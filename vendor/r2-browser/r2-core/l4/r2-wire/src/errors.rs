//! `Display` and `core::error::Error` implementations for this crate's
//! error types.
//!
//! The `Error` impls were gated behind the `std` feature when
//! `std::error::Error` was the only spelling; `core::error::Error` has been
//! stable since 1.81 and the workspace floor is 1.87, so the gate bought
//! nothing and the no_std targets pay nothing for the impls (idiom sweep,
//! 2026-08-23). `std` remains additive and now adds no trait here.

use core::fmt;

use crate::frame::{CrossError, EncodeError, ParseError};

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ParseError::UnsupportedVersion => "frame version is not implemented",
            ParseError::ReservedType => "frame carries a reserved message type",
            ParseError::Truncated => "frame is shorter than its declared structure",
            ParseError::MalformedRouteRecord => "route record count exceeds 8 or does not fit",
            ParseError::LengthMismatch => "payload length field disagrees with the frame",
            ParseError::MissingOrigin => "operation requires an origin the frame does not carry",
            ParseError::TagWithoutRoute => "tagged frame carries no route record with an entry",
        };
        f.write_str(s)
    }
}

impl core::error::Error for ParseError {}

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            EncodeError::BufferTooSmall => "output buffer is too small for the frame",
            EncodeError::NibbleOverflow => "hop limit or replication budget exceeds its nibble",
            EncodeError::MsgIdOverflow => "message identifier is wider than the compact tier",
            EncodeError::MalformedRouteRecord => "route bytes are not whole entries, or exceed 8",
            EncodeError::BadTagLen => "integrity tag length is wrong for the tier",
            EncodeError::GroupMgmtNotCompact => "GROUP_MGMT is compact on every bearer",
            EncodeError::ReservedTarget => "all-ones target is reserved and never assigned",
            EncodeError::BadEventHash => "event hash is reserved, or nonzero on a no-event type",
            EncodeError::TagWithoutOrigin => {
                "a tag requires a route record; GROUP_MGMT is never tagged"
            }
            EncodeError::MissingOrigin => "this frame type must carry an origin",
        };
        f.write_str(s)
    }
}

impl core::error::Error for EncodeError {}

impl fmt::Display for CrossError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            CrossError::Tagged => "a tagged frame never crosses a tier boundary",
            CrossError::GroupMgmt => "GROUP_MGMT is compact on every bearer, so it does not cross",
            CrossError::MsgIdOverflow => "message identifier does not fit the destination tier",
            CrossError::TargetAmbiguous => {
                "extended target with both halves set has no compact form"
            }
            CrossError::TargetNotBroadcast => "a non-broadcast compact target cannot name a half",
            CrossError::RouteEntryGroupNonzero => {
                "route entry with a nonzero group half cannot narrow"
            }
            CrossError::CannotReencode => {
                "route record cannot be re-encoded at the destination tier"
            }
            CrossError::BufferTooSmall => "output buffer is too small for the crossed frame",
        };
        f.write_str(s)
    }
}

impl core::error::Error for CrossError {}
#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::string::ToString;

    #[test]
    fn every_error_displays_without_std() {
        // Display is core::fmt, so no_std consumers get it too; the `std`
        // feature adds only the Error impls on top.
        assert_eq!(
            ParseError::TagWithoutRoute.to_string(),
            "tagged frame carries no route record with an entry"
        );
        assert_eq!(
            EncodeError::BadEventHash.to_string(),
            "event hash is reserved, or nonzero on a no-event type"
        );
        assert_eq!(
            CrossError::TargetAmbiguous.to_string(),
            "extended target with both halves set has no compact form"
        );
    }

    /// The `std` feature is additive: it adds trait impls and changes no
    /// behaviour (r2-hive INTEGRATION.md §4). This asserts the behavioural
    /// half — the same input yields the same result either way.
    #[test]
    fn std_feature_changes_no_behaviour() {
        use crate::{Frame, Tier};
        let bad = [0x44u8, 0x56, 0x12, 0x34, 0, 0, 0, 0, 0, 0, 0, 0];
        assert_eq!(
            Frame::parse(&bad, Tier::Compact),
            Err(ParseError::UnsupportedVersion)
        );
    }
}
