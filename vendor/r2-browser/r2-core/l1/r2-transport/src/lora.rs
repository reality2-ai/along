//! **The LoRa binding's decidable half (`L1-BINDING-LORA.md`).**
//!
//! # The wrapping, which is unique in this corpus
//!
//! ‼ **THIS IS THE ONLY BINDING THAT WRAPS, AND 2.2 Note 1 GIVES THE REASON:
//! THE MEDIUM HAS NO ADDRESS.** *A LoRa transmission carries no source field
//! and no destination field* (4.1), while L1 **4.5.1** obliges a bearer to
//! report the sender's canonical hive identifier and **4.2.3** forbids it to
//! read the frame in order to find one. **So this binding creates an address**
//! in the wrapping L1 4.2.2 permits.
//!
//! *The wrapping is not a loophole and the binding argues both objections
//! down in terms*: 4.7.2 forbids the **marker** inside the frame, and the
//! marker here is the sync word (3.1), not this; 4.2.3 forbids a bearer
//! **interpreting a frame's contents**, and a bearer reading its own wrapping
//! reads bytes it wrote.
//!
//! # ‼ THE ADDRESS IS A LABEL AND NOT A CLAIM
//!
//! **4.6** is a clause rather than a note for a reason the binding states:
//! the address is *four octets any transmitter may set to anything, on a
//! medium with no authentication whatever.* **Its only job is to let a bearer
//! say _these two receptions came from the same radio_**, so that 4.5.3's
//! derived identifier has something to be derived from *and the neighbour
//! table does not collapse every peer into one.*
//!
//! Everything that depends on knowing **who** a peer is happens above Layer 4
//! — *which is why a forgeable label costs nothing here, and why treating it
//! as evidence would be the one way to make it cost something.*
//!
//! # What is here and what needs a radio
//!
//! Here: the wrapping's layout, the address's generation and rotation rule,
//! the association table, quality held per address, and the fade predicate.
//! **Not here**: transmitting, receiving, and the PHY. *The same line
//! [`crate::ble`] draws, and for the reason `SS399` made concrete — a file
//! the gate does not compile is a file nothing checks.*

use crate::fade_rate::FadeRate;
use crate::l1::{
    BearerProfile, Fade, LinkQuality, Ordinal, QualityScale, Receptivity, SendError, SendTarget,
};
use r2_hal_traits::Ticks;
use r2_ident::HiveId;

/// **4.2: the wrapping is four octets carrying the sender's medium address,
/// and precedes the frame.**
///
/// Note 3 to 4.4 states the size *so a later revision can argue with the
/// reasoning rather than the number*: a long-range bearer's neighbourhood is
/// bounded by airtime long before it is bounded by address space, and four
/// octets cost about 1.8 % of the largest payload. *A collision costs two
/// hives one shared neighbour entry until either rotates — a degradation, not
/// a failure.*
pub const WRAPPING_LEN: usize = 4;

/// A LoRa medium address: four octets this binding invents (4.1, 4.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LoraAddress(pub [u8; WRAPPING_LEN]);

impl LoraAddress {
    /// Draw an address from entropy (**4.3**).
    ///
    /// ‼ **`from_entropy` AND NOT `from_identity`, AND THE NAME IS THE
    /// AUDIT.** 4.3 says a hive *shall generate it at random* and **shall not
    /// derive it from any other identifier it holds* — a rule no type can
    /// enforce, because a derivation and a draw are both four octets once
    /// they exist. *So the only constructor names its source, and
    /// `git grep from_entropy` is how a reviewer checks nothing derived one.*
    ///
    /// Note 2 to 4.6 explains why this binding is where the rule was cheapest
    /// to apply: **the address does not exist in hardware**, so nothing forces
    /// it to outlive the persona it served. *A binding that had simply used a
    /// chip serial number would have built the `SS384` defect into a medium
    /// that did not have it.*
    /// ‼ **AND IT IS THE ONLY CONSTRUCTOR, WHICH IS WHAT THE AUDIT RESTS ON.**
    /// `git grep from_entropy` only works as a review if there is no second
    /// door — *a `from_identity`, a `From<HiveId>`, a `Default`, or a public
    /// field would each be a route by which a derived value becomes an
    /// address, and the type would go on looking correct.* The tuple field is
    /// `pub` for the wrapping code that writes it on air, so a literal is a
    /// real risk rather than a hypothetical one, and the block below is what
    /// keeps the name honest: it fails to compile while `from_entropy` is the
    /// only way in, and **compiles, and so goes red, the moment a deriving
    /// constructor is added**.
    ///
    /// ```compile_fail,E0599
    /// use r2_transport::lora::LoraAddress;
    /// use r2_ident::HiveId;
    ///
    /// fn from_the_hive(id: HiveId) -> LoraAddress {
    ///     LoraAddress::from_identity(id)
    /// }
    /// ```
    pub const fn from_entropy(drawn: [u8; WRAPPING_LEN]) -> Self {
        Self(drawn)
    }
}

/// Why a transmission payload could not be read.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WrappingError {
    /// Shorter than the wrapping, so it carries no frame and no address.
    TooShort { len: usize },
    /// The caller's buffer cannot hold the wrapping plus the frame.
    BufferTooSmall { needed: usize },
}

/// **2.2: write the wrapping followed by the frame.** Returns the octets
/// written.
pub fn wrap(from: LoraAddress, frame: &[u8], out: &mut [u8]) -> Result<usize, WrappingError> {
    let needed = WRAPPING_LEN + frame.len();
    if out.len() < needed {
        return Err(WrappingError::BufferTooSmall { needed });
    }
    out[..WRAPPING_LEN].copy_from_slice(&from.0);
    out[WRAPPING_LEN..needed].copy_from_slice(frame);
    Ok(needed)
}

/// **2.2: remove the wrapping before delivering the frame upward** (L1
/// 4.2.2), returning the sender's address and the frame.
///
/// ‼ **A PAYLOAD OF EXACTLY FOUR OCTETS IS AN ADDRESS AND AN EMPTY FRAME, NOT
/// AN ERROR.** The frame layer decides whether an empty frame is meaningful;
/// this one has removed its wrapping correctly either way. *A bearer that
/// refused here would be interpreting the frame's contents, which 4.2.3
/// forbids it to do.*
pub fn unwrap(payload: &[u8]) -> Result<(LoraAddress, &[u8]), WrappingError> {
    if payload.len() < WRAPPING_LEN {
        return Err(WrappingError::TooShort { len: payload.len() });
    }
    let mut addr = [0u8; WRAPPING_LEN];
    addr.copy_from_slice(&payload[..WRAPPING_LEN]);
    Ok((LoraAddress(addr), &payload[WRAPPING_LEN..]))
}

/// **4.3: the address changes whenever the persona changes** (L5 5.1.4).
///
/// ‼ **ONE TRIGGER, NOT TWO, AND THAT IS THE DIFFERENCE FROM BLE.** BLE 4.3
/// requires rotation *at intervals not exceeding a stated maximum* **and** on
/// a persona change; LoRa 4.3 states only the persona change. *This is not an
/// oversight to paper over*: BLE advertises continuously to anyone in range,
/// so a stable address is a tracking handle even within one persona, while a
/// duty-cycled long-range bearer transmits rarely. **Adding a timer here
/// would be inventing an obligation the binding does not state**, and the
/// asymmetry is recorded rather than smoothed away.
pub const fn must_rotate(persona_changed: bool) -> bool {
    persona_changed
}

/// **4.3 performed, and not merely decided**: rotate the address on a persona
/// change and discard everything the old address wrapped.
///
/// Returns `Some(dropped)` where the address changed, carrying how many queued
/// frames went with it; `None` where the trigger did not fire and nothing was
/// touched.
///
/// ‼ **THE DISCARD IS WHY THIS EXISTS AND WHY [`must_rotate`] ALONE WAS NOT
/// ENOUGH.** A predicate answers *should I*; it cannot make the rotation true.
/// Frames on this medium are wrapped with the hive's address **before** they
/// are queued — [`wrap`] runs at acceptance and [`OutboundQueue`] holds the
/// wrapped bytes — so **a rotation that changed the address and left the queue
/// would put the OLD address on air on the very next window.** The field would
/// read new, a log line would say rotated, and the correlation 4.3 exists to
/// break would survive intact, having been announced as broken. *That is worse
/// than not rotating, because it also tells the operator it is done.*
///
/// ‼ **THE ADDRESS IS THE CALLER'S DRAW.** 4.3 requires it generated at random
/// and **not derived from any other identifier the hive holds**, which no type
/// can enforce — a draw and a derivation are both four octets once they exist.
/// Taking a [`LoraAddress`], whose only constructor is
/// [`LoraAddress::from_entropy`], keeps the audit where `git grep from_entropy`
/// can perform it and keeps this layer free of a CSPRNG.
///
/// ‼ **AND IT LIVES HERE RATHER THAN IN A BOARD CRATE BECAUSE IT IS A BINDING
/// RULE.** The relationship between a rotation and a pre-wrapped queue is true
/// of every LoRa bearer this standard admits, not of one board — and a board
/// crate is cross-compiled, so a rule proved only there is a rule the host
/// runner cannot see and the register cannot cite. *A second implementer
/// writing their own bearer meets this function; they would never have met a
/// method on somebody's ESP32 type.*
pub fn rotate_on_persona_change<const N: usize>(
    address: &mut LoraAddress,
    outbound: &mut OutboundQueue<N>,
    persona_changed: bool,
    drawn: LoraAddress,
) -> Option<usize> {
    if !must_rotate(persona_changed) {
        return None;
    }
    *address = drawn;
    Some(outbound.discard_all())
}

/// One learned association and its quality (**4.4**, **6a.4**).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Peer {
    address: LoraAddress,
    hive: HiveId,
    snr_db: Option<i16>,
}

/// **4.4 and 4.5: medium address to canonical hive identifier, learned from
/// traffic and forgotten when the address changes.**
///
/// ‼ **`observe` IS THE ONLY WAY IN, AND ITS NAME IS THE AUDIT** — the same
/// idiom as [`crate::ble::BleAssociations`], because 4.4 carries the same
/// rule: the association *shall be learned from received traffic rather than
/// computed from the address.* No type can tell a derivation from an
/// observation once the value exists, so the entry point is named for what it
/// requires.
///
/// ‼ **AND 4.6 IS WHY THIS TABLE HOLDS A `HiveId` AND NOT A VERDICT.** *The
/// address is a label and not a claim* — four octets any transmitter may set
/// to anything, on a medium with no authentication. Its only job is to say
/// *these two receptions came from the same radio*.
pub struct LoraAssociations<const N: usize> {
    peers: [Option<Peer>; N],
}

impl<const N: usize> Default for LoraAssociations<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> LoraAssociations<N> {
    pub const fn new() -> Self {
        Self { peers: [None; N] }
    }

    /// Record that `hive` was **heard from** at `address` (4.4).
    ///
    /// `false` where the table is full: a bearer that dropped an association
    /// silently would report a known peer as unknown, which is a different
    /// fact from a peer that has not spoken.
    pub fn observe(&mut self, address: LoraAddress, hive: HiveId) -> bool {
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
                    snr_db: None,
                });
                return true;
            }
        }
        false
    }

    /// The identifier to report upward for `address` (4.4, 4.5.1).
    pub fn hive_at(&self, address: &LoraAddress) -> Option<HiveId> {
        self.peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)
            .map(|p| p.hive)
    }

    /// **4.5: the address changed, so the association and its quality go.**
    ///
    /// Takes the **old address only**, so 4.5's *shall not treat two
    /// addresses as one peer on any evidence this layer holds* cannot be
    /// worked around by a convenient signature.
    pub fn forget(&mut self, address: &LoraAddress) {
        for slot in self.peers.iter_mut() {
            if slot.as_ref().is_some_and(|p| &p.address == address) {
                *slot = None;
            }
        }
    }

    /// Record a signal-to-noise reading for `address` (**6a.4**: held per
    /// medium address). Ignored where the address is not associated.
    pub fn observe_snr(&mut self, address: &LoraAddress, snr_db: i16) {
        for p in self.peers.iter_mut().flatten() {
            if &p.address == address {
                p.snr_db = Some(snr_db);
            }
        }
    }

    /// The link quality for `address` under `scale` (6a.1, 6a.2).
    ///
    /// ‼ **DERIVED FROM SIGNAL-TO-NOISE, WHICH IS 6a.1 AND IS WHAT THE BEARER
    /// GOT WRONG** (`SS403`): it interpolated over received signal strength
    /// while the SNR the radio reports was fed to nothing.
    pub fn quality_at(&self, address: &LoraAddress, scale: QualityScale) -> Option<LinkQuality> {
        let snr = self
            .peers
            .iter()
            .flatten()
            .find(|p| &p.address == address)?
            .snr_db?;
        scale.quality(snr)
    }

    pub fn len(&self) -> usize {
        self.peers.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// **B5's fade rate shall exceed the longest interval the airtime budget can
/// produce under load** (6a-bis).
///
/// ‼ **STRICT, AND EQUALITY IS THE INTERESTING CASE — THE SAME SHAPE AS BLE
/// 6a.5 AND A DIFFERENT SUBJECT.** BLE measures against the longest
/// *advertising* interval a hive may adopt; LoRa measures against **what the
/// duty-cycle budget can produce under load**, which is a consequence of
/// airtime rather than a setting. *At equality a peer transmitting exactly on
/// its longest interval fades in the same instant it speaks, flickering
/// between heard and receded while behaving perfectly.*
pub const fn fade_rate_clears_budget(fade_rate_s: u32, longest_gap_s: u32) -> bool {
    fade_rate_s > longest_gap_s
}

/// Whether `now` is past `last_heard` by more than the fade (L2 6.3.1),
/// shared with every other fade in the tree through [`Ticks::exceeded`].
pub fn has_faded(last_heard: Ticks, now: Ticks, fade_s: u32, ticks_per_second: u32) -> bool {
    now.exceeded(last_heard, fade_s, ticks_per_second)
}

/// Why a frame could not be accepted for transmission.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OutboundRefusal {
    /// Longer than the wrapped payload this medium carries (L1 6.3).
    ///
    /// **Refused, never fragmented** — 6.3 is explicit, and a bearer that
    /// split a frame would be inventing a reassembly contract nobody else
    /// implements.
    Oversize,
    /// The queue is full: this bearer has accepted as much as it can hold.
    ///
    /// ‼ **A TRANSIENT REFUSAL AND NOT A FAILURE.** L1 5.2 Note 2's test is
    /// *whether waiting helps*, and here it plainly does — the radio is
    /// working through what it already has. **`Failed` would take a healthy
    /// bearer out of service**; `Unavailable` costs a wait.
    Full,
}

/// **Frames accepted for transmission and not yet on the air.**
///
/// # ‼ WHY A QUEUE EXISTS AT ALL: THE TRAIT IS SYNCHRONOUS AND THE RADIO IS NOT
///
/// `Bearer::send` returns a verdict immediately. **A LoRa transmission at
/// SF12 takes on the order of a second**, and awaiting it inside `send` would
/// stall the hive loop that called it — which is why `LoraBearer::send`
/// refused `Broadcast` outright until now, and why the only transmit path was
/// `tx()` driven from a task.
///
/// **The queue is the seam.** `send` wraps, charges airtime and enqueues; the
/// radio task drains. ‼ **AND `Ok` FROM `send` MEANS EXACTLY WHAT IT MEANS ON
/// EVERY OTHER BEARER** — L1 4.4.3: *accepted for transmission by a bearer
/// that currently believes it can transmit*, never delivered. The ESP-NOW
/// bearer says the same thing for the same reason, discarding a completion
/// callback it must not expose upward.
///
/// # ⚠ THE AIRTIME CHARGE HAPPENS AT ACCEPTANCE, WHICH IS THE CONSERVATIVE END
///
/// A frame charged here and then lost to a radio fault has spent budget it
/// never used. *That errs toward transmitting less than the allowance, and the
/// other direction errs toward transmitting more than the law permits* — L1
/// 9.3 Note 1 says this standard cannot grant relief from the operator's
/// obligation, so the direction is not a close call.
pub struct OutboundQueue<const N: usize> {
    slots: [[u8; MAX_WRAPPED]; N],
    lens: [usize; N],
    head: usize,
    len: usize,
    /// Frames refused because the queue was full, **counted rather than
    /// dropped silently** — *a queue that loses frames without saying how
    /// many is a queue whose size nobody can size.*
    refused_full: u32,
}

/// The largest wrapped payload this medium carries: the BND3 profile's
/// 222 octets, of which [`WRAPPING_LEN`] is the address.
/// **B2 is the FRAME, and the transmission is four octets longer** (BND3
/// 5.1.1–5.1.2): the registry's 222 is carried whole and the wrapping is
/// charged to the medium. Until 2026-08-25 one constant of 222 bounded the
/// WRAPPED bytes, so a conforming frame of 219..=222 octets was refused and
/// the 226-octet transmission the binding requires could not be admitted or
/// received (r2-codex-refute).
pub const FRAME_MTU: usize = crate::l1::Ordinal::Lora.largest_payload() as usize;

/// The transmission: [`FRAME_MTU`] plus the [`WRAPPING_LEN`] wrapping — 226.
pub const MAX_WRAPPED: usize = FRAME_MTU + WRAPPING_LEN;

impl<const N: usize> Default for OutboundQueue<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> OutboundQueue<N> {
    pub const fn new() -> Self {
        Self {
            slots: [[0u8; MAX_WRAPPED]; N],
            lens: [0; N],
            head: 0,
            len: 0,
            refused_full: 0,
        }
    }

    /// Drop every queued frame, returning how many were dropped.
    ///
    /// ‼ **THIS EXISTS FOR 4.3 AND FOR NOTHING ELSE.** Frames are wrapped with
    /// this hive's medium address *at acceptance* and queued already wrapped, so
    /// **a queue that survives an address rotation transmits the OLD address
    /// afterwards** — which is precisely the correlation 4.3 exists to break.
    /// *The rotation would look done, the log would say rotated, and the next
    /// frames on air would still carry the address the old persona used.*
    ///
    /// The count is RETURNED rather than discarded because dropping a hive's
    /// queued traffic is a real cost and the caller owes an operator a number —
    /// the same reason [`Self::refused_full`] is counted rather than shrugged
    /// off. *A queue that loses frames without saying how many is a queue whose
    /// size nobody can size,* and that applies at least as much when the loss is
    /// deliberate.
    pub fn discard_all(&mut self) -> usize {
        let dropped = self.len;
        self.head = 0;
        self.len = 0;
        dropped
    }

    /// Accept a wrapped frame for transmission.
    pub fn push(&mut self, wrapped: &[u8]) -> Result<(), OutboundRefusal> {
        if wrapped.len() > MAX_WRAPPED {
            return Err(OutboundRefusal::Oversize);
        }
        self.admit()?;
        let at = (self.head + self.len) % N;
        self.slots[at][..wrapped.len()].copy_from_slice(wrapped);
        self.lens[at] = wrapped.len();
        self.len += 1;
        Ok(())
    }

    /// Take the oldest frame into `out`, returning its length.
    ///
    /// ‼ **FIFO, AND THE ORDER IS NOT A DETAIL.** L3's forwarding decisions
    /// are made in the order frames arrive, and a stack would deliver the
    /// newest first — *turning a busy moment into a reordering nobody above
    /// asked for.*
    pub fn pop(&mut self, out: &mut [u8]) -> Option<usize> {
        if self.len == 0 {
            return None;
        }
        let n = self.lens[self.head];
        if out.len() < n {
            return None;
        }
        out[..n].copy_from_slice(&self.slots[self.head][..n]);
        self.head = (self.head + 1) % N;
        self.len -= 1;
        Some(n)
    }

    /// **Read the head frame WITHOUT removing it.**
    ///
    /// ‼ **THIS EXISTS SO A CHANNEL SENSE CAN HAPPEN BEFORE THE POP.** BND3
    /// 6e.1 requires the medium to be found idle immediately before
    /// transmitting, and a bearer that popped first would have to **put the
    /// frame back** on a deferral — *a frame held in a local while the bearer
    /// waits is a frame `waiting()` does not count and nothing else can see*,
    /// so a busy channel would silently shrink the reported queue depth.
    ///
    /// Returns `None` on an empty queue or a buffer too small, exactly as
    /// [`Self::pop`] does, so the two cannot disagree about what fits.
    pub fn peek(&self, out: &mut [u8]) -> Option<usize> {
        if self.len == 0 {
            return None;
        }
        let n = self.lens[self.head];
        if out.len() < n {
            return None;
        }
        out[..n].copy_from_slice(&self.slots[self.head][..n]);
        Some(n)
    }

    /// How many frames are waiting.
    /// Is there room for one more frame? Counts the refusal, so a caller
    /// that asks BEFORE spending airtime — the bearer's `send`, which must
    /// not charge the budget for a frame the queue then refuses (BND3 6b.3,
    /// L1 9.3) — records the same `Full` a `push` would have.
    pub fn admit(&mut self) -> Result<(), OutboundRefusal> {
        if self.len == N {
            self.refused_full = self.refused_full.saturating_add(1);
            return Err(OutboundRefusal::Full);
        }
        Ok(())
    }

    pub const fn waiting(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// How many frames this bearer refused for want of room.
    ///
    /// **Reported so a capacity can be argued from a measurement** rather
    /// than from a guess about what a bench does.
    pub const fn refused_full(&self) -> u32 {
        self.refused_full
    }
}

// ── 3.1, 6a.2, 6d.3 and 7.1: the facts every board of this implementation shares ──
//
// Until 2026-09-03 each of these was spelt in each board's own xtensa file, where
// no test runs and no diff compares them — the shape that put the two boards on
// different spreading factors for ten days (`d613`). They are spelt once here, the
// boards re-export them, and the tests below are the falsifiers the tranche-one
// dispositions could not name while the values sat in code the gate never ran.

/// **3.1: the sixteen-bit LoRa sync word that is Reality2's physical discovery
/// marker.** ‼ **ONE CONSTANT FOR EVERY BOARD.** `SS393` recorded two boards
/// transmitting the driver's private default `0x1424` while their sources said
/// otherwise, and D-234 ruled the marker retained through the audited driver
/// derivative, which writes this value in wire order on every cold start.
pub const R2_SYNC_WORD: u16 = 0x5424;

/// **6a.2: the SNR window this implementation maps to link quality** — the
/// SX1262's approximate demodulation floor, −20 dB, to a strong local signal,
/// +10 dB, linear and clamped between them. 6a.3 declines to fix these bounds,
/// so they are this implementation's and are stated once: one board carried
/// them as a `QualityScale` and the other as two `f32` literals in an
/// arithmetic of its own.
pub const SNR_SCALE: QualityScale = QualityScale {
    floor: -20,
    ceiling: 10,
};

/// **6d.3: a LoRa offer needs no known peer.** The medium has no link-layer
/// destination — an addressed and a broadcast offer are the same transmission,
/// and the L4 frame decides which hive consumes it. Shared by the quote and the
/// send so the serial scheduler cannot refuse an offer `send` would accept (L1
/// 6.1, 9.5).
pub const fn accepts_target(target: SendTarget) -> Result<(), SendError> {
    match target {
        SendTarget::Hive(_) | SendTarget::Broadcast => Ok(()),
    }
}

/// **The profile of a transmitting LoRa bearer (L1 7.1).** B1, B2, B3, B6 and
/// B7 are the registry row the binding fixes at 8.2.1 — *long-range, compact,
/// 222 octets, cost 5* — B8 is regulated (6c.1), B5 is the fade the caller
/// derived under 6a.5 (a bearer whose B5 does not derive has no profile and
/// refuses service), and B9 is the caller's receptivity declaration.
pub fn regulated_profile(fade: FadeRate, receptivity: Receptivity) -> BearerProfile {
    BearerProfile {
        ordinal: Ordinal::Lora,
        max_payload: FRAME_MTU as u16..=FRAME_MTU as u16,
        wire_tier: Ordinal::Lora.wire_tier(),
        fade: Fade::Regulated(fade),
        relative_cost: Ordinal::Lora.relative_cost(),
        reach: Ordinal::Lora.reach(),
        receptivity,
        participates_in_discovery: true,
        connection: None,
    }
}

/// **The profile of the receive-only LoRa ingress (L1 4.6.3, D-247).** The
/// same medium facts; B5 is a local observation retention rather than a peer
/// fade, B8 still describes the medium, and the ingress does not participate
/// in discovery because it cannot announce.
pub fn passive_profile(observation_retention_s: u32) -> BearerProfile {
    BearerProfile {
        ordinal: Ordinal::Lora,
        max_payload: FRAME_MTU as u16..=FRAME_MTU as u16,
        wire_tier: Ordinal::Lora.wire_tier(),
        fade: Fade::Passive {
            observation_retention_s,
            regulated: true,
        },
        relative_cost: Ordinal::Lora.relative_cost(),
        reach: Ordinal::Lora.reach(),
        receptivity: Receptivity::Continuous,
        participates_in_discovery: false,
        connection: None,
    }
}

/// **L1 9.3 to 9.5 for a LoRa port — the regulated half a host test can run.**
///
/// The budget, the new-window edge the L2 serial scheduler consumes, the charge
/// for a transmission and the quote for an offer were decided inline in the
/// DFR1195's bearer, a crate no test compiles (`L1-060`): the beacon-policy
/// tests drove a double and stayed green whatever the real provider did. The
/// decisions are here and the bearer delegates; what stays on the board is the
/// radio, the region declaration and the serial owner.
///
/// ⚠ **THE AIRTIME FIGURE IS STILL `PROVISIONAL` AND `SS391` IS STILL OWED.**
/// [`crate::lora_airtime::airtime_ms`] is testable against the published
/// formula; *a suite over a model cannot tell you the model is right*, and
/// nobody has put a spectrum analyser on the board. A PHY the formula is
/// undefined for saturates the figure rather than under-reporting it: an
/// over-estimate spends less airtime than permitted, an under-estimate spends
/// airtime nobody authorised (L1 9.3 Note 1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RegulatedPort {
    budget: crate::l1::AirtimeBudget,
    regulatory_limit: bool,
    phy: crate::lora_airtime::LoraPhy,
    /// Edge consumed by the L2 serial scheduler (L1 9.4). A bool is enough:
    /// only the fact that at least one fresh window began before the owner
    /// next observes it matters, and the owner resets it once.
    new_window: bool,
    ticks_per_second: u32,
}

impl RegulatedPort {
    pub fn withhold_current_window(&mut self) {
        if self.regulatory_limit {
            self.budget.withhold_current_window();
        }
    }
    pub fn checkpoint(&self, now: Ticks) -> Option<[u32; 5]> {
        self.budget.checkpoint(now, self.ticks_per_second)
    }
    pub fn restore(&mut self, words: [u32; 5], now: Ticks, elapsed_ms: u64) -> bool {
        self.budget
            .restore(words, now, self.ticks_per_second, elapsed_ms)
    }
    /// `allowance_ms` of transmission per `window_s`, on `phy`. **The figures
    /// are the operator's** (L1 9.3 Note 1): a duty cycle is a regulatory fact
    /// about a region and a sub-band, and this file refuses to invent one.
    ///
    /// A fresh port begins in a new window, so the scheduler primes its
    /// reserve on its first observation rather than after the first roll.
    pub const fn new(
        allowance_ms: u32,
        window_s: u32,
        started: Ticks,
        ticks_per_second: u32,
        phy: crate::lora_airtime::LoraPhy,
    ) -> Self {
        Self {
            budget: crate::l1::AirtimeBudget::new(allowance_ms, window_s, started),
            regulatory_limit: true,
            phy,
            new_window: true,
            ticks_per_second,
        }
    }

    /// **A port under NO regulatory airtime limit** — the region declared
    /// [`AirtimeLimit::None`](crate::lora_region::AirtimeLimit::None).
    ///
    /// ‼ **THIS EXISTS SO 6c.3a CAN BE OBEYED, AND IT IS NOT A CONVENIENCE.**
    /// *A deployment whose region imposes no duty cycle shall not state a budget
    /// in place of it.* Before this, the only way to build a port was to hand it
    /// an allowance — so a deployment in an unregulated band had to invent a
    /// figure and put it in the field a regulatory limit lives in, which is
    /// exactly what 6c.3a Note 4 names as the harm. **A self-imposed restraint
    /// belongs in [`BenchCeiling`], where its name says whose it is.**
    ///
    /// The allowance is `u32::MAX` rather than a flag because
    /// [`crate::l1::AirtimeBudget`] is the regulatory counter and adding an
    /// unlimited variant to it would put *no limit* inside the type that means
    /// *the limit*. **The saturating arm in `permits` still refuses a frame
    /// whose airtime overflows**, so an unregulated port is not an unbounded
    /// one — it declines the impossible and permits the merely large.
    pub const fn unregulated(
        started: Ticks,
        ticks_per_second: u32,
        phy: crate::lora_airtime::LoraPhy,
    ) -> Self {
        let mut port = Self::new(u32::MAX, 1, started, ticks_per_second, phy);
        port.regulatory_limit = false;
        port
    }

    /// Whether the counter represents an actual regulatory airtime limit.
    /// An unregulated port refreshes its internal counter, but that bookkeeping
    /// edge cannot expire a physical offer as though legal airtime had ended.
    pub const fn has_regulatory_limit(&self) -> bool {
        self.regulatory_limit
    }

    /// **Tell the port what time it is.** The window rolls here, not only when
    /// a caller tries to charge — so an exhausted port becomes available again
    /// once a later tick has established the window elapsed, never before.
    /// Returns whether this call observed a fresh window; the edge is also
    /// latched for [`Self::window`], because an accepted physical frame is
    /// charged against the window that admitted it and must not survive to a
    /// later one merely because CAD deferred it.
    pub fn tick(&mut self, now: Ticks) -> bool {
        let rolled = self.budget.roll(now, self.ticks_per_second);
        self.new_window |= rolled;
        rolled
    }

    /// **9.2: nothing more can be sent in this window.**
    pub const fn exhausted(&self) -> bool {
        self.budget.exhausted()
    }

    /// Airtime still legal in the current window (9.4).
    pub const fn remaining_ms(&self) -> u32 {
        self.budget.remaining_ms()
    }

    /// Time on air of a transmission of `wrapped_len` octets, milliseconds,
    /// rounded up — saturating where the PHY refuses (see the type's note).
    pub const fn airtime_ms(&self, wrapped_len: usize) -> u32 {
        match crate::lora_airtime::airtime_ms(&self.phy, wrapped_len) {
            Ok(ms) => ms,
            Err(_) => u32::MAX,
        }
    }

    /// **9.3: charge the airtime of a `wrapped_len`-octet transmission against
    /// the window, rolling it first.** Returns whether the transmission is
    /// permitted; **a refusal spends nothing.** No priority argument, and that
    /// absence is the clause.
    pub fn charge(&mut self, wrapped_len: usize, now: Ticks) -> bool {
        self.tick(now);
        let ms = self.airtime_ms(wrapped_len);
        self.budget.spend(ms, now, self.ticks_per_second)
    }

    /// Preflight independent legal and deployment counters before spending
    /// either. Both windows use the same supplied clock; refusal spends neither.
    /// Exclusive mutable access makes the preflight and charge one serial act.
    pub fn charge_with_ceiling(
        &mut self,
        ceiling: &mut BenchCeiling,
        wrapped_len: usize,
        now: Ticks,
    ) -> bool {
        self.tick(now);
        ceiling.tick(now);
        let ms = self.airtime_ms(wrapped_len);
        if !self.budget.permits(ms) || !ceiling.permits(ms) {
            return false;
        }
        self.charge(wrapped_len, now) && ceiling.charge(ms, now)
    }

    /// **9.4: the scheduler's view — the new-window edge, consumed, and the
    /// remaining legal airtime.** Nothing more is handed upward.
    pub fn window(&mut self) -> crate::l1::RegulatedWindow {
        crate::l1::RegulatedWindow {
            new_window: core::mem::replace(&mut self.new_window, false),
            remaining_airtime_ms: self.budget.remaining_ms(),
        }
    }

    /// **9.5: quote the airtime of offering `frame` from `from`** — the airtime
    /// of the *wrapped* transmission, since the wrapping goes on air too (2.2).
    /// An offer the medium could not carry is refused as oversize, exactly as
    /// the send would refuse it.
    pub fn quote(&self, from: LoraAddress, frame: &[u8]) -> Result<u32, SendError> {
        if frame.len() > FRAME_MTU {
            return Err(SendError::Oversize);
        }
        let mut wrapped = [0u8; MAX_WRAPPED];
        let len = wrap(from, frame, &mut wrapped).map_err(|_| SendError::Oversize)?;
        Ok(self.airtime_ms(len))
    }
}

/// **A SELF-IMPOSED transmit ceiling. ‼ NOT A DUTY CYCLE AND NOT REGULATORY.**
///
/// BND3 **6c.3a**: *a deployment whose region imposes no duty cycle shall not
/// state a budget in place of it.* This type is what a deployment uses instead
/// when it wants to transmit **less** than the law permits — and the whole
/// point of it is the NAME. A conservative figure sitting in an
/// [`AirtimeBudget`](crate::l1::AirtimeBudget) field is indistinguishable from
/// a regulatory one to every later reader, and the reader who most needs to
/// tell them apart is the one deciding whether it may be raised.
///
/// ‼ **THE TWO ERRORS RUN IN OPPOSITE DIRECTIONS AND ONLY ONE IS RECOVERABLE.**
/// Mistaking a regulatory limit for a bench courtesy and raising it costs
/// compliance, which is the operator's legal exposure (L1 9.3 Note 1).
/// Mistaking a bench courtesy for a regulatory limit costs throughput and
/// somebody's afternoon. *So the type that cannot be raised safely is the one
/// that keeps the regulatory name, and this one is marked all the way down.*
///
/// It wraps the same counter rather than reimplementing it: the arithmetic of
/// an allowance in a window is not in dispute, only whose allowance it is.
#[derive(Clone, Copy, Debug)]
pub struct BenchCeiling {
    inner: Option<crate::l1::AirtimeBudget>,
    new_window: bool,
    /// Kept beside the counter rather than read back out of it: the window is
    /// needed for the 6a.5 fade derivation before anything is ever charged.
    window_s: Option<u32>,
    ticks_per_second: u32,
}

impl BenchCeiling {
    /// Remaining self-imposed allowance, without consuming a window edge or
    /// advancing its clock. `None` means no deployment ceiling is configured.
    pub const fn remaining_ms(&self) -> Option<u32> {
        match &self.inner {
            Some(budget) => Some(budget.remaining_ms()),
            None => None,
        }
    }

    pub fn withhold_current_window(&mut self) {
        if let Some(budget) = self.inner.as_mut() {
            budget.withhold_current_window();
        }
    }
    pub fn checkpoint(&self, now: Ticks) -> Option<[u32; 5]> {
        self.inner.as_ref()?.checkpoint(now, self.ticks_per_second)
    }
    pub fn restore(&mut self, words: [u32; 5], now: Ticks, elapsed_ms: u64) -> bool {
        self.inner
            .as_mut()
            .is_some_and(|budget| budget.restore(words, now, self.ticks_per_second, elapsed_ms))
    }
    /// The shared binding's B5 derivation from this deployment's stated
    /// under-load window, including its existing clock/airtime margin.
    pub fn fade(&self) -> Result<crate::fade_rate::FadeRate, crate::fade_rate::FadeRefusal> {
        use crate::fade_rate::{FadeRate, FadeRefusal, FadeSource};
        let window_s = self.window_s.ok_or(FadeRefusal::NoBasis)?;
        FadeRate::derive(
            window_s.saturating_add(window_s / 10).saturating_add(1),
            FadeSource::BudgetUnderLoad {
                longest_interval_s: window_s,
            },
        )
    }
    /// No self-imposed restraint. **Distinct from a ceiling of zero**, which
    /// would hold every frame forever.
    pub const fn none() -> Self {
        Self {
            inner: None,
            new_window: false,
            window_s: None,
            ticks_per_second: 1,
        }
    }

    /// `allowance_ms` of transmission per `window_s`, **by this deployment's
    /// own choice and not by any regulation.**
    pub const fn of(
        allowance_ms: u32,
        window_s: u32,
        started: Ticks,
        ticks_per_second: u32,
    ) -> Self {
        Self {
            inner: Some(crate::l1::AirtimeBudget::new(
                allowance_ms,
                window_s,
                started,
            )),
            new_window: true,
            window_s: Some(window_s),
            ticks_per_second,
        }
    }

    /// Whether this deployment's own ceiling is currently withholding transmit.
    ///
    /// **Named `holding` and not `exhausted`** so a caller reporting the reason
    /// cannot accidentally say the regulatory word: *held by our own choice* and
    /// *out of legal airtime* are different sentences to an operator.
    pub const fn holding(&self) -> bool {
        match &self.inner {
            Some(b) => b.exhausted(),
            None => false,
        }
    }

    /// The ceiling's window in seconds, where one is set.
    ///
    /// ‼ **BND3 6a.5 DEPENDS ON THIS AND THAT IS WHY IT IS EXPOSED.** A LoRa
    /// bearer derives its fade rate (B5) from the longest interval its
    /// restraint can produce under load — with the allowance spent, the next
    /// beacon waits for the window to roll. **So a bearer with NO ceiling has
    /// no derivable B5 from this source**, and 6a.5 gives it no profile and no
    /// service rather than a guessed one. *That is a real refusal path and not
    /// a degenerate case: removing the last restraint removes the basis for the
    /// number the binding requires.*
    pub const fn window_s(&self) -> Option<u32> {
        self.window_s
    }

    /// Roll the window and report its edge. An unset ceiling has no window.
    pub fn tick(&mut self, now: Ticks) -> bool {
        let rolled = self
            .inner
            .as_mut()
            .is_some_and(|b| b.roll(now, self.ticks_per_second));
        self.new_window |= rolled;
        rolled
    }

    /// Observe this deployment's window independently of any legal window.
    pub fn window(&mut self) -> Option<crate::l1::DeploymentWindow> {
        let inner = self.inner.as_ref()?;
        Some(crate::l1::DeploymentWindow {
            new_window: core::mem::replace(&mut self.new_window, false),
            remaining_airtime_ms: inner.remaining_ms(),
        })
    }

    /// Whether a proposed charge fits the currently observed deployment window.
    pub const fn permits(&self, airtime_ms: u32) -> bool {
        match &self.inner {
            Some(b) => b.permits(airtime_ms),
            None => true,
        }
    }

    /// Charge `airtime_ms` against the ceiling. Returns whether it is permitted;
    /// **a refusal spends nothing**, and an unset ceiling permits everything.
    pub fn charge(&mut self, airtime_ms: u32, now: Ticks) -> bool {
        self.tick(now);
        match &mut self.inner {
            Some(b) => b.spend(airtime_ms, now, self.ticks_per_second),
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn diagnostic_allowance_read_preserves_window_edge_and_spend() {
        let mut ceiling = super::BenchCeiling::of(100, 10, r2_hal_traits::Ticks(0), 1);
        assert_eq!(ceiling.remaining_ms(), Some(100));
        assert_eq!(ceiling.remaining_ms(), Some(100));
        assert!(ceiling.window().unwrap().new_window);
        assert!(ceiling.charge(25, r2_hal_traits::Ticks(1)));
        assert_eq!(ceiling.remaining_ms(), Some(75));
        assert!(!ceiling.window().unwrap().new_window);
        assert!(ceiling.tick(r2_hal_traits::Ticks(11)));
        assert_eq!(ceiling.remaining_ms(), Some(100));
        assert!(ceiling.window().unwrap().new_window);
        assert_eq!(super::BenchCeiling::none().remaining_ms(), None);
        assert_eq!(
            super::BenchCeiling::of(0, 10, r2_hal_traits::Ticks(0), 1).remaining_ms(),
            Some(0)
        );
    }

    /// ‼ **FIFO, AND THE ORDER IS NOT A DETAIL.** L3 decides forwarding in the
    /// order frames arrive; a stack would deliver the newest first, *turning a
    /// busy moment into a reordering nobody above asked for.*
    #[test]
    fn the_queue_hands_frames_back_in_the_order_they_were_accepted() {
        let mut q: OutboundQueue<3> = OutboundQueue::new();
        q.push(b"first").unwrap();
        q.push(b"second").unwrap();
        assert_eq!(q.waiting(), 2);

        let mut out = [0u8; MAX_WRAPPED];
        assert_eq!(q.pop(&mut out).unwrap(), 5);
        assert_eq!(&out[..5], b"first");
        assert_eq!(q.pop(&mut out).unwrap(), 6);
        assert_eq!(&out[..6], b"second");
        assert!(q.pop(&mut out).is_none());
        assert!(q.is_empty());
    }

    /// ‼ **FULL IS A TRANSIENT REFUSAL AND IS COUNTED.** L1 5.2 Note 2's test
    /// is *whether waiting helps*, and here it plainly does — the radio is
    /// working through what it holds. *A queue that loses frames without
    /// saying how many is a queue whose size nobody can size.*
    #[test]
    fn a_full_queue_refuses_and_counts_what_it_refused() {
        let mut q: OutboundQueue<2> = OutboundQueue::new();
        q.push(b"a").unwrap();
        q.push(b"b").unwrap();
        assert_eq!(q.push(b"c"), Err(OutboundRefusal::Full));
        assert_eq!(q.push(b"d"), Err(OutboundRefusal::Full));
        assert_eq!(q.refused_full(), 2, "counted, not dropped silently");

        // And room reappears as the radio drains it — which is what makes the
        // refusal transient rather than a failure.
        let mut out = [0u8; MAX_WRAPPED];
        q.pop(&mut out).unwrap();
        assert_eq!(q.push(b"c"), Ok(()));
    }

    /// **L1 6.3: refused, never fragmented.** A bearer that split a frame
    /// would be inventing a reassembly contract nobody else implements.
    /// BND3 5.1.1–5.1.2: a 222-octet frame wraps to the 226-octet
    /// transmission and is admitted; one octet more is not.
    #[test]
    fn a_full_frame_wraps_to_the_transmission_and_one_more_octet_does_not() {
        // One source: the registry row (L1 8.2.1), never a second literal.
        assert_eq!(
            FRAME_MTU,
            crate::l1::Ordinal::Lora.largest_payload() as usize
        );
        assert_eq!(MAX_WRAPPED, FRAME_MTU + WRAPPING_LEN);
        assert_eq!(MAX_WRAPPED, 226);
        let mut q: OutboundQueue<1> = OutboundQueue::new();
        let mut out = [0u8; MAX_WRAPPED + 1];
        let full = [7u8; FRAME_MTU];
        let n = wrap(LoraAddress([1, 2, 3, 4]), &full, &mut out).expect("wraps");
        assert_eq!(n, MAX_WRAPPED);
        assert_eq!(q.push(&out[..n]), Ok(()));
        let over = [7u8; FRAME_MTU + 1];
        let n = wrap(LoraAddress([1, 2, 3, 4]), &over, &mut out).expect("wraps");
        let mut q2: OutboundQueue<1> = OutboundQueue::new();
        assert_eq!(q2.push(&out[..n]), Err(OutboundRefusal::Oversize));
    }

    #[test]
    fn an_oversize_frame_is_refused_rather_than_split() {
        let mut q: OutboundQueue<2> = OutboundQueue::new();
        let too_long = [0u8; MAX_WRAPPED + 1];
        assert_eq!(q.push(&too_long), Err(OutboundRefusal::Oversize));
        // Exactly the maximum is not too long.
        let exact = [0u8; MAX_WRAPPED];
        assert_eq!(q.push(&exact), Ok(()));
        // And an oversize refusal is NOT counted as a capacity refusal: they
        // send an operator to different places — one to the frame, one to the
        // queue size.
        assert_eq!(q.refused_full(), 0);
    }

    /// The ring wraps rather than filling up permanently, which is the bug a
    /// hand-rolled FIFO has when `head` is not taken modulo its capacity.
    #[test]
    fn the_ring_wraps_and_keeps_accepting_after_many_frames() {
        let mut q: OutboundQueue<2> = OutboundQueue::new();
        let mut out = [0u8; MAX_WRAPPED];
        for i in 0..10u8 {
            q.push(&[i]).unwrap();
            assert_eq!(q.pop(&mut out).unwrap(), 1);
            assert_eq!(out[0], i, "the frame that came out is the one put in");
        }
        assert!(q.is_empty());
    }

    use super::*;

    const A: LoraAddress = LoraAddress::from_entropy([0xA1, 0xB2, 0xC3, 0xD4]);
    const B: LoraAddress = LoraAddress::from_entropy([0x11, 0x22, 0x33, 0x44]);

    fn hive(n: u8) -> HiveId {
        HiveId([n; 8])
    }

    /// **2.2: the wrapping precedes the frame and is removed before the frame
    /// goes upward.** The round trip is the clause.
    #[test]
    fn a_frame_round_trips_through_the_wrapping_unaltered() {
        let frame = b"a whole frame, verbatim";
        let mut out = [0u8; 64];
        let n = wrap(A, frame, &mut out).expect("wraps");
        assert_eq!(n, WRAPPING_LEN + frame.len());
        assert_eq!(&out[..WRAPPING_LEN], &A.0, "the address comes FIRST (4.2)");

        let (from, body) = unwrap(&out[..n]).expect("unwraps");
        assert_eq!(from, A);
        assert_eq!(body, frame, "the frame is delivered upward unaltered");
    }

    /// ‼ **FOUR OCTETS IS AN ADDRESS AND AN EMPTY FRAME, NOT AN ERROR.**
    /// Whether an empty frame means anything is the frame layer's question —
    /// *a bearer that refused here would be interpreting the frame's
    /// contents, which 4.2.3 forbids it to do.*
    #[test]
    fn a_payload_of_exactly_the_wrapping_is_an_address_and_an_empty_frame() {
        let (from, body) = unwrap(&A.0).expect("unwraps");
        assert_eq!(from, A);
        assert!(body.is_empty());

        // Shorter than the wrapping carries neither.
        assert_eq!(
            unwrap(&[0xA1, 0xB2, 0xC3]),
            Err(WrappingError::TooShort { len: 3 })
        );
        assert_eq!(unwrap(&[]), Err(WrappingError::TooShort { len: 0 }));
    }

    /// A short buffer refuses and names what it needed, rather than writing a
    /// partial transmission.
    #[test]
    fn a_short_buffer_refuses_and_names_what_it_needed() {
        let mut out = [0u8; 6];
        assert_eq!(
            wrap(A, b"1234567", &mut out),
            Err(WrappingError::BufferTooSmall { needed: 11 })
        );
        assert!(out.iter().all(|&b| b == 0), "and nothing partial was left");
    }

    /// ‼ **LoRa 4.3 STATES ONE TRIGGER WHERE BLE 4.3 STATES TWO, AND THE
    /// ASYMMETRY IS RECORDED RATHER THAN SMOOTHED AWAY.** BLE advertises
    /// continuously to anyone in range, so a stable address is a tracking
    /// handle within one persona; a duty-cycled long-range bearer transmits
    /// rarely. *Adding a timer here would invent an obligation the binding
    /// does not state.*
    #[test]
    fn the_address_rotates_on_a_persona_change_and_the_binding_states_no_timer() {
        assert!(must_rotate(true));
        assert!(!must_rotate(false));
    }

    /// LoRa 6a.4 (`BND3-045`): the quality value is held per medium address. The
    /// existing test measures only A; this one proves B's reading is B's own and
    /// survives A being forgotten — red if `snr_db` is hoisted out of `Peer`.
    #[test]
    fn a_quality_reading_belongs_to_one_address_and_not_to_the_table() {
        let scale = QualityScale {
            floor: -20,
            ceiling: 10,
        };
        let mut t: LoraAssociations<4> = LoraAssociations::new();
        assert!(t.observe(A, hive(1)));
        assert!(t.observe(B, hive(2)));
        t.observe_snr(&A, -5);
        assert!(
            t.quality_at(&B, scale).is_none(),
            "B has no reading of its own"
        );
        t.observe_snr(&B, 10);
        assert_eq!(
            t.quality_at(&A, scale).unwrap().0,
            0.5,
            "A's reading is not B's"
        );
        assert_eq!(t.quality_at(&B, scale).unwrap().0, 1.0);
        t.forget(&A);
        assert_eq!(
            t.quality_at(&B, scale).unwrap().0,
            1.0,
            "forgetting A leaves B's reading"
        );
    }

    /// **4.4 and 4.5**, with the negative that matters: a forgotten address
    /// takes its quality with it (6a.4) — *a quality value that outlived the
    /// address it was measured on would be a measurement of one radio
    /// attributed to another.*
    #[test]
    fn an_association_and_its_quality_die_with_the_address() {
        let scale = QualityScale {
            floor: -20,
            ceiling: 10,
        };
        let mut t: LoraAssociations<4> = LoraAssociations::new();
        assert!(t.observe(A, hive(1)));
        assert!(t.observe(B, hive(2)));
        t.observe_snr(&A, -5);

        assert_eq!(t.hive_at(&A), Some(hive(1)));
        assert_eq!(t.quality_at(&A, scale).unwrap().0, 0.5);

        t.forget(&A);
        assert_eq!(t.hive_at(&A), None);
        assert!(
            t.quality_at(&A, scale).is_none(),
            "the quality went with it"
        );
        assert_eq!(t.hive_at(&B), Some(hive(2)), "and only that one went");
    }

    /// ‼ **4.6: THE ADDRESS IS A LABEL AND NOT A CLAIM.** Its only job is to
    /// say *these two receptions came from the same radio*. Two receptions at
    /// one address are one peer; the same hive at a **new** address is a new
    /// entry, because 4.5 forbids treating two addresses as one peer *on any
    /// evidence this layer holds* — **even when the hive identifier matches.**
    #[test]
    fn two_addresses_are_never_one_peer_even_for_the_same_hive() {
        let mut t: LoraAssociations<4> = LoraAssociations::new();
        t.observe(A, hive(1));
        t.observe(B, hive(1));
        assert_eq!(t.len(), 2, "one hive, two radios' worth of label");
        assert_eq!(t.hive_at(&A), Some(hive(1)));
        assert_eq!(t.hive_at(&B), Some(hive(1)));

        // And forgetting one leaves the other, because they were never joined.
        t.forget(&A);
        assert_eq!(t.hive_at(&B), Some(hive(1)));
        assert_eq!(t.len(), 1);
    }

    /// A full table says so rather than dropping silently, and re-observing a
    /// held address updates rather than inserting.
    #[test]
    fn a_full_association_table_says_so() {
        let mut t: LoraAssociations<2> = LoraAssociations::new();
        assert!(t.observe(A, hive(1)));
        assert!(t.observe(B, hive(2)));
        assert!(!t.observe(LoraAddress::from_entropy([9, 9, 9, 9]), hive(3)));
        assert!(t.observe(A, hive(7)), "an update, not an insertion");
        assert_eq!(t.hive_at(&A), Some(hive(7)));
        assert_eq!(t.len(), 2);
    }

    /// The fade rate must strictly exceed the longest gap the budget can
    /// produce; equality flickers.
    #[test]
    fn the_fade_rate_must_strictly_exceed_the_longest_gap_under_load() {
        assert!(fade_rate_clears_budget(601, 600));
        assert!(!fade_rate_clears_budget(600, 600), "equality flickers");
        assert!(!fade_rate_clears_budget(599, 600));

        // And the fade itself is L2 6.3.1's arithmetic, shared.
        assert!(!has_faded(Ticks(0), Ticks(600), 600, 1));
        assert!(has_faded(Ticks(0), Ticks(601), 600, 1));
    }
    /// ‼ **`peek` MUST NOT CONSUME, BECAUSE A DEFERRAL PUTS NOTHING BACK.**
    /// A bearer that sensed a busy channel after popping would hold the frame
    /// in a local, where `waiting()` cannot count it.
    #[test]
    fn peek_reads_the_head_without_removing_it() {
        let mut q: OutboundQueue<4> = OutboundQueue::new();
        q.push(b"first").unwrap();
        q.push(b"second").unwrap();
        let mut buf = [0u8; 32];

        let n = q.peek(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"first");
        assert_eq!(q.waiting(), 2, "peek consumed a frame");
        // And again, unchanged — a sense may be repeated on a busy channel.
        let n = q.peek(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"first");
        assert_eq!(q.waiting(), 2);

        // The pop that follows yields the same frame peek promised.
        let n = q.pop(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"first");
        assert_eq!(q.waiting(), 1);
    }

    /// An empty queue peeks to `None`, exactly as it pops to `None`.
    #[test]
    fn peek_and_pop_agree_about_an_empty_queue() {
        let q: OutboundQueue<4> = OutboundQueue::new();
        let mut buf = [0u8; 32];
        assert!(q.peek(&mut buf).is_none());
    }

    /// **And they agree about a buffer too small**, so a caller cannot get a
    /// peek it could not have popped.
    #[test]
    fn peek_and_pop_agree_about_a_short_buffer() {
        let mut q: OutboundQueue<4> = OutboundQueue::new();
        q.push(b"a longer frame than the buffer").unwrap();
        let mut small = [0u8; 4];
        assert!(q.peek(&mut small).is_none());
        assert!(q.pop(&mut small).is_none());
        assert_eq!(q.waiting(), 1, "a refused pop must not consume");
    }

    /// 3.1 (`BND3-008`, `BND3-009`, `BND3-010`): the marker is the binding's
    /// literal and neither of the upstream driver's defaults — the public
    /// LoRaWAN word, or the private default `SS393` caught on air. Red if the
    /// constant drifts to either.
    #[test]
    fn the_sync_word_is_the_bindings_marker_and_neither_upstream_default() {
        assert_eq!(R2_SYNC_WORD, 0x5424, "L1-BINDING-LORA 3.1");
        assert_ne!(R2_SYNC_WORD, 0x3444, "the public LoRaWAN sync word");
        assert_ne!(
            R2_SYNC_WORD, 0x1424,
            "the private default the boards once transmitted"
        );
    }

    /// 6a.2 (`BND3-044`): the SNR window is stated once, is usable, and maps
    /// the floor to 0.0, the ceiling to 1.0 and the midpoint to 0.5, clamped
    /// beyond both. Red if either bound moves or the scale inverts.
    #[test]
    fn the_snr_window_is_stated_once_and_maps_the_bindings_way() {
        assert_eq!((SNR_SCALE.floor, SNR_SCALE.ceiling), (-20, 10));
        assert!(SNR_SCALE.is_usable());
        assert_eq!(SNR_SCALE.quality(-20).unwrap().0, 0.0);
        assert_eq!(SNR_SCALE.quality(10).unwrap().0, 1.0);
        assert_eq!(SNR_SCALE.quality(-5).unwrap().0, 0.5);
        assert_eq!(SNR_SCALE.quality(-40).unwrap().0, 0.0, "clamped below");
        assert_eq!(SNR_SCALE.quality(40).unwrap().0, 1.0, "clamped above");
    }

    /// 6d.3 (`BND3-053`): an offer to a hive nobody has associated is accepted
    /// exactly as a broadcast is — no peer table exists to consult. Red if an
    /// addressed offer is refused.
    #[test]
    fn an_offer_needs_no_known_peer() {
        assert_eq!(accepts_target(SendTarget::Broadcast), Ok(()));
        assert_eq!(accepts_target(SendTarget::Hive(hive(7))), Ok(()));
    }

    /// L1 7.1 and 8.2.1 with 6c.1 and 6a.5 (`L1-041`, `BND3-047`, `BND3-056`):
    /// the transmitting profile states every B-field, B8 is regulated and B5
    /// is the derived fade the caller supplied. Red if a field is dropped,
    /// misdeclared, or the fade is not the one derived.
    #[test]
    fn the_regulated_profile_states_every_b_field_the_binding_fixes() {
        use crate::fade_rate::FadeSource;
        use crate::l1::{Reach, WireTier};
        let fade = FadeRate::derive(
            700,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 600,
            },
        )
        .expect("a candidate above its basis derives");
        let p = regulated_profile(fade, Receptivity::Continuous);
        assert_eq!(p.ordinal, Ordinal::Lora, "B1");
        assert_eq!(p.max_payload, 222..=222, "B2: 8.2.1 largest payload 222");
        assert_eq!(p.wire_tier, WireTier::Compact, "B3: 8.2.1 compact");
        assert_eq!(p.fade, Fade::Regulated(fade), "B5: the derived fade");
        assert!(p.fade.regulated(), "B8: 6c.1 regulated");
        assert_eq!(p.relative_cost, 5, "B6: 8.2.1 relative cost 5");
        assert_eq!(p.reach, Reach::LongRange, "B7: 8.2.1 long-range");
        assert_eq!(p.receptivity, Receptivity::Continuous, "B9: as declared");
        assert!(p.participates_in_discovery, "5.2.2: it announces");
        assert_eq!(
            p.connection, None,
            "no connection facts on a broadcast medium"
        );
    }

    /// L1 4.6.3 and D-247 (`BND3-047` for the ingress): the receive-only
    /// profile shares the medium facts with the transmitting one, keeps B8
    /// regulated, holds B5 as the declared local retention, and cannot
    /// participate in discovery. Red if it announces or the retention is not
    /// the one declared.
    #[test]
    fn the_passive_profile_shares_the_medium_facts_and_cannot_announce() {
        use crate::fade_rate::FadeSource;
        let fade = FadeRate::derive(
            700,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 600,
            },
        )
        .unwrap();
        let t = regulated_profile(fade, Receptivity::Continuous);
        let p = passive_profile(45);
        assert_eq!(
            (
                p.ordinal,
                p.max_payload.clone(),
                p.wire_tier,
                p.relative_cost,
                p.reach
            ),
            (
                t.ordinal,
                t.max_payload.clone(),
                t.wire_tier,
                t.relative_cost,
                t.reach
            ),
            "one medium, one set of medium facts"
        );
        assert_eq!(
            p.fade,
            Fade::Passive {
                observation_retention_s: 45,
                regulated: true,
            }
        );
        assert!(p.fade.regulated(), "B8 describes the medium, not the role");
        assert!(!p.participates_in_discovery, "an ingress cannot announce");
        assert_eq!(p.connection, None);
    }

    /// The bench PHY — SF12, 125 kHz, 4/5, eight preamble symbols.
    const fn bench_phy() -> crate::lora_airtime::LoraPhy {
        crate::lora_airtime::LoraPhy {
            spreading_factor: 12,
            bandwidth_hz: 125_000,
            coding_rate: 1,
            preamble_symbols: 8,
        }
    }

    /// L1 9.4 (`L1-060`): a fresh port reports one new window, then none, and
    /// exactly one more once a later tick has established the window elapsed.
    /// Red if the edge is not latched from `tick`, or if `window` does not
    /// consume it.
    #[test]
    fn a_port_reports_one_new_window_then_none_until_the_window_rolls() {
        let mut port = RegulatedPort::new(1_000, 10, Ticks(0), 1, bench_phy());
        assert!(
            port.window().new_window,
            "a fresh port begins in a new window"
        );
        assert!(!port.window().new_window, "the edge was consumed");
        assert!(!port.tick(Ticks(5)), "mid-window: no roll");
        assert!(!port.window().new_window);
        assert!(port.tick(Ticks(11)), "the ten-second window elapsed");
        assert!(port.window().new_window, "the roll reached the scheduler");
        assert!(!port.window().new_window, "and exactly once");
    }

    /// L1 9.3 and 9.4 (`L1-060`): remaining airtime is the allowance minus what
    /// was charged, a charge is the airtime of the wrapped transmission, a
    /// refusal spends nothing, and the edge latched by a roll survives a
    /// charge made in the same tick. Red if the charge does not reach the
    /// budget or a refusal is charged.
    #[test]
    fn remaining_airtime_is_the_allowance_minus_the_charged_wrapped_airtime() {
        let mut port = RegulatedPort::new(2_000, 3_600, Ticks(0), 1, bench_phy());
        let one = port.airtime_ms(24);
        assert!(one > 0);
        assert!(port.charge(24, Ticks(1)));
        assert_eq!(port.window().remaining_airtime_ms, 2_000 - one);
        assert!(!port.exhausted());
        // A charge the window cannot afford is refused and spends nothing.
        let before = port.remaining_ms();
        assert!(
            !port.charge(MAX_WRAPPED, Ticks(2)),
            "an SF12 maximum frame exceeds what is left"
        );
        assert_eq!(port.remaining_ms(), before, "9.3: a refusal spends nothing");
    }

    /// L1 9.5 with 2.2 (`L1-060`): the quote is the airtime of the wrapped
    /// transmission — four octets more than the frame — and an offer the
    /// medium cannot carry is refused as oversize, as the send would refuse
    /// it. Red if the quote is taken on the payload length.
    #[test]
    fn the_quote_is_the_airtime_of_the_wrapped_frame_not_the_payload() {
        let port = RegulatedPort::new(1_000, 10, Ticks(0), 1, bench_phy());
        let from = LoraAddress::from_entropy([1, 2, 3, 4]);
        let frame = [0xA5u8; 40];
        let quoted = port.quote(from, &frame).expect("quotes");
        assert_eq!(quoted, port.airtime_ms(40 + WRAPPING_LEN));
        assert_ne!(quoted, port.airtime_ms(40), "the wrapping goes on air too");
        let over = [0u8; FRAME_MTU + 1];
        assert_eq!(port.quote(from, &over), Err(SendError::Oversize));
    }
    /// ‼ **BND3 4.3: THE ROTATION IS ASSERTED ON WHAT GOES ON AIR, NOT ON THE
    /// FIELD.** A test reading `address` back would pass against a plain
    /// setter and against the defect this function exists to prevent — the
    /// queue still holding frames wrapped with the retired address. *So the
    /// queued bytes are unwrapped and their source read: that is what a
    /// listener sees, and 4.3 is a rule about what a listener can correlate.*
    ///
    /// Mutation that turns it red: dropping the `discard_all` call, or
    /// replacing `must_rotate(persona_changed)` with `true`.
    #[test]
    fn a_persona_change_rotates_the_address_and_takes_the_old_wrapped_frames_with_it() {
        let old = LoraAddress::from_entropy([1, 2, 3, 4]);
        let new = LoraAddress::from_entropy([9, 9, 9, 9]);
        let mut address = old;
        let mut q: OutboundQueue<4> = OutboundQueue::new();

        let mut wrapped = [0u8; MAX_WRAPPED];
        let n = wrap(address, b"payload", &mut wrapped).expect("wraps");
        q.push(&wrapped[..n]).expect("queued");
        assert_eq!(q.waiting(), 1, "precondition: a frame really is queued");
        // Precondition on the FRAME rather than on the queue: the bytes
        // waiting to go out carry the old address.
        let mut seen = [0u8; MAX_WRAPPED];
        let len = q.peek(&mut seen).expect("one waiting");
        assert_eq!(unwrap(&seen[..len]).expect("valid").0, old);

        // NO persona change: nothing moves, and the queue is untouched.
        assert_eq!(
            rotate_on_persona_change(&mut address, &mut q, false, new),
            None
        );
        assert_eq!(address, old, "4.3 has ONE trigger and it did not fire");
        assert_eq!(q.waiting(), 1, "a non-rotation must not drop traffic");

        // The persona changes.
        assert_eq!(
            rotate_on_persona_change(&mut address, &mut q, true, new),
            Some(1),
            "the rotation reports what it cost"
        );
        assert_eq!(address, new);
        assert_eq!(
            q.waiting(),
            0,
            "‼ the frame wrapped with the RETIRED address must not survive the \
             rotation — it would put the old address on air afterwards"
        );
        assert_eq!(q.peek(&mut seen), None, "and nothing is left to read");

        // What is queued AFTER the rotation carries the new address, which is
        // the positive half: the bearer is still usable, not merely emptied.
        let n = wrap(address, b"payload", &mut wrapped).expect("wraps");
        q.push(&wrapped[..n]).expect("queued");
        let len = q.peek(&mut seen).expect("one waiting");
        assert_eq!(unwrap(&seen[..len]).expect("valid").0, new);
    }

    /// ‼ **BND3 6c.3a: A SELF-IMPOSED CEILING IS NOT A DUTY CYCLE, AND THE
    /// TWO MUST BE TELLABLE APART AT THE PORT.** *A deployment whose region
    /// imposes no duty cycle shall not state a budget in place of it.* The
    /// assertion that matters is the PAIR: an unregulated port never reports
    /// itself exhausted, while the deployment's own ceiling still holds — so
    /// a caller reporting why nothing is going out says *our choice* and not
    /// *out of legal airtime*.
    ///
    /// Mutation that turns it red: `unregulated` charging against a real
    /// allowance, or `BenchCeiling::holding` answering from the port.
    #[test]
    fn an_unregulated_port_is_never_exhausted_and_the_bench_ceiling_still_holds() {
        // The DFR1195's own PHY after d613: 916.8 MHz SF12, 125 kHz, 4/5.
        let phy = crate::lora_airtime::LoraPhy {
            spreading_factor: 12,
            bandwidth_hz: 125_000,
            coding_rate: 1,
            preamble_symbols: 8,
        };
        let mut port = RegulatedPort::unregulated(Ticks(0), 1, phy);
        // Ten seconds of airtime charged against a region that imposes none.
        for _ in 0..10 {
            assert!(
                port.charge(MAX_WRAPPED, Ticks(0)),
                "no regulation, no refusal"
            );
        }
        assert!(
            !port.exhausted(),
            "‼ 6c.3a: the REGION imposes nothing, so the regulatory counter must \
             never be the thing that stops a transmission here"
        );

        // The deployment's own restraint, which is a different claim entirely.
        // Exactly one frame's worth, so one frame exhausts it. `exhausted`
        // means nothing more can be sent in this window, not that the NEXT
        // frame of this size would not fit — a scrap left is not exhausted.
        let cost = port.airtime_ms(MAX_WRAPPED);
        let mut bench = BenchCeiling::of(cost, 3_600, Ticks(0), 1);
        assert!(!bench.holding(), "nothing spent yet");
        assert!(bench.charge(cost, Ticks(0)), "the first frame fits exactly");
        assert!(
            bench.holding(),
            "the deployment's own ceiling withholds the next one"
        );
        assert!(!bench.charge(cost, Ticks(0)), "and refuses it");
        // ‼ THE PORT IS STILL NOT EXHAUSTED. That is the whole distinction:
        //   the two answers disagree, and a reader can tell which stopped it.
        assert!(!port.exhausted(), "the region still imposes nothing");

        // An unset ceiling is not a ceiling of zero.
        let mut absent = BenchCeiling::none();
        assert!(!absent.holding());
        assert!(
            absent.charge(u32::MAX, Ticks(0)),
            "no restraint permits everything"
        );
        assert!(!absent.holding(), "and never begins holding");
    }

    #[test]
    fn legal_and_deployment_charges_are_atomic_and_their_window_edges_are_independent() {
        let cost = RegulatedPort::new(0, 10, Ticks(0), 1, bench_phy()).airtime_ms(44);
        for (legal_allowance, deployment_allowance) in [
            (cost - 1, cost * 2),
            (cost * 2, cost - 1),
            (cost * 2, cost * 2),
        ] {
            let mut legal = RegulatedPort::new(legal_allowance, 10, Ticks(0), 1, bench_phy());
            let mut deployment = BenchCeiling::of(deployment_allowance, 20, Ticks(0), 1);
            assert!(legal.window().new_window);
            assert!(deployment.window().unwrap().new_window);
            let allowed = legal_allowance >= cost && deployment_allowance >= cost;
            assert_eq!(
                legal.charge_with_ceiling(&mut deployment, 44, Ticks(0)),
                allowed
            );
            assert_eq!(
                legal.remaining_ms(),
                legal_allowance - if allowed { cost } else { 0 }
            );
            let held = deployment.window().unwrap();
            assert_eq!(
                held.remaining_airtime_ms,
                deployment_allowance - if allowed { cost } else { 0 }
            );
            assert!(!held.new_window);
            // Charging itself must latch a roll, even without a separate tick.
            legal.charge_with_ceiling(&mut deployment, 44, Ticks(11));
            assert!(legal.window().new_window);
            assert!(!deployment.window().unwrap().new_window);
            legal.charge_with_ceiling(&mut deployment, 44, Ticks(21));
            assert!(
                !legal.window().new_window,
                "equality does not exceed the legal window"
            );
            assert!(deployment.window().unwrap().new_window);
        }
    }
}
