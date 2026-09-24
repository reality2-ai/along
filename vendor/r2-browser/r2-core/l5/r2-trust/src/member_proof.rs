//! Verified membership for one attributed request (L5 6.1, 7.4).
//!
//! Unlike the lower-level evidence helper, this path computes certificate
//! authenticity and currency instead of accepting boolean assertions. It uses
//! the existing certificate encoding, which remains `PROVISIONAL(SS489)`.
//! The caller supplies a trusted crypto backend and the target group's locally
//! held policy/revocation state. This is not provisioning or policy discovery.

use crate::certificate::{standing, AcceptanceDepth, Epoch, RevocationSet, Standing};
use crate::crypto::Verifier;
use crate::evidence::{verify_evidence, EvidenceRefusal, HighWaterMarks, MemberEvidence};
use crate::identity::Identity;

#[path = "member_proof/challenge.rs"]
mod challenge;
pub use challenge::{Challenge, IssueRefusal, OwnedChallenge};

/// Locally held verification context, not facts accepted from a request.
/// The revocation set must belong to `group`. Freshness marks passed to [`verify`]
/// must also be retained per group; this module does not persist either store.
pub struct Context<'a, const R: usize> {
    pub group: &'a Identity,
    pub current_epoch: Epoch,
    pub acceptance_depth: AcceptanceDepth,
    pub revoked: &'a RevocationSet<R>,
}

/// Local refusal; a protocol endpoint must apply its own silence rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The signed operation is not the operation being requested.
    StatementMismatch,
    Evidence(EvidenceRefusal),
    ChallengeUnavailable,
    ChallengeExpired,
    ChallengeClockReversed,
    UnexpectedMember,
}

/// Evidence verified for a particular group, member and request.
///
/// Only [`verify`] constructs this value. It is intentionally neither `Copy`
/// nor `Clone`: consume it at the answering boundary for this request, not as a
/// reusable login credential. It records verification against the supplied state
/// at that instant, not immunity from later revocation or policy changes.
/// The receiver must compare both [`Self::group`] and [`Self::statement`].
///
/// ```compile_fail
/// use r2_trust::{identity::Identity, member_proof::VerifiedMember};
/// let _ = VerifiedMember { group: Identity([0; 32]), subject: Identity([0; 32]), statement: b"query" };
/// ```
#[derive(Debug)]
pub struct VerifiedMember<'a> {
    group: Identity,
    subject: Identity,
    statement: &'a [u8],
}

impl VerifiedMember<'_> {
    #[must_use]
    pub fn group(&self) -> &Identity {
        &self.group
    }

    #[must_use]
    pub fn subject(&self) -> &Identity {
        &self.subject
    }

    #[must_use]
    pub fn statement(&self) -> &[u8] {
        self.statement
    }
}

/// Verify the complete chain and freshness for the exact requested statement.
///
/// A nonce must have been issued by the verifier for this exchange and retired
/// after use. This raw primitive does not own that lifecycle; [`Challenge`] does
/// for interactive consumers. Counter marks advance only after all checks pass.
/// Supplying a nonce requires nonce evidence; an otherwise valid counter cannot
/// answer it. Without an issued nonce, only counter evidence can establish freshness.
/// Certificate signed bytes remain `PROVISIONAL(SS489)`.
pub fn verify<'a, V: Verifier, const R: usize, const N: usize>(
    evidence: &MemberEvidence<'a>,
    context: &Context<'_, R>,
    expected_statement: &[u8],
    expected_nonce: Option<&[u8; 16]>,
    marks: &mut HighWaterMarks<N>,
) -> Result<VerifiedMember<'a>, Refusal> {
    if evidence.statement != expected_statement {
        return Err(Refusal::StatementMismatch);
    }
    if &evidence.certificate.group != context.group {
        return Err(Refusal::Evidence(EvidenceRefusal::WrongGroup));
    }
    let authentic = evidence.certificate.verifies::<V>();
    let current = standing(
        &evidence.certificate,
        context.current_epoch,
        context.acceptance_depth,
        context.revoked,
    ) == Standing::Current;
    let subject = verify_evidence::<V, N>(
        evidence,
        context.group,
        current,
        authentic,
        expected_nonce,
        marks,
    )
    .map_err(Refusal::Evidence)?;
    Ok(VerifiedMember {
        group: *context.group,
        subject,
        statement: evidence.statement,
    })
}
