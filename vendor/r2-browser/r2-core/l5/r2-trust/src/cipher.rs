//! The payload cipher: **XChaCha20-Poly1305** (FORMATS 4.1,
//! `PROVISIONAL(STD-SS35)`).
//!
//! # What this closes, and it was a question from Roy rather than a gap in a table
//!
//! Asked directly what encryption the trust group uses, the honest answer
//! was **authenticated and not confidential**: [`crate::crypto::Aead`] was
//! specified with the key, nonce and tag lengths pinned, and it had
//! **zero implementors anywhere in the fleet**. The only trace of a cipher
//! was `chacha20poly1305` sitting in this crate's *dev-dependencies*,
//! referenced from no `.rs` file — **which reads like an implementation to
//! anyone auditing the manifest and is not one.**
//!
//! *A trait nothing implements is the same defect as a caller nothing
//! calls, one primitive over*, and this lane has now met that shape three
//! times: the tag verifier that could not be instantiated outside tests,
//! the gate that had no non-test caller, and this.
//!
//! # The known-answer vectors, and why they are not this implementation's own output
//!
//! **XChaCha20-Poly1305 has no authoritative specification.** The
//! RustCrypto crate says so in its own documentation and cites
//! `draft-arciszewski-xchacha-03`; FORMATS 4.1 pins the construction
//! regardless, which is a real qualification on the conformance claim and
//! is recorded rather than smoothed over.
//!
//! So the construction is anchored to **two published vectors that this
//! code cannot influence**, rather than to a transcript of its own output:
//!
//!   1. **RFC 8439 section 2.8.2** — the ChaCha20-Poly1305 AEAD vector,
//!      asserted in full: key, nonce, associated data, plaintext,
//!      ciphertext and tag.
//!   2. **`draft-arciszewski-xchacha-03` section 2.2.1** — the HChaCha20
//!      subkey vector, used as a **literal key** in the composition test
//!      below.
//!
//! XChaCha20-Poly1305 *is defined as* `ChaCha20-Poly1305` under
//! `HChaCha20(key, nonce[0..16])` with the inner nonce
//! `0x00000000 || nonce[16..24]`. The composition test seals through
//! [`XChaCha20Poly1305`](crate::cipher::XChaCha20Poly1305) and,
//! separately, through ChaCha20-Poly1305 keyed with **the draft's
//! published subkey bytes**, and requires the two to agree. *If the
//! extended-nonce path were wrong it would not equal a cipher keyed from
//! a constant the draft published*, and the subkey did not come from
//! here.
//!
//! **A direct XChaCha ciphertext vector was attempted first and abandoned
//! deliberately.** The recalled bytes did not match, and the one thing
//! that must never happen next is pasting the implementation's output back
//! in as the expected value — *that produces a test that agrees with the
//! code by construction*, which is precisely what the tag suite was right
//! to avoid. The composition route was taken instead because it reaches
//! the same guarantee from constants this file did not generate.
//!
//! **And the composition test is proven able to fail before it is
//! believed** (d178: *a null is not available until the case has been
//! shown able to fail*): flipping **one bit** of the published subkey
//! makes the two sides disagree, and so does moving the inner nonce by
//! one bit. *A test whose two sides agree for a reason other than the
//! property would pass under both.*
//!
//! **That control was in the wrong place first, and the correction is the
//! durable part.** It was measured in a throwaway program that reached
//! the cipher crate directly — which proved that *the crate's* two
//! constructions disagree under a perturbed subkey and said nothing about
//! whether [`XChaCha20Poly1305::seal`](crate::cipher::XChaCha20Poly1305::seal)
//! was in the path at all. **A known-positive must exercise the same
//! mechanism as the arm it validates; one from a different mechanism
//! validates nothing and reads as health.** It lives inside the test
//! now, on the same left-hand call, with only the constant moving.

use crate::crypto::{Aead, AEAD_KEY_LEN, AEAD_TAG_LEN, NONCE_LEN};

/// XChaCha20-Poly1305 (FORMATS 4.1): 256-bit key, 24-byte nonce, 16-byte
/// Poly1305 tag.
pub struct XChaCha20Poly1305;

impl Aead for XChaCha20Poly1305 {
    fn seal(
        key: &[u8; AEAD_KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        aad: &[u8],
        plaintext: &[u8],
        out: &mut [u8],
    ) -> Option<usize> {
        use chacha20poly1305::aead::{AeadInPlace, KeyInit};

        let total = plaintext.len().checked_add(AEAD_TAG_LEN)?;
        if out.len() < total {
            return None;
        }
        out[..plaintext.len()].copy_from_slice(plaintext);
        let tag = chacha20poly1305::XChaCha20Poly1305::new(key.into())
            .encrypt_in_place_detached(nonce.into(), aad, &mut out[..plaintext.len()])
            .ok()?;
        out[plaintext.len()..total].copy_from_slice(&tag);
        Some(total)
    }

    fn open(
        key: &[u8; AEAD_KEY_LEN],
        nonce: &[u8; NONCE_LEN],
        aad: &[u8],
        ciphertext: &[u8],
        out: &mut [u8],
    ) -> Option<usize> {
        use chacha20poly1305::aead::{AeadInPlace, KeyInit};

        // **A ciphertext shorter than the tag is refused rather than
        // subtracted**: a `len - 16` on a 3-byte input is the underflow
        // that turns a truncated frame into a panic or a huge slice.
        let body = ciphertext.len().checked_sub(AEAD_TAG_LEN)?;
        if out.len() < body {
            return None;
        }
        let (ct, tag) = ciphertext.split_at(body);
        out[..body].copy_from_slice(ct);
        match chacha20poly1305::XChaCha20Poly1305::new(key.into()).decrypt_in_place_detached(
            nonce.into(),
            aad,
            &mut out[..body],
            tag.into(),
        ) {
            Ok(()) => Some(body),
            Err(_) => {
                // **`out` is zeroed on failure, and the reason is a caller
                // that ignores the `None`.** The underlying construction
                // verifies before it decrypts, so nothing here has ever
                // held plaintext — but it does hold the *ciphertext* this
                // function copied in, and a caller reading a buffer after
                // a refusal should get neither. **A failure is never
                // distinguished by reason** (the trait says so), and a
                // buffer whose contents differ by failure mode
                // distinguishes it just as well as a return value would.
                out[..body].fill(0);
                None
            }
        }
    }
}

/// **THE PUBLISHED KNOWN-ANSWER VECTORS AND THE TESTS THAT READ THEM.**
///
/// **`pub` and compiled under the `payload-cipher` feature as well as under
/// `test`, since 2026-08-09.** The constants were `#[cfg(test)]`-only, so a
/// hive that must run a cipher known-answer test **at boot on the target**
/// could not reach them — and the alternative, transcribing a second copy
/// into firmware, is *two copies of one vector*: **they agree until one is
/// edited, and nothing compares them.**
///
/// **Nothing moved and nothing was duplicated.** The tests below read the
/// same constants a board reads. *One copy, two consumers.*
///
/// # What a boot test using these proves, and what it does not
///
/// **RFC 8439 section 2.8.2 is ChaCha20-Poly1305 with a TWELVE-byte nonce
/// and this cipher takes TWENTY-FOUR**, so it is applied *through the
/// composition* rather than directly. **A boot known-answer test therefore
/// proves the composition reproduces a published answer — NOT that XChaCha
/// itself matches a vendor vector**, because none was findable and the
/// abandoned attempt is recorded in this file's header. *A console line
/// quoting these must say which of the two it demonstrates.*
#[cfg(any(test, feature = "payload-cipher"))]
pub mod known_answer {
    // **`super::*` is needed only by the tests**, which are the sole users of
    // the cipher types in here; the VECTORS are plain byte arrays and pull in
    // nothing. Gated so a firmware build carries the constants and not an
    // unused import.
    #[cfg(test)]
    use super::*;

    /// RFC 8439 section 2.8.2, in full. **The nonce here is 12 bytes and
    /// this cipher takes 24**, so the vector is applied through the
    /// composition below rather than directly; it is asserted on its own
    /// first because *a composition anchored to an unchecked half is
    /// anchored to nothing.*
    pub const RFC8439_KEY: [u8; 32] = [
        0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e,
        0x8f, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d,
        0x9e, 0x9f,
    ];
    pub const RFC8439_NONCE: [u8; 12] = [
        0x07, 0x00, 0x00, 0x00, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47,
    ];
    pub const RFC8439_AAD: [u8; 12] = [
        0x50, 0x51, 0x52, 0x53, 0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7,
    ];
    pub const RFC8439_PLAINTEXT: &[u8] = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    pub const RFC8439_CIPHERTEXT: [u8; 114] = [
        0xd3, 0x1a, 0x8d, 0x34, 0x64, 0x8e, 0x60, 0xdb, 0x7b, 0x86, 0xaf, 0xbc, 0x53, 0xef, 0x7e,
        0xc2, 0xa4, 0xad, 0xed, 0x51, 0x29, 0x6e, 0x08, 0xfe, 0xa9, 0xe2, 0xb5, 0xa7, 0x36, 0xee,
        0x62, 0xd6, 0x3d, 0xbe, 0xa4, 0x5e, 0x8c, 0xa9, 0x67, 0x12, 0x82, 0xfa, 0xfb, 0x69, 0xda,
        0x92, 0x72, 0x8b, 0x1a, 0x71, 0xde, 0x0a, 0x9e, 0x06, 0x0b, 0x29, 0x05, 0xd6, 0xa5, 0xb6,
        0x7e, 0xcd, 0x3b, 0x36, 0x92, 0xdd, 0xbd, 0x7f, 0x2d, 0x77, 0x8b, 0x8c, 0x98, 0x03, 0xae,
        0xe3, 0x28, 0x09, 0x1b, 0x58, 0xfa, 0xb3, 0x24, 0xe4, 0xfa, 0xd6, 0x75, 0x94, 0x55, 0x85,
        0x80, 0x8b, 0x48, 0x31, 0xd7, 0xbc, 0x3f, 0xf4, 0xde, 0xf0, 0x8e, 0x4b, 0x7a, 0x9d, 0xe5,
        0x76, 0xd2, 0x65, 0x86, 0xce, 0xc6, 0x4b, 0x61, 0x16,
    ];
    pub const RFC8439_TAG: [u8; 16] = [
        0x1a, 0xe1, 0x0b, 0x59, 0x4f, 0x09, 0xe2, 0x6a, 0x7e, 0x90, 0x2e, 0xcb, 0xd0, 0x60, 0x06,
        0x91,
    ];

    /// `draft-arciszewski-xchacha-03` section 2.2.1: HChaCha20 of the key
    /// `00..1f` under the 16-byte input below. **These bytes are the
    /// draft's output, typed in here — not read out of this crate.**
    pub const DRAFT_KEY: [u8; 32] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f,
    ];
    pub const DRAFT_HCHACHA_INPUT: [u8; 16] = [
        0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x4a, 0x00, 0x00, 0x00, 0x00, 0x31, 0x41, 0x59,
        0x27,
    ];
    pub const DRAFT_SUBKEY: [u8; 32] = [
        0x82, 0x41, 0x3b, 0x42, 0x27, 0xb2, 0x7b, 0xfe, 0xd3, 0x0e, 0x42, 0x50, 0x8a, 0x87, 0x7d,
        0x73, 0xa0, 0xf9, 0xe4, 0xd5, 0x8a, 0x74, 0xa8, 0x53, 0xc1, 0x2e, 0xc4, 0x13, 0x26, 0xd3,
        0xec, 0xdc,
    ];

    /// Reference seal through **ChaCha20-Poly1305**, the 12-byte-nonce
    /// construction RFC 8439 specifies. Writes `ciphertext || tag` into
    /// `out` and returns the length. *No `alloc` here: this crate is
    /// `no_std` and the tests stay inside that constraint rather than
    /// enabling a feature to be convenient.*
    // **`cfg(test)`, not `pub`, and that asymmetry is deliberate.** The
    // VECTORS are what a board needs; this helper is the reference seal the
    // host tests compare against, and shipping it would put a second
    // ChaCha20-Poly1305 implementation in a firmware image whose whole point
    // is to exercise the first one. *A known-answer test that carries its
    // own oracle is comparing an implementation with itself.*
    #[cfg(test)]
    fn chacha20poly1305_seal<'o>(
        key: &[u8; 32],
        nonce: &[u8; 12],
        aad: &[u8],
        pt: &[u8],
        out: &'o mut [u8],
    ) -> &'o [u8] {
        use chacha20poly1305::aead::{AeadInPlace, KeyInit};
        let total = pt.len() + AEAD_TAG_LEN;
        out[..pt.len()].copy_from_slice(pt);
        let tag = chacha20poly1305::ChaCha20Poly1305::new(key.into())
            .encrypt_in_place_detached(nonce.into(), aad, &mut out[..pt.len()])
            .expect("seals");
        out[pt.len()..total].copy_from_slice(&tag);
        &out[..total]
    }

    #[test]
    fn rfc_8439_section_2_8_2_reproduces() {
        let mut buf = [0u8; 160];
        let got = chacha20poly1305_seal(
            &RFC8439_KEY,
            &RFC8439_NONCE,
            &RFC8439_AAD,
            RFC8439_PLAINTEXT,
            &mut buf,
        );
        assert_eq!(&got[..114], &RFC8439_CIPHERTEXT, "RFC 8439 ciphertext");
        assert_eq!(&got[114..], &RFC8439_TAG, "RFC 8439 tag");
    }

    /// The anchor for the extended nonce. `XChaCha20Poly1305` under a
    /// 24-byte nonce must equal `ChaCha20Poly1305` keyed with **the
    /// draft's published subkey** under `0x00000000 || nonce[16..24]`.
    ///
    /// **The subkey is a constant from the draft, so this is not the
    /// implementation checked against itself.** If the HChaCha20 stage
    /// were wrong — a swapped word, a truncated input, the wrong sixteen
    /// nonce bytes — the two sides would disagree, because only one of
    /// them derives a subkey at all.
    /// **THE CONDITION THAT MAKES THE RE-EXPORT WORTH ANYTHING: the
    /// derivation a consumer can call and the one the shipped seal uses
    /// internally are THE SAME CODE.**
    ///
    /// **Asserted BEHAVIOURALLY rather than by reading the lockfile.** A
    /// version check would say two crates resolve to one entry today; this
    /// says the bytes agree. *If a future lockfile ever permitted two
    /// `chacha20` versions to coexist, a known-answer test against the
    /// re-export would pass against a function nothing calls — which is the
    /// oracle defect wearing its fourth costume, and the reason this test
    /// exists rather than a comment.*
    ///
    /// The proof is composition: derive the subkey with the **re-exported**
    /// function, seal with plain ChaCha20-Poly1305 under it, and require
    /// byte equality with [`XChaCha20Poly1305`] sealing the same plaintext
    /// under the full 24-byte nonce. **They can only agree if the shipped
    /// cipher extended the nonce exactly as the re-export did.**
    #[test]
    fn the_re_exported_derivation_is_the_one_the_seal_uses() {
        use crate::cipher::hchacha20_subkey;
        const KEY: [u8; 32] = [7u8; 32];
        const NONCE24: [u8; 24] = [3u8; 24];
        const PT: &[u8] = b"the subkey a consumer computes must be the one the seal used";
        const AAD: &[u8] = b"aad";

        // The re-export, and the published vector it is checked against.
        assert_eq!(
            hchacha20_subkey(&DRAFT_KEY, &DRAFT_HCHACHA_INPUT),
            DRAFT_SUBKEY,
            "the re-exported derivation does not reproduce the draft's vector"
        );

        // Path A: the shipped seal, full 24-byte nonce.
        let mut a = [0u8; 128];
        let n = XChaCha20Poly1305::seal(&KEY, &NONCE24, AAD, PT, &mut a).expect("shipped seal");

        // Path B: derive with the RE-EXPORT, then seal with the 12-byte
        // construction under `0x00000000 || nonce[16..24]`.
        let sub = hchacha20_subkey(&KEY, NONCE24[..16].try_into().unwrap());
        let mut inner = [0u8; 12];
        inner[4..].copy_from_slice(&NONCE24[16..]);
        let mut b = [0u8; 128];
        let composed = chacha20poly1305_seal(&sub, &inner, AAD, PT, &mut b);

        assert_eq!(
            &a[..n],
            composed,
            "the re-exported derivation and the shipped seal disagree, so a \
             known-answer test against the re-export would prove nothing about \
             the cipher that ships"
        );
    }

    #[test]
    fn xchacha_is_the_published_hchacha_subkey_composed_with_chacha20poly1305() {
        let tail: [u8; 8] = [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47];
        let mut nonce24 = [0u8; NONCE_LEN];
        nonce24[..16].copy_from_slice(&DRAFT_HCHACHA_INPUT);
        nonce24[16..].copy_from_slice(&tail);
        let mut nonce12 = [0u8; 12];
        nonce12[4..].copy_from_slice(&tail);

        let aad = b"associated data";
        let pt = b"the composition identity, checked rather than asserted";

        let mut sealed = [0u8; 128];
        let n = XChaCha20Poly1305::seal(&DRAFT_KEY, &nonce24, aad, pt, &mut sealed).expect("seals");
        let mut rbuf = [0u8; 128];
        let reference = chacha20poly1305_seal(&DRAFT_SUBKEY, &nonce12, aad, pt, &mut rbuf);

        assert_eq!(
            &sealed[..n],
            reference,
            "XChaCha20-Poly1305 must equal ChaCha20-Poly1305 under the draft's subkey"
        );

        // **THE KNOWN-POSITIVE, AND IT RUNS THROUGH THE SAME CALLS AS THE
        // ASSERTION ABOVE.** The first version of this control lived in a
        // throwaway program that reached the cipher crate directly — so it
        // proved that *the crate's* two constructions disagree under a
        // perturbed subkey, and said nothing about whether
        // `XChaCha20Poly1305::seal` was in the path at all. *A
        // known-positive from a different mechanism than the arm it
        // validates reads as health and validates nothing.* Left side is
        // this module's `seal`, exactly as above; only the constant moves.
        let mut one_bit_off = DRAFT_SUBKEY;
        one_bit_off[0] ^= 0x01;
        let mut wbuf = [0u8; 128];
        assert_ne!(
            &sealed[..n],
            chacha20poly1305_seal(&one_bit_off, &nonce12, aad, pt, &mut wbuf),
            "one bit off the published subkey must break the agreement"
        );

        // …and the inner nonce is the other half of the composition, so it
        // gets its own arm rather than being assumed to travel with the
        // subkey.
        let mut moved_nonce = nonce12;
        moved_nonce[11] ^= 0x01;
        let mut mbuf = [0u8; 128];
        assert_ne!(
            &sealed[..n],
            chacha20poly1305_seal(&DRAFT_SUBKEY, &moved_nonce, aad, pt, &mut mbuf),
            "one bit off the inner nonce must break the agreement"
        );
    }

    #[test]
    fn seal_then_open_round_trips_and_the_plaintext_is_recovered() {
        let key = [0x11u8; AEAD_KEY_LEN];
        let nonce = [0x22u8; NONCE_LEN];
        let pt = b"a measurement";
        let mut sealed = [0u8; 64];
        let n = XChaCha20Poly1305::seal(&key, &nonce, b"aad", pt, &mut sealed).unwrap();
        assert_eq!(n, pt.len() + AEAD_TAG_LEN);
        let mut opened = [0u8; 64];
        let m = XChaCha20Poly1305::open(&key, &nonce, b"aad", &sealed[..n], &mut opened).unwrap();
        assert_eq!(&opened[..m], pt);
    }

    /// **The empty-input falsifier, both halves.** A zero-length plaintext
    /// must still seal — to exactly the tag — and must still open. *An
    /// AEAD that quietly succeeds on nothing is the vacuity class in a
    /// cipher*, and the seal side is where it would be introduced.
    #[test]
    fn a_zero_length_plaintext_seals_to_the_tag_alone_and_opens_back() {
        let key = [0x33u8; AEAD_KEY_LEN];
        let nonce = [0x44u8; NONCE_LEN];
        let mut sealed = [0u8; 32];
        let n = XChaCha20Poly1305::seal(&key, &nonce, b"aad", b"", &mut sealed).unwrap();
        assert_eq!(n, AEAD_TAG_LEN, "an empty plaintext seals to the tag alone");
        let mut opened = [0u8; 32];
        let m = XChaCha20Poly1305::open(&key, &nonce, b"aad", &sealed[..n], &mut opened).unwrap();
        assert_eq!(m, 0);
    }

    /// **Two different inputs must not produce one output** — the
    /// falsifier that found every instance of the caller-supplied-span
    /// defect. Here it is run over the associated data, because the AAD is
    /// the operand a caller supplies and therefore the one that can be
    /// dropped without the call failing.
    #[test]
    fn two_different_aads_never_produce_one_output() {
        let key = [0x55u8; AEAD_KEY_LEN];
        let nonce = [0x66u8; NONCE_LEN];
        let pt = b"identical plaintext";
        let mut a = [0u8; 64];
        let mut b = [0u8; 64];
        let na = XChaCha20Poly1305::seal(&key, &nonce, b"origin-A", pt, &mut a).unwrap();
        let nb = XChaCha20Poly1305::seal(&key, &nonce, b"origin-B", pt, &mut b).unwrap();
        assert_eq!(na, nb);
        assert_ne!(a[..na], b[..nb], "the AAD must reach the tag");
        // And the empty AAD is a third distinct value, not a synonym for
        // either — the case a `sink` that emitted nothing would produce.
        let mut c = [0u8; 64];
        let nc = XChaCha20Poly1305::seal(&key, &nonce, b"", pt, &mut c).unwrap();
        assert_ne!(a[..na], c[..nc]);
        assert_ne!(b[..nb], c[..nc]);
    }

    #[test]
    fn an_altered_aad_refuses_to_open_and_leaves_no_plaintext() {
        let key = [0x77u8; AEAD_KEY_LEN];
        let nonce = [0x88u8; NONCE_LEN];
        let pt = b"a measurement";
        let mut sealed = [0u8; 64];
        let n = XChaCha20Poly1305::seal(&key, &nonce, b"origin-A", pt, &mut sealed).unwrap();
        let mut opened = [0xEEu8; 64];
        assert!(
            XChaCha20Poly1305::open(&key, &nonce, b"origin-B", &sealed[..n], &mut opened).is_none()
        );
        assert!(
            opened[..pt.len()].iter().all(|&b| b == 0),
            "a refused open leaves neither plaintext nor ciphertext behind"
        );
    }

    #[test]
    fn an_altered_ciphertext_refuses_and_so_does_an_altered_tag() {
        let key = [0x99u8; AEAD_KEY_LEN];
        let nonce = [0xAAu8; NONCE_LEN];
        let pt = b"a measurement";
        let mut sealed = [0u8; 64];
        let n = XChaCha20Poly1305::seal(&key, &nonce, b"aad", pt, &mut sealed).unwrap();
        let mut opened = [0u8; 64];

        let mut body = sealed;
        body[0] ^= 0xFF;
        assert!(XChaCha20Poly1305::open(&key, &nonce, b"aad", &body[..n], &mut opened).is_none());

        let mut tag = sealed;
        tag[n - 1] ^= 0xFF;
        assert!(XChaCha20Poly1305::open(&key, &nonce, b"aad", &tag[..n], &mut opened).is_none());
    }

    /// A wrong nonce is a wrong key as far as opening goes, and it is
    /// asserted separately because **the nonce is the operand with no
    /// precedent in this lane's other primitives** — nothing else here
    /// takes a per-message value that must never repeat.
    #[test]
    fn a_wrong_nonce_refuses() {
        let key = [0xBBu8; AEAD_KEY_LEN];
        let mut sealed = [0u8; 64];
        let n =
            XChaCha20Poly1305::seal(&key, &[0x01; NONCE_LEN], b"aad", b"pt", &mut sealed).unwrap();
        let mut opened = [0u8; 64];
        assert!(XChaCha20Poly1305::open(
            &key,
            &[0x02; NONCE_LEN],
            b"aad",
            &sealed[..n],
            &mut opened
        )
        .is_none());
    }

    /// Short buffers refuse rather than truncate or underflow — including
    /// a "ciphertext" shorter than the tag, which is the subtraction that
    /// would wrap.
    #[test]
    fn short_buffers_refuse() {
        let key = [0xCCu8; AEAD_KEY_LEN];
        let nonce = [0xDDu8; NONCE_LEN];
        let mut small = [0u8; 4];
        assert!(XChaCha20Poly1305::seal(&key, &nonce, b"", b"plaintext", &mut small).is_none());
        let mut out = [0u8; 64];
        assert!(XChaCha20Poly1305::open(&key, &nonce, b"", &[0u8; 3], &mut out).is_none());
        assert!(XChaCha20Poly1305::open(&key, &nonce, b"", &[], &mut out).is_none());
    }
}

/// **The XChaCha20 nonce-extension step, RE-EXPORTED so a consumer can run a
/// known-answer test against a published vector.**
///
/// # Why this is a re-export and not an implementation
///
/// **This crate does not implement HChaCha20 and must not start.** The
/// derivation lives in `chacha20`, which is what `chacha20poly1305` uses
/// internally for [`XChaCha20Poly1305`]. **Writing one here would mean a
/// boot known-answer test verified a function the sealing path never
/// calls** — worse than the oracle problem it was meant to solve, because
/// the test would pass while the shipped cipher went unchecked.
///
/// # What it is for, and the bound on what a test using it proves
///
/// `draft-arciszewski-xchacha-03` section 2.2.1 publishes a vector for this
/// step, and [`known_answer::DRAFT_KEY`] with
/// [`known_answer::DRAFT_HCHACHA_INPUT`] must give
/// [`known_answer::DRAFT_SUBKEY`]. **That checks the nonce extension against
/// bytes this project did not compute.** *It does NOT check that
/// ChaCha20-Poly1305's core reproduces RFC 8439 — that vector has a
/// twelve-byte nonce and the shipped seal takes twenty-four, so it cannot
/// reach it.* **A consumer quoting this must say which half it demonstrates.**
///
/// # It is NOT a key-derivation function
///
/// **Actual key derivation in this crate is HKDF under the `FORMATS` 4a
/// purpose strings, in [`crate::derive`], and 4a.4 forbids a string outside
/// that table.** *This is the nonce-extension step of one cipher, exposed
/// for one test, and reaching for it as a general KDF would bypass the
/// purpose-string discipline entirely.*
#[cfg(feature = "payload-cipher")]
pub fn hchacha20_subkey(key: &[u8; 32], input: &[u8; 16]) -> [u8; 32] {
    chacha20::hchacha::<chacha20::cipher::consts::U10>(key.into(), input.into()).into()
}
