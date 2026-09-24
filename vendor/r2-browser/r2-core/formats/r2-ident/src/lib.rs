//! The FORMATS-band identifier types that every layer keys on.
//!
//! **`r2-ident` — the identifiers every layer keys on** (FORMATS 3.3, L4
//! 6.1.3; `D-226`, the first crate of `r2-core/`).
//!
//! One type today, deliberately: [`HiveId`], the 8-byte canonical hive
//! identifier. It lived in `r2-mesh`'s `l3` module, and **an L1 bearer
//! reporting link quality per peer (L1 4.5.3) had to reach UP to L3 for the
//! type** — five real references, invisible to `cargo xtask layering`
//! because the gate reads crate edges and this one was inside a crate.
//! An identifier defined by FORMATS and pinned by L4 belongs to neither L1
//! nor L3; it belongs below both, where every use is downward.
//!
//! `r2-mesh::l3` re-exports it, so existing paths keep resolving.
//!
//! # Examples
//!
//! ```
//! use r2_ident::HiveId;
//!
//! // An 8-byte extended entry keys as-is.
//! let extended = HiveId::from_wire(&[1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
//! assert_eq!(extended.0, [1, 2, 3, 4, 5, 6, 7, 8]);
//!
//! // A 4-byte compact entry widens LOW-side: the 4 bytes become the hive
//! // half, group half zero (L4 9.2.4).
//! let widened = HiveId::from_wire(&[0xAA, 0xBB, 0xCC, 0xDD]).unwrap();
//! assert_eq!(widened.0, [0, 0, 0, 0, 0xAA, 0xBB, 0xCC, 0xDD]);
//! ```

#![no_std]

/// Canonical hive identifier, as keyed below the trust boundary.
///
/// PROVISIONAL (STD-SS23, endorsed by standard D-013): the identifier is L5
/// identity material of unpinned width; the 8-byte extended wire form
/// (L4 6.1.3) is the only width pinned at L0-L4, so tables key on it.
/// Widening a compact 4-byte value is now normative: LOW-side
/// zero-extension — the 4 bytes become the hive half, group half zero
/// (L4 9.2.4, register L4-075). PROVISIONAL (FORMATS.md draft, 6e8348a):
/// the compact value is the hive half, derived as SHA-256 bytes 0-3 of
/// the Ed25519 identity with reserved-value skip — consistent with this
/// keying; do not hardcode the derivation until FORMATS stabilises.
/// Narrowing with a nonzero group half stays unruled (STD-SS6 residue), and a
/// hive seen at both tiers may still key twice (L4 14.1 is open on
/// dual-tier bridging).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub struct HiveId(pub [u8; 8]);

impl HiveId {
    /// Builds a [`HiveId`] from an 8- or 4-byte wire origin/route entry.
    ///
    /// Key from a wire origin/route entry: 8 bytes as-is, 4 bytes widened
    /// by LOW-side zero-extension per L4 9.2.4 (hive half = the 4 bytes,
    /// group half zero). Anything else is not a valid entry width (L4 8.4).
    ///
    /// ‼ **AN ORIGIN OR ROUTE ENTRY, NEVER A TARGET.** `hive` reported
    /// 2026-08-15 that two widenings of the same four bytes exist in this
    /// workspace and disagree — this one puts them in the **hive half**
    /// (`id[4..]`), theirs in the **group half**. **This one is the
    /// normative direction and the other is superseded in terms**: L4 6.1.3
    /// lays the extended target out as *a group half and a hive half*, in
    /// that order, and 9.2.4 says the four compact bytes **become the hive
    /// half with the group half zero**. Its Note 1 names the other form
    /// exactly — *a deployed transcoder that widened high-side is
    /// superseded, migration M10.*
    ///
    /// ‼ **AND A COMPACT TARGET MUST NOT BE PUT THROUGH HERE AT ALL.** 6.1.2
    /// Note 2: *a compact target is one hash that could name a group or a
    /// hive, and the frame does not say which* — **the receiver resolves
    /// it.** A relay holding a frame for somebody else is **not the
    /// receiver**, so it cannot perform that resolution, and widening the
    /// four bytes here would manufacture a hive identity out of something
    /// that may name a group. *A route entry is already known to be a hive;
    /// a target is not.* Same bytes, same width, different question.
    ///
    /// # The failure this prevents is silent, which is why it is stated here
    ///
    /// `CustodyBuffer` and `NeighbourTable` are both keyed by `HiveId`
    /// and **nothing in the types requires a caller to derive the two the
    /// same way.** `hive` measured what that costs on a live bench: their
    /// neighbour keys are MAC-derived, so a key widened from a four-byte
    /// target could never equal one, `NeighbourTable::path_established`
    /// would be **structurally always false**, and every retained frame
    /// would sit unreleased — *indistinguishable, from outside, from a
    /// destination that simply never became reachable.* **It would pass
    /// every test written against it and look like a quiet network.**
    /// **The obligation is the caller's and it is one sentence: the custody
    /// key and the neighbour key must come from the same derivation.**
    ///
    /// ‼ **AND 9.2.4 IS THE WRONG CITATION FOR A MESSAGE IDENTIFIER**
    /// (`standard`, 2026-08-15). This function widens an **origin or route
    /// entry**, which is 9.2.4's subject. A dedup key is a pair, and its
    /// *other* half is governed by **9.2.2** — *a compact message
    /// identifier crossing to extended shall be zero-extended; an extended
    /// one shall not be truncated.* Same direction, different clause.
    /// **Nothing here widens an identifier** — `msg_id` is carried as `u32`
    /// and never crosses — *so this is a citation for whoever adds that,
    /// not a correction to anything present.*
    ///
    /// ‼ **AND WHETHER A COMPACT-TIER RELAY MAY RETAIN AT ALL IS `STD-SS373`,
    /// OPEN WITH ROY.** `standard` had registered it before this lane
    /// asked. **L4 9.2.5 already forbids a non-broadcast compact target
    /// from crossing to extended, in terms, because which half it names
    /// cannot be known** — *the corpus met this exact impossibility once
    /// and refused the act rather than guessing.* Both readings cost
    /// something real: refusing takes store-and-forward from the tier of
    /// the smallest radios, where sleeping devices need it most; reading
    /// the target as a hive holds a group frame for a hash no neighbour
    /// will match, which 7.1.3 Note 2 calls *a slow silent drop that spends
    /// buffer a genuinely sleeping destination needed.* **Not implemented
    /// either way here, deliberately.**
    ///
    /// # Examples
    ///
    /// ```
    /// use r2_ident::HiveId;
    ///
    /// // 8 bytes: keyed as-is.
    /// assert_eq!(
    ///     HiveId::from_wire(&[1, 2, 3, 4, 5, 6, 7, 8]),
    ///     Some(HiveId([1, 2, 3, 4, 5, 6, 7, 8])),
    /// );
    ///
    /// // 4 bytes: widened LOW-side — hive half = the 4 bytes, group half
    /// // zero (L4 9.2.4).
    /// assert_eq!(
    ///     HiveId::from_wire(&[0xAA, 0xBB, 0xCC, 0xDD]),
    ///     Some(HiveId([0, 0, 0, 0, 0xAA, 0xBB, 0xCC, 0xDD])),
    /// );
    ///
    /// // Any other width is not a valid entry (L4 8.4).
    /// assert_eq!(HiveId::from_wire(&[1, 2, 3]), None);
    /// ```
    #[must_use]
    pub fn from_wire(entry: &[u8]) -> Option<Self> {
        match entry.len() {
            8 => {
                let mut id = [0u8; 8];
                id.copy_from_slice(entry);
                Some(Self(id))
            }
            4 => {
                let mut id = [0u8; 8];
                id[4..].copy_from_slice(entry);
                Some(Self(id))
            }
            _ => None,
        }
    }
}
