//! `Display` and, under the `std` feature, `std::error::Error`
//! implementations for this crate's error types.
//!
//! Additive only (r2-hive INTEGRATION.md section 4): enabling `std`
//! adds trait impls and changes no behaviour. A third consumer arrived
//! with d017 (r2-android) that is std-based and not Rust-native, so the
//! error types need to interoperate with `std` error handling without
//! the no_std targets paying for it.

#[cfg(feature = "std")]
extern crate std;

use core::fmt;

use crate::evidence::EvidenceRefusal;
use crate::membership::ClaimRefusal;

impl fmt::Display for ClaimRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ClaimRefusal::AlreadyOwner => "a claim proceeds only from OPEN",
            ClaimRefusal::Indeterminate => "claim record is unreadable; local action only",
        };
        f.write_str(s)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for ClaimRefusal {}

impl fmt::Display for EvidenceRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            EvidenceRefusal::WrongGroup => "certificate is not for the verifying group",
            EvidenceRefusal::CertificateNotAuthentic => "certificate does not verify under the group key",
            EvidenceRefusal::CertificateNotCurrent => "certificate is stale beyond acceptance depth, or revoked",
            EvidenceRefusal::SignatureInvalid => "member signature does not verify",
            EvidenceRefusal::NonceMismatch => "freshness nonce is not the one issued for this exchange",
            EvidenceRefusal::NotFresh => "freshness token does not exceed the high-water mark",
            EvidenceRefusal::StatementTooLong => "statement is longer than this build attests over; it was silently truncated before, so a signature covered only a prefix",
        };
        f.write_str(s)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for EvidenceRefusal {}
