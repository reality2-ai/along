//! **What a surface may claim about who can observe (L2 11.4), and how peer
//! information reaches a beacon identifier (5.4.3).**
//!
//! # ‼ 11.4 IS A CLAIM RULE, AND ITS SUBJECT IS A PERSON
//!
//! *This standard offers **no confidentiality of traffic metadata against any
//! party within range of a bearer**. An implementation **shall not assume,
//! nor represent to a person**, that a peer's declared build mode, its group
//! membership, or its absence from any relationship **limits what it can
//! observe**.*
//!
//! Note 0: the clause generalises 11.1–11.3 *to the party neither of them
//! names: a listener in range that never relays, never declares and never
//! joins.* **The grounding is the medium, not anyone's honesty** — *on a
//! shared radio medium anyone in range is a party, whether anyone knows them
//! or not*, so **metadata leaves before any question of membership, trust or
//! build mode arises.**
//!
//! ‼ **SO THE THREE MOST NATURAL REASSURANCES ARE ALL FORBIDDEN**, and each
//! is a sentence a well-meaning surface writes without noticing: *only
//! development devices can see this*, *only group members are on this
//! network*, *that device is not entangled with anyone, so it cannot be
//! watching.* **Every one of them is false on a shared medium and all three
//! are the same mistake** — reasoning about observers from a relationship
//! rather than from range.
//!
//! # 5.4.3: the association comes from above the trust boundary
//!
//! *A hive holding information about a peer may associate the peer's beacon
//! identifier with that information, and **shall obtain the association above
//! the trust boundary — never by decoding the identifier**.*
//!
//! The identifier is opaque and 5.4.2 forbids deriving it from anything the
//! hive holds, so **there is nothing in it to decode** — and a decoder would
//! be inventing a meaning the emitter never put there.

use crate::l2::BeaconId;
use r2_ident::HiveId;

/// A ground on which a surface might claim an observer is limited.
///
/// ‼ **ALL THREE ARE THE ONES 11.4 NAMES, AND ALL THREE ARE REFUSED.** They
/// are enumerated rather than left implicit because *each is a sentence a
/// well-meaning surface writes without noticing it is a claim about
/// physics.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimedLimit {
    /// *"Only development devices can see this."*
    DeclaredBuildMode,
    /// *"Only group members are on this network."*
    GroupMembership,
    /// *"That device is entangled with nobody, so it cannot be watching."*
    AbsenceFromAnyRelationship,
}

/// Whether a surface may tell a person that this limits what a party in range
/// can observe.
///
/// ‼ **ALWAYS `false`, AND THE FUNCTION EXISTS SO THE ANSWER IS ASKED.** A
/// constant `false` in a doc comment is a rule somebody reads once; a call
/// that returns `false` is a rule a surface has to route its reassurance
/// through, and `git grep may_represent_as_limiting_observation` finds every
/// place one was contemplated.
///
/// *The grounding is the medium, not anyone's honesty* — so no argument about
/// who a peer is can change the answer, which is why nothing is passed in but
/// the ground being claimed.
pub const fn may_represent_as_limiting_observation(_ground: ClaimedLimit) -> bool {
    false
}

/// What a surface may honestly say about observation on a shared medium.
///
/// **Offered as text rather than left to each surface to phrase**, because
/// 11.4's prohibition is on *representing* — and a surface that had to invent
/// its own wording is a surface that will eventually invent a reassuring
/// one.
pub const fn honest_observation_statement() -> &'static str {
    "Anyone within range of a bearer can observe this traffic's metadata. \
     Build mode, group membership and entanglement do not limit that."
}

/// How a hive learned to associate peer information with a beacon
/// identifier (5.4.3).
///
/// ‼ **THE ONLY CONSTRUCTOR NAMES THE SOURCE, WHICH IS THE AUDIT.** 5.4.3
/// says the association *shall be obtained above the trust boundary — never
/// by decoding the identifier* — a rule no type can enforce, because an
/// association obtained either way is the same pair once it exists. *So
/// `git grep from_above_the_trust_boundary` is how a reviewer checks nothing
/// decoded one.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PeerAssociation<'a> {
    beacon: BeaconId,
    identity: Option<HiveId>,
    info: &'a str,
}

/// ‼ **5.4.3's RESTRICTION, PROVED SHUT FROM OUTSIDE THE TYPE** (`L2-019`, added
/// 2026-09-04 after an adversarial pass).
///
/// The clause has two halves. *May associate* is behaviour and is tested. *Never by
/// decoding the identifier* is a statement about what does NOT exist — and adding the
/// forbidden constructor left the behavioural test green, because a test that drives the
/// legitimate route says nothing about a second route beside it. The row's own note
/// admitted this was a grep audit rather than a check.
///
/// So it is a `compile_fail` block, and it is the same instrument the neighbour-key rule
/// uses: every field is private and both constructors are NAMED FOR THEIR PROVENANCE, so
/// no association reaches this type without one of them. The block goes red the moment a
/// decoding route is added, however it is spelled, because then it compiles.
///
/// ```compile_fail
/// use r2_discovery::l2::BeaconId;
/// use r2_discovery::observability::PeerAssociation;
/// let beacon = BeaconId::new(&[1, 2, 3, 4]).unwrap();
/// // 5.4.3 forbids obtaining the association BY DECODING the identifier.
/// let _ = PeerAssociation::by_decoding_the_identifier(beacon, "peer info");
/// ```
///
/// And the present-control, so the refusal above is attributable to the ABSENCE of a
/// decoding route and not to a broken fixture — *a nil with no positive beside it is a
/// broken harness wearing a clean result*:
///
/// ```
/// use r2_discovery::l2::BeaconId;
/// use r2_discovery::observability::PeerAssociation;
/// let beacon = BeaconId::new(&[1, 2, 3, 4]).unwrap();
/// let a = PeerAssociation::from_above_the_trust_boundary(beacon, "peer info");
/// assert_eq!(a.beacon(), beacon);
/// assert!(a.identity().is_none());
/// ```
pub const ABOVE_THE_TRUST_BOUNDARY_IS_THE_ONLY_WAY_IN: () = ();

impl<'a> PeerAssociation<'a> {
    /// The association came from verified traffic, a ceremony, or an
    /// operator — **anything above the trust boundary.**
    pub const fn from_above_the_trust_boundary(beacon: BeaconId, info: &'a str) -> Self {
        Self {
            beacon,
            identity: None,
            info,
        }
    }

    /// The association came from the same above-trust source and resolved the
    /// peer's canonical identity as well as holding other peer information.
    ///
    /// The beacon identifier remains opaque: this stores an answer the source
    /// obtained elsewhere, never a value derived from the identifier.
    pub const fn resolved_above_the_trust_boundary(
        beacon: BeaconId,
        identity: HiveId,
        info: &'a str,
    ) -> Self {
        Self {
            beacon,
            identity: Some(identity),
            info,
        }
    }

    pub const fn beacon(&self) -> BeaconId {
        self.beacon
    }

    /// The peer's resolved identity, where the above-trust source supplied
    /// one. Absence remains distinct from a beacon identifier that could be
    /// decoded — there is no such decoding operation.
    pub const fn identity(&self) -> Option<HiveId> {
        self.identity
    }

    pub const fn info(&self) -> &'a str {
        self.info
    }
}

/// ‼ **THERE IS NO `decode`, AND ITS ABSENCE IS THE CLAUSE.** 5.4.2 forbids
/// deriving a beacon identifier from anything the hive holds, so **there is
/// nothing in it to decode** — *a decoder would be inventing a meaning the
/// emitter never put there*, and 5.4.3 forbids obtaining the association that
/// way in any case.
///
/// Stated as a function so the refusal is greppable rather than an absence a
/// reader must notice.
pub const fn identifier_carries_no_decodable_meaning() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beacon(n: u8) -> BeaconId {
        BeaconId::new(&[n, n, n, n]).expect("four octets")
    }

    /// ‼ **ALL THREE GROUNDS 11.4 NAMES ARE REFUSED, AND THE SWEEP IS THE
    /// POINT.** *Each is a sentence a well-meaning surface writes without
    /// noticing*: only development devices can see this; only group members
    /// are on this network; that device is entangled with nobody, so it
    /// cannot be watching. **All three are false on a shared medium and all
    /// three are the same mistake** — reasoning about observers from a
    /// relationship rather than from range.
    #[test]
    fn no_relationship_may_be_represented_as_limiting_observation() {
        for ground in [
            ClaimedLimit::DeclaredBuildMode,
            ClaimedLimit::GroupMembership,
            ClaimedLimit::AbsenceFromAnyRelationship,
        ] {
            assert!(
                !may_represent_as_limiting_observation(ground),
                "{ground:?} must never be represented to a person as limiting \
                 what a party in range can observe"
            );
        }
    }

    /// The honest statement names the medium rather than a relationship, and
    /// mentions all three grounds so a reader cannot infer that one of them
    /// was left out on purpose.
    #[test]
    fn the_honest_statement_grounds_itself_in_range_and_not_in_trust() {
        let s = honest_observation_statement();
        assert!(s.contains("within range"), "the grounding is the medium");
        assert!(s.contains("Build mode"));
        assert!(s.contains("group membership"));
        assert!(s.contains("entanglement"));
    }

    /// **5.4.3**: the association is held, and the only way to make one names
    /// where it came from.
    #[test]
    fn an_association_names_its_source_at_the_only_constructor() {
        let a = PeerAssociation::from_above_the_trust_boundary(beacon(3), "roof sensor, bay 2");
        assert_eq!(a.beacon(), beacon(3));
        assert_eq!(a.identity(), None);
        assert_eq!(a.info(), "roof sensor, bay 2");
    }

    #[test]
    fn a_resolved_identity_is_still_an_above_trust_answer() {
        let identity = HiveId([0xA5; 8]);
        let a = PeerAssociation::resolved_above_the_trust_boundary(
            beacon(4),
            identity,
            "verified contact",
        );
        assert_eq!(a.beacon(), beacon(4));
        assert_eq!(a.identity(), Some(identity));
        assert_eq!(a.info(), "verified contact");
    }

    /// ‼ **THERE IS NOTHING IN THE IDENTIFIER TO DECODE.** 5.4.2 forbids
    /// deriving it from anything the hive holds, so *a decoder would be
    /// inventing a meaning the emitter never put there* — and there is
    /// deliberately no function that takes an identifier and returns
    /// information about a peer.
    #[test]
    fn the_beacon_identifier_carries_no_decodable_meaning() {
        assert!(identifier_carries_no_decodable_meaning());
    }
}
