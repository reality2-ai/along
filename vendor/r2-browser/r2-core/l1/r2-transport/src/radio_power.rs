//! **L1 4.9.3: disabling a bearer to save power shall remove power from its
//! radio where the hardware permits.**
//!
//! # ‼ THE CLAUSE IS ABOUT CURRENT, AND THE CODE HELD ONLY A BOOLEAN
//!
//! [`WhyOff::DisabledAtRuntime`](crate::deployable::WhyOff::DisabledAtRuntime)
//! records that a bearer is off, which is 4.9.2's permitted frugality. **It
//! says nothing about whether the radio stopped drawing current**, and 4.9.3
//! is entirely about that: *frugality exercised by setting a flag saves
//! exactly nothing*, and a deployment that disabled a bearer to make its
//! battery last has been told it succeeded.
//!
//! # ‼ AND THE TWO CASES ARE INDISTINGUISHABLE FROM OUTSIDE
//!
//! A radio still drawing current because **the hardware cannot gate it** and a
//! radio still drawing current because **nobody gated it** present the same
//! way to every measurement a hive can make of itself. One is 4.9.3's own
//! exemption — *where the hardware permits* — and the other is a breach.
//!
//! **So the hardware fact has to be declared rather than inferred**, which is
//! the same absent-versus-wrong distinction `SS429` records for entropy
//! conditions: a platform that has not said whether it can gate its radio has
//! not thereby said that it cannot.

/// What actually happened to a radio's power when its bearer was disabled.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RadioPower {
    /// **Power removed — 4.9.3 met.**
    Removed,
    /// **The hardware does not permit removing power from this radio**, so
    /// 4.9.3 asks nothing further. *A declared exemption, not an excuse
    /// reached for after the fact.*
    HardwareCannot,
    /// ‼ **DISABLED IN SOFTWARE WHILE THE RADIO STILL DRAWS CURRENT, ON
    /// HARDWARE THAT COULD HAVE STOPPED IT.** A 4.9.3 breach, and the shape
    /// of frugality that saves nothing: *the bearer reports itself off, the
    /// battery disagrees, and nothing reconciles them.*
    StillPowered,
}

impl RadioPower {
    /// Whether 4.9.3 is satisfied.
    ///
    /// **[`HardwareCannot`](Self::HardwareCannot) satisfies it** — the clause
    /// is conditioned on what the hardware permits, and a platform that
    /// cannot gate its radio is not in breach for failing to.
    pub const fn satisfies_4_9_3(self) -> bool {
        matches!(self, RadioPower::Removed | RadioPower::HardwareCannot)
    }

    /// Whether an operator is paying for a radio nobody is using.
    ///
    /// ‼ **TRUE FOR BOTH NON-`Removed` VARIANTS, AND THAT IS DELIBERATE.**
    /// The conformance question and the battery question have different
    /// answers here: `HardwareCannot` is conformant *and still costs
    /// current*. **A platform is entitled to be conformant and expensive**,
    /// and an energy budget that read `satisfies_4_9_3` as *no draw* would be
    /// wrong on exactly the platforms that cannot help it.
    pub const fn still_drawing(self) -> bool {
        !matches!(self, RadioPower::Removed)
    }
}

/// **Classify what a disable actually achieved.**
///
/// `hardware_permits` is the platform's **declaration** about this radio, not
/// an inference from behaviour — see the module header for why that
/// distinction is load-bearing.
pub const fn on_disable(hardware_permits: bool, power_removed: bool) -> RadioPower {
    match (hardware_permits, power_removed) {
        (_, true) => RadioPower::Removed,
        (false, false) => RadioPower::HardwareCannot,
        (true, false) => RadioPower::StillPowered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **THE BREACH IS REACHABLE, AND IT IS REACHABLE FROM EXACTLY ONE
    /// INPUT.** A variant nothing can produce is not a check.
    #[test]
    fn the_breach_arises_only_from_permitted_hardware_left_powered() {
        assert_eq!(on_disable(true, false), RadioPower::StillPowered);
        assert!(!on_disable(true, false).satisfies_4_9_3());

        // Every other input is conformant.
        for (permits, removed) in [(true, true), (false, true), (false, false)] {
            assert!(
                on_disable(permits, removed).satisfies_4_9_3(),
                "permits={permits} removed={removed} was reported as a breach"
            );
        }
    }

    /// **4.9.3's exemption is conditional and the condition is the
    /// hardware's**, so a platform that cannot gate its radio is conformant.
    #[test]
    fn hardware_that_cannot_gate_its_radio_is_not_in_breach() {
        let v = on_disable(false, false);
        assert_eq!(v, RadioPower::HardwareCannot);
        assert!(v.satisfies_4_9_3());
    }

    /// ‼ **CONFORMANT AND STILL COSTING CURRENT ARE COMPATIBLE**, and an
    /// energy budget must read the second rather than the first.
    #[test]
    fn conformance_and_current_draw_are_separate_questions() {
        assert!(RadioPower::HardwareCannot.satisfies_4_9_3());
        assert!(
            RadioPower::HardwareCannot.still_drawing(),
            "a platform that cannot gate its radio is conformant AND expensive"
        );
        assert!(!RadioPower::Removed.still_drawing());
        assert!(RadioPower::StillPowered.still_drawing());
    }
}
