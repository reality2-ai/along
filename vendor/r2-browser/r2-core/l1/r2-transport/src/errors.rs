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

use crate::l1::SendError;

impl fmt::Display for SendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            SendError::Oversize => "frame exceeds the bearer's maximum transport unit payload",
            SendError::Unavailable => "bearer cannot carry now",
            SendError::Failed => "bearer has failed and needs intervention",
            SendError::ReceiveOnly => "bearer is receive-only in this assembly",
            SendError::NotCarried => "bearer is restricted and does not carry this peer",
            SendError::UnknownPeer => "peer is not addressable on this bearer",
        };
        f.write_str(s)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for SendError {}
