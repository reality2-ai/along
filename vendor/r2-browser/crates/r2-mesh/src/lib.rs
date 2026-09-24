//! **`r2-mesh` — the compatibility facade over the layer split** (`D-226`
//! increment 2). The code that lived here is now three crates, one per
//! spec layer: `r2-transport` (L1), `r2-discovery` (L2), `r2-routing`
//! (L3), under `r2-core/`. Every module path this crate ever exported is
//! re-exported below, so existing consumers compile unchanged; new code
//! should depend on the layer crate it actually needs, which is how the
//! layering gate sees the true edge.
//!
//! no_std. The `std` feature forwards to all three crates, so enabling
//! `r2-mesh/std` still switches on every `std::error::Error` impl.

#![no_std]
#![deny(unsafe_code)]

pub use r2_discovery::{
    announcement, beacon_policy, capability_summary, class_cache, duty_and_declaration, l2,
    observability,
};
pub use r2_routing::l3;

/// The pre-split `neighbour_set` path, as a NON-deprecated shim.
///
/// The owning module (`r2_routing::neighbour_set`) is deprecated — a
/// nonconforming prototype against L3 4.1/4.4, held as a design record —
/// and that deprecation travelled through a plain re-export, so a
/// pre-split consumer under `deny(deprecated)` stopped compiling, which
/// broke this facade's contract that every consumer compiles UNCHANGED
/// (r2-codex-refute, 2026-08-25, reproduced with a probe before fixing).
/// The shim keeps the OLD path exactly as it behaved before the split;
/// the warning belongs to the NEW path, where a caller is making a fresh
/// choice. New code uses `l3::NeighbourTable`.
pub mod neighbour_set {
    pub use r2_routing::prototype_neighbour_set::*;
}

/// The `Display`/`std::error::Error` impls that lived here moved with their
/// types (`D-226`, the orphan rule): `SendError`'s half to `r2-transport`,
/// `DropReason`/`CustodyRefusal`'s to `r2-routing`. The module never had an
/// importable item — trait impls are global — but **the module itself was a
/// public path, and `use r2_mesh::errors` compiled**, so the path survives
/// as this empty shim. Found by `r2-codex-refute` (2026-08-25): the facade
/// re-exported every old module's ITEMS and the completeness claim was
/// about PATHS.
pub mod errors {}
pub use r2_transport::{
    ble, ble_advert, deployable, fade_rate, l1, lora, lora_airtime, lora_media_access,
    lora_quality, lora_region, radio_power, stream_delimit,
};
