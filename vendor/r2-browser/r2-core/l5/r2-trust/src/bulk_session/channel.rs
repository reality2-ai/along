use super::{current, Certificate, Clock, Context, Refusal, SecretKey, Ticks};
use crate::{cipher::XChaCha20Poly1305, crypto::Aead};

/// Session prefix (16), counter (8) and authentication tag (16).
pub const ENVELOPE_OVERHEAD: usize = 40;

struct Keys {
    send: SecretKey<32>,
    receive: SecretKey<32>,
}

/// In-memory replay window. Updated only after authenticated opening.
#[derive(Default)]
struct Replay {
    high: Option<u64>,
    seen: u64,
}

impl Replay {
    fn permits(&self, counter: u64) -> bool {
        match self.high {
            None => true,
            Some(high) if counter > high => true,
            Some(high) => {
                let behind = high - counter;
                behind < 64 && self.seen & (1 << behind) == 0
            }
        }
    }
    fn record(&mut self, counter: u64) {
        match self.high {
            None => {
                self.high = Some(counter);
                self.seen = 1;
            }
            Some(high) if counter > high => {
                let gap = counter - high;
                self.seen = if gap >= 64 { 1 } else { (self.seen << gap) | 1 };
                self.high = Some(counter);
            }
            Some(high) => self.seen |= 1 << (high - counter),
        }
    }
}

/// Non-restorable traffic keys with owned counters, expiry and membership checks.
/// No raw key or selectable nonce is exposed. `poll` must also run when idle;
/// changes to application authorization require explicit `cancel` by its owner.
/// Neither construction nor packet success establishes firmware installation.
pub struct Session {
    keys: Option<Keys>,
    prefix: [u8; 16],
    next_send: Option<u64>,
    replay: Replay,
    local: Certificate,
    peer: Certificate,
    clock: Clock,
}

impl core::fmt::Debug for Session {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("BulkSession(redacted)")
    }
}

impl Session {
    pub(super) fn new(
        send: SecretKey<32>,
        receive: SecretKey<32>,
        binding: [u8; 32],
        local: Certificate,
        peer: Certificate,
        clock: Clock,
    ) -> Self {
        let mut prefix = [0; 16];
        prefix.copy_from_slice(&binding[..16]);
        Self {
            keys: Some(Keys { send, receive }),
            prefix,
            next_send: Some(0),
            replay: Replay::default(),
            local,
            peer,
            clock,
        }
    }

    /// Public demultiplexing hint only; matching this does not authenticate.
    pub fn id(&self) -> [u8; 16] {
        self.prefix
    }

    pub fn cancel(&mut self) {
        self.keys = None;
        self.next_send = None;
    }

    /// Current trusted policy is supplied for BOTH endpoint certificates.
    /// Expiry, clock reversal or loss of membership irreversibly drops keys.
    pub fn poll<const R: usize>(
        &mut self,
        context: &Context<'_, R>,
        now: Ticks,
    ) -> Result<(), Refusal> {
        if self.keys.is_none() {
            return Err(Refusal::Unavailable);
        }
        if let Err(error) = self.clock.observe(now) {
            self.cancel();
            return Err(error);
        }
        if !current(&self.local, context) || !current(&self.peer, context) {
            self.cancel();
            return Err(Refusal::MembershipLost);
        }
        Ok(())
    }

    /// Encode prefix || big-endian counter || ciphertext || tag. The complete
    /// service header must be AAD, including operation, object position and
    /// length. This component does not interpret that application header.
    /// Every encryption attempt consumes its counter; local queue retry may
    /// retain the same immutable ciphertext, while semantic repair seals anew.
    pub fn seal<const R: usize>(
        &mut self,
        context: &Context<'_, R>,
        now: Ticks,
        aad: &[u8],
        plaintext: &[u8],
        out: &mut [u8],
    ) -> Result<usize, Refusal> {
        out.fill(0);
        self.poll(context, now)?;
        let total = plaintext
            .len()
            .checked_add(ENVELOPE_OVERHEAD)
            .ok_or(Refusal::OutputTooSmall)?;
        if out.len() < total {
            return Err(Refusal::OutputTooSmall);
        }
        let Some(counter) = self.next_send else {
            self.cancel();
            return Err(Refusal::CounterExhausted);
        };
        self.next_send = counter.checked_add(1);
        let mut nonce = [0; 24];
        nonce[..16].copy_from_slice(&self.prefix);
        nonce[16..].copy_from_slice(&counter.to_be_bytes());
        let keys = self.keys.as_ref().ok_or(Refusal::Unavailable)?;
        let Some(n) =
            XChaCha20Poly1305::seal(keys.send.expose(), &nonce, aad, plaintext, &mut out[24..])
        else {
            out.fill(0);
            return Err(Refusal::Cipher);
        };
        out[..24].copy_from_slice(&nonce);
        Ok(n + 24)
    }

    /// Refuse duplicate/stale counters before decryption, but advance replay
    /// state only after authentication succeeds. Every refusal erases the
    /// caller's output buffer so stale plaintext cannot be read as a result.
    pub fn open<const R: usize>(
        &mut self,
        context: &Context<'_, R>,
        now: Ticks,
        aad: &[u8],
        envelope: &[u8],
        out: &mut [u8],
    ) -> Result<usize, Refusal> {
        out.fill(0);
        self.poll(context, now)?;
        let length = envelope
            .len()
            .checked_sub(ENVELOPE_OVERHEAD)
            .ok_or(Refusal::Cipher)?;
        if out.len() < length {
            return Err(Refusal::OutputTooSmall);
        }
        let nonce: &[u8; 24] = envelope[..24].try_into().map_err(|_| Refusal::Cipher)?;
        if nonce[..16] != self.prefix {
            return Err(Refusal::WrongSession);
        }
        let counter = u64::from_be_bytes(nonce[16..].try_into().map_err(|_| Refusal::Cipher)?);
        if !self.replay.permits(counter) {
            return Err(Refusal::Replay);
        }
        let keys = self.keys.as_ref().ok_or(Refusal::Unavailable)?;
        let Some(n) =
            XChaCha20Poly1305::open(keys.receive.expose(), nonce, aad, &envelope[24..], out)
        else {
            out.fill(0);
            return Err(Refusal::Cipher);
        };
        self.replay.record(counter);
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_send_counter_is_used_once_and_exhaustion_cannot_wrap() {
        let (mut a, mut b) = super::super::tests::pair();
        let group = a.local.group;
        let revoked = crate::certificate::RevocationSet::<0>::new();
        let context = Context {
            group: &group,
            current_epoch: a.local.issued_at,
            acceptance_depth: crate::certificate::AcceptanceDepth(0),
            revoked: &revoked,
        };
        a.next_send = Some(u64::MAX);
        let mut packet = [0; 64];
        let n = a
            .seal(&context, Ticks(3), b"op", b"last", &mut packet)
            .unwrap();
        assert_eq!(&packet[16..24], &u64::MAX.to_be_bytes());
        assert_eq!(
            b.open(&context, Ticks(3), b"op", &packet[..n], &mut [0; 4]),
            Ok(4)
        );
        assert_eq!(
            a.seal(&context, Ticks(3), b"op", b"wrap", &mut packet),
            Err(Refusal::CounterExhausted)
        );
        assert_eq!(packet, [0; 64]);
        assert!(a.keys.is_none());
        assert_eq!(
            a.seal(&context, Ticks(3), b"op", b"wrap", &mut packet),
            Err(Refusal::Unavailable)
        );
    }

    #[test]
    fn replay_boundaries_include_sixty_three_but_refuse_sixty_four_and_duplicates() {
        let mut replay = Replay::default();
        assert!(replay.permits(64));
        replay.record(64);
        assert!(!replay.permits(64));
        assert!(replay.permits(1));
        assert!(!replay.permits(0));
        replay.record(1);
        assert!(!replay.permits(1));
        assert!(replay.permits(u64::MAX));
        replay.record(u64::MAX);
        assert!(!replay.permits(64));
        assert!(!replay.permits(u64::MAX));
        assert!(replay.permits(u64::MAX - 63));
        assert!(!replay.permits(u64::MAX - 64));
    }
}
