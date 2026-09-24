//! **What a ceremony never leaves (L5B Clause 7), and 8.3's demonstration.**
//!
//! # ‼ 7.2 IS AN OBSERVABILITY CLAIM, NOT A LIVENESS ONE
//!
//! *An interrupted install shall resolve to one of exactly two states: the
//! prior state complete, or the new persona complete with claim state OWNER.
//! **No third state shall be observable, at any interruption point.***
//!
//! **The clause does not say the install always finishes.** It says that
//! whatever a later boot finds, it finds one of two things — *and a half-built
//! persona beside a claim state that has already moved is the third state the
//! sentence forbids.* A device in that state is not broken in a way anyone can
//! see: it holds key material, it answers, and 4.4.2 says it is owned.
//!
//! ‼ **SO THE INTERRUPTION POINT IS AN ARGUMENT AND THE DURABILITY IS THE
//! ANSWER**, which is the whole shape of an atomic commit: the points before
//! the commit resolve to the prior state, the points after resolve to the new
//! persona, and **the commit itself is the only place where either is
//! possible.** A function taking only the durability could not be swept over
//! the points, and 8.3 obliges exactly that sweep.
//!
//! # ‼ AND A REPORT THAT CONTRADICTS THE POINT IS REFUSED RATHER THAN READ
//!
//! *Durable before the commit* and *not durable after it* are not states of
//! the world — they are a platform saying two things that cannot both be
//! true. **Answering `Resolved` for either would be inventing a resolution for
//! a device whose report cannot be trusted**, and the caller would act on it.
//!
//! # 7.1: the candidate is left exactly as it was
//!
//! *A ceremony that fails or aborts at any step shall leave the candidate
//! exactly as it was: claim state OPEN, its group-of-one intact, no partial
//! persona.*
//!
//! **The prior state is returned rather than `Open` being asserted**, and that
//! is not pedantry: 7.1's *exactly as it was* is the obligation, and a
//! function that answered `Open` would be **manufacturing the precondition it
//! was supposed to preserve** — right whenever the candidate really was OPEN,
//! and silently wrong on the one call where something else had already gone
//! astray.
//!
//! # 7.3 and 7.4: forward only, and recovery is not a claim
//!
//! *No ceremony shall restore a previous persona* — **there is deliberately no
//! function here that takes one**, and Note 1 says the cost is accepted in
//! both directions: *the legitimate owner who reset their own device cannot
//! restore its old persona either.* What it buys is that **a stolen device's
//! history is beyond every attacker with every credential, because it is
//! beyond everyone.**
//!
//! *Recovery shall not make a device claimable: it erases what it erases and
//! leaves claim state untouched.* ‼ **THE FAILURE THIS FORBIDS IS A REPAIR
//! THAT HANDS THE DEVICE AWAY** — an operator recovering a bricked unit and
//! finding it claimable by anyone in range.

//! # ⚠ WHAT IS WIRED AND WHAT IS NOT, STATED RATHER THAN LEFT TO A GREP
//!
//! [`what_an_abort_leaves`] is reached from [`Ceremony::abort`](crate::ceremony::Ceremony::abort),
//! which this cluster added because **nothing could abort a ceremony from
//! outside**: the only abort was internal, on a verification mismatch, so *a
//! transport that died, an operator who walked away and a timeout all left a
//! ceremony sitting at its stage with no way to end it.*
//!
//! [`resolve_interrupted_install`] has **no runtime caller, and that is a
//! fact about the platforms rather than about this module**: it is consulted
//! by a boot that finds an interrupted install, and *no platform in this
//! workspace performs an enrolment install at all* — personas are minted, not
//! enrolled. **Said here because the alternative is a reader inferring from a
//! caller count that the duty was declined**, and *not built* and
//! *deliberately declined* look identical from that count.

use crate::membership::ClaimState;

/// Where an install was interrupted (8.3: *each step boundary*).
///
/// **Ordered by the commit**, because that is the only boundary that changes
/// the answer — the others are named so the sweep 8.3 requires can enumerate
/// them rather than a caller inventing a list.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InstallPoint {
    /// d) done: the claim request is out, nothing has been written.
    RequestEmitted,
    /// e) entered, before 4.2's second OPEN check.
    BeforeSecondOpenCheck,
    /// The second check passed and the commit has not started.
    Checked,
    /// ‼ **INSIDE THE ATOMIC COMMIT — THE ONLY POINT WHERE BOTH OUTCOMES ARE
    /// POSSIBLE.** Every other point has one lawful answer.
    CommitInFlight,
    /// The commit completed; f) has not run.
    Committed,
    /// f) done.
    Announced,
}

impl InstallPoint {
    /// Every boundary, for 8.3's sweep.
    ///
    /// **A constant rather than a caller's list**: *a demonstration that
    /// enumerates its own cases can omit the one that fails and still read as
    /// a sweep.*
    pub const ALL: [InstallPoint; 6] = [
        InstallPoint::RequestEmitted,
        InstallPoint::BeforeSecondOpenCheck,
        InstallPoint::Checked,
        InstallPoint::CommitInFlight,
        InstallPoint::Committed,
        InstallPoint::Announced,
    ];

    /// Whether the atomic commit has completed at this point.
    ///
    /// [`CommitInFlight`](Self::CommitInFlight) answers **`None`** — *that is
    /// the question the commit is in the middle of*, and any other answer
    /// would be this type deciding what only the platform's record can say.
    pub const fn commit_completed(self) -> Option<bool> {
        match self {
            InstallPoint::RequestEmitted
            | InstallPoint::BeforeSecondOpenCheck
            | InstallPoint::Checked => Some(false),
            InstallPoint::CommitInFlight => None,
            InstallPoint::Committed | InstallPoint::Announced => Some(true),
        }
    }
}

/// **7.2's two states, and there is no third.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Resolved {
    /// The prior state, complete: claim state as it was, no persona.
    PriorStateComplete,
    /// The new persona, complete, with claim state OWNER (4.4.2).
    NewPersonaOwner,
}

/// A report that cannot be true of any device.
///
/// ‼ **NOT A THIRD STATE — A CONTRADICTION IN THE REPORT.** 7.2 forbids a
/// third *observable state*; this is the platform saying two things that
/// cannot both hold. *Answering `Resolved` anyway would invent a resolution
/// for a device whose report cannot be trusted, and the caller would act on
/// it.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImpossibleReport {
    /// The commit is recorded durable at a point before the commit ran.
    DurableBeforeTheCommit,
    /// The commit is recorded absent at a point after it completed.
    AbsentAfterTheCommit,
}

/// **7.2: what an interrupted install resolves to.**
///
/// `commit_is_durable` is what the platform found **on the persona region**,
/// not what the ceremony believed — *the ceremony is the thing that was
/// interrupted, so its own view is exactly what cannot be trusted here.*
pub const fn resolve_interrupted_install(
    point: InstallPoint,
    commit_is_durable: bool,
) -> Result<Resolved, ImpossibleReport> {
    match (point.commit_completed(), commit_is_durable) {
        // Before the commit: the prior state, complete. A durable commit
        // here is a contradiction and not a resolution.
        (Some(false), false) => Ok(Resolved::PriorStateComplete),
        (Some(false), true) => Err(ImpossibleReport::DurableBeforeTheCommit),
        // After it: the new persona, complete, OWNER.
        (Some(true), true) => Ok(Resolved::NewPersonaOwner),
        (Some(true), false) => Err(ImpossibleReport::AbsentAfterTheCommit),
        // ‼ **THE COMMIT ITSELF, AND BOTH ANSWERS ARE LAWFUL HERE.** That is
        // what atomic means: the write either landed or it did not, and there
        // is nothing between the two for a later boot to find.
        (None, true) => Ok(Resolved::NewPersonaOwner),
        (None, false) => Ok(Resolved::PriorStateComplete),
    }
}

/// What a failed or aborted ceremony leaves behind (7.1).
///
/// ‼ **THERE IS NO PERSONA FIELD, AND ITS ABSENCE IS THE CLAUSE.** *No partial
/// persona* is not a value to report — it is a thing that must not exist, and
/// a `partial_persona: bool` here would be a type inviting the state 7.1
/// forbids.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LeftByAbort {
    /// The candidate's claim state — **unchanged**.
    pub claim: ClaimState,
    /// Its group of one (L5 4.3.1), intact.
    pub group_of_one_intact: bool,
}

/// **7.1: a ceremony that fails or aborts at any step leaves the candidate
/// exactly as it was.**
///
/// ‼ **RETURNS THE PRIOR STATE RATHER THAN ASSERTING `Open`.** *Exactly as it
/// was* is the obligation; a function that answered `Open` would manufacture
/// the precondition it exists to preserve — **right whenever the candidate
/// really was OPEN, and silently wrong on the one call where something had
/// already gone astray.**
pub const fn what_an_abort_leaves(prior: ClaimState) -> LeftByAbort {
    LeftByAbort {
        claim: prior,
        group_of_one_intact: true,
    }
}

/// **7.3: what a physical reset leaves for a fresh ceremony (L5 4.4.3).**
///
/// ‼ **AND THERE IS DELIBERATELY NO FUNCTION HERE THAT TAKES A PREVIOUS
/// PERSONA.** *The old persona is unreachable by any ceremony, for anyone,
/// permanently* — Note 1 accepts the cost in both directions: **the legitimate
/// owner who reset their own device cannot restore its old persona either**,
/// and what that buys is that *a stolen device's history is beyond every
/// attacker with every credential, because it is beyond everyone.*
pub const fn claim_state_after_physical_reset() -> ClaimState {
    ClaimState::Open
}

/// **7.4: recovery leaves claim state untouched (L6 5.5).**
///
/// ‼ **THE FAILURE THIS FORBIDS IS A REPAIR THAT HANDS THE DEVICE AWAY** — an
/// operator recovering a bricked unit and finding it claimable by anyone in
/// range. *Recovery erases what it erases*, and claim state is not in it.
pub const fn claim_state_after_recovery(prior: ClaimState) -> ClaimState {
    prior
}

/// Whether a device may be claimed after a recovery (7.4).
///
/// **Answers from the state recovery left, which is the state it found.** A
/// claim after recovery still requires the physical reset first, and that
/// reset — not the recovery — is what makes a device claimable.
pub const fn claimable_after_recovery(prior: ClaimState) -> bool {
    matches!(claim_state_after_recovery(prior), ClaimState::Open)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **8.3's DEMONSTRATION: EVERY STEP BOUNDARY, AND ONLY THE TWO
    /// PERMITTED STATES.** *Conformance to 7.2 shall be demonstrated by
    /// interrupting the install at each step boundary and observing only the
    /// two permitted states.*
    ///
    /// The sweep runs over [`InstallPoint::ALL`] rather than a list written
    /// here, because *a demonstration that enumerates its own cases can omit
    /// the one that fails and still read as a sweep.*
    #[test]
    fn every_interruption_point_resolves_to_one_of_exactly_two_states() {
        let mut prior = 0;
        let mut installed = 0;
        for point in InstallPoint::ALL {
            // The durability the platform can lawfully report at this point.
            let lawful: &[bool] = match point.commit_completed() {
                Some(false) => &[false],
                Some(true) => &[true],
                None => &[false, true],
            };
            for &durable in lawful {
                match resolve_interrupted_install(point, durable) {
                    Ok(Resolved::PriorStateComplete) => prior += 1,
                    Ok(Resolved::NewPersonaOwner) => installed += 1,
                    Err(e) => panic!("{point:?} durable={durable} is lawful, got {e:?}"),
                }
            }
        }
        // Four points before the commit lands, three resolutions after it —
        // and every single observation is one of the two.
        assert_eq!(
            prior + installed,
            7,
            "one resolution per lawful observation"
        );
        assert!(prior > 0 && installed > 0, "both states are reachable");
    }

    /// ‼ **THE COMMIT IS THE ONLY BOUNDARY WHERE BOTH ANSWERS ARE LAWFUL**,
    /// and that is what atomic means: *the write either landed or it did not,
    /// and there is nothing between the two for a later boot to find.*
    #[test]
    fn only_the_commit_itself_admits_both_outcomes() {
        assert_eq!(InstallPoint::CommitInFlight.commit_completed(), None);
        assert_eq!(
            resolve_interrupted_install(InstallPoint::CommitInFlight, true),
            Ok(Resolved::NewPersonaOwner)
        );
        assert_eq!(
            resolve_interrupted_install(InstallPoint::CommitInFlight, false),
            Ok(Resolved::PriorStateComplete)
        );
        // Every other point has exactly one lawful answer.
        for point in InstallPoint::ALL {
            if point == InstallPoint::CommitInFlight {
                continue;
            }
            assert!(
                point.commit_completed().is_some(),
                "{point:?} must be decided"
            );
        }
    }

    /// ‼ **A CONTRADICTORY REPORT IS REFUSED, NOT RESOLVED.** *Durable before
    /// the commit* and *absent after it* are the platform saying two things
    /// that cannot both be true — **answering `Resolved` would invent a
    /// resolution for a device whose report cannot be trusted.**
    #[test]
    fn a_report_that_contradicts_the_interruption_point_is_refused() {
        assert_eq!(
            resolve_interrupted_install(InstallPoint::Checked, true),
            Err(ImpossibleReport::DurableBeforeTheCommit),
            "nothing had been written at this point"
        );
        assert_eq!(
            resolve_interrupted_install(InstallPoint::Committed, false),
            Err(ImpossibleReport::AbsentAfterTheCommit),
            "the commit completed, so its record cannot be absent"
        );
        // And the same contradiction at every point that shares its side.
        for point in [
            InstallPoint::RequestEmitted,
            InstallPoint::BeforeSecondOpenCheck,
            InstallPoint::Checked,
        ] {
            assert!(resolve_interrupted_install(point, true).is_err());
        }
        for point in [InstallPoint::Committed, InstallPoint::Announced] {
            assert!(resolve_interrupted_install(point, false).is_err());
        }
    }

    /// ‼ **7.1 RETURNS THE PRIOR STATE AND DOES NOT ASSERT `Open`.** A
    /// function answering `Open` would be *manufacturing the precondition it
    /// exists to preserve* — right whenever the candidate really was OPEN, and
    /// **silently wrong on the one call where something had already gone
    /// astray.**
    #[test]
    fn an_abort_leaves_the_candidate_exactly_as_it_was() {
        let left = what_an_abort_leaves(ClaimState::Open);
        assert_eq!(left.claim, ClaimState::Open);
        assert!(left.group_of_one_intact);

        // The case that tells this apart from a constant: a candidate that
        // was NOT open is still reported as it was, not as 7.1's ordinary
        // precondition.
        let odd = what_an_abort_leaves(ClaimState::Owner);
        assert_eq!(
            odd.claim,
            ClaimState::Owner,
            "reporting Open here would hide that the ceremony began against \
             a candidate that was already claimed"
        );
    }

    /// **7.3: a physical reset opens the device for a FRESH ceremony**, and
    /// nothing here accepts a previous persona to restore.
    #[test]
    fn a_physical_reset_opens_the_device_for_a_fresh_ceremony_only() {
        assert_eq!(claim_state_after_physical_reset(), ClaimState::Open);
    }

    /// ‼ **7.4: RECOVERY MUST NOT HAND THE DEVICE AWAY.** The failure this
    /// forbids is an operator recovering a bricked unit and finding it
    /// claimable by anyone in range.
    #[test]
    fn recovery_leaves_claim_state_untouched_and_does_not_make_a_device_claimable() {
        assert_eq!(
            claim_state_after_recovery(ClaimState::Owner),
            ClaimState::Owner
        );
        assert!(
            !claimable_after_recovery(ClaimState::Owner),
            "a claim after recovery still requires the physical reset first"
        );
        // And a device that was already OPEN is not made un-claimable either:
        // recovery erases what it erases and touches neither direction.
        assert_eq!(
            claim_state_after_recovery(ClaimState::Open),
            ClaimState::Open
        );
        assert!(claimable_after_recovery(ClaimState::Open));
    }
}
