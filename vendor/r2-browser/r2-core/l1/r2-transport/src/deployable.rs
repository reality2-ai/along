//! **What a deployable image must carry, and whose a conformance claim is
//! (L1 4.9, 5.2.0).**
//!
//! # ‼ FRUGALITY AT RUNTIME, NEVER AT BUILD TIME — AND THE TWO LOOK ALIKE
//!
//! **4.9.1**: a **deployable image** — a production image, as distinct from a
//! development one — *shall include a binding for every bearer the target
//! hardware provides; only a bearer whose hardware is absent from the target
//! may be omitted.* **4.9.2**: *frugality shall be exercised at runtime — by
//! disabling a bearer — and never by omitting its binding at build time.*
//!
//! **From outside, an omitted binding and a disabled bearer are the same
//! silence.** Both produce a hive that never transmits on that radio. The
//! difference only appears when somebody tries to *enable* it: a disabled
//! bearer comes up, and an omitted one cannot, because the code is not in the
//! image. *So a deployment believes it holds a fallback it does not have, and
//! discovers otherwise at the moment it needs it.*
//!
//! That is why 4.9.2 is a clause rather than advice, and why this module
//! compares **what the hardware provides** against **what the image carries**
//! rather than against what is currently enabled.
//!
//! # 4.9.4 narrows the obligation, and the narrowing is not a loophole
//!
//! *A bearer not carried by a radio of its own is not obliged by this clause
//! — whether it rides an operating system's networking, or an IP stack linked
//! into the image itself.* So the question is **which radios the target
//! has**, not which ordinals exist.
//!
//! # ‼ 5.2.0's SECOND HALF, WHICH `l1.rs` RECORDS AS HAVING NO REPRESENTATION
//!
//! *A conformance claim about a bearer shall be scoped to the hive making
//! it*, and nothing carried that scope — `l1.rs` says so at its own
//! `state()` and marks `L1-059` PARTIAL for it. **A claim with no subject is
//! a claim that can be quoted about a different hive**, which is precisely
//! what a scope exists to prevent: two hives may run the same bearer in
//! different profiles, *with neither being wrong.*

use crate::l1::Ordinal;

/// The assigned ordinals (L1 8.2.2's `ASSIGNABLE_BEARERS`).
const ORDINALS: [Ordinal; 6] = [
    Ordinal::Ble,
    Ordinal::Lora,
    Ordinal::Tcp,
    Ordinal::Usb,
    Ordinal::WifiMesh,
    Ordinal::Udp,
];
use r2_ident::HiveId;

/// The radios a target board physically has (4.9.1, 4.9.4).
///
/// ‼ **HARDWARE, NOT ORDINALS.** 4.9.4 excludes a bearer *not carried by a
/// radio of its own* — one riding an operating system's networking, or an IP
/// stack linked into the image. *Naming this `radios_present` rather than
/// `bearers` keeps the distinction at the call site, where a reader can see
/// it.*
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct RadiosPresent {
    bits: u8,
}

/// The bindings an image was built with.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct BindingsCompiled {
    bits: u8,
}

/// **Which radios this platform can actually remove power from (4.9.3's
/// *where the hardware permits*).**
///
/// ‼ **DECLARED, NEVER INFERRED.** A radio still drawing current because the
/// hardware cannot gate it and one still drawing because nobody gated it are
/// **the same observation** — and only the second is a breach. *A platform
/// that has not said it can gate a radio has not thereby said it cannot*, so
/// the default here is `none()` and that reads as **no gating declared**
/// rather than as a claim about the silicon.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct RadiosPowerGatable {
    bits: u8,
}

macro_rules! bitset {
    ($t:ty) => {
        impl $t {
            pub const fn none() -> Self {
                Self { bits: 0 }
            }
            pub const fn with(self, o: Ordinal) -> Self {
                Self {
                    bits: self.bits | o.bit(),
                }
            }
            pub const fn has(&self, o: Ordinal) -> bool {
                self.bits & o.bit() != 0
            }
            pub const fn bits(&self) -> u8 {
                self.bits
            }
        }
    };
}
bitset!(RadiosPresent);
bitset!(BindingsCompiled);
bitset!(RadiosPowerGatable);

/// Which build this is (L6 6.2.1).
///
/// ‼ **4.9.1 BINDS A DEPLOYABLE IMAGE AND NOT A DEVELOPMENT ONE**, and the
/// distinction is the clause's own. *A development image omitting a binding
/// is a bench convenience; a production image doing it is a deployment that
/// cannot recover a bearer it appears to have.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImageKind {
    Development,
    Deployable,
}

/// Why an image does not satisfy 4.9.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ImageRefusal {
    /// **4.9.1**: the hardware has this radio and the image carries no
    /// binding for it.
    ///
    /// ‼ **THIS IS 4.9.2's FAILURE SEEN FROM THE BUILD SIDE.** *Only a
    /// bearer whose hardware is absent from the target may be omitted* — so
    /// an omission here is frugality taken at build time, which the clause
    /// forbids by name.
    BindingMissingForPresentRadio { radio: Ordinal },
}

/// **4.9.1 and 4.9.2: may this image be deployed to this hardware?**
///
/// Checks the **first** missing binding rather than collecting all of them:
/// the answer is the same and the first names a concrete radio a person can
/// act on.
pub fn image_is_deployable(
    kind: ImageKind,
    radios: RadiosPresent,
    compiled: BindingsCompiled,
) -> Result<(), ImageRefusal> {
    // 4.9.1 binds a DEPLOYABLE image. A development image is outside it, and
    // saying so here keeps the exemption where the clause put it.
    if matches!(kind, ImageKind::Development) {
        return Ok(());
    }
    // ‼ **EVERY ASSIGNED ORDINAL, ENUMERATED HERE RATHER THAN SAMPLED.**
    // L1 8.2.2 fixes the live set as `ASSIGNABLE_BEARERS` (0x7D) and 8.4.3
    // says a new bearer takes the lowest unassigned one — *so a list written
    // by hand goes stale the day an ordinal is assigned, and the failure is
    // an image that passes because nothing looked at the new radio.*
    for radio in ORDINALS {
        if radios.has(radio) && !compiled.has(radio) {
            return Err(ImageRefusal::BindingMissingForPresentRadio { radio });
        }
    }
    Ok(())
}

/// **4.9.2, asked of a live hive: is this bearer off because somebody
/// disabled it, or because it was never built in?**
///
/// ‼ **THE ANSWER IS THE DIFFERENCE BETWEEN A FALLBACK AND A GAP**, and from
/// the outside the two are the same silence. *A deployment that believes it
/// can enable a bearer it does not carry discovers otherwise at the moment it
/// needs it.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WhyOff {
    /// Disabled at runtime — 4.9.2's permitted frugality. It can come back.
    DisabledAtRuntime,
    /// **No binding in the image.** It cannot come back without a new image,
    /// and on a deployable image this is a 4.9.2 breach.
    NotCompiledIn,
    /// The hardware is absent, so nothing is owed (4.9.1's exception).
    NoSuchRadio,
}

/// Why a bearer is not carrying traffic.
pub fn why_off(
    radio: Ordinal,
    radios: RadiosPresent,
    compiled: BindingsCompiled,
    enabled: bool,
) -> Option<WhyOff> {
    if !radios.has(radio) {
        return Some(WhyOff::NoSuchRadio);
    }
    if !compiled.has(radio) {
        return Some(WhyOff::NotCompiledIn);
    }
    (!enabled).then_some(WhyOff::DisabledAtRuntime)
}

/// **4.9.3, asked of a bearer that IS off: did disabling it save anything?**
///
/// ‼ **`WhyOff::DisabledAtRuntime` IS 4.9.2 SATISFIED AND SAYS NOTHING ABOUT
/// 4.9.3.** The first clause permits frugality at runtime; the second is
/// about current, and *frugality exercised by setting a flag saves exactly
/// nothing.* A deployment that disabled a bearer to make a battery last has
/// been told it succeeded by a value that never asked.
///
/// Returns `None` where the bearer is not disabled-at-runtime at all — a
/// bearer that is off because it was never compiled in, or has no radio, is
/// not a 4.9.3 subject, and answering for it would put a power verdict on a
/// radio that does not exist.
pub fn power_after_disable(
    radio: Ordinal,
    radios: RadiosPresent,
    compiled: BindingsCompiled,
    enabled: bool,
    gatable: RadiosPowerGatable,
    power_removed: bool,
) -> Option<crate::radio_power::RadioPower> {
    match why_off(radio, radios, compiled, enabled) {
        Some(WhyOff::DisabledAtRuntime) => Some(crate::radio_power::on_disable(
            gatable.has(radio),
            power_removed,
        )),
        _ => None,
    }
}

/// **5.2.0: a conformance claim about a bearer, scoped to the hive making
/// it.**
///
/// ‼ **A CLAIM WITH NO SUBJECT CAN BE QUOTED ABOUT A DIFFERENT HIVE**, which
/// is what the scope exists to prevent. `l1.rs` records that nothing carried
/// this and marks `L1-059` PARTIAL for it; *two hives may run the same bearer
/// in different profiles at the same instant with neither being wrong*, so a
/// claim naming only the bearer is ambiguous by construction.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConformanceClaim {
    /// **Whose claim this is.** Not optional, and not defaulted.
    pub hive: HiveId,
    pub bearer: Ordinal,
    /// The profile the claim was made against, so a later reader can tell
    /// whether it still applies.
    pub profile_bits: u8,
}

impl ConformanceClaim {
    /// Whether this claim speaks about `hive`.
    ///
    /// ‼ **ASKED RATHER THAN ASSUMED, AND THAT IS THE WHOLE POINT.** A caller
    /// holding a claim and a hive must check that they match — *reading a
    /// claim as though it were about whichever hive is in hand is exactly the
    /// misuse 5.2.0 scopes it against.*
    pub fn is_about(&self, hive: HiveId) -> bool {
        self.hive == hive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hive(n: u8) -> HiveId {
        HiveId([n; 8])
    }

    /// ‼ **4.9.1 AND 4.9.2: A DEPLOYABLE IMAGE CARRIES A BINDING FOR EVERY
    /// RADIO THE TARGET HAS.** *Only a bearer whose hardware is absent may be
    /// omitted*, so an omission is frugality taken at build time — which
    /// 4.9.2 forbids by name.
    #[test]
    fn a_deployable_image_missing_a_binding_for_a_present_radio_is_refused() {
        let radios = RadiosPresent::none()
            .with(Ordinal::WifiMesh)
            .with(Ordinal::Lora);
        let missing = BindingsCompiled::none().with(Ordinal::WifiMesh);

        assert_eq!(
            image_is_deployable(ImageKind::Deployable, radios, missing),
            Err(ImageRefusal::BindingMissingForPresentRadio {
                radio: Ordinal::Lora
            })
        );

        let complete = missing.with(Ordinal::Lora);
        assert_eq!(
            image_is_deployable(ImageKind::Deployable, radios, complete),
            Ok(())
        );
    }

    /// **A radio the target does not have owes nothing** (4.9.1's exception),
    /// and carrying a spare binding is not an error.
    #[test]
    fn a_radio_the_hardware_lacks_owes_no_binding_and_a_spare_is_harmless() {
        let radios = RadiosPresent::none().with(Ordinal::WifiMesh);
        let extra = BindingsCompiled::none()
            .with(Ordinal::WifiMesh)
            .with(Ordinal::Lora);
        assert_eq!(
            image_is_deployable(ImageKind::Deployable, radios, extra),
            Ok(())
        );
    }

    /// **4.9.1 binds a DEPLOYABLE image and not a development one**, which is
    /// the clause's own distinction: *a development image omitting a binding
    /// is a bench convenience; a production image doing it is a deployment
    /// that cannot recover a bearer it appears to have.*
    #[test]
    fn a_development_image_is_outside_the_clause() {
        let radios = RadiosPresent::none().with(Ordinal::Lora);
        let none = BindingsCompiled::none();
        assert_eq!(
            image_is_deployable(ImageKind::Development, radios, none),
            Ok(())
        );
        assert!(image_is_deployable(ImageKind::Deployable, radios, none).is_err());
    }

    /// ‼ **THE TWO SILENCES, TOLD APART.** From outside, an omitted binding
    /// and a disabled bearer are the same: no traffic on that radio. The
    /// difference appears only when somebody tries to enable it — *and a
    /// deployment that believes it holds a fallback it does not have
    /// discovers otherwise at the moment it needs it.*
    #[test]
    fn a_disabled_bearer_and_an_omitted_binding_are_distinguished() {
        let radios = RadiosPresent::none()
            .with(Ordinal::WifiMesh)
            .with(Ordinal::Lora);
        let compiled = BindingsCompiled::none().with(Ordinal::WifiMesh);

        // Present, compiled, switched off: 4.9.2's permitted frugality.
        assert_eq!(
            why_off(Ordinal::WifiMesh, radios, compiled, false),
            Some(WhyOff::DisabledAtRuntime)
        );
        // Present, NOT compiled: cannot come back without a new image.
        assert_eq!(
            why_off(Ordinal::Lora, radios, compiled, true),
            Some(WhyOff::NotCompiledIn),
            "enabled means nothing when the binding is not in the image"
        );
        // Absent hardware: nothing owed.
        assert_eq!(
            why_off(Ordinal::Udp, radios, compiled, false),
            Some(WhyOff::NoSuchRadio)
        );
        // Present, compiled, running: not off at all.
        assert_eq!(why_off(Ordinal::WifiMesh, radios, compiled, true), None);
    }

    /// ‼ **THE ORDINAL LIST IS THE REGISTRY'S, AND A STALE ONE FAILS
    /// SILENTLY.** L1 **8.2.2** fixes the live set as `ASSIGNABLE_BEARERS`,
    /// and **8.4.3** says a new bearer takes the lowest unassigned ordinal —
    /// *so a hand-written list goes stale the day one is assigned, and the
    /// failure is an image that passes because nothing looked at the new
    /// radio.* This asserts the two agree.
    #[test]
    fn the_enumerated_ordinals_are_exactly_the_assignable_set() {
        let mut bits = 0u8;
        for o in ORDINALS {
            bits |= o.bit();
        }
        assert_eq!(
            bits,
            crate::l1::ASSIGNABLE_BEARERS,
            "the list this module sweeps is not the registry's set — an image \
             would pass without its newest radio being checked"
        );
    }

    /// ‼ **5.2.0: A CLAIM CARRIES WHOSE IT IS.** *Two hives may run the same
    /// bearer in different profiles at the same instant with neither being
    /// wrong*, so a claim naming only the bearer is ambiguous by
    /// construction — and reading one as though it were about whichever hive
    /// is in hand is the misuse the scope exists to prevent.
    #[test]
    fn a_conformance_claim_is_about_one_hive_and_says_which() {
        let claim = ConformanceClaim {
            hive: hive(1),
            bearer: Ordinal::Lora,
            profile_bits: 0b0000_1011,
        };
        assert!(claim.is_about(hive(1)));
        assert!(
            !claim.is_about(hive(2)),
            "a claim about one hive must not answer for another"
        );

        // Same bearer, different hive, different profile — both claims stand.
        let other = ConformanceClaim {
            hive: hive(2),
            bearer: Ordinal::Lora,
            profile_bits: 0b0000_0001,
        };
        assert_ne!(claim, other);
        assert!(other.is_about(hive(2)));
    }
    /// ‼ **4.9.2 SATISFIED AND 4.9.3 BREACHED AT THE SAME MOMENT**, which is
    /// the pair the old boolean could not express: the bearer is lawfully
    /// disabled at runtime, the hardware can gate its radio, and nobody did.
    #[test]
    fn a_lawfully_disabled_bearer_can_still_breach_the_power_clause() {
        use crate::radio_power::RadioPower;
        let radio = Ordinal::Lora;
        let radios = RadiosPresent::none().with(radio);
        let compiled = BindingsCompiled::none().with(radio);
        let gatable = RadiosPowerGatable::none().with(radio);

        // 4.9.2: disabling at runtime is the permitted frugality.
        assert_eq!(
            why_off(radio, radios, compiled, false),
            Some(WhyOff::DisabledAtRuntime)
        );
        // 4.9.3: and it saved nothing.
        assert_eq!(
            power_after_disable(radio, radios, compiled, false, gatable, false),
            Some(RadioPower::StillPowered)
        );
        // Gate the radio and the same disable becomes conformant.
        assert_eq!(
            power_after_disable(radio, radios, compiled, false, gatable, true),
            Some(RadioPower::Removed)
        );
    }

    /// **Hardware that cannot gate the radio is conformant**, and the verdict
    /// says so rather than reporting a breach nobody can fix.
    #[test]
    fn a_radio_the_platform_cannot_gate_is_not_a_breach() {
        use crate::radio_power::RadioPower;
        let radio = Ordinal::Lora;
        let radios = RadiosPresent::none().with(radio);
        let compiled = BindingsCompiled::none().with(radio);
        let v = power_after_disable(
            radio,
            radios,
            compiled,
            false,
            RadiosPowerGatable::none(),
            false,
        );
        assert_eq!(v, Some(RadioPower::HardwareCannot));
        assert!(v.unwrap().satisfies_4_9_3());
        assert!(
            v.unwrap().still_drawing(),
            "conformant and still costing current"
        );
    }

    /// ‼ **A BEARER THAT IS OFF FOR ANOTHER REASON IS NOT A 4.9.3 SUBJECT**,
    /// and answering for it would put a power verdict on a radio that may not
    /// exist. *`None` is the honest answer and it is a different fact from
    /// `HardwareCannot`.*
    #[test]
    fn only_a_runtime_disable_gets_a_power_verdict() {
        let radio = Ordinal::Lora;
        let present = RadiosPresent::none().with(radio);
        let gatable = RadiosPowerGatable::none().with(radio);

        // No radio at all.
        assert_eq!(
            power_after_disable(
                radio,
                RadiosPresent::none(),
                BindingsCompiled::none(),
                false,
                gatable,
                false
            ),
            None
        );
        // Radio present, binding never compiled in.
        assert_eq!(
            power_after_disable(
                radio,
                present,
                BindingsCompiled::none(),
                false,
                gatable,
                false
            ),
            None
        );
        // And an ENABLED bearer is not a subject either — it is meant to draw.
        assert_eq!(
            power_after_disable(
                radio,
                present,
                BindingsCompiled::none().with(radio),
                true,
                gatable,
                false
            ),
            None
        );
    }
}
