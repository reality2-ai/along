//! **The persona record: what durable storage holds, and what reading it
//! alone can decide** (L6 5.5.3a).
//!
//! # WHY THE PLATFORM CARRIES BYTES AND NOT A `Persona`
//!
//! Until 2026-08-07 the platform handed back a [`crate::Persona`] and the
//! crate believed it. **Two things killed that.** [`crate::Persona`]'s
//! fields are now sealed, so a platform *cannot construct one* — the only
//! remaining producer of the old `Found` variant was **replay**, handing
//! back a persona the hive was already running. And the refuter's finding
//! on the other half: `restore(&Persona) -> bool` **attests custody for
//! any bytes**, so a provenance token minted from that boolean is not
//! proof of anything.
//!
//! So the platform's job is narrowed to what a platform can honestly do:
//! **keep bytes it was given and hand the same bytes back.** *It never
//! interprets them, and nothing it says about them is trusted.*
//!
//! # WHAT `SELF-VALIDATING` MEANS HERE, AND WHAT IT DOES NOT
//!
//! **L6 5.5.3a: a persona disposition shall be determinable at boot from
//! durable storage alone, and shall be self-validating — *a complete
//! record is distinguishable from an incomplete one by reading that
//! storage and nothing else*.**
//!
//! That is a **completeness** obligation and this module meets it
//! exactly: the record carries its own length and a checksum over its
//! body, so a truncated, padded or partially-written record is rejected
//! without consulting anything outside the bytes.
//!
//! **IT IS NOT AN AUTHENTICITY OBLIGATION AND THIS MODULE DOES NOT CLAIM
//! ONE.** Nothing here proves the record was written *by this device*. On
//! a platform with no hardware-rooted secret there is nothing to bind it
//! to — that is `STD-SS271` and the open L0 10.4 gap — so a record copied
//! from another device of the same build reads as complete here. *The
//! honest boundary is that completeness is checkable from the bytes and
//! authenticity is not, and 5.5.3a asks for the first.*
//!
//! **A checksum is used rather than a keyed tag deliberately.** A keyed
//! tag whose key is compiled into the image would look like authenticity
//! and provide none, since anyone holding the image holds the key —
//! *which is the shape this lane keeps finding in other people's work.*
//! **When a hardware-rooted secret exists, the tag becomes keyed and this
//! paragraph is what must be re-read.**

use crate::crypto::IDENTITY_LEN;
use crate::identity::Identity;
use crate::membership::ClaimState;

/// Bytes as durable storage holds them. **Opaque to the platform**: it
/// receives them from [`encode`] and hands them back unaltered.
/// **IT OWNS ITS BYTES RATHER THAN BORROWING THEM, AND THAT IS A CALLER
/// DECISION RATHER THAN A STORAGE ONE.** A borrowing form put a lifetime
/// on [`crate::surface::StoredPersona`], which propagated to
/// `Trust::boot` and to **every consumer** — for a payload of
/// [`RECORD_LEN`] bytes. *A lifetime that buys nothing costs every caller
/// a borrow to arrange*, and the platform reading this out of flash has a
/// buffer whose lifetime it should not have to reason about.
///
/// **The observed length is kept even when it exceeds the capacity**, so
/// a too-long record is still reportable as [`RecordDefect::WrongLength`]
/// rather than silently truncated into a valid one. *A copy that
/// normalises its input destroys the evidence the check needs.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SealedRecord {
    bytes: [u8; RECORD_LEN],
    observed_len: usize,
}

impl SealedRecord {
    /// Take bytes read from storage. **No validation happens here** — a
    /// constructor that validated would make the invalid case
    /// unrepresentable, and *the invalid case is exactly what boot must
    /// be able to report*.
    pub fn from_storage(bytes: &[u8]) -> Self {
        let mut buf = [0u8; RECORD_LEN];
        let n = if bytes.len() < RECORD_LEN {
            bytes.len()
        } else {
            RECORD_LEN
        };
        buf[..n].copy_from_slice(&bytes[..n]);
        Self {
            bytes: buf,
            observed_len: bytes.len(),
        }
    }

    /// What storage actually held, which is **not** capped at
    /// [`RECORD_LEN`].
    pub const fn observed_len(&self) -> usize {
        self.observed_len
    }

    const fn body(&self) -> &[u8] {
        &self.bytes
    }
}

/// One byte of version, two identities, one claim byte, one checksum byte.
pub const RECORD_LEN: usize = 1 + IDENTITY_LEN + IDENTITY_LEN + 1 + 1;

const VERSION: u8 = 1;
const CLAIM_OPEN: u8 = 0x0A;
const CLAIM_OWNER: u8 = 0x0B;

/// **Two distinct byte values rather than 0 and 1**, so a zeroed or
/// erased region — the commonest shape of a partially written record —
/// **cannot decode as a valid claim state.** *An all-zero buffer is what
/// unprogrammed flash reads as, and it must not mean `Open`.*
const fn claim_byte(c: ClaimState) -> u8 {
    match c {
        ClaimState::Open => CLAIM_OPEN,
        ClaimState::Owner => CLAIM_OWNER,
    }
}

const fn claim_from(b: u8) -> Option<ClaimState> {
    match b {
        CLAIM_OPEN => Some(ClaimState::Open),
        CLAIM_OWNER => Some(ClaimState::Owner),
        _ => None,
    }
}

/// Sum of every prior byte, wrapping. **Detects truncation, a stuck bus
/// and a half-written page; it detects nothing an adversary does.** Said
/// plainly at the site because a reader who sees a checksum and thinks
/// *integrity* has read it as more than it is.
fn checksum(body: &[u8]) -> u8 {
    let mut sum: u8 = 0;
    let mut i = 0;
    while i < body.len() {
        sum = sum.wrapping_add(body[i]);
        i += 1;
    }
    sum
}

/// Produce the bytes a platform is to keep.
pub fn encode(
    group: Identity,
    member: Identity,
    claim: ClaimState,
    out: &mut [u8],
) -> Option<usize> {
    if out.len() < RECORD_LEN {
        return None;
    }
    out[0] = VERSION;
    out[1..1 + IDENTITY_LEN].copy_from_slice(&group.0);
    out[1 + IDENTITY_LEN..1 + 2 * IDENTITY_LEN].copy_from_slice(&member.0);
    out[1 + 2 * IDENTITY_LEN] = claim_byte(claim);
    out[RECORD_LEN - 1] = checksum(&out[..RECORD_LEN - 1]);
    Some(RECORD_LEN)
}

/// Why a record could not be read as complete.
///
/// **Reported rather than folded into one *unreadable*, because the three
/// want different actions**: a wrong length is a storage bug, a wrong
/// checksum is corruption, and an unknown version is a downgrade or a
/// forward-dated image. *Folding them is how a hive silently becomes a
/// different device* — the same argument `StoredPersona` already makes
/// for keeping `NeverWritten` and `Unreadable` apart.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecordDefect {
    WrongLength,
    UnknownVersion(u8),
    ChecksumMismatch,
    UndecodableClaim(u8),
}

/// Read a record, deciding **from the bytes and nothing else** whether it
/// is complete (5.5.3a).
pub fn decode(record: SealedRecord) -> Result<(Identity, Identity, ClaimState), RecordDefect> {
    if record.observed_len() != RECORD_LEN {
        return Err(RecordDefect::WrongLength);
    }
    let b = record.body();
    if b[0] != VERSION {
        return Err(RecordDefect::UnknownVersion(b[0]));
    }
    if checksum(&b[..RECORD_LEN - 1]) != b[RECORD_LEN - 1] {
        return Err(RecordDefect::ChecksumMismatch);
    }
    let mut group = [0u8; IDENTITY_LEN];
    let mut member = [0u8; IDENTITY_LEN];
    group.copy_from_slice(&b[1..1 + IDENTITY_LEN]);
    member.copy_from_slice(&b[1 + IDENTITY_LEN..1 + 2 * IDENTITY_LEN]);
    let claim = claim_from(b[1 + 2 * IDENTITY_LEN])
        .ok_or(RecordDefect::UndecodableClaim(b[1 + 2 * IDENTITY_LEN]))?;
    Ok((Identity(group), Identity(member), claim))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    fn round_trip() -> [u8; RECORD_LEN] {
        let mut buf = [0u8; RECORD_LEN];
        encode(id(1), id(2), ClaimState::Owner, &mut buf).expect("fits");
        buf
    }

    #[test]
    fn a_written_record_reads_back_as_written() {
        let buf = round_trip();
        assert_eq!(
            decode(SealedRecord::from_storage(&buf)),
            Ok((id(1), id(2), ClaimState::Owner))
        );
    }

    /// **THE CASE THE CLAUSE IS ABOUT**: an incomplete record must be
    /// distinguishable from a complete one *by reading the storage and
    /// nothing else* (5.5.3a).
    #[test]
    fn a_truncated_record_is_not_complete() {
        let buf = round_trip();
        assert_eq!(
            decode(SealedRecord::from_storage(&buf[..RECORD_LEN - 1])),
            Err(RecordDefect::WrongLength)
        );
    }

    /// **ERASED FLASH MUST NOT DECODE.** All-zero is what an unprogrammed
    /// region reads as, and a claim encoding of 0/1 would have made it a
    /// valid `Open` persona belonging to the all-zero group.
    #[test]
    fn an_erased_region_does_not_decode_as_a_persona() {
        let zeros = [0u8; RECORD_LEN];
        assert!(decode(SealedRecord::from_storage(&zeros)).is_err());
        let ones = [0xFFu8; RECORD_LEN];
        assert!(decode(SealedRecord::from_storage(&ones)).is_err());
    }

    #[test]
    fn a_flipped_byte_fails_the_checksum() {
        let mut buf = round_trip();
        buf[3] ^= 0x01;
        assert_eq!(
            decode(SealedRecord::from_storage(&buf)),
            Err(RecordDefect::ChecksumMismatch)
        );
    }

    /// **THE EXCLUDED CASE FOR THE CHECKSUM ARM**: the checksum must
    /// reject a corrupted record *and* accept an intact one, or the test
    /// above passes for a reader that rejects everything.
    #[test]
    fn the_checksum_arm_accepts_an_intact_record() {
        let buf = round_trip();
        assert!(decode(SealedRecord::from_storage(&buf)).is_ok());
    }

    /// **AND THE LIMIT, MADE INTO A TEST SO IT CANNOT BE FORGOTTEN: A
    /// RECORD FROM ANOTHER DEVICE OF THE SAME BUILD READS AS COMPLETE.**
    /// This is not a defect in the decoder — *completeness is what 5.5.3a
    /// asks for and authenticity is what no hardware-rooted secret is
    /// available to provide* (`STD-SS271`, L0 10.4). **If this test ever
    /// starts failing, someone has added authenticity and this module's
    /// header is stale.**
    #[test]
    fn a_record_from_another_device_still_reads_as_complete() {
        let mut theirs = [0u8; RECORD_LEN];
        encode(id(0xAA), id(0xBB), ClaimState::Open, &mut theirs).expect("fits");
        assert_eq!(
            decode(SealedRecord::from_storage(&theirs)),
            Ok((id(0xAA), id(0xBB), ClaimState::Open)),
            "completeness is checkable from the bytes; authenticity is not"
        );
    }
}
