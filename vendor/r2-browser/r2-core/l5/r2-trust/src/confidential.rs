//! Delivering a payload, with the key chosen by the gate's classification.
//!
//! **L5 7.3.3 is the whole design and it removes a decision rather than adding
//! one**: *"no frame shall carry a key identifier, cipher negotiation, or any
//! statement of which key protects it — the delivery gate's classification
//! names the decryption key."* Note 1: *"by the time a payload is decrypted,
//! the question 'which key?' was already answered by the verification that
//! admitted it."*
//!
//! So [`deliver_payload`] takes a [`Delivery`] — the value
//! [`crate::gate::apply_gate`] already returns — and the key follows from it.
//! **Opening is not the caller's choice.** A receive path where the caller
//! decides whether to decrypt is non-conformant against 7.3.3, because the
//! caller would be answering a question the classification already answered.
//!
//! **The exemption is not implemented, deliberately.** 7.3.1 exempts an event
//! that is *public by design*, and `STD-SS44` records that no criterion or
//! declaration mechanism for that exists anywhere in the corpus. The safe
//! disposition needs no ruling: **encrypt every intra-group payload and take
//! no exemption** — 7.3.1's default is encryption and the exemption is the
//! undefined branch, so refusing it fails closed. Nothing here can express it.
//!
//! **Cleartext and decrypted do not share a return value.** 7.3.2's
//! unauthenticated level carries its payload in clear — *no key exists at that
//! level and none is negotiated* — and that is its meaning rather than a
//! weakness. [`Delivered`] keeps the two apart so a consumer cannot read *this
//! was never protected* as *this was opened*.

use crate::crypto::{Aead, AEAD_KEY_LEN};
use crate::envelope::{open_payload, seal_payload, SealRefusal};
use crate::gate::{Delivery, EntanglementId};
use crate::keygen::ConformingEntropy;
use crate::keys::SecretKey;
use r2_wire::Frame;

/// The payload key material a receiver holds.
///
/// **`NotProvisioned` is a named state, not an absent one.** A hive can be
/// joined and hold no group material: `L5B 6.1.1 e)` returns *"the group
/// material the role carries"* and `STD-SS271` records that the phrase is defined
/// nowhere, so the install step a requirement would live in does not exist
/// yet. That state is real, so it gets a name — an `Option` here is a state a
/// caller forgets, and forgetting it means falling back to unauthenticated
/// delivery, which is the failure this type exists to prevent.
pub enum PayloadKeys<'a> {
    /// The group's payload-protection key (5.2.2), derived under
    /// `Purpose::GroupPayload`.
    Group(&'a SecretKey<AEAD_KEY_LEN>),
    /// The group's key **and** the entanglements this hive holds keys for
    /// (L5A 5.2.2, `Purpose::EntanglementPayload`).
    ///
    /// ‼ **A SEPARATE VARIANT RATHER THAN A FIELD ON `Group`, SO THAT
    /// HOLDING NO CROSSING KEY REMAINS A NAMED STATE.** A hive with group
    /// material and no entanglement is the ordinary case, and it must stay
    /// expressible without supplying an empty resolver — *an empty resolver
    /// and a hive that never entangled are the same object and different
    /// facts.*
    GroupAndCrossings {
        group: &'a SecretKey<AEAD_KEY_LEN>,
        crossings: &'a dyn CrossingKeys,
    },
    /// Joined, with no group material. Every confidential delivery refuses.
    NotProvisioned,
}

/// The entanglement payload keys this hive holds, looked up by the identifier
/// **the gate already produced** (L5 7.3.3).
///
/// ‼ **A LOOKUP, NOT A CHOICE, AND THE DISTINCTION IS 7.3.3 ITSELF.** *"No
/// frame shall carry a key identifier, cipher negotiation, or any statement
/// of which key protects it — the delivery gate's classification names the
/// decryption key."* The classification carries an [`EntanglementId`]; this
/// resolves it against what the hive holds. **The caller never decides
/// whether to decrypt or under which key** — it answers *do you hold this
/// one*, and `None` is a fact about custody rather than a decision about
/// the frame.
///
/// ‼ **RE-DERIVATION IS PERMITTED AND IS WHY THIS IS A TRAIT.** L5A **5.2.4**
/// makes the keys re-derivable from the artefact and the groups' retained
/// material, and Note 1 calls that the durability rule: *a device that lost
/// its session state and still holds its group material and the artefact
/// holds the entanglement.* An implementor may therefore keep keys in memory
/// **or** re-derive them here through
/// [`crate::entanglement::derive_entanglement_keys`], and nothing above
/// needs to know which.
pub trait CrossingKeys {
    /// The payload-protection key for `id`, or `None` where this hive holds
    /// no such entanglement.
    fn payload_key(&self, id: EntanglementId) -> Option<&SecretKey<AEAD_KEY_LEN>>;
}

/// What was delivered, keeping *opened* and *never protected* apart.
#[derive(Debug, PartialEq, Eq)]
pub enum Delivered {
    /// Decrypted under the group's payload-protection key (7.3.1).
    Confidential(usize),
    /// Carried in clear by 7.3.2, where no key exists and none is negotiated.
    InClear(usize),
}

/// Why a payload was not delivered.
#[derive(Debug, PartialEq, Eq)]
pub enum DeliveryRefusal {
    /// Classified intra-group and this hive holds no group material.
    /// **Fails closed and says which:** the alternative is delivering the
    /// bytes as though the level had been unauthenticated, which would let a
    /// missing key widen what a hive accepts.
    NotProvisioned,
    /// Classified as a crossing and **this hive holds no key for that
    /// entanglement**. 7.3.1 requires that entanglement's key at its level,
    /// so there is no honest outcome but refusal.
    ///
    /// ‼ **THIS DOC ONCE READ *entanglement establishment is Clause 10,
    /// gated on `STD-SS43`, and is not built* AND ALL THREE CLAIMS WERE
    /// FALSE BY THEN.** `SS43` was **settled on 2026-08-01** (`D-028`) and
    /// was about deferral cross-references rather than about keys at all;
    /// establishment **is** built (`entanglement.rs`); and
    /// [`crate::entanglement::derive_entanglement_keys`] produces exactly
    /// the key 7.3.1 names, canonically ordered and bound to the artefact.
    /// *The refusal was right and its reason was wrong, which is the harder
    /// defect to find: nothing misbehaves, and the citation is what stops
    /// the next reader checking.* **A gate citation is a claim with a date
    /// in it, and this one went stale in place for seventeen days.**
    CrossingNotEstablished,
    /// The envelope did not open. **Never says why** — a receiver that
    /// distinguishes *bad tag* from *short frame* has built an oracle.
    DidNotOpen,
}

/// Deliver a payload under the key the gate's classification names (7.3.3).
///
/// `payload` is the frame's payload span: an envelope for the intra-group
/// case, cleartext for the unauthenticated one.
pub fn deliver_payload<A: Aead>(
    delivery: Delivery,
    keys: PayloadKeys<'_>,
    frame: &Frame<'_>,
    payload: &[u8],
    out: &mut [u8],
) -> Result<Delivered, DeliveryRefusal> {
    match delivery {
        Delivery::IntraGroup => match keys {
            PayloadKeys::NotProvisioned => Err(DeliveryRefusal::NotProvisioned),
            PayloadKeys::Group(key)
            | PayloadKeys::GroupAndCrossings {
                group: key,
                crossings: _,
            } => open_payload::<A>(key, frame, payload, out)
                .map(Delivered::Confidential)
                .ok_or(DeliveryRefusal::DidNotOpen),
        },
        // 7.3.1's crossing arm: **that entanglement's** key, not the
        // group's. ‼ The two are distinct by construction — L5A 5.2.2
        // requires the entanglement's keys distinct from every key of either
        // group — so a crossing sealed under an entanglement key simply does
        // not open under the group key, and the wrong branch fails closed
        // rather than leaking.
        Delivery::Crossing(id) => match keys {
            PayloadKeys::GroupAndCrossings { crossings, .. } => {
                let key = crossings
                    .payload_key(id)
                    .ok_or(DeliveryRefusal::CrossingNotEstablished)?;
                open_payload::<A>(key, frame, payload, out)
                    .map(Delivered::Confidential)
                    .ok_or(DeliveryRefusal::DidNotOpen)
            }
            // A hive with group material and no entanglements, or none at
            // all: it holds no key for this crossing either way.
            PayloadKeys::Group(_) | PayloadKeys::NotProvisioned => {
                Err(DeliveryRefusal::CrossingNotEstablished)
            }
        },
        // 7.3.2. The payload is already what it is; copying it is the whole
        // operation, and the length is checked rather than assumed.
        Delivery::Unauthenticated => {
            if out.len() < payload.len() {
                return Err(DeliveryRefusal::DidNotOpen);
            }
            out[..payload.len()].copy_from_slice(payload);
            Ok(Delivered::InClear(payload.len()))
        }
    }
}

/// Why a payload was not originated.
#[derive(Debug, PartialEq, Eq)]
pub enum OriginateRefusal {
    /// This hive holds no group material, so it cannot protect a payload it
    /// is required to protect (7.3.1). **Refuses rather than sending in
    /// clear** — an unprovisioned sender that fell back to cleartext would
    /// publish the very thing the clause exists to protect, and nothing on
    /// the wire would say it had happened.
    NotProvisioned,
    /// The envelope could not be sealed. Carries the reason, because a
    /// SENDER is not an oracle: it is the party that already knows the
    /// plaintext, and the nonce rule's refusal must be diagnosable.
    Refused(SealRefusal),
    /// Asked to protect a payload for an entanglement this hive holds no key
    /// for. **The sending mirror of
    /// [`DeliveryRefusal::CrossingNotEstablished`]**, and it does not fall
    /// back to the group key for the reason `NotProvisioned` already gives.
    CrossingNotEstablished,
}

/// Protect a payload for this hive's own group (7.3.1).
///
/// **There is no `Delivery` parameter and no exemption.** 7.3.1 requires
/// encryption of every intra-group payload *unless the event is public by
/// design*, and `STD-SS44` records that no criterion or declaration mechanism
/// for that exists. The safe disposition needs no ruling — **encrypt
/// everything, take no exemption** — so this function cannot express the
/// exempt case at all. *A branch that cannot be written cannot be taken by
/// mistake.*
///
/// The key arrives from the caller, exactly as `GroupKeys` reaches
/// [`crate::gate::apply_gate`]: the surface holds no secret and this call
/// does not change that.
pub fn originate_payload<A: Aead, E: ConformingEntropy>(
    entropy: &mut E,
    keys: PayloadKeys<'_>,
    frame: &Frame<'_>,
    plaintext: &[u8],
    out: &mut [u8],
) -> Result<usize, OriginateRefusal> {
    match keys {
        PayloadKeys::NotProvisioned => Err(OriginateRefusal::NotProvisioned),
        PayloadKeys::Group(key)
        | PayloadKeys::GroupAndCrossings {
            group: key,
            crossings: _,
        } => seal_payload::<A, E>(entropy, key, frame, plaintext, out)
            .map_err(OriginateRefusal::Refused),
    }
}

/// Protect a payload for a **crossing**, under that entanglement's key
/// (7.3.1, L5A 5.2.2).
///
/// ‼ **A SEPARATE FUNCTION FROM [`originate_payload`], BECAUSE THE
/// DESTINATION IS A DIFFERENT FACT AND NOT A PARAMETER.** `originate_payload`
/// says in its own name and doc that it protects *for this hive's own group*;
/// adding an optional entanglement to it would make the group case the
/// default of a function that can address two different relationships, and
/// *a default destination is exactly the mistake that sends a crossing under
/// the group key.* The two keys are distinct by 5.2.2, so such a frame would
/// be well-formed, unopenable by the counterpart, and silent about why.
///
/// Refuses where this hive holds no key for `id` — the sending mirror of
/// [`DeliveryRefusal::CrossingNotEstablished`], and it refuses rather than
/// falling back to the group key for the reason
/// [`OriginateRefusal::NotProvisioned`] already gives: *a sender that fell
/// back would publish the very thing the clause exists to protect, and
/// nothing on the wire would say it had happened.*
pub fn originate_crossing<A: Aead, E: ConformingEntropy>(
    entropy: &mut E,
    crossings: &dyn CrossingKeys,
    id: EntanglementId,
    frame: &Frame<'_>,
    plaintext: &[u8],
    out: &mut [u8],
) -> Result<usize, OriginateRefusal> {
    let key = crossings
        .payload_key(id)
        .ok_or(OriginateRefusal::CrossingNotEstablished)?;
    seal_payload::<A, E>(entropy, key, frame, plaintext, out).map_err(OriginateRefusal::Refused)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cipher::XChaCha20Poly1305 as X;
    use crate::crypto::AEAD_KEY_LEN;
    use crate::gate::EntanglementId;
    use r2_wire::{FrameSpec, FrameType, Target, Tier};

    struct CountingEntropy(u8);
    impl ConformingEntropy for CountingEntropy {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            self.0 = self.0.wrapping_add(1);
            out.fill(self.0);
            true
        }
    }

    fn framed<'a>(buf: &'a mut [u8; 256], payload: &[u8]) -> Frame<'a> {
        let spec = FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: true,
            hop_limit: 5,
            budget: 6,
            msg_id: 0x1234,
            event_hash: 0x9ABC_DEF0,
            target: Target::Compact(0x2222_2222),
            route: Some(&[0xAA, 0xBB, 0xCC, 0xDD]),
            payload,
            tag: None,
        };
        let n = spec.encode(buf).expect("encodes");
        let bytes: &'a [u8] = &buf[..n];
        Frame::parse_on_bearer(bytes, Tier::Compact).expect("parses")
    }

    fn key(b: u8) -> SecretKey<AEAD_KEY_LEN> {
        SecretKey::new(&mut [b; AEAD_KEY_LEN])
    }

    /// The classification names the key, and the payload comes back (7.3.1).
    #[test]
    fn intra_group_opens_under_the_group_key() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let k = key(0x5A);
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &k,
            &frame,
            b"a reading",
            &mut sealed,
        )
        .expect("seals");

        let mut out = [0u8; 128];
        let got = deliver_payload::<X>(
            Delivery::IntraGroup,
            PayloadKeys::Group(&k),
            &frame,
            &sealed[..n],
            &mut out,
        );
        assert_eq!(got, Ok(Delivered::Confidential(b"a reading".len())));
        assert_eq!(&out[..b"a reading".len()], b"a reading");
    }

    /// **The arm can fail.** The same envelope under a different key refuses,
    /// and refuses without saying why.
    #[test]
    fn intra_group_under_the_wrong_key_refuses_without_a_reason() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &key(0x5A),
            &frame,
            b"a reading",
            &mut sealed,
        )
        .expect("seals");

        let mut out = [0u8; 128];
        let got = deliver_payload::<X>(
            Delivery::IntraGroup,
            PayloadKeys::Group(&key(0x5B)),
            &frame,
            &sealed[..n],
            &mut out,
        );
        assert_eq!(got, Err(DeliveryRefusal::DidNotOpen));
    }

    /// **The hazard hive named.** Joined and unprovisioned refuses and says
    /// which — it does NOT degrade to delivering the bytes in clear.
    #[test]
    fn unprovisioned_refuses_and_does_not_fall_back_to_clear() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut out = [0xEE; 64];
        let got = deliver_payload::<X>(
            Delivery::IntraGroup,
            PayloadKeys::NotProvisioned,
            &frame,
            b"whatever bytes arrived",
            &mut out,
        );
        assert_eq!(got, Err(DeliveryRefusal::NotProvisioned));
        // Nothing was written: a refusal that had copied the payload would
        // be an in-clear delivery wearing an error.
        assert!(out.iter().all(|&b| b == 0xEE));
    }

    /// A hive holding exactly one entanglement, so `payload_key` can answer
    /// both ways and the negative is not manufactured by an empty table.
    struct OneCrossing {
        id: EntanglementId,
        key: SecretKey<AEAD_KEY_LEN>,
    }

    impl CrossingKeys for OneCrossing {
        fn payload_key(&self, id: EntanglementId) -> Option<&SecretKey<AEAD_KEY_LEN>> {
            (id == self.id).then_some(&self.key)
        }
    }

    /// **7.3.1's crossing arm, served.** The classification carries the
    /// entanglement's identifier and the key follows from it — the caller
    /// never states which key protects the frame (7.3.3).
    #[test]
    fn a_crossing_opens_under_that_entanglements_key() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let held = OneCrossing {
            id: EntanglementId(9),
            key: key(0xC1),
        };
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &held.key,
            &frame,
            b"across the crossing",
            &mut sealed,
        )
        .expect("seals");

        let mut out = [0u8; 128];
        let got = deliver_payload::<X>(
            Delivery::Crossing(EntanglementId(9)),
            PayloadKeys::GroupAndCrossings {
                group: &key(0x5A),
                crossings: &held,
            },
            &frame,
            &sealed[..n],
            &mut out,
        );
        assert_eq!(
            got,
            Ok(Delivered::Confidential(b"across the crossing".len()))
        );
        assert_eq!(&out[..19], b"across the crossing");
    }

    /// ‼ **THE PROPERTY THAT MAKES THE WRONG BRANCH SAFE.** L5A **5.2.2**
    /// requires the entanglement's keys distinct from every key of either
    /// group, so a crossing sealed under the entanglement key **does not
    /// open under the group key** — a misclassification fails closed instead
    /// of leaking across a trust boundary. *Without this the crossing arm
    /// could be served by the group key and every test above would still
    /// pass.*
    #[test]
    fn a_crossing_payload_does_not_open_under_the_group_key() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let held = OneCrossing {
            id: EntanglementId(9),
            key: key(0xC1),
        };
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &held.key,
            &frame,
            b"across the crossing",
            &mut sealed,
        )
        .expect("seals");

        let mut out = [0u8; 128];
        assert_eq!(
            deliver_payload::<X>(
                Delivery::IntraGroup,
                PayloadKeys::GroupAndCrossings {
                    group: &key(0x5A),
                    crossings: &held,
                },
                &frame,
                &sealed[..n],
                &mut out,
            ),
            Err(DeliveryRefusal::DidNotOpen),
            "classified intra-group, so the GROUP key is used and it does not open"
        );
    }

    /// An entanglement this hive does not hold refuses — and the resolver is
    /// shown answering, so the refusal is about custody rather than about an
    /// empty table.
    #[test]
    fn an_entanglement_this_hive_does_not_hold_refuses() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let held = OneCrossing {
            id: EntanglementId(9),
            key: key(0xC1),
        };
        assert!(held.payload_key(EntanglementId(9)).is_some(), "control");

        let mut out = [0u8; 64];
        assert_eq!(
            deliver_payload::<X>(
                Delivery::Crossing(EntanglementId(10)),
                PayloadKeys::GroupAndCrossings {
                    group: &key(0x5A),
                    crossings: &held,
                },
                &frame,
                b"anything",
                &mut out,
            ),
            Err(DeliveryRefusal::CrossingNotEstablished)
        );
    }

    /// The sending mirror: a crossing is sealed under the entanglement key,
    /// and an entanglement this hive does not hold **refuses rather than
    /// falling back to the group key.**
    #[test]
    fn originating_a_crossing_seals_under_the_entanglement_and_never_falls_back() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let held = OneCrossing {
            id: EntanglementId(9),
            key: key(0xC1),
        };

        let mut sealed = [0u8; 128];
        let n = originate_crossing::<X, _>(
            &mut CountingEntropy(0),
            &held,
            EntanglementId(9),
            &frame,
            b"across the crossing",
            &mut sealed,
        )
        .expect("seals");

        // It round-trips through the receive arm — the two halves agree.
        let mut out = [0u8; 128];
        assert_eq!(
            deliver_payload::<X>(
                Delivery::Crossing(EntanglementId(9)),
                PayloadKeys::GroupAndCrossings {
                    group: &key(0x5A),
                    crossings: &held,
                },
                &frame,
                &sealed[..n],
                &mut out,
            ),
            Ok(Delivered::Confidential(19))
        );

        // And an entanglement it does not hold is refused, NOT sent under
        // the group key.
        assert_eq!(
            originate_crossing::<X, _>(
                &mut CountingEntropy(0),
                &held,
                EntanglementId(10),
                &frame,
                b"across the crossing",
                &mut sealed,
            ),
            Err(OriginateRefusal::CrossingNotEstablished)
        );
    }

    /// A hive with group material and no entanglements: the crossing arm
    /// still refuses, and `Group` stays expressible without an empty
    /// resolver.
    #[test]
    fn a_crossing_refuses_because_none_is_established() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut out = [0u8; 64];
        let got = deliver_payload::<X>(
            Delivery::Crossing(EntanglementId(9)),
            PayloadKeys::Group(&key(0x5A)),
            &frame,
            b"anything",
            &mut out,
        );
        assert_eq!(got, Err(DeliveryRefusal::CrossingNotEstablished));
    }

    /// 7.3.2 — in clear, and **not reported as opened**.
    #[test]
    fn unauthenticated_is_in_clear_and_is_not_confidential() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut out = [0u8; 64];
        let got = deliver_payload::<X>(
            Delivery::Unauthenticated,
            PayloadKeys::NotProvisioned,
            &frame,
            b"public speech",
            &mut out,
        );
        assert_eq!(got, Ok(Delivered::InClear(b"public speech".len())));
        assert_ne!(got, Ok(Delivered::Confidential(b"public speech".len())));
        assert_eq!(&out[..b"public speech".len()], b"public speech");
    }

    /// **Both halves, one frame.** Originate then deliver: the round trip a
    /// hive actually performs, with the key arriving from the caller at each
    /// end and held by neither surface.
    #[test]
    fn a_payload_originates_and_delivers_under_the_group_key() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let k = key(0x5A);
        let mut sealed = [0u8; 128];
        let n = originate_payload::<X, _>(
            &mut CountingEntropy(0),
            PayloadKeys::Group(&k),
            &frame,
            b"22.4 degrees",
            &mut sealed,
        )
        .expect("originates");

        let mut out = [0u8; 128];
        let got = deliver_payload::<X>(
            Delivery::IntraGroup,
            PayloadKeys::Group(&k),
            &frame,
            &sealed[..n],
            &mut out,
        );
        assert_eq!(got, Ok(Delivered::Confidential(b"22.4 degrees".len())));
        assert_eq!(&out[..b"22.4 degrees".len()], b"22.4 degrees");
    }

    /// **An unprovisioned sender refuses and writes nothing.** The failure
    /// this arm exists for is a fallback to cleartext, which would publish
    /// the payload with nothing on the wire saying it had happened.
    #[test]
    fn an_unprovisioned_sender_refuses_and_emits_nothing() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut out = [0xEE; 128];
        let got = originate_payload::<X, _>(
            &mut CountingEntropy(0),
            PayloadKeys::NotProvisioned,
            &frame,
            b"22.4 degrees",
            &mut out,
        );
        assert_eq!(got, Err(OriginateRefusal::NotProvisioned));
        assert!(out.iter().all(|&b| b == 0xEE));
    }

    /// **The nonce rule reaches the caller.** A sender is not an oracle, so
    /// unlike the receive side this refusal carries its reason.
    #[test]
    fn a_refusing_entropy_source_refuses_the_send_with_its_reason() {
        struct Refusing;
        impl ConformingEntropy for Refusing {
            fn try_fill(&mut self, _: &mut [u8; 32]) -> bool {
                false
            }
        }
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut out = [0u8; 128];
        let got = originate_payload::<X, _>(
            &mut Refusing,
            PayloadKeys::Group(&key(0x5A)),
            &frame,
            b"22.4 degrees",
            &mut out,
        );
        assert_eq!(
            got,
            Err(OriginateRefusal::Refused(SealRefusal::EntropyNotConforming))
        );
    }
}
