//! **An entanglement surviving a restart (L5A 8.5), and what must NOT be
//! stored to achieve it.**
//!
//! # ‼ THE KEYS ARE NOT PERSISTED, AND THAT IS THE DESIGN RATHER THAN A GAP
//!
//! **8.5**: *an entanglement shall survive restart: a side holding its group
//! material **and the artefact** holds the entanglement (5.2.4), and
//! conditions are re-evaluated on return.* The clause names the two things a
//! side must hold and **the derived keys are not among them** — 5.2.4 makes
//! them *re-derivable from the artefact and the groups' retained material*,
//! which Note 1 calls the durability rule and the reason *an entanglement
//! survives a crash without a resumption protocol.*
//!
//! **So writing the keys down would be strictly worse than not.** L5 **5.3.2**
//! forbids plaintext key material at rest in every case, and a record holding
//! them would put the entanglement's traffic keys on disk **to obtain
//! something the artefact already gives for free.**
//!
//! # What this record is: a witness, not a copy
//!
//! **4.1.3**: *each group shall hold its own copy of the signed artefact, and
//! every judgement this document requires shall be made against it.* The
//! artefact is therefore **already held** — this record does not duplicate
//! it, because *a second copy is a second thing to drift.* It stores the
//! **standing** (which 8.3's demotion changes and the artefact does not) and
//! a **digest binding it to one artefact**, so a standing cannot be restored
//! against a different agreement than the one it was earned under.
//!
//! # A torn write must be caught, and this is why
//!
//! A half-written record accepted as valid would restore a standing that no
//! longer matches what the counterpart re-derives from the same artefact
//! (5.2.4) — **so crossings would resume under a relationship the two sides
//! describe differently**, and every frame would fail its gate for a reason
//! neither side could see. *A refusal to restore is recoverable; a
//! confidently wrong restore is not.*

use crate::entanglement::Ending;
use crate::gate::Grade;

/// `R2EN`, so a scan can tell a written record from erased storage.
const MAGIC: [u8; 4] = *b"R2EN";
/// This record's version. **An unknown version is refused, never
/// best-guessed**: a reader that skipped fields it did not know would restore
/// a standing from a record it did not understand.
const VERSION: u8 = 1;

/// Octets one record occupies.
pub const RECORD_LEN: usize = 4 + 1 + 8 + 1 + 1 + 32 + 4;

/// The standing of one entanglement, as written down.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct StandingRecord {
    /// Increases with each write, so the newer of two records wins.
    pub generation: u64,
    /// ‼ **LIVE STANDING, WHICH IS NOT THE AGREED GRADE.** `Artefact::grade`
    /// is a **term** — what the two groups agreed the counterpart's identity
    /// is verified at — and this is where it stands **now**, which L5 10.3.2
    /// demotion lowers. *A demotion must not rewrite the agreement, and an
    /// agreement must not silently restore a demoted standing*, which is
    /// exactly why the standing is the thing worth persisting.
    pub standing: Grade,
    /// How it ended, if it has (8.1). `None` is live.
    pub ending: Option<Ending>,
    /// **Binds this standing to one artefact (4.1.3).** Computing it is the
    /// caller's — FORMATS Clause 3 owns the hash, and *a trust crate picking
    /// its own would be answering a formats question by writing code.*
    pub terms_digest: [u8; 32],
}

/// Why a record could not be restored.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RestoreRefusal {
    /// Not this record: too short, or the magic is absent.
    ///
    /// **Distinct from `Torn`** — an untouched region is a definite fact
    /// (*no entanglement was stored*), and bytes that are neither erased nor
    /// valid are not.
    NotARecord,
    /// The checksum failed: a torn or corrupted write.
    ///
    /// ‼ **REFUSED, NOT REPAIRED.** A half-written record accepted as valid
    /// restores a standing the counterpart's re-derivation will not match,
    /// so *crossings resume under a relationship the two sides describe
    /// differently and every frame fails its gate for a reason neither can
    /// see.*
    Torn,
    /// A version this reader does not know.
    UnknownVersion { found: u8 },
    /// The stored discriminants are not values this reader defines.
    Undecodable,
    /// **The record is sound and is about a different agreement.** Checked
    /// separately from `Torn` because it is not corruption: it is a standing
    /// being offered against an artefact it was not earned under.
    DifferentArtefact,
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// ‼ **EXHAUSTIVE AND EXPLICIT, NOT A CAST.** `Grade` carries no
/// discriminants, so `as u8` would renumber every stored standing the moment
/// a variant is inserted — *a record written before the change would restore
/// as a different grade after it*, silently, and a demotion is exactly the
/// direction that would go unnoticed.
const fn grade_code(g: Grade) -> u8 {
    match g {
        Grade::Opportunistic => 0,
        Grade::Confirmed => 1,
        Grade::Introduced => 2,
        Grade::Ceremonial => 3,
    }
}

const fn grade_of(code: u8) -> Option<Grade> {
    match code {
        0 => Some(Grade::Opportunistic),
        1 => Some(Grade::Confirmed),
        2 => Some(Grade::Introduced),
        3 => Some(Grade::Ceremonial),
        _ => None,
    }
}

const fn ending_code(e: Option<Ending>) -> u8 {
    match e {
        None => 0,
        Some(Ending::Completion) => 1,
        Some(Ending::Lapse) => 2,
        Some(Ending::Severance) => 3,
        Some(Ending::Dissolution) => 4,
    }
}

const fn ending_of(code: u8) -> Option<Option<Ending>> {
    match code {
        0 => Some(None),
        1 => Some(Some(Ending::Completion)),
        2 => Some(Some(Ending::Lapse)),
        3 => Some(Some(Ending::Severance)),
        4 => Some(Some(Ending::Dissolution)),
        _ => None,
    }
}

impl StandingRecord {
    /// Write this record.
    pub fn write(&self, out: &mut [u8; RECORD_LEN]) {
        out[..4].copy_from_slice(&MAGIC);
        out[4] = VERSION;
        out[5..13].copy_from_slice(&self.generation.to_be_bytes());
        out[13] = grade_code(self.standing);
        out[14] = ending_code(self.ending);
        out[15..47].copy_from_slice(&self.terms_digest);
        let sum = crc32(&out[..47]);
        out[47..51].copy_from_slice(&sum.to_be_bytes());
    }

    /// Read a record, refusing anything that is not certainly one.
    pub fn read(bytes: &[u8]) -> Result<Self, RestoreRefusal> {
        if bytes.len() < RECORD_LEN || bytes[..4] != MAGIC {
            return Err(RestoreRefusal::NotARecord);
        }
        if bytes[4] != VERSION {
            return Err(RestoreRefusal::UnknownVersion { found: bytes[4] });
        }
        // ‼ THE CHECKSUM BEFORE THE FIELDS. A torn record may hold field
        // values that decode perfectly and mean nothing.
        let stated = u32::from_be_bytes([bytes[47], bytes[48], bytes[49], bytes[50]]);
        if stated != crc32(&bytes[..47]) {
            return Err(RestoreRefusal::Torn);
        }
        let mut gen = [0u8; 8];
        gen.copy_from_slice(&bytes[5..13]);
        let standing = grade_of(bytes[13]).ok_or(RestoreRefusal::Undecodable)?;
        let ending = ending_of(bytes[14]).ok_or(RestoreRefusal::Undecodable)?;
        let mut terms_digest = [0u8; 32];
        terms_digest.copy_from_slice(&bytes[15..47]);
        Ok(Self {
            generation: u64::from_be_bytes(gen),
            standing,
            ending,
            terms_digest,
        })
    }

    /// **Restore this standing against the artefact the caller holds
    /// (4.1.3, 8.5).**
    ///
    /// ‼ **THE ARTEFACT IS THE CALLER'S AND IS NOT IN THE RECORD.** 4.1.3
    /// obliges each group to hold its own copy, so it is already held — *a
    /// second copy here would be a second thing to drift.* This checks that
    /// the standing belongs to **that** artefact and refuses otherwise.
    ///
    /// ‼ **AND AN ENDED ENTANGLEMENT RESTORES AS ENDED.** 8.2's *crossings
    /// under them fail the gate from that moment* does not stop at a reboot,
    /// and a restart that quietly revived a severed relationship would be the
    /// most useful bug an attacker could ask for.
    pub fn restore(&self, held_terms_digest: &[u8; 32]) -> Result<Restored, RestoreRefusal> {
        if &self.terms_digest != held_terms_digest {
            return Err(RestoreRefusal::DifferentArtefact);
        }
        Ok(Restored {
            standing: self.standing,
            ending: self.ending,
        })
    }
}

/// What a restart recovers: the standing and how it ended, **and no keys.**
///
/// The caller re-derives the traffic keys from the artefact and its retained
/// group material through
/// [`crate::entanglement::derive_entanglement_keys`], which is 5.2.4 and is
/// why they were never written down.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Restored {
    pub standing: Grade,
    pub ending: Option<Ending>,
}

impl Restored {
    /// Whether crossings may resume (8.2).
    ///
    /// **Conditions are re-evaluated on return** (8.5), so this answers only
    /// *did the relationship end*; a live one still faces its conditions.
    pub const fn may_resume(&self) -> bool {
        self.ending.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(b: u8) -> [u8; 32] {
        [b; 32]
    }

    fn record() -> StandingRecord {
        StandingRecord {
            generation: 3,
            standing: Grade::Confirmed,
            ending: None,
            terms_digest: digest(0xA1),
        }
    }

    /// **8.5: an entanglement survives restart.** The standing goes out and
    /// comes back, against the artefact the side already holds.
    #[test]
    fn a_standing_survives_a_restart() {
        let mut buf = [0u8; RECORD_LEN];
        record().write(&mut buf);

        let back = StandingRecord::read(&buf).expect("reads");
        assert_eq!(back, record());
        let restored = back.restore(&digest(0xA1)).expect("same artefact");
        assert_eq!(restored.standing, Grade::Confirmed);
        assert!(restored.may_resume());
    }

    /// ‼ **THE KEYS ARE NOT IN THE RECORD, AND THAT IS THE POINT.** 5.2.4
    /// makes them re-derivable from the artefact and the retained group
    /// material, and L5 **5.3.2** forbids plaintext key material at rest —
    /// *so writing them would put the traffic keys on disk to obtain
    /// something the artefact already gives for free.*
    #[test]
    fn no_key_material_appears_in_the_record() {
        // A record whose digest is a recognisable pattern; if any key-shaped
        // material were stored the record would have to be longer than the
        // fields it declares.
        assert_eq!(
            RECORD_LEN,
            4 + 1 + 8 + 1 + 1 + 32 + 4,
            "magic, version, generation, standing, ending, digest, checksum — and no key"
        );
        let mut buf = [0u8; RECORD_LEN];
        record().write(&mut buf);
        // The only 32-byte field is the digest the caller supplied.
        assert_eq!(&buf[15..47], &digest(0xA1)[..]);
    }

    /// ‼ **A TORN WRITE IS REFUSED, NOT REPAIRED.** Accepting one restores a
    /// standing the counterpart's re-derivation will not match, so
    /// *crossings resume under a relationship the two sides describe
    /// differently and every frame fails its gate for a reason neither can
    /// see.* **A refusal is recoverable; a confidently wrong restore is
    /// not.**
    #[test]
    fn a_torn_record_is_refused_rather_than_repaired() {
        let mut buf = [0u8; RECORD_LEN];
        record().write(&mut buf);

        // Every single-byte corruption in the covered span must be caught.
        for i in 0..47 {
            let mut torn = buf;
            torn[i] ^= 0x01;
            let got = StandingRecord::read(&torn);
            assert!(
                got.is_err(),
                "corruption at octet {i} was accepted: {got:?}"
            );
        }
        // A truncated record is not a record.
        assert_eq!(
            StandingRecord::read(&buf[..RECORD_LEN - 1]),
            Err(RestoreRefusal::NotARecord)
        );
        assert_eq!(StandingRecord::read(&[]), Err(RestoreRefusal::NotARecord));
    }

    /// ‼ **A SOUND RECORD ABOUT A DIFFERENT AGREEMENT IS REFUSED, AND IT IS
    /// NOT CORRUPTION.** 4.1.3 makes every judgement one against the signed
    /// artefact, so *a standing offered against an artefact it was not earned
    /// under is a standing from another relationship.*
    #[test]
    fn a_standing_does_not_restore_against_a_different_artefact() {
        let mut buf = [0u8; RECORD_LEN];
        record().write(&mut buf);
        let back = StandingRecord::read(&buf).expect("reads");
        assert_eq!(
            back.restore(&digest(0xB2)),
            Err(RestoreRefusal::DifferentArtefact)
        );
        assert!(back.restore(&digest(0xA1)).is_ok(), "control");
    }

    /// ‼ **AN ENDED ENTANGLEMENT RESTORES AS ENDED.** 8.2's *crossings under
    /// them fail the gate from that moment* does not stop at a reboot, and a
    /// restart that quietly revived a severed relationship would be the most
    /// useful bug an attacker could ask for. All four endings are swept,
    /// because a check written against severance alone would revive a lapsed
    /// one.
    #[test]
    fn an_ended_entanglement_does_not_come_back_live() {
        for ending in [
            Ending::Completion,
            Ending::Lapse,
            Ending::Severance,
            Ending::Dissolution,
        ] {
            let r = StandingRecord {
                ending: Some(ending),
                ..record()
            };
            let mut buf = [0u8; RECORD_LEN];
            r.write(&mut buf);
            let restored = StandingRecord::read(&buf)
                .expect("reads")
                .restore(&digest(0xA1))
                .expect("same artefact");
            assert_eq!(restored.ending, Some(ending));
            assert!(!restored.may_resume(), "{ending:?} must not resume");
        }
    }

    /// **A demoted standing is what is restored, not the agreed grade.** L5
    /// 10.3.2's demotion lowers the standing and *must not rewrite the
    /// agreement*; equally *an agreement must not silently restore a demoted
    /// standing.*
    #[test]
    fn the_restored_standing_is_the_live_one_and_not_the_agreed_grade() {
        let demoted = StandingRecord {
            standing: Grade::Opportunistic,
            ..record()
        };
        let mut buf = [0u8; RECORD_LEN];
        demoted.write(&mut buf);
        let restored = StandingRecord::read(&buf)
            .unwrap()
            .restore(&digest(0xA1))
            .unwrap();
        assert_eq!(restored.standing, Grade::Opportunistic);
    }

    /// An unknown version is refused rather than best-guessed: *a reader that
    /// skipped fields it did not know would restore a standing from a record
    /// it did not understand.*
    #[test]
    fn an_unknown_version_is_refused() {
        let mut buf = [0u8; RECORD_LEN];
        record().write(&mut buf);
        buf[4] = 9;
        // Re-checksum so the version is the only complaint.
        let sum = crc32(&buf[..47]);
        buf[47..51].copy_from_slice(&sum.to_be_bytes());
        assert_eq!(
            StandingRecord::read(&buf),
            Err(RestoreRefusal::UnknownVersion { found: 9 })
        );
    }

    /// The newer generation wins, so a side that wrote twice restores the
    /// second.
    #[test]
    fn the_generation_orders_two_records() {
        let older = record();
        let newer = StandingRecord {
            generation: 4,
            standing: Grade::Opportunistic,
            ..record()
        };
        assert!(newer.generation > older.generation);
        let mut a = [0u8; RECORD_LEN];
        let mut b = [0u8; RECORD_LEN];
        older.write(&mut a);
        newer.write(&mut b);
        let (ra, rb) = (
            StandingRecord::read(&a).unwrap(),
            StandingRecord::read(&b).unwrap(),
        );
        let winner = if rb.generation > ra.generation {
            rb
        } else {
            ra
        };
        assert_eq!(winner.standing, Grade::Opportunistic);
    }
}
