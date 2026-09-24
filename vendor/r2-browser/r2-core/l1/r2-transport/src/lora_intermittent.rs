//! Intermittent direct-LoRa rendezvous (BND3 2a.4).
//!
//! This module is the portable half of an intermittently receptive direct
//! LoRa deployment.  It deliberately has no fixed listen-then-transmit phase:
//! every next listen window and every pending frame's transmission opportunity
//! are drawn from entropy local to this hive.  A board owns the timer, radio
//! power and sleep operation; it uses the returned deadlines to drive them.
//!
//! [`RendezvousPlan`](crate::lora_intermittent::RendezvousPlan) is the local policy that realises the direct-LoRa
//! rendezvous contract. L2 5.4b already puts a *coarse* duty class and maximum
//! gap on air so peers can hold a frame; that deliberately does not expose the
//! exact per-bearer receive window or randomized opportunity ranges a composer
//! must inspect. `SS533` tracks the missing Layer 1 profile representation.
//!
//! `RetainedWork` owns complete L1 frames while the radio is unreceptive.  It
//! is deliberately bounded and FIFO: a low-power profile may defer work, not
//! turn its memory into an unbounded packet log.  A deep-sleep board that must
//! retain frames across reset needs a durable L0 backend in addition; this
//! in-RAM queue is not presented as such a backend.

use r2_hal_traits::{Rng, Ticks};

use crate::{l1::IntermittentReceptivity, lora::FRAME_MTU};

/// The stated timing behaviour of one intermittent direct-LoRa deployment.
///
/// `listen_delay_*` is measured from the end of one listening window to the
/// beginning of the next. `transmit_delay_*` is measured from the point the
/// serial owner is allowed to offer a retained frame. Both ranges are open
/// rather than fixed, so identical firmware images do not create a common
/// phase merely by booting together.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RendezvousPlan {
    contract: IntermittentReceptivity,
    /// How long the radio remains receptive in one window.
    listen_window_ticks: u64,
    /// Smallest locally-randomized delay before the next receive window.
    listen_delay_min_ticks: u64,
    /// Largest locally-randomized delay before the next receive window.
    listen_delay_max_ticks: u64,
    /// Smallest locally-randomized delay before a retained frame may contend.
    transmit_delay_min_ticks: u64,
    /// Largest locally-randomized delay before a retained frame may contend.
    transmit_delay_max_ticks: u64,
}

/// Why a rendezvous behaviour cannot satisfy BND3 2a.4.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PlanRefusal {
    /// A fixed delay would recreate the common phase BND3 2a.4 forbids.
    FixedListenDelay,
    /// A fixed transmit delay would recreate the common phase BND3 2a.4
    /// forbids.
    FixedTransmitDelay,
    /// An L0 time source which reports no ticks per second cannot turn the
    /// medium-neutral B9 milliseconds into deadlines.
    NoTicksPerSecond,
}

impl RendezvousPlan {
    /// Bind the direct-LoRa scheduler to its declared B9 contract.
    ///
    /// The public profile uses milliseconds so it is readable without a board
    /// clock. This constructor is the only conversion to local L0 ticks. It
    /// refuses a profile whose different millisecond values collapse to one
    /// tick: driving that schedule would silently make the random range fixed.
    pub fn new(
        contract: IntermittentReceptivity,
        ticks_per_second: u32,
    ) -> Result<Self, PlanRefusal> {
        if ticks_per_second == 0 {
            return Err(PlanRefusal::NoTicksPerSecond);
        }
        let listen_window_ticks = ms_to_ticks(contract.receptive_window_ms(), ticks_per_second);
        let (listen_delay_min_ms, listen_delay_max_ms) = contract.next_window_delay_ms();
        let listen_delay_min_ticks = ms_to_ticks(listen_delay_min_ms, ticks_per_second);
        let listen_delay_max_ticks = ms_to_ticks(listen_delay_max_ms, ticks_per_second);
        if listen_delay_min_ticks == listen_delay_max_ticks {
            return Err(PlanRefusal::FixedListenDelay);
        }
        let (transmit_delay_min_ms, transmit_delay_max_ms) = contract.transmit_delay_ms();
        let transmit_delay_min_ticks = ms_to_ticks(transmit_delay_min_ms, ticks_per_second);
        let transmit_delay_max_ticks = ms_to_ticks(transmit_delay_max_ms, ticks_per_second);
        if transmit_delay_min_ticks == transmit_delay_max_ticks {
            return Err(PlanRefusal::FixedTransmitDelay);
        }
        Ok(Self {
            contract,
            listen_window_ticks,
            listen_delay_min_ticks,
            listen_delay_max_ticks,
            transmit_delay_min_ticks,
            transmit_delay_max_ticks,
        })
    }

    /// The exact medium-hidden B9 fact this scheduler is carrying out.
    pub const fn contract(self) -> IntermittentReceptivity {
        self.contract
    }

    /// The stated receive-window width.
    pub const fn listen_window_ticks(self) -> u64 {
        self.listen_window_ticks
    }

    /// The stated inclusive delay range before the next receive window.
    pub const fn listen_delay_ticks(self) -> (u64, u64) {
        (self.listen_delay_min_ticks, self.listen_delay_max_ticks)
    }

    /// The stated inclusive delay range before a retained frame contends.
    pub const fn transmit_delay_ticks(self) -> (u64, u64) {
        (self.transmit_delay_min_ticks, self.transmit_delay_max_ticks)
    }

    /// Draw the next receive window after `after` from local L0 entropy.
    ///
    /// This is intentionally not a cadence calculated from boot time.  A
    /// common period can still converge after restart; a fresh local draw on
    /// every window makes no hive's phase authoritative for another's.
    pub fn next_listen_window<R: Rng>(self, after: Ticks, rng: &mut R) -> ListenWindow {
        let delay = sample_inclusive(
            rng,
            self.listen_delay_min_ticks,
            self.listen_delay_max_ticks,
        );
        let opens_at = Ticks(after.0.saturating_add(delay));
        ListenWindow {
            opens_at,
            closes_at: Ticks(opens_at.0.saturating_add(self.listen_window_ticks)),
        }
    }

    /// Draw the next opportunity for one retained frame to enter normal
    /// carrier-sense contention.
    ///
    /// A new value is drawn on every call, including when a previous attempt
    /// was refused.  This is a *rendezvous* delay, not a replacement for the
    /// per-attempt medium-access backoff in `lora_media_access`.
    pub fn next_transmit_opportunity<R: Rng>(self, after: Ticks, rng: &mut R) -> Ticks {
        let delay = sample_inclusive(
            rng,
            self.transmit_delay_min_ticks,
            self.transmit_delay_max_ticks,
        );
        Ticks(after.0.saturating_add(delay))
    }
}

fn ms_to_ticks(milliseconds: u32, ticks_per_second: u32) -> u64 {
    // Round up: a platform must not close a declared receptive window early
    // merely because its local clock is coarser than one millisecond.
    (u64::from(milliseconds) * u64::from(ticks_per_second)).saturating_add(999) / 1_000
}

/// One locally scheduled period in which the radio is receptive.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ListenWindow {
    /// The radio is placed in receive at this tick.
    pub opens_at: Ticks,
    /// The radio may stop receiving at this tick, unless it is completing an
    /// arrival already in progress.
    pub closes_at: Ticks,
}

/// Why an L1 frame could not be retained for an intermittent opportunity.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WorkRefusal {
    /// The L1 frame exceeds direct LoRa's fixed B2 payload bound.
    Oversize { len: usize },
    /// The bounded queue has no free slot. Existing work remains intact.
    Full,
    /// The caller cannot receive a whole retained frame. The frame remains
    /// queued; a prefix is never treated as a frame.
    OutputTooSmall { needed: usize },
}

#[derive(Clone, Copy)]
struct Work {
    bytes: [u8; FRAME_MTU],
    len: usize,
}

/// Bounded FIFO work held while an intermittent LoRa radio is unreceptive.
///
/// `N` is selected by the board assembly, so a small sensor image does not
/// inherit a repeater's RAM commitment.  The type stores L1 frames unchanged:
/// it does not parse, retag, route, or otherwise interpret their contents.
pub struct RetainedWork<const N: usize> {
    entries: [Option<Work>; N],
    head: usize,
    len: usize,
}

impl<const N: usize> Default for RetainedWork<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> RetainedWork<N> {
    /// An empty bounded queue.
    pub const fn new() -> Self {
        Self {
            entries: [None; N],
            head: 0,
            len: 0,
        }
    }

    /// Number of complete frames still held.
    pub const fn len(&self) -> usize {
        self.len
    }

    /// Whether there is no retained work.
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// Hold one complete L1 frame without changing it.
    ///
    /// A full queue refuses the new frame rather than overwriting earlier
    /// work.  Replacement needs an L3 lifetime/eviction decision; L1 cannot
    /// honestly invent one just because the radio is asleep.
    pub fn retain(&mut self, frame: &[u8]) -> Result<(), WorkRefusal> {
        if frame.len() > FRAME_MTU {
            return Err(WorkRefusal::Oversize { len: frame.len() });
        }
        if self.len == N {
            return Err(WorkRefusal::Full);
        }
        // `len < N` proves `N != 0`, so this modulo is reachable only for a
        // real ring buffer.
        let at = (self.head + self.len) % N;
        let mut bytes = [0; FRAME_MTU];
        bytes[..frame.len()].copy_from_slice(frame);
        self.entries[at] = Some(Work {
            bytes,
            len: frame.len(),
        });
        self.len += 1;
        Ok(())
    }

    /// Copy the oldest complete frame for a newly-drawn transmit opportunity
    /// without consuming it.
    ///
    /// The caller starts ordinary CAD/deferral only after this returns a
    /// frame. It MUST call [`Self::acknowledge_oldest`] only after L1 accepts
    /// the frame. A busy channel or radio refusal therefore preserves the
    /// work for a newly randomized later opportunity. A refusal to fit it in
    /// `out` also leaves the queue unchanged.
    pub fn copy_oldest(&self, out: &mut [u8]) -> Result<Option<usize>, WorkRefusal> {
        if self.len == 0 {
            return Ok(None);
        }
        let work = self.entries[self.head].expect("occupied head follows nonzero length");
        if out.len() < work.len {
            return Err(WorkRefusal::OutputTooSmall { needed: work.len });
        }
        out[..work.len].copy_from_slice(&work.bytes[..work.len]);
        Ok(Some(work.len))
    }

    /// Consume the oldest frame after the L1 bearer accepted the copied frame.
    ///
    /// Returns `false` when there was no outstanding frame to acknowledge.
    /// This separate acknowledgement deliberately makes a CAD-busy or
    /// transmit-refused attempt non-destructive.
    pub fn acknowledge_oldest(&mut self) -> bool {
        if self.len == 0 {
            return false;
        }
        self.entries[self.head] = None;
        self.head = (self.head + 1) % N;
        self.len -= 1;
        true
    }
}

fn sample_inclusive<R: Rng>(rng: &mut R, min: u64, max: u64) -> u64 {
    debug_assert!(min < max, "RendezvousPlan::check rejects fixed ranges");
    let mut bytes = [0; 8];
    rng.fill(&mut bytes);
    let drawn = u64::from_be_bytes(bytes);
    let span = max - min;
    // The one inclusive range that has 2^64 members cannot have its width
    // represented in u64. It is still a valid random range: the raw draw is
    // already exactly a member of it.
    if span == u64::MAX {
        return drawn;
    }
    let width = span + 1;
    // Map the full 64-bit entropy space into the requested inclusive range
    // without modulo bias. `u128` keeps the product exact.
    let offset = ((u128::from(drawn) * u128::from(width)) >> 64) as u64;
    min.saturating_add(offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::l1::RendezvousBasis;

    struct Entropy {
        words: [u64; 4],
        at: usize,
    }

    impl Rng for Entropy {
        fn fill(&mut self, out: &mut [u8]) {
            let bytes = self.words[self.at].to_be_bytes();
            self.at += 1;
            out.copy_from_slice(&bytes[..out.len()]);
        }
    }

    fn plan() -> RendezvousPlan {
        let contract = IntermittentReceptivity::new(10, 20, 30, 5, 15, RendezvousBasis::Autonomous)
            .expect("fixture is a usable B9 contract");
        RendezvousPlan::new(contract, 1_000).expect("fixture remains randomized in local ticks")
    }

    #[test]
    fn fixed_phases_are_refused_before_a_board_can_drive_them() {
        let fixed_listen =
            IntermittentReceptivity::new(10, 20, 20, 5, 15, RendezvousBasis::Autonomous)
                .expect("B9 permits another binding's fixed schedule");
        assert_eq!(
            RendezvousPlan::new(fixed_listen, 1_000),
            Err(PlanRefusal::FixedListenDelay)
        );
        let fixed_transmit =
            IntermittentReceptivity::new(10, 20, 30, 5, 5, RendezvousBasis::Autonomous)
                .expect("B9 permits another binding's fixed schedule");
        assert_eq!(
            RendezvousPlan::new(fixed_transmit, 1_000),
            Err(PlanRefusal::FixedTransmitDelay)
        );
    }

    #[test]
    fn a_coarse_l0_clock_cannot_collapse_a_declared_random_range() {
        let contract = IntermittentReceptivity::new(1_000, 1, 2, 1, 2, RendezvousBasis::Autonomous)
            .expect("the millisecond contract is open");
        assert_eq!(
            RendezvousPlan::new(contract, 1),
            Err(PlanRefusal::FixedListenDelay),
            "one tick per second maps both next-window values to one tick"
        );
    }

    #[test]
    fn every_listen_and_transmit_opportunity_draws_local_entropy() {
        let plan = plan();
        let mut entropy = Entropy {
            words: [0, u64::MAX, 0, u64::MAX],
            at: 0,
        };
        let first = plan.next_listen_window(Ticks(100), &mut entropy);
        let second = plan.next_listen_window(first.closes_at, &mut entropy);
        assert_eq!(first.opens_at, Ticks(120));
        assert_eq!(first.closes_at, Ticks(130));
        assert_eq!(second.opens_at, Ticks(160));
        assert_eq!(
            plan.next_transmit_opportunity(Ticks(200), &mut entropy),
            Ticks(205),
            "the first retained frame receives its own local opportunity"
        );
        assert_eq!(
            plan.next_transmit_opportunity(Ticks(200), &mut entropy),
            Ticks(215),
            "a later frame does not reuse the prior frame's phase"
        );
        assert_eq!(entropy.at, 4, "each opportunity consumed a distinct draw");
    }

    #[test]
    fn retained_work_is_fifo_and_only_l1_acceptance_consumes_it() {
        let mut work = RetainedWork::<2>::new();
        work.retain(b"first").expect("holds while unreceptive");
        work.retain(b"second").expect("holds while unreceptive");
        assert_eq!(work.retain(b"third"), Err(WorkRefusal::Full));

        let mut short = [0; 4];
        assert_eq!(
            work.copy_oldest(&mut short),
            Err(WorkRefusal::OutputTooSmall { needed: 5 })
        );
        assert_eq!(work.len(), 2, "a prefix was not misrepresented as a frame");

        let mut out = [0; FRAME_MTU];
        let len = work.copy_oldest(&mut out).unwrap().unwrap();
        assert_eq!(&out[..len], b"first");
        assert_eq!(work.len(), 2, "a CAD-busy attempt did not lose the frame");

        assert!(
            work.acknowledge_oldest(),
            "L1 acceptance consumes the copied frame"
        );
        let len = work.copy_oldest(&mut out).unwrap().unwrap();
        assert_eq!(&out[..len], b"second");
        assert!(work.acknowledge_oldest());
        assert_eq!(work.copy_oldest(&mut out).unwrap(), None);
        assert!(!work.acknowledge_oldest());
    }

    #[test]
    fn a_zero_capacity_assembly_refuses_work_without_dividing_by_zero() {
        let mut work = RetainedWork::<0>::new();
        assert_eq!(work.retain(b"frame"), Err(WorkRefusal::Full));
        assert!(work.is_empty());
    }
}
