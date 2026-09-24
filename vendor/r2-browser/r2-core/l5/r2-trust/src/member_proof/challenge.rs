//! One bounded interactive exchange, with no wire codec or persistent state.

use core::num::NonZeroU64;
use r2_hal_traits::time::Ticks;

use super::{Context, Refusal, VerifiedMember};
use crate::{
    crypto::Verifier,
    evidence::{HighWaterMarks, MemberEvidence, MAX_STATEMENT},
    identity::Identity,
    keygen::ConformingEntropy,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IssueRefusal {
    StatementTooLong,
    EntropyUnavailable,
}

/// Owns the verifier nonce and its exact group/request/optional member binding.
///
/// No Clone, restoration or nonce-setting constructor exists. Recreating an
/// exchange after restart requires fresh conforming entropy. The owner chooses
/// a nonzero lifetime in its own monotonic tick domain; no wall clock or default
/// physical timeout is supplied. A failed reply never extends that lifetime.
pub type Challenge<'a> = BoundChallenge<&'a [u8]>;

/// The same nonce owner with a fixed-size owned statement. It can move between
/// receive turns without borrowing a packet buffer or allocating memory.
pub type OwnedChallenge<const N: usize> = BoundChallenge<[u8; N]>;

/// Storage-generic implementation shared by borrowed and owned challenges.
/// Fields remain private; neither form accepts a caller-chosen nonce.
pub struct BoundChallenge<S> {
    group: Identity,
    member: Option<Identity>,
    statement: S,
    nonce: Option<[u8; 16]>,
    issued: Ticks,
    last_observed: Ticks,
    lifetime: NonZeroU64,
}

impl<S> core::fmt::Debug for BoundChallenge<S> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Challenge")
            .field("active", &self.nonce.is_some())
            .finish_non_exhaustive()
    }
}

impl<S: AsRef<[u8]>> BoundChallenge<S> {
    pub fn issue<E: ConformingEntropy>(
        entropy: &mut E,
        group: &Identity,
        member: Option<&Identity>,
        statement: S,
        now: Ticks,
        lifetime: NonZeroU64,
    ) -> Result<Self, IssueRefusal> {
        if statement.as_ref().len() > MAX_STATEMENT {
            return Err(IssueRefusal::StatementTooLong);
        }
        let mut draw = [0; 32];
        if !entropy.try_fill(&mut draw) {
            return Err(IssueRefusal::EntropyUnavailable);
        }
        let mut nonce = [0; 16];
        nonce.copy_from_slice(&draw[..16]);
        Ok(Self {
            group: *group,
            member: member.copied(),
            statement,
            nonce: Some(nonce),
            issued: now,
            last_observed: now,
            lifetime,
        })
    }

    /// Bytes to send to the prover. Expiry is checked at verification; Some
    /// does not assert that a lifetime has not elapsed since the last call.
    pub const fn nonce(&self) -> Option<[u8; 16]> {
        self.nonce
    }

    pub fn cancel(&mut self) {
        self.nonce = None;
    }

    /// Verify under current trusted local policy and retire before returning
    /// the proof. Bad evidence preserves a still-live exchange; expiry and any
    /// observed clock reversal retire it. Counter evidence cannot answer it.
    pub fn verify<'e, V: Verifier, const R: usize>(
        &mut self,
        evidence: &MemberEvidence<'e>,
        context: &Context<'_, R>,
        expected_statement: &[u8],
        now: Ticks,
    ) -> Result<VerifiedMember<'e>, Refusal> {
        let nonce = self.nonce.ok_or(Refusal::ChallengeUnavailable)?;
        if now.since(self.last_observed).is_none() {
            self.cancel();
            return Err(Refusal::ChallengeClockReversed);
        }
        self.last_observed = now;
        let Some(age) = now.since(self.issued) else {
            self.cancel();
            return Err(Refusal::ChallengeClockReversed);
        };
        if age >= self.lifetime.get() {
            self.cancel();
            return Err(Refusal::ChallengeExpired);
        }
        if expected_statement != self.statement.as_ref() || evidence.statement != expected_statement
        {
            return Err(Refusal::StatementMismatch);
        }
        if context.group != &self.group {
            return Err(Refusal::Evidence(
                crate::evidence::EvidenceRefusal::WrongGroup,
            ));
        }
        if self
            .member
            .is_some_and(|member| member != evidence.certificate.subject)
        {
            return Err(Refusal::UnexpectedMember);
        }
        // A nonce exchange cannot update a counter table. The raw verifier
        // enforces the nonce mode before this zero-capacity table is consulted.
        let verified = super::verify::<V, R, 0>(
            evidence,
            context,
            self.statement.as_ref(),
            Some(&nonce),
            &mut HighWaterMarks::new(),
        )?;
        self.cancel();
        Ok(verified)
    }
}
