//! Build mode: **one origin, many surfaces**.
//!
//! The same fact is asserted on at least three surfaces — the L2 beacon
//! declaration (5.4a.1), the L5 admission decision (Clause 9), and
//! whatever a human sees (an LED, a panel). Roy's constraint makes it
//! wire-visible and admission-controlling: *"Dev devices advertise as
//! such in the beacons, and will not be accepted into a production TN."*
//!
//! **If two surfaces ever disagree the device is lying in one of them,
//! and which one is not discoverable from either.** So the type lives in
//! the leaf crate that everything already depends on, and no layer mints
//! its own.
//!
//! This is the *opposite* of the rule this lane applies to checks, and
//! the difference is real rather than a contradiction: **for a check you
//! want two independent origins, because agreement is only evidence if
//! the sides can disagree. For an assertion about your own state you want
//! one origin and many surfaces, because disagreement is the failure.**
//! Same-source is a defect in a comparison and a requirement in a
//! broadcast.

/// A hive's build mode, and a scanner's reading of a peer's.
///
/// Three values because a *reading* has three outcomes (L2 5.4a.4:
/// absent, truncated or unreachable reads as unknown, and unknown is
/// never presented as production or as secure). A hive's own mode has
/// only two — see [`BuildMode::declared`].
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum BuildMode {
    Development,
    Production,
    /// Not determinable. **Never a synonym for production** (5.4a.4), and
    /// the default so that a value nobody set cannot read as production.
    #[default]
    Unknown,
}

impl BuildMode {
    /// What this hive declares about **itself**, per L2 5.4a.1a.
    ///
    /// The clause: *"A hive that cannot determine the build mode of the
    /// image it is running shall declare development."* So the
    /// three-valued reading collapses to two at the point of assertion,
    /// and it collapses **towards development**, by construction rather
    /// than by a caller remembering to.
    ///
    /// The direction is not symmetric and that is the whole point: a
    /// development device that fails to declare is **admitted to a
    /// production network** — a relaxed-trust device inside a production
    /// boundary. The reverse costs the device its admission and is loud.
    /// **Absence of certainty is not absence of development.**
    ///
    /// `PROVISIONAL(STD-SS205)`: 5.4a.1a is drafted and, as of writing,
    /// **uncommitted in r2-standard's working tree** — cited by its
    /// sentence rather than by its number for that reason (D-080).
    #[must_use]
    pub const fn declared(self) -> Self {
        match self {
            Self::Production => Self::Production,
            Self::Development | Self::Unknown => Self::Development,
        }
    }

    // ⚠ **`cooperates_with` WAS REMOVED HERE ON 2026-08-18. DO NOT RE-ADD IT.**
    //
    // It computed L2 **5.4a.5** — *no cooperative exchange with a peer whose
    // declared build mode differs from one's own* — and that clause was
    // **REVOKED** by Roy's ruling d231 on 2026-08-04. Its successors say the
    // opposite: **5.4a.5a** obliges a hive to participate irrespective of its
    // own mode or any peer's and forbids refusing discovery, neighbour
    // formation, relaying or delivery on that ground (`L2-061`, `L2-062`,
    // both TESTABLE), and **5.4a.5b** has an implementation assume anyone in
    // range may be recording whatever they declare.
    //
    // **The reason the wall was revoked is the medium, not anyone's honesty:**
    // on a shared radio, anyone in range is a party whether or not they
    // declare, join or relay. *A silent listener does not need to lie*, so the
    // partition was unenforceable — and an unenforceable control is worse than
    // none, because implementers rely on it.
    //
    // **It was kept armed-but-uncalled for two weeks and removed for what that
    // cost, not for what it did.** Measured repeatedly at zero non-test
    // callers, so it was never a live violation — *what kept the crate
    // conformant was that its consumer had never been written*, which is not a
    // property of the code but an accident of sequencing. One call site would
    // have made `L2-061` and `L2-062` false, and the function sat under a name
    // that reads like the obvious thing to call.
    //
    // **[`BuildMode::declared`] and [`BuildMode::emits_declaration`] are NOT
    // affected**: 5.4a.1a and 5.4a.2 are about self-declaration, which
    // survives. Build mode is now a property of the persona a device uses
    // (L5 9.2), not a partition of the network.
    //
    // **A NOTE FOR ANYONE RE-RUNNING THE GREP.** While the function existed,
    // its own doc comment refused to write its name, because registering the
    // finding in prose inflated the very count that was the evidence — 12
    // occurrences in crate source became 19 across the tree the moment the
    // gap was written up. **That hazard is now inverted and works for us:**
    // with the definition gone, this tombstone is the ONLY occurrence in
    // crate source, so `grep -rn cooperates_with crates/` returning anything
    // but this one line is a re-introduction. *A name that had to be avoided
    // to keep a measurement honest is now the measurement.*

    /// Whether a beacon from this hive carries the declaration at all.
    ///
    /// L2 5.4a.2: *"A production beacon shall carry no development-related
    /// bytes."* Note 1 makes the asymmetry the design — **only a
    /// development image contains the code that writes the declaration**,
    /// so a production device cannot falsely declare development by
    /// construction, and a production beacon spends no bytes on a field
    /// whose absence carries the information.
    ///
    /// **A single image whose mode is settable at runtime destroys that
    /// property**: it contains the declaring code, so it *is* a
    /// development image and sits permanently in the 5.4a.1a case. This
    /// function is the runtime half of a decision that is properly a
    /// build-system one, and it is written here so the consequence is
    /// visible at the call site rather than argued about later.
    #[must_use]
    pub const fn emits_declaration(self) -> bool {
        matches!(self.declared(), Self::Development)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hive_that_cannot_tell_declares_development() {
        // 5.4a.1a. The excluded case (01-terminology 4.2) is the
        // pleasant answer an implementer reaches for — say nothing,
        // which reads as production — and it must NOT happen.
        assert_eq!(BuildMode::Unknown.declared(), BuildMode::Development);
        assert_ne!(
            BuildMode::Unknown.declared(),
            BuildMode::Production,
            "absence of certainty read as absence of development"
        );
        // And the two determinable modes are unchanged by declaring.
        assert_eq!(BuildMode::Production.declared(), BuildMode::Production);
        assert_eq!(BuildMode::Development.declared(), BuildMode::Development);
    }

    #[test]
    fn unknown_is_the_default_so_an_unset_value_cannot_read_as_production() {
        // 5.4a.4: a scanner that cannot read the field treats the mode as
        // unknown and never presents unknown as production or as secure.
        assert_eq!(BuildMode::default(), BuildMode::Unknown);
        assert_ne!(BuildMode::default(), BuildMode::Production);
    }

    #[test]
    fn only_a_development_beacon_carries_the_declaration() {
        // 5.4a.2 with 5.4a.1a: a hive that cannot tell emits it, because
        // it declares development.
        assert!(BuildMode::Development.emits_declaration());
        assert!(BuildMode::Unknown.emits_declaration());
        assert!(!BuildMode::Production.emits_declaration());
    }
}
