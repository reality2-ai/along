//! Browser platform facilities: `r2-hal-traits` implemented against what a web
//! page provides. Same trait set as esp-hal and std implement — the point of
//! the exercise.

use r2_hal_traits::rng::Rng;
use r2_hal_traits::storage::{Storage, StorageFault};
use r2_hal_traits::time::{Ruler, Ticks};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// The Web Crypto per-call limit for `getRandomValues` is 65,536 bytes.
///
/// Keep this platform limit in the adapter: callers use the L0 `Rng` contract
/// and must be able to fill a buffer larger than a browser permits in one
/// Web Crypto invocation.
const WEB_CRYPTO_MAX_RANDOM_BYTES: usize = 65_536;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;

    #[wasm_bindgen(js_namespace = ["globalThis", "crypto"], js_name = getRandomValues)]
    fn get_random_values(buf: &mut [u8]);
}

/// Monotonic ruler over `performance.now()` (L0 5.2). `performance.now()` is
/// monotonic within a page session and is explicitly *not* wall-clock, which
/// is what 5.2.3 asks for. It is also not comparable with another platform's
/// ruler or across a reload — the same epoch rule the ESP32 ruler has.
pub struct PerformanceRuler {
    epoch_ms: f64,
}

impl Default for PerformanceRuler {
    fn default() -> Self {
        Self::new()
    }
}

impl PerformanceRuler {
    pub fn new() -> Self {
        Self {
            epoch_ms: performance_now(),
        }
    }
}

impl Ruler for PerformanceRuler {
    fn now(&self) -> Ticks {
        let elapsed = (performance_now() - self.epoch_ms).max(0.0);
        Ticks(elapsed as u64)
    }

    fn ticks_per_second(&self) -> u32 {
        1_000
    }
}

/// CSPRNG from the Web Crypto API (L0 5.5.1).
///
/// `crypto.getRandomValues` is the browser's cryptographic source, so
/// implementing the trait is a legitimate declaration here — a
/// `Math.random()`-backed generator would not be, and L0 5.5.2 forbids such a
/// platform from implementing this trait at all. Web Crypto refuses a single
/// request over [`WEB_CRYPTO_MAX_RANDOM_BYTES`], so this adapter chunks a large
/// L0 request while still filling the caller's complete buffer.
#[derive(Default)]
pub struct BrowserRng;

impl Rng for BrowserRng {
    fn fill(&mut self, buf: &mut [u8]) {
        fill_web_crypto_chunks(buf, get_random_values);
    }
}

/// Invoke a Web Crypto-like filler within its per-call bound.
///
/// Keeping this separate from the wasm import makes the L0 contract testable
/// on the host without pretending that host tests exercise browser entropy.
fn fill_web_crypto_chunks(buf: &mut [u8], mut fill_chunk: impl FnMut(&mut [u8])) {
    for chunk in buf.chunks_mut(WEB_CRYPTO_MAX_RANDOM_BYTES) {
        fill_chunk(chunk);
    }
}

#[cfg(test)]
mod tests {
    use super::{fill_web_crypto_chunks, WEB_CRYPTO_MAX_RANDOM_BYTES};

    #[test]
    fn a_large_rng_request_is_split_without_gaps() {
        let mut bytes = vec![0; WEB_CRYPTO_MAX_RANDOM_BYTES + 1];
        let mut calls = Vec::new();

        fill_web_crypto_chunks(&mut bytes, |chunk| {
            let marker = (calls.len() + 1) as u8;
            calls.push(chunk.len());
            chunk.fill(marker);
        });

        assert_eq!(calls, [WEB_CRYPTO_MAX_RANDOM_BYTES, 1]);
        assert!(bytes[..WEB_CRYPTO_MAX_RANDOM_BYTES]
            .iter()
            .all(|&byte| byte == 1));
        assert_eq!(bytes[WEB_CRYPTO_MAX_RANDOM_BYTES], 2);
    }
}

/// In-memory storage. **This does not satisfy L0 5.3**, which requires
/// retention across power loss: a page reload loses everything here. A
/// browser hive that needs real persistence must back this with IndexedDB,
/// and until it does, this platform cannot honestly declare 5.3 — which is
/// why persona and key material must not be stored in it.
#[derive(Default)]
pub struct MemoryStorage {
    map: HashMap<Vec<u8>, Vec<u8>>,
}

#[derive(Debug)]
pub struct Never;

impl Storage for MemoryStorage {
    type Error = Never;

    fn read(&self, key: &[u8], buf: &mut [u8]) -> Result<Option<usize>, Self::Error> {
        Ok(self.map.get(key).map(|v| {
            let n = v.len().min(buf.len());
            buf[..n].copy_from_slice(&v[..n]);
            v.len()
        }))
    }

    fn write(&mut self, key: &[u8], value: &[u8]) -> Result<(), Self::Error> {
        self.map.insert(key.to_vec(), value.to_vec());
        Ok(())
    }

    fn remove(&mut self, key: &[u8]) -> Result<(), Self::Error> {
        self.map.remove(key);
        Ok(())
    }
    /// An in-memory map with no bound has no *full* state to report
    /// (`SS507`). Saying `Fault` for the errors it can produce is the honest
    /// answer, and it means an eviction is never triggered by one.
    fn classify(&self, _error: &Self::Error) -> StorageFault {
        StorageFault::Fault
    }
}
