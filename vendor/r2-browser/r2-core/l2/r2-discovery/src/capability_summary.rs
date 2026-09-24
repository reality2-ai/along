//! **The capability summary's one-sided error (L2 8.1, 8.3, 8.4).**
//!
//! # ‼ THE DIRECTION IS THE WHOLE CLAUSE, AND GETTING IT BACKWARDS IS SILENT
//!
//! **8.1**: a summary *shall admit false positives and **shall not admit
//! false negatives**.*
//!
//! Those are not two ways of saying *approximate*. **A false positive costs
//! one wasted question**: 8.3 says a scanner treats a positive as *a reason
//! to ask, and shall not treat it as an answer*, so the ask corrects it and
//! nothing is lost but a frame. **A false negative is undetectable and
//! permanent** — a hive that *has* the capability is reported as not having
//! it, so the scanner **never asks**, and there is no later step at which the
//! mistake could surface. *One direction is self-correcting and the other is
//! invisible, which is why the clause names them separately rather than
//! saying the summary is approximate.*
//!
//! # What that forces on the structure
//!
//! A membership sketch with one-sided error: setting bits on insertion and
//! testing all of them on query. **Never removing**, because removal is what
//! introduces a false negative — *and a summary that could forget is a
//! summary that can lie in the fatal direction.* There is deliberately no
//! `remove`.
//!
//! ‼ **AND 8.4 IS A SEPARATE STATE, NOT AN EMPTY SUMMARY.** *A hive
//! publishing no public capability shall **not carry** a capability summary.*
//! An all-zero summary and an absent one are different claims — the first
//! says *I publish nothing*, the second says *I am not telling you* — so
//! [`CapabilitySummary`](crate::capability_summary::CapabilitySummary) is what a
//! hive carries and `Option<CapabilitySummary>`
//! is what a beacon has. *Encoding "no capabilities" as an empty sketch would
//! make a hive that declines to summarise indistinguishable from one that has
//! nothing.*
//!
//! # ⚠ THE WIRE FORM IS NOT HERE AND IS NOT INVENTED
//!
//! **8.2** obliges a summary to carry *the parameters needed to interpret
//! it*, and **`SS14` records that the corpus defines neither those parameters
//! nor the summary's encoding** — it is open and Roy's. So this is the
//! **local structure and its one-sided property**, which 8.1 and 8.3 fix
//! completely; the octets that would travel are the open question. *A wire
//! form chosen here would be a guess that gets built on.*

/// Bits in the sketch. A local choice: **8.2's parameters are `SS14`'s**, and
/// a summary that travelled would have to state this rather than assume it.
pub const SUMMARY_BITS: usize = 64;

/// A local capability summary with **one-sided error** (8.1).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct CapabilitySummary {
    bits: u64,
}

impl CapabilitySummary {
    /// A summary that has been told about nothing yet.
    ///
    /// ‼ **THIS IS NOT 8.4's CASE.** A hive publishing no public capability
    /// **carries no summary at all**; this is a summary into which nothing
    /// has been inserted, which is a different claim. See the module header.
    pub const fn new() -> Self {
        Self { bits: 0 }
    }

    /// Which bits a name sets. Two independent probes, so a single collision
    /// does not make every name look present.
    const fn probes(name: &str) -> (u32, u32) {
        // FNV-1a over the bytes, and a second pass with a different offset
        // basis. **Not a security hash and not required to be**: 8.1 asks for
        // one-sided error, not for unforgeability — *a summary is a reason to
        // ask and never an answer (8.3)*, so a crafted name costs an ask.
        let bytes = name.as_bytes();
        let mut a: u32 = 0x811C_9DC5;
        let mut b: u32 = 0x0100_0193;
        let mut i = 0;
        while i < bytes.len() {
            a ^= bytes[i] as u32;
            a = a.wrapping_mul(0x0100_0193);
            b = b.wrapping_add(bytes[i] as u32);
            b = b.wrapping_mul(0x0100_0193) ^ (b >> 7);
            i += 1;
        }
        (a % SUMMARY_BITS as u32, b % SUMMARY_BITS as u32)
    }

    /// Record that this hive publishes `name`.
    ///
    /// **There is no `remove`, and its absence is the clause.** Removal is
    /// what introduces a false negative, and *a summary that could forget is
    /// a summary that can lie in the fatal direction.*
    pub fn insert(&mut self, name: &str) {
        let (x, y) = Self::probes(name);
        self.bits |= 1u64 << x;
        self.bits |= 1u64 << y;
    }

    /// **8.3: a reason to ask, never an answer.**
    ///
    /// ‼ **NAMED FOR WHAT THE CALLER MUST DO WITH IT.** A method called
    /// `contains` would be read as an answer, which 8.3 forbids in terms —
    /// *and a scanner that believed a positive would skip the ask that is the
    /// only authoritative step.*
    pub const fn worth_asking_about(&self, name: &str) -> bool {
        let (x, y) = Self::probes(name);
        (self.bits & (1u64 << x)) != 0 && (self.bits & (1u64 << y)) != 0
    }

    /// Whether nothing has been inserted.
    pub const fn is_empty(&self) -> bool {
        self.bits == 0
    }
}

/// What a beacon carries about capability (8.4).
///
/// ‼ **A SEPARATE TYPE BECAUSE ABSENT AND EMPTY ARE DIFFERENT CLAIMS.** *A
/// hive publishing no public capability shall not carry a capability
/// summary* — so *I publish nothing* and *I am not telling you* must not
/// collapse into one value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SummaryCarried {
    /// The hive publishes at least one public capability and summarised it.
    Summary(CapabilitySummary),
    /// **8.4**: the hive publishes no public capability, so it carries none.
    NonePublished,
}

impl SummaryCarried {
    /// What a hive should carry, given what it publishes (8.4).
    ///
    /// An empty summary is **never** the answer: a hive with nothing to
    /// publish carries no summary at all.
    pub const fn for_a_hive(summary: CapabilitySummary) -> Self {
        if summary.is_empty() {
            SummaryCarried::NonePublished
        } else {
            SummaryCarried::Summary(summary)
        }
    }

    /// **8.3, applied to whatever the beacon carried.**
    ///
    /// A hive carrying no summary is not a hive with no capabilities — it is
    /// a hive that said nothing — so this answers `false` and *the scanner's
    /// recourse is to ask, which 7.2.2 already tells it to do.*
    pub const fn worth_asking_about(&self, name: &str) -> bool {
        match self {
            SummaryCarried::Summary(s) => s.worth_asking_about(name),
            SummaryCarried::NonePublished => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **8.1's FATAL DIRECTION, SWEPT: EVERY INSERTED NAME MUST TEST
    /// POSITIVE.** *A false negative is undetectable and permanent* — the
    /// hive has the capability, the summary says no, **the scanner never
    /// asks**, and there is no later step at which the mistake could
    /// surface.
    #[test]
    fn no_inserted_name_is_ever_reported_absent() {
        let mut s = CapabilitySummary::new();
        let names = [
            "temperature",
            "humidity",
            "acme/valve/v1",
            "",
            "a-very-long-capability-name-with-punctuation.and/slashes",
            "\u{101}whina",
        ];
        for n in names {
            s.insert(n);
        }
        for n in names {
            assert!(
                s.worth_asking_about(n),
                "{n:?} was inserted and reported absent — a FALSE NEGATIVE, \
                 which 8.1 forbids"
            );
        }

        // ‼ AND THE SWEEP IS WIDE RATHER THAN SAMPLED. A few hundred
        // generated names, all inserted, none may go missing — because a
        // false negative on ONE name is the whole failure and a six-name
        // test could miss it.
        let mut wide = CapabilitySummary::new();
        let mut buf = [0u8; 16];
        for i in 0..400u32 {
            wide.insert(name_for(i, &mut buf));
        }
        for i in 0..400u32 {
            let n = name_for(i, &mut buf);
            assert!(wide.worth_asking_about(n), "{n} went missing");
        }
    }

    /// Distinct names in a stack buffer: this crate is `no_std` and has no
    /// allocator, and a test that reached for one would not compile.
    fn name_for(i: u32, buf: &mut [u8; 16]) -> &str {
        let prefix = b"cap/";
        buf[..4].copy_from_slice(prefix);
        let mut v = i;
        let mut at = 16;
        if v == 0 {
            at -= 1;
            buf[at] = b'0';
        }
        while v > 0 {
            at -= 1;
            buf[at] = b'0' + (v % 10) as u8;
            v /= 10;
        }
        let digits = 16 - at;
        buf.copy_within(at..16, 4);
        core::str::from_utf8(&buf[..4 + digits]).expect("ascii")
    }

    /// **8.1's permitted direction**: false positives are allowed, and a
    /// summary that never said yes to anything absent would be a set, not a
    /// summary. *The clause admits them because the ask corrects them.*
    #[test]
    fn a_false_positive_is_permitted_and_costs_only_an_ask() {
        let mut s = CapabilitySummary::new();
        s.insert("temperature");
        // Most absent names are absent; the guarantee is one-sided, so this
        // asserts the STRUCTURE rather than the absence of collisions.
        let mut absent_reported_present = 0;
        let mut buf = [0u8; 16];
        for i in 1000..1500u32 {
            if s.worth_asking_about(name_for(i, &mut buf)) {
                absent_reported_present += 1;
            }
        }
        // The point is that this is TOLERATED, not that it is zero: 8.3 makes
        // a positive a reason to ask, so the ask corrects it.
        assert!(
            absent_reported_present < 500,
            "a summary answering yes to everything is useless, though still \
             conformant to 8.1"
        );
    }

    /// ‼ **8.4: ABSENT AND EMPTY ARE DIFFERENT CLAIMS.** *A hive publishing
    /// no public capability shall not carry a capability summary* — so *I
    /// publish nothing* and *I am not telling you* must not collapse into one
    /// value.
    #[test]
    fn a_hive_with_nothing_to_publish_carries_no_summary_rather_than_an_empty_one() {
        let empty = CapabilitySummary::new();
        assert!(empty.is_empty());
        assert_eq!(
            SummaryCarried::for_a_hive(empty),
            SummaryCarried::NonePublished
        );

        let mut some = CapabilitySummary::new();
        some.insert("temperature");
        assert_eq!(
            SummaryCarried::for_a_hive(some),
            SummaryCarried::Summary(some)
        );

        // A hive carrying no summary is not a hive with no capabilities; it
        // is a hive that said nothing, and the scanner's recourse is to ask.
        assert!(!SummaryCarried::NonePublished.worth_asking_about("temperature"));
    }

    /// **8.3 in the method's name.** `contains` would be read as an answer,
    /// which the clause forbids — *and a scanner that believed a positive
    /// would skip the ask that is the only authoritative step.*
    #[test]
    fn the_positive_result_is_named_as_a_reason_to_ask() {
        let mut s = CapabilitySummary::new();
        s.insert("temperature");
        // The API offers no `contains`; this is the only query, and it is
        // named for what 8.3 permits a caller to conclude.
        assert!(s.worth_asking_about("temperature"));
    }

    /// There is no `remove`, and its absence is the clause: removal is what
    /// introduces a false negative.
    #[test]
    fn inserting_the_same_name_twice_changes_nothing_and_nothing_is_removable() {
        let mut a = CapabilitySummary::new();
        a.insert("temperature");
        let once = a;
        a.insert("temperature");
        assert_eq!(a, once, "insertion is idempotent");
        // Adding more never takes anything away.
        a.insert("humidity");
        assert!(a.worth_asking_about("temperature"));
        assert!(a.worth_asking_about("humidity"));
    }

    /// **L2 8.1 (`L2-050a`): the summary ADMITS false positives — it is a
    /// sketch, not a set.** `a_false_positive_is_permitted_and_costs_only_an_ask`
    /// bounds them, which an exact set also passes; this one produces one.
    /// Two forms, both deterministic because `probes` is a fixed function:
    ///
    /// 1. Pigeonhole: more than `SUMMARY_BITS` distinct names are inserted
    ///    (two probes each into sixty-four bits), and an absent name is then
    ///    reported worth asking about — a set would say no to every one.
    /// 2. A colliding pair: two generated names with identical probes, ONE
    ///    inserted, and the other tests positive.
    ///
    /// Mutation that turns it red: `worth_asking_about` answering `false`
    /// for every name — a query that never reports an absent name present,
    /// which is the property an exact set has and a sketch cannot.
    #[test]
    fn an_absent_name_is_reported_worth_asking_about_once_the_sketch_is_crowded() {
        const INSERTED: u32 = 256;
        assert!(
            INSERTED as usize > SUMMARY_BITS,
            "the pigeonhole needs more names than bits"
        );
        let mut crowded = CapabilitySummary::new();
        let mut buf = [0u8; 16];
        for i in 0..INSERTED {
            crowded.insert(name_for(i, &mut buf));
        }
        let mut absent_reported_present = 0;
        for i in 1000..1500u32 {
            if crowded.worth_asking_about(name_for(i, &mut buf)) {
                absent_reported_present += 1;
            }
        }
        assert!(
            absent_reported_present > 0,
            "{INSERTED} names in {SUMMARY_BITS} bits and no absent name reports present — \
             that is a set, and 8.1 says a summary ADMITS false positives"
        );

        // The colliding pair: one inserted, the other reports present.
        let mut a_buf = [0u8; 16];
        let mut b_buf = [0u8; 16];
        let mut pair = None;
        'search: for i in 0..400u32 {
            let probes = CapabilitySummary::probes(name_for(i, &mut a_buf));
            for j in (i + 1)..400u32 {
                if CapabilitySummary::probes(name_for(j, &mut b_buf)) == probes {
                    pair = Some((i, j));
                    break 'search;
                }
            }
        }
        let (inserted, absent) =
            pair.expect("400 names over 64 x 64 probe pairs collide (birthday bound)");
        let mut one = CapabilitySummary::new();
        one.insert(name_for(inserted, &mut a_buf));
        assert!(
            one.worth_asking_about(name_for(absent, &mut b_buf)),
            "name {absent} shares both probes with name {inserted} and must read present"
        );
    }
}
