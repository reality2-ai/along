//! **Delimiting frames on a byte stream, and assigning an ordinal (L1 4.3.2,
//! 8.4.1, 8.4.3).**
//!
//! # ‼ 4.3.2's SECOND HALF IS THE WHOLE OF THE RULE
//!
//! *Where a medium provides a byte stream and no boundaries, a bearer shall
//! delimit frames, and shall **reject a claimed length exceeding its declared
//! maximum without consuming further input as though it were payload**.*
//!
//! Note 1 says why, and it is not a tidiness argument: **a delimiter that
//! trusts a length field will follow a corrupt one into the next frame and
//! every frame after it**, and *a stream bearer that has lost delimitation
//! does not recover on its own.* One bad length is not one bad frame — it is
//! the end of the connection's usefulness, silently, with every subsequent
//! frame parsed from the wrong offset.
//!
//! So an over-long claim is refused **before a single octet of it is
//! consumed**, and the caller is told to resynchronise rather than handed a
//! plausible prefix.
//!
//! # There is no stream bearer in this workspace, and that is why this is
//! # here
//!
//! Nothing in the tree provides a byte stream today — the ordinals that
//! would, `Tcp` and `Usb`, have no bearer. **The obligation is not
//! contingent on one existing**, and the arithmetic is decidable now, on the
//! host, where a test can drive it. *The alternative is writing it inside the
//! first stream bearer somebody builds, which `SS399` established is a file
//! nothing compiles and nothing tests.*

use crate::l1::{Ordinal, ASSIGNABLE_BEARERS};

/// Octets of length prefix this delimiter uses.
///
/// **A local framing choice and not a wire format.** 4.3.2 obliges a bearer
/// to *delimit* and does not say how; a stream binding would state its own,
/// and nothing in this corpus defines one. *Named so it is visibly a choice
/// rather than an assumption.*
pub const LENGTH_PREFIX: usize = 2;

/// What one step of delimitation produced.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Delimited {
    /// A whole frame is available: this many octets follow the prefix.
    Frame { len: usize },
    /// Not enough octets yet to decide. **Consume nothing and wait.**
    NeedMore,
    /// ‼ **THE CLAIM EXCEEDS THE DECLARED MAXIMUM — REFUSED WITHOUT
    /// CONSUMING.** 4.3.2's second half, and the caller must resynchronise:
    /// *a stream bearer that has lost delimitation does not recover on its
    /// own*, so continuing to read at this offset follows a corrupt length
    /// into every frame after it.
    OverLongClaim { claimed: usize, max: usize },
}

/// **4.3.2: how much of `buf` is one frame, if any.**
///
/// ‼ **NOTHING IS CONSUMED BY A REFUSAL**, which is the clause's own wording:
/// *without consuming further input as though it were payload.* The caller
/// sees the same buffer it passed and decides how to resynchronise — this
/// layer will not guess, because a guess that lands mid-frame is
/// indistinguishable from a correct one until the next length is read.
pub fn delimit(buf: &[u8], max_payload: usize) -> Delimited {
    if buf.len() < LENGTH_PREFIX {
        return Delimited::NeedMore;
    }
    let claimed = u16::from_be_bytes([buf[0], buf[1]]) as usize;
    // ‼ THE LENGTH IS JUDGED BEFORE ANY OF IT IS BELIEVED.
    if claimed > max_payload {
        return Delimited::OverLongClaim {
            claimed,
            max: max_payload,
        };
    }
    if buf.len() < LENGTH_PREFIX + claimed {
        return Delimited::NeedMore;
    }
    Delimited::Frame { len: claimed }
}

/// Write the prefix for a frame of `len` octets.
///
/// `None` where the length cannot be expressed or exceeds the declared
/// maximum — *a sender that emitted a length its own delimiter would refuse
/// would be desynchronising its peer on purpose.*
pub fn prefix_for(len: usize, max_payload: usize) -> Option<[u8; LENGTH_PREFIX]> {
    if len > max_payload || len > u16::MAX as usize {
        return None;
    }
    Some((len as u16).to_be_bytes())
}

/// **8.4.1: the lowest unassigned ordinal.**
///
/// ‼ **AND 8.4.3 IS WHY THIS RETURNS `None` RATHER THAN WRAPPING.** *Where
/// more than seven bearers are needed, the width of the bearer set shall be
/// extended at Layer 4, and ordinals shall not be reused to avoid doing so* —
/// Note 1: **reusing an ordinal makes every stored bearer set silently
/// wrong** rather than merely full, *and nothing distinguishes an old value
/// from a new one.*
///
/// So a full registry is a **refusal that names a Layer 4 change**, never a
/// reuse.
pub fn lowest_unassigned(assigned: u8) -> Option<u8> {
    for ordinal in 0..8u8 {
        let bit = 1u8 << ordinal;
        // Only bits the registry actually assigns are candidates: a bit
        // outside `ASSIGNABLE_BEARERS` is not free, it is not an ordinal.
        if ASSIGNABLE_BEARERS & bit != 0 && assigned & bit == 0 {
            return Some(ordinal);
        }
    }
    None
}

/// The bits an assigned ordinal set occupies, for a caller building one.
pub fn assigned_bits(ordinals: &[Ordinal]) -> u8 {
    ordinals.iter().fold(0u8, |acc, o| acc | o.bit())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **4.3.2's SECOND HALF: AN OVER-LONG CLAIM IS REFUSED WITHOUT
    /// CONSUMING.** *A delimiter that trusts a length field will follow a
    /// corrupt one into the next frame and every frame after it*, and **a
    /// stream bearer that has lost delimitation does not recover on its
    /// own.** One bad length is not one bad frame; it is the end of the
    /// connection's usefulness.
    #[test]
    fn an_over_long_claim_is_refused_and_consumes_nothing() {
        // Claims 9999 octets where 250 is the maximum, and there happen to
        // be plenty of octets after it — a delimiter that trusted the length
        // would swallow the next frames whole.
        let mut buf = [0u8; 600];
        buf[..2].copy_from_slice(&9999u16.to_be_bytes());
        assert_eq!(
            delimit(&buf, 250),
            Delimited::OverLongClaim {
                claimed: 9999,
                max: 250
            }
        );

        // The boundary: exactly the maximum is accepted, one more is not.
        let mut ok = [0u8; 300];
        ok[..2].copy_from_slice(&250u16.to_be_bytes());
        assert_eq!(delimit(&ok, 250), Delimited::Frame { len: 250 });
        ok[..2].copy_from_slice(&251u16.to_be_bytes());
        assert_eq!(
            delimit(&ok, 250),
            Delimited::OverLongClaim {
                claimed: 251,
                max: 250
            }
        );
    }

    /// **Not enough octets is not an error**, and it consumes nothing either
    /// — a stream delivers what it delivers, and a partial frame is the
    /// ordinary case rather than a fault.
    #[test]
    fn a_partial_frame_waits_rather_than_failing() {
        assert_eq!(delimit(&[], 250), Delimited::NeedMore);
        assert_eq!(
            delimit(&[0x00], 250),
            Delimited::NeedMore,
            "prefix incomplete"
        );

        let mut buf = [0u8; 10];
        buf[..2].copy_from_slice(&100u16.to_be_bytes());
        assert_eq!(
            delimit(&buf, 250),
            Delimited::NeedMore,
            "prefix complete, body still arriving"
        );
    }

    /// A zero-length frame is a frame: the prefix is complete and the body is
    /// empty. **Whether an empty frame means anything is Layer 4's question**,
    /// and a delimiter that refused it would be interpreting the frame.
    #[test]
    fn a_zero_length_frame_is_delimited_rather_than_refused() {
        let buf = [0u8, 0u8];
        assert_eq!(delimit(&buf, 250), Delimited::Frame { len: 0 });
    }

    /// A sender never emits a length its own delimiter would refuse.
    #[test]
    fn a_prefix_is_refused_for_a_length_the_delimiter_would_reject() {
        assert_eq!(prefix_for(250, 250), Some(250u16.to_be_bytes()));
        assert_eq!(prefix_for(251, 250), None);
        assert_eq!(prefix_for(0, 250), Some([0, 0]));
        // And a round trip: what the sender wrote is what the delimiter reads.
        let mut buf = [0u8; 64];
        let p = prefix_for(40, 250).expect("fits");
        buf[..2].copy_from_slice(&p);
        assert_eq!(delimit(&buf, 250), Delimited::Frame { len: 40 });
    }

    /// ‼ **8.4.1 AND 8.4.3: A FULL REGISTRY REFUSES AND NAMES A LAYER 4
    /// CHANGE, NEVER REUSES.** *Reusing an ordinal makes every stored bearer
    /// set silently wrong* rather than merely full, **and nothing
    /// distinguishes an old value from a new one.**
    #[test]
    fn the_lowest_unassigned_ordinal_is_given_and_a_full_registry_refuses() {
        assert_eq!(lowest_unassigned(0), Some(0), "BLE's ordinal is lowest");

        // With BLE taken, the next assignable is LoRa at 2 — ordinal 1 is not
        // in `ASSIGNABLE_BEARERS` and is not free, it is not an ordinal.
        let taken = assigned_bits(&[Ordinal::Ble]);
        assert_eq!(lowest_unassigned(taken), Some(2));
        assert_eq!(
            ASSIGNABLE_BEARERS & 0b10,
            0,
            "ordinal 1 is unassignable, so it must never be offered"
        );

        // Every assignable ordinal taken: refuse rather than reuse.
        assert_eq!(
            lowest_unassigned(ASSIGNABLE_BEARERS),
            None,
            "8.4.3: extend the width at Layer 4, do not reuse"
        );

        // And a registry with everything except the highest still answers.
        let all_but_udp = assigned_bits(&[
            Ordinal::Ble,
            Ordinal::Lora,
            Ordinal::Tcp,
            Ordinal::Usb,
            Ordinal::WifiMesh,
        ]);
        assert_eq!(lowest_unassigned(all_but_udp), Some(Ordinal::Udp as u8));
    }
}
