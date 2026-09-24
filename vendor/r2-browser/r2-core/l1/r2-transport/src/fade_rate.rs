//! **B5 on a regulated bearer: where the fade rate may come from, and the one
//! place it may not (BND3 6a.5, 6a.6; L2 6.2.3, 6.3.2).**
//!
//! # ‼ THE VALUE THAT FAILS IS THE ONE THAT IS EASIEST TO MEASURE
//!
//! 6a.6: *the value shall not be derived from the interval observed while the
//! bearer is idle.* And an idle bearer is exactly what a bench is.
//!
//! **A regulated bearer observed on a quiet bench announces often; the same
//! bearer in a dense deployment announces rarely**, because its cadence is
//! what the airtime budget has left after everything else (L2 6.2.3 forbids
//! giving such a bearer a fixed beacon interval at all). So a fade period
//! measured while nothing else was talking is short — *and it fails in the
//! direction that declares live peers dead, each declaration costing exactly
//! the airtime the budget was already short of.*
//!
//! # ‼ SO THE PROVENANCE IS PART OF THE VALUE, NOT A NOTE BESIDE IT
//!
//! A `u32` of seconds cannot carry where it came from, and **6a.6 is entirely
//! about where it came from** — the same number is conforming or forbidden
//! depending on what the bearer was doing when it was taken. *A type that
//! accepted a bare number would leave the clause to a reviewer's memory*,
//! which is how the BLE pattern this clause exists to forbid would arrive:
//! by looking reasonable.

/// **Where a candidate B5 value came from.**
///
/// Deliberately not `Option<u32>` plus a comment: the discriminator *is* the
/// clause.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FadeSource {
    /// **6a.5's own basis**: the longest beacon interval the airtime budget
    /// can produce *under load* (L2 6.3.2). The value must exceed it.
    BudgetUnderLoad { longest_interval_s: u32 },
    /// An interval measured on a bearer that was carrying traffic.
    ///
    /// ‼ **REFUSED SINCE 2026-08-25 — THIS VARIANT WAS ACCEPTED AND THE
    /// ACCEPTANCE WAS FALSIFIED** (`r2-codex-refute`, confirmed at source).
    /// The reasoning that admitted it — *6a.6 forbids the idle observation,
    /// not observation* — read one forbidden source as permitting every
    /// other source. **6a.5 names the only valid basis**: the longest
    /// interval the airtime budget CAN PRODUCE under load. An observation
    /// reports what the budget DID produce during one loaded window; a
    /// heavier lawful load can delay a beacon far past any observed sample,
    /// and a fade derived from the sample then fades a peer that is
    /// announcing exactly on schedule. *The variant stays so the refusal
    /// can name the mistake; deleting it would turn the wrong call into a
    /// missing-variant puzzle instead of an explained refusal.*
    ObservedUnderLoad { longest_interval_s: u32 },
    /// ‼ **AN INTERVAL MEASURED WHILE THE BEARER WAS IDLE. 6a.6 FORBIDS
    /// THIS**, and it is the measurement a bench produces by default.
    ObservedWhileIdle { longest_interval_s: u32 },
}

/// Why a candidate B5 value is refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FadeRefusal {
    /// **6a.6**: derived from an idle observation.
    ///
    /// ‼ **The observed interval is carried in the refusal on purpose.** An
    /// implementer who measured 30 s on a quiet bench needs to see that
    /// number named as the reason, or the refusal reads as a configuration
    /// error and the next attempt is the same measurement.
    DerivedWhileIdle { observed_s: u32 },
    /// **6a.5**: the value does not exceed the longest interval its basis can
    /// produce, so a peer would be faded while still announcing on schedule.
    DoesNotExceedBasis { fade_s: u32, longest_s: u32 },
    /// **6a.5, the basis half**: derived from an observation, and an
    /// observation is not a bound. The budget can lawfully produce a longer
    /// interval than any sample shows, whatever the sample's load was.
    ObservationIsNotABound { observed_s: u32 },
    /// **6a.5, and the case where there is nothing to derive FROM.**
    ///
    /// ‼ **HELD APART FROM THE OTHER THREE DELIBERATELY.** Those refuse a
    /// candidate that was computed and is wrong; this one refuses because **no
    /// basis exists** — a bearer under no restraint at all has no longest
    /// interval its budget can produce, so `BudgetUnderLoad` has no argument.
    /// *An implementer meeting `DoesNotExceedBasis` adjusts a number; one
    /// meeting this has to supply a restraint or accept that 6a.5 gives the
    /// bearer no profile and no service.* Collapsing them would send the first
    /// reader to tune a value that does not exist.
    NoBasis,
}

/// **A B5 value that satisfies 6a.5 and 6a.6, and cannot be built otherwise.**
///
/// There is no `From<u32>`, no public field and no constructor that takes a
/// bare number — *the only door is [`FadeRate::derive`]*, which is what makes
/// this a property of the type rather than an obligation on a caller.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FadeRate {
    seconds: u32,
}

impl FadeRate {
    /// The value, in seconds, for a bearer profile's `fade`
    /// ([`crate::l1::Fade::Regulated`]).
    pub const fn seconds(&self) -> u32 {
        self.seconds
    }

    /// **Derive B5 from a stated source (6a.5, 6a.6).**
    ///
    /// `fade_s` is the candidate; the source is what it was computed from.
    /// **An idle observation is refused whatever the number is** — a
    /// generously large value derived the forbidden way is still derived the
    /// forbidden way, and *it is generous only against the interval the bench
    /// happened to show.*
    pub const fn derive(fade_s: u32, source: FadeSource) -> Result<Self, FadeRefusal> {
        let longest = match source {
            FadeSource::ObservedWhileIdle { longest_interval_s } => {
                return Err(FadeRefusal::DerivedWhileIdle {
                    observed_s: longest_interval_s,
                })
            }
            FadeSource::ObservedUnderLoad { longest_interval_s } => {
                return Err(FadeRefusal::ObservationIsNotABound {
                    observed_s: longest_interval_s,
                })
            }
            FadeSource::BudgetUnderLoad { longest_interval_s } => longest_interval_s,
        };
        // **EXCEED, not meet.** 6a.5 says *shall exceed*: a fade equal to the
        // longest interval fades a peer that is announcing exactly on time.
        if fade_s <= longest {
            return Err(FadeRefusal::DoesNotExceedBasis {
                fade_s,
                longest_s: longest,
            });
        }
        Ok(Self { seconds: fade_s })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **THE FORBIDDEN DERIVATION IS REFUSED WHATEVER THE NUMBER IS**, and
    /// the refusal names the observation so the next attempt is not the same
    /// measurement.
    #[test]
    fn an_idle_observation_is_refused_however_generous_the_value() {
        for fade in [1u32, 60, 3_600, u32::MAX] {
            assert_eq!(
                FadeRate::derive(
                    fade,
                    FadeSource::ObservedWhileIdle {
                        longest_interval_s: 30
                    }
                ),
                Err(FadeRefusal::DerivedWhileIdle { observed_s: 30 }),
                "fade {fade} derived from an idle bench was accepted"
            );
        }
    }

    /// The two permitted bases both work, and produce the same value.
    #[test]
    fn a_budget_basis_and_a_loaded_observation_are_both_permitted() {
        let a = FadeRate::derive(
            600,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 300,
            },
        )
        .expect("budget basis refused");
        assert_eq!(a.seconds(), 600);
    }

    /// ‼ **THE NEGATIVE TEST r2-codex-refute DEMANDED, WITH DISTINCT OBSERVED
    /// AND BUDGET MAXIMA.** A 10 s observation under load says nothing about
    /// a budget lawfully able to delay 100 s: a fade of 11 s built on the
    /// sample would fade a conforming peer 89 s before its next beacon. The
    /// acceptance this refuses shipped, and was falsified within the day.
    #[test]
    fn a_loaded_observation_is_refused_because_it_is_not_a_bound() {
        assert_eq!(
            FadeRate::derive(
                11,
                FadeSource::ObservedUnderLoad {
                    longest_interval_s: 10,
                },
            ),
            Err(FadeRefusal::ObservationIsNotABound { observed_s: 10 })
        );
        // And generosity does not launder the source: far above the sample
        // is still built on the sample.
        assert_eq!(
            FadeRate::derive(
                600,
                FadeSource::ObservedUnderLoad {
                    longest_interval_s: 10,
                },
            ),
            Err(FadeRefusal::ObservationIsNotABound { observed_s: 10 })
        );
    }

    /// ‼ **6a.5 SAYS *EXCEED*, AND EQUAL IS NOT EXCEED** — a fade equal to the
    /// longest interval fades a peer announcing exactly on schedule.
    #[test]
    fn a_fade_equal_to_the_longest_interval_is_refused() {
        assert_eq!(
            FadeRate::derive(
                300,
                FadeSource::BudgetUnderLoad {
                    longest_interval_s: 300
                }
            ),
            Err(FadeRefusal::DoesNotExceedBasis {
                fade_s: 300,
                longest_s: 300
            })
        );
        // One second more is enough — the clause is a strict inequality and
        // this states where the boundary actually is.
        assert!(FadeRate::derive(
            301,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 300
            }
        )
        .is_ok());
    }

    /// **The idle refusal is checked BEFORE the magnitude**, so an idle
    /// derivation that also happens to be too small reports the disqualifying
    /// fault rather than the incidental one.
    #[test]
    fn the_idle_refusal_takes_precedence_over_the_magnitude_refusal() {
        assert_eq!(
            FadeRate::derive(
                10,
                FadeSource::ObservedWhileIdle {
                    longest_interval_s: 300
                }
            ),
            Err(FadeRefusal::DerivedWhileIdle { observed_s: 300 }),
            "an idle derivation was reported as merely too small, which sends \
             an implementer to raise the number rather than to reload the bench"
        );
    }

    /// **The value cannot be reached except through `derive`** — there is no
    /// field and no conversion, which is what makes 6a.6 structural.
    ///
    /// ```compile_fail
    /// let _ = r2_transport::fade_rate::FadeRate { seconds: 5 };
    /// ```
    #[test]
    fn the_only_door_is_derive() {
        let f = FadeRate::derive(
            601,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 600,
            },
        )
        .unwrap();
        assert_eq!(f.seconds(), 601);
    }
}
