//! Random numbers (L0 5.5).

/// Cryptographically secure random number generator.
///
/// Implementing this trait is the platform's declaration that L0 5.5.1 is
/// satisfied. A generator seeded only from a build-time constant, the device
/// identity, or monotonic time does not satisfy it and must not implement
/// this trait; such a platform does not generate key material (L0 5.5.2).
pub trait Rng {
    /// Fill `buf` with cryptographically secure random bytes.
    fn fill(&mut self, buf: &mut [u8]);
}
