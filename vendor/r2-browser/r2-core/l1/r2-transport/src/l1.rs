//! Layer 1 transport: the bearer registry, profile, and state machine
//! (`r2-standard/L1-transport.md`).

use crate::fade_rate::FadeRate;
use r2_hal_traits::Ticks;
use r2_wire::Tier;

/// ‼ **RE-EXPORTED SO A BEARER CAN NAME THE TYPE IT IS ALREADY GIVEN.**
/// `BearerProfile::wire_tier` is a `Tier` and `Ordinal::wire_tier` returns
/// one, so every bearer already handles the type — and **a bearer may not
/// depend on Layer 4** (the layering gate refuses it), so without this it
/// could hold the value and not spell it. *A re-export adds no dependency
/// edge and no second definition: it is the same type by the same name.*
pub use r2_wire::Tier as WireTier;

/// Registered bearer ordinals (L1 8.2.1). The ordinal and its bit are
//  normative; the name is a label (8.1.1). Ordinal 1 / bit 0x02 is reserved
/// (8.3.1, retired infrastructure WiFi) and has no variant — it must never
/// enter this enum.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum Ordinal {
    Ble = 0,
    Lora = 2,
    Tcp = 3,
    Usb = 4,
    WifiMesh = 5,
    Udp = 6,
}

/// Assembly-local identity of one concrete transport binding.
///
/// An [`Ordinal`] identifies a registry *kind* of bearer.  It deliberately
/// does not identify a radio, socket, or driver instance: L1 8.2.4 permits
/// several bindings with the same ordinal and profile.  Composition assigns
/// this value while assembling an image and keeps it stable until that
/// binding leaves service.  It is never sent on the wire and says nothing
/// about a remote hive.
///
/// L2 and L3 use this alongside the ordinal so that a reception, state
/// change, signal measurement, or local disable of one concrete binding
/// cannot qualify a sibling merely because both implement (for example)
/// LoRa.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(transparent)]
pub struct BindingId(pub u8);

/// One assembled transport binding, carrying both its local identity and its
/// L1 registry profile kind.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct BindingInstance {
    /// Assembly-local identifier, stable while the binding is in service.
    pub id: BindingId,
    /// Registry kind and profile shared by compatible binding instances.
    pub ordinal: Ordinal,
}

impl BindingInstance {
    /// Construct the identity composition assigned to this concrete binding.
    #[must_use]
    pub const fn new(id: BindingId, ordinal: Ordinal) -> Self {
        Self { id, ordinal }
    }
}

/// The bearer-set field width mask (L1 8.2.2, clarified 6e8348a): 0x7F is
/// the width of the field, not a set of bearers.
pub const BEARER_FIELD_MASK: u8 = 0x7F;

/// The assignable bearer set (L1 8.2.2): the six live ordinals —
/// the field mask minus the reserved bit 0x02 (8.3.1).
pub const ASSIGNABLE_BEARERS: u8 = 0x7D;

impl Ordinal {
    /// Local default speed preference, not a registry value or a bitrate.
    ///
    /// These coarse implementation weights favour wired/IP carriage (8),
    /// WiFi mesh (4), BLE (2), then LoRa (1). They are provisional estimates,
    /// not measured throughput: in particular, an IP socket says nothing
    /// about its underlying access link. A binding with better local evidence
    /// overrides [`Bearer::relative_speed`] for the particular peer.
    pub const fn default_speed_weight(self) -> u8 {
        match self {
            Self::Usb | Self::Tcp | Self::Udp => 8,
            Self::WifiMesh => 4,
            Self::Ble => 2,
            Self::Lora => 1,
        }
    }

    pub const fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Ordinal::Ble),
            2 => Some(Ordinal::Lora),
            3 => Some(Ordinal::Tcp),
            4 => Some(Ordinal::Usb),
            5 => Some(Ordinal::WifiMesh),
            6 => Some(Ordinal::Udp),
            _ => None,
        }
    }

    /// This bearer's bit in a bearer set (L1 8.1.1).
    pub const fn bit(self) -> u8 {
        1 << (self as u8)
    }

    /// Registry label (L1 8.2.1). A label, never an interoperability key
    /// (8.1.2).
    pub const fn label(self) -> &'static str {
        match self {
            Ordinal::Ble => "ble",
            Ordinal::Lora => "lora",
            Ordinal::Tcp => "tcp",
            Ordinal::Usb => "usb",
            Ordinal::WifiMesh => "wifi-mesh",
            Ordinal::Udp => "udp",
        }
    }

    /// Reach per the registry (L1 8.2.1).
    pub const fn reach(self) -> Reach {
        match self {
            Ordinal::Ble => Reach::Proximity,
            Ordinal::Lora => Reach::LongRange,
            Ordinal::Tcp | Ordinal::Udp => Reach::Global,
            Ordinal::Usb => Reach::PointToPoint,
            Ordinal::WifiMesh => Reach::Local,
        }
    }

    /// Default wire tier per the registry (L1 8.2.1). A binding profile may use
    /// the explicit UDP exception in L1 8.2.5. The default follows the ordinal,
    /// never the band.
    pub const fn wire_tier(self) -> Tier {
        match self {
            Ordinal::Tcp | Ordinal::Udp => Tier::Extended,
            _ => Tier::Compact,
        }
    }

    /// **L2 7.2.2: does this binding provide a means to ask?**
    ///
    /// *A scanner shall obtain the class by asking, **where the bearer provides
    /// a means to ask**.* The clause is conditional and nothing could evaluate
    /// its antecedent — so 7.2.2 read as unimplementable when it was in fact
    /// unanswerable. **This is the answer, per binding**, on Roy's ruling of
    /// 2026-09-05: yes on ESP-NOW and BLE, no on LoRa.
    ///
    /// ‼ **THE `false` IS THE CONSIDERED HALF, AND IT IS L2 12.1's OWN
    /// RESERVATION RATHER THAN AN OMISSION.** *Whether such a means should be
    /// added, and what it would cost in airtime, is undecided* — and the cost
    /// is not evenly spread. On ESP-NOW and BLE a query is a unicast exchange
    /// that costs essentially nothing. On LoRa at SF12 a round trip is a
    /// meaningful share of an hour's frames, and L3 5.1.1 makes every hive a
    /// relay, so the cost lands on traffic that is not even the asker's.
    /// **Answering the clause's own worry is not the same as overriding it**:
    /// on LoRa the antecedent stays false and 7.2.2 Note 1 applies exactly as
    /// written — *discovery stops at exact match, and a scanner cannot find a
    /// class it does not already know the name of.*
    ///
    /// ‼ **A BINDING FACT AND NOT A BEARER ONE, WHICH IS WHY IT LIVES HERE.**
    /// Putting it on [`BearerProfile`] would let two assemblies of the same
    /// binding disagree about whether their medium can carry a question —
    /// *which is not a thing an assembly gets to decide* — and would spread it
    /// across twenty construction sites, most of them fixtures, where it could
    /// be set to whatever made a test pass.
    ///
    /// ⚠ **TCP, UDP AND USB ARE `true` BY THE SAME READING AND NOT BY DEFAULT.**
    /// Each is a bidirectional link on which a directed request costs one
    /// round trip; none carries LoRa's airtime argument. Stated rather than
    /// falling out of a `_ =>` arm, so a binding added later has to be
    /// considered rather than inheriting an answer.
    pub const fn provides_a_query(self) -> bool {
        match self {
            Ordinal::Ble | Ordinal::WifiMesh | Ordinal::Tcp | Ordinal::Udp | Ordinal::Usb => true,
            Ordinal::Lora => false,
        }
    }

    /// Largest frame payload per the registry (L1 8.2.1), bytes.
    pub const fn largest_payload(self) -> u16 {
        match self {
            Ordinal::Ble => 200,
            Ordinal::Lora => 222,
            Ordinal::Tcp | Ordinal::Udp => 65_535,
            Ordinal::Usb => 255,
            Ordinal::WifiMesh => 250,
        }
    }

    /// Relative cost of sending per the registry (L1 8.2.1) — energy spent
    /// by the sender, not difficulty (usb is 0 because the far hive is
    /// powered through the link).
    pub const fn relative_cost(self) -> u8 {
        match self {
            Ordinal::Usb => 0,
            Ordinal::Ble => 1,
            Ordinal::Lora => 5,
            Ordinal::Tcp | Ordinal::Udp => 8,
            Ordinal::WifiMesh => 9,
        }
    }
}

/// Reach (profile parameter B7). The first four are ordered;
/// point-to-point sits deliberately outside the order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reach {
    Proximity,
    Local,
    LongRange,
    Global,
    PointToPoint,
}

/// Bearer state (L1 5.2.1). A bearer that cannot send reports
/// `Unavailable`, `Failed`, or `ReceiveOnly` rather than accepting and
/// discarding (5.2.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BearerState {
    /// Can carry frames to known and not-yet-known peers.
    Available,
    /// Known peers only; cannot take new ones.
    Restricted,
    /// Cannot carry now, expects to later (includes exhausted airtime
    /// budget, L1 9.2).
    Unavailable,
    /// Cannot carry; needs intervention or recovery.
    Failed,
    /// Delivers received frames but has no output path in this assembly (4.6.3).
    ReceiveOnly,
}

/// Connection lifecycle parameters, declared where the medium requires a
/// connection (L1 Clause 10), in seconds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConnectionParams {
    /// Silence after which a peer is unreachable (10.2); at least 3x the
    /// interval at which the bearer expects to hear from a peer (10.3).
    pub silence_period_s: u32,
    /// Stated maximum reattempt interval (10.4).
    pub max_reattempt_interval_s: u32,
}

/// 10.3's multiple: *at least three times the interval at which the bearer
/// expects to hear from a peer.*
pub const SILENCE_PERIOD_MULTIPLE: u32 = 3;

impl ConnectionParams {
    /// **L1 10.2: is this peer unreachable, having been silent too long?**
    ///
    /// The clause states a BEHAVIOUR — *shall treat a peer as unreachable
    /// after a period of silence* — and this type held only the period.
    /// **Nothing constructed one and nothing applied it**: every bearer in
    /// the tree sets `connection: None`, so the declaration existed and the
    /// treatment did not.
    ///
    /// Shares [`Ticks::exceeded`] with L2 6.3.1's fade and L3 7.4.2's
    /// lifetime, so **a clock that went backwards is not a silent peer** and
    /// the three cannot answer differently about the same arithmetic.
    pub fn unreachable_after_silence(
        &self,
        last_heard: Ticks,
        now: Ticks,
        ticks_per_second: u32,
    ) -> bool {
        now.exceeded(last_heard, self.silence_period_s, ticks_per_second)
    }

    /// **L1 10.3: does the declared silence period meet its floor?**
    ///
    /// ⚠ **`L1-049` IS `FLAGGED SS2`, so this checks the declaration rather
    /// than enforcing a value.** The multiple is stated — three times the
    /// interval at which the bearer expects to hear from a peer — and *what
    /// that interval IS, on a bearer whose peers speak at their own cadence,
    /// is the open question.* So the interval is the caller's to supply and
    /// this answers only whether the declared period clears it.
    ///
    /// A bearer declaring a period below its own floor treats peers as
    /// unreachable **while they are still speaking on schedule**, which looks
    /// from outside exactly like a flaky link.
    pub fn silence_period_is_sufficient(&self, expected_interval_s: u32) -> bool {
        self.silence_period_s >= expected_interval_s.saturating_mul(SILENCE_PERIOD_MULTIPLE)
    }
}

/// **Airtime accounting for a regulated bearer (L1 Clause 9).**
///
/// A bearer declaring `regulated` in its profile (B8, 9.1) has a duty cycle or
/// airtime budget it may not exceed. **Until 2026-08-18 the flag was written
/// at four sites and read at none**, and nothing in the workspace accounted
/// for airtime at all — so 9.2 and 9.3 had a declaration and no behaviour.
///
/// # 9.3 has no exception for urgency, and that is a MISSING PARAMETER
///
/// ‼ **[`Self::permits`] takes an airtime and nothing else.** There is no
/// priority, no urgency, no override — *because the clause has none, and its
/// Note 1 says the omission is deliberate*: **a budget with an exception for
/// important traffic is a budget that is exceeded whenever traffic is
/// important**, which on a shared medium is exactly when everyone else needs
/// it too. **The obligation is also a legal one on the operator in most
/// jurisdictions, and the standard says in terms that it cannot grant relief
/// from it.**
///
/// *So the API cannot express the exception.* A caller holding an urgent
/// frame and a spent budget has one honest move, and it is to wait.
///
/// # 9.2 makes exhaustion a STATE, not a silent loss
///
/// Note 2: the layers above can choose another bearer or wait, **which they
/// cannot do if the frame was simply dropped.** So [`Self::exhausted`] exists
/// to be reported through [`BearerState::Unavailable`], whose own
/// documentation already names this clause.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AirtimeBudget {
    allowance_ms: u32,
    window_s: u32,
    spent_ms: u32,
    window_started: Ticks,
    resumed_window_ticks: Option<u64>,
}

impl AirtimeBudget {
    /// `allowance_ms` of transmission permitted in each `window_s`.
    pub const fn new(allowance_ms: u32, window_s: u32, started: Ticks) -> Self {
        Self {
            allowance_ms,
            window_s,
            spent_ms: 0,
            window_started: started,
            resumed_window_ticks: None,
        }
    }

    /// Conservative cold recovery when prior accounting is unavailable.
    /// Receive remains possible; transmit waits a complete accounting window.
    pub fn withhold_current_window(&mut self) {
        self.spent_ms = self.allowance_ms;
    }

    /// Local checkpoint: allowance, window seconds, spent, remaining ms low/high.
    /// Not a network format. Round remaining time upward rather than mint credit.
    pub fn checkpoint(&self, now: Ticks, ticks_per_second: u32) -> Option<[u32; 5]> {
        if ticks_per_second == 0 {
            return None;
        }
        let mut budget = *self;
        budget.roll(now, ticks_per_second);
        let elapsed = now.0.checked_sub(budget.window_started.0)?;
        let length = budget
            .resumed_window_ticks
            .unwrap_or(u64::from(budget.window_s) * u64::from(ticks_per_second));
        // roll uses a strict exceeded boundary. Keep one millisecond at equality.
        let remaining = length.saturating_sub(elapsed);
        let remaining_ms =
            ((u128::from(remaining) * 1000).div_ceil(u128::from(ticks_per_second))).max(1);
        let remaining_ms = u64::try_from(remaining_ms).ok()?;
        Some([
            budget.allowance_ms,
            budget.window_s,
            budget.spent_ms,
            remaining_ms as u32,
            (remaining_ms >> 32) as u32,
        ])
    }

    /// Restore into the same configured limits using elapsed retained-clock time.
    /// A short restored window rolls back to the normal duration after expiry.
    pub fn restore(
        &mut self,
        words: [u32; 5],
        now: Ticks,
        ticks_per_second: u32,
        elapsed_ms: u64,
    ) -> bool {
        let remaining_ms = u64::from(words[3]) | (u64::from(words[4]) << 32);
        if ticks_per_second == 0
            || words[0] != self.allowance_ms
            || words[1] != self.window_s
            || words[2] > self.allowance_ms
            || remaining_ms == 0
            || remaining_ms > u64::from(self.window_s) * 1000
        {
            return false;
        }
        let remaining_ms = remaining_ms.saturating_sub(elapsed_ms);
        let ticks = (u128::from(remaining_ms) * u128::from(ticks_per_second)).div_ceil(1000);
        let Ok(ticks) = u64::try_from(ticks) else {
            return false;
        };
        self.window_started = now;
        self.spent_ms = if remaining_ms == 0 { 0 } else { words[2] };
        self.resumed_window_ticks = (remaining_ms != 0).then_some(ticks);
        true
    }

    /// **9.3: may a frame costing `airtime_ms` be sent?**
    ///
    /// ‼ **NO PRIORITY ARGUMENT, AND THAT ABSENCE IS THE CLAUSE.** See the
    /// type's documentation: 9.3 has no exception for urgency and its Note 1
    /// says the omission is deliberate.
    pub const fn permits(&self, airtime_ms: u32) -> bool {
        match self.spent_ms.checked_add(airtime_ms) {
            Some(total) => total <= self.allowance_ms,
            // A frame whose airtime overflows the counter is not affordable
            // by any budget, so this is `false` rather than a wrap into a
            // small number that would look affordable.
            None => false,
        }
    }

    /// Charge `airtime_ms` against the budget, rolling the window first.
    ///
    /// Returns whether the transmission is permitted. **A refusal spends
    /// nothing** — 9.3 says a bearer shall not exceed its budget *in order to
    /// send a frame*, so a refused frame must not leave the budget worse than
    /// it found it, or a burst of refusals would exhaust it without a single
    /// transmission.
    pub fn spend(&mut self, airtime_ms: u32, now: Ticks, ticks_per_second: u32) -> bool {
        self.roll(now, ticks_per_second);
        if !self.permits(airtime_ms) {
            return false;
        }
        self.spent_ms = self.spent_ms.saturating_add(airtime_ms);
        true
    }

    /// **9.2: is the budget exhausted?** Report this as
    /// [`BearerState::Unavailable`] rather than dropping frames silently.
    ///
    /// Exhausted means *nothing more can be sent in this window*, so a budget
    /// with a scrap left is not exhausted — a caller asking about a specific
    /// frame asks [`Self::permits`].
    pub const fn exhausted(&self) -> bool {
        self.spent_ms >= self.allowance_ms
    }

    /// Airtime spent in the current window.
    pub const fn spent_ms(&self) -> u32 {
        self.spent_ms
    }

    /// Airtime still legal in the current window (L1 9.4).  This reports no
    /// more than the scheduler needs; it does not hand the budget upward.
    pub const fn remaining_ms(&self) -> u32 {
        self.allowance_ms.saturating_sub(self.spent_ms)
    }

    /// Advance to a fresh window where one has elapsed.
    ///
    /// Uses the same [`Ticks::exceeded`] rule as L1 10.2, L2 6.3.1 and L3
    /// 7.4.2, so a clock that went backwards does not hand a bearer a fresh
    /// allowance — *which would be the one direction of that fault that
    /// breaks a legal obligation rather than a local one.*
    pub fn roll(&mut self, now: Ticks, ticks_per_second: u32) -> bool {
        let elapsed = now.0.checked_sub(self.window_started.0);
        let expired = self.resumed_window_ticks.map_or_else(
            || now.exceeded(self.window_started, self.window_s, ticks_per_second),
            |remaining| elapsed.is_some_and(|elapsed| elapsed > remaining),
        );
        if expired {
            self.resumed_window_ticks = None;
            self.window_started = now;
            self.spent_ms = 0;
            return true;
        }
        false
    }
}

/// **B5 and B8 as one value: the fade rate, carrying whether the bearer is
/// regulated and — where it is — where the value came from.**
///
/// ‼ **THESE WERE TWO FIELDS, `fade_s: u32` AND `regulated: bool`, AND THE
/// PAIR BYPASSED [`FadeRate`] ENTIRELY.** Every bearer wrote a bare literal
/// into `fade_s`, [`FadeRate::derive`] had no caller outside its own tests,
/// and nothing tied the two fields together — so a regulated bearer could
/// declare any number at all and BND3 6a.5/6a.6 held only by a reviewer's
/// memory (audit MEDIUM, 2026-08-25, `r2-codex-refute`'s shape). *One enum,
/// no rule invented for the media that have none:* an unregulated bearer
/// sets its seconds against the L2 announce interval (7 Note 2) and that is
/// all the standard asks of it; a regulated one must exceed the longest
/// under-load beacon gap (L2 6.3.2), and the only way to say so is to have
/// derived it.
///
/// A regulated profile cannot be built from a bare number:
///
/// ```compile_fail,E0308
/// let _ = r2_transport::l1::Fade::Regulated(600u32);
/// ```
///
/// and the door that exists is the derivation:
///
/// ```
/// use r2_transport::fade_rate::{FadeRate, FadeSource};
/// use r2_transport::l1::Fade;
/// let fade = Fade::Regulated(
///     FadeRate::derive(600, FadeSource::BudgetUnderLoad { longest_interval_s: 300 }).unwrap(),
/// );
/// assert!(fade.regulated());
/// assert_eq!(fade.seconds(), 600);
/// ```
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fade {
    /// B8 false. B5 in seconds, set against the L2 announce interval (7
    /// Note 2); no provenance is required of it because no clause asks for
    /// one.
    Unregulated { seconds: u32 },
    /// B8 true, with B5 derived (BND3 6a.5, 6a.6). **The only regulated
    /// form**: a `Provisional { seconds, refused }` variant existed for one
    /// hour on 2026-08-25 and was refuted — it made an INVALID B5
    /// representable and reachable through `seconds()` while the bearer
    /// reported *Available*, and BND3 6a.5 / L2 6.3.2 carry no provisional
    /// exemption. A regulated bearer whose B5 does not derive does not get
    /// a profile; it refuses service.
    Regulated(FadeRate),
    /// A receive-only ingress's bounded local visibility period. This is not
    /// a claim about a peer's beacon cadence or liveness (L1 B5, L2 4.1.3a).
    Passive {
        /// How long this hive keeps one passive observation visible.
        observation_retention_s: u32,
        /// B8 still describes the medium even though this ingress never sends.
        regulated: bool,
    },
}

/// The L1-to-L2 lifetime meaning of B5.  A passive retention is deliberately
/// not represented as a peer fade: the same elapsed-time comparison removes a
/// local observation, but its expiry makes no claim about a remote peer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ObservationLifetime {
    /// An addressable bearer's period before an unheard peer has receded.
    PeerFade { seconds: u32 },
    /// A receive-only ingress's local visibility period for an observation.
    PassiveRetention { seconds: u32 },
}

impl ObservationLifetime {
    /// The elapsed-time bound in seconds, regardless of its distinct meaning.
    pub const fn seconds(self) -> u32 {
        match self {
            Self::PeerFade { seconds } | Self::PassiveRetention { seconds } => seconds,
        }
    }

    /// Whether this bound expires a local observation rather than a peer.
    pub const fn is_passive(self) -> bool {
        matches!(self, Self::PassiveRetention { .. })
    }
}

impl Fade {
    /// B5, seconds.
    pub const fn seconds(&self) -> u32 {
        match self {
            Fade::Unregulated { seconds } => *seconds,
            Fade::Regulated(rate) => rate.seconds(),
            Fade::Passive {
                observation_retention_s,
                ..
            } => *observation_retention_s,
        }
    }

    /// B8: whether limited by duty cycle or airtime budget (Clause 9).
    pub const fn regulated(&self) -> bool {
        match self {
            Fade::Unregulated { .. } => false,
            Fade::Regulated(_) => true,
            Fade::Passive { regulated, .. } => *regulated,
        }
    }

    /// Whether B5 is a local passive-observation retention, not peer fade.
    pub const fn is_passive(&self) -> bool {
        matches!(self, Fade::Passive { .. })
    }

    /// Preserve B5's meaning at the L1--L2 boundary. Callers that only take
    /// [`Self::seconds`] erase the distinction a receive-only ingress needs.
    pub const fn observation_lifetime(&self) -> ObservationLifetime {
        match self {
            Fade::Unregulated { seconds } => ObservationLifetime::PeerFade { seconds: *seconds },
            Fade::Regulated(rate) => ObservationLifetime::PeerFade {
                seconds: rate.seconds(),
            },
            Fade::Passive {
                observation_retention_s,
                ..
            } => ObservationLifetime::PassiveRetention {
                seconds: *observation_retention_s,
            },
        }
    }
}

/// How an intermittently receptive bearer finds a peer.
///
/// This is a local profile fact for selection and composition; it is never an
/// instruction for a peer to use the same phase. A binding may carry a coarse
/// peer-facing availability declaration separately.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RendezvousBasis {
    /// Locally randomized windows can overlap without a continuously
    /// receptive peer being part of the deployment.
    Autonomous,
    /// The deployment requires at least one continuously receptive peer on
    /// this bearer for useful rendezvous. Composer can reject an assembly
    /// that cannot supply that counterpart before it reaches a board.
    ContinuousCounterpart,
}

/// An exact, medium-hidden intermittent-receptivity contract (L1 7.1 B9).
///
/// Durations are milliseconds so a profile remains inspectable without an L0
/// timer representation or a particular board tick rate. The ranges are
/// inclusive. They are intentionally values, not a common schedule: a binding
/// draws a fresh local value for every window or transmission opportunity.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct IntermittentReceptivity {
    receptive_window_ms: u32,
    next_window_delay_min_ms: u32,
    next_window_delay_max_ms: u32,
    transmit_delay_min_ms: u32,
    transmit_delay_max_ms: u32,
    basis: RendezvousBasis,
}

/// Why a B9 intermittent-receptivity value is not a usable rendezvous plan.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReceptivityRefusal {
    /// A zero-length window is never receptive.
    EmptyWindow,
    /// The declared next-window range is backwards.
    InvertedNextWindowRange,
    /// The declared transmission-opportunity range is backwards.
    InvertedTransmitRange,
}

impl IntermittentReceptivity {
    /// Construct one exact local rendezvous contract.
    ///
    /// This is the only constructor, so an inverted or empty schedule cannot
    /// be represented. A binding-specific scheduler adds any stronger
    /// medium-access rule: direct LoRa, for example, refuses fixed ranges
    /// before it starts the radio.
    pub const fn new(
        receptive_window_ms: u32,
        next_window_delay_min_ms: u32,
        next_window_delay_max_ms: u32,
        transmit_delay_min_ms: u32,
        transmit_delay_max_ms: u32,
        basis: RendezvousBasis,
    ) -> Result<Self, ReceptivityRefusal> {
        if receptive_window_ms == 0 {
            return Err(ReceptivityRefusal::EmptyWindow);
        }
        if next_window_delay_min_ms > next_window_delay_max_ms {
            return Err(ReceptivityRefusal::InvertedNextWindowRange);
        }
        if transmit_delay_min_ms > transmit_delay_max_ms {
            return Err(ReceptivityRefusal::InvertedTransmitRange);
        }
        Ok(Self {
            receptive_window_ms,
            next_window_delay_min_ms,
            next_window_delay_max_ms,
            transmit_delay_min_ms,
            transmit_delay_max_ms,
            basis,
        })
    }

    /// Duration of one period during which the bearer can accept arrivals.
    pub const fn receptive_window_ms(self) -> u32 {
        self.receptive_window_ms
    }

    /// Inclusive locally random delay from one window closing to the next
    /// window opening.
    pub const fn next_window_delay_ms(self) -> (u32, u32) {
        (self.next_window_delay_min_ms, self.next_window_delay_max_ms)
    }

    /// Inclusive locally random delay from eligible retained work to its
    /// carrier-sense opportunity.
    pub const fn transmit_delay_ms(self) -> (u32, u32) {
        (self.transmit_delay_min_ms, self.transmit_delay_max_ms)
    }

    /// Whether the composed deployment requires an always-receptive peer.
    pub const fn basis(self) -> RendezvousBasis {
        self.basis
    }

    /// Conservative maximum between the starts of two receptive windows.
    ///
    /// A binding converts this upward to the coarse on-air longest-interval
    /// declaration, rounding up so it never understates a sleeping peer.
    pub const fn longest_window_start_interval_ms(self) -> u64 {
        // Each declared component is a u32, but their sum need not be.  A
        // saturated u32 would understate the longest gap at exactly the
        // boundary a peer uses to decide how long to retain work.  Preserve
        // the actual sum; a binding whose coarse on-air field is narrower
        // must refuse or represent it conservatively at that boundary.
        self.receptive_window_ms as u64 + self.next_window_delay_max_ms as u64
    }
}

/// Whether a bearer is continuously receptive or needs a rendezvous plan
/// (L1 7.1 B9).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Receptivity {
    /// The bearer accepts arrivals whenever it is in service, aside from
    /// bounded half-duplex operations that the binding declares separately.
    Continuous,
    /// The bearer is receptive only for locally scheduled windows.
    Intermittent(IntermittentReceptivity),
}

/// Bearer profile, parameters B1-B9 (L1 Clause 7), readable without any
/// knowledge of the medium (7.2).
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct BearerProfile {
    /// B1: registry ordinal.
    pub ordinal: Ordinal,
    /// B2: maximum transport unit payload, bytes. Where it varies with link
    /// mode, the inclusive range; the current value is reported live (5.1).
    pub max_payload: core::ops::RangeInclusive<u16>,
    /// B3: wire tier — default frame encoding on this bearer.
    pub wire_tier: Tier,
    /// B5 and B8: fade rate — how quickly an unheard peer is treated as
    /// receding — and whether the bearer is regulated, as one value; see
    /// [`Fade`].
    pub fade: Fade,
    /// B6: relative cost of sending.
    pub relative_cost: u8,
    /// B7: reach.
    pub reach: Reach,
    /// B9: continuous or exact locally-randomized intermittent receptivity.
    pub receptivity: Receptivity,
    /// Whether this bearer participates in discovery (4.6.2).
    ///
    /// ‼ **A STATED BINDING FACT, NOT AN INFERENCE.** 4.6.2 obliges a bearer
    /// that participates to support broadcast, and **4.6.2a obliges a bearer
    /// that does not support broadcast to say so IN ITS BINDING DOCUMENT** —
    /// so this is a value a binding declares and an implementation carries,
    /// the same as every other profile field.
    ///
    /// **L2 4.1.1 is scoped by it** (`L2-001`, scoped 2026-08-09 under
    /// `SS318`): *a hive shall emit a beacon on every bearer in service that
    /// participates in discovery.* Without this field that scope is not
    /// evaluable, and a beacon loop would either skip a bearer that should
    /// announce or broadcast on one that cannot — *and 4.6.2's Note 1 makes
    /// the second one expensive rather than impossible, so it would work and
    /// cost airtime nobody chose to spend.*
    pub participates_in_discovery: bool,
    /// Clause 10 parameters, where the medium holds connections.
    pub connection: Option<ConnectionParams>,
}

/// Per-peer link quality (L1 5.3.1): 0.0 unusable, 1.0 as good as this
/// bearer gets. Stored as the raw value; a peer no longer reachable reports
/// 0 or unreachable (5.3.3).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct LinkQuality(pub f32);

impl LinkQuality {
    /// Clamp into [0, 1]; NaN becomes 0 (unusable).
    pub fn new(q: f32) -> Self {
        Self(if q.is_nan() { 0.0 } else { q.clamp(0.0, 1.0) })
    }
}

use r2_ident::HiveId;

/// A medium-level address (MAC, BLE address, …), reported only while no
/// canonical identifier is known for it (L1 4.5.3, transitional).
/// **A clamped, monotonic mapping from a signal measurement onto L1 5.3.1's
/// `[0, 1]` link quality.**
///
/// ‼ **ONE SHAPE FOR EVERY BINDING, BECAUSE 5.3.1 IS THE PARENT CLAUSE AND
/// EACH BINDING'S 6a.2 IS ITS INSTANCE.** BLE maps received signal strength
/// in dBm; LoRa maps signal-to-noise ratio in dB. *The units differ, the
/// contract does not* — floor to `0.0`, ceiling to `1.0`, clamped outside,
/// monotonic in the measure — and two copies of that contract would be two
/// places for it to drift.
///
/// ‼ **THE FLOOR AND CEILING ARE THE IMPLEMENTATION'S AND THIS TYPE REFUSES
/// TO PIN THEM.** Every binding says so in the same words — *this document
/// fixes neither* — because the usable range is a property of an antenna, a
/// package and an enclosure, and a number fixed here would be wrong for most
/// of them. *What is fixed is the shape, so that two implementations
/// disagree about calibration and not about meaning.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct QualityScale {
    /// The measure mapping to `0.0`.
    pub floor: i16,
    /// The measure mapping to `1.0`.
    pub ceiling: i16,
}

impl QualityScale {
    /// Whether the scale is usable: the ceiling strictly above the floor.
    ///
    /// **An inverted or degenerate scale is refused rather than normalised.**
    /// Both produce a mapping that looks monotonic — one is monotonic the
    /// wrong way, the other constant — and *a link quality that does not vary
    /// with the measure is indistinguishable from a radio that is not
    /// measuring.*
    pub const fn is_usable(&self) -> bool {
        self.ceiling > self.floor
    }

    /// **6a.2's derivation itself, before [`LinkQuality`]'s own invariant is
    /// applied.** `None` where the scale is unusable.
    ///
    /// ‼ **THIS EXISTS BECAUSE THE CLAMP WAS INVISIBLE, AND THE INVISIBILITY
    /// WAS MEASURED.** `LinkQuality::new` clamps into `[0, 1]` as a TYPE
    /// INVARIANT, and this maps a measure onto that range as 6a.2's
    /// DERIVATION. They are different obligations that happened to agree, so
    /// **deleting both branches below left every test in the crate green**: the
    /// raw ratio goes negative below the floor and above one past the ceiling,
    /// and the type quietly repaired it (`BND2-049`, `BND3-041`, `BND3-042`,
    /// refuted 2026-09-04). *A guard whose only observable effect is produced
    /// by a second guard is not tested by anything that looks at the result.*
    ///
    /// Both clamps stay, and neither is redundant: **removing the type's would
    /// let any other caller construct an out-of-range quality**, and removing
    /// the derivation's would make 6a.2's floor-to-zero mapping an accident of
    /// the type it returns. What changes is that the derivation's is now
    /// *observable* — this returns the value 6a.2 specifies, and the type's
    /// invariant is a backstop rather than the thing under test.
    pub fn quality_ratio(&self, measure: i16) -> Option<f32> {
        if !self.is_usable() {
            return None;
        }
        if measure <= self.floor {
            return Some(0.0);
        }
        if measure >= self.ceiling {
            return Some(1.0);
        }
        let span = (self.ceiling - self.floor) as f32;
        Some((measure - self.floor) as f32 / span)
    }

    /// Map `measure` onto `[0, 1]`. `None` where the scale is unusable.
    pub fn quality(&self, measure: i16) -> Option<LinkQuality> {
        self.quality_ratio(measure).map(LinkQuality::new)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MediumAddress {
    bytes: [u8; 8],
    len: u8,
}

impl MediumAddress {
    pub fn new(addr: &[u8]) -> Option<Self> {
        (!addr.is_empty() && addr.len() <= 8).then(|| {
            let mut bytes = [0u8; 8];
            bytes[..addr.len()].copy_from_slice(addr);
            Self {
                bytes,
                len: addr.len() as u8,
            }
        })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }
}

/// Who a frame came from, as the bearer can currently name them (L1 4.5).
///
/// `stable` on the medium-derived form answers whether the address
/// persists for the peer's lifetime on this medium — a rotating BLE
/// address is `stable: false`, and nothing above may treat it as an
/// identity, only as a delivery handle until the canonical identifier
/// resolves (4.5.3).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SenderIdentity {
    /// The canonical hive identifier — reported whenever known (4.5.1),
    /// stable by definition.
    Canonical(HiveId),
    /// Transitional medium-derived identity, replaced as soon as the
    /// canonical identifier becomes known (4.5.3).
    Medium { addr: MediumAddress, stable: bool },
}

/// What a received frame arrived with. `quality_hint` is the raw
/// medium-specific measurement the bearer's B4 quality derives from
/// (5.3.2) — e.g. RSSI in dBm; `None` where the medium measures nothing.
#[derive(Clone, Copy, Debug)]
pub struct RxMeta {
    pub sender: SenderIdentity,
    pub quality_hint: Option<i16>,
}

/// Send target (L1 6.1): one named hive or the broadcast target — nothing
/// else may be asked of a bearer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SendTarget {
    Hive(HiveId),
    Broadcast,
}

/// An opaque, versioned configuration representation for one binding (L0
/// 5.1.2; L1 4.8.2).
///
/// The binding owns the meaning of both fields.  The layer consuming this
/// contract can select a representation version and provide bounded bytes,
/// but cannot obtain a radio, driver, pin map, or medium-specific value from
/// it.  A changed meaning requires a new `version`, not a reinterpretation of
/// existing bytes (terminology 4.8.3–4.8.4).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BindingConfiguration<'a> {
    /// Binding-defined representation version.
    pub version: u16,
    /// Binding-defined opaque parameter bytes.
    pub parameters: &'a [u8],
}

/// Why a binding did not apply a configuration request (L1 4.8.3).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConfigurationError {
    /// This binding has no runtime configuration representation.
    Unsupported,
    /// The version is recognised but the parameter bytes are not valid.
    Malformed,
    /// The binding cannot safely change configuration at this time.
    Unavailable,
    /// The binding attempted the update and its implementation failed.
    Failed,
}

/// Why a send was refused. A bearer refuses rather than accepting and
/// discarding (5.2.2), and never fragments (6.3).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SendError {
    /// Larger than the currently declared maximum transport unit payload.
    Oversize,
    /// Bearer unavailable (includes exhausted airtime budget, 9.2).
    Unavailable,
    /// Bearer failed; needs intervention.
    Failed,
    /// This assembly deliberately has no output path (L1 4.6.3).
    ReceiveOnly,
    /// Restricted and the target is not among the carried peers.
    NotCarried,
    /// Named hive not addressable on this bearer.
    UnknownPeer,
}

/// Why a complete received frame was not delivered to its caller.
///
/// An L1 bearer must never replace a peer frame with a prefix merely because
/// the caller's buffer is short. This outcome is separate from [`SendError`]:
/// reception happened, but no exact delivery was possible.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ReceiveError {
    /// The supplied receive buffer cannot hold the complete frame.
    OutputTooSmall { needed: usize },
    /// The medium reported a self-inconsistent complete operation.
    Malformed,
}

/// A regulated bearer's current legal transmission window (L1 9.4).
///
/// This is deliberately a value, not access to the binding's budget.  Layer
/// 2 needs to decide whether an offer preserves its one-beacon reservation;
/// it must not learn how a radio counts airtime or when its driver changes
/// modes.  `new_window` is an edge: it is true exactly once after the
/// binding rolls a legal budget window, so a scheduler cannot accidentally
/// carry a spent reservation into the next one or create two in one window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RegulatedWindow {
    /// A fresh legal budget window began since the previous observation.
    pub new_window: bool,
    /// Airtime still legal in the current window, in milliseconds.
    pub remaining_airtime_ms: u32,
}

/// Implementation-level view of a separately imposed deployment ceiling.
/// This is NOT a legal allowance or another regulatory declaration. Its edge
/// is consumed independently of `RegulatedWindow` and follows its own window.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct DeploymentWindow {
    pub new_window: bool,
    pub remaining_airtime_ms: u32,
}

/// How this binding carries an L2 announcement.
///
/// ESP-NOW and LoRa have no unaddressed discovery primitive, so their
/// bindings carry an announcement in an L4 HEARTBEAT frame.  BLE has extended
/// advertising, where the announcement is medium data and is expressly not a
/// frame.  The distinction belongs at L1: L2 supplies opaque bytes and must
/// not know a radio's framing, while L4 must never be asked to parse an
/// advertisement as a frame.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AnnouncementCarriage {
    /// The announcement body is the payload of an L4 HEARTBEAT frame.
    Frame,
    /// The announcement body is placed directly in medium framing.
    Medium,
}

/// Whether this binding's announcement can carry L2's build-mode declaration.
///
/// This is a fixed binding-document fact (L1 11.1 j)), not a claim about the
/// current image or one particular announcement.  It belongs on the bearer
/// contract so L2 can refuse to place a development image in service before
/// the first beacon would otherwise omit its mandatory declaration.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BuildModeDeclarationCarriage {
    /// The binding has an exact encoding for the declaration.
    Carries,
    /// The binding document states that its announcement cannot carry it.
    CannotCarry,
}

/// Metadata for an announcement received outside the frame receive path.
///
/// A discovery source is a medium address, not a hive identity.  In
/// particular, a rotating BLE address is not evidence from which L2 may
/// manufacture one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AnnouncementMeta {
    /// The address reported by the medium for this one announcement.
    pub source: MediumAddress,
    /// The raw medium measurement, if the controller supplied one.
    pub quality_hint: Option<i16>,
}

/// Why an out-of-frame L2 announcement was not carried intact.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AnnouncementError {
    /// This binding has no out-of-frame announcement primitive.
    Unsupported,
    /// The controller or bearer was unable to accept the announcement.
    Send(SendError),
    /// The caller's receive buffer cannot hold the complete body.
    OutputTooSmall { needed: usize },
    /// The controller reported malformed or self-inconsistent medium data.
    Malformed,
}

/// The receive-side Layer 1 contract (L1 4.6.3, 5, 7), as a consumer's
/// radio/network driver implements it. Sans-IO polling shape: the driver
/// feeds a bounded queue from its interrupt/task side and this trait drains it
/// — `poll_recv` never blocks. Nothing here names the medium (6.2), and
/// supporting a new ingress changes nothing at Layer 3 or above (4.8.1).
///
/// **L1 4.6.3a:** This is deliberately separate from [`Bearer`], which adds output. A
/// receive-only ingress implements this trait alone, so it cannot be passed to
/// a sender API merely to obtain an eventual `SendError::ReceiveOnly`.
///
/// ```compile_fail
/// use r2_transport::l1::{Bearer, Ingress};
///
/// fn needs_output(_: &mut dyn Bearer) {}
/// fn passive_only(ingress: &mut dyn Ingress) {
///     needs_output(ingress);
/// }
/// ```
///
/// **L0 5.1.2a (`L0-052`): a receive-only ingress shall not expose an
/// operation to transmit a frame.** The block above is D-247's control for
/// the two contracts being distinct; this one is the falsifier for the
/// absence itself. It compiles — and so goes red — the moment `Ingress` gains
/// a `send`, however that `send` is defaulted:
///
/// ```compile_fail,E0599
/// use r2_transport::l1::{Ingress, SendTarget};
///
/// fn transmit_through(ingress: &mut dyn Ingress) {
///     let _ = ingress.send(SendTarget::Broadcast, &[]);
/// }
/// ```
///
/// **L0 4.1.2 (`L0-002`): hardware that transmits data without processing the
/// wire protocol shall not be presented as a device.** A platform sensor
/// reaches the stack as a `r2_hal_traits::Sensors` capability, and there is
/// no route from that capability to an ingress with a profile and a state.
/// Goes red when this crate presents a `Sensors` implementor as an `Ingress`
/// (a blanket `impl<S: Sensors> Ingress for S`):
///
/// ```compile_fail,E0277
/// use r2_hal_traits::sensors::{Fault, Measurement, Quantity, Reading, Sensors};
/// use r2_transport::l1::Ingress;
///
/// /// A level sensor on a bus: it transmits data and processes no frame.
/// struct LevelSensor;
///
/// impl Sensors for LevelSensor {
///     type Error = ();
///     fn quantities(&self) -> &[Quantity] {
///         &[Quantity::DistanceToSurface]
///     }
///     fn read(&mut self, _quantity: Quantity) -> Reading<Measurement> {
///         Reading::Unavailable(Fault::NotReady)
///     }
/// }
///
/// fn listens(_: &mut dyn Ingress) {}
/// listens(&mut LevelSensor);
/// ```
pub trait Ingress {
    /// The declared profile B1-B9 (7.1), constant while in service.
    fn profile(&self) -> &BearerProfile;

    /// Current state (5.2.1), kept current (5.1).
    ///
    /// ‼ **THIS IS THE STATE OF `(hive, bearer)`, NOT OF THE DEVICE (5.2.0),
    /// AND NOTHING IN THIS SIGNATURE ENFORCES THAT.** Where one physical
    /// medium carries the bearers of more than one hive, **each hive holds
    /// its own state and those states are independent** — so an
    /// implementor must not share one `Bearer` value between two hives and
    /// let them read one state. *A `&dyn Bearer` handed to two hives
    /// satisfies the type system and violates the clause.*
    ///
    /// **The clause's measured case is a phone**: runtime permissions are
    /// granted per user profile, and one radio, one application and one
    /// device were observed holding **three different permission states at
    /// once**. Two hives in different profiles would report different
    /// states for that radio at the same instant **with neither being
    /// wrong** — which is why *which profile a hive runs in is
    /// conformance-relevant rather than an installation detail.*
    ///
    /// **And 5.2.0's second half has no representation here at all:** *a
    /// conformance claim about a bearer shall be scoped to the hive making
    /// it*, and nothing in this crate carries the scope of such a claim.
    /// Recorded rather than invented — `L1-059` is PARTIAL for exactly
    /// these two reasons.
    fn state(&self) -> BearerState;

    /// Current maximum transport unit payload (5.1) — may vary with link
    /// mode within the profile's B2 range.
    fn max_payload(&self) -> u16;

    /// **L0 5.1.2 / L1 4.8.2: configure this binding's parameters.**
    ///
    /// The representation is versioned and opaque so the portable consumer
    /// never learns a medium's configuration model. `Ok(())` means this
    /// binding applied the requested representation; every other outcome is
    /// an explicit refusal (4.8.3). A binding fixed at construction exposes
    /// this operation and honestly returns `Unsupported` rather than
    /// pretending a runtime update took effect.
    fn configure(
        &mut self,
        _configuration: BindingConfiguration<'_>,
    ) -> Result<(), ConfigurationError> {
        Err(ConfigurationError::Unsupported)
    }

    /// **L0 5.1.2: place the binding into or out of a low-power state.**
    ///
    /// Returns whether the binding is now in the requested state. **`false`
    /// for a binding with no low-power state is the honest answer** and not a
    /// failure: L0 P2 declares *whether the low-power state any energy figure
    /// depends on is implemented in the software as shipped*, so a platform
    /// that declares it absent and answers `false` here is consistent, and one
    /// that declares it present must answer `true`.
    ///
    /// ‼ **DEFAULTED TO `false` RATHER THAN LEFT ABSTRACT**, because 5.1.2
    /// obliges the platform to EXPOSE the operation for **each binding it
    /// provides** — an unimplemented method would make every existing bearer
    /// non-conformant overnight and the honest answer is available. *A bearer
    /// that overrides this is claiming the state; one that does not is
    /// declining it, and both are conformant.*
    fn set_low_power(&mut self, _low_power: bool) -> bool {
        false
    }

    /// Whether this binding is currently in a low-power state (5.1.2).
    fn in_low_power(&self) -> bool {
        false
    }

    /// Drain one marked, out-of-frame L2 announcement.  The binding filters
    /// its marker before returning the opaque body; `None` means no matching
    /// medium event is pending.  Frame-carried bindings use [`Self::poll_recv`]
    /// and retain this default.
    fn poll_announcement(
        &mut self,
        _out: &mut [u8],
    ) -> Option<Result<(usize, AnnouncementMeta), AnnouncementError>> {
        None
    }

    /// Drain one received frame into `buf`: exactly the bytes the peer
    /// handed down, unaltered, medium wrapping removed (4.2). Returns the
    /// frame length and its metadata. `None` means nothing is queued; a short
    /// caller buffer is a distinct refusal, never a delivered prefix.
    fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>>;

    /// Per-peer link quality in [0, 1] (5.3.1); `None` = not addressable
    /// or no longer reachable (5.3.3 permits quality 0 instead).
    ///
    /// A driver whose medium API discards transmit status (e.g. a sync
    /// wrapper that forgets the completion waiter) derives this from
    /// reception alone until it gains a transmit-outcome path. That is
    /// conformant: 5.3.2 only asks that the reported value derive from
    /// measurements the bearer *has*.
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality>;

    /// Visit every currently addressable peer (5.1). Distinct from L2's
    /// peers-heard-announcing — neither substitutes for the other.
    fn for_each_peer(&self, f: &mut dyn FnMut(HiveId, LinkQuality));

    /// **Map THIS binding's raw arrival measurement onto 5.3.1's `[0, 1]`**
    /// (`SS510`).
    ///
    /// [`RxMeta::quality_hint`] is the medium's own number — RSSI in dBm on
    /// BLE and ESP-NOW, signal-to-noise in dB on LoRa — and 6a.2 of each
    /// binding states the mapping. *The units differ; the contract does not.*
    ///
    /// ‼ **NO DEFAULT IMPLEMENTATION, DELIBERATELY.** A default returning
    /// `1.0` is exactly the value L3's receive path used to hard-code, and it
    /// is a claim of a perfect link made by something that measured nothing —
    /// so a binding that gained a real measurement would go on reporting the
    /// default and nothing would say so. **Every binding answers, and one that
    /// measures nothing says so by returning `None`**, which 5.3.2 permits and
    /// which is a different fact from a strong link.
    ///
    /// `None` from the hint itself means the medium reported no measurement
    /// for THIS arrival, which is not the same as a bearer that never
    /// measures — both are `None` here and the binding's own doc says which
    /// it is.
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality>;
}

/// The bidirectional Layer 1 contract (L1 4-7). It includes the complete
/// receive-side surface and adds output. A receive-only ingress is
/// intentionally not a `Bearer`, so output code cannot be handed a passive
/// receiver at all (L0 5.1.2a, L1 4.6.3).
///
/// Rust does not permit a blanket implementation of a supertrait from its
/// subtrait. The blanket bridge below instead makes every `Bearer` usable as
/// an [`Ingress`], while leaving the latter independently implementable by a
/// structural receive-only binding.
///
/// **L1 4.1 (`L1-002`): a means of carrying frames that does not satisfy
/// Clause 4 is not a bearer, and shall not be presented as one.** A concrete
/// type implementing only [`Ingress`] — receive, no output — cannot be handed
/// where a `Bearer` is required. The block on [`Ingress`] shows this for a
/// trait object; this one shows it for a concrete receive-only type, and goes
/// red if the split were removed by a bridge from `Ingress` to `Bearer` (an
/// `impl<T: Ingress> Bearer for T` answering `send` with `ReceiveOnly`):
///
/// ```compile_fail,E0277
/// use r2_ident::HiveId;
/// use r2_transport::l1::{
///     Bearer, BearerProfile, BearerState, Fade, Ingress, LinkQuality, Ordinal, Reach,
///     ReceiveError, Receptivity, RxMeta, WireTier,
/// };
///
/// struct Listener(BearerProfile);
///
/// impl Ingress for Listener {
///     fn profile(&self) -> &BearerProfile {
///         &self.0
///     }
///     fn state(&self) -> BearerState {
///         BearerState::ReceiveOnly
///     }
///     fn max_payload(&self) -> u16 {
///         *self.0.max_payload.end()
///     }
///     fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
///         None
///     }
///     fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
///         None
///     }
///     fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
///     fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
///         None
///     }
/// }
///
/// fn needs_output(_: &mut dyn Bearer) {}
///
/// let mut listener = Listener(BearerProfile {
///     ordinal: Ordinal::Lora,
///     max_payload: 1..=222,
///     wire_tier: WireTier::Compact,
///     fade: Fade::Passive { observation_retention_s: 60, regulated: true },
///     relative_cost: Ordinal::Lora.relative_cost(),
///     reach: Reach::LongRange,
///     receptivity: Receptivity::Continuous,
///     participates_in_discovery: false,
///     connection: None,
/// });
/// needs_output(&mut listener);
/// ```
///
/// **L1 10.1 (`L1-046`): a bearer whose medium requires a connection
/// maintains it itself, and shall not require the layers above to know it
/// exists.** The contract therefore carries no connection operation: nothing
/// above can open one, close one, or be told of one. Both traits are in
/// scope, so either gaining the operation compiles a block and goes red
/// (e.g. a defaulted `fn connect(&mut self, peer: HiveId)` on `Bearer`); an
/// operation of another arity would fail the block for a different reason
/// and is not caught here.
///
/// ```compile_fail,E0599
/// use r2_ident::HiveId;
/// use r2_transport::l1::{Bearer, Ingress};
///
/// fn opens(bearer: &mut dyn Bearer, peer: HiveId) {
///     bearer.connect(peer);
/// }
/// ```
///
/// ```compile_fail,E0599
/// use r2_ident::HiveId;
/// use r2_transport::l1::{Bearer, Ingress};
///
/// fn closes(bearer: &mut dyn Bearer, peer: HiveId) {
///     bearer.disconnect(peer);
/// }
/// ```
pub trait Bearer {
    /// The declared profile B1-B9 (7.1), constant while in service.
    fn profile(&self) -> &BearerProfile;

    /// Current state (5.2.1), kept current (5.1).
    fn state(&self) -> BearerState;

    /// Current maximum transport unit payload (5.1).
    fn max_payload(&self) -> u16;

    /// Local relative transmission-speed estimate for this peer, independent
    /// of the current frame size. Larger is faster; zero means no estimate.
    ///
    /// This is a routing preference input, not measured bits/second or a
    /// delivery promise. Defaults are coarse implementation policy at L1;
    /// bindings may replace them with consistent locally calibrated weights.
    /// State, MTU, peer confidence, freshness and cost still govern selection.
    fn relative_speed(&self, _peer: HiveId) -> u8 {
        self.profile().ordinal.default_speed_weight()
    }

    /// The fixed declaration-carriage fact from this binding's document.
    ///
    /// The safe default is refusal: a new bearer must opt in only after its
    /// binding supplies the exact L2 build-mode encoding required by L1 11.1
    /// j).  Treating an unimplemented method as carriage would make a
    /// development image appear production precisely when the binding has not
    /// established that it can say otherwise.
    fn build_mode_declaration_carriage(&self) -> BuildModeDeclarationCarriage {
        BuildModeDeclarationCarriage::CannotCarry
    }

    /// L0 5.1.2 / L1 4.8.2 configuration operation. A fixed-at-construction
    /// bearer explicitly declines runtime changes by default.
    fn configure(
        &mut self,
        _configuration: BindingConfiguration<'_>,
    ) -> Result<(), ConfigurationError> {
        Err(ConfigurationError::Unsupported)
    }

    /// L0 5.1.2 low-power operation. `false` is the honest default for a
    /// binding with no low-power state.
    ///
    /// ‼ **THIS DEFAULT IS DUPLICATED ON [`Ingress`] AND THE PAIR IS HELD
    /// TOGETHER BY A TEST** (`the_two_low_power_defaults_agree`, 2026-09-05).
    /// `Bearer` is NOT a subtrait of `Ingress`, and the reason is real rather
    /// than accidental: **`Bearer` requires everything `Ingress` does plus
    /// `send`**, so `Ingress` is the RECEIVE-ONLY half — a receive-only
    /// binding implements it without being obliged to invent a `send` it
    /// cannot perform. *(Measured: Bearer's required set is a strict superset,
    /// the only difference being `send`, and the only shared defaults are
    /// these two.)* Making `Bearer: Ingress` would remove the duplication and
    /// is the better shape, at the cost of a separate `impl Ingress` at every
    /// bearer — recorded here so a later reader can weigh it rather than
    /// rediscover the option. So 5.1.2's operation exists twice, and *two
    /// independently defaulted copies of one obligation drift in exactly the
    /// direction nobody is watching.* The
    /// refutation that put this comment here is worth its space: a mutation
    /// inverting BOTH copies left all 161 tests green, because the only
    /// fixture implemented `Bearer` and the row's falsifier called the
    /// `Bearer` method fully qualified, so `Ingress`'s copy was reachable by
    /// nothing at all.
    fn set_low_power(&mut self, _low_power: bool) -> bool {
        false
    }

    /// Whether this binding is currently in its low-power state.
    fn in_low_power(&self) -> bool {
        false
    }

    /// Send one frame to one target (6.1).
    ///
    /// `Ok` means **accepted for transmission by a bearer that currently
    /// believes it can transmit** — on media that complete asynchronously
    /// (callback radios), acceptance is the contract, not completion.
    /// Delivery is never promised (4.4.1) and no completion is ever exposed
    /// upward (4.4.3). What 5.2.2 forbids is accepting while *known* unable:
    /// a full transmit queue, an exhausted airtime budget (9.2) or a down
    /// radio refuses (`Unavailable`/`Failed`) instead. A medium-level failure
    /// learned after acceptance is ordinary loss — it feeds `state()` and link
    /// quality, never a retroactive error.
    ///
    /// Blocking this call on a medium completion callback is non-conformant:
    /// where the callback reports the medium's own acknowledgement (ESP-NOW
    /// unicast, LoRa TxDone), waiting on it exposes that acknowledgement
    /// upward as a delivery signal, which 4.4.3 forbids.
    fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError>;

    /// Where this binding places an L2 announcement. Frame carriage is the
    /// common default; a binding with a distinct discovery primitive overrides
    /// this and implements its output operation below.
    fn announcement_carriage(&self) -> AnnouncementCarriage {
        AnnouncementCarriage::Frame
    }

    /// Place an opaque L2 announcement directly in medium framing.
    ///
    /// This is called only where [`Self::announcement_carriage`] is
    /// [`AnnouncementCarriage::Medium`]. It exists separately from
    /// [`Self::send`] so an advertisement cannot accidentally become an L4
    /// broadcast frame. Bindings using frame carriage retain `send` as their
    /// only transmit operation.
    fn publish_announcement(&mut self, _body: &[u8]) -> Result<(), AnnouncementError> {
        Err(AnnouncementError::Unsupported)
    }

    /// Drain one marked, out-of-frame L2 announcement from the receive side.
    fn poll_announcement(
        &mut self,
        _out: &mut [u8],
    ) -> Option<Result<(usize, AnnouncementMeta), AnnouncementError>> {
        None
    }

    /// Drain one received frame into `buf`, with medium wrapping removed.
    fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>>;

    /// Per-peer quality, or `None` where the peer is not addressable.
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality>;

    /// Visit every currently addressable peer.
    fn for_each_peer(&self, f: &mut dyn FnMut(HiveId, LinkQuality));

    /// Map a raw arrival measurement onto the normalised L1 quality scale.
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality>;
}

/// Every output-capable bearer is also an ingress. The inverse is deliberately
/// absent: a receive-only implementation has no route to `Bearer::send`.
impl<T: Bearer + ?Sized> Ingress for T {
    fn profile(&self) -> &BearerProfile {
        Bearer::profile(self)
    }
    fn state(&self) -> BearerState {
        Bearer::state(self)
    }
    fn max_payload(&self) -> u16 {
        Bearer::max_payload(self)
    }
    fn configure(
        &mut self,
        configuration: BindingConfiguration<'_>,
    ) -> Result<(), ConfigurationError> {
        Bearer::configure(self, configuration)
    }
    fn set_low_power(&mut self, low_power: bool) -> bool {
        Bearer::set_low_power(self, low_power)
    }
    fn in_low_power(&self) -> bool {
        Bearer::in_low_power(self)
    }
    fn poll_announcement(
        &mut self,
        out: &mut [u8],
    ) -> Option<Result<(usize, AnnouncementMeta), AnnouncementError>> {
        Bearer::poll_announcement(self, out)
    }
    fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
        Bearer::poll_recv(self, buf)
    }
    fn link_quality(&self, peer: HiveId) -> Option<LinkQuality> {
        Bearer::link_quality(self, peer)
    }
    fn for_each_peer(&self, f: &mut dyn FnMut(HiveId, LinkQuality)) {
        Bearer::for_each_peer(self, f)
    }
    fn quality_of_arrival(&self, hint: Option<i16>) -> Option<LinkQuality> {
        Bearer::quality_of_arrival(self, hint)
    }
}

/// The opaque L1 side of a regulated bearer scheduler (L1 9.4).
///
/// A Layer 2 scheduler receives only a window edge, remaining legal airtime,
/// and a quote for an exact prospective offer.  It does not receive the
/// budget, medium wrapper, CAD controls, or radio lifecycle; submission stays
/// the ordinary [`Bearer::send`] operation implemented by the binding.
///
/// The hive that owns this port must make it its sole regulated output path.
/// Passing the same object through a generic `Bearer` send loop would make
/// the L2 reservation advisory, because that loop could consume the reserved
/// airtime without being observed.
///
/// **L1 9.4 (`L1-061`): that interface shall not expose the binding's budget,
/// framing, medium-access control or radio lifecycle.** One block per
/// forbidden thing, each naming the accessor in this crate's own words, and
/// each compiles — going red — if `RegulatedBearer` (or `Bearer` beneath it)
/// gains that method, however it is defaulted. An accessor under another
/// name is caught only by the implementor block after them, and only where
/// it is required.
///
/// ```compile_fail,E0599
/// fn peek(port: &mut dyn r2_transport::l1::RegulatedBearer) { let _ = port.budget(); }
/// ```
///
/// ```compile_fail,E0599
/// fn peek(port: &mut dyn r2_transport::l1::RegulatedBearer) { let _ = port.framing(); }
/// ```
///
/// ```compile_fail,E0599
/// fn peek(port: &mut dyn r2_transport::l1::RegulatedBearer) { let _ = port.cad(); }
/// ```
///
/// ```compile_fail,E0599
/// fn peek(port: &mut dyn r2_transport::l1::RegulatedBearer) { let _ = port.radio(); }
/// ```
///
/// And the interface is exactly 9.4 a) to c) as two methods returning plain
/// values: an implementor providing `regulated_window` and `quote_airtime`
/// alone is complete, so a third *required* method of any name goes red here
/// (E0046), and a third field on [`RegulatedWindow`] — the budget itself,
/// say — fails the exhaustive destructuring (E0027):
///
/// ```
/// use r2_ident::HiveId;
/// use r2_transport::fade_rate::{FadeRate, FadeSource};
/// use r2_transport::l1::{
///     Bearer, BearerProfile, BearerState, Fade, LinkQuality, Ordinal, Reach, ReceiveError,
///     Receptivity, RegulatedBearer, RegulatedWindow, RxMeta, SendError, SendTarget, WireTier,
/// };
///
/// struct Scheduled {
///     profile: BearerProfile,
///     fresh: bool,
/// }
///
/// impl Bearer for Scheduled {
///     fn profile(&self) -> &BearerProfile {
///         &self.profile
///     }
///     fn state(&self) -> BearerState {
///         BearerState::Available
///     }
///     fn max_payload(&self) -> u16 {
///         *self.profile.max_payload.end()
///     }
///     fn send(&mut self, _target: SendTarget, _frame: &[u8]) -> Result<(), SendError> {
///         Ok(())
///     }
///     fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
///         None
///     }
///     fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
///         None
///     }
///     fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
///     fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
///         None
///     }
/// }
///
/// impl RegulatedBearer for Scheduled {
///     fn regulated_window(&mut self) -> RegulatedWindow {
///         RegulatedWindow {
///             new_window: core::mem::take(&mut self.fresh),
///             remaining_airtime_ms: 36_000,
///         }
///     }
///     fn quote_airtime(&self, _target: SendTarget, frame: &[u8]) -> Result<u32, SendError> {
///         Ok(frame.len() as u32 * 8)
///     }
/// }
///
/// let mut bearer = Scheduled {
///     profile: BearerProfile {
///         ordinal: Ordinal::Lora,
///         max_payload: 1..=222,
///         wire_tier: WireTier::Compact,
///         fade: Fade::Regulated(
///             FadeRate::derive(600, FadeSource::BudgetUnderLoad { longest_interval_s: 300 }).unwrap(),
///         ),
///         relative_cost: Ordinal::Lora.relative_cost(),
///         reach: Reach::LongRange,
///         receptivity: Receptivity::Continuous,
///         participates_in_discovery: true,
///         connection: None,
///     },
///     fresh: true,
/// };
/// let port: &mut dyn RegulatedBearer = &mut bearer;
/// let RegulatedWindow { new_window, remaining_airtime_ms } = port.regulated_window();
/// assert!(new_window);
/// assert_eq!(remaining_airtime_ms, 36_000);
/// assert!(!port.regulated_window().new_window, "the edge is consumed");
/// assert_eq!(port.quote_airtime(SendTarget::Broadcast, &[0; 10]), Ok(80));
/// ```
pub trait RegulatedBearer: Bearer {
    /// Observe the current legal window.  `new_window` is consumable: a
    /// second call before another roll returns `false`.
    fn regulated_window(&mut self) -> RegulatedWindow;

    /// A separately enforced deployment restraint, where this implementation
    /// has one. It cannot increase legal allowance. The default has no such
    /// restraint; never report a self-imposed ceiling as `regulated_window`.
    fn deployment_window(&mut self) -> Option<DeploymentWindow> {
        None
    }

    /// Quote the exact legal airtime cost of this prospective L1 offer after
    /// all binding framing.  A quote neither reserves nor spends airtime.
    fn quote_airtime(&self, target: SendTarget, frame: &[u8]) -> Result<u32, SendError>;
}

/// **The shortest transmission that could be a frame of `tier`.**
///
/// # ‼ WHY A BEARER NEEDS THIS AND WHY IT LIVES HERE
///
/// Every binding says it in its own Clause 2: *a transmission whose payload is
/// shorter than the compact tier's fixed fields **shall be discarded without
/// error***. **The bearer is the party bound**, because a bearer that passes a
/// runt upward has already done the damage the clause prevents — *it reports a
/// sender, and a sender reported is a neighbour learnt.* Ambient traffic on a
/// shared channel then populates a neighbour table with peers that never sent
/// a frame.
///
/// ‼ **AND A BEARER CANNOT REACH THE HEADER CONSTANTS ITSELF.** They are
/// Layer 4's, and the layering gate refuses a bearer that depends on Layer 4
/// — *the named upward edges in this workspace are exactly two:
/// `r2-transport -> r2-wire` (this one) and `r2-routing -> r2-wire`, each
/// carrying its own clause's argument since `D-226` split the old fused
/// `r2-mesh -> r2-wire` exception.* So the figure is derived here, from
/// `r2_wire`'s own constants rather than re-typed: **a second spelling of a
/// header length is a second thing to get wrong when the header changes.**
///
/// ⚠ **THIS IS THE FIXED FIELDS AND NOT A WHOLE FRAME.** A frame at this
/// length carries no payload and may carry no tag; the clause's test is
/// *could these bytes be a frame at all*, and anything more selective belongs
/// to the parser, which is entitled to refuse for its own reasons.
pub const fn minimum_carriable(tier: WireTier) -> usize {
    match tier {
        Tier::Compact => r2_wire::COMPACT_HEADER_LEN,
        Tier::Extended => r2_wire::EXTENDED_HEADER_LEN,
    }
}

/// **Could this reception be a frame of `tier` at all?** (each binding's 2.3).
///
/// **Named as a question rather than left as a comparison at each bearer**, so
/// `git grep could_carry_a_frame` finds every bearer that asked — and the ones
/// that never did.
pub const fn could_carry_a_frame(tier: WireTier, received_len: usize) -> bool {
    received_len >= minimum_carriable(tier)
}

#[cfg(test)]
mod fade_tests {
    use super::Fade;
    use crate::fade_rate::{FadeRate, FadeSource};

    /// The control: an unregulated fade is its seconds and says it is not
    /// regulated, so the accessors read the variant and not a constant.
    #[test]
    fn an_unregulated_fade_is_its_seconds_and_says_so() {
        let f = Fade::Unregulated { seconds: 30 };
        assert_eq!(f.seconds(), 30);
        assert!(!f.regulated());
        assert!(!f.is_passive());
    }

    #[test]
    fn passive_observation_retention_is_not_misrepresented_as_peer_fade() {
        let f = Fade::Passive {
            observation_retention_s: 3_961,
            regulated: true,
        };
        assert_eq!(f.seconds(), 3_961);
        assert!(f.regulated());
        assert!(f.is_passive());
        assert_eq!(
            f.observation_lifetime(),
            super::ObservationLifetime::PassiveRetention { seconds: 3_961 },
            "the L1--L2 boundary retains the meaning, not only the duration"
        );
    }

    /// ‼ **A REGULATED FADE REACHES THE PROFILE ONLY THROUGH `derive`** — the
    /// variant holds a [`FadeRate`], which has no other door — and it reports
    /// the derived value, not a re-typed one. The compile-time half of this
    /// test is the `compile_fail` block on [`Fade`].
    #[test]
    fn a_regulated_fade_reaches_the_profile_only_through_derive() {
        let rate = FadeRate::derive(
            600,
            FadeSource::BudgetUnderLoad {
                longest_interval_s: 300,
            },
        )
        .expect("a fade that exceeds its basis is accepted");
        let f = Fade::Regulated(rate);
        assert!(f.regulated());
        assert_eq!(f.seconds(), 600);
    }
}

#[cfg(test)]
mod low_power_tests {
    use super::*;

    struct Plain;
    impl Bearer for Plain {
        fn profile(&self) -> &BearerProfile {
            unreachable!("not exercised")
        }
        fn state(&self) -> BearerState {
            BearerState::Available
        }
        fn max_payload(&self) -> u16 {
            0
        }
        fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
            None
        }
        fn link_quality(&self, _peer: r2_ident::HiveId) -> Option<LinkQuality> {
            None
        }
        fn for_each_peer(&self, _f: &mut dyn FnMut(r2_ident::HiveId, LinkQuality)) {}
        fn send(&mut self, _t: SendTarget, _f: &[u8]) -> Result<(), SendError> {
            Ok(())
        }
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            // A test double measures nothing, and says so rather than claiming
            // a perfect link (`SS510`).
            None
        }
    }

    struct Sleepy {
        low: bool,
    }
    impl Bearer for Sleepy {
        fn profile(&self) -> &BearerProfile {
            unreachable!("not exercised")
        }
        fn state(&self) -> BearerState {
            BearerState::Available
        }
        fn max_payload(&self) -> u16 {
            0
        }
        fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
            None
        }
        fn link_quality(&self, _peer: r2_ident::HiveId) -> Option<LinkQuality> {
            None
        }
        fn for_each_peer(&self, _f: &mut dyn FnMut(r2_ident::HiveId, LinkQuality)) {}
        fn send(&mut self, _t: SendTarget, _f: &[u8]) -> Result<(), SendError> {
            Ok(())
        }
        fn set_low_power(&mut self, low_power: bool) -> bool {
            self.low = low_power;
            self.low == low_power
        }
        fn in_low_power(&self) -> bool {
            self.low
        }
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            // A test double measures nothing, and says so rather than claiming
            // a perfect link (`SS510`).
            None
        }
    }

    /// **L0 5.1.2 names FOUR operations** — transmit, receive, configure, and
    /// low power in and out — and the portable contract now exposes all four.
    #[test]
    fn a_binding_with_a_low_power_state_enters_and_leaves_it() {
        let mut s = Sleepy { low: false };
        assert!(!Bearer::in_low_power(&s));
        assert!(Bearer::set_low_power(&mut s, true));
        assert!(Bearer::in_low_power(&s));
        assert!(Bearer::set_low_power(&mut s, false));
        assert!(!Bearer::in_low_power(&s), "and back out again");
    }

    /// ‼ **`false` FOR A BINDING WITH NO LOW-POWER STATE IS THE HONEST ANSWER
    /// AND NOT A FAILURE.** L0 P2 declares whether the state *is implemented
    /// in the software as shipped*, so a platform declaring it absent and
    /// answering `false` here is consistent — and a bearer that overrides the
    /// default is claiming the state while one that does not is declining it.
    /// **Both are conformant**, which is why the default exists rather than
    /// the method being abstract.
    #[test]
    fn a_binding_without_one_declines_rather_than_pretending() {
        let mut p = Plain;
        assert!(
            !Bearer::set_low_power(&mut p, true),
            "it does not claim a state it lacks"
        );
        assert!(!Bearer::in_low_power(&p), "and never reports being in one");
    }

    struct ConfigurableIngress {
        applied: bool,
    }

    impl Ingress for ConfigurableIngress {
        fn profile(&self) -> &BearerProfile {
            unreachable!("not exercised")
        }
        fn state(&self) -> BearerState {
            BearerState::ReceiveOnly
        }
        fn max_payload(&self) -> u16 {
            0
        }
        fn configure(
            &mut self,
            configuration: BindingConfiguration<'_>,
        ) -> Result<(), ConfigurationError> {
            if configuration.version != 1 {
                return Err(ConfigurationError::Unsupported);
            }
            if configuration.parameters != b"listen" {
                return Err(ConfigurationError::Malformed);
            }
            self.applied = true;
            Ok(())
        }
        fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
            None
        }
        fn link_quality(&self, _peer: r2_ident::HiveId) -> Option<LinkQuality> {
            None
        }
        fn for_each_peer(&self, _f: &mut dyn FnMut(r2_ident::HiveId, LinkQuality)) {}
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            None
        }
    }

    #[test]
    fn configuration_is_versioned_and_never_silently_applied() {
        let mut ingress = ConfigurableIngress { applied: false };
        assert_eq!(
            Ingress::configure(
                &mut ingress,
                BindingConfiguration {
                    version: 2,
                    parameters: b"listen",
                },
            ),
            Err(ConfigurationError::Unsupported),
            "an unrecognised representation version cannot be reinterpreted"
        );
        assert!(!ingress.applied);
        assert_eq!(
            Ingress::configure(
                &mut ingress,
                BindingConfiguration {
                    version: 1,
                    parameters: b"other",
                },
            ),
            Err(ConfigurationError::Malformed),
            "a recognised representation still validates its opaque bytes"
        );
        assert!(!ingress.applied);
        assert_eq!(
            Ingress::configure(
                &mut ingress,
                BindingConfiguration {
                    version: 1,
                    parameters: b"listen",
                },
            ),
            Ok(())
        );
        assert!(ingress.applied, "only the accepted request changes state");

        // ‼ AND THE LIBRARY'S OWN DEFAULT MUST REFUSE (L1-140, added 2026-09-04 after an
        //   adversarial pass). Every assertion above runs against a double that OVERRIDES
        //   `configure`, so the default the trait ships — the one every real binding in
        //   this tree actually takes — was exercised by nothing here: making it silently
        //   accept left this test green. Measured. `Plain` overrides nothing, so it takes
        //   that default, and a binding fixed at construction must say so rather than
        //   report a change it did not make.
        let mut fixed = Plain;
        assert_eq!(
            Bearer::configure(
                &mut fixed,
                BindingConfiguration {
                    version: 1,
                    parameters: b"listen",
                },
            ),
            Err(ConfigurationError::Unsupported),
            "the shipped default refuses: silently accepting would report an applied \
             change that never happened, which is the one outcome 5.1.2 forbids"
        );
    }

    #[test]
    fn a_fixed_binding_explicitly_refuses_runtime_configuration() {
        let mut p = Plain;
        assert_eq!(
            Ingress::configure(
                &mut p,
                BindingConfiguration {
                    version: 1,
                    parameters: b"anything",
                },
            ),
            Err(ConfigurationError::Unsupported),
            "the Bearer-to-Ingress bridge preserves the explicit refusal"
        );
    }
}

#[cfg(test)]
mod airtime_tests {
    use super::AirtimeBudget;
    use r2_hal_traits::Ticks;

    fn budget() -> AirtimeBudget {
        // 1000 ms of airtime per 3600 s window — the shape of a 0.03 % duty
        // cycle, and the numbers are this test's rather than any region's.
        AirtimeBudget::new(1_000, 3_600, Ticks(0))
    }

    /// 9.3, and the control is that it permits what fits — a budget that
    /// refused everything would satisfy every refusal assertion.
    #[test]
    fn a_frame_within_the_budget_is_permitted_and_one_beyond_it_is_not() {
        let mut b = budget();
        assert!(b.permits(400));
        assert!(b.spend(400, Ticks(0), 1_000));
        assert_eq!(b.spent_ms(), 400);

        assert!(b.permits(600), "exactly filling the allowance is permitted");
        assert!(!b.permits(601), "one millisecond over is not");
    }

    /// ‼ **9.3 HAS NO EXCEPTION FOR URGENCY, AND THE API CANNOT EXPRESS
    /// ONE.** This test is a statement about the SIGNATURE rather than about
    /// a value: `permits` takes an airtime and nothing else, so a caller
    /// holding an urgent frame and a spent budget has one honest move.
    ///
    /// *Note 1: a budget with an exception for important traffic is a budget
    /// that is exceeded whenever traffic is important* — and the obligation
    /// is a legal one on the operator that the standard says it cannot grant
    /// relief from.
    #[test]
    fn an_exhausted_budget_refuses_every_frame_however_urgent() {
        let mut b = budget();
        assert!(b.spend(1_000, Ticks(0), 1_000));
        assert!(b.exhausted());
        // Every size, including the smallest possible, and there is no
        // argument this test could pass to ask for an exception.
        for airtime in [1, 10, 500, 1_000] {
            assert!(
                !b.permits(airtime),
                "{airtime} ms was permitted past the budget"
            );
        }
    }

    /// **A refusal spends nothing.** 9.3 forbids exceeding the budget *in
    /// order to send a frame*, so a refused frame must not leave the budget
    /// worse than it found it — otherwise a burst of refusals exhausts it
    /// without a single transmission.
    #[test]
    fn a_refused_frame_does_not_consume_the_budget() {
        let mut b = budget();
        assert!(b.spend(900, Ticks(0), 1_000));
        for _ in 0..50 {
            assert!(!b.spend(500, Ticks(0), 1_000), "too large to fit");
        }
        assert_eq!(b.spent_ms(), 900, "fifty refusals cost nothing");
        assert!(
            b.spend(100, Ticks(0), 1_000),
            "and what does fit still fits"
        );
    }

    /// The window rolls, because a budget that never refreshed would silence
    /// a bearer for ever after its first busy hour.
    #[test]
    fn the_allowance_refreshes_when_the_window_elapses() {
        let mut b = budget();
        assert!(b.spend(1_000, Ticks(0), 1_000));
        assert!(b.exhausted());

        // Inside the window, still exhausted.
        b.roll(Ticks(3_600_000), 1_000);
        assert!(b.exhausted(), "at the edge the window has not yet elapsed");

        b.roll(Ticks(3_600_001), 1_000);
        assert!(!b.exhausted(), "past it, the allowance is fresh");
        assert_eq!(b.spent_ms(), 0);
    }

    /// ‼ **A CLOCK THAT WENT BACKWARDS DOES NOT HAND A BEARER A FRESH
    /// ALLOWANCE.** Shared with L1 10.2, L2 6.3.1 and L3 7.4.2 through
    /// `Ticks::exceeded` — and this is the one direction of that fault that
    /// breaks a **legal** obligation rather than a local one.
    #[test]
    fn a_backwards_clock_does_not_refresh_the_allowance() {
        let mut b = budget();
        assert!(b.spend(1_000, Ticks(10_000_000), 1_000));
        b.roll(Ticks(0), 1_000);
        assert!(b.exhausted(), "the budget is still spent");
        assert!(!b.permits(1));
    }

    /// An airtime that overflows the counter is not affordable by any budget,
    /// and must not wrap into a small number that looks affordable.
    #[test]
    fn an_overflowing_airtime_is_refused_rather_than_wrapped() {
        let mut b = budget();
        assert!(b.spend(500, Ticks(0), 1_000));
        assert!(!b.permits(u32::MAX));
    }
}

#[cfg(test)]
mod connection_tests {
    use super::{ConnectionParams, SILENCE_PERIOD_MULTIPLE};
    use r2_hal_traits::Ticks;

    fn params() -> ConnectionParams {
        ConnectionParams {
            silence_period_s: 90,
            max_reattempt_interval_s: 300,
        }
    }

    /// **10.2 stated a behaviour and this type held only the period.** Every
    /// bearer in the tree sets `connection: None`, so the declaration existed
    /// and the treatment did not.
    #[test]
    fn a_peer_is_unreachable_only_after_the_silence_period_is_exceeded() {
        let p = params();
        let heard = Ticks(10_000);
        // 90 s at 1000 ticks/s, so the edge is t = 100_000 exactly.
        assert!(!p.unreachable_after_silence(heard, Ticks(100_000), 1_000));
        assert!(p.unreachable_after_silence(heard, Ticks(100_001), 1_000));
        // The control: a peer heard a moment ago is reachable, so the
        // predicate is not simply true.
        assert!(!p.unreachable_after_silence(heard, Ticks(11_000), 1_000));
    }

    /// ‼ **THE ARITHMETIC IS SHARED WITH L2's FADE AND L3's LIFETIME**, so a
    /// clock that went backwards is not a silent peer here either — and this
    /// test exists to pin that the sharing is real rather than described.
    #[test]
    fn a_clock_that_went_backwards_does_not_make_a_peer_unreachable() {
        assert!(!params().unreachable_after_silence(Ticks(100_000), Ticks(50_000), 1_000));
    }

    /// 10.3, and it CHECKS a declaration rather than enforcing a value —
    /// `L1-049` is `FLAGGED SS2`, and what the expected interval IS on a
    /// bearer whose peers speak at their own cadence is the open question.
    #[test]
    fn a_declared_silence_period_is_checked_against_its_floor() {
        assert_eq!(SILENCE_PERIOD_MULTIPLE, 3, "10.3: at least three times");
        let p = params();
        assert!(p.silence_period_is_sufficient(30), "90 is exactly 3x30");
        assert!(p.silence_period_is_sufficient(10));
        assert!(
            !p.silence_period_is_sufficient(40),
            "a bearer expecting a peer every 40 s needs at least 120"
        );
    }

    /// A period below its own floor treats peers as unreachable **while they
    /// are still speaking on schedule** — which looks from outside exactly
    /// like a flaky link, and is why the check is worth having at all.
    #[test]
    fn a_short_period_drops_a_peer_that_is_still_on_schedule() {
        let bad = ConnectionParams {
            silence_period_s: 30,
            max_reattempt_interval_s: 300,
        };
        assert!(!bad.silence_period_is_sufficient(30), "30 is not 3x30");
        // A peer speaking every 30 s, heard 31 s ago: on schedule, and this
        // declaration calls it unreachable.
        assert!(bad.unreachable_after_silence(Ticks(0), Ticks(31_000), 1_000));
    }
}

#[cfg(test)]
mod tests_binding_minimum {
    use super::{could_carry_a_frame, minimum_carriable};
    use r2_wire::Tier;

    /// ‼ **THE FIGURE IS LAYER 4's AND IS NOT RE-TYPED HERE.** A second
    /// spelling of a header length is a second thing to get wrong when the
    /// header changes, so the test compares against the same constants the
    /// function reads rather than against a number written twice.
    #[test]
    fn the_minimum_is_the_tier_s_own_fixed_fields() {
        assert_eq!(
            minimum_carriable(Tier::Compact),
            r2_wire::COMPACT_HEADER_LEN
        );
        assert_eq!(
            minimum_carriable(Tier::Extended),
            r2_wire::EXTENDED_HEADER_LEN
        );
        assert!(minimum_carriable(Tier::Extended) > minimum_carriable(Tier::Compact));
    }

    /// **2.3's boundary, from both sides.** *Shorter than the fixed fields* is
    /// discarded; exactly the fixed fields is not — a frame with no payload
    /// and no tag is short, not malformed, and refusing it here would be this
    /// layer deciding something the parser is entitled to decide.
    #[test]
    fn a_runt_is_refused_and_a_bare_header_is_not() {
        let m = minimum_carriable(Tier::Compact);
        assert!(!could_carry_a_frame(Tier::Compact, 0), "empty");
        assert!(
            !could_carry_a_frame(Tier::Compact, m - 1),
            "one octet short"
        );
        assert!(could_carry_a_frame(Tier::Compact, m), "exactly the fields");
        assert!(could_carry_a_frame(Tier::Compact, m + 1));
    }

    /// A compact-length reception on an extended bearer is still a runt: the
    /// tier decides the figure, and a bearer carries one tier (L4 9.1.3).
    #[test]
    fn the_tier_decides_the_figure() {
        let compact = minimum_carriable(Tier::Compact);
        assert!(!could_carry_a_frame(Tier::Extended, compact));
        assert!(could_carry_a_frame(Tier::Compact, compact));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: [Ordinal; 6] = [
        Ordinal::Ble,
        Ordinal::Lora,
        Ordinal::Tcp,
        Ordinal::Usb,
        Ordinal::WifiMesh,
        Ordinal::Udp,
    ];

    #[test]
    fn b9_is_readable_but_cannot_be_an_invalid_schedule() {
        let intermittent = IntermittentReceptivity::new(
            500,
            100,
            900,
            20,
            80,
            RendezvousBasis::ContinuousCounterpart,
        )
        .expect("a nonempty, ordered intermittent contract is readable");
        assert_eq!(intermittent.receptive_window_ms(), 500);
        assert_eq!(intermittent.next_window_delay_ms(), (100, 900));
        assert_eq!(intermittent.transmit_delay_ms(), (20, 80));
        assert_eq!(intermittent.basis(), RendezvousBasis::ContinuousCounterpart);
        assert_eq!(intermittent.longest_window_start_interval_ms(), 1_400);
        let widest =
            IntermittentReceptivity::new(u32::MAX, 1, u32::MAX, 1, 2, RendezvousBasis::Autonomous)
                .expect("the components are individually representable");
        assert_eq!(
            widest.longest_window_start_interval_ms(),
            u64::from(u32::MAX) * 2,
            "the derived longest gap is never silently understated by u32 saturation"
        );
        assert_eq!(
            IntermittentReceptivity::new(0, 1, 2, 1, 2, RendezvousBasis::Autonomous),
            Err(ReceptivityRefusal::EmptyWindow)
        );
        assert_eq!(
            IntermittentReceptivity::new(1, 2, 1, 1, 2, RendezvousBasis::Autonomous),
            Err(ReceptivityRefusal::InvertedNextWindowRange)
        );
        assert_eq!(
            IntermittentReceptivity::new(1, 1, 2, 2, 1, RendezvousBasis::Autonomous),
            Err(ReceptivityRefusal::InvertedTransmitRange)
        );
    }

    #[test]
    fn registry_bits_and_reserved_ordinal() {
        assert_eq!(Ordinal::Ble.bit(), 0x01);
        assert_eq!(Ordinal::Lora.bit(), 0x04);
        assert_eq!(Ordinal::Tcp.bit(), 0x08);
        assert_eq!(Ordinal::Usb.bit(), 0x10);
        assert_eq!(Ordinal::WifiMesh.bit(), 0x20);
        assert_eq!(Ordinal::Udp.bit(), 0x40);
        // 8.3.1: ordinal 1 is reserved and unassignable.
        assert_eq!(Ordinal::from_u8(1), None);
        assert_eq!(Ordinal::from_u8(7), None);
        let live_bits = LIVE.iter().fold(0u8, |s, o| s | o.bit());
        assert_eq!(live_bits, ASSIGNABLE_BEARERS); // 8.2.2: the set is 0x7D
        assert_eq!(ASSIGNABLE_BEARERS | 0x02, BEARER_FIELD_MASK); // 0x7F = width
    }

    /// L1 8.2.1, 8.2.3 (`L1-035`): **the registry lives in the standard, and
    /// `Ordinal` is a second spelling of it.** `registry_bits_and_reserved_ordinal`
    /// above pins the enum to bit LITERALS retyped here; nothing pinned it to the
    /// DOCUMENT, so the two could drift and every test stay green (review
    /// 2026-09-03, `notes/REVIEW-20260903.md` §2.i). This reads the table rows out
    /// of `standard/L1-transport.md` and requires every assigned ordinal's five
    /// columns to match the enum, and every unassigned row to be unrepresentable.
    /// An edit on either side goes red here.
    #[test]
    fn the_ordinal_enum_is_the_registry_table_in_the_standard() {
        const DOC: &str = include_str!("../../../../../../standard/L1-transport.md");
        fn digits(cell: &str) -> Option<u32> {
            let mut v: u32 = 0;
            let mut any = false;
            for ch in cell.chars() {
                if let Some(d) = ch.to_digit(10) {
                    v = v.checked_mul(10)?.checked_add(d)?;
                    any = true;
                } else if ch != ' ' && ch != 'B' {
                    return None;
                }
            }
            any.then_some(v)
        }
        let mut rows = 0u8;
        for line in DOC.lines() {
            // | 0 | `0x01` | `ble` | proximity | compact | 200 B | 1 |
            let mut cells = line.split('|').map(str::trim);
            if cells.next() != Some("") {
                continue;
            }
            let Some(ord) = cells.next().and_then(|c| c.parse::<u8>().ok()) else {
                continue;
            };
            let Some(bit) = cells
                .next()
                .and_then(|c| u8::from_str_radix(c.trim_matches('`').strip_prefix("0x")?, 16).ok())
            else {
                continue;
            };
            let label = cells.next().unwrap_or("").trim_matches('`');
            let reach = cells.next().unwrap_or("");
            let tier = cells.next().unwrap_or("");
            let payload = cells.next().unwrap_or("");
            let cost = cells.next().unwrap_or("");
            rows += 1;
            match Ordinal::from_u8(ord) {
                None => assert_eq!(
                    label, "—",
                    "ordinal {ord}: unassigned in the table, so unrepresentable"
                ),
                Some(o) => {
                    assert_eq!(o.bit(), bit, "ordinal {ord}: bit");
                    assert_eq!(o.label(), label, "ordinal {ord}: label");
                    let want_reach = match reach {
                        "proximity" => Reach::Proximity,
                        "long-range" => Reach::LongRange,
                        "global" => Reach::Global,
                        "point-to-point" => Reach::PointToPoint,
                        "local" => Reach::Local,
                        other => {
                            panic!("ordinal {ord}: reach word {other:?} is not one this test knows")
                        }
                    };
                    assert_eq!(o.reach(), want_reach, "ordinal {ord}: reach");
                    let want_tier = match tier {
                        "compact" => Tier::Compact,
                        "extended" => Tier::Extended,
                        other => {
                            panic!("ordinal {ord}: tier word {other:?} is not one this test knows")
                        }
                    };
                    assert_eq!(o.wire_tier(), want_tier, "ordinal {ord}: wire tier");
                    assert_eq!(
                        u32::from(o.largest_payload()),
                        digits(payload).expect("a payload figure"),
                        "ordinal {ord}: largest payload"
                    );
                    assert_eq!(
                        u32::from(o.relative_cost()),
                        digits(cost).expect("a cost figure"),
                        "ordinal {ord}: relative cost"
                    );
                }
            }
        }
        assert_eq!(
            rows, 7,
            "the registry has seven rows, 0 through 6; a new bearer lands in BOTH places"
        );
    }

    #[test]
    fn registry_values_match_l1_8_2_1() {
        assert_eq!(LIVE.len(), 6, "L1 8.2.1 has six live ordinals");
        for o in LIVE {
            let (payload, cost, tier) = match o {
                Ordinal::Ble => (200, 1, Tier::Compact),
                Ordinal::Lora => (222, 5, Tier::Compact),
                Ordinal::Tcp => (65_535, 8, Tier::Extended),
                Ordinal::Usb => (255, 0, Tier::Compact),
                Ordinal::WifiMesh => (250, 9, Tier::Compact),
                Ordinal::Udp => (65_535, 8, Tier::Extended),
            };
            assert_eq!(o.largest_payload(), payload, "{}", o.label());
            assert_eq!(o.relative_cost(), cost, "{}", o.label());
            assert_eq!(o.wire_tier(), tier, "{}", o.label());
        }
    }

    /// Minimal in-memory bearer proving the contract is implementable
    /// sans-IO and object-safe (`&mut dyn Bearer` works).
    struct LoopbackBearer {
        profile: BearerProfile,
        queued: Option<([u8; 64], usize, RxMeta)>,
        peer: HiveId,
    }

    impl Bearer for LoopbackBearer {
        fn profile(&self) -> &BearerProfile {
            &self.profile
        }
        fn state(&self) -> BearerState {
            BearerState::Available
        }
        fn max_payload(&self) -> u16 {
            *self.profile.max_payload.end()
        }
        fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
            let (bytes, len, meta) = self.queued.take()?;
            if buf.len() < len {
                self.queued = Some((bytes, len, meta));
                return Some(Err(ReceiveError::OutputTooSmall { needed: len }));
            }
            buf[..len].copy_from_slice(&bytes[..len]);
            Some(Ok((len, meta)))
        }
        fn link_quality(&self, peer: HiveId) -> Option<LinkQuality> {
            (peer == self.peer).then(|| LinkQuality::new(1.0))
        }
        fn for_each_peer(&self, f: &mut dyn FnMut(HiveId, LinkQuality)) {
            f(self.peer, LinkQuality::new(1.0));
        }
        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            // A test double measures nothing, and says so rather than claiming
            // a perfect link (`SS510`).
            None
        }

        fn send(&mut self, target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
            if frame.len() > Bearer::max_payload(self) as usize {
                return Err(SendError::Oversize); // 6.3: reject, never fragment
            }
            if let SendTarget::Hive(h) = target {
                if h != self.peer {
                    return Err(SendError::UnknownPeer);
                }
            }
            let mut buf = [0u8; 64];
            buf[..frame.len()].copy_from_slice(frame);
            self.queued = Some((
                buf,
                frame.len(),
                RxMeta {
                    sender: SenderIdentity::Canonical(self.peer),
                    quality_hint: Some(-40),
                },
            ));
            Ok(())
        }
    }

    /// A deliberate passive ingress: unlike `Unavailable`, this is not a
    /// sender awaiting recovery. Its lack of an output path is structural.
    struct ReceiveOnlyIngress {
        profile: BearerProfile,
    }

    impl Ingress for ReceiveOnlyIngress {
        fn profile(&self) -> &BearerProfile {
            &self.profile
        }
        fn state(&self) -> BearerState {
            BearerState::ReceiveOnly
        }
        fn max_payload(&self) -> u16 {
            *self.profile.max_payload.end()
        }
        fn poll_recv(&mut self, _buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
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

    /// **D-247's negative control:** a receive-only ingress exposes no output
    /// method and no addressable peer. It cannot silently become an ordinary
    /// sender because it implements only the receive-side contract.
    #[test]
    fn a_receive_only_ingress_has_no_output_capability_and_exposes_no_peer() {
        let ingress = ReceiveOnlyIngress {
            profile: BearerProfile {
                ordinal: Ordinal::Lora,
                max_payload: 1..=222,
                wire_tier: Tier::Compact,
                fade: Fade::Passive {
                    observation_retention_s: 60,
                    regulated: true,
                },
                relative_cost: Ordinal::Lora.relative_cost(),
                reach: Reach::LongRange,
                receptivity: Receptivity::Continuous,
                participates_in_discovery: false,
                connection: None,
            },
        };
        assert_eq!(ingress.state(), BearerState::ReceiveOnly);
        assert!(!ingress.profile().participates_in_discovery);
        let mut peers = 0;
        ingress.for_each_peer(&mut |_, _| peers += 1);
        assert_eq!(peers, 0, "a passive ingress has no next-hop peer");
    }

    /// ‼ **L1 5.1: A BEARER SHALL REPORT ALL FIVE — ordinal, state,
    /// maximum transport unit payload, link quality per peer, and
    /// addressable peers.** The row said *only part exercised in the mock
    /// test*, and **a partly-exercised surface is a surface whose unread
    /// half nobody has checked reports anything at all.**
    ///
    /// All five are read here, and each is asserted against a value the
    /// fixture chose — *not merely called*, because a method returning a
    /// default satisfies a call and reports nothing.
    #[test]
    fn a_bearer_reports_every_one_of_the_five_things_5_1_requires() {
        let peer = HiveId([7; 8]);
        let mut b = LoopbackBearer {
            profile: BearerProfile {
                ordinal: Ordinal::Usb,
                max_payload: 16..=32,
                wire_tier: Tier::Compact,
                fade: Fade::Unregulated { seconds: 30 },
                relative_cost: 0,
                reach: Reach::PointToPoint,
                receptivity: Receptivity::Continuous,
                // 4.6.2a: a bearer that does not support broadcast shall not
                // participate in discovery. This fixture is point-to-point, so
                // `false` is the honest value — and it is the only `false` in
                // the tree, which is what stops the field being a constant
                // nothing discriminates on.
                participates_in_discovery: false,
                connection: None,
            },
            queued: None,
            peer,
        };
        let bearer: &dyn Bearer = &b;

        // 1) ordinal, 2) state, 3) max payload.
        assert_eq!(bearer.profile().ordinal, Ordinal::Usb);
        assert_eq!(bearer.state(), BearerState::Available);
        assert_eq!(bearer.max_payload(), 32);

        // 4) link quality PER PEER — and the per-peer half is the half
        // worth asserting: a stranger gets `None`, not a default.
        assert_eq!(bearer.link_quality(peer), Some(LinkQuality::new(1.0)));
        assert_eq!(
            bearer.link_quality(HiveId([9; 8])),
            None,
            "5.3.1: reported for each peer it CAN REACH, and not for others"
        );

        // 5) addressable peers, visited.
        let mut seen = 0usize;
        bearer.for_each_peer(&mut |p, q| {
            assert_eq!(p, peer);
            assert!((0.0..=1.0).contains(&q.0), "5.3.1: within [0, 1]");
            seen += 1;
        });
        assert_eq!(seen, 1, "the peer set is visited, not merely offered");

        // Silence the unused-mut warning the fixture needs for `send`.
        let _ = &mut b;
    }

    /// ‼ **L3 8.3: THIS LAYER SHALL NOT REQUIRE THE LAYERS BELOW TO
    /// INTERPRET ANY FRAME**, and the assertion is the shape of the
    /// signature rather than a comment.
    ///
    /// `send` takes `&[u8]` and `poll_recv` fills `&mut [u8]`. **Neither
    /// mentions a frame, a tier, a header or a target beyond the medium's
    /// own addressing** — so a bearer *cannot* interpret a frame, having
    /// never been given one to interpret. The round trip below sends bytes
    /// that are **not a valid frame at all** and requires them back
    /// unchanged: *a bearer that parsed what it carried would have to
    /// refuse these, and it does not.*
    #[test]
    fn the_layer_below_is_handed_bytes_it_could_not_interpret() {
        let peer = HiveId([7; 8]);
        let mut b = LoopbackBearer {
            profile: BearerProfile {
                ordinal: Ordinal::Usb,
                max_payload: 16..=32,
                wire_tier: Tier::Compact,
                fade: Fade::Unregulated { seconds: 30 },
                relative_cost: 0,
                reach: Reach::PointToPoint,
                receptivity: Receptivity::Continuous,
                // 4.6.2a: a bearer that does not support broadcast shall not
                // participate in discovery. This fixture is point-to-point, so
                // `false` is the honest value — and it is the only `false` in
                // the tree, which is what stops the field being a constant
                // nothing discriminates on.
                participates_in_discovery: false,
                connection: None,
            },
            queued: None,
            peer,
        };
        let bearer: &mut dyn Bearer = &mut b;
        // Deliberately NOT a frame: a lone 0xFF byte is not a valid header
        // in either tier.
        let nonsense = [0xFFu8; 17];
        bearer
            .send(SendTarget::Hive(peer), &nonsense)
            .expect("carried, not parsed");
        let mut buf = [0u8; 64];
        let (n, _) = bearer
            .poll_recv(&mut buf)
            .expect("queued")
            .expect("delivered");
        assert_eq!(
            &buf[..n],
            &nonsense,
            "8.3: carried exactly, interpreted not at all"
        );
    }

    #[test]
    fn bearer_contract_round_trip_and_refusals() {
        let peer = HiveId([7; 8]);
        let mut b = LoopbackBearer {
            profile: BearerProfile {
                ordinal: Ordinal::Usb,
                max_payload: 16..=32,
                wire_tier: Tier::Compact,
                fade: Fade::Unregulated { seconds: 30 },
                relative_cost: 0,
                reach: Reach::PointToPoint,
                receptivity: Receptivity::Continuous,
                // 4.6.2a: a bearer that does not support broadcast shall not
                // participate in discovery. This fixture is point-to-point, so
                // `false` is the honest value — and it is the only `false` in
                // the tree, which is what stops the field being a constant
                // nothing discriminates on.
                participates_in_discovery: false,
                connection: None,
            },
            queued: None,
            peer,
        };
        let bearer: &mut dyn Bearer = &mut b; // object safety

        // 4.2.1: delivered bytes exactly as handed down.
        bearer.send(SendTarget::Hive(peer), b"exact bytes").unwrap();
        let mut buf = [0u8; 64];
        let (n, meta) = bearer.poll_recv(&mut buf).unwrap().unwrap();
        assert_eq!(&buf[..n], b"exact bytes");
        assert_eq!(meta.sender, SenderIdentity::Canonical(peer));

        // 6.3: oversize refused, never fragmented; unknown peer refused.
        assert_eq!(
            bearer.send(SendTarget::Broadcast, &[0; 33]),
            Err(SendError::Oversize)
        );
        assert_eq!(
            bearer.send(SendTarget::Hive(HiveId([9; 8])), b"x"),
            Err(SendError::UnknownPeer)
        );
        assert!(bearer.poll_recv(&mut buf).is_none());
    }

    #[test]
    fn medium_identity_stability_is_explicit() {
        // A rotating BLE address is a delivery handle, not an identity.
        let rotating = SenderIdentity::Medium {
            addr: MediumAddress::new(&[1, 2, 3, 4, 5, 6]).unwrap(),
            stable: false,
        };
        match rotating {
            SenderIdentity::Medium { stable, addr } => {
                assert!(!stable);
                assert_eq!(addr.as_bytes().len(), 6);
            }
            SenderIdentity::Canonical(_) => unreachable!(),
        }
    }

    #[test]
    fn quality_clamps() {
        assert_eq!(LinkQuality::new(1.5).0, 1.0);
        assert_eq!(LinkQuality::new(-0.1).0, 0.0);
        assert_eq!(LinkQuality::new(f32::NAN).0, 0.0);
    }

    /// ‼ **ONE SHAPE, TWO UNITS — 5.3.1 IS THE PARENT AND EACH BINDING'S
    /// 6a.2 IS ITS INSTANCE.** BLE maps dBm, LoRa maps dB of
    /// signal-to-noise. *The contract is the same and lived in two places
    /// until 2026-08-18*; the LoRa half additionally derived its value from
    /// the wrong measure entirely (`BND3-040`).
    #[test]
    fn a_quality_scale_clamps_both_ends_and_is_monotonic_in_its_measure() {
        // The LoRa SNR scale: SX1262's SF12 demodulator floor to a strong
        // bench signal.
        let snr = QualityScale {
            floor: -20,
            ceiling: 10,
        };
        assert_eq!(snr.quality(-20).unwrap().0, 0.0);
        assert_eq!(snr.quality(10).unwrap().0, 1.0);
        assert_eq!(snr.quality(-40).unwrap().0, 0.0, "clamped below");
        assert_eq!(snr.quality(40).unwrap().0, 1.0, "clamped above");

        let mut last = -1.0;
        for db in -40..=40 {
            let q = snr.quality(db).unwrap().0;
            assert!(q >= last, "fell at {db} dB: {q} < {last}");
            assert!((0.0..=1.0).contains(&q));
            last = q;
        }

        // The BLE dBm scale is the same object with different numbers, which
        // is the point of having one type.
        let rssi = QualityScale {
            floor: -100,
            ceiling: -40,
        };
        assert_eq!(rssi.quality(-70).unwrap().0, 0.5);
    }

    /// **An inverted or degenerate scale refuses rather than normalising.**
    /// Both produce a monotonic-LOOKING mapping — one monotonic the wrong
    /// way, the other constant — and *a link quality that does not vary with
    /// the measure is indistinguishable from a radio that is not measuring.*
    #[test]
    fn an_unusable_quality_scale_refuses() {
        assert!(QualityScale {
            floor: 10,
            ceiling: -20
        }
        .quality(0)
        .is_none());
        assert!(QualityScale {
            floor: 0,
            ceiling: 0
        }
        .quality(0)
        .is_none());
        assert!(QualityScale {
            floor: 0,
            ceiling: 1
        }
        .is_usable());
    }

    /// **`L1-037` (L1 8.4.1): a new bearer is given the lowest unassigned
    /// ordinal, so the registry as it stands has no unassigned ordinal below
    /// an assigned one except a reserved one (8.3.1).**
    /// `the_ordinal_enum_is_the_registry_table_in_the_standard` pins each
    /// row's values; nothing stated the rule the rows must obey. For every
    /// assigned ordinal `n`, every `m < n` is assigned or reserved, with the
    /// reserved set read from the constants rather than retyped. Goes red
    /// when a bearer lands above a gap (e.g. `Udp = 7` with ordinal 6 left
    /// unassigned).
    #[test]
    fn every_ordinal_below_an_assigned_one_is_assigned_or_reserved() {
        let reserved = BEARER_FIELD_MASK & !ASSIGNABLE_BEARERS;
        assert_eq!(reserved, 0x02, "8.3.1: one reserved ordinal, ordinal 1");
        let is_reserved = |m: u8| reserved & (1u8 << m) != 0;
        let is_assigned = |m: u8| Ordinal::from_u8(m).is_some();
        let mut assigned = 0usize;
        for n in 0..8u8 {
            if !is_assigned(n) {
                continue;
            }
            assigned += 1;
            assert!(!is_reserved(n), "ordinal {n} is both assigned and reserved");
            for m in 0..n {
                assert!(
                    is_assigned(m) || is_reserved(m),
                    "8.4.1: ordinal {n} is assigned while {m} below it is neither assigned nor reserved"
                );
            }
        }
        assert_eq!(assigned, LIVE.len(), "every live ordinal was examined");
    }
    /// ‼ **L2 7.2.2's ANTECEDENT, ANSWERED PER BINDING — AND THE `false` IS
    /// THE ASSERTION THAT MATTERS.** *A scanner shall obtain the class by
    /// asking, where the bearer provides a means to ask.* Roy ruled on
    /// 2026-09-05: yes on ESP-NOW and BLE, no on LoRa.
    ///
    /// A test that only checked the `true` cases would pass against a function
    /// returning `true` unconditionally, which is the reading L2 12.1
    /// explicitly declines to adopt — *it worries about airtime, and the
    /// airtime is LoRa's.* So LoRa is asserted first and by name.
    ///
    /// The sweep over every ordinal is the second half: a binding added later
    /// must be CONSIDERED rather than inheriting an answer from a catch-all
    /// arm, and this fails to compile if one is added without a decision.
    #[test]
    fn only_lora_declines_to_provide_a_query_and_every_binding_is_decided() {
        assert!(
            !Ordinal::Lora.provides_a_query(),
            "‼ L2 12.1: on LoRa a round trip is a meaningful share of an hour's \
             frames at SF12, and L3 5.1.1 makes every hive a relay, so the cost \
             lands on traffic that is not the asker's"
        );
        assert!(
            Ordinal::WifiMesh.provides_a_query(),
            "ESP-NOW: a unicast exchange"
        );
        assert!(Ordinal::Ble.provides_a_query(), "BLE: a connection");

        // Every ordinal is decided, and exactly one declines. A count rather
        // than a list, so adding a binding that declines does not silently
        // pass by matching an expected name.
        let all = [
            Ordinal::Ble,
            Ordinal::Lora,
            Ordinal::Tcp,
            Ordinal::Udp,
            Ordinal::Usb,
            Ordinal::WifiMesh,
        ];
        assert_eq!(
            all.iter().filter(|o| !o.provides_a_query()).count(),
            1,
            "exactly one binding declines, and it is the one with the airtime argument"
        );
        // ‼ AND THE POPULATION CONTROL: the array must be every ordinal there
        //   is, or the sweep above proves nothing about the ones it omits.
        assert_eq!(
            all.len(),
            (0u8..=255).filter_map(Ordinal::from_u8).count(),
            "the sweep must cover every registry ordinal"
        );
    }

    /// ‼ **5.1.2's LOW-POWER OPERATION EXISTS TWICE AND BOTH COPIES ARE
    /// EXERCISED HERE.** `Bearer` is not a subtrait of `Ingress`, so each
    /// declares its own defaulted `set_low_power`/`in_low_power`. A mutation
    /// inverting BOTH left all 161 tests green: the only fixture implemented
    /// `Bearer`, and the row's falsifier called the `Bearer` method fully
    /// qualified, so **`Ingress`'s copy was reachable by no test in the
    /// crate.**
    ///
    /// The traits are separate for a reason — `Bearer` is `Ingress` plus
    /// `send`, so `Ingress` is the receive-only half — but that reason does
    /// not make two copies of one default safe, only necessary.
    ///
    /// Two doubles, each implementing ONLY its trait's required methods, so
    /// the defaults are the code under test rather than something a fixture
    /// overrode. *A test against a double that reimplements the thing under
    /// test measures the double.*
    ///
    /// The final assertion is the one that keeps them from drifting: the two
    /// copies must give the SAME answer. **Duplication that is checked is
    /// survivable; duplication that is not is a disagreement waiting for a
    /// reader to meet one half.**
    #[test]
    fn the_two_low_power_defaults_agree_and_both_are_reached() {
        struct BearerOnly;
        impl Bearer for BearerOnly {
            fn profile(&self) -> &BearerProfile {
                unreachable!("the low-power defaults do not consult it")
            }
            fn state(&self) -> BearerState {
                BearerState::Available
            }
            fn max_payload(&self) -> u16 {
                0
            }
            fn send(&mut self, _t: SendTarget, _f: &[u8]) -> Result<(), SendError> {
                Err(SendError::Unavailable)
            }
            fn poll_recv(
                &mut self,
                _b: &mut [u8],
            ) -> Option<Result<(usize, RxMeta), ReceiveError>> {
                None
            }
            fn link_quality(&self, _p: HiveId) -> Option<LinkQuality> {
                None
            }
            fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
            fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
                None
            }
        }

        struct IngressOnly;
        impl Ingress for IngressOnly {
            fn profile(&self) -> &BearerProfile {
                unreachable!("the low-power defaults do not consult it")
            }
            fn state(&self) -> BearerState {
                BearerState::Available
            }
            fn max_payload(&self) -> u16 {
                0
            }
            fn poll_recv(
                &mut self,
                _b: &mut [u8],
            ) -> Option<Result<(usize, RxMeta), ReceiveError>> {
                None
            }
            fn link_quality(&self, _p: HiveId) -> Option<LinkQuality> {
                None
            }
            fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
            fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
                None
            }
        }

        let mut b = BearerOnly;
        let mut i = IngressOnly;
        // A binding that declines the state says so, and says it the same way
        // on both traits. `set_low_power` returning false is the DECLINING
        // answer: the operation is exposed (5.1.2) and the state is refused.
        assert!(!Bearer::set_low_power(&mut b, true), "Bearer declines");
        assert!(!Ingress::set_low_power(&mut i, true), "Ingress declines");
        assert!(!Bearer::in_low_power(&b), "and reports itself not in it");
        assert!(!Ingress::in_low_power(&i), "and so does the other copy");
        // ‼ THE ANTI-DRIFT ASSERTION. Not `both are false` — *both are the
        //   same*, so a deliberate change to one is caught rather than a
        //   change away from a literal nobody may alter.
        assert_eq!(
            Bearer::set_low_power(&mut b, true),
            Ingress::set_low_power(&mut i, true),
            "5.1.2 is one obligation and these are two copies of it"
        );
        assert_eq!(
            Bearer::in_low_power(&b),
            Ingress::in_low_power(&i),
            "5.1.2 is one obligation and these are two copies of it"
        );
    }

    /// ‼ **6a.2's CLAMP, ASSERTED WHERE IT IS VISIBLE.** *The derivation shall
    /// map a stated floor to 0.0 and a stated ceiling to 1.0, and shall clamp
    /// outside them.*
    ///
    /// The assertions are on [`QualityScale::quality_ratio`] and NOT on
    /// `quality`, and that is the whole repair. `LinkQuality::new` clamps into
    /// `[0, 1]` as a type invariant, so **through `quality` the two branches
    /// below are invisible**: deleting both left every test in this crate green
    /// while the raw ratio went negative below the floor and past one above the
    /// ceiling, and the type quietly repaired it. *A guard whose only
    /// observable effect is produced by a second guard is tested by nothing.*
    ///
    /// The final pair is the backstop, kept deliberately: the type still
    /// repairs an out-of-range value, because removing that would let any other
    /// caller construct one.
    #[test]
    fn the_derivation_clamps_before_the_type_does_and_both_are_asserted() {
        // BLE's shape: dBm, floor -95, ceiling -30.
        let s = QualityScale {
            floor: -95,
            ceiling: -30,
        };
        assert!(s.is_usable());

        // BND3-041: the endpoints map exactly.
        assert_eq!(s.quality_ratio(-95), Some(0.0), "the floor maps to 0.0");
        assert_eq!(s.quality_ratio(-30), Some(1.0), "the ceiling maps to 1.0");

        // ‼ BND2-049 / BND3-042: OUTSIDE the endpoints, and this is the arm the
        //   type used to hide. Without the branches these are -0.53 and +1.46.
        assert_eq!(s.quality_ratio(-130), Some(0.0), "far below the floor");
        assert_eq!(s.quality_ratio(0), Some(1.0), "far above the ceiling");

        // Monotonic in between, and strictly inside the endpoints.
        let mid = s.quality_ratio(-62).expect("usable");
        assert!(mid > 0.0 && mid < 1.0, "{mid}");
        assert!(s.quality_ratio(-70).unwrap() < mid);
        assert!(s.quality_ratio(-50).unwrap() > mid);

        // An unusable scale derives nothing rather than normalising.
        assert_eq!(
            QualityScale {
                floor: -30,
                ceiling: -95
            }
            .quality_ratio(-50),
            None
        );
        assert_eq!(
            QualityScale {
                floor: -50,
                ceiling: -50
            }
            .quality_ratio(-50),
            None
        );

        // THE BACKSTOP, still in place: the type repairs anything a different
        // caller hands it, including NaN.
        assert_eq!(LinkQuality::new(-2.0), LinkQuality::new(0.0));
        assert_eq!(LinkQuality::new(9.0), LinkQuality::new(1.0));
        assert_eq!(LinkQuality::new(f32::NAN), LinkQuality::new(0.0));
    }
}

#[cfg(test)]
mod sleep_accounting_tests {
    use super::*;

    #[test]
    fn repeated_sleep_preserves_spending_and_original_expiry() {
        let mut b = AirtimeBudget::new(36_000, 3600, Ticks(0));
        assert!(b.spend(10_000, Ticks(0), 1000));
        let mut words = b.checkpoint(Ticks(100_000), 1000).unwrap();
        for _ in 0..10 {
            let mut next = AirtimeBudget::new(36_000, 3600, Ticks(0));
            assert!(next.restore(words, Ticks(5000), 1000, 180_000));
            assert_eq!(next.spent_ms(), 10_000);
            assert!(!next.permits(26_001));
            words = next.checkpoint(Ticks(15_000), 1000).unwrap();
            b = next;
        }
        assert_eq!(u64::from(words[3]), 1_600_000);
        assert!(!b.roll(Ticks(1_615_000), 1000));
        assert!(b.roll(Ticks(1_615_001), 1000));
        assert_eq!(b.spent_ms(), 0);
        assert!(b.spend(36_000, Ticks(1_615_001), 1000));
        assert!(!b.roll(Ticks(1_675_002), 1000));
        assert!(b.roll(Ticks(5_215_002), 1000));
    }

    #[test]
    fn invalid_checkpoint_preserves_withheld_budget() {
        let mut b = AirtimeBudget::new(100, 60, Ticks(0));
        b.withhold_current_window();
        let original = b;
        for words in [
            [101, 60, 100, 60_000, 0],
            [100, 61, 100, 60_000, 0],
            [100, 60, 101, 60_000, 0],
            [100, 60, 100, 0, 0],
            [100, 60, 100, 60_001, 0],
        ] {
            assert!(!b.restore(words, Ticks(0), 1000, 0));
            assert_eq!(b, original);
        }
        assert!(b.exhausted());
        assert_eq!(b.checkpoint(Ticks(0), 0), None);
        assert!(b.restore([100, 60, 100, 60_000, 0], Ticks(0), 1000, 60_000));
        assert_eq!(b.spent_ms(), 0);
    }
}
