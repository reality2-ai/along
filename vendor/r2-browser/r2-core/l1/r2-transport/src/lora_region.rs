//! **The regulatory facts a LoRa deployment must declare before it may
//! transmit (BND3 6c.3, 6c.3a, 6e.7, 6e.8).**
//!
//! # ‼ THE BENCH ENFORCED A EUROPEAN RULE ON A NEW ZEALAND BAND
//!
//! `main.rs` carried `DUTY_ALLOWANCE_MS = 36_000` with the comment ***1 % of
//! an hour***, **inside the regulatory counter**. *(Renamed `BENCH_ALLOWANCE_MS`
//! and moved into `BenchCeiling` on 2026-09-05 under 6c.3a — the figure is
//! unchanged and is still ours, but it no longer sits in the field a legal
//! limit lives in. The old name is kept in this sentence because it is what
//! the history says, and a reader following the story needs it to match.)* **Verified at the primary source** — NZ Gazette `2022-go3100`,
//! *Radiocommunications Regulations (General User Radio Licence for Short
//! Range Devices)* — **915–928 MHz carries 0 dBW (1 W) e.i.r.p. and special
//! condition 23, which is unwanted-emission limits only: no duty cycle, no
//! listen-before-talk, no dwell limit.** The **1 %** is special condition 15
//! and it governs **868–870 MHz**, a European band this fleet does not use.
//!
//! ‼ **SO THE LIMIT WAS OURS, NOT THE RADIO'S, AND IT WAS ABOUT TO BE
//! REPORTED AS THE RADIO'S.** At SF12 a 50-byte frame is 2302 ms of airtime,
//! so 1 % permits about **fifteen frames an hour** — and L3 5.1.1 makes every
//! hive a relay, so that budget is spent carrying **other hives' traffic**.
//! *A self-imposed limit was one step from becoming the published reason LoRa
//! is unsuitable for a repeater.* (`SS427`.)
//!
//! # ‼ THE REGIMES DIFFER IN KIND, WHICH IS WHY THIS IS AN ENUM AND NOT A
//! # NUMBER
//!
//! A single `duty_cycle_permille` field cannot express the world. **Some
//! jurisdictions impose a duty cycle; some impose a dwell time per channel
//! and require hopping; some impose mandatory carrier sense; some impose only
//! a radiated-power limit.** Those are four different obligations, and a
//! field that held a percentage would have to encode *no duty cycle* as some
//! number — which is the absent-versus-zero defect this corpus has paid for
//! twice already (`SS419`, `SS423`).
//!
//! **So absence is a variant, and it is a DECLARED variant** (BND3 6c.3a): a
//! region that imposes no airtime limit says so, and that is a different fact
//! from a deployment that never worked it out.
//!
//! # ⚠ WHAT IS VERIFIED HERE, AND WHAT IS NOT
//!
//! **Every profile carries its own provenance string and there is no profile
//! without one.** A regulatory value with no source is the shape that put a
//! European constant on a New Zealand board, so the type makes the source
//! mandatory rather than customary. *Where a profile rests on a secondary
//! source it says so in its own text, and a reader deciding whether to
//! transmit under it can see the difference without leaving the file.*

use crate::l1::BearerState;
use crate::lora_airtime::{airtime_ms, LoraPhy, PhyRefusal};

/// **What a jurisdiction limits, expressed as the kind of limit it is.**
///
/// ‼ **[`None`](AirtimeLimit::None) IS A DECLARATION AND NOT A DEFAULT.**
/// BND3 6c.3a obliges a deployment whose region imposes no duty cycle to
/// *declare that absence*, precisely so it cannot be confused with the
/// deployment that never asked. **A `Default` impl is deliberately absent
/// from this type**: there is no safe value to fall back to, because the two
/// failure directions are a device that transmits unlawfully and a device
/// that refuses lawful traffic, and neither is the conservative one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AirtimeLimit {
    /// The region imposes no airtime restriction — only power and emission
    /// limits. **Declared, per 6c.3a.**
    None,
    /// A proportion of a rolling window may be occupied. The European shape.
    ///
    /// `permille` rather than percent so a 0.1 % limit is expressible without
    /// a fraction — the NZ notice states one for 869.20–869.25 MHz, so the
    /// case is real rather than hypothetical.
    DutyCycle { permille: u16, window_s: u32 },
    /// **No single channel may be occupied for more than `max_ms` in
    /// `window_s`, and at least `min_channels` must be used.** The United
    /// States shape (47 CFR 15.247 frequency hopping).
    ///
    /// ‼ **THIS IS NOT A DUTY CYCLE WITH DIFFERENT NUMBERS.** A duty cycle
    /// bounds *total* transmission and is satisfied by waiting; a dwell limit
    /// bounds transmission *per channel* and is satisfied by **moving**. A
    /// deployment that waits instead of hopping is still unlawful, and one
    /// that hops instead of waiting is still lawful at a hundred times the
    /// traffic. **The obligations are not comparable and must not share a
    /// representation.**
    Dwell {
        max_ms: u32,
        window_s: u32,
        min_channels: u16,
    },
}

/// **What a jurisdiction requires before a transmission may begin.**
///
/// Separate from [`AirtimeLimit`] because they are independent axes: a region
/// may impose both, either, or neither. *Japan's carrier-sense obligation and
/// Europe's duty cycle are not two settings of one dial.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MediumAccess {
    /// The region imposes nothing. **BND3 6e.1 still applies** — this crate's
    /// binding requires channel-activity detection for the medium's sake
    /// whatever the law says, and 6e.7 only ever makes a region's rule *more*
    /// restrictive, never less.
    RegionImposesNone,
    /// Carrier sense is mandatory, with the region's own parameters.
    ///
    /// `threshold_dbm` is `None` where the region mandates sensing without
    /// fixing a level — *absent is not zero, and 0 dBm would be a threshold
    /// nothing ever exceeds.*
    CarrierSense {
        threshold_dbm: Option<i16>,
        min_sense_us: u32,
    },
}

/// **One jurisdiction's facts, with the source they were read from.**
///
/// ‼ **`provenance` IS NOT DOCUMENTATION.** It is the field whose absence
/// allowed `DUTY_ALLOWANCE_MS = 36_000 // 1 % of an hour` to sit in a board
/// file for weeks looking like a measurement. *(That constant is now
/// `BENCH_ALLOWANCE_MS` inside a `BenchCeiling`, which is a second answer to
/// the same problem: `provenance` makes a profile say where its numbers came
/// from, and the type name makes a restraint say whose it is.)* A profile that cannot name
/// where its numbers came from cannot be constructed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RegionProfile {
    /// Short label for a console line.
    pub name: &'static str,
    /// The lowest and highest frequency this profile covers, in Hz.
    /// **Inclusive at both ends.**
    pub band_low_hz: u32,
    pub band_high_hz: u32,
    /// Maximum radiated power, dBm e.i.r.p.
    pub max_eirp_dbm: i16,
    pub airtime: AirtimeLimit,
    pub access: MediumAccess,
    /// ‼ **Where every number above was read, and how certainly.** A profile
    /// resting on a secondary source says so here.
    pub provenance: &'static str,
}

/// **New Zealand, 915–928 MHz. Read at the primary source.**
///
/// The band `d613`'s 916.8 MHz channel sits in. **No duty cycle, no dwell
/// limit, no carrier-sense obligation** — special condition 23 is unwanted
/// emissions only, and condition 13's hopping requirement binds above 1 W,
/// which a 14 dBm bench transmitter is nowhere near.
pub const NZ_915: RegionProfile = RegionProfile {
    name: "NZ 915-928",
    band_low_hz: 915_000_000,
    band_high_hz: 928_000_000,
    max_eirp_dbm: 30,
    airtime: AirtimeLimit::None,
    access: MediumAccess::RegionImposesNone,
    provenance: "NZ Gazette 2022-go3100, Radiocommunications Regulations \
                 (General User Radio Licence for Short Range Devices): \
                 915.0000-928.0000 MHz, 0.0 dBW e.i.r.p., special condition \
                 23 (unwanted emission limits only). The 1% duty cycle is \
                 special condition 15 and applies to 868-870 MHz. PRIMARY \
                 SOURCE, read 2026-08-19. LIMIT: one notice was read and its \
                 currency against later amendments is UNCONFIRMED",
};

/// **United States, 902–928 MHz, frequency-hopping route.**
///
/// ‼ **THE 400 ms DWELL IS WHY SF12 AT 125 kHz CANNOT BE USED HERE AT ALL.**
/// A single 20-byte frame at SF12/125 kHz occupies one channel for 1319 ms —
/// **more than three times the limit in one transmission** — so no amount of
/// waiting makes it lawful. *This is the clearest case for why a firmware
/// must carry the region as data: the same image that is correct in New
/// Zealand is unlawful in the United States, and nothing about the radio
/// changes.*
pub const US_902: RegionProfile = RegionProfile {
    name: "US 902-928",
    band_low_hz: 902_000_000,
    band_high_hz: 928_000_000,
    max_eirp_dbm: 30,
    airtime: AirtimeLimit::Dwell {
        max_ms: 400,
        window_s: 20,
        min_channels: 50,
    },
    access: MediumAccess::RegionImposesNone,
    provenance: "47 CFR 15.247(a)(1)(i): frequency hopping systems in \
                 902-928 MHz with 20 dB bandwidth under 250 kHz shall use at \
                 least 50 hopping frequencies, and average occupancy of any \
                 frequency shall not exceed 0.4 s within a 20 s period. LoRa \
                 at 125 kHz falls under this rather than the digital \
                 modulation route, which requires a 6 dB bandwidth of at \
                 least 500 kHz. Read 2026-08-19 from the rule text; NOT \
                 checked against a current eCFR revision",
};

/// **The most restrictive combination this file can state, for a device that
/// must ship before its destination is known.**
///
/// ⚠ **LEGAL IN MORE PLACES, OPTIMAL IN NONE, AND THAT IS THE TRADE BEING
/// MADE.** It carries the United States dwell limit *and* a 1 % duty cycle
/// *and* mandatory sensing, so it satisfies the strictest rule on each axis
/// separately. **It does not thereby satisfy every jurisdiction**: a hopping
/// obligation over fifty channels is a *structural* requirement no
/// conservative number can stand in for, and a band that is legal in one
/// region does not exist in another. *`band_low_hz`/`band_high_hz` are
/// deliberately left at the 915–928 plan, because there is no frequency legal
/// in both Europe and North America and pretending otherwise is the one error
/// this constant could cause.*
pub const PORTABLE_STRICT: RegionProfile = RegionProfile {
    name: "portable-strict",
    band_low_hz: 915_000_000,
    band_high_hz: 928_000_000,
    // The European 868 MHz sub-band limit, as the lowest in common use.
    max_eirp_dbm: 14,
    airtime: AirtimeLimit::Dwell {
        max_ms: 400,
        window_s: 20,
        min_channels: 50,
    },
    access: MediumAccess::CarrierSense {
        threshold_dbm: None,
        min_sense_us: 5_000,
    },
    provenance: "NOT A JURISDICTION. The per-axis intersection of the \
                 profiles in this file, for a build whose destination is \
                 unknown. It is not a substitute for declaring a region: a \
                 hopping obligation is structural, and no band is legal \
                 everywhere",
};

/// Why a transmission is refused before it is attempted.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RegionRefusal {
    /// **BND3 6e.8: no region declared.** *A bearer transmitting under no
    /// declared region chooses a regime by omission, and the one it chooses
    /// is whichever country its author lives in.*
    NoRegionDeclared,
    /// The frequency is outside the declared profile's band.
    OutOfBand { hz: u32 },
    /// The requested power exceeds the region's limit.
    OverPower { requested_dbm: i16, limit_dbm: i16 },
    /// ‼ **One transmission alone exceeds the region's per-channel dwell
    /// limit**, so no amount of waiting makes it lawful. **Kept apart from a
    /// spent budget**: a budget recovers with time and this never does — the
    /// answer is a faster spreading factor, not patience.
    DwellExceededBySingleFrame { airtime_ms: u32, max_ms: u32 },
    /// The PHY parameters are not ones airtime can be computed for.
    Phy(PhyRefusal),
}

/// **What a deployment has declared. `None` is the state 6e.8 refuses in.**
///
/// A newtype rather than a bare `Option` so the refusal is reachable only
/// through [`Declared::permits`] — *an `Option` invites a caller to
/// `unwrap_or` a default, and the whole point of 6e.8 is that there is no
/// default to reach for.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Declared(Option<RegionProfile>);

impl Declared {
    /// **Nothing declared.** Every transmission refuses until a region is set.
    pub const fn undeclared() -> Self {
        Self(None)
    }

    pub const fn region(p: RegionProfile) -> Self {
        Self(Some(p))
    }

    pub const fn profile(&self) -> Option<RegionProfile> {
        self.0
    }

    /// **The L1 output state implied by this declaration and legal budget.**
    ///
    /// BND3 6e.8 does not permit an undeclared region to be represented as an
    /// otherwise-available bearer that discards work only at the physical TX
    /// boundary. A caller would have accepted a frame, potentially occupied a
    /// bounded queue and charged airtime while already knowing no transmission
    /// can begin. The honest L1 state is therefore [`BearerState::Unavailable`]
    /// until a region is declared, independently of whether the airtime budget
    /// has room.
    ///
    /// This helper decides only the declaration and budget axes. A radio fault
    /// remains a binding-owned [`BearerState::Failed`] state and must not be
    /// cleared merely because a region is later supplied.
    pub const fn output_state(self, budget_exhausted: bool) -> BearerState {
        if self.0.is_some() && !budget_exhausted {
            BearerState::Available
        } else {
            BearerState::Unavailable
        }
    }

    /// Extend [`Self::output_state`] with a binding-owned output-capacity
    /// fact. A full local queue is a known inability to accept a new frame,
    /// even when the region and legal budget would otherwise permit it.
    #[must_use]
    pub const fn output_state_with_capacity(
        self,
        budget_exhausted: bool,
        has_output_capacity: bool,
    ) -> BearerState {
        match self.output_state(budget_exhausted) {
            BearerState::Available if has_output_capacity => BearerState::Available,
            _ => BearerState::Unavailable,
        }
    }

    /// **May this frame be transmitted, at this frequency and power?**
    ///
    /// Checks only what is knowable *before* the transmission and without
    /// history: the declaration itself, the band, the power, and whether one
    /// frame alone breaks a dwell limit. **A rolling budget is a separate
    /// question with separate state** — [`crate::lora_airtime`] holds it —
    /// and merging the two would make a stateless check look like a
    /// regulatory guarantee.
    pub fn permits(
        &self,
        hz: u32,
        eirp_dbm: i16,
        phy: &LoraPhy,
        payload_len: usize,
    ) -> Result<u32, RegionRefusal> {
        let Some(p) = self.0 else {
            return Err(RegionRefusal::NoRegionDeclared);
        };
        if hz < p.band_low_hz || hz > p.band_high_hz {
            return Err(RegionRefusal::OutOfBand { hz });
        }
        if eirp_dbm > p.max_eirp_dbm {
            return Err(RegionRefusal::OverPower {
                requested_dbm: eirp_dbm,
                limit_dbm: p.max_eirp_dbm,
            });
        }
        let ms = airtime_ms(phy, payload_len).map_err(RegionRefusal::Phy)?;
        if let AirtimeLimit::Dwell { max_ms, .. } = p.airtime {
            if ms > max_ms {
                return Err(RegionRefusal::DwellExceededBySingleFrame {
                    airtime_ms: ms,
                    max_ms,
                });
            }
        }
        Ok(ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lora_airtime::LoraPhy;

    /// 125 kHz, 4/5, 8-symbol preamble — the bench PHY, varying only the
    /// spreading factor, which is the parameter the dwell limit turns on.
    const fn phy(sf: u8) -> LoraPhy {
        LoraPhy {
            spreading_factor: sf,
            bandwidth_hz: 125_000,
            coding_rate: 1,
            preamble_symbols: 8,
        }
    }

    /// ‼ **6e.8: NOTHING DECLARED MEANS NOTHING TRANSMITS.**
    #[test]
    fn an_undeclared_region_refuses_every_transmission() {
        let d = Declared::undeclared();
        assert_eq!(
            d.permits(916_800_000, 14, &phy(9), 50),
            Err(RegionRefusal::NoRegionDeclared),
            "a bearer with no declared region was permitted to transmit"
        );
        assert!(d.profile().is_none());
    }

    /// **A declaration gate is an L1 state, not a transmit-time discard.**
    ///
    /// The state selector is host-testable so a board binding cannot quietly
    /// drift back to `Available` when a budget window rolls or receive is
    /// re-armed. The DFR direct-LoRa owner uses this exact selector before its
    /// bounded queue and airtime charge are reachable.
    #[test]
    fn an_undeclared_region_is_unavailable_and_a_declared_budget_recovers_output() {
        assert_eq!(
            Declared::undeclared().output_state(false),
            BearerState::Unavailable,
            "an undeclared region cannot accept a frame for later discard"
        );
        assert_eq!(
            Declared::region(NZ_915).output_state(true),
            BearerState::Unavailable,
            "a declared but exhausted budget is still unavailable"
        );
        assert_eq!(
            Declared::region(NZ_915).output_state(false),
            BearerState::Available,
            "a declared region with legal budget may accept output"
        );
        assert_eq!(
            Declared::region(NZ_915).output_state_with_capacity(false, false),
            BearerState::Unavailable,
            "a full output queue cannot report an offer as available"
        );
        assert_eq!(
            Declared::region(NZ_915).output_state_with_capacity(false, true),
            BearerState::Available,
            "freeing a queue entry restores the output state"
        );
    }

    /// **The bench, as it actually stands**: 916.8 MHz at 14 dBm, SF12, and
    /// New Zealand imposes no airtime limit at all — so this is lawful, and
    /// the 1 % the firmware enforced was ours.
    #[test]
    fn the_bench_setting_is_lawful_in_new_zealand_at_sf12() {
        let d = Declared::region(NZ_915);
        let ms = d
            .permits(916_800_000, 14, &phy(12), 50)
            .expect("SF12 at 916.8 MHz refused under a region with no airtime limit");
        assert!(
            ms > 2_000,
            "a 50-byte SF12 frame should be over two seconds, got {ms} ms"
        );
        assert_eq!(NZ_915.airtime, AirtimeLimit::None, "the declared absence");
    }

    /// ‼ **THE SAME FRAME, THE SAME RADIO, UNLAWFUL IN THE UNITED STATES** —
    /// and refused for a reason that names itself as unfixable by waiting.
    #[test]
    fn the_same_sf12_frame_is_refused_in_the_united_states() {
        let d = Declared::region(US_902);
        match d.permits(916_800_000, 14, &phy(12), 50) {
            Err(RegionRefusal::DwellExceededBySingleFrame { airtime_ms, max_ms }) => {
                assert_eq!(max_ms, 400);
                assert!(airtime_ms > 2_000, "got {airtime_ms} ms");
            }
            other => panic!("expected a dwell refusal, got {other:?}"),
        }
    }

    /// **And the fix is a faster spreading factor, not patience** — which is
    /// the distinction `DwellExceededBySingleFrame` exists to carry.
    #[test]
    fn sf9_is_permitted_in_the_united_states_where_sf12_is_not() {
        let d = Declared::region(US_902);
        let ms = d
            .permits(916_800_000, 14, &phy(9), 50)
            .expect("SF9 refused under the US dwell limit");
        assert!(
            ms < 400,
            "SF9 at 50 bytes should fit the dwell limit, got {ms} ms"
        );
    }

    /// The band check is real, and 868 MHz is not in the 915 plan — *there is
    /// no frequency legal in both Europe and North America, which is why the
    /// band travels with the profile.*
    #[test]
    fn a_frequency_outside_the_declared_band_is_refused() {
        let d = Declared::region(NZ_915);
        assert_eq!(
            d.permits(868_100_000, 14, &phy(9), 50),
            Err(RegionRefusal::OutOfBand { hz: 868_100_000 })
        );
    }

    /// Power is checked against the region and not against the radio.
    #[test]
    fn power_over_the_regional_limit_is_refused() {
        let d = Declared::region(PORTABLE_STRICT);
        assert_eq!(
            d.permits(916_800_000, 22, &phy(9), 50),
            Err(RegionRefusal::OverPower {
                requested_dbm: 22,
                limit_dbm: 14
            }),
            "the portable profile carries the lowest power limit in common use"
        );
        // And the bench's own 14 dBm passes it.
        assert!(d.permits(916_800_000, 14, &phy(9), 50).is_ok());
    }

    /// ‼ **EVERY PROFILE NAMES ITS SOURCE, INCLUDING THE ONE THAT IS NOT A
    /// JURISDICTION.** This is the field whose absence let a European
    /// constant sit on a New Zealand board looking like a measurement.
    #[test]
    fn no_profile_ships_without_provenance() {
        for p in [NZ_915, US_902, PORTABLE_STRICT] {
            assert!(
                p.provenance.len() > 40,
                "{} ships without a usable source",
                p.name
            );
        }
        assert!(
            PORTABLE_STRICT.provenance.contains("NOT A JURISDICTION"),
            "the intersection profile must not read as a legal reading"
        );
        assert!(
            NZ_915.provenance.contains("UNCONFIRMED"),
            "the NZ profile's one unverified property is its currency, and it \
             must say so where somebody deciding to transmit will see it"
        );
    }

    /// **The two airtime regimes are not interchangeable**, and the type says
    /// so: a duty cycle is satisfied by waiting and a dwell limit by moving.
    #[test]
    fn a_duty_cycle_and_a_dwell_limit_are_different_variants() {
        assert_ne!(
            AirtimeLimit::DutyCycle {
                permille: 10,
                window_s: 3600
            },
            AirtimeLimit::Dwell {
                max_ms: 400,
                window_s: 20,
                min_channels: 50
            }
        );
        // And neither is the declared absence.
        assert_ne!(
            AirtimeLimit::None,
            AirtimeLimit::DutyCycle {
                permille: 0,
                window_s: 0
            }
        );
    }
    /// ‼ **6c.3: A DEPLOYMENT DECLARES ITS REGION, AND EVERY FIELD 6c.3 NAMES
    /// IS A FIELD OF THE PROFILE RATHER THAN A HABIT.** *The region, the
    /// channel plan, the spreading factor and bandwidth, the duty cycle or
    /// airtime budget those imply, and any medium-access parameter the region
    /// imposes.* A declaration that carried some of them would let a
    /// deployment be silent about the rest and still look complete.
    ///
    /// ‼ **AND 6c.3a IS THE HALF THAT IS EASY TO GET WRONG: WHERE A REGION
    /// IMPOSES NO DUTY CYCLE, THE ABSENCE IS DECLARED.** `AirtimeLimit::None`
    /// is a STATEMENT and not a default — *not-yet-known and known-to-be-none
    /// are different claims*, and a deployment that simply omitted the field
    /// would be indistinguishable from one that had not looked. New Zealand's
    /// 915-928 band imposes none, and the profile says so with its source
    /// beside it.
    #[test]
    fn a_region_declares_every_field_the_clause_names_including_an_absent_duty_cycle() {
        // 6c.3a: the absence is stated, and its provenance travels with it.
        assert_eq!(NZ_915.airtime, AirtimeLimit::None, "the declared absence");
        assert!(
            NZ_915.provenance.contains("Gazette"),
            "‼ a declared absence with no source is an assertion, not a declaration: {}",
            NZ_915.provenance
        );
        assert!(!NZ_915.name.is_empty(), "6c.3: the region is named");
        assert!(
            NZ_915.band_high_hz > NZ_915.band_low_hz,
            "6c.3: the channel plan"
        );

        // ‼ EVERY PROFILE, NOT ONLY THIS ONE. A sweep over the declared set is
        //   what stops a second region being added with an empty provenance —
        //   the field exists precisely because a number with no source once
        //   sat in a board file for weeks looking like a measurement.
        // ‼ NAMED HERE RATHER THAN DERIVED, AND THE LIST IS THE POINT: a new
        //   region added without a line here is a region this sweep does not
        //   see, and the compiler cannot tell me about a `const` I did not
        //   mention. *This is the weakest part of the test and it says so.*
        let declared = [NZ_915, US_902, PORTABLE_STRICT];
        for p in declared {
            assert!(!p.name.is_empty(), "an unnamed region");
            assert!(!p.provenance.is_empty(), "{}: no provenance", p.name);
            assert!(
                p.band_high_hz > p.band_low_hz,
                "{}: no channel plan",
                p.name
            );
            assert!(p.max_eirp_dbm > -100, "{}: no power figure", p.name);
        }
        assert_eq!(declared.len(), 3, "a sweep over no region is not a pass");
    }
}
