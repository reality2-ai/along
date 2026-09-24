//! **Reality2 Layer 3 — routing** (`standard/L3-routing.md`; `D-226`
//! increment 2, split from `r2-mesh`).
//!
//! Identity keying, duplicate suppression, the replication budget, the
//! neighbour table and custody (`l3`).
//!
//! **The L3→L4 interface**: neighbour and custody state keyed by
//! [`r2_ident::HiveId`]; the wire tier it consumes from `r2-transport`'s
//! re-export is the workspace's one named upward edge (SS380).
//!
//! no_std, no allocation (L0 5.4.2).

#![no_std]
#![deny(unsafe_code)]

pub mod errors;
pub mod l3;
/// The undeprecated CARRIER of the prototype — compat plumbing, not a door.
///
/// Module-level `#[deprecated]` marks every item inside, and the mark
/// follows items through re-exports (measured with probes, 2026-08-25) —
/// so deprecating the code directly broke the facade's contract that a
/// pre-split consumer under `deny(deprecated)` compiles unchanged. The
/// resolution: the CODE lives here, undeprecated, `#[doc(hidden)]`, under
/// a name that says what it is; the DISCOVERABLE path below carries the
/// deprecation. Reaching this module by its underscore-of-intent name is
/// a deliberate act, not a discovery.
#[doc(hidden)]
pub mod prototype_neighbour_set;

/// The bounded-neighbour-set PROTOTYPE — deprecated, held, not offered.
///
/// Assigned L1 by the split's survey, refuted twice by r2-codex-refute
/// (2026-08-25): first the address (L3 4.4 owns the bounded table), then
/// the substance (wrong key, beacons-only formation, margin-only
/// eviction — nonconforming against L3 4.1/4.4 three ways). The prose
/// marker alone did not constrain the next caller, so this discoverable
/// path warns; the facade's pre-split path stays clean via the carrier
/// above. Use [`l3::NeighbourTable`].
#[deprecated(
    note = "NONCONFORMING PROTOTYPE against L3 4.1/4.4 — held as the LoRa \
            spend-arithmetic design record, not offered; use l3::NeighbourTable"
)]
#[doc(hidden)]
/// The deprecated door, built from what rustc actually honours.
///
/// Three mechanisms were MEASURED before this one (2026-08-25, probe
/// crates): a deprecated MODULE marks items defined in it but not
/// re-exports through it; `#[deprecated]` on a `use` — list or glob —
/// is silently ignored; a TYPE ALIAS honours it. So the door is
/// aliases: same types, same construction syntax, and selecting any
/// of them through THIS path warns, while the facade's pre-split path
/// stays clean through the carrier module.
pub mod neighbour_set {
    #[deprecated(note = "NONCONFORMING PROTOTYPE against L3 4.1/4.4 — use l3::NeighbourTable")]
    pub type Policy = super::prototype_neighbour_set::Policy;
    #[deprecated(note = "NONCONFORMING PROTOTYPE against L3 4.1/4.4 — use l3::NeighbourTable")]
    pub type Neighbour = super::prototype_neighbour_set::Neighbour;
    #[deprecated(note = "NONCONFORMING PROTOTYPE against L3 4.1/4.4 — use l3::NeighbourTable")]
    pub type Admission = super::prototype_neighbour_set::Admission;
    #[deprecated(note = "NONCONFORMING PROTOTYPE against L3 4.1/4.4 — use l3::NeighbourTable")]
    pub type NeighbourSet<const N: usize> = super::prototype_neighbour_set::NeighbourSet<N>;
}
