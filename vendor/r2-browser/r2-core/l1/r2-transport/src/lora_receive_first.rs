//! **Receive-first ownership for a direct half-duplex LoRa radio (BND3
//! 2a.2–2a.3).**
//!
//! This is deliberately a small, portable state machine rather than an async
//! driver.  The board-specific owner supplies the timer, CAD and radio calls;
//! this module supplies the ordering those calls must preserve.  In
//! particular, a deferred transmission has the radio back in receive, and an
//! arrived frame is delivered before the owner is allowed to start its next
//! CAD.  The owner therefore never cancels a live receive future merely to
//! service a timer.

/// The physical radio operation that the single LoRa owner must next perform.
///
/// `DeliverReceived` means the receive bytes and their metadata have already
/// been copied by the owner; it must feed the normal receive path before it
/// acknowledges [`Event::DeliveryHandled`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    /// Place the radio in continuous receive.
    ArmReceive,
    /// Deliver the copied receive result to Layers 2–4.
    DeliverReceived,
    /// Run one modulation-aware channel-activity detection.
    BeginCad,
    /// Put the selected queued frame on air.
    BeginTransmit,
    /// The bounded access attempt failed; report the bearer unavailable.
    ReportUnavailable,
}

/// One transition can require two ordered effects without allocation.
///
/// The only two-effect transition is an unavailable CAD result: the radio is
/// made receptive before the state is reported upward.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Actions {
    first: Option<Action>,
    second: Option<Action>,
}

impl Actions {
    const NONE: Self = Self {
        first: None,
        second: None,
    };

    const fn one(action: Action) -> Self {
        Self {
            first: Some(action),
            second: None,
        }
    }

    const fn two(first: Action, second: Action) -> Self {
        Self {
            first: Some(first),
            second: Some(second),
        }
    }

    /// The first required effect, if any.
    pub const fn first(self) -> Option<Action> {
        self.first
    }

    /// The required effect after [`Self::first`], if any.
    pub const fn second(self) -> Option<Action> {
        self.second
    }
}

/// An input the physical radio owner has observed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Event {
    /// The bounded outbound queue has a selected head, so begin its attempt.
    StartTransmitAttempt,
    /// L2 refused the selected offer after the owner had quiesced receive.
    /// No frame reached L1's queue, so return to receive without pretending
    /// this was a CAD result or a radio fault.
    AdmissionRefused,
    /// Receive completed and its result has been copied while the radio was
    /// still owned by the receive path.
    RxComplete,
    /// The normal receive pipeline has processed the copied arrival.
    DeliveryHandled,
    /// CAD found no configured-modulation preamble or transmission.
    CadIdle,
    /// CAD found activity; the owner has scheduled its random deferral timer.
    CadBusy,
    /// The scheduled deferral deadline elapsed.
    DeferralElapsed,
    /// The single frame transmission completed.
    TxComplete,
    /// The selected offer expired before the radio's TX operation was started.
    /// Restore receive without reporting a frame transmitted or a radio fault.
    TxAbandoned,
    /// The contention limit was reached rather than yielding another delay.
    CadUnavailable,
    /// A received duplicate caused Layer 3 to abandon the selected relay.
    CancelPending,
    /// A later, explicit retry selects the still-queued head after an
    /// unavailable access attempt.
    RetryPending,
    /// A radio operation failed.
    Fault,
}

/// A misuse or stale completion that cannot advance the owner state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Refusal {
    /// The event does not belong to the current physical operation.
    Unexpected { phase: Phase, event: Event },
    /// The caller tried to begin a second attempt while the first is pending.
    AttemptAlreadyPending,
}

/// Observable state, useful for a board's truthful L1 state report.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    /// The direct profile is receptive.
    Receiving,
    /// A short CAD exception is in progress.
    Cad,
    /// A randomized deferral timer is pending while the radio receives.
    Deferred,
    /// An arrival is being given to the upper receive path.
    Delivering,
    /// A transmit action is outstanding; its completion or confirmed pre-air
    /// abandonment must restore receive before another attempt.
    Transmitting,
    /// The owner has seen a physical failure and may not invent recovery.
    Failed,
}

/// The non-cancellable, single-owner direct-LoRa state machine.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ReceiveFirst {
    phase: Phase,
    pending: bool,
    resume_deferred: bool,
}

impl ReceiveFirst {
    /// Start the owner in receive before accepting an outbound attempt.
    pub const fn new() -> (Self, Actions) {
        (
            Self {
                phase: Phase::Receiving,
                pending: false,
                resume_deferred: false,
            },
            Actions::one(Action::ArmReceive),
        )
    }

    /// Current physical phase.
    pub const fn phase(&self) -> Phase {
        self.phase
    }

    /// Advance after a completed physical operation.
    ///
    /// A rejected event leaves this state unchanged.  In particular a timer
    /// that fires while an arrival is being delivered cannot start CAD ahead
    /// of that arrival.
    pub fn on(&mut self, event: Event) -> Result<Actions, Refusal> {
        match event {
            Event::Fault => {
                self.phase = Phase::Failed;
                self.pending = false;
                Ok(Actions::one(Action::ReportUnavailable))
            }
            Event::StartTransmitAttempt | Event::RetryPending => self.start_attempt(event),
            Event::AdmissionRefused => self.admission_refused(),
            Event::RxComplete => self.rx_complete(),
            Event::DeliveryHandled => self.delivery_handled(),
            Event::CadIdle => self.cad_idle(),
            Event::CadBusy => self.cad_busy(),
            Event::DeferralElapsed => self.deferral_elapsed(),
            Event::TxComplete | Event::TxAbandoned => self.finish_transmit(event),
            Event::CadUnavailable => self.cad_unavailable(),
            Event::CancelPending => self.cancel_pending(),
        }
    }

    fn start_attempt(&mut self, event: Event) -> Result<Actions, Refusal> {
        if self.phase != Phase::Receiving {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event,
            });
        }
        if self.pending {
            return Err(Refusal::AttemptAlreadyPending);
        }
        self.pending = true;
        self.phase = Phase::Cad;
        Ok(Actions::one(Action::BeginCad))
    }

    fn rx_complete(&mut self) -> Result<Actions, Refusal> {
        if !matches!(self.phase, Phase::Receiving | Phase::Deferred) {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::RxComplete,
            });
        }
        self.resume_deferred = self.phase == Phase::Deferred;
        self.phase = Phase::Delivering;
        Ok(Actions::one(Action::DeliverReceived))
    }

    fn admission_refused(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Cad || !self.pending {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::AdmissionRefused,
            });
        }
        self.pending = false;
        self.phase = Phase::Receiving;
        Ok(Actions::one(Action::ArmReceive))
    }

    fn delivery_handled(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Delivering {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::DeliveryHandled,
            });
        }
        self.phase = if self.resume_deferred {
            Phase::Deferred
        } else {
            Phase::Receiving
        };
        self.resume_deferred = false;
        Ok(Actions::one(Action::ArmReceive))
    }

    fn cad_idle(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Cad {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::CadIdle,
            });
        }
        self.phase = Phase::Transmitting;
        Ok(Actions::one(Action::BeginTransmit))
    }

    fn cad_busy(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Cad {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::CadBusy,
            });
        }
        self.phase = Phase::Deferred;
        Ok(Actions::one(Action::ArmReceive))
    }

    fn deferral_elapsed(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Deferred {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::DeferralElapsed,
            });
        }
        self.phase = Phase::Cad;
        Ok(Actions::one(Action::BeginCad))
    }

    fn finish_transmit(&mut self, event: Event) -> Result<Actions, Refusal> {
        if self.phase != Phase::Transmitting {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event,
            });
        }
        self.pending = false;
        self.phase = Phase::Receiving;
        Ok(Actions::one(Action::ArmReceive))
    }

    fn cad_unavailable(&mut self) -> Result<Actions, Refusal> {
        if self.phase != Phase::Cad {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::CadUnavailable,
            });
        }
        // The queue retains its head; a caller must choose a later retry.
        self.pending = false;
        self.phase = Phase::Receiving;
        Ok(Actions::two(Action::ArmReceive, Action::ReportUnavailable))
    }

    fn cancel_pending(&mut self) -> Result<Actions, Refusal> {
        if !self.pending || !matches!(self.phase, Phase::Receiving | Phase::Deferred) {
            return Err(Refusal::Unexpected {
                phase: self.phase,
                event: Event::CancelPending,
            });
        }
        self.pending = false;
        self.phase = Phase::Receiving;
        self.resume_deferred = false;
        Ok(Actions::NONE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(actions: Actions, expected: Action) {
        assert_eq!(actions.first(), Some(expected));
        assert_eq!(actions.second(), None);
    }

    #[test]
    fn starts_and_recovers_in_receive() {
        let (mut owner, actions) = ReceiveFirst::new();
        one(actions, Action::ArmReceive);
        one(
            owner.on(Event::StartTransmitAttempt).unwrap(),
            Action::BeginCad,
        );
        one(owner.on(Event::CadIdle).unwrap(), Action::BeginTransmit);
        one(owner.on(Event::TxComplete).unwrap(), Action::ArmReceive);
        assert_eq!(owner.phase(), Phase::Receiving);
    }

    #[test]
    fn pre_air_abandonment_rearms_without_claiming_tx_completion() {
        let (mut owner, _) = ReceiveFirst::new();
        assert_eq!(
            owner.on(Event::TxAbandoned),
            Err(Refusal::Unexpected {
                phase: Phase::Receiving,
                event: Event::TxAbandoned,
            })
        );
        owner.on(Event::StartTransmitAttempt).unwrap();
        owner.on(Event::CadIdle).unwrap();
        one(owner.on(Event::TxAbandoned).unwrap(), Action::ArmReceive);
        assert_eq!(owner.phase(), Phase::Receiving);
        assert!(owner.on(Event::TxComplete).is_err());
        one(
            owner.on(Event::StartTransmitAttempt).unwrap(),
            Action::BeginCad,
        );
    }

    #[test]
    fn a_busy_cad_rearms_receive_before_the_deferral() {
        let (mut owner, _) = ReceiveFirst::new();
        owner.on(Event::StartTransmitAttempt).unwrap();
        one(owner.on(Event::CadBusy).unwrap(), Action::ArmReceive);
        assert_eq!(owner.phase(), Phase::Deferred);
        one(owner.on(Event::DeferralElapsed).unwrap(), Action::BeginCad);
    }

    #[test]
    fn a_refused_l2_offer_restores_receive_without_inventing_a_cad_result() {
        let (mut owner, _) = ReceiveFirst::new();
        owner.on(Event::StartTransmitAttempt).unwrap();
        one(
            owner.on(Event::AdmissionRefused).unwrap(),
            Action::ArmReceive,
        );
        assert_eq!(owner.phase(), Phase::Receiving);
    }

    #[test]
    fn an_arrival_blocks_the_next_cad_until_it_is_delivered() {
        let (mut owner, _) = ReceiveFirst::new();
        owner.on(Event::StartTransmitAttempt).unwrap();
        owner.on(Event::CadBusy).unwrap();
        one(
            owner.on(Event::RxComplete).unwrap(),
            Action::DeliverReceived,
        );
        assert_eq!(owner.phase(), Phase::Delivering);
        assert_eq!(
            owner.on(Event::DeferralElapsed),
            Err(Refusal::Unexpected {
                phase: Phase::Delivering,
                event: Event::DeferralElapsed,
            })
        );
        one(
            owner.on(Event::DeliveryHandled).unwrap(),
            Action::ArmReceive,
        );
        assert_eq!(owner.phase(), Phase::Deferred);
        one(owner.on(Event::DeferralElapsed).unwrap(), Action::BeginCad);
    }

    #[test]
    fn a_received_duplicate_can_cancel_the_pending_relay_while_receiving() {
        let (mut owner, _) = ReceiveFirst::new();
        owner.on(Event::StartTransmitAttempt).unwrap();
        owner.on(Event::CadBusy).unwrap();
        assert_eq!(owner.on(Event::CancelPending), Ok(Actions::NONE));
        assert_eq!(owner.phase(), Phase::Receiving);
        assert_eq!(
            owner.on(Event::DeferralElapsed),
            Err(Refusal::Unexpected {
                phase: Phase::Receiving,
                event: Event::DeferralElapsed,
            })
        );
    }

    #[test]
    fn contention_failure_rearms_before_reporting_unavailable() {
        let (mut owner, _) = ReceiveFirst::new();
        owner.on(Event::StartTransmitAttempt).unwrap();
        let actions = owner.on(Event::CadUnavailable).unwrap();
        assert_eq!(actions.first(), Some(Action::ArmReceive));
        assert_eq!(actions.second(), Some(Action::ReportUnavailable));
        assert_eq!(owner.phase(), Phase::Receiving);
        one(owner.on(Event::RetryPending).unwrap(), Action::BeginCad);
    }

    #[test]
    fn a_radio_fault_is_terminal_and_reports_unavailable_once() {
        let (mut owner, _) = ReceiveFirst::new();
        one(owner.on(Event::Fault).unwrap(), Action::ReportUnavailable);
        assert_eq!(owner.phase(), Phase::Failed);
        assert_eq!(
            owner.on(Event::StartTransmitAttempt),
            Err(Refusal::Unexpected {
                phase: Phase::Failed,
                event: Event::StartTransmitAttempt,
            })
        );
    }
}
