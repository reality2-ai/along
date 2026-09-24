//! Reality2 Layer 5: trust group identity, membership, and the delivery
//! gate (`r2-standard/L5-trust-and-identity.md`).
//!
//! This crate sits **above the trust boundary** (the L4/L5 seam, L0 Clause
//! 6): it names key material, which no L1-L4 crate may. Below it,
//! everything is belief — probabilistic, local, decaying. Here at the
//! boundary is the stack's one *binary* gate: the frame's integrity tag
//! verifies under a held key or it does not.
//!
//! Byte-level choices come from the formats companion and are marked
//! `PROVISIONAL(SS-n)` at their call sites so a ruling swaps one site
//! rather than starting an archaeology (FORMATS.md 8.2).
//!
//! # WHAT `PROVISIONAL` MEANS FOR A LANE DEPENDING ON THIS CRATE
//!
//! **It answers *does this bind at all*, not merely *who wins on a
//! conflict*** (d045). A marked value is **this lane's reading of an
//! unratified draft**, chosen so the code could exist and **carrying no
//! authority of its own**. It is **evidence of what was built against,
//! not guidance for what to build.**
//!
//! **So a consumer must not treat a marked value as settled**: two
//! implementations that both read the same draft can still disagree, and
//! the ruling that settles it may name bytes neither of them chose. **If
//! you need a marked value to be stable, obtain the ruling — do not
//! inherit this lane's guess as though it were the standard.**
//!
//! **Stated once here rather than at each of the ~38 marked sites**,
//! because *where a single test disposes of a class, state the test and
//! not the class*: the convention covers every marker, including ones
//! added after this sentence was written. Cryptographic
//! primitives are traits, so a target may substitute hardware
//! acceleration or a ratified replacement.
//!
//! no_std, sans-IO, no allocation.

#![no_std]
#![deny(unsafe_code)]

/// Authenticated ephemeral session custody for the pending bulk service.
#[cfg(all(feature = "formats-suite", feature = "payload-cipher"))]
pub mod bulk_session;

pub mod abort;
pub mod at_rest;
pub mod ceremony;
pub mod certificate;
pub mod crypto;
pub mod derive;
pub mod development;
pub mod entanglement;
pub mod errors;
pub mod evidence;
pub mod gate;
pub mod identity;
pub mod introduction;
pub mod invitation;
pub mod key_agreement;
pub mod keygen;
pub mod keys;
pub mod member_proof;
pub mod membership;
pub mod record;
pub mod rotation;
/// L5A 8.5: an entanglement surviving a restart — the standing persists
/// and the keys are deliberately not stored (5.2.4).
pub mod standing;
pub mod suite;
pub mod surface;

/// The payload cipher (FORMATS 4.1) and its envelope (4.2).
///
/// **Separate from `formats-suite`**: the trust group is authenticated by
/// the Layer 4 tag whether or not payloads are encrypted, so integrity
/// without confidentiality is a real configuration and should not carry a
/// cipher it never calls. The nonce rule lives in [`envelope`].
#[cfg(feature = "payload-cipher")]
pub mod cipher;
#[cfg(feature = "payload-cipher")]
pub mod confidential;
/// The seam between a held entanglement (L5A) and the payload its key
/// protects (L5 7.3.1). Both halves existed and nothing joined them.
#[cfg(feature = "payload-cipher")]
pub mod crossing_keys;
#[cfg(feature = "payload-cipher")]
pub mod envelope;
/// The facility a hardware-rooted secret presents to [`at_rest`] — **the one
/// link that was missing** while everything above and below it was built.
#[cfg(feature = "payload-cipher")]
pub mod root_sealing;

/// Two bench hives under the **development trust group** (L5 Clause 9).
/// Conformant by Note 2 to 9.3, and conformant **only because 9.2 is
/// enforced** — a production build is refused, never served.
#[cfg(feature = "development-trust-group")]
pub mod development_bench;

pub use certificate::{
    AcceptanceDepth, Certificate, Epoch, MaxRotationInterval, RevocationReason, RevocationSet,
    RotationPolicy, Standing,
};
pub use crypto::{Aead, Digest, Signer, Verifier};
pub use derive::{derive_key, Hkdf, Purpose};
pub use evidence::{verify_evidence, Freshness, HighWaterMarks, MemberEvidence};
pub use gate::{
    apply_gate, crossing_grade, permits, Addressing, Delivery, GateOutcome, Grade, GroupKeys,
    LiveEntanglement, RequiredLevel,
};
pub use identity::{Identity, WireIdentity};
pub use keys::{IntegrityKey, PayloadKey, SecretKey};
pub use membership::{
    may_claim, may_join, AdmissionRefusal, BootClaim, ClaimRecord, ClaimRefusal, ClaimState,
    GroupKind, Persona, PersonaOrigin,
};
// **L5 11.1(b), re-exported at the root because that is where a consumer
// looks.** The types existed and were reachable only as
// `r2_trust::surface::Trust`, while this list — the crate's advertised
// surface — omitted the one surface another lane was told to build
// against. **A capability that exists and is not discoverable is, to the
// lane waiting on it, the same as one that does not exist**: composer
// recorded itself blocked on this all evening.
pub use rotation::{walk_forward, Rotation, RotationCause, WalkError};
pub use surface::{
    KeyMaterialRefusal, Keystore, NotAHive, PersonaReport, StoreCondition, StoredPersona, Trust,
};

#[cfg(feature = "development-trust-group")]
pub mod development_certificate;
