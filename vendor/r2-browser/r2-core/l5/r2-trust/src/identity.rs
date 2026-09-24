//! Identity material and its wire derivations (FORMATS.md Clause 3,
//! settling STD-SS23/STD-SS26 — every value below is `PROVISIONAL(STD-SS23)`).

use crate::crypto::{Digest, DIGEST_LEN, IDENTITY_LEN};

/// An identity: the 32-byte Ed25519 public key of a member, a hive, or a
/// group (FORMATS 3.1). Identity material is generated from the platform
/// CSPRNG at first provisioning and never from a name, serial number or
/// operator-supplied string (FORMATS 3.2, L4 7.1.4) — this type therefore
/// offers no constructor from text.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Identity(pub [u8; IDENTITY_LEN]);

/// Reserved wire values that a derived half may never take (L4 6.1.4 and
/// 7.1.3).
const RESERVED: [u32; 2] = [0x0000_0000, 0xFFFF_FFFF];

/// Derive a 4-byte wire half from an identity: bytes 0-3 of SHA-256 of the
/// public key, big-endian (FORMATS 3.3). Where the result is reserved, the
/// derivation repeats with `0x01` appended to the hashed input, iterating
/// until a non-reserved value results (FORMATS 3.5).
///
/// Termination: each iteration hashes a distinct input, so the probability
/// of `n` consecutive reserved results falls as 2^-31n; the loop is bounded
/// defensively and the bound is unreachable in practice.
pub fn derive_half<D: Digest>(identity: &Identity) -> u32 {
    let mut input = [0u8; IDENTITY_LEN + MAX_SUFFIX];
    input[..IDENTITY_LEN].copy_from_slice(&identity.0);
    let mut suffix = 0usize;
    loop {
        let mut digest = [0u8; DIGEST_LEN];
        D::hash(&input[..IDENTITY_LEN + suffix], &mut digest);
        let half = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]);
        if !RESERVED.contains(&half) {
            return half;
        }
        if suffix == MAX_SUFFIX {
            // Unreachable for any real hash; returning the last value would
            // be worse than a defined fallback that is never reserved.
            return 1;
        }
        input[IDENTITY_LEN + suffix] = 0x01;
        suffix += 1;
    }
}

/// Defensive bound on the FORMATS 3.5 iteration.
const MAX_SUFFIX: usize = 8;

/// A hive's wire identity at both tiers (L4 6.1.3, FORMATS 3.3/3.4).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct WireIdentity {
    /// Derived from the hive's identity public key.
    pub hive_half: u32,
    /// Derived from the group's identity public key.
    pub group_half: u32,
}

impl WireIdentity {
    /// Derive both halves (FORMATS 3.3).
    pub fn derive<D: Digest>(hive: &Identity, group: &Identity) -> Self {
        Self {
            hive_half: derive_half::<D>(hive),
            group_half: derive_half::<D>(group),
        }
    }

    /// The extended wire form: group half then hive half (L4 6.1.3).
    pub fn extended(&self) -> [u8; 8] {
        let mut out = [0u8; 8];
        out[..4].copy_from_slice(&self.group_half.to_be_bytes());
        out[4..].copy_from_slice(&self.hive_half.to_be_bytes());
        out
    }

    /// The compact wire form: the hive half alone (FORMATS 3.4) — the
    /// 4-byte projection r2-core adopted provisionally (D-007, endorsed by
    /// standard D-013).
    pub fn compact(&self) -> u32 {
        self.hive_half
    }
}

/// Uniqueness of a derived half is **not** guaranteed and shall not be
/// assumed (FORMATS 3.6): collisions are survived exactly as L4 7.2
/// survives all hash collisions. What is unique with overwhelming
/// probability is the [`Identity`] itself, and every consequential act
/// verifies against that above the trust boundary.
pub const COLLISION_POSTURE: () = ();

#[cfg(test)]
mod tests {
    use super::*;

    /// SHA-256 via the host dev-dependency; a target supplies its own.
    struct Sha256Digest;

    impl Digest for Sha256Digest {
        fn hash(input: &[u8], out: &mut [u8; DIGEST_LEN]) {
            use sha2::{Digest as _, Sha256};
            let mut h = Sha256::new();
            h.update(input);
            out.copy_from_slice(&h.finalize());
        }
    }

    /// A digest that always yields a reserved half, forcing the FORMATS 3.5
    /// retry path — unless the input carries the appended 0x01.
    struct ReservedOnceDigest;

    impl Digest for ReservedOnceDigest {
        fn hash(input: &[u8], out: &mut [u8; DIGEST_LEN]) {
            {
                use zeroize::Zeroize as _;
                out.zeroize();
            }
            if input.len() == IDENTITY_LEN {
                // First attempt: all-zero digest → reserved 0x00000000.
                return;
            }
            out[3] = 7; // second attempt yields a usable half
        }
    }

    #[test]
    fn derivation_is_sha256_prefix_big_endian() {
        let id = Identity([0xAB; IDENTITY_LEN]);
        let mut expected = [0u8; DIGEST_LEN];
        Sha256Digest::hash(&id.0, &mut expected);
        let want = u32::from_be_bytes([expected[0], expected[1], expected[2], expected[3]]);
        assert_eq!(derive_half::<Sha256Digest>(&id), want);
    }

    #[test]
    fn reserved_values_are_skipped_by_appending_one() {
        // FORMATS 3.5: retry with 0x01 appended until non-reserved.
        let id = Identity([0; IDENTITY_LEN]);
        let half = derive_half::<ReservedOnceDigest>(&id);
        assert_eq!(half, 7);
        assert!(!RESERVED.contains(&half));
    }

    #[test]
    fn wire_forms_place_halves_per_l4_6_1_3() {
        let hive = Identity([1; IDENTITY_LEN]);
        let group = Identity([2; IDENTITY_LEN]);
        let w = WireIdentity::derive::<Sha256Digest>(&hive, &group);
        let ext = w.extended();
        assert_eq!(&ext[..4], &w.group_half.to_be_bytes()); // group half first
        assert_eq!(&ext[4..], &w.hive_half.to_be_bytes());
        assert_eq!(w.compact(), w.hive_half); // FORMATS 3.4
                                              // Distinct identities derive distinct halves (overwhelmingly).
        assert_ne!(w.hive_half, w.group_half);
    }
}
