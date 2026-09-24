//! **How the group learns of a new member, and what the ceremony hands it
//! (L5B 6.5.1, 6.5.2).**
//!
//! # ‼ TWO PLANES, AND KEEPING THEM APART IS THE CLAUSE
//!
//! **6.5.1**: *the announcement shall teach the group the new member's
//! identity by ordinary verified traffic; **no global roster push shall be
//! required**, and a member is a member from the commit of 6.1.1 e)
//! **regardless of who has yet learned of it**.*
//!
//! Note 1 states the split in its own words: **membership is a cryptographic
//! fact from the instant of the commit; knowledge of the member is runtime
//! state that spreads as frames do.** So *a distant co-member that has never
//! heard of the newcomer is not evidence of a failed enrolment* — **it is the
//! designed shape of proximity-grounded knowledge**, and *the gate needs no
//! roster to verify the newcomer's frames.*
//!
//! ‼ **THAT LAST HALF IS TRUE BY CONSTRUCTION AND CAN BE INSPECTED WITHOUT
//! RUNNING ANYTHING**: `gate::apply_gate` takes the addressing, the frame, the
//! group's keys, the live entanglements and the clock — **and no roster, no
//! member list and no neighbour table.** *A gate that consulted one would need
//! a parameter it does not have*, which is stronger evidence than any test
//! this module could write, and it is where the conformance claim rests
//! (`01-terminology.md` 3.10, by construction).
//!
//! # 6.5.2: the ceremony hands over a warm neighbourhood
//!
//! *The ceremony's sightings shall seed the new member's neighbour table.*
//!
//! Note 2: **enrolment kick-starting routing** — *a fresh hive's first task
//! was already make noise and listen (L2 Clause 4), and the ceremony hands it
//! the provisioner and whatever the exchange overheard instead of a cold
//! table.*
//!
//! ⚠ **WHAT THIS MODULE CAN SEED IS THE PROVISIONER, AND NOT *WHATEVER THE
//! EXCHANGE OVERHEARD*.** The overheard peers are the bearer's observation
//! (L1 4.5) and reach this layer through the neighbour table, not through the
//! ceremony — *a ceremony that invented them would be reporting sightings
//! nobody made.* **Stated rather than left as an apparent omission**, because
//! a reader comparing this against Note 2 will otherwise count one seed and
//! wonder where the rest went.

use crate::ceremony::{Ceremony, CeremonyRefusal};
use crate::identity::Identity;
use crate::membership::Persona;

/// What the announcement step yields (6.5.1, 6.5.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Introduction {
    /// The new member's identity — **what the group is being taught.**
    pub new_member: Identity,
    /// The group it was enrolled into.
    pub group: Identity,
    /// **6.5.2's seed**: the member that enrolled it, which this hive has
    /// just exchanged with and verified against.
    pub seed: Identity,
}

/// Why an announcement was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AnnouncementRefusal {
    /// The ceremony is not at the announcement step.
    Ceremony(CeremonyRefusal),
    /// ‼ **THE PERSONA BEING ANNOUNCED IS NOT THE ONE THIS CEREMONY
    /// INSTALLED.** *A ceremony that announced whatever persona it was handed
    /// would teach the group a member this enrolment never produced* — and
    /// the announcement is carried by ordinary verified traffic, so it would
    /// arrive looking exactly as authentic as a correct one.
    PersonaIsNotThisCeremonys,
}

/// **6.5.1: announce the new member, and hand back 6.5.2's seed.**
///
/// The persona is an argument rather than something the ceremony kept,
/// because [`Ceremony::install`] hands it to its caller and *a second copy
/// held here would be a second place for it to go stale.* **The group is
/// checked against the invitation's**, which is what makes the argument safe.
pub fn announce(
    ceremony: &mut Ceremony,
    persona: &Persona,
) -> Result<Introduction, AnnouncementRefusal> {
    let invitation = ceremony.invitation();
    if persona.group() != invitation.group {
        return Err(AnnouncementRefusal::PersonaIsNotThisCeremonys);
    }
    ceremony.announce().map_err(AnnouncementRefusal::Ceremony)?;
    Ok(Introduction {
        new_member: persona.member(),
        group: persona.group(),
        seed: invitation.issuing_member,
    })
}

/// **6.5.1: is a global roster push required?**
///
/// **No, and the function exists so the answer is asked.** *A constant in a
/// doc comment is a rule somebody reads once; a call is a rule a design has to
/// route its roster through*, and `git grep requires_global_roster_push` finds
/// every place one was contemplated.
pub const fn requires_global_roster_push() -> bool {
    false
}

/// **6.5.1: may a hive refuse a verified frame because it has not yet heard
/// of the sender?**
///
/// **No.** *A member is a member from the commit regardless of who has yet
/// learned of it*, so **not knowing a sender is a fact about this hive's
/// knowledge and never about the sender's standing.** A hive that refused here
/// would make enrolment depend on propagation — *and the newcomer would be
/// refused precisely by the co-members furthest from the ceremony, which is
/// the population the announcement reaches last.*
pub const fn may_refuse_verified_frame_from_unknown_member() -> bool {
    false
}

/// **6.5.1: is a co-member's ignorance of the newcomer evidence of a failed
/// enrolment?**
///
/// **No** — *it is the designed shape of proximity-grounded knowledge.*
/// Offered as a predicate because the opposite reading is what an operator
/// reaches for when a newcomer is invisible from the far side of a site, and
/// **the diagnosis it produces is a re-enrolment that was never needed.**
pub const fn unheard_of_member_indicates_failed_enrolment() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ceremony::{Invitation, Role, VerificationGrade};
    use crate::certificate::{Certificate, Epoch};
    use crate::crypto::{Verifier, IDENTITY_LEN, SIGNATURE_LEN};
    use crate::invitation::AuthorisedInvitation;
    use crate::membership::{ClaimState, Minted};
    use r2_hal_traits::build_mode::BuildMode;

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    /// Stands in for the group's signature over the bundle's certificate.
    struct AnyGroupSignature;
    impl Verifier for AnyGroupSignature {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], _: &[u8; SIGNATURE_LEN]) -> bool {
            true
        }
    }

    const GROUP: u8 = 3;
    const ISSUER: u8 = 4;

    fn installed() -> (Ceremony, Persona) {
        let mut c = Ceremony::discover(
            AuthorisedInvitation::taken_as_authorised_for_test(Invitation {
                group: id(GROUP),
                issuing_member: id(ISSUER),
                role: Role::Member,
                code: [7; 16],
                validity: Epoch(100),
            }),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        )
        .expect("a well-formed ceremony");
        c.candidate_commits([9; 32]).unwrap();
        c.exchange([3; 32], [4; 32]).unwrap();
        c.verify(VerificationGrade::GlanceConfirmed, true).unwrap();
        c.request(ClaimState::Open, Minted::from_mint(id(9)))
            .unwrap();
        let persona = c
            .install::<AnyGroupSignature>(
                ClaimState::Open,
                &Certificate {
                    subject: id(9),
                    group: id(GROUP),
                    issued_at: Epoch(1),
                    signature: [0; SIGNATURE_LEN],
                },
            )
            .expect("installs");
        (c, persona)
    }

    /// **6.5.1 and 6.5.2 in one step**: the group is taught the new member,
    /// and the ceremony hands over the provisioner as the seed — *instead of
    /// a cold table.*
    #[test]
    fn the_announcement_teaches_the_new_member_and_seeds_the_provisioner() {
        let (mut c, persona) = installed();
        let intro = announce(&mut c, &persona).expect("installed, so announceable");
        assert_eq!(intro.new_member, id(9));
        assert_eq!(intro.group, id(GROUP));
        assert_eq!(intro.seed, id(ISSUER), "6.5.2: not a cold table");
    }

    /// ‼ **A CEREMONY MUST NOT ANNOUNCE A PERSONA IT DID NOT INSTALL.** *It
    /// would teach the group a member this enrolment never produced*, carried
    /// by ordinary verified traffic — **arriving looking exactly as authentic
    /// as a correct one.**
    #[test]
    fn a_persona_from_another_group_is_not_announceable_by_this_ceremony() {
        let (mut c, _) = installed();
        let foreign = Persona::group_of_one(id(88), Minted::from_mint(id(9)), ClaimState::Owner);
        assert_eq!(
            announce(&mut c, &foreign),
            Err(AnnouncementRefusal::PersonaIsNotThisCeremonys)
        );
    }

    /// The announcement is a step of 6.1.1 and keeps its ordering: it cannot
    /// run before the install.
    #[test]
    fn the_announcement_cannot_run_before_the_install() {
        let mut c = Ceremony::discover(
            AuthorisedInvitation::taken_as_authorised_for_test(Invitation {
                group: id(GROUP),
                issuing_member: id(ISSUER),
                role: Role::Member,
                code: [7; 16],
                validity: Epoch(100),
            }),
            ClaimState::Open,
            BuildMode::Production,
            BuildMode::Production,
            Role::KeyHolder,
            Epoch(1),
        )
        .expect("a well-formed ceremony");
        let persona = Persona::group_of_one(id(GROUP), Minted::from_mint(id(9)), ClaimState::Owner);
        assert!(matches!(
            announce(&mut c, &persona),
            Err(AnnouncementRefusal::Ceremony(_))
        ));
    }

    /// ‼ **THE THREE READINGS 6.5.1 FORBIDS, SWEPT.** Each is a sentence an
    /// implementation writes without noticing it has made membership depend
    /// on propagation.
    #[test]
    fn membership_never_depends_on_who_has_learned_of_it() {
        assert!(
            !requires_global_roster_push(),
            "6.5.1: no global roster push shall be required"
        );
        assert!(
            !may_refuse_verified_frame_from_unknown_member(),
            "not knowing a sender is a fact about this hive, not about the sender"
        );
        assert!(
            !unheard_of_member_indicates_failed_enrolment(),
            "the diagnosis it produces is a re-enrolment that was never needed"
        );
    }
}
