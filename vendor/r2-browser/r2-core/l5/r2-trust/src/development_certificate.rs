//! Published-credential admission for the single Dev TG (L5 9, L5B 4.5).
//! A certificate is public and does not prove possession of its member signer.
//! This module is absent without the explicit development-group feature. It
//! never treats the published issuer seed as entropy or mints another group.
use crate::{
    certificate::{Certificate, Epoch, CERTIFICATE_SIGNED_LEN},
    development,
    membership::{may_join, AdmissionRefusal, GroupKind},
    Identity,
};
use ed25519_dalek::Signer as _;
use r2_hal_traits::build_mode::BuildMode;

/// Issue under the existing published issuer, only for a development-mode
/// caller. `epoch` is trusted local Dev TG state, not a peer-supplied epoch.
/// Admission still needs the real member's nonce-bound evidence and all current
/// epoch/revocation checks; this public certificate alone authorizes no action.
pub fn issue(
    mode: BuildMode,
    subject: Identity,
    epoch: Epoch,
) -> Result<Certificate, AdmissionRefusal> {
    may_join(mode, GroupKind::Development)?;
    let key = ed25519_dalek::SigningKey::from_bytes(&development::SECRET);
    let mut certificate = Certificate {
        subject,
        group: development::IDENTITY,
        issued_at: epoch,
        signature: [0; 64],
    };
    let mut bytes = [0; CERTIFICATE_SIGNED_LEN];
    certificate.write_signed_bytes(&mut bytes);
    certificate.signature = key.sign(&bytes).to_bytes();
    // formats-suite requires dalek/zeroize: the temporary signing key is erased
    // by its existing Drop implementation. No issuer custody is exported.
    Ok(certificate)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_issuer_refuses_production_and_binds_exact_subject_and_epoch() {
        let subject = Identity([17; 32]);
        assert_eq!(
            issue(BuildMode::Production, subject, Epoch(9)),
            Err(AdmissionRefusal::ProductionDeviceIntoDevelopmentGroup)
        );
        let certificate = issue(BuildMode::Development, subject, Epoch(9)).unwrap();
        assert!(certificate.verifies::<crate::suite::Ed25519>());
        assert_eq!(certificate.subject, subject);
        assert_eq!(certificate.group, development::IDENTITY);
        assert_eq!(certificate.issued_at, Epoch(9));
        let mut changed = certificate;
        changed.subject.0[0] ^= 1;
        assert!(!changed.verifies::<crate::suite::Ed25519>());
        changed = certificate;
        changed.issued_at = Epoch(10);
        assert!(!changed.verifies::<crate::suite::Ed25519>());
    }
}
