//! Layer 3 routing: identity keying, duplicate suppression, replication
//! budget (`r2-standard/L3-routing.md`). Neighbour table and custody follow.

/// The canonical hive identifier now lives in `r2-ident` (FORMATS band,
/// `D-226`): an L1 bearer keys link quality by it (L1 4.5.3), and a type
/// both L1 and L3 need belongs below both rather than up here. Re-exported
/// so every existing `l3::HiveId` path keeps resolving.
pub use r2_ident::HiveId;

/// **The peer a bearer OBSERVED transmitting a frame** — never an identity
/// the frame itself carries (L3 4.2.2a).
///
/// ‼ **THIS TYPE EXISTS BECAUSE THE CLAUSE'S *NEVER* WAS PROSE.**
/// [`NeighbourTable::observe`] took a bare [`HiveId`], and *the observed
/// sender and the carried origin are the same Rust type*, so the wrong one
/// was spellable and **no test in this crate could assert the caller passed
/// the right one — the crate could not see which it was given.** That is
/// `L3-065`, `PARTIAL` for that reason until 2026-08-15.
///
/// *A frame says who **originated** it; a neighbour table records who is
/// **directly reachable**. Those coincide only at one hop, and nothing in
/// the frame establishes that it took one.* **Validity is not truth**: a
/// verified tag establishes the frame was not altered, never that what it
/// says is so.
///
/// # Three constructors, all named, because an unnamed escape is a hole
///
/// **The audit is one `git grep`.** Each says at its call site which kind
/// of claim the key rests on, which is the whole point — *a silent
/// `HiveId` → `ObservedSender` conversion would restore exactly the defect
/// this type removes.*
///
/// ‼ **AND `Medium` IS NOT REFUSED, WHICH WAS THE FIRST DESIGN AND WAS
/// WRONG.** The proposal had [`Self::from_canonical_rx`] as the only
/// bearer-fed path, and `hive` measured what that costs: on their bench
/// `SenderIdentity::Canonical` is **unreachable** — the peer map is
/// populated only by an `associate()` that has **zero callers in any
/// lane** — so *every* reception falls to the `Medium` arm, `observe`
/// would never be called, and the neighbour table would be permanently
/// empty. **That takes down `path_established`, the link axis and bearer
/// selection together, and does it quietly: an empty table and a silent
/// network look identical at every call site.**
///
/// **The bench was wrong and so was the type.** L1 4.5.3 calls a medium
/// identity **transitional — replaced as soon as the canonical identifier
/// becomes known — and transitional is not unusable.** *A medium-derived
/// sender is still something the bearer genuinely observed*, which is the
/// distinction 4.2.2a actually draws. So [`Self::from_transitional_medium`]
/// is a first-class constructor that **names what it is at the site**
/// rather than a refusal that would have looked principled and gone dark.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ObservedSender(HiveId, KeyOrigin);

/// **Whether a destination resolved from a FRAME could ever equal a
/// neighbour's key** — the fact that decides whether a comparison between
/// the two is a question or a formality.
///
/// ‼ **IT EXISTS BECAUSE A COMPARISON THAT CAN NEVER SUCCEED LOOKS EXACTLY
/// LIKE A PEER THAT IS ASLEEP** (r2-codex-refute 2026-08-25, and predicted
/// in terms by `r2-ident` on 2026-08-15). Custody keys a held frame by a
/// destination it resolved from the wire; the ESP-NOW receive path keys a
/// neighbour by a derivation of its MAC. **Both are `HiveId`, nothing in the
/// types requires them to agree, and where they do not,
/// [`NeighbourTable::path_established`] is structurally always false** — so
/// every retained frame sits unreleased and the bench reads as a quiet
/// network. *`r2-ident` wrote that sentence down, dated, and no caller was
/// ever brought to it.*
///
/// **This does not fix the derivation** — L1 4.5.3's *replaced as soon as
/// the canonical identifier becomes known* is undischarged and is `SS375`,
/// Roy's. What it fixes is the SILENCE: a holder can now say *no
/// established neighbour is keyed by a wire identity*, which is a different
/// sentence from *the destination is not reachable* and sends a reader
/// somewhere different.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyOrigin {
    /// A **wire identity** (L4 6.1.3, FORMATS 3.3) — a canonical identifier
    /// the bearer reported, or one a ceremony established. A destination
    /// resolved from a frame is drawn from the same space, so a comparison
    /// between the two is a genuine question.
    WireIdentity,
    /// A key derived from a **transitional medium address** (L1 4.5.3) — a
    /// MAC, which is not a hive identifier in either tier and which no
    /// clause assigns to a half. *A wire-resolved destination can equal one
    /// only by accident.*
    TransitionalMedium,
}

impl ObservedSender {
    /// The bearer reported a **canonical** hive identifier (L1 4.5.1).
    /// `None` for a transitional medium identity — use
    /// [`Self::from_transitional_medium`], which says so at the site.
    pub fn from_canonical_rx(meta: &r2_transport::l1::RxMeta) -> Option<Self> {
        match meta.sender {
            r2_transport::l1::SenderIdentity::Canonical(id) => {
                Some(Self(id, KeyOrigin::WireIdentity))
            }
            r2_transport::l1::SenderIdentity::Medium { .. } => None,
        }
    }

    /// ‼ **A KEY DERIVED FROM A TRANSITIONAL MEDIUM ADDRESS** (L1 4.5.3).
    /// Legitimate — the bearer observed it — and **carrying an obligation
    /// the clause states**: it *shall be replaced as soon as the canonical
    /// identifier becomes known*. The derivation is the caller's, because
    /// it is medium-specific and this crate is medium-blind.
    ///
    /// *Named rather than blended into the canonical path so that a tree
    /// where every neighbour is transitional says so to a grep* — which is
    /// the state `hive`'s bench is in today and could not otherwise report.
    pub fn from_transitional_medium(key: HiveId) -> Self {
        Self(key, KeyOrigin::TransitionalMedium)
    }

    /// ‼ **THE ESCAPE, AND IT IS NAMED SO IT IS A REGISTER RATHER THAN A
    /// HOLE.** For a caller that genuinely observed the peer but holds no
    /// [`r2_transport::l1::RxMeta`] — tests, mostly. **`git grep
    /// asserted_by_caller` is the audit for 4.2.2a**, and that is the
    /// entire reason this is a named function and not a `From` impl.
    /// ‼ **AND IT ASSERTS A WIRE IDENTITY, WHICH IS PART OF WHAT THE CALLER
    /// IS VOUCHING FOR.** Every live call site supplies one — the canonical
    /// arm of the receive path, and `seed_neighbour_from_ceremony`, where
    /// L5B 6.5.2 exchanged identities rather than addresses. *A caller with
    /// a medium address has [`Self::from_transitional_medium`] and the
    /// difference is the whole of [`KeyOrigin`].*
    pub fn asserted_by_caller(id: HiveId) -> Self {
        Self(id, KeyOrigin::WireIdentity)
    }

    /// What this key was derived from — see [`KeyOrigin`].
    pub const fn key_origin(self) -> KeyOrigin {
        self.1
    }

    /// The key, for callers that must index by it.
    pub fn id(self) -> HiveId {
        self.0
    }
}

/// ‼ **THE DOOR, PROVED SHUT FROM OUTSIDE THE TYPE.**
///
/// *A test asserting the three constructors work says nothing about
/// whether a fourth way in exists* — and the whole claim of `L3-065` is
/// that the wrong identity is **unspellable**, which is a statement about
/// what does NOT compile. So it is a `compile_fail` doctest and not a unit
/// test: the field is private, so no `HiveId` reaches `observe` without
/// passing one of the three named constructors, and **each of those says
/// at its site what kind of claim the key rests on.**
///
/// ```compile_fail
/// use r2_routing::l3::{HiveId, NeighbourTable, ObservedSender, RoutingConfig};
/// use r2_transport::l1::{BindingId, BindingInstance, LinkQuality, Ordinal};
/// use r2_hal_traits::Ticks;
/// let config = RoutingConfig::new(0.3, 0.6).unwrap();
/// let mut t: NeighbourTable<4> = NeighbourTable::new(config);
/// // The frame's carried origin, which 4.2.2a forbids as a table key.
/// let carried = HiveId([9u8; 8]);
/// let binding = BindingInstance::new(BindingId(1), Ordinal::Ble);
/// t.observe(carried, binding, LinkQuality::new(0.5), Ticks(1));
/// ```
///
/// Every argument but the first is the one the positive control passes, so the
/// refusal is attributable to the KEY alone. It was not always so: this block
/// once passed an `Ordinal` where `observe` takes a `BindingInstance`, and so
/// failed for two reasons at once — it would have stayed green through the very
/// change it exists to catch, because the second argument would have gone on
/// refusing after the door was opened. A `compile_fail` block earns its claim
/// only while the claim is the ONLY thing wrong with it (found 2026-09-04).
///
/// And the present-control, so the refusal above is attributable to the
/// TYPE and not to a broken fixture — *three nils with no positive is a
/// broken harness wearing a clean result*:
///
/// ```
/// use r2_routing::l3::{HiveId, NeighbourTable, ObservedSender, RoutingConfig};
/// use r2_transport::l1::{BindingId, BindingInstance, LinkQuality, Ordinal};
/// use r2_hal_traits::Ticks;
/// let config = RoutingConfig::new(0.3, 0.6).unwrap();
/// let mut t: NeighbourTable<4> = NeighbourTable::new(config);
/// let observed = ObservedSender::asserted_by_caller(HiveId([9u8; 8]));
/// let binding = BindingInstance::new(BindingId(1), Ordinal::Ble);
/// assert!(t.observe(observed, binding, LinkQuality::new(0.5), Ticks(1)));
/// ```
pub const OBSERVED_SENDER_IS_THE_ONLY_WAY_IN: () = ();

/// What a claim on a dedup key rested on, **as a property of the frame**
/// rather than of the hive (`standard`'s ruling on `d547`).
///
/// L5 **7.1.3** already conditions on exactly this — *a receiver holding no
/// usable key for a group-addressed frame shall not deliver it* — and
/// **7.1.2 b)/c)** select the key set **by the frame**, verifying against
/// that frame's group keys and trial-verifying against each live
/// entanglement's. A hive holding keys for one group and not another is the
/// ordinary case those clauses are written for, so a per-hive form would
/// narrow a per-frame question and be wrong in the common case rather than
/// an exotic one.
///
/// ‼ **THIS RECORDS, IT DOES NOT DECIDE.** Nothing here changes *which*
/// frames claim keys — asserted by
/// `suppression_is_identical_whatever_the_claim_rested_on`. Whether a key
/// may be claimed **before** verification is `d547`, `standard`'s to rule,
/// and is deliberately not settled by this type.
///
/// ‼ **AND [`ClaimBasis::Unstated`] IS NOT A FOURTH ANSWER — IT IS THE
/// ABSENCE OF ONE.** The three states above are facts about a frame; this
/// one is a fact about the *call*. Without it the pre-existing API would
/// have to fabricate one of the three, and *an unstated basis read as
/// "verified" is a claim of verification nobody made.* **Unreadable is not
/// empty**, arriving in this crate for the fifth time this week.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimBasis {
    /// Verified here against this frame's group keys (L5 7.1.2 b), or a live
    /// entanglement's under c)).
    Verified,
    /// Reached the trust gate with a usable key and **did not** verify.
    Unverified,
    /// ‼ **This hive holds no usable key FOR THIS FRAME'S GROUP** (L5
    /// 7.1.3), so verification is **absent, not deferred**.
    ///
    /// L3 **5.1.2** obliges a hive to relay *without regard to whether it
    /// can read the frame, whether it knows the origin, and whether the
    /// origin belongs to any group the hive belongs to* — so a relay outside
    /// the group is **doing exactly what the corpus requires** while unable
    /// to verify anything. *This is why the distinction cannot collapse into
    /// [`ClaimBasis::Unverified`]:* on such a relay **every** entry would
    /// carry the failure marking, the signal would fire constantly on
    /// correct behaviour, and a constant marking trains everyone to ignore
    /// it — leaving the one that matters looking identical. **That is worse
    /// than no signature at all** (`standard`'s `STD-SS352`, which corrected my
    /// own first answer on `d547`).
    NoUsableKeyForThisFrame,
    /// The caller did not say. **Not a claim about the frame** — see the
    /// type's note. This is what the pre-existing entry points record.
    Unstated,
}

impl ClaimBasis {
    /// Whether anything actually verified this frame here.
    ///
    /// [`ClaimBasis::Unstated`] answers **`false`**, and the direction is
    /// deliberate: the unreadable case must not grant the authority, which
    /// is the same G9 answer `DedupCache::live` gives an uncomputable age.
    pub const fn is_verified(self) -> bool {
        matches!(self, ClaimBasis::Verified)
    }
}

/// Duplicate-suppression cache (L3 5.3): bounded capacity **and bounded
/// lifetime**, keyed on (origin, message identifier) and nothing else —
/// the immediate sender is never part of the key (5.3.2).
///
/// Class-1 capacity is 128 entries (L0 8.3.2); `N` lets larger classes size
/// up. Callers apply it to the relay path only: frames this hive is the
/// destination of are never suppressed (5.4.1), and released custody frames
/// are not re-checked (7.5.1).
///
/// ## Why entries expire (L3 5.3.4)
///
/// **A capacity bound is not a lifetime bound.** A ring of `N` entries
/// evicts only when `N` further frames arrive, so on a quiet link an entry
/// persists for hours or days — which is indefinite in every sense that
/// matters. This cache had capacity alone until 5.3.4 required otherwise.
///
/// What that permitted: L5 7.2.2 says a receiver shall not treat passage
/// as establishing *which member* sent a frame, and the Layer 4 tag is
/// computed under the **group** key — so any member can emit a frame
/// naming another as origin. With no lifetime bound, one member could
/// pre-claim another's `(origin, msg_id)` pairs and have every relay
/// suppress that member's genuine frames **for as long as the link stayed
/// quiet**. Per-frame member signatures are unaffordable on these devices,
/// so the honest fix is not to prevent the silencing but to **bound it**:
/// expiry converts indefinite silencing into temporary (L3 10.5 records
/// the residue — suppression binds an outsider, not a member).
pub struct DedupCache<const N: usize> {
    entries: [(HiveId, u32, Ticks, ClaimBasis); N],
    len: usize,
    next: usize,
    /// How long an entry suppresses, in ticks (5.3.4).
    lifetime: u64,
}

impl<const N: usize> DedupCache<N> {
    /// A cache whose entries suppress for `lifetime_ticks` and no longer.
    ///
    /// There is deliberately **no `Default`**: the lifetime is a
    /// deployment's judgement between re-flooding a duplicate and
    /// silencing a peer, and a silent default would be exactly the
    /// unexamined value that makes the bound decorative.
    pub const fn new(lifetime_ticks: u64) -> Self {
        Self {
            entries: [(HiveId([0; 8]), 0, Ticks(0), ClaimBasis::Unstated); N],
            len: 0,
            next: 0,
            lifetime: lifetime_ticks,
        }
    }

    /// Whether `at` is still within the suppression lifetime as of `now`.
    ///
    /// An age that **cannot be computed** — `now` earlier than the entry,
    /// which L0 5.2 permits across a power cycle since a monotonic clock
    /// does not span one — counts as **expired**. That direction is the
    /// G9 answer: suppression is the authority here, so the unreadable
    /// case must not grant it. Re-flooding a duplicate costs airtime;
    /// suppressing wrongly silences a peer.
    const fn live(&self, at: Ticks, now: Ticks) -> bool {
        match now.since(at) {
            Some(age) => age < self.lifetime,
            None => false,
        }
    }

    /// True where (origin, msg_id) was already seen **and has not
    /// expired**; otherwise records it and returns false.
    pub fn seen_or_insert(&mut self, origin: HiveId, msg_id: u32, now: Ticks) -> bool {
        self.seen_or_insert_claimed(origin, msg_id, now, ClaimBasis::Unstated)
            .is_some()
    }

    /// As [`DedupCache::seen_or_insert`], recording **what this frame's
    /// claim rested on** and reporting the basis of the entry that
    /// suppressed.
    ///
    /// `None` — not seen; the key is now claimed on `basis`. `Some(b)` —
    /// suppressed by a live entry claimed on `b`, **which is the basis of
    /// the EARLIER frame and not of this one**. That is the direction the
    /// signature needs: the question a reader has is what the *suppressing*
    /// claim rested on.
    ///
    /// ‼ **Suppression is unchanged by the basis** — every value suppresses
    /// identically, so this is observability and not defence. A weaker
    /// record that a later verifying frame could override was measured and
    /// refused: *a hive that cannot verify never produces that event, so on
    /// a 5.1.2 relay every record would be weak and nothing would ever
    /// override one* — the mechanism degrades to no mechanism in exactly the
    /// population that has the problem (`standard`'s `STD-SS352`).
    pub fn seen_or_insert_claimed(
        &mut self,
        origin: HiveId,
        msg_id: u32,
        now: Ticks,
        basis: ClaimBasis,
    ) -> Option<ClaimBasis> {
        for &(o, m, at, b) in &self.entries[..self.len] {
            if o == origin && m == msg_id && self.live(at, now) {
                return Some(b);
            }
        }
        self.entries[self.next] = (origin, msg_id, now, basis);
        self.next = (self.next + 1) % N;
        self.len = (self.len + 1).min(N);
        None
    }

    /// How many entries are still suppressing as of `now`.
    ///
    /// Diagnostic: an expired entry still occupies its slot until the ring
    /// overwrites it, so this is not `len`.
    pub fn live_entries(&self, now: Ticks) -> usize {
        self.entries[..self.len]
            .iter()
            .filter(|&&(_, _, at, _)| self.live(at, now))
            .count()
    }

    /// How many live entries were claimed on a basis that **nothing
    /// verified** — [`ClaimBasis::Unverified`], [`ClaimBasis::NoUsableKeyForThisFrame`]
    /// or [`ClaimBasis::Unstated`].
    ///
    /// ‼ **REPORT THIS BESIDE [`DedupCache::live_entries`], NEVER ALONE.**
    /// A count of unverified claims with no denominator is the reporting-arm
    /// defect this fleet measured all week: *an asserting arm that goes
    /// blind starts failing, while a reporting arm that goes blind just
    /// reports a smaller number — and a smaller number reads as progress.*
    pub fn live_entries_unverified(&self, now: Ticks) -> usize {
        self.entries[..self.len]
            .iter()
            .filter(|&&(_, _, at, b)| self.live(at, now) && !b.is_verified())
            .count()
    }
}

/// What the replication budget permits (L3 5.5).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BudgetDecision {
    /// Budget 15: flooding — forward to every viable neighbour with the
    /// budget unchanged (L4 4.1.2a, L3 5.5.5).
    Flood,
    /// Forward carrying `forward`, retain `retain` locally (5.5.2).
    Forward { forward: u8, retain: u8 },
    /// Half-rounded-down is zero: do not relay; retain the frame for direct
    /// delivery if the destination becomes reachable (5.5.3, 5.5.4).
    RetainOnly,
}

/// Split a replication budget per 5.5. Values above 15 do not exist on the
/// wire (4-bit nibble).
pub const fn split_budget(budget: u8) -> BudgetDecision {
    if budget == r2_wire::frame::BUDGET_FLOODING {
        BudgetDecision::Flood
    } else {
        let forward = budget / 2;
        if forward == 0 {
            BudgetDecision::RetainOnly
        } else {
            BudgetDecision::Forward {
                forward,
                retain: budget - forward,
            }
        }
    }
}

/// Deployment routing values (L3 11.1: the values are the deployment's;
/// the ordering is conformance). Construction enforces 4.4.5: the
/// provisional ceiling strictly below the forwarding threshold — equal is
/// non-conforming.
#[derive(Clone, Copy, Debug)]
pub struct RoutingConfig {
    provisional_ceiling: f32,
    forwarding_threshold: f32,
}

impl RoutingConfig {
    pub fn new(provisional_ceiling: f32, forwarding_threshold: f32) -> Option<Self> {
        ((0.0..=1.0).contains(&provisional_ceiling)
            && (0.0..=1.0).contains(&forwarding_threshold)
            && provisional_ceiling < forwarding_threshold)
            .then_some(Self {
                provisional_ceiling,
                forwarding_threshold,
            })
    }

    pub const fn provisional_ceiling(&self) -> f32 {
        self.provisional_ceiling
    }

    pub const fn forwarding_threshold(&self) -> f32 {
        self.forwarding_threshold
    }
}

use r2_hal_traits::Ticks;
use r2_transport::l1::{LinkQuality, Ordinal};
/// **The tier a retained frame arrived at, carried so the RELEASE can be a
/// relay** (L3 7.5.1). It fixes the width of one route-record entry (L4 8.5),
/// which the releasing hive needs to append its own identity under L4 8.2 —
/// a fact about the frame that nothing outside the buffer can recover once
/// the reception it came from is gone. The edge to `r2-wire` is the one this
/// crate already carries for `BUDGET_FLOODING` (`SS380`).
use r2_wire::frame::{Target, Tier};

/// Per-bearer link state within a neighbour entry (L3 4.1.2). Fading is
/// evaluated lazily by the caller against the bearer's declared fade
/// behaviour (4.5.1) — the table stores observations, never wall-clock
/// conclusions.
#[derive(Clone, Copy, Debug)]
pub struct BearerLink {
    /// The concrete local binding that made this observation.  The ordinal
    /// inside it names a profile kind; `id` keeps sibling instances separate.
    pub binding: r2_transport::l1::BindingInstance,
    pub strength: LinkQuality,
    pub last_heard: Ticks,
}

/// One neighbour entry per peer, retaining up to `B` distinct local binding
/// instances (L3 4.1.1; L1 4.5 verification: two bearers, one entry).
///
/// `B` is an assembly memory bound, not a bearer ordinal count: L1 8.2.4
/// permits sibling bindings with one ordinal. A full row refuses the new
/// observation rather than merging its evidence into a sibling (`SS570`).
#[derive(Clone, Copy, Debug)]
pub struct Neighbour<const B: usize = 7> {
    pub id: HiveId,
    links: [Option<BearerLink>; B],
    confidence: f32,
    verified: bool,
    /// What this entry's KEY was derived from — never what the peer is.
    keyed: KeyOrigin,
}

impl<const B: usize> Neighbour<B> {
    fn new(id: HiveId, keyed: KeyOrigin) -> Self {
        Self {
            id,
            links: [None; B],
            confidence: 0.0,
            verified: false,
            keyed,
        }
    }

    /// What this entry's key was derived from ([`KeyOrigin`]).
    pub const fn key_origin(&self) -> KeyOrigin {
        self.keyed
    }

    pub fn link(&self, binding: r2_transport::l1::BindingInstance) -> Option<&BearerLink> {
        self.links
            .iter()
            .flatten()
            .find(|link| link.binding == binding)
    }

    pub fn links(&self) -> impl Iterator<Item = &BearerLink> {
        self.links.iter().flatten()
    }

    /// Confidence a path through this neighbour delivers (L3 3.5).
    pub const fn confidence(&self) -> f32 {
        self.confidence
    }

    /// Whether verified-and-fresh evidence has ever supported this entry
    /// (liveness axis, L3 4.2.3).
    pub const fn verified(&self) -> bool {
        self.verified
    }
}

/// One entry as the **link axis alone** (L3 3.3): who was heard, on which
/// bearers, how strongly, and when.
///
/// # Why this type exists rather than an iterator of [`Neighbour`]
///
/// ‼ **4.2.1 forbids deriving one axis from the other, and 4.2.4 forbids
/// treating the link axis as evidence that a peer is entitled to be
/// delivered to.** Choosing relay targets is a **link-axis** decision —
/// 5.6.1's *every viable neighbour* is about who a bearer can reach, not
/// about who has proved anything. **Handing a caller `Neighbour` would put
/// `confidence()` and `verified()` in the same reach as the enumeration**,
/// and the natural next line is *flood to the verified ones* — the two
/// axes crossed in one expression, in the code path where 4.2.4 bites.
///
/// So this view **carries no liveness at all**. *The rule is enforced by
/// what the type cannot say rather than by a note asking callers not to.*
///
/// ```compile_fail
/// # use r2_routing::l3::{NeighbourTable, RoutingConfig};
/// # let t: NeighbourTable<4> = NeighbourTable::new(RoutingConfig::new(0.2, 0.5).unwrap());
/// for peer in t.link_axis() {
///     let _ = peer.confidence();   // liveness axis: not reachable from here
/// }
/// ```
#[derive(Clone, Copy, Debug)]
pub struct LinkView<'a, const B: usize = 7> {
    /// The peer **the bearer observed transmitting** (4.2.2a), never an
    /// identity a frame claimed.
    pub id: HiveId,
    /// What [`Self::id`] was DERIVED from ([`KeyOrigin`]) — carried here so a
    /// caller comparing it against a destination resolved from a frame can
    /// tell a real negative from a comparison that could never succeed.
    pub keyed: KeyOrigin,
    links: &'a [Option<BearerLink>; B],
}

impl<'a, const B: usize> LinkView<'a, B> {
    /// The link record on one bearer, or `None` where this peer has never
    /// been heard on it.
    pub fn heard_on(&self, binding: r2_transport::l1::BindingInstance) -> Option<&'a BearerLink> {
        self.links
            .iter()
            .flatten()
            .find(|link| link.binding == binding)
    }

    /// Every bearer this peer has been heard on (4.1.2).
    pub fn links(&self) -> impl Iterator<Item = &'a BearerLink> {
        self.links.iter().flatten()
    }
}

/// A bearer's answer to *can you address this peer* — the half of L3
/// 5.6.3 that is **not** in the neighbour table (L1).
///
/// ‼ **Three answers rather than two, and the reason is the ANSWER rather
/// than a missing question.** L1 **5.3.1** gives a bearer a per-peer
/// quality reading, `None` for a peer it cannot address — but **5.3.2
/// gives the same `None` to a bearer that measures nothing at all**, so
/// one `Option` carries two meanings and the ambiguity is in what the
/// bearer said.
///
/// *Measured by hive across its three drivers, which use it both ways: an
/// ESP-NOW bearer answers `None` for a peer genuinely not known to it — a
/// true negative — a UDP bearer answers `None` for a peer it CAN address
/// but has recorded no quality for yet, and a loopback bearer answers
/// `None` unconditionally because it measures nothing.*
///
/// ‼ **So reading `None` as *not addressable* would make a bearer that
/// measures nothing forward to NOBODY, while every count reads as a
/// legitimate *no viable neighbours*.** *A `bool` would have forced that
/// collapse; the third answer is what lets a driver say the true thing.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Addressability {
    /// The bearer can address this peer now.
    Yes,
    /// It cannot. **Not viable on this bearer** (5.6.3).
    No,
    /// It cannot answer without attempting — the answer arrives as the
    /// send succeeding or failing.
    OnlyByAttempting,
}

/// A neighbour viable on one bearer (5.6.3), and **whether that viability
/// was established or is provisional**.
#[derive(Clone, Copy, Debug)]
pub struct Viable<'a, const B: usize = 7> {
    pub peer: LinkView<'a, B>,
    /// `true` where the bearer answered [`Addressability::Yes`].
    ///
    /// ‼ **`false` means [`Addressability::OnlyByAttempting`], NOT *not
    /// viable*** — a peer answered [`Addressability::No`] never appears
    /// here at all. **5.6.2 is why the distinction is carried rather than
    /// dropped**: *a hive shall not treat one transmission as satisfying
    /// 5.6.1 without establishing that the bearer's transmission reaches
    /// every viable neighbour*, and a set assembled from unattempted
    /// guesses has established nothing yet.
    pub confirmed: bool,
}

/// **Whether one transmission on a bearer may be treated as flooding
/// (5.6.2).**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FloodMode {
    /// The bearer participates in discovery, so **L1 4.6.2 OBLIGES it to
    /// support broadcast**, and 5.6.1 Note 1 makes one transmission flooding.
    /// *The establishment is a declared obligation rather than an inference.*
    OneBroadcast,
    /// **Broadcast support is not established for this bearer**, so 5.6.2
    /// forbids treating one transmission as satisfying 5.6.1. The caller
    /// sends per peer, or reports the set unestablished — it may not simply
    /// count the transmission.
    NotEstablished,
}

/// **5.6.2 — may one transmission on `profile` be treated as flooding?**
///
/// ‼ **THE ESTABLISHMENT IS A POSITIVE DECLARATION AND NOT THE ABSENCE OF A
/// NEGATIVE ONE, WHICH IS THE WHOLE OF THIS FUNCTION.** `hive-mesh` reasoned
/// from L1 4.6.2a — *a binding shall state when a bearer does NOT support
/// broadcast* — and concluded broadcast from a binding document that says
/// nothing, naming its own evidence as weak in the same comment. **A binding
/// that says nothing is not a binding that says yes**, and the next bearer may
/// not deserve the benefit.
///
/// 4.6.2 gives the positive: *a bearer that participates in discovery shall
/// support broadcast*. So participation ESTABLISHES it.
///
/// ‼ **AND THE CONVERSE IS NOT TAKEN.** A bearer that does not participate may
/// still support broadcast perfectly well — 4.6.2a's obligation to say so
/// binds the binding document, not this profile — so [`FloodMode::NotEstablished`]
/// says *nothing here establishes it*, never *this bearer cannot broadcast*.
/// **That is the absent-versus-no distinction arriving at a routing decision**,
/// and reading it as a refusal would strand traffic on a bearer that works.
pub const fn flood_mode(profile: &r2_transport::l1::BearerProfile) -> FloodMode {
    if profile.participates_in_discovery {
        FloodMode::OneBroadcast
    } else {
        FloodMode::NotEstablished
    }
}

/// The single neighbour table unifying all bearers (L3 Clause 4), bounded at
/// `N` peer entries (class-1 minimum is 32, L0 8.3.2) and `B` independently
/// observed binding instances per peer. The standard does not yet specify the
/// latter capacity (`SS570`), so an assembly must not mistake the default for
/// an interoperable limit.
///
/// Confidence *policy* (how much any observation is worth) is the
/// deployment's; the table enforces only the normative structure: the
/// unverified ceiling (4.4.2), eviction priority (4.4.3/4.4.4/4.4.6), and
/// the two-axis separation (4.2 — `observe` never touches liveness,
/// `verified_evidence` is the only way in).
pub struct NeighbourTable<const N: usize, const B: usize = 7> {
    entries: [Option<Neighbour<B>>; N],
    config: RoutingConfig,
}

/// **4.2.3's first half: the frame's authenticity was verified.**
///
/// ‼ **WHAT IS NOT SUFFICIENT, AND WOULD EACH HAVE BEEN EASY**: the frame
/// parsing, the bearer accepting it, and the medium's own link-layer
/// acknowledgement. **L1 4.4.4 — no layer shall treat a bearer's refusal or
/// acceptance as authenticating anything.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AuthenticityVerified(());

impl AuthenticityVerified {
    /// The trust layer's gate admitted this frame.
    ///
    /// *Named for the only thing that justifies it, so `git grep
    /// by_the_trust_gate` finds every place a hive decided a frame was
    /// authentic.*
    pub const fn by_the_trust_gate() -> Self {
        Self(())
    }
}

/// **4.2.3's second half: the frame's freshness was established.**
///
/// ⚠ **WHAT ESTABLISHES IT IS `SS15`, AND THAT IS WHY THIS IS A WITNESS
/// RATHER THAN A CURVE.** The clause says freshness *shall be established*
/// and does not say against what; `SS15` records the gap and is owned by the
/// drafting lane rather than by Roy. *So this crate declines to invent the
/// test and insists only that somebody performed one* — which is the whole
/// difference between an unenforced sentence and an unenforceable one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FreshnessEstablished(());

impl FreshnessEstablished {
    /// A replay window, a monotonic counter, or whatever the deployment's
    /// answer to `SS15` turns out to be — **established by the caller, and
    /// named so the assertion is greppable.**
    pub const fn asserted_by_caller() -> Self {
        Self(())
    }
}

/// **Both halves of 4.2.3, which is the only thing that may move the liveness
/// axis.**
///
/// ‼ **IT CANNOT BE BUILT FROM ONE.** *Everything below the trust boundary is
/// group-agnostic and forms from whatever it hears; everything that decides
/// who gets delivered to sits above it* — and this is the boundary passing
/// through a data structure, so a value that could be made from authenticity
/// alone would put the boundary back where the doc comment had it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LivenessEvidence(());

impl LivenessEvidence {
    pub const fn new(_authentic: AuthenticityVerified, _fresh: FreshnessEstablished) -> Self {
        Self(())
    }
}

impl<const N: usize, const B: usize> NeighbourTable<N, B> {
    pub const fn new(config: RoutingConfig) -> Self {
        Self {
            entries: [None; N],
            config,
        }
    }

    pub fn get(&self, id: HiveId) -> Option<&Neighbour<B>> {
        self.entries.iter().flatten().find(|n| n.id == id)
    }

    /// Every entry, as the link axis alone (see [`LinkView`]).
    ///
    /// **Owed by 5.6.1 rather than offered for convenience**: *flooding
    /// shall mean that every viable neighbour receives a copy*, and no
    /// implementation can satisfy *every viable neighbour* without
    /// enumerating neighbours. The obligation holds on any bearer and
    /// under any reading of 5.8.2.
    pub fn link_axis(&self) -> impl Iterator<Item = LinkView<'_, B>> {
        self.entries.iter().flatten().map(|n| LinkView {
            id: n.id,
            keyed: n.keyed,
            links: &n.links,
        })
    }

    /// Entries that have been **heard on `bearer`** — the half of 5.6.3
    /// this crate can answer.
    ///
    /// ‼ **NECESSARY AND NOT SUFFICIENT, AND THE DIFFERENCE IS THE WHOLE
    /// POINT OF 5.6.3.** The clause is *a neighbour shall be viable on a
    /// bearer only where that bearer **can address it***, and
    /// addressability is the bearer's answer (L1), not a fact this table
    /// holds. **This filters on having been heard**; a caller completes
    /// the test by asking the bearer.
    ///
    /// *5.6.3 Note 1 is why the unfiltered set is the wrong input: a hive
    /// can know of a peer from its announcements with no bearer able to
    /// address it — heard, and not reachable — and counting it viable
    /// makes a flood look like it fell short when the bearer did
    /// everything it could.*
    pub fn heard_on(
        &self,
        binding: r2_transport::l1::BindingInstance,
    ) -> impl Iterator<Item = LinkView<'_, B>> {
        self.link_axis()
            .filter(move |v| v.heard_on(binding).is_some())
    }

    /// Neighbours viable on `bearer` (**5.6.3**), asking `answer` for the
    /// half this table cannot hold.
    ///
    /// ‼ **`answer` is a required argument and there is no default.** A
    /// helper that assumed addressability would be [`heard_on`] with a
    /// longer name, and would put the word *viable* on a set nothing had
    /// checked — *heard is not addressable, and 5.6.3 Note 1's peer is
    /// heard and not reachable.*
    ///
    /// **`answer` is asked only about peers heard on this bearer**, so a
    /// caller whose answer costs something spends it on candidates rather
    /// than on the whole table.
    ///
    /// [`heard_on`]: NeighbourTable::heard_on
    pub fn viable_on<F>(
        &self,
        binding: r2_transport::l1::BindingInstance,
        mut answer: F,
    ) -> impl Iterator<Item = Viable<'_, B>>
    where
        F: FnMut(HiveId) -> Addressability,
    {
        self.heard_on(binding)
            .filter_map(move |peer| match answer(peer.id) {
                Addressability::Yes => Some(Viable {
                    peer,
                    confirmed: true,
                }),
                Addressability::OnlyByAttempting => Some(Viable {
                    peer,
                    confirmed: false,
                }),
                Addressability::No => None,
            })
    }

    fn get_mut(&mut self, id: HiveId) -> Option<&mut Neighbour<B>> {
        self.entries.iter_mut().flatten().find(|n| n.id == id)
    }

    /// Link-axis observation: any received frame or beacon, verified or not,
    /// treated equivalently (4.1.3, 4.2.2, 4.3.1). Returns false where the
    /// peer is new, the table is full, and no entry is eligible for
    /// eviction (4.4.6: refuse the newcomer).
    /// Record a sighting of `id` on `bearer`.
    ///
    /// **Obligation: `id` shall be the identity the *bearer observed*, not
    /// the origin a frame *claims*.** The two are different facts and only
    /// one of them is evidence of a neighbour.
    ///
    /// A tagged frame's route origin is inside the Layer 4 authenticated
    /// span, but Layer 4 also permits an untagged frame, whose origin an
    /// outsider can claim. Even a valid group tag proves **group
    /// membership, not member identity**, so a member can emit a frame
    /// naming another member as origin. Feeding either claim here would
    /// populate the neighbour table with entries for hives that are not
    /// neighbours and may not be present at all, which is a claim about
    /// the world that the frame is in no position to make: a frame says
    /// who *originated* it, and a neighbour table records who is *directly
    /// reachable*. Those coincide only at one hop, and nothing in the
    /// frame establishes that it took one.
    ///
    /// The bearer's `RxMeta.sender` is the observation; the route origin
    /// is the assertion. **Validity is not truth**, and a verified tag
    /// establishes the frame was not altered, never that what it says is
    /// so.
    ///
    /// ‼ **THE PARAMETER IS AN [`ObservedSender`] AND NOT A BARE [`HiveId`]
    /// SINCE 2026-08-15**, so *the clause's `never` is now unspellable
    /// rather than merely written down*. `hive` asked for it after their
    /// own key-space finding turned out to be a symptom of the same cause:
    /// **the observed sender and the carried origin being one type is WHY
    /// the wrong one could be passed.**
    pub fn observe(
        &mut self,
        sender: ObservedSender,
        binding: r2_transport::l1::BindingInstance,
        strength: LinkQuality,
        now: Ticks,
    ) -> bool {
        let id = sender.id();
        let keyed = sender.key_origin();
        if self.get_mut(id).is_none() && !self.admit(id, keyed) {
            return false;
        }
        let n = self.get_mut(id).expect("admitted above");
        // ‼ **THE LATEST OBSERVATION'S DERIVATION WINS, WHICH IS 4.5.3's
        // DIRECTION.** The clause replaces a transitional identity as soon as
        // the canonical one becomes known; the KEY replacement itself is
        // `retire_superseded`'s and is undischarged (`SS375`), but where the
        // same key arrives claiming a wire identity, recording the weaker
        // origin would understate what this entry can be compared against.
        n.keyed = keyed;
        if let Some(link) = n
            .links
            .iter_mut()
            .flatten()
            .find(|link| link.binding.id == binding.id)
        {
            // An assembly-local ID is stable while a binding is in service.
            // Refuse a caller trying to reuse it for a different profile kind
            // rather than letting one link's history migrate to another.
            if link.binding != binding {
                return false;
            }
            link.strength = strength;
            link.last_heard = now;
            return true;
        }
        let Some(slot) = n.links.iter_mut().find(|slot| slot.is_none()) else {
            // This is a per-neighbour binding-instance bound, distinct from
            // the neighbour-table bound.  Composition chooses B for the
            // bindings it places in service; a full row must not merge links.
            return false;
        };
        *slot = Some(BearerLink {
            binding,
            strength,
            last_heard: now,
        });
        true
    }

    /// Liveness-axis update: only for a frame whose authenticity was
    /// verified **and freshness established**, above the trust boundary
    /// (4.2.3). The entry must already exist (any frame forms it first).
    ///
    /// ‼ **THE SECOND HALF USED TO BE IN THIS DOC COMMENT AND NOWHERE ELSE.**
    /// The signature took an identifier, so *freshness established* was a
    /// sentence a caller could satisfy by having read it — which is the
    /// defect class this corpus keeps meeting, on the clause L3 Note 1 calls
    /// **the most consequential rule in this document.**
    ///
    /// **Now the caller must produce a [`LivenessEvidence`], which cannot be
    /// built without naming both halves.** *A caller that established
    /// authenticity and forgot freshness has nothing to pass.*
    pub fn verified_evidence(&mut self, id: HiveId, _evidence: LivenessEvidence) -> bool {
        match self.get_mut(id) {
            Some(n) => {
                n.verified = true;
                true
            }
            None => false,
        }
    }

    /// Set a neighbour's confidence per the deployment's policy. Clamped to
    /// [0, 1]; a never-verified entry is additionally capped at the
    /// provisional ceiling, whatever traffic volume argued for more (4.4.2).
    pub fn set_confidence(&mut self, id: HiveId, value: f32) -> bool {
        let ceiling = self.config.provisional_ceiling;
        match self.get_mut(id) {
            Some(n) => {
                let cap = if n.verified { 1.0 } else { ceiling };
                n.confidence = value.clamp(0.0, cap);
                true
            }
            None => false,
        }
    }

    /// A path is established for custody release only where confidence is
    /// strictly greater than the forwarding threshold (7.2.1) — which a
    /// never-verified entry can never reach (4.4.5 + 7.2.3).
    /// **Retire an entry, which is what BND1 4.4 needs and nothing offered.**
    ///
    /// ‼ **THE ONLY LEGITIMATE CALLER IS SUPERSESSION.** L1 4.5.3 calls a
    /// medium identity *transitional — replaced as soon as the canonical
    /// identifier becomes known*, and BND1 **4.4** says a derived identifier
    /// *shall not persist once a canonical one is known for that address*.
    /// **Retiring it is the only way to satisfy that**, and until 2026-08-18
    /// this table had no removal at all: an entry, once observed, was
    /// permanent.
    ///
    /// *Neighbours are not otherwise removed on purpose* — L2 6.3.1's fade
    /// governs whether a neighbour is still reachable, and deleting one on
    /// silence would confuse *has not spoken lately* with *is not there*.
    /// **This is the narrow exception, and its name says which.**
    pub fn retire_superseded(&mut self, id: HiveId) -> bool {
        for slot in self.entries.iter_mut() {
            if slot.as_ref().is_some_and(|n| n.id == id) {
                *slot = None;
                return true;
            }
        }
        false
    }

    pub fn path_established(&self, id: HiveId) -> bool {
        self.get(id)
            .is_some_and(|n| n.confidence > self.config.forwarding_threshold)
    }

    fn admit(&mut self, id: HiveId, keyed: KeyOrigin) -> bool {
        if let Some(slot) = self.entries.iter_mut().find(|s| s.is_none()) {
            *slot = Some(Neighbour::new(id, keyed));
            return true;
        }
        // Full: evict the lowest-confidence eligible entry. A newcomer is
        // always unverified (4.3.1), so verified entries are never eligible
        // (4.4.4); no eligible entry means refusal (4.4.6).
        let victim = self
            .entries
            .iter_mut()
            .filter(|s| s.as_ref().is_some_and(|n| !n.verified))
            .min_by(|a, b| {
                let (ca, cb) = (
                    a.as_ref().map_or(f32::MAX, |n| n.confidence),
                    b.as_ref().map_or(f32::MAX, |n| n.confidence),
                );
                ca.partial_cmp(&cb).unwrap_or(core::cmp::Ordering::Equal)
            });
        match victim {
            Some(slot) => {
                *slot = Some(Neighbour::new(id, keyed));
                true
            }
            None => false,
        }
    }
}

/// Frame custody (L3 Clause 7): frames retained because the destination is
/// unreachable (7.1.2 — never because the hive has no neighbours), released
/// when a path establishes strictly above the forwarding threshold (7.2.1,
/// via [`NeighbourTable::path_established`]).
///
/// Retention itself is a *may* (7.1.1, STD-SS4 reading A) — a deployment that
/// never constructs this buffer is conformant. Bounded at `N` frames of at
/// most `F` bytes, oldest discarded first at the bound (7.4.1). Frame bytes
/// are kept verbatim: origin and message identifier ride inside them
/// (7.5.2), and release transmits directly without re-applying duplicate
/// suppression (7.5.1 — caller obligation). Frames the hive cannot carry on
/// any bearer in service are the caller's to drop at once with a structural
/// reason (7.1.3) — they never enter custody.
///
/// # THIS IS **FRAME** CUSTODY, NOT KEY CUSTODY
///
/// **`custody` names two unrelated things in this workspace and a search
/// for it returns both.** Here it is L3 3.8's — *a relay holding a **frame**
/// for later forwarding*. In `r2-wallet` and in `r2-trust::keys` it is L5C
/// 3.2's — *holding a group's **secret key material***. Different layer,
/// different subject, nothing in common but the word.
///
/// **The corpus warned about exactly this and I did not act on it until a
/// peer met the general form elsewhere**: L5C 3.2 Note 1 says *"where the
/// two could be confused, say **key custody** and **frame custody**."*
/// Measured 2026-08-05: `custody` appears in **ten files across the two
/// meanings** here, and neither side named the other.
///
/// *This is the harder failure to search, and worse than a missing name:*
/// a query for the wrong sense returns **confident hits that answer nothing**,
/// where a nil at least announces itself.
pub struct CustodyBuffer<const N: usize, const F: usize> {
    slots: [Option<CustodyEntry<F>>; N],
    /// Monotonically increasing insertion stamp for oldest-first discard.
    seq: u64,
}

struct CustodyEntry<const F: usize> {
    /// The destination, **where the tier can name one**.
    ///
    /// ‼ **`None` IS THE COMPACT TIER AND IT IS NOT A DEFECT** (`d207`).
    /// L4 6.1.2 makes a compact target one hash that may name a group or a
    /// hive, so a relay cannot resolve it — and under Roy's ruling it does
    /// not need to: *a retained frame is retried by re-running the ordinary
    /// route-establishment attempt*, which takes the frame's own target and
    /// never needed a `HiveId`. **A named destination is an optimisation —
    /// it lets [`Self::peek_for_retry`] release the instant a path appears — and
    /// never a precondition for retention.**
    dest: Option<HiveId>,
    bytes: [u8; F],
    len: usize,
    /// **The frame's own TARGET** (L4 6.1), which is what `D-207` says a
    /// retry runs on: *the ordinary route-establishment attempt already
    /// takes a `Target` and never needed a `HiveId`.*
    ///
    /// ‼ **STORED BECAUSE IT IS NOT RECOVERABLE LATER, AND IT CARRIES THE
    /// TIER TOO.** The reception that knew both is gone by the time a
    /// destination becomes reachable, and a release that guessed the
    /// route-entry width would corrupt the record it was appending to
    /// (L4 8.5). `Target::tier()` projects the tier out of it, so this is
    /// one field where there were two facts.
    ///
    /// ⚠ **WHAT IT DOES NOT LICENSE**: resolving a COMPACT target to a hive
    /// is the RECEIVER's act (L4 6.1.2 Note 2), and *a relay holding a frame
    /// for somebody else is not the receiver* — `r2-ident`'s words, refusing
    /// the sibling act. Holding the target makes that resolution possible the
    /// moment `SS373` is ruled; it does not perform it.
    target: Target,
    /// Lifetime expiry deadline (7.4.2), caller-computed from the
    /// deployment's retention period (7.4.3, values unruled — L3 11.4).
    deadline: Ticks,
    seq: u64,
}

/// **One retained frame, copied out for a send attempt and STILL HELD** —
/// and the authority to discard exactly that entry once a bearer has taken
/// it.
///
/// ‼ **THE FRAME NEVER LEAVES CUSTODY BEFORE IT IS SENT** (r2-codex-refute,
/// 2026-08-25). The previous shape took the frame out, handed the caller its
/// bytes, destination and deadline, and offered `hold_again` to put it back.
/// **Two defects followed from that one design and neither was reachable
/// without it.** *First*, `hold_again` was a public raw insert: it accepted
/// arbitrary bytes with no bearer set and no proof the frame had ever been
/// held, so admission — 7.1.3's *drop at once* — had a second door with no
/// lock on it. *Second*, a put-back could not restore the entry's arrival
/// order, because the answer it returned did not carry it; the code stamped
/// `seq: 0` and
/// a comment claimed the original order was kept. **A put-back therefore
/// became the oldest frame in the buffer**, so it was retried first forever
/// and discarded first at capacity — 7.4.1 inverted, and the genuinely
/// oldest frame starved.
///
/// *A frame that is never removed cannot be restored wrongly, and a buffer
/// with no insert door but [`CustodyBuffer::retain`] cannot be filled past
/// 7.1.3.* **Both defects are gone by construction rather than by a check.**
///
/// Not [`Copy`] and not constructible outside this module: it is spent by
/// [`CustodyBuffer::discard`], which is the only removal that is not expiry.
/// ‼ **IT BORROWS THE BUFFER IT WAS COPIED INTO, SO A SECOND LOOK CANNOT
/// COMPILE** (`SS518`, r2-codex-refute 2026-08-25, CONFIRMED).
///
/// `peek_for_retry` takes `&self`, so nothing stopped a caller minting two
/// tokens for ONE slot, sending both copies, and only then discovering on the
/// second `discard` that the entry was already gone — **after two
/// transmissions of one retained frame**, against 7.5.1 and 7.4.1's bound.
/// The shipped wrapper serialises the act, so no board reached it; what was
/// wrong is that this type's documentation called itself *the only such
/// authority* while the type system permitted a second. *That is the defect
/// class `SS512` named — a door claiming what its signature does not enforce
/// — and the answer is the same: make the signature carry the claim.*
///
/// Holding `out` mutably is what does it: the buffer is the caller's, a
/// second peek needs it again, and the borrow checker refuses. The frame is
/// read back through [`Self::frame`] rather than from the caller's own
/// variable, so there is no second path to the bytes either.
#[derive(Debug)]
pub struct Held<'o> {
    slot: usize,
    seq: u64,
    len: usize,
    dest: Option<HiveId>,
    deadline: Ticks,
    target: Target,
    out: &'o mut [u8],
}

impl Held<'_> {
    /// The frame, as copied out — **read through the token and not from the
    /// caller's buffer**, which the token holds for its lifetime.
    #[must_use]
    pub fn frame(&self) -> &[u8] {
        &self.out[..self.len]
    }

    /// The frame's length, as copied into the caller's buffer.
    #[must_use]
    pub const fn len(&self) -> usize {
        self.len
    }
    /// Whether the retained frame is zero bytes long — **which is not a
    /// state this buffer produces**, since [`CustodyBuffer::retain`] stores
    /// what a bearer could carry. Present because a `len` without it reads
    /// as an oversight.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
    /// The destination, where the tier could name one (`d207`).
    #[must_use]
    pub const fn dest(&self) -> Option<HiveId> {
        self.dest
    }
    /// The lifetime deadline this entry was admitted with (7.4.2). Unchanged
    /// by a look, because a look does not remove it.
    #[must_use]
    pub const fn deadline(&self) -> Ticks {
        self.deadline
    }
    /// **The frame's own target** (L4 6.1) — what `D-207`'s retry runs on.
    #[must_use]
    pub const fn target(&self) -> Target {
        self.target
    }

    /// The tier the frame arrived at — the route-entry width its release
    /// must append at (L4 8.2/8.5). **Projected from the target rather than
    /// stored beside it**, so the two cannot disagree.
    #[must_use]
    pub const fn tier(&self) -> Tier {
        self.target.tier()
    }
}

/// What happened when custody was asked for the frame to retry next — **the
/// ONE answer, from the one way to look into custody**
/// ([`CustodyBuffer::peek_for_retry`]).
///
/// ‼ **THREE STATES, AND THE THIRD IS THE POINT.** *Nothing is held* is a
/// fact about the network; *your buffer is too small* is a fact about the
/// caller. **Answering the second with the first hides a caller bug behind
/// a routine, reassuring answer**, and the frame it silently failed to
/// release is the one 5.5.3 Note 1 kept a hive waiting to deliver.
///
/// ‼ **DELIBERATELY NOT `#[non_exhaustive]`.** `hive` argued the general
/// case for [`crate::l3`]'s sibling types on 2026-08-15 and its reasoning
/// binds here: **a wildcard arm is not a softer notification, it is the
/// absence of one**, and the release path ends at a bench capture a later
/// reader trusts. *The build break is the notification, not the cost* —
/// the answer to a peer paying for a variant they did not expect is to
/// name it before it lands, which is what happened with this one.
#[derive(Debug)]
pub enum Peeked<'o> {
    /// The frame, `len` bytes copied into `out` — **and still retained**.
    Held(Held<'o>),
    /// Nothing unexpired is held.
    NothingHeld,
    /// The caller's buffer is shorter than the frame, **and the frame is still
    /// held**: size and call again.
    BufferTooSmall { needed: usize },
}

impl Peeked<'_> {
    /// The length looked at, if a frame was. **Convenience for tests and for
    /// callers that have already handled the other two** — *not a way to
    /// treat the three states as two*, which is what this type exists to
    /// prevent.
    #[must_use]
    pub const fn frame_len(&self) -> Option<usize> {
        match self {
            Self::Held(h) => Some(h.len),
            _ => None,
        }
    }
}

/// Why a frame was refused custody.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CustodyRefusal {
    /// Larger than this buffer's slot — structurally unstorable here.
    Oversize,
    /// ‼ **7.1.3: NO BEARER IN SERVICE COULD EVER CARRY THIS FRAME**, so it
    /// is *dropped at once, with a reason distinct from every transient
    /// one* — never retained.
    ///
    /// **This is a different fact from [`Self::Oversize`] and the two must
    /// not be merged.** `Oversize` says *this buffer's slot is too small*,
    /// which a bigger buffer fixes; this says *no bearer this hive has
    /// could carry it*, which no amount of waiting or buffering fixes.
    /// *Retaining such a frame is holding it for a moment that cannot
    /// arrive.*
    StructurallyUndeliverable,
}

impl<const N: usize, const F: usize> CustodyBuffer<N, F> {
    pub const fn new() -> Self {
        Self {
            slots: [const { None }; N],
            seq: 0,
        }
    }

    /// Retain a frame for `dest` until `deadline`. At capacity the oldest
    /// retained frame is discarded first (7.4.1).
    /// ‼ **7.1.3 IS CHECKED HERE AND IT IS A REFUSAL TO RETAIN, NOT A
    /// REFUSAL TO SEND.** *A hive shall not retain a frame that no bearer
    /// in service could carry — one exceeding the maximum transport unit
    /// payload of every bearer the hive has, or barred from every one of
    /// them by the tier rules of Layer 4. Such a frame shall be dropped at
    /// once.*
    ///
    /// `carriable` is the set of bearers in service, as the caller sees
    /// them **at this moment** — the clause says *in service*, and a bearer
    /// list cached from boot would answer a different question.
    ///
    /// **An empty `carriable` is structurally undeliverable**, not
    /// vacuously deliverable: *a hive with no bearer in service has no
    /// moment at which this frame could leave.*
    ///
    /// ‼ **`now` IS TAKEN SO 7.4.2 RUNS BEFORE 7.4.1 DOES** (r2-codex-refute,
    /// 2026-08-25). Expiry used to be purged only on the retry path, and
    /// the oldest-first selection compares `seq` without asking whether an entry
    /// is still live — so at capacity **a frame with hours left was discarded
    /// to make room while an already-expired one kept its slot**, because the
    /// live one happened to be older. *7.4.2 says the expired frame should
    /// already have been gone*, and 7.4.1's oldest-first is a rule about what
    /// is still retained. **Reversing them costs the wrong frame.**
    pub fn retain(
        &mut self,
        now: Ticks,
        dest: Option<HiveId>,
        target: Target,
        frame: &[u8],
        deadline: Ticks,
        carriable: &[BearerCandidate],
    ) -> Result<(), CustodyRefusal> {
        // ‼ 7.1.3 FIRST, because it is the reason NOT TO STORE. Checking it
        // after the slot check would report `Oversize` for a frame whose
        // real problem is that no bearer could ever carry it — the wrong
        // reason, and a transient-sounding one for a permanent condition.
        if !carriable
            .iter()
            .any(|c| frame.len() <= c.max_payload as usize)
        {
            return Err(CustodyRefusal::StructurallyUndeliverable);
        }
        if frame.len() > F {
            return Err(CustodyRefusal::Oversize);
        }
        // 7.4.2 BEFORE 7.4.1: an expired entry is not a retained frame, so it
        // cannot be what oldest-first is choosing between.
        self.purge_expired(now);
        let slot = match self.slots.iter_mut().position(|s| s.is_none()) {
            Some(i) => i,
            None => self.oldest_index(),
        };
        let mut bytes = [0u8; F];
        bytes[..frame.len()].copy_from_slice(frame);
        self.slots[slot] = Some(CustodyEntry {
            dest,
            bytes,
            len: frame.len(),
            target,
            deadline,
            seq: self.seq,
        });
        self.seq += 1;
        Ok(())
    }

    /// Discard every frame whose lifetime has expired (7.4.2). Hop-limit
    /// expiry lives in the frame bytes and is the caller's release check.
    /// **Copy the frame that should be retried next into `out` — WITHOUT
    /// removing it from custody.**
    ///
    /// ‼ **THE ONE WAY TO LOOK INTO CUSTODY, AND LOOKING IS NOT TAKING**
    /// (`SS504`, r2-codex-refute 2026-08-25). Three public doors once removed
    /// a frame before any acceptance; they were reduced to one, and then that
    /// one still removed it and offered `hold_again` to put it back. **A
    /// put-back is a second admission door however carefully it is written**
    /// — it took arbitrary bytes with no bearer set, and it could not restore
    /// the arrival order it had not been given. *Nothing is taken here, so
    /// there is nothing to restore and no door to restore it through.*
    ///
    /// `prefer` names a destination whose path has just been established
    /// (7.5.1); with `None` the oldest unexpired frame is chosen, which is
    /// the queue's own ageing rather than a special rule about
    /// undeliverability — `D-207`'s fourth part.
    ///
    /// ‼ **7.5.1 AND 7.4.1 ASK DIFFERENT QUESTIONS AND BOTH ARE ANSWERED
    /// HERE.** The clause releases a frame *the moment its destination
    /// becomes reachable*, which is not *what is oldest*: the oldest frame
    /// may be for a peer still absent while a later one is for a peer that
    /// has just appeared. **One door, two orders of preference**, so the
    /// responsiveness 7.5.1 asks for does not need a second mechanism.
    ///
    /// The returned [`Held`] is the authority to [`Self::discard`] that entry
    /// once a bearer has accepted the frame — and the ONLY such authority.
    pub fn peek_for_retry<'o>(
        &self,
        prefer: Option<HiveId>,
        now: Ticks,
        out: &'o mut [u8],
    ) -> Peeked<'o> {
        let idx = self
            .slots
            .iter()
            .enumerate()
            .filter(|(_, s)| {
                s.as_ref()
                    .is_some_and(|e| now < e.deadline && prefer.is_none_or(|d| e.dest == Some(d)))
            })
            .min_by_key(|(_, s)| s.as_ref().map_or(u64::MAX, |e| e.seq))
            .map(|(i, _)| i);
        let Some(idx) = idx else {
            return Peeked::NothingHeld;
        };
        let e = self.slots[idx].as_ref().expect("just inspected");
        if out.len() < e.len {
            return Peeked::BufferTooSmall { needed: e.len };
        }
        out[..e.len].copy_from_slice(&e.bytes[..e.len]);
        Peeked::Held(Held {
            slot: idx,
            seq: e.seq,
            len: e.len,
            dest: e.dest,
            deadline: e.deadline,
            target: e.target,
            out,
        })
    }

    /// **Discard the entry `held` names — the only removal that is not
    /// expiry.** Call it once a bearer has ACCEPTED the frame.
    ///
    /// ‼ **THE ENTRY IS RE-IDENTIFIED, NOT TRUSTED TO STILL BE THERE.** A
    /// [`Held`] carries a slot index and the arrival stamp that was in it; a
    /// caller that retained something else in between could otherwise discard
    /// a DIFFERENT frame that had since taken the slot. *An index is a
    /// position and this buffer's identity is `seq`.* Returns `false` where
    /// the slot no longer carries that entry — the frame it named is already
    /// gone, and nothing else is touched.
    pub fn discard(&mut self, held: Held<'_>) -> bool {
        let slot = &mut self.slots[held.slot];
        if slot.as_ref().is_some_and(|e| e.seq == held.seq) {
            *slot = None;
            return true;
        }
        false
    }

    pub fn purge_expired(&mut self, now: Ticks) {
        for slot in &mut self.slots {
            if slot.as_ref().is_some_and(|e| now >= e.deadline) {
                *slot = None;
            }
        }
    }

    /// The destinations this buffer currently holds a frame for, oldest
    /// first, with duplicates as they occur.
    ///
    /// ‼ **A HOLDER CANNOT ACT ON 7.2.1 WITHOUT THIS.** The release rule is
    /// *forward a retained frame when a path to its destination is
    /// established*, and a caller that cannot enumerate the destinations it
    /// holds can only ask about a destination it already had a reason to name
    /// — which is the destinations it is hearing from, not the ones it is
    /// waiting for. **Without it, [`Self::peek_for_retry`]'s `prefer` arm is
    /// reachable only by
    /// accident**, and the buffer fills and expires while every frame in it
    /// was releasable. *A store you cannot enumerate is a store you can only
    /// read by guessing.*
    pub fn dests(&self) -> impl Iterator<Item = HiveId> + '_ {
        let mut order: [Option<(u64, HiveId)>; N] = [None; N];
        for (i, e) in self.slots.iter().enumerate() {
            // Only the nameable ones: an unnamed entry has no destination to
            // ask `path_established` about, and is released by retry instead.
            order[i] = e.as_ref().and_then(|e| e.dest.map(|d| (e.seq, d)));
        }
        // Selection sort by arrival sequence, in place and without an
        // allocator: N is a small const and the buffer is walked rarely.
        for i in 0..N {
            let mut best = i;
            for j in (i + 1)..N {
                let (bj, bb) = (order[j], order[best]);
                let take = match (bj, bb) {
                    (Some((sj, _)), Some((sb, _))) => sj < sb,
                    (Some(_), None) => true,
                    _ => false,
                };
                if take {
                    best = j;
                }
            }
            order.swap(i, best);
        }
        order.into_iter().flatten().map(|(_, d)| d)
    }

    pub fn len(&self) -> usize {
        self.slots.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn oldest_index(&self) -> usize {
        self.slots
            .iter()
            .enumerate()
            .min_by_key(|(_, s)| s.as_ref().map_or(u64::MAX, |e| e.seq))
            .map(|(i, _)| i)
            .unwrap_or(0)
    }
}

impl<const N: usize, const F: usize> Default for CustodyBuffer<N, F> {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-origin replication rate limiter (L3 5.7.2). A nuisance bound only —
/// the origin may be unverified (10.4). Applies to replication, never to
/// retained or locally delivered frames (5.7.3). Fixed capacity; when full,
/// the entry with the oldest window is recycled.
pub struct RateLimiter<const N: usize> {
    entries: [Option<(HiveId, u32, Ticks)>; N],
    /// Frames permitted per origin per window.
    limit: u32,
    /// Window length in ticks.
    window: u64,
}

impl<const N: usize> RateLimiter<N> {
    pub const fn new(limit: u32, window_ticks: u64) -> Self {
        Self {
            entries: [None; N],
            limit,
            window: window_ticks,
        }
    }

    /// True where replicating one more frame from `origin` is within the
    /// limit (and counts it); false where the origin's window is exhausted
    /// (5.7.2: drop).
    pub fn allow(&mut self, origin: HiveId, now: Ticks) -> bool {
        let mut slot_for_new: Option<usize> = None;
        let mut oldest: Option<(usize, Ticks)> = None;
        for (i, e) in self.entries.iter_mut().enumerate() {
            match e {
                Some((id, count, start)) if *id == origin => {
                    if now.since(*start).is_none_or(|d| d >= self.window) {
                        *start = now;
                        *count = 0;
                    }
                    return if *count < self.limit {
                        *count += 1;
                        true
                    } else {
                        false
                    };
                }
                Some((_, _, start)) => {
                    if oldest.is_none_or(|(_, t)| *start < t) {
                        oldest = Some((i, *start));
                    }
                }
                None => slot_for_new = Some(i),
            }
        }
        let idx = slot_for_new.or(oldest.map(|(i, _)| i)).unwrap_or(0);
        self.entries[idx] = Some((origin, 1, now));
        true
    }
}

/// One candidate bearer for a directed next hop (L3 6.1). The caller
/// assembles these from live L1 reports and the neighbour entry.
#[derive(Clone, Copy, Debug)]
pub struct BearerCandidate {
    pub ordinal: Ordinal,
    pub state: r2_transport::l1::BearerState,
    /// Locally disabled (6.1.2a) — distinct from the bearer's own state.
    pub disabled: bool,
    /// Current maximum transport unit payload, live-reported (L1 5.1).
    pub max_payload: u16,
    /// Restricted bearers carry only peers already among their set
    /// (6.1.2d): whether the next hop is one of them.
    pub carries_peer: bool,
    /// Confidence this bearer reaches the next hop (6.2.1), 0..=1.
    pub confidence: f32,
    /// Freshness of last hearing the next hop on this bearer (6.2.2),
    /// 0..=1 — computed by the caller from last_heard against the bearer's
    /// declared fade (4.5.1). Per bearer, never shared (6.3.3 at L2).
    pub freshness: f32,
    /// Relative cost of sending (6.2.1, profile B6).
    pub cost: u8,
    /// L1's local speed estimate; zero is unknown and receives neutral weight.
    /// It is independent of frame length, and does not override admission.
    pub relative_speed: u8,
}

/// Freshness of the last hearing of a peer on one bearer (L3 6.2.2),
/// as the `[0,1]` figure [`BearerCandidate::freshness`] takes.
///
/// # Why this lives here rather than at each board
///
/// ‼ **`BearerCandidate` documents this value as *computed by the
/// caller*, and every board computing it separately is how two hives come
/// to disagree about what silence means.** 6.2.2 is stated separately from
/// 6.2.1 precisely because *a peer heard a minute ago on a short-range
/// bearer and an hour ago on a long-range one is telling you it has
/// moved* — a fact that only survives if both ends compute it the same
/// way.
///
/// `fade_s` is the bearer's **B5** (L1 Clause 7): *how quickly a peer not
/// heard from on this bearer should be treated as receding.* L1 Note 2
/// says its value is **not a property of the medium and is not set
/// there**, and no clause gives a curve — so **the linear decay below is
/// this implementation's, exactly as `select_bearer`'s formula is.** What
/// the corpus fixes is that the score account for recency per bearer, and
/// that is what this supplies.
///
/// ‼ **`None` is not zero freshness.** It means `now` precedes
/// `last_heard`, which with a conforming monotonic source means the two
/// values are **from different epochs** and must not be compared (L0 5.2,
/// boxed rule). *A caller that reads it as stale has compared across a
/// power cycle and got a plausible number.*
///
/// `fade_s` of zero means any silence at all is total fade: the reading is
/// `1.0` only at the instant it was heard.
pub fn freshness(last_heard: Ticks, now: Ticks, fade_s: u32, ticks_per_second: u32) -> Option<f32> {
    let elapsed = now.since(last_heard)?;
    if elapsed == 0 {
        return Some(1.0);
    }
    let fade_ticks = (fade_s as u64).checked_mul(ticks_per_second as u64)?;
    if fade_ticks == 0 {
        return Some(0.0);
    }
    if elapsed >= fade_ticks {
        return Some(0.0);
    }
    Some(1.0 - (elapsed as f32 / fade_ticks as f32))
}

/// Why 6.1.2 removed a bearer from the set — **one variant per listed
/// condition**, because L3 8.1(b) asks for the REASON and *not selected*
/// cannot carry four of them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Removed {
    /// 6.1.2 a) disabled locally.
    Disabled,
    /// 6.1.2 b) cannot carry a frame of THIS size.
    TooLarge,
    /// 6.1.2 c) reports itself unavailable or failed.
    OutOfService,
    /// L1 4.6.3: observes inbound frames but has no output path to select.
    ReceiveOnly,
    /// 6.1.2 d) restricted, and this next hop is not one it already carries.
    /// **Note 1: a restricted bearer is fully usable for the peers it already
    /// carries** — the only one of the four that depends on which peer.
    RestrictedElsewhere,
}

/// **6.1.2's filter and 6.2's score as ONE function**, so the two cannot
/// drift apart nor be applied in the wrong order.
///
/// `Err` is 6.1.4's removal and it is absolute: *a bearer that comes back
/// `Err` is not reached for even when nothing else remains.* Note 1 to 6.1.4
/// is explicit — a disabled bearer that would have scored best is still
/// disabled.
///
/// The monotonicity is normative (6.2.1: rises with confidence, falls with
/// cost; 6.2.2: recency per bearer). **The exact formula is this
/// implementation's and not the standard's.**
/// D-366 adds L1's relative speed estimate to that score at every frame size.
/// Confidence and freshness remain multiplicative, so a weak or stale fast
/// link can lose to a stronger slower one. This is a heuristic, not an estimate
/// of delivery probability or measured useful throughput.
pub fn admit_and_score(c: &BearerCandidate, frame_len: usize) -> Result<f32, Removed> {
    if c.disabled {
        return Err(Removed::Disabled);
    }
    if frame_len > c.max_payload as usize {
        return Err(Removed::TooLarge);
    }
    match c.state {
        r2_transport::l1::BearerState::Available => {}
        r2_transport::l1::BearerState::Restricted if c.carries_peer => {}
        r2_transport::l1::BearerState::Restricted => return Err(Removed::RestrictedElsewhere),
        r2_transport::l1::BearerState::Unavailable | r2_transport::l1::BearerState::Failed => {
            return Err(Removed::OutOfService)
        }
        r2_transport::l1::BearerState::ReceiveOnly => return Err(Removed::ReceiveOnly),
    }
    Ok(c.confidence.clamp(0.0, 1.0)
        * c.freshness.clamp(0.0, 1.0)
        * f32::from(c.relative_speed.max(1))
        / (1.0 + c.cost as f32))
}

/// One concrete binding offered to the L3 selector by assembly.
///
/// The binding instance is the durable, local identity used for observations
/// and selection. `locally_disabled` is intentionally supplied by assembly:
/// it is a local routing policy fact, not an L1 bearer state and never a
/// property inferred from the registry ordinal.
pub struct RoutingBinding<'a> {
    /// Stable local identity and L1 profile kind for this binding.
    pub instance: r2_transport::l1::BindingInstance,
    /// The concrete L1 binding to inspect and, after selection, send on.
    bearer: &'a mut dyn r2_transport::l1::Bearer,
    regulated_dispatch: bool,
    /// L3 6.1.2a: this binding is locally disabled for routing.
    pub locally_disabled: bool,
}

impl<'a> RoutingBinding<'a> {
    /// Borrow the binding without allowing its admission wrapper to be replaced.
    pub fn bearer(&self) -> &dyn r2_transport::l1::Bearer {
        self.bearer
    }

    pub fn bearer_mut(&mut self) -> &mut dyn r2_transport::l1::Bearer {
        self.bearer
    }

    /// Whether ordinary output has a concrete L2 reservation-enforcing path.
    /// A raw regulated bearer remains excluded from generic output loops.
    pub fn ordinary_output_admitted(&self) -> bool {
        !self.bearer.profile().fade.regulated() || self.regulated_dispatch
    }

    /// Bind a regulated port through L2's actual reservation-enforcing adapter.
    /// Its private port reference cannot be replaced while this borrow lives.
    ///
    /// A raw port cannot grant itself this admission path:
    /// ```compile_fail,E0308
    /// use r2_routing::l3::RoutingBinding;
    /// use r2_transport::l1::{BindingInstance, Bearer};
    /// fn bypass(id: BindingInstance, raw: &mut dyn Bearer) {
    ///     let _ = RoutingBinding::regulated(id, raw);
    /// }
    /// ```
    pub fn regulated(
        instance: r2_transport::l1::BindingInstance,
        output: &'a mut r2_discovery::regulated_output::OrdinaryOutput<'_>,
    ) -> Self {
        Self {
            instance,
            bearer: output,
            regulated_dispatch: true,
            locally_disabled: false,
        }
    }

    /// Route through a component's ordinary-admission operation. The adapter's
    /// send invokes its dispatcher contract, never an unwrapped radio send.
    pub fn component(
        instance: r2_transport::l1::BindingInstance,
        output: &'a mut r2_discovery::regulated_output::ComponentOutput<'_>,
    ) -> Self {
        Self {
            instance,
            bearer: output,
            regulated_dispatch: true,
            locally_disabled: false,
        }
    }

    /// A deferred relay still reaches L2 admission before physical output.
    /// Its queue is owned by the receive/suppression scheduler, not routing.
    pub fn deferred(
        instance: r2_transport::l1::BindingInstance,
        output: &'a mut r2_discovery::regulated_output::DeferredOutput<'_>,
    ) -> Self {
        Self {
            instance,
            bearer: output,
            regulated_dispatch: true,
            locally_disabled: false,
        }
    }

    /// Assemble an enabled binding.
    #[must_use]
    pub const fn enabled(
        instance: r2_transport::l1::BindingInstance,
        bearer: &'a mut dyn r2_transport::l1::Bearer,
    ) -> Self {
        Self {
            instance,
            bearer,
            regulated_dispatch: false,
            locally_disabled: false,
        }
    }

    /// Assemble a binding with an explicit local routing disable.
    #[must_use]
    pub const fn with_local_disable(
        instance: r2_transport::l1::BindingInstance,
        bearer: &'a mut dyn r2_transport::l1::Bearer,
        locally_disabled: bool,
    ) -> Self {
        Self {
            instance,
            bearer,
            regulated_dispatch: false,
            locally_disabled,
        }
    }
}

/// **The binding chosen for ONE next hop (6.1.3), named by its POSITION in
/// the binding slice the caller passed.**
///
/// ‼ **AN ORDINAL CANNOT NAME IT** (L1 8.2.4). More than one binding may use
/// one ordinal, so an `Ordinal` answers a different question than 6.1.3 asks
/// — it names a KIND of bearer where the clause selected a bearer. *Acting on
/// the ordinal transmits on every binding that shares it*, which breaks
/// 6.3.1's one-bearer rule with a value that was never able to express the
/// choice.
///
/// Identical declared profiles do not imply identical routing scores. State,
/// current MTU, per-peer confidence/freshness and the optional local speed
/// estimate belong to the concrete binding. Selection therefore keeps its
/// instance identity all the way to admission.
///
/// ‼ **`index` IS A POSITION AND NOT AN IDENTITY**, as [`Held`]'s slot is. It
/// is valid only against the slice passed to this call. `ordinal` travels
/// beside it so a caller can RE-IDENTIFY before transmitting, the way
/// [`CustodyBuffer::discard`] re-identifies on `seq`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Chosen {
    /// Position in the caller's bearer slice.
    pub index: usize,
    /// The chosen binding's local identity and profile kind, for
    /// re-identification and reports.
    pub binding: r2_transport::l1::BindingInstance,
}

/// **The encoded length of this frame AT EACH TIER, and `None` where the
/// caller has no encoding for that tier** (`SS508`).
///
/// ‼ **A TIER WITH NO LENGTH IS A TIER THIS FRAME CANNOT GO OUT ON**, and the
/// two reasons for that are different in kind. L4 9.2.1 obliges an UNSIGNED
/// frame to be RE-ENCODED at the destination tier — so a caller that CAN cross
/// offers both, and a binding of either tier is viable. 9.2.3 forbids a TAGGED
/// frame from crossing at all, because the tag's span is tier-native — so a
/// caller holding one offers its own tier and nothing else, and the refusal is
/// the clause rather than a shortfall.
///
/// *Passing two lengths rather than one tier is what lets the same selector
/// serve both*: the filter asks whether this binding's tier is one the caller
/// has bytes for, which is the real question, and the tier a frame arrived at
/// stops being privileged over the tier it could be re-encoded to.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct FrameLengths {
    /// Encoded length at the compact tier, or `None` where there is none.
    pub compact: Option<usize>,
    /// Encoded length at the extended tier, or `None` where there is none.
    pub extended: Option<usize>,
}

impl FrameLengths {
    /// One tier only — the shape a TAGGED frame takes (9.2.3).
    #[must_use]
    pub const fn only(tier: Tier, len: usize) -> Self {
        match tier {
            Tier::Compact => Self {
                compact: Some(len),
                extended: None,
            },
            Tier::Extended => Self {
                compact: None,
                extended: Some(len),
            },
        }
    }

    /// The length at `tier`, or `None` where the caller built none.
    #[must_use]
    pub const fn at(self, tier: Tier) -> Option<usize> {
        match tier {
            Tier::Compact => self.compact,
            Tier::Extended => self.extended,
        }
    }
}

/// What the selection SAW, so a report can carry an honest denominator
/// rather than an outcome with no population behind it.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub struct SelectionCensus {
    /// Bindings on which this next hop has been heard at all (6.1.1's set).
    pub in_set: u16,
    /// Of those, how many the bearer itself confirmed it can address (5.6.3).
    pub confirmed: u16,
    /// Of those, how many were skipped because `now` precedes `last_heard` —
    /// different epochs, which must not be compared (L0 5.2).
    pub across_epochs: u16,
    /// Of those, how many had reached zero freshness under their own
    /// binding's declared fade behaviour (4.5.1). This is deliberately not
    /// folded into `removed`: 6.1.2 lists four live bearer filters, while
    /// fading is the separate per-binding routing effect 4.5 requires.
    pub faded: u16,
    /// Of those, how many 6.1.2 removed.
    pub removed: u16,
    /// ‼ **Of those, how many were removed because they carry the OTHER TIER**
    /// (`SS508`). **This is NOT one of 6.1.2's four** — it is L4 9.1.3, which
    /// gives a bearer one tier for ordinary frames, and 9.2.3, which forbids a
    /// TAGGED frame from crossing at all because the tag's span is
    /// tier-native. Counted separately for exactly that reason: a reader must
    /// be able to tell *this hive had no viable bearer* from *this hive had
    /// one and could not encode for it*.
    ///
    /// ⚠ **AND THE COUNT IS A DEBT, NOT A DISCHARGE.** 9.2.1 requires an
    /// UNSIGNED frame to be RE-ENCODED at the destination tier, so a frame
    /// whose only viable next hop is on the other tier is still owed delivery
    /// through `r2_wire::cross_tier`. This filter contains the defect — a
    /// frame of one tier handed to a bearer of the other — and does not pay
    /// the debt. `SS508` holds it.
    pub wrong_tier: u16,
}

/// **6.1.1 through 6.1.3 for ONE next hop, over the caller's live bearers.**
///
/// ‼ **A STREAMING ARGMAX, AND THERE IS NO ARRAY AT ALL.** The shape this
/// replaces collected candidates into a fixed seven-slot buffer and indexed
/// it with an unbounded counter, so an eighth binding on which the next hop
/// was heard **panicked in safe code** (r2-codex-refute, 2026-08-25,
/// CONFIRMED) — and its sibling `carriable_from` truncated at seven instead,
/// reporting a false refusal. *There is nothing here to overrun and nothing
/// to drop: the best binding is the best of however many there are.*
///
/// `ticks_per_second` is `None` only where the caller cannot establish the
/// scale of its L0 monotonic clock. **That is a refusal, not a claim of
/// freshness**: L3 6.2.2 requires recency in every score, so this selector
/// chooses no binding until the caller can provide the scale. Treating the
/// missing value as `1.0` would let an unmeasured link outrank a measured one;
/// omitting it would not be a score conforming to 6.2.2 at all.
pub fn select_binding(
    bearers: &[RoutingBinding<'_>],
    view: &LinkView<'_>,
    lens: FrameLengths,
    now: Ticks,
    ticks_per_second: Option<u32>,
    census: &mut SelectionCensus,
) -> Option<Chosen> {
    let ticks_per_second = ticks_per_second.filter(|ticks| *ticks != 0)?;
    let mut best: Option<(Chosen, f32)> = None;
    for (index, binding) in bearers.iter().enumerate() {
        let b = binding.bearer();
        let profile = b.profile();
        let instance = binding.instance;
        // A composition error must not let a local identity claim a profile
        // other than the concrete bearer it fronts.
        if instance.ordinal != profile.ordinal {
            census.removed = census.removed.saturating_add(1);
            continue;
        }
        // 6.1.1: the set is the bearers on which THIS next hop is reachable.
        // The link axis answers the half the table holds.
        let Some(link) = view.heard_on(instance) else {
            continue;
        };
        census.in_set = census.in_set.saturating_add(1);
        // ‼ **L4 9.1.3: A BEARER HAS ONE TIER FOR ORDINARY FRAMES** (`SS508`).
        // A binding is viable only where the caller HAS an encoding at that
        // binding's tier. 9.2.1 obliges an UNSIGNED frame to be RE-ENCODED at
        // the destination tier rather than withheld from it, so the caller
        // offers what it could build; 9.2.3 forbids a TAGGED frame from
        // crossing at all, and there the caller offers one tier only.
        //
        // Counted, because *no viable bearer* and *a viable bearer whose tier
        // this frame could not be encoded for* are different facts and only
        // one of them is about the network.
        let Some(frame_len) = lens.at(profile.wire_tier) else {
            census.wrong_tier = census.wrong_tier.saturating_add(1);
            continue;
        };
        // 5.6.3's other half, and only the bearer can answer it. `None` is
        // NOT `No`: it covers both *not addressable* and *measures nothing*,
        // and reading it as `No` would drop a peer a silent bearer reaches.
        if b.link_quality(view.id).is_some() {
            census.confirmed = census.confirmed.saturating_add(1);
        }
        let fresh = match freshness(
            link.last_heard,
            now,
            profile.fade.seconds(),
            ticks_per_second,
        ) {
            Some(f) => f,
            None => {
                census.across_epochs = census.across_epochs.saturating_add(1);
                continue;
            }
        };
        // A zero score must not remain a selectable route merely because it
        // is the only candidate.  That would make a fully faded link still
        // transmit, so fading would affect routing only when a fresher link
        // happened to exist.  4.5 makes the declared per-binding fade useful
        // in its own right; zero is therefore no current route on this
        // binding, and is reported separately from the 6.1.2 filters.
        if fresh <= 0.0 {
            census.faded = census.faded.saturating_add(1);
            continue;
        }
        let candidate = BearerCandidate {
            ordinal: instance.ordinal,
            state: b.state(),
            disabled: binding.locally_disabled,
            carries_peer: b.link_quality(view.id).is_some(),
            max_payload: b.max_payload(),
            confidence: link.strength.0,
            freshness: fresh,
            cost: profile.relative_cost,
            relative_speed: b.relative_speed(view.id),
        };
        match admit_and_score(&candidate, frame_len) {
            Err(_) => census.removed = census.removed.saturating_add(1),
            Ok(score) => {
                // Equal scores choose the first binding in the supplied
                // slice. Stable ordering makes otherwise identical runs
                // reproducible, including equal speed/quality estimates.
                if best.is_none_or(|(_, b)| score > b) {
                    best = Some((
                        Chosen {
                            index,
                            binding: instance,
                        },
                        score,
                    ));
                }
            }
        }
    }
    best.map(|(c, _)| c)
}

/// Why a frame is not relayed (L3 5.8.1), surfaced upward with
/// distinguishable reasons (8.1b). `StructurallyUndeliverable` is the 7.1.3
/// reason kept distinct from every transient one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DropReason {
    /// 5.8.1a: hop limit zero after decrement.
    HopExhausted,
    /// 5.8.1b: already seen (5.3), **the suppressing claim's basis
    /// unstated** — what this variant has always meant, and what
    /// [`relay_gate`] still produces.
    Duplicate,
    /// 5.8.1b, suppressed by a claim **verified here** (L5 7.1.2 b)/c)).
    DuplicateOfVerifiedClaim,
    /// ‼ 5.8.1b, suppressed by a claim that **reached the gate and did not
    /// verify**. *This is the one worth a console line*: the frame being
    /// dropped may be genuine and the entry silencing it may be forged.
    DuplicateOfUnverifiedClaim,
    /// 5.8.1b, suppressed by a claim this hive **could not verify at all**,
    /// holding no usable key for that frame's group (L5 7.1.3).
    ///
    /// ‼ **NOT A DEFECT SIGNAL.** On a relay outside the group this is
    /// every frame, and L3 **5.1.2** obliges that relay. It is kept distinct
    /// from [`DropReason::DuplicateOfUnverifiedClaim`] precisely so the
    /// latter stays rare enough to mean something.
    DuplicateOfUnverifiableClaim,
    /// 5.8.1c: origin required and absent (8.3 at L4).
    MissingOrigin,
    /// 5.8.1e: payload exceeds the replication size bound (5.7.1).
    OversizeReplication,
    /// 5.8.1e: origin exceeded its replication rate (5.7.2).
    RateLimited,
    /// 5.8.1g: this hive has ceased relaying (L0 4.2.2).
    CeasedRelaying,
    /// 7.1.3: no bearer in service could ever carry this frame.
    StructurallyUndeliverable,
}

/// Relay disposition (L3 8.1b): forwarded, retained, or dropped-for-reason.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RelayDecision {
    /// Forward carrying this budget (5.5.2 half; or 15 unchanged, flooding).
    Forward {
        budget: u8,
        flood: bool,
    },
    /// Budget spent (5.5.3) — hold for direct delivery, do not relay.
    ///
    /// ‼ **CARRIES NO BUDGET, AND THAT IS THE POINT.** [`Self::Forward`]
    /// names the halved value because forwarding halves; a retained frame
    /// keeps what it arrived with, because 5.5.3 says *shall not relay*
    /// and 5.5.2's halving is a property of relaying. **The release is a
    /// direct transmit to a destination that has become directly
    /// reachable** (5.5.3, 7.5.1) — not a second pass through this gate,
    /// which 7.5.1 forbids in terms: *shall not re-apply the duplicate
    /// suppression of 5.3 to it*.
    Retain,
    Drop(DropReason),
}

/// Inputs the relay gate needs, gathered by the caller from the parsed
/// frame and local state.
///
/// ‼ **`hop_limit` IS THE RECEIVED VALUE AND THE GATE NEVER DECREMENTS
/// IT.** It takes `&RelayInputs`, so it *cannot* — it applies 5.2.2's
/// **check** (would this be zero after decrement?) and leaves the
/// decrement of 5.2.1 to the caller, **immediately before transmitting**.
///
/// *This doc comment previously said the gate "applies the
/// decrement-then-check of 5.2", one sentence after saying the value is
/// the received one.* Corrected 2026-08-15 on `hive`'s retention question,
/// which is the error that contradiction produces: **5.2.1 binds the
/// decrement to the act of relaying, not to arrival**, so a caller that
/// believed the gate had already decremented would either decrement zero
/// times or twice for one hop — and *a hop limit is only a bound if every
/// hive spends exactly one*.
///
/// **The consequence for retention is the whole of the answer**: a frame
/// that came back [`RelayDecision::Retain`] was **never relayed**, so it
/// was never decremented and still carries its arrival hop limit and its
/// arrival budget. Releasing it later spends the first decrement, not a
/// second one.
#[derive(Clone, Copy, Debug)]
pub struct RelayInputs {
    pub relaying_ceased: bool,
    pub hop_limit: u8,
    pub budget: u8,
    pub origin: Option<HiveId>,
    pub origin_required: bool,
    pub msg_id: u32,
    pub payload_len: usize,
    pub replication_size_limit: usize,
}

/// The 5.8 gate, in order. Duplicate suppression and rate limiting mutate
/// their caches only for frames that get that far — a frame dropped earlier
/// leaves no trace. Bearer selection (5.8.1f) runs after, per next hop.
pub fn relay_gate<const D: usize, const R: usize>(
    inputs: &RelayInputs,
    dedup: &mut DedupCache<D>,
    rate: &mut RateLimiter<R>,
    now: Ticks,
) -> RelayDecision {
    relay_gate_claimed(inputs, ClaimBasis::Unstated, dedup, rate, now)
}

/// As [`relay_gate`], stating **what this frame's claim on the dedup key
/// rests on** and returning a drop reason that distinguishes the three
/// cases (`d547`, `standard`'s `STD-SS352`).
///
/// ‼ **THIS IS DELIBERATELY A SIBLING AND NOT A FIELD ON [`RelayInputs`].**
/// A field would oblige *every* caller to state a verification status in
/// order to call the gate at all — which is the right end state and is
/// **held** until `standard` rules `d547`, because *putting the shape in
/// the type system while the clause it serves is undecided would settle a
/// corpus matter by implementation.* This entry point is opt-in, so a
/// caller that adopts it records more and a caller that does not is
/// unchanged.
///
/// ‼ **AND IT DECIDES NOTHING.** The suppression behaviour is identical for
/// every basis, asserted by
/// `suppression_is_identical_whatever_the_claim_rested_on`. Conditioning
/// *insertion* on verification is the clause question and is not done here
/// — and could not be done generally in any case, because L3 **5.1.2**
/// obliges relay by hives that hold no key and can never produce the
/// outcome such a condition would test.
pub fn relay_gate_claimed<const D: usize, const R: usize>(
    inputs: &RelayInputs,
    basis: ClaimBasis,
    dedup: &mut DedupCache<D>,
    rate: &mut RateLimiter<R>,
    now: Ticks,
) -> RelayDecision {
    if inputs.relaying_ceased {
        return RelayDecision::Drop(DropReason::CeasedRelaying);
    }
    if inputs.hop_limit <= 1 {
        // 5.2.1/5.2.2: decrement before relaying; zero after decrement
        // never relays.
        return RelayDecision::Drop(DropReason::HopExhausted);
    }
    let origin = match (inputs.origin, inputs.origin_required) {
        (Some(o), _) => Some(o),
        (None, true) => return RelayDecision::Drop(DropReason::MissingOrigin),
        (None, false) => None,
    };
    if let Some(o) = origin {
        // The reason names the SUPPRESSING entry's basis, not this frame's:
        // the question a reader has at a drop is what the claim that
        // silenced this frame rested on.
        if let Some(b) = dedup.seen_or_insert_claimed(o, inputs.msg_id, now, basis) {
            return RelayDecision::Drop(match b {
                ClaimBasis::Verified => DropReason::DuplicateOfVerifiedClaim,
                ClaimBasis::Unverified => DropReason::DuplicateOfUnverifiedClaim,
                ClaimBasis::NoUsableKeyForThisFrame => DropReason::DuplicateOfUnverifiableClaim,
                ClaimBasis::Unstated => DropReason::Duplicate,
            });
        }
    }
    // Budget splits before the 5.7 bounds: those bound *replication* only,
    // and a frame retained under 5.5.3 is not replicated (5.7.3).
    let decision = match split_budget(inputs.budget) {
        BudgetDecision::Flood => RelayDecision::Forward {
            budget: inputs.budget,
            flood: true,
        },
        BudgetDecision::Forward { forward, .. } => RelayDecision::Forward {
            budget: forward,
            flood: false,
        },
        BudgetDecision::RetainOnly => return RelayDecision::Retain,
    };
    if inputs.payload_len > inputs.replication_size_limit {
        return RelayDecision::Drop(DropReason::OversizeReplication);
    }
    if let Some(o) = origin {
        if !rate.allow(o, now) {
            return RelayDecision::Drop(DropReason::RateLimited);
        }
    }
    decision
}

/// 5.8.2: a frame is never relayed back to the hive it was received from,
/// except where that hive is the destination. Applied per candidate next
/// hop after [`relay_gate`] permits forwarding.
pub fn may_relay_to(
    next_hop: HiveId,
    received_from: Option<HiveId>,
    next_hop_is_destination: bool,
) -> bool {
    received_from != Some(next_hop) || next_hop_is_destination
}

/// **BND1 4.3 and 4.4: a derived identifier is replaced as soon as a
/// canonical one is known, and does not persist.**
///
/// ‼ **THE BINDING CALLS THIS THE RULE MOST LIKELY TO BE IMPLEMENTED WRONGLY,
/// AND SAYS ITS FAILURE IS SILENT.** Note 1 to 4.4: *a hive reachable on three
/// bearers becoming three neighbours.* **And on ESP-NOW the temptation is
/// concrete** — *the six-octet address is stable, unique and free, and
/// reporting it upward costs nothing and looks correct.*
///
/// ‼ **`ObservedSender::from_transitional_medium` STATED THE OBLIGATION IN A
/// DOC COMMENT AND NOTHING ENFORCED IT.** That is the defect class this corpus
/// keeps meeting: *a clause stating a behaviour, with code holding only its
/// data.* This is the behaviour.
///
/// # Why `resolve` rather than a flag
///
/// A caller that must remember to check *is this superseded* will one day not
/// check, and the failure is a duplicate neighbour nobody sees. **So the
/// question a caller naturally asks — what identifier is this peer — is the
/// one that carries the answer**, and the transitional key cannot be used
/// after supersession without going through it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Supersession {
    transitional: HiveId,
    canonical: HiveId,
}

/// The transitional identities this hive has replaced.
pub struct Supersessions<const N: usize> {
    entries: [Option<Supersession>; N],
}

impl<const N: usize> Default for Supersessions<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> Supersessions<N> {
    pub const fn new() -> Self {
        Self { entries: [None; N] }
    }

    /// Record that `canonical` is the real identifier for a peer previously
    /// known as `transitional` (4.3).
    ///
    /// Returns whether it was recorded; `false` where the register is full,
    /// **which is reported rather than swallowed** — a supersession that was
    /// silently dropped leaves a derived identifier persisting, which is
    /// exactly what 4.4 forbids.
    ///
    /// ‼ **A SUPERSESSION TO ITSELF IS REFUSED.** It would make `resolve` a
    /// no-op that looks like a supersession, and *an entry claiming a peer
    /// was replaced by itself is the shape a buggy caller produces.*
    pub fn supersede(&mut self, transitional: HiveId, canonical: HiveId) -> bool {
        if transitional == canonical {
            return false;
        }
        for e in self.entries.iter_mut().flatten() {
            if e.transitional == transitional {
                e.canonical = canonical;
                return true;
            }
        }
        for slot in self.entries.iter_mut() {
            if slot.is_none() {
                *slot = Some(Supersession {
                    transitional,
                    canonical,
                });
                return true;
            }
        }
        false
    }

    /// **The identifier to use for `observed` (4.4).** The canonical one
    /// where this key has been superseded, otherwise `observed` unchanged.
    ///
    /// ‼ **TRANSITIVE, BECAUSE A PEER MAY BE HEARD TRANSITIONALLY MORE THAN
    /// ONCE.** A chain is followed to its end, and a cycle — which a caller
    /// should never build — terminates rather than hanging, because *a
    /// routing table that spins on a malformed register is worse than one
    /// that answers the last identifier it reached.*
    pub fn resolve(&self, observed: HiveId) -> HiveId {
        let mut at = observed;
        for _ in 0..N {
            match self.entries.iter().flatten().find(|e| e.transitional == at) {
                Some(e) => at = e.canonical,
                None => return at,
            }
        }
        at
    }

    /// Whether this key has been replaced, so a caller can assert 4.4 rather
    /// than infer it.
    pub fn is_superseded(&self, id: HiveId) -> bool {
        self.entries.iter().flatten().any(|e| e.transitional == id)
    }

    pub fn len(&self) -> usize {
        self.entries.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Why a device may not declare that it has ceased relaying (L0 4.2.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CessationRefusal {
    /// 4.2.2 permits cessation to **capability class 1 only**.
    NotClassOne {
        class: r2_hal_traits::decl::CapabilityClass,
    },
    /// Class 1, and not power-constrained. **4.2.2's permission has two
    /// conditions and a device meeting one of them meets neither** — *small
    /// is not the same as short of power*, and Note 1 says so in the other
    /// direction: a fully capable hive that happens to run on small hardware
    /// does not carry the marking.
    NotPowerConstrained,
}

/// Whether this device relays for others, and therefore what it must put on
/// the frames it originates (L0 4.2.1, 4.2.2, 4.2.3).
///
/// # ‼ TWO RULES THAT MUST AGREE, AND NOTHING WAS COMPARING THEM
///
/// **4.2.3**: *a device that has ceased relaying shall carry the
/// constrained-origin marking on every frame it originates.* The marking was
/// a `bool` spelled at each `FrameSpec`, and **eight origination sites across
/// three hives carried the literal `false`** while the fact lived elsewhere.
/// *Correct today, and correct by coincidence: nothing made the two move
/// together.*
///
/// **The marking is therefore DERIVED here and never spelled** —
/// [`marks_frames`](Self::marks_frames) is the only way to obtain it.
///
/// # ‼ AND CEASING IS A PERMISSION, NOT A SETTING
///
/// **4.2.2**: *a device in capability class 1 that is power-constrained may
/// cease relaying.* Both conditions, and a device meeting one meets neither.
/// Note 1 states the other side: **the marking means "this origin will not
/// relay for you" and nothing else** — *a fully capable hive that happens to
/// run on small hardware does not carry it.*
///
/// # ⚠ AND THE FACT BINDS EVEN WHERE THE PERMISSION DOES NOT
///
/// 4.2.3's subject is *a device that HAS ceased relaying*, however it came to
/// — including a bench control that silences relaying to measure something.
/// **So [`ceased_in_fact`](Self::ceased_in_fact) exists, is named for what it
/// is, and marks frames exactly like a permitted cessation.** *A hive that
/// stopped relaying and did not say so is the failure 4.2.3 Note 2 names:
/// indistinguishable, from every other device's position, from one that has
/// failed — and the mesh then spends effort routing through something that
/// will never forward.* **Ceasing to relay is legitimate; ceasing silently is
/// not.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct OriginStance {
    ceased: bool,
}

impl OriginStance {
    /// The ordinary case: this device relays for others (4.2.1).
    pub const fn relaying() -> Self {
        Self { ceased: false }
    }

    /// **4.2.2: cease relaying, where this device is permitted to.**
    ///
    /// Refuses rather than silently relaying on: *a device that believes it
    /// has ceased and has not is the same failure as one that ceased without
    /// saying so, reached from the other side.*
    pub const fn ceased(
        class: r2_hal_traits::decl::CapabilityClass,
        power_constrained: bool,
    ) -> Result<Self, CessationRefusal> {
        use r2_hal_traits::decl::CapabilityClass as C;
        match class {
            C::Class1 if power_constrained => Ok(Self { ceased: true }),
            C::Class1 => Err(CessationRefusal::NotPowerConstrained),
            other => Err(CessationRefusal::NotClassOne { class: other }),
        }
    }

    /// **Relaying has stopped as a matter of fact, whatever permitted it.**
    ///
    /// ‼ **NAMED SO A GREP FINDS EVERY ONE.** A bench control that silences
    /// relaying produces a device that has ceased relaying, and 4.2.3 binds
    /// *that device* — the clause's subject is the fact and not the
    /// permission. **The alternative was a muted hive whose frames did not
    /// say so**, which is the one outcome 4.2.3 exists to prevent.
    pub const fn ceased_in_fact() -> Self {
        Self { ceased: true }
    }

    /// **4.2.3: does every frame this device originates carry the marking?**
    ///
    /// *The only way to obtain the flag*, so a call site cannot spell it
    /// independently of the stance it belongs to.
    pub const fn marks_frames(self) -> bool {
        self.ceased
    }

    /// Whether this device has ceased relaying.
    pub const fn has_ceased(self) -> bool {
        self.ceased
    }
}

#[cfg(test)]
mod tests {
    use super::{CessationRefusal, OriginStance};
    use r2_hal_traits::decl::CapabilityClass;

    /// ‼ **4.2.2 HAS TWO CONDITIONS AND A DEVICE MEETING ONE MEETS
    /// NEITHER.** *Small is not the same as short of power*, and Note 1 says
    /// so from the other side: a fully capable hive that happens to run on
    /// small hardware does not carry the marking.
    #[test]
    fn only_a_power_constrained_class_one_device_may_cease_relaying() {
        assert!(OriginStance::ceased(CapabilityClass::Class1, true).is_ok());
        assert_eq!(
            OriginStance::ceased(CapabilityClass::Class1, false),
            Err(CessationRefusal::NotPowerConstrained)
        );
        for class in [
            CapabilityClass::Class2,
            CapabilityClass::Class3,
            CapabilityClass::Class4,
            CapabilityClass::Class5,
        ] {
            assert_eq!(
                OriginStance::ceased(class, true),
                Err(CessationRefusal::NotClassOne { class }),
                "{class:?} may not cease however power-constrained it claims to be"
            );
        }
    }

    /// ‼ **4.2.3 BINDS THE FACT, NOT THE PERMISSION.** A bench control that
    /// silences relaying produces a device that has ceased relaying, and its
    /// frames must say so — *a muted hive whose frames did not is the one
    /// outcome 4.2.3 exists to prevent.*
    #[test]
    fn a_cessation_in_fact_marks_frames_exactly_like_a_permitted_one() {
        let permitted = OriginStance::ceased(CapabilityClass::Class1, true).unwrap();
        let in_fact = OriginStance::ceased_in_fact();
        assert!(permitted.marks_frames());
        assert!(in_fact.marks_frames());
        assert_eq!(
            permitted, in_fact,
            "the wire cannot tell them apart, and 4.2.3 does not ask it to"
        );
    }

    /// The ordinary device relays and marks nothing — *the marking means
    /// "this origin will not relay for you" and nothing else.*
    #[test]
    fn a_relaying_device_marks_nothing() {
        let s = OriginStance::relaying();
        assert!(!s.has_ceased());
        assert!(!s.marks_frames());
    }

    /// ‼ **7.1.3: A FRAME NO BEARER IN SERVICE COULD CARRY IS DROPPED AT
    /// ONCE, WITH A REASON DISTINCT FROM EVERY TRANSIENT ONE** — and until
    /// 2026-08-14 the variant existed and **nothing produced it**. The row
    /// said *no test emits it*; the truth was that **no code emitted it**,
    /// which is a larger claim and the one worth recording.
    ///
    /// *Retaining such a frame is holding it for a moment that cannot
    /// arrive.*
    #[test]
    fn a_frame_no_bearer_could_carry_is_refused_custody_rather_than_retained() {
        let mut c: CustodyBuffer<4, 64> = CustodyBuffer::new();
        let small = [BearerCandidate {
            ordinal: Ordinal::Ble,
            state: r2_transport::l1::BearerState::Available,
            disabled: false,
            carries_peer: true,
            max_payload: 8,
            confidence: 1.0,
            freshness: 1.0,
            cost: 1,
            relative_speed: 1,
        }];
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                &[0u8; 32],
                Ticks(100),
                &small
            ),
            Err(CustodyRefusal::StructurallyUndeliverable)
        );
        // ‼ AND IT IS NOT MERELY UNSENT — IT IS NOT HELD. A buffer that
        // refused and stored anyway would satisfy a return-value test and
        // break the clause.
        let mut out = [0u8; 64];
        assert!(
            matches!(
                c.peek_for_retry(Some(id(1)), Ticks(50), &mut out),
                Peeked::NothingHeld
            ),
            "7.1.3: not retained"
        );

        // CONTROL 1: the same frame with a bearer that can carry it IS
        // retained — so the refusal is the bearer set, not the frame.
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                &[0u8; 32],
                Ticks(100),
                &carries_anything()
            ),
            Ok(())
        );
        // Looked at BEFORE the deadline: at it, 7.4 has already expired it, and
        // an expiry here would look like the 7.1.3 refusal it is meant to
        // contrast with.
        assert!(matches!(
            c.peek_for_retry(Some(id(1)), Ticks(50), &mut out),
            Peeked::Held(_)
        ));
    }

    /// ‼ **THE TWO REFUSALS MEAN DIFFERENT THINGS AND THE ORDER PROVES
    /// IT.** A frame too big for the slot **and** too big for every bearer
    /// reports `StructurallyUndeliverable`, not `Oversize`: *a bigger
    /// buffer fixes `Oversize` and nothing fixes this one*, so reporting
    /// the transient-sounding reason for a permanent condition would send a
    /// reader to change the wrong thing.
    #[test]
    fn the_permanent_reason_outranks_the_buffer_shaped_one() {
        let mut c: CustodyBuffer<4, 16> = CustodyBuffer::new();
        let small = [BearerCandidate {
            ordinal: Ordinal::Ble,
            state: r2_transport::l1::BearerState::Available,
            disabled: false,
            carries_peer: true,
            max_payload: 8,
            confidence: 1.0,
            freshness: 1.0,
            cost: 1,
            relative_speed: 1,
        }];
        // 32 bytes: larger than the 16-byte slot AND larger than the only
        // bearer's 8-byte payload. Both conditions hold.
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                &[0u8; 32],
                Ticks(100),
                &small
            ),
            Err(CustodyRefusal::StructurallyUndeliverable)
        );
        // CONTROL: fits every bearer, too big for the slot — now `Oversize`
        // is the true answer and is what comes back.
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                &[0u8; 32],
                Ticks(100),
                &carries_anything()
            ),
            Err(CustodyRefusal::Oversize)
        );
    }

    /// ‼ **AND NO BEARER IN SERVICE AT ALL IS STRUCTURALLY UNDELIVERABLE,
    /// NOT VACUOUSLY DELIVERABLE.** *A hive with no bearer in service has
    /// no moment at which this frame could leave* — and an `any()` over an
    /// empty slice is `false`, which is the right answer here and is the
    /// wrong answer often enough to be worth pinning.
    #[test]
    fn a_hive_with_no_bearer_in_service_retains_nothing() {
        let mut c: CustodyBuffer<4, 64> = CustodyBuffer::new();
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                b"anything",
                Ticks(100),
                &[]
            ),
            Err(CustodyRefusal::StructurallyUndeliverable)
        );
    }

    /// **L3 4.2.2a: the per-bearer link carries strength and last-heard,
    /// and the row said the test asserted PRESENCE ONLY.** *A table storing
    /// the right shape and the wrong values passes a presence test.*
    #[test]
    fn a_link_stores_the_strength_and_time_it_was_given() {
        let config = RoutingConfig::new(0.3, 0.6).expect("valid");
        let mut t: NeighbourTable<4> = NeighbourTable::new(config);
        assert!(t.observe(
            ObservedSender::asserted_by_caller(id(1)),
            binding(Ordinal::Ble),
            LinkQuality::new(0.75),
            Ticks(42)
        ));
        let n = t.get(id(1)).expect("known");
        let l = n.link(binding(Ordinal::Ble)).expect("the link is present");
        assert_eq!(
            l.strength,
            LinkQuality::new(0.75),
            "the value, not just the field"
        );
        assert_eq!(l.last_heard, Ticks(42));

        // And a later sighting REPLACES both rather than accumulating.
        assert!(t.observe(
            ObservedSender::asserted_by_caller(id(1)),
            binding(Ordinal::Ble),
            LinkQuality::new(0.25),
            Ticks(99)
        ));
        let l2 = t.get(id(1)).unwrap().link(binding(Ordinal::Ble)).unwrap();
        assert_eq!(l2.strength, LinkQuality::new(0.25));
        assert_eq!(l2.last_heard, Ticks(99));
    }

    /// ‼ **7.1.2: THE CONDITION FOR RETAINING SHALL NOT BE THAT THE HIVE
    /// HAS NO NEIGHBOURS**, and 7.1.3 Note 1 says why in terms: *a hive
    /// with neighbours but no path to the destination is **the ordinary
    /// case**, and a rule conditioned on having no neighbours at all names
    /// a trigger that never fires.*
    ///
    /// The row called this *structural: `retain` never consults the
    /// neighbour table* — true, and **an absence nothing asserted**. This
    /// is the positive form: a hive with a **full** neighbour table still
    /// retains for a destination none of them is.
    #[test]
    fn a_hive_with_neighbours_still_retains_for_an_unreachable_destination() {
        let config = RoutingConfig::new(0.3, 0.6).expect("valid");
        let mut t: NeighbourTable<4> = NeighbourTable::new(config);
        for b in 1..=4u8 {
            assert!(t.observe(
                ObservedSender::asserted_by_caller(id(b)),
                binding(Ordinal::Ble),
                LinkQuality::new(0.9),
                Ticks(1)
            ));
        }
        assert_eq!(
            (1..=4u8).filter(|b| t.get(id(*b)).is_some()).count(),
            4,
            "precondition: the hive has neighbours, and plenty"
        );

        // The destination is none of them.
        let mut c: CustodyBuffer<4, 64> = CustodyBuffer::new();
        let stranger = id(99);
        assert!(t.get(stranger).is_none(), "precondition: and not this one");
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(stranger),
                Target::Compact(0),
                b"for a stranger",
                Ticks(100),
                &carries_anything()
            ),
            Ok(()),
            "7.1.2: neighbour count is not the condition"
        );

        // ‼ AND THE CONVERSE, WHICH IS THE HALF THAT MAKES IT A CONDITION
        // RATHER THAN AN INDIFFERENCE: an EMPTY neighbour table retains the
        // same frame identically. Retention neither requires neighbours nor
        // is prevented by them — *`retain` does not consult the table at
        // all*, and both halves are needed to show that rather than
        // assert it.
        let empty: NeighbourTable<4> = NeighbourTable::new(config);
        assert!(
            empty.get(stranger).is_none() && empty.get(id(1)).is_none(),
            "precondition: this table holds nobody"
        );
        let mut c2: CustodyBuffer<4, 64> = CustodyBuffer::new();
        assert_eq!(
            c2.retain(
                Ticks(0),
                Some(stranger),
                Target::Compact(0),
                b"for a stranger",
                Ticks(100),
                &carries_anything()
            ),
            Ok(())
        );
    }

    /// A bearer set that can carry anything these tests offer, so the
    /// 7.1.3 arm is out of the way of every case that is not about it.
    /// **Named rather than inlined** so the one test that wants an
    /// *unable* set is visibly doing something different.
    fn carries_anything() -> [BearerCandidate; 1] {
        [BearerCandidate {
            ordinal: Ordinal::Ble,
            state: r2_transport::l1::BearerState::Available,
            disabled: false,
            carries_peer: true,
            max_payload: u16::MAX,
            confidence: 1.0,
            freshness: 1.0,
            cost: 1,
            relative_speed: 1,
        }]
    }
    use super::*;
    extern crate std;
    use std::vec::Vec;

    #[test]
    fn hive_id_from_wire_widths() {
        let e8 = [1, 2, 3, 4, 5, 6, 7, 8];
        assert_eq!(HiveId::from_wire(&e8), Some(HiveId(e8)));
        // 4-byte compact zero-pads high, matching XV1 zero-extension.
        let e4 = [0xA, 0xB, 0xC, 0xD];
        assert_eq!(
            HiveId::from_wire(&e4),
            Some(HiveId([0, 0, 0, 0, 0xA, 0xB, 0xC, 0xD]))
        );
        assert_eq!(HiveId::from_wire(&[1, 2, 3]), None);
    }

    #[test]
    fn dedup_keys_on_origin_and_msg_id_only() {
        let mut c: DedupCache<4> = DedupCache::new(100);
        let a = HiveId([1; 8]);
        let b = HiveId([2; 8]);
        let t = Ticks(0);
        assert!(!c.seen_or_insert(a, 7, t));
        // Same frame via a different path (different immediate sender —
        // not part of the key): suppressed (L3 vector: one copy continues).
        assert!(c.seen_or_insert(a, 7, t));
        // Different origin, same msg_id: distinct.
        assert!(!c.seen_or_insert(b, 7, t));
        // Different msg_id, same origin: distinct.
        assert!(!c.seen_or_insert(a, 8, t));
    }

    #[test]
    fn dedup_overwrites_oldest_at_capacity() {
        let mut c: DedupCache<2> = DedupCache::new(1000);
        let a = HiveId([1; 8]);
        let t = Ticks(0);
        assert!(!c.seen_or_insert(a, 1, t));
        assert!(!c.seen_or_insert(a, 2, t));
        assert!(!c.seen_or_insert(a, 3, t)); // evicts (a,1)
        assert!(!c.seen_or_insert(a, 1, t)); // forgotten — short window is the design
        assert!(c.seen_or_insert(a, 3, t));
    }

    #[test]
    fn a_suppression_record_expires() {
        // L3 5.3.4: bound the LIFETIME, not only the capacity. A ring of N
        // evicts only when N further frames arrive, so on a quiet link an
        // entry persists indefinitely — which is what this bounds.
        let mut c: DedupCache<4> = DedupCache::new(100);
        let a = HiveId([1; 8]);
        assert!(!c.seen_or_insert(a, 7, Ticks(0)));
        assert!(c.seen_or_insert(a, 7, Ticks(99)), "expired early");
        // At the lifetime it is no longer suppressing, with NO further
        // traffic having arrived to evict it.
        assert!(
            !c.seen_or_insert(a, 7, Ticks(100)),
            "the bound did not apply"
        );
        // Long after everything, with no traffic at all, the cache
        // suppresses nothing — which is the property 5.3.4 asks for.
        assert_eq!(
            c.live_entries(Ticks(10_000)),
            0,
            "an entry outlived its bound"
        );
    }

    #[test]
    fn silencing_a_peer_is_temporary_not_indefinite() {
        // The amplification 5.3.4 bounds. L5 7.2.2: passage does not
        // establish WHICH member sent a frame, and the L4 tag is computed
        // under the GROUP key — so a member can pre-claim another's
        // (origin, msg_id) pairs. Per-frame member signatures are
        // unaffordable here, so the fix is not prevention but a BOUND.
        let mut c: DedupCache<8> = DedupCache::new(60);
        let victim = HiveId([9; 8]);

        // A member pre-claims the victim's identifiers on a silent link.
        for msg_id in 0..4 {
            assert!(!c.seen_or_insert(victim, msg_id, Ticks(0)));
        }
        // The victim's genuine frames are suppressed — this is the residue
        // L3 10.5 records, and it is real.
        for msg_id in 0..4 {
            assert!(c.seen_or_insert(victim, msg_id, Ticks(10)));
        }
        // But it ends on its own, with no traffic required to flush it.
        for msg_id in 0..4 {
            assert!(
                !c.seen_or_insert(victim, msg_id, Ticks(60)),
                "msg_id {msg_id} was still silenced after the lifetime"
            );
        }
    }

    /// ‼ **THE CLAUSE-NEUTRALITY CONTROL.** `d547` asks whether a key may be
    /// claimed before verification, and `standard` owns that question. This
    /// asserts that recording the basis answers **none** of it: every basis
    /// claims the key, and every basis suppresses identically.
    ///
    /// *If a later change made insertion conditional on the basis, this test
    /// fails* — which is the point. It would be settling a corpus matter by
    /// implementation, and this is the tripwire on that.
    #[test]
    fn suppression_is_identical_whatever_the_claim_rested_on() {
        let a = HiveId([1; 8]);
        for basis in [
            ClaimBasis::Verified,
            ClaimBasis::Unverified,
            ClaimBasis::NoUsableKeyForThisFrame,
            ClaimBasis::Unstated,
        ] {
            let mut c: DedupCache<8> = DedupCache::new(60);
            assert_eq!(
                c.seen_or_insert_claimed(a, 7, Ticks(0), basis),
                None,
                "{basis:?} did not claim the key"
            );
            assert_eq!(
                c.seen_or_insert_claimed(a, 7, Ticks(10), basis),
                Some(basis),
                "{basis:?} did not suppress its own repeat"
            );
            assert_eq!(
                c.live_entries(Ticks(10)),
                1,
                "{basis:?} entry count differs"
            );
            // And the bound is unchanged: expiry is not basis-dependent
            // either, so a forged claim is temporary exactly as a genuine
            // one is.
            assert_eq!(
                c.seen_or_insert_claimed(a, 7, Ticks(60), basis),
                None,
                "{basis:?} outlived the lifetime"
            );
        }
    }

    /// The signature itself: a poisoned drop and a healthy one printed the
    /// same line, so the failure was indistinguishable from the cache
    /// working. **The reason names the SUPPRESSING claim, not this frame's.**
    #[test]
    fn the_drop_reason_names_what_the_suppressing_claim_rested_on() {
        let a = HiveId([1; 8]);
        let cases = [
            (ClaimBasis::Verified, DropReason::DuplicateOfVerifiedClaim),
            (
                ClaimBasis::Unverified,
                DropReason::DuplicateOfUnverifiedClaim,
            ),
            (
                ClaimBasis::NoUsableKeyForThisFrame,
                DropReason::DuplicateOfUnverifiableClaim,
            ),
            (ClaimBasis::Unstated, DropReason::Duplicate),
        ];
        for (claimed, expected) in cases {
            let mut d: DedupCache<8> = DedupCache::new(60);
            let mut r: RateLimiter<8> = RateLimiter::new(1000, 8);
            let inputs = RelayInputs {
                relaying_ceased: false,
                hop_limit: 4,
                budget: 15,
                origin: Some(a),
                origin_required: true,
                msg_id: 7,
                payload_len: 8,
                replication_size_limit: 1024,
            };
            // First frame claims on `claimed`; the second arrives with a
            // DIFFERENT basis, so a test that accidentally reported the
            // incoming frame's basis would fail here.
            let _ = relay_gate_claimed(&inputs, claimed, &mut d, &mut r, Ticks(0));
            let second =
                relay_gate_claimed(&inputs, ClaimBasis::Verified, &mut d, &mut r, Ticks(1));
            assert_eq!(
                second,
                RelayDecision::Drop(expected),
                "a claim on {claimed:?} produced the wrong drop reason"
            );
        }
    }

    /// ‼ **THE PRE-EXISTING ENTRY POINTS ARE UNCHANGED**, so a caller that
    /// has not adopted the basis sees exactly what it saw before — including
    /// `hive`, whose characterisation test for this defect compares against
    /// [`DropReason::Duplicate`].
    #[test]
    fn the_unstated_path_still_reports_the_reason_it_always_did() {
        let a = HiveId([1; 8]);
        let mut c: DedupCache<8> = DedupCache::new(60);
        assert!(!c.seen_or_insert(a, 7, Ticks(0)));
        assert!(c.seen_or_insert(a, 7, Ticks(10)));

        let mut d: DedupCache<8> = DedupCache::new(60);
        let mut r: RateLimiter<8> = RateLimiter::new(1000, 8);
        let inputs = RelayInputs {
            relaying_ceased: false,
            hop_limit: 4,
            budget: 15,
            origin: Some(a),
            origin_required: true,
            msg_id: 7,
            payload_len: 8,
            replication_size_limit: 1024,
        };
        let _ = relay_gate(&inputs, &mut d, &mut r, Ticks(0));
        assert_eq!(
            relay_gate(&inputs, &mut d, &mut r, Ticks(1)),
            RelayDecision::Drop(DropReason::Duplicate),
        );
    }

    /// ‼ **AN OUT-OF-GROUP RELAY MUST NOT LOOK ATTACKED.** L3 5.1.2 obliges
    /// a hive holding no key to relay, so on such a hive EVERY entry is
    /// unverifiable. If that produced the same reason as a failed
    /// verification, the signal would fire constantly on correct behaviour —
    /// and *a constant marking trains everyone to ignore it, leaving the one
    /// that matters looking identical.*
    #[test]
    fn a_hive_that_cannot_verify_does_not_report_a_verification_failure() {
        let a = HiveId([1; 8]);
        let mut d: DedupCache<8> = DedupCache::new(60);
        let mut r: RateLimiter<8> = RateLimiter::new(1000, 8);
        let inputs = RelayInputs {
            relaying_ceased: false,
            hop_limit: 4,
            budget: 15,
            origin: Some(a),
            origin_required: true,
            msg_id: 7,
            payload_len: 8,
            replication_size_limit: 1024,
        };
        let b = ClaimBasis::NoUsableKeyForThisFrame;
        let _ = relay_gate_claimed(&inputs, b, &mut d, &mut r, Ticks(0));
        let drop = relay_gate_claimed(&inputs, b, &mut d, &mut r, Ticks(1));
        assert_eq!(
            drop,
            RelayDecision::Drop(DropReason::DuplicateOfUnverifiableClaim)
        );
        assert_ne!(
            drop,
            RelayDecision::Drop(DropReason::DuplicateOfUnverifiedClaim),
            "an obliged 5.1.2 relay was reported as a verification failure"
        );
        // The counter agrees, and is reported WITH its denominator.
        assert_eq!(d.live_entries_unverified(Ticks(1)), 1);
        assert_eq!(d.live_entries(Ticks(1)), 1);
    }

    /// `Unstated` is the absence of an answer, so it must not read as
    /// verified — the same direction `live` gives an uncomputable age.
    #[test]
    fn an_unstated_basis_is_not_a_claim_of_verification() {
        assert!(!ClaimBasis::Unstated.is_verified());
        assert!(!ClaimBasis::NoUsableKeyForThisFrame.is_verified());
        assert!(!ClaimBasis::Unverified.is_verified());
        assert!(ClaimBasis::Verified.is_verified());
    }

    #[test]
    fn an_uncomputable_age_does_not_suppress() {
        // L0 5.2: a monotonic clock does not span a power cycle, so `now`
        // can precede an entry. G9 decides the direction — suppression is
        // the authority, so the unreadable case must not grant it.
        // Re-flooding a duplicate costs airtime; suppressing wrongly
        // silences a peer.
        let mut c: DedupCache<4> = DedupCache::new(1000);
        let a = HiveId([1; 8]);
        assert!(!c.seen_or_insert(a, 7, Ticks(500)));
        assert!(c.seen_or_insert(a, 7, Ticks(600)));
        // Clock restarted: the age cannot be computed at all.
        assert!(
            !c.seen_or_insert(a, 7, Ticks(3)),
            "an entry whose age is uncomputable still suppressed"
        );
    }

    fn cfg() -> RoutingConfig {
        RoutingConfig::new(0.3, 0.6).unwrap()
    }

    /// ‼ **4.2.3 HAS TWO HALVES AND THE SIGNATURE NOW CARRIES BOTH.** L3
    /// Note 1 calls this *the most consequential rule in this document* —
    /// **the trust boundary passing through a data structure** — and the
    /// second half lived only in a doc comment: the method took an
    /// identifier, so *freshness established* was a sentence a caller could
    /// satisfy by having read it.
    ///
    /// *`LivenessEvidence` cannot be built from authenticity alone*, so a
    /// caller that verified a frame and forgot freshness has nothing to pass
    /// and does not compile. **What establishes freshness is `SS15` and is
    /// deliberately not a curve in this crate** — the witness insists only
    /// that somebody performed a test, which is the difference between an
    /// unenforced sentence and an unenforceable one.
    #[test]
    fn the_liveness_axis_moves_only_on_both_halves_of_4_2_3() {
        let mut t: NeighbourTable<4> =
            NeighbourTable::new(RoutingConfig::new(0.3, 0.6).expect("ceiling below threshold"));
        let peer = id(7);

        // Below the boundary: any frame forms the link axis, group-agnostic.
        t.observe(
            ObservedSender::from_transitional_medium(peer),
            binding(Ordinal::Udp),
            LinkQuality::new(0.9),
            Ticks(1),
        );
        assert!(!t.path_established(peer), "4.4.2: unverified is capped");

        // Above it: both halves, named at the site.
        assert!(t.verified_evidence(peer, liveness()));
        t.set_confidence(peer, 1.0);
        assert!(t.path_established(peer));

        // And an entry that does not exist is not created by evidence —
        // the link axis forms first, which is the boundary's direction.
        assert!(!t.verified_evidence(id(9), liveness()));

        // ‼ ONE ENTRY CARRIES BOTH AXES (L3-004, added 2026-09-04 after an adversarial
        //   pass). Everything above reaches the axes through `path_established`, which
        //   answers the same way however the values are stored — so moving confidence off
        //   the entry into a table-wide parallel array, which is exactly what 4.2.1
        //   forbids, left this test GREEN. Measured. Both axes are therefore read here
        //   from a SINGLE borrow of one entry, so a split cannot survive: with the value
        //   elsewhere, `confidence()` is not a method on `Neighbour` and this stops
        //   compiling, which is the strongest red available for a structural claim.
        let entry = t.get(peer).expect("the observed peer has an entry");
        let link_axis = entry.links().count();
        let liveness_axis = entry.confidence();
        assert!(
            link_axis > 0,
            "3.3: the entry carries a link axis, and it is on the entry itself"
        );
        assert_eq!(
            liveness_axis, 1.0,
            "3.4: the same entry carries the liveness axis — one entry, both axes (4.2.1)"
        );
        assert!(
            entry.verified(),
            "and the verified flag rides the same entry rather than a side table"
        );
    }

    /// Both halves of 4.2.3, for tests that are about something else.
    fn liveness() -> LivenessEvidence {
        LivenessEvidence::new(
            AuthenticityVerified::by_the_trust_gate(),
            FreshnessEstablished::asserted_by_caller(),
        )
    }

    fn id(b: u8) -> HiveId {
        HiveId([b; 8])
    }

    fn binding(ordinal: Ordinal) -> r2_transport::l1::BindingInstance {
        r2_transport::l1::BindingInstance::new(r2_transport::l1::BindingId(ordinal as u8), ordinal)
    }

    /// `L3-002`: an ordinal is a profile kind, not the key of a live link.
    /// Two assembled radios implementing the same bearer must remain two
    /// observations; otherwise a strong reception on one radio refreshes a
    /// sibling that never heard the peer and routing can select the sibling.
    #[test]
    fn sibling_bindings_with_one_ordinal_do_not_share_link_evidence() {
        let mut table: NeighbourTable<1, 2> =
            NeighbourTable::new(RoutingConfig::new(0.3, 0.6).unwrap());
        let first =
            r2_transport::l1::BindingInstance::new(r2_transport::l1::BindingId(41), Ordinal::Lora);
        let second =
            r2_transport::l1::BindingInstance::new(r2_transport::l1::BindingId(42), Ordinal::Lora);
        assert!(table.observe(
            ObservedSender::asserted_by_caller(id(1)),
            first,
            LinkQuality::new(0.9),
            Ticks(10),
        ));
        assert!(table.observe(
            ObservedSender::asserted_by_caller(id(1)),
            second,
            LinkQuality::new(0.2),
            Ticks(20),
        ));
        let peer = table.get(id(1)).unwrap();
        assert_eq!(peer.links().count(), 2);
        assert_eq!(peer.link(first).unwrap().strength, LinkQuality::new(0.9));
        assert_eq!(peer.link(second).unwrap().last_heard, Ticks(20));
    }

    /// ‼ **THE FAILURE BND1 4.4 Note 1 DESCRIBES, PINNED: A HIVE HEARD FIRST
    /// BY MEDIUM ADDRESS AND THEN CANONICALLY MUST BE ONE NEIGHBOUR, NOT
    /// TWO.** *A hive reachable on three bearers becoming three neighbours* —
    /// and the binding says the failure is **silent**, which is why a test is
    /// the only thing that could have caught it.
    #[test]
    fn a_superseded_transitional_identity_leaves_one_neighbour_not_two() {
        let mut t: NeighbourTable<8> =
            NeighbourTable::new(RoutingConfig::new(0.3, 0.6).expect("ceiling below threshold"));
        let transitional = id(0xAA);
        let canonical = id(0x11);

        // Heard first as a medium-derived identity — legitimate: the bearer
        // genuinely observed it, and 4.5.3 calls it transitional, not
        // unusable.
        t.observe(
            ObservedSender::from_transitional_medium(transitional),
            binding(Ordinal::Udp),
            LinkQuality::new(0.9),
            Ticks(1),
        );
        assert_eq!(t.link_axis().count(), 1);

        // Then the canonical identifier becomes known for the same peer.
        let mut sup: Supersessions<4> = Supersessions::new();
        assert!(sup.supersede(transitional, canonical));
        t.observe(
            ObservedSender::asserted_by_caller(canonical),
            binding(Ordinal::Udp),
            LinkQuality::new(0.9),
            Ticks(2),
        );

        // ‼ WITHOUT THE RETIREMENT THIS IS THE DEFECT: two entries, one hive.
        assert_eq!(
            t.link_axis().count(),
            2,
            "both keys are present until one is retired"
        );
        assert!(
            t.retire_superseded(transitional),
            "4.4: it shall not persist"
        );

        assert_eq!(t.link_axis().count(), 1, "one hive, one neighbour");
        assert!(t.get(canonical).is_some());
        assert!(
            t.get(transitional).is_none(),
            "the derived identifier is gone, which is 4.4"
        );
        // And retiring something absent is `false` rather than a panic.
        assert!(!t.retire_superseded(transitional));
    }

    /// **4.4 through the question a caller naturally asks.** A caller that
    /// had to remember to check a flag would one day not check, and the
    /// failure is a duplicate neighbour nobody sees — so the identifier
    /// lookup carries the answer.
    #[test]
    fn resolve_returns_the_canonical_identifier_and_follows_a_chain() {
        let mut sup: Supersessions<4> = Supersessions::new();
        let (a, b, c) = (id(1), id(2), id(3));

        assert_eq!(sup.resolve(a), a, "unknown keys pass through unchanged");
        assert!(!sup.is_superseded(a));

        assert!(sup.supersede(a, b));
        assert_eq!(sup.resolve(a), b);
        assert!(sup.is_superseded(a));

        // Heard transitionally twice: the chain is followed to its end.
        assert!(sup.supersede(b, c));
        assert_eq!(sup.resolve(a), c, "a -> b -> c");
        assert_eq!(sup.resolve(b), c);
        assert_eq!(sup.resolve(c), c);
    }

    /// ‼ **A SUPERSESSION TO ITSELF IS REFUSED, AND A CYCLE TERMINATES.**
    /// The first is the shape a buggy caller produces and would make
    /// `resolve` a no-op that looks like a supersession; the second is worse
    /// than a wrong answer — *a routing table that spins on a malformed
    /// register is worse than one that answers the last identifier it
    /// reached.*
    #[test]
    fn a_self_supersession_is_refused_and_a_cycle_terminates() {
        let mut sup: Supersessions<4> = Supersessions::new();
        assert!(
            !sup.supersede(id(1), id(1)),
            "a peer is not replaced by itself"
        );
        assert!(sup.is_empty());

        // A cycle a caller should never build.
        assert!(sup.supersede(id(1), id(2)));
        assert!(sup.supersede(id(2), id(1)));
        let _ = sup.resolve(id(1)); // terminates rather than hanging
    }

    /// A full register reports rather than swallowing: a supersession
    /// silently dropped leaves a derived identifier persisting, which is
    /// exactly what 4.4 forbids.
    #[test]
    fn a_full_supersession_register_says_so() {
        let mut sup: Supersessions<2> = Supersessions::new();
        assert!(sup.supersede(id(1), id(9)));
        assert!(sup.supersede(id(2), id(9)));
        assert!(!sup.supersede(id(3), id(9)));
        // And re-superseding a held key updates rather than inserting.
        assert!(sup.supersede(id(1), id(8)));
        assert_eq!(sup.resolve(id(1)), id(8));
        assert_eq!(sup.len(), 2);
    }

    #[test]
    fn config_enforces_ceiling_strictly_below_threshold() {
        // 4.4.5: equal is non-conforming.
        assert!(RoutingConfig::new(0.6, 0.6).is_none());
        assert!(RoutingConfig::new(0.7, 0.6).is_none());
        assert!(RoutingConfig::new(0.3, 0.6).is_some());
    }

    #[test]
    fn one_peer_two_bearers_one_entry() {
        // L1 4.5 verification vector.
        let mut t: NeighbourTable<4> = NeighbourTable::new(cfg());
        let now = Ticks(10);
        assert!(t.observe(
            ObservedSender::asserted_by_caller(id(1)),
            binding(Ordinal::Ble),
            LinkQuality::new(0.8),
            now
        ));
        assert!(t.observe(
            ObservedSender::asserted_by_caller(id(1)),
            binding(Ordinal::Lora),
            LinkQuality::new(0.4),
            now
        ));
        let n = t.get(id(1)).unwrap();
        assert_eq!(n.links().count(), 2);
        assert!(n.link(binding(Ordinal::Ble)).is_some());
        assert!(n.link(binding(Ordinal::Lora)).is_some());
        assert!(t.get(id(2)).is_none());
    }

    #[test]
    fn unverified_confidence_capped_at_ceiling() {
        // 4.4.2: traffic volume never raises past the ceiling; 7.2.3/4.4.5:
        // an unverified path can never establish.
        let mut t: NeighbourTable<4> = NeighbourTable::new(cfg());
        t.observe(
            ObservedSender::asserted_by_caller(id(1)),
            binding(Ordinal::Ble),
            LinkQuality::new(1.0),
            Ticks(1),
        );
        t.set_confidence(id(1), 0.99);
        assert_eq!(t.get(id(1)).unwrap().confidence(), 0.3);
        assert!(!t.path_established(id(1)));
        // ‼ THE OPERATIVE WORDS ARE *BY VOLUME OF TRAFFIC* (L3-012b, added 2026-09-04 after
        //   an adversarial pass). One call cannot tell "capped on every call" from "capped
        //   once": a cap that applied only to the FIRST write left this test GREEN, measured.
        //   Volume is the whole claim, so the test must apply volume — and each reception
        //   also re-observes, because that is what traffic actually does.
        for round in 0..8 {
            t.observe(
                ObservedSender::asserted_by_caller(id(1)),
                binding(Ordinal::Ble),
                LinkQuality::new(1.0),
                Ticks(2 + round),
            );
            t.set_confidence(id(1), 0.99);
            assert_eq!(
                t.get(id(1)).unwrap().confidence(),
                0.3,
                "4.4.2: reception {round} raised an unverified entry past the ceiling"
            );
        }
        // Verified evidence lifts the cap; strict inequality at threshold.
        t.verified_evidence(id(1), liveness());
        t.set_confidence(id(1), 0.6);
        assert!(!t.path_established(id(1))); // 7.2.1: at equality, no
        t.set_confidence(id(1), 0.61);
        assert!(t.path_established(id(1)));
    }

    #[test]
    fn verified_survives_eviction_and_full_table_refuses() {
        // L3 9.2 named vector: fill with unverified + one verified; the
        // verified entry survives, ceiling never exceeded.
        let mut t: NeighbourTable<3> = NeighbourTable::new(cfg());
        for i in 1..=3u8 {
            t.observe(
                ObservedSender::asserted_by_caller(id(i)),
                binding(Ordinal::Ble),
                LinkQuality::new(0.5),
                Ticks(1),
            );
            t.set_confidence(id(i), 0.2);
        }
        t.verified_evidence(id(1), liveness());
        t.set_confidence(id(2), 0.05); // lowest-confidence unverified
        assert!(t.observe(
            ObservedSender::asserted_by_caller(id(9)),
            binding(Ordinal::Ble),
            LinkQuality::new(0.5),
            Ticks(2)
        ));
        assert!(t.get(id(2)).is_none(), "lowest unverified evicted");
        assert!(t.get(id(1)).is_some(), "verified survives (4.4.4)");
        assert!(t.get(id(9)).is_some());

        // All verified: newcomer refused (4.4.6).
        t.verified_evidence(id(3), liveness());
        t.verified_evidence(id(9), liveness());
        assert!(!t.observe(
            ObservedSender::asserted_by_caller(id(7)),
            binding(Ordinal::Ble),
            LinkQuality::new(1.0),
            Ticks(3)
        ));
        assert!(t.get(id(7)).is_none());
    }

    #[test]
    fn liveness_only_by_verified_evidence() {
        // 4.2: observe() never touches the liveness axis, whatever volume.
        let mut t: NeighbourTable<4> = NeighbourTable::new(cfg());
        for tick in 0..100u64 {
            t.observe(
                ObservedSender::asserted_by_caller(id(1)),
                binding(Ordinal::Ble),
                LinkQuality::new(1.0),
                Ticks(tick),
            );
        }
        assert!(!t.get(id(1)).unwrap().verified());
        // Liveness needs an existing entry — verification never forms one.
        assert!(!t.verified_evidence(id(2), liveness()));
    }

    #[test]
    fn rate_limiter_windows_per_origin() {
        let mut r: RateLimiter<4> = RateLimiter::new(2, 100);
        assert!(r.allow(id(1), Ticks(0)));
        assert!(r.allow(id(1), Ticks(10)));
        assert!(!r.allow(id(1), Ticks(20))); // exhausted within window
        assert!(r.allow(id(2), Ticks(20))); // other origins unaffected
        assert!(r.allow(id(1), Ticks(100))); // window rolled
    }

    #[test]
    fn filter_removes_exactly_6_1_2() {
        use r2_transport::l1::BearerState;
        let base = BearerCandidate {
            ordinal: Ordinal::Ble,
            state: BearerState::Available,
            disabled: false,
            max_payload: 200,
            carries_peer: false,
            confidence: 0.9,
            freshness: 1.0,
            cost: 1,
            relative_speed: 1,
        };
        // (a) locally disabled, (b) too small, (c) unavailable/failed,
        // (d) restricted without the peer.
        let candidates = [
            BearerCandidate {
                disabled: true,
                ..base
            },
            BearerCandidate {
                ordinal: Ordinal::Lora,
                max_payload: 50,
                ..base
            },
            BearerCandidate {
                ordinal: Ordinal::Usb,
                state: BearerState::Failed,
                ..base
            },
            BearerCandidate {
                ordinal: Ordinal::WifiMesh,
                state: BearerState::Restricted,
                ..base
            },
        ];
        assert_eq!(best_ordinal(&candidates, 100), None); // 6.1.4

        // ‼ ONE VARIANT PER LISTED CONDITION (L3-042, added 2026-09-04 after an adversarial
        //   pass). The assertion above reads only that NOTHING was selected, which is equally
        //   true of an implementation that answers every removal with the same reason — so
        //   collapsing TooLarge, OutOfService and RestrictedElsewhere onto Disabled left all
        //   fifty-eight tests in this crate GREEN. Measured. 6.1.2 lists the conditions
        //   separately and a caller that cannot tell them apart cannot report or act on them,
        //   so each candidate is now asked for its OWN reason, in the shape the receive-only
        //   sibling test below already uses.
        assert_eq!(
            admit_and_score(&candidates[0], 100),
            Err(Removed::Disabled),
            "6.1.2 a): a locally disabled binding is removed AS disabled"
        );
        assert_eq!(
            admit_and_score(&candidates[1], 100),
            Err(Removed::TooLarge),
            "6.1.2 b): a binding that cannot carry the frame is removed AS too small"
        );
        assert_eq!(
            admit_and_score(&candidates[2], 100),
            Err(Removed::OutOfService),
            "6.1.2 c): a failed binding is removed AS out of service"
        );
        assert_eq!(
            admit_and_score(&candidates[3], 100),
            Err(Removed::RestrictedElsewhere),
            "6.1.2 d): a restricted binding not carrying the peer is removed AS restricted"
        );

        // Restricted carrying the peer stays in.
        let ok = [BearerCandidate {
            ordinal: Ordinal::WifiMesh,
            state: BearerState::Restricted,
            carries_peer: true,
            ..base
        }];
        assert_eq!(best_ordinal(&ok, 100), Some(Ordinal::WifiMesh));
    }

    #[test]
    fn a_receive_only_ingress_cannot_win_a_next_hop_selection() {
        use r2_transport::l1::BearerState;
        let ingress = BearerCandidate {
            ordinal: Ordinal::Lora,
            state: BearerState::ReceiveOnly,
            disabled: false,
            max_payload: 250,
            carries_peer: false,
            confidence: 1.0,
            freshness: 1.0,
            cost: 0,
            relative_speed: 1,
        };
        assert_eq!(
            admit_and_score(&ingress, 64),
            Err(Removed::ReceiveOnly),
            "a strong passive observation is not an addressable return path"
        );
    }

    /// Argmax over [`admit_and_score`] — **the ORDERING half of 6.1.3 over a
    /// candidate list** rather than over live bindings.
    ///
    /// ‼ **TEST-LOCAL ON PURPOSE.** `select_bearer` used to be this, in the
    /// public surface, and it answered 6.1.3 with an `Ordinal` — which under
    /// L1 8.2.4 cannot name the binding the clause selected. *A wrong answer
    /// in the public surface is where the next caller reaches first*, so the
    /// shape survives only where it is a fixture and the property it asserts
    /// is the score's, which `admit_and_score` owns.
    fn best_ordinal(candidates: &[BearerCandidate], frame_len: usize) -> Option<Ordinal> {
        candidates
            .iter()
            .filter_map(|c| admit_and_score(c, frame_len).ok().map(|s| (c.ordinal, s)))
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(core::cmp::Ordering::Equal))
            .map(|(o, _)| o)
    }

    #[test]
    fn score_monotonicity_confidence_up_cost_down() {
        use r2_transport::l1::BearerState;
        let mk = |ordinal, confidence, freshness, cost| BearerCandidate {
            ordinal,
            state: BearerState::Available,
            disabled: false,
            max_payload: 200,
            carries_peer: false,
            confidence,
            freshness,
            cost,
            relative_speed: 1,
        };
        // Higher confidence wins at equal cost (6.2.1).
        let c = [
            mk(Ordinal::Ble, 0.9, 1.0, 1),
            mk(Ordinal::Lora, 0.5, 1.0, 1),
        ];
        assert_eq!(best_ordinal(&c, 10), Some(Ordinal::Ble));
        // Lower cost wins at equal confidence (6.2.1).
        let c = [mk(Ordinal::Udp, 0.8, 1.0, 8), mk(Ordinal::Ble, 0.8, 1.0, 1)];
        assert_eq!(best_ordinal(&c, 10), Some(Ordinal::Ble));
        // Staler hearing loses (6.2.2).
        let c = [
            mk(Ordinal::Ble, 0.8, 0.1, 1),
            mk(Ordinal::Lora, 0.8, 1.0, 1),
        ];
        assert_eq!(best_ordinal(&c, 10), Some(Ordinal::Lora));
    }

    #[test]
    fn speed_is_size_independent_but_weak_or_stale_fast_links_can_lose() {
        let slow = BearerCandidate {
            ordinal: Ordinal::Usb,
            state: r2_transport::l1::BearerState::Available,
            disabled: false,
            max_payload: 200,
            carries_peer: true,
            confidence: 0.8,
            freshness: 1.0,
            cost: 1,
            relative_speed: 1,
        };
        // Same ordinal: a local binding report decides speed, not L3's
        // knowledge of transport names. Cost still penalizes the faster one.
        let fast = BearerCandidate {
            relative_speed: 8,
            cost: 10,
            ..slow
        };
        for len in [4, 120, 200] {
            assert!(admit_and_score(&fast, len).unwrap() > admit_and_score(&slow, len).unwrap());
            for poorer in [
                BearerCandidate {
                    confidence: 0.1,
                    ..fast
                },
                BearerCandidate {
                    freshness: 0.1,
                    ..fast
                },
            ] {
                assert!(
                    admit_and_score(&poorer, len).unwrap() < admit_and_score(&slow, len).unwrap()
                );
            }
        }
        assert_eq!(admit_and_score(&fast, 4), admit_and_score(&fast, 200));
        assert_eq!(
            admit_and_score(
                &BearerCandidate {
                    relative_speed: 0,
                    ..slow
                },
                4
            ),
            admit_and_score(&slow, 4)
        );
        for refused in [
            BearerCandidate {
                disabled: true,
                ..fast
            },
            BearerCandidate {
                state: r2_transport::l1::BearerState::Failed,
                ..fast
            },
            BearerCandidate {
                state: r2_transport::l1::BearerState::Restricted,
                carries_peer: false,
                ..fast
            },
        ] {
            assert!(admit_and_score(&refused, 4).is_err());
        }
        assert_eq!(admit_and_score(&fast, 201), Err(Removed::TooLarge));
    }

    #[test]
    fn relay_gate_5_8_order_and_reasons() {
        let mut dedup: DedupCache<8> = DedupCache::new(1000);
        let mut rate: RateLimiter<8> = RateLimiter::new(10, 1000);
        let base = RelayInputs {
            relaying_ceased: false,
            hop_limit: 5,
            budget: 6,
            origin: Some(id(1)),
            origin_required: true,
            msg_id: 42,
            payload_len: 50,
            replication_size_limit: 100,
        };
        let now = Ticks(0);

        assert_eq!(
            relay_gate(&base, &mut dedup, &mut rate, now),
            RelayDecision::Forward {
                budget: 3,
                flood: false
            }
        );
        // Same frame again: duplicate (5.3 keyed origin+msgid alone).
        assert_eq!(
            relay_gate(&base, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::Duplicate)
        );
        // Hop 1 -> zero after decrement (5.2.2).
        let h = RelayInputs {
            hop_limit: 1,
            msg_id: 43,
            ..base
        };
        assert_eq!(
            relay_gate(&h, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::HopExhausted)
        );
        // Origin required, absent (5.8.1c) — and dedup untouched by it.
        let o = RelayInputs {
            origin: None,
            msg_id: 44,
            ..base
        };
        assert_eq!(
            relay_gate(&o, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::MissingOrigin)
        );
        // Oversize replication (5.7.1).
        let s = RelayInputs {
            payload_len: 101,
            msg_id: 45,
            ..base
        };
        assert_eq!(
            relay_gate(&s, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::OversizeReplication)
        );
        // Budget 1: half rounds to zero -> retain, never drop (5.5.3).
        let b = RelayInputs {
            budget: 1,
            msg_id: 46,
            ..base
        };
        assert_eq!(
            relay_gate(&b, &mut dedup, &mut rate, now),
            RelayDecision::Retain
        );
        // Flood sentinel passes through unchanged (5.5.5).
        let f = RelayInputs {
            budget: 15,
            msg_id: 47,
            ..base
        };
        assert_eq!(
            relay_gate(&f, &mut dedup, &mut rate, now),
            RelayDecision::Forward {
                budget: 15,
                flood: true
            }
        );
        // Ceased relaying wins over everything (5.8.1g).
        let c = RelayInputs {
            relaying_ceased: true,
            ..base
        };
        assert_eq!(
            relay_gate(&c, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::CeasedRelaying)
        );
        // 5.7.3: replication bounds do NOT apply to retained frames — a
        // budget-spent frame retains even when oversize for replication.
        let r = RelayInputs {
            budget: 1,
            payload_len: 101,
            msg_id: 48,
            ..base
        };
        assert_eq!(
            relay_gate(&r, &mut dedup, &mut rate, now),
            RelayDecision::Retain
        );
        // Rate limit reached through the gate itself (5.7.2 → RateLimited).
        let mut tight: RateLimiter<4> = RateLimiter::new(1, 1000);
        let a = RelayInputs { msg_id: 49, ..base };
        let b = RelayInputs { msg_id: 50, ..base };
        assert!(matches!(
            relay_gate(&a, &mut dedup, &mut tight, now),
            RelayDecision::Forward { .. }
        ));
        assert_eq!(
            relay_gate(&b, &mut dedup, &mut tight, now),
            RelayDecision::Drop(DropReason::RateLimited)
        );
    }

    /// **`CORE-18`: THE `(None, false)` ARM REACHES `Forward` WITH NEITHER
    /// DUPLICATE SUPPRESSION NOR RATE LIMITING CONSULTED, AND UNTIL NOW NO
    /// TEST ENTERED IT.**
    ///
    /// `origin_required` is the caller's `FrameType::requires_origin()`, which
    /// is false for **`GroupMgmt` and nothing else** (`r2-wire`
    /// `frame.rs:84`). So this arm is not a hypothetical: it is the whole of
    /// GROUP_MGMT's relay path, and both flood controls are `if let Some(o) =
    /// origin`, so an origin-less frame skips both by construction rather than
    /// by decision.
    ///
    /// # THIS TEST ASSERTS THE CURRENT BEHAVIOUR AND DOES NOT ENDORSE IT
    ///
    /// **No numbered clause settles what this arm should do.** The former
    /// one-hop/no-relay wording appears only in L4 8.5 Note 2. `D-232` rules
    /// that notes do not bind, so the generic gate's present admission is
    /// characterization, not an endorsed Group Management forwarding policy.
    /// `SS529` records the missing numbered carriage, source-attribution and
    /// authenticity decision.
    ///
    /// **So the fix is a clause, not a patch** — the same shape as
    /// `holds_the_key_is_not_is_a_member` in `r2-trust`. Changing the
    /// disposition here would build something the corpus does not describe.
    ///
    /// **If this test changes, read `SS529` first.** A policy change belongs
    /// in numbered canon before it belongs in this generic gate.
    ///
    /// The two controls below are what make the first assertion mean
    /// anything: they show both caches are live on the same invocation, so
    /// the skips are the arm's doing and not a dead cache's.
    #[test]
    fn group_mgmt_relays_with_both_flood_controls_unconsulted() {
        let mut dedup: DedupCache<8> = DedupCache::new(1000);
        // Capacity ONE, so a second admitted frame from one origin is refused.
        let mut rate: RateLimiter<4> = RateLimiter::new(1, 1000);
        let now = Ticks(0);

        let mgmt = RelayInputs {
            relaying_ceased: false,
            hop_limit: 5,
            budget: 6,
            origin: None,
            origin_required: false, // FrameType::GroupMgmt, and only it
            msg_id: 7,
            payload_len: 50,
            replication_size_limit: 100,
        };

        // THE FINDING. The same identifier, four times, forwarded every time:
        // no duplicate suppression (there is no key to suppress on) and no
        // rate limit (there is no origin to charge), on an arm that can also
        // reach `flood: true` through `split_budget`.
        for _ in 0..4 {
            assert!(
                matches!(
                    relay_gate(&mgmt, &mut dedup, &mut rate, now),
                    RelayDecision::Forward { .. }
                ),
                "CORE-18: origin-less relay forwards unbounded — see STD-SS275"
            );
        }

        // CONTROL 1 — the dedup cache is live on this very invocation. Same
        // msg_id, an origin supplied: the second is refused. So the four
        // passes above are the missing key, not a cache that never worked.
        let with_origin = RelayInputs {
            origin: Some(id(1)),
            origin_required: true,
            ..mgmt
        };
        assert!(matches!(
            relay_gate(&with_origin, &mut dedup, &mut rate, now),
            RelayDecision::Forward { .. }
        ));
        assert_eq!(
            relay_gate(&with_origin, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::Duplicate),
            "control: the dedup cache DOES refuse when it has a key"
        );

        // CONTROL 2 — the rate limiter is live too. The limit is PER ORIGIN
        // (`RateLimiter::limit`, 5.7.2), and control 1's forward already
        // charged id(1)'s single allowance — the four forwards above charged
        // nothing at all, which is the finding. A fresh identifier from the
        // same origin is therefore refused here.
        let same_origin_again = RelayInputs {
            origin: Some(id(1)),
            origin_required: true,
            msg_id: 8,
            ..mgmt
        };
        assert_eq!(
            relay_gate(&same_origin_again, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::RateLimited),
            "control: the limiter DOES refuse when it has an origin to charge"
        );

        // CONTROL 3 — the arm is reached by origin-lessness and not by some
        // other property of these inputs: require the origin and the gate
        // drops at 8.3 instead.
        let required = RelayInputs {
            origin_required: true,
            ..mgmt
        };
        assert_eq!(
            relay_gate(&required, &mut dedup, &mut rate, now),
            RelayDecision::Drop(DropReason::MissingOrigin),
            "control: only (None, false) reaches the unbounded path"
        );
    }

    #[test]
    fn never_relay_back_except_to_destination() {
        // 5.8.2.
        let from = id(1);
        assert!(!may_relay_to(from, Some(from), false));
        assert!(may_relay_to(from, Some(from), true)); // received-from IS destination
        assert!(may_relay_to(id(2), Some(from), false));
        assert!(may_relay_to(id(2), None, false));
    }

    /// ‼ **7.5.1: A HIVE FORWARDING A RETAINED FRAME SHALL NOT RE-APPLY
    /// THE DUPLICATE SUPPRESSION OF 5.3 TO IT** (`L3-058b`, which recorded
    /// this as structural and untested).
    ///
    /// **The mechanism is that the two structures never meet**: custody
    /// holds bytes and a destination, the cache holds `(origin, msg_id)`,
    /// and `peek_for_retry` has no `DedupCache` to touch. *Note 1's reason is
    /// that the frame was recorded as seen when it FIRST arrived — so
    /// re-gating a release would suppress the hive's own retained frame
    /// with the entry its own arrival created.*
    ///
    /// This asserts the observable consequence rather than the absence of
    /// a call: the cache is **unchanged across a retain and a release**,
    /// and the entry made at first arrival is **still live afterwards**,
    /// so nothing consumed or refreshed it.
    #[test]
    fn releasing_a_retained_frame_never_touches_the_dedup_cache() {
        let dest = id(9);
        let mut dedup: DedupCache<8> = DedupCache::new(60);
        // First arrival: the frame is recorded as seen (5.3).
        assert!(!dedup.seen_or_insert(dest, 7, Ticks(0)));
        let live_before = dedup.live_entries(Ticks(1));
        assert_eq!(live_before, 1);

        let mut c: CustodyBuffer<2, 32> = CustodyBuffer::new();
        c.retain(
            Ticks(0),
            Some(dest),
            Target::Compact(0),
            b"retained",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        let mut out = [0u8; 32];
        assert!(
            matches!(c.peek_for_retry(Some(dest), Ticks(1), &mut out), Peeked::Held(h) if h.len() == b"retained".len())
        );

        // Unchanged: nothing was inserted, evicted or refreshed.
        assert_eq!(dedup.live_entries(Ticks(1)), live_before);
        // ‼ AND THE ENTRY IS STILL SUPPRESSING, which is the half that
        // matters: a release that had re-gated would have consumed it.
        assert!(dedup.seen_or_insert(dest, 7, Ticks(1)));
    }

    /// **When the hop floor and the spent budget arrive together, the drop
    /// wins** — and neither existing test covers the crossing, because each
    /// exercises one condition with the other at a passing value.
    ///
    /// ‼ **THE ORDER IS NOT A PREFERENCE.** 5.8.1a drops at hop zero;
    /// 7.4.2 discards a *retained* frame whose hop limit has expired. So
    /// retaining first would buy a slot in a bounded buffer for a frame
    /// whose only future is to be discarded from it — **spending custody a
    /// genuinely sleeping destination needed**, which is 7.1.3 Note 2's
    /// reasoning arriving one clause over. *Waiting only helps when time is
    /// what is missing, and a spent hop limit is not time.*
    #[test]
    fn a_frame_at_the_hop_floor_is_dropped_and_never_retained() {
        let mut dedup: DedupCache<8> = DedupCache::new(1000);
        let mut rate: RateLimiter<8> = RateLimiter::new(10, 1000);
        let base = RelayInputs {
            relaying_ceased: false,
            hop_limit: 5,
            budget: 1,
            origin: Some(id(1)),
            origin_required: true,
            msg_id: 1,
            payload_len: 10,
            replication_size_limit: 100,
        };
        // Precondition, so the assertion below is about the CROSSING and
        // not about a budget that was never spent.
        assert_eq!(
            relay_gate(&base, &mut dedup, &mut rate, Ticks(0)),
            RelayDecision::Retain,
            "precondition: budget 1 alone retains (5.5.3)"
        );

        let both = RelayInputs {
            hop_limit: 1,
            msg_id: 2,
            ..base
        };
        assert_eq!(
            relay_gate(&both, &mut dedup, &mut rate, Ticks(0)),
            RelayDecision::Drop(DropReason::HopExhausted),
            "5.8.1a before 5.5.3: a frame with no hop left is not worth custody"
        );

        // ‼ AND THE GATE DID NOT DECREMENT EITHER OF THEM (5.2.1 binds the
        // decrement to relaying). The retained frame still carries the hop
        // limit it arrived with, so its later direct release spends the
        // FIRST decrement — `hive`'s double-count cannot arise here.
        assert_eq!(base.hop_limit, 5);
        assert_eq!(both.hop_limit, 1);
        assert_eq!(base.budget, 1, "5.5.3: retention does not halve");
    }

    /// ‼ **7.4.2 RUNS BEFORE 7.4.1, AND THE ORDER DECIDES WHICH FRAME IS
    /// LOST** (r2-codex-refute, 2026-08-25).
    ///
    /// `retain` chose its eviction victim by arrival stamp alone, and
    /// expiry was purged only on the retry path — so at capacity **a frame
    /// with most of its lifetime left was discarded to make room while an
    /// already-expired one kept its slot**, purely because the live one
    /// happened to be older. *7.4.2 says the expired frame should already
    /// have been gone*, and 7.4.1's oldest-first is a rule about what is
    /// still retained.
    #[test]
    fn an_expired_frame_is_discarded_before_a_live_one_is_evicted() {
        let mut c: CustodyBuffer<2, 32> = CustodyBuffer::new();
        let live = id(1);
        let stale = id(2);
        // A: oldest, and alive until 100.
        c.retain(
            Ticks(0),
            Some(live),
            Target::Compact(0),
            b"alive-and-oldest",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        // B: newer, and already expired at the moment C arrives.
        c.retain(
            Ticks(0),
            Some(stale),
            Target::Compact(0),
            b"expired",
            Ticks(10),
            &carries_anything(),
        )
        .unwrap();
        assert_eq!(c.len(), 2, "precondition: at the bound");

        // C arrives at 20, by which time B has expired.
        c.retain(
            Ticks(20),
            Some(id(3)),
            Target::Compact(0),
            b"arriving",
            Ticks(200),
            &carries_anything(),
        )
        .unwrap();

        let mut out = [0u8; 32];
        assert!(
            matches!(
                c.peek_for_retry(Some(live), Ticks(21), &mut out),
                Peeked::Held(_)
            ),
            "7.4.1 discards the oldest RETAINED frame, and an expired one is \
             not retained — A must survive"
        );
        assert!(
            matches!(
                c.peek_for_retry(Some(stale), Ticks(21), &mut out),
                Peeked::NothingHeld
            ),
            "7.4.2: B was expired and is gone"
        );
        assert!(
            matches!(
                c.peek_for_retry(Some(id(3)), Ticks(21), &mut out),
                Peeked::Held(_)
            ),
            "and C was admitted"
        );
    }

    /// ‼ **A LOOK DOES NOT REORDER THE QUEUE, WHICH A PUT-BACK DID**
    /// (r2-codex-refute, 2026-08-25).
    ///
    /// The old shape took the frame out and offered `hold_again` to return
    /// it — but the answer it returned did not carry the arrival stamp, so
    /// the put-back was written as `seq: 0`. **A frame that failed to send
    /// therefore became the oldest in the buffer**: retried first forever,
    /// and discarded first at capacity. *The genuinely oldest frame starved,
    /// which is 7.4.1 inverted by the code that claimed to preserve it.*
    ///
    /// Nothing is removed now, so there is nothing to restore and no stamp
    /// to get wrong. This asserts the observable consequence: **repeated
    /// unsuccessful attempts leave the order exactly as it was.**
    #[test]
    fn repeated_unsuccessful_attempts_do_not_reorder_custody() {
        let mut c: CustodyBuffer<4, 32> = CustodyBuffer::new();
        for (i, body) in [b"older-a".as_slice(), b"newer-b".as_slice()]
            .into_iter()
            .enumerate()
        {
            c.retain(
                Ticks(0),
                Some(id(u8::try_from(i).expect("small") + 1)),
                Target::Compact(0),
                body,
                Ticks(100),
                &carries_anything(),
            )
            .unwrap();
        }
        let mut out = [0u8; 32];
        // Three looks with no acceptance between them. The oldest is offered
        // every time, and both frames are still held.
        for attempt in 0..3 {
            let Peeked::Held(h) = c.peek_for_retry(None, Ticks(1), &mut out) else {
                panic!("attempt {attempt}: a frame is held")
            };
            assert_eq!(
                h.frame(),
                b"older-a",
                "attempt {attempt}: 7.4.1's oldest, unchanged by the last refusal"
            );
            assert_eq!(c.len(), 2, "attempt {attempt}: nothing was consumed");
        }
        // And an acceptance still removes exactly that one, leaving the newer.
        let Peeked::Held(h) = c.peek_for_retry(None, Ticks(1), &mut out) else {
            panic!("held")
        };
        assert!(c.discard(h));
        let Peeked::Held(h) = c.peek_for_retry(None, Ticks(1), &mut out) else {
            panic!("held")
        };
        assert_eq!(h.frame(), b"newer-b");
    }

    #[test]
    fn custody_oldest_first_and_expiry() {
        let mut c: CustodyBuffer<2, 32> = CustodyBuffer::new();
        let d = id(9);
        c.retain(
            Ticks(0),
            Some(d),
            Target::Compact(0),
            b"frame-one",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        c.retain(
            Ticks(0),
            Some(d),
            Target::Compact(0),
            b"frame-two",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        // 7.4.1: at the bound the oldest is discarded first.
        c.retain(
            Ticks(0),
            Some(d),
            Target::Compact(0),
            b"frame-three",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        assert_eq!(c.len(), 2);
        let mut out = [0u8; 32];
        let Peeked::Held(h) = c.peek_for_retry(Some(d), Ticks(0), &mut out) else {
            panic!("a frame was held")
        };
        assert_eq!(h.frame(), b"frame-two"); // frame-one was evicted
                                             // ‼ AND IT IS STILL HELD, which is the half a take could not show:
                                             // looking at a frame is not spending it.
        assert_eq!(c.len(), 2, "a look removes nothing");
        assert!(c.discard(h), "and the acceptance is what removes it");
        assert_eq!(c.len(), 1);

        // 7.4.2: expired frames are discarded, not released.
        c.retain(
            Ticks(0),
            Some(d),
            Target::Compact(0),
            b"stale",
            Ticks(10),
            &carries_anything(),
        )
        .unwrap();
        c.purge_expired(Ticks(10));
        let Peeked::Held(h) = c.peek_for_retry(Some(d), Ticks(0), &mut out) else {
            panic!("frame-three survives")
        };
        assert_eq!(h.len(), b"frame-three".len());
        assert!(c.discard(h));
        assert!(c.is_empty());

        // Oversize is refused outright (7.1.3 is the caller's drop; the
        // buffer never truncates).
        assert_eq!(
            c.retain(
                Ticks(0),
                Some(d),
                Target::Compact(0),
                &[0u8; 33],
                Ticks(100),
                &carries_anything()
            ),
            Err(CustodyRefusal::Oversize)
        );
    }

    /// ‼ **THE SHORT BUFFER: A PANIC PATH UNTIL 2026-08-15, AND THE SUITE
    /// COULD NOT HAVE SEEN IT.** `hive` measured the denominator that makes
    /// that a fact rather than an excuse: **six release-door call sites, all
    /// six passing a buffer large enough**, so a green run was evidence
    /// about nothing. *A test population that never varies an input is not
    /// covering it.*
    ///
    /// Three assertions, and the second is the one that matters: the
    /// refusal **names the length needed** so a caller can act, and the
    /// frame is **still there afterwards** — the old code took the entry
    /// before copying, so the panic destroyed the retained copy on its way
    /// out. *On a board a panic is the hive down; even a caught one lost
    /// the frame 5.5.3 Note 1 exists to keep.*
    /// ‼ **THE ESP-NOW → LoRa STEP IS 7.1.3's WORKED EXAMPLE, IN THE
    /// REGISTRY'S OWN NUMBERS** — and it has never happened on hardware
    /// because every capture this fleet holds is single-bearer ESP-NOW
    /// (`d610`, 77 of 77).
    ///
    /// 7.1.3 Note 2 describes exactly this: *a frame that arrived on a
    /// large-payload bearer at a hive whose only onward bearer is small is
    /// **structurally undeliverable by this hive** — no returning path
    /// changes what its radios can carry.* **L1 8.2.1 makes those two
    /// numbers 250 and 222**, so the case is not hypothetical, it is
    /// arithmetic.
    ///
    /// ‼ **AND IT IS THE DEPLOYMENT THAT WAS JUST PARKED WAITING FOR
    /// BOXES**: a repeater at distance is exactly the hive that holds both
    /// radios, and LoRa is the radio for that geometry. *A one-bearer bench
    /// cannot produce this refusal at all* — the frame that arrives always
    /// fits the bearer it arrived on.
    ///
    /// ‼ **AND A REGISTRY ROW IS NOT AN IMPLEMENTABLE BEARER — CORRECTING
    /// WHAT THIS LANE SAID ON 2026-08-17.** The commit that added this test
    /// said *core already carries LoRa in full*. **It does not.** It
    /// carries L1 8.2.1's **registry entry**: an ordinal, a reach, a
    /// payload, a cost, a tier. *Five declared values.*
    ///
    /// **What makes an ordinal implementable is a Layer 1 BINDING, and for
    /// LoRa there is none.** Measured 2026-08-17: `r2-standard/standard/`
    /// holds exactly one — `L1-BINDING-ESPNOW.md`, 562 lines covering
    /// **b) framing, c) the discovery marker, d) medium address → canonical
    /// hive identifier, e) the MTU payload, f) the quality derivation,
    /// g) the conditions producing each state, h) duty cycle and airtime
    /// budget, i) establishment, j) the build-mode declaration.** For LoRa,
    /// **none of a)–j) exists.**
    ///
    /// ‼ **AND L0 HAS NO BEARER CODE FOR *ANY* RADIO, WHICH IS THE PART
    /// THAT SURPRISES.** `r2-hal-traits` contains **zero** occurrences of
    /// `lora` — *and zero of `espnow`/`wifi` too*. Its whole bearer
    /// surface is one field, `PlatformDeclaration::transports: u8`, a
    /// bearer-ordinal **bit set** (P3): it declares WHICH bindings a
    /// platform provides and knows nothing about what any of them are.
    /// **So "no LoRa code at L0" is true and is not a LoRa fact** — it is
    /// the architecture, and stating it as a LoRa gap would send somebody
    /// to write a driver in the wrong crate.
    ///
    /// **The asymmetry between the two radios is therefore in the CORPUS,
    /// not in this tree**: ESP-NOW has a binding and LoRa has a registry
    /// row. *That is what makes one real and the other a table entry*, and
    /// it makes the LoRa question `standard`'s before it is anybody's to
    /// implement. **Several core-side hooks would have nothing to feed
    /// them**: `LinkQuality` wants f), `SenderIdentity::Canonical` wants
    /// d), and `BearerState::Restricted`'s exhausted-airtime case wants h).
    ///
    /// The numbers are taken from [`Ordinal::largest_payload`] rather than
    /// written as literals, so **this test follows the registry**: if the
    /// corpus revises either value, this either keeps testing the real gap
    /// or stops compiling — it cannot silently keep asserting a gap that
    /// has closed.
    #[test]
    fn an_espnow_sized_frame_cannot_be_taken_into_custody_for_a_lora_only_hop() {
        let espnow = Ordinal::WifiMesh.largest_payload() as usize;
        let lora = Ordinal::Lora.largest_payload() as usize;
        assert!(espnow > lora, "precondition: L1 8.2.1 still has 250 > 222");

        let lora_only = [BearerCandidate {
            ordinal: Ordinal::Lora,
            state: r2_transport::l1::BearerState::Available,
            disabled: false,
            carries_peer: true,
            max_payload: lora as u16,
            confidence: 0.9,
            freshness: 1.0,
            cost: Ordinal::Lora.relative_cost(),
            relative_speed: 1,
        }];

        let mut c: CustodyBuffer<2, 256> = CustodyBuffer::new();
        let full = [0u8; 250];
        assert_eq!(
            c.retain(Ticks(0), Some(id(1)), Target::Compact(0), &full[..espnow], Ticks(100), &lora_only),
            Err(CustodyRefusal::StructurallyUndeliverable),
            "7.1.3: no bearer in service could ever carry it — dropped at once,              with a reason distinct from every transient one"
        );
        assert!(
            c.is_empty(),
            "and it is NOT held: waiting cannot fix a size"
        );

        // ‼ CONTROL, AND IT IS THE HALF THAT MAKES THIS ABOUT THE PAIR
        // RATHER THAN ABOUT LoRa: a frame that FITS LoRa is retained on the
        // same bearer set. The refusal is arithmetic, not a prejudice
        // against the slow radio.
        assert!(c
            .retain(
                Ticks(0),
                Some(id(1)),
                Target::Compact(0),
                &full[..lora],
                Ticks(100),
                &lora_only
            )
            .is_ok());
        assert_eq!(c.len(), 1);

        // ‼ AND THE SAME OVERSIZE FRAME IS FINE WHERE ESP-NOW IS IN
        // SERVICE — so the refusal tracks the BEARERS IN SERVICE at that
        // moment, which is what 7.1.3's *in service* means and why a list
        // cached from boot would answer a different question.
        let both = [
            lora_only[0],
            BearerCandidate {
                ordinal: Ordinal::WifiMesh,
                max_payload: espnow as u16,
                cost: Ordinal::WifiMesh.relative_cost(),
                relative_speed: 1,
                ..lora_only[0]
            },
        ];
        assert!(c
            .retain(
                Ticks(0),
                Some(id(2)),
                Target::Compact(0),
                &full[..espnow],
                Ticks(100),
                &both
            )
            .is_ok());

        // And selection agrees with custody: with both in service the
        // oversize frame can only go one way.
        assert_eq!(best_ordinal(&both, espnow), Some(Ordinal::WifiMesh));
        assert_eq!(best_ordinal(&lora_only, espnow), None);
    }

    #[test]
    fn a_short_buffer_is_refused_by_name_and_the_frame_survives_the_refusal() {
        let mut c: CustodyBuffer<2, 32> = CustodyBuffer::new();
        let d = id(4);
        c.retain(
            Ticks(0),
            Some(d),
            Target::Compact(0),
            b"nine-byte",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();

        let mut too_small = [0u8; 8];
        assert!(
            matches!(
                c.peek_for_retry(Some(d), Ticks(0), &mut too_small),
                Peeked::BufferTooSmall { needed: 9 }
            ),
            "the refusal names the length, so the caller can size and retry"
        );
        // ‼ STILL HELD. The check is before the copy.
        assert_eq!(c.len(), 1, "a refused release does not consume the frame");
        // And nothing was written — no prefix, no partial frame.
        assert_eq!(too_small, [0u8; 8], "refuses rather than truncates");

        // CONTROL: the same frame, an adequate buffer, releases whole — so
        // the refusal above is about the LENGTH and not about this frame
        // being unreleasable.
        let mut big = [0u8; 32];
        let Peeked::Held(h) = c.peek_for_retry(Some(d), Ticks(0), &mut big) else {
            panic!("an adequate buffer releases it")
        };
        assert_eq!(h.len(), 9);
        assert_eq!(h.frame(), b"nine-byte");
        assert!(c.discard(h));
        assert!(c.is_empty());

        // ‼ AND THE THIRD STATE IS DISTINGUISHABLE FROM THE FIRST TWO:
        // an empty buffer is `NothingHeld`, never `BufferTooSmall`, and a
        // short buffer over an empty store is still `NothingHeld` — the
        // network fact outranks the caller fact when there is nothing to
        // release at all.
        assert!(matches!(
            c.peek_for_retry(Some(d), Ticks(0), &mut too_small),
            Peeked::NothingHeld
        ));
    }

    #[test]
    fn custody_bytes_kept_verbatim_per_destination() {
        let mut c: CustodyBuffer<4, 16> = CustodyBuffer::new();
        c.retain(
            Ticks(0),
            Some(id(1)),
            Target::Compact(0),
            b"for-one",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        c.retain(
            Ticks(0),
            Some(id(2)),
            Target::Compact(0),
            b"for-two",
            Ticks(100),
            &carries_anything(),
        )
        .unwrap();
        let mut out = [0u8; 16];
        // Only the destination's frames release (7.1.2 keys on destination).
        assert!(matches!(
            c.peek_for_retry(Some(id(3)), Ticks(0), &mut out),
            Peeked::NothingHeld
        ));
        let Peeked::Held(h) = c.peek_for_retry(Some(id(2)), Ticks(0), &mut out) else {
            panic!("held for id(2)")
        };
        assert_eq!(h.frame(), b"for-two"); // 7.5.2: verbatim
        assert!(c.discard(h));
        assert_eq!(c.len(), 1);
    }

    #[test]
    fn budget_split_per_5_5() {
        assert_eq!(split_budget(15), BudgetDecision::Flood);
        assert_eq!(
            split_budget(6),
            BudgetDecision::Forward {
                forward: 3,
                retain: 3
            }
        );
        assert_eq!(
            split_budget(5),
            BudgetDecision::Forward {
                forward: 2,
                retain: 3
            }
        );
        assert_eq!(
            split_budget(2),
            BudgetDecision::Forward {
                forward: 1,
                retain: 1
            }
        );
        // 5.5.3/5.5.4: half-rounded-down zero never rounds up.
        assert_eq!(split_budget(1), BudgetDecision::RetainOnly);
        assert_eq!(split_budget(0), BudgetDecision::RetainOnly);
        // 14 is the largest bounded value (15 is the flood sentinel).
        assert_eq!(
            split_budget(14),
            BudgetDecision::Forward {
                forward: 7,
                retain: 7
            }
        );
    }

    /// **L3 4.5.1/4.5.2 and 6.2.2 with their epoch rule.** The curve is this
    /// crate's; what is asserted is the per-binding shape the clauses require
    /// and the one case that must NOT produce a number.
    #[test]
    fn freshness_decays_per_bearer_and_refuses_across_epochs() {
        let heard = Ticks(1_000);
        // Heard just now.
        assert_eq!(freshness(heard, Ticks(1_000), 30, 100), Some(1.0));
        // Half a 30 s fade at 100 ticks/s is 1500 ticks.
        let half = freshness(heard, Ticks(1_000 + 1_500), 30, 100).unwrap();
        assert!((half - 0.5).abs() < 1e-6, "{half}");
        // Monotone: later is never fresher.
        let later = freshness(heard, Ticks(1_000 + 2_000), 30, 100).unwrap();
        assert!(later < half);
        // At and beyond the fade, nothing.
        assert_eq!(freshness(heard, Ticks(1_000 + 3_000), 30, 100), Some(0.0));
        assert_eq!(freshness(heard, Ticks(1_000 + 9_999), 30, 100), Some(0.0));
        // ‼ EXCLUDED CASE: `now` before `last_heard` is not stale, it is
        // NOT COMPARABLE (L0 5.2). A zero here would be a plausible number
        // computed across a power cycle.
        assert_eq!(freshness(Ticks(1_000), Ticks(999), 30, 100), None);
        // A bearer whose fade is zero is fresh only at the instant heard.
        assert_eq!(freshness(heard, Ticks(1_000), 0, 100), Some(1.0));
        assert_eq!(freshness(heard, Ticks(1_001), 0, 100), Some(0.0));

        // L3 4.5.2: the same observation cannot be aged by one common
        // period. At this instant the short-fade binding is gone while the
        // long-fade binding is still a usable local estimate.
        let same_observation = Ticks(1_000);
        assert_eq!(
            freshness(same_observation, Ticks(3_000), 10, 100),
            Some(0.0),
            "the short-fade binding has expired"
        );
        assert!(
            freshness(same_observation, Ticks(3_000), 60, 100).is_some_and(|fresh| fresh > 0.0),
            "the long-fade sibling must not inherit the short binding's fade"
        );
    }

    /// **The two bearers of 6.2.2 Note 1, which is why the figure is per
    /// bearer**: the same peer, heard recently on one and long ago on the
    /// other, must not average to one number.
    #[test]
    fn one_peer_two_bearers_two_freshnesses() {
        let now = Ticks(100_000);
        let recent = freshness(Ticks(99_000), now, 30, 100).unwrap();
        let old = freshness(Ticks(10_000), now, 30, 100).unwrap();
        assert!(recent > old);
        assert_eq!(old, 0.0);
        // And selection acts on the difference rather than on an average.
        let cands = [
            BearerCandidate {
                ordinal: Ordinal::Ble,
                state: r2_transport::l1::BearerState::Available,
                disabled: false,
                max_payload: 200,
                carries_peer: true,
                confidence: 0.9,
                freshness: recent,
                cost: 1,
                relative_speed: 1,
            },
            BearerCandidate {
                ordinal: Ordinal::WifiMesh,
                state: r2_transport::l1::BearerState::Available,
                disabled: false,
                max_payload: 200,
                carries_peer: true,
                confidence: 0.9,
                freshness: old,
                cost: 1,
                relative_speed: 1,
            },
        ];
        assert_eq!(best_ordinal(&cands, 100), Some(Ordinal::Ble));
    }

    /// **5.6.1 needs an enumeration or it cannot be satisfied**, and
    /// 5.6.3 needs it filtered per bearer.
    #[test]
    fn every_viable_neighbour_is_enumerable_per_bearer() {
        let mut t: NeighbourTable<4> = NeighbourTable::new(RoutingConfig::new(0.2, 0.5).unwrap());
        let a = HiveId([1; 8]);
        let b = HiveId([2; 8]);
        let c = HiveId([3; 8]);
        assert!(t.observe(
            ObservedSender::asserted_by_caller(a),
            binding(Ordinal::Ble),
            LinkQuality::new(0.8),
            Ticks(10)
        ));
        assert!(t.observe(
            ObservedSender::asserted_by_caller(b),
            binding(Ordinal::WifiMesh),
            LinkQuality::new(0.8),
            Ticks(20)
        ));
        assert!(t.observe(
            ObservedSender::asserted_by_caller(c),
            binding(Ordinal::Ble),
            LinkQuality::new(0.3),
            Ticks(30)
        ));

        // Every entry is reachable by enumeration.
        let all = t.link_axis().count();
        assert_eq!(all, 3);

        // 5.6.3's first half: heard on THIS bearer, not merely known of.
        let ble = t.heard_on(binding(Ordinal::Ble)).count();
        assert_eq!(ble, 2);
        assert!(t.heard_on(binding(Ordinal::Ble)).all(|v| v.id != b));
        assert_eq!(t.heard_on(binding(Ordinal::WifiMesh)).count(), 1);
        // A bearer nobody was heard on yields nothing — an empty flood set
        // rather than a full one (5.6.3 Note 1).
        assert_eq!(t.heard_on(binding(Ordinal::Lora)).count(), 0);

        // The per-entry bearer record a caller applies 5.6.3 with.
        let v = t.link_axis().find(|v| v.id == a).unwrap();
        assert_eq!(
            v.heard_on(binding(Ordinal::Ble)).unwrap().last_heard,
            Ticks(10)
        );
        assert!(v.heard_on(binding(Ordinal::WifiMesh)).is_none());
        assert_eq!(v.links().count(), 1);
    }

    /// **5.6.3 completed by the bearer, and 5.6.2 carried rather than
    /// dropped.** The three answers behave differently and the closure is
    /// asked only about candidates.
    #[test]
    fn viability_needs_the_bearers_answer_and_records_which_kind() {
        let mut t: NeighbourTable<4> = NeighbourTable::new(RoutingConfig::new(0.2, 0.5).unwrap());
        let yes = HiveId([1; 8]);
        let no = HiveId([2; 8]);
        let attempt = HiveId([3; 8]);
        let elsewhere = HiveId([4; 8]);
        assert!(t.observe(
            ObservedSender::asserted_by_caller(yes),
            binding(Ordinal::Ble),
            LinkQuality::new(0.9),
            Ticks(1)
        ));
        assert!(t.observe(
            ObservedSender::asserted_by_caller(no),
            binding(Ordinal::Ble),
            LinkQuality::new(0.9),
            Ticks(1)
        ));
        assert!(t.observe(
            ObservedSender::asserted_by_caller(attempt),
            binding(Ordinal::Ble),
            LinkQuality::new(0.9),
            Ticks(1)
        ));
        // Heard, but on another bearer: 5.6.3 Note 1's peer.
        assert!(t.observe(
            ObservedSender::asserted_by_caller(elsewhere),
            binding(Ordinal::Lora),
            LinkQuality::new(0.9),
            Ticks(1)
        ));

        let mut asked: Vec<HiveId> = Vec::new();
        let viable: Vec<_> = t
            .viable_on(binding(Ordinal::Ble), |id| {
                asked.push(id);
                if id == yes {
                    Addressability::Yes
                } else if id == no {
                    Addressability::No
                } else {
                    Addressability::OnlyByAttempting
                }
            })
            .map(|v| (v.peer.id, v.confirmed))
            .collect();

        // The refused peer is absent; the unattemptable one is present and
        // NOT confirmed — 5.6.2's distinction, kept.
        assert!(viable.contains(&(yes, true)));
        assert!(viable.contains(&(attempt, false)));
        assert!(!viable.iter().any(|(id, _)| *id == no));
        assert_eq!(viable.len(), 2);

        // ‼ The closure is asked ONLY about peers heard on this bearer.
        // A peer known only on another bearer never reaches it, so an
        // answer that costs a transmission is not spent on the table.
        assert_eq!(asked.len(), 3);
        assert!(!asked.contains(&elsewhere));
    }
}
