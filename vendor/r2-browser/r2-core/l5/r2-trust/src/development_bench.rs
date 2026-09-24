//! Two bench hives interoperating under the **development trust group**
//! (L5 Clause 9) — the conformant way to do this, and it already
//! existed.
//!
//! # This file was wrong, and r2-standard caught it before it shipped
//!
//! The first version minted its own bench secret from an environment
//! variable and labelled itself non-conformant. **That was building the
//! non-conformant version of a problem the standard had already solved.**
//! Note 2 to L5 9.3 says the development group *"exists so that bench and
//! test devices interoperate **without each bench minting its own
//! group**"* — which is a description of what the first version did.
//!
//! Minting one is forbidden by name, not merely unnecessary:
//!
//!   * **9.1d** — *"This pattern — a published seed deriving a group key
//!     — shall not be used for any group other than the development
//!     group."*
//!   * **9.1g** — *"The development group shall be the only group whose
//!     identity material is not generated from a random source."*
//!
//! **And what made the first version non-conformant was not that it was
//! pre-shared — it was that it MINTED ITS OWN SECRET.** A minted secret
//! is the defect; a published one is the mechanism. So the label is
//! removed rather than reworded, and 9.2 is what carries the weight —
//! enforced below rather than asserted here.
//!
//! # 9.2 is the condition that makes a published secret safe
//!
//! Both directions are obligations and both are testable:
//!
//!   * **L5-085** — a development-mode device shall join **only** the
//!     development group;
//!   * **L5-086** — the development group shall admit **only**
//!     development-mode devices.
//!
//! Every entry point below takes the caller's
//! [`BuildMode`](r2_hal_traits::build_mode::BuildMode) and runs it
//! through [`may_join`], so **a production build asking for this key is
//! refused rather than served.** L5-087/088/089 are the other side: a
//! production device treats these credentials as inert, possession
//! confers nothing.
//!
//! # A SANCTIONED ROUTE, not a stand-in — and the claim is qualified
//!
//! **L5B 4.5**: the development group's published-credential admission
//! *"is the one path that replaces it"*. A headless development pair
//! therefore has a route that is **person-free by construction** —
//! nobody witnesses an already-published credential — and it is
//! available under **both** readings of `STD-SS51`.
//!
//! *An earlier draft said that if `STD-SS51` required a person at `Anchored`
//! this module would become the only way a headless pair reached
//! `verified = true`. **That is false whichever way `STD-SS51` goes**, and
//! r2-standard falsified it. Recorded because the sentence framed the
//! module as a reluctant compromise, and it is not one.*
//!
//! **Do not read this as conformant flatly.** `STD-SS267` is open: L5B
//! 4.5's *"it"* is ambiguous — the antecedent may be **the ceremony** or
//! **the same-build-mode rule** — and *the two readings differ on
//! whether this feature is conformant today*. **Conformant under the
//! reading where the antecedent is the ceremony**; unresolved under the
//! other. **Roy rules `STD-SS267`.**
//!
//! # What this still does not do
//!
//! It does not perform an enrolment ceremony, and does not need to: the
//! material is *published*, so both hives arrive holding it rather than
//! admitting each other. **A report says *joined the development trust
//! group*, never *formed a trust group*.** L5-098's marking carries the
//! distinction.

use r2_hal_traits::build_mode::BuildMode;

use crate::derive::{derive_key, Purpose};
use crate::development::{IDENTITY, SECRET};
use crate::keys::SecretKey;
use crate::membership::{may_join, AdmissionRefusal, GroupKind};
use crate::suite::HkdfSha256;

/// The development group's integrity key, for a device entitled to it.
///
/// **Refuses a production device** (9.2 / L5-086). The refusal is the
/// conformance property, not a convenience: the secret is published, so
/// *possession cannot be the check* — the mode is.
///
/// `IDENTITY` is the public binding (HKDF salt), as [`derive_key`]
/// requires for a group key, so this key is bound to *this* group and
/// not merely to *these* bytes.
pub fn development_group_integrity_key(mode: BuildMode) -> Result<SecretKey<32>, AdmissionRefusal> {
    may_join(mode, GroupKind::Development)?;
    Ok(derive_key::<HkdfSha256>(
        &SECRET,
        &IDENTITY.0,
        Purpose::GroupIntegrity,
    ))
}

/// Run the L5 7.1.2 delivery gate under the development group's key.
///
/// **This is a non-test caller of [`crate::gate::apply_gate`]**, which
/// had none anywhere in the fleet — the gate was correct, complete and
/// unreachable. *A caller that nothing calls is that same defect one
/// layer out*, so this is reached by
/// `crates/r2-trust/tests/two_nodes_reach_verified.rs`, which r2-hive
/// asked be the landing site rather than its own binary: **two callers
/// of one seam in one binary is a second opinion about the receive
/// path.**
///
/// **And it is also the first non-test caller of [`may_join`]**, by way
/// of the key derivation above — `CORE-13`'s open half is that
/// `apply_gate` consults no membership at all. This does not close it:
/// the gate still takes whatever keys its caller hands it. *It closes
/// the route by which this module could have handed it the wrong ones.*
pub fn gate_with_development_group_key(
    mode: BuildMode,
    addressing: crate::gate::Addressing,
    frame: &r2_wire::Frame<'_>,
    now: r2_hal_traits::Ticks,
) -> Result<crate::gate::GateOutcome, AdmissionRefusal> {
    let key = development_group_integrity_key(mode)?;
    Ok(crate::gate::apply_gate::<crate::suite::HmacSha256Tag>(
        addressing,
        frame,
        // ‼ THROUGH THE CHECKED CONSTRUCTOR, AND NOT MERELY BECAUSE THE
        // FIELDS CLOSED. This path already ran `may_join(mode,
        // Development)` above — 9.3's FIRST obligation, not enrollable —
        // and `for_group` is the SECOND, possession confers nothing. *A
        // device that refuses to join while honouring a credential it
        // already holds satisfies the first and breaks the second*, so
        // passing the first is not a reason to skip the second.
        //
        // `expect` rather than `?`: reaching here means `may_join`
        // accepted, so a refusal now would mean the two checks disagree
        // about the same pair — a contradiction worth a panic rather than
        // a silently absent key, which would gate as *unauthenticated* and
        // look like an unconfigured bench.
        Some(
            crate::gate::GroupKeys::for_group(mode, GroupKind::Development, &key, None)
                .expect("may_join admitted this mode; for_group must agree"),
        ),
        // No entanglements: L5-004 is what says authenticated
        // cross-group traffic needs one, and a bench pair is one group.
        &[],
        now,
    ))
}

/// The development group's **payload** key (FORMATS 4a.2
/// `r2/v0/group/payload`), for a device entitled to it.
///
/// **Purpose separation is the whole point of there being two functions**
/// (L5 5.2.1): one group secret must not collapse into one key, so the
/// key that authenticates a frame and the key that conceals its payload
/// are different derivations of the same secret and neither can stand in
/// for the other. Refuses a production device for the same reason
/// [`development_group_integrity_key`] does.
#[cfg(feature = "payload-cipher")]
pub fn development_group_payload_key(mode: BuildMode) -> Result<SecretKey<32>, AdmissionRefusal> {
    may_join(mode, GroupKind::Development)?;
    Ok(derive_key::<HkdfSha256>(
        &SECRET,
        &IDENTITY.0,
        Purpose::GroupPayload,
    ))
}

/// Seal a payload for the development group (FORMATS 4.2 envelope).
///
/// **This is the non-test caller the envelope would otherwise not have.**
/// A cipher nothing calls is the same defect as a gate nothing calls,
/// which this lane met two hours earlier and named; shipping the second
/// instance while having just written the sentence about the first would
/// be the whole point missed.
///
/// The nonce is drawn inside [`crate::envelope::seal_payload`] from
/// `entropy` and is never a parameter here — see the nonce rule at the
/// head of that module for what happens when the draw refuses.
#[cfg(feature = "payload-cipher")]
pub fn seal_for_development_group<E: crate::keygen::ConformingEntropy>(
    mode: BuildMode,
    entropy: &mut E,
    frame: &r2_wire::Frame<'_>,
    plaintext: &[u8],
    out: &mut [u8],
) -> Result<Result<usize, crate::envelope::SealRefusal>, AdmissionRefusal> {
    let key = development_group_payload_key(mode)?;
    Ok(crate::envelope::seal_payload::<
        crate::cipher::XChaCha20Poly1305,
        E,
    >(entropy, &key, frame, plaintext, out))
}

/// Open a development-group envelope. `None` on any failure, never
/// distinguished by reason.
#[cfg(feature = "payload-cipher")]
pub fn open_for_development_group(
    mode: BuildMode,
    frame: &r2_wire::Frame<'_>,
    envelope: &[u8],
    out: &mut [u8],
) -> Result<Option<usize>, AdmissionRefusal> {
    let key = development_group_payload_key(mode)?;
    Ok(crate::envelope::open_payload::<
        crate::cipher::XChaCha20Poly1305,
    >(&key, frame, envelope, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_development_device_is_served_and_both_get_the_same_key() {
        let a = development_group_integrity_key(BuildMode::Development).unwrap();
        let b = development_group_integrity_key(BuildMode::Development).unwrap();
        assert_eq!(a.expose(), b.expose());
    }

    #[test]
    fn a_production_device_is_refused() {
        // L5-086 and L5-089. **The published secret is why this matters**:
        // possession cannot be the check, so the mode is.
        assert_eq!(
            development_group_integrity_key(BuildMode::Production).unwrap_err(),
            AdmissionRefusal::ProductionDeviceIntoDevelopmentGroup
        );
    }

    #[test]
    fn the_integrity_key_is_not_the_payload_key() {
        // Purpose separation (L5 5.2.1) survives: one group secret must
        // not collapse into one key.
        let integrity = development_group_integrity_key(BuildMode::Development).unwrap();
        let payload = derive_key::<HkdfSha256>(&SECRET, &IDENTITY.0, Purpose::GroupPayload);
        assert_ne!(integrity.expose(), payload.expose());
    }
}
