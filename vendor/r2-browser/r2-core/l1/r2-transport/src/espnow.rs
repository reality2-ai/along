//! **The ESP-NOW binding's decidable half (`L1-BINDING-ESPNOW.md`).**
//!
//! ‼ **WHY THIS FILE EXISTS, AND WHY IT IS LATE (2026-09-05).** Its siblings
//! have been here for months — `lora.rs` and six companions carry the LoRa
//! binding's decidable half, `ble_advert.rs` and `ble.rs` carry BLE's — and
//! ESP-NOW had none. Everything decidable about it lived in
//! `bearers/hive-bearer-espnow`, **which cannot be built for the host**: it
//! names `esp-radio`, whose build refuses without an `esp32*` chip feature. So
//! twelve register rows sat IMPLEMENTED-UNTESTED not because the logic was
//! doubtful but because **no test could reach it**, and the same clauses were
//! provable for the other two bindings.
//!
//! *The split is the one the BLE binding already demonstrates*: the portable
//! half holds what a second implementer would have to agree with, and the
//! adapter holds the silicon. Nothing here names a chip.
//!
//! # ‼ THE FRAMING CLAUSES ARE SATISFIED BY THERE BEING NO CODE
//!
//! **2.1**: *one Reality2 frame shall occupy exactly one ESP-NOW
//! transmission, beginning at the first octet of the ESP-NOW payload.*
//! **2.2**: *no length prefix, terminator or padding shall be added.*
//!
//! **So this module deliberately contains no `wrap` and no `unwrap`**, and
//! that absence is the implementation. Compare [`crate::lora`], which HAS
//! them and says why in its own header: *that medium has no address*, so the
//! binding creates one in the wrapping L1 4.2.2 permits. **ESP-NOW has a
//! medium address of its own**, so it needs no wrapping — and a wrapping
//! added here would put octets before the frame that 2.1 says are not there.
//! The `compile_fail` on [`crate::espnow::Association`] holds that absence in place.
//!
//! # What is here
//!
//! The association table 4.2 requires, the per-peer quality 6a.2 governs, and
//! the registration precondition 6d.2 states. **Not here**: transmitting,
//! receiving, and the peer registry the radio driver keeps — the same line
//! [`crate::lora`] draws.

use crate::l1::{LinkQuality, MediumAddress, QualityScale};
use r2_ident::HiveId;

/// One learned association and the quality observed for it (**4.2**, **6a.2**).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Peer {
    address: MediumAddress,
    hive: HiveId,
    /// ‼ **RECEIVED SIGNAL STRENGTH IN dBm, AND ONLY FROM A RECEPTION.**
    /// 6a.2 says the value *shall be derived from receptions only — never
    /// from a transmission or its outcome*. There is no field here a send
    /// could write, which is why the rule is kept by the shape rather than by
    /// the caller's restraint.
    rssi_dbm: Option<i16>,
}

/// **4.2: medium addresses associated with canonical hive identifiers.**
///
/// ‼ **KEYED BY MEDIUM ADDRESS AND NOT BY HIVE**, because that is the
/// direction a reception arrives in: the radio hands up an address and the
/// bearer must answer *whose frame was that*. 4.5.1 obliges it to report the
/// canonical identifier upward, and 4.2.3 forbids it to read the frame to
/// find one — so the answer has to already be here.
///
/// ‼ **AND 2.1/2.2 ARE HELD BY AN ABSENCE THIS BLOCK GUARDS.** There is no
/// wrapping on this medium: a frame is the payload, first octet to last. The
/// block below fails to compile while that is true and **compiles, and so
/// goes red, the moment a wrapping is added**:
///
/// ```compile_fail,E0425
/// use r2_transport::espnow;
///
/// fn prefix(frame: &[u8], out: &mut [u8]) -> usize {
///     espnow::wrap(frame, out)
/// }
/// ```
pub struct Association<const N: usize> {
    peers: [Option<Peer>; N],
}

impl<const N: usize> Default for Association<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> Association<N> {
    pub const fn new() -> Self {
        Self { peers: [None; N] }
    }

    /// Associate `address` with `hive` (**4.2**). Returns whether it was held.
    ///
    /// A re-observation of a known address updates the identifier and keeps
    /// the quality: *the peer moved identity, not medium*, and discarding the
    /// measurement would make a re-association look like a fresh silent peer.
    pub fn observe(&mut self, address: MediumAddress, hive: HiveId) -> bool {
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
                    rssi_dbm: None,
                });
                return true;
            }
        }
        false
    }

    /// **4.5.1: whose frame was that.** `None` where the address is unknown —
    /// *not a guess, and not the address itself dressed as an identifier.*
    pub fn hive_at(&self, address: &MediumAddress) -> Option<HiveId> {
        self.peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)
            .map(|p| p.hive)
    }

    /// Forget one association.
    pub fn forget(&mut self, address: &MediumAddress) {
        for slot in self.peers.iter_mut() {
            if slot.is_some_and(|p| &p.address == address) {
                *slot = None;
            }
        }
    }

    /// **6a.2: record the strength of a RECEPTION.**
    ///
    /// ‼ **THERE IS NO SIBLING TAKING A TRANSMISSION OR ITS OUTCOME**, and
    /// that is the clause: *derived from receptions only — never from a
    /// transmission or its outcome.* A send that succeeded says the far radio
    /// acknowledged, which is a fact about the acknowledgement and not about
    /// the link this hive is measuring.
    pub fn observe_reception(&mut self, address: &MediumAddress, rssi_dbm: i16) {
        for p in self.peers.iter_mut().flatten() {
            if &p.address == address {
                p.rssi_dbm = Some(rssi_dbm);
            }
        }
    }

    /// The link quality for one peer, on `scale` (**6a.2**). `None` where the
    /// peer is unknown or **has been associated but never heard from** — the
    /// two are different states and neither is zero quality.
    pub fn quality_at(&self, address: &MediumAddress, scale: QualityScale) -> Option<LinkQuality> {
        let p = self
            .peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)?;
        p.rssi_dbm.and_then(|dbm| scale.quality(dbm))
    }

    /// How many associations are held.
    pub fn len(&self) -> usize {
        self.peers.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// **6d.2: may a frame be carried to this individual peer yet?**
///
/// *A frame addressed to an individual peer shall not be carried until that
/// peer has been registered with the driver.* The registration is the radio's
/// and cannot be represented here, so what this decides is the PRECONDITION:
/// given what the caller knows about registration, may the frame go.
///
/// ‼ **BROADCAST IS NOT AN INDIVIDUAL PEER AND IS NOT GATED.** Folding the
/// two would stop a hive announcing before it knew anybody — *which is the
/// state every hive starts in*, and discovery would never begin.
pub const fn may_carry_to_peer(registered: bool) -> bool {
    registered
}

/// **6d.5: a peer is registered with the medium on FIRST reception from it.**
///
/// ESP-NOW will not unicast to an address the driver has not been told about,
/// so a bearer that waited for something else — an association, an
/// identity, a routing decision — would be unable to answer the first frame
/// it ever heard. *The reception is the trigger, and it is the only trigger
/// that is always available.*
///
/// ‼ **AND 6d.6 IS THE HALF THAT LOOKS LIKE A TECHNICALITY AND IS NOT:
/// REGISTRATION IS NOT EVIDENCE ABOUT WHO THE PEER IS.** Registering an
/// address means the driver may now send to it. It does not mean the bearer
/// knows whose it is, and 4.5.1's answer still comes from the
/// [`Association`] — *a hive that read its own registration table as a
/// neighbour list would report every address that had ever transmitted near
/// it as a peer it knows.* The two tables are separate here for exactly that
/// reason, and neither writes the other.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Registered<const N: usize> {
    addresses: [Option<MediumAddress>; N],
}

impl<const N: usize> Default for Registered<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> Registered<N> {
    pub const fn new() -> Self {
        Self {
            addresses: [None; N],
        }
    }

    /// Whether `address` is already registered with the medium.
    pub fn holds(&self, address: &MediumAddress) -> bool {
        self.addresses.iter().flatten().any(|a| a == address)
    }

    /// **Note a reception and say whether the medium must now be told.**
    ///
    /// Returns `true` the FIRST time an address is seen and `false`
    /// afterwards, so a caller registers once rather than on every frame — the
    /// driver call is not free and a bearer that repeated it would spend the
    /// radio's time proportionally to traffic rather than to peers.
    ///
    /// A full table answers `false`: *there is no room to register, so the
    /// caller must not be told to.* The peer is simply not unicastable, which
    /// 6d.2 already covers, and inventing a registration the medium cannot
    /// hold would make `may_carry_to_peer` lie.
    pub fn note_reception(&mut self, address: MediumAddress) -> bool {
        if self.holds(&address) {
            return false;
        }
        for slot in self.addresses.iter_mut() {
            if slot.is_none() {
                *slot = Some(address);
                return true;
            }
        }
        false
    }

    pub fn len(&self) -> usize {
        self.addresses.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    extern crate alloc;

    use super::*;

    fn addr(tag: u8) -> MediumAddress {
        // Six octets, locally-administered bit set, and deliberately not any
        // real device's: these are fixture tags, not hardware.
        MediumAddress::new(&[0x02, 0x00, 0x00, 0x00, 0x00, tag]).expect("six octets")
    }
    fn hive(tag: u8) -> HiveId {
        HiveId([tag; 8])
    }

    /// ‼ **4.2 AND 4.5.1: THE BEARER ANSWERS *WHOSE FRAME WAS THAT* FROM THE
    /// ADDRESS ALONE.** 4.2.3 forbids it to read the frame to find out, so an
    /// address it has not been told about must answer `None` — *not the
    /// address dressed as an identifier, and not a guess.*
    #[test]
    fn an_address_answers_only_the_hive_it_was_associated_with() {
        let mut a: Association<4> = Association::new();
        assert!(a.hive_at(&addr(1)).is_none(), "nothing is known yet");

        assert!(a.observe(addr(1), hive(0xA1)));
        assert!(a.observe(addr(2), hive(0xB2)));
        assert_eq!(a.hive_at(&addr(1)), Some(hive(0xA1)));
        assert_eq!(a.hive_at(&addr(2)), Some(hive(0xB2)));
        // ‼ AN UNASSOCIATED ADDRESS IS STILL UNKNOWN, with two peers held —
        //   so the answer is per address rather than "somebody is here".
        assert_eq!(a.hive_at(&addr(3)), None);
        assert_eq!(a.len(), 2);

        // A re-observation moves the identity and does not add a peer.
        assert!(a.observe(addr(1), hive(0xC3)));
        assert_eq!(a.hive_at(&addr(1)), Some(hive(0xC3)));
        assert_eq!(a.len(), 2, "the peer moved identity, not medium");

        a.forget(&addr(1));
        assert_eq!(a.hive_at(&addr(1)), None);
        assert_eq!(a.hive_at(&addr(2)), Some(hive(0xB2)), "and only that one");
    }

    /// ‼ **6a.2: QUALITY COMES FROM RECEPTIONS ONLY, AND THE ABSENCE OF A
    /// SEND-SIDE ROUTE IS THE MECHANISM.** There is no method here taking a
    /// transmission or its outcome, so a bearer cannot record one by mistake.
    /// *A send that succeeded says the far radio acknowledged, which is a fact
    /// about the acknowledgement and not about the link being measured.*
    ///
    /// The distinction asserted below is the one that matters: **associated
    /// but never heard from** is `None`, not zero. Zero is a measured floor;
    /// `None` is no measurement, and a hive that read one as the other would
    /// treat a peer it has never heard as a peer at its worst.
    #[test]
    fn quality_is_none_until_a_reception_and_is_never_written_by_a_send() {
        let scale = QualityScale {
            floor: -95,
            ceiling: -30,
        };
        let mut a: Association<4> = Association::new();
        assert!(a.observe(addr(1), hive(0xA1)));

        assert!(
            a.quality_at(&addr(1), scale).is_none(),
            "‼ associated and never heard from is NOT zero quality"
        );
        a.observe_reception(&addr(1), -30);
        assert_eq!(a.quality_at(&addr(1), scale), Some(LinkQuality::new(1.0)));
        a.observe_reception(&addr(1), -95);
        assert_eq!(a.quality_at(&addr(1), scale), Some(LinkQuality::new(0.0)));

        // An unknown address has no quality either, and for a different
        // reason: nothing is held for it at all.
        assert!(a.quality_at(&addr(9), scale).is_none());
        // A reception for an address nobody associated is dropped rather than
        // creating a peer: 4.2 says the association is made by observing the
        // pair, and a strength alone names no hive.
        a.observe_reception(&addr(9), -40);
        assert_eq!(a.len(), 1);
        assert!(a.quality_at(&addr(9), scale).is_none());
    }

    /// ‼ **6d.2: A UNICAST WAITS FOR REGISTRATION AND A BROADCAST DOES NOT.**
    /// Folding the two would stop a hive announcing before it knew anybody —
    /// *which is the state every hive starts in* — and discovery would never
    /// begin.
    #[test]
    fn an_individual_peer_is_gated_on_registration() {
        assert!(!may_carry_to_peer(false), "6d.2: not until registered");
        assert!(may_carry_to_peer(true));
    }

    /// **A full table refuses rather than evicting.** An association silently
    /// dropped is a peer whose frames stop being attributable, which 4.5.1
    /// then answers `None` for — *a forgetting that looks like a stranger.*
    #[test]
    fn a_full_table_refuses_a_new_association() {
        let mut a: Association<2> = Association::new();
        assert!(a.observe(addr(1), hive(1)));
        assert!(a.observe(addr(2), hive(2)));
        assert!(!a.observe(addr(3), hive(3)), "full, and it says so");
        assert_eq!(a.len(), 2);
        // ‼ AND THE HELD ONES SURVIVE: the refusal is of the new peer, not of
        //   an old one evicted to make room.
        assert_eq!(a.hive_at(&addr(1)), Some(hive(1)));
        assert_eq!(a.hive_at(&addr(2)), Some(hive(2)));
    }
    /// ‼ **4.4.3: A MEDIUM THAT ACKNOWLEDGES SHALL NOT EXPOSE THE
    /// ACKNOWLEDGEMENT UPWARD, AND THE RETURN TYPE IS WHERE THAT IS KEPT.**
    /// ESP-NOW acknowledges at the MAC layer and retransmits on its own, so
    /// this is the binding the clause is most about — *the adapter has a
    /// per-frame delivery callback in its hand and must drop it.*
    ///
    /// `Bearer::send` returns `Result<(), SendError>`: the Ok half carries
    /// **nothing**, so there is no field an acknowledgement could travel in,
    /// and the error half names only conditions of the SENDER — oversize, the
    /// bearer unavailable or failed, receive-only, not carried, an unknown
    /// peer. *None of them is a statement about whether the far radio
    /// received anything*, which is the distinction 4.4.3 draws.
    ///
    /// The sweep is over every variant rather than a spot check, because the
    /// way this breaks is somebody ADDING one — `Acknowledged`, `NoAck`,
    /// `Retried` — and a test naming the six that exist today would not
    /// notice a seventh.
    #[test]
    fn nothing_in_a_send_result_can_carry_an_acknowledgement() {
        use crate::l1::SendError;
        // The Ok half is the unit type: there is no place to put an ack.
        let ok: Result<(), SendError> = Ok(());
        assert_eq!(ok, Ok(()), "the success half carries nothing at all");

        // Every error variant, listed so a seventh has to be considered here.
        let all = [
            SendError::Oversize,
            SendError::Unavailable,
            SendError::Failed,
            SendError::ReceiveOnly,
            SendError::NotCarried,
            SendError::UnknownPeer,
        ];
        for e in all {
            let rendered = alloc::format!("{e:?}");
            assert!(
                !rendered.to_lowercase().contains("ack")
                    && !rendered.to_lowercase().contains("retr")
                    && !rendered.to_lowercase().contains("deliver"),
                "‼ 4.4.3: `{rendered}` names the medium's acknowledgement or its \
                 retransmission, which must not reach a caller"
            );
        }
        // ‼ **THE POPULATION CONTROL IS AN EXHAUSTIVE MATCH AND NOT A LENGTH,
        //   AND THE FIRST DRAFT GOT THIS WRONG.** `assert_eq!(all.len(), 6)`
        //   asserts the length of the array written just above it — *a
        //   seventh variant leaves that array at six and the assertion
        //   passes*, so the sweep would silently stop covering the enum.
        //   Measured: adding `SendError::NotAcknowledged` did not redden it.
        //   A match with no wildcard cannot miss one, because a new variant
        //   stops the crate compiling until somebody decides about it.
        for e in all {
            match e {
                SendError::Oversize
                | SendError::Unavailable
                | SendError::Failed
                | SendError::ReceiveOnly
                | SendError::NotCarried
                | SendError::UnknownPeer => {}
            }
        }
    }

    /// ‼ **6d.5 AND 6d.6 TOGETHER, BECAUSE THE SECOND IS WHAT THE FIRST
    /// TEMPTS YOU INTO BREAKING.** A peer is registered with the medium on
    /// first reception — the reception is the trigger, and the only one always
    /// available, since ESP-NOW will not unicast to an address the driver has
    /// not been told about. **And registration is not evidence about who the
    /// peer is**: it means the driver may send there, not that the bearer
    /// knows whose it is.
    ///
    /// *A hive that read its own registration table as a neighbour list would
    /// report every address that had ever transmitted near it as a peer it
    /// knows* — which is 4.5.1 answered from the wrong table. The two are
    /// separate here and neither writes the other, and this asserts that
    /// separation rather than assuming it.
    #[test]
    fn registration_follows_a_first_reception_and_says_nothing_about_identity() {
        let mut reg: Registered<2> = Registered::new();
        let mut assoc: Association<4> = Association::new();

        assert!(!reg.holds(&addr(1)), "nothing is registered yet");
        assert!(
            reg.note_reception(addr(1)),
            "6d.5: the first reception registers"
        );
        assert!(reg.holds(&addr(1)));
        assert!(
            !reg.note_reception(addr(1)),
            "and the second does not — a driver call per frame would spend the \
             radio's time on traffic rather than on peers"
        );

        // ‼ 6d.6: REGISTERED AND NOT IDENTIFIED. The association table is
        //   untouched, so 4.5.1 still answers None for this address.
        assert_eq!(
            assoc.hive_at(&addr(1)),
            None,
            "‼ 6d.6: registration is not evidence about who the peer is"
        );
        assert_eq!(assoc.len(), 0, "and it created no association");

        // The reverse holds too: associating does not register. A hive that
        // learned an identity by some other route may still not unicast to it.
        assert!(assoc.observe(addr(2), hive(0xB2)));
        assert_eq!(assoc.hive_at(&addr(2)), Some(hive(0xB2)));
        assert!(!reg.holds(&addr(2)), "an association is not a registration");
        assert!(
            !may_carry_to_peer(reg.holds(&addr(2))),
            "6d.2 still refuses it"
        );

        // A full table answers false rather than inventing a registration the
        // medium cannot hold — which would make `may_carry_to_peer` lie.
        assert!(reg.note_reception(addr(3)), "the second slot");
        assert_eq!(reg.len(), 2);
        assert!(
            !reg.note_reception(addr(4)),
            "full: the caller must not be told to register"
        );
        assert!(!reg.holds(&addr(4)));
        assert!(
            reg.holds(&addr(1)) && reg.holds(&addr(3)),
            "and the held ones survive"
        );
    }
}
