//! **L5B: the enrolment ceremony** — how a device becomes a member.
//!
//! ‼ **THE SHAPE OF THIS MODULE IS THE CLAUSE ORDER, BECAUSE 6.1.1 SAYS
//! *IN THE FOLLOWING ORDER*.** Discovery, exchange, verification, request,
//! install, announcement. Every step is reachable only from its
//! predecessor, and the two that matter most are stated where they are
//! enforced rather than only here.
//!
//! # What a person contributes
//!
//! *4.1 Note 1: **remote authority changes code; hands change membership.**
//! The ceremony is the hands' half. What the person contributes is not
//! computation but **witness** — that this device, physically here, is the
//! one being admitted.*
//!
//! # The capability to enrol is the custody
//!
//! *4.4 Note 1: the certificate the ceremony installs is signed by the
//! group's secret key, so **the capability to enrol IS the custody** —
//! there is no separate enrolment permission to grant, forget, or steal.*
//! Which is why [`Role`] has two values and no permission field.

use crate::certificate::{Certificate, Epoch};
use crate::crypto::Verifier;
use crate::identity::Identity;
use crate::membership::{ClaimState, Minted, Persona};
use r2_hal_traits::build_mode::BuildMode;

/// What membership the invitation offers (5.1).
///
/// ‼ **KEY HOLDER OR NOT, AND NOTHING ELSE.** *A group decides who may grow
/// it exactly when it decides who holds its secret*, so this is the whole
/// of the enrolment permission model — **there is no third value and no
/// separate "may enrol" flag to drift out of step with custody.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Ordinary membership: no custody of the group secret.
    Member,
    /// Membership **with** custody of the group secret (L5 5.3.1), and with
    /// it the capability to enrol further devices (4.4).
    KeyHolder,
}

/// How co-presence was evidenced (6.3.1).
///
/// **Ordered**, because 6.3.1 says the offered role sets a **floor**.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum VerificationGrade {
    /// A person compares a short verification string rendered at both
    /// endpoints — or rendered at one and confirmed at the other.
    GlanceConfirmed,
    /// A physical cable carries the ceremony; **the wire is the
    /// co-presence.**
    Anchored,
    /// Anchored, **and** a person confirms at a person-authentication level
    /// the invitation states. **The floor for custody of the group secret.**
    AnchoredPlusPerson,
}

impl Role {
    /// The floor this role sets (6.3.1's third column).
    ///
    /// ‼ **CUSTODY REQUIRES A PERSON, AND THAT IS THE WHOLE TABLE'S POINT.**
    /// *Enrolling a key holder hands over the ability to grow the group*,
    /// so the wire alone is not enough however trustworthy the cable.
    pub fn floor(self) -> VerificationGrade {
        match self {
            Role::Member => VerificationGrade::GlanceConfirmed,
            Role::KeyHolder => VerificationGrade::AnchoredPlusPerson,
        }
    }
}

/// An invitation (5.1).
///
/// ‼ **ALL FIVE THINGS 5.1 NAMES ARE FIELDS AND NONE IS OPTIONAL.** An
/// invitation missing its role would be one whose floor nobody could
/// compute (6.3.1); missing its code, one no install could consume (5.3 a).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Invitation {
    /// The group's identity.
    pub group: Identity,
    /// The issuing member.
    pub issuing_member: Identity,
    /// The role offered — **key holder or not**.
    pub role: Role,
    /// A single-use code.
    pub code: [u8; 16],
    /// ‼ **EVALUATED BY THE PROVISIONER'S SIDE, ON ITS OWN RULER (5.4)** —
    /// *the candidate shall not be required to evaluate it.* A fresh device
    /// has no clock and no reason to be trusted with one, and requiring it
    /// to judge validity would make enrolment depend on the least
    /// established party's least reliable faculty.
    pub validity: Epoch,
}

/// Why a ceremony is being stopped (7.1).
///
/// ‼ **THE CAUSE IS AN INPUT BECAUSE 5.3 TURNS ON IT**, and the two failures
/// look identical from the stage the ceremony is sitting at: *a mismatch or a
/// decline voids the invitation; a transport failure before verification does
/// not.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AbortCause {
    /// 5.3 b): the comparison failed, or a person declined (6.4.1).
    VerificationFailedOrDeclined,
    /// 5.3 c): the exchange died for transport reasons.
    TransportFailure,
    /// Anything else — a timeout, an operator, a caller that will not say.
    ///
    /// **Voids, deliberately**: *an invitation that survives an unexplained
    /// abort is a live credential nobody is watching.*
    Unstated,
}

/// Why a ceremony step was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CeremonyRefusal {
    /// 6.1.1: the sequence was not followed.
    OutOfOrder { at: Stage, attempted: Stage },
    /// 4.3: **a device in claim state OWNER shall not present itself as
    /// claimable, on any surface.**
    NotOpen { state: ClaimState },
    /// 4.5: **the ceremony shall proceed only between devices of the same
    /// build mode.**
    BuildModeMismatch {
        candidate: BuildMode,
        provisioner: BuildMode,
    },
    /// ‼ **6.2.2: A CONTRIBUTION IS ABSENT OR DEGENERATE — *a result an
    /// observer could compute*.** 6.2.2 requires the rejection to **state
    /// that reason**, so it is its own variant and not folded into a
    /// general failure.
    DegenerateContribution { party: Party },
    /// 6.2.1: the provisioner revealed before the candidate committed.
    RevealBeforeCommit,
    /// 6.1.1 e: the bundle's certificate is not over the key the candidate
    /// requested under d) — it is for some other keypair.
    CertificateNotOverRequestedKey,
    /// 6.1.1 e: the certificate binds the key to a group other than the
    /// invitation's.
    CertificateForAnotherGroup,
    /// L5 6.1.1: the certificate does not verify under the group's identity.
    CertificateUnverified,
    /// 6.3.1: the grade reached is below the floor the offered role sets.
    BelowRoleFloor {
        floor: VerificationGrade,
        reached: VerificationGrade,
    },
    /// 6.3.3 / 5.3 b): the ceremony was aborted and the invitation voided.
    Aborted { voided: bool },
    /// 5.3 a): this invitation was already consumed by an install.
    InvitationConsumed,
    /// 5.4: the validity bound has passed, judged on the provisioner's
    /// ruler.
    InvitationExpired,
    /// ‼ **4.4: A MEMBER WITHOUT CUSTODY OF THE GROUP SECRET CANNOT ENROL
    /// DEVICES.**
    ///
    /// *Note 1: the certificate the ceremony installs is signed by the
    /// group's secret key, so **the capability to enrol IS the custody** —
    /// there is no separate enrolment permission to grant, forget, or
    /// steal.* This refusal is therefore **modelling a fact rather than
    /// enforcing a policy**: a non-custodian could not produce the
    /// certificate anyway, and refusing at discovery means it does not
    /// waste a candidate's ceremony to find that out at the install.
    ProvisionerHoldsNoCustody,
}

/// Which side of the ceremony (4.1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Party {
    Candidate,
    Provisioner,
}

/// Where a ceremony has got to (6.1.1 a–f).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Stage {
    /// a) the provisioner found the candidate and confirmed claimability
    /// **by asking** — *no beacon field carries claim state* (4.1 Note 2).
    Discovered,
    /// b) the candidate has committed to its contribution and nothing else
    /// has happened yet (6.2.1).
    Committed,
    /// b) both contributions are in and the session is derived.
    Exchanged,
    /// c) verified at or above the role's floor.
    Verified,
    /// d) the claim request is out: the code and the **public** half of a
    /// keypair the candidate generated itself.
    Requested,
    /// e) installed and committed atomically — persona in, claim state
    /// OWNER, in one commit.
    Installed,
    /// f) announced to the group.
    Announced,
    /// Aborted. **Terminal.**
    Aborted,
}

/// An enrolment ceremony in progress.
///
/// ‼ **EXACTLY TWO PROTOCOL PARTIES (4.1)**, and the person of 6.4.1 is not
/// one of them — *what the person contributes is witness, not
/// computation*, which is why a person's confirmation is an input to
/// verification and never a party with state here.
#[derive(Debug, PartialEq, Eq)]
pub struct Ceremony {
    invitation: Invitation,
    stage: Stage,
    candidate_commitment: Option<[u8; 32]>,
    candidate_contribution: Option<[u8; 32]>,
    provisioner_contribution: Option<[u8; 32]>,
    /// The key the candidate requested a certificate over (6.1.1 d), held
    /// so the install can refuse a bundle over any other key.
    requested: Option<Minted>,
    /// 5.3: consumed by the install it authorised, voided by an abort.
    invitation_voided: bool,
    invitation_consumed: bool,
    /// 6.3.3: **one-shot within this exchange.**
    comparison_attempted: bool,
}

impl Ceremony {
    /// a) **discovery** — claimability confirmed **by asking**, and the
    /// build modes matched.
    ///
    /// ‼ **4.2's FIRST OPEN CHECK IS NOT HERE, AND 4.3's IS.** 4.3 says an
    /// OWNER device *shall not present itself as claimable*; 4.2's two
    /// checks are *before the claim request is emitted* and *again
    /// immediately before the install commits*. **They are different
    /// obligations with different subjects** — this one is about what a
    /// device says about itself, and the other two are about what the
    /// candidate re-confirms about its own state.
    /// ‼ **TAKES AN [`AuthorisedInvitation`](crate::invitation::AuthorisedInvitation)
    /// AND NOT A BARE ONE, WHICH IS 5.2 MADE UNSKIPPABLE.** *An invitation
    /// with no evidence is a credential anyone can mint* — five fields naming
    /// the group, the issuing member, the role, the code and the validity
    /// bound, every one of them a field an attacker would want to choose.
    /// **The token has no public constructor**, so a ceremony cannot begin
    /// from an invitation nobody checked.
    pub fn discover(
        authorised: crate::invitation::AuthorisedInvitation,
        candidate_state: ClaimState,
        candidate_mode: BuildMode,
        provisioner_mode: BuildMode,
        provisioner_role: Role,
        now: Epoch,
    ) -> Result<Self, CeremonyRefusal> {
        let invitation = authorised.invitation();
        // ‼ 4.4 FIRST, BECAUSE IT IS ABOUT WHETHER THIS CEREMONY CAN
        // HAPPEN AT ALL. *A member without custody cannot enrol devices* —
        // and finding that out at the install would have spent a
        // candidate's whole ceremony to learn something knowable before it
        // began.
        if provisioner_role != Role::KeyHolder {
            return Err(CeremonyRefusal::ProvisionerHoldsNoCustody);
        }
        if candidate_state != ClaimState::Open {
            return Err(CeremonyRefusal::NotOpen {
                state: candidate_state,
            });
        }
        if candidate_mode != provisioner_mode {
            return Err(CeremonyRefusal::BuildModeMismatch {
                candidate: candidate_mode,
                provisioner: provisioner_mode,
            });
        }
        // 5.4: the PROVISIONER's ruler, and this is the provisioner's call.
        if now.0 > invitation.validity.0 {
            return Err(CeremonyRefusal::InvitationExpired);
        }
        Ok(Self {
            invitation,
            stage: Stage::Discovered,
            candidate_commitment: None,
            candidate_contribution: None,
            provisioner_contribution: None,
            requested: None,
            invitation_voided: false,
            invitation_consumed: false,
            comparison_attempted: false,
        })
    }

    pub fn stage(&self) -> Stage {
        self.stage
    }

    /// The invitation this ceremony is running, as authorised at discovery.
    ///
    /// **Read-only and by value**: 5.3 makes the invitation single-use and
    /// this type owns that lifecycle, so *a caller holding a mutable handle
    /// could void or unvoid it behind the ceremony's back.*
    pub const fn invitation(&self) -> Invitation {
        self.invitation
    }

    pub fn invitation_is_voided(&self) -> bool {
        self.invitation_voided
    }

    /// b) the candidate **commits** to its contribution (6.2.1).
    ///
    /// ‼ **COMMIT BEFORE REVEAL FORECLOSES THE CO-LOCATED ATTACKER'S ONE
    /// GOOD MOVE** (Note 1): *grinding ephemeral values until the short
    /// verification string collides with the one the person is about to
    /// read.* **Committed first, the candidate's contribution is fixed
    /// before the attacker sees anything to grind against.**
    pub fn candidate_commits(&mut self, commitment: [u8; 32]) -> Result<(), CeremonyRefusal> {
        self.require(Stage::Discovered, Stage::Committed)?;
        self.stage = Stage::Committed;
        self.candidate_commitment = Some(commitment);
        Ok(())
    }

    /// b) the provisioner **reveals**, then the candidate reveals, and the
    /// session is derived (6.2.1).
    ///
    /// ‼ **REACHABLE ONLY FROM `Committed`, WHICH IS THE ORDERING THE
    /// ATTACK TURNS ON.** A provisioner that could reveal first would hand
    /// the grinder exactly the target it needs.
    ///
    /// 6.2.2: **a contribution that is absent or degenerate — *a result an
    /// observer could compute* — is rejected, and the rejection names which
    /// party**, because the clause requires the reason stated.
    pub fn exchange(
        &mut self,
        provisioner_contribution: [u8; 32],
        candidate_contribution: [u8; 32],
    ) -> Result<(), CeremonyRefusal> {
        self.require(Stage::Committed, Stage::Exchanged)?;
        if is_degenerate(&provisioner_contribution) {
            return Err(CeremonyRefusal::DegenerateContribution {
                party: Party::Provisioner,
            });
        }
        if is_degenerate(&candidate_contribution) {
            return Err(CeremonyRefusal::DegenerateContribution {
                party: Party::Candidate,
            });
        }
        self.provisioner_contribution = Some(provisioner_contribution);
        self.candidate_contribution = Some(candidate_contribution);
        self.stage = Stage::Exchanged;
        Ok(())
    }

    /// c) **verification**, at or above the floor the offered role sets
    /// (6.3.1).
    ///
    /// ‼ **ONE-SHOT (6.3.3).** *A mismatch or a decline shall abort the
    /// ceremony with the invitation voided, and shall not be retried within
    /// the same exchange.* Note 2: the one-shot rule is **arithmetic** — a
    /// short string is guessable given attempts, so the attempts are one.
    ///
    /// `matched` is the person's answer at the glance grades, or the wire's
    /// at the anchored grade. **A decline is `false`**, and 6.4.1 gives it
    /// the same effect as a mismatch because both mean *this was not
    /// witnessed*.
    pub fn verify(
        &mut self,
        reached: VerificationGrade,
        matched: bool,
    ) -> Result<(), CeremonyRefusal> {
        self.require(Stage::Exchanged, Stage::Verified)?;
        if self.comparison_attempted {
            // Unreachable via `require` today, and kept because 6.3.3's
            // no-retry rule must not depend on the stage machine happening
            // to forbid it.
            return Err(CeremonyRefusal::Aborted {
                voided: self.invitation_voided,
            });
        }
        self.comparison_attempted = true;

        let floor = self.invitation.role.floor();
        if reached < floor {
            // ‼ NOT AN ABORT, AND NOT A VOIDING. Reaching too low a grade
            // is a statement about the CEREMONY's arrangements, not about
            // the invitation or the counterpart — 5.3 b) voids on a
            // mismatch or a decline, and this is neither. *Voiding here
            // would burn an invitation because somebody used the wrong
            // cable.*
            self.comparison_attempted = false;
            return Err(CeremonyRefusal::BelowRoleFloor { floor, reached });
        }
        if !matched {
            self.abort_voiding();
            return Err(CeremonyRefusal::Aborted { voided: true });
        }
        self.stage = Stage::Verified;
        Ok(())
    }

    /// d) **request** — the candidate, **still OPEN**, emits its claim
    /// request (6.1.1 d, 4.2's first check).
    ///
    /// Takes the candidate's **public** half only — as a [`Minted`], so it
    /// was generated on the candidate (6.1.2, L5 5.1.1a) — and **retains
    /// it**: the install refuses a certificate over any other key. *6.1.2:
    /// the candidate's member secret key shall be generated on the candidate
    /// and shall never leave it* — **there is no parameter here that could
    /// carry one.** Until 2026-08-25 the public half was accepted and
    /// discarded, so a ceremony that requested key 9 installed whatever key
    /// the caller handed the install (r2-codex-refute).
    pub fn request(
        &mut self,
        candidate_state_now: ClaimState,
        candidate_public: Minted,
    ) -> Result<[u8; 16], CeremonyRefusal> {
        self.require(Stage::Verified, Stage::Requested)?;
        if self.invitation_consumed {
            return Err(CeremonyRefusal::InvitationConsumed);
        }
        // 4.2, FIRST of two: verified BEFORE the claim request is emitted.
        if candidate_state_now != ClaimState::Open {
            return Err(CeremonyRefusal::NotOpen {
                state: candidate_state_now,
            });
        }
        self.requested = Some(candidate_public);
        self.stage = Stage::Requested;
        Ok(self.invitation.code)
    }

    /// e) **install** — the candidate re-verifies OPEN and commits
    /// atomically (6.1.1 e, 4.2's second check).
    ///
    /// ‼ **THE SECOND OPEN CHECK IS THE ONE WITH A REASON THAT IS NOT
    /// OBVIOUS.** 4.2 requires it *again immediately before the install
    /// commits* — **because the window between the request and the install
    /// is a window in which another provisioner could have claimed the same
    /// candidate.** A single check at request time would let two ceremonies
    /// race and the loser overwrite the winner.
    ///
    /// 5.3 a): the invitation is **consumed by the install it authorised**.
    /// ‼ **RETURNS THE PERSONA, AND THAT IS THE POINT** (2026-08-15).
    /// This advanced a stage and handed back nothing, so **the ceremony
    /// did not bind its own outcome**: a caller could complete an
    /// enrolment into group A and then construct a persona for group B,
    /// and no type here would notice. *An authorisation that does not
    /// produce the thing it authorises is a permission slip nobody
    /// checks.*
    ///
    /// The group is the **invitation's**, not a parameter, so the
    /// installed persona is necessarily the one this ceremony was for.
    /// `Persona::enrolled` is `pub(crate)` and this is its only caller,
    /// which is what makes that a property of the crate rather than of
    /// this function's discipline.
    ///
    /// The persona's member is **the key requested under d)** and nothing
    /// the install is handed: the bundle brings the certificate, and the
    /// certificate must be over that key, for the invitation's group, and
    /// verify under `V` as the group's signature (6.1.1 e, L5 6.1.1). The
    /// group material the role carries is outside this type. The three
    /// refusals are distinct because a person running a ceremony needs to
    /// know which of three different mistakes was made.
    pub fn install<V: Verifier>(
        &mut self,
        candidate_state_now: ClaimState,
        certificate: &Certificate,
    ) -> Result<Persona, CeremonyRefusal> {
        self.require(Stage::Requested, Stage::Installed)?;
        let Some(requested) = self.requested else {
            return Err(CeremonyRefusal::OutOfOrder {
                at: self.stage,
                attempted: Stage::Installed,
            });
        };
        if certificate.subject != requested.get() {
            return Err(CeremonyRefusal::CertificateNotOverRequestedKey);
        }
        if certificate.group != self.invitation.group {
            return Err(CeremonyRefusal::CertificateForAnotherGroup);
        }
        if !certificate.verifies::<V>() {
            return Err(CeremonyRefusal::CertificateUnverified);
        }
        // 4.2, SECOND of two — immediately before the commit.
        if candidate_state_now != ClaimState::Open {
            return Err(CeremonyRefusal::NotOpen {
                state: candidate_state_now,
            });
        }
        self.invitation_consumed = true;
        self.stage = Stage::Installed;
        Ok(Persona::enrolled(self.invitation.group, requested))
    }

    /// f) **announcement** — introduced to the group by the group's
    /// ordinary machinery.
    pub fn announce(&mut self) -> Result<(), CeremonyRefusal> {
        self.require(Stage::Installed, Stage::Announced)?;
        self.stage = Stage::Announced;
        Ok(())
    }

    /// ‼ **5.3 c): AN EXCHANGE THAT FAILS BEFORE VERIFICATION, FOR
    /// TRANSPORT REASONS, MAY RETRY THE SAME INVITATION WITH A FRESH
    /// EXCHANGE.**
    ///
    /// **This is the clause that makes 5.3 b) meaningful rather than
    /// absolute**: an invitation is not burned by a dropped connection, and
    /// it *is* burned by a mismatch or a decline. Returns `None` once the
    /// invitation is voided or consumed — *the distinction between the two
    /// failures is the whole of 5.3.*
    pub fn retry_after_transport_failure(&self) -> Option<Invitation> {
        if self.invitation_voided || self.invitation_consumed {
            return None;
        }
        // Before verification only: after it, 5.3 b) or 5.3 a) has decided.
        if self.stage >= Stage::Verified && self.stage != Stage::Aborted {
            return None;
        }
        Some(self.invitation)
    }

    /// **7.1: stop the ceremony at any step, and report what it left.**
    ///
    /// ‼ **NOTHING COULD ABORT A CEREMONY FROM OUTSIDE UNTIL NOW.** The only
    /// abort was internal, on a verification mismatch, so *a transport that
    /// died, an operator who walked away and a timeout all left a ceremony
    /// sitting at its stage with no way to end it* — and 7.1 binds a ceremony
    /// that fails **at any step**, not only at the one step that had a path.
    ///
    /// `prior` is the candidate's claim state as it was **before** the
    /// ceremony began; see [`what_an_abort_leaves`](crate::abort::what_an_abort_leaves)
    /// for why it is returned rather than assumed to be `Open`.
    pub fn abort(&mut self, cause: AbortCause, prior: ClaimState) -> crate::abort::LeftByAbort {
        if self.voids_invitation(cause) {
            self.invitation_voided = true;
        }
        self.stage = Stage::Aborted;
        crate::abort::what_an_abort_leaves(prior)
    }

    /// Whether this cause voids the invitation (5.3 b, 5.3 c).
    ///
    /// ‼ **`Unstated` VOIDS, AND THAT IS THE FAIL-CLOSED DIRECTION.** *An
    /// invitation that survives an unexplained abort is a live credential
    /// nobody is watching*, and the cost of the other error is that somebody
    /// issues a fresh invitation.
    ///
    /// A transport failure **after** verification voids too, because 5.3 c)
    /// grants the retry only *before verification* — the same bound
    /// [`Ceremony::retry_after_transport_failure`] already enforces.
    const fn voids_invitation(&self, cause: AbortCause) -> bool {
        match cause {
            AbortCause::VerificationFailedOrDeclined => true,
            AbortCause::TransportFailure => !matches!(
                self.stage,
                Stage::Discovered | Stage::Committed | Stage::Exchanged
            ),
            AbortCause::Unstated => true,
        }
    }

    fn abort_voiding(&mut self) {
        self.invitation_voided = true;
        self.stage = Stage::Aborted;
    }

    fn require(&mut self, from: Stage, to: Stage) -> Result<(), CeremonyRefusal> {
        if self.stage == Stage::Aborted {
            return Err(CeremonyRefusal::Aborted {
                voided: self.invitation_voided,
            });
        }
        if self.stage != from {
            return Err(CeremonyRefusal::OutOfOrder {
                at: self.stage,
                attempted: to,
            });
        }
        Ok(())
    }
}

/// Whether a contribution is *a result an observer could compute* (6.2.2).
///
/// ‼ **A FLOOR, AND THE ROW MUST SAY SO.** The corpus's phrase is
/// *degenerate — a result an observer could compute* — which for a real
/// curve means the identity element and the small-order points. This
/// recognises **all-zero and all-ones**, the two an absent or stubbed
/// contribution actually produces, and **cannot recognise a small-order
/// point**: that check belongs to the curve implementation, which this
/// crate does not contain. *An arm that claimed otherwise would be the more
/// dangerous kind of green.*
fn is_degenerate(contribution: &[u8; 32]) -> bool {
    contribution.iter().all(|b| *b == 0) || contribution.iter().all(|b| *b == 0xFF)
}

/// The ceremony's verification string (6.3.2).
///
/// ‼ **DERIVED FROM THE SESSION *AND THE INVITATION* — THE GROUP IDENTITY,
/// THE ISSUING MEMBER, AND THE CODE.** Note 1 is why, and it is not the
/// interposer: *an attacker cannot forge the issuing member's evidence, but
/// could present its **own** group's invitation carrying a code copied from
/// a legitimate one.* Binding the group and the issuer makes that
/// substitution render **different strings at the two endpoints**, so the
/// person aborts.
///
/// **The string authenticates the DESTINATION of the claim, not merely the
/// absence of an interposer** — which is the property a session-only
/// derivation silently lacks while passing every interposer test.
pub fn ceremony_verification_string<H: crate::derive::Hkdf>(
    session: &[u8],
    invitation: &Invitation,
) -> [u8; 4] {
    let mut binding = [0u8; 80];
    binding[..32].copy_from_slice(&invitation.group.0);
    binding[32..64].copy_from_slice(&invitation.issuing_member.0);
    binding[64..80].copy_from_slice(&invitation.code);
    let mut out = [0u8; 32];
    H::derive(session, &binding, b"r2/v0/ceremony/vstring", &mut out);
    let s = [out[0], out[1], out[2], out[3]];
    {
        use zeroize::Zeroize as _;
        out.zeroize();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minted member for the install step. **The identity is
    /// arbitrary and the MINTEDNESS is not** — 5.1.1a, and
    /// `Minted::from_mint` is `pub(crate)` precisely so this is the
    /// only kind of place it can be written.
    fn minted() -> crate::membership::Minted {
        crate::membership::Minted::from_mint(Identity([0x5A; 32]))
    }

    /// The bundle's certificate: over the requested key, for `group`.
    fn certificate(group: Identity) -> Certificate {
        Certificate {
            subject: minted().get(),
            group,
            issued_at: Epoch(1),
            signature: [0; crate::crypto::SIGNATURE_LEN],
        }
    }

    /// Stands in for the group's signature: refuses only the forged marker.
    struct GroupSigned;
    impl Verifier for GroupSigned {
        fn verify(
            _: &[u8; crate::crypto::IDENTITY_LEN],
            _: &[u8],
            sig: &[u8; crate::crypto::SIGNATURE_LEN],
        ) -> bool {
            sig[0] != 0xFF
        }
    }

    /// ‼ **L5B 6.1.1 d/e (r2-codex-refute, 2026-08-25): the install used to
    /// take an unrelated `Minted` and no certificate at all**, so a ceremony
    /// that requested key 9 installed key 0x5A and this file's own helper
    /// did exactly that. The bundle is now checked against what was
    /// requested, and a refused install commits nothing.
    #[test]
    fn the_install_refuses_a_certificate_over_any_key_but_the_requested_one() {
        let group = Identity([7; 32]);
        let mut c = ready_to_install(group);
        let other = Certificate {
            subject: ident(9),
            ..certificate(group)
        };
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Open, &other),
            Err(CeremonyRefusal::CertificateNotOverRequestedKey)
        );
        assert_eq!(c.stage(), Stage::Requested, "a refused install committed");
    }

    #[test]
    fn the_install_refuses_a_certificate_for_another_group() {
        let mut c = ready_to_install(Identity([7; 32]));
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Open, &certificate(Identity([8; 32]))),
            Err(CeremonyRefusal::CertificateForAnotherGroup)
        );
        assert_eq!(c.stage(), Stage::Requested);
    }

    #[test]
    fn the_install_refuses_a_certificate_the_group_did_not_sign() {
        let group = Identity([7; 32]);
        let mut c = ready_to_install(group);
        let forged = Certificate {
            signature: [0xFF; crate::crypto::SIGNATURE_LEN],
            ..certificate(group)
        };
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Open, &forged),
            Err(CeremonyRefusal::CertificateUnverified)
        );
        assert_eq!(c.stage(), Stage::Requested);
    }

    /// ‼ **L5B 6.1.1 e WITH L5 4.4.2: THE CEREMONY PRODUCES THE PERSONA,
    /// IN THE INVITATION'S GROUP, ALREADY `Owner`.**
    ///
    /// Before 2026-08-15 `install` returned `Ok(())`. The enrolment
    /// committed and **the caller then built a persona out of whatever
    /// group identity it liked** — *an authorisation that does not produce
    /// the thing it authorises.* The three assertions are the three ways
    /// that could go wrong, and the third is the one a reviewer would
    /// skip: 4.4.2 requires `Owner` **in the same atomic commit**, so a
    /// second call setting it is not the same fact, and `enrolled` takes
    /// no `claim` argument at all.
    #[test]
    fn the_installed_persona_is_the_group_that_invited_it_and_is_owner() {
        let group = Identity([7; 32]);
        let mut c = ready_to_install(group);

        let persona = c
            .install::<GroupSigned>(ClaimState::Open, &certificate(group))
            .expect("an OPEN candidate installs");

        // (1) The group is the INVITATION's, not a caller's choice.
        assert_eq!(persona.group(), group);
        // (2) The member is the minted identity, unmodified.
        assert_eq!(persona.member(), Identity([0x5A; 32]));
        // ‼ (3) 4.4.2: OWNER at the install, not afterwards.
        assert_eq!(persona.claim(), ClaimState::Owner);
    }

    /// **The refusal path yields NO persona**, which is the half that
    /// makes the test above mean something: *a commit that refuses must
    /// not also hand back the thing the commit would have created.*
    #[test]
    fn a_refused_install_produces_no_persona_at_all() {
        let mut c = ready_to_install(Identity([7; 32]));
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Owner, &certificate(Identity([7; 32]))),
            Err(CeremonyRefusal::NotOpen {
                state: ClaimState::Owner
            }),
            "4.2's second check refuses a candidate already claimed"
        );
        // And the invitation is NOT consumed by a refusal (5.3).
        assert!(!c.invitation_is_voided());
    }

    struct TestHkdf;
    impl crate::derive::Hkdf for TestHkdf {
        fn derive(secret: &[u8], salt: &[u8], info: &[u8], out: &mut [u8; 32]) {
            let mut acc: u64 = 0xcbf2_9ce4_8422_2325;
            for b in secret.iter().chain(salt).chain(info) {
                acc ^= *b as u64;
                acc = acc.wrapping_mul(0x100_0000_01b3);
            }
            for (i, o) in out.iter_mut().enumerate() {
                acc ^= i as u64;
                acc = acc.wrapping_mul(0x100_0000_01b3);
                *o = (acc >> 24) as u8;
            }
        }
    }

    fn ident(b: u8) -> Identity {
        Identity([b; crate::crypto::IDENTITY_LEN])
    }

    fn invite(role: Role) -> Invitation {
        Invitation {
            group: ident(1),
            issuing_member: ident(2),
            role,
            code: [7; 16],
            validity: Epoch(100),
        }
    }

    fn discovered(role: Role) -> Ceremony {
        Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(role)),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        )
        .expect("open, matched modes, in validity, provisioner holds custody")
    }

    /// A ceremony driven to `Requested` in a NAMED group, so a test can
    /// assert which group the installed persona lands in. The other
    /// helpers fix the group at `ident(1)`, which cannot distinguish *the
    /// invitation's group* from *a default*.
    fn ready_to_install(group: Identity) -> Ceremony {
        let mut c = Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(Invitation {
                group,
                ..invite(Role::Member)
            }),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        )
        .expect("open, matched modes, in validity, provisioner holds custody");
        c.candidate_commits([9; 32]).unwrap();
        c.exchange([3; 32], [4; 32]).unwrap();
        c.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        c.request(ClaimState::Open, minted()).unwrap();
        c
    }

    /// ‼ **7.1: NOTHING COULD ABORT A CEREMONY FROM OUTSIDE, AND 7.1 BINDS
    /// ONE THAT FAILS AT *ANY* STEP.** The only abort was internal, on a
    /// verification mismatch — *so a transport that died, an operator who
    /// walked away and a timeout all left a ceremony sitting at its stage
    /// with no way to end it.*
    #[test]
    fn a_ceremony_can_be_aborted_at_any_step_and_says_what_it_left() {
        let mut c = to_exchanged(Role::Member);
        let left = c.abort(AbortCause::TransportFailure, ClaimState::Open);
        assert_eq!(left.claim, ClaimState::Open, "7.1: exactly as it was");
        assert!(left.group_of_one_intact);
        // Terminal: every further step refuses.
        assert!(matches!(
            c.verify(VerificationGrade::GlanceConfirmed, true),
            Err(CeremonyRefusal::Aborted { .. })
        ));
    }

    /// ‼ **5.3's TWO HALVES, AND THEY LOOK IDENTICAL FROM THE STAGE.** *An
    /// exchange that fails before verification, for transport reasons, may
    /// retry the same invitation* — while a mismatch or a decline voids it.
    /// **An abort that always voided would burn an invitation on a dropped
    /// connection.**
    #[test]
    fn a_transport_failure_before_verification_keeps_the_invitation() {
        let mut c = to_exchanged(Role::Member);
        c.abort(AbortCause::TransportFailure, ClaimState::Open);
        assert!(!c.invitation_is_voided(), "5.3 c): retryable");
        assert!(
            c.retry_after_transport_failure().is_some(),
            "and the invitation is actually reachable for the retry"
        );

        let mut d = to_exchanged(Role::Member);
        d.abort(AbortCause::VerificationFailedOrDeclined, ClaimState::Open);
        assert!(d.invitation_is_voided(), "5.3 b): voided");
    }

    /// ‼ **AN UNSTATED CAUSE VOIDS, AND THAT IS THE FAIL-CLOSED DIRECTION**:
    /// *an invitation that survives an unexplained abort is a live credential
    /// nobody is watching*, and the cost of the other error is that somebody
    /// issues a fresh invitation.
    #[test]
    fn an_unstated_cause_voids_the_invitation() {
        let mut c = to_exchanged(Role::Member);
        c.abort(AbortCause::Unstated, ClaimState::Open);
        assert!(c.invitation_is_voided());
        assert!(c.retry_after_transport_failure().is_none());
    }

    /// ‼ **A TRANSPORT FAILURE *AFTER* VERIFICATION VOIDS TOO**, because
    /// 5.3 c) grants the retry only *before verification* — the same bound
    /// `retry_after_transport_failure` already enforces, applied at the
    /// abort rather than left for the retry to discover.
    #[test]
    fn a_transport_failure_after_verification_voids_the_invitation() {
        let mut c = ready_to_install(Identity([7; 32]));
        c.abort(AbortCause::TransportFailure, ClaimState::Open);
        assert!(
            c.invitation_is_voided(),
            "the retry window closed at verification"
        );
    }

    fn to_exchanged(role: Role) -> Ceremony {
        let mut c = discovered(role);
        c.candidate_commits([9; 32]).unwrap();
        c.exchange([3; 32], [4; 32]).unwrap();
        c
    }

    /// ‼ **4.4: A MEMBER WITHOUT CUSTODY OF THE GROUP SECRET CANNOT ENROL
    /// DEVICES**, refused before anything else happens.
    ///
    /// *Note 1: the capability to enrol **IS** the custody — the
    /// certificate the ceremony installs is signed by the group's secret
    /// key, so there is no separate enrolment permission to grant, forget,
    /// or steal.* The refusal therefore **models a fact rather than
    /// enforcing a policy**: a non-custodian could not produce the
    /// certificate anyway, and finding that out at the install would spend
    /// a candidate's whole ceremony to learn something knowable before it
    /// began.
    #[test]
    fn a_provisioner_without_custody_cannot_run_a_ceremony() {
        assert_eq!(
            Ceremony::discover(
                crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                    Role::Member
                )),
                ClaimState::Open,
                BuildMode::Production,
                BuildMode::Production,
                Role::Member,
                Epoch(1)
            ),
            Err(CeremonyRefusal::ProvisionerHoldsNoCustody)
        );
        // CONTROL: the same ceremony with a key-holding provisioner
        // proceeds, so the refusal is the custody and not the invitation.
        assert!(Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                Role::Member
            )),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1)
        )
        .is_ok());
    }

    /// ‼ **AND THE PROVISIONER'S ROLE AND THE OFFERED ROLE ARE DIFFERENT
    /// QUESTIONS**, which is worth pinning because both are a `Role` and a
    /// reader could take one for the other. A key holder may offer
    /// **ordinary** membership — *that is the common case, and conflating
    /// the two would mean every enrolment produced another key holder.*
    #[test]
    fn a_key_holder_may_offer_ordinary_membership() {
        let c = Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                Role::Member,
            )),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        )
        .expect("custody held, ordinary membership offered");
        assert_eq!(c.stage(), Stage::Discovered);
    }

    /// ‼ **7.3: NO CEREMONY SHALL RESTORE A PREVIOUS PERSONA**, and the
    /// assertion is that **there is nowhere to put one**.
    ///
    /// `Ceremony` is an invitation, a stage, three exchange values and
    /// three flags. **No field holds a prior persona, a prior member key or
    /// a prior group**, and `install` takes only the candidate's current
    /// claim state. The destructuring below is what makes **adding such a
    /// field a test failure** rather than a quietly available restore path.
    ///
    /// *7.3 is a permanence claim — the old persona is unreachable by any
    /// ceremony, for anyone, permanently — and a permanence claim that
    /// rests on nobody having written the code yet is not a claim.*
    #[test]
    fn a_ceremony_has_nowhere_to_put_a_previous_persona() {
        let c = discovered(Role::Member);
        let Ceremony {
            invitation: _,
            stage: _,
            candidate_commitment: _,
            candidate_contribution: _,
            provisioner_contribution: _,
            requested: _,
            invitation_voided: _,
            invitation_consumed: _,
            comparison_attempted: _,
        } = c;
    }

    /// ‼ **7.3: RE-CLAIM AFTER A PHYSICAL RESET SHALL INSTALL A FRESH
    /// PERSONA BY A FRESH CEREMONY.** The word doing the work is **fresh**,
    /// twice: a completed ceremony **consumes its invitation** and cannot be
    /// rewound, so the second claim cannot reuse the first ceremony's
    /// material even in part.
    #[test]
    fn a_second_claim_needs_a_whole_new_ceremony_and_cannot_reuse_the_first() {
        let mut first = to_exchanged(Role::Member);
        first
            .verify(VerificationGrade::GlanceConfirmed, true)
            .unwrap();
        first.request(ClaimState::Open, minted()).unwrap();
        first
            .install::<GroupSigned>(ClaimState::Open, &certificate(ident(1)))
            .unwrap();

        // ...a physical reset returns the device to OPEN (L5 4.4.3). The
        // COMPLETED ceremony is not a route back: its invitation is spent
        // and every step refuses.
        assert_eq!(first.retry_after_transport_failure(), None, "consumed");
        assert_eq!(
            first.request(ClaimState::Open, minted()),
            Err(CeremonyRefusal::OutOfOrder {
                at: Stage::Installed,
                attempted: Stage::Requested
            })
        );

        // ‼ AND A FRESH CEREMONY IS AVAILABLE, which is the half that keeps
        // 7.3 from reading as "a device can be claimed once, ever". *The
        // old persona being unreachable is not the same as the DEVICE being
        // unreachable*, and an implementation confusing the two would brick
        // every reset board.
        let second = Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                Role::Member,
            )),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        );
        assert!(second.is_ok());
    }

    /// ‼ **7.4: RECOVERY SHALL NOT MAKE A DEVICE CLAIMABLE — it erases what
    /// it erases and LEAVES CLAIM STATE UNTOUCHED, and a claim after
    /// recovery still requires the physical reset first.**
    ///
    /// The mechanism is that **claim state has exactly two values and
    /// nothing in this module writes it**: `discover` and `install` both
    /// *read* it from the caller. *A recovery path that wanted to make a
    /// device claimable would have to write `Open`, and there is no
    /// writer here to do it.*
    ///
    /// Asserted from the other end, which is the end an attacker uses: an
    /// OWNER device is refused at discovery **whatever else is true** — the
    /// invitation valid, the modes matched, the provisioner a key holder.
    #[test]
    fn recovery_leaves_an_owned_device_unclaimable() {
        // Everything else about this ceremony is impeccable.
        assert_eq!(
            Ceremony::discover(
                crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                    Role::Member
                )),
                ClaimState::Owner,
                BuildMode::Production,
                BuildMode::Production,
                Role::KeyHolder,
                Epoch(1)
            ),
            Err(CeremonyRefusal::NotOpen {
                state: ClaimState::Owner
            }),
            "7.4: recovery erases what it erases; it does not reopen the claim"
        );
        // CONTROL: the physical reset (L5 4.4.3) is what changes this, and
        // it is modelled as the caller presenting `Open` — the state, not a
        // method here.
        assert!(Ceremony::discover(
            crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                Role::Member
            )),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1)
        )
        .is_ok());
    }

    /// ‼ **4.3: A DEVICE IN CLAIM STATE OWNER SHALL NOT PRESENT ITSELF AS
    /// CLAIMABLE, ON ANY SURFACE.** The ceremony cannot even begin.
    #[test]
    fn an_owned_device_cannot_be_discovered_as_claimable() {
        assert_eq!(
            Ceremony::discover(
                crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                    Role::Member
                )),
                ClaimState::Owner,
                BuildMode::Production,
                BuildMode::Production,
                Role::KeyHolder,
                Epoch(1)
            ),
            Err(CeremonyRefusal::NotOpen {
                state: ClaimState::Owner
            })
        );
    }

    /// **4.5: only between devices of the same build mode.**
    #[test]
    fn a_ceremony_across_build_modes_is_refused() {
        assert_eq!(
            Ceremony::discover(
                crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                    Role::Member
                )),
                ClaimState::Open,
                BuildMode::Development,
                BuildMode::Production,
                Role::KeyHolder,
                Epoch(1)
            ),
            Err(CeremonyRefusal::BuildModeMismatch {
                candidate: BuildMode::Development,
                provisioner: BuildMode::Production
            })
        );
    }

    /// ‼ **6.2.1: THE PROVISIONER CANNOT REVEAL BEFORE THE CANDIDATE
    /// COMMITS**, and this is the ordering the attack turns on. *Note 1:
    /// commit-before-reveal forecloses grinding ephemeral values until the
    /// short verification string collides with the one the person is about
    /// to read.*
    #[test]
    fn the_exchange_cannot_run_before_the_candidate_has_committed() {
        let mut c = discovered(Role::Member);
        assert_eq!(
            c.exchange([3; 32], [4; 32]),
            Err(CeremonyRefusal::OutOfOrder {
                at: Stage::Discovered,
                attempted: Stage::Exchanged
            })
        );
        // CONTROL: after the commitment the same call succeeds, so the
        // refusal is the ordering and not a broken exchange.
        c.candidate_commits([9; 32]).unwrap();
        assert_eq!(c.exchange([3; 32], [4; 32]), Ok(()));
    }

    /// ‼ **6.2.2 REQUIRES THE REJECTION TO STATE THE REASON**, so the
    /// refusal names **which party** contributed the degenerate value —
    /// *a bare failure would leave an operator unable to tell whose end is
    /// broken.*
    #[test]
    fn a_degenerate_contribution_is_rejected_and_the_reason_names_the_party() {
        let mut c = discovered(Role::Member);
        c.candidate_commits([9; 32]).unwrap();
        assert_eq!(
            c.exchange([0; 32], [4; 32]),
            Err(CeremonyRefusal::DegenerateContribution {
                party: Party::Provisioner
            })
        );
        assert_eq!(
            c.exchange([3; 32], [0xFF; 32]),
            Err(CeremonyRefusal::DegenerateContribution {
                party: Party::Candidate
            })
        );
        // CONTROL: two ordinary contributions pass the same call.
        assert_eq!(c.exchange([3; 32], [4; 32]), Ok(()));
    }

    /// ‼ **6.3.1: CUSTODY OF THE GROUP SECRET REQUIRES ANCHORED + PERSON.**
    /// *Enrolling a key holder hands over the ability to grow the group*,
    /// so the wire alone is not enough however trustworthy the cable.
    #[test]
    fn a_key_holder_cannot_be_enrolled_at_the_anchored_grade_alone() {
        let mut c = to_exchanged(Role::KeyHolder);
        assert_eq!(
            c.verify(VerificationGrade::Anchored, true),
            Err(CeremonyRefusal::BelowRoleFloor {
                floor: VerificationGrade::AnchoredPlusPerson,
                reached: VerificationGrade::Anchored
            })
        );
        // CONTROL 1: at the floor it proceeds.
        assert_eq!(
            c.verify(VerificationGrade::AnchoredPlusPerson, true),
            Ok(())
        );
        // CONTROL 2: an ORDINARY member IS enrollable at the lower grade,
        // so the refusal is the role's floor and not a ban on the grade.
        let mut m = to_exchanged(Role::Member);
        assert_eq!(m.verify(VerificationGrade::Anchored, true), Ok(()));
    }

    /// ‼ **TOO LOW A GRADE DOES NOT VOID THE INVITATION**, and this is the
    /// distinction 5.3 b) draws: it voids on **a mismatch or a decline**,
    /// and an insufficient grade is neither. *Voiding here would burn an
    /// invitation because somebody used the wrong cable.*
    #[test]
    fn an_insufficient_grade_does_not_void_the_invitation() {
        let mut c = to_exchanged(Role::KeyHolder);
        let _ = c.verify(VerificationGrade::Anchored, true);
        assert!(!c.invitation_is_voided());
        assert_ne!(c.stage(), Stage::Aborted);
        // And the comparison was not spent either: the one-shot rule is
        // about the COMPARISON, and no comparison happened.
        assert_eq!(
            c.verify(VerificationGrade::AnchoredPlusPerson, true),
            Ok(())
        );
    }

    /// ‼ **6.3.3: ONE-SHOT. A MISMATCH ABORTS WITH THE INVITATION VOIDED
    /// AND SHALL NOT BE RETRIED WITHIN THE SAME EXCHANGE.** *Note 2: the
    /// one-shot rule is arithmetic* — a short string is guessable given
    /// attempts, so the attempts are one.
    #[test]
    fn a_mismatch_voids_the_invitation_and_cannot_be_retried() {
        let mut c = to_exchanged(Role::Member);
        assert_eq!(
            c.verify(VerificationGrade::GlanceConfirmed, false),
            Err(CeremonyRefusal::Aborted { voided: true })
        );
        assert!(c.invitation_is_voided());
        // No retry, in this exchange or any other: the ceremony is over.
        assert_eq!(
            c.verify(VerificationGrade::GlanceConfirmed, true),
            Err(CeremonyRefusal::Aborted { voided: true })
        );
        // And 5.3 b): a fresh ceremony needs a FRESH invitation.
        assert_eq!(c.retry_after_transport_failure(), None);
    }

    /// ‼ **5.3 c) IS WHAT MAKES 5.3 b) MEANINGFUL RATHER THAN ABSOLUTE**:
    /// *an exchange that fails before verification, for transport reasons,
    /// may retry the same invitation with a fresh exchange.* An invitation
    /// is **not** burned by a dropped connection and **is** burned by a
    /// mismatch — and an implementation collapsing the two would either
    /// burn invitations on flaky links or leave a declined ceremony
    /// retryable.
    #[test]
    fn a_transport_failure_before_verification_may_reuse_the_invitation() {
        let c = to_exchanged(Role::Member);
        assert_eq!(
            c.retry_after_transport_failure(),
            Some(invite(Role::Member))
        );
        // ...and once verified, this route is closed: 5.3 a) or b) governs.
        let mut v = to_exchanged(Role::Member);
        v.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        assert_eq!(v.retry_after_transport_failure(), None);
    }

    /// ‼ **4.2 REQUIRES OPEN TWICE, AND THE SECOND CHECK IS THE ONE WITH A
    /// NON-OBVIOUS REASON**: *again immediately before the install commits*
    /// — **because the window between request and install is one in which
    /// another provisioner could have claimed the same candidate.** A
    /// single check would let two ceremonies race and the loser overwrite
    /// the winner.
    #[test]
    fn open_is_verified_again_immediately_before_the_install_commits() {
        let mut c = to_exchanged(Role::Member);
        c.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        // First check, at the request: OPEN.
        assert_eq!(c.request(ClaimState::Open, minted()), Ok([7; 16]));
        // ...another provisioner claims the candidate in the window...
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Owner, &certificate(ident(1))),
            Err(CeremonyRefusal::NotOpen {
                state: ClaimState::Owner
            })
        );
        // CONTROL: still OPEN, and the install commits.
        let mut d = to_exchanged(Role::Member);
        d.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        d.request(ClaimState::Open, minted()).unwrap();
        assert!(d
            .install::<GroupSigned>(ClaimState::Open, &certificate(ident(1)))
            .is_ok());
    }

    /// **5.3 a): consumed by the install it authorised.**
    #[test]
    fn the_install_consumes_the_invitation() {
        let mut c = to_exchanged(Role::Member);
        c.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        c.request(ClaimState::Open, minted()).unwrap();
        c.install::<GroupSigned>(ClaimState::Open, &certificate(ident(1)))
            .unwrap();
        assert_eq!(c.retry_after_transport_failure(), None, "consumed");
        c.announce().unwrap();
        assert_eq!(c.stage(), Stage::Announced);
    }

    /// **6.1.1: in the stated order**, and the step most worth refusing out
    /// of order is the install — *an install without a verification is an
    /// enrolment nobody witnessed.*
    #[test]
    fn the_install_cannot_run_without_a_verification() {
        let mut c = to_exchanged(Role::Member);
        assert_eq!(
            c.install::<GroupSigned>(ClaimState::Open, &certificate(ident(1))),
            Err(CeremonyRefusal::OutOfOrder {
                at: Stage::Exchanged,
                attempted: Stage::Installed
            })
        );
    }

    /// ‼ **6.3.2 Note 1 IS THE ATTACK THIS TEST MODELS, AND IT IS NOT THE
    /// INTERPOSER.** *An attacker cannot forge the issuing member's
    /// evidence, but could present its OWN group's invitation carrying a
    /// code copied from a legitimate one.* Binding the group and the issuer
    /// makes the substitution render different strings, so the person
    /// aborts. **A session-only derivation passes every interposer test and
    /// silently lacks this.**
    #[test]
    fn a_substituted_invitation_carrying_a_copied_code_yields_a_different_string() {
        let session = b"one ceremony session";
        let honest = invite(Role::Member);
        let substituted = Invitation {
            group: ident(0xEE),
            ..honest
        }; // same code
        assert_eq!(
            honest.code, substituted.code,
            "precondition: the code was COPIED"
        );
        assert_ne!(
            ceremony_verification_string::<TestHkdf>(session, &honest),
            ceremony_verification_string::<TestHkdf>(session, &substituted),
            "6.3.2: the string authenticates the DESTINATION of the claim"
        );
        // And the issuing member is bound too, not only the group.
        let other_issuer = Invitation {
            issuing_member: ident(0xAB),
            ..honest
        };
        assert_ne!(
            ceremony_verification_string::<TestHkdf>(session, &honest),
            ceremony_verification_string::<TestHkdf>(session, &other_issuer)
        );
    }

    /// **8.2's second negative case**: an interposed exchange yields
    /// different strings, which is the session half of 6.3.2.
    #[test]
    fn an_interposed_exchange_yields_a_different_string() {
        let honest = invite(Role::Member);
        assert_ne!(
            ceremony_verification_string::<TestHkdf>(b"session-as-candidate-sees-it", &honest),
            ceremony_verification_string::<TestHkdf>(b"session-as-provisioner-sees", &honest),
        );
    }

    /// **5.4: the validity bound is the PROVISIONER's to evaluate, on its
    /// own ruler** — *the candidate shall not be required to evaluate it*,
    /// and there is no candidate-side parameter here that could.
    #[test]
    fn the_validity_bound_is_judged_on_the_provisioners_ruler() {
        assert_eq!(
            Ceremony::discover(
                crate::invitation::AuthorisedInvitation::taken_as_authorised_for_test(invite(
                    Role::Member
                )),
                ClaimState::Open,
                BuildMode::Production,
                BuildMode::Production,
                Role::KeyHolder,
                Epoch(101)
            ),
            Err(CeremonyRefusal::InvitationExpired)
        );
    }
}
