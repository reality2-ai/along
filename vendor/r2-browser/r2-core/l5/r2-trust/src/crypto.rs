//! Cryptographic primitives as traits.
//!
//! The concrete suite is the formats companion's and every choice in it is
//! `PROVISIONAL` (FORMATS.md Clause 3 and 4, settling STD-SS23 and STD-SS35). Taking
//! the primitives through traits keeps the swap on ruling to one site —
//! the implementation the consumer supplies — and lets a target substitute
//! hardware acceleration for the software path (FORMATS 8.2).

/// Length of an identity public key: Ed25519 (FORMATS 3.1,
/// `PROVISIONAL(STD-SS23)`).
pub const IDENTITY_LEN: usize = 32;
/// Length of an identity signature: Ed25519 (FORMATS 3.1,
/// `PROVISIONAL(STD-SS23)`).
pub const SIGNATURE_LEN: usize = 64;
/// Digest length of the wire-identity hash: SHA-256 (FORMATS 3.3,
/// `PROVISIONAL(STD-SS23)`).
pub const DIGEST_LEN: usize = 32;
/// AEAD nonce length: XChaCha20-Poly1305 (FORMATS 4.1,
/// `PROVISIONAL(STD-SS35)`).
pub const NONCE_LEN: usize = 24;
/// AEAD tag length: Poly1305 (FORMATS 4.1, `PROVISIONAL(STD-SS35)`).
pub const AEAD_TAG_LEN: usize = 16;
/// AEAD key length (FORMATS 4.1, `PROVISIONAL(STD-SS35)`).
pub const AEAD_KEY_LEN: usize = 32;

/// The hash behind wire-identity derivation (FORMATS 3.3).
pub trait Digest {
    /// Hash `input`, writing the full digest.
    fn hash(input: &[u8], out: &mut [u8; DIGEST_LEN]);
}

/// Incremental form of a digest, for images that exceed available RAM.
/// The digest covers the concatenation of all `update` inputs, including
/// when the final input is shorter than the others. No allocation is required.
pub trait StreamingDigest: Sized {
    fn new() -> Self;
    fn update(&mut self, input: &[u8]);
    fn finish(self, out: &mut [u8; DIGEST_LEN]);
}

/// Signature verification. Verification is a *proof* operation: it succeeds
/// or it does not, and nothing about it is probabilistic (00-overview
/// Clause 4 — proof at the boundary, belief everywhere else).
pub trait Verifier {
    /// True where `signature` is a valid signature over `message` under
    /// `identity`. Implementations return false on any malformed input
    /// rather than panicking.
    fn verify(
        identity: &[u8; IDENTITY_LEN],
        message: &[u8],
        signature: &[u8; SIGNATURE_LEN],
    ) -> bool;
}

/// Signing, held only by a party with the private half. A member that holds
/// no private key implements nothing here — the type system is the first
/// line of the key-holder distinction.
pub trait Signer {
    fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN];
    /// The public identity corresponding to this signer.
    fn identity(&self) -> [u8; IDENTITY_LEN];
}

/// Authenticated encryption with associated data (FORMATS 4.1).
pub trait Aead {
    /// Seal `plaintext` under `key` with `nonce` and `aad`, writing
    /// `ciphertext || tag` into `out`. Returns the written length, or
    /// `None` where `out` is too small.
    fn seal(
        key: &[u8; AEAD_KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        aad: &[u8],
        plaintext: &[u8],
        out: &mut [u8],
    ) -> Option<usize>;

    /// Open `ciphertext || tag` under `key`, `nonce` and `aad`, writing the
    /// plaintext into `out`. Returns the plaintext length, or `None` where
    /// authentication fails — a failure is never distinguished by reason.
    fn open(
        key: &[u8; AEAD_KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        aad: &[u8],
        ciphertext: &[u8],
        out: &mut [u8],
    ) -> Option<usize>;
}

/// Constant-time equality for secret-dependent comparisons (L4 10.1.3
/// requires it of tag verification; the same discipline applies to every
/// comparison whose result must not leak by timing).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    core::hint::black_box(diff) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_matches_equality() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"ab"));
        assert!(ct_eq(b"", b""));
    }
}
