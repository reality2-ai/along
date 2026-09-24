//! The platform's sealing facility (L5 5.3.2), and its absence.
//!
//! **5.3.2 is absolute**: *"Derived keys shall be persisted only sealed, such
//! that what rests in storage is unreadable without a hardware-rooted secret
//! of the device. Where the platform provides no such facility, derived keys
//! shall live in volatile memory only and be re-obtained on next contact with
//! the group. **Plaintext key material at rest is forbidden in every case.**"*
//!
//! **The absence is a variant, not a missing implementation.** `L5` Note 0 to
//! 5.3.1 records that 5.3.1's *relative* obligation — the most protected
//! facility the platform provides — and 5.3.2's *absolute* one **contradict on
//! a platform with nothing**, because plaintext flash satisfies the relative
//! reading. `5.3.1a` says the absolute one governs, and the note adds the part
//! that decides the shape here: *"an implementer resolving it privately will
//! resolve it the cheap way."* So the platform declares which regime it is in
//! and the type system carries the answer — rather than a `Storage` write
//! being reachable with key material and a comment asking for restraint.

/// Why a platform can or cannot seal at rest — **three states, because two
/// of them are both "no" today and change for different reasons.**
///
/// L5 5.3.2's obligation is binary: a facility, or volatile-only. **The
/// declaration is not.** *Unprovisioned is not incapable*: the ESP32-S3 has
/// eFuse key blocks, HMAC and DS peripherals, so a hardware-rooted secret is
/// **reachable** on the part — it is simply not burned, not enabled and not
/// used. **A declaration that conflates the two is wrong the day someone
/// burns an eFuse, rather than the day someone changes boards.**
/// *(Measured on the bench by r2-hive, 2026-08-04: DFR1195, no ATECC608, no
/// secure boot, no flash encryption, no eFuse/HMAC/DS use anywhere.)*
///
/// **This type is filling a gap the corpus names.** 5.3.2 states the
/// requirement as a **property** — *unreadable without the hardware-rooted
/// secret* — **never as a named silicon feature**, and says outright that
/// *"how its presence is declared and checked remains the Layer 0 gap
/// (L0 10.4) this clause inherits."* So this is `PROVISIONAL` against
/// `L0 10.4`, and the shape is chosen to be honest rather than minimal.
impl<F: SealingFacility> core::fmt::Debug for Sealing<'_, F> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // The facility itself is opaque (it holds the secret's handle);
        // the variant is the fact worth printing.
        f.write_str(match self {
            Sealing::Provisioned(_) => "Sealing::Provisioned(..)",
            Sealing::CapableButUnprovisioned => "Sealing::CapableButUnprovisioned",
            Sealing::Unavailable => "Sealing::Unavailable",
        })
    }
}

pub enum Sealing<'a, F: SealingFacility> {
    /// A hardware-rooted secret exists and is usable now.
    Provisioned(&'a mut F),
    /// The part can root a secret; nothing has provisioned one.
    /// **Volatile-only today, and the remedy is provisioning.**
    CapableButUnprovisioned,
    /// No hardware-rooted secret is reachable on this platform at all.
    /// **Volatile-only, and the remedy is different hardware.**
    Unavailable,
}

impl<F: SealingFacility> Sealing<'_, F> {
    /// Whether 5.3.2's volatile-only regime applies. **Both negative
    /// variants answer the same here** — the obligation does not care why,
    /// only the operator does.
    #[must_use]
    pub const fn is_volatile_only(&self) -> bool {
        !matches!(self, Sealing::Provisioned(_))
    }
}

/// A platform's declaration of its sealing ability.
pub trait HasSealing {
    type Facility: SealingFacility;

    /// Declare the regime this platform is in.
    ///
    /// **Every variant is a conforming answer.** 5.3.2's second sentence
    /// makes volatile-only a permitted regime, not a failure, and the
    /// platform is the only party that can say which one it is in.
    fn sealing(&mut self) -> Sealing<'_, Self::Facility>;
}

/// Seal and unseal under a hardware-rooted secret of this device.
///
/// **Not a cipher trait.** The key never appears in this interface: it is the
/// device's, held by the platform, and the whole point of 5.3.2 is that what
/// rests in storage cannot be used without it. A facility that took a key
/// argument would be an ordinary AEAD and would not satisfy the clause.
pub trait SealingFacility {
    type Error: core::fmt::Debug;

    /// Seal `plaintext` into `out`, returning the sealed length.
    fn seal(&mut self, plaintext: &[u8], out: &mut [u8]) -> Result<usize, Self::Error>;

    /// Unseal `sealed` into `out`, returning the plaintext length.
    ///
    /// **On any failure this must not write a partial plaintext**, for the
    /// same reason the payload cipher zeroes its output: a caller that reads
    /// `out` after an error must not find key material there.
    fn unseal(&mut self, sealed: &[u8], out: &mut [u8]) -> Result<usize, Self::Error>;
}
