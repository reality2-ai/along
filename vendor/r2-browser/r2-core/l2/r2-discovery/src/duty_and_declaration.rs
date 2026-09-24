//! **Duty cycling as an exemption nobody gets, and the bearer a development
//! hive may not use (L2 4.1.4, 4.1.5, 5.4a.3a).**
//!
//! # ‼ 4.1.5 EXISTS BECAUSE A DECLARATION IS THE EASIEST ESCAPE HATCH TO
//! # REACH
//!
//! **4.1.4**: a duty-cycled hive satisfies the beaconing obligation *by
//! beaconing and receiving **while it is receptive***. **4.1.5**: a hive
//! *shall **not** declare itself duty-cycled in order to reduce its beaconing
//! below what 6.1 or 6.2 requires of it **while receptive***.
//!
//! So duty cycling **narrows when the obligation applies and never how much
//! it asks for.** *Without 4.1.5 a hive could satisfy every clause by
//! declaring itself duty-cycled and then being receptive rarely* — the
//! declaration would become a way to be conformant and undiscoverable at the
//! same time, which is the one outcome Clause 4 exists to prevent. Note 1 to
//! 4.1.1: **beaconing is a consequence of being on the network, not a feature
//! added to a hive that wants to be found.**
//!
//! **The check is therefore against the cadence WHILE RECEPTIVE**, not
//! against the average over the duty cycle. *An average is exactly the figure
//! a hive gaming 4.1.5 would prefer to be judged on.*
//!
//! # ‼ 5.4a.3a: A DEVELOPMENT HIVE MAY NOT PUT SUCH A BEARER IN SERVICE
//!
//! *A hive running a development image shall not place in service a bearer
//! whose binding document states that its announcement cannot carry the
//! declaration.* **The failure is that the hive looks like production**:
//! 5.4a.2 forbids a production hive to emit the declaration at all, so an
//! absent declaration is what production looks like — and a development hive
//! on such a bearer is **indistinguishable from a production one** to every
//! scanner in range.
//!
//! *That is not a cosmetic mislabel.* 5.4a.4 forbids presenting unknown as
//! production **to a person or to any trust decision**, and this is the case
//! where the hive itself manufactures the ambiguity.

use r2_hal_traits::build_mode::BuildMode;
use r2_transport::l1::{Bearer, BearerProfile, BuildModeDeclarationCarriage, Ordinal};

use crate::l2::DutyClass;

/// A per-bearer schedule used to check beaconing while a hive is receptive
/// (L2 4.1.4, 4.1.5).
///
/// This is deliberately **not** L0 P8 [`r2_hal_traits::decl::Availability`].
/// P8 declares a platform-wide operating promise and its three inter-wake
/// bounds; this value describes the width and recurrence of one bearer's
/// actual receptive window.  The standard has not yet defined the B9-to-P8
/// relationship (`SS534`), so a board assembly must not translate either
/// value into the other by convention.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BeaconWindowSchedule {
    AlwaysOn,
    /// Receptive in windows. `receptive_s` is how long a window lasts and
    /// `period_s` how often one starts.
    DutyCycled {
        receptive_s: u32,
        period_s: u32,
    },
}

/// Why a duty-cycle declaration does not satisfy 4.1.4/4.1.5.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DutyRefusal {
    /// **4.1.5**: the hive would beacon less often *while receptive* than
    /// 6.1 or 6.2 requires.
    ///
    /// ‼ **THE COMPARISON IS AGAINST THE CADENCE WHILE RECEPTIVE.** *An
    /// average over the duty cycle is the figure a hive gaming this clause
    /// would prefer to be judged on*, and it would let arbitrarily rare
    /// receptivity pass.
    BeaconsTooRarelyWhileReceptive { interval_s: u32, required_s: u32 },
    /// A window shorter than one beacon interval never emits at all, so the
    /// hive is undiscoverable however often the window recurs.
    ///
    /// **Stated separately from the interval check** because it is a
    /// different mistake: the cadence may be perfectly correct and still
    /// never fire inside a window too short to contain it.
    WindowShorterThanOneBeacon { receptive_s: u32, interval_s: u32 },
    /// A period that is zero or shorter than its own window is not a duty
    /// cycle.
    PeriodNotUsable { receptive_s: u32, period_s: u32 },
}

/// **4.1.4 and 4.1.5: does this duty cycle satisfy the beaconing
/// obligation?**
///
/// `required_s` is what 6.1 or 6.2 asks of this bearer — supplied rather
/// than derived, because [`crate::beacon_policy`] owns that question and a
/// second answer here would be a second place for it to drift.
pub fn beacon_window_schedule_satisfies(
    schedule: BeaconWindowSchedule,
    beacon_interval_s: u32,
    required_s: u32,
) -> Result<(), DutyRefusal> {
    let BeaconWindowSchedule::DutyCycled {
        receptive_s,
        period_s,
    } = schedule
    else {
        // An always-on hive has no window to be judged against; 6.1/6.2
        // govern it directly.
        return Ok(());
    };
    // A zero-length window is no window at all.  It must refuse here rather
    // than reach the cadence check below: `0 < beacon_interval_s` happens to
    // refuse common inputs, but a zero beacon interval would otherwise make
    // an unreceptive hive look conformant.
    if receptive_s == 0 || period_s == 0 || period_s < receptive_s {
        return Err(DutyRefusal::PeriodNotUsable {
            receptive_s,
            period_s,
        });
    }
    // 4.1.5, and the comparison is WHILE RECEPTIVE.
    if beacon_interval_s > required_s {
        return Err(DutyRefusal::BeaconsTooRarelyWhileReceptive {
            interval_s: beacon_interval_s,
            required_s,
        });
    }
    // A window that cannot contain one interval emits nothing.
    if receptive_s < beacon_interval_s {
        return Err(DutyRefusal::WindowShorterThanOneBeacon {
            receptive_s,
            interval_s: beacon_interval_s,
        });
    }
    Ok(())
}

/// Why a bearer may not be placed in service.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ServiceRefusal {
    /// **5.4a.3a**: a development image, on a bearer whose announcement
    /// cannot carry the declaration.
    ///
    /// ‼ **THE HIVE WOULD LOOK LIKE PRODUCTION.** 5.4a.2 forbids a
    /// production hive to emit the declaration at all, so *an absent
    /// declaration is what production looks like* — and 5.4a.4 forbids
    /// presenting unknown as production **to a person or to any trust
    /// decision**. Here the hive manufactures that ambiguity itself.
    DevelopmentOnABearerThatCannotDeclareIt { bearer: Ordinal },
}

/// **5.4a.3a: may this hive place this bearer in service?**
pub const fn may_place_in_service(
    image_mode: BuildMode,
    profile: &BearerProfile,
    carriage: BuildModeDeclarationCarriage,
) -> Result<(), ServiceRefusal> {
    if matches!(image_mode.declared(), BuildMode::Development)
        && matches!(carriage, BuildModeDeclarationCarriage::CannotCarry)
    {
        return Err(ServiceRefusal::DevelopmentOnABearerThatCannotDeclareIt {
            bearer: profile.ordinal,
        });
    }
    Ok(())
}

/// **5.4a.3a: admit an output bearer using its own binding fact.**
///
/// The image mode is an L0 fact and declaration carriage is an L1 fact.  L2
/// is the only layer that has the service rule joining them, so assembly must
/// call this before it makes the bearer available to any discovery scheduler
/// or regulated dispatcher.  A bearer that has not explicitly established
/// carriage defaults to `CannotCarry` at the L1 boundary and therefore fails
/// closed for a development or unknown image.
pub fn may_place_bearer_in_service(
    image_mode: BuildMode,
    bearer: &dyn Bearer,
) -> Result<(), ServiceRefusal> {
    may_place_in_service(
        image_mode,
        bearer.profile(),
        bearer.build_mode_declaration_carriage(),
    )
}

/// **What a sender may do with a frame for a peer of a given duty class
/// (L0 7.2).**
///
/// ‼ **THERE IS NO `Receptive` VARIANT, AND ITS ABSENCE IS THE CLAUSE.** 7.2
/// forbids *assuming* a peer is receptive outside a wake window, and this
/// implementation cannot know where the windows are — a beacon declares only
/// the **longest interval between** them (L2 5.4b.1), never their phase. *A
/// value meaning "receptive now" would be a place for that assumption to be
/// written down*, so the type offers only "the peer says it is always
/// receptive" and "wait for the peer to speak".
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dispatch {
    /// The peer declared continuous reception, so there is no wake window to
    /// be outside of.
    Now,
    /// Hold the frame until this peer is **heard**, and no longer than
    /// `hold_for_s` whatever happens.
    ///
    /// The bound is what stops a hold becoming a silent drop: L2 5.4b.1 makes
    /// `longest_interval_s` the longest gap between receptive windows, so a
    /// peer that is alive at all has been receptive at least once by then.
    /// *Waiting longer would be waiting on something the declaration does not
    /// promise.*
    UntilHeard { hold_for_s: u32 },
}

/// **L0 7.2 — may a frame for this peer go now?**
///
/// ‼ **`Unknown` IS `Now`, AND THE DIRECTION IS DELIBERATE.** L2 5.4b.4 says
/// a scanner unable to read the field *shall not treat the absence as a claim
/// of either class* — so an unreadable field is not a claim of intermittence
/// either, and holding on it would strand traffic to every peer on every
/// bearer whose announcement layout has no room for the declaration. **Both
/// BLE and ESP-NOW are such bearers today**, so treating unknown as
/// intermittent would hold every frame on the two bindings that carry most of
/// this mesh's traffic, for a property none of their peers ever claimed. *The
/// conservative-looking reading is the one that breaks the network.*
///
/// The caller owes the other half: a frame held under
/// [`Dispatch::UntilHeard`] is released by **hearing the peer**, which is the
/// evidence 7.2 says may not be assumed — and released anyway at the bound,
/// because a hold with no end is a drop that never reports itself.
pub const fn dispatch_for(duty: DutyClass) -> Dispatch {
    match duty {
        DutyClass::Continuous | DutyClass::Unknown => Dispatch::Now,
        DutyClass::Intermittent { longest_interval_s } => Dispatch::UntilHeard {
            hold_for_s: longest_interval_s,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2_transport::l1::{Fade, Reach};

    fn profile(ordinal: Ordinal) -> BearerProfile {
        BearerProfile {
            ordinal,
            max_payload: 0..=250,
            wire_tier: r2_transport::l1::WireTier::Compact,
            fade: Fade::Unregulated { seconds: 60 },
            relative_cost: 1,
            reach: Reach::Local,
            receptivity: r2_transport::l1::Receptivity::Continuous,
            participates_in_discovery: true,
            connection: None,
        }
    }

    /// ‼ **4.1.5: DUTY CYCLING NARROWS WHEN THE OBLIGATION APPLIES AND NEVER
    /// HOW MUCH IT ASKS FOR.** *Without it a hive could satisfy every clause
    /// by declaring itself duty-cycled and then being receptive rarely* —
    /// conformant and undiscoverable at once, which is the outcome Clause 4
    /// exists to prevent.
    #[test]
    fn a_duty_cycle_does_not_buy_a_slower_cadence_while_receptive() {
        // Awake 60 s in every hour, beaconing every 30 s while awake, where
        // 6.1 asks for 30 s. Conformant: rare receptivity, correct cadence.
        assert_eq!(
            beacon_window_schedule_satisfies(
                BeaconWindowSchedule::DutyCycled {
                    receptive_s: 60,
                    period_s: 3600
                },
                30,
                30
            ),
            Ok(())
        );

        // Same window, cadence slowed to 45 s because "we are duty-cycled".
        // That is 4.1.5's exact prohibition.
        assert_eq!(
            beacon_window_schedule_satisfies(
                BeaconWindowSchedule::DutyCycled {
                    receptive_s: 60,
                    period_s: 3600
                },
                45,
                30
            ),
            Err(DutyRefusal::BeaconsTooRarelyWhileReceptive {
                interval_s: 45,
                required_s: 30
            })
        );
    }

    /// ‼ **THE COMPARISON IS AGAINST THE CADENCE WHILE RECEPTIVE, NOT AN
    /// AVERAGE.** *An average over the duty cycle is the figure a hive gaming
    /// 4.1.5 would prefer to be judged on*, and it would let arbitrarily rare
    /// receptivity pass.
    #[test]
    fn rare_receptivity_is_not_itself_a_breach() {
        // Awake 30 s a day. The AVERAGE beacon rate is dismal; the cadence
        // while receptive is exactly right, and 4.1.4 says that satisfies it.
        assert_eq!(
            beacon_window_schedule_satisfies(
                BeaconWindowSchedule::DutyCycled {
                    receptive_s: 30,
                    period_s: 86_400
                },
                30,
                30
            ),
            Ok(()),
            "4.1.4 is satisfied by beaconing WHILE RECEPTIVE"
        );
    }

    /// A window too short to contain one interval emits nothing, however
    /// often it recurs — **a different mistake from a slow cadence**, since
    /// the cadence here is correct.
    #[test]
    fn a_window_shorter_than_one_beacon_interval_never_emits() {
        assert_eq!(
            beacon_window_schedule_satisfies(
                BeaconWindowSchedule::DutyCycled {
                    receptive_s: 10,
                    period_s: 600
                },
                30,
                30
            ),
            Err(DutyRefusal::WindowShorterThanOneBeacon {
                receptive_s: 10,
                interval_s: 30
            })
        );
    }

    /// A period that is zero or shorter than its own window is not a duty
    /// cycle, and is refused before the cadence is judged against it.
    #[test]
    fn a_nonsensical_period_is_refused_before_anything_is_judged_against_it() {
        for (receptive_s, period_s) in [(0u32, 1u32), (60, 0), (600, 60)] {
            assert_eq!(
                beacon_window_schedule_satisfies(
                    BeaconWindowSchedule::DutyCycled {
                        receptive_s,
                        period_s
                    },
                    30,
                    30
                ),
                Err(DutyRefusal::PeriodNotUsable {
                    receptive_s,
                    period_s
                })
            );
        }
    }

    /// An always-on hive has no window; 6.1 and 6.2 govern it directly.
    #[test]
    fn an_always_on_hive_is_not_judged_against_a_window_it_does_not_have() {
        assert_eq!(
            beacon_window_schedule_satisfies(BeaconWindowSchedule::AlwaysOn, 45, 30),
            Ok(())
        );
    }

    /// ‼ **5.4a.3a: A DEVELOPMENT HIVE ON SUCH A BEARER LOOKS LIKE
    /// PRODUCTION.** 5.4a.2 forbids a production hive to emit the declaration
    /// at all, so *an absent declaration is what production looks like* — and
    /// 5.4a.4 forbids presenting unknown as production **to a person or to
    /// any trust decision.** Here the hive manufactures that ambiguity
    /// itself.
    #[test]
    fn a_development_hive_may_not_use_a_bearer_that_cannot_declare_it() {
        let p = profile(Ordinal::Lora);

        assert_eq!(
            may_place_in_service(
                BuildMode::Development,
                &p,
                BuildModeDeclarationCarriage::CannotCarry,
            ),
            Err(ServiceRefusal::DevelopmentOnABearerThatCannotDeclareIt {
                bearer: Ordinal::Lora
            })
        );
        // The same bearer is fine once its binding can carry the declaration.
        assert_eq!(
            may_place_in_service(
                BuildMode::Development,
                &p,
                BuildModeDeclarationCarriage::Carries,
            ),
            Ok(())
        );
        // ‼ AND A PRODUCTION IMAGE IS UNAFFECTED, WHICH IS THE POINT: it
        // emits no declaration anywhere (5.4a.2), so a bearer that cannot
        // carry one costs it nothing.
        assert_eq!(
            may_place_in_service(
                BuildMode::Production,
                &p,
                BuildModeDeclarationCarriage::CannotCarry,
            ),
            Ok(())
        );
        assert_eq!(
            may_place_in_service(
                BuildMode::Production,
                &p,
                BuildModeDeclarationCarriage::Carries,
            ),
            Ok(())
        );
    }

    /// ‼ **`L0-031` (L0 7.2): A DUTY-CYCLED PLATFORM SHALL NOT ASSUME ANY PEER
    /// IS RECEPTIVE OUTSIDE A WAKE WINDOW.**
    ///
    /// The clause is classed CONSTRUCTION and the construction is the type:
    /// [`Dispatch`] has **no variant meaning "receptive now"**, so there is
    /// nowhere for the assumption to be written. What a test can add is the
    /// direction of each mapping, and the one that matters is `Unknown`.
    ///
    /// *A test asserting only that Intermittent holds would pass against a
    /// function that held EVERYTHING*, which is the conservative-looking
    /// reading L2 5.4b.4 forbids in terms — an unreadable field is not a claim
    /// of either class. Both BLE and ESP-NOW announcements lack room for the
    /// declaration today, so holding on `Unknown` would hold every frame on
    /// the two bindings carrying most of this mesh's traffic. So `Unknown` is
    /// asserted FIRST and by name.
    ///
    /// The sweep is exhaustive: a fourth `DutyClass` variant fails to compile
    /// here rather than inheriting an answer from a catch-all arm.
    #[test]
    fn only_an_intermittent_peer_is_held_and_an_unreadable_declaration_is_not_one() {
        assert_eq!(
            dispatch_for(DutyClass::Unknown),
            Dispatch::Now,
            "\u{203c} 5.4b.4: an unreadable declaration is NOT a claim of intermittence, \
             and holding on it would strand every frame on every bearer whose \
             announcement cannot carry the field"
        );
        assert_eq!(dispatch_for(DutyClass::Continuous), Dispatch::Now);
        assert_eq!(
            dispatch_for(DutyClass::Intermittent {
                longest_interval_s: 900
            }),
            Dispatch::UntilHeard { hold_for_s: 900 },
            "the bound is the peer's OWN declared longest interval, not a constant"
        );
        assert_eq!(
            dispatch_for(DutyClass::Intermittent {
                longest_interval_s: 30
            }),
            Dispatch::UntilHeard { hold_for_s: 30 },
            "a second interval, so a hard-coded 900 is not mistaken for the rule"
        );

        // ‼ THE POPULATION CONTROL. Every duty class is decided, and only the
        //   intermittent one holds.
        for duty in [
            DutyClass::Continuous,
            DutyClass::Unknown,
            DutyClass::Intermittent {
                longest_interval_s: 1,
            },
        ] {
            match duty {
                DutyClass::Continuous | DutyClass::Unknown => {
                    assert_eq!(dispatch_for(duty), Dispatch::Now)
                }
                DutyClass::Intermittent { longest_interval_s } => assert_eq!(
                    dispatch_for(duty),
                    Dispatch::UntilHeard {
                        hold_for_s: longest_interval_s
                    }
                ),
            }
        }
    }
}
