//! Loopback bearer: proves L1-L4 in the browser without any network.
//!
//! There is no registered L1 ordinal for a browser transport (8.2.1 lists ble,
//! lora, tcp, usb, wifi-mesh, udp — a WebSocket or WebRTC bearer fits none of
//! them, and 8.1.2 makes the ordinal, not the label, the interoperability key).
//! That is a spec finding, reported to standard. Until it is resolved this
//! bearer borrows `tcp`'s ordinal for local loopback only, which never reaches
//! a wire and so cannot mislead a peer.

use r2_mesh::l1::{
    Bearer, BearerProfile, BearerState, Fade, LinkQuality, MediumAddress, Ordinal, ReceiveError,
    RxMeta, SendError, SendTarget, SenderIdentity,
};
use r2_mesh::l3::HiveId;
use std::collections::VecDeque;

const MAX_PAYLOAD: u16 = 1024;
const QUEUE_LIMIT: usize = 16;

pub struct LoopbackBearer {
    queue: VecDeque<Vec<u8>>,
    profile: BearerProfile,
    state: BearerState,
    /// Frames dropped because the queue was full — counted, never silent.
    pub dropped: u64,
}

impl Default for LoopbackBearer {
    fn default() -> Self {
        Self::new()
    }
}

impl LoopbackBearer {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            profile: BearerProfile {
                ordinal: Ordinal::Tcp,
                max_payload: MAX_PAYLOAD..=MAX_PAYLOAD,
                wire_tier: Ordinal::Tcp.wire_tier(),
                fade: Fade::Unregulated { seconds: 30 },
                relative_cost: Ordinal::Tcp.relative_cost(),
                reach: Ordinal::Tcp.reach(),
                receptivity: r2_mesh::l1::Receptivity::Continuous,
                participates_in_discovery: true,
                connection: None,
            },
            state: BearerState::Available,
            dropped: 0,
        }
    }
}

impl Bearer for LoopbackBearer {
    fn profile(&self) -> &BearerProfile {
        &self.profile
    }

    fn state(&self) -> BearerState {
        self.state
    }

    fn max_payload(&self) -> u16 {
        MAX_PAYLOAD
    }

    fn send(&mut self, _target: SendTarget, frame: &[u8]) -> Result<(), SendError> {
        if frame.len() > MAX_PAYLOAD as usize {
            return Err(SendError::Oversize); // L1 6.3: refuse, never fragment
        }
        if self.queue.len() >= QUEUE_LIMIT {
            // Known unable: refuse rather than accept and discard (L1 5.2.2).
            self.dropped += 1;
            self.state = BearerState::Unavailable;
            return Err(SendError::Unavailable);
        }
        self.queue.push_back(frame.to_vec());
        Ok(())
    }

    fn poll_recv(&mut self, buf: &mut [u8]) -> Option<Result<(usize, RxMeta), ReceiveError>> {
        let frame = self.queue.front()?;
        if buf.len() < frame.len() {
            return Some(Err(ReceiveError::OutputTooSmall {
                needed: frame.len(),
            }));
        }
        let n = frame.len();
        buf[..n].copy_from_slice(frame);
        let _ = self.queue.pop_front();
        // A completed receive frees one queue entry, so the loopback bearer
        // can accept output again. A short-buffer refusal returns above and
        // deliberately leaves both the frame and this state unchanged.
        self.state = BearerState::Available;
        Some(Ok((
            n,
            RxMeta {
                // Loopback: the sender is this hive, but no canonical id has
                // been minted yet, so it is a medium identity like any other.
                sender: SenderIdentity::Medium {
                    addr: MediumAddress::new(&[0])?,
                    stable: true,
                },
                quality_hint: None,
            },
        )))
    }

    fn link_quality(&self, _peer: HiveId) -> Option<LinkQuality> {
        None
    }

    fn for_each_peer(&self, _f: &mut dyn FnMut(HiveId, LinkQuality)) {}
    /// ‼ **A LOOPBACK MEASURES NOTHING** (`SS510`). Nothing crossed a medium,
    /// so there is no measurement to map — and answering `1.0` would put a
    /// perfect-link claim into the neighbour table from a bearer with no link
    /// at all. 5.3.2 permits reporting nothing; inventing is what it forbids.
    fn quality_of_arrival(&self, _hint: Option<i16>) -> Option<LinkQuality> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_receive_buffer_never_returns_a_frame_prefix() {
        let mut bearer = LoopbackBearer::new();
        let frame = [0xA5; 513];
        bearer.send(SendTarget::Broadcast, &frame).unwrap();

        let mut short = [0u8; 512];
        assert!(matches!(
            bearer.poll_recv(&mut short),
            Some(Err(ReceiveError::OutputTooSmall { needed })) if needed == frame.len()
        ));
        assert_eq!(short, [0; 512], "no prefix was presented as a frame");

        let mut full = [0u8; 1024];
        let (len, _) = bearer
            .poll_recv(&mut full)
            .expect("the frame remains queued")
            .expect("the full buffer receives it");
        assert_eq!(&full[..len], &frame);
    }

    #[test]
    fn a_full_queue_reports_unavailable_until_a_receive_frees_capacity() {
        let mut bearer = LoopbackBearer::new();
        for _ in 0..QUEUE_LIMIT {
            bearer.send(SendTarget::Broadcast, b"frame").unwrap();
        }
        assert_eq!(bearer.state(), BearerState::Available);

        assert_eq!(
            bearer.send(SendTarget::Broadcast, b"overflow"),
            Err(SendError::Unavailable)
        );
        assert_eq!(bearer.state(), BearerState::Unavailable);

        let mut buf = [0u8; MAX_PAYLOAD as usize];
        assert!(matches!(bearer.poll_recv(&mut buf), Some(Ok(_))));
        assert_eq!(bearer.state(), BearerState::Available);
    }
}
