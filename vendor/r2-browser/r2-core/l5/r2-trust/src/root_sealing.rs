//! A [`SealingFacility`](r2_hal_traits::sealing::SealingFacility) built from a hardware-rooted secret this code never
//! sees (L5 5.3.2).
//!
//! ‼ **THIS WAS THE ONE MISSING LINK AND EVERYTHING ROUND IT WAS ALREADY
//! BUILT** (measured 2026-09-04). The keystore seals persona custody through
//! this trait and never touches a seed; the identity epoch couples the sealed
//! bytes to the public record; the redundant store makes that durable; the
//! restoring boot refuses without the secret half. **Every one of those exists
//! and is tested. No platform implemented the facility**, so the chain
//! terminated in a type deliberately made unconstructible, and a board could
//! not keep an identity across a reset.
//!
//! # What is here, and what is deliberately NOT
//!
//! The **framing** is here: derive, nonce, seal, unseal, and the erasure rules.
//! It is portable and testable on a host with a stub root key. **The root key
//! itself is not here** and cannot be — it lives in a key block on a
//! particular part, reached through a peripheral, and this crate must not
//! learn about either. A platform supplies [`RootKey`](crate::root_sealing::RootKey).
//!
//! # ‼ THE NONCE IS THE WHOLE SAFETY ARGUMENT
//!
//! The derived key is **deterministic**: the same root and the same context
//! give the same key on every call, for ever, which is exactly what makes
//! unsealing possible after a power cycle. So the key contributes no
//! variation, and **the nonce is the only thing standing between two seals and
//! a catastrophic reuse** — under this construction a repeated nonce with a
//! repeated key does not degrade confidentiality, it destroys it, and leaks
//! the authentication key with it.
//!
//! A fresh nonce is therefore drawn per seal and carried in the output. It is
//! not derived, not a counter, and not stored: a counter would have to survive
//! the same power loss the sealed record exists to survive, and a counter that
//! resets is a nonce that repeats.
//!
//! # The context binds the derivation AND the ciphertext
//!
//! It is the derivation input and the associated data. **Belt and braces on
//! purpose**: the first means a blob sealed for one purpose is under a
//! different key from one sealed for another, and the second means swapping
//! two blobs between purposes fails authentication rather than decrypting to
//! something plausible.

use crate::crypto::{Aead, AEAD_KEY_LEN, NONCE_LEN};
use crate::keygen::ConformingEntropy;
use core::marker::PhantomData;
use r2_hal_traits::sealing::SealingFacility;
use zeroize::Zeroize as _;

/// A secret this code never sees, in a form it can use.
///
/// **`context` binds the derivation.** An implementation must return the same
/// key for the same context for the life of the unit, and a different key for
/// a different context, or a sealed record will not open after a reboot.
pub trait RootKey {
    /// Derive a key bound to `context`. `false` for any refusal — no key
    /// block, a peripheral fault, anything. **A refusal must not leave a
    /// usable value in `out`.**
    fn derive(&mut self, context: &[u8], out: &mut [u8; AEAD_KEY_LEN]) -> bool;
}

/// Local storage derivation from a hardware HMAC primitive.
///
/// The platform supplies HMAC-SHA256 under its protected device root. Its
/// output supplies secret input material to HKDF; the public context is the
/// salt and the existing StorageSeal purpose is the info input (L5 5.2.1).
/// RootSealed also authenticates that context as associated data. This local
/// construction is not a group/network-key derivation or a new wire purpose.
/// The context and construction must remain stable across firmware updates.
///
/// The closure must use an admitted hardware root; a closure returning bytes
/// alone does not establish hardware protection, provenance or bounded latency.
pub struct HmacRoot<F, H> {
    authenticate: F,
    _hkdf: PhantomData<H>,
}

impl<F, H> HmacRoot<F, H> {
    pub const fn new(authenticate: F) -> Self {
        Self {
            authenticate,
            _hkdf: PhantomData,
        }
    }
}

impl<F, H> RootKey for HmacRoot<F, H>
where
    F: FnMut(&[u8], &mut [u8; AEAD_KEY_LEN]) -> bool,
    H: crate::derive::Hkdf,
{
    fn derive(&mut self, context: &[u8], out: &mut [u8; AEAD_KEY_LEN]) -> bool {
        out.zeroize();
        let mut material = zeroize::Zeroizing::new([0; AEAD_KEY_LEN]);
        if !(self.authenticate)(context, &mut material) {
            return false;
        }
        H::derive(
            &material[..],
            context,
            crate::derive::Purpose::StorageSeal.as_bytes(),
            out,
        );
        true
    }
}

/// Why a seal or unseal could not proceed.
///
/// ‼ **`NotAuthentic` CARRIES NO REASON, AND THAT IS DELIBERATE.** A wrong
/// key, a corrupted ciphertext and a truncated one are one answer here. The
/// cipher's own contract says a failure is never distinguished by reason, and
/// distinguishing them at this layer would hand back what that refuses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SealRefusal {
    /// The platform could not derive a key. **The remedy is provisioning, not
    /// different hardware** where the part is capable.
    NoRootKey,
    /// The caller's buffer cannot hold the result.
    OutputTooSmall,
    /// Fewer bytes than a nonce and a tag: not something this produced.
    TooShortToBeSealed,
    /// Did not authenticate.
    NotAuthentic,
}

/// [`SealingFacility`] over a hardware-rooted key and an authenticated cipher.
///
/// The output is `nonce || ciphertext || tag`.
pub struct RootSealed<R, E, A> {
    root: R,
    entropy: E,
    context: &'static [u8],
    _aead: PhantomData<A>,
}

impl<R: RootKey, E: ConformingEntropy, A: Aead> RootSealed<R, E, A> {
    /// **`context` is `'static` so it cannot be varied per call.** A caller
    /// that could pass a different context each time would be able to seal
    /// under one and unseal under another, which fails in the field rather
    /// than in a test.
    pub const fn new(root: R, entropy: E, context: &'static [u8]) -> Self {
        Self {
            root,
            entropy,
            context,
            _aead: PhantomData,
        }
    }

    fn key(&mut self) -> Result<[u8; AEAD_KEY_LEN], SealRefusal> {
        let mut k = [0u8; AEAD_KEY_LEN];
        if self.root.derive(self.context, &mut k) {
            Ok(k)
        } else {
            k.zeroize();
            Err(SealRefusal::NoRootKey)
        }
    }
}

impl<R: RootKey, E: ConformingEntropy, A: Aead> SealingFacility for RootSealed<R, E, A> {
    type Error = SealRefusal;

    fn seal(&mut self, plaintext: &[u8], out: &mut [u8]) -> Result<usize, Self::Error> {
        if out.len() < NONCE_LEN {
            return Err(SealRefusal::OutputTooSmall);
        }
        // ‼ FRESH PER SEAL. Entropy hands back a fixed 32 bytes rather than a
        //   slice, deliberately, so the first NONCE_LEN of them are taken
        //   rather than a short read being requested and accepted.
        let mut drawn = [0u8; 32];
        if !self.entropy.try_fill(&mut drawn) {
            drawn.zeroize();
            return Err(SealRefusal::NoRootKey);
        }
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&drawn[..NONCE_LEN]);
        drawn.zeroize();

        let mut k = self.key()?;
        let sealed = A::seal(&k, &nonce, self.context, plaintext, &mut out[NONCE_LEN..]);
        k.zeroize();
        match sealed {
            Some(n) => {
                out[..NONCE_LEN].copy_from_slice(&nonce);
                Ok(NONCE_LEN + n)
            }
            None => {
                // The cipher refused for want of room. Leave nothing behind.
                out.zeroize();
                Err(SealRefusal::OutputTooSmall)
            }
        }
    }

    fn unseal(&mut self, sealed: &[u8], out: &mut [u8]) -> Result<usize, Self::Error> {
        if sealed.len() <= NONCE_LEN {
            return Err(SealRefusal::TooShortToBeSealed);
        }
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&sealed[..NONCE_LEN]);

        let mut k = self.key()?;
        let opened = A::open(&k, &nonce, self.context, &sealed[NONCE_LEN..], out);
        k.zeroize();
        match opened {
            Some(n) => Ok(n),
            None => {
                // ‼ THE CONTRACT'S OWN RULE, AND IT IS THE ONE THAT MATTERS:
                //   a caller that reads `out` after an error must not find key
                //   material there.
                out.zeroize();
                Err(SealRefusal::NotAuthentic)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cipher::XChaCha20Poly1305 as X;

    const CONTEXT: &[u8] = b"persona-custody";

    /// A stub root: deterministic and context-bound, like the real one, and
    /// switchable to a refusal.
    struct StubRoot {
        refuse: bool,
    }
    impl RootKey for StubRoot {
        fn derive(&mut self, context: &[u8], out: &mut [u8; AEAD_KEY_LEN]) -> bool {
            if self.refuse {
                return false;
            }
            for (i, b) in out.iter_mut().enumerate() {
                *b = (i as u8).wrapping_mul(7) ^ context.first().copied().unwrap_or(0);
            }
            true
        }
    }

    /// Counter entropy: **a different value every call**, which is what the
    /// nonce rule needs, and reproducible so a test can state what it expects.
    struct Counting(u8);
    impl ConformingEntropy for Counting {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            self.0 = self.0.wrapping_add(1);
            out.fill(self.0);
            true
        }
    }

    fn facility(refuse: bool) -> RootSealed<StubRoot, Counting, X> {
        RootSealed::new(StubRoot { refuse }, Counting(0), CONTEXT)
    }

    #[test]
    fn a_sealed_secret_comes_back_byte_for_byte() {
        let mut f = facility(false);
        let secret = [0xA5u8; 64];
        let mut sealed = [0u8; 128];
        let n = f.seal(&secret, &mut sealed).expect("seals");
        let mut back = [0u8; 64];
        let m = f.unseal(&sealed[..n], &mut back).expect("unseals");
        assert_eq!(m, secret.len());
        assert_eq!(
            back, secret,
            "a custody bundle that does not round-trip is lost custody"
        );
    }

    /// ‼ **THE SAFETY PROPERTY, AND IT IS NOT AN OPTIMISATION.** The key is
    /// deterministic by design, so the nonce is the only variation. Two seals
    /// of the same plaintext producing the same bytes would mean a repeated
    /// nonce under a repeated key, which for this cipher does not weaken
    /// confidentiality — it destroys it and leaks the authentication key too.
    #[test]
    fn two_seals_of_the_same_secret_differ_because_the_nonce_is_fresh() {
        let mut f = facility(false);
        let secret = [0x11u8; 32];
        let mut first = [0u8; 96];
        let mut second = [0u8; 96];
        let a = f.seal(&secret, &mut first).expect("seals");
        let b = f.seal(&secret, &mut second).expect("seals");
        assert_eq!(a, b, "same plaintext, same length");
        assert_ne!(
            first[..a],
            second[..b],
            "‼ IDENTICAL OUTPUT MEANS A REPEATED NONCE UNDER A REPEATED KEY"
        );
        assert_ne!(
            first[..NONCE_LEN],
            second[..NONCE_LEN],
            "and the difference is in the nonce, not merely somewhere"
        );
        // Both still open: fresh does not mean lost.
        let mut back = [0u8; 32];
        assert!(f.unseal(&first[..a], &mut back).is_ok());
        assert!(f.unseal(&second[..b], &mut back).is_ok());
    }

    /// ‼ **THE CONTRACT'S EXPLICIT RULE.** A caller that reads `out` after a
    /// failure must not find key material there.
    #[test]
    fn a_tampered_seal_fails_and_leaves_no_partial_plaintext() {
        let mut f = facility(false);
        let secret = [0x7Eu8; 48];
        let mut sealed = [0u8; 112];
        let n = f.seal(&secret, &mut sealed).expect("seals");
        sealed[NONCE_LEN + 3] ^= 0xFF;

        let mut back = [0xCCu8; 48];
        assert_eq!(
            f.unseal(&sealed[..n], &mut back),
            Err(SealRefusal::NotAuthentic)
        );
        assert_eq!(
            back, [0u8; 48],
            "the output was zeroed rather than left holding a decryption of tampered bytes"
        );
    }

    /// ‼ **THE TAIL OF AN OVERSIZED BUFFER, WHICH IS WHERE THIS LAYER'S
    /// ERASURE EARNS ITSELF.** The cipher below zeroes only the plaintext
    /// length it was about to write; anything the caller supplied beyond that
    /// is untouched by it. *Measured: with a buffer sized exactly to the
    /// plaintext, removing the erasure here changes nothing and the test above
    /// stays green* — so that test proves the property and not this line. A
    /// facility handling custody erases the whole buffer it was handed.
    #[test]
    fn a_failed_unseal_erases_the_whole_buffer_and_not_just_the_plaintext_length() {
        let mut f = facility(false);
        let secret = [0x3Cu8; 32];
        let mut sealed = [0u8; 96];
        let n = f.seal(&secret, &mut sealed).expect("seals");
        sealed[NONCE_LEN + 1] ^= 0xFF;

        // Deliberately larger than the plaintext, with a sentinel past its end.
        let mut roomy = [0xDDu8; 64];
        assert_eq!(
            f.unseal(&sealed[..n], &mut roomy),
            Err(SealRefusal::NotAuthentic)
        );
        assert_eq!(
            roomy, [0u8; 64],
            "the tail beyond the plaintext length still held the caller's bytes, which is exactly \
             the region the cipher below does not reach"
        );
    }

    /// An unprovisioned unit refuses rather than sealing under something else.
    #[test]
    fn a_platform_with_no_root_key_refuses_both_directions() {
        let mut f = facility(true);
        let mut out = [0u8; 96];
        assert_eq!(f.seal(&[0u8; 16], &mut out), Err(SealRefusal::NoRootKey));
        // And a well-formed input still refuses, so the refusal is the KEY and
        // not the shape of what it was handed.
        let mut back = [0u8; 16];
        assert_eq!(
            f.unseal(&[0u8; NONCE_LEN + 32], &mut back),
            Err(SealRefusal::NoRootKey)
        );
    }

    /// ‼ **SHORTER THAN A NONCE IS NOT A FAILED AUTHENTICATION.** Reporting it
    /// as one would send a reader to look for corruption when what they have
    /// is not a sealed record at all.
    #[test]
    fn something_too_short_to_be_sealed_says_so_rather_than_failing_authentication() {
        let mut f = facility(false);
        let mut back = [0u8; 16];
        assert_eq!(
            f.unseal(&[0u8; NONCE_LEN], &mut back),
            Err(SealRefusal::TooShortToBeSealed),
            "a nonce with nothing after it carries no ciphertext and no tag"
        );
    }

    #[test]
    fn an_output_too_small_refuses_rather_than_truncating_custody() {
        let mut f = facility(false);
        let mut tiny = [0u8; NONCE_LEN - 1];
        assert_eq!(
            f.seal(&[0u8; 32], &mut tiny),
            Err(SealRefusal::OutputTooSmall)
        );
        // Room for the nonce and nothing else: the CIPHER refuses, and the
        // refusal must still not leave a nonce sitting in the buffer as though
        // something had been written.
        let mut nearly = [0u8; NONCE_LEN + 4];
        assert_eq!(
            f.seal(&[0u8; 32], &mut nearly),
            Err(SealRefusal::OutputTooSmall)
        );
        assert_eq!(nearly, [0u8; NONCE_LEN + 4], "nothing left behind");
    }
}

#[cfg(test)]
mod hardware_input_tests {
    #[cfg(feature = "formats-suite")]
    #[test]
    fn local_hmac_root_matches_independent_hkdf_vector_and_erases_refusal_output() {
        use super::*;
        use crate::suite::{HkdfSha256, HmacSha256Tag};
        const CONTEXT: &[u8] = b"r2/identity-epoch/v2/custody";
        let mut fixture_key = [0; 32];
        for (index, byte) in fixture_key.iter_mut().enumerate() {
            *byte = index as u8;
        }
        let mut root = HmacRoot::<_, HkdfSha256>::new(|message: &[u8], out: &mut [u8; 32]| {
            HmacSha256Tag::compute(&fixture_key, &|sink| sink(message), out);
            true
        });
        let mut first = [0xaa; 32];
        assert!(root.derive(CONTEXT, &mut first));
        // Generated independently with Python's hmac/hashlib, not this provider.
        let expected = [
            0x0a, 0xf9, 0xea, 0x62, 0x58, 0x42, 0x70, 0x11, 0x42, 0x20, 0x27, 0xa5, 0x85, 0x3c,
            0xaa, 0x5a, 0x60, 0x8e, 0x47, 0xbe, 0x2d, 0x3e, 0x4b, 0xb0, 0x2a, 0x63, 0x30, 0x41,
            0x42, 0x21, 0x69, 0x3d,
        ];
        assert_eq!(first, expected);
        let mut repeated = [0; 32];
        assert!(root.derive(CONTEXT, &mut repeated));
        assert_eq!(repeated, first);
        assert!(root.derive(b"different local binding", &mut repeated));
        assert_ne!(repeated, first);
        let mut refusing = HmacRoot::<_, HkdfSha256>::new(|_: &[u8], out: &mut [u8; 32]| {
            out.fill(0xee);
            false
        });
        assert!(!refusing.derive(CONTEXT, &mut repeated));
        assert_eq!(repeated, [0; 32]);
    }
}
