//! **Beacon cadence and the fade it must be set against (L2 Clause 6).**
//!
//! # Two kinds of bearer, and the difference is not a tuning knob
//!
//! ‼ **6.2.3 IS A REQUIREMENT AND NOT AN OMISSION**, which its own Note 1
//! says in those words: *on a regulated bearer the cadence is an **outcome**,
//! not a setting* — it falls out of what the budget has left after everything
//! else, so it lengthens by itself as a deployment gets denser or busier. **A
//! fixed interval would be a promise the bearer breaks whenever the network
//! is under load, which is precisely when a scanner is most likely to be
//! relying on it.**
//!
//! So [`BeaconSchedule`] has two constructors and no way to give a regulated
//! bearer an interval. *A type that accepted one and ignored it would be a
//! promise broken quietly.*
//!
//! # The fade is set against the cadence, not against the medium
//!
//! L1 obliges each bearer to declare how quickly an unheard peer recedes and
//! **does not say what the value should be** — 6.3 Note 1: *the value is not
//! a property of the medium, it is a property of how often the medium is used
//! to announce, which is decided here.* [`BeaconSchedule::check`] is that
//! check — **one door**: it judges the schedule's kind against the bearer
//! AND the bearer's fade against the schedule's longest gap, so no caller
//! can validate the one and forget the other. Until 2026-08-25 the fade
//! comparison was a separate helper with only test callers, and `check`
//! accepted a fade of 60 s against a gap of 900 s (r2-codex-refute).
//!
//! ‼ **6.3.2 NAMES THE CASE THAT MAKES 6.3.1 INSUFFICIENT ON ITS OWN, AND IT
//! IS A MEASUREMENT TRAP.** *A regulated bearer observed on a quiet bench
//! announces often; the same bearer in a dense deployment announces rarely.*
//! A fade measured on the bench fails in the field — so the regulated floor
//! takes **the longest interval the budget can produce under load** and the
//! type will not accept an idle observation in its place.

use r2_hal_traits::{build_mode::BuildMode, Ticks};
use r2_transport::l1::{Bearer, BearerProfile, Ordinal, RegulatedBearer, SendError, SendTarget};

use crate::duty_and_declaration::{may_place_bearer_in_service, ServiceRefusal};

/// How often this hive beacons on one bearer (6.1, 6.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BeaconSchedule {
    /// **6.1.1: a stated interval**, on a bearer whose medium permits a fixed
    /// cadence.
    ///
    /// 6.1.2's *should* — shorten when moving or expecting to be discovered,
    /// lengthen when stationary or short of energy — is why this carries the
    /// adoptable range beside the current value: **6.1.3 obliges a hive to
    /// declare the range it can adopt**, and a current interval outside its
    /// own declared range is a declaration the hive is already breaking.
    FixedCadence {
        interval_s: u32,
        shortest_s: u32,
        longest_s: u32,
    },
    /// **6.2.3: a regulated bearer is given no interval at all.** The cadence
    /// is whatever the budget leaves.
    BudgetGoverned {
        /// The longest gap the budget can produce **under load** — 6.3.2's
        /// figure, and the one a fade must clear.
        longest_gap_under_load_s: u32,
    },
}

/// Why a schedule cannot be used with a bearer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ScheduleRefusal {
    /// **6.3.4 / D-245:** a receive-only ingress observes beacons but never
    /// originates one. Its B5 value is a local retention period, not a
    /// beacon-fade constraint, so neither kind of schedule applies.
    ReceiveOnlyIngressGivenSchedule,
    /// **6.2.3**: a regulated bearer was given a fixed interval.
    RegulatedBearerGivenAnInterval,
    /// An unregulated bearer was given a budget-governed schedule, which
    /// describes a constraint it does not have.
    UnregulatedBearerGivenABudget,
    /// **6.1.3**: the current interval is outside the range the hive declares
    /// it can adopt. *A hive breaking its own declaration is worse than one
    /// that never made it.*
    IntervalOutsideDeclaredRange { interval_s: u32 },
    /// The declared range is inverted or empty.
    RangeNotUsable { shortest_s: u32, longest_s: u32 },
    /// 6.3.1 / 6.3.2: the bearer's fade does not STRICTLY exceed the longest
    /// gap this schedule can produce. At equality a peer beaconing exactly
    /// on its longest interval recedes in the instant it speaks and flickers
    /// between heard and receded while behaving perfectly.
    FadeDoesNotExceedGap { fade_s: u32, longest_s: u32 },
    /// The longest gap is `u32::MAX`: no fade can exceed it, so the basis is
    /// unrepresentable rather than merely large. Refused by name so a
    /// saturating comparison cannot wrap exceedance into acceptance.
    GapUnrepresentable,
}

impl BeaconSchedule {
    /// Check this schedule against the bearer it is for (6.1.3, 6.2.3).
    pub const fn check(&self, profile: &BearerProfile) -> Result<(), ScheduleRefusal> {
        // Do this before inspecting the medium's regulatory status. A passive
        // LoRa receiver can still report that its medium is regulated, but it
        // cannot transmit a beacon under either cadence model.
        if profile.fade.is_passive() {
            return Err(ScheduleRefusal::ReceiveOnlyIngressGivenSchedule);
        }
        match self {
            BeaconSchedule::FixedCadence {
                interval_s,
                shortest_s,
                longest_s,
            } => {
                if profile.fade.regulated() {
                    return Err(ScheduleRefusal::RegulatedBearerGivenAnInterval);
                }
                if *shortest_s > *longest_s || *longest_s == 0 {
                    return Err(ScheduleRefusal::RangeNotUsable {
                        shortest_s: *shortest_s,
                        longest_s: *longest_s,
                    });
                }
                if *interval_s < *shortest_s || *interval_s > *longest_s {
                    return Err(ScheduleRefusal::IntervalOutsideDeclaredRange {
                        interval_s: *interval_s,
                    });
                }
            }
            BeaconSchedule::BudgetGoverned { .. } => {
                if !profile.fade.regulated() {
                    return Err(ScheduleRefusal::UnregulatedBearerGivenABudget);
                }
            }
        }
        // 6.3.1 and 6.3.2, in the same door: the fade must STRICTLY exceed
        // the longest gap. `u32::MAX` is refused by name — a saturating
        // floor of MAX + 1 would read as exceeded at the type's bound.
        let longest_s = self.longest_expected_s();
        if longest_s == u32::MAX {
            return Err(ScheduleRefusal::GapUnrepresentable);
        }
        let fade_s = profile.fade.seconds();
        if fade_s <= longest_s {
            return Err(ScheduleRefusal::FadeDoesNotExceedGap { fade_s, longest_s });
        }
        Ok(())
    }

    /// **The longest interval at which this bearer's beacons can be
    /// expected** — 6.3.1's phrase, and the figure a fade must exceed.
    pub const fn longest_expected_s(&self) -> u32 {
        match self {
            BeaconSchedule::FixedCadence { longest_s, .. } => *longest_s,
            BeaconSchedule::BudgetGoverned {
                longest_gap_under_load_s,
            } => *longest_gap_under_load_s,
        }
    }
}

/// Why a fixed-cadence schedule cannot enter the reusable emission clock.
///
/// A regulated bearer is deliberately excluded: its cadence is owned by its
/// budget dispatcher (6.2.3), rather than by a wall-clock interval.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FixedScheduleRefusal {
    /// A tick rate of zero makes elapsed-time comparison meaningless.
    ZeroTicksPerSecond,
    /// The profile and schedule fail the one L2 validation door.
    Schedule(ScheduleRefusal),
    /// L2 5.4a.3a refused this output bearer before it could enter service.
    Service(ServiceRefusal),
    /// A budget-governed schedule has no fixed due time to put in this clock.
    BudgetGovernedHasNoFixedDueTime,
    /// One bearer may have exactly one active cadence in one node assembly.
    DuplicateBearer(Ordinal),
    /// The board assembly exceeded the fixed capacity it declared.
    CapacityExhausted,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct FixedScheduleEntry {
    bearer: Ordinal,
    interval_s: u32,
    last_offered: Option<Ticks>,
    /// The prior call found this bearer unable to carry a beacon. A later
    /// return to service is an immediate recovery condition, not a reason to
    /// wait through the interval that elapsed while output was impossible.
    was_out_of_service: bool,
}

/// Bounded, portable cadence state for unregulated discovery bearers.
///
/// This is the connection from L2's declared cadence to a board's real output
/// loop.  It owns neither the bearer nor its clock: assembly supplies a
/// validated L1 profile once, while each loop supplies its L0 monotonic tick.
/// That keeps cadence policy reusable and makes a raw board-local interval
/// unable to bypass the fade check in [`BeaconSchedule::check`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FixedBeaconSchedules<const N: usize> {
    ticks_per_second: u32,
    entries: [Option<FixedScheduleEntry>; N],
}

impl<const N: usize> FixedBeaconSchedules<N> {
    /// Make an empty schedule registry with the L0 monotonic clock's rate.
    pub const fn new(ticks_per_second: u32) -> Result<Self, FixedScheduleRefusal> {
        if ticks_per_second == 0 {
            return Err(FixedScheduleRefusal::ZeroTicksPerSecond);
        }
        Ok(Self {
            ticks_per_second,
            entries: [None; N],
        })
    }

    /// Validate and install one fixed schedule for an output bearer.
    ///
    /// Service admission precedes cadence validation.  A development image
    /// whose binding cannot carry its mandatory build-mode declaration is not
    /// merely forbidden to emit one beacon: L2 5.4a.3a says it cannot enter
    /// service, so it cannot acquire an otherwise-valid output schedule.
    pub fn install(
        &mut self,
        image_mode: BuildMode,
        bearer: &dyn Bearer,
        schedule: BeaconSchedule,
    ) -> Result<(), FixedScheduleRefusal> {
        may_place_bearer_in_service(image_mode, bearer).map_err(FixedScheduleRefusal::Service)?;
        let profile = bearer.profile();
        schedule
            .check(profile)
            .map_err(FixedScheduleRefusal::Schedule)?;
        let BeaconSchedule::FixedCadence { interval_s, .. } = schedule else {
            return Err(FixedScheduleRefusal::BudgetGovernedHasNoFixedDueTime);
        };
        if self
            .entries
            .iter()
            .flatten()
            .any(|entry| entry.bearer == profile.ordinal)
        {
            return Err(FixedScheduleRefusal::DuplicateBearer(profile.ordinal));
        }
        let Some(slot) = self.entries.iter_mut().find(|entry| entry.is_none()) else {
            return Err(FixedScheduleRefusal::CapacityExhausted);
        };
        *slot = Some(FixedScheduleEntry {
            bearer: profile.ordinal,
            interval_s,
            // A just-assembled node is due once, so its first valid beacon is
            // not delayed by an arbitrary full period.
            last_offered: None,
            was_out_of_service: false,
        });
        Ok(())
    }

    /// Take the next due emission slot for `bearer`, recording its cadence.
    ///
    /// The slot is consumed when output is offered to L2's emitter, not when
    /// an underlying radio confirms delivery. Retrying a live bearer refusal
    /// in a tight board loop would itself violate L2's stated interval. An
    /// out-of-service bearer is different: 4.1 Note 3 permits no beacon only
    /// *until it can*, so a transition back into service is immediately due.
    pub fn take_due(&mut self, bearer: Ordinal, now: Ticks, in_service: bool) -> bool {
        let Some(entry) = self
            .entries
            .iter_mut()
            .flatten()
            .find(|entry| entry.bearer == bearer)
        else {
            return false;
        };
        if !in_service {
            entry.was_out_of_service = true;
            return false;
        }
        let due = entry.was_out_of_service
            || match entry.last_offered {
                None => true,
                Some(last) => now.exceeded(last, entry.interval_s, self.ticks_per_second),
            };
        entry.was_out_of_service = false;
        if due {
            entry.last_offered = Some(now);
        };
        due
    }

    /// Reserve a cadence-limited offer to a temporarily unavailable output.
    /// This is an attempt to discover readiness, not a declaration that output
    /// is possible. It shares the normal interval and last-offer clock, while
    /// preserving immediate emission if readiness is learned independently.
    pub fn take_recovery_due(&mut self, bearer: Ordinal, now: Ticks) -> bool {
        let Some(entry) = self
            .entries
            .iter_mut()
            .flatten()
            .find(|entry| entry.bearer == bearer)
        else {
            return false;
        };
        entry.was_out_of_service = true;
        let due = match entry.last_offered {
            None => true,
            Some(last) => now.exceeded(last, entry.interval_s, self.ticks_per_second),
        };
        if due {
            entry.last_offered = Some(now);
        }
        due
    }

    /// The reserved recovery offer was accepted. It already used this cadence
    /// slot; becoming ready must not immediately produce a second beacon.
    /// Acceptance is the L1 offer result, never a delivery acknowledgement.
    pub fn recovery_accepted(&mut self, bearer: Ordinal) {
        if let Some(entry) = self
            .entries
            .iter_mut()
            .flatten()
            .find(|entry| entry.bearer == bearer)
        {
            entry.was_out_of_service = false;
        }
    }
}

/// The one beacon reservation L2 6.2.2a gives each complete budget window.
///
/// The reservation is stated in airtime rather than as a packet count because
/// the legal budget is airtime and the final beacon length is binding-specific.
/// A scheduler resets this value only when its L1 budget rolls to a new window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BeaconReservation {
    beacon_airtime_ms: u32,
    used: bool,
}

impl BeaconReservation {
    /// Reserve enough airtime for one beacon in the current budget window.
    pub const fn new(beacon_airtime_ms: u32) -> Self {
        Self {
            beacon_airtime_ms,
            used: false,
        }
    }

    /// Whether a non-beacon frame may spend `airtime_ms` without consuming the
    /// beacon reservation. Once the beacon has gone, all remaining legal
    /// airtime is available to ordinary traffic.
    pub const fn permits_other_traffic(&self, remaining_airtime_ms: u32, airtime_ms: u32) -> bool {
        if self.used {
            return airtime_ms <= remaining_airtime_ms;
        }
        match airtime_ms.checked_add(self.beacon_airtime_ms) {
            Some(required) => required <= remaining_airtime_ms,
            None => false,
        }
    }

    /// Record the sole beacon that consumes this window's reservation.
    pub fn mark_beacon_emitted(&mut self) {
        self.used = true;
    }

    /// Start a new L1 budget window. A fresh window has exactly one reserved
    /// beacon, never a carried-forward backlog of them.
    pub fn reset_for_new_window(&mut self) {
        self.used = false;
    }

    /// Is the one fairness beacon still available in this window?
    pub const fn available(&self) -> bool {
        !self.used
    }

    /// Whether the reserved beacon itself fits inside the airtime still legal
    /// in this window. A reserve is not an emergency allowance: when ordinary
    /// traffic has already left less than this amount, the beacon must wait for
    /// the next window rather than overrun the budget.
    pub const fn permits_beacon(&self, remaining_airtime_ms: u32) -> bool {
        !self.used && self.beacon_airtime_ms <= remaining_airtime_ms
    }
}

/// **6.2.1, 6.2.2 and 6.2.2a: may a pending beacon be emitted now?**
///
/// A beacon yields to any waiting traffic that fits without consuming the
/// reservation. Once such traffic cannot proceed, the one reserved beacon may
/// proceed; a spent reservation does not become a second priority lane. An
/// exhausted budget still always wins — 6.2.2a reserves airtime *inside* the
/// legal budget and cannot create an emergency override.
pub const fn may_emit_on_regulated(
    budget_exhausted: bool,
    other_traffic_waiting: bool,
    reservation: &BeaconReservation,
    remaining_airtime_ms: u32,
    other_traffic_fits_without_reserve: bool,
) -> bool {
    !budget_exhausted
        && reservation.permits_beacon(remaining_airtime_ms)
        && (!other_traffic_waiting || !other_traffic_fits_without_reserve)
}

/// Why the sole scheduler for a regulated bearer refused an offer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegulatedDispatchRefusal {
    /// The caller has not supplied the current complete beacon for this
    /// window, so there is no binding-inclusive reservation to preserve.
    NotPrimed,
    /// The binding began a new legal window after `begin_window`; its fresh
    /// reservation must be derived before any ordinary traffic may proceed.
    WindowChanged,
    /// This ordinary offer would consume the current window's beacon reserve.
    WouldConsumeBeaconReserve,
    /// The one beacon was already accepted in this window.
    BeaconAlreadyEmitted,
    /// The beacon itself does not fit in remaining legal airtime.
    BeaconDoesNotFit,
    /// The beacon submitted for transmission costs more airtime than the
    /// complete beacon used to establish this window's reservation.
    BeaconQuoteExceedsReservation {
        reserved_airtime_ms: u32,
        offered_airtime_ms: u32,
    },
    /// The separate deployment window needs a freshly quoted reserve.
    DeploymentWindowChanged,
    /// Ordinary traffic would consume the deployment beacon reserve.
    WouldConsumeDeploymentBeaconReserve,
    /// This deployment window has already admitted its beacon.
    DeploymentBeaconAlreadyEmitted,
    /// The beacon cannot fit this deployment's remaining allowance.
    DeploymentBeaconDoesNotFit,
    /// The submitted beacon exceeds the deployment reserve's exact quote.
    DeploymentBeaconQuoteExceedsReservation {
        reserved_airtime_ms: u32,
        offered_airtime_ms: u32,
    },
    /// Layer 1 refused the quote or the eventual submission.
    Send(SendError),
}

/// L2's serial decision-maker for one regulated `(hive, bearer)` port.
///
/// `begin_window` is deliberately explicit: the current complete beacon is
/// the only honest source for its reserve, because binding framing belongs to
/// L1.  Calling `offer_other` before it is a refusal rather than a guessed
/// reservation.  The owner keeps the regulated port private and offers every
/// output through this type; generic bearer loops must exclude it.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct RegulatedDispatcher {
    reservation: Option<BeaconReservation>,
    // An independent implementation restraint, never substituted for law.
    deployment: Option<BeaconReservation>,
}

struct CurrentReservations {
    legal: BeaconReservation,
    legal_remaining: u32,
    deployment: Option<(BeaconReservation, u32)>,
}

impl RegulatedDispatcher {
    /// Whether the current window still has its one beacon offer available.
    ///
    /// The physical serial owner uses this before it leaves receive to offer
    /// a new frame.  Treating `BeaconAlreadyEmitted` as a harmless result
    /// would be wrong there: it would still have abandoned an in-progress
    /// reception merely to learn that no offer was possible.
    pub const fn beacon_available(&self) -> bool {
        matches!(self.reservation, Some(reservation) if reservation.available())
            && !matches!(self.deployment, Some(reservation) if !reservation.available())
    }

    /// Whether the serial owner may interrupt receive to offer the beacon now.
    ///
    /// `admitted_other_waiting` is the binding queue state, not a fresh
    /// application request. A true value therefore means an ordinary frame
    /// already passed [`Self::offer_other`] and is known to preserve this
    /// reservation; it must be selected before a new beacon. The owner never
    /// puts any other producer directly into that queue (L1 9.5).
    pub fn may_offer_beacon(
        &mut self,
        port: &mut dyn RegulatedBearer,
        admitted_other_waiting: bool,
    ) -> Result<bool, RegulatedDispatchRefusal> {
        let current = self.current(port)?;
        let permits = |reservation: &BeaconReservation, remaining| {
            may_emit_on_regulated(
                remaining == 0,
                admitted_other_waiting,
                reservation,
                remaining,
                admitted_other_waiting,
            )
        };
        Ok(permits(&current.legal, current.legal_remaining)
            && current
                .deployment
                .is_none_or(|(reserve, remaining)| permits(&reserve, remaining)))
    }

    /// Derive or refresh the one-beacon reservation for the port's current
    /// legal window, and independently for any self-imposed deployment window.
    /// The deployment policy admits at most one beacon per deployment window;
    /// this is a cap on opportunistic admission, not a fixed beacon timer.
    /// Keep this dispatcher for the retained port's lifetime, including across
    /// coordinator sessions. A new session must not reset allowance/reservations.
    /// A quote has no side effect, so this cannot spend either budget.
    pub fn begin_window(
        &mut self,
        port: &mut dyn RegulatedBearer,
        beacon: &[u8],
    ) -> Result<(), RegulatedDispatchRefusal> {
        let quote = port
            .quote_airtime(SendTarget::Broadcast, beacon)
            .map_err(RegulatedDispatchRefusal::Send)?;
        let window = port.regulated_window();
        if window.new_window || self.reservation.is_none() {
            self.reservation = Some(BeaconReservation::new(quote));
        } else if self
            .reservation
            .is_some_and(|reservation| reservation.beacon_airtime_ms != quote)
        {
            // The complete beacon changed within one legal window.  Retaining
            // an old quote could under-reserve, so refuse until the next window
            // rather than pretend the earlier reservation describes this frame.
            return Err(RegulatedDispatchRefusal::WindowChanged);
        }
        match port.deployment_window() {
            None => self.deployment = None,
            Some(window) if window.new_window || self.deployment.is_none() => {
                self.deployment = Some(BeaconReservation::new(quote));
            }
            Some(_)
                if self
                    .deployment
                    .is_some_and(|r| r.beacon_airtime_ms != quote) =>
            {
                return Err(RegulatedDispatchRefusal::DeploymentWindowChanged);
            }
            Some(_) => {}
        }
        Ok(())
    }

    fn current(
        &mut self,
        port: &mut dyn RegulatedBearer,
    ) -> Result<CurrentReservations, RegulatedDispatchRefusal> {
        let window = port.regulated_window();
        if window.new_window {
            self.reservation = None;
            return Err(RegulatedDispatchRefusal::WindowChanged);
        }
        let legal = self
            .reservation
            .ok_or(RegulatedDispatchRefusal::NotPrimed)?;
        let deployment = match port.deployment_window() {
            None => None,
            Some(window) if window.new_window => {
                self.deployment = None;
                return Err(RegulatedDispatchRefusal::DeploymentWindowChanged);
            }
            Some(window) => Some((
                self.deployment.ok_or(RegulatedDispatchRefusal::NotPrimed)?,
                window.remaining_airtime_ms,
            )),
        };
        Ok(CurrentReservations {
            legal,
            legal_remaining: window.remaining_airtime_ms,
            deployment,
        })
    }

    /// Offer ordinary traffic without spending the beacon reserve.
    pub fn offer_other(
        &mut self,
        port: &mut dyn RegulatedBearer,
        target: SendTarget,
        frame: &[u8],
    ) -> Result<(), RegulatedDispatchRefusal> {
        let current = self.current(port)?;
        let quote = port
            .quote_airtime(target, frame)
            .map_err(RegulatedDispatchRefusal::Send)?;
        if !current
            .legal
            .permits_other_traffic(current.legal_remaining, quote)
        {
            return Err(RegulatedDispatchRefusal::WouldConsumeBeaconReserve);
        }
        if current
            .deployment
            .is_some_and(|(reserve, remaining)| !reserve.permits_other_traffic(remaining, quote))
        {
            return Err(RegulatedDispatchRefusal::WouldConsumeDeploymentBeaconReserve);
        }
        port.send(target, frame)
            .map_err(RegulatedDispatchRefusal::Send)
    }

    /// Offer the current window's one fairness beacon.
    pub fn offer_beacon(
        &mut self,
        port: &mut dyn RegulatedBearer,
        beacon: &[u8],
    ) -> Result<(), RegulatedDispatchRefusal> {
        let current = self.current(port)?;
        let reservation = current.legal;
        let remaining = current.legal_remaining;
        if !reservation.available() {
            return Err(RegulatedDispatchRefusal::BeaconAlreadyEmitted);
        }
        // The reservation belongs to the complete frame supplied to
        // `begin_window`, not to a beacon-shaped request in general. Re-quote
        // the bytes about to enter L1: otherwise ordinary traffic can preserve
        // a one-millisecond reserve and a later five-millisecond beacon can
        // consume it. A smaller replacement remains safe because the stored
        // reservation is conservative; a larger one must wait for a window
        // whose reservation was derived from it.
        let offered_airtime_ms = port
            .quote_airtime(SendTarget::Broadcast, beacon)
            .map_err(RegulatedDispatchRefusal::Send)?;
        if offered_airtime_ms > reservation.beacon_airtime_ms {
            return Err(RegulatedDispatchRefusal::BeaconQuoteExceedsReservation {
                reserved_airtime_ms: reservation.beacon_airtime_ms,
                offered_airtime_ms,
            });
        }
        if !reservation.permits_beacon(remaining) {
            return Err(RegulatedDispatchRefusal::BeaconDoesNotFit);
        }
        if let Some((reserve, remaining)) = current.deployment {
            if !reserve.available() {
                return Err(RegulatedDispatchRefusal::DeploymentBeaconAlreadyEmitted);
            }
            if offered_airtime_ms > reserve.beacon_airtime_ms {
                return Err(
                    RegulatedDispatchRefusal::DeploymentBeaconQuoteExceedsReservation {
                        reserved_airtime_ms: reserve.beacon_airtime_ms,
                        offered_airtime_ms,
                    },
                );
            }
            if !reserve.permits_beacon(remaining) {
                return Err(RegulatedDispatchRefusal::DeploymentBeaconDoesNotFit);
            }
        }
        port.send(SendTarget::Broadcast, beacon)
            .map_err(RegulatedDispatchRefusal::Send)?;
        if let Some(reserve) = self.deployment.as_mut() {
            reserve.mark_beacon_emitted();
        }
        self.reservation = Some(BeaconReservation {
            beacon_airtime_ms: reservation.beacon_airtime_ms,
            used: true,
        });
        Ok(())
    }
}

/// **6.3.3: one bearer's fade behaviour is never applied to another.**
///
/// ‼ **STATED BECAUSE THE OBVIOUS SIMPLIFICATION IS WRONG IN BOTH DIRECTIONS
/// AT ONCE**, which Note 2 spells out: *applied to a slow bearer, a fast
/// bearer's impatience declares working peers gone every few minutes; applied
/// to a fast bearer, a slow bearer's patience keeps peers in the table long
/// after they have left. The first costs re-discovery, the second costs
/// frames sent into empty air.*
///
/// The rule is made structural elsewhere — `SightingTable::purge_expired`
/// asks for the typed lifetime **per bearer** through a closure keyed by
/// `Ordinal` — so this function exists to let a caller **assert** the property
/// rather than to enforce it, and returns whether two bearers' fades may be
/// shared.
pub const fn fade_may_be_shared() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2_ident::HiveId;
    use r2_transport::fade_rate::{FadeRate, FadeSource};
    use r2_transport::l1::{
        Bearer, BearerState, BuildModeDeclarationCarriage, Fade, LinkQuality, Ordinal, Reach,
        RegulatedWindow, RxMeta,
    };

    #[test]
    fn routing_output_cannot_bypass_the_beacon_reserve_or_window_priming() {
        use crate::regulated_output::OrdinaryOutput;
        let mut port = TestRegulatedPort::new(100);
        let mut dispatcher = RegulatedDispatcher::default();
        assert_eq!(
            OrdinaryOutput::new(&mut port, &mut dispatcher).send(SendTarget::Broadcast, &[0; 1]),
            Err(SendError::Unavailable)
        );
        assert_eq!(port.sent, 0);
        dispatcher.begin_window(&mut port, &[0; 30]).unwrap();
        assert_eq!(
            OrdinaryOutput::new(&mut port, &mut dispatcher).send(SendTarget::Broadcast, &[0; 71]),
            Err(SendError::Unavailable)
        );
        assert_eq!(port.remaining, 100);
        let target = SendTarget::Hive(HiveId([0x61; 8]));
        OrdinaryOutput::new(&mut port, &mut dispatcher)
            .send(target, &[0; 70])
            .unwrap();
        assert_eq!(port.last_target, Some(target));
        assert_eq!(port.remaining, 30);
        dispatcher.offer_beacon(&mut port, &[0; 30]).unwrap();
        assert_eq!(port.remaining, 0);
        assert_eq!(port.sent, 2);
    }

    struct TestRegulatedPort {
        profile: BearerProfile,
        remaining: u32,
        fresh: bool,
        sent: u32,
        last_target: Option<SendTarget>,
    }

    struct TestFixedBearer {
        profile: BearerProfile,
        carriage: BuildModeDeclarationCarriage,
    }

    impl TestFixedBearer {
        fn carrying(profile: BearerProfile) -> Self {
            Self {
                profile,
                carriage: BuildModeDeclarationCarriage::Carries,
            }
        }

        fn not_carrying(profile: BearerProfile) -> Self {
            Self {
                profile,
                carriage: BuildModeDeclarationCarriage::CannotCarry,
            }
        }
    }

    impl Bearer for TestFixedBearer {
        fn profile(&self) -> &BearerProfile {
            &self.profile
        }
        fn state(&self) -> BearerState {
            BearerState::Available
        }
        fn max_payload(&self) -> u16 {
            250
        }
        fn build_mode_declaration_carriage(&self) -> BuildModeDeclarationCarriage {
            self.carriage
        }
        fn send(&mut self, _target: SendTarget, _frame: &[u8]) -> Result<(), SendError> {
            Ok(())
        }
        fn poll_recv(
            &mut self,
            _buf: &mut [u8],
        ) -> Option<Result<(usize, RxMeta), r2_transport::l1::ReceiveError>> {
            None
        }
        fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
            None
        }
        fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            None
        }
    }

    impl TestRegulatedPort {
        fn new(remaining: u32) -> Self {
            Self {
                profile: profile(Ordinal::Lora, true),
                remaining,
                fresh: true,
                sent: 0,
                last_target: None,
            }
        }
    }

    impl Bearer for TestRegulatedPort {
        fn profile(&self) -> &BearerProfile {
            &self.profile
        }
        fn state(&self) -> BearerState {
            BearerState::Available
        }
        fn max_payload(&self) -> u16 {
            250
        }
        fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
            let cost = frame.len() as u32;
            if cost > self.remaining {
                return Err(SendError::Unavailable);
            }
            self.remaining -= cost;
            self.sent += 1;
            self.last_target = Some(target);
            Ok(())
        }
        fn poll_recv(
            &mut self,
            _buf: &mut [u8],
        ) -> Option<Result<(usize, RxMeta), r2_transport::l1::ReceiveError>> {
            None
        }
        fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
            None
        }
        fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            None
        }
    }

    impl RegulatedBearer for TestRegulatedPort {
        fn regulated_window(&mut self) -> RegulatedWindow {
            RegulatedWindow {
                new_window: core::mem::replace(&mut self.fresh, false),
                remaining_airtime_ms: self.remaining,
            }
        }
        fn quote_airtime(&self, _target: SendTarget, frame: &[u8]) -> Result<u32, SendError> {
            Ok(frame.len() as u32)
        }
    }

    fn profile_with(ordinal: Ordinal, fade: Fade) -> BearerProfile {
        BearerProfile {
            ordinal,
            max_payload: 0..=250,
            wire_tier: r2_transport::l1::WireTier::Compact,
            fade,
            relative_cost: 1,
            reach: Reach::Local,
            receptivity: r2_transport::l1::Receptivity::Continuous,
            participates_in_discovery: true,
            connection: None,
        }
    }

    fn profile(ordinal: Ordinal, regulated: bool) -> BearerProfile {
        profile_fading(ordinal, regulated, 60)
    }

    fn profile_fading(ordinal: Ordinal, regulated: bool, seconds: u32) -> BearerProfile {
        let fade = if regulated {
            // A regulated fade exists only by derivation (BND3 6a.5).
            Fade::Regulated(
                FadeRate::derive(
                    seconds,
                    FadeSource::BudgetUnderLoad {
                        longest_interval_s: 30.min(seconds.saturating_sub(1)),
                    },
                )
                .expect("the fade exceeds its basis"),
            )
        } else {
            Fade::Unregulated { seconds }
        };
        profile_with(ordinal, fade)
    }

    /// ‼ **6.2.3: A REGULATED BEARER CANNOT BE GIVEN A FIXED INTERVAL, AND
    /// THAT IS A REQUIREMENT RATHER THAN AN OMISSION.** *On a regulated
    /// bearer the cadence is an outcome, not a setting* — a fixed interval
    /// would be **a promise the bearer breaks whenever the network is under
    /// load, which is precisely when a scanner is most likely to be relying
    /// on it.**
    #[test]
    fn a_regulated_bearer_is_never_given_a_fixed_interval() {
        let fixed = BeaconSchedule::FixedCadence {
            interval_s: 30,
            shortest_s: 10,
            longest_s: 60,
        };
        assert_eq!(
            fixed.check(&profile(Ordinal::Lora, true)),
            Err(ScheduleRefusal::RegulatedBearerGivenAnInterval)
        );
        // And the same schedule is fine on an unregulated bearer, so the
        // refusal is about the bearer rather than the schedule.
        assert_eq!(
            fixed.check(&profile_fading(Ordinal::Udp, false, 61)),
            Ok(())
        );

        // The converse: a budget schedule describes a constraint an
        // unregulated bearer does not have.
        let budget = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: 30,
        };
        assert_eq!(budget.check(&profile(Ordinal::Lora, true)), Ok(()));
        assert_eq!(
            budget.check(&profile(Ordinal::Udp, false)),
            Err(ScheduleRefusal::UnregulatedBearerGivenABudget)
        );
    }

    /// **6.3.4:** passive ingress retention is not a beacon fade.  Testing
    /// both schedule forms prevents a future medium-status check from making
    /// a receive-only regulated LoRa receiver look schedulable again.
    #[test]
    fn a_receive_only_ingress_is_never_given_a_beacon_schedule() {
        let passive = profile_with(
            Ordinal::Lora,
            Fade::Passive {
                observation_retention_s: 31,
                regulated: true,
            },
        );
        let fixed = BeaconSchedule::FixedCadence {
            interval_s: 30,
            shortest_s: 10,
            longest_s: 30,
        };
        let budget = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: 30,
        };
        assert_eq!(
            fixed.check(&passive),
            Err(ScheduleRefusal::ReceiveOnlyIngressGivenSchedule)
        );
        assert_eq!(
            budget.check(&passive),
            Err(ScheduleRefusal::ReceiveOnlyIngressGivenSchedule)
        );
    }

    /// **6.1.3: a hive declares the range it can adopt**, and an interval
    /// outside it is *a declaration the hive is already breaking.*
    #[test]
    fn an_interval_outside_the_declared_range_is_refused() {
        let p = profile_fading(Ordinal::Udp, false, 61);
        for bad in [9u32, 61] {
            assert_eq!(
                BeaconSchedule::FixedCadence {
                    interval_s: bad,
                    shortest_s: 10,
                    longest_s: 60,
                }
                .check(&p),
                Err(ScheduleRefusal::IntervalOutsideDeclaredRange { interval_s: bad })
            );
        }
        // Both boundaries are inside, so the check is not simply refusing.
        for ok in [10u32, 60] {
            assert_eq!(
                BeaconSchedule::FixedCadence {
                    interval_s: ok,
                    shortest_s: 10,
                    longest_s: 60,
                }
                .check(&p),
                Ok(())
            );
        }
        // An inverted range is refused before the interval is judged against
        // it, because judging against nonsense produces a nonsense verdict.
        assert_eq!(
            BeaconSchedule::FixedCadence {
                interval_s: 30,
                shortest_s: 60,
                longest_s: 10,
            }
            .check(&p),
            Err(ScheduleRefusal::RangeNotUsable {
                shortest_s: 60,
                longest_s: 10
            })
        );
    }

    /// The board-facing scheduler takes its authority from a checked L1
    /// profile, then consumes one slot per stated cadence rather than once per
    /// loop iteration.  The exact-boundary negative matters because `Ticks`
    /// deliberately means *exceeded*, not *equal*.
    #[test]
    fn fixed_schedule_clock_validates_the_profile_and_never_collapses_to_a_loop() {
        let profile = profile_fading(Ordinal::WifiMesh, false, 31);
        let bearer = TestFixedBearer::carrying(profile);
        let schedule = BeaconSchedule::FixedCadence {
            interval_s: 30,
            shortest_s: 10,
            longest_s: 30,
        };
        let mut clock = FixedBeaconSchedules::<1>::new(1_000).expect("non-zero tick rate");
        clock
            .install(BuildMode::Development, &bearer, schedule)
            .expect("fade clears cadence");

        assert!(
            clock.take_due(Ordinal::WifiMesh, Ticks(0), true),
            "first beacon is due"
        );
        assert!(
            !clock.take_due(Ordinal::WifiMesh, Ticks(30_000), true),
            "equality has not exceeded the stated interval"
        );
        assert!(clock.take_due(Ordinal::WifiMesh, Ticks(30_001), true));
        assert!(
            !clock.take_due(Ordinal::WifiMesh, Ticks(30_002), true),
            "a tight loop cannot turn one accepted slot into many beacons"
        );

        let mut invalid = FixedBeaconSchedules::<1>::new(1).unwrap();
        assert_eq!(
            invalid.install(
                BuildMode::Development,
                &TestFixedBearer::carrying(profile_fading(Ordinal::Udp, false, 30)),
                BeaconSchedule::FixedCadence {
                    interval_s: 30,
                    shortest_s: 30,
                    longest_s: 30,
                },
            ),
            Err(FixedScheduleRefusal::Schedule(
                ScheduleRefusal::FadeDoesNotExceedGap {
                    fade_s: 30,
                    longest_s: 30,
                }
            )),
            "a raw board interval cannot enter this clock without the L2 fade check"
        );
    }

    /// 5.4a.3a is a service admission guard, not merely an output-time
    /// condition: a development (or unknown) image cannot acquire a beacon
    /// schedule for a binding whose own contract says it cannot declare.
    #[test]
    fn a_non_declaring_bearer_cannot_enter_a_development_schedule() {
        let profile = profile_fading(Ordinal::Udp, false, 31);
        let bearer = TestFixedBearer::not_carrying(profile);
        let schedule = BeaconSchedule::FixedCadence {
            interval_s: 30,
            shortest_s: 30,
            longest_s: 30,
        };
        let mut clock = FixedBeaconSchedules::<1>::new(1_000).unwrap();
        assert_eq!(
            clock.install(BuildMode::Development, &bearer, schedule),
            Err(FixedScheduleRefusal::Service(
                ServiceRefusal::DevelopmentOnABearerThatCannotDeclareIt {
                    bearer: Ordinal::Udp,
                }
            ))
        );
        assert_eq!(
            clock.install(BuildMode::Production, &bearer, schedule),
            Ok(()),
            "production is silent by rule, not a development bearer that passed"
        );
    }

    /// ‼ **6.3.1 IS STRICT, AND EQUALITY IS THE INTERESTING CASE.** A peer
    /// beaconing exactly on its longest interval recedes in the same instant
    /// it speaks — *flickering between heard and receded while behaving
    /// perfectly.*
    #[test]
    fn the_fade_must_strictly_exceed_the_longest_expected_interval() {
        let s = BeaconSchedule::FixedCadence {
            interval_s: 30,
            shortest_s: 10,
            longest_s: 60,
        };
        assert_eq!(s.longest_expected_s(), 60, "the LONGEST, not the current");
        assert_eq!(
            s.check(&profile_fading(Ordinal::Udp, false, 60)),
            Err(ScheduleRefusal::FadeDoesNotExceedGap {
                fade_s: 60,
                longest_s: 60
            }),
            "equality flickers"
        );
        assert_eq!(s.check(&profile_fading(Ordinal::Udp, false, 61)), Ok(()));
        assert_eq!(s.check(&profile_fading(Ordinal::Udp, false, 600)), Ok(()));
    }

    /// The exact case `check` accepted until 2026-08-25: a fade of 60 s,
    /// derived against a 30 s basis, on a schedule whose gap under load is
    /// 900 s (r2-codex-refute). One door now refuses it.
    #[test]
    fn a_regulated_bearers_fade_is_set_against_the_gap_under_load() {
        let s = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: 900,
        };
        assert_eq!(s.longest_expected_s(), 900);
        assert_eq!(
            s.check(&profile(Ordinal::Lora, true)),
            Err(ScheduleRefusal::FadeDoesNotExceedGap {
                fade_s: 60,
                longest_s: 900
            }),
            "a fade derived from an idle observation is refused"
        );
        assert_eq!(s.check(&profile_fading(Ordinal::Lora, true, 901)), Ok(()));
    }

    /// 6.3.1–6.3.2 say EXCEED. A saturating floor made a gap of `u32::MAX`
    /// read as exceeded by a fade of `u32::MAX` (r2-codex-refute); the basis
    /// is refused by name, and equality at the bound is refused too.
    #[test]
    fn a_gap_at_the_type_bound_is_unrepresentable_rather_than_exceeded() {
        let s = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: u32::MAX,
        };
        assert_eq!(
            s.check(&profile_fading(Ordinal::Lora, true, u32::MAX)),
            Err(ScheduleRefusal::GapUnrepresentable)
        );
        let below = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: u32::MAX - 1,
        };
        assert_eq!(
            below.check(&profile_fading(Ordinal::Lora, true, u32::MAX - 1)),
            Err(ScheduleRefusal::FadeDoesNotExceedGap {
                fade_s: u32::MAX - 1,
                longest_s: u32::MAX - 1
            })
        );
        assert_eq!(
            below.check(&profile_fading(Ordinal::Lora, true, u32::MAX)),
            Ok(())
        );
    }

    /// **6.2.1–6.2.2a:** every ordinary frame that fits without using the
    /// reservation goes first; the one reserved beacon bounds continuous
    /// backlog without exceeding the legal budget.
    #[test]
    fn a_beacon_reservation_bounds_backlog_without_becoming_priority_traffic() {
        let mut reservation = BeaconReservation::new(30);

        assert!(reservation.permits_other_traffic(100, 70));
        assert!(!reservation.permits_other_traffic(100, 71));
        assert!(
            !may_emit_on_regulated(false, true, &reservation, 100, true),
            "traffic that leaves the reservation intact goes first"
        );
        assert!(
            may_emit_on_regulated(false, true, &reservation, 100, false),
            "the one reserved beacon prevents continuous traffic starving discovery"
        );
        assert!(
            !may_emit_on_regulated(true, true, &reservation, 100, false),
            "the reservation cannot exceed the legal budget"
        );

        reservation.mark_beacon_emitted();
        assert!(!reservation.available());
        assert!(reservation.permits_other_traffic(70, 70));
        assert!(
            !may_emit_on_regulated(false, true, &reservation, 70, false),
            "one budget window cannot grow a second beacon priority lane"
        );

        reservation.reset_for_new_window();
        assert!(
            reservation.available(),
            "one fresh window restores one reservation"
        );
        assert!(
            !may_emit_on_regulated(false, true, &reservation, 10, false),
            "the reserve never permits a beacon beyond the remaining legal airtime"
        );
    }

    /// The scheduler, rather than a policy helper, is the test that matters:
    /// direct submissions reduce the fake port's remaining airtime, so this
    /// proves an ordinary offer that would steal the beacon's 30 ms cannot
    /// reach `send` at all.  The controls show that an exactly preserving
    /// offer and then the one beacon do reach it.
    #[test]
    fn the_serial_dispatcher_preserves_one_binding_quoted_beacon_reserve() {
        let mut port = TestRegulatedPort::new(100);
        let mut dispatcher = RegulatedDispatcher::default();
        let beacon = [0u8; 30];
        dispatcher
            .begin_window(&mut port, &beacon)
            .expect("the full beacon derives the reserve before any other offer");

        assert_eq!(
            dispatcher.offer_other(&mut port, SendTarget::Broadcast, &[0; 71]),
            Err(RegulatedDispatchRefusal::WouldConsumeBeaconReserve)
        );
        assert_eq!(
            port.remaining, 100,
            "a refused offer spent no legal airtime"
        );

        assert!(
            dispatcher.beacon_available(),
            "the serial owner may leave receive only while a fresh offer exists"
        );
        assert!(
            dispatcher
                .may_offer_beacon(&mut port, false)
                .expect("a primed port has an observable scheduling decision"),
            "with no admitted ordinary frame waiting, the reservation permits its beacon"
        );

        let named = SendTarget::Hive(HiveId([0x61; 8]));
        dispatcher
            .offer_other(&mut port, named, &[0; 70])
            .expect("a named offer that leaves the reservation intact goes first");
        assert_eq!(port.remaining, 30);
        assert_eq!(
            port.last_target,
            Some(named),
            "the scheduler preserves an addressed offer rather than widening it to broadcast"
        );
        assert!(
            !dispatcher
                .may_offer_beacon(&mut port, true)
                .expect("the already-admitted ordinary frame is part of the owner state"),
            "a queued ordinary offer that preserved the beacon reserve goes first"
        );
        dispatcher
            .offer_beacon(&mut port, &beacon)
            .expect("the one reservation is usable without exceeding the budget");
        assert_eq!(port.remaining, 0);
        assert_eq!(port.sent, 2);
        assert!(
            !dispatcher.beacon_available(),
            "a second physical RX interruption must not be attempted in this window"
        );
        assert_eq!(
            dispatcher.offer_beacon(&mut port, &beacon),
            Err(RegulatedDispatchRefusal::BeaconAlreadyEmitted)
        );
    }

    /// The reservation is a quote for the beacon that will actually reach
    /// Layer 1. A later, larger byte slice used to pass the stored one-byte
    /// reservation after five milliseconds of ordinary traffic had been
    /// admitted; the fake port would accept it exactly because the budget
    /// itself cannot know which bytes established the L2 reserve.
    #[test]
    fn a_larger_submitted_beacon_cannot_spend_an_under_sized_reservation() {
        let mut port = TestRegulatedPort::new(10);
        let mut dispatcher = RegulatedDispatcher::default();
        let reserved = [0u8; 1];
        let larger = [0u8; 5];
        dispatcher.begin_window(&mut port, &reserved).unwrap();
        dispatcher
            .offer_other(&mut port, SendTarget::Broadcast, &[0u8; 5])
            .expect("five milliseconds preserves the one-millisecond reservation");
        assert_eq!(port.remaining, 5);

        assert_eq!(
            dispatcher.offer_beacon(&mut port, &larger),
            Err(RegulatedDispatchRefusal::BeaconQuoteExceedsReservation {
                reserved_airtime_ms: 1,
                offered_airtime_ms: 5,
            }),
            "a larger submitted beacon cannot consume the reserve ordinary traffic preserved"
        );
        assert_eq!(port.remaining, 5, "the refused beacon never reaches L1");
        assert_eq!(port.sent, 1, "only the ordinary offer was accepted");

        dispatcher
            .offer_beacon(&mut port, &reserved)
            .expect("the actual reserved beacon remains admissible");
        assert_eq!(
            port.remaining, 4,
            "the control charges only its quoted airtime"
        );
    }

    /// A fresh legal window is an edge.  `offer_other` refuses it until the
    /// owner supplies the current complete beacon and derives exactly one new
    /// reservation; otherwise the previous window's spent reservation could
    /// be silently carried or reset twice.
    #[test]
    fn a_new_window_must_be_primed_before_any_ordinary_offer() {
        let mut port = TestRegulatedPort::new(100);
        let mut dispatcher = RegulatedDispatcher::default();
        let beacon = [0u8; 30];
        dispatcher.begin_window(&mut port, &beacon).unwrap();
        port.remaining = 100;
        port.fresh = true;
        assert_eq!(
            dispatcher.offer_other(&mut port, SendTarget::Broadcast, &[0; 1]),
            Err(RegulatedDispatchRefusal::WindowChanged)
        );
        dispatcher.begin_window(&mut port, &beacon).unwrap();
        dispatcher
            .offer_other(&mut port, SendTarget::Broadcast, &[0; 70])
            .unwrap();
    }

    /// **6.3.3**, asserted rather than enforced here — the enforcement is
    /// structural, in `SightingTable::purge_expired`, which asks for the
    /// typed lifetime per bearer. *The obvious simplification is wrong in both
    /// directions at once.*
    #[test]
    fn one_bearers_fade_is_never_another_bearers() {
        assert!(!fade_may_be_shared());

        // The two schedules below are exactly Note 2's pair: a fast bearer's
        // impatience would declare the slow bearer's peers gone, and the slow
        // bearer's patience would keep the fast bearer's peers long after
        // they left.
        let fast = BeaconSchedule::FixedCadence {
            interval_s: 5,
            shortest_s: 5,
            longest_s: 10,
        };
        let slow = BeaconSchedule::BudgetGoverned {
            longest_gap_under_load_s: 900,
        };
        assert!(
            slow.check(&profile_fading(Ordinal::Lora, true, 11))
                .is_err(),
            "the fast bearer's fade declares working peers on the slow bearer gone"
        );
        assert_eq!(
            fast.check(&profile_fading(Ordinal::Udp, false, 901)),
            Ok(()),
            "and the slow one's keeps the fast bearer's peers long after they left"
        );
    }
}
