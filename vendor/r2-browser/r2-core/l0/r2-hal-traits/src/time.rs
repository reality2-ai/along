//! Monotonic time (L0 5.2).
//!
//! A tick count is a local ruler, never wall-clock time, and never comparable
//! with another platform's (L0 5.2.3). No interval spanning a power cycle is
//! measurable (L0 5.2, boxed rule): a `Ticks` value from before a power cycle
//! must not be compared with one from after.

/// Opaque monotonic tick count. Meaning is defined by the [`Ruler`] that
/// produced it; two values are comparable only within one ruler's epoch
/// (one power-on session).
///
/// # A tick count is not wall-clock time (L0 5.2.3, `L0-012`)
///
/// *A platform shall not present its monotonic time source as wall-clock
/// time.* There is no conversion from a `Ticks` to an epoch, a date or a
/// time of day, and the absence is asserted by the compiler rather than by
/// a reader: the fragment below is well-formed Rust that fails ONLY because
/// `unix_seconds` does not exist (E0599, no such method). The day such a
/// conversion is added to this type — the mutation that reddens this
/// doctest is exactly `pub const fn unix_seconds(self) -> u64` on `Ticks` —
/// the fragment compiles and the doctest fails.
///
/// ```compile_fail,E0599
/// use r2_hal_traits::time::Ticks;
/// let _secs_since_epoch: u64 = Ticks(1).unix_seconds();
/// ```
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub struct Ticks(pub u64);

impl Ticks {
    /// Ticks elapsed since `earlier`. Returns `None` where `earlier` is later
    /// than `self` — which, with a conforming monotonic source, means the
    /// values are from different epochs and must not be compared.
    #[must_use]
    pub const fn since(self, earlier: Ticks) -> Option<u64> {
        self.0.checked_sub(earlier.0)
    }

    /// Whether more than `seconds` have passed since `earlier`.
    ///
    /// ‼ **ONE IMPLEMENTATION, BECAUSE TWO WOULD DIVERGE.** Several clauses
    /// across two layers ask this same question of different subjects — L1
    /// 10.2's *unreachable after a period of silence*, L2 6.3.1's *treated as
    /// receding*, L3 7.4.2's retained-frame lifetime — and each was a
    /// candidate for its own copy of the arithmetic. *The workspace has
    /// already paid once for two implementations of one rule where the
    /// shorter was the one that ran* (`D-197`), and elapsed-time comparison
    /// is exactly the shape that invites it: three lines, obvious, and wrong
    /// in the same two ways every time.
    ///
    /// ‼ **A CLOCK THAT WENT BACKWARDS IS NOT AN ELAPSED PERIOD.** `since`
    /// answers `None` where `now` precedes `earlier`, and this answers
    /// **false** — *the event happened, and the only thing in doubt is the
    /// clock.* L0 5.2.1 asks for a monotonic source and does not make a
    /// non-monotonic one impossible, and every caller of this would otherwise
    /// discard something live on the strength of a time source misbehaving.
    ///
    /// **Strictly greater**, so a subject exactly at its period has not yet
    /// exceeded it.
    #[must_use]
    pub const fn exceeded(self, earlier: Ticks, seconds: u32, ticks_per_second: u32) -> bool {
        let Some(elapsed) = self.since(earlier) else {
            return false;
        };
        let tps = if ticks_per_second == 0 {
            1
        } else {
            ticks_per_second
        };
        elapsed > (seconds as u64).saturating_mul(tps as u64)
    }

    /// `seconds` have elapsed since `earlier` — the boundary INCLUDED. `exceeded`
    /// is strict and right for a fade (a peer is not gone at the fade, only past
    /// it); an obligation phrased *at intervals not exceeding a stated maximum*
    /// (BLE 4.3) is due the moment the maximum is reached, and `exceeded` there
    /// realises max plus one tick, which exceeds it (`BND2-017`, 2026-09-03).
    #[must_use]
    pub const fn reached(self, earlier: Ticks, seconds: u32, ticks_per_second: u32) -> bool {
        let Some(elapsed) = self.since(earlier) else {
            return false;
        };
        let tps = if ticks_per_second == 0 {
            1
        } else {
            ticks_per_second
        };
        elapsed >= (seconds as u64).saturating_mul(tps as u64)
    }
}

/// The platform's monotonic time source (L0 5.2.1-5.2.3): resolution one
/// second or finer, readable without network access, not wall-clock time.
pub trait Ruler {
    /// Current tick count. Never decreases within one power-on session.
    fn now(&self) -> Ticks;

    /// Ticks per second — at least 1 (L0 5.2.1). Constant for the life of
    /// the ruler.
    fn ticks_per_second(&self) -> u32;
}
