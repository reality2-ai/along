//! Sensors and peripherals (L0 5.6).
//!
//! ## 5.6.2 decides the shape of the return type
//!
//! *"A platform providing none of these shall report them as
//! **unsupported**, and shall **not report an error**."* Note 1 says why,
//! and it is an operational difference rather than a naming preference:
//!
//! > *Unsupported* is a **fixed property of the platform**, which a
//! > higher layer can act on once and remember. *Error* is a **passing
//! > condition**, which a higher layer will retry — for as long as it
//! > keeps being told to.
//!
//! So this is not `Result<T, E>` with an `Unsupported` variant in `E`.
//! That shape is the clause's violation written down: every caller with a
//! retry loop treats the whole `Err` arm as transient, and a device with
//! no such sensor is then polled for ever. [`Reading`] separates the two
//! at the type, so a caller must *choose* what to do about a permanent
//! absence and cannot reach it by falling through an error path.
//!
//! ## 5.6.3 and the unit trap
//!
//! *"A platform should present sensor values in SI units."* [`Length`]
//! has **one canonical representation** and **named constructors**, so a
//! number cannot be handed over without saying what it is.
//!
//! That is not decoration on this bench. The SEN0676's own registers mix
//! units — `0x0005` (installation height) is **centimetres** while
//! `0x0001` and `0x0003` (empty height, water level) are
//! **millimetres** — and the water level is *derived* from both, so a
//! confusion between them is silent, off by ten, and looks plausible.
//! `Length::from_centimetres(1000)` and `Length::from_millimetres(1000)`
//! are different values that cannot be produced by accident from the same
//! integer.

/// A length, held canonically in micrometres.
///
/// Micrometres because the register resolutions on this bench are
/// millimetres and centimetres, and an integer canonical unit finer than
/// both converts either without rounding. `i64` because a metre is
/// 1_000_000 of them and 40 m — this sensor's range — is nowhere near the
/// bound.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub struct Length {
    micrometres: i64,
}

impl Length {
    /// From millimetres — registers `0x0001` and `0x0003`.
    #[must_use]
    pub const fn from_millimetres(mm: i32) -> Self {
        Self {
            micrometres: mm as i64 * 1_000,
        }
    }

    /// From centimetres — register `0x0005`, and **only** that one.
    #[must_use]
    pub const fn from_centimetres(cm: i32) -> Self {
        Self {
            micrometres: cm as i64 * 10_000,
        }
    }

    /// From metres, the SI base unit 5.6.3 asks for.
    #[must_use]
    pub const fn from_metres(m: i32) -> Self {
        Self {
            micrometres: m as i64 * 1_000_000,
        }
    }

    /// Truncating toward zero; the caller names the unit it wants.
    #[must_use]
    pub const fn as_millimetres(self) -> i64 {
        self.micrometres / 1_000
    }

    #[must_use]
    pub const fn as_centimetres(self) -> i64 {
        self.micrometres / 10_000
    }

    #[must_use]
    pub const fn micrometres(self) -> i64 {
        self.micrometres
    }

    /// Difference between two lengths.
    ///
    /// The SEN0676's water level is *derived*: installation height minus
    /// empty height. Both operands are `Length`, so the subtraction cannot
    /// mix units even though the registers they came from do.
    #[must_use]
    pub const fn minus(self, other: Length) -> Length {
        Length {
            micrometres: self.micrometres - other.micrometres,
        }
    }
}

/// A quantity **and** the value of it, minted only by a provider.
///
/// # Why a bare `Length` was not enough
///
/// `measurement_payload` used to take a `Length`, on the reasoning that a
/// *value* cannot be produced from an absent reading. **`Length` is
/// publicly constructible and implements `Default`**, so
/// `Length::default()` — zero — reaches the wire as a measurement nobody
/// took. The property I claimed by construction was defeated by a
/// constructor I had written myself, one file away.
///
/// And the quantity was **caller-chosen**: the profile decoded which
/// register a value came from and then returned a bare `Length`,
/// **dropping the quantity**, after which the encoder took an independent
/// `Quantity` argument. A distance read from `0x0001` could be labelled
/// `WaterLevel` and encode as a plausible wrong level.
///
/// This type closes both: the fields are private, there is no public
/// constructor, and the only mint is a provider that read a device. A
/// caller cannot conjure one, and cannot relabel one it holds.
///
/// (Both found by the companion lane, which noted that the existing test
/// proving one value encodes two ways was itself the proof the pairing
/// was unbound.)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Measurement {
    quantity: Quantity,
    value: Length,
}

impl Measurement {
    /// Mint a measurement. **For sensor providers only.**
    ///
    /// `#[doc(hidden)]`: a driver in another crate must be able to build
    /// one from a device reply, so this cannot be `pub(crate)` — but it
    /// is not part of the supported surface and an application calling it
    /// is forging a reading.
    ///
    /// **Named limit, because the difference matters**: this closes the
    /// *accidental* path — `Length::default()` can no longer be passed to
    /// an encoder, and a value cannot be relabelled with a quantity it did
    /// not come from — and it does **not** close deliberate forgery. A
    /// sans-IO crate has no way to prove a caller spoke to a device. What
    /// it can do is make the wrong thing require saying so.
    #[doc(hidden)]
    #[must_use]
    pub const fn new(quantity: Quantity, value: Length) -> Self {
        Self { quantity, value }
    }

    #[must_use]
    pub const fn quantity(&self) -> Quantity {
        self.quantity
    }

    #[must_use]
    pub const fn value(&self) -> Length {
        self.value
    }
}

/// What a sensor read yielded (L0 5.6.1, 5.6.2).
///
/// Three outcomes, and the separation of the last two is 5.6.2's whole
/// content — see this module's header. A caller that treats
/// [`Reading::Unsupported`] as retryable polls a device for a capability
/// it will never have.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Reading<T> {
    /// A value, in SI units (5.6.3).
    Value(T),
    /// **This platform has no such sensor.** A fixed property: act once
    /// and remember. Never an error, and deliberately not reachable
    /// through an error path.
    Unsupported,
    /// The sensor exists and did not answer this time — powered down, not
    /// yet settled, a bus fault. A **passing condition**: a caller may
    /// retry, and only this variant invites that.
    Unavailable(Fault),
}

impl<T> Reading<T> {
    /// Whether retrying could ever produce a value.
    ///
    /// Written as an explicit match rather than `!= Unsupported`, so a
    /// fourth outcome is a compile error here rather than silently
    /// joining the retryable set.
    pub const fn worth_retrying(&self) -> bool {
        match self {
            Reading::Unavailable(_) => true,
            Reading::Value(_) | Reading::Unsupported => false,
        }
    }

    /// Whether this outcome is a permanent fact about the platform.
    pub const fn is_permanent(&self) -> bool {
        matches!(self, Reading::Unsupported)
    }
}

/// Why a present sensor did not answer.
///
/// Deliberately coarse: a caller's only decisions are *retry* and *report*,
/// and a finer taxonomy invites branching on a distinction the platform
/// cannot reliably make. What it must never contain is a variant meaning
/// *no such sensor* — that is [`Reading::Unsupported`], one level up.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fault {
    /// Powered down, or not yet settled after power-on.
    NotReady,
    /// The platform could not access the bus or peripheral before a request
    /// was issued.
    ///
    /// This is neither [`Fault::Silence`] nor [`Fault::BadReply`]: neither
    /// says anything about the sensor or its wiring until an actual request
    /// reached the medium. It is retryable because a transient peripheral or
    /// bus-controller refusal can clear, but it must remain distinguishable so
    /// a caller does not send a hardware investigation after a local failure.
    AccessUnavailable,
    /// **Nothing arrived at all.**
    ///
    /// On a bus whose device never transmits unsolicited, silence is
    /// indistinguishable from a healthy link that was not asked — so this
    /// is a **wiring hypothesis first** and a firmware defect second
    /// (d014). It is never a value: a listen-only path proves nothing
    /// about the wiring, and inferring from quiet already produced one
    /// false hardware diagnosis on the reference bench.
    Silence,
    /// **Bytes arrived and did not verify** — checksum, framing or length.
    ///
    /// Kept apart from [`Fault::Silence`] because **they need opposite
    /// investigations**, which is the whole reason this enum has more than
    /// one failure variant. Silence says the request or the reply never
    /// crossed the wire: look at the solder. Bytes-that-fail say
    /// **something is connected and talking**: look at baud rate, framing
    /// and noise. Folding them into one *bus failure* destroys the
    /// discriminator and sends every investigation to the soldering iron.
    /// (Raised by the hive lane, which had the distinction in its own
    /// outcome type and noticed mine did not.)
    BadReply,
    /// A reply verified and then meant something this reader does not
    /// understand — a value outside the range the quantity can take.
    ///
    /// Distinct from [`Fault::BadReply`] again for the reason above: the
    /// bytes are intact, so the link is fine and the disagreement is
    /// about *meaning*. That points at configuration or at a device that
    /// is not the one expected.
    Malformed,
}

/// Which quantity a sensor reports.
///
/// Closed, because 5.6.1 requires a platform to *enumerate* what it has,
/// and an open string would let two platforms name one quantity
/// differently — the comparison problem one level down from the
/// conformance-vocabulary question.
///
/// # ‼ A KNOWN IMPURITY, ANSWERED HERE SO THE NEXT SWEEP DOES NOT RE-DERIVE IT
///
/// **L0 5.6 enumerates NO quantities.** It obliges a platform to
/// enumerate, read and write what it has (5.6.1), to report absent
/// facilities as *unsupported* rather than as an error (5.6.2), and to
/// present values in SI units (5.6.3) — and it names none of the three
/// variants below. **They are liquid-level product vocabulary in a crate
/// that is otherwise pure L0**, found by the 2026-08-10 sweep for code
/// that does not come from the standard (`D-319`), which deleted
/// `r2-mesh::sensing` on exactly that ground.
///
/// **They stay, and the reason is structural rather than a preference —
/// hive's measurement, verified here at the four sites.** `Quantity` is
/// **a parameter of the 5.6 trait surface, not a payload beside it**:
/// [`Measurement`] holds one as a field and takes one in `new`, and
/// [`Sensors::quantities`] returns them while [`Sensors::read`] takes one.
/// *Moving it would mean parameterising `Measurement` and `Sensors` over a
/// quantity type the consumer supplies — a generic in the L0 seam to
/// relocate three enum variants, trading a small vocabulary impurity for
/// a structural one in the clause-shaped part.* **And the split is not
/// available either: it is the whole type or none.**
///
/// **The impurity is therefore recorded rather than removed.** *Hive's
/// `r2-modbus` is the sole consumer of these variants anywhere in
/// `r2-impl`, so a move would also be a two-lane change.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Quantity {
    /// Water level — a **derived** quantity, not a measured one.
    ///
    /// Kept distinct from [`Quantity::DistanceToSurface`] because they
    /// are different facts about the world that happen to share a unit: a
    /// distance is measured directly, a level is *installation height
    /// minus distance* and is meaningless until the installation height
    /// is known. A consumer that treats them as interchangeable reads a
    /// distance as a level and gets a number that is wrong by the height
    /// of the tank.
    WaterLevel,
    /// The configured distance from the sensor to the bottom of the
    /// vessel — a **setting**, reported back, not a measurement.
    InstallationHeight,
    /// Distance from the sensor to a surface.
    ///
    /// The SEN0676 is a **liquid-level** sensor, not a presence radar, and
    /// its semantics are distance-to-a-surface in millimetres. A catalogue
    /// entry calling it occupancy is wrong.
    DistanceToSurface,
}

/// Platform sensor access (L0 5.6.1): enumerate, and read.
///
/// ‼ **WRITING WAS DECLINED HERE AND IS NOW BUILT, AND THE OLD REASONING IS
/// REPLACED RATHER THAN LEFT STANDING.** This doc used to read *writing is
/// 5.6.1's other half and is not modelled here yet — nothing in this
/// workspace writes a sensor, and an unused method would be a claim about a
/// capability nobody has exercised.* **That reason was good and it is
/// answered rather than overruled**: the write below defaults to
/// [`Written::ReadOnly`] for a quantity the platform enumerates and to
/// [`Written::Unsupported`] for one it does not. A platform that has never
/// actuated anything therefore claims nothing by gaining the method, while a
/// caller can still distinguish an absent facility from a readable one that
/// cannot be changed. And 5.6.1 obliges a platform to **expose** the operation,
/// which a trait without one cannot do at any later date without changing every
/// implementor.
///
/// *A superseded declination is replaced, not edited: leaving "not modelled
/// here yet" above a modelled method is the shape that makes a reader
/// distrust the next comment they meet.*
pub trait Sensors {
    type Error: core::fmt::Debug;

    /// Which quantities this platform can report (5.6.1).
    ///
    /// A platform with none returns an empty slice — it does **not**
    /// error, per 5.6.2.
    fn quantities(&self) -> &[Quantity];

    /// Read one quantity.
    ///
    /// Returns [`Reading::Unsupported`] where `quantity` is not in
    /// [`Sensors::quantities`], **never** an error: 5.6.2, and the reason
    /// is in this module's header.
    fn read(&mut self, quantity: Quantity) -> Reading<Measurement>;

    /// Which quantities this platform can **write** (5.6.1).
    ///
    /// ‼ **A SEPARATE LIST, AND THAT IS THE WHOLE POINT.** 5.6.1 asks a
    /// platform to expose operations to enumerate, **read and write** — and
    /// *being enumerable does not make a quantity writable.* A temperature
    /// sensor is enumerable, readable and not writable by any amount of
    /// trying, and **a caller that read `quantities()` as the writable set
    /// would attempt to set the temperature.**
    ///
    /// Defaulted to empty because that is the honest answer for a platform
    /// with sensors and no actuators, which is most of them — *and a default
    /// that claimed writability would make every existing implementation
    /// assert something none of them can do.*
    fn writable(&self) -> &[Quantity] {
        &[]
    }

    /// Write one complete measurement — an **actuation**, not a reading.
    ///
    /// The [`Measurement`] names its own quantity, so a caller cannot hand the
    /// platform a value from one capability and label it as another. Returns
    /// [`Written::ReadOnly`] for an enumerated but non-writable quantity and
    /// [`Written::Unsupported`] for an absent one, **never an error**: 5.6.2
    /// draws that distinction and Note 1 gives the consequence — *unsupported
    /// is a fixed property of the platform, which a higher layer can act on
    /// once and remember; error is a passing condition, which a higher layer
    /// will retry for as long as it keeps being told to.*
    fn write(&mut self, value: Measurement) -> Written {
        // ‼ **THE DEFAULT REFUSES RATHER THAN SUCCEEDING SILENTLY.** A
        // defaulted `write` that returned success would make every platform
        // with no actuators claim to have actuated — *the one failure mode
        // where the caller believes the world changed and it did not.*
        if self.quantities().contains(&value.quantity()) {
            Written::ReadOnly
        } else {
            Written::Unsupported
        }
    }
}

/// What a write did (5.6.1, 5.6.2).
///
/// ‼ **`Unsupported` AND `ReadOnly` ARE KEPT APART.** *This quantity does not
/// exist here* and *this quantity exists and cannot be written* are different
/// facts about the platform, and a caller acts differently on them: the first
/// says look elsewhere, the second says you already have all this quantity
/// can give you. **Collapsing them would tell somebody holding a working
/// sensor that it is absent.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Written {
    /// The actuation was accepted by the platform.
    ///
    /// **Accepted, not achieved.** A platform reports that it took the
    /// value; whether the world moved is what a subsequent [`Sensors::read`]
    /// is for, and no write result may stand in for one.
    Accepted,
    /// Not a quantity this platform has at all (5.6.2 — *unsupported*, never
    /// an error).
    Unsupported,
    /// The quantity exists and is **readable only**.
    ReadOnly,
    /// A passing condition. ‼ **THE ONLY VARIANT WORTH RETRYING**, which is
    /// Note 1's distinction: a higher layer will retry an error for as long
    /// as it keeps being told to, so a permanent condition must never be
    /// reported as one.
    Unavailable(Fault),
}

impl Written {
    /// Whether a caller should try again.
    #[must_use]
    pub const fn worth_retrying(&self) -> bool {
        matches!(self, Written::Unavailable(_))
    }

    /// Whether the platform took the value.
    #[must_use]
    pub const fn accepted(&self) -> bool {
        matches!(self, Written::Accepted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A platform with a readable sensor and one actuator, so both lists
    /// are non-empty and differ.
    struct Bench {
        level: Length,
    }

    impl Sensors for Bench {
        type Error = ();

        fn quantities(&self) -> &[Quantity] {
            &[Quantity::WaterLevel]
        }
        fn read(&mut self, quantity: Quantity) -> Reading<Measurement> {
            match quantity {
                Quantity::WaterLevel => {
                    Reading::Value(Measurement::new(Quantity::WaterLevel, self.level))
                }
                // 5.6.2: not in `quantities()`, so unsupported and NOT an
                // error — a higher layer acts on it once and remembers.
                _ => Reading::Unsupported,
            }
        }
        fn writable(&self) -> &[Quantity] {
            &[Quantity::WaterLevel]
        }
        fn write(&mut self, value: Measurement) -> Written {
            let quantity = value.quantity();
            if !self.quantities().contains(&quantity) {
                return Written::Unsupported;
            }
            if !self.writable().contains(&quantity) {
                return Written::ReadOnly;
            }
            self.level = value.value();
            Written::Accepted
        }
    }

    /// ‼ **A PLATFORM WITH NO ACTUATORS CLAIMS NONE, AND ITS `write` REFUSES
    /// RATHER THAN SUCCEEDING SILENTLY.** A readable quantity is read-only;
    /// a quantity absent from the platform is unsupported. *A defaulted write
    /// that returned success would make every platform with no actuators claim
    /// to have actuated* — the one failure mode where the caller believes the
    /// world changed and it did not.
    #[test]
    fn a_platform_with_no_actuators_defaults_to_writing_nothing() {
        struct ReadOnlyBoard;
        impl Sensors for ReadOnlyBoard {
            type Error = ();

            fn quantities(&self) -> &[Quantity] {
                &[Quantity::WaterLevel]
            }
            fn read(&mut self, _q: Quantity) -> Reading<Measurement> {
                Reading::Unsupported
            }
        }
        let mut b = ReadOnlyBoard;
        assert!(b.writable().is_empty(), "no actuators, and it says so");
        assert_eq!(
            b.write(Measurement::new(
                Quantity::WaterLevel,
                Length::from_millimetres(1),
            )),
            Written::ReadOnly,
            "the platform has this quantity but does not actuate it"
        );
        assert_eq!(
            b.write(Measurement::new(
                Quantity::InstallationHeight,
                Length::from_millimetres(1),
            )),
            Written::Unsupported,
            "a quantity the platform does not enumerate remains absent"
        );
        // ‼ AND IT IS NOT AN ERROR (5.6.2), so nothing retries it forever.
        assert!(!Written::ReadOnly.worth_retrying());
        assert!(!Written::ReadOnly.accepted());
    }

    /// ‼ **ENUMERABLE IS NOT WRITABLE, AND THAT IS WHY THE LISTS ARE
    /// SEPARATE.** *A temperature sensor is enumerable, readable and not
    /// writable by any amount of trying*, and a caller reading
    /// `quantities()` as the writable set would attempt to set it.
    #[test]
    fn the_readable_and_writable_sets_are_asked_separately() {
        let mut b = Bench {
            level: Length::from_millimetres(0),
        };
        assert_eq!(b.quantities(), &[Quantity::WaterLevel]);
        assert_eq!(b.writable(), &[Quantity::WaterLevel]);

        let target = Measurement::new(Quantity::WaterLevel, Length::from_centimetres(12));
        assert_eq!(b.write(target), Written::Accepted);

        // ‼ **ACCEPTED IS NOT ACHIEVED.** The platform took the value; that
        // the world moved is what a subsequent READ establishes, and no
        // write result may stand in for one.
        match b.read(Quantity::WaterLevel) {
            Reading::Value(m) => assert_eq!(m.value().as_millimetres(), 120),
            other => panic!("expected a reading, got {other:?}"),
        }
    }

    /// ‼ **`Unsupported` AND `ReadOnly` SAY DIFFERENT THINGS AND ONLY ONE OF
    /// THE FOUR IS WORTH RETRYING.** Note 1: *unsupported is a fixed property
    /// of the platform, which a higher layer can act on once and remember;
    /// error is a passing condition, which a higher layer will retry — for as
    /// long as it keeps being told to.*
    #[test]
    fn only_a_passing_condition_is_worth_retrying() {
        assert!(Written::Unavailable(Fault::NotReady).worth_retrying());
        assert!(!Written::Unsupported.worth_retrying());
        assert!(!Written::ReadOnly.worth_retrying());
        assert!(!Written::Accepted.worth_retrying());

        // And the two refusals are distinguishable, which is the point: one
        // says look elsewhere, the other says you already have all this
        // quantity can give you.
        assert_ne!(Written::Unsupported, Written::ReadOnly);
    }

    #[test]
    fn a_number_cannot_become_a_length_without_naming_its_unit() {
        // 5.6.3, and the SEN0676's own register trap: 0x0005 is
        // centimetres while 0x0001 and 0x0003 are millimetres.
        let mm = Length::from_millimetres(1000);
        let cm = Length::from_centimetres(1000);
        assert_ne!(mm, cm, "the same integer produced the same length");
        assert_eq!(mm.as_millimetres(), 1000);
        assert_eq!(cm.as_millimetres(), 10_000);
        // And a metre is a metre by either route.
        assert_eq!(Length::from_metres(1), Length::from_millimetres(1000));
        assert_eq!(Length::from_metres(1), Length::from_centimetres(100));
    }

    #[test]
    fn the_derived_water_level_cannot_mix_units() {
        // Datasheet: water level = installation height (cm) minus empty
        // height (mm). Both become Length at construction, so the
        // subtraction is in one unit however the registers disagree.
        let installation = Length::from_centimetres(1000); // 10 m
        let empty = Length::from_millimetres(2500); //  2.5 m
        assert_eq!(installation.minus(empty).as_millimetres(), 7_500);
        // The trap, had the numbers been passed as bare integers:
        // 1000 - 2500 = -1500, a negative water level that looks like a
        // sensor fault rather than a unit confusion.
        assert_ne!(installation.minus(empty).as_millimetres(), -1_500);
    }

    #[test]
    fn unsupported_is_not_retryable_and_not_an_error() {
        // 5.6.2 and its Note 1. A caller with a retry loop must not be
        // able to reach a permanent absence through the retryable arm.
        let absent: Reading<Length> = Reading::Unsupported;
        assert!(!absent.worth_retrying());
        assert!(absent.is_permanent());

        // Every fault, by contrast, invites a retry — and none of them
        // means "no such sensor".
        for f in [
            Fault::NotReady,
            Fault::AccessUnavailable,
            Fault::Silence,
            Fault::BadReply,
            Fault::Malformed,
        ] {
            let r: Reading<Length> = Reading::Unavailable(f);
            assert!(r.worth_retrying(), "{f:?} was not retryable");
            assert!(!r.is_permanent(), "{f:?} was treated as permanent");
        }
    }

    #[test]
    fn silence_and_a_bad_reply_are_different_faults() {
        // They need OPPOSITE investigations, which is why the enum has
        // more than one failure variant. Silence: the request or reply
        // never crossed the wire — look at the solder. Bytes that fail to
        // verify: something IS connected and talking — look at baud,
        // framing, noise. Folding them sends every investigation to the
        // soldering iron, and this bench has already been sent there once
        // on a false diagnosis.
        let quiet: Reading<Length> = Reading::Unavailable(Fault::Silence);
        let noisy: Reading<Length> = Reading::Unavailable(Fault::BadReply);
        assert_ne!(quiet, noisy, "the discriminator was folded away");
        // Both retryable, and that is not what distinguishes them — the
        // difference is diagnostic, exactly as with the revert reasons at
        // L6 5.4.4.
        assert!(quiet.worth_retrying());
        assert!(noisy.worth_retrying());
    }

    #[test]
    fn a_value_is_neither_retryable_nor_permanent_absence() {
        let got = Reading::Value(Length::from_millimetres(1234));
        assert!(!got.worth_retrying());
        assert!(!got.is_permanent());
    }

    #[test]
    fn silence_is_a_fault_and_never_a_reading() {
        // The SEN0676 never transmits unsolicited, so a quiet bus is
        // indistinguishable from a healthy one that was not asked. There
        // is no Reading variant meaning "nothing arrived, assume zero" —
        // silence can only be Unavailable(BusFailure), which is retryable
        // and reportable and is not a measurement.
        let quiet: Reading<Length> = Reading::Unavailable(Fault::Silence);
        assert!(quiet.worth_retrying());
        assert_ne!(quiet, Reading::Value(Length::default()));
        // Length::default() is zero, which is exactly the plausible-looking
        // value a silence-tolerant reader would invent.
        assert_eq!(Length::default().as_millimetres(), 0);
    }
}
