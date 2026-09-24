//! `Display` and, under the `std` feature, `std::error::Error`
//! implementations for this crate's error types.
//!
//! Additive only (r2-hive INTEGRATION.md section 4): enabling `std`
//! adds trait impls and changes no behaviour. Split with the crate
//! (`D-226` increment 2): the orphan rule puts each impl in the crate
//! that defines its type, so `SendError`'s half lives here and the
//! `DropReason`/`CustodyRefusal` half lives in `r2-routing`.

#[cfg(feature = "std")]
extern crate std;

use core::fmt;

use crate::l3::{CustodyRefusal, DropReason};

impl fmt::Display for DropReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            DropReason::HopExhausted => "hop limit reached zero after decrement",
            // ‼ THE WHOLE POINT OF THE SPLIT IS HERE. A poisoned drop and a
            // healthy one used to print the SAME line, so the failure had no
            // signature — indistinguishable from correct operation rather
            // than merely hard to spot (`d547`). These four strings are what
            // makes them distinguishable, so they must stay distinct even
            // when the wording is tidied.
            DropReason::Duplicate => "frame was already seen",
            DropReason::DuplicateOfVerifiedClaim => {
                "frame was already seen, on a claim verified here"
            }
            DropReason::DuplicateOfUnverifiedClaim => {
                "frame was already seen, on a claim that did not verify here"
            }
            // Not a defect signal: L3 5.1.2 obliges relay by a hive that
            // holds no key, so on such a relay this is EVERY frame.
            DropReason::DuplicateOfUnverifiableClaim => {
                "frame was already seen, on a claim this hive holds no key to verify"
            }
            DropReason::MissingOrigin => "frame type requires an origin and carries none",
            DropReason::OversizeReplication => "payload exceeds the replication size bound",
            DropReason::RateLimited => "origin exceeded its replication rate",
            DropReason::CeasedRelaying => "this hive has ceased relaying",
            DropReason::StructurallyUndeliverable => {
                "no bearer in service could ever carry this frame"
            }
        };
        f.write_str(s)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for DropReason {}

impl fmt::Display for CustodyRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            CustodyRefusal::Oversize => "frame is larger than a custody slot",
            // ‼ DISTINCT FROM EVERY TRANSIENT REASON (7.1.3), and the
            // wording says why: a bigger buffer fixes `Oversize` and
            // nothing fixes this one.
            CustodyRefusal::StructurallyUndeliverable => {
                "no bearer in service could ever carry this frame, so retaining it would hold it for a moment that cannot arrive"
            }
        };
        f.write_str(s)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for CustodyRefusal {}
