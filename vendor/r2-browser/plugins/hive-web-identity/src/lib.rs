#![no_std]
#![forbid(unsafe_code)]

//! Application request binding for the website, shared by host and browser.
//!
//! This is not a TN bearer or a complete browser hive. The application binds
//! an attributed member to its own account and checks current roles separately.
//! Membership evidence and certificate encoding remain those of r2-trust,
//! including the existing provisional certificate format (SS489).

use r2_trust::{crypto::Digest, evidence::Freshness, suite::Sha256};

const DOMAIN: &[u8] = b"ai.reality2.web.request.v1\0";
/// Domain plus separate hashes of origin, method, exact path/query and body.
pub const STATEMENT_LEN: usize = DOMAIN.len() + 4 * 32;
/// A nonce freshness token adds its discriminator and sixteen bytes.
pub const SIGNING_LEN: usize = STATEMENT_LEN + 17;

#[derive(Debug, PartialEq, Eq)]
pub enum InvalidRequest {
    Origin,
    Method,
    Path,
    Body,
}

/// Bind the actual HTTP request bytes. No path normalization or JSON re-encoding
/// is permitted between construction and the answering boundary.
pub fn statement(
    origin: &str,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<[u8; STATEMENT_LEN], InvalidRequest> {
    if origin.is_empty() || origin.len() > 256 || origin.bytes().any(|b| b <= 32 || b == 127) {
        return Err(InvalidRequest::Origin);
    }
    if !matches!(method, "GET" | "POST") {
        return Err(InvalidRequest::Method);
    }
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 2048
        || path.bytes().any(|b| b <= 32 || b == 127 || b == b'#')
    {
        return Err(InvalidRequest::Path);
    }
    if body.len() > 65536 || (method == "GET" && !body.is_empty()) {
        return Err(InvalidRequest::Body);
    }
    let mut out = [0; STATEMENT_LEN];
    out[..DOMAIN.len()].copy_from_slice(DOMAIN);
    for (index, bytes) in [origin.as_bytes(), method.as_bytes(), path.as_bytes(), body]
        .iter()
        .enumerate()
    {
        let mut digest = [0; 32];
        Sha256::hash(bytes, &mut digest);
        let start = DOMAIN.len() + index * 32;
        out[start..start + 32].copy_from_slice(&digest);
    }
    Ok(out)
}

/// Exact L5 bytes a platform's Ed25519 signer signs for this nonce exchange.
pub fn signing_message(statement: &[u8; STATEMENT_LEN], nonce: [u8; 16]) -> [u8; SIGNING_LEN] {
    let mut bytes = [0; SIGNING_LEN];
    // These fixed sizes meet the shared encoder's bounds by construction.
    let written = r2_trust::evidence::signing_bytes(statement, Freshness::Nonce(nonce), &mut bytes);
    debug_assert_eq!(written, Some(SIGNING_LEN));
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_request_part_is_bound_without_normalizing_query_or_json() {
        let original = statement(
            "https://portal.test",
            "POST",
            "/api/settings?x=1",
            b"{\"x\":1}",
        )
        .unwrap();
        for changed in [
            statement(
                "https://other.test",
                "POST",
                "/api/settings?x=1",
                b"{\"x\":1}",
            ),
            statement("https://portal.test", "GET", "/api/settings?x=1", b""),
            statement(
                "https://portal.test",
                "POST",
                "/api/settings?x=2",
                b"{\"x\":1}",
            ),
            statement(
                "https://portal.test",
                "POST",
                "/api/settings?x=1",
                b"{\"x\":2}",
            ),
            statement(
                "https://portal.test",
                "POST",
                "/api/settings?x=1",
                b"{ \"x\":1}",
            ),
        ] {
            assert_ne!(original, changed.unwrap());
        }
        assert_ne!(
            signing_message(&original, [1; 16]),
            signing_message(&original, [2; 16])
        );
    }

    #[test]
    fn unsupported_requests_and_short_signer_buffers_refuse() {
        assert_eq!(statement("", "GET", "/", b""), Err(InvalidRequest::Origin));
        assert_eq!(
            statement("https://portal.test", "PUT", "/", b""),
            Err(InvalidRequest::Method)
        );
        assert_eq!(
            statement("https://portal.test", "GET", "//other", b""),
            Err(InvalidRequest::Path)
        );
        assert_eq!(
            statement("https://portal.test", "GET", "/", b"body"),
            Err(InvalidRequest::Body)
        );
        let mut short = [7; 16];
        assert_eq!(
            r2_trust::evidence::signing_bytes(b"", Freshness::Nonce([1; 16]), &mut short),
            None
        );
        assert_eq!(short, [7; 16]);
    }
}
