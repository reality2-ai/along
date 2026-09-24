//! The delivery gate (L5 Clause 7, register rows L5-055..L5-059, L5-091,
//! L5-097).
//!
//! This is the stack's **one binary gate**: below and around it everything
//! is belief — probabilistic, local, decaying — and here the tag verifies
//! under a held key or it does not (00-overview Clause 4). Two disciplines,
//! one boundary, and keeping them apart is the design.
//!
//! Passing the gate is a **floor, not a character reference** (L5 7.2): an
//! operation whose effect depends on *which* member asked, or on *when*,
//! requires evidence beyond the gate — a signature attributable to a
//! member, freshness evidence, or both (L5 7.2.3 / L5-062).
//!
//! Two rules shape this module's *absences*, and both are deliberate:
//!
//! - **Failing open shall not be a configuration, a fallback, or a
//!   migration default** (L5 7.1.3 / L5-058). There is therefore no
//!   permissive mode, no "allow unverified" switch, and no constructor
//!   that yields one.
//! - **No local-network, same-site or debug exemption in a production
//!   image** (L5 7.1.4 / L5-060), and the gate is identical on every
//!   platform class and every bearer (7.1.4 / L5-059). Nothing here is
//!   `cfg`-conditional and nothing consults the bearer or the class —
//!   L5 7.1 Note 3 records the failure this prevents: *an inactive gate
//!   that reported itself as a gate.*

use crate::identity::WireIdentity;
use r2_hal_traits::Ticks;
use r2_wire::{Frame, Target};

/// An entanglement's identifier, as named by the deployment. Acceptance
/// establishes *which entanglement* a frame crossed — never which member
/// of the entangled group sent it (L5 10.4.1 / L5-097).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct EntanglementId(pub u32);

/// How a frame's target relates to this hive (L4 6.1.2: the receiver
/// resolves the compact tier's group-or-hive ambiguity against its own
/// identity and memberships).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Addressing {
    /// Addressed to all hives.
    Broadcast,
    /// Addressed to this hive's group.
    MyGroup,
    /// Addressed to this hive specifically.
    MyHive,
    /// Addressed elsewhere.
    Other,
}

impl Addressing {
    /// Whether the frame is addressed to this hive at all. Frames that are
    /// not are relay-only and never delivered locally (L5 7.1.2 a).
    pub const fn is_for_me(self) -> bool {
        !matches!(self, Addressing::Other)
    }
}

/// Classify a frame's target against this hive's wire identity.
///
/// L5 7.1.2 a) asks whether a frame is addressed to **me** — my group, my
/// hive, or all hives (citing L4 6.1) — and 7.1.2 Note 1 states what that
/// arm decides: *whose frame this is*, not which key opens it. Only
/// [`Addressing::Other`] is relay-only.
///
/// (The clause formerly read "not addressed to my group", which taken
/// literally made unicast-to-hive and broadcast undeliverable; this lane
/// reported it and the standard corrected the text — standard D-031,
/// `PROVISIONAL(supervisor)` pending Roy's ratification per d014.)
pub fn classify_target(target: Target, me: &WireIdentity) -> Addressing {
    match target {
        Target::Compact(0) => Addressing::Broadcast,
        Target::Compact(t) if t == me.hive_half => Addressing::MyHive,
        Target::Compact(t) if t == me.group_half => Addressing::MyGroup,
        Target::Compact(_) => Addressing::Other,
        Target::Extended { group, hive } => {
            // Zero means *any* per half (L4 6.1.3).
            let group_matches = group == 0 || group == me.group_half;
            let hive_matches = hive == 0 || hive == me.hive_half;
            match (group_matches, hive_matches) {
                (false, _) => Addressing::Other,
                (true, false) => Addressing::Other,
                (true, true) if group == 0 && hive == 0 => Addressing::Broadcast,
                (true, true) if hive == me.hive_half => Addressing::MyHive,
                (true, true) => Addressing::MyGroup,
            }
        }
    }
}

/// How a delivered frame reached this hive — the marking L5 provides to the
/// layers above (L5 11.1 a / L5-098).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Delivery {
    /// Verified under the group's own integrity key.
    IntraGroup,
    /// Verified under a live entanglement's keys, subject to that
    /// entanglement's scope and level (L5 7.1.2 c).
    Crossing(EntanglementId),
    /// Carried no tag at all. Not the 7.1.2 d) case: a frame carrying no
    /// tag may be delivered as unauthenticated (L5 10.1.2 / L5-091).
    Unauthenticated,
}

/// The gate's verdict.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GateOutcome {
    /// Deliver upward, marked.
    Deliver(Delivery),
    /// Not addressed here: relay only, never deliver locally
    /// (L5 7.1.2 a).
    RelayOnly,
    /// Carried a group tag that verified under nothing (L5 7.1.2 d), or
    /// arrived group-addressed with no usable key held (L5 7.1.3 /
    /// L5-057).
    Drop,
}

/// A group integrity key and, where one is in grace, the immediately prior
/// key with the instant its grace ends (L5 7.1.2 b).
#[derive(Clone, Copy)]
pub struct GroupKeys<'a> {
    current: &'a [u8],
    /// The **immediately prior** key only, valid only within its grace
    /// period — never an unbounded history.
    prior: Option<(&'a [u8], Ticks)>,
}

impl<'a> GroupKeys<'a> {
    /// Build the keys **only if this device's credentials confer anything
    /// for this group** (L5 9.3).
    ///
    /// ‼ **THE DEFECT THIS ANSWERS IS THAT THE CHECK EXISTED AND NOTHING
    /// RAN IT.** `membership::credentials_confer` decides correctly and had
    /// **no caller outside its own tests**, while `apply_gate` never
    /// consulted membership, build mode or group kind — *so a production
    /// device handed the development group's keys passed the gate for that
    /// group's traffic.* `L5-087`'s own text said the excuse did not apply
    /// here: **the gate is in this crate and could consult it.**
    ///
    /// ‼ **PLACED AT CONSTRUCTION RATHER THAN AT THE GATE, AND THAT IS THE
    /// STRONGER PLACE.** A gate-side check runs once per frame and can be
    /// bypassed by any caller that builds the keys another way; **keys that
    /// cannot be built are keys no frame can be verified under.** *A
    /// safety property enforced per-call is one somebody eventually calls
    /// around.*
    ///
    /// **`None` is the refusal**, and it carries no reason on purpose:
    /// there is exactly one, and a `Result` here would invite a caller to
    /// match on it and proceed.
    ///
    /// ‼ **AND THE FIELDS ARE PRIVATE, SO THIS IS THE ONLY WAY IN.** They
    /// were public for six hours after this constructor landed, because
    /// closing them would have broken `r2-hive`'s two sites and blocked the
    /// shared tip — *which this lane has done twice and would not do a
    /// third time without asking.* `hive` converted both at `016e5e2`,
    /// verified here as **zero `GroupKeys` struct literals in that tree**,
    /// and the fields closed. **A two-step that cost six hours and blocked
    /// nobody.**
    ///
    /// ‼ **`None` HERE IS NOT THE SAME FACT AS A CALLER HOLDING NO KEY**,
    /// and `hive` added the half that makes it safe: both arrive at
    /// [`apply_gate`] as an absent key and **they mean opposite things** —
    /// one is *nothing to verify under*, the other is *these credentials
    /// confer nothing here*. **Collapsing them would make a live safety
    /// refusal indistinguishable from an unconfigured bench**, silently and
    /// *in the flattering direction*: the run proceeds, `Deliver` appears,
    /// and nobody learns the group check fired. **Every call site must
    /// decide which it is looking at** — `hive`'s live site prints the
    /// refusal, and its test helper panics, because there a refusal is a
    /// setup fault rather than a result.
    pub fn for_group<const N: usize>(
        device: r2_hal_traits::build_mode::BuildMode,
        group: crate::membership::GroupKind,
        current: &'a crate::keys::SecretKey<N>,
        prior: Option<(&'a crate::keys::SecretKey<N>, Ticks)>,
    ) -> Option<Self> {
        if !crate::membership::credentials_confer(device, group) {
            return None;
        }
        // The raw slices live only inside this crate: `expose` is
        // crate-private, and this constructor is how a consumer's key in
        // custody reaches the gate (r2-codex-refute, 2026-08-25).
        Some(Self {
            current: current.expose(),
            prior: prior.map(|(k, t)| (k.expose().as_slice(), t)),
        })
    }
}

/// The grade an entanglement was established at (L5A 5.3.1), ordered
/// **weakest to strongest** — and the order is the type's, not a
/// convention, so a comparison cannot be written backwards.
///
/// ‼ **THE GRADE IS A CEILING, NOT A LABEL** (L5A 5.3.4): a receiver
/// treats it as a bound on what its own policies may accept over the
/// entanglement. **The gate cannot enforce that bound**, because L5 10.1.1
/// gives the decision to the receiving side *per operation* and the gate
/// does not know the operation — so the gate's obligation is to make the
/// **current** grade available, which is what [`crossing_grade`] does.
///
/// *Grade 0 is stated honestly rather than dressed up: its keys encrypt
/// against the world and authenticate nothing about the counterpart.*
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Grade {
    /// 0 — nothing beyond the in-band exchange; defeats passive observation only.
    Opportunistic,
    /// 1 — a verification string compared over a channel establishment did not use.
    Confirmed,
    /// 2 — an introducer's member-attributable attestation of the counterpart.
    Introduced,
    /// 3 — grade 1 or 2, and a person on each side confirming.
    Ceremonial,
}

/// One live entanglement's verification material.
#[derive(Clone, Copy)]
pub struct LiveEntanglement<'a> {
    id: EntanglementId,
    key: &'a [u8],
    /// The grade this entanglement is live **at right now** (L5A 5.3.1).
    ///
    /// ‼ **DEMOTION IS A CHANGE TO THIS FIELD, AND THAT IS WHY IT IS *AT
    /// ONCE*** (L5 10.3.2). The gate reads the live set **as given at the
    /// call**, so lowering a grade takes effect on the very next frame —
    /// *the same mechanism that makes severing immediate, which is removal
    /// from the same set.* **There is no cached grade anywhere**, so an
    /// old ceiling cannot outlive the demotion that lowered it.
    grade: Grade,
}

impl<'a> LiveEntanglement<'a> {
    /// ‼ **THE FIELDS ARE PRIVATE AND THERE IS NO PUBLIC CONSTRUCTOR, AND
    /// THAT IS THE ACCEPTANCE CRITERION FOR THE L5A PROGRAMME MADE
    /// STRUCTURAL.** Five rows in this lane's matrix were `CLOSED` under
    /// `01-terminology` 4.7 because **every input to their demonstration
    /// was produced by the implementation under test** — the entanglements
    /// the gate judged were struct literals, so *those demonstrations could
    /// not have come out otherwise.*
    ///
    /// The only way to obtain one is now
    /// [`crate::entanglement::Held::to_live`], and the only way to obtain a
    /// `Held` is to complete an establishment. **A grade the gate sees has
    /// therefore been agreed, signed over, verified, keyed and tried** —
    /// *not typed.*
    ///
    /// Measured before closing it: **zero constructions outside this crate**
    /// across `r2-hive`, `r2-android` and `r2-composer`, with the
    /// present-control that 14 files in `r2-hive` do reference `r2-trust`,
    /// **so the nil is bounded rather than blind.**
    pub(crate) fn new(id: EntanglementId, key: &'a [u8], grade: Grade) -> Self {
        Self { id, key, grade }
    }

    pub fn id(&self) -> EntanglementId {
        self.id
    }

    pub fn key(&self) -> &'a [u8] {
        self.key
    }

    /// The grade this entanglement is live at **right now** — read from the
    /// held agreement when it was built, never set beside it.
    pub fn grade(&self) -> Grade {
        self.grade
    }
}

/// What level an operation requires before it may act (L5 10.1.1's
/// ladder, from the receiving side).
///
/// ‼ **THE CALLER CHOOSES THIS PER OPERATION AND THIS CRATE NEVER DOES.**
/// 10.1.1 gives the decision to the receiving side *per operation*, so a
/// policy that mapped operations to levels here would be **this crate
/// deciding what another layer's operations are worth**. What core owns is
/// the **comparison** — so that every caller does not re-derive the ladder
/// and get its ordering backwards.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RequiredLevel {
    /// Only a frame verified under the receiver's own group key.
    SameGroup,
    /// A crossing of a live entanglement at **at least** this grade.
    Entangled(Grade),
    /// Anything the gate delivered, including an untagged frame.
    ///
    /// *An unauthenticated frame claims nothing and gets nothing — but a
    /// public reading, a discovery exchange and a first hello all live
    /// here, and requiring entanglement for them would make every first
    /// contact impossible.*
    Unauthenticated,
}

/// Whether a delivered frame satisfies what this operation requires
/// (L5 10.1.1; L5A 5.3.4's ceiling, enforced).
///
/// ‼ **THIS IS THE CONSUMER OF THE CEILING, AND WITHOUT IT THE GRADE IS
/// EXPOSED AND ENFORCED BY NOTHING** — `standard`'s challenge on
/// `L5A-021`, and it was right: *a ceiling nothing consults is not a
/// ceiling.*
///
/// The grade is resolved through [`crossing_grade`] **at the moment of the
/// question**, from the same live set the gate verified against — so a
/// demotion or a severance is in force here immediately, with **no cached
/// grade between the two decisions.**
///
/// ‼ **A SEVERED ENTANGLEMENT SATISFIES NOTHING ABOVE `Unauthenticated`.**
/// `crossing_grade` answers `None`, and `None` is treated as *no grade at
/// all* rather than as a weak one — a caller that read it the other way
/// would restore exactly the crossings 10.3.2 requires to stop.
pub fn permits(
    delivery: Delivery,
    required: RequiredLevel,
    entanglements: &[LiveEntanglement<'_>],
) -> bool {
    match (delivery, required) {
        // Same-group is the top of the ladder and satisfies every rung.
        (Delivery::IntraGroup, _) => true,
        // A crossing never satisfies a same-group requirement: passage
        // under an entanglement's keys says nothing about own-group
        // membership.
        (Delivery::Crossing(_), RequiredLevel::SameGroup) => false,
        (Delivery::Crossing(id), RequiredLevel::Entangled(floor)) => {
            matches!(crossing_grade(id, entanglements), Some(g) if g >= floor)
        }
        (Delivery::Crossing(_), RequiredLevel::Unauthenticated) => true,
        // An untagged frame claimed nothing, so it can satisfy only the
        // rung that asks for nothing.
        (Delivery::Unauthenticated, RequiredLevel::Unauthenticated) => true,
        (Delivery::Unauthenticated, _) => false,
    }
}

/// The grade a crossing is currently live at, or `None` where the
/// entanglement is not in the live set at all.
///
/// **This is the receiver's enforcement point** (L5A 5.3.4, and L5 10.3.2
/// Note 3: *the receiver's enforcement point is the delivery gate*). A
/// caller re-scopes a crossing by consulting it, and gets the demoted
/// grade immediately because it reads the same set the gate verified
/// against.
///
/// ‼ **`None` MEANS SEVERED AND NOT *UNGRADED***, which is the direction
/// that matters: a caller that treated a missing entanglement as
/// permissive would restore exactly the crossings 10.3.2 requires to stop.
pub fn crossing_grade(id: EntanglementId, entanglements: &[LiveEntanglement<'_>]) -> Option<Grade> {
    entanglements.iter().find(|e| e.id == id).map(|e| e.grade)
}

/// The frame's authenticated span, presented as a callback that feeds its
/// pieces in order (L4 10.2.1) without copying them into a buffer.
///
/// # The conditions under which a tag verified over this is meaningful
///
/// Stated because **terminology 5.4b / T-007 requires it, and because
/// this type cannot enforce it**. `Span` is an opaque callback: the gate
/// verifies a tag over *whatever bytes it is fed*, and the claim that
/// those bytes are L4 10.2.1's authenticated span is a **contract in
/// prose**, not a property of the type.
///
/// A conforming caller feeds exactly, in this order:
/// frame type · message identifier (2 bytes compact, 4 extended) · route
/// origin · event hash · target (2 bytes compact; group then hive
/// extended) · payload. `r2_wire::Frame::authenticated_span` writes
/// precisely that, and calling it is the only way to be sure.
///
/// **The hazard, which is a security one rather than an interop one.** A
/// caller that feeds a *shorter* sequence — omitting the target, say —
/// gets a tag that verifies while saying nothing about the omitted field,
/// so an attacker may alter it freely. Nothing here refuses that: the
/// span arrives as bytes and every byte sequence is a valid one.
///
/// **Why this interface exists at all is worth knowing** (LESSONS 1.79):
/// L0 6.1 forbids Layer 1–4 code from touching trust material, so the
/// span must be computed at Layer 4 and the tag verified at Layer 5.
/// **The isolation requirement manufactured this agreement problem** —
/// the two ends could not have been one function. Neither clause is
/// wrong; their product is a seam where divergence is the default rather
/// than the accident, which is exactly why the predicate is written out
/// here instead of left in a function body.
///
/// **Named limit and a stated next action**: this *should* be structural.
/// `r2-trust` already depends on `r2-wire`, so the gate could take a
/// `&Frame` and call `authenticated_span` itself, making a wrong span
/// unrepresentable rather than merely discouraged. That is a signature
/// change at a load-bearing seam and is recorded rather than made
/// hurriedly — see RESUME's named limits.
/// Appended to a span that could not be completed, so a tag computed
/// over the partial bytes cannot verify.
///
/// A short span is the hazard L5 7.1.3a exists to prevent: a tag over
/// fewer bytes than the frame says nothing about the omitted fields
/// while still verifying. Poisoning makes that outcome impossible
/// rather than improbable.
const SHORT_SPAN_POISON: &[u8] = b"r2/v0/span/incomplete";

pub type Span<'a> = &'a dyn Fn(&mut dyn FnMut(&[u8]));

/// Tag verification, supplied by the caller. The mechanics are Layer 4's
/// (L5 11.2 / L5-099) and the key material is this layer's; the gate owns
/// only the **order** in which keys are tried.
///
/// Implementations compare in constant time (L4 10.1.3) and return false on
/// any failure without distinguishing why.
pub trait TagVerifier {
    fn verify(key: &[u8], span: Span<'_>, tag: &[u8]) -> bool;
}

/// Apply the delivery gate (L5 7.1.2), in order:
///
/// a) not addressed to me → relay only, never deliver locally;
/// b) addressed here → verify against the group's currently valid integrity
///    keys — the current key, and the immediately prior key only within its
///    grace period; on success, deliver as intra-group;
/// c) on failure of b), trial-verify against each live entanglement's keys;
///    on a match, deliver as a crossing of that entanglement;
/// d) nothing verifies → drop.
///
/// An untagged frame is not case d): it may be delivered as unauthenticated
/// (L5 10.1.2). `keys` is `None` where this hive holds no usable key, in
/// which case a tagged group-addressed frame is dropped rather than
/// delivered (L5 7.1.3).
///
/// The gate is identical on every platform class and every bearer
/// (L5 7.1.4 / L5-059): nothing here consults either.
#[allow(clippy::too_many_arguments)]
pub fn apply_gate<V: TagVerifier>(
    addressing: Addressing,
    frame: &Frame<'_>,
    keys: Option<GroupKeys<'_>>,
    entanglements: &[LiveEntanglement<'_>],
    now: Ticks,
) -> GateOutcome {
    // a) not addressed to me: relay only, never deliver locally.
    if !addressing.is_for_me() {
        return GateOutcome::RelayOnly;
    }

    let Some(tag) = frame.tag() else {
        // Not the d) case (L5 10.1.2): no tag, no claim, may be delivered
        // as unauthenticated. What the layers above then permit is theirs.
        return GateOutcome::Deliver(Delivery::Unauthenticated);
    };

    // **The span is computed here, from the frame** (L5 7.1.3a): a
    // caller-chosen byte sequence shall not be accepted as the span. This
    // function previously took one, and a caller feeding a short sequence
    // obtained a tag that verified while saying nothing about the omitted
    // field. Nothing refused it, because every byte sequence is a valid
    // one — the hazard was not an implementation slip but what an opaque
    // callback across the L0 6.1 boundary makes possible.
    //
    // Establish the span is computable *before* verifying anything. A
    // tagged frame with no route origin has no authenticated span at all
    // (L4 10.2.1), so there is nothing for a tag to be a tag *over*: it
    // carried a tag that verified under nothing, which is 7.1.2 d).
    //
    // The probe calls `authenticated_span` rather than testing the origin
    // directly, so this function and Layer 4 cannot drift about what makes
    // a span computable — one definition, not two agreeing by habit.
    if frame.authenticated_span(&mut |_| {}).is_err() {
        return GateOutcome::Drop;
    }
    let span_of = |sink: &mut dyn FnMut(&[u8])| {
        // **THE CALL MUST NOT LIVE INSIDE A MACRO THAT DISAPPEARS.**
        //
        // This was `debug_assert!(frame.authenticated_span(sink).is_ok())`,
        // and `debug_assert!` compiles out in release **taking the call
        // with it**. So in every release build the sink received NOTHING
        // and `V::verify` computed the tag over an EMPTY message. Found
        // by r2-hive on hardware-adjacent host nodes, measured across
        // three builds of one unchanged source: release DROP, debug
        // DELIVER, release with `-C debug-assertions=yes` DELIVER. *The
        // only variable was this macro.*
        //
        // Two consequences, and the second is worse. **Availability**:
        // every correctly tagged frame is dropped in release, so
        // `Delivery::IntraGroup` is unreachable, so `verified_evidence`
        // is unreachable, so no path can ever establish. **Integrity**:
        // the tag stops being bound to the frame — every tag is checked
        // against `HMAC(key, EMPTY)`, so one constant tag verifies over
        // arbitrary content, any target, any origin, any payload. It
        // failed closed only by accident, because a sender computing
        // the real span disagrees; two peers both on this path would
        // agree on nothing-as-the-message and forgery would be free.
        //
        // **And no test in the default configuration can see it**:
        // `cargo test` builds in debug. The falsifier is the build
        // profile, not the input.
        //
        // *The comment that stood here named the short-span hazard and
        // said it could not be ignored — above an expression that
        // ignored it in every shipped build.*
        if frame.authenticated_span(sink).is_err() {
            // Probed computable immediately above, so unreachable in
            // practice. If it is ever reached the sink has ALREADY
            // received a short span — the exact hazard 7.1.3a exists to
            // prevent — so the span is poisoned to guarantee the tag
            // cannot verify. **Fail closed, never quietly short.**
            sink(SHORT_SPAN_POISON);
        }
    };
    let span: Span<'_> = &span_of;

    // b) the group's currently valid integrity keys.
    if let Some(k) = keys {
        if V::verify(k.current, span, tag) {
            return GateOutcome::Deliver(Delivery::IntraGroup);
        }
        // The immediately prior key, and only within its grace period.
        if let Some((prior, grace_ends)) = k.prior {
            if now < grace_ends && V::verify(prior, span, tag) {
                return GateOutcome::Deliver(Delivery::IntraGroup);
            }
        }
    }

    // c) live entanglements, trial-verified. A severed entanglement is
    // absent from this slice, and severing stops crossings at once
    // (L5 10.3.2 / L5-095).
    for e in entanglements {
        if V::verify(e.key, span, tag) {
            return GateOutcome::Deliver(Delivery::Crossing(e.id));
        }
    }

    // d) nothing verifies.
    GateOutcome::Drop
}

/// Whether an operation may rest on the gate alone.
///
/// The gate establishes that a frame is the group's. It establishes
/// nothing about *which member* sent it or *when* — so an operation whose
/// effect depends on either requires evidence beyond it (L5 7.2.3 /
/// L5-062). Callers pass what the operation depends on; the answer is
/// deliberately conservative.
pub const fn gate_alone_suffices(depends_on_member: bool, depends_on_time: bool) -> bool {
    !depends_on_member && !depends_on_time
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::entanglement::{
        establish_for_test, Condition, ConditionClass, Direction, FailureClass, Held,
    };

    const ME: WireIdentity = WireIdentity {
        hive_half: 0x1111_1111,
        group_half: 0x2222_2222,
    };

    /// Verifier that accepts exactly one key, standing in for a real MAC.
    struct KeyIs<const K: u8>;

    impl<const K: u8> TagVerifier for KeyIs<K> {
        fn verify(key: &[u8], _span: Span<'_>, _tag: &[u8]) -> bool {
            key == [K]
        }
    }

    /// Build a real frame, because the gate now computes the span from one.
    ///
    /// The previous helper was `fn span(_sink) {}` — **an empty span**,
    /// fed to the verifier as though it were the authenticated bytes.
    /// That test double could not exist under 7.1.3a, and its removal is
    /// the point of the change rather than a consequence of it: the
    /// interface no longer has a place to put one.
    fn encode_frame<'a>(buf: &'a mut [u8], tag: Option<&'a [u8]>) -> usize {
        use r2_wire::{FrameSpec, FrameType};
        const ORIGIN: &[u8] = &[0xAB, 0xCD, 0xEF, 0x01];
        FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: true,
            hop_limit: 5,
            budget: 6,
            msg_id: 0x1234,
            event_hash: 0x9ABC_DEF0,
            target: Target::Compact(0x2222_2222),
            route: Some(ORIGIN),
            payload: b"payload",
            tag,
        }
        .encode(buf)
        .expect("frame encodes")
    }

    fn gate<const K: u8>(
        addressing: Addressing,
        tag: Option<&[u8]>,
        keys: Option<GroupKeys<'_>>,
        ents: &[LiveEntanglement<'_>],
        now: u64,
    ) -> GateOutcome {
        // A tag on the wire is a fixed width (L4: 8 bytes compact). The
        // callers below pass a one-byte stand-in because these tests are
        // about WHICH KEY is tried, not about tag contents — `KeyIs`
        // ignores the tag entirely. Widen it here rather than weaken the
        // encoder, which is the party that should refuse a wrong-length
        // tag.
        let mut wide = [0u8; r2_wire::frame::COMPACT_TAG_LEN];
        let has_tag = tag.is_some();
        if let Some(t) = tag {
            let n = t.len().min(wide.len());
            wide[..n].copy_from_slice(&t[..n]);
        }
        let tag: Option<&[u8]> = if has_tag { Some(&wide[..]) } else { None };
        let mut buf = [0u8; 128];
        let n = encode_frame(&mut buf, tag);
        let frame = Frame::parse(&buf[..n], r2_wire::Tier::Compact).expect("frame parses");
        apply_gate::<KeyIs<K>>(addressing, &frame, keys, ents, Ticks(now))
    }

    /// The verifier records what span it was actually given, so a test can
    /// assert the gate fed it the frame's own bytes rather than trusting
    /// that it did.
    struct Recording;
    impl TagVerifier for Recording {
        fn verify(_key: &[u8], span: Span<'_>, _tag: &[u8]) -> bool {
            let mut total = 0usize;
            span(&mut |piece: &[u8]| total += piece.len());
            // A non-empty span is the whole claim: the previous interface
            // allowed a caller to pass one that fed nothing at all.
            total > 0
        }
    }

    #[test]
    fn the_gate_verifies_over_the_frames_own_span_not_a_supplied_one() {
        // L5 7.1.3a. The old signature took `span: Span<'_>` and verified
        // over whatever bytes it was handed — a caller feeding a short or
        // empty sequence obtained a tag that verified while saying nothing
        // about the omitted fields. There is now no parameter through
        // which to do that, and this asserts the replacement is real
        // rather than nominal: the verifier is handed a span with bytes in
        // it, sourced from the frame.
        let mut buf = [0u8; 128];
        let tag = [0xEEu8; r2_wire::frame::COMPACT_TAG_LEN];
        let n = encode_frame(&mut buf, Some(&tag));
        let frame = Frame::parse(&buf[..n], r2_wire::Tier::Compact).expect("parses");

        let keys = GroupKeys {
            current: &[1],
            prior: None,
        };
        assert_eq!(
            apply_gate::<Recording>(Addressing::MyGroup, &frame, Some(keys), &[], Ticks(0)),
            GateOutcome::Deliver(Delivery::IntraGroup),
            "the verifier was handed an empty span"
        );
    }

    #[test]
    fn this_crate_cannot_originate_a_tagged_frame_with_no_span() {
        // A tagged frame whose route carries no origin has no
        // authenticated span at all (L4 10.2.1), so there is nothing for
        // the tag to be a tag OVER.
        //
        // **Named limit.** The gate drops such a frame (7.1.2 d), and that
        // path is NOT exercised here, because this crate cannot build one
        // to feed it: Layer 4's encoder refuses to originate it, which is
        // what this test actually demonstrates. The gate's guard is
        // therefore defence against a *non-conforming or hostile sender*,
        // reachable only from wire bytes, and it is untested rather than
        // proven. Testing it needs hand-built bytes that `Frame::parse`
        // accepts — recorded rather than faked.
        use r2_wire::{FrameSpec, FrameType};
        let mut buf = [0u8; 128];
        let tag = [0xEEu8; r2_wire::frame::COMPACT_TAG_LEN];
        let n = FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: false,
            hop_limit: 5,
            budget: 6,
            msg_id: 0x1234,
            event_hash: 0x9ABC_DEF0,
            target: Target::Compact(0x2222_2222),
            route: None, // no origin
            payload: b"payload",
            tag: Some(&tag),
        }
        .encode(&mut buf);

        // Layer 4 refuses at the encoder: a tag with nothing to be a tag
        // OVER is not a frame this stack will originate.
        assert_eq!(n, Err(r2_wire::EncodeError::MissingOrigin));
    }

    #[test]
    fn classify_resolves_compact_ambiguity_against_own_identity() {
        assert_eq!(
            classify_target(Target::Compact(0), &ME),
            Addressing::Broadcast
        );
        assert_eq!(
            classify_target(Target::Compact(0x1111_1111), &ME),
            Addressing::MyHive
        );
        assert_eq!(
            classify_target(Target::Compact(0x2222_2222), &ME),
            Addressing::MyGroup
        );
        assert_eq!(
            classify_target(Target::Compact(0xDEAD_BEEF), &ME),
            Addressing::Other
        );
    }

    #[test]
    fn classify_extended_zero_half_means_any() {
        // Any hive in my group.
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: 0x2222_2222,
                    hive: 0
                },
                &ME
            ),
            Addressing::MyGroup
        );
        // My hive specifically, in my group.
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: 0x2222_2222,
                    hive: 0x1111_1111
                },
                &ME
            ),
            Addressing::MyHive
        );
        // Another group: relay-only territory.
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: 0x9999_9999,
                    hive: 0
                },
                &ME
            ),
            Addressing::Other
        );
        // My group but another hive.
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: 0x2222_2222,
                    hive: 0x7777_7777
                },
                &ME
            ),
            Addressing::Other
        );
    }

    #[test]
    fn a_not_addressed_here_is_relay_only() {
        // 7.1.2 a): never delivered locally, whatever it carries.
        assert_eq!(
            gate::<1>(Addressing::Other, Some(&[0xAA]), None, &[], 0),
            GateOutcome::RelayOnly
        );
        let keys = GroupKeys {
            current: &[1],
            prior: None,
        };
        assert_eq!(
            gate::<1>(Addressing::Other, Some(&[0xAA]), Some(keys), &[], 0),
            GateOutcome::RelayOnly
        );
    }

    #[test]
    fn b_current_key_delivers_intra_group() {
        let keys = GroupKeys {
            current: &[1],
            prior: None,
        };
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 0),
            GateOutcome::Deliver(Delivery::IntraGroup)
        );
    }

    #[test]
    fn b_prior_key_only_within_grace() {
        // Current key is 2 (which this verifier rejects); prior is 1.
        let keys = GroupKeys {
            current: &[2],
            prior: Some((&[1], Ticks(100))),
        };
        // Inside the grace window: delivered.
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 99),
            GateOutcome::Deliver(Delivery::IntraGroup)
        );
        // At and after expiry: the prior key is no longer tried.
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 100),
            GateOutcome::Drop
        );
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 101),
            GateOutcome::Drop
        );
    }

    /// ‼ **A REAL ENTANGLEMENT, NOT A TYPED ONE.** Every `LiveEntanglement`
    /// below now comes through here, which drives 5.1.1's sequence in order
    /// and hands over only once the trial completed. *Before this, the
    /// gate's entanglement inputs were struct literals — so five rows'
    /// demonstrations were `CLOSED` under `01-terminology` 4.7: every input
    /// was produced by the implementation under test, and they could not
    /// have come out otherwise.*
    ///
    /// The `grade` argument is the grade **agreed in the terms**; the
    /// standing the gate sees is read back off the artefact, never passed
    /// in beside it.
    fn real<'a>(id: u32, key: &'a [u8], grade: Grade, conds: &'a [Condition<'a>]) -> Held<'a> {
        establish_for_test(EntanglementId(id), key, Direction::Both, grade, conds)
    }

    /// The one condition every fixture below carries. **A lapse**, so
    /// 6.2.4 is satisfied without the fixture having to think about it.
    const COND: [Condition<'static>; 1] = [Condition {
        class: ConditionClass::Presence,
        predicate: "the bearer is in service",
        evidence: "the local bearer table",
        failure: FailureClass::Lapse { resumable: false },
    }];

    /// ‼ **L5 9.3: POSSESSION CONFERS NOTHING — AND UNTIL 2026-08-14 THE
    /// CHECK EXISTED AND NOTHING RAN IT.** `credentials_confer` decided
    /// correctly and had **no caller outside its own tests**, so *a
    /// production device handed the development group's keys passed the
    /// gate for that group's traffic.*
    ///
    /// The refusal is now **at construction**: keys that cannot be built
    /// are keys no frame can be verified under. *A safety property
    /// enforced per-call is one somebody eventually calls around.*
    #[test]
    fn a_production_device_cannot_build_keys_for_a_development_group() {
        use crate::membership::GroupKind;
        use r2_hal_traits::build_mode::BuildMode;
        let key = crate::keys::SecretKey::new(&mut [2u8; 1]);
        assert!(
            GroupKeys::for_group(BuildMode::Production, GroupKind::Development, &key, None)
                .is_none(),
            "9.3: possession confers nothing"
        );
        // CONTROL 1: the same production device CAN build keys for an
        // ordinary group — so the refusal is the group kind, not the mode.
        assert!(
            GroupKeys::for_group(BuildMode::Production, GroupKind::Ordinary, &key, None).is_some()
        );
        // ‼ CONTROL 2: A DEVELOPMENT DEVICE CAN BUILD THEM FOR THE
        // DEVELOPMENT GROUP. Without this the check would equally describe
        // an implementation that banned the development group outright,
        // which would make the group useless rather than safe.
        assert!(
            GroupKeys::for_group(BuildMode::Development, GroupKind::Development, &key, None)
                .is_some()
        );
    }

    #[test]
    fn c_entanglement_match_marks_the_crossing() {
        let keys = GroupKeys {
            current: &[2],
            prior: None,
        };
        let (h7, h9) = (
            real(7, &[3], Grade::Confirmed, &COND),
            real(9, &[1], Grade::Introduced, &COND),
        );
        let ents = [h7.to_live().unwrap(), h9.to_live().unwrap()];
        // Group key fails, second entanglement matches: marked as that
        // crossing and no other (L5 10.4.1).
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &ents, 0),
            GateOutcome::Deliver(Delivery::Crossing(EntanglementId(9)))
        );
    }

    /// ‼ **THE CEILING, CONSULTED.** `L5A-021` was NOT-IMPL while the
    /// grade was exposed and nothing read it.
    #[test]
    fn a_crossing_below_the_floor_is_refused_and_at_it_is_permitted() {
        let h = real(9, &[1], Grade::Confirmed, &COND);
        let live = [h.to_live().unwrap()];
        let d = Delivery::Crossing(EntanglementId(9));
        assert!(permits(
            d,
            RequiredLevel::Entangled(Grade::Opportunistic),
            &live
        ));
        assert!(permits(
            d,
            RequiredLevel::Entangled(Grade::Confirmed),
            &live
        ));
        assert!(!permits(
            d,
            RequiredLevel::Entangled(Grade::Introduced),
            &live
        ));
        assert!(!permits(
            d,
            RequiredLevel::Entangled(Grade::Ceremonial),
            &live
        ));
    }

    /// ‼ **DEMOTION IS IN FORCE AT THE POLICY QUESTION, NOT ONLY AT THE
    /// GATE** — the grade is resolved from the live set at the moment of
    /// the question, so there is no cached grade between the two
    /// decisions.
    #[test]
    fn demotion_refuses_an_operation_that_passed_a_moment_ago() {
        let d = Delivery::Crossing(EntanglementId(9));
        let hb = real(9, &[1], Grade::Ceremonial, &COND);
        let before = [hb.to_live().unwrap()];
        assert!(permits(
            d,
            RequiredLevel::Entangled(Grade::Introduced),
            &before
        ));

        let ha = real(9, &[1], Grade::Opportunistic, &COND);
        let after = [ha.to_live().unwrap()];
        assert!(!permits(
            d,
            RequiredLevel::Entangled(Grade::Introduced),
            &after
        ));
    }

    /// ‼ **SEVERED SATISFIES NOTHING ABOVE UNAUTHENTICATED**, because
    /// `crossing_grade` answers `None` and `None` is no grade rather than
    /// a weak one.
    #[test]
    fn a_severed_crossing_satisfies_no_graded_requirement() {
        let none: [LiveEntanglement<'_>; 0] = [];
        let d = Delivery::Crossing(EntanglementId(9));
        assert!(!permits(
            d,
            RequiredLevel::Entangled(Grade::Opportunistic),
            &none
        ));
        assert!(!permits(d, RequiredLevel::SameGroup, &none));
    }

    /// A crossing never satisfies a same-group requirement: passage under
    /// an entanglement's keys says nothing about own-group membership.
    #[test]
    fn a_crossing_is_never_same_group_however_high_its_grade() {
        let h = real(9, &[1], Grade::Ceremonial, &COND);
        let live = [h.to_live().unwrap()];
        assert!(!permits(
            Delivery::Crossing(EntanglementId(9)),
            RequiredLevel::SameGroup,
            &live
        ));
    }

    /// An untagged frame claimed nothing, so it satisfies only the rung
    /// that asks for nothing — and intra-group satisfies every rung.
    #[test]
    fn unauthenticated_satisfies_only_the_rung_that_asks_for_nothing() {
        let h = real(9, &[1], Grade::Confirmed, &COND);
        let live = [h.to_live().unwrap()];
        let u = Delivery::Unauthenticated;
        assert!(permits(u, RequiredLevel::Unauthenticated, &live));
        assert!(!permits(
            u,
            RequiredLevel::Entangled(Grade::Opportunistic),
            &live
        ));
        assert!(!permits(u, RequiredLevel::SameGroup, &live));

        let g = Delivery::IntraGroup;
        assert!(permits(g, RequiredLevel::SameGroup, &live));
        assert!(permits(
            g,
            RequiredLevel::Entangled(Grade::Ceremonial),
            &live
        ));
        assert!(permits(g, RequiredLevel::Unauthenticated, &live));
    }

    /// ‼ **DEMOTION, THE HALF THAT HAD NOTHING TO ACT ON UNTIL 2026-08-14**
    /// (L5 10.3.2, `L5-096`). Lowering the grade in the live set re-scopes
    /// the crossing on the **next frame**, because the gate and
    /// [`crossing_grade`] read the set as given at the call.
    #[test]
    fn demotion_lowers_the_ceiling_at_once() {
        let hb = real(9, &[1], Grade::Ceremonial, &COND);
        let before = [hb.to_live().unwrap()];
        assert_eq!(
            crossing_grade(EntanglementId(9), &before),
            Some(Grade::Ceremonial)
        );

        // The conditions name a lower grade for this breach; the live set
        // is rebuilt carrying it. No cache, so nothing survives the change.
        let ha = real(9, &[1], Grade::Opportunistic, &COND);
        let after = [ha.to_live().unwrap()];
        assert_eq!(
            crossing_grade(EntanglementId(9), &after),
            Some(Grade::Opportunistic)
        );

        // And the clause's point: the ceiling really is lower, so a policy
        // comparison that passed before now fails.
        assert!(Grade::Ceremonial >= Grade::Introduced);
        assert!(Grade::Opportunistic < Grade::Introduced);
    }

    /// ‼ **SEVERED IS `None`, NOT AN UNGRADED CROSSING.** A caller that
    /// read a missing entanglement as permissive would restore exactly the
    /// crossings 10.3.2 requires to stop.
    #[test]
    fn a_severed_entanglement_has_no_grade_rather_than_a_weak_one() {
        let live: [LiveEntanglement<'_>; 0] = [];
        assert_eq!(crossing_grade(EntanglementId(9), &live), None);
        let ho = real(7, &[3], Grade::Confirmed, &COND);
        let other = [ho.to_live().unwrap()];
        assert_eq!(crossing_grade(EntanglementId(9), &other), None);
    }

    /// The ladder of L5A 5.3.1 is ordered weakest to strongest **by the
    /// type**, so a comparison cannot be written backwards.
    #[test]
    fn grades_are_ordered_weakest_to_strongest() {
        assert!(Grade::Opportunistic < Grade::Confirmed);
        assert!(Grade::Confirmed < Grade::Introduced);
        assert!(Grade::Introduced < Grade::Ceremonial);
    }

    #[test]
    fn c_severed_entanglement_stops_crossings_at_once() {
        // L5 10.3.2: severing removes it from the live set; frames that
        // verified only under it now fail the gate from that moment.
        let keys = GroupKeys {
            current: &[2],
            prior: None,
        };
        let h = real(9, &[1], Grade::Introduced, &COND);
        let live = [h.to_live().unwrap()];
        assert!(matches!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &live, 0),
            GateOutcome::Deliver(Delivery::Crossing(_))
        ));
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 0),
            GateOutcome::Drop
        );
    }

    #[test]
    fn d_nothing_verifies_drops() {
        let keys = GroupKeys {
            current: &[2],
            prior: None,
        };
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), Some(keys), &[], 0),
            GateOutcome::Drop
        );
    }

    #[test]
    fn no_usable_key_never_delivers_a_tagged_frame() {
        // L5 7.1.3 / L5-057.
        assert_eq!(
            gate::<1>(Addressing::MyGroup, Some(&[0xAA]), None, &[], 0),
            GateOutcome::Drop
        );
    }

    #[test]
    fn untagged_frame_is_not_the_drop_case() {
        // L5 10.1.2 / L5-091: no tag is not "verified under nothing".
        assert_eq!(
            gate::<1>(Addressing::MyGroup, None, None, &[], 0),
            GateOutcome::Deliver(Delivery::Unauthenticated)
        );
        assert_eq!(
            gate::<1>(Addressing::Broadcast, None, None, &[], 0),
            GateOutcome::Deliver(Delivery::Unauthenticated)
        );
        // ...but an unaddressed one is still relay-only.
        assert_eq!(
            gate::<1>(Addressing::Other, None, None, &[], 0),
            GateOutcome::RelayOnly
        );
    }

    /// **A GROUP_MGMT frame reaches the layers above marked
    /// `Unauthenticated`, ALWAYS, and no clause takes it further.**
    /// `CORE-17`.
    ///
    /// This is not a defect in the gate and the assertion below is the
    /// conforming outcome: L4 10.1.4 forbids a GROUP_MGMT frame from
    /// carrying an integrity tag at all — `r2-wire` refuses one on
    /// **both** the encode and the parse side — and L5 10.1.2 says an
    /// untagged frame may be delivered marked unauthenticated. Each
    /// clause is satisfied.
    ///
    /// **THE GAP IS BETWEEN THEM.** L4 10.1.4 does not merely permit this
    /// — it *delegates*: *"its authenticity is established by the means
    /// Layer 5 specifies."* **Measured 2026-08-04 against r2-standard
    /// `4f32fdc`: no Layer 5 document names GROUP_MGMT anywhere** — not
    /// `L5`, `L5A`, `L5B` or `L5C` — under that spelling or any of *group
    /// management*, *management frame*, *frame type 4*. **The forward
    /// reference lands nowhere.** `STD-SS31` is `SETTLED` on the ruling
    /// that authenticity is *wholly L5's*; **settling it there is what
    /// created this**, and *a resolved question does not close the
    /// concern its remedy produced.*
    ///
    /// **The hazard is ARMED RATHER THAN ABSENT, which is the same shape
    /// as `StoredPersona::Found` before `Keystore::restore`**: nothing in
    /// this workspace dispatches on `FrameType::GroupMgmt` above the
    /// wire, so no group-management operation is currently acted on
    /// unauthenticated. **What keeps it safe is that the consumer has not
    /// been written yet — an accident of sequencing, not a guard.** This
    /// test exists so the next lane to write that consumer reads the gap
    /// here rather than inferring permission from a clean delivery.
    #[test]
    fn a_group_mgmt_frame_is_delivered_unauthenticated_and_nothing_specifies_more() {
        use r2_wire::{FrameSpec, FrameType};
        let mut buf = [0u8; 128];
        let n = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            constrained_origin: false,
            hop_limit: 1,
            budget: 1,
            msg_id: 7,
            event_hash: 0,
            target: Target::Compact(ME.group_half),
            route: None,
            payload: b"a group operation",
            tag: None,
        }
        .encode(&mut buf)
        .expect("GROUP_MGMT encodes without a route (L4 8.1 Note 2)");
        let frame = Frame::parse_on_bearer(&buf[..n], r2_wire::Tier::Compact).expect("parses");

        // Holding a perfectly good group key changes nothing: there is no
        // tag to try it against, so custody of the group secret is not
        // what is missing.
        let keys = GroupKeys {
            current: &[1],
            prior: None,
        };
        assert_eq!(
            apply_gate::<KeyIs<1>>(Addressing::MyGroup, &frame, Some(keys), &[], Ticks(0)),
            GateOutcome::Deliver(Delivery::Unauthenticated),
            "the gate reached a verdict other than the one both clauses require"
        );

        // And the other half of the pair, so this is not read as a quirk
        // of one addressing mode: a GROUP_MGMT frame cannot be tagged into
        // authenticity by an origin that tries (L4 10.1.4, encode side).
        //
        // **The refusal is asserted BY ITS REASON, not by being an
        // error.** A wrong-width tag and a missing origin both refuse
        // here too, and `is_err()` alone would pass on either — reporting
        // *GROUP_MGMT cannot be tagged* while measuring something else.
        assert_eq!(
            FrameSpec {
                frame_type: FrameType::GroupMgmt,
                constrained_origin: false,
                hop_limit: 1,
                budget: 1,
                msg_id: 7,
                event_hash: 0,
                target: Target::Compact(ME.group_half),
                route: None,
                payload: b"a group operation",
                tag: Some(&[0u8; r2_wire::frame::COMPACT_TAG_LEN]),
            }
            .encode(&mut buf)
            .unwrap_err(),
            r2_wire::frame::EncodeError::TagWithoutOrigin,
            "a GROUP_MGMT frame was tagged, or refused for an unrelated reason; \
             L4 10.1.4 says it is never tagged, and the delegation to Layer 5 is \
             the ONLY route its authenticity has"
        );
    }

    #[test]
    fn gate_is_a_floor_not_a_character_reference() {
        // L5 7.2.3 / L5-062.
        assert!(gate_alone_suffices(false, false));
        assert!(!gate_alone_suffices(true, false)); // which member asked
        assert!(!gate_alone_suffices(false, true)); // when they asked
        assert!(!gate_alone_suffices(true, true));
    }
    // ── L5 14.2: the conformance demonstration the clause asks for by name ──
    //
    // > *Conformance to 7.1.2 shall be demonstrated with a frame addressed to
    // > the hive rather than to its group, and with a broadcast frame: each is
    // > delivered when its tag verifies, and neither falls to relay-only.*
    //
    // ‼ **THE FAILURE IT GUARDS AGAINST IS AN IMPLEMENTATION WHOSE IDEA OF
    // *ADDRESSED TO ME* IS ONLY ITS GROUP.** Such a receiver passes every
    // group-addressed test, relays everything else, and is wrong in exactly
    // two cases: a frame addressed to THIS HIVE and one addressed to ALL
    // HIVES. Both look like somebody else's traffic to a receiver that
    // compares one field, and both then **fall silently to relay-only** — the
    // frame is forwarded, nothing is delivered, no error is raised anywhere,
    // and the sender sees a network that swallowed its message. *That is why
    // the clause names the two cases rather than asking for coverage.*

    /// The two targets 14.2 names, with the group case beside them as the one
    /// that already worked.
    fn addressed_cases() -> [(&'static str, Target, Addressing); 3] {
        [
            (
                "addressed to this hive",
                Target::Compact(ME.hive_half),
                Addressing::MyHive,
            ),
            (
                "broadcast to all hives",
                Target::Compact(0),
                Addressing::Broadcast,
            ),
            (
                "addressed to my group",
                Target::Compact(ME.group_half),
                Addressing::MyGroup,
            ),
        ]
    }

    /// ‼ **L5 14.2: EACH IS DELIVERED WHEN ITS TAG VERIFIES, AND NEITHER FALLS
    /// TO RELAY-ONLY.**
    #[test]
    fn l5_14_2_a_hive_addressed_frame_and_a_broadcast_frame_are_both_delivered() {
        for (what, target, expected) in addressed_cases() {
            // The classification is the shipped function's, from the target
            // and this hive's identity — not asserted into being by the test.
            let addressing = classify_target(target, &ME);
            assert_eq!(addressing, expected, "{what}: classified wrongly");
            assert!(
                addressing.is_for_me(),
                "{what}: 7.1.2 a) would send this to relay-only"
            );
            let keys = GroupKeys {
                current: &[1],
                prior: None,
            };
            let out = gate::<1>(addressing, Some(&[1]), Some(keys), &[], 0);
            assert_eq!(
                out,
                GateOutcome::Deliver(Delivery::IntraGroup),
                "{what}: not delivered as intra-group"
            );
            assert_ne!(
                out,
                GateOutcome::RelayOnly,
                "{what}: FELL TO RELAY-ONLY — forwarded, nothing delivered, no \
                 error raised anywhere"
            );
        }
    }

    /// **The other half of the sentence: *when its tag verifies*.** A gate
    /// delivering whatever arrived would satisfy the test above and none of
    /// 7.1.2.
    #[test]
    fn l5_14_2_neither_is_delivered_when_the_tag_does_not_verify() {
        for (what, target, _) in addressed_cases() {
            let addressing = classify_target(target, &ME);
            let keys = GroupKeys {
                current: &[1],
                prior: None,
            };
            // KeyIs<2> accepts only key 2; the group holds key 1.
            assert_eq!(
                gate::<2>(addressing, Some(&[1]), Some(keys), &[], 0),
                GateOutcome::Drop,
                "{what}: delivered on a tag that does not verify — 7.1.2 d)"
            );
        }
    }

    /// ‼ **THE CONTROL, AND IT IS WHAT MAKES THE OTHER TWO MEAN ANYTHING.** A
    /// frame for somebody else MUST fall to relay-only, with a verifier that
    /// accepts everything — so the assertions above distinguish addressing
    /// rather than reporting that this gate delivers whatever it is handed.
    #[test]
    fn l5_14_2_a_frame_for_another_hive_does_fall_to_relay_only() {
        let addressing = classify_target(Target::Compact(0x7777_7777), &ME);
        assert_eq!(addressing, Addressing::Other);
        let keys = GroupKeys {
            current: &[1],
            prior: None,
        };
        assert_eq!(
            gate::<1>(addressing, Some(&[1]), Some(keys), &[], 0),
            GateOutcome::RelayOnly,
            "a frame addressed to another hive was delivered locally — 7.1.2 a) \
             is ordered FIRST for exactly this reason"
        );
    }

    /// **The extended form reaches the same three decisions**, and 6.1.3's
    /// *zero means any per half* is where a hive-addressed frame is most
    /// likely to be misread as broadcast.
    #[test]
    fn l5_14_2_the_extended_target_form_agrees_with_the_compact_one() {
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: ME.group_half,
                    hive: ME.hive_half
                },
                &ME
            ),
            Addressing::MyHive
        );
        assert_eq!(
            classify_target(Target::Extended { group: 0, hive: 0 }, &ME),
            Addressing::Broadcast
        );
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: ME.group_half,
                    hive: 0
                },
                &ME
            ),
            Addressing::MyGroup,
            "any-hive within my group is the group case, not the hive case"
        );
        assert_eq!(
            classify_target(
                Target::Extended {
                    group: 0x9999_9999,
                    hive: ME.hive_half
                },
                &ME
            ),
            Addressing::Other,
            "a matching hive half under ANOTHER group must not be for me — the \
             halves are not independently sufficient"
        );
    }
}
