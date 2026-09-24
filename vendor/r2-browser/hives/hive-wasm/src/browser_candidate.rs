//! Candidate key generation through Web Crypto and the core platform mint path.
//! Volatile custody only. This is not membership, admission or sealed storage.
use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
// The pinned binding macro uses this name; js-sys owns its implementation.
use js_sys::futures as wasm_bindgen_futures;
use r2_trust::{
    membership::Minted,
    surface::{KeyMaterialRefusal, Keystore},
    Identity,
};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

fn unavailable() -> JsValue {
    JsValue::from_str("Candidate key unavailable")
}
fn field(value: &JsValue, name: &str) -> Result<JsValue, JsValue> {
    Reflect::get(value, &JsValue::from_str(name))
}
fn method(value: &JsValue, name: &str) -> Result<Function, JsValue> {
    field(value, name)?.dyn_into().map_err(|_| unavailable())
}
fn subtle() -> Result<JsValue, JsValue> {
    field(&field(&js_sys::global(), "crypto")?, "subtle")
}
async fn settle(value: JsValue) -> Result<JsValue, JsValue> {
    value
        .dyn_into::<Promise>()
        .map_err(|_| unavailable())?
        .await
}

// This adapter is private. Its public bytes are obtained only from the newly
// generated Web Crypto keypair, never from a wire claim or a caller argument.
struct CandidateMint(Option<Identity>);
impl Keystore for CandidateMint {
    fn mint_group(&mut self) -> Option<Identity> {
        None
    }
    fn mint_member(&mut self) -> Option<Identity> {
        self.0.take()
    }
    fn refusal(&self) -> KeyMaterialRefusal {
        KeyMaterialRefusal::Absent
    }
}

#[wasm_bindgen]
pub struct BrowserCandidateKey {
    minted: Minted,
    private: RefCell<Option<JsValue>>,
}

impl BrowserCandidateKey {
    pub(crate) fn into_storage_custody(self) -> Result<JsValue, JsValue> {
        self.private.borrow_mut().take().ok_or_else(unavailable)
    }

    pub(crate) fn mint_proof(&self) -> Result<Minted, JsValue> {
        if self.private.borrow().is_none() {
            return Err(unavailable());
        }
        Ok(self.minted)
    }
}

#[wasm_bindgen]
impl BrowserCandidateKey {
    /// Generate a fresh nonextractable Ed25519 private key on this candidate.
    /// Unsupported browsers reject; no imported-key or software-seed fallback.
    pub async fn generate() -> Result<BrowserCandidateKey, JsValue> {
        let subtle = subtle()?;
        let usages = Array::new();
        usages.push(&JsValue::from_str("sign"));
        usages.push(&JsValue::from_str("verify"));
        let pair = settle(method(&subtle, "generateKey")?.call3(
            &subtle,
            &JsValue::from_str("Ed25519"),
            &JsValue::FALSE,
            &usages,
        )?)
        .await?;
        let private = field(&pair, "privateKey")?;
        if field(&private, "extractable")?.as_bool() != Some(false) {
            return Err(unavailable());
        }
        let public = field(&pair, "publicKey")?;
        let raw = settle(method(&subtle, "exportKey")?.call2(
            &subtle,
            &JsValue::from_str("raw"),
            &public,
        )?)
        .await?;
        let raw: [u8; 32] = Uint8Array::new(&raw)
            .to_vec()
            .try_into()
            .map_err(|_| unavailable())?;
        let minted = Minted::from_keystore(&mut CandidateMint(Some(Identity(raw))))
            .map_err(|_| unavailable())?;
        Ok(Self {
            minted,
            private: RefCell::new(Some(private)),
        })
    }

    /// Public candidate identity. A closed handle cannot be reused in a claim.
    pub fn public_key(&self) -> Result<Vec<u8>, JsValue> {
        if self.private.borrow().is_none() {
            return Err(unavailable());
        }
        Ok(self.minted.get().0.to_vec())
    }

    /// Sign canonical protocol bytes; the enclosing runtime owns authorization.
    /// Closing during crypto prevents its late result from reaching the caller.
    pub async fn sign(&self, message: Vec<u8>) -> Result<Vec<u8>, JsValue> {
        if message.is_empty() || message.len() > 4096 {
            return Err(unavailable());
        }
        let private = self
            .private
            .borrow()
            .as_ref()
            .cloned()
            .ok_or_else(unavailable)?;
        let subtle = subtle()?;
        let raw = settle(method(&subtle, "sign")?.call3(
            &subtle,
            &JsValue::from_str("Ed25519"),
            &private,
            &Uint8Array::from(message.as_slice()),
        )?)
        .await?;
        let mut signature = Uint8Array::new(&raw).to_vec();
        if self.private.borrow().is_none() || signature.len() != 64 {
            signature.fill(0);
            return Err(unavailable());
        }
        Ok(signature)
    }

    /// Drop this handle's volatile custody. Does not promise engine memory erasure.
    pub fn close(&self) {
        self.private.borrow_mut().take();
    }
}
