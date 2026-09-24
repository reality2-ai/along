//! The one development trust group (L5 Clause 9), and its published seed.
//!
//! 9.1: *"There shall be one development trust group, whose key material
//! is published."* **Nothing published it until 2026-08-02** — this lane
//! filed the gap as `CORE-5`, Roy ruled the seed, and the supervisor
//! ruled the derivation.
//!
//! ## Why a printable sentence rather than random bytes
//!
//! Clause 9 Note 2: *"its secrecy is zero and its admission rule is its
//! entire security."* So **auditability beats entropy**: anyone who dumps
//! this key material and traces it back finds a sentence saying what it
//! is. If it ever appears where it should not, **the bytes themselves say
//! so.**
//!
//! ## Why the bytes are pinned this precisely
//!
//! The supervisor's first draft of the seed used an **em-dash**, U+2014,
//! which is not ASCII. Two implementations, one typing an em-dash and one
//! a hyphen, derive different keys and never interoperate — **which is
//! precisely the failure Clause 9 exists to prevent, reintroduced by the
//! fix for it.** Measured here: the em-dash variant is **59 bytes, not
//! 57**, because an em-dash is three bytes in UTF-8, so **the length
//! check catches the near miss before the hash does.**
//!
//! ## Reading B, and it is the corpus rather than a preference
//!
//! L5 4.2.2: *"The group's identifier shall be derived from its public
//! key, so that generating the keypair determines the identifier."* A
//! derivation producing no keypair produces no public key and leaves
//! 4.2.2 nothing to derive from — **non-conformant, not a weaker
//! alternative.** Clause 9 Note 2 grants **exactly one** abnormality, the
//! secrecy; the keys, the gate and the certificates stay ordinary.
//!
//! The suite coupling is answered by **4.2.3** — *"Every structure at this
//! layer carrying a key, signature or ciphertext shall carry an algorithm
//! identifier"* — so the suite travels with the material. **A development
//! group under a different signature suite is a different group**, and
//! that is an honest report of a real discontinuity: devices on different
//! suites cannot verify each other's certificates, so they are not one
//! group in any operative sense.
//!
//! Derivation is a **plain hash of the seed, deliberately not the FORMATS
//! KDF**. The KDF needs a purpose label, purpose labels are `STD-SS39`,
//! and routing this through it would chain a published single-purpose
//! group behind an unrelated ruling. **A public single-purpose group has
//! no purpose separation to preserve.** Recorded as an exception with its
//! reason so the next reader does not "fix" it.
//!
//! # THIS FILE IS AN EXEMPTION, AND HERE IS WHAT BINDS EVERYONE ELSE
//!
//! **This pattern is correct exactly once.** A published seed deriving a
//! group key is right for this group and for no other; anything that
//! copies the mechanism for a real group has copied the abnormality
//! without the admission rule that pays for it.
//!
//! **The ruling is named, not merely the reason** (d043): **L5 9.1d,
//! register row `L5-113` — *this pattern shall not be used for any group
//! other than the development group.*** That clause binds **every lane**,
//! not this one. A reader arriving here from hive, composer or android
//! is looking at the single authorised instance of a mechanism their own
//! lane may not reproduce.
//!
//! **The operative distinction: the exemption is THIS GROUP, never THE
//! MECHANISM.** Core may publish *these* bytes because 9.1 requires the
//! development group's key material to be published. **No lane may
//! publish a seed for any other group**, and copying this file's shape
//! for a real group is the failure 9.1d exists to forbid.
//!
//! **Why it is spelled out rather than left to the prose above**: a
//! prohibition addressed to one named lane reads as permission to every
//! other, by construction. The paragraph above explained the *reason* and
//! named no ruling and no audience, so a reader who is not this lane met
//! a design note rather than a rule.

use crate::crypto::IDENTITY_LEN;
use crate::identity::Identity;
use crate::membership::GroupKind;

/// The published seed: **US-ASCII, no trailing newline, exactly
/// [`SEED_LEN`] bytes.**
/// **9.3a: absent from a production image, not disabled in it** — gated
/// with the secret it derives (the occam-calm audit, 2026-08-25: absence
/// rested on the linker dropping an unreferenced const, which is the
/// runtime-check-vs-absence distinction 9.3 Note 0a refuses).
#[cfg(any(test, feature = "development-trust-group"))]
pub const SEED: &[u8] = b"Reality2 development trust group - not for production use";

/// 57.
///
/// Stated as a constant because **checking it catches a transcription
/// error more cheaply than any hash**: the em-dash near miss is 59.
pub const SEED_LEN: usize = 57;

/// `sha256(SEED)`, which **is** the group's secret half.
///
/// # `CORE-13`, structural half: THIS SHOULD NOT EXIST IN A PRODUCTION IMAGE
///
/// **Measured 2026-08-03: `SEED`, `SECRET` and `IDENTITY` are all
/// unconditional `pub const`, so they compile into every image**, and
/// **nothing outside this module reads `SECRET` at all.** A production
/// build therefore carries a published private key in its trust path for
/// no reason any caller can name.
///
/// **The split is not symmetric and that is the whole design.**
/// [`IDENTITY`] **must stay unconditional**: a production device needs it
/// to *recognise* the development group in order to refuse it —
/// `classify` → `may_join` → `ProductionDeviceIntoDevelopmentGroup`.
/// **The identifier must be present to refuse it; the secret must be
/// absent to make possession impossible.**
///
/// **And structure does not replace the check.** Removing the constant
/// stops the image being one source of those keys; **keys can also arrive
/// from storage or a peer**, and the gate governs all sources or none.
/// So `CORE-13` has two halves and this is the cheaper one — **CLOSED
/// 2026-08-25**: the constant is now compiled only under `test` or the
/// `development-trust-group` feature, so a production image never sees it.
#[cfg(any(test, feature = "development-trust-group"))]
pub const SECRET: [u8; 32] = [
    0x7f, 0xfc, 0xba, 0x77, 0xaa, 0x8a, 0xfc, 0x96, 0x2e, 0x32, 0xf9, 0xf4, 0x2e, 0xbc, 0x50, 0x04,
    0x14, 0xa4, 0x6b, 0xdf, 0xfa, 0xde, 0x96, 0xdb, 0x18, 0xda, 0xb8, 0xba, 0xf7, 0xc8, 0xb3, 0xac,
];

/// The development group's identifier: the Ed25519 public half of
/// [`SECRET`] (4.2.2, and 4.2.3 carries the suite alongside).
///
/// Pinned as a vector so **two implementations can prove they landed on
/// the same group before they meet on a wire**, and so a transcription
/// error in this file is caught in-tree rather than as two benches that
/// mysteriously cannot verify each other.
pub const IDENTITY: Identity = Identity([
    0xcc, 0x95, 0x27, 0xce, 0xcd, 0x94, 0x8b, 0x5b, 0xb9, 0x7b, 0x0c, 0x10, 0xe5, 0x83, 0x8d, 0xd2,
    0xca, 0x09, 0x60, 0x69, 0x4f, 0x31, 0x7e, 0x34, 0xeb, 0xfd, 0xa9, 0x24, 0xa5, 0x33, 0x31, 0x63,
]);

/// Which group this is, **derived from the bytes rather than asserted by
/// a caller** (L5 Clause 9).
///
/// This closes a limit this lane named and refused to paper over: while
/// `GroupKind` was a caller's claim, nothing stopped it passing
/// `Development` for a group of its own choosing. **Now the kind is a
/// function of the identifier**, so a group is the development group if
/// and only if it is *this* group.
pub const fn classify(group: &Identity) -> GroupKind {
    let mut i = 0;
    while i < IDENTITY_LEN {
        if group.0[i] != IDENTITY.0[i] {
            return GroupKind::Ordinary;
        }
        i += 1;
    }
    GroupKind::Development
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_is_exactly_what_the_clause_pins() {
        assert_eq!(SEED.len(), SEED_LEN, "seed length");
        assert!(
            !SEED.ends_with(b"\n"),
            "a trailing newline changes the group"
        );
        assert!(
            SEED.iter().all(|b| (0x20..=0x7e).contains(b)),
            "a non-ASCII byte here is the em-dash defect"
        );
    }

    #[test]
    fn a_one_character_difference_is_a_different_group_and_is_not_admitted() {
        // 01-terminology 4.2, and the case the supervisor nearly shipped.
        assert_eq!(classify(&IDENTITY), GroupKind::Development);
        let mut near = IDENTITY;
        near.0[0] ^= 0x01;
        assert_eq!(
            classify(&near),
            GroupKind::Ordinary,
            "a group one bit from the published one was admitted as the development group"
        );
    }

    #[test]
    fn the_em_dash_variant_is_caught_by_length_alone() {
        // Measured, not reasoned: an em-dash is three bytes in UTF-8.
        let em = "Reality2 development trust group \u{2014} not for production use".as_bytes();
        assert_ne!(em.len(), SEED_LEN);
        assert_eq!(em.len(), 59);
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod vector {
    use super::*;
    use crate::crypto::Digest;
    use crate::suite::Sha256;

    #[test]
    fn the_published_seed_derives_the_pinned_secret() {
        let mut out = [0u8; 32];
        Sha256::hash(SEED, &mut out);
        assert_eq!(out, SECRET, "sha256(seed) is not the pinned secret half");
    }

    #[test]
    fn the_pinned_secret_derives_the_pinned_identifier() {
        // 4.2.2: generating the keypair determines the identifier. This is
        // the half a second implementation must reproduce to be in the
        // same group.
        use ed25519_dalek::SigningKey;
        let public = SigningKey::from_bytes(&SECRET).verifying_key();
        assert_eq!(
            public.as_bytes(),
            &IDENTITY.0,
            "the vector does not reproduce"
        );
    }

    /// L5 9.1f: the group identifier is derived from the public half
    /// **exactly as 4.3.1 derives any group identifier**, giving the wire
    /// group half `0e6c3b8c`.
    ///
    /// The clause states the answer, so this is the rare row where the
    /// register itself supplies the vector — and **that is the only
    /// reason it can be checked without a second implementation.** A
    /// derivation stated in prose and nowhere pinned is reproducible only
    /// by two parties who already agree.
    ///
    /// **`exactly as 4.3.1` is the load-bearing phrase**: it is checked
    /// by calling the ordinary `derive_half`, the same function every
    /// other group goes through, rather than by hashing here. A private
    /// copy of the derivation would agree with itself forever.
    #[test]
    fn the_development_group_lands_on_the_wire_half_the_clause_states() {
        use crate::identity::derive_half;
        assert_eq!(derive_half::<Sha256>(&IDENTITY), 0x0e6c_3b8c);
        // 4.2 excluded case: a neighbouring identity must NOT land there,
        // or the assertion above would be satisfied by a constant.
        let mut near = IDENTITY;
        near.0[0] ^= 0x01;
        assert_ne!(derive_half::<Sha256>(&near), 0x0e6c_3b8c);
    }

    #[test]
    fn a_seed_differing_by_one_character_derives_a_different_identifier() {
        use ed25519_dalek::SigningKey;
        let near = b"Reality2 development trust group - not for production Use";
        assert_eq!(
            near.len(),
            SEED_LEN,
            "the control must differ only in content"
        );
        let mut secret = [0u8; 32];
        Sha256::hash(near, &mut secret);
        assert_ne!(secret, SECRET);
        let public = SigningKey::from_bytes(&secret).verifying_key();
        assert_ne!(public.as_bytes(), &IDENTITY.0);
        assert_eq!(classify(&Identity(*public.as_bytes())), GroupKind::Ordinary);
    }
}

/// **9.1e DERIVED, NOT TRANSCRIBED.**
///
/// [`IDENTITY`] is pinned as a vector in this file and 9.1e publishes the
/// same bytes in the clause — **so until this test existed the constant
/// was transcribed in every lane and derived in none.** r2-standard
/// raised it directly: it verified the seed bytes and computed
/// `sha256(SEED)`, and could not derive the Ed25519 public half in its
/// environment. *Two independent transcriptions of one number agree
/// whether or not the number is right.*
///
/// Feature-gated because the derivation needs a real Ed25519, which is
/// exactly why nobody had done it.
#[cfg(all(test, feature = "formats-suite"))]
mod clause_9_1e_is_derived {
    use super::{IDENTITY, SECRET, SEED, SEED_LEN};

    #[test]
    fn the_published_identity_is_the_ed25519_public_half_of_the_secret() {
        use ed25519_dalek::SigningKey;
        // 9.1c: the secret half IS taken as the 32-byte Ed25519 private
        // seed of RFC 8032 — not hashed again, not expanded first.
        let signing = SigningKey::from_bytes(&SECRET);
        assert_eq!(
            signing.verifying_key().to_bytes(),
            IDENTITY.0,
            "9.1e does not reproduce from 9.1c; the published identifier and \
             the published secret describe different groups, and two benches \
             would fail to verify each other for a reason neither could see"
        );
    }

    #[test]
    fn the_secret_is_sha256_of_the_seed_and_the_seed_is_the_pinned_bytes() {
        // The other half of the chain, so a failure above is attributable
        // to the Ed25519 step rather than to a drifted seed (d090 cl. 1).
        use sha2::{Digest as _, Sha256};
        assert_eq!(SEED.len(), SEED_LEN);
        assert_eq!(<[u8; 32]>::from(Sha256::digest(SEED)), SECRET);
    }
}
