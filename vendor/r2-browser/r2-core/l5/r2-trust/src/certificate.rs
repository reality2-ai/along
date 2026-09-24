//! Certificates, epoch currency, and revocation (L5 Clause 6, with the
//! rotation rules of Clause 8 that bear on currency).
//!
//! **Membership never fades.** Reachability is a routing fact that decays
//! at Layer 3; membership is not, and the two are kept strictly apart. A
//! member absent through any number of rotations remains a member unless
//! revoked (L5 6.1.5 / L5-049: *absence shall never be grounds for
//! refusal*). What a long absence costs is *currency*, not membership —
//! and a stale certificate is still authentic evidence on return
//! (6.1 Note 3).
//!
//! Currency is **set membership over epochs, not a time comparison**
//! (6.1 Note 2): answerable by any platform from material it already
//! holds, with nothing to reconstruct after power loss. Nothing in this
//! module reads a clock.

use crate::crypto::Verifier;
use crate::identity::Identity;
use r2_hal_traits::time::Ticks;

/// A group's key epoch, incremented by every rotation (L5 8.5 / L5-079).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Epoch(pub u64);

/// How many epochs back from the current one a certificate may name and
/// still be current (L5 6.1.3, stated by group policy — `FLAGGED STD-SS42`:
/// the policy artifact's form, location and inspection are undefined, so
/// this is carried as a value, not read from anywhere).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct AcceptanceDepth(pub u64);

/// **L5 8.6: a group's policy shall state a MAXIMUM INTERVAL between
/// rotations, and its key holders shall rotate at least that often,
/// MEASURED ON THEIR OWN RULERS.**
///
/// ‼ **THERE WAS NO FIELD FOR THIS UNTIL 2026-08-14** (`L5-081`), so a
/// policy could not state it — the acceptance depth of the same clause was
/// carried and the interval was not, and *a policy that can state one half
/// of a clause reads as complete.*
///
/// ‼ **TICKS, NEVER A WALL CLOCK.** 8.6's *on their own rulers* is why:
/// nothing in this crate reads absolute time, currency is epoch-set
/// membership rather than elapsed time, and a group whose members
/// disagreed about the hour would still agree about this interval. *A
/// duration in seconds would have imported a clock the trust path
/// deliberately does not have.*
///
/// **This crate does not enforce it and says so**: rotating is a key
/// holder's act and there is no key holder here (`L5-073`/`L5-082`). What
/// the type provides is the ability to STATE the policy — which is
/// precisely what 8.6 requires of the policy, as distinct from what it
/// requires of the holder.
///
/// *`FLAGGED STD-SS42` with `AcceptanceDepth`: the policy artefact's form,
/// location and inspection are undefined, so this is carried as a value
/// rather than read from anywhere.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MaxRotationInterval(pub u64);

/// A group's rotation policy (L5 8.6), stated in one place because the
/// clause states both halves in one sentence.
///
/// ‼ **BOTH FIELDS OR NEITHER.** Carrying the depth alone was how the
/// interval went missing for months: *there was nothing whose absence was
/// visible.* A struct naming both makes an unstated interval a
/// construction the compiler refuses rather than a field nobody added.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RotationPolicy {
    /// 6.1.3's acceptance depth.
    pub acceptance_depth: AcceptanceDepth,
    /// 8.6's maximum interval between rotations, in ticks.
    pub max_interval: MaxRotationInterval,
}

impl RotationPolicy {
    /// Whether a rotation is overdue: `now` is at least `max_interval`
    /// ticks after the last one, **on this holder's own ruler**.
    ///
    /// ‼ **AN UNCOMPUTABLE AGE IS NOT OVERDUE.** L0 5.2 permits `now` to
    /// precede the last rotation across a power cycle, and *the unreadable
    /// case must not manufacture an obligation to rotate* — the same G9
    /// direction `DedupCache::live` takes, in the opposite polarity,
    /// because here the authority being granted is an ACTION rather than a
    /// suppression.
    pub fn rotation_overdue(&self, last: Ticks, now: Ticks) -> bool {
        match now.since(last) {
            Some(age) => age >= self.max_interval.0,
            None => false,
        }
    }
}

/// A member's certificate: the member keypair's public half bound to the
/// group and signed by the group secret key (L5 6.1.1 / L5-044), naming
/// the epoch at which it was issued (6.1.3 / L5-045, 8.5 / L5-080).
///
/// The signature is verified through [`crate::crypto::Verifier`]; this
/// type carries it and never checks it itself, so a certificate value can
/// be parsed and stored without implying it was ever trusted.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Certificate {
    /// The certificate's subject: the member keypair's public half.
    pub subject: Identity,
    /// The group this certificate binds the subject to.
    pub group: Identity,
    /// The epoch at which it was issued.
    pub issued_at: Epoch,
    /// Signature by the group secret key over the bound fields.
    pub signature: [u8; crate::crypto::SIGNATURE_LEN],
}

/// Length of the bytes a member certificate's signature covers:
/// subject 32 ‖ group 32 ‖ issued_at 8.
pub const CERTIFICATE_SIGNED_LEN: usize = crate::crypto::IDENTITY_LEN * 2 + 8;

/// Exact transported size under FORMATS 5d.1.
pub const CERTIFICATE_WIRE_LEN: usize = CERTIFICATE_SIGNED_LEN + crate::crypto::SIGNATURE_LEN;

impl Certificate {
    /// Decode FORMATS 5d.1, rejecting truncated or trailing bytes.
    /// This is structural decoding only: the result is not authenticated or current.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let bytes: &[u8; CERTIFICATE_WIRE_LEN] = bytes.try_into().ok()?;
        Some(Self {
            subject: Identity(bytes[..32].try_into().ok()?),
            group: Identity(bytes[32..64].try_into().ok()?),
            issued_at: Epoch(u64::from_be_bytes(bytes[64..72].try_into().ok()?)),
            signature: bytes[72..].try_into().ok()?,
        })
    }

    /// Encode the exact FORMATS 5d.1 representation. No authentication is implied.
    pub fn to_bytes(&self) -> [u8; CERTIFICATE_WIRE_LEN] {
        let mut out = [0; CERTIFICATE_WIRE_LEN];
        let mut signed = [0; CERTIFICATE_SIGNED_LEN];
        self.write_signed_bytes(&mut signed);
        out[..CERTIFICATE_SIGNED_LEN].copy_from_slice(&signed);
        out[CERTIFICATE_SIGNED_LEN..].copy_from_slice(&self.signature);
        out
    }

    /// The canonical bytes the group secret key signs over: subject, group,
    /// epoch — the three things L5 6.1.1 says a certificate binds. The
    /// signature itself is excluded.
    ///
    /// FORMATS 5d.1 fixes this span; approved by Roy in D-348.
    pub fn write_signed_bytes(&self, out: &mut [u8; CERTIFICATE_SIGNED_LEN]) {
        const ID: usize = crate::crypto::IDENTITY_LEN;
        out[..ID].copy_from_slice(&self.subject.0);
        out[ID..2 * ID].copy_from_slice(&self.group.0);
        out[2 * ID..].copy_from_slice(&self.issued_at.0.to_be_bytes());
    }

    /// Whether the signature verifies under the group the certificate
    /// names — *signed by the group secret key* (L5 6.1.1).
    pub fn verifies<V: Verifier>(&self) -> bool {
        let mut buf = [0u8; CERTIFICATE_SIGNED_LEN];
        self.write_signed_bytes(&mut buf);
        V::verify(&self.group.0, &buf, &self.signature)
    }
}

/// A certificate's standing, computed locally from held material.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Standing {
    /// Epoch within the acceptance depth of the current epoch, subject not
    /// revoked (L5 6.1.3 / L5-046).
    Current,
    /// Epoch older than the acceptance depth, subject not revoked.
    ///
    /// **Not current, but still evidence** (6.1 Note 3): a key holder
    /// re-issues against any authentic prior certificate of the subject,
    /// however old (6.1.5 / L5-048). Stale currency is not lost
    /// membership.
    Stale,
    /// Issued after the locally established current epoch, subject not revoked.
    /// Authenticity alone cannot move the verifier's accepted epoch window.
    /// This is neither current authority nor a claim of revocation; the owner
    /// must establish its current epoch through the group's rotation mechanism.
    Ahead,
    /// Subject is in the revocation set: rejected immediately on learning
    /// of the revocation (6.2.3 / L5-053). Terminal.
    Revoked,
}

impl RevocationEntry {
    /// The canonical bytes the group secret key signs over: subject,
    /// epoch, sequence, reason. The signature itself is excluded, and the
    /// advisory time is excluded because no decision reads it (6.2.2) and
    /// signing it would let an operator's clock change an entry's
    /// identity.
    ///
    /// `PROVISIONAL`: the corpus specifies no layout for a revocation
    /// entry. Reported to the standard lane.
    pub fn write_signed_bytes(&self, out: &mut [u8]) -> usize {
        let mut n = 0;
        out[n..n + crate::crypto::IDENTITY_LEN].copy_from_slice(&self.subject.0);
        n += crate::crypto::IDENTITY_LEN;
        out[n..n + 8].copy_from_slice(&self.at_epoch.0.to_be_bytes());
        n += 8;
        out[n..n + 8].copy_from_slice(&self.sequence.to_be_bytes());
        n += 8;
        out[n] = match self.reason {
            RevocationReason::Compromise => 0,
            RevocationReason::Eviction => 1,
            RevocationReason::Retirement => 2,
            RevocationReason::Superseded => 3,
        };
        n + 1
    }
}

/// The revocation set: append-only, grow-only, never pruned (L5 6.2.1 /
/// L5-050).
///
/// Never pruned is the point — a set that forgets is a set that
/// re-admits. Bounded at `N` here because storage is finite; a full set is
/// reported rather than silently overwritten, since dropping an entry
/// would silently re-admit an evicted member.
pub struct RevocationSet<const N: usize> {
    entries: [Option<RevocationEntry>; N],
    len: usize,
}

/// Why a certificate was revoked (L5 6.2.2a / L5-102).
///
/// Enumerated because 8.2 grades the grace period by it, and *a reason the
/// receiver cannot interpret cannot be graded* (6.2.2 Note 1). An
/// unrecognised reason is therefore not representable here.
/// `PROVISIONAL(supervisor)` pending Roy, per standard D-033.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RevocationReason {
    /// The subject's key material is believed exposed. Zero grace, always
    /// (8.2 / L5-076).
    Compromise,
    /// The subject is removed from the group by decision.
    Eviction,
    /// The subject has left or been decommissioned without fault.
    Retirement,
    /// The certificate is replaced by a later one for the same subject.
    Superseded,
}

/// One revocation entry (L5 6.2.2).
///
/// Ordered by `(epoch, sequence)` and never by a clock — the epoch is
/// already carried by every certificate and already increments on every
/// rotation, so the ordering a revocation set needs exists without
/// inventing anything (6.2.2 Note 1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RevocationEntry {
    pub subject: Identity,
    /// The key epoch current when the entry was issued.
    pub at_epoch: Epoch,
    /// Sequence within that epoch; `(epoch, sequence)` is the ordering.
    pub sequence: u64,
    pub reason: RevocationReason,
    /// Signed by the group secret key (6.2.2 / L5-052).
    pub signature: [u8; crate::crypto::SIGNATURE_LEN],
    /// Advisory only: an operator reading a set wants to know *when*, but
    /// two groups' clocks are not comparable and nothing in the standard
    /// makes them so — **no decision shall rely on this** (6.2.2).
    pub advisory_time: Option<u64>,
}

/// The revocation set is full and cannot admit another entry without
/// forgetting one — which it never does (6.2.1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RevocationSetFull;

/// A revocation entry whose group signature has been verified.
///
/// **This type is the only way into a [`RevocationSet`].** L5 6.2.2
/// requires each entry to be signed by the group secret key, but states
/// nothing about *when* a receiver checks that signature relative to
/// accepting the entry — the same shape as the 7.4.3a ordering rule. The
/// consequence here is worse than a replay lockout: 6.2.1 makes the set
/// append-only with no removal, so **a forged entry accepted once is
/// permanent**, and it permanently evicts a legitimate member. An epoch
/// change eventually clears a replay lockout; nothing clears this.
///
/// So the unverified path is made unrepresentable rather than guarded:
/// there is no constructor but [`VerifiedRevocation::verify`], and
/// `RevocationSet::append` accepts nothing else.
#[derive(Clone, Copy, Debug)]
pub struct VerifiedRevocation(RevocationEntry);

impl VerifiedRevocation {
    /// Verify `entry`'s signature under the group's identity (6.2.2).
    /// Returns `None` where it does not verify — the entry is then a
    /// forgery and has no way to reach a set.
    pub fn verify<V: Verifier>(entry: RevocationEntry, group: &Identity) -> Option<Self> {
        let mut buf = [0u8; REVOCATION_SIGNED_LEN];
        let n = entry.write_signed_bytes(&mut buf);
        V::verify(&group.0, &buf[..n], &entry.signature).then_some(Self(entry))
    }

    pub const fn entry(&self) -> &RevocationEntry {
        &self.0
    }

    pub const fn subject(&self) -> Identity {
        self.0.subject
    }
}

/// Length of the canonical byte sequence a revocation entry is signed over
/// (FORMATS **5a.1**, `PROVISIONAL(STD-SS91)`).
///
/// ‼ **THIS COMMENT SAID *THE CORPUS SPECIFIES NO LAYOUT* UNTIL
/// 2026-08-14, AND THAT STOPPED BEING TRUE WHEN THE GAP WAS ANSWERED.**
/// The gap was reported from this lane while fixing the 6.2.2b defect, and
/// **FORMATS 5a.1 adopted this layout** — the clause's own Note 2 says so:
/// *layout proposed by the core lane, and offered as a starting point
/// rather than a claim.* *A reported gap that was closed and never
/// re-read is the same staleness class as `L5-123`.*
///
/// **Verified byte-for-byte against the clause 2026-08-14**: subject 32 ‖
/// epoch 8 big-endian ‖ sequence 8 big-endian ‖ reason 1, with the reason
/// numbering 0 compromise, 1 eviction, 2 retirement, 3 superseded.
///
/// ‼ **AND NOTE 2 SAYS WHY THE LAYOUT MATTERS MORE THAN ITS CONTENT**:
/// without the clause every implementation invents the byte order, and
/// **two conformant implementations then reject each other's
/// revocations — so an evicted member stays a member on half the mesh,
/// permanently**, with 6.2.1's never-pruned set meaning nothing ever
/// corrects it.
pub const REVOCATION_SIGNED_LEN: usize = crate::crypto::IDENTITY_LEN + 8 + 8 + 1;

impl<const N: usize> Default for RevocationSet<N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const N: usize> RevocationSet<N> {
    pub const fn new() -> Self {
        Self {
            entries: [None; N],
            len: 0,
        }
    }

    /// Append a **verified** entry. Appending an already-present subject
    /// is a no-op, not an error: the set is a set.
    ///
    /// Takes [`VerifiedRevocation`] rather than a raw entry so that no
    /// call site — bulk sync, chain walk, deserialisation, restore from
    /// storage, or a test helper — can insert an unverified one.
    pub fn append(&mut self, verified: VerifiedRevocation) -> Result<(), RevocationSetFull> {
        let entry = verified.0;
        if self.contains(&entry.subject) {
            return Ok(());
        }
        if self.len == N {
            // Never pruned (6.2.1): report rather than forget. Forgetting
            // would silently re-admit an evicted member.
            return Err(RevocationSetFull);
        }
        self.entries[self.len] = Some(entry);
        self.len += 1;
        Ok(())
    }

    pub fn contains(&self, subject: &Identity) -> bool {
        self.entries[..self.len]
            .iter()
            .flatten()
            .any(|e| &e.subject == subject)
    }

    pub const fn len(&self) -> usize {
        self.len
    }

    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// There is no `remove`, no `prune`, and no `clear`: 6.2.1 makes the
    /// set append-only and grow-only, so the operations that would violate
    /// it are absent rather than guarded.
    pub fn entries(&self) -> impl Iterator<Item = &RevocationEntry> {
        self.entries[..self.len].iter().flatten()
    }
}

/// Compute a certificate's standing (L5 6.1.3), given the group's current
/// epoch, its stated acceptance depth, and its revocation set.
///
/// Revocation is checked first and is terminal: a revoked subject's
/// certificate is rejected whatever its epoch (6.2.3).
pub fn standing<const N: usize>(
    cert: &Certificate,
    current: Epoch,
    depth: AcceptanceDepth,
    revoked: &RevocationSet<N>,
) -> Standing {
    if revoked.contains(&cert.subject) {
        return Standing::Revoked;
    }
    // L5 6.1.3 / Note 2: the locally held accepted epoch set ends at
    // `current`. A peer certificate cannot extend that set by naming a later
    // epoch. Subtraction also handles a depth reaching past epoch zero without
    // wrapping a lower-bound calculation.
    let Some(gap) = current.0.checked_sub(cert.issued_at.0) else {
        return Standing::Ahead;
    };
    if gap <= depth.0 {
        Standing::Current
    } else {
        Standing::Stale
    }
}

/// Whether a key holder may re-issue for this subject (L5 6.1.5 /
/// L5-048).
///
/// Re-issue proceeds against the member keypair and **any authentic prior
/// certificate of that subject, however old** — the certificate's age is
/// deliberately not an input. The single bar is the revocation set, and
/// **absence is never grounds for refusal** (L5-049).
pub fn may_reissue<const N: usize>(subject: &Identity, revoked: &RevocationSet<N>) -> bool {
    !revoked.contains(subject)
}

impl RevocationReason {
    /// Grace ticks permitted for the immediately prior key when a rotation
    /// is triggered for this reason (L5 8.2).
    ///
    /// Compromise is zero regardless of what a deployment asks for: a
    /// grace period on a compromise eviction is a window in which the
    /// rotation has changed nothing (8 Note 1). `FLAGGED STD-SS41` — every
    /// other reason's value is the deployment's, since the standard states
    /// only the compromise case.
    pub const fn grace_ticks(self, deployment_grace: u64) -> u64 {
        match self {
            RevocationReason::Compromise => 0,
            RevocationReason::Eviction
            | RevocationReason::Retirement
            | RevocationReason::Superseded => deployment_grace,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{IDENTITY_LEN, SIGNATURE_LEN};

    fn id(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    fn cert(subject: u8, issued_at: u64) -> Certificate {
        Certificate {
            subject: id(subject),
            group: id(0xEE),
            issued_at: Epoch(issued_at),
            signature: [0; SIGNATURE_LEN],
        }
    }

    /// Accepts any signature: stands in for a key holder's real one.
    struct GroupSigned;
    impl Verifier for GroupSigned {
        fn verify(_: &[u8; IDENTITY_LEN], _: &[u8], sig: &[u8; SIGNATURE_LEN]) -> bool {
            // A forged entry in these tests carries an all-0xFF signature.
            sig[0] != 0xFF
        }
    }

    fn verified(entry: RevocationEntry) -> VerifiedRevocation {
        VerifiedRevocation::verify::<GroupSigned>(entry, &id(0xEE)).expect("signed")
    }

    fn revocation(subject: u8, at: u64) -> RevocationEntry {
        RevocationEntry {
            subject: id(subject),
            at_epoch: Epoch(at),
            sequence: 0,
            reason: RevocationReason::Eviction,
            signature: [0; SIGNATURE_LEN],
            advisory_time: None,
        }
    }

    /// ‼ **8.6's INTERVAL, WHICH HAD NO FIELD UNTIL 2026-08-14**
    /// (`L5-081`). The depth was carried and the interval was not, so a
    /// policy could state one half of the clause and read as complete.
    #[test]
    fn a_policy_states_both_halves_of_8_6() {
        let p = RotationPolicy {
            acceptance_depth: AcceptanceDepth(2),
            max_interval: MaxRotationInterval(1_000),
        };
        assert!(!p.rotation_overdue(Ticks(0), Ticks(999)));
        assert!(
            p.rotation_overdue(Ticks(0), Ticks(1_000)),
            "the bound is inclusive"
        );
        assert!(p.rotation_overdue(Ticks(0), Ticks(5_000)));
    }

    /// ‼ **AN UNCOMPUTABLE AGE IS NOT OVERDUE.** L0 5.2 permits `now` to
    /// precede the last rotation across a power cycle, and *the unreadable
    /// case must not manufacture an obligation to rotate.* Same G9
    /// direction as `DedupCache::live` in the opposite polarity, because
    /// the authority granted here is an ACTION rather than a suppression.
    #[test]
    fn a_clock_that_went_backwards_does_not_demand_a_rotation() {
        let p = RotationPolicy {
            acceptance_depth: AcceptanceDepth(2),
            max_interval: MaxRotationInterval(10),
        };
        assert!(!p.rotation_overdue(Ticks(5_000), Ticks(1)));
    }

    /// The interval is **ticks, never a wall clock** — 8.6's *on their own
    /// rulers*. A group whose members disagreed about the hour would still
    /// agree about this interval.
    #[test]
    fn the_interval_is_measured_on_the_holders_own_ruler() {
        let p = RotationPolicy {
            acceptance_depth: AcceptanceDepth(1),
            max_interval: MaxRotationInterval(100),
        };
        // Two holders whose Ticks epochs differ by an arbitrary offset
        // reach the same verdict for the same elapsed count.
        assert_eq!(
            p.rotation_overdue(Ticks(0), Ticks(100)),
            p.rotation_overdue(Ticks(9_000), Ticks(9_100)),
        );
    }

    #[test]
    fn currency_is_epoch_set_membership_not_time() {
        let empty: RevocationSet<4> = RevocationSet::new();
        let depth = AcceptanceDepth(2);
        // Issued this epoch, and within depth.
        assert_eq!(
            standing(&cert(1, 10), Epoch(10), depth, &empty),
            Standing::Current
        );
        assert_eq!(
            standing(&cert(1, 8), Epoch(10), depth, &empty),
            Standing::Current
        );
        // One epoch beyond the depth: stale, but not lost.
        assert_eq!(
            standing(&cert(1, 7), Epoch(10), depth, &empty),
            Standing::Stale
        );
        // The accepted set ends at the locally established current epoch.
        assert_eq!(
            standing(&cert(1, 11), Epoch(10), depth, &empty),
            Standing::Ahead
        );
    }

    #[test]
    fn a_certificate_from_a_future_epoch_is_ahead_not_current_or_revoked() {
        let empty: RevocationSet<4> = RevocationSet::new();
        for (issued, current, depth, expected) in [
            (12, 10, 1, Standing::Ahead),
            (12, 10, u64::MAX, Standing::Ahead),
            (1, 0, u64::MAX, Standing::Ahead),
            (u64::MAX, 0, u64::MAX, Standing::Ahead),
            (u64::MAX, u64::MAX - 1, 0, Standing::Ahead),
            (u64::MAX, u64::MAX, 0, Standing::Current),
            (0, u64::MAX, u64::MAX, Standing::Current),
            (0, u64::MAX, u64::MAX - 1, Standing::Stale),
        ] {
            assert_eq!(
                standing(
                    &cert(1, issued),
                    Epoch(current),
                    AcceptanceDepth(depth),
                    &empty
                ),
                expected,
            );
        }
        // An authentic member is not expelled because our local epoch lags.
        assert!(may_reissue(&id(1), &empty));
    }

    #[test]
    fn revocation_beats_every_epoch() {
        let mut set: RevocationSet<4> = RevocationSet::new();
        set.append(verified(revocation(1, 9))).unwrap();
        // Revocation also wins when currency would be stale or ahead (6.2.3).
        for issued in [0, 10, 11, u64::MAX] {
            assert_eq!(
                standing(&cert(1, issued), Epoch(10), AcceptanceDepth(5), &set),
                Standing::Revoked
            );
        }
    }

    #[test]
    fn absence_is_never_grounds_for_refusal() {
        // L5 6.1.5 / L5-048-049: however old the certificate, re-issue
        // proceeds; only revocation bars it.
        let mut set: RevocationSet<4> = RevocationSet::new();
        assert!(may_reissue(&id(1), &set));
        let ancient = cert(1, 0);
        assert_eq!(
            standing(&ancient, Epoch(10_000), AcceptanceDepth(2), &set),
            Standing::Stale // stale...
        );
        assert!(may_reissue(&ancient.subject, &set)); // ...but still a member

        set.append(verified(revocation(1, 5))).unwrap();
        assert!(!may_reissue(&id(1), &set)); // the one bar
    }

    #[test]
    fn revocation_set_is_append_only_and_never_forgets() {
        let mut set: RevocationSet<2> = RevocationSet::new();
        set.append(verified(revocation(1, 1))).unwrap();
        set.append(verified(revocation(1, 1))).unwrap(); // idempotent, still one
        assert_eq!(set.len(), 1);
        set.append(verified(revocation(2, 2))).unwrap();
        assert_eq!(set.len(), 2);
        // Full: reported, never silently overwritten — forgetting an entry
        // would re-admit an evicted member (6.2.1).
        assert_eq!(
            set.append(verified(revocation(3, 3))),
            Err(RevocationSetFull)
        );
        assert!(set.contains(&id(1)));
        assert!(set.contains(&id(2)));
        assert!(!set.contains(&id(3)));
    }

    #[test]
    fn a_forged_revocation_cannot_reach_the_set() {
        // 6.2.2 requires the entry be signed; 6.2.1 makes the set
        // append-only with no removal, so a forged entry accepted once
        // would permanently evict a legitimate member and nothing would
        // ever clear it. Verification is therefore the only way in.
        let mut forged = revocation(1, 5);
        forged.signature = [0xFF; SIGNATURE_LEN];
        assert!(
            VerifiedRevocation::verify::<GroupSigned>(forged, &id(0xEE)).is_none(),
            "a forged entry produced a VerifiedRevocation"
        );
        // And there is no other route: `append` takes only the verified
        // form, so no bulk-sync, deserialisation or test helper can insert
        // an unverified entry (by construction).
        let mut set: RevocationSet<4> = RevocationSet::new();
        set.append(verified(revocation(2, 5))).unwrap();
        assert!(set.contains(&id(2)));
        assert!(!set.contains(&id(1)));
    }

    /// ‼ **FORMATS 5a.1's LAYOUT, ASSERTED FIELD BY FIELD AGAINST THE
    /// CLAUSE.** *Without this clause every implementation invents the byte
    /// order, and two conformant implementations then reject each other's
    /// revocations — an evicted member stays a member on half the mesh,
    /// permanently* (Note 2).
    ///
    /// **The order is the whole assertion**: the same four fields permuted
    /// produce a span of identical length that verifies against nothing,
    /// *and a length check cannot see it.*
    /// ‼ **THE CERTIFICATE'S OWN SIGNED SPAN, WHICH NOTHING COVERED** (`SS589`,
    /// found by mutation 2026-09-05). The span test below is the REVOCATION
    /// ENTRY's; the certificate's `write_signed_bytes` had no layout test at
    /// all. **Zeroing the issuing epoch out of the signed bytes left all 290
    /// tests green.**
    ///
    /// That field is not decorative: `standing` reads `issued_at` to decide
    /// currency against the acceptance depth, so an epoch outside the
    /// signature is an unauthenticated input to a freshness decision — a
    /// holder of an old certificate could set it forward and it would still
    /// verify. *The code binds it correctly; nothing checked that it did.*
    #[test]
    fn the_certificates_signed_span_binds_its_subject_group_and_issuing_epoch() {
        let c = cert(1, 5);
        let mut buf = [0u8; CERTIFICATE_SIGNED_LEN];
        c.write_signed_bytes(&mut buf);
        const ID: usize = crate::crypto::IDENTITY_LEN;
        assert_eq!(
            CERTIFICATE_SIGNED_LEN,
            ID * 2 + 8,
            "subject 32, group 32, epoch 8"
        );
        assert_eq!(&buf[..ID], &c.subject.0[..], "subject first, in full");
        assert_eq!(&buf[ID..2 * ID], &c.group.0[..], "then the group");
        // BIG-ENDIAN, which is the byte order a round trip cannot see.
        assert_eq!(
            &buf[2 * ID..],
            &c.issued_at.0.to_be_bytes()[..],
            "the issuing epoch must be INSIDE the signature: `standing` reads it to decide \
             currency, so an epoch outside the span is an unauthenticated input to a freshness \
             decision"
        );
        // ‼ AND THE EXCLUDED CASE: two certificates differing ONLY in the
        //   epoch must produce different signed bytes, or the assertion
        //   above could hold while the field contributed nothing.
        let mut other = [0u8; CERTIFICATE_SIGNED_LEN];
        cert(1, 6).write_signed_bytes(&mut other);
        assert_ne!(buf, other, "the epoch does not change the signed bytes");
    }

    #[test]
    fn the_signed_span_is_the_layout_formats_5a_1_states() {
        let e = revocation(1, 5);
        let mut buf = [0u8; REVOCATION_SIGNED_LEN];
        let n = e.write_signed_bytes(&mut buf);
        assert_eq!(
            n,
            32 + 8 + 8 + 1,
            "5a.1: subject 32, epoch 8, sequence 8, reason 1"
        );

        // subject first, in full.
        assert_eq!(&buf[..32], &e.subject.0[..]);
        // then epoch, BIG-ENDIAN — the byte order a round-trip cannot see.
        assert_eq!(&buf[32..40], &e.at_epoch.0.to_be_bytes()[..]);
        // then sequence, likewise.
        assert_eq!(&buf[40..48], &e.sequence.to_be_bytes()[..]);
        // then the reason, as the clause numbers them.
        assert_eq!(buf[48], 1, "5a.1: 1 is eviction");
    }

    #[test]
    fn signed_bytes_exclude_the_signature_and_the_advisory_time() {
        // Signing the advisory time would let an operator's clock change
        // an entry's identity, and it is barred from decisions anyway.
        let mut a = revocation(1, 5);
        let mut b = a;
        b.advisory_time = Some(999_999);
        b.signature = [0x7; SIGNATURE_LEN];
        let (mut ba, mut bb) = ([0u8; REVOCATION_SIGNED_LEN], [0u8; REVOCATION_SIGNED_LEN]);
        let (na, nb) = (a.write_signed_bytes(&mut ba), b.write_signed_bytes(&mut bb));
        assert_eq!(ba[..na], bb[..nb]);
        // But the reason is covered: it grades grace, so it must not be
        // substitutable after signing.
        a.reason = RevocationReason::Compromise;
        let na2 = a.write_signed_bytes(&mut ba);
        assert_ne!(ba[..na2], bb[..nb]);
    }

    #[test]
    fn compromise_has_zero_grace_whatever_the_deployment_says() {
        // L5 8.2 / L5-076, and 8 Note 1: grace on a compromise eviction is
        // a window in which the rotation has changed nothing.
        assert_eq!(RevocationReason::Compromise.grace_ticks(9_999), 0);
        // Every other reason takes the deployment's value (STD-SS41).
        let graced = [
            RevocationReason::Eviction,
            RevocationReason::Retirement,
            RevocationReason::Superseded,
        ];
        assert_eq!(graced.len(), 3, "a non-compromise reason went untested");
        for r in graced {
            assert_eq!(r.grace_ticks(9_999), 9_999, "{r:?}");
        }
    }

    #[test]
    fn revocation_ordering_is_epoch_sequence_never_a_clock() {
        // 6.2.2 Note 1: advisory time exists for operators and is barred
        // from any decision, so entries order without it.
        let mut a = revocation(1, 5);
        a.sequence = 2;
        a.advisory_time = Some(1_000);
        let mut b = revocation(2, 5);
        b.sequence = 3;
        b.advisory_time = Some(0); // earlier clock, later in the ordering
        assert!((a.at_epoch, a.sequence) < (b.at_epoch, b.sequence));
    }
}
