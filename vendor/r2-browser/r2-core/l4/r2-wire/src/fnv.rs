//! FNV-1a 32-bit hash (L4 7.1.1).

/// Offset basis (L4 7.1.1).
pub const OFFSET_BASIS: u32 = 0x811C_9DC5;
/// Prime (L4 7.1.1).
pub const PRIME: u32 = 0x0100_0193;

/// Incremental FNV-1a 32-bit hasher.
#[derive(Clone, Copy, Debug)]
pub struct Fnv1a32(u32);

impl Fnv1a32 {
    #[must_use]
    pub const fn new() -> Self {
        Self(OFFSET_BASIS)
    }

    /// `const` so consumers can build compile-time event-hash tables
    /// (requested by the composer lane, 2026-08-01).
    pub const fn update(&mut self, bytes: &[u8]) {
        let mut h = self.0;
        let mut i = 0;
        while i < bytes.len() {
            h ^= bytes[i] as u32;
            h = h.wrapping_mul(PRIME);
            i += 1;
        }
        self.0 = h;
    }

    #[must_use]
    pub const fn finish(self) -> u32 {
        self.0
    }
}

impl Default for Fnv1a32 {
    fn default() -> Self {
        Self::new()
    }
}

/// One-shot FNV-1a 32 over `bytes`.
///
/// `const`, so an event-hash table can be built at compile time rather
/// than stamped at run time — a self-stamp is a constant on an embedded
/// target, not a startup cost.
#[must_use]
pub const fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h = Fnv1a32::new();
    h.update(bytes);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vectors() {
        assert_eq!(fnv1a32(b""), 0x811C_9DC5);
        assert_eq!(fnv1a32(b"a"), 0xE40C_292C);
        assert_eq!(fnv1a32(b"foobar"), 0xBF9C_F968);
    }

    /// 01-terminology 4.2: **the same procedure applied to a case the
    /// requirement excludes.** 7.1.1 names FNV-1**a** with a specific
    /// offset basis and prime, and the three vectors above demonstrate
    /// only that our answer is right — *they say nothing about what the
    /// clause rules out.* The two nearest wrong implementations are
    /// built here and required to disagree.
    ///
    /// **Both are wrong in a way that keeps the vectors' shape**: FNV-1
    /// differs from FNV-1a only in the ORDER of the multiply and the
    /// xor, and a mistaken basis differs only in a constant. Neither is
    /// caught by an equality against a known-good value alone — that is
    /// what makes them the excluded cases worth writing rather than
    /// decoration.
    #[test]
    fn the_order_and_the_basis_are_both_load_bearing() {
        // FNV-1: multiply THEN xor. Same prime, same basis.
        fn fnv1_not_1a(bytes: &[u8]) -> u32 {
            let mut h = OFFSET_BASIS;
            for &b in bytes {
                h = h.wrapping_mul(PRIME);
                h ^= u32::from(b);
            }
            h
        }
        // FNV-1a with the basis a careless reading might use.
        fn wrong_basis(bytes: &[u8]) -> u32 {
            let mut h = 0u32;
            for &b in bytes {
                h ^= u32::from(b);
                h = h.wrapping_mul(PRIME);
            }
            h
        }
        // **Non-empty only, and the empty case is handled separately
        // rather than dropped.** The first version of this test looped
        // over the empty input too and FAILED: with no bytes to mix,
        // every variant returns its own basis untouched, so FNV-1 and
        // FNV-1a agree exactly. *An input that cannot distinguish the
        // right answer from the wrong one is not a control* — the same
        // precondition failure this lane keeps meeting in its probes,
        // arriving here in a unit test.
        for input in [b"a".as_slice(), b"foobar", b"temperature"] {
            assert_ne!(fnv1a32(input), fnv1_not_1a(input), "FNV-1 order accepted");
            assert_ne!(fnv1a32(input), wrong_basis(input), "zero basis accepted");
        }
        // The empty input, where the two variants CAN be separated: the
        // hash is the basis itself, so the basis is the whole claim.
        assert_eq!(fnv1a32(b""), OFFSET_BASIS);
        assert_eq!(wrong_basis(b""), 0);
        assert_eq!(fnv1_not_1a(b""), OFFSET_BASIS); // order is invisible here
    }

    #[test]
    fn usable_in_const_context() {
        // Compile-time event-hash table (composer/hive use case).
        const HEARTBEAT: u32 = fnv1a32(b"r2.hb.health");
        const TEMPERATURE: u32 = fnv1a32(b"temperature");
        assert_eq!(HEARTBEAT, 0x3C23_00C9); // composer's verified value
        assert_eq!(TEMPERATURE, 0xE9F2_A935); // TEST-VECTORS-L4 N1
    }
}
