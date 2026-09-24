//! The L5 surface the layers above consume (L5 11.1).
//!
//! 11.1 says this layer shall provide (a) delivered frames marked
//! intra-group, a crossing, or unauthenticated; **(b) the hive's persona:
//! its group, its member identity, its claim state**; and (c) the
//! beacon-identifier association. (a) is [`crate::gate`]. This module is
//! **(b)**, which is what a hive needs before it can honestly say it is a
//! hive.
//!
//! ## Shaped so a caller cannot report what it has not got
//!
//! L5 4.3.3: *"There shall be no ungrouped, keyless or persona-less
//! running state."* 4.3.3a: a hive reporting its group, keys or persona
//! *"shall not present the absence of one as a legitimate value."*
//!
//! So [`Trust`] **cannot exist without a persona** — there is no
//! constructor that leaves one out and no `Option` to unwrap. A platform
//! that cannot establish one gets [`NotAHive`] and, per 4.3.3, must not
//! proceed to a running state. **The panel cannot display a blank hive
//! identity, because there is no value to display it from.**
//!
//! The temptation at every step of bring-up is to show the value we
//! expect rather than the one we have. This module is built so that the
//! expected value is not reachable until it is the real one.

use crate::identity::Identity;
use crate::membership::{may_join, AdmissionRefusal, ClaimState, Persona, PersonaOrigin};
use r2_hal_traits::build_mode::BuildMode;

/// The platform's key custody. **Core never holds a secret half.**
///
/// L5 4.3.1: on first boot a hive *"shall generate a group keypair, hold
/// the secret half, and derive the group identifier from the public
/// half."* Holding is the platform's job — this trait returns only public
/// halves, so a secret cannot reach a layer that has no business with one
/// (L0 6.1).
pub trait Keystore {
    /// Generate a fresh group keypair, retain the secret half, return the
    /// public half. `None` where the platform cannot generate key
    /// material — L0 5.5.2.
    fn mint_group(&mut self) -> Option<Identity>;
    /// Generate a fresh member keypair (5.1.1), same custody rule.
    fn mint_member(&mut self) -> Option<Identity>;

    /// Install only the published development group custody (L5 9.1), keeping
    /// the member key unchanged. Refuse inadmissible build modes before any
    /// mutation. This is not an arbitrary group-secret import interface.
    #[cfg(feature = "development-trust-group")]
    fn install_development_group(&mut self, _mode: BuildMode) -> bool {
        false
    }

    /// Why a mint returned `None`. Defaulted, so an existing
    /// implementation compiles unchanged, and defaulted to
    /// [`KeyMaterialRefusal::NotStated`] because **a platform that has not
    /// said why must not be read as having said something.**
    fn refusal(&self) -> KeyMaterialRefusal {
        KeyMaterialRefusal::NotStated
    }

    /// Resume custody of the secret halves of a persona this platform
    /// previously sealed (5.3.2), returning whether it now holds them.
    ///
    /// **This is the route whose absence made `Found` unreachable.**
    /// `Keystore` could mint and could not load, so a stored persona could
    /// only ever produce [`NotAHive::RestoredPersonaHasNoSecretHalf`] — and
    /// r2-hive stopped short of writing a store whose sole reachable
    /// outcome was a board that is no longer a hive. *Its finding, from the
    /// other end of the same seam.*
    ///
    /// **It returns a `bool`, not a key.** The platform holds every secret
    /// half and that does not change here: the question is *do you have
    /// custody of this persona again*, and the answer is the platform's.
    ///
    /// **Defaulted to `false`, which is the refusal.** An implementation
    /// that has not written a restore path compiles unchanged and **keeps
    /// refusing** — *a platform that has not said it restored must not be
    /// read as having restored.* Same shape as [`Self::refusal`] one method
    /// up: the default is the safe answer, not the convenient one.
    fn restore(&mut self, persona: &Persona) -> bool {
        let _ = persona;
        false
    }

    /// Seal and record a persona this crate has just minted, returning
    /// whether the platform now holds it durably (5.3.2).
    ///
    /// **This is the outbound half of [`Self::restore`], and without it
    /// the inbound half is unreachable.** `restore` removed the refusal on
    /// the return path; it could not put anything on the path. Nothing in
    /// this crate ever told the platform *a persona now exists, keep it*,
    /// so [`StoredPersona::NeverWritten`] was the only report a store could
    /// honestly make, on this boot and on every boot after it. **A board
    /// re-mints its identity forever, and neither half alone stops that.**
    ///
    /// **It takes public halves and returns a `bool`, for the same reason
    /// `restore` does.** The secret halves are already the platform's (L0
    /// 6.1); this says *which persona* to keep, not *what* to keep. The
    /// sealing that 5.3.2 requires happens on the platform's side of the
    /// line, under a hardware-rooted secret this crate has no
    /// representation for — see [`r2_hal_traits::sealing`].
    ///
    /// **Defaulted to `false`, and a `false` here is NOT a refusal to
    /// boot** — but the paragraph that used to justify that **quoted half
    /// a sentence and was wrong twice over** (standard's ruling,
    /// 2026-08-07).
    ///
    /// **FIRST ERROR — THE HALF-QUOTE.** It read *"where the platform
    /// provides no such facility, derived keys shall live in volatile
    /// memory only"* and stopped. **5.3.2 continues: *"…and be re-obtained
    /// on next contact with the group."*** Volatile-only is conforming
    /// **with** the re-obtaining, **not instead of it** — so the fragment
    /// was true and read as the whole rule. *This crate's own
    /// `r2_hal_traits::sealing` and two ledger entries carry the complete
    /// sentence; only this site truncated it, and this site is where the
    /// design decision was justified.*
    ///
    /// **SECOND ERROR — WRONG CLAUSE ENTIRELY, AND IT IS THE ONE THAT
    /// MATTERS.** 5.3.2 governs **derived keys**. A **persona** is
    /// identity — a group keypair and a claim state — **and no sentence of
    /// 5.3 mentions it.** *So 5.3.2 never licensed a hive that cannot
    /// reload its persona, and it was never the clause to read.*
    ///
    /// **WHAT ACTUALLY GOVERNS IS L6, AND THEY ARE UNCONDITIONAL —
    /// VERIFIED VERBATIM AT THE CORPUS**: **5.5.3a**, *a device's persona
    /// disposition shall be determinable at boot from durable storage
    /// alone, and shall be self-validating*; **5.4.5**, *applying an
    /// update shall preserve the persona and the device's claim state,
    /// across success, failure and reversion alike*; and **8.2**, whose
    /// demonstration requires *its persona is intact after reversion*.
    /// **An update is a reboot, so a hive that re-mints every boot cannot
    /// pass 8.2 by construction.**
    ///
    /// **CONFORMING FOR DERIVED KEYS, NOT CONFORMING FOR THE PERSONA:
    /// [`PersonaDurability`] is the right REPORT and was the wrong
    /// DISPOSITION.** Persona reload is a **MUST-BUILD** and is
    /// `L5-124`'s deferred half; see `RESUME.md`. *A `false` here still
    /// does not refuse the boot — it now marks a device that cannot
    /// satisfy L6, rather than one exercising a permitted regime.*
    /// **CHANGED 2026-08-07: IT TAKES THE RECORD, NOT THE PERSONA.** The
    /// crate encodes ([`crate::record::encode`]) and the platform keeps
    /// bytes it never interprets — *so the inbound half can hand the same
    /// bytes back and the crate can decide completeness from them alone,
    /// which is what 5.5.3a asks for.* A platform that received a
    /// `&Persona` could not return one, because `Persona` is sealed.
    fn persist(&mut self, record: &[u8]) -> bool {
        let _ = record;
        false
    }
}

/// Whether this hive's persona outlives a power cycle (L5 5.3.2).
///
/// **Both variants are conforming, and that is exactly why this is
/// reported.** The clause permits volatile-only where no sealing facility
/// exists, so `Volatile` is not an error to escalate — but a hive whose
/// identity dies with its power supply looks identical on a panel to one
/// whose identity is durable, right up until the reboot where every peer
/// meets a stranger.
///
/// **CORRECTED 2026-08-04 (d219), AND THE CORRECTION IS THE USEFUL PART.**
/// This paragraph used to end *"and `verified` returns to zero"*. **That
/// is false, and it was refuted on metal**: two boards that both re-mint
/// every boot reached `Deliver(IntraGroup)` with `verified_now=true` in
/// both directions, 179 receptions measured on the DFR1195 side alone.
/// **Verification runs against the development trust group (Clause 9), a
/// published constant compiled into both images, and reads no persisted
/// persona at all.**
///
/// **So what persistence buys is RECOGNITION OF A SPECIFIC PEER across a
/// power cycle — not verification, which already works without it.** The
/// two were collapsed into one claim by this lane and by the supervisor,
/// and the bench separated them. *A re-minting pair still forms a
/// verified path; what it cannot do is know it has met before.*
///
/// Same argument as [`StoreCondition::WasUnreadable`] one type up: *a
/// condition to report, not a state to hide.* It is a **separate field
/// rather than a third `StoreCondition` variant** because the two can
/// co-occur — a store that could not be read and cannot be written is the
/// worst case on the bench, and an enum with one slot would report half of
/// it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PersonaDurability {
    /// The platform holds this persona sealed. It should be here on the
    /// next boot — **should**, because this crate records the platform's
    /// answer and cannot audit its flash.
    Persisted,
    /// The persona lives in volatile memory only. **This hive re-mints on
    /// the next boot**, so it comes back as an identity no peer has seen
    /// before. **It still verifies and is still verified** — that runs on
    /// the group key, not on this persona (d219) — *what it loses is
    /// having been met, not being trusted.*
    Volatile,
}

/// The platform's `bool` as a reportable state. **One conversion, so the
/// polarity is written once** — every boot arm that mints reads the same
/// mapping, and `false` cannot become `Persisted` at one call site.
/// Encode the persona and offer it to the store, reporting what the
/// platform said. **One helper rather than three call sites**: boot's mint
/// path, boot's replacement path and [`Trust::join`] must write the SAME
/// three values the same way, and *three copies of an encoder is three
/// chances for one of them to drift.*
fn write_record<K: Keystore>(persona: &Persona, keystore: &mut K) -> PersonaDurability {
    let mut buf = [0u8; crate::record::RECORD_LEN];
    match crate::record::encode(persona.group, persona.member, persona.claim, &mut buf) {
        Some(n) => durability_of(keystore.persist(&buf[..n])),
        // **Unreachable with a fixed-size buffer, and refused rather than
        // assumed**: an encode that could not write is not a persisted
        // persona, and reporting `Persisted` would be the report claiming
        // what the write did not do.
        None => PersonaDurability::Volatile,
    }
}

const fn durability_of(persisted: bool) -> PersonaDurability {
    if persisted {
        PersonaDurability::Persisted
    } else {
        PersonaDurability::Volatile
    }
}

/// Why a platform could not generate key material.
///
/// **The distinction is hive's finding on ESP32-S3 and it is not
/// cosmetic.** `esp-hal` 1.1.1 documents that the hardware RNG is true
/// random *only* while the RF subsystem is enabled or an ADC is feeding
/// entropy; otherwise its output *"should be considered pseudo-random
/// only"*. So a hive that mints its persona at first boot **before
/// starting a radio** generates a perfectly well-formed 32-byte identity
/// from a non-conforming source, **silently**.
///
/// **L0 5.5.1/5.5.2 do not describe this case.** They treat entropy as a
/// platform *capability* — provided or not — and an implementer checking
/// *"does this chip have a TRNG?"* gets **yes** and mints anyway. The
/// clause has no *time of use* obligation. `CORE-6`, hive's finding,
/// core's framing.
///
/// Both variants **refuse identically** — 4.3.3 admits no persona-less
/// running state either way — and **report differently**, because the
/// operator action differs: start the radio, versus replace the platform.
/// That is the same shape as `NeverWritten` versus `Unreadable`, one
/// layer down.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum KeyMaterialRefusal {
    /// The platform did not say. **Not a synonym for either of the others**
    /// — it is the third answer, and folding it into one of the definite
    /// ones is the move `01-terminology` 5.3 exists to forbid.
    NotStated,
    /// Conforming entropy is not available **yet**. The platform can host a
    /// hive; the ordering is wrong. On ESP32-S3 this means **the radio must
    /// start before trust boots**, which is an ordering no clause states.
    NotYetAvailable,
    /// This platform does not provide a conforming generator at all (L0
    /// 5.5.2). It does not become a hive by waiting.
    Absent,
}

/// What the platform found in its identity store at boot.
///
/// **`Found` is reachable on this board.** Roy ruled 2026-08-02 that
/// ESP32-S3 flash encryption with a read-protected eFuse key qualifies as
/// *"a hardware-rooted secret of the device"* (L5 5.3.2), so the member
/// secret **may** be persisted sealed.
///
/// **AMENDED 2026-08-04, and the amendment is the point.** This used to
/// end *"and `LoadedFromStorage` becomes the common case"*. It is not
/// the common case and it is not any case: **nothing writes a persona**,
/// `Keystore` can mint and cannot load, and [`Persona`] carries public
/// halves only — so [`Trust::boot`] now **refuses** a `Found` persona
/// with [`NotAHive::RestoredPersonaHasNoSecretHalf`] rather than booting
/// a hive that peers recognise and that cannot sign. *Reachable in
/// principle was written here as though it were reached, and the sentence
/// below about the discriminator was built on top of it.*
///
/// That mattered beyond convenience, and it is why the earlier reading
/// was worth arguing — **but the concern it raised is now the live
/// state**: every boot reports [`PersonaOrigin::MintedThisBoot`] or
/// [`PersonaOrigin::ReplacedInadmissibleStore`], and **a discriminator
/// always in one state stops discriminating** — a reader seeing *minted
/// this boot* on every panel learns to ignore it, and the boot where it
/// means *your identity store failed* reads identically. 4.3.1a would
/// have been defeated by success rather than by failure.
///
/// **Two things this does NOT settle**, neither of them core's to close:
/// the ruling says the facility *qualifies*, not that it is **switched
/// on** — an unverified eFuse state is a platform declaring a facility it
/// may not have; and ESP-IDF **development-mode** flash encryption
/// deliberately permits re-flashing, which weakens the seal on exactly
/// the images d011 requires. A development group's secrets are low-value
/// by Clause 9, but **the member key is per-device and its leak is
/// impersonation within that group.**
///
/// **`CORE-7` IS CLOSED, AND IT WAS CLOSED IN THE CORPUS BEFORE THIS
/// PARAGRAPH WAS LAST TOUCHED** (2026-08-07, on standard's ruling). It
/// said: 5.3.1's *most protected facility the platform provides* is
/// **relative**, 5.3.2's *plaintext key material at rest is forbidden in
/// every case* is **absolute**, the two cannot both hold on a platform
/// with no sealing facility, and that is a drafting defect.
///
/// **The corpus answers it directly. `L5` 5.3.1a: *where the platform
/// provides no facility meeting 5.3.2, the group secret key shall live in
/// volatile memory only*** — verified at the corpus — **and Note 0 to
/// 5.3.1 states the contradiction in these very terms and rules that THE
/// ABSOLUTE ONE GOVERNS.** Registered `STD-SS217`, `PROVISIONAL(supervisor)`,
/// **2026-08-02**.
///
/// **SO THIS LANE CARRIED AN OPEN FINDING FOR FIVE DAYS AFTER ITS ANSWER
/// LANDED — AND WORSE, ITS OWN LEDGER ALREADY HELD THE ANSWER.**
/// `DECISIONS.md` records 5.3.1a and *the absolute one governs* by name.
/// **The resolution was in the ledger and the open finding was in the
/// code, and the code is where a reader meets it.** *Fourth sighting this
/// week of two records of one fact with the weaker where the reader
/// looks* — and the first where the weaker record was not merely weaker
/// but **stale**. **A finding is not closed when the answer exists; it is
/// closed when the site that raises it says so.**
///
/// Three outcomes, not two, and the third is the one that matters:
/// **`Unreadable` is a fault and `NeverWritten` is an unprovisioned
/// device**, and folding them together is how a hive silently becomes a
/// different device (4.3.1a Note 1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StoredPersona {
    /// **The bytes durable storage holds** (L6 5.5.3a). Opaque to the
    /// platform: it hands back what [`crate::record::encode`] gave it and
    /// **never interprets them**.
    ///
    /// # THIS REPLACED `Found(Persona)` ON 2026-08-07 AND THE OLD VARIANT
    /// HAD NO HONEST PRODUCER LEFT
    ///
    /// `Found` took a [`Persona`] from the platform. Once `Persona`'s
    /// fields were sealed **a platform could not construct one**, so the
    /// only remaining way to build `Found` was **REPLAY** — handing back
    /// the persona the hive was already running, as though storage had
    /// returned it. *A variant nobody can legitimately construct is worse
    /// than an absent one: it reads as a supported path.*
    ///
    /// **And the other half was the refuter's**: `restore(&Persona) ->
    /// bool` **attests custody for any bytes**, so nothing the platform
    /// said about a `Persona` it could not have made was evidence. The
    /// platform's job is now narrowed to what a platform can honestly do
    /// — *keep bytes and hand the same bytes back.*
    Sealed(crate::record::SealedRecord),
    /// No persona has ever been written. First boot.
    NeverWritten,
    /// A persona may exist and could not be read. **Minting here makes
    /// this device a stranger to every peer that knew it**, which is why
    /// the report carries [`StoreCondition::WasUnreadable`] rather than
    /// looking like an ordinary first boot.
    Unreadable,
    /// ‼ **THE STORE ANSWERED AND CANNOT TELL ABSENT FROM UNREADABLE**
    /// (L5 4.3.1b's second half, `L5-126`).
    ///
    /// **The platform is the party that knows this, so it is the party
    /// that says it** — a store returning a bare byte array with no error
    /// channel cannot distinguish the two, and *nothing above it can work
    /// that out from the bytes.* `android`'s `DeviceMasterStore` is the
    /// measured instance and is why 4.3.1b is conditional rather than an
    /// unconditional shall.
    ///
    /// **Distinct from [`Self::NeverWritten`] and NOT a pessimistic
    /// substitute for it**: a store that CAN tell must keep saying which,
    /// *because collapsing a capable store into this variant would throw
    /// away the distinction 4.3.1a was written to create.*
    CannotDistinguish,
}

/// Whether the identity store answered cleanly at boot (L5 4.3.1b).
///
/// ‼ **THREE VALUES, AND THE THIRD IS THE HONEST NIL.** 4.3.1b: *where the
/// store CAN distinguish a persona that was present-and-unreadable from one
/// that was absent, a hive shall report which of the two preceded a
/// creation. **Where it cannot, the hive shall report that it cannot.***
///
/// Note 1 says why the pair matters: 4.3.1a made *minted* distinguishable
/// from *loaded* and left **minted because nothing was there**
/// indistinguishable from **minted over material that was there and could
/// not be read** — *a first boot working correctly, and a device that has
/// just destroyed its continuity.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StoreCondition {
    /// The store answered, and at the moment of a **creation** that means
    /// **absent**.
    ///
    /// ‼ **AT A CREATION, THIS *IS* THE ABSENT HALF OF 4.3.1b'S PAIR** —
    /// *a persona that read fine produces no creation*, so `Healthy`
    /// reported beside a mint can only mean nothing was there. **The first
    /// half of the clause is therefore carried by the two original variants
    /// and needed no widening**, which is `standard`'s reading and
    /// `android`'s correction of its own report, reached independently.
    Healthy,
    /// The store could not be read and a persona was minted over it. The
    /// hive is running and its peers see a stranger — **a condition to
    /// report, not a state to hide.**
    WasUnreadable,
    /// ‼ **THE STORE CANNOT TELL ABSENT FROM UNREADABLE, AND SAYS SO**
    /// (4.3.1b's second half, `L5-126`).
    ///
    /// **Without this variant such a store returns `Healthy` for both**, so
    /// `Healthy`-at-creation becomes ambiguous **and there is no way to say
    /// so** — *the obligation would have no type to live in.*
    ///
    /// **This is `01-terminology` 4.5's general form**: where a requirement
    /// cannot be met, **say so and name what prevents it**. It is the same
    /// third-state discipline as `SequenceFloor::Unreadable`,
    /// `BuildMode::Unknown` and `Outcome::Unresolvable` — *a two-valued
    /// answer has nowhere to put "cannot tell", and the missing value
    /// always collapses into the reassuring one.*
    ///
    /// ‼ **ROUTED BY `android` FROM A MEASUREMENT IN ITS OWN TREE**, not
    /// from this one: its `DeviceMasterStore` returns a bare byte array and
    /// cannot distinguish the two, which is the case the conditional form
    /// of 4.3.1b was written for. *It checked its own boundary first and
    /// found its FFI bool exactly as expressive as its source — so widening
    /// there alone would have reported a state nobody could supply.*
    ///
    /// **And the clause states its own limit in Note 2, which this variant
    /// does not repair**: *unreadable is not deleted.* A cleared data
    /// directory or a reinstall presents as **absent**, so the third state
    /// is negative on the commonest real failure. That is `STD-SS371`, open
    /// with Roy, and is not this crate's to close.
    CannotDistinguish,
}

/// Why this platform is not a hive (01-terminology 3.2, L5 4.3.3).
///
/// Not an error to log and continue past: 4.3.3 admits no persona-less
/// running state, so this is a refusal to run.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NotAHive {
    /// Development boot could not admit or install the published group key.
    #[cfg(feature = "development-trust-group")]
    DevelopmentGroupCustodyUnavailable,
    /// The platform could not generate key material (L0 5.5.2). The
    /// payload says **why**, and the two live reasons want opposite
    /// actions from an operator — see [`KeyMaterialRefusal`].
    NoKeyMaterial(KeyMaterialRefusal),
    /// **Two mints returned the same key**, so the source is not
    /// generating — it is repeating.
    ///
    /// Found by a test double that filled deterministically, which is the
    /// useful part: a generator stuck on a constant produces perfectly
    /// well-formed key material and satisfies every other check here. This
    /// catches a subset of `CORE-6`'s pseudo-random case **for free**, at
    /// the one moment two independent draws are required anyway (4.3.1
    /// mints a group keypair, 5.1.1 a member keypair).
    ///
    /// It is a **weak** detector and is named as one: it catches a source
    /// that repeats *within one boot*, not one that is merely predictable.
    /// L0 5.5.1 remains the platform's declaration and this crate cannot
    /// audit it.
    EntropyRepeated,
    /// **The store returned a persona and there is no route by which its
    /// SECRET half could reach this crate** (L5 4.3.3, 5.3.2).
    ///
    /// [`Persona`] carries public halves only, and [`Keystore`] can
    /// *mint* and cannot *load* — so a restored persona is an identity
    /// with no signing key anywhere in the process. Booting on it
    /// produced a hive that **peers recognise and that cannot tag, sign
    /// or derive**: healthy panel, correct group identifier, and every
    /// authenticated obligation silently unmet.
    ///
    /// **The trap was armed rather than absent.** `StoredPersona::Found`
    /// was already wired and already returned `Ok`, so the failure was
    /// waiting for the first platform that made persistence work — and
    /// what has been keeping it unarmed is that nothing writes a persona
    /// yet, which is an accident of sequencing rather than a guard.
    ///
    /// **This refuses; it does not fix persistence.** Sealed persona
    /// storage needs a hardware-rooted secret this crate has no
    /// representation for, and the clause that would say how such a
    /// facility is declared and checked is an open Layer 0 gap (L0 10.4,
    /// which L5 5.3.2 inherits by name). *A refusal is loud and a hive
    /// that authenticates nothing is silent*, so refusing is the
    /// conforming answer until the route exists.
    RestoredPersonaHasNoSecretHalf,
}

/// The hive's persona and how it came to hold it (L5 11.1 b, 4.3.1a).
///
/// **This is an INDICATOR, so it shares the fate of what it reports.**
/// The fleet rule (hive, 2026-08-02) is that the distinction is
/// *direction*, not principle: **a thing that reports a subsystem must
/// share its fate; a thing used to investigate one must not.** A report
/// that outlives the persona it describes is the same defect as a
/// heartbeat driven by a timer — *the most confidently wrong signal a
/// device can produce.*
///
/// Here that holds by construction rather than by discipline: a
/// `PersonaReport` is obtainable only from a [`Trust`], and a `Trust`
/// cannot exist without a persona. **There is no path by which a panel
/// keeps displaying an identity the hive no longer holds.**
///
/// Every field is present. There is no *absent* representation, because
/// 4.3.3a forbids presenting one as a legitimate value and the cheapest
/// way to honour that is to make it unrepresentable.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PersonaReport {
    pub group: Identity,
    pub member: Identity,
    pub claim: ClaimState,
    /// 4.3.1a: minted this boot, or loaded — **never reported alike**.
    pub origin: PersonaOrigin,
    pub store: StoreCondition,
    /// Whether this persona survives a power cycle. **Not derivable from
    /// `origin`**: a `MintedThisBoot` persona may or may not have been
    /// kept, and the difference is whether this board is a hive or a
    /// sequence of strangers.
    pub durability: PersonaDurability,
    /// The mode this hive declares about itself (L2 5.4a.1a); one origin
    /// for the beacon, the admission decision and the panel.
    pub mode: BuildMode,
}

/// L5 11.1(b), and the type a hive is built around.
///
/// `Debug` is derived deliberately and is safe here **by construction, not
/// by care**: every field is a public half or a status value. The secret
/// halves are held by the platform's [`Keystore`] and never enter this
/// crate (L0 6.1), so there is nothing here for a log line to leak.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Trust {
    persona: Persona,
    origin: PersonaOrigin,
    store: StoreCondition,
    durability: PersonaDurability,
    mode: BuildMode,
}

impl Trust {
    /// Boot: load the persona, or mint a group of one (4.3.1, 4.3.4).
    ///
    /// **There is no third outcome that keeps running.** A platform that
    /// cannot mint is not a hive (4.3.3) and gets [`NotAHive`].
    ///
    /// `mode` is the hive's own build mode; it is stored as
    /// [`BuildMode::declared`], so a hive that cannot determine its mode
    /// is a development hive everywhere downstream — the beacon, the
    /// admission decision and the panel — rather than at each call site's
    /// discretion (L2 5.4a.1a).
    pub fn boot<K: Keystore>(
        stored: StoredPersona,
        keystore: &mut K,
        mode: BuildMode,
    ) -> Result<Self, NotAHive> {
        Self::boot_inner(stored, keystore, mode, true)
    }

    /// Boot into Dev TG with matching group custody before the first write.
    /// A fresh boot still generates the group-of-one and member key required
    /// by L5 4.3.1, but keeps that intermediate persona volatile. A restored
    /// Dev TG persona retains its custody and needs no replacement write.
    #[cfg(feature = "development-trust-group")]
    pub fn boot_development<K: Keystore>(
        stored: StoredPersona,
        keystore: &mut K,
        mode: BuildMode,
    ) -> Result<Self, NotAHive> {
        may_join(
            mode,
            crate::development::classify(&crate::development::IDENTITY),
        )
        .map_err(|_| NotAHive::DevelopmentGroupCustodyUnavailable)?;
        let mut trust = Self::boot_inner(stored, keystore, mode, false)?;
        if trust.origin == PersonaOrigin::LoadedFromStorage {
            return Ok(trust);
        }
        if !keystore.install_development_group(mode) {
            return Err(NotAHive::DevelopmentGroupCustodyUnavailable);
        }
        trust.persona.group = crate::development::IDENTITY;
        trust.durability = write_record(&trust.persona, keystore);
        Ok(trust)
    }

    fn boot_inner<K: Keystore>(
        stored: StoredPersona,
        keystore: &mut K,
        mode: BuildMode,
        persist_new: bool,
    ) -> Result<Self, NotAHive> {
        let mode = mode.declared();
        // **The restore is a route** (L5 9.3, `CORE-8`, d037). This match
        // used to take a stored persona straight through, so a production
        // device whose store carried the development group booted into
        // it. `may_join` guarded the *join* and nothing guarded the
        // *restore*, though both reach the same state — **a guard placed
        // on the path you were thinking about is a guard with an unstated
        // denominator.**
        //
        // The refusal is expressed as a LOCAL conclusion rather than as a
        // new `StoredPersona` variant: `StoredPersona` is what the
        // platform *reports*, and inadmissibility is what this layer
        // *decides*. A public variant would let a caller assert the
        // conclusion — the same defect `GroupKind` had until `classify`
        // made the kind a function of the bytes.
        // **DECODED ONCE, BEFORE ANYTHING LOOKS AT IT** (L6 5.5.3a). A
        // record that is not COMPLETE is not a persona, so the decode
        // failure is folded into the same path as a store that could not
        // be read — *an incomplete record and an unreadable one are the
        // same fact about this boot*, and both are distinguished from
        // `NeverWritten` in the report rather than in the behaviour.
        let decoded: Option<Persona> = match &stored {
            StoredPersona::Sealed(record) => {
                crate::record::decode(*record)
                    .ok()
                    .map(|(group, member, claim)| {
                        // L6 5.5.3a — one line from the `decode` whose success
                        // it wraps, exactly as the two mint sites are one line
                        // from their mint.
                        Persona::self_validated(
                            group,
                            crate::membership::SelfValidated::from_record(member),
                            claim,
                        )
                    })
            }
            _ => None,
        };
        let refused = match &decoded {
            Some(persona)
                if may_join(mode, crate::development::classify(&persona.group)).is_err() =>
            {
                Some(persona.group)
            }
            _ => None,
        };
        if let Some(refused) = refused {
            // Refused as a MEMBERSHIP, not as a boot. Fail closed on the
            // group, fail open on availability, stay loud about which
            // group was refused.
            let group = keystore
                .mint_group()
                .ok_or(NotAHive::NoKeyMaterial(keystore.refusal()))?;
            let member = crate::membership::Minted::from_keystore(keystore)
                .map_err(NotAHive::NoKeyMaterial)?;
            if group == member.get() {
                return Err(NotAHive::EntropyRepeated);
            }
            // Boot and enrollment use the same core-owned platform mint path.
            let persona = Persona::group_of_one(group, member, ClaimState::Open);
            // **The replacement is persisted too, and it must be.** This
            // device was carrying a group it must not have; leaving the
            // new persona volatile means the refused one stays the only
            // thing on the store and the same refusal happens next boot,
            // forever. *Refusing a credential and not replacing it is
            // half of the remedy.*
            let durability = if persist_new {
                write_record(&persona, keystore)
            } else {
                PersonaDurability::Volatile
            };
            return Ok(Self {
                persona,
                // **Not `MintedThisBoot`, by requirement.** A re-mint that
                // looked like a clean first boot would present *healthy
                // new device* for *unit that was carrying credentials it
                // must not have*.
                origin: PersonaOrigin::ReplacedInadmissibleStore(refused),
                store: StoreCondition::Healthy,
                durability,
                mode,
            });
        }
        match stored {
            // **REFUSED, AND THE ARM USED TO RETURN `Ok`.** Reaching here
            // means the platform found a persona; nothing found its
            // secret half, because no such route exists — `Keystore`
            // mints and cannot load, and `Persona` is public halves. The
            // old arm therefore produced a hive with an identity and no
            // signing key. **A soundness hole, closed independently of
            // every unsettled clause**: this says nothing about how a
            // persona *should* be persisted, only that a persona which
            // arrives without its secret is not a hive.
            //
            // `_persona` rather than dropping the binding, so the arm
            // still reads as *this is the found case* to the next person.
            // **THE REFUSAL IS STILL THE DEFAULT AND IS NOW ESCAPABLE.**
            // `Keystore::restore` defaults to `false`, so a platform that
            // has written no restore path reaches exactly the same error it
            // did before. What changed is that a platform which HAS sealed
            // this persona can say so, and only then does the hive boot
            // with the identity peers already recognise.
            _ if decoded.is_some() => {
                let persona = decoded.expect("guarded by the arm");
                if keystore.restore(&persona) {
                    Ok(Self {
                        persona,
                        origin: PersonaOrigin::LoadedFromStorage,
                        store: StoreCondition::Healthy,
                        // **Demonstrated, not declared.** This persona was
                        // read back off the store and its custody resumed,
                        // which is the evidence `Persisted` asserts —
                        // nothing is re-written to earn it.
                        durability: PersonaDurability::Persisted,
                        mode,
                    })
                } else {
                    Err(NotAHive::RestoredPersonaHasNoSecretHalf)
                }
            }
            _ => {
                let group = keystore
                    .mint_group()
                    .ok_or(NotAHive::NoKeyMaterial(keystore.refusal()))?;
                let member = crate::membership::Minted::from_keystore(keystore)
                    .map_err(NotAHive::NoKeyMaterial)?;
                if group == member.get() {
                    return Err(NotAHive::EntropyRepeated);
                }
                // The token records the platform mint performed above.
                let persona = Persona::group_of_one(group, member, ClaimState::Open);
                // **THE FIRST-BOOT WRITE, and the one whose absence made
                // every later boot a first boot.** Offered on the
                // `Unreadable` path as well as the `NeverWritten` one: a
                // store that could not be read is a store that may yet be
                // written, and declining to try would leave a recoverable
                // board permanently ephemeral.
                let durability = if persist_new {
                    write_record(&persona, keystore)
                } else {
                    PersonaDurability::Volatile
                };
                Ok(Self {
                    persona,
                    origin: PersonaOrigin::MintedThisBoot,
                    store: match stored {
                        // **A record that failed to decode counts here.**
                        // It is a store that answered and whose answer was
                        // not a complete record — which is the same
                        // operator-visible fact as one that could not be
                        // read at all, and NOT the same as never written.
                        StoredPersona::Unreadable | StoredPersona::Sealed(_) => {
                            StoreCondition::WasUnreadable
                        }
                        StoredPersona::NeverWritten => StoreCondition::Healthy,
                        // 4.3.1b's second half: the store said it cannot
                        // tell, so the report says so too. **Never folded
                        // into `Healthy`** — that fold is the whole defect
                        // the clause exists to prevent.
                        StoredPersona::CannotDistinguish => StoreCondition::CannotDistinguish,
                    },
                    durability,
                    mode,
                })
            }
        }
    }

    /// The persona, for the layers above (11.1 b).
    pub const fn persona(&self) -> &Persona {
        &self.persona
    }

    /// What this hive declares about itself. **The single origin** for the
    /// beacon declaration, the admission decision and anything a human
    /// reads.
    pub const fn mode(&self) -> BuildMode {
        self.mode
    }

    /// Everything 4.3.3a requires be reportable, with nothing absent.
    pub const fn report(&self) -> PersonaReport {
        PersonaReport {
            group: self.persona.group,
            member: self.persona.member,
            claim: self.persona.claim,
            origin: self.origin,
            store: self.store,
            durability: self.durability,
            mode: self.mode,
        }
    }

    /// Whether this persona outlives a power cycle (5.3.2).
    pub const fn durability(&self) -> PersonaDurability {
        self.durability
    }

    /// Join a group (L5 Clause 9 admission, both directions).
    ///
    /// **The kind is DERIVED from the identifier, never supplied.** An
    /// earlier signature took a [`GroupKind`](crate::membership::GroupKind)
    /// from the caller, and this lane named the limit rather than hiding
    /// it: nothing stopped a caller passing `Development` for a group of
    /// its own choosing, so the admission rule bound to a claim instead
    /// of to the bytes. With the seed published (`CORE-5`, ruled
    /// 2026-08-02) the classification
    /// is [`crate::development::classify`] and **a group is the
    /// development group if and only if it is that group.**
    ///
    /// 4.3.2 — exactly one group at any instant — is why this replaces
    /// the persona rather than adding to it.
    /// # IT TAKES THE KEYSTORE BECAUSE THE WRITE BELONGS WITH THE MUTATION
    ///
    /// **Until 2026-08-07 this changed the group and persisted nothing**,
    /// so the record written at boot described the **pre-join** persona.
    /// Next boot decoded that stale record, [`may_join`] saw an ordinary
    /// group on a development device, **refused it as inadmissible and
    /// re-minted** — *the device was a stranger every launch exactly as
    /// before, and the record now made it look persisted.* Measured from
    /// the consumer side by r2-android against `bd0c7d9`: same reported
    /// group both boots because the join runs again, **but a new member
    /// identity**.
    ///
    /// **THE FIX IS THE SIGNATURE, NOT A REMINDER.** The alternative was
    /// to leave re-persisting to the caller — which is what the one
    /// affected consumer had already done by hand — and *a consumer that
    /// does not know to re-encode gets a SILENT re-mint.* **Requiring the
    /// keystore here means a caller cannot change the group without
    /// supplying the means to record it**, so the failure is
    /// unrepresentable rather than discouraged.
    ///
    /// **AND THE DURABILITY IS RECOMPUTED, NOT CARRIED OVER.** If this
    /// write fails, the record on the store **no longer describes this
    /// hive** — so a `Persisted` inherited from boot would be a claim
    /// about a persona that is no longer the one running. *A hive whose
    /// stored record has gone stale is volatile, whatever the last
    /// successful write said.*
    pub fn join<K: Keystore>(
        &mut self,
        group: Identity,
        keystore: &mut K,
    ) -> Result<(), AdmissionRefusal> {
        may_join(self.mode, crate::development::classify(&group))?;
        self.persona.group = group;
        self.durability = write_record(&self.persona, keystore);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::IDENTITY_LEN;
    use crate::membership::Minted;

    struct Mint(u8, bool);
    impl Keystore for Mint {
        fn mint_group(&mut self) -> Option<Identity> {
            self.1.then_some(Identity([self.0; IDENTITY_LEN]))
        }
        fn mint_member(&mut self) -> Option<Identity> {
            self.1.then_some(Identity([self.0 + 1; IDENTITY_LEN]))
        }
    }

    /// A keystore that can resume custody — the route r2-hive asked for.
    struct Restoring(u8, bool);
    impl Keystore for Restoring {
        fn mint_group(&mut self) -> Option<Identity> {
            Some(Identity([self.0; IDENTITY_LEN]))
        }
        fn mint_member(&mut self) -> Option<Identity> {
            Some(Identity([self.0 + 1; IDENTITY_LEN]))
        }
        fn restore(&mut self, _: &Persona) -> bool {
            self.1
        }
    }

    /// **The refusal is still what a silent platform gets.** `Mint` does
    /// not implement `restore`, so it takes the default and a found
    /// persona is refused exactly as before.
    #[test]
    fn a_keystore_with_no_restore_path_still_refuses_a_found_persona() {
        let stored = Persona::group_of_one(
            Identity([7; IDENTITY_LEN]),
            Minted::from_mint(Identity([8; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        let got = Trust::boot(sealed(stored), &mut Mint(5, true), BuildMode::Production);
        assert_eq!(got.err(), Some(NotAHive::RestoredPersonaHasNoSecretHalf));
    }

    /// **And a platform that says it resumed custody boots the persona it
    /// stored** — the identity peers already recognise, which is the whole
    /// point of persisting one.
    #[test]
    fn a_platform_that_resumed_custody_boots_loaded_from_storage() {
        let stored = Persona::group_of_one(
            Identity([7; IDENTITY_LEN]),
            Minted::from_mint(Identity([8; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        let want = stored.group;
        let t = Trust::boot(
            sealed(stored),
            &mut Restoring(5, true),
            BuildMode::Production,
        )
        .expect("boots");
        assert_eq!(t.persona().group, want);
        assert_eq!(t.report().origin, PersonaOrigin::LoadedFromStorage);
    }

    /// **A platform that says it did NOT is refused, not minted over.**
    /// Falling back to a fresh mint would silently change the hive's
    /// identity while its stored persona sat there — a different device
    /// wearing the same board.
    #[test]
    fn a_platform_that_did_not_resume_is_refused_rather_than_reminted() {
        let stored = Persona::group_of_one(
            Identity([7; IDENTITY_LEN]),
            Minted::from_mint(Identity([8; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        let got = Trust::boot(
            sealed(stored),
            &mut Restoring(5, false),
            BuildMode::Production,
        );
        assert_eq!(got.err(), Some(NotAHive::RestoredPersonaHasNoSecretHalf));
    }

    /// **A persona as durable storage would hold it.** The tests used to
    /// hand `Trust::boot` a `Persona` directly; **no platform can do that
    /// any more**, so the fixture goes through the same encode a real
    /// store would — *a fixture that takes a shortcut the product cannot
    /// take is testing a path nobody runs.*
    fn sealed(p: Persona) -> StoredPersona {
        let mut buf = [0u8; crate::record::RECORD_LEN];
        crate::record::encode(p.group(), p.member(), p.claim(), &mut buf).expect("fits");
        StoredPersona::Sealed(crate::record::SealedRecord::from_storage(&buf))
    }

    fn persona(b: u8) -> Persona {
        Persona::group_of_one(
            Identity([b; IDENTITY_LEN]),
            Minted::from_mint(Identity([b + 1; IDENTITY_LEN])),
            ClaimState::Open,
        )
    }

    #[test]
    fn a_minted_persona_and_a_loaded_one_do_not_report_alike() {
        // 4.3.1a, and the excluded case beside it (01-terminology 4.2):
        // the two paths must produce reports that DIFFER, or the clause
        // is satisfied in name only.
        let loaded = Trust::boot(
            sealed(persona(9)),
            &mut Mint(9, true),
            BuildMode::Development,
        )
        .unwrap();
        let minted = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(9, true),
            BuildMode::Development,
        )
        .unwrap();
        assert_eq!(
            loaded.report().group,
            minted.report().group,
            "same bytes either way"
        );
        assert_ne!(
            loaded.report().origin,
            minted.report().origin,
            "identical key material reported identically — the silent case"
        );
    }

    #[test]
    fn an_unreadable_store_is_not_reported_as_a_first_boot() {
        // The two mint paths are distinguishable in the report, because
        // minting over an unreadable store makes this device a stranger
        // to peers that knew it.
        let fresh = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(1, true),
            BuildMode::Development,
        )
        .unwrap();
        let over = Trust::boot(
            StoredPersona::Unreadable,
            &mut Mint(1, true),
            BuildMode::Development,
        )
        .unwrap();
        assert_eq!(fresh.report().origin, over.report().origin);
        assert_ne!(fresh.report().store, over.report().store);
        assert_eq!(over.report().store, StoreCondition::WasUnreadable);
    }

    struct Repeat;
    impl Keystore for Repeat {
        fn mint_group(&mut self) -> Option<Identity> {
            Some(Identity([0x5A; IDENTITY_LEN]))
        }
        fn mint_member(&mut self) -> Option<Identity> {
            Some(Identity([0x5A; IDENTITY_LEN]))
        }
    }

    /// ‼ **L5 4.3.1b: WHERE THE STORE CANNOT DISTINGUISH ABSENT FROM
    /// UNREADABLE, THE HIVE SHALL REPORT THAT IT CANNOT** (`L5-126`).
    ///
    /// **Three variants and the third is the honest nil.** Without it such
    /// a store returns `Healthy` for both cases, *`Healthy`-at-creation
    /// becomes ambiguous, and there is no way to say so.*
    ///
    /// ‼ **THE TWO CONTROLS ARE THE HALF THAT MATTERS**: a store that CAN
    /// tell still says WHICH. *Collapsing a capable store into
    /// `CannotDistinguish` — the pessimistic, safe-looking fold — would
    /// throw away the distinction 4.3.1a was written to create*, and this
    /// test would pass for it if only the first assertion existed.
    #[test]
    fn a_store_that_cannot_distinguish_says_so_and_one_that_can_still_says_which() {
        // 4.3.1b, second half: the store cannot tell, and the report says
        // exactly that.
        let cannot = Trust::boot(
            StoredPersona::CannotDistinguish,
            &mut Mint(3, true),
            BuildMode::Development,
        )
        .expect("a mint on a store that cannot tell still boots");
        assert_eq!(cannot.report().store, StoreCondition::CannotDistinguish);
        assert_eq!(cannot.report().origin, PersonaOrigin::MintedThisBoot);

        // ‼ CONTROL 1: absent is still ABSENT, not folded into the nil.
        let absent = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(4, true),
            BuildMode::Development,
        )
        .expect("first boot");
        assert_eq!(absent.report().store, StoreCondition::Healthy);

        // ‼ CONTROL 2: unreadable is still UNREADABLE. *Minting here makes
        // this device a stranger to every peer that knew it*, and that fact
        // must not be softened into "cannot tell".
        let over = Trust::boot(
            StoredPersona::Unreadable,
            &mut Mint(5, true),
            BuildMode::Development,
        )
        .expect("mints over an unreadable store");
        assert_eq!(over.report().store, StoreCondition::WasUnreadable);

        // And the three are pairwise distinct, asserted rather than assumed
        // from being separate variants.
        assert_ne!(cannot.report().store, absent.report().store);
        assert_ne!(cannot.report().store, over.report().store);
        assert_ne!(absent.report().store, over.report().store);
    }

    #[test]
    fn a_source_that_repeats_is_not_a_hive() {
        // A generator stuck on a constant produces perfectly well-formed
        // key material. Excluded case beside it: a source that DOES vary
        // boots, so the refusal is about the repetition and not about the
        // path.
        assert_eq!(
            Trust::boot(
                StoredPersona::NeverWritten,
                &mut Repeat,
                BuildMode::Development
            ),
            Err(NotAHive::EntropyRepeated)
        );
        assert!(Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(1, true),
            BuildMode::Development
        )
        .is_ok());
    }

    #[test]
    fn a_platform_that_cannot_mint_is_not_a_hive() {
        // 4.3.3: no persona-less running state, so there is no Trust to
        // return and nothing above can display a blank identity.
        assert_eq!(
            Trust::boot(
                StoredPersona::NeverWritten,
                &mut Mint(1, false),
                BuildMode::Development
            ),
            Err(NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotStated))
        );
        // Excluded case: with key material it IS a hive, so the refusal
        // is about the key material and not about the path.
        assert!(Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(1, true),
            BuildMode::Development
        )
        .is_ok());
    }

    struct Timing(KeyMaterialRefusal);
    impl Keystore for Timing {
        fn mint_group(&mut self) -> Option<Identity> {
            None
        }
        fn mint_member(&mut self) -> Option<Identity> {
            None
        }
        fn refusal(&self) -> KeyMaterialRefusal {
            self.0
        }
    }

    #[test]
    fn not_yet_and_never_refuse_identically_and_report_differently() {
        // hive's ESP32-S3 finding: a chip whose TRNG is only conforming
        // while the RF subsystem runs is a platform that CAN host a hive
        // and is not ready to. Both refuse — 4.3.3 admits no persona-less
        // running state either way — and the operator actions differ:
        // start the radio, versus replace the platform.
        let mut yet = Timing(KeyMaterialRefusal::NotYetAvailable);
        let mut never = Timing(KeyMaterialRefusal::Absent);
        let a = Trust::boot(
            StoredPersona::NeverWritten,
            &mut yet,
            BuildMode::Development,
        );
        let b = Trust::boot(
            StoredPersona::NeverWritten,
            &mut never,
            BuildMode::Development,
        );
        assert!(a.is_err() && b.is_err(), "one of them became a hive");
        assert_ne!(a, b, "identical report for opposite operator actions");
        assert_eq!(
            a,
            Err(NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotYetAvailable))
        );
    }

    #[test]
    fn a_platform_that_did_not_say_why_is_not_read_as_having_said_something() {
        // The third answer (01-terminology 5.3). `Mint(_, false)` does not
        // implement `refusal`, so it takes the default — and the default
        // must not claim either definite reason.
        let e = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(1, false),
            BuildMode::Development,
        )
        .unwrap_err();
        assert_eq!(e, NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotStated));
        assert_ne!(e, NotAHive::NoKeyMaterial(KeyMaterialRefusal::Absent));
        assert_ne!(
            e,
            NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotYetAvailable)
        );
    }

    #[test]
    fn a_hive_that_cannot_determine_its_mode_is_a_development_hive_everywhere() {
        // L2 5.4a.1a resolved ONCE, at boot, so no downstream surface
        // gets to decide differently.
        let t = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(2, true),
            BuildMode::Unknown,
        )
        .unwrap();
        assert_eq!(t.mode(), BuildMode::Development);
        assert_eq!(t.report().mode, BuildMode::Development);
        assert_ne!(t.mode(), BuildMode::Unknown, "unknown reached a surface");
    }

    #[test]
    fn joining_honours_clause_9_in_both_directions() {
        let dev_group = crate::development::IDENTITY;
        let other = Identity([7; IDENTITY_LEN]);

        let mut dev = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(3, true),
            BuildMode::Development,
        )
        .unwrap();
        assert_eq!(
            dev.join(other, &mut Mint(3, true)),
            Err(AdmissionRefusal::DevelopmentDeviceOutsideDevelopmentGroup)
        );
        assert_eq!(dev.join(dev_group, &mut Mint(3, true)), Ok(()));
        // 4.3.2: one group at any instant — the join replaced it.
        assert_eq!(dev.persona().group, dev_group);

        let mut prod = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(4, true),
            BuildMode::Production,
        )
        .unwrap();
        assert_eq!(
            prod.join(dev_group, &mut Mint(3, true)),
            Err(AdmissionRefusal::ProductionDeviceIntoDevelopmentGroup)
        );
        assert_eq!(prod.join(other, &mut Mint(3, true)), Ok(()));
    }

    /// L5 9.3 / `CORE-8` / d037: **the restore route is a route.**
    ///
    /// The realistic case, not a contrived one: a development unit
    /// reflashed to production **with its store intact**. Before this,
    /// `boot` took the stored persona straight through and the device
    /// came up inside the development group.
    ///
    /// Three assertions, and **the third is the one that stops this being
    /// a silent re-mint**: it boots, it is NOT in that group, and its
    /// origin is not the clean-first-boot value. Without the third, a
    /// production unit that had been carrying development credentials
    /// would be indistinguishable from a new device out of the box.
    #[test]
    fn a_production_device_does_not_boot_into_a_stored_development_group() {
        let dev_group = crate::development::IDENTITY;
        let stored = Persona::group_of_one(
            dev_group,
            Minted::from_mint(Identity([9; IDENTITY_LEN])),
            ClaimState::Owner,
        );

        let t = Trust::boot(sealed(stored), &mut Mint(5, true), BuildMode::Production).unwrap();
        assert_ne!(
            t.persona().group,
            dev_group,
            "booted into the development group"
        );
        assert_eq!(
            t.report().origin,
            PersonaOrigin::ReplacedInadmissibleStore(dev_group),
            "a refused membership was re-minted silently"
        );
        assert_ne!(
            t.report().origin,
            PersonaOrigin::MintedThisBoot,
            "a unit that was carrying development credentials reads as a clean first boot"
        );
    }

    /// The excluded case (01-terminology 4.2), and it is what makes the
    /// test above evidence rather than an assertion about one input:
    /// **an ADMISSIBLE stored persona must still load unchanged.** A boot
    /// that re-minted every stored persona would pass every assertion
    /// above and be catastrophically wrong.
    #[test]
    fn an_admissible_stored_persona_refuses_for_the_secret_reason_not_the_admission_one() {
        // **This test used to assert the trap.** It required an
        // admissible stored persona to boot `LoadedFromStorage`
        // untouched — which is exactly the hive with an identity and no
        // signing key. The property it was protecting is still real and
        // is kept: *the admission guard must not over-refuse an ordinary
        // group.* So the assertion moves from `Ok(LoadedFromStorage)` to
        // **the identity of the refusal**.
        //
        // **That distinction is the whole test.** Both refusals stop the
        // boot; only one of them means *your admission guard is eating
        // ordinary groups*. A test asserting merely that `boot` returned
        // `Err` would pass under a guard that refused everything.
        let ordinary = Identity([7; IDENTITY_LEN]);
        let stored = Persona::group_of_one(
            ordinary,
            Minted::from_mint(Identity([8; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        assert_eq!(
            Trust::boot(sealed(stored), &mut Mint(5, true), BuildMode::Production),
            Err(NotAHive::RestoredPersonaHasNoSecretHalf),
            "an ordinary group must reach the secret-half refusal, not the admission one"
        );

        // The mirror direction: a DEVELOPMENT device holding the
        // development group across a reboot must also reach the
        // secret-half refusal, so 9.2's first direction is still not
        // making every stored dev persona inadmissible.
        let dev = Persona::group_of_one(
            crate::development::IDENTITY,
            Minted::from_mint(Identity([6; IDENTITY_LEN])),
            ClaimState::Open,
        );
        assert_eq!(
            Trust::boot(sealed(dev), &mut Mint(5, true), BuildMode::Development),
            Err(NotAHive::RestoredPersonaHasNoSecretHalf)
        );
    }

    /// **The diagonal, and it is what proves the arm above is not just
    /// `boot` refusing everything**: an INADMISSIBLE stored persona takes
    /// the replacement path, which **mints**, so it still boots — with a
    /// secret half, because minting produces one.
    ///
    /// *One stored persona boots and another does not, and the difference
    /// is whether a secret half exists for it.* That is the property the
    /// fix is about, stated as a discrimination rather than as a refusal.
    #[test]
    fn an_inadmissible_stored_persona_still_boots_because_replacement_mints() {
        let dev = Persona::group_of_one(
            crate::development::IDENTITY,
            Minted::from_mint(Identity([6; IDENTITY_LEN])),
            ClaimState::Open,
        );
        let t = Trust::boot(sealed(dev), &mut Mint(5, true), BuildMode::Production)
            .expect("a production device replaces an inadmissible store rather than refusing");
        assert!(matches!(
            t.report().origin,
            PersonaOrigin::ReplacedInadmissibleStore(_)
        ));
        assert_ne!(t.persona().group, crate::development::IDENTITY);
    }

    /// ‼ **THE REPLACEMENT MINT PATH'S OWN GUARDS, WHICH NOTHING REACHED**
    /// (`SS585`, found by mutation 2026-09-05). `Trust::boot` mints at TWO
    /// sites carrying the SAME entropy-repeat guard and the SAME group/member
    /// pair: the ordinary first boot, and this one — taken when a stored
    /// persona names a group this device may not join. **Only the first was
    /// exercised.** Making this site fall back to the group key when the
    /// member mint failed, and disabling its repeat guard, left ALL 289 TESTS
    /// GREEN; with this test present the same mutation reddens exactly it.
    ///
    /// The tests that DID reach here assert a boot HAPPENS, not what it
    /// minted — covered for reachability and dark for both invariants. *And
    /// the path is not a corner: it is the reflashed-development-unit case
    /// the code exists for, so a device whose stored group was refused could
    /// mint a persona whose member identity IS its group identity.*
    #[test]
    fn the_replacement_mint_refuses_a_repeating_source_and_a_failed_member_mint() {
        let stored = || {
            sealed(Persona::group_of_one(
                crate::development::IDENTITY,
                Minted::from_mint(Identity([6; IDENTITY_LEN])),
                ClaimState::Open,
            ))
        };
        // A generator stuck on a constant produces well-formed material, and
        // this site must refuse it exactly as its twin does.
        assert_eq!(
            Trust::boot(stored(), &mut Repeat, BuildMode::Production),
            Err(NotAHive::EntropyRepeated),
            "the replacement path accepted a persona whose member identity is its group identity"
        );
        // And a member mint that refuses must not be papered over: no persona
        // at all, rather than one built from whatever was to hand.
        assert_eq!(
            Trust::boot(stored(), &mut Mint(5, false), BuildMode::Production),
            Err(NotAHive::NoKeyMaterial(KeyMaterialRefusal::NotStated)),
            "the replacement path minted something despite the keystore refusing"
        );
        // ‼ THE EXCLUDED CASE, so both refusals are about the MATERIAL and not
        //   about this path being unreachable or broken in general.
        assert!(
            Trust::boot(stored(), &mut Mint(5, true), BuildMode::Production).is_ok(),
            "the replacement path refuses even with good material, so the assertions above \
             prove nothing about the guards"
        );
    }

    #[test]
    fn a_group_one_bit_from_the_development_group_is_not_the_development_group() {
        // The excluded case for the classification itself: a development
        // hive must NOT be admitted to a near-miss group, or the published
        // seed buys nothing.
        let mut near = crate::development::IDENTITY;
        near.0[31] ^= 0x01;
        let mut dev = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(6, true),
            BuildMode::Development,
        )
        .unwrap();
        assert_eq!(
            dev.join(near, &mut Mint(3, true)),
            Err(AdmissionRefusal::DevelopmentDeviceOutsideDevelopmentGroup)
        );
    }

    #[test]
    fn a_refused_join_leaves_the_persona_untouched() {
        // 4.3.2/4.3.3: a refusal must not leave the hive between groups.
        let mut dev = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(5, true),
            BuildMode::Development,
        )
        .unwrap();
        let before = dev.report();
        assert!(dev
            .join(Identity([8; IDENTITY_LEN]), &mut Mint(3, true))
            .is_err());
        assert_eq!(dev.report(), before, "a refused join changed the persona");
    }

    /// A platform with a store: it keeps whatever `persist` hands it and
    /// resumes custody of **exactly** that persona. `next` is the identity
    /// a fresh mint would produce, and the power-cycle test moves it so a
    /// re-mint cannot be mistaken for a restore.
    struct Board {
        /// **The BYTES, as a board holds them** — not a `Persona`. The
        /// double used to keep the typed value, which quietly gave it a
        /// capability no real store has: *a store keeps what it was
        /// handed and cannot reconstruct meaning from it.*
        stored: Option<[u8; crate::record::RECORD_LEN]>,
        next: u8,
    }
    impl Keystore for Board {
        fn mint_group(&mut self) -> Option<Identity> {
            Some(Identity([self.next; IDENTITY_LEN]))
        }
        fn mint_member(&mut self) -> Option<Identity> {
            Some(Identity([self.next + 1; IDENTITY_LEN]))
        }
        fn persist(&mut self, record: &[u8]) -> bool {
            let mut buf = [0u8; crate::record::RECORD_LEN];
            if record.len() != buf.len() {
                return false;
            }
            buf.copy_from_slice(record);
            self.stored = Some(buf);
            true
        }
        fn restore(&mut self, persona: &Persona) -> bool {
            // **Custody is answered by decoding what was kept**, which is
            // the most a store can honestly do here.
            match self.stored {
                Some(bytes) => {
                    crate::record::decode(crate::record::SealedRecord::from_storage(&bytes))
                        == Ok((persona.group(), persona.member(), persona.claim()))
                }
                None => false,
            }
        }
    }

    /// **The whole point, end to end: an identity that survives a power
    /// cycle.** This is what was unreachable — `restore` alone could not
    /// produce it, because nothing ever wrote and `Found` never happened.
    ///
    /// The load-bearing line is `board.next = 200`: after the first boot a
    /// fresh mint would yield a **different** identity, so the second
    /// boot's group can only match if it came off the store. Without it
    /// the test would pass on a board that re-minted the same constant,
    /// and would be asserting the fixture rather than the route.
    #[test]
    fn a_persisted_persona_is_the_same_hive_after_a_power_cycle() {
        let mut board = Board {
            stored: None,
            next: 9,
        };

        let first = Trust::boot(
            StoredPersona::NeverWritten,
            &mut board,
            BuildMode::Production,
        )
        .unwrap();
        assert_eq!(
            first.durability(),
            PersonaDurability::Persisted,
            "a platform that kept the persona was reported as volatile"
        );
        let was = first.persona().group;

        board.next = 200; // a re-mint from here is a different device
        let stored = StoredPersona::Sealed(crate::record::SealedRecord::from_storage(
            &board.stored.expect("nothing was written to the store"),
        ));
        let second = Trust::boot(stored, &mut board, BuildMode::Production).unwrap();

        assert_eq!(second.persona().group, was, "the board came up a stranger");
        assert_eq!(second.report().origin, PersonaOrigin::LoadedFromStorage);
        assert_eq!(second.durability(), PersonaDurability::Persisted);
    }

    /// **The default is `false`, so a platform that has written no persist
    /// path must not read as durable.** `Mint` does not implement
    /// `persist`; the hive boots — 5.3.2 permits volatile-only — and says
    /// so.
    #[test]
    fn a_keystore_with_no_persist_path_boots_and_reports_volatile() {
        let t = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Mint(5, true),
            BuildMode::Production,
        )
        .unwrap();
        assert_eq!(
            t.durability(),
            PersonaDurability::Volatile,
            "an unwritten persona was reported as surviving a power cycle"
        );
        assert_eq!(
            t.report().origin,
            PersonaOrigin::MintedThisBoot,
            "a volatile persona is still a persona; this must not refuse"
        );
    }

    /// **A failed persist is not a failed boot.** The distinction is
    /// 5.3.2's second sentence: volatile-only is a *conforming* regime, so
    /// a platform that tried and could not must still be a hive — with the
    /// condition visible rather than escalated.
    #[test]
    fn a_platform_that_cannot_persist_is_still_a_hive() {
        struct Declines(u8);
        impl Keystore for Declines {
            fn mint_group(&mut self) -> Option<Identity> {
                Some(Identity([self.0; IDENTITY_LEN]))
            }
            fn mint_member(&mut self) -> Option<Identity> {
                Some(Identity([self.0 + 1; IDENTITY_LEN]))
            }
            fn persist(&mut self, _: &[u8]) -> bool {
                false
            }
        }
        let t = Trust::boot(
            StoredPersona::NeverWritten,
            &mut Declines(4),
            BuildMode::Production,
        )
        .unwrap();
        assert_eq!(t.durability(), PersonaDurability::Volatile);
    }

    /// **THE REPLACEMENT SURVIVES THE NEXT BOOT — the other write whose
    /// EFFECT nobody had checked.**
    ///
    /// `d037`'s replacement path persists the fresh persona over a refused
    /// one, and a test already asserts **that the write happened**. *That
    /// is the same half that was checked for `join`, and checking it was
    /// what let `join` be wrong for an hour* — **a write can happen and
    /// still leave the next boot re-minting.**
    ///
    /// So this boots a third time from the bytes the replacement wrote and
    /// requires `LoadedFromStorage`: **if the replacement were not
    /// readable, a production unit that had been carrying the development
    /// group would re-mint on every boot for ever** and the panel would
    /// say *replaced inadmissible store* each time, which reads as the
    /// remedy working.
    #[test]
    fn the_replacement_for_an_inadmissible_store_is_readable_next_boot() {
        let dev_group = crate::development::IDENTITY;
        let refused = Persona::group_of_one(
            dev_group,
            Minted::from_mint(Identity([9; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        let mut board = Board {
            stored: None,
            next: 31,
        };

        let replaced = Trust::boot(sealed(refused), &mut board, BuildMode::Production)
            .expect("a production hive replaces an inadmissible store rather than refusing to run");
        assert_eq!(
            replaced.report().origin,
            PersonaOrigin::ReplacedInadmissibleStore(dev_group)
        );

        let next = Trust::boot(
            StoredPersona::Sealed(crate::record::SealedRecord::from_storage(
                &board.stored.expect("the replacement was written"),
            )),
            &mut board,
            BuildMode::Production,
        )
        .expect("the replacement is admissible and its custody resumes");

        assert_eq!(
            next.report().origin,
            PersonaOrigin::LoadedFromStorage,
            "the replacement was written and the next boot could not use it — \
             the unit re-mints for ever and the panel calls it a remedy"
        );
        assert_eq!(next.persona().group(), replaced.persona().group());
        assert_eq!(next.persona().member(), replaced.persona().member());
    }

    /// **THE RECORD FOLLOWS THE JOIN, AND THE SECOND BOOT IS THE PROOF.**
    ///
    /// Found by r2-android from the consumer side against `bd0c7d9`:
    /// `join` changed the group and persisted nothing, so the record kept
    /// the **pre-join** persona, the next boot refused it as inadmissible
    /// and re-minted — *a stranger every launch, with a record that made
    /// it look persisted.*
    ///
    /// **The assertion that matters is the second boot, not the bytes.**
    /// Checking only that the stored group changed would pass on a record
    /// that was rewritten and still unusable; **booting from it and
    /// getting `LoadedFromStorage` with the SAME member identity is what
    /// says reload actually works for a joining consumer.**
    #[test]
    fn a_joined_group_is_what_the_next_boot_reads_back() {
        let mut board = Board {
            stored: None,
            next: 21,
        };
        let mut first = Trust::boot(
            StoredPersona::NeverWritten,
            &mut board,
            BuildMode::Development,
        )
        .expect("mints");
        let minted_member = first.persona().member();

        first
            .join(crate::development::IDENTITY, &mut board)
            .expect("the development group is admissible on a development hive");
        assert_eq!(first.durability(), PersonaDurability::Persisted);

        // Second boot, from exactly the bytes the store now holds.
        let second = Trust::boot(
            StoredPersona::Sealed(crate::record::SealedRecord::from_storage(
                &board.stored.expect("the join was written"),
            )),
            &mut board,
            BuildMode::Development,
        )
        .expect("the stored persona is admissible and its custody resumed");

        assert_eq!(
            second.report().origin,
            PersonaOrigin::LoadedFromStorage,
            "the joined group was refused and re-minted"
        );
        assert_eq!(
            second.persona().group(),
            crate::development::IDENTITY,
            "the record still held the pre-join group"
        );
        assert_eq!(
            second.persona().member(),
            minted_member,
            "a new member identity means this device is a stranger to its peers"
        );
    }

    /// **The replacement is written too.** A production unit that was
    /// carrying the development group gets a fresh admissible persona —
    /// and if that persona is not kept, the refused one stays on the store
    /// and the same replacement happens on every boot forever. *Refusing a
    /// credential without replacing it is half a remedy.*
    #[test]
    fn a_replaced_inadmissible_persona_is_persisted_over_the_refused_one() {
        let dev_group = crate::development::IDENTITY;
        let stored = Persona::group_of_one(
            dev_group,
            Minted::from_mint(Identity([9; IDENTITY_LEN])),
            ClaimState::Owner,
        );
        let mut written = [0u8; crate::record::RECORD_LEN];
        crate::record::encode(
            stored.group(),
            stored.member(),
            stored.claim(),
            &mut written,
        )
        .expect("fits");
        let mut board = Board {
            stored: Some(written),
            next: 11,
        };

        let t = Trust::boot(sealed(stored), &mut board, BuildMode::Production).unwrap();

        assert_eq!(
            t.report().origin,
            PersonaOrigin::ReplacedInadmissibleStore(dev_group)
        );
        assert_eq!(t.durability(), PersonaDurability::Persisted);
        let (group_now, _, _) = crate::record::decode(crate::record::SealedRecord::from_storage(
            &board.stored.expect("the store was emptied"),
        ))
        .expect("the replacement was written as a complete record");
        assert_ne!(
            group_now, dev_group,
            "the refused group is still what the store would report next boot"
        );
    }
}
