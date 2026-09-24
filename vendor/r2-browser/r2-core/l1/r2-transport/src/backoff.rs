//! Contention backoff — the generator, and the seed that cannot be zero.
//!
//! ‼‼ **THIS LIVES HERE BECAUSE THE DEFECT IT CARRIES WAS UNTESTABLE WHERE IT
//! WAS.** The generator sat in `hive-esp32-dfr1195`, an xtensa binary whose
//! `cargo test` does not build for the host — so, in that crate's own words
//! about `rtc`, `bme280`, `gnss` and `capacity_walk`, *a `#[cfg(test)]` block in
//! an xtensa binary is assertions that never execute.* **A generator whose only
//! obligation is to differ between hives had no executable test that it did.**
//! Same split, same reason: the logic is here and the radio stays there.
//!
//! # ‼ WHAT `SS428` ACTUALLY WAS, BECAUSE THE SHAPE MATTERS MORE THAN THE BUG
//!
//! The bearer took a `u32` seed and **substituted a fixed constant when it was
//! zero** — directly beneath a comment reading *this value's only job is to
//! differ between hives.* **A shared constant is the one value that cannot
//! differ.** Every hive whose entropy source refused took the same state,
//! therefore the same deferral slot, on every common deferral — the exact
//! collision `BND3` 6e.2's randomly-chosen slot exists to prevent, and one that
//! *worsens* with contention rather than easing.
//!
//! ‼ **AND ZERO WAS BOTH THE SENTINEL AND A VALID DRAW.** A hive whose source
//! succeeded and returned four zero bytes was indistinguishable from one that
//! refused. One in 2^32 is small; it is also **silent**, and it meant the
//! sentinel could not be trusted to mean what it said.
//!
//! ‼ **THE ROW WAS CLOSED ON A `println`.** The warning was real, it named
//! `SS428`, it said *NOT silent* — and **a warning is not a control**: nothing
//! refused, nothing failed, the bearer was built and it transmitted. *A measured
//! hazard left as a printed sentence is a receipt, not a fix.*
//!
//! # The two properties, and only one of them is about randomness
//!
//! 1. **A seed of zero is unrepresentable**, not checked. `NonZeroU32` carries
//!    it, so there is no branch to get wrong and no constant to substitute.
//! 2. **Distinct seeds produce distinct sequences.** That is the whole job, and
//!    the test below is the one nobody could write before.
//!
//! *An all-zero xorshift state is a fixed point — it yields zero for ever — so
//! the type is not fastidiousness. It is the difference between a backoff and a
//! constant.*

/// An xorshift32 contention-backoff generator.
///
/// ‼ **ADVANCES ON EVERY DRAW, INCLUDING THE ONES THAT FIND THE CHANNEL IDLE.**
/// *Drawing only on a deferral would make the sequence a function of how many
/// collisions had happened* — which is the same number on both sides of a
/// collision, so two hives colliding would step in lockstep. **That is the
/// defect wearing a different hat**, and it is why `next` is called on the
/// clear path too.
#[derive(Debug, Clone)]
pub struct Backoff {
    state: u32,
}

impl Backoff {
    /// Seed the generator. **Zero cannot be passed**, which is the fix.
    pub const fn new(seed: core::num::NonZeroU32) -> Self {
        Self { state: seed.get() }
    }

    /// One draw. Advances the state and returns the high half.
    pub fn next_u16(&mut self) -> u16 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        (x >> 16) as u16
    }

    /// The state, for a caller that must carry it across a rebuild.
    pub const fn state(&self) -> u32 {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::num::NonZeroU32;

    fn nz(v: u32) -> NonZeroU32 {
        NonZeroU32::new(v).expect("test seed is non-zero by construction")
    }

    /// ‼ A FIXED-SIZE ARRAY RATHER THAN A `Vec`. This crate is `no_std` with no
    /// allocator, and pulling `alloc` in for a test would make the test
    /// environment differ from the one the code ships into — which is how a
    /// test comes to pass on something the target cannot run.
    fn draws<const N: usize>(seed: u32) -> [u16; N] {
        let mut b = Backoff::new(nz(seed));
        let mut out = [0u16; N];
        for slot in out.iter_mut() {
            *slot = b.next_u16();
        }
        out
    }

    /// ‼‼ **THE NEGATIVE CONTROL `SS428` WAS CLOSED WITHOUT.**
    ///
    /// This is the assertion that had no home: **two hives seeded alike defer
    /// alike, for ever.** It is written as the FAILING case on purpose — it
    /// states the hazard rather than the happy path, so that a future change
    /// which reintroduces a shared constant makes THIS test the one that
    /// explains why the boards stopped talking.
    ///
    /// *The old code substituted `0x9E37_79B9` for every refusing hive. Under
    /// that behaviour this identity held across the whole fleet, which is what
    /// the deferral slot exists to prevent.*
    #[test]
    fn identical_seeds_collide_on_every_draw() {
        assert_eq!(
            draws::<64>(0x9E37_79B9),
            draws::<64>(0x9E37_79B9),
            "two generators on one seed must be identical — this is the HAZARD, \
             and it is asserted so the fix has something to be measured against"
        );
    }

    /// **AND THE POSITIVE HALF: DISTINCT SEEDS MUST DIVERGE.**
    ///
    /// A generator that returned the same sequence regardless of seed would
    /// pass the test above and be useless, so the pair is what carries the
    /// claim — neither assertion means anything alone.
    #[test]
    fn distinct_seeds_diverge_immediately() {
        let a = draws::<32>(1);
        let b = draws::<32>(2);
        assert_ne!(a, b, "distinct seeds must produce distinct sequences");
        assert_ne!(
            a[0], b[0],
            "and they must differ from the FIRST draw — a \
                   generator that converges after n draws collides for those n"
        );
    }

    /// **NO SEED IS A FIXED POINT, AND ZERO IS THE ONE THAT WOULD HAVE BEEN.**
    ///
    /// An all-zero xorshift state yields zero for ever. `NonZeroU32` makes that
    /// unconstructible, and this walks a spread of real seeds to show none of
    /// the representable ones degenerates either.
    #[test]
    fn no_representable_seed_degenerates_to_a_constant() {
        for seed in [1u32, 2, 3, 0x9E37_79B9, u32::MAX, 0x0001_0000, 0xFFFF_0000] {
            let mut b = Backoff::new(nz(seed));
            let first = b.next_u16();
            let mut varied = false;
            for _ in 0..64 {
                if b.next_u16() != first {
                    varied = true;
                    break;
                }
            }
            assert!(
                varied,
                "seed {seed:#x} produced a constant sequence — that is a \
                             fixed point, and a fixed backoff is not a backoff"
            );
        }
    }

    /// **THE SENTINEL COLLISION, AS A TYPE FACT.**
    ///
    /// `0` was both *the entropy source refused* and *the source returned four
    /// zero bytes*. The refusal signal is out of band now — the caller passes
    /// `Option` and builds no bearer on `None` — and this records that zero
    /// cannot re-enter through the seed.
    #[test]
    fn zero_is_not_a_representable_seed() {
        assert!(
            NonZeroU32::new(0).is_none(),
            "zero must remain unrepresentable as a seed; the caller signals \
             refusal with None, never with an in-band value"
        );
    }
}
