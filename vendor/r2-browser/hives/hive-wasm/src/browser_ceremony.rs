//! Browser bridge to the core ceremony. Platform facts and exchange evidence
//! must come from the enclosing runtime; this does not establish initial trust.
//! A prepared persona is volatile and is not a durable installation receipt.
use crate::browser_candidate::BrowserCandidateKey;
use crate::browser_membership::BrowserInvitation;
use r2_hal_traits::build_mode::BuildMode;
use r2_trust::{
    ceremony::{AbortCause, Ceremony, CeremonyRefusal, Role, VerificationGrade},
    certificate::{Certificate, Epoch},
    membership::{ClaimState, Persona},
    suite::Ed25519,
};
use wasm_bindgen::prelude::*;

fn unavailable() -> JsValue {
    JsValue::from_str("Candidate ceremony unavailable")
}
fn claim(value: &str) -> Result<ClaimState, JsValue> {
    match value {
        "open" => Ok(ClaimState::Open),
        "owner" => Ok(ClaimState::Owner),
        _ => Err(unavailable()),
    }
}
fn mode(development: bool) -> BuildMode {
    if development {
        BuildMode::Development
    } else {
        BuildMode::Production
    }
}
fn refused(error: CeremonyRefusal) -> JsValue {
    JsValue::from_str(&format!("Candidate ceremony refused: {error:?}"))
}

/// Owns core ordering and the candidate's newly generated member key.
/// No method accepts an arbitrary candidate public identity.
#[wasm_bindgen]
pub struct BrowserCandidateCeremony {
    core: Ceremony,
    candidate: Option<BrowserCandidateKey>,
    closed: bool,
}

#[wasm_bindgen]
impl BrowserCandidateCeremony {
    /// Consume verified invitation evidence. The caller must supply actual
    /// platform claim/build state and the provisioner's custody/epoch facts.
    /// This ordinary-member adapter cannot grant the key-holder role.
    pub fn discover(
        invitation: BrowserInvitation,
        candidate_state: &str,
        candidate_development: bool,
        provisioner_development: bool,
        provisioner_holds_custody: bool,
        provisioner_epoch: u64,
    ) -> Result<BrowserCandidateCeremony, JsValue> {
        let authorised = invitation.into_authorised();
        if authorised.invitation().role != Role::Member {
            return Err(unavailable());
        }
        let core = Ceremony::discover(
            authorised,
            claim(candidate_state)?,
            mode(candidate_development),
            mode(provisioner_development),
            if provisioner_holds_custody {
                Role::KeyHolder
            } else {
                Role::Member
            },
            Epoch(provisioner_epoch),
        )
        .map_err(refused)?;
        Ok(Self {
            core,
            candidate: None,
            closed: false,
        })
    }

    /// Record the actual commitment before the provisioner reveals.
    pub fn candidate_commits(&mut self, commitment: &[u8]) -> Result<(), JsValue> {
        self.guard(|this| {
            this.core
                .candidate_commits(commitment.try_into().map_err(|_| unavailable())?)
                .map_err(refused)
        })
    }

    /// Record contributions only after the exchange has verified the commitment
    /// and completed nondegenerate shared-secret derivation. The core orders the
    /// steps; it does not perform that cryptographic verification on these bytes.
    pub fn exchanged(&mut self, provisioner: &[u8], candidate: &[u8]) -> Result<(), JsValue> {
        self.guard(|this| {
            this.core
                .exchange(
                    provisioner.try_into().map_err(|_| unavailable())?,
                    candidate.try_into().map_err(|_| unavailable())?,
                )
                .map_err(refused)
        })
    }

    /// The enclosing comparison session must establish both people's decisions.
    /// A boolean is not evidence of co-presence or of the displayed comparison.
    pub fn confirm(&mut self, matched: bool) -> Result<(), JsValue> {
        self.guard(|this| {
            this.core
                .verify(VerificationGrade::GlanceConfirmed, matched)
                .map_err(refused)
        })
    }

    /// Consume this candidate's generated key and run the first OPEN check.
    /// A refused request drops custody; a successful one retains it here.
    pub fn request(
        &mut self,
        candidate: BrowserCandidateKey,
        candidate_state_now: &str,
    ) -> Result<Vec<u8>, JsValue> {
        self.guard(move |this| {
            let minted = candidate.mint_proof()?;
            this.core
                .request(claim(candidate_state_now)?, minted)
                .map_err(refused)?;
            let public = candidate.public_key()?;
            this.candidate = Some(candidate);
            Ok(public)
        })
    }

    /// Core certificate validation and the second OPEN check, synchronously.
    /// The returned persona is PREPARED ONLY. Storage must atomically compare
    /// current claim state, persist custody/persona and consume the invitation.
    /// Do not announce enrollment or grant application access from this result.
    pub fn prepare_install(
        &mut self,
        certificate: &[u8],
        candidate_state_now: &str,
    ) -> Result<BrowserPreparedPersona, JsValue> {
        self.guard(|this| {
            this.candidate
                .as_ref()
                .ok_or_else(unavailable)?
                .mint_proof()?;
            let certificate = Certificate::from_bytes(certificate).ok_or_else(unavailable)?;
            let persona = this
                .core
                .install::<Ed25519>(claim(candidate_state_now)?, &certificate)
                .map_err(refused)?;
            Ok(BrowserPreparedPersona {
                persona,
                candidate: this.candidate.take(),
                certificate: certificate.to_bytes().to_vec(),
            })
        })
    }

    /// End volatile custody. The enclosing session also voids its durable journal.
    pub fn close(&mut self) {
        if !self.closed {
            self.closed = true;
            self.core.abort(AbortCause::Unstated, ClaimState::Open);
            if let Some(candidate) = self.candidate.take() {
                candidate.close();
            }
        }
    }
}

impl BrowserCandidateCeremony {
    fn guard<T>(
        &mut self,
        action: impl FnOnce(&mut Self) -> Result<T, JsValue>,
    ) -> Result<T, JsValue> {
        if self.closed {
            return Err(unavailable());
        }
        let result = action(self);
        if result.is_err() {
            self.close();
        }
        result
    }
}

/// Public metadata from a core-validated, volatile prepared persona.
/// No public constructor; no durable-installation or credential authority.
#[wasm_bindgen]
pub struct BrowserPreparedPersona {
    persona: Persona,
    candidate: Option<BrowserCandidateKey>,
    certificate: Vec<u8>,
}

#[wasm_bindgen]
impl BrowserPreparedPersona {
    /// Transfer the candidate's nonextractable browser key and core-validated
    /// public metadata together. This record has NO hardware-sealing claim and
    /// contains no group issuer or derived traffic keys. The enclosing runtime
    /// owns atomic persistence and cannot treat this as a commit receipt.
    pub fn into_browser_record(mut self) -> Result<JsValue, JsValue> {
        use js_sys::{Object, Reflect, Uint8Array};
        let private = self
            .candidate
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
        set(
            "certificate",
            &Uint8Array::from(self.certificate.as_slice()),
        )?;
        set("privateKey", &private)?;
        Ok(record.into())
    }

    pub fn group(&self) -> Vec<u8> {
        self.persona.group().0.to_vec()
    }
    pub fn member(&self) -> Vec<u8> {
        self.persona.member().0.to_vec()
    }
}
