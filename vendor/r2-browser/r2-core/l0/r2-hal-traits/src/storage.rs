//! Persistent storage (L0 5.3): retains contents across power loss, readable
//! and writable without network access. Sufficient at least for the device
//! identity (L0 4.3.1); a key-bearing platform also retains trust-group key
//! material here (L0 5.3.2 — that use lives above the trust boundary and
//! never passes through Layer 1-4 code, L0 6.1).

/// **What a storage error MEANS, which the error type alone cannot say**
/// (`SS507`, r2-codex-refute 2026-08-25).
///
/// ‼ **AN UNCLASSIFIED ERROR WAS READ AS AN ANSWER, AND THAT WAS ONE ROOT
/// UNDER FIVE DEFECTS.** `Self::Error` is opaque to every consumer, so the
/// durable custody queue treated EVERY write failure as *the store is full*
/// and discarded the oldest frame to make room — **a transient bus fault
/// therefore evicted a good frame**, though L3 7.4.1 permits a discard only
/// at the bound. The same opacity made a failed read indistinguishable from
/// an absent key, which silently forgot frames and orphaned others.
///
/// *Only the implementation knows which its error is*, so only the
/// implementation can say — and it is asked rather than guessed at.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StorageFault {
    /// **No room.** The only condition under which 7.4.1's discard-the-oldest
    /// is a correct response.
    Full,
    /// Anything else: a device fault, a corrupt record, a bus error, a
    /// refusal the medium did not explain. **Never a reason to discard
    /// somebody else's frame**, and never to be read as absence.
    Fault,
}

/// Persistent key-value storage.
pub trait Storage {
    type Error: core::fmt::Debug;

    /// **Which kind of failure this is** — see [`StorageFault`].
    ///
    /// ‼ **NO DEFAULT IMPLEMENTATION, DELIBERATELY.** A default answering
    /// `Full` is the guess that caused the defect, and a default answering
    /// `Fault` would stop every legitimate eviction; either way an
    /// implementation that gained a real classification would go on reporting
    /// the default with nothing to say so. Every store answers for its own
    /// errors.
    fn classify(&self, error: &Self::Error) -> StorageFault;

    /// Read the value under `key` into `buf`, returning the value's full
    /// length. Where the value is longer than `buf`, `buf` holds the prefix
    /// and the returned length still reports the full size. Returns
    /// `Ok(None)` where the key is absent.
    fn read(&self, key: &[u8], buf: &mut [u8]) -> Result<Option<usize>, Self::Error>;

    /// Write `value` under `key`, replacing any existing value. The write is
    /// durable across power loss once this returns `Ok`.
    fn write(&mut self, key: &[u8], value: &[u8]) -> Result<(), Self::Error>;

    /// Remove `key`. Removing an absent key is not an error.
    fn remove(&mut self, key: &[u8]) -> Result<(), Self::Error>;
}
