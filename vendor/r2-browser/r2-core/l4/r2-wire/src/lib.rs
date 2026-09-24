//! Reality2 Layer 4 wire protocol.
//!
//! Implements the byte-exact frame format of `r2-standard/L4-wire.md`: the two
//! tiers, message types, addressing, FNV-1a name hashing with the L4 7.1.2
//! normalisation, the route record, and serialisation of the authenticated
//! span. Keys and tag computation belong to Layer 5 (L4 10.3.1); this crate
//! only delimits the tag bytes and the span they cover.
//!
//! no_std, zero dependencies, no allocation (L0 5.4.2: Layers 1-4 must be
//! implementable with static allocation alone).

#![no_std]
#![deny(unsafe_code)]

/// L4 5.2 and 6.2.2: retransmitting the same frame unchanged, and dividing
/// above this layer — the network never holds half a thing.
pub mod carriage;
pub mod errors;
pub mod fnv;
pub mod frame;
pub mod name;

pub use frame::{
    cross_tier, CrossError, EncodeError, Flags, Frame, FrameSpec, FrameType, ParseError,
    RouteRecord, Target, Tier, COMPACT_HEADER_LEN, EXTENDED_HEADER_LEN,
};
