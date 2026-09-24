//! **How a shared, half-duplex medium is divided between hives that must all
//! relay (BND3 6e, answering L1 11.1 k).**
//!
//! # ‼ THE THREE FACTS THAT MAKE THIS MANDATORY RATHER THAN ADVISABLE
//!
//! **L3 5.1.1 obliges *every* hive to relay a frame not addressed to it.** So
//! on a shared medium every hive is a repeater, and most of what a hive
//! transmits is traffic it did not originate.
//!
//! **L1 11.1 a) to j) had no item for medium access**, so BND3's silence on
//! the subject was *conformant* — nothing had ever asked it. *A gap that
//! reads as an implementation choice from one end and as a completed list
//! from the other.* (`SS426`; 11.1 k) now asks.)
//!
//! **And the medium is half-duplex.** A radio cannot hear while it sends, so
//! two hives relaying the same frame at the same instant are **each deaf to
//! the other's collision**. Neither can detect it, neither can back off
//! part-way, and nothing above them learns why the frame did not arrive.
//! *The failure is invisible to both parties, at both parties.*
//!
//! # The mechanism, and why the inversion is the whole of it
//!
//! Sense the channel; defer a random whole number of slots while it is busy.
//! Then, for a **relay**, wait a random delay drawn from a window that
//! **narrows as the received quality falls** — so the hive that heard the
//! frame *worst* is the hive that transmits *first*.
//!
//! ‼ **THAT IS BACKWARDS ON PURPOSE.** A weak reception means a distant
//! sender, and a distant hive's relay carries the frame **furthest**. Letting
//! it go first spends the airtime on distance; the nearer hives, still
//! waiting, hear that relay and abandon their own.
//!
//! **Neither half works alone.** Without abandonment the inversion merely
//! reorders a scramble in which everyone still transmits. Without the
//! inversion the abandonment cancels whichever hive drew the short straw,
//! which is as likely to be the one adding no distance at all.
//!
//! # ⚠ WHAT THIS DOES NOT DO
//!
//! **It does not make the medium collision-free**, and no listen-before-talk
//! discipline on any medium does. Two hives out of range of each other and in
//! range of a third both find the channel idle and both transmit; the third
//! hears neither. *That is the hidden terminal, it is unsolved here, and it
//! is named so nobody reads a clear channel as a guarantee.* What this
//! removes is the collision between hives that **can** hear each other —
//! which, where every hive relays every frame, is the common case.

use r2_hal_traits::Ticks;

use crate::{l1::LinkQuality, lora::FRAME_MTU, lora_region::MediumAccess};

/// What one channel-activity detection found.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Channel {
    Idle,
    /// A preamble or a transmission of the configured modulation is present.
    Busy,
}

/// What a bearer should do about a frame it wants to send now.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Access {
    /// The channel was idle. Transmit.
    Transmit,
    /// Busy. Wait this many slot periods and sense again (6e.2).
    Defer { slots: u16 },
    /// ‼ **The deferral limit is reached, so the bearer reports *unavailable*
    /// (6b.3) rather than deferring for ever.** *A bearer that retried
    /// silently and indefinitely would present a congested channel as a slow
    /// one, and the layers above cannot choose another bearer for a state
    /// they are never told about.*
    Unavailable,
}

/// The contention parameters a bearer runs with.
///
/// `slot_us` **must** be at least the time one channel-activity detection
/// occupies at the configured PHY (6e.3) — *a slot shorter than the test that
/// fills it cannot separate two transmitters* — and
/// [`Contention::slot_is_long_enough`] is how a caller checks rather than
/// assumes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Contention {
    pub slot_us: u32,
    /// The widest backoff, in slots, for a hive that heard the frame
    /// perfectly. The window shrinks from here as quality falls (6e.4).
    pub max_window_slots: u16,
    /// How many consecutive busy senses before [`Access::Unavailable`].
    pub max_deferrals: u8,
    /// The level a sense must exceed to call the channel busy, where a region
    /// fixes one (6e.7).
    ///
    /// ‼ **`None` IS THE RADIO'S OWN DETECTION, NOT A THRESHOLD OF ZERO.**
    /// *0 dBm is a level nothing on this medium ever exceeds*, so a `None`
    /// flattened into a number would make every channel read idle and turn
    /// carrier sense into an expensive no-op that still reports success.
    pub threshold_dbm: Option<i16>,
}

impl Contention {
    /// Whether `slot_us` satisfies 6e.3 against the measured duration of one
    /// detection.
    pub const fn slot_is_long_enough(&self, cad_duration_us: u32) -> bool {
        self.slot_us >= cad_duration_us
    }

    /// **6e.3 — the time one channel-activity detection occupies, in
    /// microseconds.**
    ///
    /// A CAD runs for a fixed number of symbols at the configured PHY, so its
    /// duration is `symbols x symbol_time`. `lora-phy`'s SX126x driver
    /// configures **eight** symbols (`CADSymbols::_8`), which is where the
    /// count comes from — *it is a property of the driver, not of the
    /// standard*, so it is a parameter here rather than a constant.
    pub const fn cad_duration_us(phy: &crate::lora_airtime::LoraPhy, symbols: u16) -> u32 {
        phy.symbol_time_us().saturating_mul(symbols as u32)
    }

    /// **6e.3 — a slot at least as long as one detection, derived rather than
    /// declared.**
    ///
    /// ‼ **THE DEPLOYED SLOT WAS 80 000 µs AGAINST A DETECTION OF 262 144 µs
    /// AT SF12/125 kHz, WHICH IS THE FAILURE 6e.3 NAMES AND THIS TYPE'S OWN
    /// DOCUMENTATION DESCRIBES.** *A slot shorter than the test that fills it
    /// cannot separate two transmitters* — both sense, both find the channel
    /// busy, and both re-sense inside the same transmission for ever. The
    /// number was a hand-written literal and the PHY it had to agree with was
    /// three constants away.
    ///
    /// **Derivation is the repair rather than an assertion**, because an
    /// assertion catches a wrong number after somebody writes it and this
    /// makes the wrong number unwritable: change the spreading factor and the
    /// slot follows. [`Self::slot_is_long_enough`] remains for a caller
    /// holding a slot it did not derive.
    ///
    /// The wider of the two is taken, so a deployment that had already chosen
    /// a longer slot for its own reasons keeps it.
    pub const fn for_cad(self, phy: &crate::lora_airtime::LoraPhy, symbols: u16) -> Self {
        let needed = Self::cad_duration_us(phy, symbols);
        Self {
            slot_us: if needed > self.slot_us {
                needed
            } else {
                self.slot_us
            },
            ..self
        }
    }

    /// **6e.7 — where the region imposes its own medium access, those
    /// parameters govern.**
    ///
    /// Returns the contention a bearer shall run with in `access`'s region:
    /// the region's minimum sensing duration in place of any shorter slot,
    /// and the region's threshold where it fixes one.
    ///
    /// ‼ **IT TAKES THE MAXIMUM AND NEVER THE REGION'S VALUE OUTRIGHT, AND
    /// THAT IS 6e.7 READ EXACTLY.** The clause says a region's parameters
    /// replace *any less restrictive value this clause would otherwise
    /// permit* — so a region demanding a longer sense lengthens the slot, and
    /// a region demanding a shorter one **changes nothing**. Assigning the
    /// region's value directly would satisfy the sentence read casually and
    /// would *shorten* a slot this binding had already set for the medium's
    /// own sake under 6e.3, which is the one thing 6e.7 never authorises: it
    /// only ever ratchets toward more restrictive.
    ///
    /// [`MediumAccess::RegionImposesNone`] returns `self` unchanged, because
    /// 6e.1 still obliges this binding's own detection whatever the law says.
    pub const fn for_region(self, access: MediumAccess) -> Self {
        match access {
            MediumAccess::RegionImposesNone => self,
            MediumAccess::CarrierSense {
                threshold_dbm,
                min_sense_us,
            } => Self {
                slot_us: if min_sense_us > self.slot_us {
                    min_sense_us
                } else {
                    self.slot_us
                },
                // ‼ A REGION THAT MANDATES SENSING WITHOUT FIXING A LEVEL
                //   LEAVES WHATEVER THE BEARER HAD, rather than clearing it:
                //   `None` here is *the region states none*, and overwriting a
                //   bearer's own threshold with it would be this function
                //   making the deployment LESS restrictive under a clause that
                //   cannot do that.
                threshold_dbm: match threshold_dbm {
                    Some(t) => Some(t),
                    None => self.threshold_dbm,
                },
                ..self
            },
        }
    }

    /// **6e.1/6e.2 — what to do given what the sense found.**
    ///
    /// `deferrals_so_far` is the count of consecutive busy senses already
    /// made for this frame; `entropy` supplies the randomness the standard
    /// requires and this crate does not generate.
    /// How long a deferral of `slots` waits before the medium is tested
    /// again (BND3 6e.2). The bearer awaits exactly this before re-sensing,
    /// which is what makes the random choice load-bearing.
    pub const fn wait_us(&self, slots: u16) -> u64 {
        slots as u64 * self.slot_us as u64
    }

    pub fn decide(&self, sensed: Channel, deferrals_so_far: u8, entropy: u16) -> Access {
        match sensed {
            Channel::Idle => Access::Transmit,
            Channel::Busy if deferrals_so_far >= self.max_deferrals => Access::Unavailable,
            Channel::Busy => Access::Defer {
                // At least one slot: a zero-slot deferral is a busy-wait that
                // re-senses within the same transmission it just detected.
                slots: 1 + entropy % self.max_window_slots.max(1),
            },
        }
    }

    /// **6e.4 — the relay backoff window, inverted against quality.**
    ///
    /// Returns the number of slots to wait. **A worse-heard frame yields a
    /// shorter wait**, so the most distant hearer relays first.
    ///
    /// ‼ **THE FLOOR IS ONE SLOT AND NOT ZERO.** A zero wait for the weakest
    /// hearer would make the relay immediate, and *two hives that both heard
    /// a frame equally badly would then transmit together every time* — the
    /// exact collision this exists to prevent, reintroduced at the one
    /// quality value where it is most likely, because a frame at the edge of
    /// range is heard badly by everything out there.
    pub fn relay_backoff_slots(&self, heard_at: LinkQuality, entropy: u16) -> u16 {
        // `LinkQuality` is [0, 1]; clamp rather than trust, because the value
        // arrives from a bearer's own scale conversion.
        //
        // ‼ **NaN IS TREATED AS THE BEST POSSIBLE RECEPTION, AND THE
        // DIRECTION IS THE WHOLE REASON THIS BRANCH EXISTS.** `clamp` alone
        // propagates NaN, `NaN as u16` saturates to **0**, and a zero window
        // is the *shortest* wait — so a bearer whose quality conversion
        // divided by zero would **win every race on the mesh** and relay
        // ahead of hives that genuinely heard the frame worst. *A broken
        // measurement must lose the contention, not win it*, so it is mapped
        // to the longest backoff and yields to anything real.
        let q = if heard_at.0.is_nan() {
            1.0
        } else {
            heard_at.0.clamp(0.0, 1.0)
        };
        let window = 1 + ((self.max_window_slots.saturating_sub(1)) as f32 * q) as u16;
        1 + entropy % window
    }
}

/// A relay this hive intends to make, and has not yet made.
///
/// Held so that 6e.5 can cancel it: the frame is identified exactly as
/// L3 5.3.1 identifies it — **origin and message identifier, never the hive
/// it was received from** (5.3.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PendingRelay {
    pub origin: u32,
    pub message_id: u32,
    /// Slots remaining before this relay transmits.
    pub slots_remaining: u16,
}

/// What happened to a pending relay when another hive was heard.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Suppression {
    /// ‼ **6e.5: somebody else relayed it, so this hive does not.** *An
    /// overheard relay is already evidence the frame is travelling; spending
    /// that information is cheaper than spending the airtime.*
    Abandoned,
    /// A different frame. The pending relay stands.
    Unaffected,
}

/// The L3 identity of a relay candidate, carried into L1 without asking L1 to
/// parse a Layer 4 frame.
///
/// `origin` is opaque: compact and extended route entries have different
/// widths, and their interpretation remains with the layer that parsed the
/// frame. Equality is the only operation medium access needs for 6e.5.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RelayKey {
    origin: [u8; 8],
    origin_len: u8,
    message_id: u32,
}

impl RelayKey {
    /// Construct a key from the origin representation the frame tier carried.
    ///
    /// A route entry is either compact or extended; an empty or other-width
    /// value cannot identify a relay and is refused rather than padded into a
    /// possibly matching origin.
    pub fn new(origin: &[u8], message_id: u32) -> Option<Self> {
        if origin.len() != 4 && origin.len() != 8 {
            return None;
        }
        let mut stored = [0u8; 8];
        stored[..origin.len()].copy_from_slice(origin);
        Some(Self {
            origin: stored,
            origin_len: origin.len() as u8,
            message_id,
        })
    }
}

/// Why a direct-LoRa relay cannot enter its bounded suppression window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelayWorkRefusal {
    /// The complete L1 frame exceeds direct LoRa's fixed payload ceiling.
    Oversize { len: usize },
    /// A caller cannot receive the complete opaque frame; no prefix is valid.
    OutputTooSmall { needed: usize },
}

/// The state of one pending relay after it has received L3 authority.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelayWorkState {
    /// It remains in the suppression window and blocks originated traffic.
    Waiting,
    /// L1 accepted the exact frame into its physical transmit queue.
    Admitted,
    /// A matching relay was heard; this frame must not be transmitted.
    Suppressed,
}

/// One bounded, opaque direct-LoRa relay held through its suppression window.
///
/// The slot is deliberately singular. An owner must not silently replace an
/// earlier authorised relay with a later arrival: L3 made the forwarding
/// decision once, while BND3 6e.5 needs that exact candidate available for
/// suppression. A board that needs more capacity composes explicit slots and
/// an L3 queue policy above this L1 primitive.
#[derive(Clone, Copy)]
pub struct RelayWork {
    key: RelayKey,
    bytes: [u8; FRAME_MTU],
    len: usize,
    due: Ticks,
    state: RelayWorkState,
    // Suppression is the current state, but an owner also needs to know
    // whether this exact work reached its physical queue before it was
    // suppressed.  That history decides whether CancelPending is required;
    // inferring it after `state` becomes Suppressed would lose the fact.
    was_admitted: bool,
}

impl RelayWork {
    /// Retain the exact prepared frame until `due`.
    pub fn new(key: RelayKey, frame: &[u8], due: Ticks) -> Result<Self, RelayWorkRefusal> {
        if frame.len() > FRAME_MTU {
            return Err(RelayWorkRefusal::Oversize { len: frame.len() });
        }
        let mut bytes = [0u8; FRAME_MTU];
        bytes[..frame.len()].copy_from_slice(frame);
        Ok(Self {
            key,
            bytes,
            len: frame.len(),
            due,
            state: RelayWorkState::Waiting,
            was_admitted: false,
        })
    }

    /// The relay's current suppression/admission state.
    pub const fn state(&self) -> RelayWorkState {
        self.state
    }

    /// Whether an originated frame must wait to preserve this relay's
    /// suppression opportunity.
    pub const fn blocks_originated(&self) -> bool {
        !matches!(self.state, RelayWorkState::Suppressed)
    }

    /// Whether an older originated queue head must remain physically quiet.
    ///
    /// A waiting relay has not yet earned an L1 queue entry, but its
    /// suppression interval is still a listening interval.  Starting a
    /// pre-existing originated CAD/TX attempt here would make the radio deaf
    /// to the matching relay that BND3 6e.5 requires it to hear.  Once the
    /// relay is admitted it is promoted ahead of that older head, so normal
    /// owner progress may resume for the relay itself.
    pub const fn holds_older_originated_attempt(&self) -> bool {
        matches!(self.state, RelayWorkState::Waiting)
    }

    /// Whether this exact frame is ready to offer to the regulated L1 queue.
    pub const fn is_due(&self, now: Ticks) -> bool {
        matches!(self.state, RelayWorkState::Waiting) && now.0 >= self.due.0
    }

    /// Copy the complete prepared frame for an L1 offer without consuming it.
    ///
    /// The owner calls [`Self::acknowledge_admission`] only after its L1 queue
    /// accepts the bytes. A dispatcher refusal therefore leaves the relay
    /// eligible for an explicit later policy decision rather than reporting a
    /// frame as pending when it was lost.
    pub fn copy_frame(&self, out: &mut [u8]) -> Result<usize, RelayWorkRefusal> {
        if out.len() < self.len {
            return Err(RelayWorkRefusal::OutputTooSmall { needed: self.len });
        }
        out[..self.len].copy_from_slice(&self.bytes[..self.len]);
        Ok(self.len)
    }

    /// Record successful acceptance into the physical transmit queue.
    pub fn acknowledge_admission(&mut self) -> bool {
        if self.state != RelayWorkState::Waiting {
            return false;
        }
        self.state = RelayWorkState::Admitted;
        self.was_admitted = true;
        true
    }

    /// Whether suppressing this work also requires its selected physical
    /// queue head to be cancelled.  This is intentionally a property of the
    /// work rather than board-local remembered timing: [`Self::on_heard`]
    /// changes the current state to `Suppressed`, which otherwise erases the
    /// distinction between work still in its listen window and work already
    /// admitted by the single radio owner.
    pub const fn needs_queue_cancellation(&self) -> bool {
        matches!(self.state, RelayWorkState::Suppressed) && self.was_admitted
    }

    /// Apply BND3 6e.5 before any later relay decision.
    pub fn on_heard(&mut self, key: RelayKey) -> Suppression {
        if self.key != key {
            return Suppression::Unaffected;
        }
        self.state = RelayWorkState::Suppressed;
        Suppression::Abandoned
    }
}

impl PendingRelay {
    /// **6e.5 — abandon on hearing the same frame from another hive.**
    pub fn on_heard(&mut self, origin: u32, message_id: u32) -> Suppression {
        if self.origin == origin && self.message_id == message_id {
            self.slots_remaining = 0;
            Suppression::Abandoned
        } else {
            Suppression::Unaffected
        }
    }

    /// Whether this relay was abandoned rather than merely due.
    ///
    /// **Distinct from `slots_remaining == 0` reached by counting down**, and
    /// the caller must keep them apart — which is why [`Suppression`] is
    /// returned rather than inferred. *A relay that arrived at zero by waiting
    /// must transmit; one that arrived there by abandonment must not.*
    pub const fn is_due(&self, abandoned: bool) -> bool {
        self.slots_remaining == 0 && !abandoned
    }
}

/// **What a bearer should put on the air next (BND3 6e.6).**
///
/// ‼ **6e.6 FORBIDS PREFERRING YOUR OWN FRAME *SOLELY BECAUSE IT IS YOURS*,**
/// and the reason is not politeness. A relay's backoff window was chosen by
/// 6e.4 so that the hive which heard the frame **worst** — the one whose
/// relay carries it furthest — speaks first. *An originated frame that jumps
/// that queue does not merely delay a relay; it moves the relay out of the
/// slot the whole inversion exists to put it in.*
///
/// ⚠ **AND IT COSTS THE SUPPRESSION, WHICH IS THE PART THAT IS NOT OBVIOUS.**
/// This medium is half-duplex: while transmitting, the radio is deaf. A hive
/// that sends its own frame while a relay is counting down **cannot hear the
/// neighbour's rebroadcast during that window** — so 6e.5 never fires, the
/// relay it should have abandoned goes out anyway, and the frame is
/// transmitted twice on a medium where one transmission is a second of
/// airtime. *Jumping the queue does not save a transmission; it adds one.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NextOut {
    /// The pending relay is due and goes.
    Relay,
    /// Nothing is pending, so the hive's own frame goes.
    Originated,
    /// ‼ **A relay is pending but not yet due, and the hive's own frame WAITS
    /// rather than filling the gap.** *The gap is not idle time — it is the
    /// window in which a neighbour's rebroadcast would cancel this relay, and
    /// a transmission spent in it is spent going deaf on purpose.*
    WaitForRelay { slots_remaining: u16 },
    /// Nothing to send.
    Idle,
}

/// **Decide what goes next (6e.6).**
///
/// `abandoned` is whether the pending relay was cancelled by 6e.5 — it is
/// passed rather than inferred because [`PendingRelay::is_due`] cannot tell
/// *counted down to zero* from *cancelled at zero*, and they are opposite
/// instructions.
pub const fn next_transmission(
    pending: Option<PendingRelay>,
    abandoned: bool,
    have_originated: bool,
) -> NextOut {
    match pending {
        Some(p) if !abandoned => {
            if p.slots_remaining == 0 {
                NextOut::Relay
            } else {
                // ‼ Even with nothing else to do, an originated frame does not
                // fill this window. See `NextOut::WaitForRelay`.
                NextOut::WaitForRelay {
                    slots_remaining: p.slots_remaining,
                }
            }
        }
        _ if have_originated => NextOut::Originated,
        _ => NextOut::Idle,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const C: Contention = Contention {
        slot_us: 12_000,
        max_window_slots: 16,
        max_deferrals: 8,
        // The bench radio's own detection: no region in the tree fixes a level
        // for this fixture, and 6e.7 is exercised by `for_region` rather than
        // by baking a threshold in here.
        threshold_dbm: None,
    };

    #[test]
    fn an_idle_channel_transmits_and_a_busy_one_defers() {
        assert_eq!(C.decide(Channel::Idle, 0, 7), Access::Transmit);
        match C.decide(Channel::Busy, 0, 7) {
            Access::Defer { slots } => assert!(
                slots >= 1,
                "a zero-slot deferral re-senses inside the transmission it just found"
            ),
            other => panic!("expected a deferral, got {other:?}"),
        }
    }

    /// ‼ **A CONGESTED CHANNEL BECOMES A REPORTED STATE, NOT AN INFINITE
    /// RETRY.** The layers above cannot choose another bearer for a condition
    /// nothing tells them about.
    #[test]
    fn deferral_is_bounded_and_ends_in_unavailable() {
        assert_eq!(
            C.decide(Channel::Busy, C.max_deferrals, 3),
            Access::Unavailable
        );
        assert_eq!(
            C.decide(Channel::Busy, C.max_deferrals + 5, 3),
            Access::Unavailable
        );
        // And one below the limit still defers, so the boundary is the stated one.
        assert!(matches!(
            C.decide(Channel::Busy, C.max_deferrals - 1, 3),
            Access::Defer { .. }
        ));
    }

    /// ‼ **THE PROPERTY THE WHOLE MECHANISM RESTS ON: WORSE HEARD MEANS
    /// SOONER SENT.** If this inverts, the mesh spends its airtime on the
    /// relays that add the least distance.
    #[test]
    fn a_worse_heard_frame_relays_sooner_than_a_well_heard_one() {
        // Same entropy, so only the quality differs.
        let far = C.relay_backoff_slots(LinkQuality(0.05), 9_999);
        let near = C.relay_backoff_slots(LinkQuality(0.95), 9_999);
        assert!(
            far < near,
            "the distant hearer waited longer ({far} vs {near}) — the inversion is the mechanism"
        );
    }

    /// The floor is one slot at every quality, including the worst.
    #[test]
    fn no_quality_produces_an_immediate_relay() {
        for q in [0.0f32, 0.01, 0.5, 1.0] {
            for e in [0u16, 1, 7, 65_535] {
                assert!(
                    C.relay_backoff_slots(LinkQuality(q), e) >= 1,
                    "quality {q} entropy {e} produced a zero wait: two edge-of-range \
                     hearers would then transmit together every time"
                );
            }
        }
    }

    /// A quality outside [0, 1] is clamped rather than trusted — it arrives
    /// from a bearer's own scale conversion.
    #[test]
    fn an_out_of_range_quality_does_not_escape_the_window() {
        for q in [-5.0f32, 1.5, 99.0] {
            let s = C.relay_backoff_slots(LinkQuality(q), 65_535);
            assert!(s >= 1 && s <= C.max_window_slots, "got {s} for quality {q}");
        }
    }

    /// ‼ **A BROKEN QUALITY MEASUREMENT MUST LOSE THE CONTENTION, NOT WIN
    /// IT.** `NaN as u16` saturates to zero, and zero is the *shortest* wait
    /// — so the naive clamp would let a bearer with a divide-by-zero in its
    /// scale conversion relay ahead of every hive that genuinely heard the
    /// frame badly.
    #[test]
    fn a_nan_quality_yields_the_longest_backoff_rather_than_the_shortest() {
        let nan = C.relay_backoff_slots(LinkQuality(f32::NAN), 0);
        let worst = C.relay_backoff_slots(LinkQuality(0.0), 0);
        let best = C.relay_backoff_slots(LinkQuality(1.0), 0);
        assert_eq!(
            nan, best,
            "a NaN quality did not take the best-reception window"
        );
        assert!(
            nan >= worst,
            "a NaN quality ({nan}) beat a genuinely weak reception ({worst}) to the air"
        );
    }

    /// ‼ **6e.5, AND IT IS KEYED THE WAY L3 5.3.1 KEYS IT.**
    #[test]
    fn hearing_the_same_frame_from_another_hive_abandons_the_relay() {
        let mut p = PendingRelay {
            origin: 0xAABB_CCDD,
            message_id: 42,
            slots_remaining: 9,
        };
        assert_eq!(p.on_heard(0xAABB_CCDD, 42), Suppression::Abandoned);
        assert_eq!(p.slots_remaining, 0);
        assert!(!p.is_due(true), "an abandoned relay must not transmit");
    }

    /// **The negative control**: a different frame leaves the pending relay
    /// alone. Without this the test above would pass on an implementation
    /// that abandoned on any reception at all.
    #[test]
    fn a_different_frame_does_not_abandon_the_pending_relay() {
        let mut p = PendingRelay {
            origin: 0xAABB_CCDD,
            message_id: 42,
            slots_remaining: 9,
        };
        assert_eq!(p.on_heard(0xAABB_CCDD, 43), Suppression::Unaffected);
        assert_eq!(p.on_heard(0x1111_2222, 42), Suppression::Unaffected);
        assert_eq!(
            p.slots_remaining, 9,
            "an unrelated frame moved the countdown"
        );
    }

    #[test]
    fn relay_work_retains_the_exact_frame_until_queue_admission() {
        let key = RelayKey::new(&[1, 2, 3, 4], 9).expect("a compact origin is valid");
        let frame = [0xA5, 0x5A, 0x09];
        let mut work = RelayWork::new(key, &frame, Ticks(50)).expect("fits direct LoRa");
        assert!(
            work.blocks_originated(),
            "a suppression window is not idle time"
        );
        assert!(
            work.holds_older_originated_attempt(),
            "an older queued origin must not make this half-duplex radio deaf during suppression"
        );
        assert!(!work.is_due(Ticks(49)));
        assert!(work.is_due(Ticks(50)));

        let mut copied = [0u8; FRAME_MTU];
        let len = work
            .copy_frame(&mut copied)
            .expect("full output accepts the frame");
        assert_eq!(
            &copied[..len],
            &frame,
            "L1 retained no parsed or rewritten substitute"
        );
        assert_eq!(
            work.state(),
            RelayWorkState::Waiting,
            "copying is not admission"
        );
        assert!(work.acknowledge_admission());
        assert_eq!(work.state(), RelayWorkState::Admitted);
        assert!(
            !work.holds_older_originated_attempt(),
            "the admitted relay is now the promoted queue head, not a reason to hold it"
        );
        assert!(
            !work.is_due(Ticks(500)),
            "an admitted frame is not offered twice"
        );
        assert!(
            !work.acknowledge_admission(),
            "admission cannot be reported twice"
        );
    }

    #[test]
    fn a_matching_arrival_suppresses_even_an_admitted_relay() {
        let key = RelayKey::new(&[1, 2, 3, 4], 9).expect("a compact origin is valid");
        let other = RelayKey::new(&[1, 2, 3, 4], 10).expect("a compact origin is valid");
        let mut work = RelayWork::new(key, &[7], Ticks(50)).expect("fits direct LoRa");
        assert_eq!(work.on_heard(other), Suppression::Unaffected);
        assert_eq!(work.state(), RelayWorkState::Waiting);
        assert!(
            !work.needs_queue_cancellation(),
            "waiting work owns no physical queue head"
        );
        assert!(work.acknowledge_admission());
        assert_eq!(work.on_heard(key), Suppression::Abandoned);
        assert_eq!(work.state(), RelayWorkState::Suppressed);
        assert!(
            work.needs_queue_cancellation(),
            "an admitted relay must be removed from the selected queue after suppression"
        );
        assert!(
            !work.blocks_originated(),
            "the cancelled relay no longer holds the medium"
        );
        assert!(
            !work.is_due(Ticks(500)),
            "a heard relay is never offered again"
        );
    }

    #[test]
    fn relay_work_refuses_an_oversized_or_partial_frame() {
        let key = RelayKey::new(&[1; 8], 9).expect("an extended origin is valid");
        assert!(matches!(
            RelayWork::new(key, &[0; FRAME_MTU + 1], Ticks(0)),
            Err(RelayWorkRefusal::Oversize { len }) if len == FRAME_MTU + 1
        ));
        let work = RelayWork::new(key, &[1, 2], Ticks(0)).expect("small frame fits");
        assert_eq!(
            work.copy_frame(&mut [0; 1]),
            Err(RelayWorkRefusal::OutputTooSmall { needed: 2 })
        );
    }

    /// ‼ **DUE-BY-WAITING AND DUE-BY-ABANDONMENT ARE THE SAME NUMBER AND
    /// OPPOSITE ACTIONS**, which is why the distinction is returned rather
    /// than inferred from `slots_remaining`.
    #[test]
    fn a_relay_that_counted_down_transmits_and_one_that_was_abandoned_does_not() {
        let p = PendingRelay {
            origin: 1,
            message_id: 1,
            slots_remaining: 0,
        };
        assert!(
            p.is_due(false),
            "a relay that waited its turn must transmit"
        );
        assert!(!p.is_due(true));
    }

    /// 6e.3 is checkable rather than assumed.
    #[test]
    fn a_slot_shorter_than_one_detection_is_refused_by_the_check() {
        assert!(C.slot_is_long_enough(12_000));
        assert!(C.slot_is_long_enough(5_000));
        assert!(
            !C.slot_is_long_enough(20_000),
            "a slot shorter than the test that fills it cannot separate two transmitters"
        );
    }
    // ── BND3 6e.6: an originated frame does not jump a pending relay ────────

    const RELAY: PendingRelay = PendingRelay {
        origin: 7,
        message_id: 7,
        slots_remaining: 3,
    };

    /// ‼ **THE CLAUSE: A DUE RELAY GOES BEFORE THE HIVE'S OWN FRAME.**
    #[test]
    fn a_due_relay_goes_before_an_originated_frame() {
        let due = PendingRelay {
            slots_remaining: 0,
            ..RELAY
        };
        assert_eq!(
            next_transmission(Some(due), false, true),
            NextOut::Relay,
            "the hive's own frame jumped a relay that was due"
        );
    }

    /// ‼ **AND THE GAP IS NOT FILLED EITHER.** A relay pending but not yet due
    /// leaves a window, and an originated frame sent into it makes the radio
    /// deaf through exactly the interval in which a neighbour's rebroadcast
    /// would have cancelled the relay (6e.5). *Jumping the queue does not save
    /// a transmission; it adds one.*
    #[test]
    fn an_originated_frame_does_not_fill_the_window_before_a_relay() {
        assert_eq!(
            next_transmission(Some(RELAY), false, true),
            NextOut::WaitForRelay { slots_remaining: 3 },
            "the hive transmitted into its own suppression window"
        );
    }

    /// **The positive control**: with nothing pending the hive's own frame
    /// goes, so the rule above is a priority and not a mute.
    #[test]
    fn an_originated_frame_goes_when_no_relay_is_pending() {
        assert_eq!(next_transmission(None, false, true), NextOut::Originated);
        assert_eq!(next_transmission(None, false, false), NextOut::Idle);
    }

    /// ‼ **AN ABANDONED RELAY RELEASES THE CHANNEL**, and this is why
    /// `abandoned` is passed rather than read off `slots_remaining`: a relay
    /// cancelled by 6e.5 sits at zero exactly like one that counted down, and
    /// the two are opposite instructions.
    #[test]
    fn a_relay_abandoned_under_6e5_no_longer_blocks_the_hives_own_frame() {
        let mut p = RELAY;
        assert_eq!(p.on_heard(7, 7), Suppression::Abandoned);
        assert_eq!(p.slots_remaining, 0);
        assert_eq!(
            next_transmission(Some(p), true, true),
            NextOut::Originated,
            "an abandoned relay still held the channel"
        );
        // And without the abandoned flag the same zero reads as due — which is
        // the confusion the separate argument exists to prevent.
        assert_eq!(next_transmission(Some(p), false, true), NextOut::Relay);
    }

    /// **`BND3-063` (`L1-BINDING-LORA.md` 6e.2): where the medium is busy a
    /// bearer waits a *randomly chosen* whole number of slot periods.** The
    /// tests above accept any deferral of at least one slot, so a constant
    /// draw passes them. Two entropies that differ modulo the window must
    /// draw differently, and a sweep of every entropy must reach every slot
    /// count in `1..=max_window_slots` and nothing outside it — for a
    /// power-of-two window, one that is not, and the one-slot degenerate.
    /// Goes red when `decide` stops using `entropy` (e.g. `slots: 1`) or draws
    /// from a window other than the configured one (e.g. `entropy % 16`
    /// hard-coded).
    #[test]
    fn a_busy_channel_s_deferral_is_drawn_from_the_whole_window() {
        fn slots(c: &Contention, entropy: u16) -> u16 {
            match c.decide(Channel::Busy, 0, entropy) {
                Access::Defer { slots } => slots,
                other => panic!("expected a deferral, got {other:?}"),
            }
        }
        assert_ne!(
            slots(&C, 0),
            slots(&C, 1),
            "two entropies differing modulo the window drew the same deferral"
        );

        for window in [C.max_window_slots, 5, 1] {
            let c = Contention {
                max_window_slots: window,
                ..C
            };
            let mut seen = 0u32;
            for entropy in 0..=u16::MAX {
                let s = slots(&c, entropy);
                assert!(
                    (1..=window).contains(&s),
                    "window {window}: entropy {entropy} drew {s} slots"
                );
                seen |= 1 << (s - 1);
            }
            assert_eq!(
                seen,
                (1u32 << window) - 1,
                "window {window}: not every slot count in 1..={window} was drawn"
            );
        }
    }

    /// **`BND3-066` (`L1-BINDING-LORA.md` 6e.4): a relay waits a *randomly
    /// chosen* delay drawn from the quality-narrowed window.** The tests above
    /// pin the floor, the ceiling and the inversion, all of which a draw that
    /// always returns the window's top satisfies. At a fixed quality a sweep
    /// of every entropy must vary, and must reach every slot count from one
    /// up to the window's top: the full `max_window_slots` for a perfectly
    /// heard frame, and for a middling one a top strictly between one and
    /// that. Goes red when `relay_backoff_slots` stops using `entropy` (e.g.
    /// returns `window`).
    #[test]
    fn the_relay_delay_is_drawn_from_every_slot_of_its_window() {
        fn draw(quality: f32) -> (u32, u16) {
            let mut seen = 0u32;
            let mut top = 0u16;
            for entropy in 0..=u16::MAX {
                let s = C.relay_backoff_slots(LinkQuality(quality), entropy);
                assert!(
                    (1..=C.max_window_slots).contains(&s),
                    "{s} at quality {quality}"
                );
                seen |= 1 << (s - 1);
                top = top.max(s);
            }
            (seen, top)
        }

        // Heard perfectly: the widest window, and every slot of it drawn.
        let (seen, top) = draw(1.0);
        assert_eq!(
            top, C.max_window_slots,
            "a perfectly heard frame draws from the full window"
        );
        assert_eq!(
            seen,
            (1u32 << C.max_window_slots) - 1,
            "not every slot count in 1..={} was drawn",
            C.max_window_slots
        );

        // Heard so-so: a narrower window, and still a draw rather than a constant.
        let (seen, top) = draw(0.5);
        assert!(
            top > 1 && top < C.max_window_slots,
            "a middling quality gave a window of {top} slots"
        );
        assert_eq!(
            seen,
            (1u32 << top) - 1,
            "not every slot count in 1..={top} was drawn"
        );
    }

    /// ‼ **`BND3-069` (6e.7): a region's medium-access parameters govern, and
    /// THE DIRECTION IS THE WHOLE ASSERTION.**
    ///
    /// 6e.7 says a region's parameters replace *any less restrictive value
    /// this clause would otherwise permit*. The obvious implementation —
    /// assign the region's `min_sense_us` to `slot_us` — reads as a faithful
    /// transcription of that sentence and is wrong in the direction that
    /// matters: it would **shorten** a slot 6e.3 had already set for the
    /// medium's own sake. So the shorter-region case is asserted first and by
    /// name, because it is the one a correct-looking implementation fails and
    /// **it is the case the only carrier-sense region in this tree actually
    /// presents** — `PORTABLE_STRICT` asks for 5 ms against a bench slot of
    /// 80 ms, so a bearer that took the region's value outright would sense
    /// for a sixteenth of the time it does now and every test that only
    /// checked *the region was consulted* would still pass.
    ///
    /// The threshold half is the absent-versus-zero distinction again: a
    /// region mandating sensing without fixing a level must leave the
    /// bearer's own, never overwrite it with nothing.
    #[test]
    fn a_regions_medium_access_only_ever_ratchets_toward_more_restrictive() {
        let bench = Contention {
            slot_us: 80_000,
            max_window_slots: 8,
            max_deferrals: 8,
            threshold_dbm: Some(-90),
        };

        // 1. A region imposing nothing changes nothing: 6e.1 still obliges
        //    this binding's own detection whatever the law says.
        assert_eq!(
            bench.for_region(MediumAccess::RegionImposesNone),
            bench,
            "6e.1 survives a region that imposes no medium access of its own"
        );

        // 2. ‼ THE CASE THE TREE ACTUALLY HAS. A shorter regional minimum
        //    leaves the slot alone.
        let shorter = bench.for_region(MediumAccess::CarrierSense {
            threshold_dbm: None,
            min_sense_us: 5_000,
        });
        assert_eq!(
            shorter.slot_us, 80_000,
            "‼ 6e.7 REPLACES ONLY A LESS RESTRICTIVE VALUE — a region asking \
             for a SHORTER sense than 6e.3 already requires must not shorten it"
        );
        assert_eq!(
            shorter.threshold_dbm,
            Some(-90),
            "a region that mandates sensing without fixing a level leaves the \
             bearer's own threshold, rather than clearing it to None"
        );

        // 3. A longer regional minimum governs.
        let longer = bench.for_region(MediumAccess::CarrierSense {
            threshold_dbm: Some(-80),
            min_sense_us: 120_000,
        });
        assert_eq!(longer.slot_us, 120_000, "6e.7: the longer sense governs");
        assert_eq!(
            longer.threshold_dbm,
            Some(-80),
            "6e.7: a level the region fixes governs"
        );

        // 4. Nothing else moves. A region decides medium access and says
        //    nothing about the backoff window or the deferral limit.
        for c in [shorter, longer] {
            assert_eq!(c.max_window_slots, bench.max_window_slots);
            assert_eq!(c.max_deferrals, bench.max_deferrals);
        }

        // 5. ‼ THE POPULATION CONTROL, AND IT IS A COMPILE-TIME ONE. Every
        //    profile in the tree is folded, and the exhaustive match means a
        //    fourth `MediumAccess` variant FAILS TO COMPILE here rather than
        //    silently inheriting a catch-all arm.
        for region in [
            crate::lora_region::NZ_915,
            crate::lora_region::US_902,
            crate::lora_region::PORTABLE_STRICT,
        ] {
            let got = bench.for_region(region.access);
            match region.access {
                MediumAccess::RegionImposesNone => assert_eq!(
                    got, bench,
                    "{}: imposes none and must change nothing",
                    region.name
                ),
                MediumAccess::CarrierSense { min_sense_us, .. } => assert!(
                    got.slot_us >= bench.slot_us && got.slot_us >= min_sense_us,
                    "{}: the governing slot is at least both",
                    region.name
                ),
            }
        }
    }

    /// ‼ **`BND3-065` (6e.3): THE SLOT PERIOD SHALL BE AT LEAST THE TIME ONE
    /// CHANNEL-ACTIVITY DETECTION OCCUPIES — AND THE DEPLOYED ONE WAS A THIRD
    /// OF IT.**
    ///
    /// `DEFAULT_CONTENTION.slot_us` was a hand-written `80_000`; at the PHY
    /// both boards run since `d613` — SF12, 125 kHz — one eight-symbol CAD
    /// takes **262 144 µs**. *A slot shorter than the test that fills it cannot
    /// separate two transmitters*, which this module's own header says, and
    /// nothing compared the literal with the three PHY constants it had to
    /// agree with.
    ///
    /// The repair is DERIVATION rather than an assertion: an assertion catches
    /// a wrong number after somebody writes it, and this makes the wrong number
    /// unwritable. So the test asserts the arithmetic, the raise, and that the
    /// slot MOVES WITH THE PHY — a `for_cad` returning a constant would satisfy
    /// the first two.
    #[test]
    fn the_deployed_slot_covers_the_configured_cad_and_follows_the_phy() {
        use crate::lora_airtime::LoraPhy;
        const DEPLOYED: LoraPhy = LoraPhy {
            spreading_factor: 12,
            bandwidth_hz: 125_000,
            coding_rate: 1,
            preamble_symbols: 8,
        };
        // 2^12 / 125 kHz = 32 768 µs a symbol; lora-phy's do_cad runs eight.
        assert_eq!(DEPLOYED.symbol_time_us(), 32_768);
        assert_eq!(Contention::cad_duration_us(&DEPLOYED, 8), 262_144);

        let hand_written = Contention {
            slot_us: 80_000,
            ..C
        };
        assert!(
            !hand_written.slot_is_long_enough(262_144),
            "PRECONDITION: the value this replaced really was too short, or the \
             arm below proves nothing"
        );
        let derived = hand_written.for_cad(&DEPLOYED, 8);
        assert_eq!(derived.slot_us, 262_144);
        assert!(derived.slot_is_long_enough(Contention::cad_duration_us(&DEPLOYED, 8)));

        // ‼ IT FOLLOWS THE PHY. A `for_cad` that returned a constant would pass
        //   every assertion above; halving the symbol time must halve the slot.
        const FASTER: LoraPhy = LoraPhy {
            spreading_factor: 11,
            ..DEPLOYED
        };
        assert_eq!(
            hand_written.for_cad(&FASTER, 8).slot_us,
            131_072,
            "SF11 is half SF12's symbol time, so the slot halves with it"
        );

        // And a deployment that already chose a longer slot keeps it: 6e.3 is a
        // floor, and lowering a slot somebody widened deliberately is not its
        // business.
        let wide = Contention {
            slot_us: 500_000,
            ..C
        };
        assert_eq!(wide.for_cad(&DEPLOYED, 8).slot_us, 500_000);

        // Nothing else moves.
        assert_eq!(derived.max_window_slots, hand_written.max_window_slots);
        assert_eq!(derived.max_deferrals, hand_written.max_deferrals);
        assert_eq!(derived.threshold_dbm, hand_written.threshold_dbm);
    }
}
