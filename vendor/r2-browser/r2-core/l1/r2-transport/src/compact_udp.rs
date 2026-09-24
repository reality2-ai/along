//! Compact UDP version 1 mode framing (L1 8.2.5).
//!
//! Fixed UDP endpoint mode; never inferred from a frame or its authentication.
//! One datagram carries the discriminator followed by one unchanged L4 frame.
//! The first octet has a reserved L4 message type, so this envelope cannot be
//! mistaken for a valid bare extended frame by an ordinary UDP endpoint.

use crate::l1::{ReceiveError, SendError};

/// Mode discriminator: reserved L4 octet, ASCII R2IP, version, mode, reserved.
pub const HEADER: [u8; 8] = [0xff, b'R', b'2', b'I', b'P', 1, 0, 0];
/// Ethernet/IPv4 UDP payload ceiling minus the mode envelope.
pub const MAX_FRAME: usize = 1472 - HEADER.len();

pub fn encode(frame: &[u8], output: &mut [u8]) -> Result<usize, SendError> {
    if frame.is_empty() {
        return Err(SendError::NotCarried);
    }
    let bytes = HEADER.len() + frame.len();
    if frame.len() > MAX_FRAME || output.len() < bytes {
        return Err(SendError::Oversize);
    }
    output[..HEADER.len()].copy_from_slice(&HEADER);
    output[HEADER.len()..bytes].copy_from_slice(frame);
    Ok(bytes)
}

pub fn decode(datagram: &[u8]) -> Result<&[u8], ReceiveError> {
    if datagram.len() <= HEADER.len()
        || datagram.len() > HEADER.len() + MAX_FRAME
        || !datagram.starts_with(&HEADER)
    {
        return Err(ReceiveError::Malformed);
    }
    Ok(&datagram[HEADER.len()..])
}
