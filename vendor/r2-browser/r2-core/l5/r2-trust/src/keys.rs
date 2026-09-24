//! Key material custody (L5 5.3).
//!
//! The standard names the verification method for this clause directly:
//! *"by inspection of types — key-bearing types are non-copyable and erase
//! on release — and by asserting the redacted form of every key-bearing
//! type's diagnostic output"* (L5 5.3, Verification). This module makes
//! those properties structural rather than procedural:
//!
//! - [`SecretKey`] is **not** `Copy` and **not** `Clone`: no implicit copy
//!   can be made (L5 5.3.4).
//! - Its bytes live in a [`zeroize::Zeroizing`], whose `Drop` erases them
//!   through volatile writes — zeroize's exact guarantee; it contains no compiler fence — *"by a means the
//!   toolchain cannot elide"* (5.3.4). **This module writes no erasure of
//!   its own.** Until 2026-08-25 it did — assignment plus
//!   `core::hint::black_box`, which rustc documents as best-effort with no
//!   security guarantee (r2-codex-refute, confirmed against 5.3.4).
//! - [`SecretKey::new`] takes its material **from a caller's buffer and
//!   erases that buffer in the same step**, so the caller is not left
//!   holding a readable copy the wrapper cannot see (5.3.4, *no implicit
//!   copies*).
//! - Its `Debug` prints a redaction, so a key cannot reach a crash report,
//!   log or serialised form — *"a key printed into a crash report has been
//!   persisted as surely as one written to disk"* (5.3 Note 1).

use core::fmt;
use zeroize::{Zeroize, Zeroizing};

/// Secret key material of `N` bytes.
///
/// Plaintext key material at rest is forbidden in every case (L5 5.3.2):
/// this type is an in-memory custody wrapper, and persisting its contents
/// is the caller's obligation to do sealed, or not at all — a platform
/// without a sealing facility keeps derived keys volatile and re-obtains
/// them on next contact with the group (5.3.2).
///
/// Non-copyability is enforced by the compiler, and this example is the
/// executable form of that half of L5 5.3's verification method — it must
/// fail to compile:
///
/// ```compile_fail
/// use r2_trust::keys::SecretKey;
/// let a = SecretKey::new(&mut [0u8; 4]);
/// let b = a;              // moves, because SecretKey is not Copy
/// let _ = a.len();        // error: use of moved value
/// ```
///
/// A borrow, which is what a cryptographic operation needs, compiles —
/// and outside this crate a borrow reaches only the redaction and the
/// length, never the bytes:
///
/// ```
/// use r2_trust::keys::SecretKey;
/// let a = SecretKey::new(&mut [7u8; 4]);
/// assert_eq!(a.len(), 4);
/// assert_eq!(format!("{a:?}"), "SecretKey<4>(redacted)");
/// ```
///
/// **The raw bytes are unreachable from outside the crate.** `expose` is
/// `pub(crate)`: a public `&[u8; N]` is one dereference from a `Copy`
/// array, so `let leaked = *key.expose();` would have walked the material
/// out of custody by value — which is what the accessor did until
/// 2026-08-25 (r2-codex-refute: *the public accessor defeats the structural
/// boundary and its own claim*). A key now leaves this crate only through an
/// operation that consumes it in place, such as
/// `suite::HmacSha256Tag::tag_frame`:
///
/// ```compile_fail,E0624
/// use r2_trust::keys::SecretKey;
/// let k = SecretKey::new(&mut [7u8; 4]);
/// let leaked = *k.expose(); // error: method `expose` is private
/// ```
#[must_use = "SecretKey::new erased its source as part of the transfer; dropping the result destroys the held copy"]
pub struct SecretKey<const N: usize> {
    bytes: Zeroizing<[u8; N]>,
}

impl<const N: usize> SecretKey<N> {
    /// Take custody of the material in `source`, **erasing `source`** as
    /// part of the transfer: when this returns, `source` is all zeros, and
    /// the wrapper is neither `Copy` nor `Clone`. A by-value constructor
    /// would have left the caller's array — `Copy`, and so freely
    /// duplicable — readable after the wrapper existed, which is the
    /// implicit copy 5.3.4 forbids.
    ///
    /// **What this does NOT prove** (r2-codex-refute, 2026-08-25): that the
    /// returned key is the only physical copy. The `Zeroizing` is built as
    /// a local and MOVED into the return, and `zeroize`'s own documentation
    /// warns that moves and stack spills may leave copies (it recommends
    /// heap plus `Pin` where that matters). The claim here is exactly the
    /// tested one — source erased, no `Copy`/`Clone` — and the physical-copy
    /// limit is recorded as `SS488` in `ledgers/OPEN-QUESTIONS.md` rather
    /// than asserted away.
    pub fn new(source: &mut [u8; N]) -> Self {
        let bytes = Zeroizing::new(*source);
        source.zeroize();
        Self { bytes }
    }

    /// Borrow the material for a cryptographic operation **inside this
    /// crate**. Crate-private on purpose: a public `&[u8; N]` is one
    /// dereference from a `Copy` array, so the bytes would escape custody by
    /// value through any consumer. Consumers are given purpose-specific
    /// operations that take `&SecretKey` instead.
    pub(crate) fn expose(&self) -> &[u8; N] {
        &self.bytes
    }

    pub const fn len(&self) -> usize {
        N
    }

    pub const fn is_empty(&self) -> bool {
        N == 0
    }
}

/// Redacted: key material never appears in diagnostic output (L5 5.3.4).
impl<const N: usize> fmt::Debug for SecretKey<N> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "SecretKey<{N}>(redacted)")
    }
}

/// A group's integrity key: what the delivery gate verifies tags under
/// (L5 7.1.2, derived per 5.2.2).
pub type IntegrityKey = SecretKey<32>;

/// A group's payload-protection key (L5 5.2.2, cipher per FORMATS 4.1).
pub type PayloadKey = SecretKey<32>;

/// Whether a prior key is in grace **after a restart**.
///
/// A grace deadline is an instant on the local monotonic ruler, and L0 5.2
/// forbids assuming an interval spanning a power cycle is measurable — so a
/// deadline recorded before a restart means nothing after it. The gate
/// therefore starts with no prior key in grace and re-obtains material from
/// the group, which is the fail-closed reading of L5 7.1.3.
///
/// Reported by this lane and now stated: L5 7.1.3 Note 2.
pub const PRIOR_KEY_IN_GRACE_AFTER_RESTART: bool = false;

#[cfg(test)]
mod tests {
    use super::*;
    extern crate std;
    use std::format;

    #[test]
    fn debug_output_is_redacted() {
        // L5 5.3 Verification: assert the redacted form of the diagnostic
        // output of every key-bearing type.
        let k = SecretKey::new(&mut [0xAB; 32]);
        let shown = format!("{k:?}");
        assert_eq!(shown, "SecretKey<32>(redacted)");
        assert!(!shown.contains("ab") && !shown.contains("AB") && !shown.contains("171"));
    }

    #[test]
    fn material_is_reachable_only_by_borrow() {
        let k: IntegrityKey = SecretKey::new(&mut [7; 32]);
        assert_eq!(k.expose(), &[7u8; 32]);
        assert_eq!(k.len(), 32);
    }

    // Non-copyability is checked by the `compile_fail` doctest on
    // `SecretKey` itself, where it actually runs — a doctest inside this
    // `cfg(test)` module would never be executed.

    /// L5 5.3.4, *no implicit copies*: taking custody leaves the source
    /// unreadable. Fails against a constructor that copies without erasing.
    #[test]
    fn taking_custody_erases_the_source() {
        let mut source = [0x5A; 32];
        let k = SecretKey::new(&mut source);
        assert_eq!(source, [0u8; 32], "5.3.4: the caller still holds a copy");
        // EXCLUDED CASE: the material arrived — the zeros above are a
        // transfer, not a constructor that discards its input.
        assert_eq!(k.expose(), &[0x5A; 32]);
    }

    /// L5 5.3.4, *erased when it leaves use*. **What this can and cannot
    /// check, stated:** safe Rust cannot read a slot after its value has
    /// been dropped, so no test here observes the erased bytes — that
    /// would take `unsafe`, which this crate forbids. What CAN be pinned
    /// is the type: a bare `[u8; N]` has no drop glue, so `needs_drop` is
    /// true only while the bytes sit inside `Zeroizing`. A mutation that
    /// swaps the field back to a raw array fails here. The erasure itself
    /// is `zeroize`'s, not this crate's, which is why there is no hand
    /// `Drop` whose body a mutation could empty.
    #[test]
    fn erasure_on_release_is_in_the_type() {
        assert!(
            core::mem::needs_drop::<SecretKey<32>>(),
            "5.3.4: a SecretKey with no drop glue erases nothing on release"
        );
        // CONTROL: the assertion above is not vacuous — the bytes alone
        // have no drop glue.
        assert!(!core::mem::needs_drop::<[u8; 32]>());
    }

    #[test]
    fn no_prior_key_is_in_grace_after_restart() {
        // L0 5.2: an interval spanning a power cycle is not measurable.
        const { assert!(!PRIOR_KEY_IN_GRACE_AFTER_RESTART) };
    }

    /// Stronger than `needs_drop` (the skeptic's point): a raw `[u8; N]`
    /// field plus an EMPTY hand `impl Drop` would pass `needs_drop` and erase
    /// nothing. `ZeroizeOnDrop` is the trait only the zeroizing wrapper
    /// implements, so a field-type revert fails to COMPILE here.
    #[test]
    fn the_field_is_zeroize_on_drop_not_merely_dropped() {
        fn pinned<T: zeroize::ZeroizeOnDrop>(_: &T) {}
        let mut src = [7u8; 32];
        let k = SecretKey::<32>::new(&mut src);
        pinned(&k.bytes);
    }
}
