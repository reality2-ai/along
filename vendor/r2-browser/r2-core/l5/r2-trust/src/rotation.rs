//! Key rotation and the retained chain (L5 Clause 8).
//!
//! A rotation increments the epoch (8.5) and, where it was triggered by an
//! eviction, **binds that eviction into itself** (6.2.4 / 8.3): a member
//! cannot accept the rotation without also receiving the eviction. *The
//! set is the record; the rotation is the delivery* (6.2 Note 1).
//!
//! That binding is what makes [`walk_forward`] work. A member absent
//! through any number of rotations returns, walks the retained chain, and
//! receives each rotation's bound evictions as it goes (8.4 / L5-078) —
//! so it cannot arrive at the current epoch holding current keys while
//! still believing an evicted member belongs. Absence costs currency,
//! never membership (6.1.5).

use crate::certificate::{Epoch, RevocationEntry, RevocationSet, VerifiedRevocation};
use crate::crypto::Verifier;
use crate::identity::Identity;

/// Why a rotation happened.
///
/// Deliberately **not** two `Option` fields. As `Option<RevocationEntry>`
/// plus `Option<RevocationReason>`, an absent value read as "cadence
/// rotation, nothing bound" — and stripping either field from an eviction
/// rotation was both undetectable and rewarding:
///
/// - stripping the entry defeats 6.2.4, whose whole purpose is that a
///   member cannot accept the rotation *without also receiving the
///   eviction*;
/// - stripping the reason turned a **compromise** rotation's mandatory
///   zero grace into the deployment's full grace (8.2 / L5-076), and
///   8 Note 1 says grace on a compromise eviction is a window in which
///   the rotation has changed nothing.
///
/// Now the caller states which case applies, and for an eviction the
/// entry and its reason travel together so neither can be dropped
/// without the other.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RotationCause {
    /// A rotation made on the group's cadence (8.6). Nothing is bound to
    /// it, and saying so is explicit rather than inferred from absence.
    Cadence,
    /// Triggered by an eviction, which is bound into it (6.2.4 / 8.3).
    ///
    /// ‼ THE REASON IS THE ENTRY'S, AND IS DELIBERATELY NOT REPEATED HERE.
    /// This variant carried its own `reason` field until 2026-08-17, beside
    /// `entry.reason`, and **only the entry's copy was covered by the
    /// 6.2.4a signature** while `grace_ticks` read the outer one. Flipping
    /// the outer copy from `Compromise` to `Retirement` left the signature
    /// verifying and turned 8.2's mandatory zero grace into the
    /// deployment's full grace — *the exact defect the doc comment above
    /// claims this enum exists to prevent*, reintroduced one field down.
    /// One value, signed, read from the same place by everything.
    Eviction { entry: RevocationEntry },
}

/// One link of the retained rotation chain (L5 8.4).
///
/// The key material itself is deliberately absent from this type: a chain
/// link records *what changed and why*, and the keys ride separately
/// under whatever protection 5.3 requires. That also lets a member walk a
/// chain it has been handed before it holds any of the keys in it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Rotation {
    /// The epoch this rotation produced. Strictly greater than the epoch
    /// it succeeded (8.5).
    pub to_epoch: Epoch,
    pub cause: RotationCause,
    /// The binding of 6.2.4a: a signature by the group secret key over
    /// **the epoch and the cause**, never over the eviction alone.
    ///
    /// Signing the cause is the whole mechanism (6.2.4a Note 2): it makes
    /// a routine link and an eviction-carrying link *different signed
    /// objects*, so omitting the eviction changes the signed bytes and
    /// fails verification. Signing only the eviction would leave a routine
    /// claim unauthenticated, and stripping the eviction would still yield
    /// a link that verifies as routine — which is the attack 6.2.4a Note 1
    /// describes and which this crate was open to until 2026-08-17.
    pub signature: [u8; crate::crypto::SIGNATURE_LEN],
}

/// Upper bound on [`Rotation::write_signed_bytes`]: epoch, cause tag, and
/// in the eviction case the revoked subject's signed entry bytes.
pub const ROTATION_SIGNED_LEN: usize = 8 + 1 + crate::certificate::REVOCATION_SIGNED_LEN;

impl Rotation {
    /// Grace ticks for the key this rotation superseded (L5 8.2).
    ///
    /// A cadence rotation takes the deployment's ordinary grace; an
    /// eviction takes whatever its reason grades, and compromise takes
    /// zero however generous the deployment is (8 Note 1).
    pub const fn grace_ticks(&self, deployment_grace: u64) -> u64 {
        match self.cause {
            RotationCause::Cadence => deployment_grace,
            // The signed copy, and the only copy (see RotationCause::Eviction).
            RotationCause::Eviction { entry } => entry.reason.grace_ticks(deployment_grace),
        }
    }

    /// The canonical bytes the group secret key signs over (6.2.4a): the
    /// epoch this rotation produces, then a tag stating the cause, and for
    /// an eviction the revoked subject and reason it commits to.
    ///
    /// The cause tag is written even for a routine rotation, so that
    /// "routine" is an asserted value rather than the absence of one —
    /// the same reasoning that made [`RotationCause`] an enum instead of
    /// two `Option`s.
    ///
    /// `PROVISIONAL`: 6.2.4a states what the signature must cover and no
    /// clause states a byte layout for a rotation link. Registered against
    /// the standard with the revocation-entry layout it reuses.
    pub fn write_signed_bytes(&self, out: &mut [u8]) -> usize {
        let mut n = 0;
        out[n..n + 8].copy_from_slice(&self.to_epoch.0.to_be_bytes());
        n += 8;
        match self.cause {
            RotationCause::Cadence => {
                out[n] = 0;
                n + 1
            }
            RotationCause::Eviction { entry } => {
                out[n] = 1;
                n += 1;
                // The entry's own signed bytes already carry the subject
                // and the reason of 6.2.2a, which is what 6.2.4a requires
                // the cause to commit to.
                n + entry.write_signed_bytes(&mut out[n..])
            }
        }
    }

    /// The eviction bound into this rotation, if any.
    pub const fn bound_eviction(&self) -> Option<RevocationEntry> {
        match self.cause {
            RotationCause::Cadence => None,
            RotationCause::Eviction { entry } => Some(entry),
        }
    }
}

/// Why a walk could not complete.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WalkError {
    /// The chain does not start where the member left off: a link is
    /// missing, so evictions bound into it would be skipped. Refusing is
    /// the point — arriving at the current epoch without the evictions in
    /// between is exactly what 6.2.4 exists to prevent.
    ChainBroken { expected: Epoch, found: Epoch },
    /// The revocation set cannot hold another eviction, so the walk would
    /// silently drop one. Refuse rather than arrive under-informed.
    RevocationSetFull,
    /// A link's bound eviction does not verify under the group key. The
    /// chain is network data, so this is the ordinary case of a forged or
    /// corrupted link — and it must never reach the set, which has no
    /// removal (6.2.1).
    ForgedEviction { at_epoch: Epoch },
    /// The link's own binding does not verify under the group key
    /// (6.2.4a). Refused before anything else is read from it: an
    /// unverified link's *cause* is not evidence, so a routine claim on
    /// an unsigned link cannot be trusted either.
    UnverifiedLink { at_epoch: Epoch },
}

/// Walk a returning member forward through the retained chain (L5 8.4).
///
/// `from` is the epoch the member last held. Links are applied in order,
/// each one's bound eviction entering the revocation set as it is passed
/// — the member "receives each rotation's bound evictions as it goes",
/// which is the whole reason a member cannot accept the rotation without
/// the eviction (6.2.4).
///
/// A gap in the chain is refused, not skipped: a member that jumped
/// straight to the current epoch would hold current keys while still
/// treating an evicted subject as a member.
///
/// Returns the epoch arrived at. An empty chain is not an error — a
/// member that missed nothing walks zero links and stays where it is.
///
/// ‼ WHAT IS STILL UNPROVEN ABOUT 6.2.4a HERE, NAMED RATHER THAN LEFT TO
/// BE DISCOVERED (`r2-codex-refute`, 2026-08-17, after it confirmed the
/// fix). The binding is exercised by unit tests including one under the
/// real `Ed25519` suite, and that is all: **this function has no
/// production caller anywhere in the workspace**, and **no published
/// vector covers a rotation link**, so nothing byte-compares this layout
/// against another implementation. A second implementation could satisfy
/// 6.2.4a and be unable to walk a chain produced here.
///
/// That is the SS383 shape — a normative obligation about bytes with no
/// vector is outside the conformance contract by construction — and it
/// applies to `write_signed_bytes` above, whose layout is `PROVISIONAL`
/// precisely because no clause states one.
pub fn walk_forward<V: Verifier, const N: usize>(
    from: Epoch,
    chain: &[Rotation],
    group: &Identity,
    revoked: &mut RevocationSet<N>,
) -> Result<Epoch, WalkError> {
    let mut at = from;
    for link in chain {
        // 6.2.4a FIRST, BEFORE ANYTHING IS READ FROM THE LINK — including
        // its epoch. The clause is unconditional: *a member shall reject a
        // link whose signature does not verify*, so a link cannot earn a
        // skip, a continuity verdict, or anything else on the strength of
        // fields that have not been authenticated yet.
        //
        // EVERY link, not only those carrying an eviction. Verifying only
        // eviction-bearing links is the defect 6.2.4a Note 1 describes: a
        // link presented as routine, with the eviction simply omitted, is
        // then indistinguishable from a genuine routine rotation, and the
        // returning member arrives at the current epoch holding current
        // keys having never learnt of the eviction.
        //
        // And it runs BEFORE the already-held skip below, which is the
        // subtler half: a link the member already holds still arrived from
        // the network, and skipping it unverified would let an attacker
        // append unauthenticated links to a chain for free so long as they
        // claimed a low epoch. They would change no state, but "changes no
        // state" is not what the clause says.
        let mut signed = [0u8; ROTATION_SIGNED_LEN];
        let n = link.write_signed_bytes(&mut signed);
        if !V::verify(&group.0, &signed[..n], &link.signature) {
            return Err(WalkError::UnverifiedLink {
                at_epoch: link.to_epoch,
            });
        }
        // Each link must succeed the one before it. Anything else means a
        // link is missing and its evictions with it.
        if link.to_epoch.0 <= at.0 {
            // Already held: a member re-walking a chain it partly knows is
            // ordinary, so skip rather than fail.
            continue;
        }
        if link.to_epoch.0 != at.0 + 1 {
            return Err(WalkError::ChainBroken {
                expected: Epoch(at.0 + 1),
                found: link.to_epoch,
            });
        }
        if let Some(eviction) = link.bound_eviction() {
            // The chain arrives from the network, so every bound eviction
            // is verified before it can enter the set (6.2.2). A set with
            // no removal cannot afford a single forged entry.
            let verified = VerifiedRevocation::verify::<V>(eviction, group).ok_or(
                WalkError::ForgedEviction {
                    at_epoch: link.to_epoch,
                },
            )?;
            revoked
                .append(verified)
                .map_err(|_| WalkError::RevocationSetFull)?;
        }
        at = link.to_epoch;
    }
    Ok(at)
}

/// Whether a member that walked to `arrived` is current against the
/// group's epoch — the cheap check a returning member makes before
/// deciding whether it still needs re-issue (6.1.4).
pub const fn caught_up(arrived: Epoch, group_current: Epoch) -> bool {
    arrived.0 >= group_current.0
}

/// A member absent through any number of rotations remains a member unless
/// revoked (L5 6.1.5 / L5-049). This is stated as a function so the rule
/// has a call site rather than living only in prose: no count of missed
/// rotations, and no length of absence, is an input.
pub fn absence_forfeits_membership(_missed_rotations: u64) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    // Only the tests name a reason directly now: the library reads it through
    // entry.reason, which is the signed copy (see RotationCause::Eviction).
    use crate::certificate::RevocationReason;
    use crate::crypto::{IDENTITY_LEN, SIGNATURE_LEN};
    use crate::identity::Identity;

    const GROUP: Identity = Identity([0xEE; IDENTITY_LEN]);

    /// Rejects the all-0xFF signature used for forgeries below.
    struct GroupSigned;
    impl Verifier for GroupSigned {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], sig: &[u8; SIGNATURE_LEN]) -> bool {
            sig[0] != 0xFF
        }
    }

    fn walk<const N: usize>(
        from: Epoch,
        chain: &[Rotation],
        revoked: &mut RevocationSet<N>,
    ) -> Result<Epoch, WalkError> {
        walk_forward::<GroupSigned, N>(from, chain, &GROUP, revoked)
    }

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    fn eviction(subject: u8, epoch: u64, reason: RevocationReason) -> RevocationEntry {
        RevocationEntry {
            subject: id(subject),
            at_epoch: Epoch(epoch),
            sequence: 0,
            reason,
            signature: [0; SIGNATURE_LEN],
            advisory_time: None,
        }
    }

    fn cadence(to: u64) -> Rotation {
        Rotation {
            to_epoch: Epoch(to),
            cause: RotationCause::Cadence,
            signature: [0; SIGNATURE_LEN],
        }
    }

    fn evicting(to: u64, subject: u8, reason: RevocationReason) -> Rotation {
        Rotation {
            to_epoch: Epoch(to),
            cause: RotationCause::Eviction {
                entry: eviction(subject, to, reason),
            },
            signature: [0; SIGNATURE_LEN],
        }
    }

    /// A verifier that actually BINDS the signature to the message, unlike
    /// [`GroupSigned`] above, which accepts any signature whose first byte
    /// is not 0xFF.
    ///
    /// The distinction is the point of the test below. A content-blind
    /// verifier can show that a *forged* link is refused, because forgery
    /// is spelled 0xFF; it cannot show the property 6.2.4a actually buys,
    /// which is that **stripping the eviction changes the signed bytes**.
    /// That needs a signature computed FROM the message.
    struct Binding;
    impl Binding {
        /// A stand-in for a real signature: a checksum of the message,
        /// which is enough to make the signature depend on every byte.
        fn sign(message: &[u8]) -> [u8; SIGNATURE_LEN] {
            let mut sig = [0u8; SIGNATURE_LEN];
            let mut acc: u64 = 0xcbf2_9ce4_8422_2325;
            for b in message {
                acc ^= u64::from(*b);
                acc = acc.wrapping_mul(0x0000_0100_0000_01b3);
            }
            sig[..8].copy_from_slice(&acc.to_be_bytes());
            sig
        }
    }
    impl Verifier for Binding {
        fn verify(_: &[u8; IDENTITY_LEN], message: &[u8], sig: &[u8; SIGNATURE_LEN]) -> bool {
            Self::sign(message) == *sig
        }
    }

    /// An eviction whose own 6.2.2 signature verifies under [`Binding`],
    /// so a control exercising the whole walk is not stopped by the
    /// entry's signature before it reaches the link's.
    fn signed_evicting(to: u64, subject: u8, reason: RevocationReason) -> Rotation {
        let mut entry = eviction(subject, to, reason);
        let mut buf = [0u8; crate::certificate::REVOCATION_SIGNED_LEN];
        let n = entry.write_signed_bytes(&mut buf);
        entry.signature = Binding::sign(&buf[..n]);
        signed(Rotation {
            to_epoch: Epoch(to),
            cause: RotationCause::Eviction { entry },
            signature: [0; SIGNATURE_LEN],
        })
    }

    /// Sign a link under [`Binding`], as the group secret key would.
    fn signed(mut link: Rotation) -> Rotation {
        let mut buf = [0u8; ROTATION_SIGNED_LEN];
        let n = link.write_signed_bytes(&mut buf);
        link.signature = Binding::sign(&buf[..n]);
        link
    }

    #[test]
    fn stripping_the_eviction_from_a_link_makes_it_fail_to_verify() {
        // L5 6.2.4a Note 1, and this is the ATTACK rather than a property
        // of the Rust type: the attacker takes a genuine eviction link,
        // presents it as routine with the eviction simply omitted, and
        // keeps the signature. Before 6.2.4a was implemented the walk
        // verified only links that CARRIED an eviction, so a link claiming
        // to be routine was never verified at all and this succeeded.
        let genuine = signed_evicting(7, 2, RevocationReason::Compromise);

        let stripped = Rotation {
            to_epoch: genuine.to_epoch,
            cause: RotationCause::Cadence,
            signature: genuine.signature,
        };

        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(6), &[stripped], &GROUP, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(7) }),
            "a link stripped of its eviction must not verify as routine"
        );

        // And the control: the SAME link, unstripped, walks and delivers
        // the eviction — so the refusal above is the stripping and not a
        // verifier that refuses everything.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(6), &[genuine], &GROUP, &mut revoked),
            Ok(Epoch(7))
        );
        assert_eq!(
            revoked.len(),
            1,
            "the genuine link must deliver its eviction"
        );
    }

    #[test]
    fn an_already_held_link_is_still_verified_rather_than_skipped() {
        // 6.2.4a is unconditional — *a member shall reject a link whose
        // signature does not verify* — so a link cannot earn the
        // already-held skip on the strength of an epoch nobody has
        // authenticated. The attacker here appends an unsigned link
        // claiming an epoch the member already passed: it changes no
        // state, which is exactly why an implementation is tempted to let
        // it through, and the clause still says reject.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(9), &[cadence(4)], &GROUP, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(4) })
        );

        // Control: the same already-held link, properly signed, is skipped
        // as ordinary — so the refusal above is the signature and not the
        // epoch.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(9), &[signed(cadence(4))], &GROUP, &mut revoked),
            Ok(Epoch(9))
        );
    }

    #[test]
    fn the_grace_reason_is_the_signed_one_so_it_cannot_be_downgraded() {
        // REFUTATION, 2026-08-17, r2-codex-refute: the variant used to carry
        // its own `reason` beside `entry.reason`, and only the entry's copy
        // was inside the 6.2.4a signature while grace_ticks read the outer
        // one. Flipping the outer copy from Compromise to Retirement left
        // the signature verifying and turned 8.2's mandatory ZERO grace
        // into the deployment's full grace — the very defect this enum's
        // own doc comment says it exists to prevent.
        //
        // The field is gone, so the attack is now unrepresentable rather
        // than merely detected. What this test can still assert is the
        // property that made it unrepresentable: the value grace is
        // computed from is the value the signature covers.
        let link = signed_evicting(7, 2, RevocationReason::Compromise);
        assert_eq!(link.grace_ticks(9_999), 0, "compromise takes zero grace");

        // Change the reason in the ONLY place it exists. The signature must
        // now fail, because the reason is inside the signed bytes — under
        // the old shape this mutation was invisible to the signature.
        let mut downgraded = link;
        if let RotationCause::Eviction { entry } = &mut downgraded.cause {
            entry.reason = RevocationReason::Retirement;
        }
        assert_ne!(
            downgraded.grace_ticks(9_999),
            0,
            "the mutation must actually change grace, or this proves nothing"
        );
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(6), &[downgraded], &GROUP, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(7) }),
            "a reason change must break the link signature"
        );
    }

    /// The same two properties again, under the REAL signature suite.
    ///
    /// Raised by `r2-codex-refute` after it confirmed the fix: every test
    /// above drives `Binding`, a checksum stand-in, and *"no production
    /// Rotation caller or real Ed25519 round trip"* existed. A stand-in
    /// verifier can be wrong in the direction that matters — it is
    /// length-blind, domain-blind, and cannot fail the way a real scheme
    /// fails — so a binding proved only against it is proved against a
    /// model of itself.
    ///
    /// `Ed25519` here is the production implementor from `crate::suite`,
    /// the same one the gate uses, with `verify_strict` behind it.
    #[cfg(feature = "formats-suite")]
    #[test]
    fn the_binding_holds_under_the_real_signature_suite() {
        use crate::suite::Ed25519;
        use ed25519_dalek::{Signer as _, SigningKey};

        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let group = Identity(*sk.verifying_key().as_bytes());

        // Sign a genuine compromise-eviction link exactly as the group
        // secret key would: over write_signed_bytes, and nothing else.
        let mut entry = eviction(2, 7, RevocationReason::Compromise);
        let mut ebuf = [0u8; crate::certificate::REVOCATION_SIGNED_LEN];
        let en = entry.write_signed_bytes(&mut ebuf);
        entry.signature = sk.sign(&ebuf[..en]).to_bytes();

        let mut link = Rotation {
            to_epoch: Epoch(7),
            cause: RotationCause::Eviction { entry },
            signature: [0; SIGNATURE_LEN],
        };
        let mut lbuf = [0u8; ROTATION_SIGNED_LEN];
        let ln = link.write_signed_bytes(&mut lbuf);
        link.signature = sk.sign(&lbuf[..ln]).to_bytes();

        // It walks, and it delivers its eviction.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Ed25519, 8>(Epoch(6), &[link], &group, &mut revoked),
            Ok(Epoch(7))
        );
        assert_eq!(revoked.len(), 1);
        assert_eq!(link.grace_ticks(9_999), 0, "compromise takes zero grace");

        // 6.2.4a Note 1 under real signatures: present it as routine with
        // the eviction omitted, keeping the signature.
        let stripped = Rotation {
            to_epoch: link.to_epoch,
            cause: RotationCause::Cadence,
            signature: link.signature,
        };
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Ed25519, 8>(Epoch(6), &[stripped], &group, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(7) })
        );

        // And the grace downgrade the refutation found, under real
        // signatures: the reason now lives in one signed place, so
        // changing it breaks the link.
        let mut downgraded = link;
        if let RotationCause::Eviction { entry } = &mut downgraded.cause {
            entry.reason = RevocationReason::Retirement;
        }
        assert_ne!(downgraded.grace_ticks(9_999), 0);
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Ed25519, 8>(Epoch(6), &[downgraded], &group, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(7) })
        );
    }

    #[test]
    fn a_routine_link_and_an_eviction_link_can_never_share_signed_bytes() {
        // 6.2.4a Note 2: signing the CAUSE is what makes omission fail, so
        // the two forms must be distinguishable as byte strings. A tag at a
        // fixed offset plus differing lengths is what does it here; assert
        // it rather than trust it, since an ambiguity would make the whole
        // binding decorative.
        let routine = cadence(7);
        let evicting_link = evicting(7, 2, RevocationReason::Compromise);

        let (mut a, mut b) = ([0u8; ROTATION_SIGNED_LEN], [0u8; ROTATION_SIGNED_LEN]);
        let (na, nb) = (
            routine.write_signed_bytes(&mut a),
            evicting_link.write_signed_bytes(&mut b),
        );
        assert_ne!(a[..na], b[..nb], "same epoch, different cause, same bytes");
        assert_ne!(na, nb, "the two forms must differ in length as well");
    }

    #[test]
    fn a_routine_link_is_verified_too() {
        // The other half of 6.2.4a: EVERY link is verified, so an
        // unsigned routine link is refused rather than walked past.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(5), &[cadence(6)], &GROUP, &mut revoked),
            Err(WalkError::UnverifiedLink { at_epoch: Epoch(6) })
        );

        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert_eq!(
            walk_forward::<Binding, 8>(Epoch(5), &[signed(cadence(6))], &GROUP, &mut revoked),
            Ok(Epoch(6))
        );
    }

    #[test]
    fn a_returning_member_receives_every_bound_eviction() {
        // L5 8.4 / 6.2.4: the member was away for epochs 6..9 and must not
        // arrive at 9 still believing subjects 2 and 3 belong.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        let chain = [
            cadence(6),
            evicting(7, 2, RevocationReason::Compromise),
            cadence(8),
            evicting(9, 3, RevocationReason::Eviction),
        ];
        let arrived = walk(Epoch(5), &chain, &mut revoked).unwrap();
        assert_eq!(arrived, Epoch(9));
        assert!(revoked.contains(&id(2)));
        assert!(revoked.contains(&id(3)));
        assert_eq!(revoked.len(), 2);
    }

    #[test]
    fn a_gap_in_the_chain_is_refused_not_skipped() {
        // Arriving at the current epoch without the evictions in between
        // is exactly what the binding exists to prevent.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        let broken = [cadence(6), evicting(9, 3, RevocationReason::Eviction)];
        assert_eq!(
            walk(Epoch(5), &broken, &mut revoked),
            Err(WalkError::ChainBroken {
                expected: Epoch(7),
                found: Epoch(9)
            })
        );
        // Nothing beyond the good prefix was applied.
        assert!(!revoked.contains(&id(3)));
    }

    #[test]
    fn walking_a_partly_known_chain_is_ordinary() {
        // A member that already holds epochs 6 and 7 re-walks harmlessly.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        let chain = [
            cadence(6),
            evicting(7, 2, RevocationReason::Eviction),
            cadence(8),
        ];
        let arrived = walk(Epoch(7), &chain, &mut revoked).unwrap();
        assert_eq!(arrived, Epoch(8));
        // The already-passed eviction is not re-applied as a duplicate.
        assert_eq!(revoked.len(), 0);
    }

    #[test]
    fn an_empty_chain_leaves_a_member_where_it_is() {
        let mut revoked: RevocationSet<4> = RevocationSet::new();
        assert_eq!(walk(Epoch(3), &[], &mut revoked), Ok(Epoch(3)));
    }

    #[test]
    fn a_full_revocation_set_refuses_the_walk() {
        // Arriving under-informed is worse than not arriving: the member
        // would hold current keys and a short revocation set.
        let mut revoked: RevocationSet<1> = RevocationSet::new();
        let chain = [
            evicting(1, 2, RevocationReason::Eviction),
            evicting(2, 3, RevocationReason::Compromise),
        ];
        assert_eq!(
            walk(Epoch(0), &chain, &mut revoked),
            Err(WalkError::RevocationSetFull)
        );
    }

    #[test]
    fn a_forged_bound_eviction_stops_the_walk() {
        // The chain is network data and the set has no removal, so a
        // forged link must never be applied — and the walk must not
        // silently continue past it either.
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        let mut forged = evicting(6, 2, RevocationReason::Eviction);
        if let RotationCause::Eviction { entry, .. } = &mut forged.cause {
            entry.signature = [0xFF; SIGNATURE_LEN];
        }
        let chain = [forged, evicting(7, 3, RevocationReason::Eviction)];
        assert_eq!(
            walk(Epoch(5), &chain, &mut revoked),
            Err(WalkError::ForgedEviction { at_epoch: Epoch(6) })
        );
        assert!(revoked.is_empty(), "a forged eviction entered the set");
    }

    #[test]
    fn compromise_rotations_grant_no_grace_however_long_the_absence() {
        let compromise = evicting(7, 2, RevocationReason::Compromise);
        assert_eq!(compromise.grace_ticks(10_000), 0);
        // A cadence rotation takes the deployment's ordinary grace.
        assert_eq!(cadence(8).grace_ticks(10_000), 10_000);
    }

    #[test]
    fn a_compromise_rotation_cannot_be_stripped_into_a_grace_bearing_one() {
        // The polarity finding: as Option<RevocationReason>, dropping the
        // reason from a compromise rotation silently yielded the
        // deployment's FULL grace — a window in which the rotation has
        // changed nothing (8 Note 1). The entry and its reason now travel
        // together in one variant, so there is no field to drop.
        let compromise = evicting(7, 2, RevocationReason::Compromise);
        assert_eq!(compromise.grace_ticks(10_000), 0);
        assert!(compromise.bound_eviction().is_some());
        // A caller wanting no eviction must say Cadence out loud, and
        // then carries no eviction to strip.
        assert!(cadence(7).bound_eviction().is_none());
    }

    #[test]
    fn absence_never_forfeits_membership() {
        // L5 6.1.5 / L5-049, given a call site so the rule is checkable.
        assert!(!absence_forfeits_membership(0));
        assert!(!absence_forfeits_membership(1));
        assert!(!absence_forfeits_membership(u64::MAX));
    }

    #[test]
    fn caught_up_is_an_epoch_comparison_not_a_clock() {
        assert!(caught_up(Epoch(9), Epoch(9)));
        assert!(caught_up(Epoch(10), Epoch(9)));
        assert!(!caught_up(Epoch(8), Epoch(9)));
    }

    /// ‼ **THE LINK'S SIGNATURE MUST BIND *WHICH* EVICTION, NOT MERELY
    /// *THAT THERE IS ONE* — and until 2026-09-05 nothing here checked it
    /// (`SS591`).**
    ///
    /// 8.3 / `L5-077` says a rotation triggered by an eviction binds that
    /// eviction as 6.2.4 requires. **Three mutations of the span were run
    /// against the whole suite and the results separate cleanly.** Omitting
    /// the entry entirely reddened three existing tests; blanking its
    /// REASON reddened two. **Blanking its SUBJECT reddened NOTHING — all
    /// 334 green.** So the crate proved that an eviction is bound and that
    /// its grading is bound, and never that *which subject* is.
    ///
    /// The near miss is instructive rather than embarrassing:
    /// `stripping_the_eviction_from_a_link_makes_it_fail_to_verify` is
    /// satisfied by the CAUSE TAG alone — an eviction link writes `1` and a
    /// cadence link writes `0` — so the stripping attack it names is caught
    /// without any of the entry ever entering the span. *It measures its
    /// own attack correctly and does not measure this one.*
    ///
    /// So this asserts the excluded case the other cannot: two links at one
    /// epoch, both evictions, **differing only in who is evicted**, must
    /// sign different bytes. Same for the reason, since 8.2 grades grace by
    /// it and an unbound reason is a grace period an attacker chooses.
    ///
    /// # ‼ WHAT THE CONSEQUENCE ACTUALLY IS, STATED HONESTLY
    ///
    /// A substituted subject would still be refused **one line later** —
    /// `walk_forward` verifies each bound eviction under its own signature
    /// before it can enter the set — so this is not a live hole. *That is
    /// exactly what makes it worth a test rather than a shrug:* the
    /// defence-in-depth is what kept every mutation green, and a second
    /// layer that silently carries a first layer's claim is how an
    /// unproved claim survives. The last assertion drives that second layer
    /// so it is measured here rather than assumed.
    #[test]
    fn a_link_binds_which_eviction_it_carries_and_not_merely_that_it_has_one() {
        let alice = evicting(7, 2, RevocationReason::Compromise);
        let bob = evicting(7, 3, RevocationReason::Compromise);
        // PRECONDITION: they differ in the subject and in nothing else, so
        // a failure below cannot be some other field doing the work.
        assert_eq!(alice.to_epoch, bob.to_epoch);
        assert_ne!(alice.cause, bob.cause);

        let mut a = [0u8; ROTATION_SIGNED_LEN];
        let mut b = [0u8; ROTATION_SIGNED_LEN];
        let na = alice.write_signed_bytes(&mut a);
        let nb = bob.write_signed_bytes(&mut b);
        assert_ne!(
            a[..na],
            b[..nb],
            "two rotations evicting DIFFERENT subjects sign the same bytes, so the group's \
             signature says only that somebody was evicted at this epoch — a holder of one \
             genuine link could present it as evicting anybody"
        );

        // The reason likewise: 8.2 grades grace by it, so an unbound reason
        // is a grace period the presenter chooses.
        let retired = evicting(7, 2, RevocationReason::Retirement);
        let mut r = [0u8; ROTATION_SIGNED_LEN];
        let nr = retired.write_signed_bytes(&mut r);
        assert_ne!(
            a[..na],
            r[..nr],
            "a compromise eviction and a retirement of the SAME subject at the SAME epoch sign \
             the same bytes, so 8.2's grading is outside the signature"
        );

        // CONTROL: two links agreeing in every field DO sign the same
        // bytes, so the inequalities above are the fields and not a
        // serialiser that never repeats itself.
        let again = evicting(7, 2, RevocationReason::Compromise);
        let mut c = [0u8; ROTATION_SIGNED_LEN];
        let nc = again.write_signed_bytes(&mut c);
        assert_eq!(a[..na], c[..nc]);

        // And the second layer, driven rather than assumed: a substituted
        // entry is refused by its OWN signature before it can enter a set
        // that has no removal (6.2.1).
        let mut forged = signed_evicting(7, 2, RevocationReason::Compromise);
        if let RotationCause::Eviction { entry } = &mut forged.cause {
            entry.subject = id(3);
        }
        let mut revoked: RevocationSet<8> = RevocationSet::new();
        assert!(
            walk_forward::<Binding, 8>(Epoch(6), &[forged], &GROUP, &mut revoked).is_err(),
            "an entry substituted into a signed link reached the revocation set"
        );
        assert!(revoked.is_empty());
    }
}
