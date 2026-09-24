//! Key material at rest (L5 5.3.2), where the forbidden case has no code path.
//!
//! **5.3.2's last sentence is absolute — *plaintext key material at rest is
//! forbidden in every case* — so this module offers no way to write it.**
//! [`persist_derived_key`] asks the platform for its sealing facility and
//! refuses when there is none. There is no second entry point, no flag, and
//! no `Storage` handle reachable from here with a key in hand.
//!
//! *That is the same discipline as the confidentiality exemption one clause
//! over: the branch the corpus forbids is one nobody can type.*
//!
//! **The refusal is not a failure.** 5.3.2's second sentence makes
//! volatile-only a **conforming regime** for a platform with no
//! hardware-rooted secret, and `L5` Note 0 to 5.3.1 records why it must be
//! declared rather than inferred: the relative and absolute obligations
//! contradict on such a platform, `5.3.1a` rules the absolute one governs,
//! and *"an implementer resolving it privately will resolve it the cheap
//! way."* So the platform declares, and the caller is told which regime it is
//! in rather than discovering it by a write that silently succeeded.

use crate::keys::SecretKey;
use r2_hal_traits::sealing::{HasSealing, Sealing, SealingFacility};

/// Why a derived key was not persisted.
#[derive(Debug, PartialEq, Eq)]
pub enum PersistRefusal {
    /// The platform declares no hardware-rooted secret. **Conforming**: under
    /// 5.3.2 this key lives in volatile memory only and is re-obtained on
    /// next contact with the group.
    ///
    /// *Note 1 to 5.3.2 records that the volatile-only rule cannot be
    /// absolute, because a member that is not a key holder has no group
    /// secret to re-derive from. `L5B 10.6` now states the gap in the
    /// corpus itself — **"the material exists, is entailed by other clauses,
    /// and is named by no clause"** — and lists what is undecided, including
    /// **what the `re-obtained on next contact with the group` path actually
    /// is**. `STD-SS271`, owner Roy. This lane does not resolve it here.*
    NoSealingFacility,
    /// The part can root a secret and nothing has provisioned one.
    /// **Same obligation as [`Self::NoSealingFacility`], different remedy:**
    /// *unprovisioned is not incapable*, and telling them apart is the
    /// difference between burning an eFuse and changing boards.
    SealingNotProvisioned,
    /// The facility was asked and could not seal.
    FacilityRefused,
    /// `out` was too small for the sealed form.
    BufferTooSmall,
}

/// Persist a derived key, sealed, or refuse — and never write it in clear.
///
/// Returns the sealed length written to `out`.
pub fn persist_derived_key<const N: usize, P: HasSealing>(
    platform: &mut P,
    key: &SecretKey<N>,
    out: &mut [u8],
) -> Result<usize, PersistRefusal> {
    // Asked BEFORE the key is touched: a platform with no facility must not
    // reach a code path that has plaintext key material and a buffer.
    let facility = match platform.sealing() {
        Sealing::Provisioned(f) => f,
        // Both negative variants are the same obligation and different
        // remedies: provisioning versus different hardware. 5.3.2 does not
        // distinguish them and the operator must.
        Sealing::CapableButUnprovisioned => return Err(PersistRefusal::SealingNotProvisioned),
        Sealing::Unavailable => return Err(PersistRefusal::NoSealingFacility),
    };
    if out.is_empty() {
        return Err(PersistRefusal::BufferTooSmall);
    }
    match facility.seal(key.expose(), out) {
        Ok(n) if n <= out.len() => Ok(n),
        Ok(_) => {
            // A facility that reports more than it was given has not sealed
            // anything this caller can trust. Treat it as a refusal and
            // leave nothing behind.
            {
                use zeroize::Zeroize as _;
                out.zeroize();
            }
            Err(PersistRefusal::FacilityRefused)
        }
        Err(_) => {
            // The output may hold a partial seal, and a partial seal of key
            // material is key material. Same reason `open` zeroes on failure.
            {
                use zeroize::Zeroize as _;
                out.zeroize();
            }
            Err(PersistRefusal::FacilityRefused)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A facility that seals by a trivial reversible transform. **Not a
    /// cipher and named as a fixture** — what is under test is the refusal
    /// structure, not the sealing.
    struct Facility(bool);
    impl SealingFacility for Facility {
        type Error = ();
        fn seal(&mut self, plaintext: &[u8], out: &mut [u8]) -> Result<usize, ()> {
            if !self.0 || out.len() < plaintext.len() {
                return Err(());
            }
            for (o, p) in out.iter_mut().zip(plaintext) {
                *o = p ^ 0xA5;
            }
            Ok(plaintext.len())
        }
        fn unseal(&mut self, sealed: &[u8], out: &mut [u8]) -> Result<usize, ()> {
            self.seal(sealed, out)
        }
    }

    enum Decl {
        Provisioned(Facility),
        Unprovisioned,
        None,
    }
    struct Platform(Decl);
    impl HasSealing for Platform {
        type Facility = Facility;
        fn sealing(&mut self) -> Sealing<'_, Facility> {
            match &mut self.0 {
                Decl::Provisioned(f) => Sealing::Provisioned(f),
                Decl::Unprovisioned => Sealing::CapableButUnprovisioned,
                Decl::None => Sealing::Unavailable,
            }
        }
    }

    fn key() -> SecretKey<32> {
        SecretKey::new(&mut [0x11u8; 32])
    }

    #[test]
    fn a_platform_with_a_facility_persists_sealed_and_not_in_clear() {
        let mut p = Platform(Decl::Provisioned(Facility(true)));
        let mut out = [0u8; 32];
        let n = persist_derived_key(&mut p, &key(), &mut out).expect("seals");
        assert_eq!(n, 32);
        // **The falsifier.** A facility that merely copied would pass a
        // length check and write the key to storage in clear.
        assert_ne!(&out[..], &[0x11u8; 32][..]);
    }

    /// 5.3.2's second regime: conforming, declared, and it writes nothing.
    #[test]
    fn a_platform_without_one_refuses_and_leaves_the_buffer_untouched() {
        let mut p = Platform(Decl::None);
        let mut out = [0xEEu8; 32];
        let got = persist_derived_key(&mut p, &key(), &mut out);
        assert_eq!(got, Err(PersistRefusal::NoSealingFacility));
        assert!(out.iter().all(|&b| b == 0xEE));
    }

    /// **Hive's distinction, asserted rather than described.** A part that
    /// could root a secret but has not been provisioned refuses with its
    /// own reason — the remedy is burning an eFuse, not changing boards.
    #[test]
    fn capable_but_unprovisioned_is_told_apart_from_incapable() {
        let mut p = Platform(Decl::Unprovisioned);
        let mut out = [0xEEu8; 32];
        let got = persist_derived_key(&mut p, &key(), &mut out);
        assert_eq!(got, Err(PersistRefusal::SealingNotProvisioned));
        assert_ne!(got, Err(PersistRefusal::NoSealingFacility));
        assert!(out.iter().all(|&b| b == 0xEE));
        // ...and both are the same OBLIGATION.
        assert!(Platform(Decl::Unprovisioned).sealing().is_volatile_only());
        assert!(Platform(Decl::None).sealing().is_volatile_only());
    }

    /// A facility that fails leaves no partial seal — a partial seal of key
    /// material is key material.
    #[test]
    fn a_failing_facility_leaves_nothing_behind() {
        let mut p = Platform(Decl::Provisioned(Facility(false)));
        let mut out = [0xEEu8; 32];
        let got = persist_derived_key(&mut p, &key(), &mut out);
        assert_eq!(got, Err(PersistRefusal::FacilityRefused));
        assert!(out.iter().all(|&b| b == 0));
    }
}
