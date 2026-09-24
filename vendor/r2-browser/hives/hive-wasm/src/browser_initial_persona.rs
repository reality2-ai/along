//! Fresh browser group-of-one construction. Issuer and derived traffic keys
//! remain volatile: this platform does not establish hardware-rooted sealing.
//! Creating this handle is not permission to replace a stored persona.
use crate::{
    browser_candidate::BrowserCandidateKey,
    browser_membership::{tg_certificate_encode, tg_certificate_signing_bytes},
    hal::BrowserRng,
};
use ed25519_dalek::{Signer, SigningKey};
use js_sys::futures as wasm_bindgen_futures;
use js_sys::{Object, Reflect, Uint8Array};
use r2_hal_traits::rng::Rng;
use r2_trust::{
    derive::{derive_key, Purpose},
    keys::SecretKey,
    membership::{ClaimState, Persona},
    suite::HkdfSha256,
    Identity,
};
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

fn unavailable() -> JsValue {
    JsValue::from_str("Initial persona unavailable")
}

struct VolatileGroup {
    issuer: SigningKey,
    _payload: SecretKey<32>,
    _integrity: SecretKey<32>,
}
impl VolatileGroup {
    fn from_entropy(seed: &[u8; 32]) -> Self {
        let issuer = SigningKey::from_bytes(seed);
        let group = issuer.verifying_key().to_bytes();
        Self {
            issuer,
            _payload: derive_key::<HkdfSha256>(seed, &group, Purpose::GroupPayload),
            _integrity: derive_key::<HkdfSha256>(seed, &group, Purpose::GroupIntegrity),
        }
    }
    fn group(&self) -> Identity {
        Identity(self.issuer.verifying_key().to_bytes())
    }
    fn certificate(&self, subject: &[u8; 32]) -> Vec<u8> {
        let group = self.group();
        let signature = self
            .issuer
            .sign(&tg_certificate_signing_bytes(subject, &group.0, 0));
        tg_certificate_encode(subject, &group.0, 0, &signature.to_bytes())
    }
}

/// Newly generated group and member, not a restored persona. Dropping or closing
/// the handle drops issuer/traffic custody; no method exports those secrets.
#[wasm_bindgen]
pub struct BrowserInitialPersona {
    persona: Persona,
    member: Option<BrowserCandidateKey>,
    group: Option<VolatileGroup>,
}

#[wasm_bindgen]
impl BrowserInitialPersona {
    /// Called only for an explicit local first-use operation. Storage inspection,
    /// cancellation and atomic claim/persona installation belong to the caller.
    pub async fn generate() -> Result<BrowserInitialPersona, JsValue> {
        let member = BrowserCandidateKey::generate().await?;
        let mut seed = Zeroizing::new([0u8; 32]);
        BrowserRng.fill(&mut seed[..]);
        let group = VolatileGroup::from_entropy(&seed);
        let persona = Persona::group_of_one(group.group(), member.mint_proof()?, ClaimState::Open);
        Ok(Self {
            persona,
            member: Some(member),
            group: Some(group),
        })
    }

    /// Public evidence only. The returned member CryptoKey is explicitly
    /// unqualified browser custody. No issuer or derived key is placed in it.
    /// This one-shot transfer is not a commit receipt; refusal must not retry by
    /// silently minting a replacement. The issuer stays in this volatile handle.
    pub fn take_member_record(&mut self) -> Result<JsValue, JsValue> {
        let group = self.group.as_ref().ok_or_else(unavailable)?;
        let certificate = group.certificate(&self.persona.member().0);
        if certificate.len() != 136 {
            return Err(unavailable());
        }
        let private = self
            .member
            .take()
            .ok_or_else(unavailable)?
            .into_storage_custody()?;
        let record = Object::new();
        let set = |name: &str, value: &JsValue| -> Result<(), JsValue> {
            if Reflect::set(&record, &JsValue::from_str(name), value)? {
                Ok(())
            } else {
                Err(unavailable())
            }
        };
        set("format", &JsValue::from_f64(1.0))?;
        set(
            "custody",
            &JsValue::from_str("browser-nonextractable-unqualified"),
        )?;
        set(
            "group",
            &Uint8Array::from(self.persona.group().0.as_slice()),
        )?;
        set(
            "subject",
            &Uint8Array::from(self.persona.member().0.as_slice()),
        )?;
        set("certificate", &Uint8Array::from(certificate.as_slice()))?;
        set("privateKey", &private)?;
        Ok(record.into())
    }

    /// Public initial group identity; unavailable after volatile custody ends.
    pub fn group(&self) -> Result<Vec<u8>, JsValue> {
        self.group.as_ref().ok_or_else(unavailable)?;
        Ok(self.persona.group().0.to_vec())
    }

    /// Drop volatile custody. Does not erase a separately committed member key,
    /// nor promise that browser engine memory or stack spills are erased.
    pub fn close(&mut self) {
        if let Some(member) = self.member.take() {
            member.close();
        }
        self.group.take();
    }
}

#[cfg(test)]
mod tests {
    use super::VolatileGroup;
    use crate::browser_membership::tg_certificate_authentic;

    #[test]
    fn fresh_group_certificate_binds_member_group_and_initial_epoch() {
        let first = VolatileGroup::from_entropy(&[41; 32]);
        let other = VolatileGroup::from_entropy(&[42; 32]);
        let subject = [43; 32];
        let certificate = first.certificate(&subject);
        assert_eq!(certificate.len(), 136);
        assert!(tg_certificate_authentic(
            &certificate,
            &subject,
            &first.group().0
        ));
        assert!(!tg_certificate_authentic(
            &certificate,
            &subject,
            &other.group().0
        ));
        assert!(!tg_certificate_authentic(
            &certificate,
            &[44; 32],
            &first.group().0
        ));
        assert_eq!(&certificate[64..72], &[0; 8]);
    }
}
