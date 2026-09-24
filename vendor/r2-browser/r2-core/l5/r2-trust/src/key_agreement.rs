//! Key agreement for L5 4.2.3–4.2.4, with secret material kept in custody.
//!
//! The required X25519 primitive is supplied under `formats-suite`. This is
//! not an authenticated handshake: callers still need peer authentication,
//! transcript binding, algorithm negotiation and the standard's wire format.
//! No algorithm identifier or new derivation-purpose string is assigned here.
//! A DH result is input keying material, not an identity or membership proof.
//! Protocol integration must bind the transcript and derivation purpose through
//! its own reviewed construction; this module offers no caller-selected KDF.

use crate::keys::SecretKey;

/// Why no shared secret was established. A peer value with an all-zero result
/// must not produce usable key material, even though it has the correct width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgreementRefusal {
    NonContributory,
}

/// A single-use key agreement operation. Hardware providers may implement this
/// boundary without exporting their private key. Successful output remains in
/// `SecretKey` custody; callers must not use it as a peer-authentication proof.
pub trait KeyAgreement: Sized {
    /// Public X25519 u-coordinate encoding, not an Ed25519 identity.
    fn public_key(&self) -> [u8; 32];
    /// Consume this private key, refusing non-contributory peer inputs.
    fn agree(self, peer: &[u8; 32]) -> Result<SecretKey<32>, AgreementRefusal>;
}

/// One-shot software X25519, as required by L5 4.2.4.
/// Generation uses the platform's conforming-entropy boundary, never a public
/// seed constructor. The upstream storage type supports reuse, but remains
/// private: this wrapper exposes neither Clone, raw private bytes nor a second
/// agreement. Its private key and upstream shared-secret temporary erase on
/// Drop. Moves and compiler spills retain the existing SS488 limitation; this
/// is not a claim that all physical copies are eliminated.
///
/// ```compile_fail,E0382
/// use r2_trust::key_agreement::{KeyAgreement, X25519};
/// fn cannot_reuse(key: X25519, peer: &[u8; 32]) {
///     let _ = key.agree(peer);
///     let _ = key.agree(peer);
/// }
/// ```
#[cfg(feature = "formats-suite")]
pub struct X25519 {
    private: x25519_dalek::StaticSecret,
}

#[cfg(feature = "formats-suite")]
impl X25519 {
    /// Obtain a fresh independent private scalar. A failed or partial entropy
    /// draw is erased and refused with the platform's current reason.
    pub fn generate<E: crate::keygen::ConformingEntropy>(
        entropy: &mut E,
    ) -> Result<Self, crate::surface::KeyMaterialRefusal> {
        let mut seed = zeroize::Zeroizing::new([0u8; 32]);
        if !entropy.try_fill(&mut seed) {
            return Err(entropy.refusal());
        }
        Ok(Self {
            private: x25519_dalek::StaticSecret::from(*seed),
        })
    }
}

#[cfg(feature = "formats-suite")]
impl core::fmt::Debug for X25519 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("X25519(redacted)")
    }
}

#[cfg(feature = "formats-suite")]
impl KeyAgreement for X25519 {
    fn public_key(&self) -> [u8; 32] {
        x25519_dalek::PublicKey::from(&self.private).to_bytes()
    }

    fn agree(self, peer: &[u8; 32]) -> Result<SecretKey<32>, AgreementRefusal> {
        let shared = self
            .private
            .diffie_hellman(&x25519_dalek::PublicKey::from(*peer));
        // The provider implements the RFC 7748 all-zero check in constant
        // time. Do not replace it with a variable-length/prefix comparison.
        if !shared.was_contributory() {
            return Err(AgreementRefusal::NonContributory);
        }
        let mut material = zeroize::Zeroizing::new(*shared.as_bytes());
        Ok(SecretKey::new(&mut material))
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod tests {
    use super::*;
    use crate::keygen::ConformingEntropy;
    use crate::surface::KeyMaterialRefusal;
    extern crate std;

    struct VectorEntropy([u8; 32]);
    impl ConformingEntropy for VectorEntropy {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            out.copy_from_slice(&self.0);
            true
        }
    }
    fn hex<const N: usize>(s: &str) -> [u8; N] {
        assert_eq!(s.len(), 2 * N);
        let mut out = [0; N];
        for (i, b) in out.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
        }
        out
    }
    fn alice() -> X25519 {
        X25519::generate(&mut VectorEntropy(hex(
            "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
        )))
        .unwrap()
    }
    fn bob() -> X25519 {
        X25519::generate(&mut VectorEntropy(hex(
            "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
        )))
        .unwrap()
    }

    /// L5 4.2.3–4.2.4: required X25519 primitive, tested against
    /// RFC 7748 §6.1, https://www.rfc-editor.org/rfc/rfc7748.html#section-6.1 .
    /// Both public values and both agreement directions are checked against
    /// external known answers, not just against each other.
    #[test]
    fn x25519_matches_rfc7748_alice_and_bob() {
        let (alice, bob) = (alice(), bob());
        let a = alice.public_key();
        let b = bob.public_key();
        assert_eq!(
            a,
            hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")
        );
        assert_eq!(
            b,
            hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")
        );
        let expected = hex("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");
        assert_eq!(alice.agree(&b).unwrap().expose(), &expected);
        assert_eq!(bob.agree(&a).unwrap().expose(), &expected);
    }

    /// L5-009 / L5 4.2.3–4.2.4: both required algorithms have concrete
    /// providers, checked against published answers. This does not establish
    /// the missing algorithm-identifier wire contract or authenticate enrolment.
    #[test]
    fn required_signature_and_key_agreement_algorithms_match_known_answers() {
        use crate::crypto::Verifier;
        use crate::suite::Ed25519;
        // RFC 8032 §7.1, test 1 (empty message):
        // https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1
        let mut seed = VectorEntropy(hex(
            "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        ));
        let public = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        assert_eq!(crate::keygen::mint(&mut seed).unwrap().public().0, public);
        let mut signature = hex(concat!(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155",
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        ));
        assert!(Ed25519::verify(&public, b"", &signature));
        assert!(!Ed25519::verify(&public, b"changed", &signature));
        signature[63] ^= 1;
        assert!(!Ed25519::verify(&public, b"", &signature));
        x25519_matches_rfc7748_alice_and_bob();
        x25519_refuses_low_order_inputs_and_accepts_a_valid_control();
    }

    #[test]
    fn x25519_matches_rfc7748_scalar_and_coordinate_vectors() {
        // RFC 7748 §5.2: non-base-point inputs exercise scalar clamping and
        // coordinate decoding independently of the public-key fixtures.
        for (scalar, peer, expected) in [
            (
                "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
                "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c",
                "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
            ),
            (
                "4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d",
                "e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493",
                "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
            ),
        ] {
            let key = X25519::generate(&mut VectorEntropy(hex(scalar))).unwrap();
            assert_eq!(key.agree(&hex(peer)).unwrap().expose(), &hex(expected));
        }
    }

    #[test]
    fn x25519_accepts_noncanonical_coordinates_modulo_the_field_prime() {
        // p + 9 encodes the same u-coordinate as the base point 9 (RFC 7748 §5).
        let mut base = [0; 32];
        base[0] = 9;
        let mut noncanonical = [0xff; 32];
        noncanonical[0] = 0xf6;
        noncanonical[31] = 0x7f;
        let expected = alice().public_key();
        assert_eq!(alice().agree(&base).unwrap().expose(), &expected);
        assert_eq!(alice().agree(&noncanonical).unwrap().expose(), &expected);
    }

    #[test]
    fn x25519_refuses_low_order_inputs_and_accepts_a_valid_control() {
        let mut one = [0; 32];
        one[0] = 1;
        for peer in [[0; 32], one] {
            assert_eq!(
                alice().agree(&peer).err(),
                Some(AgreementRefusal::NonContributory)
            );
        }
        assert!(alice().agree(&bob().public_key()).is_ok());
    }

    #[test]
    fn x25519_masks_the_peer_high_bit_as_required_by_rfc7748() {
        let peer = bob().public_key();
        let mut high_bit = peer;
        high_bit[31] |= 128;
        assert_eq!(
            alice().agree(&peer).unwrap().expose(),
            alice().agree(&high_bit).unwrap().expose()
        );
    }

    #[test]
    fn entropy_failure_never_produces_a_private_key() {
        struct Failing;
        impl ConformingEntropy for Failing {
            fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
                out[..7].fill(0x51); // a partially written failed draw
                false
            }
            fn refusal(&self) -> KeyMaterialRefusal {
                KeyMaterialRefusal::NotStated
            }
        }
        assert!(matches!(
            X25519::generate(&mut Failing),
            Err(KeyMaterialRefusal::NotStated)
        ));
    }

    #[test]
    fn keys_remain_redacted_and_upstream_erasure_is_enabled() {
        assert_eq!(std::format!("{:?}", alice()), "X25519(redacted)");
        assert!(core::mem::needs_drop::<x25519_dalek::StaticSecret>());
        assert!(core::mem::needs_drop::<x25519_dalek::SharedSecret>());
        // Compile-time evidence that erasure itself is enabled, not merely
        // some unrelated Drop implementation on the upstream types.
        fn erases<T: zeroize::Zeroize>() {}
        erases::<x25519_dalek::StaticSecret>();
        erases::<x25519_dalek::SharedSecret>();
        let shared = alice().agree(&bob().public_key()).unwrap();
        assert_eq!(std::format!("{shared:?}"), "SecretKey<32>(redacted)");
    }
}
