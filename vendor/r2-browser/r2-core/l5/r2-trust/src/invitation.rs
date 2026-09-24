//! **What an invitation carries, and why a ceremony may not start from a bare
//! one (L5B 5.1, 5.2).**
//!
//! # ‼ AN INVITATION WITH NO EVIDENCE IS A CREDENTIAL ANYONE CAN MINT
//!
//! **5.1** names what an invitation states: *the group's identity; the issuing
//! member; the role offered — key holder or not; a single-use code; and a
//! validity bound.* **5.2** binds all of it: *an invitation shall carry the
//! issuing member's member-attributable evidence (Layer 5, 7.4) **over all of
//! 5.1**.*
//!
//! Until this module, `Ceremony::discover` took a bare [`Invitation`] — five
//! fields and nothing attesting them. **Every one of them is a field an
//! attacker would want to choose**: the group it enrols into, the member it
//! claims to come from, the role it offers, the code it burns, and how long it
//! lives.
//!
//! # ‼ *OVER ALL OF 5.1* IS THE PHRASE THAT DOES THE WORK
//!
//! Evidence over *some* of the fields verifies perfectly and attests the wrong
//! document. **The role is the field that shows why**: evidence covering
//! everything but `role` lets a Member invitation be presented as a KeyHolder
//! one — *and 6.3.1 makes the offered role set the verification floor, so the
//! forged upgrade also lowers the bar that would have caught it.* The code is
//! the same shape one field along: evidence covering everything but `code`
//! makes one signed invitation authorise **any** code.
//!
//! So the statement is **the whole of 5.1 in a fixed layout**, and the test
//! that matters flips each field in turn and asserts the statement moves.
//!
//! # ‼ AND THE CHECK IS A TYPE RATHER THAN A CALL A CALLER MUST REMEMBER
//!
//! [`AuthorisedInvitation`] has **no public constructor**. The only way to
//! obtain one is [`authorise_invitation`], and `Ceremony::discover` takes one
//! — *so a ceremony cannot begin from an invitation nobody checked, and the
//! rule is not a step a caller might skip.*
//!
//! # What this does NOT do
//!
//! It performs no cryptography of its own: [`verify_evidence`] does the chain
//! — certificate authentic under the group key, statement authentic under the
//! certificate's subject, freshness — and this module adds the two questions
//! that are **about the invitation** rather than about the evidence: *does the
//! signed statement cover exactly this invitation*, and *is the signer the
//! member the invitation names*.

use crate::ceremony::{Invitation, Role};
use crate::crypto::Verifier;
use crate::evidence::{verify_evidence, EvidenceRefusal, HighWaterMarks, MemberEvidence};
use crate::identity::Identity;

/// The signed statement's length: **the whole of 5.1, in a fixed layout.**
///
/// 32 (group) + 32 (issuing member) + 1 (role) + 16 (code) + 8 (validity).
pub const INVITATION_STATEMENT_LEN: usize = 32 + 32 + 1 + 16 + 8;

/// The role byte, **written by an exhaustive match and never by a cast.**
///
/// ‼ A `role as u8` would publish whatever the discriminants happen to be and
/// **renumber them silently** the day a variant is inserted — after which
/// evidence signed under the old numbering would verify against a different
/// role. *The same defect this workspace has already met twice on enum casts.*
const fn role_byte(role: Role) -> u8 {
    match role {
        Role::Member => 0x01,
        Role::KeyHolder => 0x02,
    }
}

/// **5.1 as bytes: the statement 5.2's evidence must be over.**
///
/// Fixed positions and fixed widths, so **no field can absorb another's
/// bytes** — a length-prefixed or delimiter-separated encoding would let a
/// crafted code and a crafted validity bound trade places and hash alike.
pub fn invitation_statement(
    invitation: &Invitation,
    out: &mut [u8; INVITATION_STATEMENT_LEN],
) -> usize {
    let mut at = 0;
    out[at..at + 32].copy_from_slice(&invitation.group.0);
    at += 32;
    out[at..at + 32].copy_from_slice(&invitation.issuing_member.0);
    at += 32;
    out[at] = role_byte(invitation.role);
    at += 1;
    out[at..at + 16].copy_from_slice(&invitation.code);
    at += 16;
    out[at..at + 8].copy_from_slice(&invitation.validity.0.to_be_bytes());
    at += 8;
    at
}

/// Why an invitation was not authorised.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InvitationRefusal {
    /// **5.2**: the evidence is over something other than this invitation.
    ///
    /// ‼ **A SIGNATURE THAT VERIFIES OVER A DIFFERENT STATEMENT IS A VALID
    /// SIGNATURE OVER SOMETHING ELSE.** It is not a forgery and nothing about
    /// it looks wrong; it simply does not attest what is being presented.
    EvidenceDoesNotCoverTheInvitation,
    /// **5.2**: the evidence is attributable to a member — *just not the one
    /// the invitation names as its issuer.*
    ///
    /// **A separate refusal from the one above on purpose.** Both mean the
    /// invitation is unauthorised, and they send an operator to different
    /// places: one is a wrong or altered document, the other is a member
    /// signing for an issuer it is not.
    EvidenceIsNotTheIssuingMembers {
        /// Who actually signed. **Named, because *unauthorised* alone leaves
        /// an operator with nothing to look at.**
        attributed_to: Identity,
    },
    /// The evidence chain itself failed (L5 7.4), reported unchanged.
    Evidence(EvidenceRefusal),
}

/// An invitation whose evidence has been checked (5.2).
///
/// ‼ **NO PUBLIC CONSTRUCTOR, AND THAT IS THE ENFORCEMENT.** A ceremony takes
/// one of these rather than an [`Invitation`], so *the check is a thing the
/// type system required rather than a step a caller had to remember.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AuthorisedInvitation {
    invitation: Invitation,
    issuer: Identity,
}

impl AuthorisedInvitation {
    /// The invitation, now safe to act on.
    pub const fn invitation(&self) -> Invitation {
        self.invitation
    }

    /// The member the evidence was attributed to — **equal to the
    /// invitation's `issuing_member` by construction**, and exposed so a
    /// caller can log the attribution without re-deriving it.
    pub const fn issuer(&self) -> Identity {
        self.issuer
    }
}

/// **5.2: check the issuing member's evidence over all of 5.1.**
///
/// The group verified against is **the invitation's own**, which is what makes
/// the binding meaningful: evidence from a member of some other group cannot
/// authorise an enrolment into this one, and `verify_evidence` refuses it as
/// `WrongGroup`.
///
/// ‼ **THE COVERAGE CHECK COMES FIRST.** It is the question *what was
/// signed*, and every check after it reasons about "the statement" — running
/// the chain first would verify a perfectly good signature over a document
/// nobody is presenting, and only then discover it was the wrong one.
pub fn authorise_invitation<V: Verifier, const N: usize>(
    invitation: &Invitation,
    evidence: &MemberEvidence<'_>,
    cert_is_current: bool,
    cert_authentic: bool,
    expected_nonce: Option<&[u8; 16]>,
    marks: &mut HighWaterMarks<N>,
) -> Result<AuthorisedInvitation, InvitationRefusal> {
    let mut expected = [0u8; INVITATION_STATEMENT_LEN];
    let n = invitation_statement(invitation, &mut expected);
    if evidence.statement != &expected[..n] {
        return Err(InvitationRefusal::EvidenceDoesNotCoverTheInvitation);
    }

    let attributed = verify_evidence::<V, N>(
        evidence,
        &invitation.group,
        cert_is_current,
        cert_authentic,
        expected_nonce,
        marks,
    )
    .map_err(InvitationRefusal::Evidence)?;

    // ‼ **5.2 SAYS *THE ISSUING MEMBER'S* EVIDENCE.** Any member of the group
    // can produce evidence that verifies; only one of them is the member this
    // invitation says it came from, and 4.4 makes enrolment the province of a
    // member holding custody rather than of members generally.
    if attributed != invitation.issuing_member {
        return Err(InvitationRefusal::EvidenceIsNotTheIssuingMembers {
            attributed_to: attributed,
        });
    }

    Ok(AuthorisedInvitation {
        invitation: *invitation,
        issuer: attributed,
    })
}

impl AuthorisedInvitation {
    /// ‼ **TEST-ONLY, `pub(crate)`, AND NAMED FOR WHAT IT SKIPS.** A ceremony
    /// test needs a token without standing up a certificate chain and a
    /// signature double; *nothing outside this crate can reach it*, and
    /// `git grep taken_as_authorised_for_test` finds every place a check was
    /// bypassed. **The name is the audit** — `for_test` alone would read as a
    /// convenience rather than as a hole.
    #[cfg(test)]
    pub(crate) const fn taken_as_authorised_for_test(invitation: Invitation) -> Self {
        Self {
            issuer: invitation.issuing_member,
            invitation,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::{Certificate, Epoch};
    use crate::crypto::{IDENTITY_LEN, SIGNATURE_LEN};
    use crate::evidence::Freshness;

    struct AlwaysValid;
    impl Verifier for AlwaysValid {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], _: &[u8; SIGNATURE_LEN]) -> bool {
            true
        }
    }

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    const GROUP: u8 = 1;
    const ISSUER: u8 = 2;

    fn invite() -> Invitation {
        Invitation {
            group: id(GROUP),
            issuing_member: id(ISSUER),
            role: Role::Member,
            code: [7; 16],
            validity: Epoch(100),
        }
    }

    fn evidence_over<'a>(statement: &'a [u8], subject: u8) -> MemberEvidence<'a> {
        MemberEvidence {
            certificate: Certificate {
                subject: id(subject),
                group: id(GROUP),
                issued_at: Epoch(1),
                signature: [0; SIGNATURE_LEN],
            },
            statement,
            freshness: Freshness::Nonce([9; 16]),
            signature: [0; SIGNATURE_LEN],
        }
    }

    fn authorise(
        inv: &Invitation,
        ev: &MemberEvidence<'_>,
    ) -> Result<AuthorisedInvitation, InvitationRefusal> {
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        authorise_invitation::<AlwaysValid, 4>(inv, ev, true, true, Some(&[9; 16]), &mut marks)
    }

    /// ‼ **EVERY FIELD OF 5.1 PARTICIPATES, AND THIS IS THE TEST THAT SAYS
    /// SO.** *Evidence over SOME of the fields verifies perfectly and attests
    /// the wrong document* — so each field is changed in turn and the
    /// statement must move.
    #[test]
    fn the_statement_covers_all_of_5_1_and_moves_when_any_field_does() {
        let base = invite();
        let mut b = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&base, &mut b);
        assert_eq!(n, INVITATION_STATEMENT_LEN, "the whole layout is written");

        let variants = [
            Invitation {
                group: id(9),
                ..base
            },
            Invitation {
                issuing_member: id(9),
                ..base
            },
            Invitation {
                role: Role::KeyHolder,
                ..base
            },
            Invitation {
                code: [8; 16],
                ..base
            },
            Invitation {
                validity: Epoch(101),
                ..base
            },
        ];
        for (i, v) in variants.iter().enumerate() {
            let mut o = [0u8; INVITATION_STATEMENT_LEN];
            invitation_statement(v, &mut o);
            assert_ne!(o, b, "field {i} of 5.1 does not reach the statement");
        }
    }

    /// ‼ **THE ROLE IS THE FIELD THAT SHOWS WHY *OVER ALL OF 5.1* MATTERS.**
    /// Evidence covering everything but `role` would let a Member invitation
    /// be presented as a KeyHolder one — *and 6.3.1 makes the offered role set
    /// the verification floor, so the forged upgrade also lowers the bar that
    /// would have caught it.*
    #[test]
    fn evidence_signed_over_a_different_role_does_not_authorise_the_upgrade() {
        let member = invite();
        let mut signed = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&member, &mut signed);

        // The same invitation, presented with the role raised.
        let upgraded = Invitation {
            role: Role::KeyHolder,
            ..member
        };
        let ev = evidence_over(&signed[..n], ISSUER);
        assert_eq!(
            authorise(&upgraded, &ev),
            Err(InvitationRefusal::EvidenceDoesNotCoverTheInvitation)
        );
        // And the invitation actually signed still authorises.
        assert!(authorise(&member, &ev).is_ok());
    }

    /// The same shape one field along: **evidence that did not cover the code
    /// would make one signed invitation authorise any code.**
    #[test]
    fn evidence_signed_over_a_different_code_does_not_authorise_this_one() {
        let signed_inv = invite();
        let mut signed = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&signed_inv, &mut signed);
        let presented = Invitation {
            code: [8; 16],
            ..signed_inv
        };
        let ev = evidence_over(&signed[..n], ISSUER);
        assert_eq!(
            authorise(&presented, &ev),
            Err(InvitationRefusal::EvidenceDoesNotCoverTheInvitation)
        );
    }

    /// ‼ **5.2 SAYS *THE ISSUING MEMBER'S* EVIDENCE.** Any member of the
    /// group can produce evidence that verifies; only one of them is the
    /// member this invitation says it came from.
    #[test]
    fn evidence_from_another_member_of_the_same_group_is_refused_and_names_the_signer() {
        let inv = invite();
        let mut signed = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&inv, &mut signed);
        // A different member of the SAME group signs the SAME statement.
        let ev = evidence_over(&signed[..n], 5);
        assert_eq!(
            authorise(&inv, &ev),
            Err(InvitationRefusal::EvidenceIsNotTheIssuingMembers {
                attributed_to: id(5)
            }),
            "and it names the signer: `unauthorised` alone leaves an operator \
             with nothing to look at"
        );
    }

    /// A well-formed invitation with its issuer's evidence authorises, and the
    /// token carries the attribution.
    #[test]
    fn an_invitation_with_its_issuers_evidence_over_all_of_5_1_authorises() {
        let inv = invite();
        let mut signed = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&inv, &mut signed);
        let ev = evidence_over(&signed[..n], ISSUER);
        let ok = authorise(&inv, &ev).expect("issuer's evidence over all of 5.1");
        assert_eq!(ok.invitation(), inv);
        assert_eq!(ok.issuer(), id(ISSUER));
    }

    /// The evidence chain's own refusals are reported unchanged — this module
    /// adds the two questions that are **about the invitation** and does no
    /// cryptography of its own.
    #[test]
    fn an_evidence_chain_failure_is_reported_as_itself() {
        let inv = invite();
        let mut signed = [0u8; INVITATION_STATEMENT_LEN];
        let n = invitation_statement(&inv, &mut signed);
        let ev = evidence_over(&signed[..n], ISSUER);
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        // Certificate not authentic under the group key.
        assert_eq!(
            authorise_invitation::<AlwaysValid, 4>(
                &inv,
                &ev,
                true,
                false,
                Some(&[9; 16]),
                &mut marks
            ),
            Err(InvitationRefusal::Evidence(
                EvidenceRefusal::CertificateNotAuthentic
            ))
        );
    }

    /// ‼ **THE ROLE BYTE IS WRITTEN BY AN EXHAUSTIVE MATCH, NOT A CAST**, so
    /// a variant inserted later cannot silently renumber what was signed.
    #[test]
    fn the_two_roles_are_distinct_bytes_and_are_stated_rather_than_cast() {
        assert_eq!(role_byte(Role::Member), 0x01);
        assert_eq!(role_byte(Role::KeyHolder), 0x02);
    }
}
