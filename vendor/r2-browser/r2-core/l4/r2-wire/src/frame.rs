//! Frame parsing, encoding, relay mutation, and the authenticated span
//! (L4 Clauses 4-6, 8-10).

/// Protocol version implemented by this crate (byte 0 bits 7-6). Also the
/// algorithm epoch (L4 13.3).
pub const VERSION: u8 = 0;

/// Compact fixed header length in bytes (L4 4.2.1).
pub const COMPACT_HEADER_LEN: usize = 12;
/// Extended fixed header length in bytes (L4 4.3.1).
pub const EXTENDED_HEADER_LEN: usize = 22;
/// Maximum route record entries (L4 8.2).
pub const ROUTE_MAX_ENTRIES: usize = 8;
/// Integrity tag length at the compact tier (L4 10.1.1).
pub const COMPACT_TAG_LEN: usize = 8;
/// Integrity tag length at the extended tier (L4 10.1.1).
pub const EXTENDED_TAG_LEN: usize = 32;
/// Replication budget sentinel meaning flooding (L4 4.1.2a).
pub const BUDGET_FLOODING: u8 = 15;

/// Wire tier (L4 Clause 4). Selected by the arrival bearer's declared tier
/// (9.1.1), never by frame bytes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tier {
    Compact,
    Extended,
}

impl Tier {
    #[must_use]
    pub const fn header_len(self) -> usize {
        match self {
            Tier::Compact => COMPACT_HEADER_LEN,
            Tier::Extended => EXTENDED_HEADER_LEN,
        }
    }

    #[must_use]
    pub const fn route_entry_len(self) -> usize {
        match self {
            Tier::Compact => 4,
            Tier::Extended => 8,
        }
    }

    #[must_use]
    pub const fn tag_len(self) -> usize {
        match self {
            Tier::Compact => COMPACT_TAG_LEN,
            Tier::Extended => EXTENDED_TAG_LEN,
        }
    }

    #[must_use]
    pub const fn msg_id_len(self) -> usize {
        match self {
            Tier::Compact => 2,
            Tier::Extended => 4,
        }
    }
}

/// Message type (L4 5.1). Values 1, 2, 6 and 7 are reserved; a frame carrying
/// one is silently discarded on receipt.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FrameType {
    Event = 0,
    Capability = 3,
    GroupMgmt = 4,
    Heartbeat = 5,
}

impl FrameType {
    pub const fn from_bits(bits: u8) -> Result<Self, ParseError> {
        match bits {
            0 => Ok(FrameType::Event),
            3 => Ok(FrameType::Capability),
            4 => Ok(FrameType::GroupMgmt),
            5 => Ok(FrameType::Heartbeat),
            _ => Err(ParseError::ReservedType),
        }
    }

    /// Types required to carry an origin as route entry zero (L4 8.1).
    /// A frame of such a type with no route record is dropped (8.3).
    #[must_use]
    pub const fn requires_origin(self) -> bool {
        !matches!(self, FrameType::GroupMgmt)
    }

    /// Whether this type's payload is an ordinary payload (L4 3.8, 11.1).
    ///
    /// GROUP_MGMT remains opaque at this layer and is the sole non-ordinary
    /// type. EVENT, CAPABILITY and HEARTBEAT payloads use the definite-length
    /// CBOR profile owned by the FORMATS crate.
    #[must_use]
    pub const fn has_ordinary_payload(self) -> bool {
        !matches!(self, FrameType::GroupMgmt)
    }
}

/// Byte-0 flag bits (L4 4.2.2 / 4.3.2, identical at both tiers).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Flags(u8);

impl Flags {
    const ROUTE_RECORD: u8 = 0b100;
    const INTEGRITY_TAG: u8 = 0b010;
    const CONSTRAINED_ORIGIN: u8 = 0b001;

    #[must_use]
    pub const fn from_bits(bits: u8) -> Self {
        Self(bits & 0b111)
    }

    #[must_use]
    pub const fn bits(self) -> u8 {
        self.0
    }

    #[must_use]
    pub const fn route_record(self) -> bool {
        self.0 & Self::ROUTE_RECORD != 0
    }

    #[must_use]
    pub const fn integrity_tag(self) -> bool {
        self.0 & Self::INTEGRITY_TAG != 0
    }

    #[must_use]
    pub const fn constrained_origin(self) -> bool {
        self.0 & Self::CONSTRAINED_ORIGIN != 0
    }
}

/// Frame target (L4 6.1): all hives, one group, or one hive — nothing
/// smaller is addressable on the wire.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    /// Compact 4-byte target: zero = broadcast, else the identifier hash of a
    /// group or a hive (receiver resolves the ambiguity, 6.1.2).
    Compact(u32),
    /// Extended 8-byte target: group half + hive half, zero = *any* (6.1.3).
    Extended { group: u32, hive: u32 },
}

impl Target {
    #[must_use]
    pub const fn tier(self) -> Tier {
        match self {
            Target::Compact(_) => Tier::Compact,
            Target::Extended { .. } => Tier::Extended,
        }
    }

    #[must_use]
    pub const fn is_broadcast(self) -> bool {
        match self {
            Target::Compact(t) => t == 0,
            Target::Extended { group, hive } => group == 0 && hive == 0,
        }
    }

    /// All-ones is reserved in both tiers and never assigned (6.1.4).
    #[must_use]
    pub const fn is_reserved(self) -> bool {
        match self {
            Target::Compact(t) => t == u32::MAX,
            Target::Extended { group, hive } => group == u32::MAX && hive == u32::MAX,
        }
    }
}

/// Route record view (L4 Clause 8): raw entry bytes, entry width per tier.
/// Entry zero is the origin — immutable and authenticated; the tail is an
/// unauthenticated breadcrumb.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RouteRecord<'a> {
    entry_len: usize,
    bytes: &'a [u8],
}

impl<'a> RouteRecord<'a> {
    #[must_use]
    pub fn count(&self) -> usize {
        self.bytes.len() / self.entry_len
    }

    #[must_use]
    pub fn entry(&self, i: usize) -> Option<&'a [u8]> {
        let start = i.checked_mul(self.entry_len)?;
        self.bytes.get(start..start + self.entry_len)
    }

    /// Route entry zero: the origin (L4 8.1).
    #[must_use]
    pub fn origin(&self) -> Option<&'a [u8]> {
        self.entry(0)
    }

    pub fn entries(&self) -> impl Iterator<Item = &'a [u8]> + '_ {
        self.bytes.chunks_exact(self.entry_len)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ParseError {
    /// Version bits not implemented: discard without parsing further (4.1.3).
    UnsupportedVersion,
    /// Reserved type value: silently discard (5.1).
    ReservedType,
    /// Frame shorter than its declared structure.
    Truncated,
    /// Route record count exceeds 8 or cannot fit (8.4): malformed.
    MalformedRouteRecord,
    /// Extended frame whose remaining length disagrees with its payload
    /// length field (4.3.3): malformed.
    LengthMismatch,
    /// A frame with no origin (route entry zero) where one is required for
    /// the operation — returned by [`Frame::authenticated_span`], never by
    /// parsing: an origin-less frame parses (TEST-VECTORS-L4 CV2/EV2), then
    /// 8.3 drops it as a separate step.
    MissingOrigin,
    /// L4 10.1.4 (L4-074a/b/c): a frame bearing an integrity tag shall
    /// carry a route record — a tagged route-less frame is malformed, and
    /// GROUP_MGMT never carries a tag at all.
    TagWithoutRoute,
}

/// A parsed frame, borrowing the receive buffer.
///
/// ‼ **Every field is private and read through a getter, because a parsed
/// frame is a PROOF.** `parse` establishes the invariants the rest of the
/// crate relies on — route entries at the tier's width, the message id
/// within the tier's width, the target variant matching both — and a
/// public field would let safe code overwrite any of them after the fact.
/// r2-codex-refute (2026-08-23) demonstrated two panics reachable that way
/// with `tier` already derived: an Extended parse with its 8-byte route
/// entries re-targeted to `Compact` (`cross_tier` copies into 4-byte
/// slots), and a compact broadcast given a 32-bit message id (the span
/// authenticates 16 of them). *The only way to hold a `Frame` is to have
/// parsed one.*
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Frame<'a> {
    frame_type: FrameType,
    flags: Flags,
    hop_limit: u8,
    /// Replication budget nibble; 15 denotes flooding (4.1.2a).
    budget: u8,
    /// Message identifier, zero-extended to 32 bits at the compact tier
    /// (9.2.2 defines that widening as value-preserving).
    msg_id: u32,
    event_hash: u32,
    target: Target,
    route: Option<RouteRecord<'a>>,
    payload: &'a [u8],
    tag: Option<&'a [u8]>,
}

impl<'a> Frame<'a> {
    #[must_use]
    pub const fn frame_type(&self) -> FrameType {
        self.frame_type
    }
    #[must_use]
    pub const fn flags(&self) -> Flags {
        self.flags
    }
    #[must_use]
    pub const fn hop_limit(&self) -> u8 {
        self.hop_limit
    }
    /// Replication budget nibble; 15 denotes flooding (4.1.2a).
    #[must_use]
    pub const fn budget(&self) -> u8 {
        self.budget
    }
    /// Message identifier, zero-extended to 32 bits at the compact tier.
    #[must_use]
    pub const fn msg_id(&self) -> u32 {
        self.msg_id
    }
    #[must_use]
    pub const fn event_hash(&self) -> u32 {
        self.event_hash
    }
    #[must_use]
    pub const fn target(&self) -> Target {
        self.target
    }
    #[must_use]
    pub const fn route(&self) -> Option<RouteRecord<'a>> {
        self.route
    }
    #[must_use]
    pub const fn payload(&self) -> &'a [u8] {
        self.payload
    }
    #[must_use]
    pub const fn tag(&self) -> Option<&'a [u8]> {
        self.tag
    }
}

impl<'a> Frame<'a> {
    /// The wire tier — **derived from the target, never stored beside it.**
    /// Until 2026-08-23 `tier` was a second public field, so a caller could
    /// hold `tier: Compact` with `target: Extended` and reach an
    /// `unreachable!` in `cross_tier` (r2-codex-refute). One source, no
    /// hybrid, and the panic arms are gone with the duplicate.
    #[must_use]
    pub const fn tier(&self) -> Tier {
        self.target.tier()
    }

    /// Parse at the tier the arrival bearer declares (9.1.1) — except
    /// GROUP_MGMT, which is compact on every bearer (9.1.2; safe because the
    /// type field sits at the same offset in both tiers).
    ///
    /// ‼ **AND THAT OFFSET-INVARIANCE IS LOAD-BEARING FOR AN AUTHENTICATION
    /// ARGUMENT, NOT ONLY FOR THE PARSE** (`hive`, 2026-08-15, extending
    /// the out-of-span sweep at [`Frame::authenticated_span`] one step
    /// wider). **The reinterpreting thing need not be a field in the
    /// frame**, and the tier is the obvious candidate — it sets the widths
    /// of `msg_id`, origin and target. *It is not reachable by an
    /// attacker*: the tier comes from the **bearer**, and nobody chooses
    /// which medium they were heard on.
    ///
    /// **This override is the one exception — a genuine data-driven
    /// reinterpretation of every subsequent width — and it is closed
    /// because it is driven by the TYPE VALUE, which is INSIDE the
    /// authenticated span** as the first field of the 10.2.1
    /// serialisation. *The override is authenticated, so the hole is not
    /// here.*
    ///
    /// ‼ **BUT THAT SAFETY RESTS ENTIRELY ON THE OFFSET BEING THE SAME.**
    /// A future tier that moved the type field would make this override
    /// **read a different byte to decide how to read the rest** — a wrong
    /// subject in the one place that currently makes the reinterpretation
    /// safe. *Cheap to say now and expensive to discover*, which is why it
    /// is written beside the override rather than in a sweep nobody
    /// re-reads.
    pub fn parse_on_bearer(bytes: &'a [u8], bearer_tier: Tier) -> Result<Self, ParseError> {
        let b0 = *bytes.first().ok_or(ParseError::Truncated)?;
        if b0 >> 6 != VERSION {
            return Err(ParseError::UnsupportedVersion);
        }
        let tier = match FrameType::from_bits((b0 >> 3) & 0x7) {
            Ok(FrameType::GroupMgmt) => Tier::Compact,
            _ => bearer_tier,
        };
        Self::parse(bytes, tier)
    }

    /// Parse at an explicitly known tier.
    ///
    /// **Two encode-side guards have no mirror here, deliberately.**
    /// [`FrameSpec::encode`] refuses a reserved event hash (7.1.3) and an
    /// all-ones target (6.1.4); parsing accepts both. Those clauses bind
    /// the *originator* and state no receiver obligation, so rejecting
    /// here would invent a rule — and inventing one risks dropping
    /// traffic a future epoch makes legitimate. Reported to the standard
    /// lane as unstated receiver behaviour rather than closed silently.
    ///
    /// This note lives at the parse site rather than only in a report so
    /// that whoever adds a receiver obligation finds the reasoning where
    /// they would change it.
    pub fn parse(bytes: &'a [u8], tier: Tier) -> Result<Self, ParseError> {
        let header_len = tier.header_len();
        if bytes.len() < header_len {
            return Err(ParseError::Truncated);
        }

        let b0 = bytes[0];
        if b0 >> 6 != VERSION {
            return Err(ParseError::UnsupportedVersion);
        }
        let frame_type = FrameType::from_bits((b0 >> 3) & 0x7)?;
        let flags = Flags::from_bits(b0);
        // L4 10.1.4: an integrity tag requires a route record, and
        // GROUP_MGMT is never tagged. A route record present-but-empty
        // (count 0) is not rejected here — that residue is STD-SS5's.
        if flags.integrity_tag() && (frame_type == FrameType::GroupMgmt || !flags.route_record()) {
            return Err(ParseError::TagWithoutRoute);
        }
        let hop_limit = bytes[1] >> 4;
        let budget = bytes[1] & 0x0F;

        let (msg_id, event_hash, declared_payload_len, target) = match tier {
            Tier::Compact => (
                u32::from(u16::from_be_bytes([bytes[2], bytes[3]])),
                be32(bytes, 4),
                None,
                Target::Compact(be32(bytes, 8)),
            ),
            Tier::Extended => (
                be32(bytes, 2),
                be32(bytes, 6),
                Some(be32(bytes, 10) as usize),
                Target::Extended {
                    group: be32(bytes, 14),
                    hive: be32(bytes, 18),
                },
            ),
        };

        let mut off = header_len;
        let route = if flags.route_record() {
            let count = *bytes.get(off).ok_or(ParseError::Truncated)? as usize;
            if count > ROUTE_MAX_ENTRIES {
                return Err(ParseError::MalformedRouteRecord);
            }
            let entries_len = count * tier.route_entry_len();
            let entries = bytes
                .get(off + 1..off + 1 + entries_len)
                .ok_or(ParseError::MalformedRouteRecord)?;
            off += 1 + entries_len;
            Some(RouteRecord {
                entry_len: tier.route_entry_len(),
                bytes: entries,
            })
        } else {
            None
        };

        // L4 10.1.4 (D-018): the span requires route entry zero, so a tagged
        // frame's route record carries count >= 1 — tagged count-0 is
        // malformed. (STD-SS5's residue is only the untagged 8.3 drop question.)
        if flags.integrity_tag() && route.is_some_and(|r| r.count() == 0) {
            return Err(ParseError::TagWithoutRoute);
        }

        let tag_len = if flags.integrity_tag() {
            tier.tag_len()
        } else {
            0
        };
        let remaining = bytes.len().checked_sub(off).ok_or(ParseError::Truncated)?;
        if remaining < tag_len {
            return Err(ParseError::Truncated);
        }
        let payload_len = remaining - tag_len;
        if let Some(declared) = declared_payload_len {
            // 4.3.3, reading the 4.3.1 layout literally: the length field
            // counts the payload region only (see docs/spec-map/L4-wire.md §7).
            if payload_len != declared {
                return Err(ParseError::LengthMismatch);
            }
        }
        let payload = &bytes[off..off + payload_len];
        let tag = flags
            .integrity_tag()
            .then(|| &bytes[off + payload_len..off + payload_len + tag_len]);

        Ok(Frame {
            frame_type,
            flags,
            hop_limit,
            budget,
            msg_id,
            event_hash,
            target,
            route,
            payload,
            tag,
        })
    }

    /// 8.3 (D-020 ruling): a frame of a type required to carry an origin,
    /// arriving with no route record **or a count-0 record** — both are
    /// origin-less — is dropped after parsing, and no origin is ever
    /// supplied on its behalf.
    #[must_use]
    pub fn lacks_required_origin(&self) -> bool {
        self.frame_type.requires_origin() && self.route.is_none_or(|r| r.count() == 0)
    }

    /// Serialise the authenticated span (10.2.1), in order: type value as one
    /// zero-padded byte; message identifier at tier-native width; origin
    /// (route entry zero) at tier-native width; event identifier hash;
    /// target; payload. Hop limit, budget, the route count byte, route
    /// entries after the first, and byte-0 version/flag bits are excluded
    /// (10.2.2, 10.2.3).
    ///
    /// # ‼ Which excluded field can change what a VERIFYING frame means
    ///
    /// `hive` asked (2026-08-15, `STD-SS374`) whether *a field outside the
    /// authenticated span deciding something inside the trust boundary* is
    /// a class with more than the two known members. **Measured here,
    /// against the exclusion list above as the denominator, and the answer
    /// narrows the class rather than widening it.**
    ///
    /// The discriminator is not *is the field forgeable* — every one of
    /// them is. It is: **can an attacker use it to produce a frame that
    /// still VERIFIES and asserts something they could not otherwise
    /// assert?** *Anything they could have sent themselves is not an
    /// escalation, and counting it as one inflates the class.*
    ///
    /// - **Route count byte — YES, and it is the only one.** Entry zero is
    ///   inside the span and the count is outside it, so rewriting the
    ///   count changes *what the in-span bytes mean* without touching
    ///   them. `hive`'s case: capture a genuine **relayed** frame, set the
    ///   count to 1, rebroadcast from your own medium address, **and the
    ///   tag still verifies** — the frame now asserts *the origin is the
    ///   immediate sender*, which the attacker cannot otherwise say.
    ///   Decided here by [`Frame::lacks_required_origin`] and by the
    ///   `count == 0` refusal in `parse`.
    /// - **`flags.integrity_tag()` — NO.** It decides whether a tag is
    ///   parsed at all, which looks worse and is not: clearing it yields a
    ///   frame that arrives **unauthenticated**, and *an attacker can
    ///   already send unauthenticated frames.* They gain a denial they
    ///   could equally have achieved by dropping the frame. **Stated as a
    ///   negative because it is the one a reader will reach for first.**
    /// - **`flags.route_record()` — NO.** Clearing it on a tagged frame is
    ///   refused at parse (10.1.4, `TagWithoutRoute`); setting it on an
    ///   untagged one produces something unauthenticated. No verifying
    ///   frame results either way.
    /// - **Hop limit and budget — NO, and they are outside the span BY
    ///   NECESSITY.** 5.2.1 obliges every relay to decrement one and 5.5.2
    ///   to halve the other, so *a span covering them could not survive a
    ///   single legitimate hop.* The corpus has already reasoned about
    ///   them in the right form — L3 10 Note 1: *the bounds that do not
    ///   depend on identity — hop limit, replication budget, payload size
    ///   — hold against an attacker who varies what they claim to be, are
    ///   deliberately crude, and are the reason a hive that believes
    ///   nothing it hears is still safe to run.*
    /// - **`flags.constrained_origin()` — NIL, WITH ITS DENOMINATOR.** 23
    ///   occurrences across this workspace and **not one is a branch**: it
    ///   is carried into `FrameSpec` and set in tests. *A nil is worth
    ///   nothing without the count that shows the scan had something to
    ///   look at.* ‼ **AND ONE OF THE 23 IS THIS SENTENCE.** It was
    ///   measured at 22, written down, and the writing made it 23 — *a
    ///   figure that rots at the instant of being recorded, because the
    ///   record is inside its own population.* Declared rather than
    ///   quietly corrected, which is the remedy `hive` used an hour
    ///   earlier for the same shape in a grep audit: **the explanation of
    ///   a count contains the string the count is of.**
    ///
    /// ‼ **SO THE CLASS HAS ONE MEMBER HERE, NOT TWO** — and `STD-SS85` is a
    /// **different mechanism** wearing the same description. There, origin
    /// and `msg_id` claim a dedup key *before* verification: the fields are
    /// **inside** the span and the defect is the **timing**. Here the
    /// field is **outside** the span and the defect is that it
    /// **reinterprets** bytes that are inside. *Pre-verification use of an
    /// authenticated field, and post-verification reinterpretation by an
    /// unauthenticated one, are not the same failure and a class holding
    /// both would not predict either.*
    pub fn authenticated_span(&self, sink: &mut dyn FnMut(&[u8])) -> Result<(), ParseError> {
        self.span(true, sink)
    }

    /// The **associated data of the payload AEAD** (FORMATS 4.3): the
    /// authenticated span *"excluding the payload itself"*, which binds
    /// the ciphertext to origin, identifier and target **without
    /// double-covering the payload** — the payload is already covered by
    /// the AEAD as plaintext.
    ///
    /// # Why this is not a second implementation of the span
    ///
    /// It is the **same** serialiser with the last field suppressed, and
    /// that is deliberate rather than tidy. *Two independent orderings of
    /// one span is exactly how a sign side and a verify side come to
    /// disagree while both look right* — this lane has already recorded
    /// the caller-supplied-span form of that defect twice tonight. A
    /// field added to [`authenticated_span`](Self::authenticated_span)
    /// therefore appears here **by construction**, not by somebody
    /// remembering, which is the same argument FORMATS Note 0 to 5.2
    /// makes about signing a map rather than a list of keys.
    ///
    /// Fallibility is identical and for the identical reason: the origin
    /// lookup is the only fallible step and it precedes every `sink`
    /// call, so this is all-or-nothing and **never emits a partial span**.
    pub fn aead_associated_data(&self, sink: &mut dyn FnMut(&[u8])) -> Result<(), ParseError> {
        self.span(false, sink)
    }

    fn span(&self, with_payload: bool, sink: &mut dyn FnMut(&[u8])) -> Result<(), ParseError> {
        let origin = self
            .route
            .and_then(|r| r.origin())
            .ok_or(ParseError::MissingOrigin)?;
        sink(&[self.frame_type as u8]);
        match self.target {
            // msg_id is zero-extended from 16 bits at the compact tier
            // (9.2.2), so the low half IS the value.
            Target::Compact(_) => sink(&self.msg_id.to_be_bytes()[2..]),
            Target::Extended { .. } => sink(&self.msg_id.to_be_bytes()),
        }
        sink(origin);
        sink(&self.event_hash.to_be_bytes());
        match self.target {
            Target::Compact(t) => sink(&t.to_be_bytes()),
            Target::Extended { group, hive } => {
                sink(&group.to_be_bytes());
                sink(&hive.to_be_bytes());
            }
        }
        if with_payload {
            sink(self.payload);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EncodeError {
    BufferTooSmall,
    /// Hop limit or budget outside its nibble.
    NibbleOverflow,
    /// Compact message identifier wider than 16 bits (cf. 9.2.2: such a
    /// frame does not cross to the compact tier).
    MsgIdOverflow,
    /// Route bytes not a whole number of entries, or more than 8 entries.
    MalformedRouteRecord,
    /// Tag length wrong for the tier (10.1.1).
    BadTagLen,
    /// GROUP_MGMT is compact on every bearer (5.3, 9.1.2).
    GroupMgmtNotCompact,
    /// All-ones target is reserved and never assigned (6.1.4).
    ReservedTarget,
    /// Event hash violates 7.1.3: 0xFFFFFFFF is never used, and HEARTBEAT /
    /// GROUP_MGMT carry the *no event* value zero.
    BadEventHash,
    /// STD-SS31 (ruled normative 2026-08-01): the integrity flag requires the
    /// route flag for origin-requiring types, and GROUP_MGMT is never
    /// tagged — its authenticity is wholly Layer 5's.
    TagWithoutOrigin,
    /// A type requiring an origin (8.1) was given no route entries.
    MissingOrigin,
}

/// Description of a frame to encode. The tier follows the target variant.
///
/// ## On `tag: Option<_>` and optionality polarity
///
/// The polarity test asks what the *absent* value means. Here it means an
/// **unauthenticated frame**, which L5 10.1.1 names as a level of the
/// ladder and 10.1.2 delivers as such — not a skipped check. That is the
/// difference from the case the test was coined for, where absence meant
/// *unverified* with no defined meaning and no signal: a receiver marks
/// this one [`Delivery::Unauthenticated`](../../r2_trust/gate/enum.Delivery.html),
/// and L5 7.2.3 already requires evidence beyond the gate for anything
/// consequential. So the type is not inverted and the field stays: this
/// is a hot-path zero-copy builder, and the absent case is normative
/// rather than exceptional.
///
/// What the plain `Option` *cannot* do is tell a reviewer a `None` was
/// deliberate. Use [`FrameSpec::unauthenticated`] and
/// [`FrameSpec::tagged`] to say which at the call site, so intent is
/// greppable — raised by the hive lane, whose bring-up traffic is
/// legitimately untagged and was indistinguishable from an oversight.
/// `route` is raw entry bytes at the tier's entry width; `tag` is appended
/// verbatim (computed by the caller over [`Frame::authenticated_span`] —
/// keys are Layer 5's, L4 10.3.1).
#[derive(Clone, Copy, Debug)]
pub struct FrameSpec<'a> {
    pub frame_type: FrameType,
    pub constrained_origin: bool,
    pub hop_limit: u8,
    pub budget: u8,
    pub msg_id: u32,
    pub event_hash: u32,
    pub target: Target,
    pub route: Option<&'a [u8]>,
    pub payload: &'a [u8],
    pub tag: Option<&'a [u8]>,
}

impl<'a> FrameSpec<'a> {
    /// Mark this frame as deliberately unauthenticated (L5 10.1.1's
    /// unauthenticated level). Equivalent to `tag: None`, but says so.
    #[must_use]
    pub fn unauthenticated(mut self) -> Self {
        self.tag = None;
        self
    }

    /// Attach an integrity tag (L4 10.1.1). Equivalent to `tag: Some(t)`,
    /// but pairs with [`FrameSpec::unauthenticated`] so a reader sees
    /// which was intended.
    #[must_use]
    pub fn tagged(mut self, tag: &'a [u8]) -> Self {
        self.tag = Some(tag);
        self
    }

    pub fn encode(&self, out: &mut [u8]) -> Result<usize, EncodeError> {
        let tier = self.target.tier();
        if self.frame_type == FrameType::GroupMgmt && tier != Tier::Compact {
            return Err(EncodeError::GroupMgmtNotCompact);
        }
        if self.target.is_reserved() {
            return Err(EncodeError::ReservedTarget);
        }
        // 7.1.3: 0xFFFFFFFF is never used; HEARTBEAT and GROUP_MGMT carry
        // the *no event* value zero (originator obligation, L4-036/L4-037).
        if self.event_hash == u32::MAX
            || (matches!(self.frame_type, FrameType::Heartbeat | FrameType::GroupMgmt)
                && self.event_hash != 0)
        {
            return Err(EncodeError::BadEventHash);
        }
        if self.hop_limit > 0xF || self.budget > 0xF {
            return Err(EncodeError::NibbleOverflow);
        }
        if tier == Tier::Compact && self.msg_id > u32::from(u16::MAX) {
            return Err(EncodeError::MsgIdOverflow);
        }
        if let Some(route) = self.route {
            let entry_len = tier.route_entry_len();
            if route.len() % entry_len != 0 || route.len() / entry_len > ROUTE_MAX_ENTRIES {
                return Err(EncodeError::MalformedRouteRecord);
            }
        }
        if let Some(tag) = self.tag {
            if tag.len() != tier.tag_len() {
                return Err(EncodeError::BadTagLen);
            }
        }
        if self.frame_type.requires_origin() && self.route.is_none_or(|r| r.is_empty()) {
            return Err(EncodeError::MissingOrigin);
        }
        // STD-SS31 ruling: a tag needs a route record (the origin is inside the
        // span), and GROUP_MGMT is never tagged.
        if self.tag.is_some() && (self.frame_type == FrameType::GroupMgmt || self.route.is_none()) {
            return Err(EncodeError::TagWithoutOrigin);
        }

        let route_len = self.route.map_or(0, |r| 1 + r.len());
        let tag_len = self.tag.map_or(0, |t| t.len());
        let total = tier.header_len() + route_len + self.payload.len() + tag_len;
        if out.len() < total {
            return Err(EncodeError::BufferTooSmall);
        }

        let mut flags = 0u8;
        if self.route.is_some() {
            flags |= Flags::ROUTE_RECORD;
        }
        if self.tag.is_some() {
            flags |= Flags::INTEGRITY_TAG;
        }
        if self.constrained_origin {
            flags |= Flags::CONSTRAINED_ORIGIN;
        }
        out[0] = (VERSION << 6) | ((self.frame_type as u8) << 3) | flags;
        out[1] = (self.hop_limit << 4) | self.budget;

        let mut off = match self.target {
            Target::Compact(t) => {
                out[2..4].copy_from_slice(&self.msg_id.to_be_bytes()[2..]);
                out[4..8].copy_from_slice(&self.event_hash.to_be_bytes());
                out[8..12].copy_from_slice(&t.to_be_bytes());
                12
            }
            Target::Extended { group, hive } => {
                let payload_len =
                    u32::try_from(self.payload.len()).map_err(|_| EncodeError::BufferTooSmall)?;
                out[2..6].copy_from_slice(&self.msg_id.to_be_bytes());
                out[6..10].copy_from_slice(&self.event_hash.to_be_bytes());
                out[10..14].copy_from_slice(&payload_len.to_be_bytes());
                out[14..18].copy_from_slice(&group.to_be_bytes());
                out[18..22].copy_from_slice(&hive.to_be_bytes());
                22
            }
        };

        if let Some(route) = self.route {
            // ROUTE_MAX_ENTRIES bounds the count well under u8::MAX; the
            // conversion is stated rather than cast.
            out[off] = u8::try_from(route.len() / tier.route_entry_len())
                .map_err(|_| EncodeError::BufferTooSmall)?;
            out[off + 1..off + 1 + route.len()].copy_from_slice(route);
            off += 1 + route.len();
        }
        out[off..off + self.payload.len()].copy_from_slice(self.payload);
        off += self.payload.len();
        if let Some(tag) = self.tag {
            out[off..off + tag.len()].copy_from_slice(tag);
            off += tag.len();
        }
        Ok(off)
    }
}

/// Why a frame may not cross a tier boundary (L4 9.2, incl. 9.2.5 /
/// L4-076a-d from the STD-SS6 ruling).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CrossError {
    /// 9.2.3: a frame bearing an integrity tag never crosses.
    Tagged,
    /// 9.1.2: GROUP_MGMT is compact on every bearer — crossing is
    /// meaningless for it.
    GroupMgmt,
    /// 9.2.2: an extended identifier wider than 16 bits does not cross.
    MsgIdOverflow,
    /// 9.2.5 (L4-076a): extended target with both halves nonzero cannot be
    /// expressed compactly.
    TargetAmbiguous,
    /// 9.2.5 (L4-076c): a non-broadcast compact target does not cross to
    /// extended — which half it names is unknowable.
    TargetNotBroadcast,
    /// 9.2.5 (L4-076d): a route entry with a nonzero group half cannot
    /// narrow.
    RouteEntryGroupNonzero,
    /// 9.2.5 (L4-076): the route record cannot re-encode at the
    /// destination tier.
    CannotReencode,
    BufferTooSmall,
}

/// Re-encode an unsigned frame at the opposite tier (L4 9.2), preserving
/// every field's value (9.2.1). Broadcast crosses freely both ways;
/// everything 9.2.5 names refuses. Returns the new frame's length in `out`.
pub fn cross_tier(frame: &Frame<'_>, out: &mut [u8]) -> Result<usize, CrossError> {
    if frame.tag.is_some() {
        return Err(CrossError::Tagged);
    }
    if frame.frame_type == FrameType::GroupMgmt {
        return Err(CrossError::GroupMgmt);
    }

    let mut route_buf = [0u8; 8 * ROUTE_MAX_ENTRIES];
    let (target, route_len) = match frame.target {
        Target::Compact(t) => {
            if t != 0 {
                return Err(CrossError::TargetNotBroadcast);
            }
            // 9.2.4: widen entries by LOW-side zero-extension.
            let mut len = 0;
            if let Some(route) = &frame.route {
                for entry in route.entries() {
                    route_buf[len + 4..len + 8].copy_from_slice(entry);
                    len += 8;
                }
            }
            (Target::Extended { group: 0, hive: 0 }, len)
        }
        Target::Extended { group, hive } => {
            if frame.msg_id > u32::from(u16::MAX) {
                return Err(CrossError::MsgIdOverflow);
            }
            let t = match (group != 0, hive != 0) {
                (false, false) => 0,
                (true, false) => group,
                (false, true) => hive,
                (true, true) => return Err(CrossError::TargetAmbiguous),
            };
            // Narrow entries: the group half must be zero (L4-076d).
            let mut len = 0;
            if let Some(route) = &frame.route {
                for entry in route.entries() {
                    if entry[..4] != [0; 4] {
                        return Err(CrossError::RouteEntryGroupNonzero);
                    }
                    route_buf[len..len + 4].copy_from_slice(&entry[4..8]);
                    len += 4;
                }
            }
            (Target::Compact(t), len)
        }
    };

    let spec = FrameSpec {
        frame_type: frame.frame_type,
        constrained_origin: frame.flags.constrained_origin(),
        hop_limit: frame.hop_limit,
        budget: frame.budget,
        msg_id: frame.msg_id,
        event_hash: frame.event_hash,
        target,
        route: frame.route.is_some().then_some(&route_buf[..route_len]),
        payload: frame.payload,
        tag: None,
    };
    spec.encode(out).map_err(|e| match e {
        EncodeError::BufferTooSmall => CrossError::BufferTooSmall,
        _ => CrossError::CannotReencode,
    })
}

/// Relay mutation (L4 4.4.1): decrement the hop limit in place. Returns the
/// new value, or `None` where the frame is too short or already at zero.
pub fn decrement_hop_limit(frame: &mut [u8]) -> Option<u8> {
    let b = frame.get_mut(1)?;
    let hop = *b >> 4;
    let new = hop.checked_sub(1)?;
    *b = (new << 4) | (*b & 0x0F);
    Some(new)
}

/// Relay mutation (L4 4.4.1, L3 5.5): set the replication budget nibble in
/// place. The flooding sentinel 15 is forwarded unchanged (4.1.2a) — callers
/// must not rewrite it.
pub fn set_budget(frame: &mut [u8], budget: u8) -> Result<(), EncodeError> {
    if budget > 0xF {
        return Err(EncodeError::NibbleOverflow);
    }
    let b = frame.get_mut(1).ok_or(EncodeError::BufferTooSmall)?;
    *b = (*b & 0xF0) | budget;
    Ok(())
}

/// **L4 8.2: each relay shall append its identity to the route record, to a
/// maximum of eight entries — and A RELAY FINDING THE RECORD FULL SHALL
/// FORWARD WITHOUT APPENDING.**
///
/// ‼ **A FULL RECORD IS NOT AN ERROR AND MUST NOT BE ONE.** The clause says
/// *forward without appending*, so a `Result::Err` here would make a relay
/// drop a frame the standard requires it to carry. The outcome is reported
/// as [`Appended`] instead, and **both variants are a frame the caller must
/// send** — *the distinction is for a diagnostic, never for a decision to
/// forward.*
///
/// ‼ **THIS PRIMITIVE DID NOT EXIST UNTIL 2026-08-14, WHICH IS WHY THE
/// 8-ENTRY CAP HAD NOTHING TO ENFORCE AGAINST** (`L4-042`). `hive` measured
/// the complete set of in-place frame mutators in this crate — `encode`,
/// `cross_tier`, `decrement_hop_limit`, `set_budget` — and **there was no
/// append among them**, so the row read as *the caller is elsewhere* when
/// the truth was that **nobody could call it because nothing offered it.**
///
/// The frame grows, so this writes into `out` rather than mutating in
/// place. 8.5: the count byte is **outside** the authenticated span and the
/// first entry stays **inside** it, so appending never disturbs a tag —
/// *entries are added at the END of the record, and entry zero is never
/// moved.*
pub fn append_route_entry(
    frame: &[u8],
    entry: &[u8],
    tier: Tier,
    out: &mut [u8],
) -> Result<(usize, Appended), EncodeError> {
    let header = tier.header_len();
    let width = tier.route_entry_len();
    if entry.len() != width {
        return Err(EncodeError::MalformedRouteRecord);
    }
    // ‼ THE FLAGS ARE IN BYTE 0 WITH THE VERSION AND TYPE, not a byte of
    // their own — read through `Flags::from_bits` rather than by index, so
    // this cannot drift from `parse`.
    let flags = Flags::from_bits(*frame.first().ok_or(EncodeError::BufferTooSmall)?);
    if !flags.route_record() {
        return Err(EncodeError::MalformedRouteRecord);
    }
    let count = usize::from(*frame.get(header).ok_or(EncodeError::BufferTooSmall)?);
    if count > ROUTE_MAX_ENTRIES {
        return Err(EncodeError::MalformedRouteRecord);
    }
    // 8.2: full is a forward-unchanged, never a refusal.
    if count == ROUTE_MAX_ENTRIES {
        if out.len() < frame.len() {
            return Err(EncodeError::BufferTooSmall);
        }
        out[..frame.len()].copy_from_slice(frame);
        return Ok((frame.len(), Appended::RecordFull));
    }
    let insert = header + 1 + count * width;
    if frame.len() < insert || out.len() < frame.len() + width {
        return Err(EncodeError::BufferTooSmall);
    }
    out[..insert].copy_from_slice(&frame[..insert]);
    out[header] = u8::try_from(count + 1).map_err(|_| EncodeError::MalformedRouteRecord)?;
    out[insert..insert + width].copy_from_slice(entry);
    let rest = frame.len() - insert;
    out[insert + width..insert + width + rest].copy_from_slice(&frame[insert..]);
    Ok((frame.len() + width, Appended::Yes))
}

/// Whether [`append_route_entry`] added an entry.
///
/// ‼ **BOTH VARIANTS ARE A FRAME TO FORWARD** (8.2). This exists so a relay
/// can *report* that it left no trace, **not so it can decide whether to
/// send.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Appended {
    /// The identity was appended and the count byte incremented.
    Yes,
    /// The record already held eight entries, so the frame is forwarded
    /// **unchanged** — which is what 8.2 requires.
    RecordFull,
}

fn be32(bytes: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]])
}

#[cfg(test)]
mod tests {
    /// ‼ A `Frame` can only come from `parse`: the fields are private, so
    /// the two forgeries r2-codex-refute demonstrated against public fields
    /// — an Extended parse re-targeted to Compact with 8-byte route entries,
    /// a compact broadcast given a 32-bit message id — are not expressible
    /// in safe code. This test is the positive half: a parsed compact frame
    /// reports through getters exactly what the bytes said, and a compact
    /// wire message id is by construction at most 16 bits.
    #[test]
    fn a_parsed_frame_is_read_only_and_its_compact_msg_id_fits_sixteen_bits() {
        let mut buf = [0u8; 64];
        let spec = FrameSpec {
            msg_id: 0x3EEF,
            target: Target::Compact(0),
            ..compact_spec(b"hi", None)
        };
        let n = spec.encode(&mut buf).unwrap();
        let f = Frame::parse(&buf[..n], Tier::Compact).unwrap();
        assert_eq!(f.msg_id(), 0x3EEF);
        assert!(f.msg_id() <= u32::from(u16::MAX));
        assert_eq!(f.payload(), b"hi");
        assert_eq!(f.tier(), Tier::Compact);
    }

    use super::*;

    extern crate std;
    use std::vec::Vec;

    const ORIGIN_C: [u8; 4] = [0xAA, 0xBB, 0xCC, 0xDD];
    const ORIGIN_E: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

    fn compact_spec<'a>(payload: &'a [u8], tag: Option<&'a [u8]>) -> FrameSpec<'a> {
        FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: false,
            hop_limit: 5,
            budget: 4,
            msg_id: 0x1234,
            event_hash: 0xDEAD_BEEF,
            target: Target::Compact(0x0BAD_CAFE),
            route: Some(&ORIGIN_C),
            payload,
            tag,
        }
    }

    #[test]
    fn compact_roundtrip() {
        let tag = [9u8; COMPACT_TAG_LEN];
        let mut buf = [0u8; 64];
        let spec = compact_spec(b"hi", Some(&tag));
        let len = spec.encode(&mut buf).unwrap();
        assert_eq!(len, 12 + 1 + 4 + 2 + 8);

        let f = Frame::parse(&buf[..len], Tier::Compact).unwrap();
        assert_eq!(f.frame_type, FrameType::Event);
        assert_eq!(f.hop_limit, 5);
        assert_eq!(f.budget, 4);
        assert_eq!(f.msg_id, 0x1234);
        assert_eq!(f.event_hash, 0xDEAD_BEEF);
        assert_eq!(f.target, Target::Compact(0x0BAD_CAFE));
        assert_eq!(f.route.unwrap().origin().unwrap(), &ORIGIN_C);
        assert_eq!(f.payload, b"hi");
        assert_eq!(f.tag.unwrap(), &tag);
    }

    #[test]
    fn extended_roundtrip_and_length_check() {
        let tag = [7u8; EXTENDED_TAG_LEN];
        let mut buf = [0u8; 128];
        let spec = FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: true,
            hop_limit: 15,
            budget: BUDGET_FLOODING,
            msg_id: 0x8000_0001,
            event_hash: 1,
            target: Target::Extended {
                group: 0x11111111,
                hive: 0,
            },
            route: Some(&ORIGIN_E),
            payload: b"payload",
            tag: Some(&tag),
        };
        let len = spec.encode(&mut buf).unwrap();
        let f = Frame::parse(&buf[..len], Tier::Extended).unwrap();
        assert_eq!(f.msg_id, 0x8000_0001);
        assert!(f.flags.constrained_origin());
        assert_eq!(f.payload, b"payload");
        assert_eq!(f.tag.unwrap().len(), EXTENDED_TAG_LEN);

        // 4.3.3: mutate the payload length field; parse must reject.
        buf[13] ^= 1;
        assert_eq!(
            Frame::parse(&buf[..len], Tier::Extended),
            Err(ParseError::LengthMismatch)
        );
    }

    #[test]
    fn group_mgmt_parses_compact_on_extended_bearer() {
        let mut buf = [0u8; 64];
        let spec = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            constrained_origin: false,
            hop_limit: 1,
            budget: 0,
            msg_id: 1,
            event_hash: 0, // no event: mandatory for GROUP_MGMT (7.1.3)
            target: Target::Compact(0x22222222),
            route: None,
            payload: b"opaque-to-l4",
            tag: None,
        };
        let len = spec.encode(&mut buf).unwrap();
        let f = Frame::parse_on_bearer(&buf[..len], Tier::Extended).unwrap();
        assert_eq!(f.tier(), Tier::Compact);
        assert_eq!(f.frame_type, FrameType::GroupMgmt);
        assert_eq!(f.payload, b"opaque-to-l4");
    }

    #[test]
    fn rejects_bad_frames() {
        let mut buf = [0u8; 64];
        let len = compact_spec(b"x", None).encode(&mut buf).unwrap();

        // 4.1.3: unimplemented version discarded without parsing further.
        let mut v = buf;
        v[0] |= 0b0100_0000;
        assert_eq!(
            Frame::parse(&v[..len], Tier::Compact),
            Err(ParseError::UnsupportedVersion)
        );

        // 5.1: every reserved type, including the retired REPLY value 2,
        // is silently discarded.
        for reserved in [1, 2, 6, 7] {
            let mut t = buf;
            t[0] = (t[0] & !0b0011_1000) | (reserved << 3);
            assert_eq!(
                Frame::parse(&t[..len], Tier::Compact),
                Err(ParseError::ReservedType),
                "reserved type {reserved} was accepted"
            );
        }

        // 8.4: route count above 8 is malformed.
        let mut r = buf;
        r[12] = 9;
        assert_eq!(
            Frame::parse(&r[..len], Tier::Compact),
            Err(ParseError::MalformedRouteRecord)
        );

        // 8.3: origin-requiring type without a route record is dropped.
        let spec = FrameSpec {
            route: None,
            ..compact_spec(b"x", None)
        };
        assert_eq!(spec.encode(&mut buf), Err(EncodeError::MissingOrigin));
    }

    #[test]
    fn prohibited_event_hashes_refused_on_encode() {
        let mut buf = [0u8; 64];
        // 7.1.3: HEARTBEAT with a nonzero event hash never leaves an origin.
        let hb = FrameSpec {
            frame_type: FrameType::Heartbeat,
            event_hash: 1,
            ..compact_spec(b"", None)
        };
        assert_eq!(hb.encode(&mut buf), Err(EncodeError::BadEventHash));
        // 7.1.3: GROUP_MGMT likewise carries the no-event value only.
        let gm = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            event_hash: 1,
            route: None,
            ..compact_spec(b"", None)
        };
        assert_eq!(gm.encode(&mut buf), Err(EncodeError::BadEventHash));
        // 7.1.3: 0xFFFFFFFF is never used, any type.
        let ff = FrameSpec {
            event_hash: u32::MAX,
            ..compact_spec(b"", None)
        };
        assert_eq!(ff.encode(&mut buf), Err(EncodeError::BadEventHash));
        // The mandatory zero forms still encode.
        let ok = FrameSpec {
            frame_type: FrameType::Heartbeat,
            event_hash: 0,
            ..compact_spec(b"", None)
        };
        assert!(ok.encode(&mut buf).is_ok());
    }

    #[test]
    fn only_group_management_has_an_opaque_payload() {
        assert!(FrameType::Event.has_ordinary_payload());
        assert!(FrameType::Capability.has_ordinary_payload());
        assert!(FrameType::Heartbeat.has_ordinary_payload());
        assert!(!FrameType::GroupMgmt.has_ordinary_payload());
    }

    #[test]
    fn std_ss31_tag_requires_route_and_group_mgmt_never_tagged() {
        let mut buf = [0u8; 64];
        let tag = [9u8; COMPACT_TAG_LEN];
        // GROUP_MGMT tagged: refused.
        let gm = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            event_hash: 0,
            route: None,
            tag: Some(&tag),
            ..compact_spec(b"", None)
        };
        assert_eq!(gm.encode(&mut buf), Err(EncodeError::TagWithoutOrigin));
        // Untagged GROUP_MGMT still encodes.
        let gm_plain = FrameSpec { tag: None, ..gm };
        assert!(gm_plain.encode(&mut buf).is_ok());

        // ‼ THE CASE THAT SEPARATES THE TWO CLAUSES (L4-074c, added 2026-09-04 after an
        //   adversarial pass). The refusal above is produced by EITHER clause of the guard,
        //   because that fixture carries no route record — so deleting `frame_type ==
        //   GroupMgmt` left this test GREEN and a tagged GROUP_MGMT *with* a route record
        //   would have encoded with nothing watching. Measured. A tagged GROUP_MGMT that
        //   DOES carry a route record must still be refused, and the paired EVENT proves
        //   the refusal is attributable to the TYPE rather than to the route record.
        let gm_routed = FrameSpec {
            route: Some(&ORIGIN_C),
            tag: Some(&tag),
            ..gm
        };
        assert_eq!(
            gm_routed.encode(&mut buf),
            Err(EncodeError::TagWithoutOrigin),
            "a tagged GROUP_MGMT is refused for its TYPE, route record or not (10.1.4)"
        );
        let event_routed = FrameSpec {
            frame_type: FrameType::Event,
            ..gm_routed
        };
        assert!(
            event_routed.encode(&mut buf).is_ok(),
            "the control: the same tag and the same route record encode as an EVENT, so \
             the refusal above cannot be blamed on either of them"
        );
    }

    #[test]
    fn l4_10_1_4_tagged_routeless_frames_malformed_on_parse() {
        // EVENT, integrity flag set, route flag clear (byte 0 = 0x02):
        // malformed per L4-074b.
        let tagged_routeless = [&[0x02u8, 0x56, 0x12, 0x34][..], &[0u8; 8], &[9u8; 8]].concat();
        assert_eq!(
            Frame::parse(&tagged_routeless, Tier::Compact),
            Err(ParseError::TagWithoutRoute)
        );
        // GROUP_MGMT with integrity flag (byte 0 = 0x22): never tagged
        // (L4-074c) — rejected before structure is read.
        let tagged_gm = [&[0x22u8, 0x56, 0x20, 0x01][..], &[0u8; 8], &[9u8; 8]].concat();
        assert_eq!(
            Frame::parse_on_bearer(&tagged_gm, Tier::Extended),
            Err(ParseError::TagWithoutRoute)
        );
        // Tagged with route flag set but count 0: tag uncomputable without
        // entry zero — malformed (L4 10.1.4, standard D-018).
        let tagged_count0 = [
            &[0x06u8, 0x56, 0x12, 0x34][..],
            &[0u8; 8],
            &[0u8],
            &[9u8; 8],
        ]
        .concat();
        assert_eq!(
            Frame::parse(&tagged_count0, Tier::Compact),
            Err(ParseError::TagWithoutRoute)
        );
        // Route flag + tag together still parse (CV1 shape).
        let mut ok_buf = [0u8; 64];
        let tag = [9u8; COMPACT_TAG_LEN];
        let len = compact_spec(b"x", Some(&tag)).encode(&mut ok_buf).unwrap();
        assert!(Frame::parse(&ok_buf[..len], Tier::Compact).is_ok());
    }

    #[test]
    fn intent_is_greppable_without_changing_the_hot_path() {
        // Both builders produce exactly what the plain field produces —
        // they exist so a reviewer can tell a deliberate unauthenticated
        // frame from a forgotten tag.
        let tag = [9u8; COMPACT_TAG_LEN];
        let mut a = [0u8; 64];
        let mut b = [0u8; 64];
        let na = compact_spec(b"x", Some(&tag)).encode(&mut a).unwrap();
        let nb = compact_spec(b"x", None)
            .tagged(&tag)
            .encode(&mut b)
            .unwrap();
        assert_eq!(a[..na], b[..nb]);

        let mut c = [0u8; 64];
        let mut d = [0u8; 64];
        let nc = compact_spec(b"x", None).encode(&mut c).unwrap();
        let nd = compact_spec(b"x", Some(&tag))
            .unauthenticated()
            .encode(&mut d)
            .unwrap();
        assert_eq!(c[..nc], d[..nd]);
    }

    #[test]
    fn reserved_target_refused_on_encode() {
        let mut buf = [0u8; 64];
        let spec = FrameSpec {
            target: Target::Compact(u32::MAX),
            ..compact_spec(b"", None)
        };
        assert_eq!(spec.encode(&mut buf), Err(EncodeError::ReservedTarget));
    }

    /// ‼ **THE EXTENDED HALF OF THE ALL-ONES REFUSAL, WHICH WAS UNTESTED**
    /// (`L4-029`). The compact case above has been asserted since the
    /// arm was written; the extended target has **two** fields and
    /// all-ones means both, so a check that tested only one would pass on
    /// a half-reserved value.
    /// ‼ **8.2, THE PRIMITIVE THAT DID NOT EXIST** (`L4-042`). A relay
    /// appends its identity and the count byte increments.
    #[test]
    fn appending_adds_the_entry_and_increments_the_count() {
        let mut buf = [0u8; 96];
        let n = compact_spec(b"p", None).encode(&mut buf).expect("encodes");
        let mut out = [0u8; 96];
        let (m, r) =
            append_route_entry(&buf[..n], &[9, 9, 9, 9], Tier::Compact, &mut out).expect("appends");
        assert_eq!(r, Appended::Yes);
        assert_eq!(m, n + 4);
        let header = Tier::Compact.header_len();
        assert_eq!(out[header], 2, "count byte did not increment");
        // ‼ 8.5: entry ZERO is inside the authenticated span and must not
        // move. The new entry goes at the END of the record.
        assert_eq!(&out[header + 1..header + 5], &ORIGIN_C, "entry zero moved");
        assert_eq!(&out[header + 5..header + 9], &[9, 9, 9, 9]);
    }

    /// ‼ **A FULL RECORD IS FORWARDED UNCHANGED, NOT REFUSED** — *8.2 says
    /// a relay finding the record full shall forward without appending*, so
    /// an `Err` here would drop a frame the standard requires it to carry.
    #[test]
    fn a_full_record_forwards_unchanged_rather_than_erroring() {
        let mut buf = [0u8; 128];
        let full: [u8; 32] = [7; 32]; // eight compact entries
        let spec = FrameSpec {
            route: Some(&full),
            ..compact_spec(b"p", None)
        };
        let n = spec.encode(&mut buf).expect("encodes");
        let header = Tier::Compact.header_len();
        assert_eq!(buf[header], 8, "fixture is not a full record");

        let mut out = [0u8; 128];
        let (m, r) = append_route_entry(&buf[..n], &[1, 2, 3, 4], Tier::Compact, &mut out)
            .expect("full is not an error");
        assert_eq!(r, Appended::RecordFull);
        assert_eq!(m, n, "the frame changed length");
        assert_eq!(&out[..m], &buf[..n], "the frame was modified");
    }

    /// The entry width is the tier's (8.4): four bytes compact, eight
    /// extended. A wrong-width entry is malformed rather than silently
    /// truncated.
    #[test]
    fn an_entry_of_the_wrong_width_is_refused() {
        let mut buf = [0u8; 96];
        let n = compact_spec(b"p", None).encode(&mut buf).expect("encodes");
        let mut out = [0u8; 96];
        assert_eq!(
            append_route_entry(
                &buf[..n],
                &[1, 2, 3, 4, 5, 6, 7, 8],
                Tier::Compact,
                &mut out
            ),
            Err(EncodeError::MalformedRouteRecord),
        );
    }

    /// `D-251`: an identifier's high bit is ordinary entropy. Reply is a
    /// sentant helper which fills an EVENT target; no L4 category or return
    /// path may be inferred from either bit pattern.
    #[test]
    fn message_identifier_high_bit_has_no_reply_semantics() {
        let mut buf = [0u8; 96];
        let compact = FrameSpec {
            msg_id: 0x9234,
            ..compact_spec(b"", None)
        };
        assert!(compact.encode(&mut buf).is_ok(), "compact high bit encodes");

        let extended = FrameSpec {
            msg_id: 0x8000_1234,
            target: Target::Extended { group: 1, hive: 2 },
            route: Some(&ORIGIN_E),
            ..compact_spec(b"", None)
        };
        assert!(
            extended.encode(&mut buf).is_ok(),
            "extended high bit encodes without a reply category"
        );
    }

    #[test]
    fn reserved_target_refused_on_encode_extended_too() {
        let mut buf = [0u8; 64];
        let spec = FrameSpec {
            target: Target::Extended {
                group: u32::MAX,
                hive: u32::MAX,
            },
            ..compact_spec(b"", None)
        };
        assert_eq!(spec.encode(&mut buf), Err(EncodeError::ReservedTarget));
    }

    /// ‼ **AND THE NEGATIVE CONTROL THAT MAKES THE REFUSAL MEAN
    /// SOMETHING**: a target with only ONE half all-ones is **not**
    /// reserved and must encode. *Without this the test above would pass
    /// for an arm that refused every extended target.*
    #[test]
    fn a_half_all_ones_extended_target_is_not_reserved() {
        let mut buf = [0u8; 64];
        for t in [
            Target::Extended {
                group: u32::MAX,
                hive: 0,
            },
            Target::Extended {
                group: 0,
                hive: u32::MAX,
            },
        ] {
            let spec = FrameSpec {
                target: t,
                ..compact_spec(b"", None)
            };
            // ‼ NOT `is_ok()`: this control asks only whether the target is
            // REJECTED AS RESERVED. An extended target on a spec whose other
            // fields are compact-shaped can fail for an unrelated reason, and
            // asserting success would make this test about something else —
            // which is what it did on its first run.
            assert_ne!(
                spec.encode(&mut buf),
                Err(EncodeError::ReservedTarget),
                "{t:?} was refused as RESERVED, but only one half is all-ones",
            );
        }
    }

    /// ‼ **AN ORDINARY FRAME THROUGH `parse_on_bearer`** (`L4-050`). Only
    /// the `GROUP_MGMT` override path was tested, so the **ordinary**
    /// path — where the bearer's declared tier is the one used — had no
    /// assertion at all.
    #[test]
    fn parse_on_bearer_uses_the_bearers_tier_for_an_ordinary_frame() {
        let mut buf = [0u8; 64];
        let n = compact_spec(b"hi", None).encode(&mut buf).expect("encodes");
        let f = Frame::parse_on_bearer(&buf[..n], Tier::Compact).expect("parses");
        assert_eq!(f.payload, b"hi");

        // And the discriminator: the SAME bytes read at the wrong tier do
        // not silently succeed, so the tier argument is load-bearing
        // rather than decorative.
        assert!(Frame::parse_on_bearer(&buf[..n], Tier::Extended).is_err());
    }

    fn span_of(frame: &Frame<'_>) -> Vec<u8> {
        let mut out = Vec::new();
        frame
            .authenticated_span(&mut |b| out.extend_from_slice(b))
            .unwrap();
        out
    }

    /// **L4 9.1.4** (`L4-081`/`L4-082`, `STD-SS376`, landed 2026-08-15 out
    /// of this lane's sweep): *a tier shall place the type field at the
    /// same offset as every other tier, and that type value shall be
    /// covered by the authenticated span.*
    ///
    /// ‼ **BOTH ARE `CONSTRUCTION` OBLIGATIONS ON WHOEVER DEFINES A TIER,
    /// AND THIS CRATE IS THE ONLY PLACE THE TWO DEFINED TIERS ARE
    /// REALISED** — so the properties are assertable here even though the
    /// duty is not this lane's. *A construction claim nobody can fail is
    /// still worth pinning when a future tier is exactly what would break
    /// it.*
    ///
    /// The first assertion is the strong form: **the type is read BEFORE
    /// the tier is known** (`parse_on_bearer` extracts it from byte 0 to
    /// decide the tier for GROUP_MGMT), which is offset-invariance stated
    /// as something the code depends on rather than something it happens
    /// to satisfy.
    #[test]
    fn the_type_field_is_tier_invariant_and_the_span_covers_it() {
        // 9.1.4a: the same byte 0, read at either tier, yields the same
        // type — the offset does not move.
        let mut c = [0u8; 64];
        let cn = compact_spec(b"x", None).encode(&mut c).expect("encodes");
        let mut e = [0u8; 64];
        let ext = FrameSpec {
            target: Target::Extended { group: 1, hive: 2 },
            route: Some(&ORIGIN_E),
            ..compact_spec(b"x", None)
        };
        let en = ext.encode(&mut e).expect("encodes");
        let ct = Frame::parse_on_bearer(&c[..cn], Tier::Compact).expect("parses");
        let et = Frame::parse_on_bearer(&e[..en], Tier::Extended).expect("parses");
        assert_eq!(ct.frame_type, et.frame_type, "same type at both tiers");
        // ...and it comes out of the SAME bit positions of byte 0.
        assert_eq!((c[0] >> 3) & 0x7, (e[0] >> 3) & 0x7, "9.1.4a: same offset");

        // 9.1.4b: the type value is the FIRST thing the span covers, so
        // the 9.1.2 override is decided by an authenticated byte.
        let span = span_of(&ct);
        assert_eq!(
            span.first().copied(),
            Some(ct.frame_type as u8),
            "9.1.4b/10.2.1: the type value is inside the span, first"
        );

        // ‼ AND THE CONTROL THAT MAKES THE ABOVE MEAN ANYTHING: the flag
        // bits of the SAME BYTE are NOT covered (10.2.3). Without this the
        // assertion would pass for a span that simply included byte 0
        // whole, which is a different and weaker property.
        let mut flagged = compact_spec(b"x", None);
        flagged.constrained_origin = !flagged.constrained_origin;
        let mut f = [0u8; 64];
        let fn_ = flagged.encode(&mut f).expect("encodes");
        let ft = Frame::parse_on_bearer(&f[..fn_], Tier::Compact).expect("parses");
        assert_ne!(c[0], f[0], "precondition: byte 0 differs in its flag bits");
        assert_eq!(span_of(&ft), span, "10.2.3: flag bits are NOT in the span");
    }

    #[test]
    fn span_covers_exactly_the_immutable_fields() {
        let mut a = [0u8; 64];
        let len_a = compact_spec(b"data", None).encode(&mut a).unwrap();

        // Same frame after relay mutations: hop decremented, budget halved,
        // a relay identity appended to the route record.
        let two_hops: [u8; 8] = [0xAA, 0xBB, 0xCC, 0xDD, 0x99, 0x88, 0x77, 0x66];
        let mut b = [0u8; 64];
        let relayed = FrameSpec {
            hop_limit: 4,
            budget: 2,
            route: Some(&two_hops),
            ..compact_spec(b"data", None)
        };
        let len_b = relayed.encode(&mut b).unwrap();

        let fa = Frame::parse(&a[..len_a], Tier::Compact).unwrap();
        let fb = Frame::parse(&b[..len_b], Tier::Compact).unwrap();
        // 10.2.2/10.2.3: the span is byte-identical under every
        // relay-mutable field's mutation.
        assert_eq!(span_of(&fa), span_of(&fb));

        // A covered field's mutation changes the span.
        let retargeted = FrameSpec {
            target: Target::Compact(0x0BAD_CAF0),
            ..compact_spec(b"data", None)
        };
        let mut c = [0u8; 64];
        let len_c = retargeted.encode(&mut c).unwrap();
        let fc = Frame::parse(&c[..len_c], Tier::Compact).unwrap();
        assert_ne!(span_of(&fa), span_of(&fc));
    }

    #[test]
    fn span_layout_is_byte_exact() {
        let mut buf = [0u8; 64];
        let len = compact_spec(b"pl", None).encode(&mut buf).unwrap();
        let f = Frame::parse(&buf[..len], Tier::Compact).unwrap();
        let mut expected = Vec::new();
        expected.push(FrameType::Event as u8); // type, one zero-padded byte
        expected.extend_from_slice(&0x1234u16.to_be_bytes()); // msg id, tier-native
        expected.extend_from_slice(&ORIGIN_C); // origin = route entry zero
        expected.extend_from_slice(&0xDEAD_BEEFu32.to_be_bytes()); // event hash
        expected.extend_from_slice(&0x0BAD_CAFEu32.to_be_bytes()); // target
        expected.extend_from_slice(b"pl"); // payload
        assert_eq!(span_of(&f), expected);
    }

    #[test]
    fn relay_mutations_in_place() {
        let mut buf = [0u8; 64];
        let len = compact_spec(b"", None).encode(&mut buf).unwrap();
        assert_eq!(decrement_hop_limit(&mut buf[..len]), Some(4));
        set_budget(&mut buf[..len], 2).unwrap();
        let f = Frame::parse(&buf[..len], Tier::Compact).unwrap();
        assert_eq!(f.hop_limit, 4);
        assert_eq!(f.budget, 2);

        // Hop limit zero: no further decrement (5.2.2 refuses relay).
        let mut z = buf;
        z[1] &= 0x0F;
        assert_eq!(decrement_hop_limit(&mut z[..len]), None);
    }

    #[test]
    fn compact_route_count_zero_and_max() {
        // Count 0 (flag set, no entries) and count 8 both delimit the
        // payload unambiguously (12.2). GROUP_MGMT is the only type allowed
        // to lack an origin.
        let mut buf = [0u8; 96];
        let empty: [u8; 0] = [];
        let spec = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            constrained_origin: false,
            hop_limit: 1,
            budget: 0,
            msg_id: 0,
            event_hash: 0,
            target: Target::Compact(1),
            route: Some(&empty),
            payload: b"abc",
            tag: None,
        };
        let len = spec.encode(&mut buf).unwrap();
        let f = Frame::parse(&buf[..len], Tier::Compact).unwrap();
        assert_eq!(f.route.unwrap().count(), 0);
        assert_eq!(f.payload, b"abc");

        let full = [0x11u8; 32]; // 8 entries * 4 bytes
        let spec = FrameSpec {
            route: Some(&full),
            ..compact_spec(b"abc", None)
        };
        let len = spec.encode(&mut buf).unwrap();
        let f = Frame::parse(&buf[..len], Tier::Compact).unwrap();
        assert_eq!(f.route.unwrap().count(), 8);
        assert_eq!(f.payload, b"abc");
    }

    /// **L0 5.2.3 and L0 6.3 (`L0-013`, `L0-029`): a parsed frame carries no
    /// tick count and no trust material.** `Frame` is destructured
    /// exhaustively, by name and without `..`, and every field is bound at
    /// its declared type — so a field added to `Frame` fails this test at
    /// compile time, and a field retyped to a tick count or a key fails it
    /// the same way. The ten types, named: `FrameType`, `Flags`, `u8`, `u8`,
    /// `u32`, `u32`, `Target`, `Option<RouteRecord>`, `&[u8]` and
    /// `Option<&[u8]>` — two enums, a flag byte, two nibbles, two words, a
    /// route view and two borrowed byte slices. None is a `Ticks`: this
    /// crate has no dependency on `r2-hal-traits`, so the type cannot even be
    /// named here, and L0 5.2.3's *not comparable with any other platform's*
    /// holds because a tick never crosses the wire. None is a key or a
    /// secret: this crate has no dependency on `r2-trust` (`cargo xtask
    /// layering` refuses one), and the tag is a borrowed slice the receiver
    /// verifies with Layer 5's key (L4 10.3.1) — the key itself is never a
    /// frame field. The wire length is then accounted for byte by byte, so
    /// nothing rides beside the fields. One test serves both rows.
    ///
    /// Mutation that turns it red: any field added to `Frame` (e.g.
    /// `received_at: u64`, set in `parse`) — the pattern no longer covers the
    /// struct and the test target fails to compile.
    #[test]
    fn a_frame_is_exactly_ten_fields_and_none_is_a_tick_or_a_key() {
        let mut buf = [0u8; 64];
        let tag_bytes = [9u8; COMPACT_TAG_LEN];
        let n = compact_spec(b"hi", Some(&tag_bytes))
            .encode(&mut buf)
            .expect("encodes");
        let parsed = Frame::parse(&buf[..n], Tier::Compact).expect("parses");
        let Frame {
            frame_type,
            flags,
            hop_limit,
            budget,
            msg_id,
            event_hash,
            target,
            route,
            payload,
            tag,
        } = parsed;
        let _: FrameType = frame_type;
        let _: Flags = flags;
        let _: u8 = hop_limit;
        let _: u8 = budget;
        let _: u32 = msg_id;
        let _: u32 = event_hash;
        let _: Target = target;
        let _: Option<RouteRecord<'_>> = route;
        let _: &[u8] = payload;
        let _: Option<&[u8]> = tag;
        // The bytes on the wire are the header, the route count and its one
        // entry, the payload and the tag — and nothing else, so there is no
        // byte for an eleventh field to hide in.
        assert_eq!(
            n,
            Tier::Compact.header_len() + 1 + ORIGIN_C.len() + b"hi".len() + COMPACT_TAG_LEN
        );
    }
}
