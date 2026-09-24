//! Browser boundary for the existing FORMATS 5d.1 certificate codec.
//!
//! Authenticity is not admission: the caller must establish the expected group,
//! subject, current epoch and revocation state through the runtime lifecycle.
use r2_trust::certificate::{
    standing, AcceptanceDepth, Certificate, Epoch, RevocationEntry, RevocationReason,
    RevocationSet, Standing, VerifiedRevocation, CERTIFICATE_SIGNED_LEN, REVOCATION_SIGNED_LEN,
};
use r2_trust::evidence::{
    signing_bytes, verify_evidence, Freshness, HighWaterMarks, MemberEvidence, MAX_STATEMENT,
};
use r2_trust::identity::Identity;
use r2_trust::suite::Ed25519;
use wasm_bindgen::prelude::*;

fn unsigned(subject: &[u8], group: &[u8], epoch: u64) -> Option<Certificate> {
    Some(Certificate {
        subject: Identity(subject.try_into().ok()?),
        group: Identity(group.try_into().ok()?),
        issued_at: Epoch(epoch),
        signature: [0; 64],
    })
}

/// Existing L5B invitation statement for an asynchronous browser member signer.
/// Empty output refuses malformed identities, code or an unknown role.
#[wasm_bindgen]
pub fn tg_invitation_statement(
    group: &[u8],
    issuer: &[u8],
    role: u8,
    code: &[u8],
    validity: u64,
) -> Vec<u8> {
    use r2_trust::ceremony::{Invitation, Role};
    use r2_trust::invitation::{invitation_statement, INVITATION_STATEMENT_LEN};
    let (Ok(group), Ok(issuer), Ok(code)) = (group.try_into(), issuer.try_into(), code.try_into())
    else {
        return Vec::new();
    };
    let role = match role {
        1 => Role::Member,
        2 => Role::KeyHolder,
        _ => return Vec::new(),
    };
    let invitation = Invitation {
        group: Identity(group),
        issuing_member: Identity(issuer),
        role,
        code,
        validity: Epoch(validity),
    };
    let mut out = [0; INVITATION_STATEMENT_LEN];
    invitation_statement(&invitation, &mut out);
    out.to_vec()
}

/// Canonical bytes for the browser's asynchronous group signer. No new format.
#[wasm_bindgen]
pub fn tg_certificate_signing_bytes(subject: &[u8], group: &[u8], epoch: u64) -> Vec<u8> {
    let Some(certificate) = unsigned(subject, group, epoch) else {
        return Vec::new();
    };
    let mut bytes = [0; CERTIFICATE_SIGNED_LEN];
    certificate.write_signed_bytes(&mut bytes);
    bytes.to_vec()
}

/// Encode only a correctly signed certificate. Empty output means refusal.
#[wasm_bindgen]
pub fn tg_certificate_encode(
    subject: &[u8],
    group: &[u8],
    epoch: u64,
    signature: &[u8],
) -> Vec<u8> {
    let Some(mut certificate) = unsigned(subject, group, epoch) else {
        return Vec::new();
    };
    let Ok(signature) = signature.try_into() else {
        return Vec::new();
    };
    certificate.signature = signature;
    if !certificate.verifies::<Ed25519>() {
        return Vec::new();
    }
    certificate.to_bytes().to_vec()
}

/// Check exact structure, expected identities and signature, not membership
/// currency or revocation. Expected identities must not come from an untrusted
/// certificate itself when deciding admission.
#[wasm_bindgen]
pub fn tg_certificate_authentic(bytes: &[u8], subject: &[u8], group: &[u8]) -> bool {
    let Some(certificate) = Certificate::from_bytes(bytes) else {
        return false;
    };
    certificate.subject.0.as_slice() == subject
        && certificate.group.0.as_slice() == group
        && certificate.verifies::<Ed25519>()
}

/// Canonical L5 evidence bytes for a verifier-issued nonce. The owner must
/// enforce nonce lifetime and single use; this encoder does not issue challenges.
#[wasm_bindgen]
pub fn tg_nonce_signing_bytes(statement: &[u8], nonce: &[u8]) -> Vec<u8> {
    let Ok(nonce) = nonce.try_into() else {
        return Vec::new();
    };
    let mut bytes = [0; MAX_STATEMENT + 17];
    let Some(len) = signing_bytes(statement, Freshness::Nonce(nonce), &mut bytes) else {
        return Vec::new();
    };
    bytes[..len].to_vec()
}

fn revocation(
    subject: &[u8],
    epoch: u64,
    sequence: u64,
    reason: u8,
    signature: &[u8],
) -> Option<RevocationEntry> {
    Some(RevocationEntry {
        subject: Identity(subject.try_into().ok()?),
        at_epoch: Epoch(epoch),
        sequence,
        reason: match reason {
            0 => RevocationReason::Compromise,
            1 => RevocationReason::Eviction,
            2 => RevocationReason::Retirement,
            3 => RevocationReason::Superseded,
            _ => return None,
        },
        signature: signature.try_into().ok()?,
        advisory_time: None,
    })
}

/// Existing FORMATS 5a.1 signing bytes, for an asynchronous platform signer.
#[wasm_bindgen]
pub fn tg_revocation_signing_bytes(
    subject: &[u8],
    epoch: u64,
    sequence: u64,
    reason: u8,
) -> Vec<u8> {
    let Some(entry) = revocation(subject, epoch, sequence, reason, &[0; 64]) else {
        return Vec::new();
    };
    let mut bytes = [0; REVOCATION_SIGNED_LEN];
    let len = entry.write_signed_bytes(&mut bytes);
    bytes[..len].to_vec()
}

fn invitation_from_statement(statement: &[u8]) -> Option<r2_trust::ceremony::Invitation> {
    use r2_trust::ceremony::{Invitation, Role};
    if statement.len() != r2_trust::invitation::INVITATION_STATEMENT_LEN {
        return None;
    }
    let invitation = Invitation {
        group: Identity(statement[..32].try_into().ok()?),
        issuing_member: Identity(statement[32..64].try_into().ok()?),
        role: match statement[64] {
            1 => Role::Member,
            2 => Role::KeyHolder,
            _ => return None,
        },
        code: statement[65..81].try_into().ok()?,
        validity: Epoch(u64::from_be_bytes(statement[81..89].try_into().ok()?)),
    };
    Some(invitation)
}

/// Existing L5B short comparison string. The ephemeral session is never stored.
#[wasm_bindgen]
pub fn tg_ceremony_verification_string(session: &[u8], statement: &[u8]) -> Vec<u8> {
    if session.len() != 32 || session.iter().all(|byte| *byte == 0) {
        return Vec::new();
    }
    let Some(invitation) = invitation_from_statement(statement) else {
        return Vec::new();
    };
    r2_trust::ceremony::ceremony_verification_string::<r2_trust::suite::HkdfSha256>(
        session,
        &invitation,
    )
    .to_vec()
}

/// Opaque result of the core invitation evidence check. This does not attest
/// issuer custody, validity on its ruler, co-presence, or installation consent.
#[wasm_bindgen]
pub struct BrowserInvitation {
    inner: r2_trust::invitation::AuthorisedInvitation,
}

impl BrowserInvitation {
    pub(crate) fn into_authorised(self) -> r2_trust::invitation::AuthorisedInvitation {
        self.inner
    }
}

#[wasm_bindgen]
impl BrowserInvitation {
    /// Public fields covered by the verified issuing member's signature.
    pub fn statement(&self) -> Vec<u8> {
        use r2_trust::invitation::{invitation_statement, INVITATION_STATEMENT_LEN};
        let mut out = [0; INVITATION_STATEMENT_LEN];
        invitation_statement(&self.inner.invitation(), &mut out);
        out.to_vec()
    }
}

/// Held public membership material. Construct only from an established group
/// and epoch policy, not from fields copied out of an untrusted certificate.
/// This object makes no network-freshness claim and does not persist itself.
#[wasm_bindgen]
pub struct BrowserMembership {
    group: Identity,
    current: Epoch,
    depth: AcceptanceDepth,
    revoked: RevocationSet<256>,
}

#[wasm_bindgen]
impl BrowserMembership {
    /// Run the actual L5B authorization boundary, retaining its opaque result.
    /// Caller owns the expected nonce, its lifetime and single-use enforcement.
    pub fn authorise_invitation(
        &self,
        statement: &[u8],
        certificate: &[u8],
        nonce: &[u8],
        signature: &[u8],
    ) -> Option<BrowserInvitation> {
        use r2_trust::invitation::{authorise_invitation, INVITATION_STATEMENT_LEN};
        if statement.len() != INVITATION_STATEMENT_LEN {
            return None;
        }
        let invitation = invitation_from_statement(statement)?;
        if invitation.group != self.group {
            return None;
        }
        let certificate = Certificate::from_bytes(certificate)?;
        let nonce = nonce.try_into().ok()?;
        let signature = signature.try_into().ok()?;
        let current =
            standing(&certificate, self.current, self.depth, &self.revoked) == Standing::Current;
        let authentic = certificate.verifies::<Ed25519>();
        let evidence = MemberEvidence {
            certificate,
            statement,
            freshness: Freshness::Nonce(nonce),
            signature,
        };
        let inner = authorise_invitation::<Ed25519, 0>(
            &invitation,
            &evidence,
            current,
            authentic,
            Some(&nonce),
            &mut HighWaterMarks::new(),
        )
        .ok()?;
        Some(BrowserInvitation { inner })
    }

    /// Verify the member's actual L5 evidence against held epoch/revocation
    /// state. Nonce issuance, single use and expiry belong to the caller.
    pub fn verify_nonce(
        &self,
        bytes: &[u8],
        subject: &[u8],
        statement: &[u8],
        nonce: &[u8],
        signature: &[u8],
    ) -> bool {
        let Some(certificate) = Certificate::from_bytes(bytes) else {
            return false;
        };
        if certificate.subject.0.as_slice() != subject {
            return false;
        }
        let Ok(nonce) = nonce.try_into() else {
            return false;
        };
        let Ok(signature) = signature.try_into() else {
            return false;
        };
        let current =
            standing(&certificate, self.current, self.depth, &self.revoked) == Standing::Current;
        let authentic = certificate.verifies::<Ed25519>();
        let evidence = MemberEvidence {
            certificate,
            statement,
            freshness: Freshness::Nonce(nonce),
            signature,
        };
        verify_evidence::<Ed25519, 0>(
            &evidence,
            &self.group,
            current,
            authentic,
            Some(&nonce),
            &mut HighWaterMarks::new(),
        )
        .is_ok()
    }
    /// Invalid group length returns no state. No certificate can advance current.
    pub fn establish(group: &[u8], current: u64, depth: u64) -> Option<BrowserMembership> {
        Some(Self {
            group: Identity(group.try_into().ok()?),
            current: Epoch(current),
            depth: AcceptanceDepth(depth),
            revoked: RevocationSet::new(),
        })
    }

    /// A verified revocation is terminal regardless of the certificate's epoch.
    /// Full capacity refuses rather than evicting an older revocation.
    pub fn apply_revocation(
        &mut self,
        subject: &[u8],
        epoch: u64,
        sequence: u64,
        reason: u8,
        signature: &[u8],
    ) -> bool {
        let Some(entry) = revocation(subject, epoch, sequence, reason, signature) else {
            return false;
        };
        let Some(verified) = VerifiedRevocation::verify::<Ed25519>(entry, &self.group) else {
            return false;
        };
        self.revoked.append(verified).is_ok()
    }

    /// Evaluates the actual core standing rules after authentication/context checks.
    pub fn status(&self, bytes: &[u8], subject: &[u8]) -> String {
        let Some(certificate) = Certificate::from_bytes(bytes) else {
            return "invalid".into();
        };
        if certificate.subject.0.as_slice() != subject
            || certificate.group != self.group
            || !certificate.verifies::<Ed25519>()
        {
            return "invalid".into();
        }
        match standing(&certificate, self.current, self.depth, &self.revoked) {
            Standing::Current => "current",
            Standing::Stale => "stale",
            Standing::Ahead => "ahead",
            Standing::Revoked => "revoked",
        }
        .into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn held_policy_rejects_future_and_stale_authority_and_revocation_is_terminal() {
        let signer = SigningKey::from_bytes(&[31; 32]);
        let group = signer.verifying_key().to_bytes();
        let subject = [42; 32];
        let certificate = |epoch| {
            let message = tg_certificate_signing_bytes(&subject, &group, epoch);
            tg_certificate_encode(&subject, &group, epoch, &signer.sign(&message).to_bytes())
        };
        let mut state = BrowserMembership::establish(&group, 5, 1).unwrap();
        assert_eq!(state.status(&certificate(6), &subject), "ahead");
        assert_eq!(state.status(&certificate(3), &subject), "stale");
        assert_eq!(state.status(&certificate(4), &subject), "current");
        assert!(!state.apply_revocation(&subject, 5, 1, 0, &[0; 64]));
        assert_eq!(state.status(&certificate(5), &subject), "current");
        let message = tg_revocation_signing_bytes(&subject, 5, 1, 0);
        let signature = signer.sign(&message).to_bytes();
        assert!(!state.apply_revocation(&subject, 5, 1, 1, &signature));
        assert!(state.apply_revocation(&subject, 5, 1, 0, &signature));
        assert!(state.apply_revocation(&subject, 5, 1, 0, &signature));
        assert_eq!(state.status(&certificate(6), &subject), "revoked");
        assert_eq!(state.status(&certificate(3), &subject), "revoked");
        assert!(tg_revocation_signing_bytes(&subject, 5, 1, 4).is_empty());
    }

    #[test]
    fn browser_boundary_uses_core_codec_and_refuses_forgery_and_wrong_context() {
        let signer = SigningKey::from_bytes(&[19; 32]);
        let group = signer.verifying_key().to_bytes();
        let subject = [27; 32];
        let message = tg_certificate_signing_bytes(&subject, &group, u64::MAX);
        let signature = signer.sign(&message).to_bytes();
        let bytes = tg_certificate_encode(&subject, &group, u64::MAX, &signature);
        let decoded = Certificate::from_bytes(&bytes).unwrap();
        assert_eq!(decoded.issued_at, Epoch(u64::MAX));
        assert_eq!(decoded.to_bytes().as_slice(), bytes);
        assert!(tg_certificate_authentic(&bytes, &subject, &group));
        assert!(!tg_certificate_authentic(&bytes, &[28; 32], &group));
        assert!(!tg_certificate_authentic(&bytes, &subject, &[20; 32]));
        assert!(!tg_certificate_authentic(
            &bytes[..bytes.len() - 1],
            &subject,
            &group
        ));
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(!tg_certificate_authentic(&trailing, &subject, &group));
        let mut forged = bytes;
        forged[72] ^= 1;
        assert!(!tg_certificate_authentic(&forged, &subject, &group));
        assert!(tg_certificate_encode(&subject, &group, 0, &signature).is_empty());
        assert!(tg_certificate_signing_bytes(&subject[..31], &group, 0).is_empty());
        assert!(tg_certificate_encode(&subject, &group, 0, &[0; 63]).is_empty());
    }
}
