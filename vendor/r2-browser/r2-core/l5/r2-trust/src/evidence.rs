//! Evidence beyond the gate (L5 7.4).
//!
//! The gate establishes that a frame is the group's, and nothing more —
//! every member can tag any frame, and a captured frame replays with a
//! valid tag (L5 7.2 Note 1). So an operation whose effect depends on
//! *which member* asked, or on *when*, requires evidence of its own
//! (7.2.3): a signature by that member's key over the operation together
//! with a freshness token, accompanied by the member's certificate
//! (7.4.1 / L5-066).
//!
//! **The verifier needs no roster.** It verifies the chain against the
//! issuing group's public key alone (7.4.2 / L5-067, L5-068) — which is
//! what lets a hive that has never met the sender, and holds no list of
//! who belongs, still judge the claim.
//!
//! **Neither freshness form requires absolute time** (7.4.3 / L5-072).
//!
//! **Check ordering matters and the spec does not state it.** The
//! high-water mark is advanced only *after* the member signature
//! verifies. A certificate is public — 6.1.4 has them re-issued in the
//! background, and 7.4.1 has them accompany every piece of evidence — so
//! if an unverified token could advance the mark, anyone who had seen a
//! member's certificate could replay it with a bogus signature and a high
//! sequence number, locking the real member out until the next epoch.
//! Reported to the standard lane as a d013 learning.

use crate::certificate::{Certificate, Epoch};
use crate::crypto::{Verifier, SIGNATURE_LEN};
use crate::identity::Identity;

/// A freshness token (L5 7.4.3 / L5-069). Exactly two forms exist, and
/// neither requires absolute time.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Freshness {
    /// For an interactive exchange: a nonce issued by the **verifier** for
    /// this exchange. Its freshness is guaranteed by the verifier having
    /// just chosen it, so no ordering state is needed.
    Nonce([u8; 16]),
    /// Otherwise: a monotonic `(epoch, sequence)` token, ordered against a
    /// per-origin high-water mark.
    Counter { epoch: Epoch, sequence: u64 },
}

/// Evidence attributable to a member (L5 7.4.1).
#[derive(Clone, Copy, Debug)]
pub struct MemberEvidence<'a> {
    /// The member's certificate, binding the signing key to the group.
    pub certificate: Certificate,
    /// The operation or claim being attested.
    pub statement: &'a [u8],
    pub freshness: Freshness,
    /// Signature by the member key over statement ‖ freshness.
    pub signature: [u8; SIGNATURE_LEN],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SigningRefusal {
    WrongSubject,
    StatementTooLong,
}

/// Sign the same complete statement/freshness representation verification uses.
/// This does not authenticate the supplied certificate or establish its currency;
/// receivers must still verify the full chain and their own freshness state.
pub fn sign<'a, S: crate::crypto::Signer>(
    signer: &S,
    certificate: Certificate,
    statement: &'a [u8],
    freshness: Freshness,
) -> Result<MemberEvidence<'a>, SigningRefusal> {
    if signer.identity() != certificate.subject.0 {
        return Err(SigningRefusal::WrongSubject);
    }
    let mut evidence = MemberEvidence {
        certificate,
        statement,
        freshness,
        signature: [0; SIGNATURE_LEN],
    };
    let mut message = [0; MAX_STATEMENT + 32];
    let n =
        write_signed_message(&evidence, &mut message).ok_or(SigningRefusal::StatementTooLong)?;
    evidence.signature = signer.sign(&message[..n]);
    Ok(evidence)
}

/// Why evidence was refused. Distinguishable so a caller can act, but note
/// that none of these are wire-visible refusal reasons — L6 5.2.4's
/// silence-preserving rule applies to what a hive *says*, not to what it
/// knows.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EvidenceRefusal {
    /// The certificate is not for the group we are verifying against.
    WrongGroup,
    /// The certificate's signature does not verify under the group key.
    CertificateNotAuthentic,
    /// The certificate is not current (stale beyond acceptance depth, or
    /// the subject is revoked) — judged by
    /// [`crate::certificate::standing`].
    CertificateNotCurrent,
    /// The member signature does not verify under the certificate's
    /// subject.
    SignatureInvalid,
    /// The nonce is not the one this verifier issued for this exchange, or
    /// counter evidence was offered in place of the requested nonce.
    NonceMismatch,
    /// The token does not exceed the last accepted for this origin
    /// (7.4.3 / L5-071) — a replay, or an out-of-order arrival, which are
    /// indistinguishable and treated alike.
    NotFresh,
    /// ‼ **The statement is longer than this build can attest over.**
    ///
    /// **This refusal replaces a SILENT TRUNCATION, and the truncation was
    /// a live defect rather than a tidiness one.** `write_signed_message`
    /// used to clamp the statement to [`MAX_STATEMENT`] — then 256 — so
    /// **two statements differing only past the clamp produced the same
    /// signed bytes** — a signature over the first was a valid signature
    /// over the second. In `hive`'s words: *that is not a truncation bug,
    /// it is a signature that does not bind what it appears to bind, and it
    /// fails silently in the direction that produces a valid-looking proof
    /// of the wrong statement.* Anything whose meaning lived past the clamp was outside the
    /// signature while looking like it was under it.
    ///
    /// Found while wiring L5A 4.1.2, whose Note 1 names this exact hazard
    /// one layer up: *terms that travelled beside a signature rather than
    /// under it could drift apart from it.* Here they did not even travel
    /// beside it — **they were dropped, and nothing said so.**
    StatementTooLong,
}

/// Per-origin high-water mark (L5 7.4.3 / L5-070).
///
/// Bounded at `N` origins. A full table refuses new origins rather than
/// evicting: evicting a mark would accept a replay from the evicted
/// origin, which is the exact failure the mark exists to prevent.
pub struct HighWaterMarks<const N: usize> {
    entries: [Option<(Identity, Epoch, u64)>; N],
    len: usize,
}

impl<const N: usize> Default for HighWaterMarks<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> HighWaterMarks<N> {
    pub const fn new() -> Self {
        Self {
            entries: [None; N],
            len: 0,
        }
    }

    /// Whether `(epoch, sequence)` would be accepted for `origin`, without
    /// changing anything. Used as a cheap pre-filter before the expensive
    /// signature check, so an obvious replay costs no curve arithmetic.
    ///
    /// Ordering is lexicographic on `(epoch, sequence)`: a new epoch
    /// restarts the sequence, and 8.5 makes epochs strictly increasing, so
    /// the pair is monotonic across rotations without any clock.
    pub fn would_accept(&self, origin: &Identity, epoch: Epoch, sequence: u64) -> bool {
        for slot in self.entries[..self.len].iter().flatten() {
            if &slot.0 == origin {
                return (epoch, sequence) > (slot.1, slot.2);
            }
        }
        // A new origin is acceptable only if there is room: refusing beats
        // evicting, since an evicted mark accepts a replay.
        self.len < N
    }

    /// Advance the mark for `origin`.
    ///
    /// **Call only after the member signature has verified.** The mark is
    /// advanced by evidence, and evidence is only evidence once signed —
    /// advancing on an unverified token lets anyone holding the member's
    /// (public) certificate burn sequence numbers and lock the real member
    /// out. See the module note on check ordering.
    pub fn accept(&mut self, origin: &Identity, epoch: Epoch, sequence: u64) -> bool {
        for slot in self.entries[..self.len].iter_mut().flatten() {
            if &slot.0 == origin {
                if (epoch, sequence) > (slot.1, slot.2) {
                    slot.1 = epoch;
                    slot.2 = sequence;
                    return true;
                }
                return false;
            }
        }
        if self.len == N {
            return false;
        }
        self.entries[self.len] = Some((*origin, epoch, sequence));
        self.len += 1;
        true
    }

    pub const fn len(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Verify member-attributable evidence (L5 7.4).
///
/// `group` is the issuing group's public key — **the only group material
/// needed** (7.4.2). `cert_is_current` is the caller's result from
/// [`crate::certificate::standing`], kept as an input so this function has
/// no opinion about epochs it cannot see.
///
/// The signed message is `statement ‖ freshness`, so evidence cannot be
/// lifted from one exchange and replayed into another with a different
/// token.
/// `Some(expected_nonce)` selects an interactive exchange and requires that
/// nonce form. `None` permits only counter evidence and its retained marks.
/// A sender cannot select the other mode to bypass the verifier's challenge.
pub fn verify_evidence<V: Verifier, const N: usize>(
    evidence: &MemberEvidence<'_>,
    group: &Identity,
    cert_is_current: bool,
    cert_authentic: bool,
    expected_nonce: Option<&[u8; 16]>,
    marks: &mut HighWaterMarks<N>,
) -> Result<Identity, EvidenceRefusal> {
    // ‼ FIRST, because it is a fact about whether we can represent what was
    // signed at all — every check below it reasons about "the statement",
    // and under the old clamp that phrase silently meant "its first 256
    // bytes". A refusal here is honest; a pass over a prefix was not.
    if evidence.statement.len() > MAX_STATEMENT {
        return Err(EvidenceRefusal::StatementTooLong);
    }
    if &evidence.certificate.group != group {
        return Err(EvidenceRefusal::WrongGroup);
    }
    // The chain: certificate authentic under the group key, then the
    // statement authentic under the certificate's subject (7.4.2).
    if !cert_authentic {
        return Err(EvidenceRefusal::CertificateNotAuthentic);
    }
    if !cert_is_current {
        return Err(EvidenceRefusal::CertificateNotCurrent);
    }

    // Freshness, checked but NOT yet recorded: a cheap pre-filter that
    // rejects obvious replays without curve arithmetic.
    match evidence.freshness {
        Freshness::Nonce(n) => match expected_nonce {
            Some(expected) if crate::crypto::ct_eq(&n, expected) => {}
            _ => return Err(EvidenceRefusal::NonceMismatch),
        },
        Freshness::Counter { epoch, sequence } => {
            if expected_nonce.is_some() {
                return Err(EvidenceRefusal::NonceMismatch);
            }
            if !marks.would_accept(&evidence.certificate.subject, epoch, sequence) {
                return Err(EvidenceRefusal::NotFresh);
            }
        }
    }

    let mut message = [0u8; MAX_STATEMENT + 32];
    let n = match write_signed_message(evidence, &mut message) {
        Some(n) => n,
        // Unreachable given the length check above, and written as a
        // refusal rather than an `unwrap` so that a future caller reaching
        // this function by another path cannot resurrect the clamp.
        None => return Err(EvidenceRefusal::StatementTooLong),
    };
    if !V::verify(
        &evidence.certificate.subject.0,
        &message[..n],
        &evidence.signature,
    ) {
        return Err(EvidenceRefusal::SignatureInvalid);
    }

    // Only now does the mark move. Certificates are public — they are
    // re-issued in the background and travel with every claim — so anyone
    // who has seen one could otherwise present it with a bogus signature
    // and a high sequence number, advancing our mark and locking the real
    // member out until the next epoch. The signature is what makes a token
    // evidence, so it is what earns the state change.
    if let Freshness::Counter { epoch, sequence } = evidence.freshness {
        if !marks.accept(&evidence.certificate.subject, epoch, sequence) {
            return Err(EvidenceRefusal::NotFresh);
        }
    }
    Ok(evidence.certificate.subject)
}

/// Longest statement this no-alloc implementation attests over.
///
/// ‼ **RAISED FROM 256 ON 2026-08-14, AND THE NUMBER CAME FROM A
/// MEASUREMENT RATHER THAN A PREFERENCE.** L5A agreement terms for eight
/// conditions of ordinary wording exceed 256 bytes, so artefacts the corpus
/// permits could not be signed. `hive` measured the platform this runs on
/// instead of estimating it — ESP32-S3-WROOM-1-N4, `.data` 20 240 +
/// `.bss` 452 604 = **472 844 bytes already committed against 524 288 of
/// internal SRAM, no PSRAM**, leaving **51 444 bytes for every stack and
/// the heap**. The one extra buffer here is `MAX_STATEMENT + 32`, so the
/// rise costs **256 bytes, 0.50 % of that headroom.**
///
/// ‼ **AND THE BOUND THAT WOULD ACTUALLY SETTLE IT DOES NOT EXIST**, in
/// `hive`'s words: *peak stack use has not been measured*, because that
/// needs a high-water mark read from a running board and that lane no
/// longer flashes. **The static footprint is exact and the dynamic peak is
/// unknown.** 0.5 % is comfortable against that uncertainty and 8 KiB
/// would not have been — *which is why the answer arrived with a scale
/// attached rather than as a yes.*
pub const MAX_STATEMENT: usize = 512;

/// Serialise `statement ‖ freshness` — the bytes the member signs.
///
/// ‼ **`None` rather than a clamp.** This used to write
/// `statement[..min(len, MAX_STATEMENT)]`, which meant a signature covered
/// a PREFIX of what the caller believed it covered, with no signal — see
/// [`EvidenceRefusal::StatementTooLong`].
fn write_signed_message(evidence: &MemberEvidence<'_>, out: &mut [u8]) -> Option<usize> {
    signing_bytes(evidence.statement, evidence.freshness, out)
}

/// Encode the exact message for an external platform signer, such as WebCrypto.
///
/// This shares the representation used by [`sign`] and evidence verification.
/// It authenticates nothing by itself. An oversized statement or short output
/// buffer returns `None` without writing a partial message.
pub fn signing_bytes(statement: &[u8], freshness: Freshness, out: &mut [u8]) -> Option<usize> {
    if statement.len() > MAX_STATEMENT || out.len() < statement.len().checked_add(17)? {
        return None;
    }
    let s = statement;
    out[..s.len()].copy_from_slice(s);
    let mut n = s.len();
    match freshness {
        Freshness::Nonce(nonce) => {
            out[n] = 0x01;
            n += 1;
            out[n..n + 16].copy_from_slice(&nonce);
            n += 16;
        }
        Freshness::Counter { epoch, sequence } => {
            out[n] = 0x02;
            n += 1;
            out[n..n + 8].copy_from_slice(&epoch.0.to_be_bytes());
            n += 8;
            out[n..n + 8].copy_from_slice(&sequence.to_be_bytes());
            n += 8;
        }
    }
    Some(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{IDENTITY_LEN, SIGNATURE_LEN};

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    /// Accepts any signature, so the tests exercise the *ordering* of the
    /// checks rather than the cryptography.
    struct AlwaysValid;
    impl Verifier for AlwaysValid {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], _: &[u8; SIGNATURE_LEN]) -> bool {
            true
        }
    }
    struct NeverValid;
    impl Verifier for NeverValid {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], _: &[u8; SIGNATURE_LEN]) -> bool {
            false
        }
    }

    fn evidence(subject: u8, group: u8, freshness: Freshness) -> MemberEvidence<'static> {
        MemberEvidence {
            certificate: Certificate {
                subject: id(subject),
                group: id(group),
                issued_at: Epoch(1),
                signature: [0; SIGNATURE_LEN],
            },
            statement: b"open the door",
            freshness,
            signature: [0; SIGNATURE_LEN],
        }
    }

    #[test]
    fn counter_must_exceed_the_high_water_mark() {
        // L5 7.4.3 / L5-071.
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let e = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 5,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&e, &id(9), true, true, None, &mut marks),
            Ok(id(1))
        );
        // Same token again: a replay.
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&e, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::NotFresh)
        );
        // Lower sequence: also refused.
        let older = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 4,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&older, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::NotFresh)
        );
        // Higher sequence advances it.
        let newer = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 6,
            },
        );
        assert!(
            verify_evidence::<AlwaysValid, 4>(&newer, &id(9), true, true, None, &mut marks).is_ok()
        );
    }

    #[test]
    fn a_new_epoch_outranks_any_sequence() {
        // Epochs are strictly increasing (8.5), so (epoch, sequence)
        // ordering is monotonic across rotations without a clock.
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let high_seq = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: u64::MAX,
            },
        );
        assert!(
            verify_evidence::<AlwaysValid, 4>(&high_seq, &id(9), true, true, None, &mut marks)
                .is_ok()
        );
        let next_epoch = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(2),
                sequence: 0,
            },
        );
        assert!(verify_evidence::<AlwaysValid, 4>(
            &next_epoch,
            &id(9),
            true,
            true,
            None,
            &mut marks
        )
        .is_ok());
    }

    #[test]
    fn marks_are_per_origin() {
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let a = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 5,
            },
        );
        let b = evidence(
            2,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 5,
            },
        );
        assert!(
            verify_evidence::<AlwaysValid, 4>(&a, &id(9), true, true, None, &mut marks).is_ok()
        );
        // Same token, different member: not a replay.
        assert!(
            verify_evidence::<AlwaysValid, 4>(&b, &id(9), true, true, None, &mut marks).is_ok()
        );
        assert_eq!(marks.len(), 2);
    }

    #[test]
    fn nonce_must_be_the_one_this_verifier_issued() {
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let e = evidence(1, 9, Freshness::Nonce([7; 16]));
        assert!(verify_evidence::<AlwaysValid, 4>(
            &e,
            &id(9),
            true,
            true,
            Some(&[7; 16]),
            &mut marks
        )
        .is_ok());
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&e, &id(9), true, true, Some(&[8; 16]), &mut marks),
            Err(EvidenceRefusal::NonceMismatch)
        );
        // No nonce issued at all: refused, never waved through.
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&e, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::NonceMismatch)
        );
    }

    #[test]
    fn chain_is_checked_before_freshness_advances_anything() {
        // A stranger must not be able to advance our high-water mark.
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let wrong = evidence(
            1,
            0xAA,
            Freshness::Counter {
                epoch: Epoch(9),
                sequence: 99,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&wrong, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::WrongGroup)
        );
        assert!(marks.is_empty());

        let not_authentic = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(9),
                sequence: 99,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(
                &not_authentic,
                &id(9),
                true,
                false,
                None,
                &mut marks
            ),
            Err(EvidenceRefusal::CertificateNotAuthentic)
        );
        assert!(marks.is_empty());
    }

    #[test]
    fn stale_certificate_refuses_even_with_a_good_signature() {
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let e = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 1,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&e, &id(9), false, true, None, &mut marks),
            Err(EvidenceRefusal::CertificateNotCurrent)
        );
    }

    #[test]
    fn a_bogus_signature_cannot_burn_a_members_sequence_numbers() {
        // Certificates are public. If an unverified token advanced the
        // mark, anyone holding a member's certificate could lock that
        // member out until the next epoch by replaying it with a high
        // sequence number and a junk signature.
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let forged = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 9_999,
            },
        );
        assert_eq!(
            verify_evidence::<NeverValid, 4>(&forged, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::SignatureInvalid)
        );
        assert!(marks.is_empty(), "a refused signature moved the mark");

        // The real member's ordinary next token still works.
        let genuine = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 1,
            },
        );
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&genuine, &id(9), true, true, None, &mut marks),
            Ok(id(1))
        );
    }

    #[test]
    fn bad_member_signature_refuses() {
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        let e = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 1,
            },
        );
        assert_eq!(
            verify_evidence::<NeverValid, 4>(&e, &id(9), true, true, None, &mut marks),
            Err(EvidenceRefusal::SignatureInvalid)
        );
    }

    #[test]
    fn full_mark_table_refuses_rather_than_evicting() {
        // Evicting a mark would accept a replay from the evicted origin.
        let mut marks: HighWaterMarks<1> = HighWaterMarks::new();
        assert!(marks.accept(&id(1), Epoch(1), 1));
        assert!(!marks.accept(&id(2), Epoch(1), 1));
    }

    #[test]
    fn signed_message_binds_statement_to_freshness() {
        // Evidence cannot be lifted from one exchange into another.
        let a = evidence(1, 9, Freshness::Nonce([1; 16]));
        let b = evidence(1, 9, Freshness::Nonce([2; 16]));
        let mut buf_a = [0u8; MAX_STATEMENT + 32];
        let mut buf_b = [0u8; MAX_STATEMENT + 32];
        let na = write_signed_message(&a, &mut buf_a).expect("short statement");
        let nb = write_signed_message(&b, &mut buf_b).expect("short statement");
        assert_ne!(buf_a[..na], buf_b[..nb]);
        // The two token forms are domain-separated from each other too.
        let c = evidence(
            1,
            9,
            Freshness::Counter {
                epoch: Epoch(1),
                sequence: 1,
            },
        );
        let mut buf_c = [0u8; MAX_STATEMENT + 32];
        let nc = write_signed_message(&c, &mut buf_c).expect("short statement");
        assert_ne!(buf_a[..na], buf_c[..nc]);
    }

    /// ‼ **THE DEFECT THIS REPLACED, PINNED SO IT CANNOT COME BACK.**
    ///
    /// `write_signed_message` clamped the statement to [`MAX_STATEMENT`],
    /// so **two statements differing only past byte 256 signed the same
    /// bytes** — a signature over one verified over the other. The
    /// precondition below asserts the two statements really do differ, so
    /// this cannot pass by comparing a pair that was never distinct.
    #[test]
    fn an_overlong_statement_is_refused_rather_than_clamped() {
        let mut long_a = [b'x'; MAX_STATEMENT + 8];
        let mut long_b = [b'x'; MAX_STATEMENT + 8];
        long_a[MAX_STATEMENT + 1] = b'A';
        long_b[MAX_STATEMENT + 1] = b'B';
        // PRECONDITION: distinct statements, agreeing on every byte the
        // clamp would have kept — exactly the pair it made
        // indistinguishable. Sized RELATIVE to the bound, so raising
        // `MAX_STATEMENT` moves the fixture with it rather than quietly
        // turning this into a test of a shorter statement.
        assert_ne!(long_a, long_b);
        assert_eq!(long_a[..MAX_STATEMENT], long_b[..MAX_STATEMENT]);

        let mut a = evidence(1, 9, Freshness::Nonce([1; 16]));
        let mut b = a;
        a.statement = &long_a;
        b.statement = &long_b;

        let mut buf = [0u8; MAX_STATEMENT + 32];
        assert!(write_signed_message(&a, &mut buf).is_none());
        assert!(write_signed_message(&b, &mut buf).is_none());

        // And the refusal reaches the caller rather than living only in the
        // serialiser: a verifier that accepts EVERY signature still refuses,
        // so the refusal is attributable to the length and not to the crypto.
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            verify_evidence::<AlwaysValid, 4>(&a, &id(9), true, true, Some(&[1; 16]), &mut marks),
            Err(EvidenceRefusal::StatementTooLong)
        );
        // CONTROL: the same evidence with a statement that fits is accepted
        // by the same call, so the refusal above is not the whole fixture
        // failing for an unrelated reason.
        let short = evidence(1, 9, Freshness::Nonce([1; 16]));
        assert!(verify_evidence::<AlwaysValid, 4>(
            &short,
            &id(9),
            true,
            true,
            Some(&[1; 16]),
            &mut marks
        )
        .is_ok());
    }
}
