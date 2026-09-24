//! The encrypted-payload envelope (FORMATS 4.2) and **the nonce rule**.
//!
//! # THE NONCE RULE, STATED AT THE SITE
//!
//! This is the part of the payload cipher with no precedent anywhere else
//! in this crate: nothing else takes a per-message value whose *only*
//! requirement is that it never repeat. So the rule is written here rather
//! than left to a caller's judgement, in the three parts it has.
//!
//! **Where it comes from.** FORMATS 4.2: *"nonce freshly drawn from the
//! CSPRNG per frame."* It is drawn **inside [`seal_payload`]**, from the
//! platform's [`ConformingEntropy`] — the same source, and the same
//! trait, that key generation uses.
//! **There is no `nonce` parameter on this function and there will not
//! be.** *A caller-supplied nonce is the caller-supplied-span defect one
//! primitive over, and this lane has already shipped that defect twice:*
//! `apply_gate` took a span from its caller, then `HmacSha256Tag::compute`
//! did the same on the sign side. The difference here is the consequence
//! — a span a caller got wrong produced a tag that said nothing; a nonce
//! a caller repeats destroys confidentiality **and** authenticity for
//! every message under that key.
//!
//! **What guarantees it is not reused.** A uniform 192-bit draw, per
//! frame, and nothing else — no counter, no message identifier, no clock.
//! That is exactly why FORMATS 4.1 chose the extended nonce over
//! ChaCha20-Poly1305: *"the 24-byte random nonce removes the
//! nonce-uniqueness bookkeeping a 16-bit compact message identifier
//! cannot provide."* **The bookkeeping is not done better here; it is
//! made unnecessary.** The residual is the birthday bound, which at 24
//! bytes is not a bound a device reaches.
//!
//! **What happens when the guarantee cannot be met.** [`seal_payload`]
//! **refuses**. `try_fill` returning `false` means the source is not
//! conforming *at this moment* (L0 5.5.2 as a timing condition), and the
//! only conforming response is to send nothing. There is **no fallback**
//! — not a counter, not a timestamp, not the message identifier, not
//! zeros — and the refusal is a distinct variant so a caller cannot fold
//! it into a buffer-too-small.
//!
//! ## Why a fallback would be the worst kind of defect
//!
//! **A repeated nonce under XChaCha20-Poly1305 does not degrade; it
//! collapses.** Two messages under one key and nonce leak the XOR of
//! their plaintexts, and — because the Poly1305 one-time key is derived
//! from the same keystream — the authenticator key becomes recoverable,
//! so an attacker gains **forgery**, not merely disclosure. *And it is
//! invisible*: the ciphertext is the right length, the tag verifies, the
//! frame is delivered, and every test that seals and opens still passes.
//! **A reused nonce is worse than no encryption, and it fails silently.**
//! That combination is why the rule lives in the function rather than in
//! a document.

use crate::crypto::{Aead, AEAD_KEY_LEN, AEAD_TAG_LEN, NONCE_LEN};
use crate::keygen::ConformingEntropy;
use crate::keys::SecretKey;
use r2_wire::Frame;

/// Bytes an envelope adds to its plaintext: `nonce || … || tag`
/// (FORMATS 4.2). The 40-byte cost is accepted by that clause rather than
/// worked around.
pub const ENVELOPE_OVERHEAD: usize = NONCE_LEN + AEAD_TAG_LEN;

/// The largest associated-data span this module will assemble.
///
/// **Derived from the fields FORMATS 4.3 admits, not chosen round**: type
/// (1) + message identifier (≤4) + origin (≤8, the extended tier's entry
/// width) + event hash (4) + target (≤8) is 25. The margin is for a field
/// added to the span later; **exceeding it refuses rather than truncates**,
/// because a truncated AAD is an AAD that silently stops covering the
/// field at the end of it.
const MAX_AAD: usize = 64;

/// Why sealing refused. **Distinct variants on purpose**: the entropy
/// refusal is an operator-actionable condition about the device, and
/// folding it into a buffer error would report a broken CSPRNG as a
/// programming mistake.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SealRefusal {
    /// The platform's entropy source is not conforming **right now**, so
    /// no nonce was drawn and nothing was sealed. See the nonce rule
    /// above: there is no fallback.
    EntropyNotConforming,
    /// The frame's associated data is not computable — an origin-less
    /// frame (L4 8.3). *The same all-or-nothing condition the tag path
    /// has*, and it is checked before anything is written.
    AssociatedDataNotComputable,
    /// `out` is smaller than `plaintext.len() + ENVELOPE_OVERHEAD`, or the
    /// associated data exceeds `MAX_AAD`.
    BufferTooSmall,
    /// The cipher refused. Reached only through an implementation of
    /// [`Aead`] that fails for its own reasons; kept rather than
    /// `unwrap`ped because a panic in a sealing path is a denial of
    /// service on a device with no operator.
    CipherRefused,
}

/// Assemble the FORMATS 4.3 associated data into a fixed buffer.
///
/// **Derived from the frame, never supplied.** Returns the filled prefix,
/// or `None` where the frame has no origin or the span exceeds `MAX_AAD`.
fn associated_data<'b>(frame: &Frame<'_>, buf: &'b mut [u8; MAX_AAD]) -> Option<&'b [u8]> {
    let mut len = 0usize;
    let mut overflowed = false;
    let ok = frame
        .aead_associated_data(&mut |chunk| match buf.get_mut(len..len + chunk.len()) {
            Some(slot) => {
                slot.copy_from_slice(chunk);
                len += chunk.len();
            }
            None => overflowed = true,
        })
        .is_ok();
    if !ok || overflowed {
        return None;
    }
    Some(&buf[..len])
}

/// Seal a payload into the FORMATS 4.2 envelope: `nonce || ciphertext ||
/// tag`, with the frame's span as associated data (4.3).
///
/// **Both operands that a caller could get wrong are derived here rather
/// than accepted**: the nonce from the platform CSPRNG (see the nonce
/// rule at the head of this module) and the associated data from `frame`.
/// The only inputs are the key, the frame, and the bytes to protect.
///
/// `frame` supplies origin, message identifier, event hash and target.
/// **Its `payload` field is irrelevant and is not read** — 4.3 excludes
/// the payload from the associated data precisely because the AEAD
/// already covers it — so a caller may pass the frame it is about to
/// send with any placeholder payload. *That is a real property and it is
/// asserted below rather than promised here.*
pub fn seal_payload<A: Aead, E: ConformingEntropy>(
    entropy: &mut E,
    key: &SecretKey<AEAD_KEY_LEN>,
    frame: &Frame<'_>,
    plaintext: &[u8],
    out: &mut [u8],
) -> Result<usize, SealRefusal> {
    let mut aad_buf = [0u8; MAX_AAD];
    // **Computability first, before any draw and any write** — the shape
    // the gate and `tag_frame` both use, so a refusal never leaves half an
    // envelope or a spent nonce behind.
    let aad =
        associated_data(frame, &mut aad_buf).ok_or(SealRefusal::AssociatedDataNotComputable)?;

    let total = plaintext
        .len()
        .checked_add(ENVELOPE_OVERHEAD)
        .ok_or(SealRefusal::BufferTooSmall)?;
    if out.len() < total {
        return Err(SealRefusal::BufferTooSmall);
    }

    // The draw. `try_fill` is fixed at 32 bytes by design — hive's point,
    // that a slice invites a short read — so 24 are taken from a full
    // draw. **That is a prefix of a conforming draw, not a short read**:
    // the source was asked for its full width and answered.
    let mut drawn = [0u8; 32];
    if !entropy.try_fill(&mut drawn) {
        return Err(SealRefusal::EntropyNotConforming);
    }
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&drawn[..NONCE_LEN]);

    out[..NONCE_LEN].copy_from_slice(&nonce);
    let written = A::seal(
        key.expose(),
        &nonce,
        aad,
        plaintext,
        &mut out[NONCE_LEN..total],
    )
    .ok_or(SealRefusal::CipherRefused)?;
    Ok(NONCE_LEN + written)
}

/// Open a FORMATS 4.2 envelope. The nonce is **read out of the envelope**
/// and the associated data derived from `frame`, so the receive path has
/// no operand a caller can substitute either.
///
/// `None` on any failure, never distinguished by reason: a receiver that
/// reports *bad tag* separately from *short frame* has built an oracle.
pub fn open_payload<A: Aead>(
    key: &SecretKey<AEAD_KEY_LEN>,
    frame: &Frame<'_>,
    envelope: &[u8],
    out: &mut [u8],
) -> Option<usize> {
    if envelope.len() < ENVELOPE_OVERHEAD {
        return None;
    }
    let mut aad_buf = [0u8; MAX_AAD];
    let aad = associated_data(frame, &mut aad_buf)?;
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&envelope[..NONCE_LEN]);
    A::open(key.expose(), &nonce, aad, &envelope[NONCE_LEN..], out)
}

#[cfg(all(test, feature = "formats-suite"))]
mod tests {
    use super::*;
    use crate::cipher::XChaCha20Poly1305 as X;
    use r2_wire::frame::{Target, Tier};
    use r2_wire::{FrameSpec, FrameType};

    const ORIGIN: &[u8] = &[0xAB, 0xCD, 0xEF, 0x01];

    /// Entropy that answers, seeded so a test is reproducible. **Not a
    /// CSPRNG and named as a test fixture**, which is why it lives here
    /// and not beside the trait.
    struct CountingEntropy(u8);
    impl ConformingEntropy for CountingEntropy {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            self.0 = self.0.wrapping_add(1);
            out.fill(self.0);
            true
        }
    }

    /// Entropy that refuses — the condition the nonce rule is written for.
    struct RefusingEntropy;
    impl ConformingEntropy for RefusingEntropy {
        fn try_fill(&mut self, _: &mut [u8; 32]) -> bool {
            false
        }
    }

    fn spec<'a>(payload: &'a [u8], route: Option<&'a [u8]>) -> FrameSpec<'a> {
        FrameSpec {
            frame_type: FrameType::Event,
            constrained_origin: true,
            hop_limit: 5,
            budget: 6,
            msg_id: 0x1234,
            event_hash: 0x9ABC_DEF0,
            target: Target::Compact(0x2222_2222),
            route,
            payload,
            tag: None,
        }
    }

    fn framed<'a>(buf: &'a mut [u8; 256], payload: &[u8]) -> Frame<'a> {
        let n = spec(payload, Some(ORIGIN)).encode(buf).expect("encodes");
        let bytes: &'a [u8] = &buf[..n];
        Frame::parse_on_bearer(bytes, Tier::Compact).expect("parses")
    }

    fn key() -> SecretKey<AEAD_KEY_LEN> {
        SecretKey::new(&mut [0x5Au8; AEAD_KEY_LEN])
    }

    #[test]
    fn a_payload_seals_and_opens_under_the_same_frame() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &key(),
            &frame,
            b"a measurement",
            &mut sealed,
        )
        .expect("seals");
        assert_eq!(n, b"a measurement".len() + ENVELOPE_OVERHEAD);
        let mut opened = [0u8; 128];
        let m = open_payload::<X>(&key(), &frame, &sealed[..n], &mut opened).expect("opens");
        assert_eq!(&opened[..m], b"a measurement");
    }

    /// **The nonce rule's refusal arm, and nothing is written.** A device
    /// whose CSPRNG is not conforming sends nothing rather than sending
    /// something well-formed.
    #[test]
    fn a_non_conforming_entropy_source_refuses_and_writes_nothing() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut sealed = [0xEEu8; 128];
        assert_eq!(
            seal_payload::<X, _>(&mut RefusingEntropy, &key(), &frame, b"secret", &mut sealed),
            Err(SealRefusal::EntropyNotConforming)
        );
        assert!(
            sealed.iter().all(|&b| b == 0xEE),
            "a refused seal leaves the output buffer untouched"
        );
    }

    /// **Two seals of one plaintext must differ**, which is the whole
    /// point of drawing per frame. *If this ever passes with equal
    /// outputs the nonce has stopped being fresh*, and that is the failure
    /// the rule above says is silent everywhere else.
    #[test]
    fn two_seals_of_one_plaintext_differ_because_the_nonce_is_drawn_per_frame() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut e = CountingEntropy(0);
        let (mut a, mut b) = ([0u8; 128], [0u8; 128]);
        let na = seal_payload::<X, _>(&mut e, &key(), &frame, b"same", &mut a).unwrap();
        let nb = seal_payload::<X, _>(&mut e, &key(), &frame, b"same", &mut b).unwrap();
        assert_eq!(na, nb);
        assert_ne!(a[..na], b[..nb]);
        assert_ne!(a[..NONCE_LEN], b[..NONCE_LEN], "the nonce itself moved");
    }

    /// The associated data is payload-independent, which is what makes it
    /// safe to pass the frame before its payload is final. **Asserted, not
    /// promised** — the doc comment on [`seal_payload`] claims it.
    #[test]
    fn the_associated_data_ignores_the_payload_field() {
        let (mut b1, mut b2) = ([0u8; 256], [0u8; 256]);
        let f1 = framed(&mut b1, b"one");
        let f2 = framed(&mut b2, b"a completely different payload");
        let (mut a1, mut a2) = ([0u8; MAX_AAD], [0u8; MAX_AAD]);
        assert_eq!(
            associated_data(&f1, &mut a1).unwrap(),
            associated_data(&f2, &mut a2).unwrap()
        );
    }

    /// …and it is **not** independent of the fields it must bind (4.3:
    /// origin, identifier, target). **This is the diagonal half**: the
    /// test above alone would pass for an associated data that was empty.
    #[test]
    fn the_associated_data_moves_with_the_fields_it_binds() {
        let mut b1 = [0u8; 256];
        let f1 = framed(&mut b1, b"p");
        let mut a1 = [0u8; MAX_AAD];
        let base_slice = associated_data(&f1, &mut a1).unwrap();
        let base_len = base_slice.len();
        let mut base = [0u8; MAX_AAD];
        base[..base_len].copy_from_slice(base_slice);
        let base = &base[..base_len];
        assert!(!base.is_empty(), "an empty AAD binds nothing");

        let mut b2 = [0u8; 256];
        let mut s = spec(b"p", Some(ORIGIN));
        s.target = Target::Compact(0x3333_3333);
        let n = s.encode(&mut b2).unwrap();
        let f2 = Frame::parse_on_bearer(&b2[..n], Tier::Compact).unwrap();
        let mut a2 = [0u8; MAX_AAD];
        assert_ne!(associated_data(&f2, &mut a2).unwrap(), base);
    }

    /// A frame whose associated data changed does not open — the binding
    /// 4.3 exists for, measured end to end rather than at the buffer.
    #[test]
    fn an_envelope_does_not_open_under_a_different_frame() {
        let mut b1 = [0u8; 256];
        let f1 = framed(&mut b1, b"p");
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(&mut CountingEntropy(0), &key(), &f1, b"secret", &mut sealed)
            .unwrap();

        let mut b2 = [0u8; 256];
        let mut s = spec(b"p", Some(ORIGIN));
        s.msg_id = 0x4321;
        let m = s.encode(&mut b2).unwrap();
        let f2 = Frame::parse_on_bearer(&b2[..m], Tier::Compact).unwrap();

        let mut opened = [0u8; 128];
        assert!(open_payload::<X>(&key(), &f2, &sealed[..n], &mut opened).is_none());
    }

    /// **The empty-input falsifier on the envelope path.** A zero-length
    /// payload seals to exactly the overhead and opens back to nothing —
    /// and it is still bound to its frame, which is the half that would be
    /// lost if an empty plaintext short-circuited.
    #[test]
    fn an_empty_payload_seals_to_the_overhead_and_stays_bound() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"p");
        let mut sealed = [0u8; 128];
        let n = seal_payload::<X, _>(&mut CountingEntropy(0), &key(), &frame, b"", &mut sealed)
            .unwrap();
        assert_eq!(n, ENVELOPE_OVERHEAD);
        let mut opened = [0u8; 128];
        assert_eq!(
            open_payload::<X>(&key(), &frame, &sealed[..n], &mut opened),
            Some(0)
        );

        let mut b2 = [0u8; 256];
        let mut s = spec(b"p", Some(ORIGIN));
        s.msg_id = 0x4321;
        let m = s.encode(&mut b2).unwrap();
        let other = Frame::parse_on_bearer(&b2[..m], Tier::Compact).unwrap();
        assert!(open_payload::<X>(&key(), &other, &sealed[..n], &mut opened).is_none());
    }

    /// A truncated envelope refuses before any subtraction, and an
    /// envelope of exactly the overhead length is the boundary case that
    /// must still be admitted.
    #[test]
    fn a_truncated_envelope_refuses() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"p");
        let mut out = [0u8; 128];
        for len in 0..ENVELOPE_OVERHEAD {
            assert!(
                open_payload::<X>(&key(), &frame, &[0u8; ENVELOPE_OVERHEAD][..len], &mut out)
                    .is_none(),
                "an envelope of {len} bytes must refuse"
            );
        }
    }

    #[test]
    fn a_short_output_buffer_refuses_before_the_nonce_is_drawn() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"p");
        let mut e = CountingEntropy(0);
        let mut small = [0u8; 8];
        assert_eq!(
            seal_payload::<X, _>(&mut e, &key(), &frame, b"a measurement", &mut small),
            Err(SealRefusal::BufferTooSmall)
        );
        assert_eq!(e.0, 0, "no draw was spent on a refusal");
    }

    /// **L5 7.3.3 (`L5-065`).** *No frame shall carry a key identifier,
    /// cipher negotiation, or any statement of which key protects it.*
    ///
    /// ‼ **THIS IS A NEGATIVE AND IT IS PROVED BY A COMPLETE ACCOUNTING
    /// RATHER THAN BY LOOKING FOR A FIELD.** Asserting that some named
    /// header is absent only rules out the header somebody thought to
    /// name. Instead every byte is accounted for — `NONCE_LEN` of nonce,
    /// `plaintext.len()` of ciphertext, `AEAD_TAG_LEN` of tag — across a
    /// range of lengths INCLUDING zero, so **there is no room left in
    /// which an identifier could live**, whatever it might be called.
    ///
    /// And the accounting alone would still admit a *keyed* header, so the
    /// second half is the discriminating one: the same plaintext sealed
    /// under two different keys, from two entropy sources at the same
    /// seed, produces **byte-identical nonces**. A key identifier, a key
    /// hash, a suite byte or a negotiated selector would all differ there.
    /// The ciphertexts differ, which is the control proving the two keys
    /// were really different rather than the fixture comparing one key
    /// with itself.
    ///
    /// The receiver is the other half of the same property: `open_payload`
    /// takes the key **as a parameter**. It is told which key to try, from
    /// context, and the envelope has no say in it — so a wrong key is a
    /// silent `None` and never a renegotiation.
    #[test]
    fn an_envelope_is_nonce_ciphertext_and_tag_with_no_room_to_name_its_key() {
        let mut fb = [0u8; 256];
        let frame = framed(&mut fb, b"placeholder");
        let mut sealed = [0u8; 256];

        // a) Complete accounting, at every length from empty upward.
        let filler = [b'z'; 64];
        for len in [0usize, 1, 7, 16, 64] {
            let plaintext = &filler[..len];
            let n = seal_payload::<X, _>(
                &mut CountingEntropy(0),
                &key(),
                &frame,
                plaintext,
                &mut sealed,
            )
            .expect("seals");
            assert_eq!(
                n,
                len + NONCE_LEN + AEAD_TAG_LEN,
                "an envelope over {len} plaintext bytes is {n} bytes. Every byte must be nonce, \
                 ciphertext or tag — a difference here is a field, and 7.3.3 forbids one that \
                 states which key protects the frame"
            );
        }

        // b) The nonce is not keyed, and carries nothing about the key.
        let mut other_bytes = [0xA5u8; AEAD_KEY_LEN];
        let other = SecretKey::new(&mut other_bytes);
        let mut under_a = [0u8; 256];
        let mut under_b = [0u8; 256];
        let na = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &key(),
            &frame,
            b"same",
            &mut under_a,
        )
        .expect("seals");
        let nb = seal_payload::<X, _>(
            &mut CountingEntropy(0),
            &other,
            &frame,
            b"same",
            &mut under_b,
        )
        .expect("seals");
        assert_eq!(na, nb);
        assert_eq!(
            under_a[..NONCE_LEN],
            under_b[..NONCE_LEN],
            "the header differs between two keys, so it says something about which key protects \
             the frame — which is exactly what 7.3.3 forbids"
        );
        // CONTROL: the two keys really are different, or the equality
        // above would be the trivial one.
        assert_ne!(
            under_a[NONCE_LEN..na],
            under_b[NONCE_LEN..nb],
            "the two ciphertexts are identical, so the fixture sealed under one key twice and \
             the nonce comparison above proved nothing"
        );

        // c) The receiver is told the key; the envelope never selects it.
        let mut opened = [0u8; 256];
        assert!(
            open_payload::<X>(&other, &frame, &under_a[..na], &mut opened).is_none(),
            "an envelope opened under the wrong key must refuse — silently, and without the \
             envelope naming the right one"
        );
        assert_eq!(
            open_payload::<X>(&key(), &frame, &under_a[..na], &mut opened),
            Some(4)
        );
    }
}
