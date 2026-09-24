//! Group membership and claim state (L5 Clause 4, register rows
//! L5-005..L5-026).

use crate::identity::Identity;
use r2_hal_traits::build_mode::BuildMode;

/// The persisted claim state of a persona (L5 4.4.1 / L5-018). Exactly two
/// values are ever *written*; what a boot makes of an absent or damaged
/// record is [`BootClaim`], which is not the same question.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimState {
    /// Claimable: set at first boot or after a physical reset, and at no
    /// other time (L5 4.4.2 / L5-019).
    Open,
    /// Claimed by an owner; set in the same atomic commit that installs the
    /// persona (L5 4.4.2 / L5-021).
    Owner,
}

/// What a boot concludes from the stored claim record.
///
/// L5 4.4.6 (L5-026) makes an absent or unreadable record its own outcome:
/// **not OWNER and not claimable over the network**, recoverable only by
/// local action. That is deliberately *not* [`ClaimState::Open`] — treating
/// damage as Open would let anyone on the network claim a device whose
/// storage merely faulted, so the damaged case must be a state of its own.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BootClaim {
    /// Record read, value OPEN: claimable over the network.
    Open,
    /// Record read, value OWNER.
    Owner,
    /// **No record has ever been written.** A definite fact, not an
    /// inability to tell.
    ///
    /// Treated exactly as [`BootClaim::Indeterminate`] — 4.4.6 says
    /// *missing or unreadable* and mandates one treatment for both, and
    /// that is right: neither is evidence of OPEN. Kept apart because the
    /// **reason** differs and nothing else distinguishes them. An
    /// unprovisioned device and one whose storage faulted are the same to
    /// the claim logic and entirely different to whoever investigates.
    ///
    /// `PROVISIONAL(STD-SS128)`, and now ruled: **L5 4.4.6a** is a
    /// *should* — report a missing claim state distinguishably from an
    /// unreadable one. The fold of behaviour is correct and stays; only
    /// the report was wrong. L6 5.5.4 now rules the analogous persona case —
    /// *report it distinguishably from a persona never given* — and this
    /// is the same question one layer down. Nothing here diverges from
    /// 4.4.6; it adds only the ability to say which happened.
    NeverRecorded,
    /// A record exists and cannot be read: fail closed.
    Indeterminate,
}

/// What storage yielded when the claim record was read.
///
/// Three outcomes, because `Option<ClaimState>` has **one** empty case and
/// there are **two** ways to have no value — and a reader given the
/// `Option` is forced to conflate them at the point of reading, before
/// anything can distinguish them. The polarity test: *what does the empty
/// value mean?* Here it meant two different things.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimRecord {
    /// A record was read and verified.
    Recorded(ClaimState),
    /// No record has ever been written for this device.
    NeverRecorded,
    /// A record is present and does not verify.
    Unreadable,
}

impl BootClaim {
    /// Interpret the stored record (L5 4.4.6).
    pub const fn from_stored(record: ClaimRecord) -> Self {
        match record {
            ClaimRecord::Recorded(ClaimState::Open) => BootClaim::Open,
            ClaimRecord::Recorded(ClaimState::Owner) => BootClaim::Owner,
            ClaimRecord::NeverRecorded => BootClaim::NeverRecorded,
            ClaimRecord::Unreadable => BootClaim::Indeterminate,
        }
    }

    /// Whether this outcome should be reported upward as a **fault**.
    ///
    /// Only [`BootClaim::Indeterminate`]. A device that never had a claim
    /// record is not faulty, and reporting it as damaged sends whoever
    /// reads it hunting storage trouble on a perfectly good unit — the
    /// harm L6 5.4.4's ruling names: *a diagnostic that names the wrong
    /// cause is worse than none, because it is acted on*.
    pub const fn needs_reporting(self) -> bool {
        matches!(self, BootClaim::Indeterminate)
    }

    /// Whether a network claim may proceed (L5 4.4.2 / L5-020: only from
    /// OPEN; L5 4.4.6: never from an indeterminate record).
    pub const fn claimable_over_network(self) -> bool {
        matches!(self, BootClaim::Open)
    }

    /// Whether this hive counts as owned. An indeterminate record is
    /// **not** owned (L5 4.4.6) — and is equally not claimable, so it is
    /// recoverable only by local action.
    pub const fn is_owner(self) -> bool {
        matches!(self, BootClaim::Owner)
    }
}

/// Why a claim attempt was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClaimRefusal {
    /// Already owned — a claim proceeds only from OPEN (L5 4.4.2).
    AlreadyOwner,
    /// The claim record is absent or unreadable: local action only
    /// (L5 4.4.6). Both refuse identically, as the clause requires.
    Indeterminate,
}

/// The 4.4.2 check, which the standard requires **twice**: once before the
/// request is emitted and again before installation (L5-020). The second
/// call is not redundant — it is the one that catches a state change
/// during the exchange.
///
/// **This crate provides the check and CANNOT provide the two call
/// sites**, because it is sans-IO: it neither emits the request nor
/// performs the installation. An earlier version of this sentence said
/// *"both call sites use this function"*, **which was a claim about code
/// that does not exist here** — the caller's discipline described as
/// though it were this crate's guarantee. `L5-020` is dispositioned
/// PARTIAL for exactly that reason.
pub const fn may_claim(state: BootClaim) -> Result<(), ClaimRefusal> {
    match state {
        BootClaim::Open => Ok(()),
        BootClaim::Owner => Err(ClaimRefusal::AlreadyOwner),
        // 4.4.6 mandates one treatment for missing and unreadable alike,
        // and this is where that is honoured: the two states differ only
        // in what they are reported as, never in what they permit.
        BootClaim::Indeterminate | BootClaim::NeverRecorded => Err(ClaimRefusal::Indeterminate),
    }
}

/// A hive's persona: the group it belongs to, its member identity for that
/// group, and its claim state (L5 Clause 5, surfaced upward by 11.1 b /
/// L5-098).
///
/// There is no ungrouped, keyless or persona-less running state (L5 4.3.3 /
/// L5-014), and a hive is a member of exactly one group at any instant
/// (4.3.2 / L5-013) — so this type has no "no group" representation and
/// nothing above can construct one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Persona {
    /// The group's identity; its identifier derives from this public key
    /// (L5 4.2.2 / L5-007), so generating the keypair determines the
    /// identifier.
    pub(crate) group: Identity,
    /// A member keypair generated fresh for this persona (L5 5.1.1 /
    /// L5-027); its public half is this identity.
    pub(crate) member: Identity,
    pub(crate) claim: ClaimState,
}

impl Persona {
    /// The group this hive belongs to.
    pub const fn group(&self) -> Identity {
        self.group
    }

    /// This hive's member identity within that group.
    pub const fn member(&self) -> Identity {
        self.member
    }

    /// The claim state (L5 Clause 5).
    pub const fn claim(&self) -> ClaimState {
        self.claim
    }
}

/// **PROOF THAT AN IDENTITY CAME OUT OF THE MINT PATH — L5 5.1.1a.**
///
/// *"A hive shall present as its own only a persona identity it GENERATED
/// under 5.1.1 and has held without interruption since."*
///
/// Until 2026-08-05 the type permitted the opposite. [`Identity`] is
/// `Identity(pub [u8; 32])` — **a tuple struct with a public field** — and
/// [`Persona::group_of_one`] took one, so **a persona could be built around
/// an identity that was never minted anywhere**: read off a wire, typed by
/// hand, copied from a peer. The clause said *generated*; the signature said
/// *any thirty-two bytes*.
///
/// The raw-identity constructor remains crate-private. A platform obtains this
/// proof through [`Minted::from_keystore`], which calls its actual member mint
/// rather than accepting a public identity supplied by the caller. This makes
/// the same boundary available to enrollment consumers outside the core crate.
///
/// # What this does NOT close, said here rather than left to be found
///
/// **`Identity` itself stays public and constructible, deliberately.** A
/// *peer's* identity arrives from the wire and must be expressible; sealing
/// it would break the case the clause is not about. Only the persona's OWN
/// member identity is narrowed.
///
/// And **the mint is the platform's** — `mint_member` is a trait method the
/// hive implements — so this proves *the identity came through the mint
/// path*, **not that the platform actually generated it rather than
/// fabricating one**. That half is the platform's and is `L5-122`'s
/// entropy boundary.
///
/// **`held without interruption` is untouched by this**: a persona restored
/// from storage did not pass through here, and storage custody is `L5-124`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Minted(Identity);

impl Minted {
    /// Generate a candidate member through the platform keystore and retain the
    /// core's mint-path proof. No public identity can be supplied to this method.
    /// The platform must actually generate and retain the private key; this token
    /// does not establish entropy quality, durable custody or enrollment consent.
    /// A refusal returns no proof and preserves the platform's stated reason.
    pub fn from_keystore<K: crate::surface::Keystore>(
        keystore: &mut K,
    ) -> Result<Self, crate::surface::KeyMaterialRefusal> {
        match keystore.mint_member() {
            Some(identity) => Ok(Self::from_mint(identity)),
            None => Err(keystore.refusal()),
        }
    }

    /// Record that `id` came from the mint path.
    ///
    /// **`pub(crate)` is the whole mechanism.** Widening it to `pub` returns
    /// the surface to what `L5-123` was PARTIAL for, and the row's evidence
    /// is this visibility.
    ///
    /// **THE SEAL, DEMONSTRATED FROM OUTSIDE THE CRATE** — a doc test is
    /// compiled as a separate crate, so this is the consumer's view and not
    /// an in-crate assertion about itself:
    ///
    /// ```compile_fail
    /// use r2_trust::{Identity, membership::Minted};
    /// // A caller cannot mint the proof, so it cannot forge a persona.
    /// let _ = Minted::from_mint(Identity([9; 32]));
    /// ```
    ///
    /// And the EXCLUDED CASE, so the failure above is privacy and not a
    /// typo in the path — **reading one is fine; the restriction is on
    /// making one**:
    ///
    /// ```
    /// use r2_trust::{Identity, membership::Minted};
    /// fn takes_one(m: Minted) -> Identity { m.get() }
    /// ```
    pub(crate) const fn from_mint(id: Identity) -> Self {
        Self(id)
    }

    /// The identity, for reading. Handing it out is harmless — the
    /// restriction is on **making** one, not on seeing one.
    pub const fn get(self) -> Identity {
        self.0
    }
}

/// **PROOF THAT A PERSONA DECODED FROM A COMPLETE STORED RECORD — L6
/// 5.5.3a, AND THE NAME IS THE CLAUSE'S OWN WORD.**
///
/// # WHY NOT `Restored`, WHICH IS WHAT THIS WAS CALLED FOR AN HOUR
///
/// **A NAME BORROWED FROM A CLAUSE IMPORTS THE CLAUSE'S BOUND** (standard,
/// 2026-08-07). 5.5.3a defines *self-validating* as **a complete record is
/// distinguishable from an incomplete one by reading that storage and
/// nothing else** — which names completeness **and says in its own words
/// that storage alone is the whole basis**, so *the absence of
/// device-binding is stated by the name rather than documented beside it.*
/// **An invented name needs its limit in a docstring, and docstrings drift
/// while clause references do not.**
///
/// **AND `Restored` IS LEFT UNSPENT DELIBERATELY — retain-do-not-reuse,
/// applied to a type name.** When L0 10.4 closes and a hardware-rooted
/// secret exists, the token becomes genuinely device-bound, **and THAT is
/// the thing honestly called `Restored`.** *Spend the word now on the
/// weaker property and the stronger one has no name — and the migration is
/// worse than a rename, because every call site that read `Restored` as
/// device-bound was already wrong and NOTHING WILL FAIL when it becomes
/// right.* Three states where this crate has two, the third deliberately
/// unimplemented.
///
/// **L6 5.4.2b Note 3 already ruled what a discriminator like this
/// establishes**: it protects a record against **corruption, not against
/// being false** — *no checksum catches a true-looking lie* — and with the
/// key in the image it is weaker still: it attests that **this BUILD**
/// wrote bytes of this shape, not that **this DEVICE** did.
///
/// The sibling of [`Minted`], and **deliberately not the same type**.
/// `Minted` means *this crate minted this identity*. Widening it to cover
/// bytes read from a store would **delete the distinction `L5-123` IS**,
/// while leaving every signature looking unchanged — *a widened token
/// deletes the claim and looks like it kept it.*
///
/// # WHAT IT ESTABLISHES, AND IT IS NARROWER THAN ITS NAME SUGGESTS
///
/// **That [`crate::record::decode`] read a COMPLETE record** — right
/// length, known version, checksum intact, decodable claim — *from the
/// stored bytes and nothing else*, which is exactly what 5.5.3a's
/// **self-validating** asks for.
///
/// **IT DOES NOT ESTABLISH THAT THE RECORD IS THIS DEVICE'S.** With no
/// hardware-rooted secret there is nothing to bind it to (`STD-SS271`,
/// L0 10.4), so a record copied from another device of the same build
/// satisfies it. **VALIDATED, NOT AUTHENTIC** — and the name is with the
/// standard lane for exactly that reason.
///
/// **AND IT IS NOT A CUSTODY CLAIM.** Whether the platform still holds
/// the secret half is the platform's answer, kept apart and reported
/// rather than folded in — *a token minted from a platform boolean is not
/// proof, because that boolean can be returned for any bytes.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SelfValidated(Identity);

impl SelfValidated {
    /// Record that `id` came back out of a complete stored record.
    ///
    /// **`pub(crate)` is the whole mechanism**, exactly as for
    /// [`Minted::from_mint`]: the only callers are inside this crate, one
    /// line from a successful `decode`.
    pub(crate) const fn from_record(id: Identity) -> Self {
        Self(id)
    }

    /// The identity, for reading.
    pub const fn get(self) -> Identity {
        self.0
    }
}

impl Persona {
    /// A fresh group of one: the state a hive enters at first boot, and the
    /// state it enters on leaving a group without joining another —
    /// a newly generated keypair and therefore a new group identifier
    /// (L5 4.3.4 / L5-015). Leaving is never an ungrouped state.
    ///
    /// **`member` is a [`Minted`], not an [`Identity`], and that is L5
    /// 5.1.1a enforced rather than asserted** (2026-08-05).
    pub const fn group_of_one(group: Identity, member: Minted, claim: ClaimState) -> Self {
        let member = member.get();
        Self {
            group,
            member,
            claim,
        }
    }

    /// Leave the current group without joining another (L5 4.3.4): a
    /// fresh group of one, **with a newly generated keypair and therefore
    /// a new group identifier**.
    ///
    /// ‼ **THE CLAIM STATE IS CARRIED, NOT PASSED, AND THAT IS 4.4.4
    /// ENFORCED RATHER THAN CHECKED.** *Leaving a group shall not set
    /// OPEN; the departing hive enters a CLOSED group of one and remains
    /// unclaimable until physically reset.* There is **no `claim`
    /// parameter here**, so a caller cannot set OPEN on the way out —
    /// *the clause forbids a transition, and the transition has no
    /// argument to express it.*
    ///
    /// ‼ **AND LEAVING IS NEVER AN UNGROUPED STATE** (4.3.3): the return
    /// type is a `Persona`, not an `Option<Persona>`, so there is no
    /// moment between the two groups that a type here can represent.
    ///
    /// **5.1.4's three-part destruction is satisfied by substitution
    /// rather than by an erase call**: the member keypair is replaced by
    /// `new_member`, the derived keys change because
    /// [`crate::derive`] takes the group identity as input and the group
    /// identity is new, and the beacon identifier follows the member
    /// identity. *The old secret halves are the platform `Keystore`'s and
    /// leave through `SecretKey`'s zeroizing `Drop` (5.3.4), not through
    /// anything this function can call.*
    /// **The persona an enrolment ceremony installed** (L5B 6.1.1 e).
    ///
    /// ‼ **`pub(crate)` IS THE WHOLE MECHANISM**, exactly as for
    /// [`Minted::from_mint`] and [`SelfValidated::from_record`]: the only
    /// caller is [`crate::ceremony::Ceremony::install`], one line from the
    /// commit that authorised it. **A caller outside this crate cannot
    /// manufacture a persona for a group it was never enrolled into.**
    ///
    /// ‼ **AND THE CLAIM STATE IS NOT A PARAMETER, WHICH IS L5 4.4.2
    /// ENFORCED RATHER THAN CHECKED.** *`Owner` is set in the SAME ATOMIC
    /// COMMIT that installs the persona* — so it is set here, by
    /// construction, and **there is no argument in which a caller could
    /// install a persona and leave it `Open`.** *The clause names a
    /// simultaneity, and a simultaneity is not something a second call can
    /// be trusted to preserve.*
    ///
    /// Note the asymmetry with [`Self::leave`], which is deliberate and is
    /// the same rule from the other side: leaving **carries** the claim
    /// because 4.4.4 forbids a departing hive setting `Open`; enrolling
    /// **sets** it because 4.4.2 requires `Owner` at the install.
    pub(crate) const fn enrolled(group: Identity, member: Minted) -> Self {
        Self {
            group,
            member: member.get(),
            claim: ClaimState::Owner,
        }
    }

    pub const fn leave(&self, new_group: Identity, new_member: Minted) -> Self {
        Self {
            group: new_group,
            member: new_member.get(),
            claim: self.claim,
        }
    }

    /// **The persona a complete stored record decoded to** (L6 5.5.3a).
    ///
    /// Named for what the record established rather than for what a
    /// caller hopes it did — see [`SelfValidated`].
    ///
    /// Separate from [`Persona::group_of_one`] and taking a different
    /// token, because **the two say different things about where the
    /// member identity came from** and only the caller that produced it
    /// knows which. *One function with a boolean would have let a caller
    /// pass the wrong one* — the same argument [`crate::surface`] makes
    /// for keeping unload and suspend apart.
    ///
    /// **This does not decide admissibility.** A restored persona is
    /// still put through the same group check as any other at boot: the
    /// route by which a persona arrived has never been what makes its
    /// group acceptable, and `d037` is the entry recording that a guard
    /// on the path you were thinking about is a guard with an unstated
    /// denominator.
    pub const fn self_validated(group: Identity, member: SelfValidated, claim: ClaimState) -> Self {
        let member = member.get();
        Self {
            group,
            member,
            claim,
        }
    }
}

/// Which trust group this is, for admission (L5 Clause 9).
///
/// **This kind is DERIVED from the identifier, never asserted by a
/// caller** — [`crate::development::classify`] returns `Development` if
/// and only if the group is *the* published one. So it is a
/// by-construction guarantee.
///
/// **It was not, and the history is kept because the correction is the
/// point.** `CORE-5` recorded that nothing in the corpus published the
/// development group's key material — searched, and 9.1 itself was the
/// only hit — so this crate offered no constant, `Development` was a
/// caller's claim, and the doc said plainly that this was **not** a
/// by-construction guarantee. **Roy ruled the seed on 2026-08-02 and the
/// supervisor ruled the derivation**, `CORE-5` closed, and the guarantee
/// the doc disclaimed now holds.
///
/// *This paragraph was itself stale for a day*: it went on denying a
/// constant that had shipped beside it, found while dispositioning L5
/// Clause 9 against the code rather than against intent — **which is the
/// argument for dispositioning at all.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GroupKind {
    /// The one development group of 9.1, identified by its published
    /// public half.
    Development,
    /// Any other group, including the group-of-one a hive mints at first
    /// boot (4.3.1).
    Ordinary,
}

/// Why a join was refused (L5 Clause 9).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AdmissionRefusal {
    /// 9.2, first direction: *"A development-mode device shall join only
    /// the development group."* Keeps a development device from being a
    /// foothold into a real group.
    DevelopmentDeviceOutsideDevelopmentGroup,
    /// 9.2, second direction: *"The development group shall admit only
    /// development-mode devices."* This is what makes publication safe —
    /// a published credential that only opens development devices is
    /// worth nothing against the production world.
    ProductionDeviceIntoDevelopmentGroup,
}

/// L5 9.2/9.3 admission, both directions.
///
/// Takes the device's **declared** mode rather than its raw one, so a hive
/// that cannot determine its own mode is admitted as development (L2
/// 5.4a.1a) instead of falling through to production. **The unsafe
/// direction is a development device inside a production boundary**, and
/// this is where that is refused.
pub const fn may_join(device: BuildMode, group: GroupKind) -> Result<(), AdmissionRefusal> {
    match (device.declared(), group) {
        (BuildMode::Development, GroupKind::Development) => Ok(()),
        (BuildMode::Development, GroupKind::Ordinary) => {
            Err(AdmissionRefusal::DevelopmentDeviceOutsideDevelopmentGroup)
        }
        (_, GroupKind::Development) => Err(AdmissionRefusal::ProductionDeviceIntoDevelopmentGroup),
        (_, GroupKind::Ordinary) => Ok(()),
    }
}

/// L5 9.3: *"A production device shall treat the development group's
/// credentials as inert: possession shall confer nothing."*
///
/// # `CORE-13`: CLOSED 2026-08-14 — THE CALLER IS `GroupKeys::for_group`
///
/// ‼ **THIS HEADING READ *THIS FUNCTION HAS NO CALLER* UNTIL 2026-09-05,
/// THREE WEEKS AFTER IT ACQUIRED ONE (`SS592`).** The paragraph is kept
/// because the defect it describes was real and the fix is the
/// interesting part — but it is now *history*, and it said so nowhere.
///
/// **What was true, found 2026-08-03.** This function decided the
/// question correctly and **nothing outside its own tests called it**.
/// [`crate::gate::apply_gate`] never consults membership, build mode or
/// group kind — it takes the group keys its caller hands it — so a
/// production device given the development group's keys passed the gate
/// for that group's traffic with `may_join` never running and this
/// function never asked. `L5-087` and `L5-088` were dispositioned MET on
/// this function and became PARTIAL: *the check existed and nothing ran
/// it.*
///
/// **What is true now.** [`crate::gate::GroupKeys::for_group`] calls it
/// and returns `None` when it refuses, and **`GroupKeys`' fields are
/// private, so that constructor is the only way in.** The refusal moved
/// from the decision to the CONSTRUCTION: *keys that cannot be built are
/// keys no frame can be verified under*, and **a safety property enforced
/// per-call is one somebody eventually calls around.** Both rows are
/// `IMPLEMENTED+TESTED` again, proved red by removing the check.
///
/// **And the development group's secret is a published constant**, so
/// possession is not a barrier. That is precisely why 9.3 puts the
/// obligation on the *treatment* rather than on the secrecy.
///
/// Separate from [`may_join`] because 9.3 is two obligations, not one —
/// **not enrollable by any route** *and* **possession confers nothing**.
/// A device that refuses to join but honours a credential it already
/// holds satisfies the first and breaks the second.
pub const fn credentials_confer(device: BuildMode, group: GroupKind) -> bool {
    !matches!(
        (device.declared(), group),
        (BuildMode::Production, GroupKind::Development)
    )
}

/// Whether this persona was created during the current boot or loaded
/// from storage (L5 4.3.1a).
///
/// 4.3.1a: a hive *"shall be able to report whether the persona it holds
/// was created during the current boot or loaded from storage, and shall
/// not report the two alike."*
///
/// The measured case behind the clause: a store answered with 32 valid
/// bytes whether it had loaded an established identity or minted one
/// seconds earlier, so **a failure to read existing material was
/// indistinguishable from correct operation** — the hive comes up
/// healthy, its peers see a stranger, and nothing anywhere reports it.
/// This is validity-is-not-truth at the identity layer: the key material
/// is valid, and valid says nothing about whether it is the identity this
/// device had yesterday.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PersonaOrigin {
    /// Minted this boot — 4.3.1's group of one, or 4.3.4's fresh group
    /// after leaving. **A peer's view of the group changed.**
    MintedThisBoot,
    LoadedFromStorage,
    /// **A stored persona was refused and replaced** (L5 9.3, d037).
    ///
    /// The store held a group this device may not be in — the realistic
    /// case being a development unit reflashed to production with its
    /// store intact — so the membership was refused and a fresh group of
    /// one minted in its place. Carries the **refused** group, because
    /// *which* group it was is the whole diagnostic.
    ///
    /// **Distinct from [`MintedThisBoot`](Self::MintedThisBoot) by
    /// requirement, not by taste.** If a re-mint after refusing an
    /// inadmissible group looked identical to a clean first boot, the
    /// medium would present *healthy new device* for *unit that was
    /// carrying credentials it must not have* — a resting state reading
    /// as the healthy one, in the place it would cost most.
    ///
    /// So: **fail closed on membership, fail open on availability, and
    /// loud on the fact.** The device runs; it is not in that group; and
    /// nothing has to infer what happened.
    ReplacedInadmissibleStore(Identity),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::IDENTITY_LEN;

    fn id(b: u8) -> Identity {
        Identity([b; crate::crypto::IDENTITY_LEN])
    }

    #[test]
    fn a_development_device_joins_only_the_development_group() {
        // 9.2, first direction, and its excluded case (4.2): the same
        // call for the group it MAY join must succeed, or the refusal
        // proves nothing.
        assert_eq!(
            may_join(BuildMode::Development, GroupKind::Development),
            Ok(())
        );
        assert_eq!(
            may_join(BuildMode::Development, GroupKind::Ordinary),
            Err(AdmissionRefusal::DevelopmentDeviceOutsideDevelopmentGroup),
            "a development device became a foothold into a real group"
        );
    }

    #[test]
    fn the_development_group_admits_only_development_devices() {
        // 9.2, second direction — the half that makes publication safe.
        assert_eq!(
            may_join(BuildMode::Production, GroupKind::Development),
            Err(AdmissionRefusal::ProductionDeviceIntoDevelopmentGroup)
        );
        assert_eq!(may_join(BuildMode::Production, GroupKind::Ordinary), Ok(()));
    }

    #[test]
    fn a_hive_that_cannot_tell_its_mode_is_admitted_as_development() {
        // L2 5.4a.1a reaching the admission decision: Unknown must NOT
        // fall through to the production branch, which is the unsafe
        // direction — a relaxed-trust device inside a production
        // boundary.
        assert_eq!(
            may_join(BuildMode::Unknown, GroupKind::Development),
            may_join(BuildMode::Development, GroupKind::Development)
        );
        assert_eq!(
            may_join(BuildMode::Unknown, GroupKind::Ordinary),
            Err(AdmissionRefusal::DevelopmentDeviceOutsideDevelopmentGroup),
            "an undeterminable mode was admitted to an ordinary group"
        );
    }

    #[test]
    fn possession_of_development_credentials_confers_nothing_on_production() {
        // 9.3 is TWO obligations. Refusing to join satisfies the first;
        // this is the second, and a device honouring a credential it
        // already holds would pass the first and break this.
        assert!(!credentials_confer(
            BuildMode::Production,
            GroupKind::Development
        ));
        // Excluded case: every other pairing does confer, so the refusal
        // is aimed rather than blanket.
        assert!(credentials_confer(
            BuildMode::Development,
            GroupKind::Development
        ));
        assert!(credentials_confer(
            BuildMode::Production,
            GroupKind::Ordinary
        ));
        assert!(credentials_confer(
            BuildMode::Unknown,
            GroupKind::Development
        ));
    }

    #[test]
    fn a_minted_persona_does_not_report_the_same_as_a_loaded_one() {
        // 4.3.1a: "shall not report the two alike". The measured failure
        // is a store that answers with valid bytes either way, so a
        // failure to read existing material is indistinguishable from
        // correct operation.
        assert_ne!(
            PersonaOrigin::MintedThisBoot,
            PersonaOrigin::LoadedFromStorage
        );
        let fresh = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Open);
        let loaded = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Open);
        // Same persona bytes, and the origin is what tells them apart —
        // so the distinction cannot be recovered from the persona alone.
        assert_eq!(fresh, loaded);
    }

    #[test]
    fn damaged_claim_record_is_not_open() {
        // L5 4.4.6: the case the fail-closed rule exists for — a faulted
        // record must not become a network-claimable device.
        let boot = BootClaim::from_stored(ClaimRecord::Unreadable);
        assert_eq!(boot, BootClaim::Indeterminate);
        assert!(!boot.claimable_over_network());
        assert!(!boot.is_owner());
        assert_eq!(may_claim(boot), Err(ClaimRefusal::Indeterminate));
    }

    #[test]
    fn absent_and_unreadable_refuse_identically_and_report_differently() {
        // 4.4.6 mandates ONE treatment for missing and unreadable, and
        // that is honoured: neither is evidence of OPEN, so neither is
        // claimable and neither is owner.
        let never = BootClaim::from_stored(ClaimRecord::NeverRecorded);
        let damaged = BootClaim::from_stored(ClaimRecord::Unreadable);
        for s in [never, damaged] {
            assert!(!s.claimable_over_network(), "{s:?} was claimable");
            assert!(!s.is_owner(), "{s:?} counted as owner");
            assert_eq!(may_claim(s), Err(ClaimRefusal::Indeterminate));
        }
        // They differ only in what they are REPORTED as. An unprovisioned
        // device is not faulty, and reporting it as damaged sends a
        // reader hunting storage trouble on a good unit.
        assert!(damaged.needs_reporting());
        assert!(!never.needs_reporting());
        assert_ne!(never, damaged);
    }

    #[test]
    fn claim_proceeds_only_from_open() {
        assert_eq!(
            may_claim(BootClaim::from_stored(ClaimRecord::Recorded(
                ClaimState::Open
            ))),
            Ok(())
        );
        assert_eq!(
            may_claim(BootClaim::from_stored(ClaimRecord::Recorded(
                ClaimState::Owner
            ))),
            Err(ClaimRefusal::AlreadyOwner)
        );
    }

    #[test]
    fn owner_record_reads_back_as_owner() {
        let boot = BootClaim::from_stored(ClaimRecord::Recorded(ClaimState::Owner));
        assert!(boot.is_owner());
        assert!(!boot.claimable_over_network());
    }

    /// **THE EXHAUSTIVE FIELD BINDING, MOVED IN HERE WHEN THE FIELDS WERE
    /// SEALED (2026-08-07) — AND IT IS WEAKER HERE, WHICH IS WHY THE MOVE
    /// IS RECORDED AT BOTH ENDS.**
    ///
    /// It used to live in `tests/holds_the_key_is_not_is_a_member.rs`,
    /// **compiled as a separate crate, so it was the consumer's view**.
    /// `pub(crate)` fields cannot be destructured from out there, so the
    /// check had to come inside or cease to exist. *An in-crate assertion
    /// about the crate's own shape is exactly what `01-terminology` 3.10
    /// says is not evidence a third party can check.*
    ///
    /// **Its job is unchanged: the binding is exhaustive — no `..` — so a
    /// field added to [`Persona`], a certificate among them, stops this
    /// compiling.** `Persona.member` is set from a minted keypair and
    /// nothing else, so the type that names a device a *member* records no
    /// evidence that it is one.
    #[test]
    fn persona_has_exactly_these_fields() {
        let p = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Open);
        let Persona {
            group,
            member,
            claim,
        } = p;
        assert_eq!(group, id(1));
        assert_eq!(member, id(2));
        assert_eq!(claim, ClaimState::Open);
    }

    /// ‼ **4.4.4: LEAVING SHALL NOT SET OPEN.** An OWNER that leaves is
    /// still an OWNER — *the departing hive enters a CLOSED group of one
    /// and remains unclaimable until physically reset.*
    #[test]
    fn leaving_carries_the_claim_state_and_cannot_set_open() {
        let owned = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Owner);
        let left = owned.leave(id(3), Minted::from_mint(id(4)));
        assert_eq!(left.claim(), ClaimState::Owner, "leaving set OPEN");
        // And a hive that was OPEN stays OPEN — the state is carried in
        // both directions rather than forced in one.
        let open = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Open);
        assert_eq!(
            open.leave(id(3), Minted::from_mint(id(4))).claim(),
            ClaimState::Open
        );
    }

    /// 4.3.4: a FRESH group of one — new group identity and a newly
    /// generated member keypair, so neither half of the old persona
    /// survives into the new one.
    #[test]
    fn leaving_enters_a_fresh_group_of_one() {
        let before = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Owner);
        let after = before.leave(id(3), Minted::from_mint(id(4)));
        assert_ne!(after.group(), before.group());
        assert_ne!(after.member(), before.member());
        assert_eq!(after.group(), id(3));
        assert_eq!(after.member(), id(4));
    }

    /// ‼ **5.1.3 AND 5.1.4's CONSTRUCTION HALF, ON THE ONE PATH THAT
    /// EXISTS.** *The identities of one hive's successive personas shall
    /// not be derivable from one another*, and on re-persona the member
    /// keypair, derived keys and beacon identifier are **generated
    /// afresh**.
    ///
    /// **The mechanism is that no field of the old persona is an INPUT to
    /// the new one except the claim state** — the new member comes from
    /// [`Minted`], which only the mint path can produce, so a successor
    /// identity cannot be a function of its predecessor. *Derivability is
    /// prevented by there being nothing to derive from, rather than by a
    /// derivation being avoided.*
    #[test]
    fn a_successor_persona_takes_nothing_from_its_predecessor_but_the_claim() {
        let old = Persona::group_of_one(id(9), Minted::from_mint(id(8)), ClaimState::Owner);
        let new = old.leave(id(3), Minted::from_mint(id(4)));
        // Every identity field is the supplied one, not a function of the old.
        assert_eq!(new.group(), id(3));
        assert_eq!(new.member(), id(4));
        assert_ne!(new.group(), old.group());
        assert_ne!(new.member(), old.member());
        // The claim is the single carried field, and 4.4.4 is why.
        assert_eq!(new.claim(), old.claim());
    }

    /// ‼ **WHAT THIS TEST IS AND IS NOT.** 4.4.4 is enforced by `leave`
    /// having **no `claim` parameter**, which is a property of the
    /// signature and not of any assertion below.
    ///
    /// *A `compile_fail` doctest was written here first and DELETED
    /// rather than kept*: doctests are collected only from **public**
    /// items, so one placed on a `cfg(test)` function **never runs** —
    /// it appeared in no test list and asserted nothing. **A control that
    /// cannot run is worse than none, because it reads as coverage.**
    ///
    /// **And it could not have been written from outside in any case**:
    /// `leave` takes a [`Minted`], which is not exported, so a consumer
    /// cannot call it at all. *That is `Minted`'s seal working — only the
    /// crate's own mint path can produce one — and it means a
    /// consumer-view demonstration of this signature is not constructible
    /// today.*
    #[test]
    fn leave_takes_no_claim_argument() {
        let p = Persona::group_of_one(id(1), Minted::from_mint(id(2)), ClaimState::Owner);
        assert_eq!(
            p.leave(id(3), Minted::from_mint(id(4))).claim(),
            ClaimState::Owner
        );
    }

    #[test]
    fn group_of_one_carries_its_own_group_identity() {
        // L5 4.3.4: leaving without joining is a fresh group, never an
        // ungrouped state — the type cannot express "no group".
        let g = Identity([9; IDENTITY_LEN]);
        let m = Identity([8; IDENTITY_LEN]);
        let p = Persona::group_of_one(g, Minted::from_mint(m), ClaimState::Open);
        assert_eq!(p.group, g);
        assert_ne!(p.group, p.member);
    }
}
