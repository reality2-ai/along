//! Key generation (L5 5.1.1), and the seam that carries hive's entropy
//! guarantee across the crate boundary.
//!
//! **Core owns keygen** (d006, and `STD-SS144`'s class: two lanes
//! implementing one cryptographic primitive is two implementations of a
//! signature scheme that agree on every test and could differ on one
//! representation). Hive consumes through this surface and never holds a
//! secret it did not receive from it (5.3.3).
//!
//! ## The one interface property, and it is the point
//!
//! Hive made the ordering **unconstructible to get wrong**: its `Entropy`
//! cannot exist without a reference to a *running* source, so a loop that
//! boots trust before the radio does not compile. **If this crate accepted
//! raw bytes or a `bool`, that guarantee would stop at the crate boundary
//! and the strongest control built today would be decorative one call
//! later.**
//!
//! So [`ConformingEntropy`] is the parameter, and:
//!
//! **There is deliberately NO blanket implementation over
//! [`r2_hal_traits::rng::Rng`].** A blanket impl would let any generator
//! satisfy this by accident, which is the bypass — implementing this trait
//! must be a *deliberate act at the platform*, made by a type that can only
//! be built from a **started source**.
//!
//! ‼ **THE WORD WAS `RADIO` UNTIL 2026-08-09 AND THAT WAS TOO NARROW —
//! MEASURED BY HIVE, NOT SUPPOSED.** On the DFR1195 the conforming source
//! is `TrngSource::new(rng, adc1)`, **built from the ADC rather than the
//! radio**, and hive's own comment records that *starting WiFi does NOT set
//! `is_enabled()`* — so on that board the radio path was measured and
//! **rejected as insufficient**. *This crate never depended on a radio; it
//! depends on a source the platform can prove is running, and naming one
//! mechanism made a general property look like a specific one.*
//!
//! **`CORE-6` is unaffected as a general question** — L0 5.5.1/5.5.2 treat
//! entropy as a *capability* while hive measured it as a *timing* condition
//! on ESP32-S3 — **but it is NOT a precondition for a board whose source is
//! the ADC**, and this file used to imply that it was.
//!
//! ## The negative requirement, which is binding
//!
//! **This crate provides no path to mint from bytes.** No
//! `mint_from_seed`, no `From<[u8; 32]>`, no generator trait with a
//! blanket implementation. Hive's argument and the supervisor's ruling:
//! **if a caller can hand core 32 bytes, hive's chain is decorative one
//! call later** — a platform under time pressure fills an array and
//! nothing anywhere refuses.
//!
//! **The predicted bypass arrives as a HELPER, not as a check.** A
//! deterministic source makes core's own tests reproducible, which is
//! correct and necessary; the moment it is not `cfg(test)` it becomes the
//! convenience every platform reaches for. So the only implementor in
//! this crate is `NotRandomForTestsOnly`, it is `cfg(test)`, and it is
//! **named to be flinched at** — a reviewer skims a use site and reads the
//! type name, not the `cfg` on a definition three files away, so the name
//! is the only part of the guard that travels to where it would be
//! misused.
//!
//! That is **proven by attempting the forbidden construction and being
//! refused**, not by reading the attribute — see the `compile_fail`
//! doctest on [`ConformingEntropy`]. Its limit, stated: it proves *that
//! name* is unreachable from outside. **The fleet property — exactly one
//! non-test implementor, on a type with no public constructor — is
//! countable rather than enforceable**, and hive holds that count on the
//! platform side.
//!
//! ## What this crate cannot check, stated rather than implied
//!
//! A platform that implements [`ConformingEntropy`] on a type it can build
//! without entropy has lied, and **nothing here can detect it**. The trait
//! makes the claim *explicit and locatable*; it does not make it true.
//! That is the same limit as every other declaration — see
//! `01-terminology` 5.4 — and it is why the property is enforced where the
//! peripheral is, not here.

// Only the keypair types use it, and they are all behind the suite.
#[cfg(feature = "formats-suite")]
use crate::identity::Identity;

/// A generator the platform declares conforming **at the moment of use**
/// (L0 5.5.1, and `CORE-6`'s timing reading of it).
///
/// The `&mut self` is not incidental: a source that can be read from a
/// shared reference can be read by anything that has one, and this must be
/// held by the party that started it.
///
/// **The only implementor in this crate is test-only, and that is proven
/// rather than asserted.** Naming it from outside does not compile:
///
/// ```compile_fail
/// // There is no deterministic source a platform can reach for.
/// let _ = r2_trust::keygen::NotRandomForTestsOnly::default();
/// ```
pub trait ConformingEntropy {
    /// Fill `out` with cryptographically secure random bytes.
    ///
    /// **Fixed width, not a slice** (hive's point, and it is right): a
    /// slice invites a caller to ask for four bytes and get away with it,
    /// and **a keygen that accepts a short read is the same silent
    /// weakness as a pseudo-random one.** There is no length to get
    /// wrong.
    ///
    /// **`false` where the source is not conforming right now** — L0 5.5.2
    /// as a timing condition, not a capability one. A generator that
    /// cannot answer must say so rather than fill the buffer with
    /// something well-formed: **a fabricated key is a well-formed 32 bytes
    /// no peer can verify**, and the panel would show a hive identity
    /// while the device is a stranger.
    fn try_fill(&mut self, out: &mut [u8; 32]) -> bool;

    /// Why a `try_fill` refused, **asked at the moment it is reported**.
    ///
    /// Defaulted to `NotStated`, because a platform that has not said why
    /// must not be read as having said something.
    ///
    /// **This is a method and not a value passed at construction**, and
    /// that is hive's category arriving here: *evidence of a condition at
    /// construction time says nothing about the condition at use time.*
    /// A reason sampled when a keystore is built and replayed when a mint
    /// fails is **a stale answer that reads as a current one** — the
    /// source can move from *not yet* to *absent* between the two, and the
    /// panel would name the wrong operator action. Time-of-check to
    /// time-of-use, in the field whose only job is to explain a failure.
    fn refusal(&self) -> crate::surface::KeyMaterialRefusal {
        crate::surface::KeyMaterialRefusal::NotStated
    }
}

/// A minted keypair. The secret half stays in this process and is handed
/// to the platform only for **sealed** persistence (5.3.2; the sealing
/// contradiction this used to cite as `CORE-7` is **closed** by 5.3.1a —
/// *the absolute one governs* — `STD-SS217`).
///
/// ‼ **FORMATS 3.2: IDENTITY MATERIAL COMES FROM THE PLATFORM'S CSPRNG AND
/// NEVER FROM A NAME, A SERIAL OR A COUNTER — AND THE FIELDS BEING PRIVATE IS
/// THE WHOLE MECHANISM.** [`mint`] takes a [`ConformingEntropy`] by mutable
/// reference and is the ONLY constructor, so there is no route by which a
/// derived value becomes a keypair. *A `pub` on either field, or any second
/// constructor, would open one silently* — the type would still look right
/// and every existing test would still pass.
///
/// These fail to compile while that holds, and **compile, and so go red, the
/// moment a field is exposed or a constructor is added**:
///
/// ```compile_fail,E0451
/// use r2_trust::keygen::Keypair;
/// use r2_trust::Identity;
///
/// fn from_a_serial(serial: [u8; 32]) -> Keypair {
///     Keypair { public: Identity(serial), secret: unimplemented!() }
/// }
/// ```
///
/// ```compile_fail,E0616
/// use r2_trust::keygen::Keypair;
///
/// fn read_the_secret(k: &Keypair) -> &r2_trust::keys::SecretKey<32> {
///     &k.secret
/// }
/// ```
#[cfg(feature = "formats-suite")]
pub struct Keypair {
    public: Identity,
    secret: crate::keys::SecretKey<32>,
}

#[cfg(feature = "formats-suite")]
impl Keypair {
    pub const fn public(&self) -> Identity {
        self.public
    }
    /// The secret half, for sealing. **Named `for_sealing` rather than
    /// `expose` because the only conforming destination is sealed
    /// storage**: 5.3.2's *"plaintext key material at rest is forbidden in
    /// every case"* is what this return value is bounded by, and a caller
    /// writing it anywhere else has broken that clause, not this type.
    pub const fn for_sealing(&self) -> &crate::keys::SecretKey<32> {
        &self.secret
    }

    /// Reconstitute one keypair from a seed that has just been unsealed by
    /// the platform, or the exact published Dev TG seed under L5 9.1. This
    /// stays private: consumers cannot import arbitrary seed bytes.
    fn from_unsealed_seed(seed: &mut [u8; 32]) -> Self {
        use ed25519_dalek::SigningKey;

        let signing = SigningKey::from_bytes(seed);
        let public = Identity(*signing.verifying_key().as_bytes());
        let secret = crate::keys::SecretKey::new(seed);
        Self { public, secret }
    }
}

/// Signing borrows held custody; it neither exports the seed nor mints a key.
#[cfg(feature = "formats-suite")]
impl crate::crypto::Signer for Keypair {
    fn sign(&self, message: &[u8]) -> [u8; crate::crypto::SIGNATURE_LEN] {
        use ed25519_dalek::Signer as _;
        // The dependency's enabled zeroize support erases this temporary
        // signing-key object on drop, as with the existing mint/unseal paths.
        ed25519_dalek::SigningKey::from_bytes(self.secret.expose())
            .sign(message)
            .to_bytes()
    }

    fn identity(&self) -> [u8; crate::crypto::IDENTITY_LEN] {
        self.public.0
    }
}

/// Generate a keypair (L5 5.1.1).
///
/// `None` where the platform's entropy is not conforming at this moment —
/// which becomes [`crate::surface::NotAHive`], and 4.3.3 refuses the
/// running state. **The honest failure is the feature**: a device that
/// says it is not a hive is recoverable, one that mints from a
/// pseudo-random source is silently a stranger to everyone.
#[cfg(feature = "formats-suite")]
pub fn mint<E: ConformingEntropy>(entropy: &mut E) -> Option<Keypair> {
    use ed25519_dalek::SigningKey;

    let mut seed = [0u8; 32];
    if !entropy.try_fill(&mut seed) {
        return None;
    }
    let signing = SigningKey::from_bytes(&seed);
    let public = Identity(*signing.verifying_key().as_bytes());
    let secret = crate::keys::SecretKey::new(&mut seed);
    Some(Keypair { public, secret })
}

#[cfg(all(test, feature = "formats-suite"))]
mod tests {
    use super::*;

    /// Named to be flinched at, per hive: a reviewer reads the type at
    /// the use site, never the `cfg` three files away.
    #[derive(Default)]
    pub struct NotRandomForTestsOnly(pub u8, pub bool);
    impl ConformingEntropy for NotRandomForTestsOnly {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            if self.1 {
                out.fill(self.0);
            }
            self.1
        }
    }

    #[test]
    fn a_non_conforming_source_mints_nothing() {
        // The excluded case beside it (01-terminology 4.2): the same call
        // on a conforming source DOES mint, so the refusal is about the
        // entropy and not about the path.
        assert!(mint(&mut NotRandomForTestsOnly(7, false)).is_none());
        assert!(mint(&mut NotRandomForTestsOnly(7, true)).is_some());
    }

    #[test]
    fn nothing_is_written_when_the_source_refuses() {
        // A source that refuses must not leave a half-filled buffer that a
        // caller could mistake for key material.
        let mut refused = NotRandomForTestsOnly(0xAB, false);
        let mut buf = [0u8; 32];
        assert!(!refused.try_fill(&mut buf));
        assert_eq!(buf, [0u8; 32], "a refusing source wrote into the buffer");
    }

    #[test]
    fn distinct_entropy_gives_distinct_identities() {
        // Weak, and named as weak: this shows the public half FOLLOWS the
        // seed. It says nothing about the quality of the seed, which is
        // exactly what this crate cannot see (L0 5.5.1 is the platform's
        // declaration).
        let a = mint(&mut NotRandomForTestsOnly(1, true)).unwrap().public();
        let b = mint(&mut NotRandomForTestsOnly(2, true)).unwrap().public();
        assert_ne!(a, b);
    }
}

/// The [`crate::surface::Keystore`] core provides, so a platform supplies
/// **entropy** rather than key generation.
///
/// This is the whole seam in one type: hive constructs it from its own
/// `Entropy` — which cannot exist without a running source — and passes it
/// to [`crate::surface::Trust::boot`] unchanged. **Keygen is core's, the
/// ordering guarantee stays hive's, and neither has to trust the other's
/// discipline.**
///
/// It holds the minted secrets for this boot. They are handed out only via
/// [`Keypair::for_sealing`], because 5.3.2 bounds the only conforming
/// destination.
#[cfg(feature = "formats-suite")]
pub struct CoreKeystore<'e, E: ConformingEntropy> {
    entropy: &'e mut E,
    group: Option<Keypair>,
    member: Option<Keypair>,
}

/// The exact plaintext width of a persona's group and member seed bundle.
///
/// This is a custody-internal value, not an L0 storage declaration. A
/// hardware sealing facility may add overhead; an epoch writer therefore
/// records the sealed length it actually received rather than assuming this
/// is also its durable width.
#[cfg(feature = "formats-suite")]
pub const PERSONA_CUSTODY_PLAINTEXT_LEN: usize = 64;

/// Why the current in-memory custody cannot be sealed into a durable bundle.
#[cfg(feature = "formats-suite")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PersonaCustodySealRefusal {
    /// Trust has not minted both halves, so no complete persona exists to
    /// persist.
    IncompletePersona,
    /// The platform facility did not produce a bounded complete seal. Its API
    /// does not distinguish a too-small caller buffer from a device refusal,
    /// so neither is guessed to be the other.
    FacilityRefused,
}

/// Why a sealed custody bundle cannot restore the persona it accompanies.
#[cfg(feature = "formats-suite")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PersonaCustodyRestoreRefusal {
    /// The platform did not unseal a complete value.
    FacilityRefused,
    /// The facility returned a complete plaintext of the wrong width.
    WrongLength(usize),
    /// The unsealed seeds derive public identities different from the stored
    /// L5 persona. A copied or mismatched aggregate is not this hive's
    /// custody.
    PublicIdentityMismatch,
}

#[cfg(feature = "formats-suite")]
impl<'e, E: ConformingEntropy> CoreKeystore<'e, E> {
    /// Takes the entropy **by mutable reference**, so the caller must hold
    /// the started source for as long as this exists — the same property
    /// hive's `from_running_radio(&radio)` has, preserved across the crate
    /// boundary rather than restated in a comment.
    pub fn new(entropy: &'e mut E) -> Self {
        Self {
            entropy,
            group: None,
            member: None,
        }
    }

    pub const fn group(&self) -> Option<&Keypair> {
        self.group.as_ref()
    }
    pub const fn member(&self) -> Option<&Keypair> {
        self.member.as_ref()
    }

    /// Move member custody to its runtime owner without exporting secret bytes.
    /// This removes it from this keystore; seal a complete persona before the
    /// handoff if persistence is required. Repeated takes return `None`.
    pub fn take_member_custody(&mut self) -> Option<Keypair> {
        self.member.take()
    }

    /// Seal the exact group/member seed pair the current keystore holds.
    ///
    /// The caller supplies only a provisioned L0
    /// [`r2_hal_traits::sealing::SealingFacility`]; it
    /// never receives either seed. The temporary plaintext is erased after
    /// every outcome, and an error clears the possible partial output too.
    /// This operation does not write storage: the upper identity-epoch owner
    /// must atomically couple the resulting opaque bytes with its public L5
    /// record and L2 BeaconId.
    pub fn seal_persona_custody<F: r2_hal_traits::sealing::SealingFacility>(
        &self,
        facility: &mut F,
        out: &mut [u8],
    ) -> Result<usize, PersonaCustodySealRefusal> {
        use zeroize::Zeroize as _;

        let (Some(group), Some(member)) = (self.group.as_ref(), self.member.as_ref()) else {
            return Err(PersonaCustodySealRefusal::IncompletePersona);
        };
        let mut plaintext = [0u8; PERSONA_CUSTODY_PLAINTEXT_LEN];
        plaintext[..32].copy_from_slice(group.for_sealing().expose());
        plaintext[32..].copy_from_slice(member.for_sealing().expose());
        let sealed = facility.seal(&plaintext, out);
        plaintext.zeroize();
        match sealed {
            Ok(n) if n <= out.len() => Ok(n),
            Ok(_) | Err(_) => {
                out.zeroize();
                Err(PersonaCustodySealRefusal::FacilityRefused)
            }
        }
    }

    /// Resume custody from a sealed group/member seed bundle and prove that
    /// it belongs to the public persona Trust decoded from the same aggregate.
    ///
    /// A successful unseal is deliberately insufficient. The device could
    /// have unsealed a prior epoch or another device's copied aggregate; only
    /// matching both derived public identities proves this is the custody that
    /// can answer [`crate::surface::Keystore::restore`] for that persona.
    pub fn restore_persona_custody<F: r2_hal_traits::sealing::SealingFacility>(
        &mut self,
        facility: &mut F,
        sealed: &[u8],
        persona: &crate::membership::Persona,
    ) -> Result<(), PersonaCustodyRestoreRefusal> {
        use zeroize::Zeroize as _;

        let mut plaintext = [0u8; PERSONA_CUSTODY_PLAINTEXT_LEN];
        let n = match facility.unseal(sealed, &mut plaintext) {
            Ok(n) if n <= plaintext.len() => n,
            Ok(_) | Err(_) => {
                plaintext.zeroize();
                return Err(PersonaCustodyRestoreRefusal::FacilityRefused);
            }
        };
        if n != PERSONA_CUSTODY_PLAINTEXT_LEN {
            plaintext.zeroize();
            return Err(PersonaCustodyRestoreRefusal::WrongLength(n));
        }
        let mut group_seed = [0u8; 32];
        let mut member_seed = [0u8; 32];
        group_seed.copy_from_slice(&plaintext[..32]);
        member_seed.copy_from_slice(&plaintext[32..]);
        plaintext.zeroize();
        let group = Keypair::from_unsealed_seed(&mut group_seed);
        let member = Keypair::from_unsealed_seed(&mut member_seed);
        if group.public() != persona.group() || member.public() != persona.member() {
            return Err(PersonaCustodyRestoreRefusal::PublicIdentityMismatch);
        }
        self.group = Some(group);
        self.member = Some(member);
        Ok(())
    }
}

#[cfg(feature = "formats-suite")]
impl<E: ConformingEntropy> crate::surface::Keystore for CoreKeystore<'_, E> {
    #[cfg(feature = "development-trust-group")]
    fn install_development_group(&mut self, mode: r2_hal_traits::build_mode::BuildMode) -> bool {
        if crate::membership::may_join(
            mode,
            crate::development::classify(&crate::development::IDENTITY),
        )
        .is_err()
        {
            return false;
        }
        let mut seed = crate::development::SECRET;
        let group = Keypair::from_unsealed_seed(&mut seed);
        if group.public() != crate::development::IDENTITY {
            return false;
        }
        self.group = Some(group);
        true
    }

    fn mint_group(&mut self) -> Option<Identity> {
        let k = mint(self.entropy)?;
        let id = k.public();
        self.group = Some(k);
        Some(id)
    }

    fn mint_member(&mut self) -> Option<Identity> {
        let k = mint(self.entropy)?;
        let id = k.public();
        self.member = Some(k);
        Some(id)
    }

    /// **Delegates rather than replays.** The reason comes from the source
    /// at the moment it is asked, not from a snapshot taken when this
    /// keystore was built.
    fn refusal(&self) -> crate::surface::KeyMaterialRefusal {
        self.entropy.refusal()
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod seam {
    use super::*;
    use crate::surface::{KeyMaterialRefusal, StoredPersona, Trust};
    use r2_hal_traits::sealing::SealingFacility;

    /// Varies between draws. The first version of this double filled
    /// deterministically, so group and member came out identical — which
    /// is what put `NotAHive::EntropyRepeated` in the surface. **The
    /// double was wrong and the code was right to reject it.**
    struct Src(bool, u8);
    impl Src {
        fn reason(&self) -> KeyMaterialRefusal {
            if self.0 {
                KeyMaterialRefusal::NotStated
            } else {
                KeyMaterialRefusal::NotYetAvailable
            }
        }
    }
    impl ConformingEntropy for Src {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            if self.0 {
                self.1 = self.1.wrapping_add(1);
                for (i, b) in out.iter_mut().enumerate() {
                    *b = (i as u8).wrapping_add(self.1);
                }
            }
            self.0
        }
        fn refusal(&self) -> KeyMaterialRefusal {
            self.reason()
        }
    }

    /// Reversible fixture only. It lets the custody controls test the L5
    /// binding and refusal structure without pretending a XOR transform is a
    /// hardware-rooted facility.
    struct Facility {
        fail_seal: bool,
        fail_unseal: bool,
    }

    impl SealingFacility for Facility {
        type Error = ();

        fn seal(&mut self, plaintext: &[u8], out: &mut [u8]) -> Result<usize, Self::Error> {
            if self.fail_seal || out.len() < plaintext.len() {
                return Err(());
            }
            for (destination, source) in out.iter_mut().zip(plaintext) {
                *destination = *source ^ 0xA5;
            }
            Ok(plaintext.len())
        }

        fn unseal(&mut self, sealed: &[u8], out: &mut [u8]) -> Result<usize, Self::Error> {
            if self.fail_unseal || out.len() < sealed.len() {
                return Err(());
            }
            for (destination, source) in out.iter_mut().zip(sealed) {
                *destination = *source ^ 0xA5;
            }
            Ok(sealed.len())
        }
    }

    fn minted_persona<'a>(
        source: &'a mut Src,
    ) -> (CoreKeystore<'a, Src>, crate::membership::Persona) {
        let mut keystore = CoreKeystore::new(source);
        let trust = Trust::boot(
            StoredPersona::NeverWritten,
            &mut keystore,
            r2_hal_traits::build_mode::BuildMode::Development,
        )
        .expect("fixture mints a persona");
        (keystore, *trust.persona())
    }

    #[test]
    fn the_reason_follows_the_source_rather_than_a_snapshot() {
        // hive's category, found in this file: evidence of a condition at
        // construction time says nothing about the condition at use time.
        // The keystore used to CAPTURE the reason when it was built.
        let mut src = Src(false, 0);
        let mut ks = CoreKeystore::new(&mut src);
        use crate::surface::Keystore as _;
        assert_eq!(ks.refusal(), KeyMaterialRefusal::NotYetAvailable);
        assert!(ks.mint_group().is_none());
        // The excluded case: a source in the other state reports the other
        // reason through the same call, so the delegation is real.
        let mut ok = Src(true, 0);
        let ks2 = CoreKeystore::new(&mut ok);
        assert_eq!(ks2.refusal(), KeyMaterialRefusal::NotStated);
    }

    #[test]
    fn a_hive_boots_from_entropy_alone_and_core_does_the_keygen() {
        let mut src = Src(true, 0);
        let mut ks = CoreKeystore::new(&mut src);
        let t = Trust::boot(
            StoredPersona::NeverWritten,
            &mut ks,
            r2_hal_traits::build_mode::BuildMode::Development,
        )
        .unwrap();
        // The persona's public halves are the ones core minted.
        assert_eq!(t.persona().group, ks.group().unwrap().public());
        assert_ne!(t.persona().group, t.persona().member);
    }

    #[test]
    fn moved_member_custody_signs_complete_evidence_after_keystore_drop() {
        use crate::certificate::{AcceptanceDepth, Certificate, Epoch, RevocationSet};
        use crate::crypto::Signer;
        use crate::evidence::{self, Freshness, HighWaterMarks};
        use crate::surface::Keystore;
        let mut entropy = Src(true, 40);
        let (member, certificate) = {
            let mut store = CoreKeystore::new(&mut entropy);
            let group = store.mint_group().unwrap();
            let subject = store.mint_member().unwrap();
            let mut certificate = Certificate {
                subject,
                group,
                issued_at: Epoch(1),
                signature: [0; 64],
            };
            let mut bound = [0; crate::certificate::CERTIFICATE_SIGNED_LEN];
            certificate.write_signed_bytes(&mut bound);
            certificate.signature = store.group().unwrap().sign(&bound);
            let member = store.take_member_custody().unwrap();
            assert!(store.member().is_none());
            assert!(store.take_member_custody().is_none());
            (member, certificate)
        };
        // Entropy is available again while the independently owned key lives.
        assert!(entropy.try_fill(&mut [0; 32]));
        let statement = [7; evidence::MAX_STATEMENT];
        let freshness = Freshness::Counter {
            epoch: Epoch(1),
            sequence: 1,
        };
        let proof = evidence::sign(&member, certificate, &statement, freshness).unwrap();
        let revoked = RevocationSet::<4>::new();
        let context = crate::member_proof::Context {
            group: &certificate.group,
            current_epoch: Epoch(1),
            acceptance_depth: AcceptanceDepth(0),
            revoked: &revoked,
        };
        let mut marks = HighWaterMarks::<4>::new();
        let verified = crate::member_proof::verify::<crate::suite::Ed25519, 4, 4>(
            &proof, &context, &statement, None, &mut marks,
        )
        .unwrap();
        assert_eq!(*verified.subject(), member.public());
        assert!(
            crate::member_proof::verify::<crate::suite::Ed25519, 4, 4>(
                &proof, &context, &statement, None, &mut marks,
            )
            .is_err(),
            "signed evidence still requires receiver freshness"
        );
        assert_eq!(
            evidence::sign(
                &member,
                certificate,
                &[7; evidence::MAX_STATEMENT + 1],
                freshness
            )
            .unwrap_err(),
            evidence::SigningRefusal::StatementTooLong
        );
        let wrong = Certificate {
            subject: certificate.group,
            ..certificate
        };
        assert_eq!(
            evidence::sign(&member, wrong, b"claim", freshness).unwrap_err(),
            evidence::SigningRefusal::WrongSubject
        );
        let mut changed = proof;
        changed.statement = b"another claim";
        assert!(crate::member_proof::verify::<crate::suite::Ed25519, 4, 4>(
            &changed,
            &context,
            changed.statement,
            None,
            &mut HighWaterMarks::new(),
        )
        .is_err());
    }

    /// **THE SHIPPED KEYSTORE CANNOT RELOAD, AND THAT IS THE INTENDED
    /// TERMINAL STATE RATHER THAN A GAP — SO IT IS PINNED HERE.**
    ///
    /// [`CoreKeystore`] mints **in-process** and its secret halves die with
    /// the process, so it takes `Keystore::restore`'s default `false` and a
    /// complete stored record yields
    /// [`crate::surface::NotAHive::RestoredPersonaHasNoSecretHalf`]. *A
    /// persona restored without its secret is a hive peers recognise and
    /// that cannot tag, sign or derive* — the refusal is correct and a boot
    /// would be wrong.
    ///
    /// # WHY THIS TEST EXISTS AT ALL, AND IT IS THE THIRD OF A FAMILY
    ///
    /// r2-android measured that **every reload test in this crate uses a
    /// test double that CAN restore, while the only keystore this crate
    /// SHIPS cannot** — so the behaviour a consumer actually meets had no
    /// test, and the ruling that it is intended lived **in a message**.
    /// *Same family as the two before it: reload was tested by fixtures
    /// that booted and never joined, and persistence rested on a single
    /// round trip.* **All three were found by someone doing the thing the
    /// tests did not.**
    ///
    /// **AND IT IS A LIMIT WRITTEN AS A PASSING TEST**: if a shipped
    /// reloading keystore is ever added here, **this fails and forces the
    /// ruling to be re-read** rather than leaving a stale sentence
    /// somewhere. *A docstring can rot; a green assertion cannot.*
    #[test]
    fn the_shipped_keystore_refuses_a_stored_persona_because_it_holds_no_secret() {
        // **PRODUCTION, DELIBERATELY, AND THE REASON IS A FINDING**: on a
        // DEVELOPMENT hive `may_join(Development, Ordinary)` REFUSES, so a
        // minted group-of-one is inadmissible on the very next boot and the
        // replacement path runs before custody is ever consulted. *This
        // test would then pass for the wrong reason* — it would observe an
        // `Ok` and conclude nothing about the secret half.
        let mut src = Src(true, 0);
        let mut ks = CoreKeystore::new(&mut src);
        let minted = Trust::boot(
            StoredPersona::NeverWritten,
            &mut ks,
            r2_hal_traits::build_mode::BuildMode::Production,
        )
        .expect("mints from entropy alone");

        // A COMPLETE record — the decode succeeds and the group is
        // admissible, so the refusal below is about custody and nothing else.
        let mut buf = [0u8; crate::record::RECORD_LEN];
        crate::record::encode(
            minted.persona().group(),
            minted.persona().member(),
            minted.persona().claim(),
            &mut buf,
        )
        .expect("fits");

        let mut src2 = Src(true, 0);
        let mut fresh = CoreKeystore::new(&mut src2);
        let second = Trust::boot(
            StoredPersona::Sealed(crate::record::SealedRecord::from_storage(&buf)),
            &mut fresh,
            r2_hal_traits::build_mode::BuildMode::Production,
        );
        assert_eq!(
            second.err(),
            Some(crate::surface::NotAHive::RestoredPersonaHasNoSecretHalf),
            "the shipped keystore reloaded a persona whose secret half it cannot hold"
        );
    }

    #[test]
    fn sealed_custody_restores_only_the_persona_its_seeds_derive() {
        let mut source = Src(true, 3);
        let (keystore, persona) = minted_persona(&mut source);
        let mut facility = Facility {
            fail_seal: false,
            fail_unseal: false,
        };
        let mut sealed = [0u8; 96];
        let n = keystore
            .seal_persona_custody(&mut facility, &mut sealed)
            .expect("both minted seeds seal together");
        assert_ne!(
            &sealed[..32],
            &keystore.group().unwrap().for_sealing().expose()[..],
            "the fixture transform is a control against an accidental clear write"
        );

        let mut restoring_source = Src(true, 31);
        let mut restoring = CoreKeystore::new(&mut restoring_source);
        restoring
            .restore_persona_custody(&mut facility, &sealed[..n], &persona)
            .expect("the exact sealed seed pair matches its public persona");
        assert_eq!(restoring.group().unwrap().public(), persona.group());
        assert_eq!(restoring.member().unwrap().public(), persona.member());

        let mut other_source = Src(true, 67);
        let (_, other_persona) = minted_persona(&mut other_source);
        let mut mismatched_source = Src(true, 101);
        let mut mismatched = CoreKeystore::new(&mut mismatched_source);
        assert_eq!(
            mismatched.restore_persona_custody(&mut facility, &sealed[..n], &other_persona),
            Err(PersonaCustodyRestoreRefusal::PublicIdentityMismatch),
            "a valid seal for another epoch must not attest this persona's custody"
        );
    }

    #[test]
    fn custody_sealing_and_unsealing_refuse_without_leaving_partial_output() {
        let mut empty_source = Src(true, 4);
        let empty = CoreKeystore::new(&mut empty_source);
        let mut facility = Facility {
            fail_seal: false,
            fail_unseal: false,
        };
        let mut out = [0xEE; 96];
        assert_eq!(
            empty.seal_persona_custody(&mut facility, &mut out),
            Err(PersonaCustodySealRefusal::IncompletePersona)
        );
        assert_eq!(
            out, [0xEE; 96],
            "an incomplete persona is not offered to a sealer"
        );

        let mut source = Src(true, 7);
        let (keystore, persona) = minted_persona(&mut source);
        facility.fail_seal = true;
        assert_eq!(
            keystore.seal_persona_custody(&mut facility, &mut out),
            Err(PersonaCustodySealRefusal::FacilityRefused)
        );
        assert_eq!(out, [0u8; 96], "a failed seal leaves no partial output");

        facility.fail_seal = false;
        let n = keystore
            .seal_persona_custody(&mut facility, &mut out)
            .expect("fixture seals");
        facility.fail_unseal = true;
        let mut restoring_source = Src(true, 9);
        let mut restoring = CoreKeystore::new(&mut restoring_source);
        assert_eq!(
            restoring.restore_persona_custody(&mut facility, &out[..n], &persona),
            Err(PersonaCustodyRestoreRefusal::FacilityRefused)
        );
        assert!(restoring.group().is_none() && restoring.member().is_none());
    }

    #[test]
    fn entropy_that_is_not_yet_conforming_yields_not_a_hive_with_the_reason() {
        let mut src = Src(false, 0);
        let mut ks = CoreKeystore::new(&mut src);
        let e = Trust::boot(
            StoredPersona::NeverWritten,
            &mut ks,
            r2_hal_traits::build_mode::BuildMode::Development,
        )
        .unwrap_err();
        assert_eq!(
            e,
            crate::surface::NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotYetAvailable)
        );
    }
}

#[cfg(all(test, feature = "formats-suite"))]
mod dalek_erasure {
    /// `mint` builds an `ed25519_dalek::SigningKey` copy of the seed; its
    /// erasure on drop is dalek's `zeroize` FEATURE, which this crate must
    /// enable or the copy leaves use unerased (r2-codex-refute,
    /// 2026-08-25). Asserted at the type so the feature cannot lapse
    /// silently; a raw array is the control that `needs_drop` is not
    /// trivially true.
    #[test]
    fn the_signing_key_copy_erases_on_drop() {
        assert!(core::mem::needs_drop::<ed25519_dalek::SigningKey>());
        assert!(!core::mem::needs_drop::<[u8; 32]>());
    }
}

#[cfg(all(test, feature = "development-trust-group"))]
mod development_custody_tests {
    use super::*;
    use crate::surface::{Keystore, NotAHive, PersonaDurability, StoredPersona, Trust};
    use r2_hal_traits::build_mode::BuildMode;

    struct FixtureEntropy(u8);
    impl ConformingEntropy for FixtureEntropy {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            self.0 += 1;
            out.fill(self.0);
            true
        }
    }

    #[test]
    fn unsupported_development_custody_refuses_before_any_persistence() {
        // Use a borrowing fixture instead of constructing or leaking entropy.
        struct Adapter<'a> {
            core: CoreKeystore<'a, FixtureEntropy>,
            writes: usize,
        }
        impl Keystore for Adapter<'_> {
            fn mint_group(&mut self) -> Option<Identity> {
                self.core.mint_group()
            }
            fn mint_member(&mut self) -> Option<Identity> {
                self.core.mint_member()
            }
            fn persist(&mut self, _: &[u8]) -> bool {
                self.writes += 1;
                true
            }
        }
        let mut entropy = FixtureEntropy(30);
        let mut unsupported = Adapter {
            core: CoreKeystore::new(&mut entropy),
            writes: 0,
        };
        assert_eq!(
            Trust::boot_development(
                StoredPersona::NeverWritten,
                &mut unsupported,
                BuildMode::Development
            ),
            Err(NotAHive::DevelopmentGroupCustodyUnavailable)
        );
        assert_eq!(unsupported.writes, 0);
    }

    #[test]
    fn development_custody_keeps_member_and_refuses_production_without_mutation() {
        let mut entropy = FixtureEntropy(10);
        let mut core = CoreKeystore::new(&mut entropy);
        let group = core.mint_group().unwrap();
        let member = core.mint_member().unwrap();
        assert!(!core.install_development_group(BuildMode::Production));
        assert_eq!(core.group().unwrap().public(), group);
        assert_eq!(core.member().unwrap().public(), member);
        assert!(core.install_development_group(BuildMode::Development));
        assert_eq!(core.group().unwrap().public(), crate::development::IDENTITY);
        assert_eq!(core.member().unwrap().public(), member);
    }

    #[test]
    fn development_boot_refuses_production_before_mint_and_reports_volatile_without_store() {
        let mut entropy = FixtureEntropy(20);
        let mut core = CoreKeystore::new(&mut entropy);
        assert_eq!(
            Trust::boot_development(
                StoredPersona::NeverWritten,
                &mut core,
                BuildMode::Production
            ),
            Err(NotAHive::DevelopmentGroupCustodyUnavailable)
        );
        assert!(core.group().is_none());
        assert!(core.member().is_none());
        let trust = Trust::boot_development(
            StoredPersona::NeverWritten,
            &mut core,
            BuildMode::Development,
        )
        .unwrap();
        assert_eq!(trust.report().group, crate::development::IDENTITY);
        assert_eq!(trust.report().member, core.member().unwrap().public());
        assert_eq!(trust.report().durability, PersonaDurability::Volatile);
    }
}
