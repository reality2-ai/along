//! **Reality2 Layer 2 — capability and discovery**
//! (`standard/L2-capability-and-discovery.md`; `D-226` increment 2, split
//! from `r2-mesh`).
//!
//! The announcement codec and its build-mode reading (`announcement`),
//! sightings and their per-bearer fade (`l2`), the capability summary,
//! beacon cadence policy, the duty-class declaration, learned class
//! strings, and what a surface may claim about who can observe.
//!
//! **The L2→L3 interface is this crate's public API**: sightings and
//! their fade, and the capability ladder's answers (L2 7.1).
//!
//! # Discovery is evidence, not a route or a verdict
//!
//! L2 consumes a binding's complete arrivals, declaration-carriage facts and
//! arrival quality. It produces bounded, per-bearer sightings, beacon
//! declarations, capability screening and beacon cadence decisions. The next
//! layer may consume that evidence to form routes; L2 itself neither selects a
//! bearer nor creates a next hop.
//!
//! ```text
//! L1 complete arrival + RxMeta
//!             |
//!             v
//!  announcement decode / sighting table / capability screen
//!             |
//!             v
//! L3 candidate evidence (not a neighbour or delivery decision)
//! ```
//!
//! A beacon is presence plus the declarations it carries. Its capability
//! summary is a reason to ask, never an authoritative answer. A sighting is
//! keyed by peer *and bearer*, so observations from different media cannot be
//! silently merged. `BuildMode::Unknown`, an absent declaration, a malformed
//! declaration and an unavailable observation remain distinct from a positive
//! production or capability claim.
//!
//! # Output and admission
//!
//! Beacon cadence and service-admission helpers make the binding's declared
//! carriage and legal constraints visible before an image presents a bearer as
//! in service. A regulated bearer uses the L1 scheduler seam for every
//! on-air offer; generic fan-out cannot spend its reserved beacon budget.
//! This crate does not own the physical scheduler, airtime calculation or
//! radio lifecycle — those remain in L1 and its board adaptation.
//!
//! # Boundary limits
//!
//! L2 neither parses L4 frames, retains L3 custody, authenticates an identity,
//! holds a Layer 5 association, nor invokes a plugin. It can describe what a
//! surface may claim about observability, but never turns a sighting into a
//! trust verdict. The capability ask exchange and class-hash algorithm remain
//! standard-defined work outside this crate's current portable surface.
//!
//! See `implementations/rust/docs/L0-L2-CONTRACTS.md` for assembly guidance,
//! optionality, verification commands and the named L0-to-L7 plugin seam.
//!
//! no_std, no allocation (L0 5.4.2).

#![no_std]
#![deny(unsafe_code)]

pub mod announcement;
pub mod beacon_policy;
/// L2 5.5.3, 5.5.4, 7.2.1, 7.3.2: learned class strings, keyed by PEER —
/// never by hash, which is the step Note 0 records an implementation taking.
/// L2 8.1, 8.3, 8.4: the capability summary — false positives admitted,
/// false negatives never, and absent is not empty.
pub mod capability_summary;
pub mod class_cache;
/// L2 4.1.4, 4.1.5, 5.4a.3a: duty cycling as an exemption nobody gets,
/// and the bearer a development hive may not place in service.
pub mod duty_and_declaration;
pub mod l2;
/// L2 11.4 and 5.4.3: what a surface may claim about who can observe, and
/// how peer information reaches a beacon identifier.
pub mod observability;
pub mod regulated_output;
