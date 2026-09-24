//! Reality2 Layer 0 platform facilities as traits, plus the platform
//! declaration types (`r2-standard/L0-hardware-and-runtime.md`).
//!
//! Leaf crate: trait definitions and tiny types only — no layer dependencies,
//! no async runtime, no platform types (r2-hive INTEGRATION.md §3.2). The
//! consumer implements these once per platform (esp-hal glue on target,
//! in-memory mocks on host). The crate already includes the portable
//! facilities that later layers may need, including sealing and image slots;
//! it does not decide whether an image assembles or exposes any one of them.
//!
//! # Two consumers, two contracts
//!
//! L0 has two intentionally different paths upward. A radio adaptation is
//! consumed by an L1 bearer binding. A peripheral adaptation is consumed by a
//! plugin through a named capability contract. They must not be collapsed:
//!
//! ```text
//! board wiring, buses, power, vendor driver, timing
//!                         |
//!                         v
//!                  L0 adaptation
//!                   /          \
//!                  v            v
//!       L1 bearer binding    L7 plugin capability
//!              |                    |
//!              v                    v
//!       L2 discovery ...      plugin-sourced L7 event
//! ```
//!
//! The left branch owns medium configuration, frame carriage, airtime and
//! connection lifecycle. The right branch owns a physical capability such as
//! a sensor, clock, display, storage device or actuator. A plugin invokes the
//! named capability operation; it never receives a GPIO number, bus, vendor
//! handle, board name, Layer 5 key or management credential. Conversely, an
//! L0 adaptation never receives a sentant identity and never emits an L7 event
//! itself. The plugin translates a capability outcome into an L7 event.
//!
//! This is the named non-adjacent contract permitted by the standard, not an
//! exemption from the layer boundary. A plugin that needs network data uses an
//! already-established service above L1; it does not select a radio or call a
//! bearer directly. See `standard/L0-hardware-and-runtime.md` 5.1 and 5.6,
//! and `standard/L7-application.md` 6.1.
//!
//! # Board-adapter pattern
//!
//! A board crate owns the concrete wiring and vendor driver, and exposes only
//! one of the portable traits or declaration values below. For example, a
//! radar adapter can implement [`Sensors`] and return [`Reading::Unsupported`]
//! when that board does not provide the requested quantity. A plugin can then
//! depend on the named sensor capability without knowing whether it is backed
//! by I2C, UART, SPI, a USB bridge, or no physical device at all.
//!
//! A platform declaration describes the assembled image, not the chip family.
//! Do not infer pins, radios, storage, or an enabled feature from a board
//! model name. Composer selects board adaptations and optional crates; the
//! resulting image declares only what it actually constructs.
//!
//! # Outcomes and ownership
//!
//! [`Reading`] distinguishes a fixed absence from a transient [`Fault`], so an
//! upper layer cannot accidentally retry an unsupported peripheral forever.
//! [`Storage`], [`Ruler`], [`Rng`], [`sealing::SealingFacility`] and [`ImageSlots`]
//! follow the same rule: they are portable contracts, not promises that every
//! platform supplies a particular hardware feature. A platform-specific
//! adapter classifies vendor failures at this boundary before those details can
//! leak into L1, L7, or a reusable plugin.
//!
//! no_std, zero dependencies.

#![no_std]
#![deny(unsafe_code)]

pub mod build_mode;
pub mod decl;
/// L0 8.4.1: publishing a declaration so a third party can read it
/// without possessing the platform.
pub mod publish;
pub mod rng;
pub mod sealing;
pub mod sensors;
pub mod sleep;
pub mod slots;
pub mod storage;
pub mod time;

pub use decl::{
    Availability, CapabilityClass, ClassCapacities, Discrepancy, ObservedCapacities, Parameter,
    PlatformDeclaration, UpdateSlots, WakeIntervals,
};
pub use rng::Rng;
pub use sensors::{Fault, Length, Quantity, Reading, Sensors};
pub use slots::{ImageSlots, SlotError, SlotId, SlotImage};
pub use storage::Storage;
pub use time::{Ruler, Ticks};
