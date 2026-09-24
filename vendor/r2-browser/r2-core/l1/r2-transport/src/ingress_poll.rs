//! Fair, lossless polling of a pair of Layer 1 ingresses.
//!
//! A consumer sharing one receive buffer between multiple ingresses must not
//! eagerly poll them all and then choose one result. The later ingress would
//! overwrite the bytes while the earlier metadata was retained, and the later
//! operation could be consumed with no corresponding delivery attempt. This
//! helper polls one preferred ingress and uses the other only when the first
//! reports no queued operation. A caller alternates `first_preferred` between
//! service turns to avoid a busy ingress starving its sibling.
//!
//! An explicit [`crate::l1::ReceiveError`] is an operation, not emptiness, so it is
//! returned from the preferred ingress without polling the fallback. This
//! preserves the receive contract: only `None` permits trying another source.

use crate::l1::{Ingress, ReceiveError, RxMeta};

/// An operation from an indexed ingress set. The selected index owns both
/// metadata and the bytes in the shared output buffer, including on refusal.
#[derive(Clone, Copy, Debug)]
pub struct IndexedIngress {
    /// Position in the supplied ingress slice.
    pub index: usize,
    /// The selected ingress's complete frame or explicit refusal.
    pub outcome: Result<(usize, RxMeta), ReceiveError>,
}

/// Service a changing ingress set without starving a busy member or consuming
/// another member's frame. The cursor advances past the selected operation;
/// an explicit error consumes a turn just as a complete frame does.
pub fn poll_set(
    ingresses: &mut [&mut dyn Ingress],
    buf: &mut [u8],
    next: &mut usize,
) -> Option<IndexedIngress> {
    if ingresses.is_empty() {
        *next = 0;
        return None;
    }
    let mut index = *next % ingresses.len();
    for _ in 0..ingresses.len() {
        let following = (index + 1) % ingresses.len();
        if let Some(outcome) = ingresses[index].poll_recv(buf) {
            *next = following;
            return Some(IndexedIngress { index, outcome });
        }
        index = following;
    }
    None
}

/// Which member of a pair produced the returned polling outcome.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IngressSlot {
    /// The `first` ingress supplied to [`poll_pair`].
    First,
    /// The `second` ingress supplied to [`poll_pair`].
    Second,
}

/// One selected ingress polling outcome.
///
/// [`Self::slot`] identifies the ingress that owns both [`Self::outcome`]'s
/// metadata and the bytes copied into the caller's buffer. The helper has no
/// reference to either ingress after returning, so the consumer may inspect
/// that selected ingress's profile and quality mapping without retaining a
/// borrow across later work.
#[derive(Clone, Copy, Debug)]
pub struct PolledIngress {
    /// The ingress whose poll operation produced this outcome.
    pub slot: IngressSlot,
    /// A complete frame, or that ingress's explicit refusal.
    pub outcome: Result<(usize, RxMeta), ReceiveError>,
}

/// Poll exactly one available operation from a pair of ingresses.
///
/// `first_preferred` controls only this turn's order. Callers that service a
/// pair repeatedly should alternate it before each call. The fallback is
/// polled only after the preferred ingress returns `None`; a successful frame
/// or an explicit receive refusal always belongs to the preferred ingress and
/// leaves the fallback untouched.
pub fn poll_pair(
    first: &mut dyn Ingress,
    second: &mut dyn Ingress,
    buf: &mut [u8],
    first_preferred: bool,
) -> Option<PolledIngress> {
    if first_preferred {
        if let Some(outcome) = first.poll_recv(buf) {
            return Some(PolledIngress {
                slot: IngressSlot::First,
                outcome,
            });
        }
        return second.poll_recv(buf).map(|outcome| PolledIngress {
            slot: IngressSlot::Second,
            outcome,
        });
    }

    if let Some(outcome) = second.poll_recv(buf) {
        return Some(PolledIngress {
            slot: IngressSlot::Second,
            outcome,
        });
    }
    first.poll_recv(buf).map(|outcome| PolledIngress {
        slot: IngressSlot::First,
        outcome,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::l1::{BearerProfile, BearerState, LinkQuality, SenderIdentity};
    use r2_ident::HiveId;

    struct QueuedIngress {
        bytes: [u8; 8],
        len: usize,
        queued: bool,
        quality_hint: i16,
    }

    impl QueuedIngress {
        const fn new(bytes: [u8; 8], len: usize, quality_hint: i16) -> Self {
            Self {
                bytes,
                len,
                queued: true,
                quality_hint,
            }
        }
    }

    impl Ingress for QueuedIngress {
        fn profile(&self) -> &BearerProfile {
            unreachable!("the pair selector never inspects a profile")
        }

        fn state(&self) -> BearerState {
            BearerState::Available
        }

        fn max_payload(&self) -> u16 {
            8
        }

        fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
            if !self.queued {
                return None;
            }
            if buf.len() < self.len {
                return Some(Err(ReceiveError::OutputTooSmall { needed: self.len }));
            }
            buf[..self.len].copy_from_slice(&self.bytes[..self.len]);
            self.queued = false;
            Some(Ok((
                self.len,
                RxMeta {
                    sender: SenderIdentity::Canonical(HiveId([self.quality_hint as u8; 8])),
                    quality_hint: Some(self.quality_hint),
                },
            )))
        }

        fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
            None
        }

        fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}

        fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
            None
        }
    }

    #[test]
    fn indexed_service_preserves_three_busy_sources_and_advances_past_refusals() {
        let mut a = QueuedIngress::new(*b"first...", 5, 11);
        let mut b = QueuedIngress::new(*b"second..", 6, 22);
        let mut c = QueuedIngress::new(*b"third...", 5, 33);
        let mut next = 0;
        let mut buf = [0u8; 8];
        for (index, bytes, hint) in [
            (0, &b"first"[..], 11),
            (1, &b"second"[..], 22),
            (2, &b"third"[..], 33),
        ] {
            // A remains busy. Advancing only after an empty poll would starve
            // both B and C, which is the board's new three-transport case.
            a.queued = true;
            let polled = poll_set(&mut [&mut a, &mut b, &mut c], &mut buf, &mut next).unwrap();
            assert_eq!(polled.index, index);
            let (len, meta) = polled.outcome.unwrap();
            assert_eq!(&buf[..len], bytes);
            assert_eq!(meta.quality_hint, Some(hint));
        }
        a.queued = true;
        b.queued = true;
        c.queued = true;
        let polled = poll_set(&mut [&mut a, &mut b, &mut c], &mut [], &mut next).unwrap();
        assert_eq!(polled.index, 0);
        assert!(matches!(
            polled.outcome,
            Err(ReceiveError::OutputTooSmall { needed: 5 })
        ));
        assert!(a.queued && b.queued && c.queued);
        let polled = poll_set(&mut [&mut a, &mut b, &mut c], &mut buf, &mut next).unwrap();
        assert_eq!(polled.index, 1);
        assert_eq!(&buf[..polled.outcome.unwrap().0], b"second");
        assert!(a.queued && c.queued);
    }

    #[test]
    fn indexed_service_handles_empty_and_shrinking_sets_without_stale_indices() {
        let mut next = usize::MAX;
        let mut buf = [0; 8];
        assert!(poll_set(&mut [], &mut buf, &mut next).is_none());
        assert_eq!(next, 0);
        let mut a = QueuedIngress::new(*b"first...", 5, 11);
        next = usize::MAX;
        let polled = poll_set(&mut [&mut a], &mut buf, &mut next).unwrap();
        assert_eq!(polled.index, 0);
        assert_eq!(&buf[..polled.outcome.unwrap().0], b"first");
        assert!(poll_set(&mut [&mut a], &mut buf, &mut next).is_none());
    }

    #[test]
    fn a_selected_ingress_owns_the_buffer_and_the_other_remains_for_the_next_turn() {
        let mut first = QueuedIngress::new(*b"first...", 5, 11);
        let mut second = QueuedIngress::new(*b"second..", 6, 22);
        let mut buf = [0u8; 8];

        let selected = poll_pair(&mut first, &mut second, &mut buf, true)
            .expect("the preferred ingress has a queued frame");
        assert_eq!(selected.slot, IngressSlot::First);
        let (len, meta) = selected.outcome.expect("the first frame fits");
        assert_eq!(&buf[..len], b"first");
        assert_eq!(meta.quality_hint, Some(11));
        assert!(!first.queued);
        assert!(second.queued, "the unpolled frame remains available");

        let selected = poll_pair(&mut first, &mut second, &mut buf, false)
            .expect("the remaining ingress is selected next");
        assert_eq!(selected.slot, IngressSlot::Second);
        let (len, meta) = selected.outcome.expect("the second frame fits");
        assert_eq!(&buf[..len], b"second");
        assert_eq!(meta.quality_hint, Some(22));
        assert!(!second.queued);
    }

    #[test]
    fn an_explicit_refusal_does_not_consume_the_fallback_ingress() {
        let mut first = QueuedIngress::new(*b"first...", 5, 11);
        let mut second = QueuedIngress::new(*b"second..", 6, 22);
        let mut short = [0u8; 4];

        let selected = poll_pair(&mut first, &mut second, &mut short, true)
            .expect("the first ingress has an operation");
        assert_eq!(selected.slot, IngressSlot::First);
        assert!(matches!(
            selected.outcome,
            Err(ReceiveError::OutputTooSmall { needed: 5 })
        ));
        assert!(first.queued, "the refused operation remains retryable");
        assert!(
            second.queued,
            "a refusal is not permission to consume another ingress"
        );
    }

    #[test]
    fn an_empty_preferred_ingress_falls_back_to_the_other_one() {
        let mut first = QueuedIngress::new(*b"first...", 5, 11);
        let mut second = QueuedIngress::new(*b"second..", 6, 22);
        first.queued = false;
        let mut buf = [0u8; 8];

        let selected = poll_pair(&mut first, &mut second, &mut buf, true)
            .expect("the fallback ingress has a queued frame");
        assert_eq!(selected.slot, IngressSlot::Second);
        let (len, meta) = selected.outcome.expect("the fallback frame fits");
        assert_eq!(&buf[..len], b"second");
        assert_eq!(meta.quality_hint, Some(22));
    }
}
