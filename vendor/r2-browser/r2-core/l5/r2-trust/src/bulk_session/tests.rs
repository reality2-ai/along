use super::*;
use crate::{
    certificate::{
        AcceptanceDepth, Epoch, RevocationEntry, RevocationReason, RevocationSet,
        VerifiedRevocation,
    },
    crypto::Signer,
    evidence::{self, EvidenceRefusal, Freshness},
    keygen,
};
extern crate std;
use std::{format, vec, vec::Vec};

const FIXTURE: &str = include_str!("../../test-data/bulk-session/independent.hex.txt");

fn bytes(name: &str) -> Vec<u8> {
    let rows: Vec<_> = FIXTURE
        .lines()
        .filter_map(|line| line.split_once('='))
        .filter(|(key, _)| *key == name)
        .collect();
    assert_eq!(rows.len(), 1, "fixture field {name}");
    let value = rows[0].1;
    assert_eq!(value.len() % 2, 0);
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
        .collect()
}
fn array<const N: usize>(name: &str) -> [u8; N] {
    bytes(name).try_into().unwrap()
}
fn certificate(name: &str) -> Certificate {
    Certificate::from_bytes(&bytes(&format!("{name}_certificate"))).unwrap()
}
fn binding() -> Binding {
    Binding {
        group: Identity(array("group")),
        initiator: Identity(array("initiator")),
        responder: Identity(array("responder")),
        context: array("context"),
    }
}
fn context<'a>(group: &'a Identity, revoked: &'a RevocationSet<4>) -> Context<'a, 4> {
    Context {
        group,
        current_epoch: Epoch(4),
        acceptance_depth: AcceptanceDepth(0),
        revoked,
    }
}
struct Entropy(Vec<[u8; 32]>);
impl ConformingEntropy for Entropy {
    fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
        assert!(!self.0.is_empty(), "unexpected entropy draw");
        *out = self.0.remove(0);
        true
    }
}
fn key(name: &str) -> keygen::Keypair {
    keygen::mint(&mut Entropy(vec![array(&format!("{name}_seed"))])).unwrap()
}
fn pending(name: &str, role: Role) -> Pending {
    let bind = binding();
    let revoked = RevocationSet::new();
    Pending::begin(
        &mut Entropy(vec![
            array(&format!("{name}_dh_seed")),
            array(&format!("{name}_nonce_draw")),
        ]),
        role,
        bind,
        certificate(name),
        &context(&bind.group, &revoked),
        Ticks(0),
        NonZeroU64::new(1000).unwrap(),
    )
    .unwrap()
}
fn handshakes() -> (Pending, Pending) {
    let mut a = pending("initiator", Role::Initiator);
    let mut b = pending("responder", Role::Responder);
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    a.receive_hello(b.hello(), &context, Ticks(1)).unwrap();
    b.receive_hello(a.hello(), &context, Ticks(1)).unwrap();
    (a, b)
}
fn proof<'a>(name: &str, statement: &'a [u8], nonce: [u8; 16]) -> MemberEvidence<'a> {
    evidence::sign(
        &key(name),
        certificate(name),
        statement,
        Freshness::Nonce(nonce),
    )
    .unwrap()
}
pub(super) fn pair() -> (Session, Session) {
    let (mut a, mut b) = handshakes();
    let statement = a.statement().unwrap();
    assert_eq!(statement, b.statement().unwrap());
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    let a_proof = proof("initiator", &statement, b.hello().challenge);
    let b_proof = proof("responder", &statement, a.hello().challenge);
    (
        a.confirm(&b_proof, &context, Ticks(2)).unwrap(),
        b.confirm(&a_proof, &context, Ticks(2)).unwrap(),
    )
}

#[test]
fn independent_generator_matches_fixture_without_running_any_rust_crypto() {
    let result = std::process::Command::new("python3")
        .arg(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("test-data/bulk-session/generate.py"),
        )
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        std::string::String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn invalid_local_binding_or_membership_is_refused_before_entropy_is_drawn() {
    let bind = binding();
    let empty = RevocationSet::new();
    let revoked = revoke("initiator");
    for case in 0..7 {
        let mut selected = bind;
        let mut local = certificate("initiator");
        let mut policy = context(&bind.group, &empty);
        let expected = match case {
            0 => {
                selected.responder = selected.initiator;
                Refusal::Binding
            }
            1 => {
                selected.group = selected.initiator;
                Refusal::Binding
            }
            2 => {
                local = certificate("responder");
                Refusal::LocalMembership
            }
            3 => {
                local.signature[0] ^= 1;
                Refusal::LocalMembership
            }
            4 => {
                policy.current_epoch = Epoch(5);
                Refusal::LocalMembership
            }
            5 => {
                policy.revoked = &revoked;
                Refusal::LocalMembership
            }
            _ => {
                local.group = bind.responder;
                Refusal::LocalMembership
            }
        };
        // This source panics if admission asks it for even one draw.
        assert_eq!(
            Pending::begin(
                &mut Entropy(vec![]),
                Role::Initiator,
                selected,
                local,
                &policy,
                Ticks(0),
                NonZeroU64::new(1000).unwrap()
            )
            .unwrap_err(),
            expected
        );
    }
}

#[test]
fn pending_handshake_rechecks_peer_membership_and_local_cancellation() {
    let group = binding().group;
    let (mut a, _) = handshakes();
    let statement = a.statement().unwrap();
    let p = proof("responder", &statement, a.hello().challenge);
    let revoked = revoke("responder");
    assert!(a.confirm(&p, &context(&group, &revoked), Ticks(2)).is_err());
    a.cancel();
    assert_eq!(
        a.confirm(&p, &context(&group, &revoked), Ticks(3))
            .unwrap_err(),
        Refusal::Unavailable
    );
    let (mut a, _) = handshakes();
    let revoked = revoke("initiator");
    assert_eq!(
        a.poll(&context(&group, &revoked), Ticks(2)),
        Err(Refusal::MembershipLost)
    );
    assert_eq!(
        a.poll(&context(&group, &RevocationSet::new()), Ticks(3)),
        Err(Refusal::Unavailable)
    );
}

#[test]
fn transcript_proofs_and_both_traffic_directions_match_independent_bytes() {
    let (a, b) = handshakes();
    let statement = a.statement().unwrap();
    assert_eq!(statement.as_slice(), bytes("statement"));
    assert_eq!(statement, b.statement().unwrap());
    assert_eq!(a.hello().encode().as_slice(), bytes("initiator_hello"));
    assert_eq!(b.hello().encode().as_slice(), bytes("responder_hello"));
    assert_eq!(
        proof("initiator", &statement, b.hello().challenge).signature,
        array::<64>("initiator_proof")
    );
    assert_eq!(
        proof("responder", &statement, a.hello().challenge).signature,
        array::<64>("responder_proof")
    );
    let (mut a, mut b) = pair();
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    assert_eq!(a.id().as_slice(), &bytes("transcript_digest")[..16]);
    for counter in 0..2 {
        let mut packet = [0; 256];
        let mut clear = [0; 192];
        let n = a
            .seal(
                &context,
                Ticks(3),
                &bytes("aad"),
                &bytes("plaintext"),
                &mut packet,
            )
            .unwrap();
        assert_eq!(&packet[..n], bytes(&format!("forward_packet_{counter}")));
        assert_eq!(
            b.open(&context, Ticks(3), &bytes("aad"), &packet[..n], &mut clear),
            Ok(192)
        );
        assert_eq!(clear.as_slice(), bytes("plaintext"));
        let n = b
            .seal(
                &context,
                Ticks(3),
                &bytes("aad"),
                &bytes("plaintext"),
                &mut packet,
            )
            .unwrap();
        assert_eq!(&packet[..n], bytes(&format!("reverse_packet_{counter}")));
        assert_eq!(
            a.open(&context, Ticks(3), &bytes("aad"), &packet[..n], &mut clear),
            Ok(192)
        );
    }
    assert_eq!(format!("{a:?}"), "BulkSession(redacted)");
    assert_eq!(
        format!("{:?}", pending("initiator", Role::Initiator)),
        "PendingBulkSession(redacted)"
    );
    assert!(core::mem::needs_drop::<Pending>());
    assert!(core::mem::needs_drop::<Session>());
}

#[test]
fn incomplete_or_conflicting_hello_never_creates_a_session() {
    let mut a = pending("initiator", Role::Initiator);
    let b = pending("responder", Role::Responder);
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    assert_eq!(a.statement(), Err(Refusal::PeerHelloMissing));
    let statement = bytes("statement");
    let p = proof("responder", &statement, a.hello().challenge);
    assert_eq!(
        a.confirm(&p, &context, Ticks(1)).unwrap_err(),
        Refusal::PeerHelloMissing
    );
    a.receive_hello(b.hello(), &context, Ticks(1)).unwrap();
    a.receive_hello(b.hello(), &context, Ticks(1)).unwrap();
    let mut changed = b.hello();
    changed.public[0] ^= 1;
    assert_eq!(
        a.receive_hello(changed, &context, Ticks(1)),
        Err(Refusal::HelloConflict)
    );
    assert_eq!(a.statement().unwrap().as_slice(), statement);
    assert!(a.confirm(&p, &context, Ticks(2)).is_ok());
    assert_eq!(
        a.confirm(&p, &context, Ticks(2)).unwrap_err(),
        Refusal::Unavailable
    );
    let encoded = b.hello().encode();
    for n in 0..48 {
        assert!(Hello::decode(&encoded[..n]).is_none());
    }
    assert!(Hello::decode(&[0; 49]).is_none());
    assert_eq!(Hello::decode(&encoded), Some(b.hello()));
}

#[test]
fn peer_identity_certificate_signature_nonce_and_every_transcript_field_are_bound() {
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    for case in 0..5 {
        let (mut a, _) = handshakes();
        let statement = a.statement().unwrap();
        let good = proof("responder", &statement, a.hello().challenge);
        let mut bad = good;
        let expected = match case {
            0 => {
                bad.certificate = certificate("initiator");
                member_proof::Refusal::UnexpectedMember
            }
            1 => {
                bad.certificate.signature[0] ^= 1;
                member_proof::Refusal::Evidence(EvidenceRefusal::CertificateNotAuthentic)
            }
            2 => {
                bad.signature[0] ^= 1;
                member_proof::Refusal::Evidence(EvidenceRefusal::SignatureInvalid)
            }
            3 => {
                bad.freshness = Freshness::Nonce([0; 16]);
                member_proof::Refusal::Evidence(EvidenceRefusal::NonceMismatch)
            }
            _ => {
                bad.freshness = Freshness::Counter {
                    epoch: Epoch(4),
                    sequence: 1,
                };
                member_proof::Refusal::Evidence(EvidenceRefusal::NonceMismatch)
            }
        };
        assert_eq!(
            a.confirm(&bad, &context, Ticks(2)).unwrap_err(),
            Refusal::Member(expected)
        );
        assert!(a.confirm(&good, &context, Ticks(3)).is_ok());
    }
    // Domain, each identity, context and both halves of both hellos.
    for at in [0, 19, 51, 83, 115, 147, 179, 195, 227, 242] {
        let (mut a, _) = handshakes();
        let mut changed = a.statement().unwrap();
        changed[at] ^= 1;
        let p = proof("responder", &changed, a.hello().challenge);
        assert_eq!(
            a.confirm(&p, &context, Ticks(2)).unwrap_err(),
            Refusal::Member(member_proof::Refusal::StatementMismatch)
        );
    }
}

#[test]
fn failed_entropy_noncontributory_peer_and_retired_handshake_leave_no_usable_session() {
    struct Failed {
        after: usize,
    }
    impl ConformingEntropy for Failed {
        fn try_fill(&mut self, out: &mut [u8; 32]) -> bool {
            out[..8].fill(0x72);
            if self.after == 0 {
                false
            } else {
                self.after -= 1;
                out.fill(0x31);
                true
            }
        }
    }
    let bind = binding();
    let revoked = RevocationSet::new();
    let context = context(&bind.group, &revoked);
    for after in [0, 1] {
        assert_eq!(
            Pending::begin(
                &mut Failed { after },
                Role::Initiator,
                bind,
                certificate("initiator"),
                &context,
                Ticks(0),
                NonZeroU64::new(1000).unwrap()
            )
            .unwrap_err(),
            Refusal::Entropy
        );
    }
    let mut a = pending("initiator", Role::Initiator);
    a.receive_hello(
        Hello {
            public: [0; 32],
            challenge: [7; 16],
        },
        &context,
        Ticks(1),
    )
    .unwrap();
    let statement = a.statement().unwrap();
    let p = proof("responder", &statement, a.hello().challenge);
    assert_eq!(
        a.confirm(&p, &context, Ticks(2)).unwrap_err(),
        Refusal::Agreement
    );
    assert_eq!(
        a.confirm(&p, &context, Ticks(3)).unwrap_err(),
        Refusal::Unavailable
    );
    for (tick, expected) in [(1000, Refusal::Expired), (0, Refusal::ClockReversed)] {
        let (mut a, _) = handshakes();
        assert_eq!(a.poll(&context, Ticks(tick)), Err(expected));
        assert_eq!(a.poll(&context, Ticks(2)), Err(Refusal::Unavailable));
    }
}

#[test]
fn changed_packet_header_nonce_body_tag_or_direction_cannot_poison_replay_state() {
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    let (mut a, mut b) = pair();
    let packet = bytes("forward_packet_0");
    for at in 0..packet.len() {
        let mut bad = packet.clone();
        bad[at] ^= 1;
        let mut out = [0xaa; 192];
        assert!(
            b.open(&context, Ticks(3), &bytes("aad"), &bad, &mut out)
                .is_err(),
            "byte {at}"
        );
        assert_eq!(out, [0; 192]);
    }
    let mut out = [0xaa; 192];
    assert_eq!(
        b.open(
            &context,
            Ticks(3),
            b"different operation",
            &packet,
            &mut out
        ),
        Err(Refusal::Cipher)
    );
    assert_eq!(
        a.open(&context, Ticks(3), &bytes("aad"), &packet, &mut out),
        Err(Refusal::Cipher)
    );
    assert_eq!(
        b.open(&context, Ticks(3), &bytes("aad"), &packet, &mut out),
        Ok(192)
    );
    assert_eq!(
        b.open(&context, Ticks(3), &bytes("aad"), &packet, &mut out),
        Err(Refusal::Replay)
    );
    assert_eq!(out, [0; 192]);
}

#[test]
fn reordering_loss_and_short_buffers_do_not_invent_delivery_or_reuse_counters() {
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    let (mut a, mut b) = pair();
    let mut small = [0xaa; 39];
    assert_eq!(
        a.seal(&context, Ticks(3), b"op", b"", &mut small),
        Err(Refusal::OutputTooSmall)
    );
    assert_eq!(small, [0; 39]);
    let mut packets = Vec::new();
    for counter in 0u64..70 {
        let mut packet = [0; 64];
        let n = a
            .seal(
                &context,
                Ticks(3),
                b"op",
                &counter.to_be_bytes(),
                &mut packet,
            )
            .unwrap();
        assert_eq!(&packet[16..24], &counter.to_be_bytes());
        packets.push(packet[..n].to_vec());
    }
    let mut out = [0; 8];
    // Loss of older traffic does not prevent a fresh authenticated packet.
    b.open(&context, Ticks(3), b"op", &packets[69], &mut out)
        .unwrap();
    b.open(&context, Ticks(3), b"op", &packets[6], &mut out)
        .unwrap();
    assert_eq!(
        b.open(&context, Ticks(3), b"op", &packets[5], &mut out),
        Err(Refusal::Replay)
    );
    assert_eq!(
        b.open(&context, Ticks(3), b"op", &packets[6], &mut out),
        Err(Refusal::Replay)
    );
    assert_eq!(
        b.open(&context, Ticks(3), b"op", &packets[68], &mut [0; 7]),
        Err(Refusal::OutputTooSmall)
    );
    b.open(&context, Ticks(3), b"op", &packets[68], &mut out)
        .unwrap();
    for n in 0..40 {
        let mut out = [0xaa; 8];
        assert_eq!(
            b.open(&context, Ticks(3), b"op", &packets[67][..n], &mut out),
            Err(Refusal::Cipher)
        );
        assert_eq!(out, [0; 8]);
    }
}

fn revoke(name: &str) -> RevocationSet<4> {
    let mut entry = RevocationEntry {
        subject: Identity(array(name)),
        at_epoch: Epoch(4),
        sequence: 1,
        reason: RevocationReason::Compromise,
        signature: [0; 64],
        advisory_time: None,
    };
    let mut message = [0; crate::certificate::REVOCATION_SIGNED_LEN];
    let n = entry.write_signed_bytes(&mut message);
    entry.signature = key("group").sign(&message[..n]);
    let mut revoked = RevocationSet::new();
    revoked
        .append(VerifiedRevocation::verify::<Ed25519>(entry, &binding().group).unwrap())
        .unwrap();
    revoked
}

#[test]
fn cancellation_expiry_clock_reversal_and_either_member_revocation_retire_traffic_keys() {
    let group = binding().group;
    for (name, tick, expected) in [
        ("none", 1000, Refusal::Expired),
        ("none", 1, Refusal::ClockReversed),
        ("initiator", 3, Refusal::MembershipLost),
        ("responder", 3, Refusal::MembershipLost),
    ] {
        let (mut a, _) = pair();
        let revoked = if name == "none" {
            RevocationSet::new()
        } else {
            revoke(name)
        };
        let context = context(&group, &revoked);
        assert_eq!(a.poll(&context, Ticks(tick)), Err(expected));
        assert_eq!(
            a.seal(&context, Ticks(4), b"op", b"data", &mut [0; 64]),
            Err(Refusal::Unavailable)
        );
    }
    let (mut a, _) = pair();
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    a.cancel();
    assert_eq!(
        a.open(
            &context,
            Ticks(3),
            &bytes("aad"),
            &bytes("reverse_packet_0"),
            &mut [0; 192]
        ),
        Err(Refusal::Unavailable)
    );
    let (mut a, _) = pair();
    let stale = Context {
        current_epoch: Epoch(5),
        ..context
    };
    assert_eq!(a.poll(&stale, Ticks(3)), Err(Refusal::MembershipLost));
}

#[test]
fn new_handshake_nonce_changes_keys_and_old_session_bytes_are_refused() {
    let group = binding().group;
    let revoked = RevocationSet::new();
    let context = context(&group, &revoked);
    let mut a = Pending::begin(
        &mut Entropy(vec![array("initiator_dh_seed"), [9; 32]]),
        Role::Initiator,
        binding(),
        certificate("initiator"),
        &context,
        Ticks(0),
        NonZeroU64::new(1000).unwrap(),
    )
    .unwrap();
    let mut b = pending("responder", Role::Responder);
    a.receive_hello(b.hello(), &context, Ticks(1)).unwrap();
    b.receive_hello(a.hello(), &context, Ticks(1)).unwrap();
    let statement = a.statement().unwrap();
    let p = proof("responder", &statement, a.hello().challenge);
    let mut channel = a.confirm(&p, &context, Ticks(2)).unwrap();
    assert_ne!(channel.id().as_slice(), &bytes("transcript_digest")[..16]);
    assert_eq!(
        channel.open(
            &context,
            Ticks(3),
            &bytes("aad"),
            &bytes("reverse_packet_0"),
            &mut [0; 192]
        ),
        Err(Refusal::WrongSession)
    );
}
