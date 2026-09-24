//! Browser hive: the Reality2 stack on `wasm32-unknown-unknown`.
//!
//! Third platform on the same core crates, and the one that shares nothing
//! with the first two: no radios, no flash, no interrupts, a single-threaded
//! event loop, and time handed down by the host. Everything platform-specific
//! is in this crate — the core crates needed no cfg, no feature, and no change
//! to build here.
//!
//! # ‼ THIS CRATE CANNOT BE BUILT FROM THIS WORKSPACE. DO NOT DEBUG IT.
//!
//! `r2-hive/rust-toolchain.toml` pins `channel = "esp"` — the esp-rs xtensa
//! fork — and **`rustup target list` there offers exactly one target,
//! `x86_64-unknown-linux-gnu`.** `wasm32` is **not available to add**, not
//! merely uninstalled. A bare `wasm-pack build` here fails and **reads exactly
//! like a broken crate. It is not one.**
//!
//! ‼ **AND THE MECHANISM IS NARROWER THAN "A MISSING TARGET" — CORRECTED
//! 2026-08-11.** `wasm-pack` runs **`rustup target add` before building and
//! aborts there**; no compiler is ever invoked. *So that failure is even less
//! evidence about what this toolchain can compile than an installed count — the
//! count is at least a fact about a toolchain, this is a fact about `wasm-pack`
//! preflight.*
//!
//! **What actually fails is addressing the toolchain BY NAME**, because `esp`
//! is a directory-override *linked* toolchain — and `wasm-pack` addresses it by
//! name. Measured here, `rc` checked before any count was believed:
//! `rustup component list --toolchain esp` exits **1** with *invalid toolchain
//! name*, while `rustup component list` with **no flag**, under the override,
//! exits **0** and lists six components. **Components are listable; naming the
//! toolchain is what breaks.**
//!
//! ‼ **AND `rust-src` IS PRESENT**, the prerequisite for `-Zbuild-std`. **So
//! whether this toolchain can build `wasm32` under `build-std` is LIVE AND
//! UNMEASURED, and nobody may assert it either way.** *Nobody is commissioned
//! to answer it; the route below is unchanged, cheaper and green regardless.*
//!
//! ‼ **AND THAT IS A STRONGER CLAIM THAN AN INSTALLED COUNT, DELIBERATELY.**
//! An earlier version of this note said the toolchain *has no wasm32 target*,
//! inferred from `--installed` counting zero. **An installed-target zero is not
//! evidence that a target cannot be built**: under `-Zbuild-std` the target
//! standard library is compiled from source rather than downloaded.
//!
//! *Measured in this very tree:* `rustup target list --installed` prints
//! **only** `x86_64-unknown-linux-gnu` — **`xtensa-esp32s3-none-elf` is absent
//! from it — and the DFR1195 image compiles for that target anyway**, because
//! `crates/hive-esp32-dfr1195/.cargo/config.toml` sets
//! `build-std = ["core", "alloc"]`. **The list is an inventory of what was
//! downloaded, not a statement of what can be produced.**
//!
//! ‼ **AND A TOOLCHAIN QUERY MEASURES THE DIRECTORY YOU RUN IT IN, NOT THE
//! MACHINE** — zero wasm32 in `r2-hive` and `r2-core`, one in `r2-composer`,
//! which pins nothing. **Name the tree, and say whether the claim is about
//! installed targets or about a build that succeeded. Only a build answers the
//! build question.**
//!
//! **Build it from a directory that does not pin `esp`**, and direct
//! `CARGO_TARGET_DIR` and `--out-dir` out of this shared tree so the build
//! never invalidates a peer's cache or writes into a peer's directory.
//!
//! **This crate is EXCLUDED FROM THIS LANE'S GATE BY NAME, AND COMPOSER BUILDS
//! IT** — its gate compiles this crate for `wasm32-unknown-unknown` in a tree
//! that pins nothing. *A bare exclusion is how a board went unbuildable for
//! days: it records that nobody builds it and reads as a decision rather than a
//! gap.* **An exclusion with an owner is coverage; one without is a hole with a
//! note on it.**

mod browser_candidate;
mod browser_ceremony;
mod browser_initial_persona;
mod browser_membership;
mod hal;
mod loopback;

pub use browser_candidate::BrowserCandidateKey;
pub use browser_ceremony::{BrowserCandidateCeremony, BrowserPreparedPersona};
pub use browser_initial_persona::BrowserInitialPersona;
pub use browser_membership::{
    tg_ceremony_verification_string, tg_certificate_authentic, tg_certificate_encode,
    tg_certificate_signing_bytes, tg_invitation_statement, tg_nonce_signing_bytes,
    tg_revocation_signing_bytes, BrowserMembership,
};

use r2_hal_traits::rng::Rng;
use r2_hal_traits::storage::Storage;
use r2_hal_traits::time::Ruler;
use r2_mesh::l1::{Bearer, SendTarget};
use r2_wire::frame::{Frame, FrameSpec, FrameType, Target, Tier};
use r2_wire::name;
use wasm_bindgen::prelude::*;

pub use hal::{BrowserRng, MemoryStorage, PerformanceRuler};
pub use loopback::LoopbackBearer;

/// Bind a portal request and verifier nonce using the same Rust representation
/// as the host verifier. The browser's platform key signs these returned bytes.
#[wasm_bindgen]
pub fn portal_request_message(
    origin: &str,
    method: &str,
    path: &str,
    body: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let nonce = nonce
        .try_into()
        .map_err(|_| JsValue::from_str("Invalid challenge"))?;
    let statement = hive_web_identity::statement(origin, method, path, body)
        .map_err(|_| JsValue::from_str("Invalid request"))?;
    Ok(hive_web_identity::signing_message(&statement, nonce).to_vec())
}

/// Parse one complete L1 arrival at the tier its bearer declares.
///
/// [`Frame::parse_on_bearer`] owns the exceptional compact interpretation of
/// `GROUP_MGMT` on an otherwise extended bearer (L4 9.1.2). Calling
/// [`Frame::parse`] with the profile tier here would bypass that rule at this
/// image boundary.
fn parse_arrival(bytes: &[u8], bearer_tier: Tier) -> Result<Frame<'_>, r2_wire::frame::ParseError> {
    Frame::parse_on_bearer(bytes, bearer_tier)
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

/// Bring the hive up and report what the platform provides. Returns the log as
/// a string so a caller can render it without touching the console.
#[wasm_bindgen]
pub fn boot() -> String {
    let mut out = String::new();
    let mut say = |line: String| {
        log(&line);
        out.push_str(&line);
        out.push('\n');
    };

    say("hive-wasm: browser hive starting".into());

    let ruler = PerformanceRuler::new();
    let mut rng = BrowserRng;
    let mut store = MemoryStorage::default();

    let t0 = ruler.now();
    // ‼ NOT KEY MATERIAL, AND THE OLD NAME SAID OTHERWISE. This was
    //   `boot-seed`, written and read back purely to prove the store works.
    //   Eight random bytes under a name that reads as a derivation seed cost a
    //   measurement on 2026-09-04 when a sweep for durable key material had to
    //   stop and rule it out. **Nothing in this repository persists a derived
    //   key**, and a probe should not be the reason somebody doubts that.
    let mut probe = [0u8; 8];
    rng.fill(&mut probe);
    store.write(b"storage-round-trip", &probe).expect("write");
    let mut back = [0u8; 8];
    let len = store.read(b"storage-round-trip", &mut back).expect("read");
    say(format!(
        "hive-wasm: ruler {} ticks/s, rng ok, storage round-trip {} bytes",
        ruler.ticks_per_second(),
        len.unwrap_or(0)
    ));

    // No network bearer yet: a loopback proves L1-L4 without one.
    let mut bearer = LoopbackBearer::new();
    say(format!(
        "hive-wasm: bearer up — {} (loopback), tier={:?} max_payload={}",
        bearer.profile().ordinal.label(),
        bearer.profile().wire_tier,
        bearer.max_payload()
    ));

    let origin = *b"WASM0000";
    let spec = FrameSpec {
        frame_type: FrameType::Event,
        // L0 4.2.3, derived rather than spelled: this hive relays (4.2.1).
        constrained_origin: r2_mesh::l3::OriginStance::relaying().marks_frames(),
        hop_limit: 3,
        budget: 1,
        msg_id: 1,
        event_hash: name::event_hash("hive wasm hello").expect("valid name"),
        target: Target::Extended { group: 0, hive: 0 },
        route: Some(&origin),
        payload: b"browser hive",
        // Deliberately unauthenticated (L5 10.1.1's unauthenticated level):
        // bring-up traffic, sent before any trust group exists.
        tag: None,
    };
    let mut buf = [0u8; 256];
    let len = spec.encode(&mut buf).expect("encode");

    match bearer.send(SendTarget::Broadcast, &buf[..len]) {
        Ok(()) => say(format!("hive-wasm: {len} bytes accepted for transmit")),
        Err(e) => say(format!("hive-wasm: send refused: {e:?}")),
    }

    let mut rx = [0u8; 1024];
    match bearer.poll_recv(&mut rx) {
        Some(Ok((n, meta))) => {
            let parsed = parse_arrival(&rx[..n], bearer.profile().wire_tier);
            say(format!(
                "hive-wasm: looped back {n} bytes from {:?}, parses={}, payload={:?}",
                meta.sender,
                parsed.is_ok(),
                parsed
                    .ok()
                    .and_then(|f| core::str::from_utf8(f.payload()).ok())
            ));
        }
        Some(Err(error)) => say(format!("hive-wasm: receive refused: {error:?}")),
        None => say("hive-wasm: nothing looped back".into()),
    }

    say(format!(
        "hive-wasm: run complete — {} ticks elapsed",
        ruler.now().since(t0).unwrap_or(0)
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_group_management_frame_on_the_extended_loopback_uses_compact_parsing() {
        let spec = FrameSpec {
            frame_type: FrameType::GroupMgmt,
            constrained_origin: false,
            hop_limit: 1,
            budget: 0,
            msg_id: 1,
            event_hash: 0,
            target: Target::Compact(0),
            route: None,
            payload: b"group-management",
            tag: None,
        };
        let mut encoded = [0u8; 64];
        let length = spec
            .encode(&mut encoded)
            .expect("compact GROUP_MGMT encodes");
        let mut bearer = LoopbackBearer::new();
        bearer
            .send(SendTarget::Broadcast, &encoded[..length])
            .expect("loopback accepts the complete frame");
        let mut received = [0u8; 64];
        let (length, _) = bearer
            .poll_recv(&mut received)
            .expect("queued operation")
            .expect("complete frame");

        let frame = parse_arrival(&received[..length], bearer.profile().wire_tier)
            .expect("L4 9.1.2 compact override");
        assert_eq!(frame.frame_type(), FrameType::GroupMgmt);
        assert_eq!(frame.tier(), Tier::Compact);
    }
}
