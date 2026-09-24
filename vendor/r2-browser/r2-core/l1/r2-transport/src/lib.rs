//! **Reality2 Layer 1 — transport** (`standard/L1-transport.md` and the
//! three binding documents; `D-226` increment 2, split from `r2-mesh`).
//!
//! The bearer contract and everything a bearer binding states: the ordinal
//! registry and profile B1–B9 (`l1`), the per-medium bindings (`ble`,
//! `lora`), advertisement and airtime arithmetic, frame delimiting on a
//! byte stream, deployability and radio power (L1 4.9), and the fade-rate value B5.
//!
//! **The L1→L2 interface is this crate's public API**: carry a frame,
//! report state (L1 5.2), report link quality (5.3), declare the profile.
//! Nothing here parses a frame body or holds trust material.
//!
//! # What a binding contributes
//!
//! A board adaptation owns pins, radio or network-stack lifecycle, vendor
//! callbacks and medium-specific timing. A binding adapts that work to the
//! portable [`l1::Ingress`] or [`l1::Bearer`] contract; it does not expose the
//! vendor API above L1. The next layer receives a complete opaque frame plus
//! [`l1::RxMeta`], state, profile and arrival-quality facts:
//!
//! ```text
//! L0 board adaptation -> L1 binding -> L2 discovery / L3 forwarding
//!                         |                 |
//!                   complete frame      sightings, not trust
//! ```
//!
//! The boundary is deliberately narrower than a convenient driver API:
//!
//! - [`l1::Bearer::send`] means accepted for physical transmission, never
//!   delivered. A binding must not wait for or expose a medium acknowledgement.
//! - [`l1::Ingress::poll_recv`] and [`l1::Bearer::poll_recv`] return `None`
//!   only when no operation is available. A short caller buffer or malformed
//!   arrival is an explicit [`l1::ReceiveError`], never a usable prefix.
//! - A structural listener implements [`l1::Ingress`] only. It cannot become
//!   a sender by receiving a late `SendError`; the type system prevents the
//!   call.
//! - L2 announcements are separate from L4 frames where a binding has an
//!   out-of-frame discovery primitive. `announcement_carriage` records which
//!   path applies.
//!
//! # Timing and shared media
//!
//! The profile is the L1 statement of what the medium can do: payload ceiling,
//! reach, tier, fade, receptivity and discovery participation. A regulated
//! binding additionally exposes the small [`l1::RegulatedBearer`] scheduler
//! seam: the caller can see a new window, remaining legal airtime and a quote
//! for an exact offer, but not the radio controls that could bypass the budget.
//! A half-duplex LoRa owner remains receive-first, retains complete frames
//! while it cannot transmit or receive, uses randomized rendezvous rather than
//! a common listen/send phase, and restores reception after an attempt. Those
//! facts belong to the binding; routing chooses neither a PHY setting nor a
//! radio mode.
//!
//! # Boundary limits
//!
//! L1 carries opaque bytes. It does not parse L4, establish an L3 neighbour,
//! decide trust, assign a plugin, or make a board capability available. The
//! only documented L1-to-L4 dependency is the checked tier-floor exception in
//! the workspace layering gate; it derives the minimum plausible frame length
//! and does not parse a frame. For the complete composition map and the
//! L0-to-L7 plugin path, see `implementations/rust/docs/L0-L2-CONTRACTS.md`.
//!
//! no_std, no allocation (L0 5.4.2).

#![no_std]
#![deny(unsafe_code)]

pub mod backoff;
pub mod ble;
pub mod ble_advert;
/// L1 4.9, 5.2.0: what a deployable image must carry, and whose a
/// conformance claim is.
pub mod deployable;
pub mod errors;
/// The ESP-NOW binding's decidable half — the association table, the per-peer
/// quality, and the registration precondition. Added 2026-09-05: its siblings
/// had been here for months and ESP-NOW had none, so twelve rows were untested
/// because no host test could reach the bearer crate, which needs a chip
/// feature to build at all.
pub mod espnow;
/// L1 6a-bis (per binding): the B5 fade rate, held as derive-only.
pub mod fade_rate;
/// L1 receive ownership across a pair of ingresses sharing one caller buffer.
pub mod ingress_poll;
pub mod l1;
pub mod lora;
pub mod lora_airtime;
/// BND3 2a.4: locally randomized intermittent direct-LoRa rendezvous.
pub mod lora_intermittent;
pub mod lora_media_access;
pub mod lora_quality;
/// BND3 2a.2–2a.3: the portable ordering contract for one direct LoRa owner.
pub mod lora_receive_first;
pub mod lora_region;
pub mod radio_power;
/// L1 4.3.2, 8.4.1, 8.4.3: delimiting frames on a byte stream, and giving
/// a new bearer the lowest unassigned ordinal.
pub mod stream_delimit;

/// Explicit compact UDP mode framing, separate from ordinary extended UDP.
pub mod compact_udp;
