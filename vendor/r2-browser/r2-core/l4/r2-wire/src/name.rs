//! Name normalisation and hashing (L4 Clause 7).
//!
//! Applies only to names — event names, class strings, human-authored text.
//! Hive/group wire identity derives from L5 identity material and must NOT
//! pass through this path (L4 7.1.4).

use crate::fnv::Fnv1a32;

/// Hash meaning *no event* (L4 7.1.3); mandatory event field value for
/// HEARTBEAT and GROUP_MGMT.
pub const NO_EVENT: u32 = 0x0000_0000;
/// Reserved hash value, never used (L4 7.1.3).
pub const RESERVED_HASH: u32 = 0xFFFF_FFFF;

/// The L4 7.1.2 whitespace set, used for trimming only.
///
/// **`const` so a consumer can decide at COMPILE TIME whether a name it holds
/// is already normal** — see [`is_l4_normal`]. *The body is unchanged; only
/// the qualifier moved.*
#[must_use]
pub const fn is_l4_whitespace(c: char) -> bool {
    matches!(
        c as u32,
        0x09..=0x0D
            | 0x20
            | 0x85
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
    )
}

/// The L4 7.1.2 case fold. Pure arithmetic on code points; exactly the stated
/// mapping and no other.
///
/// **`const`, and the MAPPING IS UNCHANGED — ONE edit was forced and it is not
/// in the mapping**: a `match` in place of `Option::unwrap_or`, which is not
/// `const`. *An earlier draft also replaced `is_multiple_of` with `% 2 == 0`
/// on the assumption that it was not const-callable; **measured, it is**, so
/// the arm is left exactly as it was and clippy stays silent — the assumption
/// would have cost a warning and a needless divergence.* **The pins below are
/// compile-time assertions rather than tests precisely because a rewrite for
/// const-ness is where an arm of this mapping gets dropped with nothing
/// failing.*
#[must_use]
pub const fn fold(c: char) -> char {
    let cp = c as u32;
    let folded = match cp {
        // (a) Basic Latin capitals
        0x41..=0x5A => cp + 0x20,
        // (b) Latin-1 capitals, excluding the multiplication sign
        0xC0..=0xDE if cp != 0xD7 => cp + 0x20,
        // (c) Latin Extended-A even-numbered capitals
        0x100..=0x137 | 0x14A..=0x177 if cp.is_multiple_of(2) => cp + 1,
        // (d) Latin Extended-A odd-numbered capitals
        0x139..=0x148 | 0x179..=0x17E if cp % 2 == 1 => cp + 1,
        // (e) Y with diaeresis
        0x178 => 0xFF,
        // (f) all others unchanged
        _ => cp,
    };
    // Every mapped value above is a valid scalar (arithmetic stays inside
    // assigned Latin ranges), so this cannot fail.
    match char::from_u32(folded) {
        Some(x) => x,
        None => c,
    }
}

/// **THE FIVE PINS, EVALUATED BY THE COMPILER AND NOT BY A TEST RUNNER.**
///
/// A `const` block that fails is a build error, so these hold on **every**
/// target this crate is compiled for, including the Xtensa build where no
/// test harness runs. **(b)'s multiplication-sign exclusion is the arm a
/// careless rewrite drops**, and it is the reason this list exists at all.
const _FOLD_BASIC_LATIN: () = assert!(fold('A') as u32 == 'a' as u32);
const _FOLD_IDEMPOTENT: () = assert!(fold('a') as u32 == 'a' as u32);
const _FOLD_Y_DIAERESIS: () = assert!(fold('\u{178}') as u32 == 0xFF);
const _FOLD_SPARES_MULTIPLICATION_SIGN: () = assert!(fold('\u{D7}') as u32 == 0xD7);
const _WHITESPACE_SET_IS_NOT_EVERYTHING: () =
    assert!(is_l4_whitespace(' ') && !is_l4_whitespace('x'));

/// **Is `name` ALREADY in L4 7.1.2 normal form?** — trimmed, and folding
/// changes no character.
///
/// # Why this exists, and it is not the fold-invariance arm
///
/// **`FORMATS.md` 7.5.2c (`STD-SS312`)**: where a hive compares an event that
/// arrived in a frame with an event name a definition carries, it **shall
/// compute the identifier hash of the name it holds** as L4 7.1.1/7.1.2
/// require, and compare *that* with the frame's hash. **The clause forbids
/// the hand-written digest table** — its Note 2 says why, and the reason is
/// the sharpest in the corpus: *7.5.6 requires a hive to discard an
/// unmatched event without error and without queueing, so a wrongly joined
/// name-and-hash is byte-for-byte the specified correct behaviour for an
/// event nobody sent.*
///
/// **So a consumer needs to hash names it holds, ideally at compile time —
/// and this predicate is the precondition that makes the compile-time hash
/// trivially correct**: on an already-normal name, trim and fold are
/// no-ops, so hashing the raw bytes *is* the L4 hash. See
/// [`event_hash_of_normal`].
///
/// # The departure, stated here rather than in a ledger
///
/// **Iterating `chars()` is not `const` on stable, so this walks BYTES and
/// REFUSES any byte `>= 0x80` rather than guessing at UTF-8.** It is
/// therefore **STRICTER than 7.1.2**: *over-refuse, never under-refuse.* A
/// non-ASCII name that is perfectly normal answers `false` here — **which
/// costs nothing real, because every event name in this fleet and every
/// reverse-DNS name is ASCII** — and the failure direction is the safe one,
/// since a `false` sends a caller to the runtime [`event_hash`].
///
/// **An empty name, or one that is empty after trimming, is NOT normal**:
/// 7.1.2 says such a string is not a name and shall not be hashed.
#[must_use]
pub const fn is_l4_normal(name: &str) -> bool {
    let b = name.as_bytes();
    if b.is_empty() {
        return false;
    }
    // Trim is a property of the ENDS only, so the ends decide it.
    if is_l4_whitespace(b[0] as char) || is_l4_whitespace(b[b.len() - 1] as char) {
        return false;
    }
    let mut i = 0;
    while i < b.len() {
        // Refuse rather than decode: this arm is the stated departure.
        if b[i] >= 0x80 {
            return false;
        }
        if fold(b[i] as char) as u32 != b[i] as u32 {
            return false;
        }
        i += 1;
    }
    true
}

/// The L4 7.1.1 hash of a name **already known to be normal**, computable at
/// COMPILE TIME.
///
/// Returns `None` where [`is_l4_normal`] is `false` — **the check is not
/// optional and is not the caller's to skip**, because the whole correctness
/// argument is that trim and fold are no-ops on such a name, so hashing the
/// raw bytes is hashing the normalised ones.
///
/// **This is what 7.5.2c asks a hive to do, moved to build time.** A hive
/// holding its event names as `&'static str` constants can write
/// `const H: u32 = event_hash_of_normal(NAME).unwrap();` and get **a table
/// the compiler builds and no author maintains** — the opposite of the
/// hand-written digest table Note 2 exists to prevent. *A wrong entry in a
/// hand-written table is silent; a wrong entry here is a build error.*
///
/// **It is not a second implementation of anything**: it calls the same
/// [`fold`] and [`is_l4_whitespace`] through [`is_l4_normal`], and the same
/// [`Fnv1a32`]. The equality with [`event_hash`] is asserted below rather
/// than argued.
#[must_use]
pub const fn event_hash_of_normal(name: &str) -> Option<u32> {
    if !is_l4_normal(name) {
        return None;
    }
    let mut h = Fnv1a32::new();
    h.update(name.as_bytes());
    Some(h.finish())
}

/// Normalise `name` per L4 7.1.2 (trim + fold) and hash per 7.1.1.
///
/// Returns `None` where the name is empty after trimming — such a string is
/// not a name and shall not be hashed (7.1.2).
pub fn event_hash(name: &str) -> Option<u32> {
    let trimmed = name.trim_matches(is_l4_whitespace);
    if trimmed.is_empty() {
        return None;
    }
    let mut h = Fnv1a32::new();
    let mut buf = [0u8; 4];
    for c in trimmed.chars() {
        h.update(fold(c).encode_utf8(&mut buf).as_bytes());
    }
    Some(h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fnv::fnv1a32;

    #[test]
    fn case_insensitive_ascii() {
        assert_eq!(event_hash("Hello"), event_hash("hello"));
        assert_eq!(event_hash("hello"), Some(fnv1a32(b"hello")));
    }

    #[test]
    fn trims_but_preserves_internal_whitespace() {
        assert_eq!(event_hash("  door open \u{3000}"), event_hash("door open"));
        assert_ne!(event_hash("door open"), event_hash("dooropen"));
    }

    #[test]
    fn empty_after_trim_is_not_a_name() {
        assert_eq!(event_hash(""), None);
        assert_eq!(event_hash(" \t\u{2028}\u{00A0}"), None);
    }

    #[test]
    fn latin1_fold() {
        // À → à, É → é; × is excluded from rule (b)
        assert_eq!(event_hash("ÀÉ"), event_hash("àé"));
        assert_eq!(fold('\u{D7}'), '\u{D7}');
        assert_eq!(fold('\u{DE}'), '\u{FE}');
    }

    #[test]
    fn latin_extended_a_fold() {
        // (c) even capitals: Ā (0x100) → ā (0x101), Ŋ (0x14A) → ŋ (0x14B)
        assert_eq!(fold('\u{100}'), '\u{101}');
        assert_eq!(fold('\u{14A}'), '\u{14B}');
        // lowercase (odd in those ranges) unchanged
        assert_eq!(fold('\u{101}'), '\u{101}');
        // (d) odd capitals: Ĺ (0x139) → ĺ (0x13A), Ź (0x179) → ź (0x17A)
        assert_eq!(fold('\u{139}'), '\u{13A}');
        assert_eq!(fold('\u{179}'), '\u{17A}');
        // boundary just outside (c): 0x138 ĸ unchanged; 0x178 handled by (e)
        assert_eq!(fold('\u{138}'), '\u{138}');
        assert_eq!(fold('\u{178}'), '\u{FF}');
    }

    #[test]
    fn fold_hashes_folded_utf8_bytes() {
        // "Ā" folds to "ā" (U+0101 = 0xC4 0x81)
        assert_eq!(event_hash("Ā"), Some(fnv1a32("ā".as_bytes())));
    }
}

#[cfg(test)]
mod const_path {
    use super::*;

    /// **THE LOAD-BEARING EQUALITY: the compile-time path and the runtime
    /// path agree wherever the compile-time path answers at all.**
    ///
    /// `FORMATS` 7.5.2c obliges a hive to compute the L4 hash of a name it
    /// holds. [`event_hash_of_normal`] moves that to build time, and it is
    /// only sound if it is the SAME hash — so this asserts it over the
    /// names this fleet actually uses rather than over invented ones.
    #[test]
    fn the_compile_time_hash_equals_the_runtime_hash() {
        for n in [
            "dev.indicator.heartbeat",
            "dev.indicator.traffic",
            "status.panel.refresh",
            "level.reading",
            "state.record.torn",
            "state.store.unavailable",
            "hive stage2 beacon",
            "temperature reading",
            "a",
        ] {
            assert_eq!(
                event_hash_of_normal(n),
                event_hash(n),
                "compile-time and runtime hashes disagree for {n:?}"
            );
        }
    }

    /// **THE PRECONDITION IS LOAD-BEARING, NOT DECORATIVE — asserted by
    /// showing what it prevents.**
    ///
    /// For a name that is NOT normal, hashing the raw bytes is a DIFFERENT
    /// value from the L4 hash. *So an implementation that dropped the
    /// [`is_l4_normal`] check to "optimise" would not merely be sloppy; it
    /// would compute a hash no sender ever puts on the wire* — and 7.5.6
    /// would discard the resulting non-match in silence.
    #[test]
    fn skipping_the_normality_check_would_produce_a_hash_nobody_sends() {
        for bad in ["Level.Reading", "level.reading ", " level.reading"] {
            assert_eq!(event_hash_of_normal(bad), None, "{bad:?} is not normal");
            let mut h = Fnv1a32::new();
            h.update(bad.as_bytes());
            assert_ne!(
                Some(h.finish()),
                event_hash(bad),
                "raw-byte hash of {bad:?} coincides with the L4 hash, so this \
                 control proves nothing for it"
            );
        }
    }

    /// **BOTH HALVES OF 7.1.2, BECAUSE A PROBE THAT ONLY EXERCISES CASE
    /// LEAVES THE WHITESPACE HALF UNTESTED.**
    #[test]
    fn normality_refuses_case_and_whitespace_and_the_empty_name() {
        assert!(is_l4_normal("level.reading"));
        assert!(!is_l4_normal("Level.Reading"), "fold half");
        assert!(!is_l4_normal("level.reading "), "trim half, trailing");
        assert!(!is_l4_normal(" level.reading"), "trim half, leading");
        assert!(!is_l4_normal(""), "7.1.2: not a name");
        assert!(!is_l4_normal("   "), "empty after trimming is not a name");
    }

    /// **THE STATED DEPARTURE, ASSERTED RATHER THAN DOCUMENTED: a non-ASCII
    /// name is REFUSED even when it is perfectly normal.**
    ///
    /// Over-refuse, never under-refuse — and the failure direction is safe
    /// because a `false` sends the caller to [`event_hash`], **which still
    /// answers correctly for it.** That second half is the part worth
    /// asserting: the departure costs a compile-time answer, not an answer.
    #[test]
    fn a_non_ascii_name_is_refused_here_and_still_hashes_at_runtime() {
        let n = "café.reading";
        assert!(!is_l4_normal(n), "the ASCII departure");
        assert_eq!(event_hash_of_normal(n), None);
        assert!(event_hash(n).is_some(), "the runtime path is unaffected");
    }
}

/// **THE IDIOM 7.5.2c WANTS, DEMONSTRATED AT COMPILE TIME.**
///
/// This is what a hive writes instead of a hand-maintained digest table. It
/// is `const`, so **a name that is not normal is a BUILD ERROR rather than a
/// silent non-match** — which is the whole difference the clause's Note 2
/// turns on.
#[cfg(test)]
const _TABLE_IDIOM: u32 = match event_hash_of_normal("level.reading") {
    Some(h) => h,
    None => panic!("a name a hive holds must be normal at build time"),
};
