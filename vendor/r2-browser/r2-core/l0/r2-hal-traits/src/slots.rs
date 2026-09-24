//! Image slot mechanics (L6 5.4).
//!
//! Staging, switching and reverting are the platform's; the apply/health/
//! revert state machine is Layer 6's. This trait is the seam.
//!
//! ## Two guarantees the trait shape provides
//!
//! **Nothing here can name a persona.** An implementor holds handles to
//! its OTA and state regions only. L6 4.2.2 demands that by construction,
//! and a trait handing out a whole-flash handle would make the clause
//! unsatisfiable for anyone implementing it — the requirement is the
//! narrow handle, not merely the intention to use it narrowly.
//!
//! **Two refusals are obligations, not options.** `begin_stage` refuses
//! the running slot and `confirm` refuses with nothing pending — both
//! reachable from a plain local call with no untrusted input anywhere,
//! and both destroying the rollback path the standard relies on. They are
//! stated on the methods and controlled by the mock below. (Raised by the
//! hive lane, which found them in its own implementation after supplying
//! the shape this trait was published from.)
//!
//! **Selecting a boot slot requires proof.** [`ImageSlots::mark_pending`]
//! takes `Self::Permission`, an associated type the implementor chooses,
//! so a platform can require Layer 6's verified-package token without
//! this crate depending on Layer 6 — it is the leaf crate, and a
//! dependency here would force every HAL implementation to link every
//! layer. The permission is taken **by value**: a receipt that can be
//! reused is a receipt that can be replayed.
//!
//! ```
//! use r2_hal_traits::slots::{ImageSlots, SlotError, SlotId, SlotImage};
//! # struct P;
//! # struct Platform { staged: bool }
//! impl ImageSlots for Platform {
//!     type Permission = P;      // a real platform uses r2-mgmt's token
//!     type Error = SlotError;
//!     fn running(&self) -> SlotId { SlotId(0) }
//!     fn target(&self) -> SlotId { SlotId(1) }
//!     // The running-slot guard is the trait's; this is the platform half.
//!     fn begin_stage_on_non_running(&mut self, _: SlotId) -> Result<(), Self::Error> { Ok(()) }
//!     fn write_stage(&mut self, _: u32, _: &[u8]) -> Result<(), Self::Error> { Ok(()) }
//!     fn read_slot(&mut self, _: SlotId, _: u32, _: &mut [u8]) -> Result<usize, Self::Error> { Ok(0) }
//!     fn slot_image(&mut self, _: SlotId) -> Result<SlotImage, Self::Error> { Ok(SlotImage::Empty) }
//!     fn mark_pending(&mut self, _: SlotId, _: Self::Permission) -> Result<(), Self::Error> { Ok(()) }
//!     fn confirm(&mut self) -> Result<(), Self::Error> { Ok(()) }
//!     fn revert(&mut self) -> Result<(), Self::Error> { Ok(()) }
//!     fn slot_capacity(&self, _: SlotId) -> u32 { 0 }
//! }
//! ```
//!
//! Selecting a boot slot without a permission does not compile:
//!
//! ```compile_fail
//! # use r2_hal_traits::slots::{ImageSlots, SlotId};
//! fn boot_it<S: ImageSlots>(s: &mut S) {
//!     s.mark_pending(SlotId(1));   // missing the permission argument
//! }
//! ```
//!
//! Nor does reusing one, since it is taken by value:
//!
//! ```compile_fail
//! # use r2_hal_traits::slots::{ImageSlots, SlotId};
//! fn twice<S: ImageSlots>(s: &mut S, p: S::Permission) {
//!     let _ = s.mark_pending(SlotId(1), p);
//!     let _ = s.mark_pending(SlotId(1), p);   // p was moved
//! }
//! ```

/// Which image slot.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SlotId(pub u8);

/// What a slot holds, as far as the platform can tell.
///
/// Three facts, distinguishable, as **terminology 5.3** now requires: a
/// platform asked a question about its own state may answer *I cannot
/// tell*, and a clause posing such a question shall name it alongside the
/// others. Folding the middle one into either neighbour is what does the
/// damage.
///
/// Reading `PresentLengthUnknown` as `Empty` treats a real fallback image
/// as an empty slot — and the caller that then declines to copy it, or
/// erases it as free space, has destroyed the rollback target L6 5.4.3
/// depends on. Reading it as `Present { bytes: 0 }` is the same error
/// wearing a number.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlotImage {
    /// Erased, or holding nothing this platform recognises as an image.
    Empty,
    /// An image is present, but this platform cannot say how long it is.
    ///
    /// A caller that must cover the whole image — digesting it, or
    /// serving it to a neighbour — treats this as "up to
    /// [`ImageSlots::slot_capacity`]" and pays for the erased tail. It
    /// does **not** treat it as absent.
    PresentLengthUnknown,
    /// An image of exactly this many bytes.
    Present { bytes: u32 },
}

impl SlotImage {
    /// Whether a slot holds something that must not be discarded.
    ///
    /// True for both present cases. The method exists so the common
    /// question is asked once, correctly, rather than by each caller
    /// matching and getting the middle case wrong.
    #[must_use]
    pub const fn holds_an_image(self) -> bool {
        !matches!(self, SlotImage::Empty)
    }

    /// How many bytes a caller must cover to be sure it has the whole
    /// image, given this slot's capacity.
    ///
    /// `PresentLengthUnknown` yields the full capacity: covering too much
    /// costs time, covering too little serves or digests a truncated
    /// image, and only one of those is a correctness failure.
    #[must_use]
    pub const fn bytes_to_cover(self, capacity: u32) -> u32 {
        match self {
            SlotImage::Empty => 0,
            SlotImage::PresentLengthUnknown => capacity,
            SlotImage::Present { bytes } => bytes,
        }
    }
}

/// Ordinary slot failures.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SlotError {
    /// No such slot on this platform.
    NoSuchSlot,
    /// The image does not fit the slot.
    Oversize,
    /// A write arrived with no staging session open — the platform has no
    /// record that this slot was ever begun, so it cannot know what the
    /// bytes belong to.
    NotStaging,
    /// Staging was attempted on the **running** slot. Erasing it destroys
    /// the executing image and the rollback target in one act — the
    /// outcome L6 5.4.3's unaided rollback exists to make impossible.
    WouldEraseRunning,
    /// Commit was attempted with nothing pending. Committing releases the
    /// prior image, so doing it with nothing staged discards the fallback
    /// for no gain — and on a board whose position is *indeterminate*, it
    /// would discard it on the strength of a record the platform could
    /// not read (L6 5.2.3b's hazard, reached through this API).
    NothingPending,
    /// The underlying storage failed.
    Storage,
}

/// Platform image-slot mechanics.
///
/// Mechanics only: whether an update *should* be applied, whether its
/// health passed, and what to do when it fails are Layer 6's, which owns
/// the state machine. An implementor answers questions about slots and
/// does what it is told, with the one exception that it demands a
/// [`ImageSlots::Permission`] before changing what boots.
pub trait ImageSlots {
    /// Proof that selecting a boot slot is permitted.
    ///
    /// A platform sets this to Layer 6's verified-package token, so
    /// "marked pending without verification" is unconstructible end to
    /// end rather than checked at each layer. A host mock may use `()`.
    type Permission;

    /// ‼ **`From<SlotError>` IS REQUIRED SO THE TRAIT CAN REFUSE ON AN
    /// IMPLEMENTOR'S BEHALF.** The running-slot guard below is a provided
    /// method, and a provided method that could not construct the refusal
    /// would have to be left to each implementation — *which is the
    /// arrangement this change exists to end.* Every implementor whose error
    /// is `SlotError` satisfies it for free.
    type Error: core::fmt::Debug + From<SlotError>;

    /// The slot currently running.
    ///
    /// Infallible on purpose: there is no honest answer to "the platform
    /// forgot what it booted", so a platform that cannot tell has a
    /// bigger problem than an error variant would express.
    ///
    /// **Obligation (terminology 5.4a / T-006): where the record behind
    /// this answer is also read by the platform's bootloader, an
    /// implementation shall accept it only under the strictest validity
    /// predicate among all its readers.**
    ///
    /// This is not hypothetical and it is not the implementor's fault
    /// when it goes wrong. Measured (CORE-2/STD-SS144): the ESP-IDF
    /// bootloader accepts an OTA select entry only when its sequence is
    /// initialised **and its CRC matches** and its state is not
    /// invalid — while a widely used Rust binding writes that CRC and
    /// **never verifies one on read**. A record with a good sequence and
    /// a corrupt checksum is therefore *invalid to the bootloader and
    /// valid to the application*, and the device **boots one slot and
    /// reports another**, silently, with every check the application can
    /// see passing.
    ///
    /// Neither party can detect that from its own side, so the only thing
    /// that finds it is **reading the other definition**. An implementor
    /// who has not compared its binding's predicate against its
    /// bootloader's has not satisfied this obligation, however carefully
    /// it validated the bytes it read.
    ///
    /// **Implementations may cache this**, and on a platform where the
    /// answer lives in flash they generally must, since reading flash
    /// wants `&mut`. Caching carries a precondition: **the platform must
    /// guarantee no other writer of the boot record**, because a cached
    /// value cannot notice something else rewriting it underneath, and a
    /// stale `running()` selects the wrong target slot. Confining the raw
    /// boot-record API to one module is one way to hold that guarantee;
    /// having no such confinement is how it is silently lost. (Raised by
    /// the hive lane, whose implementation caches safely for exactly that
    /// reason.)
    fn running(&self) -> SlotId;

    /// The slot a staged image would be written to.
    fn target(&self) -> SlotId;

    /// Open a staging session on `slot`, erasing what was there.
    ///
    /// ‼ **THE RUNNING-SLOT GUARD IS HERE, AND IT USED TO BE A SENTENCE.**
    ///
    /// This doc said *an implementation shall refuse where `slot` is
    /// [`running`](ImageSlots::running)* and the trait enforced nothing:
    /// **an implementer who never considered the case was conformant to the
    /// signature and one call from bricking a device.** Erasing the running
    /// slot destroys the executing image *and* the rollback target in one
    /// act — precisely what L6 5.4.3's unaided rollback exists to prevent.
    ///
    /// *The obligation is now a provided method*, so the check happens
    /// whether or not an implementor thought of it, and
    /// [`begin_stage_on_non_running`](ImageSlots::begin_stage_on_non_running)
    /// is what an implementation writes.
    ///
    /// ⚠ **WHAT THIS DOES NOT CLOSE, STATED RATHER THAN IMPLIED**: a
    /// provided method can be *overridden*, so this ends the FORGETTING
    /// failure and not the deliberate one. **`git grep "fn begin_stage"`
    /// finds every override**, and an override is a thing somebody wrote on
    /// purpose rather than a case they never met.
    ///
    /// **L6 5.4.1c binds the other half and no type can**: `running` must be
    /// *the platform's report of the image it BOOTED, never a record of the
    /// image that was configured to boot.* The two differ **exactly after a
    /// fallback** — which is after a revert, so a guard keyed on the record
    /// protects the wrong slot in the one situation 5.4.3 exists to survive.
    fn begin_stage(&mut self, slot: SlotId) -> Result<(), Self::Error> {
        if slot == self.running() {
            return Err(SlotError::WouldEraseRunning.into());
        }
        self.begin_stage_on_non_running(slot)
    }

    /// Open a staging session on `slot`, erasing what was there.
    ///
    /// **Called only after the running-slot guard has passed**, so an
    /// implementation writes what is particular to its platform — a health
    /// window that must not be erased, a partition lookup, the erase itself —
    /// and never the check every platform shares.
    fn begin_stage_on_non_running(&mut self, slot: SlotId) -> Result<(), Self::Error>;

    /// Write staged bytes at `offset`. Fails with `NotStaging`-equivalent
    /// where no session is open: bytes that belong to nothing must not
    /// land in a slot something might later boot.
    fn write_stage(&mut self, offset: u32, bytes: &[u8]) -> Result<(), Self::Error>;

    /// Read from `slot` into `buf`, returning how many bytes were read.
    ///
    /// **Why a read capability belongs here at all**, given that this
    /// trait otherwise exists to constrain writes: L6 5.2.2 requires a
    /// hive to verify the digest before *serving* a package, and 5.3.5
    /// says any holder may answer a request for pieces. A hive with 512 KB
    /// of RAM and a multi-megabyte image cannot hold one to digest or
    /// serve it — it must read the image back out of the slot it landed
    /// in. Without this, the epidemic model of 5.3 is unimplementable
    /// above this seam, and the alternative is every platform reaching
    /// around the trait to its raw flash API, which is precisely the
    /// confinement L6 4.2.2 asks for.
    ///
    /// **Reading takes no permission**, unlike
    /// [`ImageSlots::mark_pending`]. The asymmetry is deliberate and
    /// load-bearing: reading changes nothing and cannot be replayed into
    /// damage, while selecting a boot slot is durable and irreversible.
    /// Demanding proof for a read would spend the permission on the
    /// harmless half of the job.
    ///
    /// **This does not widen what the trait can see.** An implementor
    /// still holds handles to its OTA and state regions only, so a read
    /// cannot reach a persona any more than a write could — L6 4.2.2 is
    /// unaffected. The narrow handle is what bounds this, not the absence
    /// of a read method.
    ///
    /// Short reads are ordinary: fewer bytes than `buf.len()` means the
    /// slot ended. Reading past the end yields `Ok(0)`, not an error.
    fn read_slot(
        &mut self,
        slot: SlotId,
        offset: u32,
        buf: &mut [u8],
    ) -> Result<usize, Self::Error>;

    /// What `slot` holds, and how much of it is image (L6 5.2.2, 5.3.5).
    ///
    /// [`ImageSlots::slot_capacity`] answers *how big is the slot*, which
    /// is a different question and not a substitute: a caller that
    /// digests or serves a whole 1.6 MB slot to send a 400 KB image
    /// wastes airtime on erased flash, on exactly the constrained bearers
    /// 5.3 is written for.
    ///
    /// Returning [`SlotImage::PresentLengthUnknown`] is a conformant
    /// answer and often the honest one — a platform storing raw images
    /// with no length metadata genuinely cannot say. What is **not**
    /// conformant is answering [`SlotImage::Empty`] when unsure: that
    /// invites a caller to treat a live rollback target as free space.
    ///
    /// Platform knowledge lives on this side of the seam on purpose, and
    /// it is genuinely harder than it looks. **Corrected by the hive lane
    /// from the bench**: the ESP32-S3 application descriptor at offset
    /// 0x20 carries a version and a project name but **no length**, so
    /// "read the application descriptor" does *not* settle the question —
    /// exact length needs a segment walk. That platform therefore answers
    /// [`SlotImage::PresentLengthUnknown`], distinguishing present from
    /// empty exactly (by the 0xE9 magic) and declining to guess the rest.
    /// **That is the middle variant working as intended**, not a
    /// shortfall: the errors are asymmetric, and a platform with nothing
    /// to validate a segment walk against should say so rather than ship
    /// an unverified length. Four platforms each inventing the notion
    /// separately is the outcome this method exists to prevent.
    fn slot_image(&mut self, slot: SlotId) -> Result<SlotImage, Self::Error>;

    /// Select `slot` for the next boot, consuming the permission.
    ///
    /// This is the durable, security-relevant act — it changes what the
    /// bootloader runs — which is why it is the one method that demands
    /// proof rather than trusting its caller.
    fn mark_pending(
        &mut self,
        slot: SlotId,
        permission: Self::Permission,
    ) -> Result<(), Self::Error>;

    /// Commit the running image, releasing the prior one (L6 5.4.2).
    ///
    /// **Obligation:** an implementation shall refuse where nothing is
    /// pending. Commit is the act that releases the fallback, so with
    /// nothing staged it throws the prior image away for no gain — and on
    /// a freshly flashed board, whose position is *indeterminate* rather
    /// than settled, it would do so on the strength of a record the
    /// platform could not read. [`SlotError::NothingPending`] names it.
    fn confirm(&mut self) -> Result<(), Self::Error>;

    /// Revert to the prior image, unaided (L6 5.4.3).
    fn revert(&mut self) -> Result<(), Self::Error>;

    /// Bytes `slot` can hold. Cacheable under the same precondition as
    /// [`ImageSlots::running`].
    fn slot_capacity(&self, slot: SlotId) -> u32;
}

/// An exclusive borrow can own an update session without moving the backend's
/// partition buffers through each transfer/verification state. The original
/// backend remains inaccessible until that borrow is released. Every operation,
/// including an overridden staging guard, delegates to the same backend.
///
/// ```compile_fail
/// use r2_hal_traits::ImageSlots;
/// fn use_session<S: ImageSlots>(mut slots: S) { let _ = slots.revert(); }
/// fn cannot_write_behind_session<S: ImageSlots>(slots: &mut S) {
///     let session = &mut *slots;
///     let _ = slots.revert(); // session still owns the exclusive borrow
///     use_session(session);
/// }
/// ```
impl<S: ImageSlots + ?Sized> ImageSlots for &mut S {
    type Permission = S::Permission;
    type Error = S::Error;

    fn running(&self) -> SlotId {
        (**self).running()
    }
    fn target(&self) -> SlotId {
        (**self).target()
    }
    fn begin_stage(&mut self, slot: SlotId) -> Result<(), Self::Error> {
        (**self).begin_stage(slot)
    }
    fn begin_stage_on_non_running(&mut self, slot: SlotId) -> Result<(), Self::Error> {
        (**self).begin_stage_on_non_running(slot)
    }
    fn write_stage(&mut self, offset: u32, bytes: &[u8]) -> Result<(), Self::Error> {
        (**self).write_stage(offset, bytes)
    }
    fn read_slot(
        &mut self,
        slot: SlotId,
        offset: u32,
        buf: &mut [u8],
    ) -> Result<usize, Self::Error> {
        (**self).read_slot(slot, offset, buf)
    }
    fn slot_image(&mut self, slot: SlotId) -> Result<SlotImage, Self::Error> {
        (**self).slot_image(slot)
    }
    fn mark_pending(
        &mut self,
        slot: SlotId,
        permission: Self::Permission,
    ) -> Result<(), Self::Error> {
        (**self).mark_pending(slot, permission)
    }
    fn confirm(&mut self) -> Result<(), Self::Error> {
        (**self).confirm()
    }
    fn revert(&mut self) -> Result<(), Self::Error> {
        (**self).revert()
    }
    fn slot_capacity(&self, slot: SlotId) -> u32 {
        (**self).slot_capacity(slot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Mock {
        staging: Option<SlotId>,
        pending: Option<SlotId>,
        writes: u32,
        /// Slot contents, short enough to assert on.
        contents: [[u8; 8]; 2],
        lens: [Option<u32>; 2],
    }

    impl Mock {
        fn new() -> Self {
            Mock {
                staging: None,
                pending: None,
                writes: 0,
                contents: [[0xFF; 8]; 2],
                lens: [None, None],
            }
        }
    }

    impl ImageSlots for Mock {
        type Permission = ();
        type Error = SlotError;

        fn running(&self) -> SlotId {
            SlotId(0)
        }
        fn target(&self) -> SlotId {
            SlotId(1)
        }
        fn begin_stage_on_non_running(&mut self, slot: SlotId) -> Result<(), SlotError> {
            if slot.0 > 1 {
                return Err(SlotError::NoSuchSlot);
            }
            // Kept as a belt-and-braces control rather than deleted: it is
            // what the provided guard is asserted AGAINST in the test below,
            // and a mock that could not refuse would make that test vacuous.
            if slot == self.running() {
                return Err(SlotError::WouldEraseRunning);
            }
            self.staging = Some(slot);
            Ok(())
        }
        fn write_stage(&mut self, offset: u32, bytes: &[u8]) -> Result<(), SlotError> {
            // The control for "bytes that belong to nothing".
            let slot = self.staging.ok_or(SlotError::NotStaging)?;
            let at = offset as usize;
            if at + bytes.len() > 8 {
                return Err(SlotError::Oversize);
            }
            self.contents[slot.0 as usize][at..at + bytes.len()].copy_from_slice(bytes);
            // bounded by the 8-byte slot checked just above
            self.lens[slot.0 as usize] =
                Some(u32::try_from(at + bytes.len()).map_err(|_| SlotError::Oversize)?);
            self.writes += 1;
            Ok(())
        }
        fn read_slot(
            &mut self,
            slot: SlotId,
            offset: u32,
            buf: &mut [u8],
        ) -> Result<usize, SlotError> {
            if slot.0 > 1 {
                return Err(SlotError::NoSuchSlot);
            }
            let src = &self.contents[slot.0 as usize];
            let at = offset as usize;
            if at >= src.len() {
                return Ok(0); // past the end is not an error
            }
            let n = buf.len().min(src.len() - at);
            buf[..n].copy_from_slice(&src[at..at + n]);
            Ok(n)
        }
        fn slot_image(&mut self, slot: SlotId) -> Result<SlotImage, SlotError> {
            if slot.0 > 1 {
                return Err(SlotError::NoSuchSlot);
            }
            match self.lens[slot.0 as usize] {
                Some(bytes) => Ok(SlotImage::Present { bytes }),
                None => Ok(SlotImage::Empty),
            }
        }
        fn mark_pending(&mut self, slot: SlotId, _p: ()) -> Result<(), SlotError> {
            self.pending = Some(slot);
            Ok(())
        }
        fn confirm(&mut self) -> Result<(), SlotError> {
            self.pending.take().ok_or(SlotError::NothingPending)?;
            Ok(())
        }
        fn revert(&mut self) -> Result<(), SlotError> {
            Ok(())
        }
        fn slot_capacity(&self, _slot: SlotId) -> u32 {
            1024
        }
    }

    #[test]
    fn writing_without_an_open_session_is_refused() {
        let mut m = Mock::new();
        assert_eq!(m.write_stage(0, b"x"), Err(SlotError::NotStaging));
        assert_eq!(m.writes, 0);
        m.begin_stage(SlotId(1)).unwrap();
        assert!(m.write_stage(0, b"x").is_ok());
        assert_eq!(m.writes, 1);
    }

    #[test]
    fn staging_the_running_slot_is_refused() {
        // Erasing the running slot destroys the executing image and the
        // rollback target together — the outcome unaided rollback exists
        // to prevent, reachable from a plain local call.
        let mut m = Mock::new();
        let running = m.running();
        assert_eq!(m.begin_stage(running), Err(SlotError::WouldEraseRunning));
        assert!(m.staging.is_none(), "a refused stage opened a session");
        // The other slot stages normally.
        let target = m.target();
        assert!(m.begin_stage(target).is_ok());
    }

    #[test]
    fn confirming_with_nothing_pending_is_refused() {
        // Commit releases the fallback. With nothing staged it discards
        // the prior image for no gain, and on an indeterminate board it
        // would do so on the strength of an unreadable record.
        let mut m = Mock::new();
        assert_eq!(m.confirm(), Err(SlotError::NothingPending));
        // With something pending it commits, and only once.
        m.mark_pending(SlotId(1), ()).unwrap();
        assert!(m.confirm().is_ok());
        assert_eq!(m.confirm(), Err(SlotError::NothingPending));
    }

    #[test]
    fn a_staged_image_can_be_read_back_to_digest_or_serve_it() {
        // L6 5.2.2 requires verifying the digest before SERVING, and
        // 5.3.5 lets any holder answer. A device with 512 KB of RAM and a
        // multi-megabyte image must read it back out of the slot.
        let mut m = Mock::new();
        m.begin_stage(SlotId(1)).unwrap();
        m.write_stage(0, b"IMAGE").unwrap();

        let mut buf = [0u8; 5];
        assert_eq!(m.read_slot(SlotId(1), 0, &mut buf).unwrap(), 5);
        assert_eq!(&buf, b"IMAGE");

        // Reading needs no permission — no token is spent here, and the
        // staging session is untouched by the read.
        assert!(m.staging.is_some(), "a read closed the staging session");
    }

    #[test]
    fn reading_past_the_end_is_empty_rather_than_an_error() {
        // Short reads are how a caller learns where the slot ended, so
        // they must not be failures.
        let mut m = Mock::new();
        let mut buf = [0u8; 4];
        assert_eq!(m.read_slot(SlotId(0), 99, &mut buf).unwrap(), 0);
        // A read spanning the end returns what there was.
        assert_eq!(m.read_slot(SlotId(0), 6, &mut buf).unwrap(), 2);
        // A slot that does not exist is still an error.
        assert_eq!(
            m.read_slot(SlotId(9), 0, &mut buf),
            Err(SlotError::NoSuchSlot)
        );
    }

    #[test]
    fn an_image_of_unknown_length_is_never_treated_as_an_absent_one() {
        // The tri-state's whole purpose. A caller that folds
        // PresentLengthUnknown into Empty treats a live rollback target as
        // free space — destroying the fallback L6 5.4.3 depends on.
        let unknown = SlotImage::PresentLengthUnknown;
        assert!(unknown.holds_an_image());
        assert_ne!(unknown, SlotImage::Empty);
        assert_ne!(unknown, SlotImage::Present { bytes: 0 });

        // And it costs airtime rather than correctness: cover the whole
        // slot rather than none of it.
        assert_eq!(unknown.bytes_to_cover(1_638_400), 1_638_400);
        assert_eq!(SlotImage::Empty.bytes_to_cover(1_638_400), 0);
        assert_eq!(
            SlotImage::Present { bytes: 400_000 }.bytes_to_cover(1_638_400),
            400_000
        );
    }

    #[test]
    fn slot_image_distinguishes_an_empty_slot_from_a_written_one() {
        let mut m = Mock::new();
        assert_eq!(m.slot_image(SlotId(1)).unwrap(), SlotImage::Empty);
        assert!(!m.slot_image(SlotId(1)).unwrap().holds_an_image());

        m.begin_stage(SlotId(1)).unwrap();
        m.write_stage(0, b"IMAGE").unwrap();
        assert_eq!(
            m.slot_image(SlotId(1)).unwrap(),
            SlotImage::Present { bytes: 5 }
        );
        assert!(m.slot_image(SlotId(1)).unwrap().holds_an_image());
        // The distinction slot_capacity cannot make: 5 bytes of image in a
        // slot that holds 1024.
        assert_eq!(m.slot_capacity(SlotId(1)), 1024);
    }

    /// ‼ **A PLATFORM THAT NEVER WROTE THE GUARD IS STILL REFUSED**, which
    /// is the whole of this change. `Unguarded` writes only
    /// `begin_stage_on_non_running` and would happily erase whatever it is
    /// handed — *the shape the trait's doc used to describe and the doc
    /// example itself used to have.*
    #[test]
    fn the_trait_refuses_the_running_slot_for_an_implementation_that_wrote_no_guard() {
        struct Unguarded {
            erased: Option<SlotId>,
        }
        impl ImageSlots for Unguarded {
            type Permission = ();
            type Error = SlotError;
            fn running(&self) -> SlotId {
                SlotId(0)
            }
            fn target(&self) -> SlotId {
                SlotId(1)
            }
            fn begin_stage_on_non_running(&mut self, slot: SlotId) -> Result<(), SlotError> {
                // No check of any kind. This is the point.
                self.erased = Some(slot);
                Ok(())
            }
            fn write_stage(&mut self, _: u32, _: &[u8]) -> Result<(), SlotError> {
                Ok(())
            }
            fn read_slot(&mut self, _: SlotId, _: u32, _: &mut [u8]) -> Result<usize, SlotError> {
                Ok(0)
            }
            fn slot_image(&mut self, _: SlotId) -> Result<SlotImage, SlotError> {
                Ok(SlotImage::Empty)
            }
            fn mark_pending(&mut self, _: SlotId, _: ()) -> Result<(), SlotError> {
                Ok(())
            }
            fn confirm(&mut self) -> Result<(), SlotError> {
                Ok(())
            }
            fn revert(&mut self) -> Result<(), SlotError> {
                Ok(())
            }
            fn slot_capacity(&self, _: SlotId) -> u32 {
                1024
            }
        }

        let mut u = Unguarded { erased: None };
        assert_eq!(u.begin_stage(SlotId(0)), Err(SlotError::WouldEraseRunning));
        assert_eq!(
            u.erased, None,
            "the platform half must not have been reached at all"
        );
        // And the ordinary case still reaches the platform.
        assert_eq!(u.begin_stage(SlotId(1)), Ok(()));
        assert_eq!(u.erased, Some(SlotId(1)));
    }

    /// The guard is keyed on [`ImageSlots::running`], so an implementation
    /// that answers it from **the configured record rather than the booted
    /// image** defeats the trait's protection while passing every test here.
    /// **L6 5.4.1c is that obligation and no type can carry it** — this test
    /// pins the dependency so a reader meets it.
    #[test]
    fn the_guard_is_only_as_good_as_what_running_reports() {
        let mut m = Mock::new();
        assert_eq!(m.running(), SlotId(0));
        assert_eq!(m.begin_stage(SlotId(0)), Err(SlotError::WouldEraseRunning));
        // Had `running()` answered SlotId(1) — the configured slot after a
        // fallback — this same call would have been permitted.
        assert_eq!(m.begin_stage(SlotId(1)), Ok(()));
    }

    #[test]
    fn the_trait_is_object_safe_where_the_permission_is_fixed() {
        // A consumer can hold `&mut dyn ImageSlots<Permission = (), Error = SlotError>`.
        let mut m = Mock::new();
        let s: &mut dyn ImageSlots<Permission = (), Error = SlotError> = &mut m;
        assert_eq!(s.running(), SlotId(0));
        assert_eq!(s.target(), SlotId(1));
    }
}

// ── L0 8.6.3 / L6 5.4.2: what the current boot is, and why ──────────────────
//
// ‼ **MOVED HERE FROM `hive-esp32-dfr1195` ON 2026-09-05, AND THE MOVE IS THE
//   POINT.** These two enums and the rule below decided 8.6.3 — *a hive on a
//   platform that cannot report the absence of a valid image-position record
//   shall not treat that record as evidence an update was applied* — and they
//   lived in a board crate that is cross-compiled for xtensa. **No host test
//   could reach them**, so the clause was IMPLEMENTED-UNTESTED not because the
//   logic was doubtful but because nothing could run it. *A rule about what a
//   record may be believed to mean is not a board fact; the flash read is.*
//   The board keeps the silicon — reading otadata, asking the MMU what is
//   executing — and calls [`corroborate_position`] with what it found.

/// What the current boot is, from the platform's point of view (L6 5.4.2/5.4.3).
///
/// `Indeterminate` exists because an unreadable or invalid OTA record must not
/// be reported as either of the other two. Roy's SS53 ruling is the precedent:
/// an invalid update-sequence record silently treated as a floor bricked two
/// real boards, so the discriminator is mandatory and the failure is
/// fail-closed. Same shape as L5 4.4.6's unreadable claim state, which is
/// neither OPEN nor OWNER. Core is designing r2-mgmt around this outcome.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BootDisposition {
    /// Running a committed image; nothing pending.
    Settled,
    /// Running a freshly switched image awaiting confirmation — the health
    /// window is open and an unconfirmed reboot reverts (5.4.3).
    Pending,
    /// The OTA record could not be read or did not validate. NOT a synonym for
    /// either other state: the caller must treat the update position as
    /// unknown and refuse to act on it rather than assume a floor.
    Indeterminate,
    /// The record parsed **cleanly** and disagrees with the slots: it names a
    /// current slot that holds no image.
    ///
    /// Distinct from `Indeterminate`, and the distinction is the whole point.
    /// `Indeterminate` means the record could not be trusted to *parse*;
    /// this means it parsed perfectly and is **false**. Core's line, and it is
    /// the sharpest thing said about record integrity tonight: SS53's
    /// discriminator protects the record against corruption, not against being
    /// false — **no checksum catches a true-looking lie.**
    ///
    /// Why it must not be folded into `Pending`: an interrupted copy leaves the
    /// staged slot erased while the record still names it. The bootloader
    /// cannot boot that slot, falls back to the prior image, and the record
    /// still reads Pending — so a health window opens against the *prior*
    /// image, which is perfectly healthy. The checks pass, the update commits,
    /// and the sequence floor advances to an image that was never applied. The
    /// device then runs `n-1` under a floor of `n` and refuses package `n` —
    /// the one that would repair it — for ever.
    ///
    /// **Staging is permitted from here**, unlike from `Pending`. A torn slot
    /// is repaired by rewriting it, so refusing would close the only route out.
    Inconsistent,
}

/// WHY the position reads as it does. The behaviour for the last three is the
/// same — `Indeterminate`, the safe answer — but the REASON must survive,
/// because a board with genuinely blank OTA data and a board whose flash read
/// is failing need OPPOSITE repairs.
///
/// Folding them cost this repo two hours: a read failure was reported as a
/// position, and the log could not distinguish it from an unprovisioned board.
/// Same shape as L6 5.4.4's "report the reversion AND its reason", and as
/// core's `HealthOutcome::CouldNotAssess` — arriving here in the instrument we
/// were measuring with rather than in the thing measured.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PositionReason {
    /// The record was read and believed.
    Readable,
    /// Both sequence numbers are uninitialised: genuinely never provisioned.
    Unprovisioned,
    /// The record could not be READ — flash error, partition-table error, or
    /// no otadata partition. Says nothing about what the record contains.
    ReadFailed,
    /// The record names one slot and the MMU says another is executing.
    RecordDisagreesWithBoot,
}

/// **L0 8.6.3: decide what a boot is, from four facts the platform gathered.**
///
/// Returns the disposition and the reason together, because the reason is not
/// decoration: three different causes all produce [`BootDisposition::
/// Indeterminate`], and *a board with genuinely blank OTA data and a board
/// whose flash read is failing need OPPOSITE repairs.*
///
/// ‼ **THE ORDER OF THE CHECKS IS THE CLAUSE AND IS NOT AN OPTIMISATION.** The
/// two disagreement tests run BEFORE the record's own state is consulted, so
/// **no false record can reach the `Settled` or `Pending` arms.** A record that
/// parses perfectly and is false is exactly what 8.6.3 exists for — *no
/// checksum catches a true-looking lie* — and a version that read the state
/// first would report `Pending` for a record naming a slot that holds nothing.
/// The cost of that ordering being wrong is recorded on
/// [`BootDisposition::Inconsistent`]: a health window opens against the PRIOR
/// image, which is perfectly healthy, the update commits, and the device runs
/// `n-1` under a floor of `n` and refuses the package that would repair it,
/// for ever.
///
/// `booted` and `named` are `Option` because either may be unavailable on a
/// platform that cannot report it — **and an unavailable half is not a
/// disagreement.** P13 is the declaration of which halves exist; a platform
/// that cannot report one passes `None` and this does not invent a conflict
/// out of an absence.
#[must_use]
pub fn corroborate_position(
    booted: Option<SlotId>,
    named: Option<SlotId>,
    running_slot_holds_an_image: bool,
    record: Result<RecordState, PositionReason>,
) -> (BootDisposition, PositionReason) {
    // ARTEFACT AGAINST WORLD. The MMU knows what is executing and the record
    // knows what was selected; when they disagree the record is false however
    // well-formed it is — which is the post-revert state, and also what a
    // corrupt entry looks like to a reader that does not verify the checksum.
    if let (Some(b), Some(n)) = (booted, named) {
        if b != n {
            return (
                BootDisposition::Inconsistent,
                PositionReason::RecordDisagreesWithBoot,
            );
        }
    }
    // A record can also be well-formed and name a slot holding nothing: an
    // interrupted copy leaves the staged slot erased while the record goes on
    // naming it.
    if !running_slot_holds_an_image {
        return (
            BootDisposition::Inconsistent,
            PositionReason::RecordDisagreesWithBoot,
        );
    }
    match record {
        Err(reason) => (BootDisposition::Indeterminate, reason),
        Ok(RecordState::Committed) => (BootDisposition::Settled, PositionReason::Readable),
        Ok(RecordState::AwaitingConfirmation) => {
            (BootDisposition::Pending, PositionReason::Readable)
        }
        // A state the platform could not classify is a read that did not
        // validate, and 8.6.3 forbids reading it as either other answer.
        Ok(RecordState::Unclassifiable) => {
            (BootDisposition::Indeterminate, PositionReason::ReadFailed)
        }
    }
}

/// What the platform's image-position record says, once the platform has
/// mapped its own vendor states onto the three this clause distinguishes.
///
/// ‼ **THE MAPPING STAYS ON THE PLATFORM AND ONLY THE OUTCOME CROSSES.** An
/// `esp-bootloader` OTA state, an nRF DFU state and a Linux A/B flag are
/// different vocabularies for the same three answers, and putting any one of
/// them here would make this seam name a vendor.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecordState {
    /// A committed image; nothing pending.
    Committed,
    /// A freshly switched image whose health window is open.
    AwaitingConfirmation,
    /// A state this platform cannot map onto either of the above. **Not an
    /// error and not a default** — it is the honest answer for a record whose
    /// contents are outside the three cases, and 8.6.3 makes it indeterminate.
    Unclassifiable,
}

#[cfg(test)]
mod position_tests {
    use super::*;

    const A: SlotId = SlotId(0);
    const B: SlotId = SlotId(1);

    /// ‼ **8.6.3's WHOLE POINT: A RECORD THAT PARSES PERFECTLY AND IS FALSE
    /// MUST NOT REACH `Settled` OR `Pending`.** Both disagreements are fed
    /// with a record that reads `Committed` — the most believable state there
    /// is — so a version that consulted the record first would answer
    /// `Settled` on each. *No checksum catches a true-looking lie.*
    #[test]
    fn a_record_that_disagrees_with_the_boot_is_inconsistent_however_well_it_reads() {
        // The MMU says A is executing and the record names B.
        assert_eq!(
            corroborate_position(Some(A), Some(B), true, Ok(RecordState::Committed)),
            (
                BootDisposition::Inconsistent,
                PositionReason::RecordDisagreesWithBoot
            )
        );
        // The record names the running slot and that slot holds nothing —
        // an interrupted copy, and the state that would otherwise open a
        // health window against the PRIOR image.
        assert_eq!(
            corroborate_position(
                Some(A),
                Some(A),
                false,
                Ok(RecordState::AwaitingConfirmation)
            ),
            (
                BootDisposition::Inconsistent,
                PositionReason::RecordDisagreesWithBoot
            )
        );
        // ‼ THE CONTROL: the same record, agreeing, is believed. Without this
        //   a function returning Inconsistent always would pass the two above.
        assert_eq!(
            corroborate_position(Some(A), Some(A), true, Ok(RecordState::Committed)),
            (BootDisposition::Settled, PositionReason::Readable)
        );
    }

    /// ‼ **AN UNAVAILABLE HALF IS NOT A DISAGREEMENT, WHICH IS WHAT P13
    /// DECLARES.** A platform that cannot report the booted slot passes
    /// `None`, and the rule must not invent a conflict out of an absence —
    /// *that would make every platform without an MMU report its records
    /// false.* The record is still believed on its own terms.
    #[test]
    fn a_half_the_platform_cannot_report_is_not_a_conflict() {
        assert_eq!(
            corroborate_position(None, Some(B), true, Ok(RecordState::Committed)),
            (BootDisposition::Settled, PositionReason::Readable)
        );
        assert_eq!(
            corroborate_position(Some(A), None, true, Ok(RecordState::AwaitingConfirmation)),
            (BootDisposition::Pending, PositionReason::Readable)
        );
        assert_eq!(
            corroborate_position(None, None, true, Ok(RecordState::Committed)),
            (BootDisposition::Settled, PositionReason::Readable)
        );
    }

    /// ‼ **THREE CAUSES, ONE BEHAVIOUR, AND THE REASON SURVIVES.** All three
    /// answer `Indeterminate`, which is the safe answer — but *a board with
    /// genuinely blank OTA data and a board whose flash read is failing need
    /// OPPOSITE repairs*, and folding them cost this repo two hours once.
    #[test]
    fn every_unreadable_cause_is_indeterminate_and_keeps_its_own_reason() {
        for reason in [
            PositionReason::Unprovisioned,
            PositionReason::ReadFailed,
            PositionReason::RecordDisagreesWithBoot,
        ] {
            assert_eq!(
                corroborate_position(Some(A), Some(A), true, Err(reason)),
                (BootDisposition::Indeterminate, reason),
                "the behaviour is shared and the reason is not"
            );
        }
        // A state the platform could not map is a read that did not validate,
        // and 8.6.3 forbids reading it as either other answer.
        assert_eq!(
            corroborate_position(Some(A), Some(A), true, Ok(RecordState::Unclassifiable)),
            (BootDisposition::Indeterminate, PositionReason::ReadFailed)
        );
    }

    /// **`Indeterminate` is never `Settled` and never `Pending`, swept.** The
    /// clause is a prohibition — *shall not treat that record as evidence an
    /// update was applied* — so the assertion worth making is over every input
    /// that fails to establish the position, not over one of them.
    #[test]
    fn no_unestablished_position_is_ever_reported_as_applied() {
        let unestablished = [
            corroborate_position(Some(A), Some(B), true, Ok(RecordState::Committed)),
            corroborate_position(Some(A), Some(A), false, Ok(RecordState::Committed)),
            corroborate_position(Some(A), Some(A), true, Err(PositionReason::ReadFailed)),
            corroborate_position(Some(A), Some(A), true, Err(PositionReason::Unprovisioned)),
            corroborate_position(Some(A), Some(A), true, Ok(RecordState::Unclassifiable)),
        ];
        assert_eq!(
            unestablished.len(),
            5,
            "the sweep covers every failing shape"
        );
        for (disposition, _) in unestablished {
            assert!(
                !matches!(
                    disposition,
                    BootDisposition::Settled | BootDisposition::Pending
                ),
                "8.6.3: {disposition:?} was reported as an applied update"
            );
        }
    }
}
