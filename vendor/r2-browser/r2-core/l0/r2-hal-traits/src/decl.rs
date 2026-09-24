//! Platform declaration and capability classes (L0 Clauses 7 and 8).

/// Availability (L0 Clause 7, parameter P8).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Availability {
    AlwaysOn,
    /// Duty-cycled, with the three declared intervals (L0 7.3).
    DutyCycled(WakeIntervals),
}

/// The three intervals a duty-cycled platform states (L0 7.3), in seconds.
/// A platform never adopts an interval shorter than `shortest_permitted`,
/// whatever instruction it receives (L0 7.4).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct WakeIntervals {
    pub shortest_permitted_s: u32,
    pub longest_permitted_s: u32,
    pub shortest_self_selected_s: u32,
}

impl WakeIntervals {
    /// **L0 7.4: the interval this platform adopts when instructed to use
    /// `requested_s`.**
    ///
    /// ‼ **THE CLAUSE IS A BEHAVIOUR AND IT HAD NO IMPLEMENTATION.** *A
    /// duty-cycled platform shall not adopt an interval shorter than the
    /// shortest permitted, **whatever instruction it receives.*** This type
    /// stated the three numbers 7.3 requires and **nothing enforced the
    /// floor** — so the obligation lived in a struct field that any caller
    /// could read and ignore.
    ///
    /// **Clamping rather than refusing, and that is the clause's shape.** 7.4
    /// does not say *refuse an instruction below the floor*, it says the
    /// platform shall not ADOPT one — so an instruction of two seconds against
    /// a floor of ten yields ten, and the platform keeps running. *A refusal
    /// would leave the platform on its previous interval, which the instructor
    /// cannot see and did not choose either.*
    ///
    /// The ceiling is applied too: an instruction longer than
    /// `longest_permitted_s` is a duty cycle this platform has declared it
    /// does not offer.
    #[must_use]
    pub const fn adopt(&self, requested_s: u32) -> u32 {
        if requested_s < self.shortest_permitted_s {
            return self.shortest_permitted_s;
        }
        if requested_s > self.longest_permitted_s {
            return self.longest_permitted_s;
        }
        requested_s
    }

    /// Whether these three intervals are ordered as 7.3 describes them.
    ///
    /// *shortest permitted ≤ shortest self-selected ≤ longest permitted.* A
    /// declaration failing this states a floor above its own ceiling, or a
    /// self-selected interval it is not permitted to use — **both of which
    /// [`Self::adopt`] would silently paper over**, since a clamp always
    /// returns something plausible.
    #[must_use]
    pub const fn is_ordered(&self) -> bool {
        self.shortest_permitted_s <= self.shortest_self_selected_s
            && self.shortest_self_selected_s <= self.longest_permitted_s
    }
}

/// Capability class (L0 8.3.1). A platform is in a class where its
/// declaration satisfies the class values; **it provides at least the
/// [`ClassCapacities`] of the class it declares (8.3.2)**.
///
/// **8.3.3 is deliberately NOT cited here.** It carries a shall-meet, but
/// **scoped to a platform satisfying MORE THAN ONE class** — *which of them
/// it may declare, and that it meets 8.3.2 for the one it picks.* A bare
/// `8.3.2/8.3.3` read as though the obligation were joint, which is a
/// citation **wider than its source**; the unconditional obligation is
/// 8.3.2's alone. See [`PlatformDeclaration::class_declared`] for the one place
/// 8.3.3 is the right clause.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CapabilityClass {
    Class1,
    Class2,
    Class3,
    Class4,
    Class5,
}

/// Mandated minimum table capacities (L0 8.3.2), in entries.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ClassCapacities {
    pub dedup_cache: u32,
    pub neighbour_table: u32,
    /// `None` = unbounded (classes 3 and 4).
    pub packet_log: Option<u32>,
}

impl CapabilityClass {
    /// Minimum capacities for this class (L0 8.3.2). For class 2 these are
    /// the L1-4 part's figures; its L5-7 part carries the class-3 figures.
    #[must_use]
    pub const fn capacities(self) -> ClassCapacities {
        match self {
            CapabilityClass::Class1 | CapabilityClass::Class2 => ClassCapacities {
                dedup_cache: 128,
                neighbour_table: 32,
                packet_log: Some(256),
            },
            CapabilityClass::Class3 | CapabilityClass::Class4 => ClassCapacities {
                dedup_cache: 4096,
                neighbour_table: 256,
                packet_log: None,
            },
            CapabilityClass::Class5 => ClassCapacities {
                dedup_cache: 1024,
                neighbour_table: 64,
                packet_log: Some(1024),
            },
        }
    }
}

/// Which platform a declaration and an observation are about.
///
/// ‼ **THIS EXISTS BECAUSE A CORROBORATION OF THE WRONG BOARD PASSED.**
/// `hive` measured it (2026-08-14): one board's declaration corroborated
/// against **another board's observed capacities** compiled and returned
/// `Ok(())`. *A corroboration of the wrong subject passes, and passing is
/// what the caller is looking for.* Two constants with similar names in
/// one scope is all it takes, and the crossed call is the one a
/// reasonable hand reaches for.
///
/// **The value is the platform's own and only equality is used here** —
/// this crate never interprets it. *It is an identity for the SUBJECT of
/// a claim, not a description of it.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlatformId(pub u32);

/// **P9's three facts** (L0 8.2.1): how many image slots, and the usable
/// size of each.
///
/// Whether the platform provides slots at all is carried by the
/// `Option<UpdateSlots>` that holds this, so an absent facility is
/// unrepresentable as *zero slots of zero size*.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct UpdateSlots {
    pub count: u8,
    /// Usable bytes per slot — *usable*, which is the clause's word, so a
    /// platform must not state gross flash here.
    pub usable_bytes_each: u64,
}

/// A half-open byte range `[start, start + len)`.
///
/// **The clause 8.6.1 states is RELATIONAL** — records storage *lying
/// outside both slots* — and *inside-ness is a relation between four
/// numbers, none of which states it.* `hive` made that point by
/// **computing** a board's layout rather than reading it back: a read tells
/// you the regions exist and where they start, and only the arithmetic
/// tells you neither is inside a slot.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Extent {
    pub start: u64,
    pub len: u64,
}

impl Extent {
    /// First byte after this extent, if the declared range is representable.
    #[must_use]
    pub const fn end(&self) -> Option<u64> {
        self.start.checked_add(self.len)
    }

    /// Whether the two share any byte. **A zero-length extent overlaps
    /// nothing**, which is the honest answer for an unpopulated slot.
    #[must_use]
    pub const fn overlaps(&self, other: &Extent) -> bool {
        if self.len == 0 || other.len == 0 {
            return false;
        }
        match (self.end(), other.end()) {
            (Some(self_end), Some(other_end)) => self.start < other_end && other.start < self_end,
            // A wrapped endpoint cannot establish L0 8.6.1's safety relation.
            _ => true,
        }
    }
}

/// The most slots a declaration can describe here. Raising it is a
/// one-line change; **8.6.1 sets a FLOOR of two and no ceiling**, so this
/// is a representation bound and never a conformance one.
pub const MAX_DESCRIBED_SLOTS: usize = 4;

/// Where the image slots and the records region lie (L0 8.6.1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SlotLayout {
    /// Slot extents; only the first `described` entries are meaningful.
    pub slots: [Extent; MAX_DESCRIBED_SLOTS],
    /// How many of `slots` the platform stated.
    pub described: u8,
    /// The persistent storage for the records Layer 6 requires.
    ///
    /// **8.6.1's reason, from its Note 1**: *a record inside a slot is
    /// erased by the write it exists to describe.*
    pub records: Extent,
}

impl SlotLayout {
    /// Whether the records region lies outside **every** described slot
    /// (L0 8.6.1).
    ///
    /// ‼ **THE QUESTION COULD NOT BE ASKED AT ALL BEFORE 2026-08-14**, and
    /// that is the defect this answers rather than any particular board's
    /// layout. A board whose records happened to sit outside its slots
    /// passed for the same reason as one whose records sat inside:
    /// *nothing looked.* `hive`'s words, on measuring a conforming board:
    /// **a conforming instance with no way to state the constraint is the
    /// weakest kind of pass.**
    #[must_use]
    pub fn records_outside_all_slots(&self) -> bool {
        let n = (self.described as usize).min(MAX_DESCRIBED_SLOTS);
        !self.slots[..n].iter().any(|s| s.overlaps(&self.records))
    }
}

impl UpdateSlots {
    /// Whether the slot count meets 8.6.1's floor of **two**.
    ///
    /// *Stated separately from the layout because a platform may declare
    /// its count honestly and describe no extents* — the two halves of
    /// 8.6.1 fail independently and are reported independently.
    #[must_use]
    pub const fn meets_slot_floor(&self) -> bool {
        self.count >= 2
    }
}

/// **P10** (L0 8.2.1): the update path's write boundary, and what lies
/// outside it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct WriteBoundary {
    /// Whether the storage the update path writes through enforces a
    /// boundary that path cannot cross.
    pub enforced: bool,
    /// Which regions lie outside it, as a platform-defined bit set.
    ///
    /// **Zero where `enforced` is false**, and that is checked by
    /// [`WriteBoundary::is_coherent`] rather than left to a convention: a
    /// declaration naming regions outside a boundary that does not exist
    /// is stating something about nothing.
    pub regions_outside: u32,
}

impl WriteBoundary {
    /// Whether this pair of values says something possible.
    #[must_use]
    pub const fn is_coherent(&self) -> bool {
        self.enforced || self.regions_outside == 0
    }

    /// Whether this platform may claim **L6 4.2.2 by construction**
    /// (L0 8.6.2).
    ///
    /// ‼ **8.6.2 IS A PROHIBITION AND IT HAD NO SITE TO FIRE AT.** *A
    /// platform whose declaration states no write boundary (P10) shall not
    /// claim conformance to Layer 6, 4.2.2 by construction.* P10 was
    /// representable and nothing anywhere carried the claim, **so the
    /// prohibition could not be broken and could not be kept** — a rule
    /// with no subject.
    ///
    /// ‼ **AND 4.2.2's OWN WORDING IS WHY A BOOLEAN IS THE RIGHT SHAPE
    /// HERE**: *an update path shall be constructed so that it cannot write
    /// the persona's storage — **not merely instructed that it may not**.*
    /// A claim answerable only by a declared, enforced boundary is a claim
    /// **about construction**; one a platform could assert for itself would
    /// be an instruction wearing a claim's clothes.
    ///
    /// L0 8.6.2 Note 2: *8.6.2 gives 4.2.2's by-construction an enabling
    /// mechanism and a name — that clause is satisfiable only where the
    /// storage offers a boundary the update path cannot cross.*
    #[must_use]
    pub const fn may_claim_construction_isolation(&self) -> bool {
        self.enforced && self.is_coherent()
    }
}

/// A claim of L6 4.2.2 conformance **by construction**, which L0 8.6.2
/// permits only where P10 states an enforced boundary.
///
/// ‼ **THE POINT IS THAT THIS CANNOT BE BUILT WITHOUT THE DECLARATION.**
/// The only constructor takes the [`WriteBoundary`] and refuses — *a claim
/// a platform could assert about itself is exactly what 4.2.2 means by
/// **not merely instructed that it may not**.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConstructionIsolationClaim {
    _private: (),
}

impl ConstructionIsolationClaim {
    /// `None` where P10 states no enforced boundary (L0 8.6.2).
    #[must_use]
    pub const fn from_boundary(boundary: &WriteBoundary) -> Option<Self> {
        if boundary.may_claim_construction_isolation() {
            Some(Self { _private: () })
        } else {
            None
        }
    }
}

/// **P12** (L0 8.2.1): the recovery substrate, as the two questions the
/// clause asks.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RecoverySubstrate {
    /// Whether the slot layout and the code that chooses a slot can be
    /// written by the platform's own install path.
    pub writable_by_install_path: bool,
    /// Whether the integrity check applied before writing covers them.
    pub integrity_check_covers_them: bool,
}

impl RecoverySubstrate {
    /// **The combination worth naming: the install path can rewrite the
    /// structures the update arrangement depends on, and the pre-write
    /// integrity check does NOT cover them.**
    ///
    /// This is a fact about the platform, not a verdict on it — L0 states
    /// no conformance requirement on the pair — so it is a predicate a
    /// caller may act on and **not** a `Discrepancy` this crate raises.
    /// *Inventing a refusal here would build a requirement the corpus does
    /// not state.*
    #[must_use]
    pub const fn self_writable_and_unchecked(&self) -> bool {
        self.writable_by_install_path && !self.integrity_check_covers_them
    }
}

/// **P13** (L0 8.2.1): whether the platform can report the absence of a
/// valid image-position record.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionObservability {
    /// It can report to the layers above that no valid record exists.
    ReportsAbsence,
    /// Its boot path writes a record where it finds none — so the layers
    /// above can never observe the absence, because by the time they look
    /// it has been manufactured.
    BootPathWritesOne,
}

/// A facility this document requires that a platform does not provide, with
/// **the obligations that loss costs** (L0 8.5.1, 8.5.2).
///
/// # ‼ THE SECOND FIELD IS THE LOAD-BEARING ONE, BY THE CLAUSE'S OWN NOTE
///
/// 8.5.2 obliges a shortfall to *name the obligations of other parts that the
/// platform therefore cannot meet*, and **a shortfall stated without its
/// consequences reads as a small omission** — while *the reader who needs it
/// is deciding whether to deliver a persona, an update or a key.*
///
/// # ‼ AND AN ABSENT VALUE IS NOT A NAMED SHORTFALL
///
/// `SS357` measured the defect this closes: `PlatformDeclaration` could
/// describe only what a platform **has**, so a platform lacking a required
/// facility had no vocabulary for its own shape — **8.5's own Note 1 names
/// that as the reason the clause exists.** And `None` on an existing
/// parameter *cannot distinguish this platform has no slots from nobody
/// filled the field in*: `FORMATS` 5c.2 Note 2 already rules the class —
/// **absent is a fact; zero is a lie with a plausible interpretation** — and
/// the corpus had written that rule for a reporting surface without carrying
/// it to the declaration.
///
/// ⚠ **THE SHAPE IS ROY'S RULING OF 2026-08-19**, taken over the free-text
/// alternative `SS357` also offered, *because structured fields make 8.5
/// checkable and because L5A 6.1.3 — a group shall not adopt a condition
/// whose evidence requires a facility its platforms have not declared —
/// works only as far as the declaration can be read by a machine.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Shortfall<'a> {
    /// **8.5.1: the facility, named.** Free text because the facilities are
    /// the corpus's own and no enumeration of them exists — *inventing one
    /// here would be a second vocabulary for a reader to keep in step.*
    pub facility: &'a str,
    /// **8.5.2: the obligations this platform therefore cannot meet**, as
    /// clause references.
    ///
    /// ‼ **AN EMPTY LIST IS A CLAIM AND NOT A BLANK**: it says *this
    /// shortfall costs no obligation*, which is occasionally true and is
    /// exactly what a reader must be able to tell from *nobody worked it
    /// out.* [`Shortfall::states_consequences`] is how a caller asks.
    pub obligations_lost: &'a [&'a str],
}

impl Shortfall<'_> {
    /// Whether 8.5.2 has actually been answered for this shortfall.
    ///
    /// **A shortfall naming no obligation is not thereby malformed** — it may
    /// genuinely cost nothing — *so this reports rather than refuses*, and a
    /// publisher that wants the distinction visible prints it.
    #[must_use]
    pub const fn states_consequences(&self) -> bool {
        !self.obligations_lost.is_empty()
    }
}

/// **What a platform says about when its entropy source is conforming
/// (L0 5.5.1, 5.5.2, 5.5.2b).**
///
/// ‼ **THREE STATES, BECAUSE TWO CANNOT CARRY THE DIFFERENCE THAT MATTERS.**
/// *Unconditional* and *not stated* are the same absence to a reader and
/// opposite facts to a chooser: one is a platform that has worked it out and
/// answered, the other is a platform that has not been asked. **The one that
/// gets somebody hurt is `NotStated` read as `Unconditional`**, which is
/// `SS213`'s shape exactly — a hive minting a perfectly well-formed identity
/// from a pseudo-random source, indistinguishable by inspection for the life
/// of the device.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EntropyConditions {
    /// **The platform has not answered.** Not a claim of anything, and a
    /// reader must not treat it as one.
    NotStated,
    /// ‼ **THE PLATFORM HAS NO CONFORMING SOURCE AT ALL (5.5.2).** It shall
    /// not generate key material, ever — *the operator action is to replace
    /// the platform, not to wait*, which is what keeps this apart from a
    /// condition that is merely unmet right now.
    None,
    /// The source is conforming whenever the platform is running.
    Unconditional,
    /// **Conforming only while these conditions hold**, each stated in terms
    /// an operator can act on.
    ///
    /// *Free text because the conditions are the platform's own and no
    /// enumeration of them exists* — the same reasoning [`Shortfall`] carries
    /// for a facility name, and inventing a vocabulary here would be a second
    /// one for a reader to keep in step.
    OnlyWhile(&'static [&'static str]),
}

impl EntropyConditions {
    /// **Whether this platform may generate key material at all** (5.5.2).
    ///
    /// ‼ **`NotStated` ANSWERS `false`, AND THAT IS THE WHOLE POINT OF THE
    /// THIRD VARIANT.** A platform that has not said whether its entropy
    /// conforms has not said that it does, and *the failure of a wrong `true`
    /// here is invisible for the life of the device* while the failure of a
    /// wrong `false` is a device that says it is not a hive — which is
    /// recoverable and loud.
    #[must_use]
    pub const fn may_generate_key_material(&self) -> bool {
        match self {
            EntropyConditions::Unconditional => true,
            // A conditional declaration that names no conditions has not
            // stated an operator-checkable basis for generation.
            EntropyConditions::OnlyWhile(conditions) => !conditions.is_empty(),
            EntropyConditions::NotStated | EntropyConditions::None => false,
        }
    }

    /// **5.5.2b: may key material be generated RIGHT NOW?**
    ///
    /// [`Self::may_generate_key_material`] answers 5.5.2 — *may this platform
    /// ever* — and this answers 5.5.2b, which is a different question asked at
    /// a different moment. *A platform that may generate is not a platform that
    /// may generate now*, and the whole of 5.5.2b is the gap between them.
    ///
    /// ‼ **THE ARGUMENT IS THE CONDITION OBSERVED AT THE MOMENT OF THE ASK, NOT
    /// A VALUE SAMPLED EARLIER.** The board this was extracted from records the
    /// reason: a state captured when the keystore was built and replayed at
    /// failure names the wrong operator action — *start the radio*, when the
    /// answer is *replace the platform* — because a source can move between
    /// states in between. **A reason sampled at construction and reported at
    /// failure is a stale answer that reads as a current one.**
    ///
    /// `Unconditional` ignores the observation deliberately: its conditions are
    /// vacuous, so there is nothing for an observation to be about, and a
    /// platform that answered `false` there would be refusing on evidence it
    /// never claimed to depend on.
    #[must_use]
    pub const fn may_fill_now(&self, conditions_hold: bool) -> bool {
        match self {
            // Nothing to observe: the source conforms whenever the platform runs.
            EntropyConditions::Unconditional => true,
            // ‼ THE ONE ARM 5.5.2b IS ABOUT. The declaration named the
            //   conditions so an operator can check them; this refuses while
            //   they do not hold, and the refusal is the obligation.
            EntropyConditions::OnlyWhile(c) => !c.is_empty() && conditions_hold,
            // No conforming source, or none declared: no observation can make
            // generation permissible, and 5.5.2's operator action is to replace
            // the platform rather than to wait.
            EntropyConditions::NotStated | EntropyConditions::None => false,
        }
    }

    /// Whether generation is gated on something an operator must arrange.
    #[must_use]
    pub const fn is_conditional(&self) -> bool {
        matches!(self, EntropyConditions::OnlyWhile(_))
    }

    /// **Whether 5.5.2b has actually been answered.**
    ///
    /// An `OnlyWhile` carrying an empty list claims a condition and names
    /// none, which is *worse than `NotStated`* — it reads as answered.
    #[must_use]
    pub const fn states_its_conditions(&self) -> bool {
        match self {
            EntropyConditions::OnlyWhile(c) => !c.is_empty(),
            EntropyConditions::NotStated => false,
            _ => true,
        }
    }
}

/// A versioned transport-behaviour profile declared as part of P3.
///
/// The `transport_bit` is exactly one L1 bearer-ordinal bit from the P3
/// transport set. `schema` belongs to its publisher and is a reverse-DNS
/// identifier; `canonical_value` is the complete representation that schema
/// and version define. This is deliberately data rather than a controller
/// configuration object: pins, buses, vendor handles, and chip registers do
/// not cross the L0/L1 boundary (L0 8.2.1a–8.2.1b).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BindingProfileDeclaration {
    /// Exactly one bearer-ordinal bit for the binding this profile describes.
    pub transport_bit: u8,
    /// Reverse-DNS identity of the binding parameter schema.
    pub schema: &'static str,
    /// Version of `schema` used by `canonical_value`.
    pub version: u16,
    /// Complete, binding-defined canonical parameter representation.
    pub canonical_value: &'static str,
}

/// The bearer-ordinal bit of the BLE binding: ordinal 0 in the L1 8.2.1
/// registry, so bit `1 << 0`.
///
/// **Restated here because L0 cannot name L1's `Ordinal`** — the dependency
/// runs the other way. `r2-transport`'s own registry test pins
/// `Ordinal::Ble.bit() == 0x01`, and `hive-bearer-ble` compares its
/// profile's `transport_bit` against that same value, so a drift would show
/// at both ends before it showed here.
pub const BLE_TRANSPORT_BIT: u8 = 0b0000_0001;

/// **The bindings whose binding document requires a P3 binding-parameter
/// declaration (L0 8.2.1a).** Today that is BLE alone: L1-BINDING-BLE
/// 6a-ter.1 — *a platform that declares this binding in P3 of Layer 0,
/// 8.2.1 shall carry the P3 binding-parameter declaration Layer 0, 8.2.1a
/// requires.* A binding joins this list by an edit, beside the clause that
/// obliges it; [`PlatformDeclaration::check_required_binding_profiles`] is
/// what reads it.
pub const BINDINGS_REQUIRING_A_PROFILE: &[u8] = &[BLE_TRANSPORT_BIT];

/// Why a P3 binding profile is not a declaration a portable binding may use.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BindingProfileRefusal {
    /// A profile must identify exactly one bearer, not none or several.
    NotOneTransport,
    /// The profile describes a bearer that P3 does not declare.
    TransportNotDeclared,
    /// An empty schema has no publisher or interpretation.
    EmptySchema,
    /// A schema identity is not a lower-case reverse-DNS name with at least
    /// two non-empty labels.
    SchemaNotReverseDns,
    /// Version zero cannot identify a published representation.
    ZeroVersion,
    /// The binding profile omitted its required canonical value.
    EmptyValue,
    /// More than one profile described the same bearer.
    DuplicateTransport,
}

impl BindingProfileDeclaration {
    /// Check the parts that do not depend on the enclosing declaration.
    pub const fn check(self) -> Result<(), BindingProfileRefusal> {
        if self.transport_bit == 0 || !self.transport_bit.is_power_of_two() {
            return Err(BindingProfileRefusal::NotOneTransport);
        }
        if self.schema.is_empty() {
            return Err(BindingProfileRefusal::EmptySchema);
        }
        if !is_reverse_dns(self.schema) {
            return Err(BindingProfileRefusal::SchemaNotReverseDns);
        }
        if self.version == 0 {
            return Err(BindingProfileRefusal::ZeroVersion);
        }
        if self.canonical_value.is_empty() {
            return Err(BindingProfileRefusal::EmptyValue);
        }
        Ok(())
    }
}

/// Whether `name` has the portable reverse-DNS spelling P3 requires.
///
/// This checks syntax only: an L0 crate can reject a name nobody owns, but
/// cannot establish who owns a DNS root. That evidence belongs to the schema
/// publisher, not the board that carries a profile using it.
const fn is_reverse_dns(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut labels = 1u8;
    let mut label_len = 0usize;
    let mut previous_hyphen = false;
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'.' {
            if label_len == 0 || previous_hyphen {
                return false;
            }
            labels = match labels.checked_add(1) {
                Some(next) => next,
                None => return false,
            };
            label_len = 0;
            previous_hyphen = false;
        } else if byte == b'-' {
            if label_len == 0 {
                return false;
            }
            label_len += 1;
            previous_hyphen = true;
        } else if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            label_len += 1;
            previous_hyphen = false;
        } else {
            return false;
        }
        i += 1;
    }
    labels >= 2 && label_len != 0 && !previous_hyphen
}

/// The platform declaration, parameters P1-P13 (L0 8.2.1). Every parameter
/// carries a value (8.1.2); the class is never identified by product, board
/// or vendor name (8.1.3).
// The parameters P1–P13 are the standard's own list (L0 8.2.1), several of
// them yes/no by the clause; a struct mirroring the declaration carries
// those bools by name, which is the readable form here.
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PlatformDeclaration {
    /// Which platform this declaration is about (L0 8.3, the class run;
    /// **not 8.3.3, which is the class-declaration rule** — see
    /// [`PlatformDeclaration::corroborate`] for the miscitation this
    /// replaced).
    ///
    /// **Compared against [`ObservedCapacities::platform`] before anything
    /// else**, so a corroboration can only ever be about one subject.
    pub platform: PlatformId,
    /// P1: memory available to the implementation, bytes.
    pub memory_bytes: u64,
    /// P1: persistent storage available to the implementation, bytes.
    pub storage_bytes: u64,
    /// P2: whether the low-power state any energy figure depends on is
    /// implemented in the software as shipped.
    pub low_power_state_implemented: bool,
    /// P3: Layer 1 bindings provided, as a bearer-ordinal bit set
    /// (L1 Clause 8; all-bearers set is 0x7F).
    pub transports: u8,
    /// P3: versioned parameter declarations for bindings whose binding
    /// document requires platform-selected facts (L0 8.2.1a).
    ///
    /// An empty list means no selected binding requires such a declaration;
    /// it is not a substitute for a BLE profile once the BLE bit is declared.
    pub binding_profiles: &'static [BindingProfileDeclaration],
    /// P4: whether power to sensors/peripherals is gated.
    pub peripheral_power_gated: bool,
    /// P5: whether any timebase survives power loss.
    pub timebase_survives_power_loss: bool,
    /// P6: highest layer this platform runs.
    pub highest_layer_hosted: u8,
    /// P7: whether trust-group key material is retained.
    pub key_bearing: bool,
    /// P8: availability.
    pub availability: Availability,

    // ------------------------------------------------------------------
    // **P9-P13, ADDED 2026-08-05. THE TYPE COULD NOT EXPRESS A CONFORMING
    // DECLARATION WITHOUT THEM**: L0 8.2.1 names THIRTEEN parameters and
    // this struct carried eight, while 8.1.2 requires a declaration to
    // state a value for every parameter in 8.2. Found by hive, which
    // withdrew its own MET on `L0-035` over it rather than working around
    // it.
    //
    // **Every one of the five is stated by 8.2.1 and none is invented
    // here** — the contrast with the packet log (`CORE-22`) is the point:
    // that structure has a capacity and no definition anywhere in the
    // corpus, so it cannot be built; these have their content written out
    // in the clause, so they were simply unbuilt.
    // ------------------------------------------------------------------
    /// ‼ **`None` MEANS TWO THINGS TODAY AND THAT IS A KNOWN DEFECT** (L0
    /// 8.5.1, `STD-SS357`, 2026-08-14). It cannot distinguish **this
    /// platform has no slots** — a *declared shortfall*, which is what
    /// 8.5.1 asks for — from **nobody filled the field in**.
    /// *`FORMATS` 5c.2 Note 2 already rules this class:* **absent is a
    /// fact; zero is a lie with a plausible interpretation.** The corpus
    /// wrote that rule for a reporting surface and has not carried it to
    /// the declaration, so **do not read `None` as an assertion about the
    /// platform** until it does. The shape 8.5 needs is Roy's to rule and
    /// **is deliberately not invented here** — *an invented shape gets
    /// built and then is wrong.*
    ///
    /// **P9: update slots.** `None` where the platform provides no image
    /// slots for the update model of Layer 6, 5.4.
    ///
    /// 8.2.1 asks for three facts and this carries all three — *whether*
    /// (the `Option`), *how many*, and *the usable size of each*. A bare
    /// count would have answered two of the three questions the clause
    /// asks, which is the shape of an under-stated declaration.
    pub update_slots: Option<UpdateSlots>,

    /// **L0 8.5: the facilities this platform does not provide, each naming
    /// the obligations that loss costs.**
    ///
    /// ‼ **AN EMPTY SLICE MEANS *NO SHORTFALL IS DECLARED*, WHICH IS A
    /// CLAIM.** It does not mean nobody looked — *that distinction is the
    /// whole reason 8.5 exists*, and a declaration that could not make it
    /// left a platform lacking a required facility with **no vocabulary for
    /// its own shape** (8.5 Note 1). A publisher prints the list either way,
    /// so a reader sees the claim rather than an absence.
    ///
    /// Shape ruled by Roy 2026-08-19 on `SS357`, over the free-text
    /// alternative: *structured fields make 8.5 checkable*, and **L5A 6.1.3 —
    /// a group shall not adopt a condition whose evidence requires a facility
    /// its platforms have not declared — works only as far as the declaration
    /// can be read by a machine.*
    pub shortfalls: &'static [Shortfall<'static>],

    /// **L0 5.5.2b: the conditions under which this platform's entropy source
    /// is conforming.**
    ///
    /// ‼ **THE CLAUSE SAYS *STATED* CONDITIONS AND NOTHING STATED THEM.**
    /// Both entropy implementations in this workspace refuse correctly at the
    /// moment of use — the ESP32 one checks `TrngSource::is_enabled()` and
    /// returns without touching the buffer — so 5.5.2a and the *refusal* half
    /// of 5.5.2b were honoured. **But the condition existed only as a Rust
    /// comment inside a board crate**, and 8.4.1 requires a declaration a
    /// third party can read *without possessing the platform*.
    ///
    /// *So a reader choosing a board for a key-bearing role could not learn
    /// that its entropy is conditional at all* — the platform looked
    /// unconditionally conforming, which is precisely the reading `SS213`
    /// records a hive making before it minted a weak identity.
    pub entropy: EntropyConditions,

    /// **8.6.1's relational fact**: where the slots and the records region
    /// lie, so *outside both* can be asked at all.
    ///
    /// ‼ **`None` MEANS THE PLATFORM DID NOT STATE ITS LAYOUT AND IS NOT
    /// A CONFORMING ANSWER.** *Absent is a fact; a conforming answer to a
    /// question nobody asked is a lie with a plausible interpretation*
    /// (`FORMATS` 5c.2 Note 2). **Carried here rather than inside
    /// [`UpdateSlots`] because P9 asks how many slots and how large, and
    /// 8.6.1 asks a different question about the same flash.**
    pub slot_layout: Option<SlotLayout>,
    /// **P10: update-path write boundary.** Whether the storage the update
    /// path writes through enforces a boundary that path cannot cross.
    ///
    /// `regions_outside_boundary` is the clause's second half — *which
    /// regions lie outside it* — and it is **meaningless unless
    /// `boundary_enforced`**, which is why the two travel together in one
    /// type rather than as two fields a caller can set inconsistently.
    pub update_write_boundary: WriteBoundary,
    /// **P11: image read-back.** Whether a stored image can be read back
    /// **in pieces bounded by available memory**.
    ///
    /// Named for the clause's own qualifier rather than shortened to
    /// *readable*: a platform that can only read an image whole answers
    /// `false` here, and that is exactly the distinction the parameter
    /// exists to carry (see `CORE-11`/composer's L6 10.8 — reassembly
    /// against a few hundred kB of RAM).
    pub image_read_back_in_bounded_pieces: bool,
    /// **P12: recovery substrate.** Whether the structures the update
    /// arrangement itself depends on can be written by the platform's own
    /// install path, and whether the pre-write integrity check covers
    /// them.
    ///
    /// **Two booleans, because 8.2.1 asks two questions**, and a platform
    /// whose install path can rewrite its own slot layout while the
    /// integrity check does NOT cover it is the dangerous combination the
    /// parameter exists to make visible. Collapsing them to one would hide
    /// exactly that case.
    pub recovery_substrate: RecoverySubstrate,
    /// **P13: position observability.** Whether the platform can report to
    /// the layers above that **no valid image-position record exists**, or
    /// whether its boot path writes one where it finds none.
    ///
    /// The two are mutually exclusive and the second is the hazard —
    /// a boot path that manufactures a position destroys the very fact
    /// L0 4.3.1 and `STD-SS110` turn on — so this is an enum and not a
    /// `bool` whose `false` would have to be read as *the other one*.
    pub position_observability: PositionObservability,
    /// The capability class this platform declares (8.3.3).
    ///
    /// ‼ **THE ONE SITE WHERE 8.3.3 IS THE RIGHT CLAUSE, AND IT IS KEPT AS
    /// THE CONTROL THAT SHOWS THE CLAUSE IS NOT WRONG EVERYWHERE.** 8.3.3
    /// is about **which class a platform satisfying several may declare**;
    /// what it must then *provide* is 8.3.2's. *A sweep that had replaced
    /// every occurrence would have destroyed the distinction it was
    /// correcting.*
    pub class_declared: CapabilityClass,

    /// **8.2.2: every energy or duration figure this platform states, each
    /// naming the parameter values it was measured or calculated against.**
    ///
    /// ‼ **EMPTY IS THE HONEST STATE AND IT IS NOT THE SAME AS ABSENT.** No
    /// platform in this tree states a figure yet, so 8.2.2 is satisfied
    /// vacuously — *and a vacuous satisfaction is not an implementation*. What
    /// this field adds is that the FIRST figure cannot be stated without its
    /// parameters, because [`Figure`] has no constructor that omits them.
    pub figures: &'static [Figure<'static>],
}

/// **An energy or duration figure, inseparable from what it was measured
/// against (8.2.2).**
///
/// ‼ **THE PARAMETERS ARE A FIELD OF THE FIGURE RATHER THAN A NEIGHBOURING
/// LIST, AND THAT IS THE WHOLE CONSTRUCTION.** 8.2.2 obliges a figure to *name
/// the parameter values it was measured or calculated against*; a design that
/// put the figure in one place and its conditions in another would satisfy the
/// clause on the day it was written and drift the moment either moved. **A
/// figure whose conditions can go missing is a figure that will eventually be
/// read against the wrong ones** — and an energy number read against a
/// low-power state the shipped software never enters is exactly what 8.2.1's
/// P2 exists to prevent, said there in its own Note 1.
///
/// [`Figure::new`] refuses an empty `against`, so *twenty days* cannot be
/// stated at all without saying twenty days of what.
///
/// ‼ **THE FIELDS ARE PRIVATE AND THAT IS THE OTHER HALF OF THE
/// CONSTRUCTION.** A refusal inside `new` protects nothing if a caller can
/// build the struct directly, and **no unit test can see that change** — a
/// mutation making `against` public leaves every arm green. So the closure is
/// the type system's, and it is pinned here:
///
/// ```compile_fail,E0451
/// use r2_hal_traits::decl::{Figure, FigureUnit};
/// // 8.2.2: a figure assembled around the constructor, with nothing to read
/// // it against. Private fields refuse it at compile time.
/// let unqualified = Figure {
///     label: "battery life",
///     value: 1_728_000,
///     unit: FigureUnit::Seconds,
///     against: &[],
/// };
/// ```
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Figure<'a> {
    label: &'a str,
    value: u64,
    unit: FigureUnit,
    against: &'a [(Parameter, &'a str)],
}

/// The units 8.2.2's *energy or duration* admits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FigureUnit {
    Seconds,
    MilliwattHours,
}

/// Why a figure cannot be stated.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FigureRefusal {
    /// **8.2.2**: no parameter values were named. *The figure is refused
    /// rather than stored unqualified*, because a number with no conditions
    /// is read against whichever the reader assumes.
    NoParametersNamed,
    /// A figure with no label names nothing a reader could ask about.
    Unlabelled,
}

impl<'a> Figure<'a> {
    /// **The only constructor, and it refuses an unqualified figure.**
    pub const fn new(
        label: &'a str,
        value: u64,
        unit: FigureUnit,
        against: &'a [(Parameter, &'a str)],
    ) -> Result<Self, FigureRefusal> {
        if label.is_empty() {
            return Err(FigureRefusal::Unlabelled);
        }
        if against.is_empty() {
            return Err(FigureRefusal::NoParametersNamed);
        }
        Ok(Self {
            label,
            value,
            unit,
            against,
        })
    }

    #[must_use]
    pub const fn label(&self) -> &'a str {
        self.label
    }
    #[must_use]
    pub const fn value(&self) -> u64 {
        self.value
    }
    #[must_use]
    pub const fn unit(&self) -> FigureUnit {
        self.unit
    }
    /// The parameter values this figure was measured or calculated against.
    /// **Never empty**, by construction.
    #[must_use]
    pub const fn against(&self) -> &'a [(Parameter, &'a str)] {
        self.against
    }
}

/// What a hive actually built, for checking a declaration against.
///
/// Not a declaration: these are the capacities of structures that exist,
/// which is why they are supplied separately from
/// [`PlatformDeclaration`] rather than being fields of it. A value here
/// comes from `N` on a real table, not from a claim.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ObservedCapacities {
    /// Which platform these observations came from.
    ///
    /// ‼ **THE WHOLE POINT: THIS MAKES THE CROSSED CALL REFUSABLE.** A
    /// caller that pairs one board's declaration with another board's
    /// observations gets [`Discrepancy::DifferentPlatform`] rather than
    /// `Ok(())`.
    pub platform: PlatformId,
    /// Entries in the dedup cache actually constructed.
    pub dedup_cache: u32,
    /// Entries in the neighbour table actually constructed.
    pub neighbour_table: u32,
    /// Entries in the packet log actually constructed; `None` where it is
    /// genuinely unbounded.
    pub packet_log: Option<u32>,
    /// Bearer-ordinal bit set for the bearers actually registered.
    pub transports: u8,
    /// Availability assembled for this processor part.
    ///
    /// This is an observation of the part that supplies the structures above,
    /// not a second P8 declaration. L0 8.3.4 requires the Layer 1–4 part of
    /// a split class-2 platform to remain always-on even where its Layer 5–7
    /// counterpart duty-cycles independently.
    pub availability: Availability,
    /// **The slots the platform reports it actually has**, `None` where it
    /// reports none. **L6 5.4.1a: a platform declaring the 5.4.1 capability
    /// shall verify at boot that the storage slots that capability requires
    /// are present.**
    ///
    /// ‼ **This is the observation, not the declaration** — 5.4.1a Note 0's
    /// incident is exactly a platform whose *declaration* was intact while
    /// its layout was not, and *only the bootloader's own dump revealed
    /// it*. A caller that fills this in from the same source as
    /// [`PlatformDeclaration::update_slots`] has built a check that cannot
    /// fail (`01-terminology.md` 5.4 Note 2: **does anything check this
    /// artefact against the thing it claims?**).
    pub update_slots: Option<UpdateSlots>,
}

/// A declaration that does not describe the platform it is on.
///
/// **The capacity obligation is L0 8.3.2** (*shall provide at least*); 8.3.3
/// only governs which class a platform satisfying several may declare. This
/// cited 8.3.3 until 2026-08-14.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Discrepancy {
    /// ‼ **The declaration and the observation are about DIFFERENT
    /// PLATFORMS**, so the comparison had no common subject at all.
    ///
    /// *Checked before every capacity, because a capacity comparison
    /// across two boards is not a weaker check — it is a check of
    /// nothing, and it can pass.*
    DifferentPlatform {
        declared: PlatformId,
        observed: PlatformId,
    },
    /// Class 2 has distinct Layer 1–4 and Layer 5–7 capacity obligations.
    /// One aggregate observation cannot establish that either processor part
    /// supplies its own required structures.
    Class2NeedsSeparatePartObservations,
    /// The Layer 1–4 processor part of a split class-2 platform is not
    /// always-on, contrary to L0 8.3.4.
    Class2L1ToL4NotAlwaysOn,
    /// The dedup cache is smaller than the declared class requires.
    DedupCacheTooSmall { class_requires: u32, built: u32 },
    /// The neighbour table is smaller than the declared class requires.
    NeighbourTableTooSmall { class_requires: u32, built: u32 },
    /// The packet log is smaller than the declared class requires.
    PacketLogTooSmall { class_requires: u32, built: u32 },
    /// A class whose capacity row requires an unbounded packet log supplied
    /// a finite one instead.
    PacketLogMustBeUnbounded { built: u32 },
    /// The declaration names no Layer 1 binding, so it cannot describe a
    /// platform that hosts a Reality2 hive (L0 5.1.1).
    NoTransportBindings,
    /// The declaration's P3 bindings are not the bindings the image provides.
    ///
    /// P3 is a declaration fact, not a capacity floor: `missing` is the set
    /// of declared-but-unbuilt bindings and `unexpected` is the set of
    /// built-but-undeclared bindings. Either result leaves layers above the
    /// platform with a false binding inventory.
    TransportsMismatch {
        declared: u8,
        built: u8,
        missing: u8,
        unexpected: u8,
    },
    /// A P3 binding profile is malformed or does not describe one of the
    /// platform's declared transport bindings.
    BindingProfileInvalid {
        /// Position in [`PlatformDeclaration::binding_profiles`].
        index: usize,
        /// The fail-closed reason this declaration cannot be published as a
        /// binding profile.
        reason: BindingProfileRefusal,
    },
    /// **L0 8.2.1a: P3 names a binding whose binding document requires a
    /// binding-parameter declaration, and the declaration carries none for
    /// it.** `transport_bit` is that binding's bearer-ordinal bit — for BLE,
    /// [`BLE_TRANSPORT_BIT`], required by L1-BINDING-BLE 6a-ter.1. Until
    /// 2026-09-03 a declaration could set the BLE bit beside an empty
    /// profile list and nothing refused it (`L0-053`): the profile check
    /// validated the profiles a declaration DID carry and could not see the
    /// one it omitted.
    BindingProfileMissing { transport_bit: u8 },
    /// The declaration's P9 update-facility fact is not the facility the
    /// image provides. `None` says no update slots; `Some` states both the
    /// count and usable size. P9 is not a minimum-capacity claim.
    UpdateSlotsMismatch {
        declared: Option<UpdateSlots>,
        observed: Option<UpdateSlots>,
    },
}

/// A parameter of the platform declaration (L0 8.2.1), and **whether this
/// crate corroborates it or takes it on the declaration's word**.
///
/// # Why this is an enum and not a list of strings
///
/// ‼ **The list it replaces was written when the declaration carried eight
/// parameters and was never extended when it grew to thirteen.** `P6`, and
/// then `P9`-`P13` (added 2026-08-05), were **neither checked nor named as
/// unchecked** — so a caller reading
/// [`PlatformDeclaration::unverifiable_here`] to learn the limits of a
/// passing check was told about seven of the twelve it had.
///
/// *An honesty mechanism that enumerates is only honest about the
/// population it was written against.* An exhaustive `match` makes the
/// question compulsory for every parameter in this enum rather than
/// optional.
///
/// **Residue, stated rather than hidden:** adding a *field* to
/// [`PlatformDeclaration`] does not force a variant here. The compiler
/// closes the gap between this enum and the answer; it does not close the
/// gap between this enum and the struct, and no Rust construct does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Parameter {
    /// P1, memory. P1 carries two values, so it is two variants.
    P1Memory,
    /// P1, storage.
    P1Storage,
    /// P2, low-power state implemented.
    P2LowPowerState,
    /// P3, Layer 1 bindings provided.
    P3Transports,
    /// P4, peripheral power gating.
    P4PeripheralPower,
    /// P5, timebase survival across power loss.
    P5Timebase,
    /// P6, highest layer hosted.
    P6HighestLayer,
    /// P7, key bearing.
    P7KeyBearing,
    /// P8, availability.
    P8Availability,
    /// P9, update slots.
    P9UpdateSlots,
    /// P10, update-path write boundary.
    P10WriteBoundary,
    /// P11, image read-back in bounded pieces.
    P11ImageReadBack,
    /// P12, recovery substrate.
    P12RecoverySubstrate,
    /// P13, position observability.
    P13PositionObservability,
}

impl Parameter {
    /// Every parameter of 8.2.1, in clause order.
    pub const ALL: [Parameter; 14] = [
        Parameter::P1Memory,
        Parameter::P1Storage,
        Parameter::P2LowPowerState,
        Parameter::P3Transports,
        Parameter::P4PeripheralPower,
        Parameter::P5Timebase,
        Parameter::P6HighestLayer,
        Parameter::P7KeyBearing,
        Parameter::P8Availability,
        Parameter::P9UpdateSlots,
        Parameter::P10WriteBoundary,
        Parameter::P11ImageReadBack,
        Parameter::P12RecoverySubstrate,
        Parameter::P13PositionObservability,
    ];

    /// The parameter's name, for a caller reporting what it could not check.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Parameter::P1Memory => "P1 memory_bytes",
            Parameter::P1Storage => "P1 storage_bytes",
            Parameter::P2LowPowerState => "P2 low_power_state_implemented",
            Parameter::P3Transports => "P3 transports",
            Parameter::P4PeripheralPower => "P4 peripheral_power_gated",
            Parameter::P5Timebase => "P5 timebase_survives_power_loss",
            Parameter::P6HighestLayer => "P6 highest_layer_hosted",
            Parameter::P7KeyBearing => "P7 key_bearing",
            Parameter::P8Availability => "P8 availability",
            Parameter::P9UpdateSlots => "P9 update_slots",
            Parameter::P10WriteBoundary => "P10 update_write_boundary",
            Parameter::P11ImageReadBack => "P11 image_read_back_in_bounded_pieces",
            Parameter::P12RecoverySubstrate => "P12 recovery_substrate",
            Parameter::P13PositionObservability => "P13 position_observability",
        }
    }

    /// Whether [`PlatformDeclaration::corroborate`] compares this parameter
    /// against something the platform actually built.
    ///
    /// **Exhaustive on purpose**: a new parameter does not compile until
    /// someone answers this question for it, and *unanswered* is the state
    /// that produced this type.
    #[must_use]
    pub const fn corroborated_here(self) -> bool {
        match self {
            // Bearer bindings (declared-and-absent is caught) and slots
            // (L6 5.4.1a, against the platform's own report).
            Parameter::P3Transports | Parameter::P9UpdateSlots => true,
            // Everything else is a claim about hardware or about software
            // behaviour that only instrumenting the platform can settle,
            // and this crate is sans-IO.
            Parameter::P1Memory
            | Parameter::P1Storage
            | Parameter::P2LowPowerState
            | Parameter::P4PeripheralPower
            | Parameter::P5Timebase
            | Parameter::P6HighestLayer
            | Parameter::P7KeyBearing
            | Parameter::P8Availability
            | Parameter::P10WriteBoundary
            | Parameter::P11ImageReadBack
            | Parameter::P12RecoverySubstrate
            | Parameter::P13PositionObservability => false,
        }
    }
}

impl PlatformDeclaration {
    /// Check that P3 names at least one binding, then validate every
    /// binding-profile's shape and ownership against that transport set.
    ///
    /// The L0 layer deliberately does not parse a schema's canonical value:
    /// that interpretation belongs to the portable binding which publishes
    /// the schema. It can still reject an empty, duplicate, or unowned
    /// profile before a board assembly presents it as a platform fact.
    pub const fn check_binding_profiles(&self) -> Result<(), Discrepancy> {
        // L0 5.1.1 is not a capacity floor: a platform with no bindings
        // cannot host a hive at all. A pair of zero bitsets would otherwise
        // corroborate exactly, and publication would turn that invalid image
        // into a plausible P3 declaration.
        if self.transports == 0 {
            return Err(Discrepancy::NoTransportBindings);
        }
        let mut index = 0;
        while index < self.binding_profiles.len() {
            let profile = self.binding_profiles[index];
            if let Err(reason) = profile.check() {
                return Err(Discrepancy::BindingProfileInvalid { index, reason });
            }
            if profile.transport_bit & self.transports == 0 {
                return Err(Discrepancy::BindingProfileInvalid {
                    index,
                    reason: BindingProfileRefusal::TransportNotDeclared,
                });
            }
            let mut earlier = 0;
            while earlier < index {
                if self.binding_profiles[earlier].transport_bit == profile.transport_bit {
                    return Err(Discrepancy::BindingProfileInvalid {
                        index,
                        reason: BindingProfileRefusal::DuplicateTransport,
                    });
                }
                earlier += 1;
            }
            index += 1;
        }
        Ok(())
    }

    /// **L0 8.2.1a: every declared binding whose binding document requires
    /// a P3 binding-parameter declaration has one** — for BLE, L1-BINDING-BLE
    /// 6a-ter.1. The population is [`BINDINGS_REQUIRING_A_PROFILE`].
    ///
    /// This is the other half of [`Self::check_binding_profiles`]: that
    /// method validates the profiles a declaration DOES carry, and cannot
    /// see the one it omits. Both corroboration entry points call both.
    ///
    /// **Kept beside the profile check rather than folded into it, and the
    /// reason is stated rather than hidden**: `publish` calls
    /// `check_binding_profiles` over a fixture that sets the BLE bit and
    /// carries no profile, so the requirement placed there would turn the
    /// publisher's own tests red before that fixture is corrected. The
    /// residue is that a BLE-declaring platform with no profile can still be
    /// PUBLISHED; it cannot be CORROBORATED.
    pub const fn check_required_binding_profiles(&self) -> Result<(), Discrepancy> {
        let mut i = 0;
        while i < BINDINGS_REQUIRING_A_PROFILE.len() {
            let transport_bit = BINDINGS_REQUIRING_A_PROFILE[i];
            if self.transports & transport_bit != 0 && !self.carries_profile_for(transport_bit) {
                return Err(Discrepancy::BindingProfileMissing { transport_bit });
            }
            i += 1;
        }
        Ok(())
    }

    /// Whether P3 carries a binding profile for exactly this bearer bit.
    const fn carries_profile_for(&self, transport_bit: u8) -> bool {
        let mut i = 0;
        while i < self.binding_profiles.len() {
            if self.binding_profiles[i].transport_bit == transport_bit {
                return true;
            }
            i += 1;
        }
        false
    }

    /// Check this declaration against what the platform actually built.
    ///
    /// ‼ **THE OBLIGATION IS 8.3.2, NOT 8.3.3, AND THIS COMMENT SAID
    /// OTHERWISE UNTIL 2026-08-14** (`composer`, measured against
    /// `L0-hardware-and-runtime.md`). *8.3.2: a platform in a capability
    /// class shall provide AT LEAST the following capacities.* 8.3.3 is a
    /// **class-declaration rule** — which class you may pick when you
    /// satisfy several — and it points the obligation back at 8.3.2. The
    /// apparatus was checking a real obligation and citing the wrong clause
    /// for it.
    ///
    /// ‼ **AND NOTHING IN L0 REQUIRES THIS CHECK TO RUN AT ALL.** 8.3.2
    /// says *shall provide*, never *shall verify*, *shall check at boot* or
    /// *shall corroborate*; `corroborat` occurs exactly **twice** in L0 and
    /// **both point at Layer 6 5.4.2b**, which is the OTA record against
    /// the slots — a different subject. **So calling this is LANE POLICY
    /// and must never be recorded as discharging 8.3.2 or 8.3.3.**
    /// *Enforcing a rule the corpus does not state is a legitimate choice
    /// with an author and a reason, and it is never conformance.*
    ///
    /// # Why this exists
    ///
    /// **A declaration is an artefact that claims something about the
    /// world, and validity is not truth.** Every field here is
    /// well-formed by construction — the types guarantee it — and none of
    /// that establishes the values are *so*. L6 5.4.1a Note 0 states the
    /// principle from an incident where firmware *"went on printing the
    /// layout it had been written to claim"*: **a platform's own
    /// assertion about its configuration is not evidence of that
    /// configuration.** That clause applies the principle to a partition
    /// table. It applies here word for word.
    ///
    /// Nothing here can measure RAM or verify a low-power state — those
    /// claims are checkable only by instrumenting the platform, and this
    /// crate is sans-IO. What it *can* do is compare the declaration
    /// against structures that were actually constructed, because their
    /// sizes are facts rather than assertions. **Only something that reads
    /// both the claim and the thing claimed can notice a disagreement**,
    /// and this is the one place in this crate that holds both.
    ///
    /// What remains unchecked is named rather than implied — see
    /// [`PlatformDeclaration::unverifiable_here`].
    pub fn corroborate(&self, built: ObservedCapacities) -> Result<(), Discrepancy> {
        // ‼ SUBJECT FIRST. Everything below compares numbers, and numbers
        // from two different boards compare perfectly well.
        if self.platform != built.platform {
            return Err(Discrepancy::DifferentPlatform {
                declared: self.platform,
                observed: built.platform,
            });
        }
        self.check_binding_profiles()?;
        self.check_required_binding_profiles()?;
        // L0 8.3.2 gives class 2 two different columns.  An aggregate
        // observation cannot show which processor supplied a capacity, so a
        // one-observation check must not certify the pair.  Call the explicit
        // two-part operation below instead.
        if self.class_declared == CapabilityClass::Class2 {
            return Err(Discrepancy::Class2NeedsSeparatePartObservations);
        }
        Self::corroborate_capacities(built, self.class_declared.capacities())?;
        self.corroborate_transports_and_slots(built)
    }

    /// Corroborate a class-2 declaration against each processor part.
    ///
    /// L0 8.3.2 assigns the class-1 capacities to the Layer 1–4 part and
    /// the class-3 capacities to the Layer 5–7 part.  The two observations
    /// retain their common platform identity so a crossed-board comparison
    /// remains a refusal, not a plausible numeric match.
    pub fn corroborate_class2_parts(
        &self,
        l1_to_l4: ObservedCapacities,
        l5_to_l7: ObservedCapacities,
    ) -> Result<(), Discrepancy> {
        if self.class_declared != CapabilityClass::Class2 {
            return self.corroborate(l1_to_l4);
        }
        for observed in [l1_to_l4, l5_to_l7] {
            if self.platform != observed.platform {
                return Err(Discrepancy::DifferentPlatform {
                    declared: self.platform,
                    observed: observed.platform,
                });
            }
        }
        self.check_binding_profiles()?;
        self.check_required_binding_profiles()?;
        if l1_to_l4.availability != Availability::AlwaysOn {
            return Err(Discrepancy::Class2L1ToL4NotAlwaysOn);
        }
        Self::corroborate_capacities(l1_to_l4, CapabilityClass::Class1.capacities())?;
        Self::corroborate_capacities(l5_to_l7, CapabilityClass::Class3.capacities())?;
        // L1 bindings are supplied by the always-on Layer 1–4 part; Layer 6
        // update slots belong to the Layer 5–7 part.
        self.corroborate_transports(l1_to_l4)?;
        self.corroborate_update_slots(l5_to_l7)
    }

    fn corroborate_capacities(
        built: ObservedCapacities,
        needs: ClassCapacities,
    ) -> Result<(), Discrepancy> {
        if built.dedup_cache < needs.dedup_cache {
            return Err(Discrepancy::DedupCacheTooSmall {
                class_requires: needs.dedup_cache,
                built: built.dedup_cache,
            });
        }
        if built.neighbour_table < needs.neighbour_table {
            return Err(Discrepancy::NeighbourTableTooSmall {
                class_requires: needs.neighbour_table,
                built: built.neighbour_table,
            });
        }
        // An unbounded log satisfies any finite floor.  Conversely, the
        // `unbounded` cell in L0 8.3.2 is an exact obligation: no finite
        // allocation can corroborate it.
        match (needs.packet_log, built.packet_log) {
            (Some(required), Some(actual)) if actual < required => {
                return Err(Discrepancy::PacketLogTooSmall {
                    class_requires: required,
                    built: actual,
                });
            }
            (None, Some(actual)) => {
                return Err(Discrepancy::PacketLogMustBeUnbounded { built: actual });
            }
            _ => {}
        }
        Ok(())
    }

    fn corroborate_transports_and_slots(
        &self,
        built: ObservedCapacities,
    ) -> Result<(), Discrepancy> {
        self.corroborate_transports(built)?;
        self.corroborate_update_slots(built)
    }

    fn corroborate_transports(&self, built: ObservedCapacities) -> Result<(), Discrepancy> {
        // P3 states every Layer 1 binding the platform provides. Unlike the
        // capacity class, it is not a floor: either set difference is a false
        // declaration to an upper-layer consumer.
        let missing = self.transports & !built.transports;
        let unexpected = built.transports & !self.transports;
        if missing != 0 || unexpected != 0 {
            return Err(Discrepancy::TransportsMismatch {
                declared: self.transports,
                built: built.transports,
                missing,
                unexpected,
            });
        }
        Ok(())
    }

    fn corroborate_update_slots(&self, built: ObservedCapacities) -> Result<(), Discrepancy> {
        // P9 states whether slots exist and, where they do, their count and
        // usable size. A larger facility is still a different stated fact.
        if self.update_slots != built.update_slots {
            return Err(Discrepancy::UpdateSlotsMismatch {
                declared: self.update_slots,
                observed: built.update_slots,
            });
        }
        Ok(())
    }

    /// The parameters [`PlatformDeclaration::corroborate`] cannot check —
    /// stated so a caller does not read a passing check as *the declaration
    /// is true*.
    ///
    /// **Derived from [`Parameter::corroborated_here`] rather than written
    /// out**, because the written-out version was a list of seven beside a
    /// declaration of fourteen values. A corroborated declaration means
    /// **the class's table capacities, the bearer bindings and the update
    /// slots are real**, and nothing more.
    pub fn unverifiable_here() -> impl Iterator<Item = Parameter> {
        Parameter::ALL
            .into_iter()
            .filter(|p| !p.corroborated_here())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **`01-terminology` 4.1b: TWO COOPERATING PROCESSORS ARE ONE HIVE ONLY
    /// WHERE EXACTLY ONE IDENTITY IS PRESENTED — AND NO ARM ASSERTED THE
    /// ONENESS.** The declaration is singular by construction, one
    /// `PlatformId` and one capability set per `PlatformDeclaration`, so
    /// *exactly one presented to other hives* is the shape of the type. But
    /// the class-2 path takes TWO observations, and that is the one place
    /// where two things could disagree about which hive they are.
    ///
    /// So this feeds it two parts that name DIFFERENT platforms and requires
    /// the refusal. *Without it, a split hive whose halves believed they were
    /// different devices would corroborate*, and 4.1b's condition — the one
    /// that makes them one hive at all — would be unchecked at the only seam
    /// where it can fail.
    #[test]
    fn two_cooperating_parts_that_name_different_platforms_are_not_one_hive() {
        let mut declaration = class1();
        declaration.class_declared = CapabilityClass::Class2;
        let lower = honest();
        let mut upper = honest();

        // THE CONTROL: both parts naming this declaration's platform get past
        // the identity check (and fail, if at all, further down on capacity).
        assert!(
            !matches!(
                declaration.corroborate_class2_parts(lower, upper),
                Err(Discrepancy::DifferentPlatform { .. })
            ),
            "precondition: two parts of ONE platform are not refused for identity"
        );

        // ‼ THE SUBJECT: the upper half believes it is a different device.
        upper.platform = PlatformId(0xDEAD_BEEF);
        assert_eq!(
            declaration.corroborate_class2_parts(lower, upper),
            Err(Discrepancy::DifferentPlatform {
                declared: declaration.platform,
                observed: PlatformId(0xDEAD_BEEF),
            }),
            "‼ 4.1b: two processors are one hive only where exactly ONE identity \
             is presented — halves that disagree are two devices, not one hive"
        );

        // And the same for the lower half, so the check is on BOTH parts
        // rather than on whichever one the fixture happens to vary.
        let mut lower_wrong = honest();
        lower_wrong.platform = PlatformId(0xDEAD_BEEF);
        assert_eq!(
            declaration.corroborate_class2_parts(lower_wrong, honest()),
            Err(Discrepancy::DifferentPlatform {
                declared: declaration.platform,
                observed: PlatformId(0xDEAD_BEEF),
            })
        );
    }

    /// ‼ **5.5.2b IS A DIFFERENT QUESTION FROM 5.5.2 AND THE PAIR IS ASSERTED
    /// TOGETHER.** *May this platform ever* and *may it right now* diverge on
    /// exactly one arm, and that arm is the clause: a platform whose source is
    /// conforming only under stated conditions must refuse WHILE they are
    /// unmet. A test of `may_fill_now` alone would pass against a function
    /// that ignored its argument, so the divergence is what is measured.
    #[test]
    fn a_conditional_platform_may_generate_and_must_still_refuse_while_the_condition_is_unmet() {
        const NAMED: EntropyConditions = EntropyConditions::OnlyWhile(&["TrngSource::is_enabled"]);
        // 5.5.2: it may, in principle.
        assert!(NAMED.may_generate_key_material());
        // 5.5.2b: and it must not, right now.
        assert!(!NAMED.may_fill_now(false), "‼ the refusal 5.5.2b obliges");
        assert!(NAMED.may_fill_now(true), "and it generates once they hold");

        // ‼ THE DIVERGENCE, STATED AS ONE ASSERTION: the two answers differ on
        //   this arm and on no other, which is why 5.5.2b needed its own.
        assert_ne!(
            NAMED.may_generate_key_material(),
            NAMED.may_fill_now(false),
            "5.5.2 and 5.5.2b are different questions"
        );

        // Unconditional ignores the observation deliberately — its conditions
        // are vacuous, so refusing would be refusing on evidence it never
        // claimed to depend on.
        assert!(EntropyConditions::Unconditional.may_fill_now(false));
        assert!(EntropyConditions::Unconditional.may_fill_now(true));

        // No observation makes these permissible. The operator action for
        // `None` is to replace the platform, not to wait.
        for never in [
            EntropyConditions::None,
            EntropyConditions::NotStated,
            EntropyConditions::OnlyWhile(&[]),
        ] {
            assert!(!never.may_fill_now(true), "{never:?} cannot be waited out");
            assert!(!never.may_fill_now(false), "{never:?}");
        }
    }

    fn class1() -> PlatformDeclaration {
        PlatformDeclaration {
            shortfalls: &[],
            entropy: EntropyConditions::Unconditional,
            memory_bytes: 512 * 1024,
            storage_bytes: 4 * 1024 * 1024,
            low_power_state_implemented: true,
            transports: 0b0000_0110,
            binding_profiles: &[],
            peripheral_power_gated: true,
            timebase_survives_power_loss: false,
            highest_layer_hosted: 7,
            key_bearing: true,
            availability: Availability::AlwaysOn,
            // P9-P13, stated because 8.1.2 requires a value for EVERY
            // parameter of 8.2 — and the compiler now requires it too:
            // adding these five broke every existing constructor, which is
            // the clause enforced rather than remembered.
            update_slots: Some(UpdateSlots {
                count: 2,
                usable_bytes_each: 1_600 * 1024,
            }),
            update_write_boundary: WriteBoundary {
                enforced: true,
                regions_outside: 0b1,
            },
            image_read_back_in_bounded_pieces: true,
            recovery_substrate: RecoverySubstrate {
                writable_by_install_path: false,
                integrity_check_covers_them: true,
            },
            position_observability: PositionObservability::ReportsAbsence,
            class_declared: CapabilityClass::Class1,
            figures: &[],
            slot_layout: None,
            platform: PlatformId(1),
        }
    }

    /// **P9-P13 are STATED, and 8.1.2 is what makes that a requirement.**
    ///
    /// The declaration type is the only thing that can enforce *a value
    /// for every parameter* — a struct with a field per parameter and no
    /// `Default` cannot be constructed while leaving one out, which is why
    /// adding these five broke every constructor in the workspace instead
    /// of passing silently.
    /// ‼ **8.6.1's RELATIONAL HALF, WHICH COULD NOT BE ASKED BEFORE
    /// 2026-08-14.** The fixture is `hive`'s **measured** DFR1195 layout,
    /// computed from the board's partition table rather than read off it —
    /// *inside-ness is a relation between four numbers and none of the four
    /// states it.*
    ///
    /// **The defect this closes, in `hive`'s sharper form**: the board was
    /// conforming *before* the field existed, and it passed for the same
    /// reason a board with records inside a slot would have passed —
    /// nothing looked. ‼ **A PASS AND A NON-CHECK ARE THE SAME OBSERVATION
    /// UNTIL SOMEBODY BUILDS THE CHECK.**
    ///
    /// ‼ **AND WHAT REMAINS UNVERIFIED, WHICH IS `hive`'s OWN LIMIT**:
    /// these extents come from the source of truth the image is *built*
    /// from — the right subject for a declaration — **but a board flashed
    /// with a different partition table would satisfy every test here and
    /// be wrong.** That is a bench check, and this lane does not flash.
    /// ‼ **THE CROSSED CORROBORATION, WHICH USED TO PASS.** `hive`
    /// measured that one board's declaration corroborated against
    /// another board's observations compiled and returned `Ok(())` — *a
    /// check of nothing, returning the answer the caller wanted.*
    /// ‼ **L0 8.6.2: A PLATFORM STATING NO WRITE BOUNDARY SHALL NOT CLAIM
    /// L6 4.2.2 BY CONSTRUCTION** — and until 2026-08-14 the prohibition
    /// **had no site to fire at**: P10 was representable and *nothing
    /// anywhere carried the claim*, so the rule could be neither broken nor
    /// kept.
    ///
    /// The claim is now unconstructible without the declaration that
    /// permits it. *4.2.2's own words are the reason: an update path shall
    /// be constructed so that it cannot — **not merely instructed that it
    /// may not** — and a claim a platform could assert about itself is an
    /// instruction wearing a claim's clothes.*
    #[test]
    fn a_platform_with_no_write_boundary_cannot_claim_construction_isolation() {
        let none = WriteBoundary {
            enforced: false,
            regions_outside: 0,
        };
        assert!(
            none.is_coherent(),
            "precondition: a coherent declaration, just not an enforcing one"
        );
        assert!(
            ConstructionIsolationClaim::from_boundary(&none).is_none(),
            "8.6.2"
        );

        // CONTROL 1: an enforced boundary MAY claim it, so this is not a
        // refusal of every platform.
        let enforced = WriteBoundary {
            enforced: true,
            regions_outside: 0b11,
        };
        assert!(ConstructionIsolationClaim::from_boundary(&enforced).is_some());

        // ‼ CONTROL 2: AN INCOHERENT DECLARATION CANNOT CLAIM IT EITHER.
        // Regions outside a boundary that does not exist is *stating
        // something about nothing*, and a claim resting on it would rest on
        // a declaration the platform has already contradicted.
        let incoherent = WriteBoundary {
            enforced: false,
            regions_outside: 0b1,
        };
        assert!(!incoherent.is_coherent(), "precondition: incoherent");
        assert!(ConstructionIsolationClaim::from_boundary(&incoherent).is_none());
    }

    #[test]
    fn a_corroboration_across_two_platforms_is_refused() {
        let mut decl = class1();
        decl.platform = PlatformId(0x00DF_1195);
        let mut built = honest();
        built.platform = PlatformId(0x0000_01A0);

        assert_eq!(
            decl.corroborate(built),
            Err(Discrepancy::DifferentPlatform {
                declared: PlatformId(0x00DF_1195),
                observed: PlatformId(0x0000_01A0),
            }),
        );
    }

    /// ‼ **AND THE NEGATIVE CONTROL FOR IT**: the same observations, with
    /// the SAME platform id, corroborate cleanly — so the refusal above is
    /// attributable to the subject check and not to the capacities.
    #[test]
    fn the_same_observations_pass_when_the_platform_matches() {
        let decl = class1();
        let built = honest();
        assert_eq!(decl.platform, built.platform);
        assert_eq!(decl.corroborate(built), Ok(()));
    }

    #[test]
    fn hives_measured_layout_puts_the_records_outside_both_slots() {
        let layout = SlotLayout {
            slots: [
                Extent {
                    start: 0x020_000,
                    len: 0x190_000,
                }, // ota_0 .. 0x1b0000
                Extent {
                    start: 0x1b0_000,
                    len: 0x190_000,
                }, // ota_1 .. 0x340000
                Extent { start: 0, len: 0 },
                Extent { start: 0, len: 0 },
            ],
            described: 2,
            // ‼ **THE RECORDS REGION IS `r2store`, NOT `persona`** — this
            // fixture named `persona` until `hive` corrected it
            // (2026-08-14). **Both are data-undefined and a lookup by TYPE
            // returns `persona` first**, so the wrong one is what a
            // reasonable implementation reaches for; `hive`'s store selects
            // by LABEL and says so at its site. *Naming `persona` here
            // would declare conformance for a region the store never
            // writes, and it would have looked exactly as correct.*
            records: Extent {
                start: 0x380_000,
                len: 0x080_000,
            },
        };
        assert!(layout.records_outside_all_slots());
        assert!(UpdateSlots {
            count: 2,
            usable_bytes_each: 0x190_000
        }
        .meets_slot_floor());
    }

    /// The negative the clause exists for: **a record inside a slot is
    /// erased by the write it exists to describe** (8.6.1 Note 1).
    #[test]
    fn records_inside_a_slot_are_detected() {
        let layout = SlotLayout {
            slots: [
                Extent {
                    start: 0x020_000,
                    len: 0x190_000,
                },
                Extent {
                    start: 0x1b0_000,
                    len: 0x190_000,
                },
                Extent { start: 0, len: 0 },
                Extent { start: 0, len: 0 },
            ],
            described: 2,
            // Moved inside ota_1 — the shape nothing would have noticed.
            records: Extent {
                start: 0x200_000,
                len: 0x010_000,
            },
        };
        assert!(!layout.records_outside_all_slots());
    }

    /// A wrapped endpoint must not make an overlapping high-end record region
    /// look safely disjoint.
    #[test]
    fn an_unrepresentable_slot_extent_fails_the_records_safety_check() {
        let layout = SlotLayout {
            slots: [
                Extent {
                    start: u64::MAX - 10,
                    len: 20,
                },
                Extent { start: 0, len: 0 },
                Extent { start: 0, len: 0 },
                Extent { start: 0, len: 0 },
            ],
            described: 1,
            records: Extent {
                start: u64::MAX - 5,
                len: 1,
            },
        };
        assert_eq!(layout.slots[0].end(), None);
        assert!(!layout.records_outside_all_slots());
    }

    /// ‼ **AN UNSTATED LAYOUT ANSWERS `None`, NEVER `true`.** Absent is a
    /// fact; a conforming answer to a question nobody asked is a lie with
    /// a plausible interpretation (`FORMATS` 5c.2 Note 2).
    #[test]
    fn an_unstated_layout_is_not_a_conforming_one() {
        let d = class1();
        assert!(d.slot_layout.is_none());
    }

    /// 8.6.1's floor is **two**, and it fails independently of the layout.
    #[test]
    fn one_slot_fails_the_floor_whatever_the_layout_says() {
        let slots = UpdateSlots {
            count: 1,
            usable_bytes_each: 1,
        };
        assert!(!slots.meets_slot_floor());
    }

    /// A zero-length extent overlaps nothing — the honest answer for an
    /// undescribed slot, and the reason `described` bounds the scan.
    #[test]
    fn an_undescribed_slot_does_not_manufacture_an_overlap() {
        let empty = Extent {
            start: 0x340_000,
            len: 0,
        };
        let records = Extent {
            start: 0x340_000,
            len: 0x040_000,
        };
        assert!(!empty.overlaps(&records));
        assert!(!records.overlaps(&empty));
    }

    #[test]
    fn a_declaration_states_all_thirteen_parameters() {
        let d = class1();
        // P1-P8, the eight that were already here.
        assert!(d.memory_bytes > 0 && d.storage_bytes > 0);
        assert!(d.low_power_state_implemented);
        assert_ne!(d.transports, 0);
        assert!(d.peripheral_power_gated);
        assert!(!d.timebase_survives_power_loss);
        assert_eq!(d.highest_layer_hosted, 7);
        assert!(d.key_bearing);
        assert_eq!(d.availability, Availability::AlwaysOn);
        // P9-P13.
        let slots = d.update_slots.expect("P9");
        assert_eq!(slots.count, 2);
        assert_eq!(slots.usable_bytes_each, 1_600 * 1024);
        assert!(d.update_write_boundary.enforced);
        assert!(d.image_read_back_in_bounded_pieces);
        assert!(d.recovery_substrate.integrity_check_covers_them);
        assert_eq!(
            d.position_observability,
            PositionObservability::ReportsAbsence
        );
    }

    /// **P10's two halves must agree**, and the incoherent pair is the one
    /// worth naming: regions declared outside a boundary that is not
    /// enforced is a statement about nothing.
    #[test]
    fn naming_regions_outside_an_unenforced_boundary_is_incoherent() {
        assert!(WriteBoundary {
            enforced: true,
            regions_outside: 0b11
        }
        .is_coherent());
        assert!(WriteBoundary {
            enforced: false,
            regions_outside: 0
        }
        .is_coherent());
        // EXCLUDED CASE: the one that is not.
        assert!(!WriteBoundary {
            enforced: false,
            regions_outside: 0b11
        }
        .is_coherent());
    }

    /// **P12's dangerous combination is nameable and is NOT refused here.**
    ///
    /// The install path can rewrite the structures the update arrangement
    /// depends on, and the pre-write integrity check does not cover them.
    /// L0 states no conformance requirement on that pair, so this crate
    /// reports it and does not judge it — *inventing a refusal would build
    /// a requirement the corpus does not state.*
    #[test]
    fn the_self_writable_unchecked_substrate_is_named_not_refused() {
        let dangerous = RecoverySubstrate {
            writable_by_install_path: true,
            integrity_check_covers_them: false,
        };
        assert!(dangerous.self_writable_and_unchecked());
        // EXCLUDED CASES: each of the other three combinations is not it.
        for (w, c) in [(true, true), (false, false), (false, true)] {
            assert!(!RecoverySubstrate {
                writable_by_install_path: w,
                integrity_check_covers_them: c
            }
            .self_writable_and_unchecked());
        }
        // And it is not a Discrepancy: corroborate() has no arm for it.
        assert_eq!(class1().corroborate(honest()), Ok(()));
    }

    fn honest() -> ObservedCapacities {
        ObservedCapacities {
            dedup_cache: 128,
            neighbour_table: 32,
            packet_log: Some(256),
            transports: 0b0000_0110,
            availability: Availability::AlwaysOn,
            // What the platform reports it has, matching class1()'s claim.
            update_slots: Some(UpdateSlots {
                count: 2,
                usable_bytes_each: 1_600 * 1024,
            }),
            platform: PlatformId(1),
        }
    }

    #[test]
    fn an_honest_declaration_corroborates() {
        assert_eq!(class1().corroborate(honest()), Ok(()));
    }

    #[test]
    fn a_platform_without_a_transport_binding_is_refused() {
        // L0 5.1.1 requires one or more bindings. Matching zero-valued P3
        // bitsets are not an honest declaration and observation of a hive.
        let mut declaration = class1();
        declaration.transports = 0;
        let mut built = honest();
        built.transports = 0;
        assert_eq!(
            declaration.check_binding_profiles(),
            Err(Discrepancy::NoTransportBindings)
        );
        assert_eq!(
            declaration.corroborate(built),
            Err(Discrepancy::NoTransportBindings)
        );
    }

    #[test]
    fn a_declaration_claiming_a_class_it_does_not_provide_is_caught() {
        // L0 8.3.2 — *shall provide at least* — and NOT 8.3.3, which only
        // governs which class a multi-class platform may declare. Plus L6
        // 5.4.1a Note 0's principle: the firmware went on printing the
        // layout it had been written to claim.
        let mut built = honest();
        built.dedup_cache = 64;
        assert_eq!(
            class1().corroborate(built),
            Err(Discrepancy::DedupCacheTooSmall {
                class_requires: 128,
                built: 64
            })
        );

        let mut built = honest();
        built.neighbour_table = 8;
        assert!(matches!(
            class1().corroborate(built),
            Err(Discrepancy::NeighbourTableTooSmall { .. })
        ));

        let mut built = honest();
        built.packet_log = Some(16);
        assert!(matches!(
            class1().corroborate(built),
            Err(Discrepancy::PacketLogTooSmall { .. })
        ));
    }

    #[test]
    fn a_declared_bearer_that_is_not_registered_is_a_lie() {
        // The declaration says it binds bearers 1 and 2; only 2 exists.
        let mut built = honest();
        built.transports = 0b0000_0100;
        assert_eq!(
            class1().corroborate(built),
            Err(Discrepancy::TransportsMismatch {
                declared: 0b0000_0110,
                built: 0b0000_0100,
                missing: 0b0000_0010,
                unexpected: 0,
            })
        );
    }

    #[test]
    fn a_bearer_present_and_undeclared_is_a_discrepancy() {
        // P3 must state each binding the platform provides. This is not the
        // 8.3.2 capacity floor, so an omitted binding is a false declaration.
        let mut built = honest();
        built.transports = 0b0111_1110;
        assert_eq!(
            class1().corroborate(built),
            Err(Discrepancy::TransportsMismatch {
                declared: 0b0000_0110,
                built: 0b0111_1110,
                missing: 0,
                unexpected: 0b0111_1000,
            })
        );
    }

    #[test]
    fn a_binding_profile_is_owned_by_one_declared_transport() {
        const PROFILE: BindingProfileDeclaration = BindingProfileDeclaration {
            transport_bit: 0b0000_0010,
            schema: "org.example.binding.test",
            version: 1,
            canonical_value: "value=1",
        };

        let mut declaration = class1();
        declaration.binding_profiles = &[PROFILE];
        assert_eq!(declaration.check_binding_profiles(), Ok(()));

        declaration.binding_profiles = &[BindingProfileDeclaration {
            transport_bit: 0b0000_0001,
            ..PROFILE
        }];
        assert_eq!(
            declaration.check_binding_profiles(),
            Err(Discrepancy::BindingProfileInvalid {
                index: 0,
                reason: BindingProfileRefusal::TransportNotDeclared,
            })
        );

        declaration.binding_profiles = &[BindingProfileDeclaration {
            transport_bit: 0b0000_0110,
            ..PROFILE
        }];
        assert_eq!(
            declaration.check_binding_profiles(),
            Err(Discrepancy::BindingProfileInvalid {
                index: 0,
                reason: BindingProfileRefusal::NotOneTransport,
            })
        );

        declaration.binding_profiles = &[BindingProfileDeclaration {
            schema: "ble",
            ..PROFILE
        }];
        assert_eq!(
            declaration.check_binding_profiles(),
            Err(Discrepancy::BindingProfileInvalid {
                index: 0,
                reason: BindingProfileRefusal::SchemaNotReverseDns,
            })
        );

        declaration.binding_profiles = &[PROFILE, PROFILE];
        assert_eq!(
            declaration.check_binding_profiles(),
            Err(Discrepancy::BindingProfileInvalid {
                index: 1,
                reason: BindingProfileRefusal::DuplicateTransport,
            })
        );
    }

    #[test]
    fn an_unbounded_log_satisfies_a_bounded_floor() {
        let mut built = honest();
        built.packet_log = None;
        assert_eq!(class1().corroborate(built), Ok(()));
    }

    /// **L6 5.4.1a, and it is 5.4.1a Note 0's own incident.** The firmware
    /// fell back to a single-slot layout with no second slot and no state
    /// region, **and went on printing the layout it had been written to
    /// claim**. The declaration is intact; the platform reports nothing.
    #[test]
    fn a_declaration_claiming_slots_the_platform_does_not_have_is_caught() {
        let mut built = honest();
        built.update_slots = None;
        assert_eq!(
            class1().corroborate(built),
            Err(Discrepancy::UpdateSlotsMismatch {
                declared: Some(UpdateSlots {
                    count: 2,
                    usable_bytes_each: 1_600 * 1024,
                }),
                observed: None,
            })
        );

        // Fewer slots than declared: rollback is structurally impossible
        // with one, which is what 5.4.3 exists to survive.
        let mut built = honest();
        built.update_slots = Some(UpdateSlots {
            count: 1,
            usable_bytes_each: 1_600 * 1024,
        });
        assert!(matches!(
            class1().corroborate(built),
            Err(Discrepancy::UpdateSlotsMismatch { .. })
        ));

        // Right number, too small: the count alone would have passed this,
        // which is why P9 carries the usable size as well.
        let mut built = honest();
        built.update_slots = Some(UpdateSlots {
            count: 2,
            usable_bytes_each: 1_400 * 1024,
        });
        assert!(matches!(
            class1().corroborate(built),
            Err(Discrepancy::UpdateSlotsMismatch { .. })
        ));
    }

    #[test]
    fn a_larger_update_facility_than_declared_is_a_discrepancy() {
        // P9 states the facility's count and usable size, rather than a
        // minimum a platform may understate.
        let mut built = honest();
        built.update_slots = Some(UpdateSlots {
            count: 3,
            usable_bytes_each: 2_048 * 1024,
        });
        assert!(matches!(
            class1().corroborate(built),
            Err(Discrepancy::UpdateSlotsMismatch { .. })
        ));
    }

    #[test]
    fn declaring_no_slots_matches_only_an_image_without_slots() {
        // P9 `None` states that the image does not provide slots.
        let mut decl = class1();
        decl.update_slots = None;
        let mut built = honest();
        built.update_slots = None;
        assert_eq!(decl.corroborate(built), Ok(()));

        let built = honest();
        assert!(matches!(
            decl.corroborate(built),
            Err(Discrepancy::UpdateSlotsMismatch { .. })
        ));
    }

    /// ‼ **The defect this type exists for.** The old list named seven
    /// parameters beside a declaration carrying fourteen values: `P6` was
    /// never in it, and `P9`-`P13` were added to the struct on 2026-08-05
    /// without being added to it. **A caller reading the limits of a
    /// passing check was told about seven of the twelve it had.**
    #[test]
    fn every_parameter_is_answered_exactly_once() {
        assert_eq!(
            Parameter::ALL.len(),
            14,
            "L0 8.2.1 names P1-P13; P1 carries two values"
        );
        for (i, p) in Parameter::ALL.iter().enumerate() {
            assert_eq!(
                Parameter::ALL.iter().filter(|q| *q == p).count(),
                1,
                "{} appears more than once",
                Parameter::ALL[i].name()
            );
        }
        assert_eq!(PlatformDeclaration::unverifiable_here().count(), 12);
        let named = |p: Parameter| PlatformDeclaration::unverifiable_here().any(|q| q == p);
        // The five that were silently in neither set.
        for missing in [
            Parameter::P6HighestLayer,
            Parameter::P10WriteBoundary,
            Parameter::P11ImageReadBack,
            Parameter::P12RecoverySubstrate,
            Parameter::P13PositionObservability,
        ] {
            assert!(named(missing), "{}", missing.name());
        }
        // And the two that are corroborated are NOT in it — an honesty
        // list naming something the check does catch is the other error.
        assert!(!named(Parameter::P3Transports));
        assert!(!named(Parameter::P9UpdateSlots));
    }

    #[test]
    fn a_passing_check_does_not_mean_the_declaration_is_true() {
        // The limit, asserted rather than left to the doc comment: a
        // declaration can corroborate while every unmeasurable parameter
        // is false. Nothing here reads RAM.
        let mut lying = class1();
        lying.memory_bytes = u64::MAX;
        lying.low_power_state_implemented = true;
        lying.timebase_survives_power_loss = true;
        assert_eq!(lying.corroborate(honest()), Ok(()));
        // So the unverifiable set must be non-empty and must name them.
        assert!(PlatformDeclaration::unverifiable_here().count() > 0);
        assert!(PlatformDeclaration::unverifiable_here().any(|p| p == Parameter::P1Memory));
        assert!(PlatformDeclaration::unverifiable_here().any(|p| p == Parameter::P5Timebase));
    }

    #[test]
    fn class1_capacities_bind_the_esp32_build() {
        let c = CapabilityClass::Class1.capacities();
        assert_eq!(c.dedup_cache, 128);
        assert_eq!(c.neighbour_table, 32);
        assert_eq!(c.packet_log, Some(256));
    }

    #[test]
    fn unbounded_packet_log_only_on_always_on_classes() {
        assert_eq!(CapabilityClass::Class3.capacities().packet_log, None);
        assert_eq!(CapabilityClass::Class4.capacities().packet_log, None);
        assert_eq!(CapabilityClass::Class5.capacities().packet_log, Some(1024));
    }

    #[test]
    fn a_class_two_declaration_requires_each_processor_parts_observation() {
        let mut declaration = class1();
        declaration.class_declared = CapabilityClass::Class2;

        // The old aggregate check accepted these class-1 capacities even
        // though the class-2 Layer 5–7 part requires the class-3 column.
        assert_eq!(
            declaration.corroborate(honest()),
            Err(Discrepancy::Class2NeedsSeparatePartObservations)
        );

        let lower = honest();
        let upper = ObservedCapacities {
            dedup_cache: 4096,
            neighbour_table: 256,
            packet_log: None,
            transports: 0,
            availability: Availability::DutyCycled(WakeIntervals {
                shortest_permitted_s: 10,
                longest_permitted_s: 60,
                shortest_self_selected_s: 20,
            }),
            update_slots: declaration.update_slots,
            platform: declaration.platform,
        };
        assert_eq!(declaration.corroborate_class2_parts(lower, upper), Ok(()));

        let duty_cycled_lower = ObservedCapacities {
            availability: upper.availability,
            ..lower
        };
        assert_eq!(
            declaration.corroborate_class2_parts(duty_cycled_lower, upper),
            Err(Discrepancy::Class2L1ToL4NotAlwaysOn)
        );

        let insufficient_upper = ObservedCapacities {
            dedup_cache: 128,
            neighbour_table: 32,
            packet_log: Some(256),
            ..upper
        };
        assert_eq!(
            declaration.corroborate_class2_parts(lower, insufficient_upper),
            Err(Discrepancy::DedupCacheTooSmall {
                class_requires: 4096,
                built: 128,
            })
        );
    }

    #[test]
    fn a_finite_log_cannot_corroborate_an_unbounded_capacity() {
        let mut declaration = class1();
        declaration.class_declared = CapabilityClass::Class3;
        let mut built = honest();
        built.dedup_cache = 4096;
        built.neighbour_table = 256;
        built.packet_log = Some(u32::MAX);
        assert_eq!(
            declaration.corroborate(built),
            Err(Discrepancy::PacketLogMustBeUnbounded { built: u32::MAX })
        );
    }

    /// **L0 8.2.1a (`L0-053`): a declaration naming BLE in P3 carries a BLE
    /// binding profile, or it is refused.** L1-BINDING-BLE 6a-ter.1 is the
    /// binding document that requires one. Before this check a declaration
    /// could set the BLE bit beside an empty profile list and corroborate,
    /// because the profile check validated only the profiles it was handed.
    /// The refusal names the bit; a profile for a DIFFERENT declared bearer
    /// does not stand in; and a declaration that does not name BLE owes
    /// nothing — the unchanged fixture still corroborates. L0 does not parse
    /// the canonical value (that is the binding's), so the control's value
    /// is a placeholder in the schema's shape.
    ///
    /// Mutation that turns it red: `corroborate` no longer calling
    /// `check_required_binding_profiles`, or that method returning `Ok(())`
    /// unconditionally.
    #[test]
    fn a_declaration_naming_ble_without_a_ble_profile_is_refused_and_with_one_is_not() {
        const BLE_PROFILE: BindingProfileDeclaration = BindingProfileDeclaration {
            transport_bit: BLE_TRANSPORT_BIT,
            schema: "ai.reality2.binding.ble",
            version: 1,
            canonical_value: "quality-floor-dbm=-90",
        };
        let missing = Err(Discrepancy::BindingProfileMissing {
            transport_bit: BLE_TRANSPORT_BIT,
        });

        let mut decl = class1();
        decl.transports |= BLE_TRANSPORT_BIT;
        decl.binding_profiles = &[];
        let mut built = honest();
        built.transports = decl.transports;
        assert_eq!(decl.check_required_binding_profiles(), missing);
        assert_eq!(decl.corroborate(built), missing);

        // A profile for another declared bearer (LoRa, bit 2) is not BLE's.
        decl.binding_profiles = &[BindingProfileDeclaration {
            transport_bit: 0b0000_0100,
            ..BLE_PROFILE
        }];
        assert_eq!(decl.check_binding_profiles(), Ok(()));
        assert_eq!(decl.check_required_binding_profiles(), missing);
        assert_eq!(decl.corroborate(built), missing);

        // CONTROL: the BLE profile satisfies the requirement, and the whole
        // corroboration.
        decl.binding_profiles = &[BLE_PROFILE];
        assert_eq!(decl.check_required_binding_profiles(), Ok(()));
        assert_eq!(decl.corroborate(built), Ok(()));

        // And a declaration not naming BLE owes no BLE profile.
        assert_eq!(class1().check_required_binding_profiles(), Ok(()));
        assert_eq!(class1().corroborate(honest()), Ok(()));
    }
}

#[cfg(test)]
mod wake_tests {
    use super::{Figure, FigureRefusal, FigureUnit, Parameter, WakeIntervals};

    fn intervals() -> WakeIntervals {
        WakeIntervals {
            shortest_permitted_s: 10,
            longest_permitted_s: 600,
            shortest_self_selected_s: 30,
        }
    }

    /// ‼ **L0 7.4, WHICH HAD NO IMPLEMENTATION AT ALL.** *Shall not adopt an
    /// interval shorter than the shortest permitted, **whatever instruction it
    /// receives*** — so the instruction is the thing under test, and the
    /// assertion is about what comes back rather than about a refusal.
    #[test]
    fn an_instruction_below_the_floor_is_not_adopted() {
        let w = intervals();
        assert_eq!(
            w.adopt(2),
            10,
            "7.4: the floor holds against the instruction"
        );
        assert_eq!(
            w.adopt(0),
            10,
            "including zero, which is the strongest form"
        );
        // The control: an instruction inside the range is adopted as given, so
        // the clamp is not simply returning the floor for everything.
        assert_eq!(w.adopt(45), 45);
        assert_eq!(w.adopt(10), 10, "the floor itself is permitted");
    }

    /// The ceiling is a declaration too: an instruction longer than the
    /// longest permitted is a duty cycle this platform says it does not offer.
    #[test]
    fn an_instruction_above_the_ceiling_is_brought_back_to_it() {
        assert_eq!(intervals().adopt(3_600), 600);
        assert_eq!(
            intervals().adopt(600),
            600,
            "the ceiling itself is permitted"
        );
    }

    /// A declaration whose floor sits above its ceiling, or whose
    /// self-selected interval it is not permitted to use, is one `adopt`
    /// would **silently paper over** — a clamp always returns something
    /// plausible, so the ordering has to be checked separately.
    #[test]
    fn a_declaration_out_of_order_is_reported_rather_than_clamped_over() {
        assert!(intervals().is_ordered());
        assert!(!WakeIntervals {
            shortest_permitted_s: 100,
            longest_permitted_s: 60,
            shortest_self_selected_s: 80,
        }
        .is_ordered());
        assert!(
            !WakeIntervals {
                shortest_permitted_s: 10,
                longest_permitted_s: 600,
                shortest_self_selected_s: 5,
            }
            .is_ordered(),
            "a self-selected interval below the floor it may not go under"
        );
    }

    /// ‼ **`L0-038` (8.2.2): AN ENERGY OR DURATION FIGURE SHALL NAME THE
    /// PARAMETER VALUES IT WAS MEASURED OR CALCULATED AGAINST — AND THE
    /// CONSTRUCTION IS THAT AN UNQUALIFIED ONE CANNOT BE BUILT.**
    ///
    /// The clause is conditional on a figure being stated, and no platform in
    /// this tree states one, so it was satisfied VACUOUSLY — *which is not an
    /// implementation*. What changes is that the first figure to be stated
    /// cannot omit its conditions: [`Figure::new`] is the only constructor and
    /// it refuses an empty `against`.
    ///
    /// **The conditions are a FIELD of the figure rather than a neighbouring
    /// list**, because a design that put them side by side would satisfy 8.2.2
    /// on the day it was written and drift the moment either moved. *An energy
    /// number read against a low-power state the shipped software never enters
    /// is exactly what P2 exists to prevent*, and 8.2.1's Note 1 says so.
    #[test]
    fn a_figure_cannot_be_stated_without_the_parameters_it_was_measured_against() {
        const AGAINST: &[(Parameter, &str)] = &[
            (Parameter::P2LowPowerState, "light-sleep entered"),
            (Parameter::P8Availability, "duty-cycled, 900 s"),
        ];
        let ok = Figure::new("battery life", 20 * 86_400, FigureUnit::Seconds, AGAINST)
            .expect("a qualified figure is statable");
        assert_eq!(ok.value(), 1_728_000);
        assert_eq!(ok.unit(), FigureUnit::Seconds);
        assert_eq!(ok.against().len(), 2);
        assert_eq!(ok.against()[0].1, "light-sleep entered");

        // ‼ THE REFUSAL IS THE CLAUSE. `about twenty days` with nothing to read
        //   it against is the sentence 8.2.2 forbids, and it is unbuildable.
        assert_eq!(
            Figure::new("battery life", 20 * 86_400, FigureUnit::Seconds, &[]),
            Err(FigureRefusal::NoParametersNamed)
        );
        // And a figure nobody can ask about by name is refused too: a reader
        // given a number and no subject cannot check it either.
        assert_eq!(
            Figure::new("", 1, FigureUnit::MilliwattHours, AGAINST),
            Err(FigureRefusal::Unlabelled)
        );

        // ‼ THE VACUITY IS ASSERTED RATHER THAN LEFT IMPLICIT. Both shipped
        //   declarations state no figure today, so every arm above runs on a
        //   fixture — true only while this is true, and it is pinned so the
        //   first real figure moves it.
        assert!(
            DEFAULT_FIGURES.is_empty(),
            "a platform now states a figure; the arms above have a live subject"
        );
    }

    /// The figures a declaration carries when it states none — pinned so the
    /// vacuity above is a measurement rather than an assumption.
    const DEFAULT_FIGURES: &[Figure<'static>] = &[];
}
