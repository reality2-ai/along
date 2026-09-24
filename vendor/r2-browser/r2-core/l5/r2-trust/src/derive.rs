//! Key derivation (L5 5.2).
//!
//! One derivation serves the whole layer, with no exceptions (L5 5.2.1):
//! **HKDF-SHA256, 32-byte output**, the relevant secret as input keying
//! material, the relevant public binding as salt, and a domain-separating
//! purpose string as info. No two derivations share a purpose string
//! (5.2.3).
//!
//! The purpose strings themselves are FORMATS.md 4a, `PROVISIONAL(STD-SS39)`
//! — the scheme, not merely the strings, is open to replacement until
//! ratified. FORMATS 4a Note 1 states the failure they prevent, and it is
//! silent: two derivations sharing one string yield the same key for
//! different jobs, which no test detects and no party observes until the
//! compromise of one exposes the other.

use crate::keys::SecretKey;

/// A domain-separating purpose string (L5 5.2.1 info input).
///
/// Deliberately a closed set: FORMATS 4a.4 states that a purpose string not
/// in the table shall not be used with this derivation, and that a new
/// derivation is added by adding a row there. A caller therefore cannot
/// supply an arbitrary string, and 5.2.3's no-sharing rule holds by
/// construction rather than by review.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Purpose {
    /// `r2/v0/group/payload` — group payload protection.
    GroupPayload,
    /// `r2/v0/group/integrity` — the Layer 4 tag key.
    GroupIntegrity,
    /// `r2/v0/entanglement/payload`.
    EntanglementPayload,
    /// `r2/v0/entanglement/integrity`.
    EntanglementIntegrity,
    /// `r2/v0/ceremony/session` — enrolment ceremony session.
    CeremonySession,
    /// `r2/v0/storage/seal` — sealed storage of derived keys.
    StorageSeal,
    /// Bulk-session traffic from the initiator to the responder.
    BulkInitiatorToResponder,
    /// Bulk-session traffic from the responder to the initiator.
    BulkResponderToInitiator,
}

impl Purpose {
    /// The exact ASCII byte sequence, with no terminator and no padding
    /// (FORMATS 4a.2, `PROVISIONAL(STD-SS39)`).
    ///
    /// The `v0` field is the Layer 4 version — the algorithm epoch
    /// (L4 4.1.3 Note 1) — and a new epoch takes a new set of strings,
    /// never a reused one (FORMATS 4a.3).
    pub const fn as_bytes(self) -> &'static [u8] {
        match self {
            Purpose::GroupPayload => b"r2/v0/group/payload",
            Purpose::GroupIntegrity => b"r2/v0/group/integrity",
            Purpose::EntanglementPayload => b"r2/v0/entanglement/payload",
            Purpose::EntanglementIntegrity => b"r2/v0/entanglement/integrity",
            Purpose::CeremonySession => b"r2/v0/ceremony/session",
            Purpose::StorageSeal => b"r2/v0/storage/seal",
            Purpose::BulkInitiatorToResponder => b"r2/v0/bulk/initiator-to-responder",
            Purpose::BulkResponderToInitiator => b"r2/v0/bulk/responder-to-initiator",
        }
    }

    /// Every purpose, for exhaustiveness checks.
    pub const ALL: [Purpose; 8] = [
        Purpose::GroupPayload,
        Purpose::GroupIntegrity,
        Purpose::EntanglementPayload,
        Purpose::EntanglementIntegrity,
        Purpose::CeremonySession,
        Purpose::StorageSeal,
        Purpose::BulkInitiatorToResponder,
        Purpose::BulkResponderToInitiator,
    ];
}

/// HKDF-SHA256 with 32-byte output, supplied by the caller (L5 5.2.1).
///
/// Behind a trait for the same reason as every other primitive here: the
/// scheme is `PROVISIONAL(STD-SS39)` and a target may have hardware for it.
pub trait Hkdf {
    /// Expand to exactly 32 bytes: `ikm` is the secret, `salt` the public
    /// binding, `info` the purpose string.
    fn derive(ikm: &[u8], salt: &[u8], info: &[u8], out: &mut [u8; 32]);
}

/// Derive a 32-byte key under one purpose (L5 5.2.1).
///
/// `secret` is the relevant secret — the group secret for group keys —
/// and `public_binding` the relevant public binding used as salt: the
/// group's identity for group keys, so that two groups never derive the
/// same key from the same secret material.
pub fn derive_key<H: Hkdf>(
    secret: &[u8],
    public_binding: &[u8],
    purpose: Purpose,
) -> SecretKey<32> {
    let mut out = [0u8; 32];
    H::derive(secret, public_binding, purpose.as_bytes(), &mut out);
    // The staging buffer is key material too, and 5.3.4 asks that it leave
    // no copy behind: `SecretKey::new` erases its source in the transfer.
    SecretKey::new(&mut out)
}

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::collections::BTreeSet;
    use std::vec::Vec;

    /// HKDF-SHA256 built from the host `sha2` dev-dependency (RFC 5869).
    struct HostHkdf;

    fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut k = [0u8; 64];
        if key.len() > 64 {
            let d = Sha256::digest(key);
            k[..32].copy_from_slice(&d);
        } else {
            k[..key.len()].copy_from_slice(key);
        }
        let mut ipad = [0x36u8; 64];
        let mut opad = [0x5Cu8; 64];
        for i in 0..64 {
            ipad[i] ^= k[i];
            opad[i] ^= k[i];
        }
        let mut inner = Sha256::new();
        inner.update(ipad);
        inner.update(msg);
        let inner = inner.finalize();
        let mut outer = Sha256::new();
        outer.update(opad);
        outer.update(inner);
        outer.finalize().into()
    }

    impl Hkdf for HostHkdf {
        fn derive(ikm: &[u8], salt: &[u8], info: &[u8], out: &mut [u8; 32]) {
            // Extract, then one expand round (32 bytes = one SHA-256 block).
            let prk = hmac_sha256(salt, ikm);
            let mut msg = Vec::from(info);
            msg.push(0x01);
            *out = hmac_sha256(&prk, &msg);
        }
    }

    #[test]
    fn purpose_strings_are_exact_formats_4a_2_values() {
        assert_eq!(Purpose::GroupPayload.as_bytes(), b"r2/v0/group/payload");
        assert_eq!(Purpose::GroupIntegrity.as_bytes(), b"r2/v0/group/integrity");
        assert_eq!(
            Purpose::EntanglementPayload.as_bytes(),
            b"r2/v0/entanglement/payload"
        );
        assert_eq!(
            Purpose::EntanglementIntegrity.as_bytes(),
            b"r2/v0/entanglement/integrity"
        );
        assert_eq!(
            Purpose::CeremonySession.as_bytes(),
            b"r2/v0/ceremony/session"
        );
        assert_eq!(Purpose::StorageSeal.as_bytes(), b"r2/v0/storage/seal");
        assert_eq!(
            Purpose::BulkInitiatorToResponder.as_bytes(),
            b"r2/v0/bulk/initiator-to-responder"
        );
        assert_eq!(
            Purpose::BulkResponderToInitiator.as_bytes(),
            b"r2/v0/bulk/responder-to-initiator"
        );
    }

    #[test]
    fn no_terminator_and_no_padding() {
        // FORMATS 4a.2: the exact ASCII sequence, nothing appended.
        assert_eq!(Purpose::ALL.len(), 8, "FORMATS 4a.2 defines eight purposes");
        for p in Purpose::ALL {
            let b = p.as_bytes();
            assert!(!b.contains(&0), "{p:?} carries a terminator");
            assert_ne!(*b.last().unwrap(), b' ', "{p:?} is padded");
            assert!(b.is_ascii());
            assert!(b.starts_with(b"r2/v0/")); // 4a.3: the epoch field
        }
    }

    #[test]
    fn no_two_derivations_share_a_purpose_string() {
        // L5 5.2.3, the rule whose violation is silent.
        let distinct: BTreeSet<&[u8]> = Purpose::ALL.iter().map(|p| p.as_bytes()).collect();
        // Count first: 0 == 0 would pass vacuously for an emptied set.
        assert_eq!(Purpose::ALL.len(), 8);
        assert_eq!(distinct.len(), Purpose::ALL.len());
    }

    #[test]
    fn distinct_purposes_yield_distinct_keys() {
        // The property the purpose strings exist to produce: same secret,
        // same binding, different job, different key.
        let secret = [0x11u8; 32];
        let binding = [0x22u8; 32];
        let integrity = derive_key::<HostHkdf>(&secret, &binding, Purpose::GroupIntegrity);
        let payload = derive_key::<HostHkdf>(&secret, &binding, Purpose::GroupPayload);
        assert_ne!(integrity.expose(), payload.expose());
    }

    #[test]
    fn distinct_bindings_yield_distinct_keys() {
        // Two groups never derive the same key from the same secret.
        let secret = [0x11u8; 32];
        let a = derive_key::<HostHkdf>(&secret, &[0xAA; 32], Purpose::GroupIntegrity);
        let b = derive_key::<HostHkdf>(&secret, &[0xBB; 32], Purpose::GroupIntegrity);
        assert_ne!(a.expose(), b.expose());
    }

    #[test]
    fn derivation_is_deterministic() {
        let secret = [0x33u8; 32];
        let binding = [0x44u8; 32];
        let a = derive_key::<HostHkdf>(&secret, &binding, Purpose::StorageSeal);
        let b = derive_key::<HostHkdf>(&secret, &binding, Purpose::StorageSeal);
        assert_eq!(a.expose(), b.expose());
    }
}
