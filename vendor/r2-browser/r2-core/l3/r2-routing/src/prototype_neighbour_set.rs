//! **A bounded neighbour set built from received beacons, and why "the X
//! closest" is the wrong X.**
//!
//! # ‼ NONCONFORMING PROTOTYPE — HELD, NOT OFFERED (r2-codex-refute, 2026-08-25)
//!
//! Widened from the finding that moved this module here: **relocating it did
//! not make it the L3 table, and it must not be mistaken for one.** Measured
//! against `L3-routing.md` 4.1/4.4, three ways at once:
//!
//! - **keys one entry per `u32` medium address** — 4.1 keys the table per
//!   canonical `HiveId`, with per-bearer evidence beneath it;
//! - **forms only from beacons** — 4.1 refreshes from any frame or beacon;
//! - **evicts solely by link margin** — 4.4.3/4.4.4 evict by confidence and
//!   protect verified evidence, which this module does not model at all.
//!
//! The conforming table is [`crate::l3::NeighbourTable`]. What this module
//! holds that the table does not yet is the LoRa spend-arithmetic — the
//! reach-slot argument below, hysteresis against measurement noise, the
//! named [`Admission`](crate::prototype_neighbour_set::Admission) fates — and that knowledge is the reason it is HELD
//! rather than deleted: it is the design record for teaching the real table
//! those policies, and its facade path is part of the compatibility
//! contract. **No conformance claim cites this module, nothing constructs
//! it outside its own tests, and code wanting a neighbour table uses
//! `l3::NeighbourTable`.**
//!
//! # ‼ ON A RELAY MESH, KEEPING YOUR STRONGEST NEIGHBOURS SHRINKS THE NETWORK
//!
//! The obvious policy is *keep the X best links*. It is wrong here, and the
//! reason is the same arithmetic that governs everything else on this medium:
//! **every hop costs a whole transmission.** At SF12 a beacon-sized frame is
//! about 1.8 s, of which **two thirds of a second is preamble and header
//! before any content** — so crossing a given distance in four short hops
//! costs roughly four times what two long hops cost, in the one resource that
//! is actually scarce.
//!
//! A hive that keeps only its strongest neighbours makes the mesh a **dense
//! cluster**: every link excellent, every route long. *Reliability per hop is
//! bought with hop count, and hop count is airtime.*
//!
//! ‼ **AND IT CONTRADICTS THE RELAY DISCIPLINE THIS CRATE ALREADY
//! IMPLEMENTS.** `BND3` 6e.4 gives the **weakest** hearer the shortest backoff,
//! precisely because a distant hive's relay carries the frame furthest. A
//! neighbour set that discarded exactly those peers would spend the airtime
//! saved by 6e.4 on extra hops.
//!
//! # So the set reserves slots for reach
//!
//! [`Policy::reserved_for_reach`](crate::neighbour_set::Policy::reserved_for_reach)
//! holds back part of the table for peers that
//! are **usable but marginal** — above the modulation's demodulation floor and
//! not much above it. Those are the far ones. The rest of the table goes to
//! the strongest, which are the ones that carry traffic without retries.
//!
//! **The split is a stated choice, not a default**, because the right answer
//! depends on the deployment: a dense indoor fleet wants reliability and a
//! sparse rural one wants reach, and *nothing this crate can measure tells it
//! which it is in.*
//!
//! # ‼ AND MARGIN IS NOT RELIABILITY — IT IS INSURANCE AGAINST FADING
//!
//! **LoRa sensitivity is published at PER < 1 %**, so a link sitting *at* the
//! demodulation limit already delivers about ninety-nine frames in a hundred.
//! The curve is a **waterfall**: nearly flat at low error, then a steep
//! transition of a very few dB, then nothing.
//!
//! Two consequences, and both cut toward keeping the far links:
//!
//! * ‼ **ABOVE A FEW dB OF MARGIN, MORE SIGNAL BUYS ALMOST NOTHING.** A link
//!   at +10 dB is not meaningfully more reliable than one at +3 dB — both sit
//!   in the flat part. *A policy that ranks peers by margin is optimising a
//!   quantity that saturated long before the top of its range.*
//! * **One long hop beats two short ones while its error rate is under a
//!   half** — it replaces two transmissions with an expected `1/(1-p)`. At the
//!   1 % the limit is specified for, that is a **twofold** airtime win.
//!
//! **So what margin actually buys is survival of a fade**: weather, foliage,
//! a lorry parked in the path. A link at +10 dB survives a 7 dB fade and one
//! at +1 dB does not. *Reach versus resilience, not reach versus
//! reliability* — and [`NeighbourSet::fade`](crate::neighbour_set::NeighbourSet::fade)
//! plus the hysteresis are what
//! handle a reach link that stops being one.
//!
//! ⚠ **WHICH IS WHY THE REACH BAND HAS A FLOOR.** A peer heard **below** the
//! demodulation limit is past the waterfall, not at the edge of it, and a
//! reserved slot spent on one is a slot spent on a link that mostly does not
//! deliver. It may still be admitted when there is room — *hearing it at all
//! is evidence* — but it does not displace a working peer.
//!
//! # ⚠ AND THE BOUND ITSELF IS A POLICY HERE, NOT A MEDIUM FACT
//!
//! On ESP-NOW the peer table has a **hard limit** and `BND1` says so — Layer 1
//! 5.2's `Restricted` state exists for media with one, *"and this is one of
//! them"*. **On LoRa there is no such limit**: `BND3` 6d.2 states the medium
//! places no precondition on carrying a frame to an individual peer and no
//! limit on how many may be held. So a cap on this bearer is a **routing
//! decision** that must justify itself, and — `SS374`'s lesson — a bound with
//! no stated discharge refuses forever, conformantly.
//! [`Admission`](crate::prototype_neighbour_set::Admission) is that
//! discharge: every outcome names what happened to the peer that did not fit.

// MOVED FROM r2-transport 2026-08-25 — r2-codex-refute falsified the survey's
// L1 assignment, and this module's own header was the evidence: "a cap on
// this bearer is a ROUTING DECISION". L3 4.4.1 owns the bounded neighbour
// table, 4.4.3 its eviction; BND3 6a.4 assigns only per-address quality
// STORAGE to L1, not table policy. The type this keeps from L1 is the
// measurement, which is the part that genuinely is L1's.
use r2_transport::l1::LinkQuality;

/// How a bounded neighbour set decides who to keep.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Policy {
    /// Slots held for **usable but marginal** peers — the far ones.
    ///
    /// Zero makes this a pure top-N by quality, which is the shape the module
    /// header argues against; it is reachable so a deployment can choose it
    /// deliberately rather than by the type forbidding it.
    pub reserved_for_reach: usize,
    /// **The bottom of the useful reach band, in tenths of a dB.**
    ///
    /// A peer below this is past the waterfall rather than at the edge of it.
    /// Zero — the demodulation limit itself — is the natural value, because
    /// that is where the published 1 % error rate is specified.
    pub reach_floor_db10: i16,
    /// ‼ **HOW MUCH BETTER A CANDIDATE MUST BE TO DISPLACE AN INCUMBENT, IN
    /// TENTHS OF A dB.**
    ///
    /// **Without it the table churns on measurement noise.** LoRa SNR moves
    /// several dB frame to frame on a link that has not changed at all, so a
    /// strict `>` comparison reorders the set on nothing — and **every
    /// admission and eviction is a topology change the routing layer above
    /// has to absorb.** *The set must be stickier than the measurement it is
    /// built from.*
    pub hysteresis_db10: i16,
}

impl Policy {
    /// A deployment that has not chosen: half the table held for reach, and
    /// 3 dB of hysteresis — *one spreading factor is 2.5 dB, so this asks a
    /// candidate to be better by more than the step it would let you take.*
    pub const fn balanced(capacity: usize) -> Self {
        Self {
            reserved_for_reach: capacity / 2,
            reach_floor_db10: 0,
            hysteresis_db10: 30,
        }
    }
}

/// One peer, as beacons have described it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Neighbour {
    /// The medium address the beacons came from. **Held per address and
    /// discarded when the address changes** (`BND3` 6a.4, 4.5).
    pub address: u32,
    /// Headroom above the modulation's demodulation floor, tenths of a dB —
    /// see `lora_quality`. **Not RSSI**: on this medium a link with a signal
    /// strength that looks like nothing at all still works.
    pub margin_db10: i16,
    /// When it was last heard, in the caller's tick unit.
    pub last_heard: u64,
}

impl Neighbour {
    /// Whether this peer sits in the **reach band** — far enough to be worth a
    /// reserved slot, and not so far that it is past the waterfall.
    ///
    /// ‼ **A BAND AND NOT A THRESHOLD.** The top is one spreading factor of
    /// headroom: below that a peer is at the edge of what this modulation
    /// decodes, which is exactly the peer worth keeping. The bottom is the
    /// demodulation limit, where the published 1 % error rate is specified —
    /// *below it the link mostly does not deliver, and a reserved slot spent
    /// there is spent on nothing.*
    pub const fn is_far(&self, floor_db10: i16, far_below_db10: i16) -> bool {
        self.margin_db10 >= floor_db10 && self.margin_db10 < far_below_db10
    }
}

/// What happened when a beacon offered a peer to a full table.
///
/// ‼ **EVERY VARIANT NAMES A FATE**, because a bound with no stated discharge
/// is a bound that refuses forever without saying so (`SS374`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Admission {
    /// Already present; its margin and last-heard were updated.
    Refreshed,
    /// There was room.
    Admitted,
    /// Admitted, and this address was dropped to make room.
    Displaced { evicted: u32 },
    /// **Refused, and the incumbent it failed to beat is named** — so a
    /// caller can see the table is full of *better* peers rather than merely
    /// full.
    RefusedNotBetter { than: u32 },
    /// Refused: the reach slots are full and this peer is not far enough to
    /// compete for one, nor strong enough for the rest.
    RefusedNoSlot,
}

/// A bounded set of neighbours, kept from received beacons.
#[derive(Clone, Copy, Debug)]
pub struct NeighbourSet<const N: usize> {
    entries: [Option<Neighbour>; N],
    policy: Policy,
    far_below_db10: i16,
    churn: u32,
}

impl<const N: usize> NeighbourSet<N> {
    /// `far_below_db10` is the margin under which a peer counts as *far* and
    /// competes for a reserved slot. One spreading factor — 25 — is the
    /// natural value and is the caller's to state.
    pub const fn new(policy: Policy, far_below_db10: i16) -> Self {
        Self {
            entries: [None; N],
            policy,
            far_below_db10,
            churn: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.entries.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// **How many times a peer has been evicted.**
    ///
    /// *A set that only reports its contents cannot tell an operator it is
    /// thrashing* — and a thrashing neighbour table looks, from above, like a
    /// mesh whose peers keep going away.
    pub const fn churn(&self) -> u32 {
        self.churn
    }

    pub fn iter(&self) -> impl Iterator<Item = &Neighbour> {
        self.entries.iter().flatten()
    }

    fn far_count(&self) -> usize {
        self.iter()
            .filter(|n| n.is_far(self.policy.reach_floor_db10, self.far_below_db10))
            .count()
    }

    /// **Offer a peer heard in a beacon.**
    pub fn heard(&mut self, address: u32, margin_db10: i16, at: u64) -> Admission {
        // Already known: refresh in place. Never an eviction decision.
        for slot in self.entries.iter_mut().flatten() {
            if slot.address == address {
                slot.margin_db10 = margin_db10;
                slot.last_heard = at;
                return Admission::Refreshed;
            }
        }
        let candidate = Neighbour {
            address,
            margin_db10,
            last_heard: at,
        };
        if let Some(slot) = self.entries.iter_mut().find(|e| e.is_none()) {
            *slot = Some(candidate);
            return Admission::Admitted;
        }
        // Full. A far candidate competes only against the far incumbents, and
        // a near one only against the near — otherwise the strongest peers
        // would evict the reach slots one beacon at a time, which is the
        // failure the reservation exists to prevent.
        let candidate_far = candidate.is_far(self.policy.reach_floor_db10, self.far_below_db10);
        let reach_slots_full = self.far_count() >= self.policy.reserved_for_reach;
        if candidate_far && !reach_slots_full {
            // Take from the near side: the weakest near peer goes.
            if let Some(victim) = self.weakest(false) {
                return self.replace(victim, candidate);
            }
        }
        if candidate_far {
            // ‼ **WITHIN THE REACH BAND THERE IS NO RANKING, AND INVENTING ONE
            // WAS A DESIGN ERROR A TEST CAUGHT.** LoRa sensitivity is published
            // at PER < 1 %, so every peer in the band delivers about
            // ninety-nine frames in a hundred and extends reach by about as
            // much. **They are interchangeable**, so displacing one for another
            // buys nothing and costs a topology change the layer above must
            // absorb. *A full reach set is freed by fading, not by
            // competition.*
            //
            // The first version ranked the band by margin and preferred the
            // furthest — which reads as sensible and is not: past the floor,
            // further is WORSE, and inside the band the difference is noise.
            // It was also unreachable, because the 3 dB hysteresis is wider
            // than the 2.5 dB band.
            return match self.weakest(true) {
                Some(w) => Admission::RefusedNotBetter { than: w.address },
                None => Admission::RefusedNoSlot,
            };
        }
        let worst = match self.weakest(false) {
            Some(w) => w,
            None => return Admission::RefusedNoSlot,
        };
        // ‼ Hysteresis on the near side, where margin DOES still order: better
        // is not enough, better BY THE STATED MARGIN is.
        if candidate.margin_db10 - worst.margin_db10 >= self.policy.hysteresis_db10 {
            self.replace(worst, candidate)
        } else {
            Admission::RefusedNotBetter {
                than: worst.address,
            }
        }
    }

    /// The weakest incumbent on the requested side.
    ///
    /// On the near side that is the lowest margin. **On the far side the
    /// choice is arbitrary and only names an incumbent for the refusal** —
    /// within the reach band the peers are interchangeable, so there is no
    /// weakest to find.
    fn weakest(&self, far_side: bool) -> Option<Neighbour> {
        self.iter()
            .filter(|n| n.is_far(self.policy.reach_floor_db10, self.far_below_db10) == far_side)
            .copied()
            .reduce(|a, b| {
                let take_b = if far_side {
                    b.margin_db10 > a.margin_db10
                } else {
                    b.margin_db10 < a.margin_db10
                };
                if take_b {
                    b
                } else {
                    a
                }
            })
    }

    fn replace(&mut self, victim: Neighbour, candidate: Neighbour) -> Admission {
        for slot in self.entries.iter_mut() {
            if matches!(slot, Some(n) if n.address == victim.address) {
                *slot = Some(candidate);
                self.churn = self.churn.saturating_add(1);
                return Admission::Displaced {
                    evicted: victim.address,
                };
            }
        }
        Admission::RefusedNoSlot
    }

    /// **Drop peers not heard within the fade window (B5).**
    ///
    /// Separate from admission because *not heard* and *outcompeted* are
    /// different facts about a peer, and merging them would report a fading
    /// link as a crowded table.
    pub fn fade(&mut self, now: u64, fade_after: u64) -> usize {
        let mut gone = 0;
        for slot in self.entries.iter_mut() {
            if matches!(slot, Some(n) if now.saturating_sub(n.last_heard) >= fade_after) {
                *slot = None;
                gone += 1;
            }
        }
        gone
    }

    /// The set as link qualities, for Layer 3's scoring (6.2).
    pub fn quality_of(&self, address: u32, ceiling_db10: i16) -> Option<LinkQuality> {
        let n = self.iter().find(|n| n.address == address)?;
        if n.margin_db10 <= 0 {
            return Some(LinkQuality(0.0));
        }
        if ceiling_db10 <= 0 || n.margin_db10 >= ceiling_db10 {
            return Some(LinkQuality(1.0));
        }
        Some(LinkQuality(n.margin_db10 as f32 / ceiling_db10 as f32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAR: i16 = 25; // one spreading factor of headroom
    fn set() -> NeighbourSet<4> {
        NeighbourSet::new(
            Policy {
                reserved_for_reach: 2,
                reach_floor_db10: 0,
                hysteresis_db10: 30,
            },
            FAR,
        )
    }

    /// ‼ **THE PROPERTY THE MODULE EXISTS FOR: A STRONG PEER CANNOT EVICT THE
    /// LAST FAR ONE.** A pure top-N table collapses the mesh into a cluster,
    /// and every route out of it costs extra hops — which on this medium is
    /// the only cost that matters.
    #[test]
    fn strong_peers_cannot_take_the_slots_reserved_for_reach() {
        let mut s = set();
        s.heard(1, 10, 0); // far
        s.heard(2, 15, 0); // far
        s.heard(3, 200, 0); // near, strong
        s.heard(4, 190, 0); // near
        assert_eq!(s.len(), 4);

        // A very strong newcomer may take a NEAR slot...
        assert!(matches!(
            s.heard(5, 400, 1),
            Admission::Displaced { evicted: 4 }
        ));
        // ...and may never take a far one, however strong.
        for margin in [500i16, 900, 2000] {
            let before = s.iter().filter(|n| n.is_far(0, FAR)).count();
            s.heard(99, margin, 2);
            let after = s.iter().filter(|n| n.is_far(0, FAR)).count();
            assert_eq!(before, after, "a strong peer at {margin} ate a reach slot");
        }
        assert_eq!(s.iter().filter(|n| n.is_far(0, FAR)).count(), 2);
    }

    /// **A far candidate takes from the near side while reach slots are
    /// unfilled** — the reservation pulls the table outward rather than
    /// merely refusing to shrink it.
    #[test]
    fn a_far_peer_claims_a_reserved_slot_from_the_near_side() {
        let mut s = set();
        for (a, m) in [(1u32, 300i16), (2, 280), (3, 260), (4, 240)] {
            s.heard(a, m, 0);
        }
        assert_eq!(s.iter().filter(|n| n.is_far(0, FAR)).count(), 0);
        assert!(matches!(
            s.heard(9, 5, 1),
            Admission::Displaced { evicted: 4 }
        ));
        assert_eq!(s.iter().filter(|n| n.is_far(0, FAR)).count(), 1);
    }

    /// ‼ **HYSTERESIS: BETTER IS NOT ENOUGH.** LoRa SNR moves several dB
    /// frame to frame on a link that has not changed, and every eviction is a
    /// topology change the layer above must absorb.
    #[test]
    fn a_marginally_better_peer_does_not_churn_the_table() {
        let mut s = set();
        for (a, m) in [(1u32, 300i16), (2, 280), (3, 10), (4, 12)] {
            s.heard(a, m, 0);
        }
        // 1 dB better than the weakest near peer (280): refused.
        assert_eq!(
            s.heard(7, 290, 1),
            Admission::RefusedNotBetter { than: 2 },
            "the table churned on less than the stated hysteresis"
        );
        assert_eq!(s.churn(), 0);
        // 3 dB better: admitted.
        assert!(matches!(
            s.heard(7, 310, 2),
            Admission::Displaced { evicted: 2 }
        ));
        assert_eq!(s.churn(), 1);
    }

    /// **A known peer refreshes and never triggers an eviction decision.**
    #[test]
    fn hearing_a_known_peer_refreshes_it() {
        let mut s = set();
        s.heard(1, 100, 0);
        assert_eq!(s.heard(1, 400, 5), Admission::Refreshed);
        assert_eq!(s.len(), 1);
        assert_eq!(s.churn(), 0);
        let n = s.iter().next().unwrap();
        assert_eq!(n.margin_db10, 400);
        assert_eq!(n.last_heard, 5);
    }

    /// **Fading and being outcompeted are different facts**, so they are
    /// different operations and counted differently.
    #[test]
    fn fading_is_not_churn() {
        let mut s = set();
        s.heard(1, 100, 0);
        s.heard(2, 100, 50);
        assert_eq!(s.fade(100, 60), 1, "peer 1 was last heard at 0");
        assert_eq!(s.len(), 1);
        assert_eq!(s.churn(), 0, "a faded peer was counted as churn");
    }

    /// ‼ **PEERS INSIDE THE REACH BAND ARE INTERCHANGEABLE, SO THEY DO NOT
    /// COMPETE.** Every one delivers about ninety-nine frames in a hundred and
    /// extends reach by about as much; displacing one for another buys nothing
    /// and costs a topology change. **A full reach set is freed by fading.**
    ///
    /// *The first version of this ranked the band and preferred the furthest,
    /// which reads as sensible and is wrong twice over: past the floor further
    /// is worse, and inside the band the difference is noise.*
    #[test]
    fn peers_within_the_reach_band_do_not_displace_each_other() {
        let mut s = set();
        s.heard(1, 24, 0);
        s.heard(2, 20, 0);
        s.heard(3, 300, 0);
        s.heard(4, 280, 0);
        for margin in [1i16, 2, 10, 24] {
            assert!(
                !matches!(s.heard(9, margin, 1), Admission::Displaced { .. }),
                "an in-band peer at {margin} displaced another in-band peer"
            );
        }
        assert_eq!(s.churn(), 0);
        // And fading frees the slot, which is the route that does work.
        assert_eq!(s.fade(100, 50), 4);
        assert!(matches!(s.heard(9, 5, 101), Admission::Admitted));
    }

    /// ‼ **BELOW THE DEMODULATION LIMIT IS PAST THE WATERFALL, NOT AT THE EDGE
    /// OF IT.** LoRa sensitivity is published at PER < 1 %, so a peer heard
    /// *below* the limit mostly does not deliver — and a reserved slot spent
    /// on one is spent on nothing. It must not displace a working reach peer.
    #[test]
    fn a_peer_past_the_waterfall_does_not_claim_a_reach_slot() {
        let mut s = set();
        s.heard(1, 24, 0); // in the band
        s.heard(2, 20, 0); // in the band
        s.heard(3, 300, 0);
        s.heard(4, 280, 0);
        let before: u32 = s.iter().map(|n| n.address).sum();
        assert!(
            !matches!(s.heard(9, -50, 1), Admission::Displaced { .. }),
            "a peer 5 dB below what this modulation can decode evicted a link              that works"
        );
        assert_eq!(
            s.iter().map(|n| n.address).sum::<u32>(),
            before,
            "the table changed anyway"
        );
        assert_eq!(s.churn(), 0);
    }

    /// The bound is honoured, and a refusal names what it lost to.
    #[test]
    fn the_set_never_exceeds_its_capacity() {
        let mut s = set();
        for a in 0u32..40 {
            s.heard(a, (a as i16) * 7, a as u64);
            assert!(s.len() <= 4, "capacity exceeded at {a}");
        }
    }
}
