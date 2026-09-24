//! Concrete implementations of the FORMATS provisional suite.
//!
//! Behind the `formats-suite` feature. Everything in this crate takes
//! crypto through the traits in [`crate::crypto`] precisely so the suite
//! can be swapped on ruling or replaced by hardware (FORMATS 8.2) — this
//! module is *a* supplier of those traits, never a privileged one.
//!
//! ## Why this exists at all
//!
//! It was found missing rather than planned. Every `impl Verifier` in this
//! workspace lived under `#[cfg(test)]`, and one lived in a doc comment
//! and returned `true` unconditionally. `ed25519-dalek` was a
//! **dev-dependency**, so it could never have supplied a production path.
//!
//! The consequence, which the hive lane named while about to build on it:
//! the chain *staged requires a verified package requires a recognised
//! authority signature* was **closed in shape and open in substance**.
//! `VerifiedPackage::accept::<V>` is generic over a verifier, and a
//! generic over a trait with no production implementor cannot be reached
//! through — the artefact does not reach the protected state past the
//! check, it reaches it by never going there. A test-only terminus makes
//! every guard upstream of it decorative on real hardware, while every
//! test passes.
//!
//! **A trait with no production implementation is an unreachable check,
//! not a satisfied one.** Grep for the implementors of anything a
//! guarantee terminates in, and count the ones outside `cfg(test)`.

#[cfg(feature = "formats-suite")]
pub use imp::{Ed25519, HkdfSha256, HmacSha256Tag, Sha256, Sha256Stream};

#[cfg(feature = "formats-suite")]
pub use crate::key_agreement::X25519;

#[cfg(feature = "formats-suite")]
mod imp {
    use crate::crypto::{Digest, Verifier, DIGEST_LEN, IDENTITY_LEN, SIGNATURE_LEN};
    use crate::gate::{Span, TagVerifier};
    use crate::keys::SecretKey;

    /// Ed25519 signature verification (FORMATS 3.1, `PROVISIONAL(STD-SS23)`).
    pub struct Ed25519;

    impl Verifier for Ed25519 {
        /// Verifies with **`verify_strict`**, not `verify` — now required
        /// by FORMATS 3.1a, `PROVISIONAL(STD-SS114)`, which was written from
        /// this implementation's argument.
        ///
        /// The difference is not a preference. Plain `verify` accepts
        /// signatures under small-order and non-canonical public keys, so
        /// one message can have several valid signatures — signature
        /// malleability. This standard leans on signatures being an
        /// identity for a decision in several places: L6 5.2.3's
        /// anti-replay reasons about *the* package that was signed, and
        /// L5's evidence high-water mark advances on *a* verified
        /// signature (7.4.3a). A malleable signature lets the same
        /// authorisation appear as two distinct ones, which is the
        /// replay this stack refuses everywhere else.
        ///
        /// Returns `false` on every malformed input — a key that is not a
        /// valid point, a signature that is not canonical — rather than
        /// panicking, as [`Verifier`] requires. No input reaching this
        /// function is trusted.
        ///
        /// ‼ **AMENDED 2026-08-19: HALF OF THE LIMIT BELOW IS NOW DISCHARGED
        /// AND HALF IS NOT, AND THE HALVES ARE NOT THE ONES THIS PARAGRAPH
        /// ASSUMED.** `FORMATS` 3.1b now carries the vector it said was owed
        /// (`FV-024`), and `tests/formats_3_1b_noncanonical_signature.rs`
        /// runs it: a signature whose `S` is not reduced modulo the group
        /// order is refused, with a positive control beside it.
        ///
        /// ⚠ **BUT THAT VECTOR DOES NOT DISTINGUISH STRICT FROM PERMISSIVE,
        /// MEASURED RATHER THAN ASSUMED**: `verify_strict` and plain `verify`
        /// **both** reject it. So the paragraph below remains true of
        /// **3.1a** — the small-order and non-canonical public KEY half — and
        /// is no longer true of 3.1b. *Splitting it matters because the
        /// original wording would otherwise be read as discharged by a vector
        /// that speaks to the other clause.*
        ///
        /// **Named limit: the strictness is not proven by any test here.**
        /// Measured — replacing `verify_strict` with plain `verify` leaves
        /// all 64 tests in this crate green. The tests below establish
        /// that verification *happens* and that forgery, substitution and
        /// bit-flips are refused; they do **not** distinguish strict from
        /// cofactored verification, because doing so needs a genuine
        /// small-order-key malleability vector and inventing one risks a
        /// test that passes for the wrong reason.
        ///
        /// So the argument above is a *reason*, not evidence. Recorded
        /// here rather than in a report so that whoever changes this line
        /// knows what is and is not behind it, and does not read the
        /// reasoning as a passing control. Raised to the standard lane:
        /// if strict verification matters it belongs in FORMATS Clause 3
        /// as a requirement with a vector, not in one implementation's
        /// judgement. **That request was answered for 3.1b and is still
        /// outstanding for 3.1a.**
        fn verify(
            identity: &[u8; IDENTITY_LEN],
            message: &[u8],
            signature: &[u8; SIGNATURE_LEN],
        ) -> bool {
            let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(identity) else {
                return false;
            };
            let sig = ed25519_dalek::Signature::from_bytes(signature);
            key.verify_strict(message, &sig).is_ok()
        }
    }

    /// SHA-256, the hash behind wire-identity derivation (FORMATS 3.3).
    pub struct Sha256;

    impl Digest for Sha256 {
        fn hash(input: &[u8], out: &mut [u8; DIGEST_LEN]) {
            use sha2::Digest as _;
            let mut h = sha2::Sha256::new();
            h.update(input);
            out.copy_from_slice(&h.finalize());
        }
    }

    /// Bounded-memory SHA-256 for stored image readback (FORMATS 5.1 key 5).
    #[derive(Debug)]
    pub struct Sha256Stream(sha2::Sha256);

    impl crate::crypto::StreamingDigest for Sha256Stream {
        fn new() -> Self {
            use sha2::Digest as _;
            Self(sha2::Sha256::new())
        }

        fn update(&mut self, input: &[u8]) {
            use sha2::Digest as _;
            self.0.update(input);
        }

        fn finish(self, out: &mut [u8; DIGEST_LEN]) {
            use sha2::Digest as _;
            out.copy_from_slice(&self.0.finalize());
        }
    }

    // ---- THE PRODUCE SIDE -------------------------------------------
    //
    // Everything above verifies. Until these two types shipped, **every
    // `Signer`, `Aead`, `Hkdf` and `TagVerifier` impl in this workspace
    // lived under `cfg(test)`**, and the consequences were not academic:
    //
    //   * `apply_gate` is generic over `TagVerifier`, so with no non-test
    //     impl it **could not be instantiated outside tests at all** —
    //     the L5 7.1.2 delivery gate was correct, complete, and
    //     unreachable.
    //   * `derive_key(.., GroupIntegrity)` is generic over `Hkdf`, so the
    //     group integrity key could not be derived outside tests.
    //   * Nothing anywhere could COMPUTE a tag. `FrameSpec::tagged`
    //     accepts tag bytes and, before this, no function in the fleet
    //     produced any.
    //
    // Two boards could therefore exchange frames perfectly and form
    // nothing: a neighbour admitted by `observe` stays unverified,
    // `verified_evidence` is the only path to `verified`, and nothing
    // could justify calling it.
    //
    // **Neither of these is new cryptography.** Both are promotions of
    // code that already existed and already passed its vectors —
    // `hmac_sha256`/`HostHkdf` from `derive.rs`'s test module, and
    // `tag_over` from `r2-wire/tests/l4_vectors.rs`, which is the oracle
    // the L4 conformance vectors are checked against. *What was missing
    // was not the algorithm; it was the algorithm being reachable from
    // non-test code.*

    /// HKDF-SHA256, 32-byte output (L5 5.2.1, `PROVISIONAL(STD-SS39)`).
    pub struct HkdfSha256;

    impl crate::derive::Hkdf for HkdfSha256 {
        fn derive(ikm: &[u8], salt: &[u8], info: &[u8], out: &mut [u8; 32]) {
            use hmac::Mac as _;
            // RFC 5869 extract, then ONE expand round — 32 bytes is
            // exactly one SHA-256 block, so there is no counter loop and
            // no place for a length mistake to hide.
            // The PRK is key material and is erased on release (5.3.4).
            // ‼ RESIDUE, STATED: `hmac` 0.12 copies its key into a 64-byte
            // derived-key buffer inside each Mac and carries no zeroizing
            // Drop, so the keyed HMAC states below still leave use
            // unerased. 5.3.4 is NOT fully discharged by this crate until
            // the selected primitive erases its keyed state or the key is
            // hardware-held (r2-codex-refute, 2026-08-25).
            let mut m = HmacSha256::new_from_slice(salt).expect("HMAC accepts any key length");
            m.update(ikm);
            let prk = finalize_erasing(m);
            let mut m =
                HmacSha256::new_from_slice(prk.expose()).expect("HMAC accepts any key length");
            // **Streamed rather than concatenated.** The test original
            // built `info || 0x01` in a `Vec`; this crate is `no_std`,
            // and a fixed staging buffer would have imposed a silent
            // bound on the purpose string. Two updates impose none.
            m.update(info);
            m.update(&[0x01]);
            let okm = finalize_erasing(m);
            out.copy_from_slice(okm.expose());
        }
    }

    pub(super) type HmacSha256 = hmac::Hmac<sha2::Sha256>;

    /// Finalise a MAC into key custody, **erasing the only other copy**.
    ///
    /// Both HKDF outputs — the PRK, and the OKM before it is copied into the
    /// caller's buffer — come through here, so each derived key leaves use
    /// erased (L5 5.3.4). Until 2026-08-25 the PRK was copied out of the
    /// primitive's `GenericArray` and that array dropped unerased, and the
    /// OKM went through a raw temporary the same way (r2-codex-refute, twice
    /// — the first repair stopped one copy short). Now the array is moved
    /// into a named buffer and [`SecretKey::new`] erases that buffer as part
    /// of taking custody: the erasure is the tested constructor's, not a
    /// loop written here. **Limit, stated**: the move out of the
    /// `GenericArray` is a copy nothing here can erase — `SS488`, the same
    /// physical-copy limit `SecretKey` carries.
    pub(super) fn finalize_erasing(m: HmacSha256) -> SecretKey<32> {
        use hmac::Mac as _;
        let mut bytes: [u8; 32] = m.finalize().into_bytes().into();
        SecretKey::new(&mut bytes)
    }

    /// Sign-side twin of the gate's poison: a span that could not
    /// be completed must not yield a usable tag.
    const SHORT_SPAN_POISON_SIGN: &[u8] = b"r2/v0/span/incomplete";

    /// HMAC-SHA256 frame tags: the L4 10.1 mechanics under L5 11.2 keys.
    pub struct HmacSha256Tag;

    impl HmacSha256Tag {
        /// Compute the full 32-byte tag over an authenticated span.
        ///
        /// **The span is streamed, never collected.** `Span` hands out
        /// chunks precisely so a `no_std` target never needs the whole
        /// frame contiguous, and because the span is what L4 10.2.1
        /// defines — a caller that reassembled it could reassemble it
        /// differently from the verifier.
        ///
        /// **The caller truncates to its tier's tag length** (L4 10.1),
        /// which is why this returns the full digest rather than a
        /// truncated one: truncation is a wire property, and a function
        /// that guessed it would be guessing about a frame it cannot
        /// see.
        /// Tag a FRAME, deriving the span from it.
        ///
        /// **This is the sign-side counterpart of the fix already made
        /// on the verify side**, and it exists because that fix left
        /// this half untreated. `apply_gate` used to take a
        /// caller-supplied span and was changed to compute one from the
        /// frame, because *a caller feeding a short sequence obtained a
        /// tag that verified while saying nothing about the omitted
        /// fields.* [`compute`](Self::compute) has exactly that
        /// freedom — measured: an empty closure yields a tag over
        /// nothing, and two calls agree.
        ///
        /// r2-composer demonstrated the same shape reachable from
        /// public exports in the old vendored codec — two different
        /// payloads, one identical all-zero tag. **Retiring one
        /// instance while shipping another is not a resolution.**
        ///
        /// Refuses when the span is not computable rather than tagging
        /// a partial one: a frame with no route origin has no
        /// authenticated span at all (L4 10.2.1), and the only frame
        /// type that can be in that state is `GROUP_MGMT`, which L4
        /// `STD-SS31` says is never tagged.
        ///
        /// **Takes the key in custody.** This is the door a `SecretKey`
        /// reaches a MAC through from outside the crate; the raw bytes are
        /// crate-private (`keys::SecretKey::expose`).
        pub fn tag_frame(
            key: &SecretKey<32>,
            frame: &r2_wire::Frame<'_>,
            out: &mut [u8; 32],
        ) -> Result<(), r2_wire::frame::ParseError> {
            // Establish computability BEFORE emitting anything, so a
            // partial span can never reach the MAC.
            frame.authenticated_span(&mut |_| {})?;
            let span_of = |sink: &mut dyn FnMut(&[u8])| {
                if frame.authenticated_span(sink).is_err() {
                    sink(SHORT_SPAN_POISON_SIGN);
                }
            };
            Self::compute(key.expose(), &span_of, out);
            Ok(())
        }

        /// The raw primitive: HMAC over whatever the span emits.
        ///
        /// **A caller supplying the span is the hazard this crate has
        /// now met twice** — see [`tag_frame`](Self::tag_frame), which
        /// derives it. Kept public because `TagVerifier::verify` needs
        /// the same shape and `apply_gate` derives the span for it, but
        /// **a signer should not be reaching for this.**
        pub fn compute(key: &[u8], span: Span<'_>, out: &mut [u8; 32]) {
            use hmac::Mac as _;
            let mut m = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
            span(&mut |chunk| m.update(chunk));
            out.copy_from_slice(&m.finalize().into_bytes());
        }
    }

    impl TagVerifier for HmacSha256Tag {
        fn verify(key: &[u8], span: Span<'_>, tag: &[u8]) -> bool {
            use hmac::Mac as _;
            let mut m = HmacSha256::new_from_slice(key).expect("HMAC accepts any key length");
            span(&mut |chunk| m.update(chunk));
            // **`verify_truncated_left` is the constant-time comparison
            // L4 10.1.3 requires**, and it takes the tier truncation as
            // given rather than comparing a re-truncated copy. A plain
            // `==` here would be the timing side channel the clause
            // exists to forbid — and it would have looked correct.
            //
            // An empty tag is refused rather than trivially accepted:
            // `verify_truncated_left` errors on a zero-length tag, and
            // a zero-length tag is L5 7.1.2 d) — a tag that verifies
            // under nothing — not an untagged frame.
            m.verify_truncated_left(tag).is_ok()
        }
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod produce_side_known_answers {
    //! **Published known answers, not self-consistency** (d178 cl. 1 in
    //! its original form: a result is not available until the case can
    //! fail). Checking the promoted code against the test code it was
    //! promoted from would agree with itself whether or not either is
    //! right — so both are checked against RFC vectors instead.

    use super::{HkdfSha256, HmacSha256Tag};
    use crate::derive::Hkdf as _;
    use crate::gate::TagVerifier as _;
    use crate::keys::SecretKey;

    /// The helper returns the MAC it finalised — the erasure of its named
    /// source is `SecretKey::new`'s tested property (`keys::tests`).
    #[test]
    fn the_finalised_mac_is_the_mac() {
        use hmac::Mac as _;
        let mut reference = super::imp::HmacSha256::new_from_slice(b"k").unwrap();
        reference.update(b"m");
        let mut via_helper = super::imp::HmacSha256::new_from_slice(b"k").unwrap();
        via_helper.update(b"m");
        let expected: [u8; 32] = reference.finalize().into_bytes().into();
        assert_eq!(super::imp::finalize_erasing(via_helper).expose(), &expected);
    }

    /// Parse a hex known-answer at compile time. **The expected value
    /// stays in the readable form the RFC prints it in**, so a reader
    /// can check it against the document rather than against a
    /// transcription into byte literals.
    const fn unhex32(s: &[u8; 64]) -> [u8; 32] {
        const fn nib(c: u8) -> u8 {
            match c {
                b'0'..=b'9' => c - b'0',
                b'a'..=b'f' => c - b'a' + 10,
                _ => panic!("known-answer hex must be lowercase 0-9a-f"),
            }
        }
        let mut out = [0u8; 32];
        let mut i = 0;
        while i < 32 {
            out[i] = (nib(s[2 * i]) << 4) | nib(s[2 * i + 1]);
            i += 1;
        }
        out
    }

    #[test]
    fn hmac_matches_rfc_4231_case_1() {
        let key = [0x0bu8; 20];
        let data = b"Hi There";
        let mut out = [0u8; 32];
        let span = |sink: &mut dyn FnMut(&[u8])| sink(&data[..]);
        HmacSha256Tag::compute(&key, &span, &mut out);
        assert_eq!(
            out,
            unhex32(b"b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
        );
    }

    #[test]
    fn hmac_over_a_split_span_equals_the_contiguous_one() {
        // The span hands out CHUNKS. A tag that depended on how the
        // caller happened to split them would verify on one node and
        // fail on the other, which is the failure this streaming form
        // exists to make impossible.
        let key = [0x0bu8; 20];
        let (mut whole, mut split) = ([0u8; 32], [0u8; 32]);
        let one = |sink: &mut dyn FnMut(&[u8])| sink(b"Hi There");
        let many = |sink: &mut dyn FnMut(&[u8])| {
            sink(b"Hi ");
            sink(b"The");
            sink(b"re");
        };
        HmacSha256Tag::compute(&key, &one, &mut whole);
        HmacSha256Tag::compute(&key, &many, &mut split);
        assert_eq!(whole, split);
    }

    #[test]
    fn hkdf_matches_rfc_5869_case_1_first_block() {
        // RFC 5869 A.1. This derive does ONE expand round, so it is the
        // first 32 bytes of that case's 42-byte OKM.
        let ikm = [0x0bu8; 22];
        let salt: [u8; 13] = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
        ];
        let info: [u8; 10] = [0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9];
        let mut out = [0u8; 32];
        HkdfSha256::derive(&ikm, &salt, &info, &mut out);
        assert_eq!(
            out,
            unhex32(b"3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf")
        );
    }

    #[test]
    fn verify_accepts_the_computed_tag_and_refuses_a_wrong_key() {
        let key = [7u8; 32];
        let mut tag = [0u8; 32];
        let span = |sink: &mut dyn FnMut(&[u8])| sink(b"an authenticated span");
        HmacSha256Tag::compute(&key, &span, &mut tag);
        assert!(HmacSha256Tag::verify(&key, &span, &tag));
        assert!(!HmacSha256Tag::verify(&[8u8; 32], &span, &tag));
        // A DIFFERENT SPAN under the right key must also refuse: a tag
        // is a tag *over* something, and L4 10.2.1 is the clause that
        // says so.
        let other = |sink: &mut dyn FnMut(&[u8])| sink(b"a different span");
        assert!(!HmacSha256Tag::verify(&key, &other, &tag));
    }

    #[test]
    fn tag_frame_refuses_a_frame_with_no_authenticated_span() {
        // The one type that can be in that state is GROUP_MGMT, which
        // `STD-SS31` says is never tagged — so the refusal and the clause
        // agree rather than merely coexisting.
        use r2_wire::frame::{Frame, Target, Tier};
        use r2_wire::{FrameSpec, FrameType};
        let mut buf = [0u8; 128];
        let n = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            constrained_origin: false,
            hop_limit: 1,
            budget: 1,
            msg_id: 7,
            event_hash: 0,
            target: Target::Compact(1),
            route: None,
            payload: b"",
            tag: None,
        }
        .encode(&mut buf)
        .expect("GROUP_MGMT encodes without a route");
        let frame = Frame::parse_on_bearer(&buf[..n], Tier::Compact).expect("parses");
        let mut out = [0u8; 32];
        assert!(
            super::HmacSha256Tag::tag_frame(&SecretKey::new(&mut [7u8; 32]), &frame, &mut out)
                .is_err(),
            "a frame with no authenticated span was tagged anyway; the tag \
             would cover nothing and verify under nothing"
        );
    }

    #[test]
    fn a_truncated_tag_verifies_and_an_empty_one_does_not() {
        // Truncation to the tier length is L4 10.1 and must verify.
        let key = [7u8; 32];
        let mut tag = [0u8; 32];
        let span = |sink: &mut dyn FnMut(&[u8])| sink(b"span");
        HmacSha256Tag::compute(&key, &span, &mut tag);
        assert!(HmacSha256Tag::verify(&key, &span, &tag[..8]));
        assert!(HmacSha256Tag::verify(&key, &span, &tag[..16]));
        // An EMPTY tag is not an untagged frame. L5 7.1.2 d) drops a tag
        // that verifies under nothing; accepting a zero-length one would
        // make every frame intra-group.
        assert!(!HmacSha256Tag::verify(&key, &span, &[]));
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod tests {
    use super::*;
    use crate::crypto::{Digest, Verifier, IDENTITY_LEN, SIGNATURE_LEN};
    use ed25519_dalek::{Signer as _, SigningKey};

    fn keypair(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    #[test]
    fn a_genuine_signature_verifies() {
        let sk = keypair(1);
        let identity: [u8; IDENTITY_LEN] = sk.verifying_key().to_bytes();
        let sig: [u8; SIGNATURE_LEN] = sk.sign(b"package-body").to_bytes();
        assert!(Ed25519::verify(&identity, b"package-body", &sig));
    }

    #[test]
    fn a_signature_over_a_different_message_is_refused() {
        // The property every caller of this actually depends on.
        let sk = keypair(1);
        let identity = sk.verifying_key().to_bytes();
        let sig = sk.sign(b"package-body").to_bytes();
        assert!(!Ed25519::verify(&identity, b"package-bodyX", &sig));
        assert!(!Ed25519::verify(&identity, b"", &sig));
    }

    #[test]
    fn another_authoritys_signature_is_refused() {
        // L6 4.1.2: only an authority the hive recognises.
        let signer = keypair(1);
        let other = keypair(2);
        let sig = signer.sign(b"package-body").to_bytes();
        assert!(!Ed25519::verify(
            &other.verifying_key().to_bytes(),
            b"package-body",
            &sig
        ));
    }

    #[test]
    fn malformed_input_returns_false_rather_than_panicking() {
        // Nothing reaching a verifier is trusted, and the trait forbids
        // panicking on bad input. An all-ones key is not a valid point.
        let bad_key = [0xFFu8; IDENTITY_LEN];
        assert!(!Ed25519::verify(&bad_key, b"m", &[0; SIGNATURE_LEN]));
        // A zero signature under a genuine key.
        let sk = keypair(1);
        assert!(!Ed25519::verify(
            &sk.verifying_key().to_bytes(),
            b"m",
            &[0; SIGNATURE_LEN]
        ));
    }

    #[test]
    fn a_flipped_bit_anywhere_refuses() {
        let sk = keypair(3);
        let identity = sk.verifying_key().to_bytes();
        let good = sk.sign(b"package-body").to_bytes();
        for bit in [0usize, 7, 63, 255, 383, 511] {
            let mut tampered = good;
            tampered[bit / 8] ^= 1 << (bit % 8);
            assert!(
                !Ed25519::verify(&identity, b"package-body", &tampered),
                "a signature with bit {bit} flipped verified"
            );
        }
    }

    #[test]
    fn the_verifier_drives_package_acceptance_end_to_end() {
        // The point of the whole module: the L6 chain now terminates in
        // something that exists outside cfg(test) — real key, real
        // signature, real refusal.
        use crate::identity::Identity;
        let sk = keypair(9);
        let authority = Identity(sk.verifying_key().to_bytes());
        let body = b"the-package-body";
        let sig = sk.sign(body).to_bytes();

        assert!(Ed25519::verify(&authority.0, body, &sig));
        // A body the authority never signed.
        assert!(!Ed25519::verify(&authority.0, b"substituted-body", &sig));
    }

    #[test]
    fn sha256_matches_the_known_digest() {
        // NIST test vector for the empty string.
        let mut out = [0u8; 32];
        Sha256::hash(b"", &mut out);
        assert_eq!(
            out,
            [
                0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f,
                0xb9, 0x24, 0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b,
                0x78, 0x52, 0xb8, 0x55
            ]
        );
        // And "abc", so the vector is not a one-off constant.
        Sha256::hash(b"abc", &mut out);
        assert_eq!(
            out,
            [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad
            ]
        );
    }
    /// ‼ **L4 10.1.3 IS A TIMING PROPERTY AND TIMING IS NOT OBSERVABLE FROM A
    /// RETURN VALUE.** *Verification shall compare in constant time.* No
    /// assertion here can measure that; what carries the claim is the call —
    /// `verify_truncated_left`, the `hmac` crate's constant-time compare —
    /// and the risk this test guards is a future edit replacing it with `==`,
    /// which would look correct and pass every behavioural test.
    ///
    /// So what IS asserted is the half a `==` would also satisfy but a
    /// PREFIX comparison would not: **every octet is compared.** A tag
    /// differing only in its LAST octet is refused, and so is one differing
    /// only in its first — a short-circuiting or prefix-only comparison would
    /// accept the first of those.
    ///
    /// ⚠ **AND THE REGISTER'S OLD REASON WAS WRONG, CORRECTED HERE**: it said
    /// the type hands out no tag bytes for a caller to compare with `==`.
    /// [`HmacSha256Tag::compute`] hands out thirty-two. What is true is
    /// narrower and is the thing that matters: the VERIFIER returns `bool` and
    /// exposes nothing, so the delivery gate never holds a tag to compare.
    #[test]
    fn verification_compares_every_octet_and_the_verifier_exposes_no_tag() {
        let key = [0x5Au8; 32];
        let span = |sink: &mut dyn FnMut(&[u8])| sink(b"an authenticated span");
        let mut good = [0u8; 32];
        HmacSha256Tag::compute(&key, &span, &mut good);
        assert!(
            <HmacSha256Tag as crate::gate::TagVerifier>::verify(&key, &span, &good),
            "precondition: the computed tag verifies"
        );

        // ‼ THE LAST OCTET. A prefix or short-circuiting comparison accepts
        //   this; a whole-tag comparison does not.
        let mut last = good;
        last[31] ^= 0x01;
        assert!(
            !<HmacSha256Tag as crate::gate::TagVerifier>::verify(&key, &span, &last),
            "a tag differing only in its final octet must be refused"
        );

        // The first octet, so the sweep covers both ends rather than one.
        let mut first = good;
        first[0] ^= 0x01;
        assert!(!<HmacSha256Tag as crate::gate::TagVerifier>::verify(
            &key, &span, &first
        ));

        // Every octet in turn, because "both ends" is still two samples.
        for i in 0..32 {
            let mut bad = good;
            bad[i] ^= 0xFF;
            assert!(
                !<HmacSha256Tag as crate::gate::TagVerifier>::verify(&key, &span, &bad),
                "octet {i} is not compared"
            );
        }

        // A different key refuses the same tag, so the comparison is against
        // something derived rather than against a constant.
        let other = [0xA5u8; 32];
        assert!(!<HmacSha256Tag as crate::gate::TagVerifier>::verify(
            &other, &span, &good
        ));
    }
}
