//! Layer 2 capability and discovery: sightings and scanner semantics
//! (`r2-standard/L2-capability-and-discovery.md`, semantics ruled at
//! standard D-019).
//!
//! A beacon is presence plus its carried declarations, nothing more (4.4.2,
//! D-019): the capability summary is a reason to ask, never an answer
//! (8.3), and the ask path is authoritative. Beacon *layout* is each
//! binding document's; this module holds the medium-independent record and
//! filter semantics. L2 selects no bearer for any purpose (9.3).

use r2_hal_traits::Ticks;
use r2_transport::l1::{BindingInstance, ObservationLifetime};

/// Build mode read from a beacon (3.7, 5.4a).
///
/// **Re-exported, not redefined.** The same fact is asserted by the L2
/// beacon, by the L5 admission decision and by whatever a human sees, and
/// if two surfaces disagree the device is lying in one of them with no way
/// to tell which. So the type lives in `r2-hal-traits`, which every layer
/// already depends on, and no layer mints its own — see that module for
/// why this is the opposite of the independence rule that governs checks.
///
/// Absent, truncated or unreachable reads as `Unknown` — never as
/// production, never as secure (5.4a.4).
pub use r2_hal_traits::build_mode::BuildMode;

/// Duty class read from a beacon (5.4b). Absent or truncated reads as
/// `Unknown` — a claim of neither class (5.4b.4).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum DutyClass {
    /// Intermittently receptive, with the declared longest interval
    /// between receptive windows, coarse, in seconds (5.4b.1).
    Intermittent {
        longest_interval_s: u32,
    },
    Continuous,
    #[default]
    Unknown,
}

/// Beacon identifier: opaque, stable, independent of every other
/// identifier (5.4.1/5.4.2). Wire width is the binding document's; this is
/// a storage capacity, not a format claim.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BeaconId {
    bytes: [u8; 16],
    len: u8,
}

impl BeaconId {
    /// `None` where the identifier exceeds this implementation's capacity.
    pub fn new(id: &[u8]) -> Option<Self> {
        (!id.is_empty() && id.len() <= 16).then(|| {
            let mut bytes = [0u8; 16];
            bytes[..id.len()].copy_from_slice(id);
            Self {
                bytes,
                len: id.len() as u8,
            }
        })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }
}

/// The declarations a beacon carried (Clause 5, D-019: declarations plus
/// optional summary, nothing else).
#[derive(Clone, Copy, Debug)]
pub struct BeaconDeclarations {
    /// Class hash, computed from the class exactly as written (5.5.1) —
    /// byte-exact, NOT the L4 7.1.2 name normalisation.
    pub class_hash: u32,
    /// Whether a capability summary was carried (8.4: absent where the
    /// hive publishes no public capability). Its contents are consumed at
    /// reception as a reason-to-ask (8.3); only presence is recorded.
    pub summary_carried: bool,
    pub build_mode: BuildMode,
    pub duty_class: DutyClass,
}

/// What a sighting may retain from the received beacon.
///
/// An associated peer's later beacon is still a real per-bearer presence
/// observation, but L2 7.3.2 forbids treating it as new class or capability
/// information. It does not freeze build mode or duty class: 5.4b.3 still
/// requires a read intermittent duty class and interval to be recorded.
#[derive(Clone, Copy, Debug)]
pub enum SightingDeclarations {
    /// A discovery beacon whose declarations may feed steps 2–4.
    Announced(BeaconDeclarations),
    /// A beacon from a peer associated above the trust boundary. Its current
    /// build mode and duty class are retained, while class/capability retain
    /// only what this scanner had already consumed, if anything.
    PresenceOnly {
        /// The earlier discovery class hash, never the later beacon's hash.
        held_class_hash: Option<u32>,
        /// The earlier capability-summary flag, never the later beacon's.
        held_summary_carried: Option<bool>,
        /// Read from this beacon; 7.3.2 does not exclude build mode.
        build_mode: BuildMode,
        /// Read from this beacon; 5.4b.3 requires it.
        duty_class: DutyClass,
    },
}

impl SightingDeclarations {
    /// Class hash previously consumed for this peer, if any.
    ///
    /// For [`Self::PresenceOnly`] this is historical information, not an
    /// input from the latest beacon. Use [`Self::discovery_class_hash`] when
    /// deciding whether this particular beacon is a discovery candidate.
    pub const fn class_hash(self) -> Option<u32> {
        match self {
            Self::Announced(decl) => Some(decl.class_hash),
            Self::PresenceOnly {
                held_class_hash, ..
            } => held_class_hash,
        }
    }

    /// Class hash that this particular beacon may contribute to discovery.
    /// A held value remains visible upward as prior information about the
    /// peer, but L2 7.3.2 bars using a later associated-peer beacon to screen
    /// discovery again.
    pub const fn discovery_class_hash(self) -> Option<u32> {
        match self {
            Self::Announced(decl) => Some(decl.class_hash),
            Self::PresenceOnly { .. } => None,
        }
    }

    /// Whether a capability summary had previously been consumed for this
    /// peer. `None` means no such discovery declaration was retained.
    pub const fn summary_carried(self) -> Option<bool> {
        match self {
            Self::Announced(decl) => Some(decl.summary_carried),
            Self::PresenceOnly {
                held_summary_carried,
                ..
            } => held_summary_carried,
        }
    }

    /// Build mode currently read from this beacon.
    pub const fn build_mode(self) -> BuildMode {
        match self {
            Self::Announced(decl) => decl.build_mode,
            Self::PresenceOnly { build_mode, .. } => build_mode,
        }
    }

    /// Duty class currently read from this beacon.
    pub const fn duty_class(self) -> DutyClass {
        match self {
            Self::Announced(decl) => decl.duty_class,
            Self::PresenceOnly { duty_class, .. } => duty_class,
        }
    }
}

/// One sighting: one (peer, binding-instance) pair, never merged across
/// concrete bindings (9.2).
#[derive(Clone, Copy, Debug)]
pub struct Sighting {
    pub beacon_id: BeaconId,
    pub binding: BindingInstance,
    /// Most recent sighting on this concrete binding, monotonic (9.1c).
    pub last_heard: Ticks,
    /// The declarations this scanner actually consumed. A known peer's later
    /// beacon carries [`SightingDeclarations::PresenceOnly`], so no caller can
    /// accidentally read its class hash or capability flag as fresh data.
    pub declarations: SightingDeclarations,
}

impl Sighting {
    /// Has this sighting expired under its L1-declared lifetime?
    ///
    /// A [`ObservationLifetime::PeerFade`] means its peer receded on this
    /// bearer under L2 6.3.1. A [`ObservationLifetime::PassiveRetention`]
    /// means only that the local passive observation has expired; it makes no
    /// liveness or reachability claim about the peer. Keeping the choice typed
    /// prevents a caller from reducing passive retention to a peer-fade
    /// number at this boundary.
    ///
    /// A peer fade is the bearer's own declared B5 value, which 6.3.1
    /// requires to exceed the longest interval that bearer's beacons
    /// 6.3.1 requires to exceed the longest interval that bearer's beacons
    /// can be expected at — and 6.3.2 requires to exceed the longest interval
    /// the airtime budget can produce **under load** on a regulated bearer.
    /// *Neither of those is checked here, because both are properties of the
    /// declared value rather than of this comparison* — this applies whatever
    /// the bearer declared, and a bearer declaring too short a fade recedes
    /// its peers too early, visibly.
    ///
    /// ‼ **A CLOCK THAT WENT BACKWARDS IS NOT A RECEDED PEER**, and that is
    /// [`Ticks::exceeded`]'s rule rather than this one's — the arithmetic is
    /// shared with L1 10.2 and L3 7.4.2 precisely so the three cannot answer
    /// differently.
    pub fn has_expired(
        &self,
        now: Ticks,
        lifetime: ObservationLifetime,
        ticks_per_second: u32,
    ) -> bool {
        now.exceeded(self.last_heard, lifetime.seconds(), ticks_per_second)
    }
}

/// Bounded per-(peer, bearer) sighting store (Clause 9). Capacity policy
/// under many candidates is explicitly unspecified (12.2) — this
/// implementation recycles the stalest sighting.
pub struct SightingTable<const N: usize> {
    slots: [Option<Sighting>; N],
}

impl<const N: usize> Default for SightingTable<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> SightingTable<N> {
    pub const fn new() -> Self {
        Self { slots: [None; N] }
    }

    /// Record a discovery beacon heard on one concrete `binding`.
    ///
    /// A caller that knows this beacon identifier is associated above trust
    /// must use [`Self::record_presence_only`] instead. Keeping the two entry
    /// points separate makes the source of the association an explicit
    /// decision at the L2 boundary rather than an inference from beacon bytes.
    pub fn record(&mut self, s: Sighting) {
        let existing = self.slots.iter_mut().find(|slot| {
            slot.as_ref()
                .is_some_and(|e| e.beacon_id == s.beacon_id && e.binding == s.binding)
        });
        if let Some(slot) = existing {
            *slot = Some(s);
            return;
        }
        if let Some(slot) = self.slots.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(s);
            return;
        }
        if let Some(slot) = self
            .slots
            .iter_mut()
            .min_by_key(|slot| slot.as_ref().map_or(Ticks(0), |e| e.last_heard))
        {
            *slot = Some(s);
        }
    }

    /// Record a later beacon from an above-trust associated peer.
    ///
    /// Class/capability remain held while time, build mode and duty refresh.
    /// Where this is the first observation on a bearer, the sighting records
    /// no class/capability at all. This is the state the old layout could not
    /// express: storing the incoming class/capability would breach 7.3.2,
    /// while dropping the sighting would lose Clause 9 presence and breach
    /// 5.4b.3 for a read intermittent duty declaration.
    pub fn record_presence_only(
        &mut self,
        beacon_id: BeaconId,
        binding: BindingInstance,
        now: Ticks,
        incoming: BeaconDeclarations,
    ) {
        let existing = self.slots.iter_mut().find(|slot| {
            slot.as_ref()
                .is_some_and(|e| e.beacon_id == beacon_id && e.binding == binding)
        });
        if let Some(slot) = existing {
            if let Some(sighting) = slot {
                sighting.last_heard = now;
                sighting.declarations = match sighting.declarations {
                    SightingDeclarations::Announced(previous) => {
                        SightingDeclarations::PresenceOnly {
                            held_class_hash: Some(previous.class_hash),
                            held_summary_carried: Some(previous.summary_carried),
                            build_mode: incoming.build_mode,
                            duty_class: incoming.duty_class,
                        }
                    }
                    SightingDeclarations::PresenceOnly {
                        held_class_hash,
                        held_summary_carried,
                        ..
                    } => SightingDeclarations::PresenceOnly {
                        held_class_hash,
                        held_summary_carried,
                        build_mode: incoming.build_mode,
                        duty_class: incoming.duty_class,
                    },
                };
            }
            return;
        }
        self.record(Sighting {
            beacon_id,
            binding,
            last_heard: now,
            declarations: SightingDeclarations::PresenceOnly {
                held_class_hash: None,
                held_summary_carried: None,
                build_mode: incoming.build_mode,
                duty_class: incoming.duty_class,
            },
        });
    }

    /// The sighting of `id` on one specific binding — sightings are per
    /// binding instance and never merged (9.2).
    /// Drop every sighting whose typed L1 lifetime has expired. A peer fade
    /// records recession on its own bearer (6.3.1); passive retention removes
    /// only a local observation (6.3.4). An absent bearer has no current
    /// observation and is removed without being called receded.
    ///
    /// ‼ **THE FADE IS ASKED PER BEARER AND THAT IS 6.3.3 MADE STRUCTURAL** —
    /// *a hive shall not apply one bearer's fade behaviour to another
    /// bearer.* A single `fade_s` parameter would have made the breach the
    /// easy call and the compliance the careful one; a closure keyed by
    /// [`BindingInstance`] makes the per-binding answer the ordinary one.
    /// *It does not make a constant closure impossible, and nothing can —
    /// what it does is put the concrete binding in front of whoever writes
    /// it.*
    ///
    /// **Until 2026-08-18 nothing expired a sighting at all**, so a peer heard
    /// once was current for ever and 6.3.1 had no implementation. *An
    /// unexpiring sighting table does not look wrong from inside: it answers
    /// every query, and every answer is about a peer that may be long gone.*
    pub fn purge_expired(
        &mut self,
        now: Ticks,
        ticks_per_second: u32,
        lifetime_for: impl Fn(BindingInstance) -> Option<ObservationLifetime>,
    ) {
        for slot in &mut self.slots {
            if slot.as_ref().is_some_and(|s| {
                lifetime_for(s.binding)
                    .is_none_or(|lifetime| s.has_expired(now, lifetime, ticks_per_second))
            }) {
                *slot = None;
            }
        }
    }

    /// How many sightings are held — **the denominator a reader needs to tell
    /// an empty table from a silent network** (added 2026-08-26 with the
    /// receive half, `SS517`). *A table nobody can count is one whose zero
    /// says nothing*, which is the same argument that put `dests()` on the
    /// custody buffer.
    #[must_use]
    pub fn len(&self) -> usize {
        self.slots.iter().flatten().count()
    }

    /// Whether nothing has been heard announce itself yet.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Every per-binding-instance sighting currently retained by Layer 2.
    ///
    /// Clause 9 keeps one sighting per binding instance. An upward consumer may group
    /// this flat view by [`BeaconId`], but must not collapse the individual
    /// freshness observations before it has presented them.
    pub fn iter(&self) -> impl Iterator<Item = &Sighting> {
        self.slots.iter().flatten()
    }

    pub fn on_binding(&self, id: BeaconId, binding: BindingInstance) -> Option<&Sighting> {
        self.slots
            .iter()
            .flatten()
            .find(|s| s.beacon_id == id && s.binding == binding)
    }

    /// All bindings `id` has been heard on (9.1b), with per-binding recency.
    pub fn sightings_of(&self, id: BeaconId) -> impl Iterator<Item = &Sighting> {
        self.slots
            .iter()
            .flatten()
            .filter(move |s| s.beacon_id == id)
    }

    /// Match by class hash (filter step 2, 5.5.2): hash the sought class
    /// and compare — the class is never recovered from the hash, and a
    /// match is a reason for step 3, not an answer.
    pub fn matching_class(&self, class_hash: u32) -> impl Iterator<Item = &Sighting> {
        self.slots
            .iter()
            .flatten()
            .filter(move |s| s.declarations.discovery_class_hash() == Some(class_hash))
    }
}

/// The progressive filter (7.1.1): steps run in order, and a later step
/// never runs for a candidate that failed an earlier one. Steps 1-2 answer
/// from the beacon alone (7.1.2); 3-4 ask; step 5 — perform and observe —
/// is the only authoritative step.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum FilterStep {
    /// Is this Reality2? — discovery marker, pre-parse.
    Marker = 1,
    /// Is this the class I want? — class hash, beacon alone.
    ClassHash = 2,
    /// Class of the kind I want? — the class itself, by asking (7.2.1:
    /// structural matching is on the class, never the hash).
    ClassAsk = 3,
    /// What can it actually do? — capability list, by asking.
    CapabilityAsk = 4,
    /// Does it do it for me? — perform and observe.
    Perform = 5,
}

impl FilterStep {
    /// **7.1.2: steps 1 and 2 are answerable from a beacon alone.**
    ///
    /// The other three are not, and 7.1.3 (`L2-046`) makes that a
    /// requirement rather than an observation: *steps 3 and 4 shall not be
    /// required in order to complete steps 1 and 2.* **A scanner that had to
    /// ask before it could reject a candidate would have to ask everybody**,
    /// which is the cost the progressive filter exists to avoid.
    pub const fn answerable_from_beacon(self) -> bool {
        matches!(self, FilterStep::Marker | FilterStep::ClassHash)
    }

    /// Whether reaching this step requires asking the peer (steps 3 and 4).
    ///
    /// Step 5 is neither: **perform and observe is the only authoritative
    /// step**, and it is doing the thing rather than asking about it.
    pub const fn requires_asking(self) -> bool {
        matches!(self, FilterStep::ClassAsk | FilterStep::CapabilityAsk)
    }
}

/// How far the beacon-only screen got, and why it stopped.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Screened {
    /// Rejected at this step. **No later step ran** (7.1.1).
    Rejected(FilterStep),
    /// Everything answerable from the beacon passed. Going further means
    /// asking, which is [`FilterStep::ClassAsk`] onward.
    PassedBeaconSteps,
    /// This is a presence-only sighting of a peer associated above trust.
    /// It is deliberately not a discovery candidate, so steps 2–4 were not
    /// run and the incoming beacon supplied no class/capability information.
    PresenceOnly,
}

/// **Run the progressive filter as far as a beacon alone can take it
/// (7.1.1, 7.1.2).**
///
/// ‼ **A LATER STEP NEVER RUNS FOR A CANDIDATE THAT FAILED AN EARLIER ONE**,
/// which is 7.1.1 and is the whole point of the filter being progressive. The
/// return value names the step that rejected, so a caller can tell *not
/// Reality2* from *not the class I want* — **two different reasons to ignore
/// a peer, and only one of them is about the peer's class.**
///
/// Step 1 (the discovery marker) passed by construction: a [`Sighting`]
/// exists because a beacon parsed as one, and a candidate that failed the
/// marker never became a sighting. *Stated rather than assumed, because "it
/// cannot be false here" and "nobody checked it" produce the same code.*
///
/// ⚠ **7.2.1 forbids structural matching on the hash**, so this compares a
/// hash for EQUALITY and nothing else. Matching *a family of classes, a
/// supplier, a role shared across suppliers* is 7.2.1's subject and must be
/// performed on the class itself — which is step 3, by asking, because a
/// beacon does not carry the class.
pub fn screen_from_beacon(sighting: &Sighting, wanted_class_hash: u32) -> Screened {
    let Some(class_hash) = sighting.declarations.discovery_class_hash() else {
        return Screened::PresenceOnly;
    };
    // Step 2. Step 1 is above.
    if class_hash != wanted_class_hash {
        return Screened::Rejected(FilterStep::ClassHash);
    }
    Screened::PassedBeaconSteps
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2_transport::l1::{BindingId, Ordinal};

    fn bid(b: u8) -> BeaconId {
        BeaconId::new(&[b; 4]).unwrap()
    }

    fn binding(ordinal: Ordinal) -> BindingInstance {
        BindingInstance::new(BindingId(ordinal as u8), ordinal)
    }

    fn sighting(b: u8, bearer: Ordinal, t: u64, class: u32) -> Sighting {
        Sighting {
            beacon_id: bid(b),
            binding: binding(bearer),
            last_heard: Ticks(t),
            declarations: SightingDeclarations::Announced(BeaconDeclarations {
                class_hash: class,
                summary_carried: false,
                build_mode: BuildMode::Unknown,
                duty_class: DutyClass::Unknown,
            }),
        }
    }

    // ── 7.1: the progressive filter ─────────────────────────────────────

    /// **7.1.2 and `L2-046`.** Steps 1 and 2 answer from a beacon; 3 and 4
    /// ask; and 3–4 must not be needed to complete 1–2. *A scanner that had
    /// to ask before it could reject a candidate would have to ask
    /// everybody.*
    #[test]
    fn only_the_first_two_steps_are_answerable_from_a_beacon() {
        assert!(FilterStep::Marker.answerable_from_beacon());
        assert!(FilterStep::ClassHash.answerable_from_beacon());
        for step in [
            FilterStep::ClassAsk,
            FilterStep::CapabilityAsk,
            FilterStep::Perform,
        ] {
            assert!(!step.answerable_from_beacon(), "{step:?}");
        }
        // Asking is steps 3 and 4 only. **Step 5 is not asking** — perform
        // and observe is doing the thing, and it is the only authoritative
        // step.
        assert!(FilterStep::ClassAsk.requires_asking());
        assert!(FilterStep::CapabilityAsk.requires_asking());
        assert!(!FilterStep::Perform.requires_asking());
        assert!(!FilterStep::Marker.requires_asking());
    }

    /// **7.1.1: a later step never runs for a candidate that failed an
    /// earlier one**, and the rejection names WHICH step — *not Reality2* and
    /// *not the class I want* are two different reasons to ignore a peer, and
    /// only one of them is about its class.
    #[test]
    fn a_class_hash_mismatch_is_rejected_at_step_two_and_named() {
        let s = sighting(1, Ordinal::WifiMesh, 10, 0xAAAA_AAAA);
        assert_eq!(
            screen_from_beacon(&s, 0xBBBB_BBBB),
            Screened::Rejected(FilterStep::ClassHash)
        );
        // The control: the matching case passes the beacon steps, so the
        // screen is not simply rejecting everything.
        assert_eq!(
            screen_from_beacon(&s, 0xAAAA_AAAA),
            Screened::PassedBeaconSteps
        );
    }

    /// ⚠ **7.2.1 FORBIDS STRUCTURAL MATCHING ON THE HASH.** The screen
    /// compares for EQUALITY and nothing else — matching *a family of
    /// classes, a supplier, a role shared across suppliers* is performed on
    /// the class itself, at step 3, by asking. **A beacon does not carry the
    /// class**, so there is nothing here a structural match could be
    /// attempted against, and this test records that the type makes it
    /// impossible rather than merely discouraged.
    #[test]
    fn the_screen_compares_a_hash_for_equality_and_has_no_class_to_match_on() {
        let s = sighting(1, Ordinal::WifiMesh, 10, 0xAAAA_AAAA);
        // Two hashes that share every structural feature a naive matcher
        // might use — a prefix, a suffix — are still two different classes.
        assert_eq!(
            screen_from_beacon(&s, 0xAAAA_AAAB),
            Screened::Rejected(FilterStep::ClassHash)
        );
        // And a `Sighting` carries no class string at all, so step 3 cannot
        // be attempted from one. The declarations are the whole of what a
        // beacon said.
        let SightingDeclarations::Announced(BeaconDeclarations {
            class_hash: _,
            summary_carried: _,
            build_mode: _,
            duty_class: _,
        }) = s.declarations
        else {
            panic!("fixture sighting is a discovery sighting");
        };

        // ‼ 7.1.3: STEPS 3 AND 4 ARE NOT REQUIRED TO COMPLETE STEPS 1 AND 2 (L2-046,
        //   added 2026-09-04 after an adversarial pass). Everything above is 7.2.1's
        //   equality property, which is the NEIGHBOURING row's clause and reddens under
        //   the same mutations — nothing here separated the two, and inverting the
        //   predicate that says which steps need an ask left this test green. This clause
        //   is about which steps the beacon alone can finish, so it is asserted directly:
        //   a matching beacon COMPLETES, reaching a verdict rather than a request to ask,
        //   and the partition of the steps is pinned so that moving a step across it is
        //   visible here rather than only in a reader's head.
        let matching = sighting(1, Ordinal::WifiMesh, 10, 0xAAAA_AAAA);
        assert_eq!(
            screen_from_beacon(&matching, 0xAAAA_AAAA),
            Screened::PassedBeaconSteps,
            "7.1.3: steps 1 and 2 complete from the beacon alone — no ask is required to \
             reach a verdict on them"
        );
        for step in [FilterStep::Marker, FilterStep::ClassHash] {
            assert!(
                step.answerable_from_beacon(),
                "{step:?} is one of the steps the beacon alone answers"
            );
            assert!(
                !step.requires_asking(),
                "7.1.3: {step:?} completes WITHOUT asking — if it required an ask, steps \
                 1 and 2 could not finish without steps 3 and 4"
            );
        }
        for step in [FilterStep::ClassAsk, FilterStep::CapabilityAsk] {
            assert!(
                step.requires_asking(),
                "{step:?} is one of the steps that does require asking"
            );
            assert!(
                !step.answerable_from_beacon(),
                "and it is therefore not answerable from the beacon"
            );
        }
    }

    /// **7.3.2 does not freeze every declaration.** A later associated-peer
    /// beacon is not new class/capability information, but an intermittent
    /// duty declaration still has to reach the Clause 9 sighting under 5.4b.3.
    #[test]
    fn an_associated_peer_refreshes_presence_without_reconsuming_class_or_capability() {
        let mut table: SightingTable<4> = SightingTable::new();
        let mut first = sighting(1, Ordinal::Ble, 10, 0xAAAA_AAAA);
        let SightingDeclarations::Announced(declarations) = &mut first.declarations else {
            panic!("fixture sighting is a discovery sighting");
        };
        declarations.summary_carried = true;
        table.record(first);

        let incoming = BeaconDeclarations {
            class_hash: 0xBBBB_BBBB,
            summary_carried: false,
            build_mode: BuildMode::Development,
            duty_class: DutyClass::Intermittent {
                longest_interval_s: 900,
            },
        };
        table.record_presence_only(bid(1), binding(Ordinal::Ble), Ticks(20), incoming);

        let held = table
            .on_binding(bid(1), binding(Ordinal::Ble))
            .expect("same bearer refreshed");
        assert_eq!(held.last_heard, Ticks(20));
        assert_eq!(held.declarations.class_hash(), Some(0xAAAA_AAAA));
        assert_eq!(held.declarations.summary_carried(), Some(true));
        assert_eq!(held.declarations.build_mode(), BuildMode::Development);
        assert_eq!(
            held.declarations.duty_class(),
            DutyClass::Intermittent {
                longest_interval_s: 900
            }
        );
        assert_eq!(
            screen_from_beacon(held, 0xAAAA_AAAA),
            Screened::PresenceOnly,
            "a held historic class is not a new beacon discovery candidate"
        );
        assert_eq!(
            table.matching_class(0xAAAA_AAAA).count(),
            0,
            "known-peer presence may not re-enter class-hash discovery"
        );
    }

    #[test]
    fn an_associated_peer_first_heard_on_another_bearer_still_has_presence_not_discovery() {
        let mut table: SightingTable<4> = SightingTable::new();
        let incoming = BeaconDeclarations {
            class_hash: 0xAAAA_AAAA,
            summary_carried: true,
            build_mode: BuildMode::Unknown,
            duty_class: DutyClass::Intermittent {
                longest_interval_s: 600,
            },
        };
        table.record_presence_only(bid(1), binding(Ordinal::Lora), Ticks(30), incoming);
        let held = table
            .on_binding(bid(1), binding(Ordinal::Lora))
            .expect("presence is per bearer");
        assert_eq!(held.declarations.class_hash(), None);
        assert_eq!(held.declarations.summary_carried(), None);
        assert_eq!(
            held.declarations.duty_class(),
            DutyClass::Intermittent {
                longest_interval_s: 600
            }
        );
        assert_eq!(
            screen_from_beacon(held, 0xAAAA_AAAA),
            Screened::PresenceOnly
        );
    }

    // ── 6.3: cadence and fade ───────────────────────────────────────────

    /// 6.3.1, and the boundary is *exceeds* rather than *reaches*: a peer
    /// heard exactly one fade period ago has not yet receded.
    #[test]
    fn a_peer_recedes_only_after_its_bearers_fade_period_is_exceeded() {
        let tps = 1_000;
        let s = sighting(1, Ordinal::WifiMesh, 10_000, 0);
        // Heard at t=10s, fade 60s, so the edge is t=70s exactly.
        assert!(
            !s.has_expired(
                Ticks(70_000),
                ObservationLifetime::PeerFade { seconds: 60 },
                tps
            ),
            "at the edge it is still current"
        );
        assert!(
            s.has_expired(
                Ticks(70_001),
                ObservationLifetime::PeerFade { seconds: 60 },
                tps
            ),
            "one tick past it has receded"
        );
        assert!(!s.has_expired(
            Ticks(11_000),
            ObservationLifetime::PeerFade { seconds: 60 },
            tps
        ));
    }

    /// ‼ **6.3.3: A HIVE SHALL NOT APPLY ONE BEARER'S FADE BEHAVIOUR TO
    /// ANOTHER**, which is why the fade is asked per bearer rather than
    /// passed once.
    ///
    /// Two sightings of the same peer, heard at the same moment on two
    /// bearers whose declared fades differ. **The short-fade bearer recedes
    /// and the long-fade one does not** — a table applying either fade to
    /// both would drop neither or both, and this fails in both directions.
    #[test]
    fn one_bearers_fade_does_not_recede_a_peer_on_another_bearer() {
        let mut t: SightingTable<4> = SightingTable::new();
        t.record(sighting(1, Ordinal::WifiMesh, 10_000, 0));
        t.record(sighting(1, Ordinal::Lora, 10_000, 0));
        assert_eq!(
            t.sightings_of(bid(1)).count(),
            2,
            "precondition: both recorded"
        );

        // WifiMesh fades in 30 s, LoRa in 600 s. At t=100 s only the first has.
        t.purge_expired(Ticks(100_000), 1_000, |b| {
            Some(match b.ordinal {
                Ordinal::WifiMesh => ObservationLifetime::PeerFade { seconds: 30 },
                _ => ObservationLifetime::PeerFade { seconds: 600 },
            })
        });

        assert!(
            t.on_binding(bid(1), binding(Ordinal::WifiMesh)).is_none(),
            "the short-fade bearer receded"
        );
        assert!(
            t.on_binding(bid(1), binding(Ordinal::Lora)).is_some(),
            "6.3.3: and the long-fade bearer did NOT, though it is the same peer"
        );
    }

    /// **Until 2026-08-18 nothing expired a sighting at all.** The control
    /// for the purge is that it leaves a current one alone — a purge that
    /// emptied the table would satisfy every *is it gone* assertion above.
    #[test]
    fn a_purge_leaves_a_current_sighting_alone() {
        let mut t: SightingTable<4> = SightingTable::new();
        t.record(sighting(1, Ordinal::WifiMesh, 10_000, 0));
        t.record(sighting(2, Ordinal::WifiMesh, 99_000, 0));
        t.purge_expired(Ticks(100_000), 1_000, |_| {
            Some(ObservationLifetime::PeerFade { seconds: 30 })
        });
        assert!(
            t.on_binding(bid(1), binding(Ordinal::WifiMesh)).is_none(),
            "receded"
        );
        assert!(
            t.on_binding(bid(2), binding(Ordinal::WifiMesh)).is_some(),
            "heard one second ago and must survive"
        );
    }

    /// ‼ **A CLOCK THAT WENT BACKWARDS IS NOT A RECEDED PEER.** L0 5.2.1 asks
    /// for a monotonic source and does not make a non-monotonic one
    /// impossible; discarding a live neighbour on the strength of a
    /// misbehaving clock is the wrong direction to fail in.
    #[test]
    fn a_sighting_from_the_future_is_not_receded() {
        let s = sighting(1, Ordinal::WifiMesh, 100_000, 0);
        assert!(!s.has_expired(
            Ticks(50_000),
            ObservationLifetime::PeerFade { seconds: 1 },
            1_000
        ));
    }

    /// L2 6.3.4: passive expiry removes a local observation, not an ordinary
    /// peer fade. The same beacon may remain current on an addressable bearer
    /// while its unrepeatable passive observation disappears.
    #[test]
    fn passive_retention_expires_without_receding_the_peer_on_another_bearer() {
        let mut t: SightingTable<4> = SightingTable::new();
        t.record(sighting(1, Ordinal::WifiMesh, 10_000, 0));
        t.record(sighting(1, Ordinal::Lora, 10_000, 0));

        t.purge_expired(Ticks(41_000), 1_000, |bearer| {
            Some(match bearer.ordinal {
                Ordinal::WifiMesh => ObservationLifetime::PeerFade { seconds: 60 },
                Ordinal::Lora => ObservationLifetime::PassiveRetention { seconds: 30 },
                _ => unreachable!("only the two recorded bearers are queried"),
            })
        });

        assert!(
            t.on_binding(bid(1), binding(Ordinal::WifiMesh)).is_some(),
            "the peer remains current on its ordinary 60-second bearer"
        );
        assert!(
            t.on_binding(bid(1), binding(Ordinal::Lora)).is_none(),
            "only the local passive observation reached its 30-second retention"
        );
    }

    /// ‼ **L2 5.4a.4 / 5.4b.4: THE UNREADABLE FIELD IS A THIRD ANSWER, NOT
    /// A FALLBACK TO EITHER SIDE.** *A scanner unable to read the field —
    /// absent, truncated, or unreachable — shall treat the hive's build
    /// mode as unknown*, and **shall not treat the absence as a claim of
    /// either class.**
    ///
    /// The `#[default]` on both enums is the mechanism, and it was
    /// **untested until now** — *a default is the easiest thing in a type
    /// to change by accident, because nothing at the call site names it.*
    /// The three unreadable cases the clause enumerates are indistinguishable
    /// to a scanner and are therefore one state here, which is the point:
    /// **absent, truncated and unreachable must not be told apart, or a
    /// scanner could treat one of them as informative.**
    #[test]
    fn an_unreadable_declaration_is_unknown_and_not_a_claim_of_either_value() {
        // Built the way a scanner builds one when the field did not read:
        // the type's own defaults, which is the mechanism under test.
        let d = BeaconDeclarations {
            class_hash: 0,
            summary_carried: false,
            build_mode: BuildMode::default(),
            duty_class: DutyClass::default(),
        };
        assert_eq!(d.build_mode, BuildMode::Unknown, "5.4a.4");
        assert_eq!(d.duty_class, DutyClass::Unknown, "5.4b.4");
        // ‼ AND `Unknown` IS A CLAIM OF NEITHER, asserted rather than
        // implied: it must equal no readable value, so a caller matching on
        // it cannot fall through to one.
        assert_ne!(d.build_mode, BuildMode::Production);
        assert_ne!(d.build_mode, BuildMode::Development);
        assert_ne!(d.duty_class, DutyClass::Continuous);
        assert_ne!(
            d.duty_class,
            DutyClass::Intermittent {
                longest_interval_s: 0
            }
        );
        // CONTROL: a READ field is recorded as read, so `Unknown` is the
        // unreadable case and not the only case.
        let read = BeaconDeclarations {
            build_mode: BuildMode::Production,
            ..d
        };
        assert_eq!(read.build_mode, BuildMode::Production);
    }

    /// **L2 5.4b.3: a scanner reading an intermittent value shall record
    /// the peer's duty class AND ITS STATED INTERVAL as part of the
    /// sighting.**
    ///
    /// ‼ **THE INTERVAL IS THE HALF WORTH ASSERTING**: a scanner that
    /// recorded only *intermittent* would satisfy the sentence's first
    /// clause and lose the one number that tells it **how long silence
    /// means nothing** — 4.1.5's *declared intervals are what tell a
    /// scanner the difference.*
    #[test]
    fn an_intermittent_sighting_records_the_class_and_its_stated_interval() {
        let mut table: SightingTable<4> = SightingTable::new();
        let mut s = sighting(1, Ordinal::Ble, 10, 0xAB);
        let SightingDeclarations::Announced(declarations) = &mut s.declarations else {
            panic!("fixture sighting is a discovery sighting");
        };
        declarations.duty_class = DutyClass::Intermittent {
            longest_interval_s: 900,
        };
        table.record(s);

        let stored = table
            .sightings_of(bid(1))
            .next()
            .expect("precondition: the sighting was stored");
        match stored.declarations.duty_class() {
            DutyClass::Intermittent { longest_interval_s } => {
                assert_eq!(longest_interval_s, 900, "5.4b.3: AND ITS STATED INTERVAL");
            }
            other => panic!("expected the intermittent class to survive recording, got {other:?}"),
        }
    }

    /// ‼ **L2 4.4.2 / 8.3: A CARRIED CAPABILITY SUMMARY IS A REASON TO ASK
    /// AND NOT AN ANSWER — AND THE TYPE IS WHAT MAKES THAT TRUE.**
    ///
    /// `BeaconDeclarations` stores `summary_carried`, **a bool**, and has
    /// no field of any kind for the summary's contents. *So a scanner
    /// cannot treat a positive as an answer even if it wanted to: there is
    /// nothing to answer from.* The rows called this *structural … no
    /// dedicated test*, and **today has twice shown that a structural claim
    /// with no assertion is a belief about every future version of the
    /// code** — this is the assertion.
    ///
    /// **The positive half is asserted too**: presence survives recording,
    /// so it can still prompt the ask 8.3 requires. *An implementation that
    /// dropped the flag would satisfy the negative and break the clause.*
    #[test]
    fn a_capability_summary_is_a_reason_to_ask_and_never_an_answer() {
        let mut t: SightingTable<4> = SightingTable::new();
        let mut s = sighting(1, Ordinal::Ble, 10, 0xAB);
        let SightingDeclarations::Announced(declarations) = &mut s.declarations else {
            panic!("fixture sighting is a discovery sighting");
        };
        declarations.summary_carried = true;
        t.record(s);

        let stored = t.sightings_of(bid(1)).next().expect("recorded");
        // The positive survives: it can prompt an ask (8.3, L2-052a).
        assert_eq!(stored.declarations.summary_carried(), Some(true));
        // ‼ AND THERE IS NOTHING TO ANSWER FROM. The whole declaration is
        // four scalars; none of them is the summary's contents. Written as
        // a field-by-field walk rather than as a comment, so ADDING such a
        // field breaks this test rather than passing it silently.
        let SightingDeclarations::Announced(BeaconDeclarations {
            class_hash: _,
            summary_carried: _,
            build_mode: _,
            duty_class: _,
        }) = stored.declarations
        else {
            panic!("fixture sighting retains its discovery declaration");
        };
    }

    /// **L2 4.4.2: a beacon is evidence of presence and of the declarations
    /// it carries, AND OF NOTHING MORE — never of identity or membership.**
    ///
    /// ‼ **THE ASSERTION IS THE FIELD WALK.** A `Sighting` is a beacon id,
    /// a bearer, a time and four declarations; **there is no identity and
    /// no membership anywhere in it**, and the destructuring below is what
    /// makes adding one a test failure rather than a silent widening of
    /// what a beacon is taken to prove.
    #[test]
    fn a_sighting_carries_no_identity_and_no_membership() {
        let s = sighting(1, Ordinal::Ble, 10, 0xAB);
        let Sighting {
            beacon_id: _,
            binding: _,
            last_heard: _,
            declarations: _,
        } = s;
        // And the beacon id is explicitly NOT an identity: 5.4.1/5.4.2 make
        // it opaque, stable and independent of every other identifier.
        assert_eq!(bid(1), bid(1), "stable");
        assert_ne!(bid(1), bid(2), "distinguishing, which is all it does");
    }

    /// **L2 5.4b.3 second half: a scanner shall provide the duty class and
    /// interval UPWARD as Clause 9 requires.** The row said the accessors
    /// return the full sighting and were *tested for recency and bearer
    /// only* — so the thing Clause 9 asks for was never read back through
    /// the path Clause 9 names.
    #[test]
    fn the_duty_class_is_readable_through_the_clause_9_accessors() {
        let mut t: SightingTable<4> = SightingTable::new();
        let mut s = sighting(1, Ordinal::Ble, 10, 0xAB);
        let SightingDeclarations::Announced(declarations) = &mut s.declarations else {
            panic!("fixture sighting is a discovery sighting");
        };
        declarations.duty_class = DutyClass::Intermittent {
            longest_interval_s: 300,
        };
        t.record(s);

        // Both accessors, because Clause 9 offers both and a caller may use
        // either — one of them working is not the clause being met.
        for d in [
            t.sightings_of(bid(1))
                .next()
                .expect("by peer")
                .declarations
                .duty_class(),
            t.on_binding(bid(1), binding(Ordinal::Ble))
                .expect("by bearer")
                .declarations
                .duty_class(),
        ] {
            assert_eq!(
                d,
                DutyClass::Intermittent {
                    longest_interval_s: 300
                }
            );
        }
    }

    #[test]
    fn sightings_per_bearer_never_merged() {
        let mut t: SightingTable<8> = SightingTable::new();
        t.record(sighting(1, Ordinal::Ble, 10, 0xAA));
        t.record(sighting(1, Ordinal::Lora, 20, 0xAA));
        assert_eq!(t.sightings_of(bid(1)).count(), 2); // 9.2
        assert_eq!(
            t.on_binding(bid(1), binding(Ordinal::Ble))
                .unwrap()
                .last_heard,
            Ticks(10)
        );
        assert_eq!(
            t.on_binding(bid(1), binding(Ordinal::Lora))
                .unwrap()
                .last_heard,
            Ticks(20)
        );
        // Refresh replaces the same (peer, bearer), not a new row.
        t.record(sighting(1, Ordinal::Ble, 30, 0xAA));
        assert_eq!(t.sightings_of(bid(1)).count(), 2);
        assert_eq!(
            t.on_binding(bid(1), binding(Ordinal::Ble))
                .unwrap()
                .last_heard,
            Ticks(30)
        );
    }

    #[test]
    fn class_hash_match_is_filter_step_two() {
        let mut t: SightingTable<8> = SightingTable::new();
        t.record(sighting(1, Ordinal::Ble, 1, 0xAA));
        t.record(sighting(2, Ordinal::Ble, 1, 0xBB));
        assert_eq!(t.matching_class(0xAA).count(), 1);
        assert_eq!(t.matching_class(0xCC).count(), 0);
    }

    #[test]
    fn stalest_recycled_at_capacity() {
        let mut t: SightingTable<2> = SightingTable::new();
        t.record(sighting(1, Ordinal::Ble, 100, 0));
        t.record(sighting(2, Ordinal::Ble, 5, 0));
        t.record(sighting(3, Ordinal::Ble, 50, 0)); // recycles peer 2 (stalest)
        assert!(t.on_binding(bid(2), binding(Ordinal::Ble)).is_none());
        assert!(t.on_binding(bid(1), binding(Ordinal::Ble)).is_some());
        assert!(t.on_binding(bid(3), binding(Ordinal::Ble)).is_some());
    }

    /// **L2 4.1.3 (2026-08-09): a hive shall receive and evaluate beacons on
    /// every bearer in service, WHETHER OR NOT that bearer participates in
    /// discovery.**
    ///
    /// Emit and receive were one obligation on one predicate until that date.
    /// **This side is met by having no filter to remove**: `record` takes the
    /// bearer as data and never consults a participation predicate — there
    /// is none in [`r2_transport::l1::BearerProfile`] to consult.
    ///
    /// *Pinned rather than assumed, because the natural way to implement
    /// 4.1.1a is to add the predicate to the profile and then gate BOTH
    /// paths on it — which would breach 4.1.3 while looking like tidying up.*
    #[test]
    fn beacons_are_recorded_on_every_bearer_regardless_of_participation() {
        let mut t: SightingTable<4> = SightingTable::default();
        // Two bearers of different kinds — `Usb` is point-to-point and is
        // exactly the case 4.6.2a contemplates. Nothing here says whether
        // either participates in discovery, and nothing may start to.
        t.record(sighting(1, Ordinal::WifiMesh, 10, 7));
        t.record(sighting(2, Ordinal::Usb, 11, 7));
        assert_eq!(
            t.matching_class(7).count(),
            2,
            "4.1.3: both bearers evaluated"
        );
    }

    #[test]
    fn filter_steps_ordered() {
        assert!(FilterStep::Marker < FilterStep::ClassHash);
        assert!(FilterStep::ClassHash < FilterStep::ClassAsk);
        assert!(FilterStep::CapabilityAsk < FilterStep::Perform);
    }
}
