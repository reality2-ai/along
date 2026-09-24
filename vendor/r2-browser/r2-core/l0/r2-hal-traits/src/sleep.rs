//! Ceasing to be receptive, and being woken (L0 Clause 7).
//!
//! ‼‼ **THE STANDARD OBLIGES THE DECLARATION AND THE RESTRAINT, NOT THE ACT.**
//! Nothing in L0 says a duty-cycled platform *shall* sleep. 7.1 obliges it to
//! declare which it is, 7.2 forbids assuming a peer is receptive outside a wake
//! window, 7.3 obliges three intervals and 7.4 forbids adopting one below the
//! floor *whatever instruction it receives*. **So the thing this module builds
//! is not conformance — it is the ability to declare `DutyCycled` truthfully.**
//!
//! ‼ WHICH IS WHY IT DID NOT EXIST AND THE TREE WAS STILL HONEST. Both board
//! declarations say `AlwaysOn`, each with the same reason written beside it:
//! *no duty cycle is implemented, so declaring `DutyCycled` would oblige three
//! intervals this firmware does not honour.* That is the correct refusal, and it
//! is also a ceiling: the beacon's duty class is derived from `availability`
//! (`hive-mesh`), so a hive cannot announce a duty cycle it does not have, and
//! peers cannot hold frames for it rather than flooding at a silent radio —
//! which is the whole purpose L2 5.4b Note 2 gives the field.
//!
//! ‼ **THE CALLER MAY NOT SUPPLY A DURATION, AND THAT IS 7.4 MADE STRUCTURAL.**
//! *Shall not adopt an interval shorter than the shortest permitted, whatever
//! instruction it receives* is a behaviour; a `sleep(duration)` door leaves it a
//! sentence in a doc comment that any caller can read and ignore. Here the
//! instruction goes in and the ADOPTED interval comes out of
//! [`WakeIntervals::adopt`] inside the door, so a two-second instruction against
//! a sixty-second floor sleeps sixty and says so.

use crate::decl::{Availability, PlatformDeclaration, WakeIntervals};

/// What woke the platform — or why it never slept.
///
/// ‼ **THREE ANSWERS, NEVER A BOOL.** *Woke on schedule*, *was interrupted* and
/// *did not sleep* mean different things to the hive above: the first is the
/// duty cycle turning over, the second is the world interrupting it, and the
/// third is a platform that cannot cease being receptive at all. A boolean
/// collapses the second into the first and hides the third entirely — which is
/// the same shape as reporting a hive that could not start as one that started
/// quietly.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Woke {
    /// The adopted interval elapsed. Carries what was ACTUALLY adopted, which
    /// is not always what was asked for (L0 7.4).
    Scheduled { adopted_s: u32 },
    /// A declared wake source fired before the interval elapsed.
    Event(WakeSource),
    /// Nothing happened, and this says why rather than returning quietly.
    NotSlept(WhyNot),
}

/// A source permitted to end a sleep.
///
/// ‼ **AN EVENT WAKE IS EXPRESSIBLE HERE AND HAS NO FORM IN THE DUTY-CLASS
/// VOCABULARY ON AIR** (`SS521`). A hive that wakes on a schedule *and* on an
/// event still has a real longest interval to declare, so it is conformant; a
/// hive whose ONLY wake is an event has no interval to state and 5.4b.1's
/// *shall* is unqualified. This type does not resolve that — it makes the
/// distinction visible to the code so the row has something concrete to be
/// about.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WakeSource {
    /// A level or edge on a pin the platform has declared wake-capable.
    Pin(u8),
}

/// Why a sleep did not happen.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum WhyNot {
    /// The platform declares itself always-on (L0 7.1). Not a fault: most
    /// platforms are, and a mains-powered relay that slept would be worse.
    AlwaysOn,
    /// The declaration claims a duty cycle and P2 says the low-power state is
    /// **not implemented in the software as shipped**. The two disagree, and
    /// [`SleepAuthority::of`] refuses rather than picking a side.
    DeclarationDisagreesWithItself,
    /// The duty-cycle declaration reverses one of L0 7.3's ordered
    /// intervals. Granting an authority over it could clamp a request below
    /// the platform's stated floor, so the declaration is refused rather than
    /// repaired at use.
    UnorderedWakeIntervals,
    /// The platform has a low-power state and this build does not reach it —
    /// a host or wasm image, or a board image built without the feature.
    NotOnThisPlatform,
}

/// The right to cease being receptive, granted by the declaration and by
/// nothing else.
///
/// ‼‼ **ONE DOOR, AND IT CANNOT BE OPENED BY A CALLER'S OPINION.** A platform
/// cannot sleep because a caller thinks it should; it sleeps because its own
/// declaration says it is duty-cycled AND that the low-power state is
/// implemented. Both halves are required and neither is inferred from the other:
/// P8 is what the platform IS, P2 is whether the software as shipped can get
/// there, and **a declaration carrying `DutyCycled` with P2 false is a
/// declaration disagreeing with itself** — which this refuses by name rather
/// than resolving in either direction.
///
/// ‼ **THE INVARIANT HAD NO ENFORCEMENT ANYWHERE.** Nothing in the tree tied P2
/// to P8. A board could have declared a duty cycle with no low-power state and
/// every test would have passed, while the beacon announced an intermittent
/// hive and peers held frames for a radio that was never off.
#[derive(Clone, Copy, Debug)]
pub struct SleepAuthority {
    intervals: WakeIntervals,
}

impl SleepAuthority {
    /// The authority this declaration grants, or the reason it grants none.
    ///
    /// # Errors
    /// Returns the reason in [`WhyNot`]; there is no other failure.
    pub const fn of(d: &PlatformDeclaration) -> Result<Self, WhyNot> {
        match (d.availability, d.low_power_state_implemented) {
            (Availability::AlwaysOn, _) => Err(WhyNot::AlwaysOn),
            (Availability::DutyCycled(_), false) => Err(WhyNot::DeclarationDisagreesWithItself),
            (Availability::DutyCycled(intervals), true) => {
                if !intervals.is_ordered() {
                    return Err(WhyNot::UnorderedWakeIntervals);
                }
                Ok(Self { intervals })
            }
        }
    }

    /// The interval this platform would adopt if instructed to use
    /// `requested_s` — L0 7.4, applied here so no caller can route around it.
    #[must_use]
    pub const fn adopt(&self, requested_s: u32) -> u32 {
        self.intervals.adopt(requested_s)
    }

    /// The declared intervals, for a caller that must report them (L0 7.3) —
    /// read-only, because changing them is a change to the declaration.
    #[must_use]
    pub const fn intervals(&self) -> WakeIntervals {
        self.intervals
    }
}

/// A platform that can cease to be receptive until something wakes it.
///
/// ‼ **THE INSTRUCTION GOES IN AND THE ADOPTED INTERVAL COMES OUT.** The
/// implementation must clamp through [`SleepAuthority::adopt`]; the return value
/// carries what was actually adopted so a caller cannot mistake its request for
/// the outcome. *A door that returned nothing would let a floor violation look
/// exactly like compliance.*
///
/// ‼‼ **THERE ARE TWO DOORS BECAUSE THE HARDWARE HAS TWO, AND ONE OF THEM DOES
/// NOT COME BACK.** This trait was written with a single `sleep -> Woke` method,
/// which reads well and is wrong: on the part this fleet runs, `sleep_deep`
/// returns `!` — **the chip resets on wake, so the answer to *what woke you*
/// cannot arrive as a return value.** It arrives in the NEXT BOOT, from the wake
/// cause, and a trait that can only express the returning kind would have
/// quietly excluded the deeper state — which is the one the energy figures
/// depend on (P2). *A signature that cannot express the case that matters is a
/// design decision made by accident.*
pub trait Sleeper {
    /// Cease being receptive for the interval adopted from `requested_s`, or
    /// until a declared wake source fires, **and resume here**.
    ///
    /// An implementation that cannot reach its low-power state **shall** return
    /// [`Woke::NotSlept`] rather than busy-waiting: a caller that asked to sleep
    /// and was silently kept awake has been told the energy was spent when it
    /// was not.
    fn sleep(&mut self, authority: &SleepAuthority, requested_s: u32) -> Woke;
}

/// A platform whose deepest state is a reset: it does not resume, it reboots.
///
/// ‼‼ **WHAT DOES NOT SURVIVE IS THE POINT OF SEPARATING THIS FROM [`Sleeper`].**
/// RAM is gone. On this fleet's boards that means the group key held for the
/// life of a boot (the declarations say `key_bearing: false` for exactly this
/// reason — *a group key in RAM is not retention*), the neighbour table, the
/// custody buffer and every unacknowledged frame it holds. **Anything that must
/// outlive a wake has to be in durable storage before this is called**, and a
/// caller that treats it as a longer [`Sleeper::sleep`] will lose the outbox it
/// was about to drain.
///
/// ‼ THE READING LOG ALREADY ANTICIPATED THIS AND NOTHING ELSE DID: its stamp
/// orders `boot` before `time_ms`, so records stay ordered across a reset that
/// restarts the millisecond counter. That is one structure prepared for a wake
/// nothing could yet perform.
pub trait DeepSleeper {
    /// Cease being receptive and **do not return**. The platform resets when a
    /// declared wake source fires; the cause is read at the next boot with
    /// [`DeepSleeper::woke_because`].
    fn sleep_until_reset(self, authority: &SleepAuthority, requested_s: u32) -> !;

    /// Why the platform is running, read once at boot.
    ///
    /// [`None`] means this boot did not follow a deep sleep — a power-on, a
    /// flash, a watchdog or a panic. ‼ **`None` IS NOT `Scheduled`**: a boot
    /// nobody asked for and a boot the timer asked for want different responses,
    /// and collapsing them is how a crash loop comes to look like a duty cycle.
    fn woke_because(&self) -> Option<Woke>;
}

/// The honest implementation for every platform that has no low-power state:
/// host, wasm, and any board image built without the feature.
///
/// ‼ **IT EXISTS SO THAT `sleep` IS ALWAYS CALLABLE.** The alternative — no
/// implementation, so the call site is `#[cfg]`-gated — puts the platform's
/// availability into the build graph, where a caller reading the source cannot
/// see which way it went. Here the code is identical on every platform and the
/// ANSWER differs, which is the difference between a fact and a compile flag.
#[derive(Clone, Copy, Debug, Default)]
pub struct NeverSleeps;

impl Sleeper for NeverSleeps {
    fn sleep(&mut self, _authority: &SleepAuthority, _requested_s: u32) -> Woke {
        Woke::NotSlept(WhyNot::NotOnThisPlatform)
    }
}

// ‼ NO `DeepSleeper` FOR `NeverSleeps`, AND THE ABSENCE IS DELIBERATE.
// `sleep_until_reset` returns `!`, so an honest stub cannot exist: it would have
// to loop for ever or panic, and both are worse than not being callable. A
// platform that cannot reset itself has no deep sleep, and the way to say so is
// NOT TO IMPLEMENT THE TRAIT — which a reader and a compiler can both check,
// unlike a stub returning a value that means *I did not*.

#[cfg(test)]
mod tests {
    use super::{NeverSleeps, SleepAuthority, Sleeper, WhyNot, Woke};
    use crate::decl::{
        Availability, CapabilityClass, PlatformDeclaration, PlatformId, PositionObservability,
        RecoverySubstrate, UpdateSlots, WakeIntervals, WriteBoundary,
    };

    /// ‼ **THE FIXTURE IS PUBLISH'S, TAKEN VERBATIM RATHER THAN WRITTEN
    /// AGAIN.** `PlatformDeclaration` has nineteen fields and two of them are
    /// the subject here; a second hand-built fixture would drift from the
    /// first, and the drift would land in whichever test nobody edited. What
    /// this file varies is exactly the pair under test, so a failure has one
    /// place to land.
    fn base() -> PlatformDeclaration {
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

    fn decl(availability: Availability, low_power: bool) -> PlatformDeclaration {
        PlatformDeclaration {
            availability,
            low_power_state_implemented: low_power,
            ..base()
        }
    }

    const INTERVALS: WakeIntervals = WakeIntervals {
        shortest_permitted_s: 60,
        longest_permitted_s: 3_600,
        shortest_self_selected_s: 300,
    };

    /// ‼ **THE INVARIANT NOTHING ENFORCED.** A declaration claiming a duty cycle
    /// while P2 says the low-power state is not implemented is a declaration
    /// disagreeing with itself, and until this type existed a board could have
    /// carried exactly that — announcing an intermittent hive on the beacon,
    /// while peers held frames for a radio that was never off.
    #[test]
    fn a_duty_cycle_without_a_low_power_state_is_refused_by_name() {
        let d = decl(Availability::DutyCycled(INTERVALS), false);
        assert_eq!(
            SleepAuthority::of(&d).unwrap_err(),
            WhyNot::DeclarationDisagreesWithItself,
            "the two halves must be refused together rather than resolved in either direction"
        );
    }

    /// An always-on platform is refused, and NOT as a fault: most platforms are
    /// always-on, and a mains-powered relay that slept would be worse than one
    /// that did not.
    #[test]
    fn an_always_on_platform_gets_no_authority_and_no_blame() {
        for low_power in [false, true] {
            let d = decl(Availability::AlwaysOn, low_power);
            assert_eq!(SleepAuthority::of(&d).unwrap_err(), WhyNot::AlwaysOn);
        }
    }

    #[test]
    fn a_declaration_that_agrees_with_itself_grants_the_authority() {
        let d = decl(Availability::DutyCycled(INTERVALS), true);
        let a = SleepAuthority::of(&d).expect("both halves declared");
        assert_eq!(a.intervals(), INTERVALS);
    }

    #[test]
    fn an_unordered_declaration_cannot_turn_its_ceiling_into_a_floor_violation() {
        let inverted = WakeIntervals {
            shortest_permitted_s: 100,
            longest_permitted_s: 60,
            shortest_self_selected_s: 100,
        };
        let d = decl(Availability::DutyCycled(inverted), true);
        assert!(
            matches!(SleepAuthority::of(&d), Err(WhyNot::UnorderedWakeIntervals)),
            "a request of 101 would otherwise be clamped to 60 below the declared floor of 100"
        );
    }

    /// ‼ **L0 7.4 MADE STRUCTURAL.** *Shall not adopt an interval shorter than
    /// the shortest permitted, whatever instruction it receives.* The caller
    /// cannot supply a duration to `sleep`; it supplies a REQUEST, and the floor
    /// is applied inside the door. Probed here at the boundary rather than in
    /// the safe middle: one second below the floor, and the floor itself.
    #[test]
    fn an_instruction_below_the_floor_is_clamped_and_not_obeyed() {
        let d = decl(Availability::DutyCycled(INTERVALS), true);
        let a = SleepAuthority::of(&d).unwrap();
        assert_eq!(
            a.adopt(1),
            60,
            "two seconds against a sixty-second floor sleeps sixty"
        );
        assert_eq!(a.adopt(59), 60, "one below the floor is still the floor");
        assert_eq!(a.adopt(60), 60, "the floor itself is adoptable");
        assert_eq!(a.adopt(300), 300, "above the floor, the instruction stands");
    }

    /// ‼ **THE CEILING IS THE DEPENDER'S GUARANTEE AND IT HAD NO ARM.** L0 7.4
    /// forbids adopting SHORTER than the floor and says nothing about longer —
    /// but 7.3 Note 1 gives the longest permitted its own owner: it *bounds how
    /// stale the data may become and belongs to whoever depends on it*. Clamping
    /// there is stronger than 7.4 obliges and is what honours that owner.
    ///
    /// ‼ AND IT IS NOT SILENT, WHICH IS WHY CLAMPING IS ACCEPTABLE RATHER THAN A
    /// REFUSAL: the door returns the ADOPTED value, so a caller asking for two
    /// hours is handed one and can see it. A door returning nothing would have
    /// had to refuse instead, because a shortened sleep and an obeyed one would
    /// print the same silence.
    #[test]
    fn an_instruction_above_the_ceiling_is_clamped_and_the_caller_is_told() {
        let d = decl(Availability::DutyCycled(INTERVALS), true);
        let a = SleepAuthority::of(&d).unwrap();
        assert_eq!(a.adopt(3_600), 3_600, "the ceiling itself is adoptable");
        assert_eq!(
            a.adopt(3_601),
            3_600,
            "one above the ceiling is the ceiling"
        );
        assert_eq!(a.adopt(u32::MAX), 3_600, "and so is any instruction at all");
    }

    /// ‼ **A PLATFORM THAT CANNOT SLEEP SAYS SO RATHER THAN BUSY-WAITING.** A
    /// caller that asked to sleep and was silently kept awake has been told the
    /// energy was spent when it was not — and the call site would look identical
    /// on a board that really slept.
    #[test]
    fn a_platform_with_no_low_power_state_answers_rather_than_pretending() {
        let d = decl(Availability::DutyCycled(INTERVALS), true);
        let a = SleepAuthority::of(&d).unwrap();
        assert_eq!(
            NeverSleeps.sleep(&a, 300),
            Woke::NotSlept(WhyNot::NotOnThisPlatform)
        );
    }

    /// ‼ **A BOOT NOBODY ASKED FOR IS NOT A SCHEDULED WAKE.** `woke_because`
    /// returns `Option<Woke>` and the `None` arm is the one that matters: a
    /// power-on, a flash, a watchdog or a panic all produce a running board with
    /// no wake behind it, and a caller that read `None` as *the timer fired*
    /// would tick its duty cycle forward on a crash. **A crash loop would then
    /// look exactly like a duty cycle**, which is the failure this arm exists to
    /// keep visible — it is a type-level property, so the arm asserts the type
    /// rather than a behaviour.
    #[test]
    fn a_wake_cause_is_optional_and_none_is_not_a_scheduled_wake() {
        let none: Option<Woke> = None;
        assert!(none.is_none());
        assert_ne!(none, Some(Woke::Scheduled { adopted_s: 60 }));
    }

    /// The three answers are three, and a caller cannot collapse two of them by
    /// accident: `Scheduled` carries what was ADOPTED, so a floor violation
    /// cannot look like compliance.
    #[test]
    fn waking_on_schedule_and_waking_on_an_event_are_not_the_same_answer() {
        assert_ne!(
            Woke::Scheduled { adopted_s: 60 },
            Woke::Event(super::WakeSource::Pin(2))
        );
        assert_ne!(
            Woke::Scheduled { adopted_s: 60 },
            Woke::Scheduled { adopted_s: 300 },
            "the adopted interval is part of the answer, not a detail beside it"
        );
    }
}
