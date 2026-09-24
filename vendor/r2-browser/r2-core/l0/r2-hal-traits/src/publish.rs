//! **Publishing a platform declaration so a third party can read it without
//! the platform (L0 8.4.1).**
//!
//! # Why this was missing and why it matters here
//!
//! **8.4.1**: *a platform declaration shall be published in a form a third
//! party can read without possessing the platform.* `PlatformDeclaration`
//! could be **corroborated** against observed capacities and **not emitted**
//! — so the declaration existed as a Rust constant inside a firmware image
//! and *the one party the clause is written for, somebody who does not have
//! the board, could not read it.*
//!
//! ‼ **AND THIS IS THE ARTEFACT AN ENSEMBLE BUILDER NEEDS.** Choosing which
//! firmware a board can carry means knowing its memory, its transports, its
//! highest hosted layer, whether it bears keys and whether it has update
//! slots — **all of which the declaration states and none of which was
//! readable off the board.**
//!
//! # The form is the standard's own, and it is illustrative rather than
//! # normative
//!
//! L0 8.4.1 prints a worked example and says in terms: *the following form
//! satisfies 8.1 and 8.2. It is illustrative and not the only permitted
//! form.* **So this emits that shape and the doc says it is a choice** — a
//! reader must not take it for a wire format, and nothing in the corpus
//! parses it back.
//!
//! ‼ **NO ALLOCATOR, SO THE CALLER SUPPLIES THE BUFFER AND A SHORT ONE
//! REFUSES.** *A declaration truncated to fit is a declaration stating fewer
//! parameters than 8.1.2 requires*, and it would look like a conforming
//! declaration of a smaller platform.

use crate::decl::{
    Availability, CapabilityClass, Discrepancy, PlatformDeclaration, PositionObservability,
};

/// Why a declaration could not be published.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PublishError {
    /// The buffer ran out. **Nothing partial is usable**: 8.1.2 requires a
    /// value for every parameter in 8.2, so a truncated declaration would
    /// state fewer and read as a conforming declaration of a smaller
    /// platform.
    BufferTooSmall,
    /// L0 7.3's three duty-cycle intervals are not ordered. Publishing an
    /// internally contradictory P8 would make a non-conforming schedule look
    /// like a usable declaration to a third party.
    UnorderedWakeIntervals,
    /// P3 contains a malformed, duplicate, or undeclared-binding profile.
    /// Publishing it would turn a rejected construction input into an
    /// apparently readable platform fact.
    BindingProfileInvalid(Discrepancy),
    /// P3 names no Layer 1 binding. L0 5.1.1 requires at least one, so a
    /// publisher must not emit a plausible declaration for a non-hive.
    NoTransportBindings,
}

/// A tiny append-only writer, so the emitter can be written as a sequence of
/// pushes and every one of them can fail closed.
struct Out<'a> {
    buf: &'a mut [u8],
    at: usize,
    full: bool,
}

impl Out<'_> {
    fn s(&mut self, text: &str) {
        let b = text.as_bytes();
        if self.at + b.len() > self.buf.len() {
            self.full = true;
            return;
        }
        self.buf[self.at..self.at + b.len()].copy_from_slice(b);
        self.at += b.len();
    }

    fn n(&mut self, mut v: u64) {
        let mut digits = [0u8; 20];
        let mut i = digits.len();
        if v == 0 {
            i -= 1;
            digits[i] = b'0';
        }
        while v > 0 {
            i -= 1;
            digits[i] = b'0' + (v % 10) as u8;
            v /= 10;
        }
        // SAFETY-free: the slice is ASCII digits by construction.
        let text = core::str::from_utf8(&digits[i..]).unwrap_or("0");
        self.s(text);
    }

    fn yes_no(&mut self, v: bool) {
        self.s(if v { "yes" } else { "no" });
    }

    /// Emit every line of a schema-owned canonical value beneath the field
    /// that contains it. The indentation is presentation only: it makes a
    /// multi-line value readable in this illustrative declaration form and
    /// does not become part of the value the binding schema defines.
    fn child_lines(&mut self, text: &str) {
        for line in text.split('\n') {
            self.s("\n          ");
            self.s(line);
        }
    }
}

/// Emit `decl` in the form L0 8.4.1 illustrates. Returns the octets written.
///
/// ‼ **EVERY PARAMETER 8.2.1 NAMES IS EMITTED, INCLUDING THE ONES WHOSE
/// VALUE IS AN ABSENCE.** 8.1.2 requires a declaration to state a value for
/// **every** parameter, and *a parameter omitted because it had nothing to
/// say is the under-stated declaration 8.5 exists to prevent.* So an absent
/// update-slot facility prints `update-slots: none` rather than not printing.
///
/// ⚠ **`update-slots: none` INHERITS `SS357`'s AMBIGUITY AND SAYS SO AT THE
/// SITE.** `Option::None` on that field cannot today distinguish *this
/// platform has no slots* — a declared shortfall — from *nobody filled the
/// field in*, and **the shape 8.5 needs is Roy's to rule.** This emitter
/// therefore prints what the type holds and **does not invent a shortfall
/// notation**; a reader must not take `none` for an attested absence.
pub fn publish(decl: &PlatformDeclaration, buf: &mut [u8]) -> Result<usize, PublishError> {
    match decl.check_binding_profiles() {
        Ok(()) => {}
        Err(Discrepancy::NoTransportBindings) => return Err(PublishError::NoTransportBindings),
        Err(error) => return Err(PublishError::BindingProfileInvalid(error)),
    }
    if let Availability::DutyCycled(intervals) = decl.availability {
        if !intervals.is_ordered() {
            return Err(PublishError::UnorderedWakeIntervals);
        }
    }
    let mut o = Out {
        buf,
        at: 0,
        full: false,
    };

    o.s("platform-declaration: 1\n");
    o.s("  platform: ");
    o.n(u64::from(decl.platform.0));
    o.s("\n  P1  memory-bytes: ");
    o.n(decl.memory_bytes);
    o.s("  storage-bytes: ");
    o.n(decl.storage_bytes);
    o.s("\n  P2  low-power-state-implemented: ");
    o.yes_no(decl.low_power_state_implemented);
    o.s("\n  P3  transports-bits: ");
    o.n(u64::from(decl.transports));
    o.s("\n      binding-profiles:");
    if decl.binding_profiles.is_empty() {
        o.s(" none");
    } else {
        for profile in decl.binding_profiles {
            o.s("\n        transport-bit: ");
            o.n(u64::from(profile.transport_bit));
            o.s("\n        schema: ");
            o.s(profile.schema);
            o.s("\n        version: ");
            o.n(u64::from(profile.version));
            // A schema-owned canonical value may itself be multi-line (BLE
            // v1 is). Printing only its first line after this field would
            // make every later line look like a new P3 field to the reader
            // who L0 8.4.1 says need not possess the platform.
            o.s("\n        canonical-value:");
            o.child_lines(profile.canonical_value);
        }
    }
    o.s("\n  P4  peripheral-power-gated: ");
    o.yes_no(decl.peripheral_power_gated);
    o.s("\n  P5  timebase-survives-power-loss: ");
    o.yes_no(decl.timebase_survives_power_loss);
    o.s("\n  P6  highest-layer-hosted: ");
    o.n(u64::from(decl.highest_layer_hosted));
    o.s("\n  P7  key-bearing: ");
    o.yes_no(decl.key_bearing);
    o.s("\n  P8  availability: ");
    match decl.availability {
        Availability::AlwaysOn => o.s("always-on"),
        Availability::DutyCycled(w) => {
            o.s("duty-cycled\n      shortest-permitted-s: ");
            o.n(u64::from(w.shortest_permitted_s));
            o.s("\n      longest-permitted-s: ");
            o.n(u64::from(w.longest_permitted_s));
            o.s("\n      shortest-self-selected-s: ");
            o.n(u64::from(w.shortest_self_selected_s));
        }
    }
    // ‼ **8.5 IS PRINTED WHETHER OR NOT THERE IS ONE**, because *no
    // shortfall declared* is a claim and an omitted section is not. A reader
    // who saw nothing could not tell a platform that declared none from a
    // publisher that forgot the section — which is the ambiguity 8.5 was
    // added to remove, reproduced at the surface that carries it.
    // ‼ **5.5.2b IS PRINTED ALWAYS, FOR THE SAME REASON 8.5 IS.** The
    // condition was ENFORCED and never PUBLISHED: both entropy sources in
    // this workspace refuse correctly at the moment of use, and the condition
    // they refuse on lived in a Rust comment inside a board crate. **8.4.1
    // requires a declaration a third party can read without possessing the
    // platform**, and a chooser chooses a board from the declaration.
    o.s("\n  5.5.2b entropy: ");
    match decl.entropy {
        crate::decl::EntropyConditions::NotStated => {
            // ‼ Never silence. *Not stated* read as *unconditional* is the
            // `SS213` failure, and it is invisible for the life of the device.
            o.s("NOT STATED — 5.5.2b unanswered; this is NOT a claim that the source is unconditional");
        }
        crate::decl::EntropyConditions::None => {
            o.s("no conforming source — 5.5.2: this platform shall not generate key material, and does not become able to by waiting");
        }
        crate::decl::EntropyConditions::Unconditional => {
            o.s("conforming whenever the platform is running");
        }
        crate::decl::EntropyConditions::OnlyWhile(conditions) => {
            o.s("conforming ONLY WHILE:");
            if conditions.is_empty() {
                // Claims a condition and names none — worse than NotStated,
                // because it reads as answered.
                o.s(" NONE STATED — 5.5.2b unanswered");
            } else {
                for c in conditions {
                    o.s("\n      - ");
                    o.s(c);
                }
            }
        }
    }
    o.s("\n  8.5 shortfalls: ");
    if decl.shortfalls.is_empty() {
        o.s("none declared");
    } else {
        for sf in decl.shortfalls {
            o.s("\n      facility: ");
            o.s(sf.facility);
            o.s("\n      obligations-lost: ");
            if sf.states_consequences() {
                let mut first = true;
                for ob in sf.obligations_lost {
                    if !first {
                        o.s(", ");
                    }
                    o.s(ob);
                    first = false;
                }
            } else {
                // 8.5.2's own Note: a shortfall stated without its
                // consequences reads as a small omission, and the reader who
                // needs it is deciding whether to deliver a persona, an
                // update or a key. So the absence is LABELLED rather than
                // printed as an empty line.
                o.s("NONE STATED — 8.5.2 unanswered for this shortfall");
            }
        }
    }
    o.s("\n  P9  update-slots: ");
    match decl.update_slots {
        // See the header: this is what the TYPE holds, and SS357 is why it
        // is not dressed up as an attested absence.
        None => o.s("none"),
        Some(s) => {
            o.n(u64::from(s.count));
            o.s("  usable-bytes-each: ");
            o.n(s.usable_bytes_each);
        }
    }
    o.s("\n  P10 update-path-write-boundary-enforced: ");
    o.yes_no(decl.update_write_boundary.enforced);
    o.s("  regions-outside: ");
    o.n(u64::from(decl.update_write_boundary.regions_outside));
    o.s("\n  P11 image-read-back: ");
    o.yes_no(decl.image_read_back_in_bounded_pieces);
    o.s("\n  P12 recovery-substrate-writable: ");
    o.yes_no(decl.recovery_substrate.writable_by_install_path);
    o.s("  covered-by-pre-write-check: ");
    o.yes_no(decl.recovery_substrate.integrity_check_covers_them);
    o.s("\n  P13 position-observability: ");
    o.s(match decl.position_observability {
        PositionObservability::ReportsAbsence => "reports-absence",
        PositionObservability::BootPathWritesOne => "boot-path-writes-one",
    });
    o.s("\n  class-declared: ");
    // ‼ **MATCHED RATHER THAN CAST.** `CapabilityClass` carries no explicit
    // discriminants, so `as u64` would publish a **zero-based** ordinal — a
    // class-1 platform would declare `class-declared: 0`, which is a class
    // this standard does not define. *A cast that happens to line up today
    // is a cast that silently renumbers every platform if a variant is ever
    // inserted.*
    o.n(match decl.class_declared {
        CapabilityClass::Class1 => 1,
        CapabilityClass::Class2 => 2,
        CapabilityClass::Class3 => 3,
        CapabilityClass::Class4 => 4,
        CapabilityClass::Class5 => 5,
    });

    // ‼ **8.2.2: EVERY FIGURE CARRIES WHAT IT WAS MEASURED AGAINST, AND THE
    //   PUBLISHED FORM SHOWS BOTH OR NEITHER.** A surface that printed the
    //   number and dropped the conditions would put an unqualified figure in
    //   front of a reader while the declaration behind it was conforming —
    //   which is 8.2.2's failure arriving one layer later, and harder to see.
    //   Nothing is emitted where no figure is stated: absent is a fact, and an
    //   empty heading would read as a platform that measured nothing.
    for f in decl.figures {
        o.s("\n  figure ");
        o.s(f.label());
        o.s(": ");
        o.n(f.value());
        o.s(match f.unit() {
            crate::decl::FigureUnit::Seconds => " s",
            crate::decl::FigureUnit::MilliwattHours => " mWh",
        });
        o.s("\n      against:");
        for (parameter, value) in f.against() {
            o.s("\n        ");
            o.s(parameter.name());
            o.s(": ");
            o.s(value);
        }
    }
    o.s("\n");

    if o.full {
        return Err(PublishError::BufferTooSmall);
    }
    Ok(o.at)
}

/// **The shortfall every ESP-NOW platform in this workspace carries**
/// (L0 8.5.1, 8.5.2; BND1 3.1, 3.4; L1 4.7.1).
///
/// # ‼ THE MARKER IS REQUIRED AND THIS PLATFORM CANNOT SET IT
///
/// L1 **4.7.1** obliges a bearer to carry a marker in its **medium framing**
/// by which a receiver distinguishes Reality2 traffic before parsing, and
/// **4.7.2** forbids putting it inside the frame — *a marker inside the frame
/// would be bytes the bearer added, and 4.2.1 says there are none.* BND1
/// **3.1** names the marker: the three-octet OUI of the ESP-NOW
/// vendor-specific element.
///
/// **`esp-radio`'s ESP-NOW interface hands an application the payload and
/// nothing else** — `send(dst, data)` and `ReceivedData::data()`. The
/// vendor-specific action frame's OUI is the stack's, not the application's,
/// so this platform can neither set nor observe it.
///
/// ‼ **THAT IS BND1 3.4's CASE AND IT IS A FACT TO STATE, NOT A LICENCE**:
/// *whether an implementation on a given platform can set or observe the
/// element is a property of that platform's interface* — and an implementer
/// who finds it unavailable has met L1 4.5's case, **which is not permission
/// to move the marker inside the frame.**
///
/// # ⚠ WHAT IT COSTS, WHICH IS THE HALF 8.5.2 ASKS FOR
///
/// L2 **7.1.1 step 1** — *is this Reality2?*, answered from the bearer's
/// discovery marker, free before parsing — **is unanswerable on this
/// bearer.** BND1's own Note 1 calls that the largest thing the binding
/// fixes: *without a marker the ladder has no first rung, and a scanner is
/// left parsing every transmission on a shared medium to discover it was not
/// ours.*
pub const ESPNOW_MARKER_SHORTFALL: crate::decl::Shortfall<'static> = crate::decl::Shortfall {
    facility: "BND1 3.1: the OUI of the ESP-NOW vendor-specific element, which \
               esp-radio does not expose to an application",
    obligations_lost: &["L1 4.7.1", "L2 7.1.1 step 1"],
};

#[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::decl::{PlatformId, RecoverySubstrate, UpdateSlots, WakeIntervals, WriteBoundary};

    fn decl() -> PlatformDeclaration {
        PlatformDeclaration {
            shortfalls: &[],
            entropy: crate::decl::EntropyConditions::Unconditional,
            platform: PlatformId(0x0BAD_F00D),
            memory_bytes: 512 * 1024,
            storage_bytes: 4 * 1024 * 1024,
            low_power_state_implemented: true,
            transports: 0b0000_1011,
            binding_profiles: &[],
            peripheral_power_gated: true,
            timebase_survives_power_loss: false,
            highest_layer_hosted: 7,
            key_bearing: true,
            availability: Availability::DutyCycled(WakeIntervals {
                shortest_permitted_s: 5,
                longest_permitted_s: 1800,
                shortest_self_selected_s: 30,
            }),
            update_slots: Some(UpdateSlots {
                count: 2,
                usable_bytes_each: 1_600_000,
            }),
            slot_layout: None,
            update_write_boundary: WriteBoundary {
                enforced: true,
                regions_outside: 2,
            },
            image_read_back_in_bounded_pieces: true,
            recovery_substrate: RecoverySubstrate {
                writable_by_install_path: true,
                integrity_check_covers_them: false,
            },
            position_observability: PositionObservability::BootPathWritesOne,
            class_declared: CapabilityClass::Class2,
            figures: &[],
        }
    }

    /// Publish into the caller's buffer and hand back the text, so the
    /// tests stay `no_std` — this crate has no allocator and the emitter is
    /// the reason: **the caller supplies the buffer.**
    fn published<'a>(d: &PlatformDeclaration, buf: &'a mut [u8]) -> &'a str {
        let n = publish(d, buf).expect("publishes");
        core::str::from_utf8(&buf[..n]).expect("ascii")
    }

    /// ‼ **EVERY PARAMETER 8.2.1 NAMES APPEARS, BECAUSE 8.1.2 REQUIRES A
    /// VALUE FOR EVERY ONE OF THEM.** *A parameter omitted because it had
    /// nothing to say is the under-stated declaration 8.5 exists to
    /// prevent*, and the sweep is over the list rather than over a sample.
    /// ‼ **A DECLARED SHORTFALL NAMES WHAT IT COSTS, AND THE ESP-NOW ONE
    /// COSTS L2's FIRST RUNG.** 8.5.2's own Note: *a shortfall stated without
    /// its consequences reads as a small omission*, while the reader who
    /// needs it is deciding whether to deliver a persona, an update or a key.
    #[test]
    fn the_espnow_marker_shortfall_names_the_obligations_it_costs() {
        let sf = ESPNOW_MARKER_SHORTFALL;
        assert!(sf.states_consequences());
        assert!(sf.facility.contains("BND1 3.1"));
        assert!(sf.obligations_lost.contains(&"L1 4.7.1"));
        assert!(
            sf.obligations_lost.contains(&"L2 7.1.1 step 1"),
            "the cost is the discovery ladder's first rung, not only the marker"
        );
    }

    /// ‼ **THE SECTION PRINTS WHETHER OR NOT THERE IS A SHORTFALL.** *No
    /// shortfall declared* is a claim; an omitted section is not, and a reader
    /// could not tell a platform that declared none from a publisher that
    /// forgot to print it — the very ambiguity 8.5 was added to remove.
    /// ‼ **THE CONDITION MUST REACH THE PUBLISHED TEXT, BECAUSE ENFORCING IT
    /// AND PUBLISHING IT ARE DIFFERENT OBLIGATIONS AND ONLY ONE WAS MET.**
    #[test]
    fn the_entropy_conditions_are_printed_in_every_state() {
        use crate::decl::EntropyConditions as E;
        let mut buf = [0u8; 2048];
        let mut d = decl();

        d.entropy = E::Unconditional;
        assert!(published(&d, &mut buf).contains("conforming whenever the platform is running"));

        d.entropy = E::OnlyWhile(&["the radio is started"]);
        let text = published(&d, &mut buf);
        assert!(text.contains("conforming ONLY WHILE:"), "{text}");
        assert!(
            text.contains("the radio is started"),
            "the condition itself must appear"
        );

        // ‼ NotStated must never print as silence, and must never read as a
        // claim — `SS213` is `NotStated` taken for `Unconditional`.
        d.entropy = E::NotStated;
        let text = published(&d, &mut buf);
        assert!(text.contains("NOT STATED"), "{text}");
        assert!(
            text.contains("NOT a claim that the source is unconditional"),
            "the published text let an unanswered question read as an answer"
        );

        d.entropy = E::None;
        assert!(published(&d, &mut buf).contains("shall not generate key material"));

        // An OnlyWhile naming nothing claims a condition and answers nothing
        // — worse than NotStated, because it reads as answered.
        d.entropy = E::OnlyWhile(&[]);
        assert!(published(&d, &mut buf).contains("NONE STATED"));
    }

    /// **`may_generate_key_material` answers `false` for `NotStated`**, and
    /// that asymmetry is deliberate: a wrong `true` is invisible for the life
    /// of the device, a wrong `false` is a device that says it is not a hive.
    #[test]
    fn an_unstated_entropy_condition_does_not_permit_key_generation() {
        use crate::decl::EntropyConditions as E;
        assert!(!E::NotStated.may_generate_key_material());
        assert!(!E::None.may_generate_key_material());
        assert!(E::Unconditional.may_generate_key_material());
        assert!(E::OnlyWhile(&["x"]).may_generate_key_material());
        assert!(
            !E::OnlyWhile(&[]).may_generate_key_material(),
            "an unnamed condition cannot authorise key generation"
        );

        assert!(!E::NotStated.states_its_conditions());
        assert!(
            !E::OnlyWhile(&[]).states_its_conditions(),
            "a condition claimed and not named is not a stated condition"
        );
        assert!(E::OnlyWhile(&["x"]).states_its_conditions());
        assert!(E::OnlyWhile(&["x"]).is_conditional());
        assert!(!E::Unconditional.is_conditional());
    }

    #[test]
    fn the_shortfall_section_is_printed_in_both_directions() {
        let mut buf = [0u8; 2048];
        let mut d = decl();
        let text = published(&d, &mut buf);
        assert!(
            text.contains("8.5 shortfalls: none declared"),
            "a platform with no shortfall says so"
        );

        d.shortfalls = &[ESPNOW_MARKER_SHORTFALL];
        let mut buf2 = [0u8; 2048];
        let text = published(&d, &mut buf2);
        assert!(text.contains("facility: BND1 3.1"), "got {text}");
        assert!(text.contains("obligations-lost: L1 4.7.1, L2 7.1.1 step 1"));
    }

    /// A shortfall that answers 8.5.1 and not 8.5.2 is **labelled**, not
    /// printed as an empty line — *the absence of the consequences is the
    /// thing a reader must be able to see.*
    #[test]
    fn a_shortfall_with_no_stated_consequence_is_labelled_as_unanswered() {
        const BARE: crate::decl::Shortfall<'static> = crate::decl::Shortfall {
            facility: "something",
            obligations_lost: &[],
        };
        assert!(!BARE.states_consequences());
        let mut d = decl();
        d.shortfalls = &[BARE];
        let mut buf = [0u8; 2048];
        let text = published(&d, &mut buf);
        assert!(
            text.contains("8.5.2 unanswered for this shortfall"),
            "got {text}"
        );
    }

    /// ‼ **8.1.2 IS A VALUE FOR EVERY PARAMETER, AND THIS ASSERTED LABELS
    /// UNTIL 2026-09-05.** `text.contains("P7 ")` is true of a declaration
    /// that emits `P7 key-bearing: ` and then stops — *the label is the
    /// question, and the clause obliges the answer.* `r2-codex-refute` showed
    /// the hole by emitting a parameter label with no value and watching all
    /// seventy-seven tests stay green.
    ///
    /// **The sweep is structural rather than a longer list of literals**, so
    /// it covers `P14` on the day one is added. A list of expected values
    /// would have to be extended by the same person who forgot the value —
    /// *the check would grow exactly as fast as the defect.* The sibling
    /// `the_published_values_are_the_declarations_values` still pins seven
    /// values by content, which is the other half: this one proves an answer
    /// EXISTS, that one proves it is the declaration's own.
    #[test]
    fn every_parameter_the_clause_names_is_published() {
        let mut buf = [0u8; 1024];
        let text = published(&decl(), &mut buf);
        let mut seen = 0;
        for line in text.lines() {
            let line = line.trim();
            // A parameter line is `P<n> <label>: <value>`; `P` alone is not
            // enough, because `POSIX` would qualify.
            let Some(rest) = line.strip_prefix('P') else {
                continue;
            };
            if !rest.starts_with(|c: char| c.is_ascii_digit()) {
                continue;
            }
            let (label, value) = rest
                .split_once(": ")
                .unwrap_or_else(|| panic!("8.1.2: `P{rest}` states no value at all:\n{text}"));
            assert!(
                !value.trim().is_empty(),
                "8.1.2: `P{label}` names a parameter and states no value:\n{text}"
            );
            seen += 1;
        }
        // The population control: a sweep that matched nothing would pass
        // every assertion above and prove that no parameter is published.
        assert_eq!(seen, 13, "8.2 names thirteen parameters; found {seen}");
        assert!(text.contains("class-declared: 2"));
        // ‼ EVERY CLASS PUBLISHES ITS OWN NUMBER. A cast over an enum with
        // no explicit discriminants would have made class 1 read as 0 — a
        // class this standard does not define — and the sweep is what turns
        // that from a lucky alignment into a checked one.
        for (class, want) in [
            (CapabilityClass::Class1, "class-declared: 1"),
            (CapabilityClass::Class2, "class-declared: 2"),
            (CapabilityClass::Class3, "class-declared: 3"),
            (CapabilityClass::Class4, "class-declared: 4"),
            (CapabilityClass::Class5, "class-declared: 5"),
        ] {
            let mut d = decl();
            d.class_declared = class;
            let mut b = [0u8; 1024];
            assert!(published(&d, &mut b).contains(want), "{class:?}");
        }
        assert!(text.starts_with("platform-declaration: 1"));
    }

    #[test]
    fn a_binding_profile_is_published_for_a_reader_without_the_platform() {
        const PROFILE: crate::decl::BindingProfileDeclaration =
            crate::decl::BindingProfileDeclaration {
                transport_bit: 0b0000_0010,
                schema: "org.example.binding.test",
                version: 1,
                canonical_value: "value=1\nnext=2",
            };
        let mut declaration = decl();
        declaration.binding_profiles = &[PROFILE];
        let mut buf = [0u8; 1024];
        let text = published(&declaration, &mut buf);
        for expected in [
            "binding-profiles:",
            "transport-bit: 2",
            "schema: org.example.binding.test",
            "version: 1",
            "canonical-value:\n          value=1\n          next=2",
        ] {
            assert!(text.contains(expected), "{expected} missing from:\n{text}");
        }
        assert!(
            !text.contains("\nnext=2"),
            "a canonical-value continuation must not resemble a P3 peer field:\n{text}"
        );
    }

    #[test]
    fn an_invalid_p3_profile_is_not_published_as_a_platform_fact() {
        let mut declaration = decl();
        declaration.binding_profiles = &[crate::decl::BindingProfileDeclaration {
            transport_bit: 0b0100_0000,
            schema: "org.example.binding.test",
            version: 1,
            canonical_value: "value=1",
        }];
        let mut buf = [0u8; 1024];
        assert!(matches!(
            publish(&declaration, &mut buf),
            Err(PublishError::BindingProfileInvalid(
                Discrepancy::BindingProfileInvalid {
                    reason: crate::decl::BindingProfileRefusal::TransportNotDeclared,
                    ..
                }
            ))
        ));
    }

    #[test]
    fn a_declaration_without_a_transport_is_not_published() {
        let mut declaration = decl();
        declaration.transports = 0;
        let mut buf = [0u8; 1024];
        assert_eq!(
            publish(&declaration, &mut buf),
            Err(PublishError::NoTransportBindings),
            "a zero P3 binding set is not a publishable hive declaration"
        );
    }

    /// The duty-cycled arm carries its three intervals; the always-on arm
    /// carries none and must not print empty ones.
    #[test]
    fn the_availability_arms_publish_what_they_have_and_nothing_they_do_not() {
        let mut buf = [0u8; 1024];
        let text = published(&decl(), &mut buf);
        assert!(text.contains("availability: duty-cycled"));
        assert!(text.contains("shortest-permitted-s: 5"));
        assert!(text.contains("longest-permitted-s: 1800"));
        assert!(text.contains("shortest-self-selected-s: 30"));

        let mut d = decl();
        d.availability = Availability::AlwaysOn;
        let mut buf2 = [0u8; 1024];
        let text = published(&d, &mut buf2);
        assert!(text.contains("availability: always-on"));
        assert!(
            !text.contains("shortest-permitted"),
            "an always-on platform must not publish wake intervals it has none of"
        );
    }

    /// ‼ **AN ABSENT FACILITY IS PUBLISHED AS `none`, NOT OMITTED — AND IT
    /// IS NOT DRESSED UP AS AN ATTESTED SHORTFALL.** `SS357` records that
    /// `Option::None` here cannot distinguish *this platform has no slots*
    /// from *nobody filled the field in*, and **the shape 8.5 needs is Roy's
    /// to rule**, so this prints what the type holds and invents nothing.
    #[test]
    fn an_absent_update_facility_is_stated_rather_than_omitted() {
        let mut d = decl();
        d.update_slots = None;
        let mut buf2 = [0u8; 1024];
        let text = published(&d, &mut buf2);
        assert!(text.contains("P9  update-slots: none"));
        assert!(
            !text.contains("usable-bytes-each"),
            "no size for slots that do not exist"
        );
        // And the present case still states both facts.
        let mut buf = [0u8; 1024];
        let text = published(&decl(), &mut buf);
        assert!(text.contains("P9  update-slots: 2"));
        assert!(text.contains("usable-bytes-each: 1600000"));
    }

    /// ‼ **A SHORT BUFFER REFUSES AND WRITES NOTHING A READER COULD USE.**
    /// *A declaration truncated to fit states fewer parameters than 8.1.2
    /// requires, and would read as a conforming declaration of a smaller
    /// platform* — which is the one failure mode this emitter must not have.
    #[test]
    fn a_short_buffer_refuses_rather_than_truncating() {
        let d = decl();
        let mut small = [0u8; 40];
        assert_eq!(publish(&d, &mut small), Err(PublishError::BufferTooSmall));

        // And the boundary: exactly enough works, one octet short refuses.
        let mut buf = [0u8; 1024];
        let n = publish(&d, &mut buf).expect("publishes");
        let mut scratch = [0u8; 1024];
        assert!(publish(&d, &mut scratch[..n]).is_ok(), "exactly enough");
        assert_eq!(
            publish(&d, &mut scratch[..n - 1]),
            Err(PublishError::BufferTooSmall),
            "one octet short REFUSES rather than stating fewer parameters"
        );
    }

    #[test]
    fn an_unordered_duty_cycle_is_not_published_as_a_usable_declaration() {
        let d = PlatformDeclaration {
            availability: Availability::DutyCycled(WakeIntervals {
                shortest_permitted_s: 100,
                longest_permitted_s: 60,
                shortest_self_selected_s: 100,
            }),
            ..decl()
        };
        let mut buf = [0u8; 1024];
        assert_eq!(
            publish(&d, &mut buf),
            Err(PublishError::UnorderedWakeIntervals),
            "a contradictory P8 is refused before any declaration is emitted"
        );
    }

    /// The numbers are the declaration's own, so a third party reading this
    /// without the board learns what the board would have told them.
    #[test]
    fn the_published_values_are_the_declarations_values() {
        let mut buf = [0u8; 1024];
        let text = published(&decl(), &mut buf);
        assert!(text.contains("memory-bytes: 524288"));
        assert!(text.contains("storage-bytes: 4194304"));
        assert!(text.contains("highest-layer-hosted: 7"));
        assert!(text.contains("key-bearing: yes"));
        assert!(text.contains("timebase-survives-power-loss: no"));
        assert!(text.contains("position-observability: boot-path-writes-one"));
        assert!(text.contains("covered-by-pre-write-check: no"));
    }
}
