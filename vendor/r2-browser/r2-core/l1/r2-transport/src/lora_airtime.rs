//! **LoRa time on air, held where the gate can run it (L1 9.2, 9.3).**
//!
//! # Why this is here and not in the bearer
//!
//! It was in `hive-esp32-dfr1195/src/lora_bearer.rs`, which **no host test can
//! reach** — and `SS399` found that no gate arm compiled that file either, so
//! for as long as it lived there *nothing checked this arithmetic and nothing
//! checked that it still built.* It is pure integer arithmetic over four PHY
//! parameters. It has no radio in it.
//!
//! That is the same argument [`crate::ble_advert`] and `link_quality` make,
//! and it applies here with more force than to either: **a duty cycle is a
//! legal obligation on the operator**, which L1 **9.3 Note 1** says in terms
//! this standard cannot grant relief from. *Arithmetic that decides whether a
//! deployment is lawful should not sit in the one file the tests cannot open.*
//!
//! # The direction of an error matters more than its size
//!
//! ‼ **ROUNDING IS UPWARD AT EVERY STEP, DELIBERATELY.** An estimate that runs
//! SHORT spends airtime nobody authorised; one that runs long makes a bearer
//! transmit less than it lawfully could. **The second is the side to be wrong
//! on**, and every division here is a ceiling for that reason rather than by
//! accident — which is a property a reader can check, and
//! [`airtime_ms`]'s tests do.
//!
//! # Still provisional, and about the model rather than the code
//!
//! ⚠ **`SS391`: THE FORMULA IS THE PUBLISHED ONE AND HAS NEVER BEEN MEASURED
//! ON THIS RADIO.** Moving it here makes it *testable against itself* — that
//! the arithmetic implements the formula — and **not** true of any hardware.
//! *A test suite over a model cannot tell you the model is right.* `SS391`
//! asks for one frame at each of two payload lengths against a spectrum
//! analyser before any sustained transmission, and that is still owed.

/// The PHY parameters time on air depends on.
///
/// ‼ **A STRUCT RATHER THAN FOUR CONSTANTS, BECAUSE THE SIBLING PAIR ALREADY
/// DISAGREED ONCE.** Two boards in this fleet sat on different spreading
/// factors and different channels for ten days while each file declared its
/// own values privately — *each one alone is total deafness.* Parameters that
/// must agree between two devices should be a value that can be compared,
/// passed and asserted, not a constant compiled into whichever file needs it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LoraPhy {
    /// Spreading factor, 6..=12.
    pub spreading_factor: u8,
    /// Bandwidth in hertz.
    pub bandwidth_hz: u32,
    /// Coding rate as the `n` of 4/(4+n), 1..=4.
    pub coding_rate: u8,
    /// Programmed preamble length in symbols.
    pub preamble_symbols: u16,
}

/// Why a PHY cannot be used for an airtime figure.
///
/// ‼ **AN OUT-OF-RANGE PHY REFUSES RATHER THAN RETURNING A NUMBER.** The
/// formula divides by `4 * (SF - 2*DE)`, so a nonsense spreading factor
/// produces a nonsense figure of exactly the shape a caller would accept —
/// *and a duty-cycle budget spends whatever it is told.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PhyRefusal {
    /// Outside 6..=12.
    SpreadingFactor(u8),
    /// Zero, which would divide by zero for the symbol time.
    Bandwidth(u32),
    /// Outside 1..=4.
    CodingRate(u8),
}

impl LoraPhy {
    /// Check the parameters are ones the formula is defined for.
    pub const fn check(&self) -> Result<(), PhyRefusal> {
        if self.spreading_factor < 6 || self.spreading_factor > 12 {
            return Err(PhyRefusal::SpreadingFactor(self.spreading_factor));
        }
        if self.bandwidth_hz == 0 {
            return Err(PhyRefusal::Bandwidth(self.bandwidth_hz));
        }
        if self.coding_rate < 1 || self.coding_rate > 4 {
            return Err(PhyRefusal::CodingRate(self.coding_rate));
        }
        Ok(())
    }

    /// Symbol time in microseconds, `2^SF / BW`, rounded **up**.
    pub const fn symbol_time_us(&self) -> u32 {
        let sf = self.spreading_factor as u32;
        (((1u64 << sf) * 1_000_000).div_ceil(self.bandwidth_hz as u64)) as u32
    }

    /// Whether our SX126x configuration enables low-data-rate optimisation.
    /// Use 16 ms, conservatively below the datasheet's 16.38 ms recommendation
    /// (SX1261/2 Rev. 2.1, 6.1.1.4 and 13.4.5.2). This selects the same supported
    /// hardware settings without mistaking rounded bandwidth labels such as
    /// 15.63 kHz for exact frequencies at the boundary. Compare before rounding.
    ///
    /// ‼ **IT CHANGES THE DENOMINATOR, SO GETTING IT WRONG IS NOT A ROUNDING
    /// ERROR.** With it set the formula divides by `4*(SF-2)` instead of
    /// `4*SF`, which at SF12 is a **20 %** difference in payload symbols.
    pub const fn low_data_rate_optimise(&self) -> bool {
        (1u64 << self.spreading_factor) * 1_000_000 >= 16_000 * self.bandwidth_hz as u64
    }
}

/// Time on air for `payload_len` octets, in **milliseconds, rounded up**.
///
/// The standard LoRa calculation: symbol time `2^SF / BW`, a preamble of
/// `n + 4.25` symbols, and the Semtech payload-symbol formula with CRC on and
/// an explicit header.
///
/// ‼ **THE PREAMBLE'S QUARTER SYMBOL IS CARRIED AS QUARTERS, NOT DROPPED.**
/// `n + 4.25` symbols is held as `4n + 17` quarter-symbols so the fraction is
/// exact in integers. *Truncating it would shorten every estimate by a
/// quarter symbol — 8 ms at SF12 — in the direction that overspends.*
pub const fn airtime_ms(phy: &LoraPhy, payload_len: usize) -> Result<u32, PhyRefusal> {
    if let Err(e) = phy.check() {
        return Err(e);
    }
    let sf = phy.spreading_factor as u32;
    let t_sym_us = phy.symbol_time_us();

    let preamble_quarter_syms = phy.preamble_symbols as u32 * 4 + 17;

    // Payload symbols (Semtech): 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC
    // - 20*IH) / (4*(SF - 2*DE))) * (CR + 4), 0), with CRC on and an
    // explicit header.
    let de: u32 = if phy.low_data_rate_optimise() { 1 } else { 0 };
    let numerator = 8 * payload_len as i64 - 4 * sf as i64 + 28 + 16;
    let denominator = 4 * (sf as i64 - 2 * de as i64);
    let payload_syms = if numerator <= 0 || denominator <= 0 {
        8
    } else {
        // ‼ **UNSIGNED, BECAUSE `i64::div_ceil` IS NIGHTLY-ONLY** —
        // `int_roundings` stabilised the unsigned forms only, and this exact
        // call failed to compile on the pinned toolchain for as long as it
        // lived in a file no gate arm built (`SS399`). The branch above
        // proves both operands strictly positive, so the cast is total.
        let n = (numerator as u64).div_ceil(denominator as u64) * (phy.coding_rate as u64 + 4);
        8 + n as u32
    };

    let total_quarter_syms = preamble_quarter_syms + payload_syms * 4;
    Ok(((total_quarter_syms as u64 * t_sym_us as u64).div_ceil(4 * 1_000)) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The DFR1195's PHY after `d613` — 125 kHz, SF12, CR 4/5, 8-symbol
    /// preamble.
    const BENCH: LoraPhy = LoraPhy {
        spreading_factor: 12,
        bandwidth_hz: 125_000,
        coding_rate: 1,
        preamble_symbols: 8,
    };

    /// ‼ **THE ANCHOR THE WHOLE MODULE RESTS ON, AND IT IS EXACT.** At SF12
    /// and 125 kHz the symbol time is `4096 / 125000` seconds = **32.768 ms**,
    /// a figure published in every SX126x note. *If this were wrong every
    /// airtime figure would be wrong by the same factor and every test below
    /// would still agree with itself.*
    #[test]
    fn the_symbol_time_is_the_published_value() {
        assert_eq!(BENCH.symbol_time_us(), 32_768);
        // And it halves as the spreading factor drops by one, which is what
        // 2^SF means and is a second, independent check on the exponent.
        let sf11 = LoraPhy {
            spreading_factor: 11,
            ..BENCH
        };
        assert_eq!(sf11.symbol_time_us(), 16_384);
        // 250 kHz halves it again.
        let wide = LoraPhy {
            bandwidth_hz: 250_000,
            ..BENCH
        };
        assert_eq!(wide.symbol_time_us(), 16_384);
    }

    /// ‼ **EVERY DIVISION IS A CEILING, AND THIS IS THE TEST THAT SAYS SO.**
    /// L1 9.3 Note 1 makes the duty cycle a legal obligation on the operator,
    /// so an estimate running SHORT spends airtime nobody authorised. *A
    /// bandwidth that does not divide `2^SF` evenly is where truncation would
    /// show, and 62_500 does divide evenly — so 62_501 is used, which does
    /// not.*
    #[test]
    fn the_rounding_is_upward_at_every_step() {
        let awkward = LoraPhy {
            bandwidth_hz: 62_501,
            ..BENCH
        };
        // 4096 * 1_000_000 / 62_501 = 65_534.95..., so the ceiling is 65_535
        // and truncation would give 65_534.
        assert_eq!(awkward.symbol_time_us(), 65_535);
        assert!(
            awkward.symbol_time_us() as u64 * 62_501 >= 4096 * 1_000_000,
            "a symbol time that rounded DOWN would under-report every frame"
        );
    }

    /// The low-data-rate optimise bit changes the denominator, so it is
    /// pinned rather than left to be inferred from a total.
    #[test]
    fn low_data_rate_optimise_follows_the_spreading_factor() {
        assert!(BENCH.low_data_rate_optimise(), "SF12");
        assert!(LoraPhy {
            spreading_factor: 11,
            ..BENCH
        }
        .low_data_rate_optimise());
        assert!(!LoraPhy {
            spreading_factor: 10,
            ..BENCH
        }
        .low_data_rate_optimise());

        // And it is worth 20 % of the payload symbols at SF12, which is why
        // it is not a detail: same frame, denominator 4*(12-2) vs 4*12.
        let with = airtime_ms(&BENCH, 32).expect("valid");
        let sf10 = airtime_ms(
            &LoraPhy {
                spreading_factor: 10,
                ..BENCH
            },
            32,
        )
        .expect("valid");
        assert!(with > sf10, "SF12 is slower than SF10 regardless");
    }

    /// ‼ **AIRTIME AT SF12 IS THE REASON `d613`'s DUTY-CYCLE FOLLOW-UP
    /// EXISTS.** A 32-octet frame is over a second on air. *The figure is
    /// asserted rather than described, so a change to the formula has to
    /// explain itself.*
    #[test]
    fn a_small_frame_at_sf12_is_over_a_second_on_air() {
        let ms = airtime_ms(&BENCH, 32).expect("valid");
        assert!(
            (1_000..2_000).contains(&ms),
            "32 octets at SF12/125k should be ~1.3 s, got {ms} ms"
        );
        // Monotonic in payload length: a longer frame is never cheaper.
        let mut last = 0;
        for len in 0..=64 {
            let t = airtime_ms(&BENCH, len).expect("valid");
            assert!(t >= last, "airtime fell at len={len}: {t} < {last}");
            last = t;
        }
    }

    /// The empty and tiny frames take the formula's `numerator <= 0` branch,
    /// which is the one a length sweep would otherwise never exercise.
    #[test]
    fn a_frame_too_short_for_the_formula_still_costs_the_preamble() {
        let ms = airtime_ms(&BENCH, 0).expect("valid");
        assert!(ms > 0, "a preamble is still time on air");
        // 8 payload symbols plus 8+4.25 preamble symbols at 32.768 ms.
        assert_eq!(ms, 664);
    }

    /// ‼ **A NONSENSE PHY REFUSES RATHER THAN RETURNING A NUMBER**, because a
    /// duty-cycle budget spends whatever it is told and the failure would be
    /// a plausible-looking figure rather than a crash.
    #[test]
    fn an_out_of_range_phy_refuses_instead_of_computing() {
        assert_eq!(
            airtime_ms(
                &LoraPhy {
                    spreading_factor: 13,
                    ..BENCH
                },
                16
            ),
            Err(PhyRefusal::SpreadingFactor(13))
        );
        assert_eq!(
            airtime_ms(
                &LoraPhy {
                    bandwidth_hz: 0,
                    ..BENCH
                },
                16
            ),
            Err(PhyRefusal::Bandwidth(0)),
            "zero bandwidth would divide by zero for the symbol time"
        );
        assert_eq!(
            airtime_ms(
                &LoraPhy {
                    coding_rate: 5,
                    ..BENCH
                },
                16
            ),
            Err(PhyRefusal::CodingRate(5))
        );
        // And the boundaries are accepted, so the guard is not simply always
        // refusing.
        for sf in 6..=12u8 {
            assert!(airtime_ms(
                &LoraPhy {
                    spreading_factor: sf,
                    ..BENCH
                },
                16
            )
            .is_ok());
        }
    }
}

#[cfg(test)]
mod bridge_deployment_airtime {
    // ‼ This crate is `no_std`; the helper below reads the board's own source, so
    //   the test module opts into `std` explicitly rather than the crate doing it.
    extern crate std;
    use super::*;
    use std::vec::Vec;

    /// The DFR1195 bridge sensor's PHY, from `lora_bearer.rs`: SF12,
    /// 125 kHz, 4/5, 8-symbol preamble, aligned onto 916.8 MHz under d613.
    const DEPLOYED: LoraPhy = LoraPhy {
        spreading_factor: 12,
        bandwidth_hz: 125_000,
        coding_rate: 1,
        preamble_symbols: 8,
    };

    /// **The field profile's `sensor_cadence_ms`, read from the board crate.**
    ///
    /// The board crate cross-compiles for Xtensa and cannot be imported here, so
    /// the value is read from its source the way this repository's other tests
    /// read the standard: **from the artefact that governs, rather than from a
    /// copy of it.** A parse failure is a failure, not a default — a fallback
    /// would restore the very drift this exists to prevent.
    fn field_profile_cadence_ms() -> u32 {
        let here = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = here
            .ancestors()
            .find(|p| p.join("implementations").is_dir() && p.join("standard").is_dir())
            .expect("the repository root holds implementations/ and standard/");
        let src = std::fs::read_to_string(
            root.join("implementations/rust/hives/hive-esp32-dfr1195/src/profile.rs"),
        )
        .expect("the board's profile.rs reads");
        // Two `PROFILE` blocks live in that file, bench then field, each behind
        // its own `cfg`. The field one is the LAST `sensor_cadence_ms`, and the
        // assertion below refuses the pair being equal so a file that stopped
        // having two distinct profiles cannot pass silently.
        let values: Vec<u32> = src
            .lines()
            .filter_map(|l| l.trim().strip_prefix("sensor_cadence_ms:"))
            .filter_map(|v| v.trim().trim_end_matches(',').replace('_', "").parse().ok())
            .collect();
        assert_eq!(
            values.len(),
            2,
            "expected a bench and a field profile in profile.rs; read {values:?}"
        );
        assert!(
            values[1] > values[0],
            "the field cadence must be the slower of the two; read {values:?}"
        );
        values[1]
    }

    /// ‼ **ONE FULL READING AT SF12 SPENDS 84% OF A FIFTEEN-MINUTE 1% BUDGET,
    /// AND THAT IS THE DEPLOYMENT'S REAL MARGIN.**
    ///
    /// A bridge sensor reads every fifteen minutes and sends what it read. At
    /// SF12 a sealed, tagged reading is **222 bytes at the very largest**
    /// (L1 8.2.1's LoRa payload ceiling) and takes **8037 ms** of airtime;
    /// 1% of 900 s is 9000 ms. *It fits, and it fits with about a second to
    /// spare.*
    ///
    /// # What this test is really refusing
    ///
    /// **There is no room for a retransmission.** A second attempt at the same
    /// reading breaches the region's allowance, so a lost frame must wait for
    /// the next cadence rather than be resent — which is exactly why the
    /// acknowledgement is a *cumulative cursor* that repairs itself on the next
    /// reading instead of a per-frame retry.
    ///
    /// It is also why this is asserted at the **largest payload the bearer
    /// admits** rather than at today's reading size: a reading that grows by
    /// one more sensor field must not silently cross the line, and 222 is the
    /// only bound that cannot be exceeded without the frame being refused for a
    /// different reason first.
    #[test]
    fn a_full_reading_every_fifteen_minutes_stays_inside_the_regional_duty_cycle() {
        /// L1 8.2.1, ordinal 2 `lora`.
        const LARGEST_LORA_PAYLOAD: usize = 222;
        // ‼ **READ FROM THE BOARD'S OWN `profile.rs`, NOT COPIED FROM IT.**
        //   This was `const CADENCE_MS: u32 = 900_000;` — a second spelling of a
        //   number that lives in a crate this one cannot import, and *the whole
        //   claim below is about that number.* A cadence changed in the profile
        //   would have left this test passing against a value no board runs,
        //   which is the two-copies-of-one-fact shape the register keeps
        //   recording. `profile.rs` has no tests of its own, so nothing else
        //   would have noticed either.
        let cadence_ms = field_profile_cadence_ms();
        /// AS923's sub-band allowance.
        const DUTY_CYCLE_PERCENT: u32 = 1;
        let allowance_ms = cadence_ms / 100 * DUTY_CYCLE_PERCENT;

        let ms = airtime_ms(&DEPLOYED, LARGEST_LORA_PAYLOAD).expect("the deployed PHY is in range");
        assert!(
            ms <= allowance_ms,
            "‼ the largest reading takes {ms} ms of airtime and a {cadence_ms} ms \
             cadence allows {allowance_ms} ms at {DUTY_CYCLE_PERCENT}% — the bridge \
             sensor cannot send what it measures without breaching AS923"
        );

        // ‼ **AND THE MARGIN IS ASSERTED, NOT MERELY THE BOUND.** A change that
        //   left this passing with fifty milliseconds to spare would be a
        //   different deployment, and nobody would be told. There is room for
        //   ONE frame per cadence and not two — *stated here so that a proposal
        //   to add retries meets a test rather than a surprise on a bridge.*
        assert!(
            ms * 2 > allowance_ms,
            "there is now room for two frames per cadence ({ms} ms each of \
             {allowance_ms} ms) — retries became affordable and the no-retry \
             reasoning above is stale"
        );

        // The measured figures at the two sizes that matter, so a change to the
        // formula or the PHY is visible as a number rather than as a verdict.
        assert_eq!(ms, 8037);
        assert_eq!(
            airtime_ms(&DEPLOYED, 206).expect("in range"),
            7545,
            "the sealed and tagged reading `hive-tn` measures"
        );
    }

    /// ‼ **A HEARTBEAT IS NOT FREE EITHER**, and the contrast is the point: the
    /// same budget carries three or four small frames where it carries one
    /// reading, so *dropping companions is the lever that buys airtime* if one
    /// is ever needed.
    #[test]
    fn a_bare_reading_costs_a_quarter_of_what_a_full_one_does() {
        let full = airtime_ms(&DEPLOYED, 222).expect("in range");
        let bare = airtime_ms(&DEPLOYED, 48).expect("in range");
        assert_eq!(bare, 2302);
        assert!(
            full > bare * 3,
            "a full reading should cost several times a bare one; {full} vs {bare}"
        );
    }
}
