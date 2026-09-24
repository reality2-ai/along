//! **The seam between a held entanglement and the payload it protects.**
//!
//! # Two halves that both existed and did not touch
//!
//! `entanglement` builds an establishment through its five stages and hands
//! back a [`Held`](crate::entanglement::Held); `confidential` opens a
//! crossing's payload under *that entanglement's key* (L5 **7.3.1**).
//! **Nothing joined them.** Measured
//! 2026-08-18: `Establishment::into_held` — the transition from a completed
//! establishment to a held one — had **exactly one caller and it was inside
//! `#[cfg(test)]`**, and [`crate::confidential::CrossingKeys`] had **no
//! implementor at all.**
//!
//! *Both subsystems were complete and tested. The join was the missing part,
//! and a missing join is invisible from either side* — each half's tests pass
//! against its own fixtures, and neither has a reason to mention the other.
//!
//! # ‼ THE KEYRING REFUSES ONCE AN ENTANGLEMENT HAS ENDED, AND THAT IS THE
//! # WHOLE REASON THIS IS A TYPE RATHER THAN A LOOKUP
//!
//! L5A **8.2**: *crossings under them fail the gate from that moment.*
//! [`Held::live_grade`](crate::entanglement::Held::live_grade) enforces
//! it for the gate — it checks `ending` **first, because an ended
//! entanglement's other properties are no longer anybody's business**.
//! A keyring that answered `payload_key` for an ended
//! entanglement would hand the delivery path a working key for a relationship
//! that is over, *and the bytes would decrypt perfectly.*
//!
//! The gate would ordinarily refuse such a crossing before delivery is
//! reached. **This does not rely on that.** The two checks are independent on
//! purpose: *a key that outlives the relationship it belongs to is a fact
//! about custody, not about routing*, and the party holding it should not be
//! able to use it whatever else fails open.

use crate::confidential::CrossingKeys;
use crate::crypto::AEAD_KEY_LEN;
use crate::entanglement::{Ending, Held};
use crate::gate::EntanglementId;
use crate::keys::SecretKey;

/// One entanglement this hive holds, with the payload key derived for it.
///
/// ‼ **THE KEY IS SEPARATE FROM THE `Held` RATHER THAN INSIDE IT**, because
/// L5A **5.2.4** makes the keys **re-derivable** from the artefact and the
/// groups' retained material — Note 1 calls that the durability rule, and it
/// is why *an entanglement survives a crash without a resumption protocol.*
/// A holder may therefore keep the derived key or re-derive it through
/// [`crate::entanglement::derive_entanglement_keys`], and this pairs whichever
/// it has with the relationship it belongs to.
pub struct HeldKey<'a> {
    pub held: Held<'a>,
    /// `Purpose::EntanglementPayload` (5.2.2).
    pub payload: SecretKey<AEAD_KEY_LEN>,
}

/// The entanglements this hive holds keys for.
///
/// Implements [`CrossingKeys`], so
/// [`crate::confidential::deliver_payload`] can serve L5 7.3.1's crossing arm
/// from what the establishment path actually produced.
pub struct Keyring<'a> {
    entries: &'a [HeldKey<'a>],
}

impl<'a> Keyring<'a> {
    pub const fn new(entries: &'a [HeldKey<'a>]) -> Self {
        Self { entries }
    }

    /// How this entanglement ended, if it has.
    pub fn ending(&self, id: EntanglementId) -> Option<Ending> {
        self.entries
            .iter()
            .find(|e| e.held.id == id)
            .and_then(|e| e.held.ending)
    }
}

impl CrossingKeys for Keyring<'_> {
    fn payload_key(&self, id: EntanglementId) -> Option<&SecretKey<AEAD_KEY_LEN>> {
        let entry = self.entries.iter().find(|e| e.held.id == id)?;
        // ‼ **8.2, CHECKED HERE AND NOT ONLY AT THE GATE.** An ended
        // entanglement yields no key, whatever it ended as — completion,
        // lapse, severance or dissolution are four reasons and one
        // consequence. `live_grade` is the module's own predicate and it
        // checks the ending first for exactly this reason; using it rather
        // than reading `ending` directly means a later change to what counts
        // as live reaches this too.
        entry.held.live_grade().ok()?;
        Some(&entry.payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::certificate::Epoch;
    use crate::confidential::{deliver_payload, Delivered, DeliveryRefusal, PayloadKeys};
    use crate::entanglement::{Artefact, Condition, Direction, Establishment};
    use crate::envelope::seal_payload;
    use crate::gate::{Delivery, Grade};
    use crate::identity::Identity;
    use crate::keygen::ConformingEntropy;
    use r2_wire::{Frame, FrameSpec, FrameType, Target, Tier};

    struct Zeroes(u8);
    impl ConformingEntropy for Zeroes {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            for b in out.iter_mut() {
                self.0 = self.0.wrapping_add(1);
                *b = self.0;
            }
            true
        }
    }

    fn ident(n: u8) -> Identity {
        Identity([n; 32])
    }

    /// A completed establishment, driven through all five stages of 5.1.
    fn live<'a>(conds: &'a [Condition<'a>], id: u32) -> Held<'a> {
        let artefact = Artefact {
            scope: Direction::Both,
            grade: Grade::Confirmed,
            conditions: conds,
            lifetime: Epoch(9),
        };
        let mut e = Establishment::propose(artefact, Epoch(0)).expect("a) proposal");
        e.agreed([ident(1), ident(2)]).expect("b");
        e.verified().expect("c");
        e.keyed().expect("d");
        e.trial_crossed(Direction::OutboundOnly).expect("e out");
        e.trial_crossed(Direction::InboundOnly).expect("e in");
        e.into_held(EntanglementId(id), &[7u8; 32]).expect("live")
    }

    fn framed(buf: &mut [u8]) -> Frame<'_> {
        let n = FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: false,
            hop_limit: 4,
            budget: 4,
            msg_id: 1,
            event_hash: 0x1234_5678,
            target: Target::Compact(0xAABB_CCDD),
            route: Some(&[0xA1, 0xB2, 0xC3, 0xD4]),
            payload: b"x",
            tag: None,
        }
        .encode(buf)
        .expect("encodes");
        let bytes: &[u8] = &buf[..n];
        Frame::parse_on_bearer(bytes, Tier::Compact).expect("parses")
    }

    /// ‼ **THE JOIN, WHICH IS THE WHOLE POINT.** An establishment driven
    /// through all five stages of 5.1 yields a `Held`; its payload key opens
    /// a crossing through L5 7.3.1's arm. *Both halves existed and nothing
    /// connected them.*
    #[test]
    fn a_held_entanglement_opens_its_own_crossing() {
        let conds: [Condition; 0] = [];
        let held = live(&conds, 9);
        let entries = [HeldKey {
            held,
            payload: SecretKey::new(&mut [0xC1; AEAD_KEY_LEN]),
        }];
        let ring = Keyring::new(&entries);

        let mut fb = [0u8; 256];
        let frame = framed(&mut fb);
        let mut sealed = [0u8; 128];
        let n = seal_payload::<crate::cipher::XChaCha20Poly1305, _>(
            &mut Zeroes(0),
            &SecretKey::new(&mut [0xC1; AEAD_KEY_LEN]),
            &frame,
            b"across",
            &mut sealed,
        )
        .expect("seals");

        let mut out = [0u8; 128];
        assert_eq!(
            deliver_payload::<crate::cipher::XChaCha20Poly1305>(
                Delivery::Crossing(EntanglementId(9)),
                PayloadKeys::GroupAndCrossings {
                    group: &SecretKey::new(&mut [0x5A; AEAD_KEY_LEN]),
                    crossings: &ring,
                },
                &frame,
                &sealed[..n],
                &mut out,
            ),
            Ok(Delivered::Confidential(6))
        );
        assert_eq!(&out[..6], b"across");
    }

    /// ‼ **8.2: AN ENDED ENTANGLEMENT YIELDS NO KEY, AND THIS DOES NOT RELY
    /// ON THE GATE TO SAY SO.** *Crossings under them fail the gate from that
    /// moment* — and a keyring that kept answering would hand the delivery
    /// path a working key for a relationship that is over, *with the bytes
    /// decrypting perfectly.* The two checks are independent on purpose: **a
    /// key that outlives its relationship is a fact about custody, not about
    /// routing.**
    #[test]
    fn an_ended_entanglement_yields_no_key_whatever_it_ended_as() {
        let conds: [Condition; 0] = [];
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb);
        let mut sealed = [0u8; 128];
        let n = seal_payload::<crate::cipher::XChaCha20Poly1305, _>(
            &mut Zeroes(0),
            &SecretKey::new(&mut [0xC1; AEAD_KEY_LEN]),
            &frame,
            b"across",
            &mut sealed,
        )
        .expect("seals");

        // Four reasons, one consequence — and the sweep is the point: a
        // check written against `Severance` alone would let a lapsed
        // entanglement keep decrypting.
        for ending in [
            Ending::Completion,
            Ending::Lapse,
            Ending::Severance,
            Ending::Dissolution,
        ] {
            let mut held = live(&conds, 9);
            held.ending = Some(ending);
            let entries = [HeldKey {
                held,
                payload: SecretKey::new(&mut [0xC1; AEAD_KEY_LEN]),
            }];
            let ring = Keyring::new(&entries);

            assert!(
                ring.payload_key(EntanglementId(9)).is_none(),
                "{ending:?} still yielded a key"
            );

            let mut out = [0u8; 128];
            assert_eq!(
                deliver_payload::<crate::cipher::XChaCha20Poly1305>(
                    Delivery::Crossing(EntanglementId(9)),
                    PayloadKeys::GroupAndCrossings {
                        group: &SecretKey::new(&mut [0x5A; AEAD_KEY_LEN]),
                        crossings: &ring,
                    },
                    &frame,
                    &sealed[..n],
                    &mut out,
                ),
                Err(DeliveryRefusal::CrossingNotEstablished),
                "{ending:?}: the payload must not open"
            );
            assert_eq!(ring.ending(EntanglementId(9)), Some(ending));
        }
    }

    /// An entanglement this hive does not hold yields nothing, and the
    /// keyring is shown answering so the refusal is about custody rather than
    /// an empty table.
    #[test]
    fn an_entanglement_not_held_yields_nothing() {
        let conds: [Condition; 0] = [];
        let entries = [HeldKey {
            held: live(&conds, 9),
            payload: SecretKey::new(&mut [0xC1; AEAD_KEY_LEN]),
        }];
        let ring = Keyring::new(&entries);
        assert!(ring.payload_key(EntanglementId(9)).is_some(), "control");
        assert!(ring.payload_key(EntanglementId(10)).is_none());
    }

    /// An empty keyring is a hive that has entangled with nobody — a real
    /// state, and not an error.
    #[test]
    fn a_hive_holding_no_entanglement_is_a_keyring_that_refuses_everything() {
        let ring = Keyring::new(&[]);
        assert!(ring.payload_key(EntanglementId(1)).is_none());
        assert_eq!(ring.ending(EntanglementId(1)), None);
    }
}
