//! **The announcement body — the beacon's payload, shared by every binding.**
//!
//! A beacon is carried as a Layer 4 HEARTBEAT frame whose payload is this
//! body (ESP-NOW 5.2.1, LoRa 5.2.1, BLE 5.2.1). **All three binding documents
//! define the same body** — the BLE one says so in terms, *the two share an
//! announcement body in its first three elements* — so this is one codec and
//! not three, and a hive announcing on two bearers says the same thing on
//! both by construction rather than by care.
//!
//! # The format
//!
//! A sequence of elements, each `type (1 octet) || length (1 octet) || value
//! (length octets)`, **in ascending type order, with no element repeated**
//! (5.3.1).
//!
//! | Type | Length | Value |
//! |---|---|---|
//! | `0x01` | 4 | beacon identifier (L2 5.4.1) |
//! | `0x02` | 4 | class hash, big-endian (L2 5.5.1) |
//! | `0x03` | 1 | build-mode declaration (L2 5.4a.1) |
//! | `0x04` | 2 | duty class and interval (L2 5.4b) — LoRa only |
//!
//! # What a reader must not conclude
//!
//! ⚠ **The three build-mode outcomes are NOT two.** 6.3 makes them *present
//! with value `0x01`* → development, *body well-formed to its end and the
//! element absent* → production, and *truncated, unparseable, or unreachable*
//! → **unknown**; and 6.4 says in terms that **a scanner shall not read
//! unknown as production.** The whole point of 5.3.4 — *a truncated final
//! element shall be treated as unreadable from that element onward, and shall
//! not be treated as though the element were absent* — is that a body cut
//! short before `0x03` looks exactly like a body that never carried it.
//! [`Announcement::truncated`] is what keeps those apart, and it is why this
//! decoder reports a flag rather than an `Option`.

use crate::l2::{BeaconDeclarations, BeaconId, DutyClass};
use r2_hal_traits::build_mode::BuildMode;

/// Beacon identifier (L2 5.4.1). Four octets on every binding.
pub const ELEM_BEACON_ID: u8 = 0x01;
/// Class hash (L2 5.5.1), four octets big-endian.
pub const ELEM_CLASS_HASH: u8 = 0x02;
/// Build-mode declaration (L2 5.4a.1), one octet.
pub const ELEM_BUILD_MODE: u8 = 0x03;
/// Duty class and longest receptive interval (L2 5.4b), two octets.
///
/// ⚠ **LoRa only, and its interval encoding is `PROVISIONAL`.** The other two
/// bindings define no type for it and are thereby unable to announce a
/// duty-cycled hive at all — stated in the LoRa binding's own Note 1 to 5.4,
/// and the interval ladder is flagged `SS11`, which records that L2 5.4b.1's
/// *coarsely stated* has no granularity and no encoding.
pub const ELEM_DUTY_CLASS: u8 = 0x04;

/// The build-mode octet a development image emits (ESP-NOW 6.1).
const DEVELOPMENT_OCTET: u8 = 0x01;

/// Duty-class octet: intermittently receptive.
const DUTY_INTERMITTENT: u8 = 0x00;
/// Duty-class octet: continuously receptive (L2 5.4b.2's *may carry a
/// continuous value where the bearer's announcement layout provides one*).
const DUTY_CONTINUOUS: u8 = 0x01;
/// Interval octet meaning *not stated* (LoRa 5.4.3).
const INTERVAL_UNSTATED: u8 = 0xFF;

/// Largest body this codec writes: four elements, each with a two-octet head.
pub const MAX_BODY: usize = (2 + 4) + (2 + 4) + (2 + 1) + (2 + 2);

/// What a beacon announced, and whether the body could be read to its end.
#[derive(Clone, Copy, Debug)]
pub struct Announcement {
    pub beacon_id: Option<BeaconId>,
    pub declarations: BeaconDeclarations,
    /// ‼ **Whether the body carried the elements L2 5.1 makes MANDATORY** —
    /// a beacon identifier and a class hash.
    ///
    /// **A body carrying neither is not a beacon**, and reading a build mode
    /// out of it is reading the absence of everything as a positive claim.
    /// *Found by the first run of `TEST-VECTORS-ANNOUNCEMENT.md`, which is
    /// what a byte-exact vector file is for* — `SS400`.
    pub carries_mandatory_elements: bool,
    /// ‼ **THE `0x03` ELEMENT WAS NOT THERE — A FACT, NOT A VERDICT
    /// (`SS404`).** What it *means* differs by binding, so the observation
    /// is recorded and [`Announcement::build_mode_conclusion`] applies the
    /// caller's rule to it.
    pub declaration_absent: bool,
    /// ⚠ **The body ran out inside an element, or was not parseable.**
    ///
    /// 5.3.4: unreadable **from that element onward**, and *not* as though the
    /// element were absent. A caller must not read an absent `0x03` as
    /// production when this is set — 6.4 forbids exactly that, and
    /// [`Self::build_mode_conclusion`] is the form that cannot get it wrong.
    pub truncated: bool,
}

/// **Which binding's 6.3 the caller is applying — `SS404`.**
///
/// ‼ **THE THREE BINDINGS DO NOT AGREE, AND ONE CODEC SERVES ALL THREE.**
/// ESP-NOW **6.3** row 2 reads *body well-formed to its end, element `0x03`
/// absent* as **production**. BLE **6.3** and LoRa **6.3** say, in identical
/// words, that a receiver finding no element *shall treat the declaration as
/// absent* and that absence *shall **not** be treated as production
/// declared.* **Those are opposite verdicts on the same observation.**
///
/// This codec used to bake the ESP-NOW reading in at decode time, which made
/// it **silently non-conformant for BND2-046 and BND3-039** — the two rows
/// that state the BLE and LoRa rule. *A shared codec cannot satisfy both by
/// assuming one, so the reading is an input and the caller must name it.*
///
/// **The idiom is deliberate and this lane uses it elsewhere**: where no type
/// can decide, force the caller to say which rule it is applying, so the
/// choice is visible at the call site and greppable — the same reason
/// `Presence::as_bool` takes `unknown_means_present`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AbsentDeclaration {
    /// **ESP-NOW 6.3**: well-formed to its end with no `0x03` is production.
    ReadsAsProduction,
    /// **BLE 6.3, LoRa 6.3**: absent is *absent*, and shall not be read as
    /// production declared.
    ///
    /// BLE's Note 1 gives the reason: *there is no value meaning production*
    /// — L2 5.4a.2 — so production is encodable only as the element's
    /// absence, and *a scanner that collapsed absent and unreadable would
    /// report a cut-off advertisement as a production hive.*
    NotProductionDeclared,
}

impl Announcement {
    /// The build-mode outcome, as 6.3's three-way table.
    ///
    /// Provided because the two facts a caller must combine — *was the element
    /// there* and *was the body readable* — live in different fields, and
    /// every wrong answer to this question is the same wrong answer:
    /// **reading unknown as production.**
    pub fn build_mode_conclusion(&self, reading: AbsentDeclaration) -> BuildMode {
        if self.truncated {
            return BuildMode::Unknown;
        }
        // ‼ **`SS400`: A BODY MISSING THE ELEMENTS L2 5.1 MAKES MANDATORY IS
        // NOT A BEACON, AND ITS BUILD MODE IS UNKNOWN.** 5.1 says a beacon
        // *shall carry* b) a beacon identifier and c) a class hash. Without
        // them there is no announcement to draw a conclusion from — and the
        // conclusion this drew was **Production**, from a body that declared
        // nothing at all, which is exactly what 6.4 forbids.
        //
        // ⚠ **THIS IS NOT `SS390` AND NEEDS NO RULING.** `SS390` concerns a
        // body that HAS both mandatory elements and lacks only the optional
        // `0x03`; whether that reads as production is disputed and Roy's.
        // *This is a body that carries neither, which 5.1 already decides.*
        if !self.carries_mandatory_elements {
            return BuildMode::Unknown;
        }
        // `SS404`: the bindings disagree about an ABSENT element, so the
        // caller names which rule applies. A present element decides itself
        // and no reading changes it.
        if self.declaration_absent {
            return match reading {
                AbsentDeclaration::ReadsAsProduction => BuildMode::Production,
                AbsentDeclaration::NotProductionDeclared => BuildMode::Unknown,
            };
        }
        self.declarations.build_mode
    }
}

/// Why a body could not be written.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EncodeError {
    /// The output buffer is shorter than the body. Nothing partial is left in
    /// it that a caller could mistake for a beacon.
    TooSmall { needed: usize },
    /// The beacon identifier is not four octets, which every binding's 5.3.2
    /// fixes. [`BeaconId`] holds up to sixteen because its width *is* the
    /// binding's to state, so the check belongs here rather than in the type.
    BeaconIdNotFourOctets,
}

/// Write an announcement body.
///
/// ⚠ **A production image emits NO `0x03` element** (6.2), and 6.2's second
/// half — *shall carry no other development-related octet* — is why the
/// production path here writes nothing extra rather than writing a zero. *A
/// zero would be a development-related octet whose value happens to mean
/// production, which is a different claim from silence.*
///
/// The elements are written in ascending type order because 5.3.1 requires it
/// and because a decoder is entitled to rely on it.
pub fn encode(
    beacon_id: BeaconId,
    decl: &BeaconDeclarations,
    out: &mut [u8],
) -> Result<usize, EncodeError> {
    let id = beacon_id.as_bytes();
    if id.len() != 4 {
        return Err(EncodeError::BeaconIdNotFourOctets);
    }

    let duty = duty_octets(decl.duty_class);
    let needed = (2 + 4)
        + (2 + 4)
        + if decl.build_mode.emits_declaration() {
            2 + 1
        } else {
            0
        }
        + if duty.is_some() { 2 + 2 } else { 0 };
    if out.len() < needed {
        return Err(EncodeError::TooSmall { needed });
    }

    let mut n = 0;
    n += put(out, n, ELEM_BEACON_ID, id);
    n += put(out, n, ELEM_CLASS_HASH, &decl.class_hash.to_be_bytes());
    // 6.1: a development image includes `0x03` with length 1 and value 0x01.
    // 6.2: a production image does not include it at all.
    if decl.build_mode.emits_declaration() {
        n += put(out, n, ELEM_BUILD_MODE, &[DEVELOPMENT_OCTET]);
    }
    if let Some(bytes) = duty {
        n += put(out, n, ELEM_DUTY_CLASS, &bytes);
    }
    Ok(n)
}

fn put(out: &mut [u8], at: usize, ty: u8, value: &[u8]) -> usize {
    out[at] = ty;
    out[at + 1] = value.len() as u8;
    out[at + 2..at + 2 + value.len()].copy_from_slice(value);
    2 + value.len()
}

/// LoRa 5.4.1 and 5.4.2: an intermittent hive carries the element, a
/// continuously receptive one **shall not** — so `Continuous` writes nothing
/// here, and 5.4b.2's *may carry a continuous value* is the reason the octet
/// exists to be READ rather than written.
fn duty_octets(duty: DutyClass) -> Option<[u8; 2]> {
    match duty {
        DutyClass::Intermittent { longest_interval_s } => {
            Some([DUTY_INTERMITTENT, interval_exponent(longest_interval_s)])
        }
        DutyClass::Continuous | DutyClass::Unknown => None,
    }
}

/// LoRa 5.4.3 `PROVISIONAL`: the octet is read as `2^n` seconds, **rounded UP
/// to the next representable value**.
///
/// ⚠ **Rounding UP is the direction that matters and it is the clause's.** The
/// value is a bound a receiver uses to decide how long to hold a frame for a
/// sleeping peer, so rounding down would understate the wait and drop frames
/// the hive would have taken. `0xFF` is reserved for *not stated* and is
/// therefore never produced by rounding — an interval too long to represent
/// saturates at `0xFE`, which is a stated bound rather than a refusal to say.
fn interval_exponent(seconds: u32) -> u8 {
    if seconds <= 1 {
        return 0;
    }
    let mut n = 0u8;
    while n < INTERVAL_UNSTATED - 1 && (1u64 << n) < seconds as u64 {
        n += 1;
    }
    n
}

/// The seconds an interval octet denotes (LoRa 5.4.3).
///
/// `None` for `0xFF`, which means *the interval is not stated* — distinct from
/// an interval of zero.
pub fn interval_seconds(octet: u8) -> Option<u32> {
    (octet != INTERVAL_UNSTATED).then(|| 1u32.checked_shl(octet as u32).unwrap_or(u32::MAX))
}

/// Read an announcement body.
///
/// ‼ **`body` MUST BE THE WHOLE CARRIED UNIT AND NOT A PREFIX OF ONE**, which
/// is `5.3.4a` in each binding (`PROVISIONAL(r2, SS390)`, drafted
/// 2026-08-24): the body's extent is the length its carriage declares — an
/// ESP-NOW or LoRa frame's payload length, a BLE Service Data structure's
/// length — and a body shorter than that declaration is **unreadable
/// throughout**, not a shorter body that is well-formed to its end.
///
/// **This function cannot check that and must not pretend to**: it sees a
/// slice and knows nothing about the carrier. The check belongs at the
/// bearer seam, where the declared length is in hand, and the reason it
/// matters is exact — a body cut at an ELEMENT BOUNDARY is byte-for-byte a
/// shorter, complete, well-formed body, so `truncated` is false and 6.3
/// concludes **production** for a development hive, which 6.4 forbids. The
/// build-mode element is `0x03`, last in ascending order, so it is the first
/// thing any truncation removes.
///
/// Never fails: an unreadable body is an [`Announcement`] with `truncated`
/// set, because **there is no verdict a caller may draw from a parse error
/// other than *unknown***, and returning an error would leave the caller to
/// invent one. 6.3's third outcome is *truncated, unparseable, or
/// unreachable* — one outcome, not three.
pub fn decode(body: &[u8]) -> Announcement {
    let mut out = Announcement {
        beacon_id: None,
        declarations: BeaconDeclarations {
            class_hash: 0,
            summary_carried: false,
            // ⚠ Unknown until an element says otherwise. 5.4a.4 and 6.4 both
            // forbid the other default.
            build_mode: BuildMode::Unknown,
            duty_class: DutyClass::Unknown,
        },
        carries_mandatory_elements: false,
        declaration_absent: false,
        truncated: false,
    };

    let mut at = 0usize;
    let mut last_type: Option<u8> = None;
    let mut saw_build_mode = false;
    // ‼ **PRESENCE, NOT VALUE.** A class hash of zero is a legal hash, so
    // `class_hash == 0` cannot stand in for *the element was there* — the
    // same defect `saw_build_mode` exists to avoid, one element along.
    let mut saw_class_hash = false;
    while at < body.len() {
        // A head needs two octets; one octet left is a truncated element and
        // not the end of the body.
        if at + 2 > body.len() {
            out.truncated = true;
            return out;
        }
        let ty = body[at];
        let len = body[at + 1] as usize;
        let value_at = at + 2;
        if value_at + len > body.len() {
            // 5.3.4: unreadable FROM THIS ELEMENT ONWARD. Everything already
            // read stands; nothing after it is guessed at.
            out.truncated = true;
            return out;
        }

        // 5.3.1: ascending type order, no repeats. A body breaking that is
        // unparseable rather than partially trusted — 6.3's third outcome —
        // because two orderings would otherwise carry one meaning and the
        // element that decides development from production is in the sequence.
        if let Some(prev) = last_type {
            if ty <= prev {
                out.truncated = true;
                return out;
            }
        }
        last_type = Some(ty);

        let value = &body[value_at..value_at + len];
        match ty {
            ELEM_BEACON_ID => out.beacon_id = BeaconId::new(value),
            ELEM_CLASS_HASH => {
                if let Ok(four) = <[u8; 4]>::try_from(value) {
                    out.declarations.class_hash = u32::from_be_bytes(four);
                    saw_class_hash = true;
                }
            }
            ELEM_BUILD_MODE => {
                saw_build_mode = true;
                // 6.3: present with value 0x01 is development. Any other value
                // is a declaration this reader does not recognise, and 5.4a.4
                // makes an unrecognised mode UNKNOWN — never production.
                out.declarations.build_mode = match value {
                    [DEVELOPMENT_OCTET] => BuildMode::Development,
                    _ => BuildMode::Unknown,
                };
            }
            ELEM_DUTY_CLASS => {
                out.declarations.duty_class = match value {
                    [DUTY_INTERMITTENT, interval] => match interval_seconds(*interval) {
                        Some(s) => DutyClass::Intermittent {
                            longest_interval_s: s,
                        },
                        // 5.4.3's reserved octet: the class is stated and the
                        // interval is not. 5.4b.4 forbids reading an
                        // unreadable field as a claim of either class, and an
                        // interval nobody stated is not a bound — so this is
                        // Unknown rather than Intermittent with a guess.
                        None => DutyClass::Unknown,
                    },
                    [DUTY_CONTINUOUS, _] => DutyClass::Continuous,
                    _ => DutyClass::Unknown,
                };
            }
            // 5.3.3: an unknown type is SKIPPED and its length honoured. Not
            // an error — this is how the format grows, and a reader that
            // refused would make every future element a breaking change.
            _ => {}
        }
        at = value_at + len;
    }

    // 6.3's second outcome: **the body was well-formed to its END** and the
    // element is absent. An absent `0x03` is now, and only now, production.
    //
    // ⚠ Presence is tracked with its own flag rather than inferred from the
    // last type seen. The first version of this asked whether the last element
    // was `>= 0x03`, which a trailing `0x04` satisfies with no `0x03` in the
    // body at all — **a production verdict from a beacon that declared
    // nothing**, which is precisely what 6.4 forbids.
    // ‼ **THE ABSENCE IS RECORDED AND NOT RESOLVED HERE — `SS404`.** This
    // used to set `Production`, which is ESP-NOW 6.3's reading baked into a
    // codec that BLE and LoRa also use, and their 6.3 says the opposite in
    // identical words. `declarations.build_mode` therefore stays `Unknown`,
    // which is what the BYTES said, and the verdict is the caller's.
    // ‼ **`!out.truncated` WAS HERE AND WAS DEAD, WHICH IS WORSE THAN ABSENT
    // (removed 2026-09-05).** Every truncation sets the flag and RETURNS
    // immediately — three sites, all `truncated = true; return out;` — so this
    // line is only ever reached with `truncated == false` and the term could
    // never be false. **It read as the 5.3.4 guard and was not one**, and
    // deleting it changed nothing, which is exactly what the refutation
    // measured (`BND1-016`, `BND2-039`, 2026-09-04). *A condition that cannot
    // be false is a comment wearing the syntax of code, and it drew the eye
    // away from where the obligation is actually discharged.*
    //
    // **5.3.4 IS DISCHARGED BY THE EARLY RETURN**: a truncated body never
    // reaches this line, so `declaration_absent` keeps its initialised
    // `false`, and a truncated final element is therefore NOT reported as an
    // absent one. That is the obligation, and it is now the thing a test can
    // point at.
    out.declaration_absent = !saw_build_mode;
    // L2 5.1 b) and c). Set last so an early `return` on a truncated body
    // leaves it false, which is the honest answer there too: a body that ran
    // out cannot be said to carry what it never reached.
    out.carries_mandatory_elements = out.beacon_id.is_some() && saw_class_hash;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **`SS404`: THE THREE BINDINGS GIVE OPPOSITE VERDICTS ON THE SAME
    /// BYTES, AND ONE CODEC SERVES ALL THREE.**
    ///
    /// ESP-NOW **6.3** row 2: *body well-formed to its end, element `0x03`
    /// absent* → **production**. BLE **6.3** and LoRa **6.3**, in identical
    /// words: a receiver finding no element *shall treat the declaration as
    /// absent*, and neither absent nor unreadable *shall be treated as
    /// production declared.*
    ///
    /// **This codec baked the ESP-NOW reading in at decode time**, which made
    /// it silently non-conformant for `BND2-046` and `BND3-039` — *the two
    /// rows that state the other rule.* The bytes are now reported as a
    /// fact and the verdict is the caller's, named at the call site.
    #[test]
    fn the_same_body_reads_differently_under_each_bindings_6_3() {
        let mut body = [0u8; 12];
        body[0] = ELEM_BEACON_ID;
        body[1] = 4;
        body[2..6].copy_from_slice(&[0xA1, 0xB2, 0xC3, 0xD4]);
        body[6] = ELEM_CLASS_HASH;
        body[7] = 4;
        body[8..].copy_from_slice(&[0xE9, 0xF2, 0xA9, 0x35]);

        let got = decode(&body);
        assert!(got.carries_mandatory_elements);
        assert!(got.declaration_absent, "no 0x03 element — a FACT");
        assert!(!got.truncated);

        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production,
            "ESP-NOW 6.3 row 2"
        );
        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::NotProductionDeclared),
            BuildMode::Unknown,
            "BLE 6.3 and LoRa 6.3: absence is not a production declaration"
        );
    }

    /// **A PRESENT element decides itself, and no reading changes it** — the
    /// disagreement is only about absence. *Without this the parameter could
    /// be read as a general override of the declared mode.*
    #[test]
    fn a_present_declaration_is_unaffected_by_which_binding_reads_it() {
        let mut body = [0u8; 15];
        body[0] = ELEM_BEACON_ID;
        body[1] = 4;
        body[2..6].copy_from_slice(&[0xA1, 0xB2, 0xC3, 0xD4]);
        body[6] = ELEM_CLASS_HASH;
        body[7] = 4;
        body[8..12].copy_from_slice(&[0xE9, 0xF2, 0xA9, 0x35]);
        body[12] = ELEM_BUILD_MODE;
        body[13] = 1;
        body[14] = DEVELOPMENT_OCTET;

        let got = decode(&body);
        assert!(!got.declaration_absent);
        for reading in [
            AbsentDeclaration::ReadsAsProduction,
            AbsentDeclaration::NotProductionDeclared,
        ] {
            assert_eq!(
                got.build_mode_conclusion(reading),
                BuildMode::Development,
                "a present 0x03 is not the disputed case"
            );
        }
    }

    /// ‼ **`SS400`: A BODY THAT CARRIES NEITHER MANDATORY ELEMENT IS NOT A
    /// BEACON, AND ITS BUILD MODE IS UNKNOWN — IT USED TO READ AS
    /// PRODUCTION.**
    ///
    /// L2 **5.1** says a beacon *shall carry* b) a beacon identifier and c) a
    /// class hash. An empty body has neither, and the old conclusion drew
    /// **Production** from it: the `0x03` element was absent and the body was
    /// well-formed to its end, so both of the production test's conditions
    /// held **vacuously**. *That is a positive claim about build mode read
    /// out of the absence of everything, which is what 6.4 forbids.*
    ///
    /// ⚠ **NOT `SS390`, AND NEEDING NO RULING.** `SS390` concerns a body that
    /// HAS both mandatory elements and lacks only the optional `0x03`, and
    /// whether that reads as production is disputed. *This body carries
    /// neither, which 5.1 already decides.*
    ///
    /// **Found by the first run of `TEST-VECTORS-ANNOUNCEMENT.md`**, from
    /// bytes derived out of the clauses rather than out of this file — which
    /// is the whole reason a vector file is generated independently.
    #[test]
    fn a_body_without_the_mandatory_elements_is_not_a_beacon() {
        let empty = decode(&[]);
        assert!(!empty.carries_mandatory_elements);
        assert!(
            !empty.truncated,
            "an empty body is not TRUNCATED, it is empty"
        );
        assert_eq!(
            empty.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Unknown,
            "production from a body that declared nothing is what 6.4 forbids"
        );

        // A beacon identifier alone is still not a beacon: 5.1 requires both.
        let mut only_id = [0u8; 6];
        only_id[0] = ELEM_BEACON_ID;
        only_id[1] = 4;
        only_id[2..].copy_from_slice(&[0xA1, 0xB2, 0xC3, 0xD4]);
        let one = decode(&only_id);
        assert!(one.beacon_id.is_some());
        assert!(!one.carries_mandatory_elements, "the class hash is missing");
        assert_eq!(
            one.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Unknown
        );

        // ‼ AND THE CONTROL, WHICH IS WHAT KEEPS THIS FROM BEING A BLANKET
        // REFUSAL: both mandatory elements present and no 0x03 still reads
        // as production. That case is SS390's and is deliberately unchanged.
        let mut both = [0u8; 12];
        both[..6].copy_from_slice(&only_id);
        both[6] = ELEM_CLASS_HASH;
        both[7] = 4;
        both[8..].copy_from_slice(&[0xE9, 0xF2, 0xA9, 0x35]);
        let two = decode(&both);
        assert!(two.carries_mandatory_elements);
        assert_eq!(
            two.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );
    }

    /// ‼ **PRESENCE, NOT VALUE — A CLASS HASH OF ZERO IS A LEGAL HASH.**
    /// Inferring the element's presence from `class_hash != 0` would make a
    /// hive whose class happens to hash to zero indistinguishable from one
    /// that sent no class hash at all. *This is the `saw_build_mode` defect
    /// one element along, and it is pinned before anybody writes it.*
    #[test]
    fn a_class_hash_of_zero_is_a_hash_and_not_an_absence() {
        let mut body = [0u8; 12];
        body[0] = ELEM_BEACON_ID;
        body[1] = 4;
        body[2..6].copy_from_slice(&[0xA1, 0xB2, 0xC3, 0xD4]);
        body[6] = ELEM_CLASS_HASH;
        body[7] = 4;
        // value stays all zeroes
        let got = decode(&body);
        assert_eq!(got.declarations.class_hash, 0);
        assert!(
            got.carries_mandatory_elements,
            "the element was THERE and its value was zero"
        );
        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );
    }

    fn decl(build_mode: BuildMode, duty: DutyClass) -> BeaconDeclarations {
        BeaconDeclarations {
            class_hash: 0xDEAD_BEEF,
            summary_carried: false,
            build_mode,
            duty_class: duty,
        }
    }

    fn id() -> BeaconId {
        BeaconId::new(&[0x11, 0x22, 0x33, 0x44]).unwrap()
    }

    /// ESP-NOW 5.3.2 / BLE 5.3.2 / LoRa 5.3.2 (`BND1-013`, `BND2-036`, `BND3-027`) and
    /// 6.1 (`BND2-042`, `BND3-035`): the element TYPE octets and the development
    /// octet are wire literals fixed by the binding tables. Every other test here
    /// reaches them through the `ELEM_*` names, so a consistent renumbering would
    /// pass the whole module while every beacon on air became unreadable to a
    /// conforming peer. This is the one place the literals are spelt.
    #[test]
    fn the_element_types_and_the_development_octet_are_the_bindings_literals() {
        assert_eq!(
            ELEM_BEACON_ID, 0x01,
            "5.3.2: beacon identifier is element 0x01"
        );
        assert_eq!(ELEM_CLASS_HASH, 0x02, "5.3.2: class hash is element 0x02");
        assert_eq!(
            ELEM_BUILD_MODE, 0x03,
            "5.3.2 / 6.1: build-mode declaration is element 0x03"
        );
        assert_eq!(
            ELEM_DUTY_CLASS, 0x04,
            "5.3.2 / 5.4.1: duty class is element 0x04"
        );
        assert_eq!(
            DEVELOPMENT_OCTET, 0x01,
            "6.1: development is the octet 0x01"
        );
        // And on the wire, not only in the constants: a development beacon's body
        // carries the bytes 0x03 0x01 0x01 in sequence.
        let mut buf = [0u8; 64];
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let n = encode(id(), &d, &mut buf).expect("encodes");
        let body = &buf[..n];
        assert!(
            body.windows(3).any(|w| w == [0x03, 0x01, 0x01]),
            "the build-mode element must appear as type 0x03, length 1, value 0x01 on the wire"
        );
    }

    #[test]
    fn a_development_beacon_round_trips_with_every_element() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");
        let got = decode(&buf[..n]);

        assert_eq!(got.beacon_id.unwrap().as_bytes(), &[0x11, 0x22, 0x33, 0x44]);
        assert_eq!(got.declarations.class_hash, 0xDEAD_BEEF);
        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Development
        );
        assert!(!got.truncated);
        // 5.4.2: a continuously receptive hive does not carry the element, so
        // a reader learns nothing about its duty class from the beacon.
        assert_eq!(got.declarations.duty_class, DutyClass::Unknown);
    }

    /// 6.2: a production image does not include element `0x03`, and 6.3's
    /// second outcome reads its absence — **in a body well-formed to its
    /// end** — as production.
    #[test]
    fn a_production_beacon_carries_no_build_mode_element_and_reads_as_production() {
        let d = decl(BuildMode::Production, DutyClass::Continuous);
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");

        // 6.2 second half: no other development-related octet either. The body
        // is exactly the two required elements and nothing more.
        assert_eq!(n, (2 + 4) + (2 + 4));
        assert!(
            !buf[..n].contains(&ELEM_BUILD_MODE),
            "a production body must not carry the element at all"
        );
        assert_eq!(
            decode(&buf[..n]).build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );
    }

    /// ‼ **6.3's THIRD OUTCOME, AND 6.4 IS THE WHOLE REASON IT EXISTS.** A body
    /// cut short before `0x03` is byte-for-byte a body that never carried it —
    /// so without 5.3.4's rule, truncation would read as PRODUCTION.
    #[test]
    fn a_truncated_body_is_unknown_and_never_production() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");

        // Control: whole, it is development.
        assert_eq!(
            decode(&buf[..n]).build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Development
        );

        // ‼ **CUT INSIDE AN ELEMENT, the verdict must not be production.**
        let boundaries = [0usize, 6, 12, 15];
        for cut in 1..n {
            if boundaries.contains(&cut) {
                continue;
            }
            let got = decode(&buf[..cut]);
            assert!(
                got.truncated,
                "a body cut at {cut} of {n} must read as truncated"
            );
            assert_ne!(
                got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
                BuildMode::Production,
                "a body cut at {cut} of {n} read as production — 6.4 forbids it"
            );
        }

        // ‼ 5.3.4: TRUNCATED IS NOT ABSENT, AND THE TWO MUST BE DISTINGUISHABLE
        //   (BND3-030, added 2026-09-04 after an adversarial pass). Everything above
        //   asserts that a truncated body is never production, which is the NEIGHBOURING
        //   row's claim and is reddened by the same mutation — no mutation separated the
        //   two. This clause says something else: a final element cut short shall not be
        //   read as though it were simply missing. Both bodies exist here, they differ by
        //   one byte of length, and they must not agree.
        let absent = decode(&buf[..15]);
        let cut_short = decode(&buf[..n - 1]);
        assert!(
            !absent.truncated,
            "a body ending exactly at an element boundary is complete, not truncated"
        );
        assert!(
            cut_short.truncated,
            "a body cut inside its final element is truncated"
        );
        assert_ne!(
            absent.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            cut_short.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            "5.3.4: a truncated final element is not to be treated as though the element \
             were absent — the absent body concludes from the caller's stated default, \
             the cut one cannot conclude at all"
        );
    }

    /// ‼ **AND HERE IS THE HOLE 5.3.4 DOES NOT CLOSE, PINNED SO IT IS A KNOWN
    /// PROPERTY RATHER THAN A SURPRISE.**
    ///
    /// A body cut at an ELEMENT BOUNDARY is byte-for-byte a shorter, complete,
    /// well-formed body — so 6.3's second outcome applies and it reads as
    /// **production**. 5.3.4 protects only a cut that lands *inside* an
    /// element. **The build-mode element is `0x03`, third in ascending order,
    /// so it is the element a truncation is most likely to remove**, and the
    /// verdict that replaces it is the one 6.4 exists to prevent.
    ///
    /// *What actually protects this is the CARRIER*: the body's end is
    /// trustworthy because the L4 frame states its payload length, so a short
    /// body is a short frame rather than a silent prefix. **The binding relies
    /// on that and does not say so** — registered as a finding rather than
    /// worked around here, because a codec cannot fix it and a reader who
    /// assumes 5.3.4 covers all truncation is wrong in the security-relevant
    /// direction.
    #[test]
    fn a_cut_at_an_element_boundary_is_indistinguishable_from_a_complete_body() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");
        assert_eq!(n, 15, "id(6) + class(6) + build mode(3)");

        // Cut after the class-hash element: a complete two-element body.
        let cut = decode(&buf[..12]);
        assert!(!cut.truncated, "it IS well-formed to its end");
        assert_eq!(
            cut.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production,
            "and so a development hive reads as production — the carrier's \
             length is what prevents this, not 5.3.4"
        );
    }

    /// 5.3.3: an unknown type is SKIPPED and its length honoured — which is
    /// how the format grows without every new element being a breaking change.
    #[test]
    fn an_unknown_element_is_skipped_and_its_length_honoured() {
        // 0x01 id, then an unknown 0x02-adjacent type carrying junk, then the
        // real build-mode element AFTER it so the skip must land exactly.
        let mut body = alloc_body();
        body.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        body.extend_from_slice(&[ELEM_CLASS_HASH, 4, 0xDE, 0xAD, 0xBE, 0xEF]);
        // An unknown type between the class hash and the build mode. Ascending
        // order is preserved, which 5.3.1 requires of the producer.
        body.extend_from_slice(&[0x02 + 1 - 1, 0, 0]); // placeholder, replaced below
        body.truncate(body.len() - 3);
        body.extend_from_slice(&[0x7F, 3, 0xAA, 0xBB, 0xCC]);
        body.extend_from_slice(&[0xFE, 1, DEVELOPMENT_OCTET]); // unknown, not 0x03

        let got = decode(&body);
        assert!(
            !got.truncated,
            "an unknown element must not read as truncated"
        );
        assert_eq!(got.declarations.class_hash, 0xDEAD_BEEF);
        // Neither unknown element is the build-mode element, so this body is a
        // production one — the skip must not have been mistaken for it.
        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );
    }

    /// 5.3.1: ascending type order with no repeat. A body breaking it is
    /// unparseable — 6.3's third outcome — rather than partially trusted,
    /// because two orderings would otherwise carry one meaning and the element
    /// that decides development from production is in the sequence.
    #[test]
    fn out_of_order_or_repeated_elements_are_unparseable_and_not_production() {
        let mut descending = alloc_body();
        descending.extend_from_slice(&[ELEM_CLASS_HASH, 4, 0xDE, 0xAD, 0xBE, 0xEF]);
        descending.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        let got = decode(&descending);
        assert!(got.truncated);
        assert_ne!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );

        let mut repeated = alloc_body();
        repeated.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        repeated.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x55, 0x66, 0x77, 0x88]);
        assert!(decode(&repeated).truncated);
    }

    /// 5.4a.4 / 6.4: a build-mode octet this reader does not recognise is
    /// UNKNOWN. **Not production** — the element was there and said something
    /// else, which is not the same as it being absent.
    #[test]
    fn an_unrecognised_build_mode_octet_is_unknown_rather_than_production() {
        let mut body = alloc_body();
        body.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        body.extend_from_slice(&[ELEM_CLASS_HASH, 4, 0, 0, 0, 0]);
        body.extend_from_slice(&[ELEM_BUILD_MODE, 1, 0x7E]);
        assert_eq!(
            decode(&body).build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Unknown
        );
    }

    /// ‼ **THE BUG THIS TEST WAS WRITTEN FOR.** Presence of `0x03` was first
    /// inferred from the LAST element type being `>= 0x03`, which a trailing
    /// `0x04` satisfies with no `0x03` in the body at all — a production
    /// verdict from a beacon that declared nothing.
    #[test]
    fn an_element_after_the_build_mode_slot_does_not_imply_a_build_mode() {
        let mut body = alloc_body();
        body.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        body.extend_from_slice(&[ELEM_CLASS_HASH, 4, 0, 0, 0, 0]);
        body.extend_from_slice(&[ELEM_DUTY_CLASS, 2, DUTY_INTERMITTENT, 4]);
        let got = decode(&body);
        // No 0x03 anywhere and the body is whole, so 6.3's second outcome does
        // apply — production — and it must be reached by absence rather than
        // by the trailing element.
        assert_eq!(
            got.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Production
        );
        assert_eq!(
            got.declarations.duty_class,
            DutyClass::Intermittent {
                longest_interval_s: 16
            }
        );
    }

    /// LoRa 5.4.3: `2^n` seconds, **rounded UP**, because the value is a bound
    /// a receiver holds a frame against and rounding down understates the wait.
    #[test]
    fn the_interval_ladder_rounds_up_and_reserves_the_unstated_octet() {
        assert_eq!(interval_exponent(1), 0);
        assert_eq!(interval_exponent(2), 1);
        // 3 is not representable, so it rounds UP to 4 rather than down to 2.
        assert_eq!(interval_exponent(3), 2);
        assert_eq!(interval_seconds(interval_exponent(3)), Some(4));
        assert_eq!(interval_seconds(8), Some(256));
        // 0xFF is reserved for *not stated* and must never be produced by
        // rounding. It cannot be reached in any case: 2^32 already covers
        // every `u32`, so the ladder tops out far below the reserved value and
        // the guard in the loop is a belt rather than the thing that saves it.
        assert_eq!(interval_seconds(0xFF), None);
        assert_eq!(interval_exponent(u32::MAX), 32);
        assert_ne!(interval_exponent(u32::MAX), INTERVAL_UNSTATED);
    }

    /// 5.4.3's reserved octet states the class and NOT the interval, and
    /// 5.4b.4 forbids reading an unreadable field as a claim of either class.
    #[test]
    fn an_unstated_interval_is_not_an_intermittent_claim_with_a_guess() {
        let mut body = alloc_body();
        body.extend_from_slice(&[ELEM_BEACON_ID, 4, 0x11, 0x22, 0x33, 0x44]);
        body.extend_from_slice(&[ELEM_CLASS_HASH, 4, 0, 0, 0, 0]);
        body.extend_from_slice(&[ELEM_DUTY_CLASS, 2, DUTY_INTERMITTENT, 0xFF]);
        assert_eq!(decode(&body).declarations.duty_class, DutyClass::Unknown);
    }

    #[test]
    fn an_intermittent_beacon_round_trips_its_interval() {
        let d = decl(
            BuildMode::Development,
            DutyClass::Intermittent {
                longest_interval_s: 300,
            },
        );
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");
        match decode(&buf[..n]).declarations.duty_class {
            DutyClass::Intermittent { longest_interval_s } => {
                // Rounded UP to the next power of two: 512, never 256.
                assert_eq!(longest_interval_s, 512);
            }
            other => panic!("expected Intermittent, got {other:?}"),
        }
    }

    #[test]
    fn a_short_buffer_refuses_and_writes_no_partial_beacon() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let mut buf = [0u8; 4];
        assert_eq!(
            encode(id(), &d, &mut buf),
            Err(EncodeError::TooSmall { needed: 15 })
        );
        assert_eq!(
            buf, [0u8; 4],
            "nothing partial is left for a caller to send"
        );
    }

    /// Every binding's 5.3.2 fixes the identifier at four octets. `BeaconId`
    /// holds up to sixteen because its width is the BINDING's to state, so the
    /// check belongs at the encoder rather than in the type.
    #[test]
    fn a_beacon_identifier_that_is_not_four_octets_is_refused() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        let mut buf = [0u8; MAX_BODY];
        let wide = BeaconId::new(&[1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
        assert_eq!(
            encode(wide, &d, &mut buf),
            Err(EncodeError::BeaconIdNotFourOctets)
        );
    }

    /// **8.4 / `L2-053`: a hive publishing no public capability shall not
    /// carry a capability summary.**
    ///
    /// Satisfied by construction here — there is no summary element in any
    /// binding's 5.3.2 table, so `encode` has nothing to emit and could not
    /// emit one if it wanted to. **Recorded as a test rather than left to the
    /// absence**, because *satisfied because nobody built the thing* and
    /// *satisfied because the hive publishes nothing* are the same bytes and
    /// different claims, and only the first survives somebody adding the
    /// element.
    #[test]
    fn a_beacon_carrying_no_capability_summary_says_so() {
        let d = decl(BuildMode::Development, DutyClass::Continuous);
        assert!(
            !d.summary_carried,
            "this node publishes no public capability"
        );
        let mut buf = [0u8; MAX_BODY];
        let n = encode(id(), &d, &mut buf).expect("encodes");
        let got = decode(&buf[..n]);
        assert!(
            !got.declarations.summary_carried,
            "8.4: no summary was carried, and the reader agrees"
        );
    }

    /// An empty body is not a production beacon: nothing was declared and
    /// nothing can be concluded.
    #[test]
    fn an_empty_body_declares_nothing() {
        let got = decode(&[]);
        assert!(got.beacon_id.is_none());
        assert_eq!(got.declarations.class_hash, 0);
    }

    extern crate alloc;
    use alloc::vec::Vec;
    fn alloc_body() -> Vec<u8> {
        Vec::new()
    }
    /// ‼ **5.3.4: A TRUNCATED FINAL ELEMENT IS NOT AN ABSENT ONE, ASSERTED AT
    /// THE PLACE THE OBLIGATION IS ACTUALLY DISCHARGED.** The codec used to
    /// carry `!out.truncated` in the `declaration_absent` assignment, which
    /// looked like the guard and was dead: every truncation returns before
    /// that line, so the term could never be false and deleting it changed
    /// nothing (`BND1-016`, `BND2-039`, refuted 2026-09-04).
    ///
    /// What actually discharges 5.3.4 is the EARLY RETURN leaving the field at
    /// its initialised `false`. So this feeds a body whose final element runs
    /// off the end and asserts the three facts a caller combines: the body is
    /// marked truncated, the declaration is NOT reported absent, and the
    /// build-mode conclusion is `Unknown` rather than `Production`.
    ///
    /// *Reading unknown as production is the one wrong answer 6.4 names*, and
    /// the control below is the same body one octet longer, which is complete
    /// and does report the absence.
    #[test]
    fn a_truncated_final_element_is_not_reported_as_an_absent_one() {
        // A well-formed beacon identifier element, then a final element whose
        // declared length runs past the end of the body.
        let mut body = alloc::vec![0x01, 0x04, 0xDE, 0xAD, 0xBE, 0xEF];
        body.extend_from_slice(&[0x03, 0x08, 0x00]); // says 8 octets, gives 1
        let d = decode(&body);
        assert!(d.truncated, "precondition: the body really does run out");
        assert!(
            !d.declaration_absent,
            "‼ 5.3.4: a truncated final element must not be treated as absent"
        );
        assert_eq!(
            d.build_mode_conclusion(AbsentDeclaration::ReadsAsProduction),
            BuildMode::Unknown,
            "‼ 6.4: unknown must not be read as production, even where the \
             caller's binding says an ABSENT declaration would mean it"
        );

        // ‼ THE SECOND TRUNCATION SHAPE, BECAUSE THE CODEC HAS TWO AND A
        //   FIXTURE EXERCISES ONE. Above, a declared length runs past the end;
        //   here a single trailing octet cannot even hold an element head.
        //   *Measured: the first fixture reddens only the return that governs
        //   its own path, so one fixture leaves the other return unexercised.*
        let mut short_head = alloc::vec![0x01, 0x04, 0xDE, 0xAD, 0xBE, 0xEF];
        short_head.push(0x03); // a head needs two octets and this is one
        let s = decode(&short_head);
        assert!(s.truncated, "a lone trailing octet is a truncated element");
        assert!(!s.declaration_absent, "‼ 5.3.4, by the other route");

        // THE CONTROL: the same shape, complete. Now the absence is real and
        // IS reported, so the assertions above are about truncation rather
        // than about a decoder that reports nothing.
        let complete = [0x01, 0x04, 0xDE, 0xAD, 0xBE, 0xEF];
        let c = decode(&complete);
        assert!(!c.truncated, "the control is not truncated");
        assert!(
            c.declaration_absent,
            "a complete body with no build-mode element DOES declare nothing"
        );

        // ‼ **THE SECOND CONTROL, AND IT IS THE ONE THE FIRST DRAFT LACKED.**
        //   Every case above has NO build-mode element, so `declaration_absent`
        //   is true for them whatever the assignment says — *setting it
        //   unconditionally left the whole test green, which is the same
        //   defect being repaired here, committed once more in the repair.*
        //   A complete body that DOES carry the element must report no absence.
        let declared = [0x01, 0x04, 0xDE, 0xAD, 0xBE, 0xEF, 0x03, 0x01, 0x01];
        let dc = decode(&declared);
        assert!(!dc.truncated);
        assert!(
            !dc.declaration_absent,
            "the element is present, so nothing is absent"
        );
    }

    /// ‼ **THE ENCODER IS EXERCISED THROUGH ITS OWN BYTES, WHICH IS WHAT THE
    /// OLD FALSIFIERS DID NOT DO.** `BND1-019` (the class hash is four octets
    /// big-endian) and `BND3-027` (the element table: 0x01 beacon identifier
    /// 4, 0x02 class hash 4, 0x03 build mode 1, 0x04 duty class 2) were both
    /// refuted the same way — *deleting the class-hash write from encode, and
    /// renumbering the beacon-identifier element type on the wire, each left
    /// the named test green, because it asserted the CONSTANTS and never
    /// called encode.* A constant is what the code intends; the body is what
    /// a peer receives.
    ///
    /// So this reads the produced body element by element and asserts the type
    /// octet, the declared length and the value — and the class hash is given
    /// a byte pattern that is **not a palindrome**, so a flipped byte order is
    /// a different four octets rather than the same ones.
    #[test]
    fn the_encoded_body_carries_the_element_table_the_binding_states() {
        // Distinct in every octet, so a reversal is visible.
        const HASH: u32 = 0x1122_3344;
        let id = BeaconId::new(&[0xA1, 0xB2, 0xC3, 0xD4]).expect("4 octets");
        let decl = BeaconDeclarations {
            class_hash: HASH,
            summary_carried: false,
            build_mode: BuildMode::Development,
            duty_class: DutyClass::Unknown,
        };
        let mut out = [0u8; 64];
        let n = encode(id, &decl, &mut out).expect("encodes");
        let body = &out[..n];

        // Walk the body as a peer would: type, length, value.
        let mut seen = alloc::vec::Vec::new();
        let mut at = 0usize;
        while at + 2 <= body.len() {
            let (ty, len) = (body[at], body[at + 1] as usize);
            seen.push((ty, len, body[at + 2..at + 2 + len].to_vec()));
            at += 2 + len;
        }
        assert_eq!(at, body.len(), "the body is exactly its elements");

        // ‼ BND3-027: the element TABLE, read off the wire.
        assert_eq!(seen[0].0, 0x01, "beacon identifier is element 0x01");
        assert_eq!(seen[0].1, 4, "and four octets wide");
        assert_eq!(seen[0].2, alloc::vec![0xA1, 0xB2, 0xC3, 0xD4]);
        assert_eq!(seen[1].0, 0x02, "class hash is element 0x02");
        assert_eq!(seen[1].1, 4, "and four octets wide");
        // ‼ BND1-019: FOUR OCTETS, BIG-ENDIAN, on the wire. The pattern is not
        //   a palindrome, so a reversal fails here rather than passing.
        assert_eq!(
            seen[1].2,
            alloc::vec![0x11, 0x22, 0x33, 0x44],
            "5.4.1: big-endian — a little-endian write is 0x44 0x33 0x22 0x11"
        );
        assert_eq!(seen[2].0, 0x03, "build-mode declaration is element 0x03");
        assert_eq!(seen[2].1, 1, "and one octet wide");

        // Ascending type order (5.3.1), read from the body rather than assumed.
        for w in seen.windows(2) {
            assert!(w[0].0 < w[1].0, "elements ascend by type: {seen:?}");
        }

        // And the decoder agrees with the encoder about the same bytes, which
        // is the round trip the two rows are really about.
        let back = decode(body);
        assert!(!back.truncated);
        assert_eq!(back.declarations.class_hash, HASH);
        assert_eq!(
            back.beacon_id.map(|b| b.as_bytes().to_vec()),
            Some(alloc::vec![0xA1, 0xB2, 0xC3, 0xD4])
        );
    }

    /// ‼ **6.2: A PRODUCTION ANNOUNCEMENT CARRIES NO DEVELOPMENT-RELATED
    /// OCTET, AND THE SIZING IS ASSERTED AT THE BUFFER RATHER THAN AT A
    /// LENGTH.** The refutation was exact: inflating `needed` left the named
    /// test green, because it asserted a body LENGTH — which pins the write
    /// loop, not the sizing. *`needed` is used only to refuse a short buffer,
    /// so the only thing it can get wrong is refusing one that would have
    /// fitted, and no assertion on the output can see that.*
    ///
    /// So this encodes into a buffer of EXACTLY the produced length and
    /// requires success, then into one octet less and requires `TooSmall`.
    /// Inflating the sizing reddens the first; understating it reddens the
    /// second.
    #[test]
    fn a_production_body_carries_no_development_octet_and_is_sized_exactly() {
        let id = BeaconId::new(&[0xA1, 0xB2, 0xC3, 0xD4]).expect("4 octets");
        let decl = BeaconDeclarations {
            class_hash: 0x1122_3344,
            summary_carried: false,
            build_mode: BuildMode::Production,
            duty_class: DutyClass::Unknown,
        };

        let mut roomy = [0u8; 64];
        let n = encode(id, &decl, &mut roomy).expect("encodes");

        // ‼ 6.2: no element 0x03 ANYWHERE, walked as elements rather than
        //   searched as bytes — a 0x03 inside a value is not an element, and
        //   a byte scan would report one.
        let mut at = 0usize;
        let mut types = alloc::vec::Vec::new();
        while at + 2 <= n {
            types.push(roomy[at]);
            at += 2 + roomy[at + 1] as usize;
        }
        assert_eq!(at, n, "the body is exactly its elements");
        assert!(
            !types.contains(&0x03),
            "6.2: a production image carries no build-mode element: {types:?}"
        );
        assert_eq!(types, alloc::vec![0x01, 0x02], "only the two 5.1 mandates");

        // THE CONTROL: development DOES carry it, so the assertion above is
        // about the build mode and not about an encoder that emits nothing.
        let dev = BeaconDeclarations {
            build_mode: BuildMode::Development,
            ..decl
        };
        let mut d = [0u8; 64];
        let dn = encode(id, &dev, &mut d).expect("encodes");
        assert!(dn > n, "the development body is longer by its element");

        // ‼ THE SIZING, ASSERTED AT THE BUFFER. Exactly enough must be
        //   accepted; one octet less must be refused, and by NAME.
        let mut exact = alloc::vec![0u8; n];
        assert_eq!(
            encode(id, &decl, &mut exact),
            Ok(n),
            "a buffer of exactly the produced length must be accepted — an \
             inflated `needed` refuses one that fits"
        );
        let mut short = alloc::vec![0u8; n - 1];
        assert_eq!(
            encode(id, &decl, &mut short),
            Err(EncodeError::TooSmall { needed: n }),
            "one octet less is refused, and the refusal states what was needed"
        );
    }
}
