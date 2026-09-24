//! Authenticated ephemeral session custody for the pending bulk service.
//!
//! This component does not admit TN events, select an application profile or
//! observe a direct radio. The caller must establish those preconditions and
//! bind their exact descriptor to `Binding::context`. See the construction in
//! docs/BULK-SESSION-CRYPTO.md. No deployed runtime selects this component yet.
//! The cryptographic primitives and purpose registry are FORMATS 3/4/4a;
//! certificate bytes remain PROVISIONAL(SS489), FORMATS 5d.1.

use core::num::NonZeroU64;
use r2_hal_traits::time::Ticks;

use crate::{
    certificate::{standing, Certificate, Standing},
    crypto::Digest,
    derive::{derive_key, Purpose},
    evidence::{HighWaterMarks, MemberEvidence},
    identity::Identity,
    key_agreement::{KeyAgreement, X25519},
    keygen::ConformingEntropy,
    keys::SecretKey,
    member_proof::{self, Context},
    suite::{Ed25519, HkdfSha256, Sha256},
};

mod channel;
pub use channel::{Session, ENVELOPE_OVERHEAD};

const DOMAIN: &[u8; 19] = b"r2 bulk session v1\0";
pub const STATEMENT_BYTES: usize = 243;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Initiator,
    Responder,
}

/// Locally selected full identities and SHA-256 of the exact service descriptor.
/// The descriptor must bind profile/version, object/digest, directions, bounds
/// and lifetime; for OTA it also binds target, sequence and complete package
/// size. A caller-selected hash alone establishes none of those preconditions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Binding {
    pub group: Identity,
    pub initiator: Identity,
    pub responder: Identity,
    pub context: [u8; 32],
}

impl Binding {
    fn local(&self, role: Role) -> Identity {
        match role {
            Role::Initiator => self.initiator,
            Role::Responder => self.responder,
        }
    }
    fn peer(&self, role: Role) -> Identity {
        match role {
            Role::Initiator => self.responder,
            Role::Responder => self.initiator,
        }
    }
}

/// Untrusted hello: X25519 public coordinate followed by a verifier nonce.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hello {
    pub public: [u8; 32],
    pub challenge: [u8; 16],
}

impl Hello {
    pub fn encode(&self) -> [u8; 48] {
        let mut out = [0; 48];
        out[..32].copy_from_slice(&self.public);
        out[32..].copy_from_slice(&self.challenge);
        out
    }
    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let bytes: &[u8; 48] = bytes.try_into().ok()?;
        Some(Self {
            public: bytes[..32].try_into().ok()?,
            challenge: bytes[32..].try_into().ok()?,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    Unavailable,
    Entropy,
    Binding,
    LocalMembership,
    PeerHelloMissing,
    HelloConflict,
    Member(member_proof::Refusal),
    Agreement,
    Expired,
    ClockReversed,
    MembershipLost,
    WrongSession,
    Replay,
    OutputTooSmall,
    Cipher,
    CounterExhausted,
}

#[derive(Clone, Copy)]
struct Clock {
    issued: Ticks,
    last: Ticks,
    lifetime: NonZeroU64,
}

impl Clock {
    fn observe(&mut self, now: Ticks) -> Result<(), Refusal> {
        if now.since(self.last).is_none() {
            return Err(Refusal::ClockReversed);
        }
        let age = now.since(self.issued).ok_or(Refusal::ClockReversed)?;
        if age >= self.lifetime.get() {
            return Err(Refusal::Expired);
        }
        self.last = now;
        Ok(())
    }
}

/// A fresh, non-restorable handshake. The private agreement key is consumed
/// once, and the nonce cannot be supplied or reset by a caller. A peer hello
/// is pinned once before proof verification. Bad proof cannot extend lifetime.
pub struct Pending {
    key: Option<X25519>,
    role: Role,
    binding: Binding,
    local: Certificate,
    hello: Hello,
    peer: Option<Hello>,
    clock: Clock,
}

impl core::fmt::Debug for Pending {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("PendingBulkSession(redacted)")
    }
}

impl Pending {
    /// Begin only after local profile/application authorization. `local` must
    /// be the runtime's own certificate; possessing a copy is not possession
    /// of its signer. The mutual exchange still requires both member proofs.
    /// Lifetime is measured from this call, including handshake time.
    pub fn begin<const R: usize>(
        entropy: &mut impl ConformingEntropy,
        role: Role,
        binding: Binding,
        local: Certificate,
        context: &Context<'_, R>,
        now: Ticks,
        lifetime: NonZeroU64,
    ) -> Result<Self, Refusal> {
        if binding.initiator == binding.responder || context.group != &binding.group {
            return Err(Refusal::Binding);
        }
        if local.subject != binding.local(role)
            || local.group != binding.group
            || !local.verifies::<Ed25519>()
            || !current(&local, context)
        {
            return Err(Refusal::LocalMembership);
        }
        let key = X25519::generate(entropy).map_err(|_| Refusal::Entropy)?;
        let mut draw = zeroize::Zeroizing::new([0; 32]);
        if !entropy.try_fill(&mut draw) {
            return Err(Refusal::Entropy);
        }
        let mut challenge = [0; 16];
        challenge.copy_from_slice(&draw[..16]);
        Ok(Self {
            hello: Hello {
                public: key.public_key(),
                challenge,
            },
            key: Some(key),
            role,
            binding,
            local,
            peer: None,
            clock: Clock {
                issued: now,
                last: now,
                lifetime,
            },
        })
    }

    /// Public handshake bytes only; their existence is not a liveness claim.
    pub fn hello(&self) -> Hello {
        self.hello
    }

    pub fn cancel(&mut self) {
        self.key = None;
    }

    /// Call even without incoming traffic so expiry/revocation releases keys.
    pub fn poll<const R: usize>(
        &mut self,
        context: &Context<'_, R>,
        now: Ticks,
    ) -> Result<(), Refusal> {
        if self.key.is_none() {
            return Err(Refusal::Unavailable);
        }
        if let Err(error) = self.clock.observe(now) {
            self.cancel();
            return Err(error);
        }
        if !current(&self.local, context) {
            self.cancel();
            return Err(Refusal::MembershipLost);
        }
        Ok(())
    }

    pub fn receive_hello<const R: usize>(
        &mut self,
        peer: Hello,
        context: &Context<'_, R>,
        now: Ticks,
    ) -> Result<(), Refusal> {
        self.poll(context, now)?;
        match self.peer {
            Some(held) if held != peer => Err(Refusal::HelloConflict),
            _ => {
                self.peer = Some(peer);
                Ok(())
            }
        }
    }

    /// Exact public statement for the existing member-evidence signer. Sign
    /// it with nonce freshness using `peer_challenge()`, never a counter.
    pub fn statement(&self) -> Result<[u8; STATEMENT_BYTES], Refusal> {
        let peer = self.peer.ok_or(Refusal::PeerHelloMissing)?;
        let (initiator, responder) = match self.role {
            Role::Initiator => (self.hello, peer),
            Role::Responder => (peer, self.hello),
        };
        let mut out = [0; STATEMENT_BYTES];
        out[..DOMAIN.len()].copy_from_slice(DOMAIN);
        let mut at = DOMAIN.len();
        for bytes in [
            &self.binding.group.0[..],
            &self.binding.initiator.0,
            &self.binding.responder.0,
            &self.binding.context,
            &initiator.encode(),
            &responder.encode(),
        ] {
            out[at..at + bytes.len()].copy_from_slice(bytes);
            at += bytes.len();
        }
        Ok(out)
    }

    pub fn peer_challenge(&self) -> Result<[u8; 16], Refusal> {
        self.peer
            .map(|p| p.challenge)
            .ok_or(Refusal::PeerHelloMissing)
    }

    /// Verify the exact peer member/certificate/epoch/revocation/nonce and
    /// complete transcript before consuming the agreement key. The returned
    /// channel authenticates this peer locally; the application exchange must
    /// also deliver our proof and obtain its protected request/confirmation.
    pub fn confirm<const R: usize>(
        &mut self,
        evidence: &MemberEvidence<'_>,
        context: &Context<'_, R>,
        now: Ticks,
    ) -> Result<Session, Refusal> {
        self.poll(context, now)?;
        let peer = self.peer.ok_or(Refusal::PeerHelloMissing)?;
        if evidence.certificate.subject != self.binding.peer(self.role) {
            return Err(Refusal::Member(member_proof::Refusal::UnexpectedMember));
        }
        let statement = self.statement()?;
        member_proof::verify::<Ed25519, R, 0>(
            evidence,
            context,
            &statement,
            Some(&self.hello.challenge),
            &mut HighWaterMarks::new(),
        )
        .map_err(Refusal::Member)?;
        // Consumed before agreement/derivation: no error path can reuse it.
        let secret = self
            .key
            .take()
            .ok_or(Refusal::Unavailable)?
            .agree(&peer.public)
            .map_err(|_| Refusal::Agreement)?;
        let mut binding = [0; 32];
        Sha256::hash(&statement, &mut binding);
        let forward =
            derive_key::<HkdfSha256>(secret.expose(), &binding, Purpose::BulkInitiatorToResponder);
        let reverse =
            derive_key::<HkdfSha256>(secret.expose(), &binding, Purpose::BulkResponderToInitiator);
        let (send, receive) = match self.role {
            Role::Initiator => (forward, reverse),
            Role::Responder => (reverse, forward),
        };
        Ok(Session::new(
            send,
            receive,
            binding,
            self.local,
            evidence.certificate,
            self.clock,
        ))
    }
}

fn current<const R: usize>(certificate: &Certificate, context: &Context<'_, R>) -> bool {
    &certificate.group == context.group
        && standing(
            certificate,
            context.current_epoch,
            context.acceptance_depth,
            context.revoked,
        ) == Standing::Current
}

#[cfg(test)]
mod tests {
    // Keep an inline module boundary for the crate's production-string scanner.
    include!("bulk_session/tests.rs");
}
