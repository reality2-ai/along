//! **Retransmission, and dividing above this layer (L4 5.2, 6.2.2).**
//!
//! # ‼ THE NETWORK NEVER HOLDS HALF A THING
//!
//! **6.2.2**: a payload too large for one frame *shall be divided at its
//! source, **above this layer**, by the endpoint that knows what the payload
//! means, into payloads **each carried by an ordinary, independent frame**.*
//!
//! Note 1 says what that buys and what the alternative costs: *every frame is
//! complete, routable and droppable on its own*, and **a fragmentation layer
//! would reintroduce everything the core premise forbids — state in the
//! middle, loss that cascades, and a frame whose meaning depends on another
//! frame arriving.**
//!
//! ‼ **SO THIS MODULE DIVIDES AND DOES NOT FRAGMENT, AND THE DIFFERENCE IS
//! NOT A MATTER OF DEGREE.** A fragmenter cuts at a byte offset and the
//! pieces mean nothing apart; a divider is handed **already-independent
//! pieces by the endpoint that knows their meaning** and only checks that
//! each one fits. *This crate cannot know where a payload may be cut — that
//! is exactly the knowledge 6.2.2 places above it — so it never cuts.*
//!
//! # 5.2: retransmit the same frame, unchanged
//!
//! *Where delivery has to be more probable than one transmission makes it,
//! the sender shall retransmit **the same frame, unchanged**, and the
//! receiver's duplicate handling shall make retransmission harmless.*
//!
//! ‼ **UNCHANGED IS THE WHOLE WORD.** The message identifier is what
//! duplicate suppression keys on, so a "retransmission" that re-originated
//! the frame with a fresh identifier is **a second message**, and the
//! receiver's dedup — the thing 5.2 relies on to make retries harmless — has
//! nothing to match it against. *It would arrive twice and be delivered
//! twice, which is precisely what the clause promises will not happen.*

/// Why a payload could not be carried.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CarriageRefusal {
    /// A single piece does not fit one frame's payload.
    ///
    /// ‼ **REFUSED, NEVER CUT.** 6.2.2 puts the division **above this
    /// layer**, with *the endpoint that knows what the payload means* — so a
    /// piece this crate cannot carry is a piece the endpoint divided wrongly,
    /// and cutting it here would be the fragmentation layer Note 1 forbids.
    PieceTooLargeForOneFrame {
        index: usize,
        len: usize,
        max: usize,
    },
}

/// **6.2.2: check that each piece is carriable as an ordinary, independent
/// frame.**
///
/// Takes pieces **the endpoint already divided**, because that is where the
/// clause puts the division. Returns how many frames the payload will occupy
/// — which equals the number of pieces, since *each is carried by an ordinary
/// frame* and none is joined to another.
pub fn pieces_are_carriable(
    pieces: &[&[u8]],
    max_payload: usize,
) -> Result<usize, CarriageRefusal> {
    for (index, piece) in pieces.iter().enumerate() {
        if piece.len() > max_payload {
            return Err(CarriageRefusal::PieceTooLargeForOneFrame {
                index,
                len: piece.len(),
                max: max_payload,
            });
        }
    }
    Ok(pieces.len())
}

/// **Whether a whole payload needs dividing at all** (6.2.2's condition).
///
/// `false` means one ordinary frame carries it and no endpoint contract is
/// needed; `true` means the endpoint must divide it, and **this layer will
/// not do that for it.**
#[must_use]
pub const fn needs_dividing(payload_len: usize, max_payload: usize) -> bool {
    payload_len > max_payload
}

/// **5.2: a retransmission is the same frame, unchanged.**
///
/// ‼ **COMPARES THE BYTES, NOT AN INTENT.** A caller can only demonstrate
/// *unchanged* by producing the same octets, and any weaker check — same
/// length, same identifier, same type — passes for a frame that differs
/// somewhere the receiver's duplicate handling does not look.
#[must_use]
pub fn is_unchanged_retransmission(first: &[u8], again: &[u8]) -> bool {
    first == again
}

/// How many times a sender may repeat one frame.
///
/// ‼ **THE FIGURE IS THE DEPLOYMENT'S AND IS NOT FIXED HERE.** 5.2 says
/// *where delivery has to be more probable than one transmission makes it*
/// and names no number — how probable is enough is a property of the
/// deployment, not of the wire. *A constant here would be obeyed exactly and
/// be wrong everywhere it was not measured.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RetryBudget {
    /// Total transmissions of one frame, the first included.
    pub transmissions: u8,
}

impl RetryBudget {
    /// A sender that transmits once and does not repeat — **5.2's default,
    /// because fire-and-forget is the layer's model and repetition is the
    /// exception a deployment opts into.**
    #[must_use]
    pub const fn once() -> Self {
        Self { transmissions: 1 }
    }

    /// Whether another transmission of the same frame is permitted.
    #[must_use]
    pub const fn may_send_again(&self, already_sent: u8) -> bool {
        already_sent < self.transmissions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **6.2.2: THE PIECES ARE INDEPENDENT FRAMES, AND THIS LAYER NEVER
    /// CUTS.** *A fragmentation layer would reintroduce everything the core
    /// premise forbids — state in the middle, loss that cascades, and a frame
    /// whose meaning depends on another frame arriving.*
    #[test]
    fn each_piece_becomes_one_ordinary_frame_and_none_is_joined_to_another() {
        let a = [0u8; 100];
        let b = [1u8; 100];
        let c = [2u8; 55];
        let pieces: [&[u8]; 3] = [&a, &b, &c];
        assert_eq!(
            pieces_are_carriable(&pieces, 200),
            Ok(3),
            "three pieces, three ordinary frames"
        );
        // An empty division carries nothing and is not an error: an endpoint
        // with nothing to say says nothing.
        assert_eq!(pieces_are_carriable(&[], 200), Ok(0));
    }

    /// ‼ **A PIECE TOO LARGE IS REFUSED AND NEVER CUT.** 6.2.2 puts the
    /// division above this layer, *with the endpoint that knows what the
    /// payload means* — so an over-long piece is a division the endpoint got
    /// wrong, and cutting it here would be the fragmentation layer Note 1
    /// forbids.
    #[test]
    fn an_over_long_piece_is_refused_rather_than_cut() {
        let ok = [0u8; 200];
        let big = [0u8; 201];
        let pieces: [&[u8]; 2] = [&ok, &big];
        assert_eq!(
            pieces_are_carriable(&pieces, 200),
            Err(CarriageRefusal::PieceTooLargeForOneFrame {
                index: 1,
                len: 201,
                max: 200
            }),
            "and it names WHICH piece, so the endpoint can fix its division"
        );
        // The boundary: exactly the maximum fits.
        assert_eq!(pieces_are_carriable(&[&ok], 200), Ok(1));
    }

    /// **6.2.2's condition**: whether an endpoint contract is needed at all.
    #[test]
    fn a_payload_that_fits_one_frame_needs_no_division() {
        assert!(!needs_dividing(200, 200));
        assert!(needs_dividing(201, 200));
        assert!(!needs_dividing(0, 200));
    }

    /// ‼ **5.2: `UNCHANGED` IS THE WHOLE WORD.** A retransmission that
    /// re-originated the frame with a fresh message identifier is **a second
    /// message**, and the receiver's duplicate handling — *the thing 5.2
    /// relies on to make retries harmless* — has nothing to match it
    /// against. It would arrive twice and be delivered twice.
    #[test]
    fn a_retransmission_differing_anywhere_is_a_second_message() {
        let first = [0x06u8, 0x56, 0x12, 0x34, 0xAA, 0xBB];
        assert!(is_unchanged_retransmission(&first, &first.clone()));

        // One octet different — a new message identifier, say — and it is
        // not a retransmission at all.
        let mut relabelled = first;
        relabelled[2] ^= 0x01;
        assert!(
            !is_unchanged_retransmission(&first, &relabelled),
            "a fresh identifier makes it a SECOND message, which dedup cannot suppress"
        );

        // Same prefix, different length: also not the same frame.
        assert!(!is_unchanged_retransmission(&first, &first[..5]));
    }

    /// **Fire-and-forget is the model and repetition is opted into**, so the
    /// default budget transmits once. The figure beyond that is the
    /// deployment's — *5.2 names none, because how probable is enough is a
    /// property of the deployment and not of the wire.*
    #[test]
    fn the_default_is_one_transmission_and_more_is_a_deployment_choice() {
        let once = RetryBudget::once();
        assert!(once.may_send_again(0), "the first transmission");
        assert!(!once.may_send_again(1), "and no repeat unless asked for");

        let thrice = RetryBudget { transmissions: 3 };
        assert!(thrice.may_send_again(0));
        assert!(thrice.may_send_again(2));
        assert!(!thrice.may_send_again(3));
    }
}
