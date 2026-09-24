//! **The BLE binding's decidable half (`L1-BINDING-BLE.md`).**
//!
//! # What is here and why
//!
//! There is no BLE bearer and there is no BLE stack in this workspace. But
//! most of what BND2 obliges is **not radio work**: an address predicate, a
//! tie-break, a rotation trigger, an association table, a threshold, a
//! clamped mapping and two invariants. *All of it is decidable without a
//! radio, and none of it was written.*
//!
//! ‼ **THE PRECEDENT IS [`crate::ble_advert`] AND THE REASON IS `SS399`.**
//! That module put the advertising byte layout here because a bearer, when it
//! arrives, will be host-untestable — and `SS399` then found a whole transmit
//! path that no gate arm had ever compiled, sitting in exactly such a file.
//! *Arithmetic parked in an untestable crate is not merely untested; it can
//! stop building and nothing says so.* So the decidable half lands where the
//! gate runs it, and the bearer, when it exists, calls this.
//!
//! # What is NOT here
//!
//! Connecting, scanning, GATT input and output, MTU **negotiation**, reading
//! an RSSI, and observing a supervision timeout actually elapse. Those need a
//! stack. **The decisions taken on their results are here**, which is the
//! line this module draws: *a threshold is not a negotiation, and a timer
//! comparison is not a connection.*

use crate::l1::{BearerState, ConnectionParams, QualityScale, SILENCE_PERIOD_MULTIPLE};
use r2_hal_traits::Ticks;
use r2_ident::HiveId;

// ── 4 d) medium address ─────────────────────────────────────────────────

/// A BLE device address: 48 bits and its type (**4.1**).
///
/// ‼ **THE TYPE IS PART OF THE ADDRESS AND NOT A NOTE BESIDE IT**, because
/// 4.1 says so and because the same 48 bits mean different things under
/// different types — *two peers with identical octets and different types are
/// two peers.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BleAddress {
    /// Big-endian, most significant octet first — the order **2a.2** compares
    /// in.
    pub octets: [u8; 6],
    pub kind: AddressKind,
}

/// The address types **4.2** distinguishes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AddressKind {
    /// Assigned, permanent, globally unique. **4.2 forbids it.**
    Public,
    /// Random, and which random is decided by the top two bits of the octets.
    Random,
}

/// Why an address does not satisfy **4.2**.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AddressRefusal {
    /// A public address (4.2, first prohibition).
    Public,
    /// Random static — top two bits `11` (4.2, second prohibition).
    RandomStatic,
    /// Resolvable private — top two bits `01`. **Not named by 4.2 and
    /// refused anyway**: 4.2 requires *non-resolvable* private, and a
    /// resolvable one is by construction linkable by anybody holding the
    /// identity resolving key, which is the property Note 1 exists to deny.
    ResolvablePrivate,
    /// Top two bits `10`, which no BLE address type uses.
    Reserved,
    /// All-zero or all-one random part. The Bluetooth specification forbids
    /// both for a non-resolvable private address, and **an implementation
    /// that generated one would be refused by the controller rather than by
    /// this check** — it is here so the refusal is diagnosable on the host.
    Degenerate,
}

impl BleAddress {
    /// **4.2: a non-resolvable private address, and neither a public one nor
    /// a random static one.**
    ///
    /// ‼ **THIS IS THE CLAUSE THAT MAKES RE-PERSONA MEAN ANYTHING, WHICH IS
    /// WHY IT IS A REFUSAL AND NOT A PREFERENCE.** L5 5.1.4 obliges a hive on
    /// re-persona to destroy the member keypair, the derived keys and the
    /// beacon identifier and generate all three afresh, *so that the new
    /// persona is a different hive to every observer.* **A stable medium
    /// address defeats that entirely** — the persona changes and the radio
    /// does not, and an observer carries the link across the one act that
    /// exists to break it. Note 1 to 4.5 says this in terms.
    pub const fn check(&self) -> Result<(), AddressRefusal> {
        match self.kind {
            AddressKind::Public => return Err(AddressRefusal::Public),
            AddressKind::Random => {}
        }
        // The two most significant bits of the most significant octet select
        // the random address sub-type.
        match self.octets[0] >> 6 {
            0b00 => {}
            0b01 => return Err(AddressRefusal::ResolvablePrivate),
            0b10 => return Err(AddressRefusal::Reserved),
            _ => return Err(AddressRefusal::RandomStatic),
        }
        // The 46 bits below the sub-type must not be all zero or all one.
        let mut all_zero = self.octets[0] & 0x3F == 0;
        let mut all_one = self.octets[0] & 0x3F == 0x3F;
        let mut i = 1;
        while i < 6 {
            all_zero &= self.octets[i] == 0;
            all_one &= self.octets[i] == 0xFF;
            i += 1;
        }
        if all_zero || all_one {
            return Err(AddressRefusal::Degenerate);
        }
        Ok(())
    }

    /// The address as the big-endian 48-bit unsigned integer **2a.2**
    /// compares.
    pub const fn as_u48(&self) -> u64 {
        let o = &self.octets;
        ((o[0] as u64) << 40)
            | ((o[1] as u64) << 32)
            | ((o[2] as u64) << 24)
            | ((o[3] as u64) << 16)
            | ((o[4] as u64) << 8)
            | (o[5] as u64)
    }

    /// **2a.2: does this hive abandon its outbound attempt and accept the
    /// inbound one?** True where **this** address is numerically lower.
    ///
    /// ‼ **THE RULE IS TOTAL AND ASYMMETRIC, AND BOTH PROPERTIES ARE THE
    /// POINT.** Exactly one of two distinct addresses yields, so the deadlock
    /// cannot survive the comparison — *and Note 1 records that the failure
    /// this prevents was observed on a bench and is invisible to either
    /// device*: two boards each running continuous outbound attempts and each
    /// refusing inbound, both behaving correctly by their own lights, neither
    /// able to see why nothing connects.
    pub const fn yields_to(&self, other: &BleAddress) -> bool {
        self.as_u48() < other.as_u48()
    }
}

/// **4.3: the address changes at intervals not exceeding a stated maximum,
/// and whenever the persona changes.**
///
/// ‼ **TWO TRIGGERS, AND THE SECOND IS NOT A SPECIAL CASE OF THE FIRST.** A
/// timer alone would leave a re-personad hive on its old address for up to
/// the whole interval, *which is precisely the window an observer needs to
/// carry the link across the change.* Holding both here means a caller
/// cannot implement the easy one and forget the one that matters.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AddressRotation {
    /// The stated maximum, seconds. 4.3 obliges a hive to state one and fixes
    /// no value.
    pub max_interval_s: u32,
}

impl AddressRotation {
    /// Whether the address must change now.
    ///
    /// `persona_changed` is the caller's — L5 5.1.4 is not this layer's event
    /// to observe — and it is a **parameter rather than an inferred fact**
    /// so that a bearer cannot satisfy 4.3 by watching a clock alone.
    pub fn must_rotate(
        &self,
        last_changed: Ticks,
        now: Ticks,
        ticks_per_second: u32,
        persona_changed: bool,
    ) -> bool {
        // BLE 4.3: *not exceeding* the maximum — due when it is REACHED, not one
        // tick after (`BND2-017`).
        persona_changed || now.reached(last_changed, self.max_interval_s, ticks_per_second)
    }
}

// ── 4.4, 4.5, 6a.4: what a bearer may remember about an address ─────────

/// One learned association and its quality (**4.4**, **6a.4**).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Peer {
    address: BleAddress,
    hive: HiveId,
    quality: Option<u16>,
}

/// **4.4 and 4.5: medium address to canonical hive identifier, learned from
/// traffic and forgotten when the address changes.**
///
/// ‼ **`observe` IS THE ONLY WAY IN, AND ITS NAME IS THE AUDIT.** 4.4 says
/// the association *shall be learned from received traffic and shall not be
/// computed from the address* — a rule no type can enforce, because a
/// derivation and an observation have the same shape once the value exists.
/// So the entry point is named for what it requires, and `git grep observe`
/// is how a reviewer checks that nothing computed one. *This is the same
/// idiom as `ObservedSender::asserted_by_caller` and
/// `PhysicalPossession::observed_at_the_device`.*
pub struct BleAssociations<const N: usize> {
    peers: [Option<Peer>; N],
}

impl<const N: usize> Default for BleAssociations<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> BleAssociations<N> {
    pub const fn new() -> Self {
        Self { peers: [None; N] }
    }

    /// Record that `hive` was **heard from** at `address` (4.4).
    ///
    /// Returns `false` where the table is full: a bearer that silently
    /// dropped an association would report a known peer as unknown, which is
    /// a different fact from a peer that has not spoken.
    pub fn observe(&mut self, address: BleAddress, hive: HiveId) -> bool {
        for p in self.peers.iter_mut().flatten() {
            if p.address == address {
                p.hive = hive;
                return true;
            }
        }
        for slot in self.peers.iter_mut() {
            if slot.is_none() {
                *slot = Some(Peer {
                    address,
                    hive,
                    quality: None,
                });
                return true;
            }
        }
        false
    }

    /// The identifier to report upward for `address` (4.4), or `None`.
    pub fn hive_at(&self, address: &BleAddress) -> Option<HiveId> {
        self.peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)
            .map(|p| p.hive)
    }

    /// The current medium address for a canonical hive identifier.
    ///
    /// This is the send-side inverse of [`Self::hive_at`].  It is deliberately
    /// an association lookup rather than an address derivation: binding 4.4
    /// permits only an address learned from received traffic to become a
    /// delivery handle.
    pub fn address_for(&self, hive: HiveId) -> Option<BleAddress> {
        self.peers
            .iter()
            .flatten()
            .find(|p| p.hive == hive)
            .map(|p| p.address)
    }

    /// Visit the canonical associations and their last RSSI, if one has been
    /// observed.  The controller adapter uses this to implement L1 5.1 and
    /// 5.3 without exposing the table's representation.
    pub fn for_each(&self, f: &mut dyn FnMut(BleAddress, HiveId, Option<i16>)) {
        for peer in self.peers.iter().flatten() {
            f(
                peer.address,
                peer.hive,
                peer.quality.map(|rssi| rssi as i16),
            );
        }
    }

    /// **4.5: the address changed, so the association and its quality go.**
    ///
    /// ‼ **AND NOTHING IS CARRIED ACROSS, WHICH IS THE HALF THAT IS EASY TO
    /// GET WRONG.** 4.5 says a bearer *shall not treat two addresses as one
    /// peer on any evidence this layer holds* — so this takes the OLD address
    /// only and cannot be handed a new one to migrate the entry to. *A
    /// signature that accepted both would make the prohibited operation the
    /// convenient one.*
    pub fn forget(&mut self, address: &BleAddress) {
        for slot in self.peers.iter_mut() {
            if slot.as_ref().is_some_and(|p| &p.address == address) {
                *slot = None;
            }
        }
    }

    /// Record a signal strength for `address` (**6a.4**: held per medium
    /// address). Ignored where the address is not associated.
    pub fn observe_quality(&mut self, address: &BleAddress, rssi_dbm: i16) {
        for p in self.peers.iter_mut().flatten() {
            if &p.address == address {
                p.quality = Some(rssi_dbm as u16);
            }
        }
    }

    /// The recorded signal strength for `address`, if any.
    pub fn rssi_at(&self, address: &BleAddress) -> Option<i16> {
        self.peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)
            .and_then(|p| p.quality)
            .map(|q| q as i16)
    }

    pub fn len(&self) -> usize {
        self.peers.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

// ── 5.1.3: the maximum transmission unit floor ──────────────────────────

/// **5.1.3's floor: 200 octets plus the three-octet ATT operation header.**
///
/// The arithmetic is stated in the clause *because getting it wrong produces
/// the worst failure this medium offers* — a frame truncated by the
/// controller, delivered as a short write, and parsed as malformed by a layer
/// with no way to know the medium did it.
pub const MTU_FLOOR: u16 = 203;

/// **5.1.3: what a connection at this maximum transmission unit may do.**
///
/// Below the floor the bearer reports `restricted` **and carries no frame on
/// that connection** — the two halves are one decision, so they are one
/// function rather than a constant a caller compares against and a rule a
/// caller remembers.
pub const fn state_for_mtu(mtu: u16) -> BearerState {
    if mtu >= MTU_FLOOR {
        BearerState::Available
    } else {
        BearerState::Restricted
    }
}

/// **2.5: a frame is never reassembled from more than one characteristic
/// operation.**
///
/// True where the frame fits one operation, which is the maximum transmission
/// unit less the three-octet ATT header. ‼ **A FALSE HERE IS A REFUSAL TO
/// SEND, NOT AN INSTRUCTION TO SPLIT** — 2.5 forbids the reassembly, so a
/// bearer meeting an over-long frame has no conforming way to carry it.
pub const fn fits_one_operation(mtu: u16, frame_len: usize) -> bool {
    (mtu as usize).saturating_sub(3) >= frame_len
}

// ── 6a.2: signal strength to link quality ───────────────────────────────

/// The stated floor and ceiling of **6a.3** for BLE, in **dBm**.
///
/// ‼ **THE SHAPE LIVES IN L1 AS [`QualityScale`] BECAUSE 5.3.1 IS THE PARENT
/// CLAUSE AND EVERY BINDING'S 6a.2 IS ITS INSTANCE.** BLE measures received
/// signal strength; LoRa measures signal-to-noise ratio. *The units differ,
/// the contract does not*, and two copies of *floor, ceiling, clamped,
/// monotonic* would be two places for it to drift.
///
/// 6a.3 fixes neither bound — Note 1: the usable range is a property of an
/// antenna, a package and an enclosure, and a number fixed here would be
/// wrong for most of them.
pub type QualityRange = QualityScale;

/// **6a.5: B5, the fade rate, shall exceed the longest advertising interval
/// the hive can adopt.**
///
/// ‼ **STRICTLY EXCEED, AND EQUALITY IS THE INTERESTING CASE.** At equality a
/// peer advertising exactly on its longest interval fades in the same instant
/// it speaks, so it flickers between heard and receded **while behaving
/// perfectly** — the observable is an unstable neighbour table and the cause
/// is two numbers that were merely equal.
pub const fn fade_rate_clears_advertising(fade_rate_s: u32, longest_advertising_s: u32) -> bool {
    fade_rate_s > longest_advertising_s
}

// ── 6d: what a connection-bearing medium declares ───────────────────────

/// **6d.2 and 6d.3, which supply the numbers L1 10.2 and 10.3 ask for.**
///
/// ⚠ **THIS DISCHARGES `SS2`'s PRACTICAL HALF AND NOT ITS CLAUSE-LEVEL
/// HALF**, which the binding's own Note 1 to 6d says. `SS2` records that L1
/// 10.2 says the silence period is declared *in its profile* while Clause 7's
/// profile carries no such field, and that the interval 10.3 multiplies by
/// three is **declared nowhere at all**. *This binding names both for BLE —
/// the connection interval and the link supervision timeout — so a BLE bearer
/// can be built; the missing profile field is still missing.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BleConnection {
    /// 6d.2: the interval in force on the link, milliseconds.
    pub connection_interval_ms: u32,
    /// 6d.3: the link supervision timeout, milliseconds.
    pub supervision_timeout_ms: u32,
}

impl BleConnection {
    /// **6d.3: at least three times the connection interval.**
    ///
    /// Uses L1's own [`SILENCE_PERIOD_MULTIPLE`] rather than a literal three,
    /// so the binding and the layer cannot drift apart — *the multiple is
    /// 10.3's and this clause is its instance.*
    pub const fn timeout_clears_interval(&self) -> bool {
        self.supervision_timeout_ms >= self.connection_interval_ms * SILENCE_PERIOD_MULTIPLE
    }

    /// Whether these integer-millisecond facts can be represented exactly by
    /// a Bluetooth LE controller request.
    ///
    /// Connection intervals use 1.25 ms units and supervision timeouts use
    /// 10 ms units. P3 deliberately writes whole milliseconds, so an integer
    /// interval must be a multiple of five milliseconds to avoid a controller
    /// rounding the declared value. The integer form's smallest legal interval
    /// is consequently 10 ms (Bluetooth also permits 7.5 ms, which P3 cannot
    /// spell). This is a medium fact, not a host-library policy.
    pub const fn is_bluetooth_le_representable(&self) -> bool {
        self.connection_interval_ms >= 10
            && self.connection_interval_ms <= 4_000
            && self.connection_interval_ms.is_multiple_of(5)
            && self.supervision_timeout_ms >= 100
            && self.supervision_timeout_ms <= 32_000
            && self.supervision_timeout_ms.is_multiple_of(10)
            && self.supervision_timeout_ms > self.connection_interval_ms.saturating_mul(2)
    }

    /// The L1 Clause 10 parameters this connection implies.
    ///
    /// ‼ **SECONDS, ROUNDED UP, AND THE DIRECTION IS DELIBERATE.** L1 10.2's
    /// period is in seconds and BLE states both figures in milliseconds, so
    /// the conversion loses resolution. Rounding **down** would declare a peer
    /// unreachable before its supervision timeout had actually elapsed —
    /// *reporting a loss the medium has not yet had* — so it rounds up.
    pub const fn as_connection_params(&self, max_reattempt_interval_s: u32) -> ConnectionParams {
        ConnectionParams {
            silence_period_s: self.supervision_timeout_ms.div_ceil(1_000),
            max_reattempt_interval_s,
        }
    }
}

/// **6d.6: exhausting the stated connection limit produces `restricted`.**
pub const fn state_for_connections(in_use: usize, limit: usize) -> BearerState {
    if in_use >= limit {
        BearerState::Restricted
    } else {
        BearerState::Available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn addr(top: u8, kind: AddressKind) -> BleAddress {
        BleAddress {
            octets: [top, 0x22, 0x33, 0x44, 0x55, 0x66],
            kind,
        }
    }

    /// **4.2, and every refusal it distinguishes.** The positives and the
    /// negatives are in one test because the sub-type is two bits and a
    /// predicate that accepted everything would pass any test written from
    /// one side.
    #[test]
    fn only_a_non_resolvable_private_address_satisfies_4_2() {
        // `00` in the top two bits, random: the one 4.2 requires.
        assert_eq!(addr(0x00, AddressKind::Random).check(), Ok(()));
        assert_eq!(addr(0x3F, AddressKind::Random).check(), Ok(()));

        assert_eq!(
            addr(0x00, AddressKind::Public).check(),
            Err(AddressRefusal::Public),
            "4.2 forbids a public address whatever its bits"
        );
        assert_eq!(
            addr(0xC0, AddressKind::Random).check(),
            Err(AddressRefusal::RandomStatic),
            "`11` is random static, forbidden by name"
        );
        assert_eq!(
            addr(0x40, AddressKind::Random).check(),
            Err(AddressRefusal::ResolvablePrivate),
            "`01` is linkable by anyone holding the resolving key"
        );
        assert_eq!(
            addr(0x80, AddressKind::Random).check(),
            Err(AddressRefusal::Reserved)
        );
    }

    /// The degenerate random parts, which a controller would refuse anyway —
    /// caught here so the refusal is diagnosable on the host.
    #[test]
    fn an_all_zero_or_all_one_random_part_is_refused() {
        assert_eq!(
            BleAddress {
                octets: [0x00; 6],
                kind: AddressKind::Random
            }
            .check(),
            Err(AddressRefusal::Degenerate)
        );
        assert_eq!(
            BleAddress {
                octets: [0x3F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
                kind: AddressKind::Random
            }
            .check(),
            Err(AddressRefusal::Degenerate),
            "all ones BELOW the sub-type bits"
        );
        // And one bit away from degenerate is fine, so the check is not
        // simply refusing everything near the edges.
        assert_eq!(
            BleAddress {
                octets: [0x00, 0x00, 0x00, 0x00, 0x00, 0x01],
                kind: AddressKind::Random
            }
            .check(),
            Ok(())
        );
    }

    /// ‼ **2a.2: EXACTLY ONE OF TWO DISTINCT ADDRESSES YIELDS.** The
    /// asymmetry is the whole mechanism — Note 1 records two boards each
    /// running continuous outbound attempts and each refusing inbound, *both
    /// behaving correctly and neither able to see why nothing connects.*
    #[test]
    fn the_yield_rule_is_total_and_exactly_one_side_gives_way() {
        let low = addr(0x00, AddressKind::Random);
        let high = addr(0x3F, AddressKind::Random);
        assert!(low.yields_to(&high));
        assert!(!high.yields_to(&low));
        assert!(
            low.yields_to(&high) ^ high.yields_to(&low),
            "exactly one yields, which is what breaks the deadlock"
        );
        // Big-endian: the FIRST octet dominates, which is what 2a.2 means by
        // a big-endian 48-bit unsigned integer.
        let a = BleAddress {
            octets: [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
            kind: AddressKind::Random,
        };
        let b = BleAddress {
            octets: [0x02, 0x00, 0x00, 0x00, 0x00, 0x00],
            kind: AddressKind::Random,
        };
        assert!(a.yields_to(&b), "little-endian would give the opposite");
        assert_eq!(b.as_u48(), 0x0200_0000_0000);
    }

    /// ‼ **4.3's SECOND TRIGGER IS NOT A SPECIAL CASE OF THE FIRST.** A timer
    /// alone leaves a re-personad hive on its old address for up to the whole
    /// interval — *the exact window an observer needs to carry the link
    /// across the change L5 5.1.4 exists to make unfollowable.*
    #[test]
    fn a_persona_change_rotates_the_address_without_waiting_for_the_timer() {
        let r = AddressRotation {
            max_interval_s: 900,
        };
        let start = Ticks(0);
        let soon = Ticks(60);

        assert!(
            !r.must_rotate(start, soon, 1, false),
            "a minute into a fifteen-minute interval, nothing has happened"
        );
        assert!(
            r.must_rotate(start, soon, 1, true),
            "and the persona change rotates it anyway"
        );
        // The timer half still works on its own — and 4.3 says *not exceeding*
        // the maximum, so it is due AT the maximum, not one tick after it.
        assert!(
            r.must_rotate(start, Ticks(900), 1, false),
            "due at the maximum"
        );
        assert!(!r.must_rotate(start, Ticks(899), 1, false), "not yet");
    }

    fn hive(n: u8) -> HiveId {
        HiveId([n; 8])
    }

    /// BLE 4.3 (`BND2-017`): *a hive shall change that address at intervals not
    /// exceeding a stated maximum.* Due AT the maximum — a rotation that waits
    /// for the maximum to be exceeded realises max plus one tick, which exceeds
    /// it. Goes red with a strict comparison.
    #[test]
    fn the_address_rotation_is_due_when_the_maximum_is_reached_not_after() {
        let policy = AddressRotation {
            max_interval_s: 600,
        };
        let tps = 1_000;
        let changed = Ticks(5_000);
        let one_tick_before = Ticks(5_000 + 600 * 1_000 - 1);
        let at_the_maximum = Ticks(5_000 + 600 * 1_000);
        assert!(
            !policy.must_rotate(changed, one_tick_before, tps, false),
            "not yet"
        );
        assert!(
            policy.must_rotate(changed, at_the_maximum, tps, false),
            "4.3: due at the maximum"
        );
        assert!(
            policy.must_rotate(changed, Ticks(5_000), tps, true),
            "a persona change is due at once"
        );
    }

    /// **4.4 and 4.5**, and the negative that matters: a forgotten address
    /// takes its quality with it (6a.4 Note 2 — *a quality value that
    /// outlived the address it was measured on would be a measurement of one
    /// radio attributed to another*).
    #[test]
    fn an_association_and_its_quality_die_with_the_address() {
        let mut t: BleAssociations<4> = BleAssociations::new();
        let a = addr(0x01, AddressKind::Random);
        let b = addr(0x02, AddressKind::Random);

        assert!(t.observe(a, hive(1)));
        assert!(t.observe(b, hive(2)));
        t.observe_quality(&a, -70);
        assert_eq!(t.hive_at(&a), Some(hive(1)));
        assert_eq!(t.address_for(hive(1)), Some(a));
        assert_eq!(t.rssi_at(&a), Some(-70));

        let mut visited = None;
        t.for_each(&mut |address, identifier, rssi| {
            if identifier == hive(1) {
                visited = Some((address, rssi));
            }
        });
        assert_eq!(visited, Some((a, Some(-70))));

        t.forget(&a);
        assert_eq!(t.hive_at(&a), None);
        assert_eq!(t.rssi_at(&a), None, "the quality went with it");
        assert_eq!(t.hive_at(&b), Some(hive(2)), "and only that one went");
        assert_eq!(t.len(), 1);
    }

    /// A full table refuses rather than dropping silently: a known peer
    /// reported as unknown is a different fact from a peer that has not
    /// spoken.
    #[test]
    fn a_full_association_table_says_so() {
        let mut t: BleAssociations<2> = BleAssociations::new();
        assert!(t.observe(addr(0x01, AddressKind::Random), hive(1)));
        assert!(t.observe(addr(0x02, AddressKind::Random), hive(2)));
        assert!(!t.observe(addr(0x03, AddressKind::Random), hive(3)));
        // And re-observing an address already held is an update, not an
        // insertion, so a talkative peer cannot fill the table.
        assert!(t.observe(addr(0x01, AddressKind::Random), hive(9)));
        assert_eq!(t.hive_at(&addr(0x01, AddressKind::Random)), Some(hive(9)));
        assert_eq!(t.len(), 2);
    }

    /// ‼ **5.1.3's FLOOR IS 200 PLUS THE THREE-OCTET ATT HEADER**, and the
    /// clause states the arithmetic because getting it wrong yields a frame
    /// truncated by the controller and parsed as malformed by a layer with no
    /// way to know the medium did it.
    #[test]
    fn a_connection_below_the_mtu_floor_is_restricted_and_carries_nothing() {
        assert_eq!(MTU_FLOOR, 203, "200 plus the ATT operation header");
        assert_eq!(state_for_mtu(203), BearerState::Available);
        assert_eq!(state_for_mtu(202), BearerState::Restricted);
        assert_eq!(
            state_for_mtu(23),
            BearerState::Restricted,
            "the BLE default"
        );

        // 2.5: at the floor a 200-octet frame fits one operation, and 201
        // does not — the boundary the header accounts for.
        assert!(fits_one_operation(203, 200));
        assert!(!fits_one_operation(203, 201));
        // And a tiny MTU cannot be talked into a negative budget.
        assert!(!fits_one_operation(2, 1));
    }

    /// BLE 6a.4 (`BND2-052`): the quality value is held per medium address. Two
    /// peers, one reading: the other's quality stays absent, and forgetting one
    /// leaves the other's reading untouched. Goes red if the reading is hoisted
    /// to a table-wide value.
    #[test]
    fn a_quality_reading_belongs_to_one_address_and_not_to_the_table() {
        let mut t: BleAssociations<4> = BleAssociations::new();
        let a = addr(0x01, AddressKind::Random);
        let b = addr(0x02, AddressKind::Random);
        assert!(t.observe(a, hive(1)));
        assert!(t.observe(b, hive(2)));
        t.observe_quality(&a, -60);
        assert_eq!(t.rssi_at(&a), Some(-60));
        assert_eq!(t.rssi_at(&b), None, "b has no reading of its own");
        t.observe_quality(&b, -80);
        assert_eq!(t.rssi_at(&a), Some(-60), "a's reading is not b's");
        t.forget(&a);
        assert_eq!(t.rssi_at(&b), Some(-80), "forgetting a leaves b's reading");
    }

    /// **6a.2: floor to 0.0, ceiling to 1.0, clamped, monotonic.** The
    /// monotonicity is swept rather than sampled, because a mapping that is
    /// monotonic at three points and not in between is the defect this clause
    /// is guarding against.
    #[test]
    fn quality_is_clamped_at_both_ends_and_monotonic_between_them() {
        let r = QualityRange {
            floor: -100,
            ceiling: -40,
        };
        assert_eq!(r.quality(-100).unwrap().0, 0.0);
        assert_eq!(r.quality(-40).unwrap().0, 1.0);
        assert_eq!(r.quality(-120).unwrap().0, 0.0, "clamped below");
        assert_eq!(r.quality(0).unwrap().0, 1.0, "clamped above");

        let mut last = -1.0;
        for dbm in -120..=0 {
            let q = r.quality(dbm).unwrap().0;
            assert!(q >= last, "fell at {dbm} dBm: {q} < {last}");
            assert!((0.0..=1.0).contains(&q));
            last = q;
        }

        // ‼ MONOTONIC AND IN RANGE IS NOT LINEAR (BND2-050, added 2026-09-04 after an
        //   adversarial pass). Everything above holds for a cubic map and for a four-step
        //   floor ladder — both were measured passing — because the sweep constrains only
        //   the ORDER of the values and their bounds, never the shape between the ends. A
        //   quality that jumps in steps is indistinguishable here from one that tracks the
        //   signal, and the difference is the whole point of reporting a ratio rather than
        //   a band. The interior is therefore pinned at the quarter points, where a ladder
        //   and a curve both depart from the straight line by more than the tolerance.
        for (dbm, want) in [(-85i16, 0.25f32), (-70, 0.5), (-55, 0.75)] {
            let q = r.quality(dbm).unwrap().0;
            assert!(
                (q - want).abs() < 0.01,
                "the interior is linear between floor and ceiling: at {dbm} dBm expected \
                 about {want}, got {q} — a stepped or curved map passes the sweep above"
            );
        }
    }

    /// ‼ **AN INVERTED OR DEGENERATE RANGE REFUSES RATHER THAN NORMALISING.**
    /// Both produce a mapping that looks monotonic — one is monotonic the
    /// wrong way, the other constant — and *a link quality that does not vary
    /// with signal is indistinguishable from a radio that is not measuring.*
    #[test]
    fn an_unusable_quality_range_refuses() {
        assert!(QualityRange {
            floor: -40,
            ceiling: -100
        }
        .quality(-70)
        .is_none());
        assert!(QualityRange {
            floor: -70,
            ceiling: -70
        }
        .quality(-70)
        .is_none());
        assert!(QualityRange {
            floor: -71,
            ceiling: -70
        }
        .is_usable());
    }

    /// ‼ **6a.5 IS A STRICT INEQUALITY AND EQUALITY IS THE INTERESTING
    /// CASE**: a peer advertising exactly on its longest interval would fade
    /// in the same instant it speaks, flickering between heard and receded
    /// while behaving perfectly.
    #[test]
    fn the_fade_rate_must_strictly_exceed_the_longest_advertising_interval() {
        assert!(fade_rate_clears_advertising(61, 60));
        assert!(!fade_rate_clears_advertising(60, 60), "equality flickers");
        assert!(!fade_rate_clears_advertising(59, 60));
    }

    /// **6d.3**, expressed through L1's own multiple rather than a literal
    /// three, so the binding and the layer cannot drift apart.
    #[test]
    fn the_supervision_timeout_is_at_least_three_connection_intervals() {
        let ok = BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 300,
        };
        assert!(ok.timeout_clears_interval());
        assert!(!BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 299
        }
        .timeout_clears_interval());
        assert_eq!(SILENCE_PERIOD_MULTIPLE, 3, "L1 10.3's multiple");

        // And it feeds L1 Clause 10 in seconds, rounded UP: rounding down
        // would report a peer unreachable before its timeout had elapsed.
        let p = BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 3_200,
        }
        .as_connection_params(30);
        assert_eq!(p.silence_period_s, 4, "3.2 s rounds up, never down");
        assert!(p.silence_period_s * 1_000 >= 3_200);
    }

    #[test]
    fn controller_timing_is_exactly_representable_in_the_declared_units() {
        assert!(BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 300,
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            connection_interval_ms: 101,
            supervision_timeout_ms: 310,
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 301,
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            connection_interval_ms: 5,
            supervision_timeout_ms: 100,
        }
        .is_bluetooth_le_representable());
    }

    /// **6d.6**: exhausting the stated limit is `restricted`, not a refusal
    /// and not `unavailable` — the bearer is still carrying its existing
    /// connections.
    #[test]
    fn exhausting_the_connection_limit_restricts_rather_than_failing() {
        assert_eq!(state_for_connections(0, 3), BearerState::Available);
        assert_eq!(state_for_connections(2, 3), BearerState::Available);
        assert_eq!(state_for_connections(3, 3), BearerState::Restricted);
        assert_eq!(state_for_connections(4, 3), BearerState::Restricted);
        // ‼ A LIMIT OF ZERO IS RESTRICTED FROM THE START, not available: a
        //   bearer that may hold no connection cannot take a new peer, and
        //   `>=` is what makes the empty case fall the same way as the full
        //   one rather than through the other arm.
        assert_eq!(state_for_connections(0, 0), BearerState::Restricted);
    }
    /// ‼ **6a-ter.3a: A DECLARED CONNECTION INTERVAL OR SUPERVISION TIMEOUT IS
    /// NOT ROUNDED WHEN IT IS APPLIED — IT IS REFUSED.** BLE states the
    /// connection interval in 1.25 ms units and the supervision timeout in
    /// 10 ms units, so a declared figure the controller cannot express exactly
    /// has to go somewhere. **Rounding is the tempting answer and the wrong
    /// one**: the platform published a number an operator can read (L0 8.4.1),
    /// and applying a different one makes the declaration false while
    /// everything continues to work. `is_bluetooth_le_representable` refuses
    /// instead, so the profile never loads.
    ///
    /// *The boundaries are asserted from both sides, because a refusal that
    /// rejects everything satisfies the clause and nothing else.*
    #[test]
    fn a_declared_timing_the_controller_cannot_express_exactly_is_refused_not_rounded() {
        let ok = BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 2_000,
        };
        assert!(
            ok.is_bluetooth_le_representable(),
            "the control: a usable pair"
        );

        // ‼ NOT A MULTIPLE OF THE UNIT. 1.25 ms units mean the interval must be
        //   a multiple of 5 ms; 101 would have to be rounded to be applied.
        assert!(!BleConnection {
            connection_interval_ms: 101,
            ..ok
        }
        .is_bluetooth_le_representable());
        // 10 ms units for the timeout; 2005 would have to be rounded.
        assert!(!BleConnection {
            supervision_timeout_ms: 2_005,
            ..ok
        }
        .is_bluetooth_le_representable());

        // The ends of each range, from both sides.
        assert!(BleConnection {
            connection_interval_ms: 10,
            ..ok
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            connection_interval_ms: 5,
            ..ok
        }
        .is_bluetooth_le_representable());
        assert!(BleConnection {
            connection_interval_ms: 4_000,
            supervision_timeout_ms: 32_000
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            connection_interval_ms: 4_005,
            supervision_timeout_ms: 32_000
        }
        .is_bluetooth_le_representable());
        assert!(!BleConnection {
            supervision_timeout_ms: 32_010,
            ..ok
        }
        .is_bluetooth_le_representable());
        assert!(
            !BleConnection {
                connection_interval_ms: 40,
                supervision_timeout_ms: 90
            }
            .is_bluetooth_le_representable(),
            "below the 100 ms floor"
        );

        // ‼ AND THE RELATION, WHICH IS NOT A UNIT QUESTION: a supervision
        //   timeout at or under twice the interval cannot survive a single
        //   missed event, so the link would drop on one lost packet.
        assert!(
            !BleConnection {
                connection_interval_ms: 1_000,
                supervision_timeout_ms: 2_000
            }
            .is_bluetooth_le_representable(),
            "exactly twice is not enough"
        );
        assert!(
            BleConnection {
                connection_interval_ms: 1_000,
                supervision_timeout_ms: 2_010
            }
            .is_bluetooth_le_representable(),
            "just over twice is"
        );
    }

    /// ‼ **6d.5/6d.7 AND L1 10.2: THE SILENCE PERIOD IS THE SUPERVISION
    /// TIMEOUT IN FORCE ON THAT LINK, AND THE CONVERSION ROUNDS UP.** L1 10.2
    /// states the period in seconds and BLE states the timeout in
    /// milliseconds, so resolution is lost — and the DIRECTION of the loss is
    /// the clause. *Rounding down would declare a peer unreachable before its
    /// supervision timeout had actually elapsed, reporting a loss the medium
    /// has not yet had.*
    #[test]
    fn the_silence_period_rounds_up_so_a_peer_is_never_lost_early() {
        let c = BleConnection {
            connection_interval_ms: 100,
            supervision_timeout_ms: 2_500,
        };
        let p = c.as_connection_params(60);
        assert_eq!(
            p.silence_period_s, 3,
            "2.5 s rounds UP to 3 — rounding down would report a loss at 2 s \
             that the medium has not had"
        );
        assert_eq!(
            p.max_reattempt_interval_s, 60,
            "10.4's figure is carried, not derived"
        );

        // An exact second is not inflated: rounding up is for the remainder.
        assert_eq!(
            BleConnection {
                supervision_timeout_ms: 2_000,
                ..c
            }
            .as_connection_params(60)
            .silence_period_s,
            2
        );
        // And a sub-second timeout still yields a whole second rather than
        // zero, which would make every peer instantly unreachable.
        assert_eq!(
            BleConnection {
                connection_interval_ms: 10,
                supervision_timeout_ms: 100
            }
            .as_connection_params(60)
            .silence_period_s,
            1
        );
    }
}
