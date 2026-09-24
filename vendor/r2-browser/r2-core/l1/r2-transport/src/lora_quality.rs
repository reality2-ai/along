//! **What LoRa can tell the routing layer that no other bearer can (BND3 6a;
//! L1 5.3.1; L3 6.2).**
//!
//! # ‼ A STATED FLOOR IS WRONG AT EVERY SPREADING FACTOR BUT ONE
//!
//! BND3 6a.1 already derives quality from **signal-to-noise ratio rather than
//! signal strength**, and its Note 1 gives the reason: *LoRa demodulates below
//! the noise floor, so a usable link can have a received signal strength that
//! looks like nothing at all.*
//!
//! But 6a.3 says *the floor and the ceiling shall be stated by the
//! implementation. This document fixes neither.* ‼ **AND THE FLOOR IS NOT A
//! FREE CHOICE — IT IS A PROPERTY OF THE SPREADING FACTOR.** Each step of SF
//! buys about 2.5 dB, from roughly **−7.5 dB at SF7 to −20 dB at SF12**, so a
//! constant floor is **12.5 dB wrong across the range**:
//!
//! * a floor stated at −20 while running SF7 reports a link at −15 dB as
//!   *usable* when it is **7.5 dB below what SF7 can decode** — a peer scored
//!   as reachable that cannot be reached;
//! * a floor stated at −7.5 while running SF12 reports **every genuinely
//!   working long-range link as `0.0`** — which is the range this bearer
//!   exists for.
//!
//! Both are silent. Layer 3, 6.2 scores routes from these numbers, so the
//! error arrives as a routing decision rather than as a reading.
//!
//! # So quality here means MARGIN, and margin is comparable
//!
//! Taking the floor from the SF makes the value *headroom above what this
//! modulation can actually decode*. **That is comparable across spreading
//! factors and across implementations** — two hives at different SFs reporting
//! `0.5` mean the same thing — where a value against a stated constant is
//! comparable with nothing.
//!
//! ‼ **AND IT IS ACTIONABLE IN A WAY RAW QUALITY IS NOT.** 2.5 dB of margin is
//! one spreading factor of headroom, so the same number that scores a route
//! also says **how much faster the link could run** — and at SF12 one step
//! saves roughly half the airtime on a medium where airtime is the whole
//! budget.

use crate::l1::LinkQuality;
use crate::lora_airtime::{airtime_ms, LoraPhy, PhyRefusal};

/// **Demodulation limit by spreading factor, in tenths of a dB.**
///
/// Indexed by `sf - 7`. Published Semtech figures for the SX126x family, and
/// they step by a near-constant 2.5 dB — *the regularity is why this is a
/// table rather than a formula: the numbers are measured, and a formula would
/// imply a precision the datasheet does not claim.*
pub const DEMOD_LIMIT_DB10: [i16; 6] = [-75, -100, -125, -150, -175, -200];

/// Why a margin could not be computed.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum QualityRefusal {
    /// Outside SF7..=SF12, the range the table covers.
    ///
    /// ‼ **REFUSED RATHER THAN CLAMPED TO THE NEAREST**, because clamping
    /// would silently score a link against a floor belonging to a different
    /// modulation — which is the exact defect this module exists to fix.
    SpreadingFactor(u8),
}

/// **Headroom above what this spreading factor can decode, in tenths of a dB.**
///
/// Negative means the reception was **below** the demodulation limit — which
/// is a real observation on a bearer that sometimes decodes a frame it
/// statistically should not, and is reported rather than floored so a caller
/// can see it happened.
pub const fn margin_db10(snr_db10: i16, spreading_factor: u8) -> Result<i16, QualityRefusal> {
    if spreading_factor < 7 || spreading_factor > 12 {
        return Err(QualityRefusal::SpreadingFactor(spreading_factor));
    }
    Ok(snr_db10 - DEMOD_LIMIT_DB10[(spreading_factor - 7) as usize])
}

/// **The margin at which quality reaches `1.0`, in tenths of a dB.**
///
/// 20 dB of headroom is eight spreading factors' worth on a scale that only
/// has six, so it is comfortably beyond *this link is as good as it needs to
/// be*. **The ceiling stays an implementation statement (6a.3) and only the
/// FLOOR is fixed by the modulation** — a ceiling is a judgement about when
/// more signal stops mattering, and that genuinely is a deployment's to make.
pub const DEFAULT_CEILING_DB10: i16 = 200;

/// **Derive B4 from the margin (BND3 6a.1, 6a.2).**
///
/// Monotonic in SNR and clamped at both ends, as 6a.2 requires — the change is
/// only *what zero means*: **the demodulation limit of the modulation in use**
/// rather than a number somebody chose once.
pub fn quality(
    snr_db10: i16,
    spreading_factor: u8,
    ceiling_db10: i16,
) -> Result<LinkQuality, QualityRefusal> {
    let margin = margin_db10(snr_db10, spreading_factor)?;
    if margin <= 0 {
        return Ok(LinkQuality(0.0));
    }
    if ceiling_db10 <= 0 || margin >= ceiling_db10 {
        return Ok(LinkQuality(1.0));
    }
    Ok(LinkQuality(margin as f32 / ceiling_db10 as f32))
}

/// **How many spreading factors of headroom this reception had.**
///
/// ‼ **THE ACTIONABLE HALF, AND THE ONE A BARE QUALITY VALUE THROWS AWAY.**
/// Each step is about 2.5 dB, so a link heard 8 dB above SF12's limit would
/// still decode at SF9 — *at roughly a seventh of the airtime.* On a medium
/// where every hive relays and airtime is the whole budget, that is the
/// difference between a mesh that carries traffic and one that spends its
/// allowance on preambles.
///
/// **Reports headroom and chooses nothing.** Selecting a spreading factor is a
/// deployment decision bound by a region and a channel plan (BND3 6c.3), and a
/// bearer that quietly went faster because one frame arrived strongly would be
/// making it on a sample of one.
pub const fn spreading_factors_of_headroom(margin_db10: i16) -> u8 {
    if margin_db10 <= 0 {
        return 0;
    }
    (margin_db10 / 25) as u8
}

/// **The cost of sending one frame, in milliseconds of airtime.**
///
/// ‼ **B6 IS A `u8` CONSTANT AND THIS MEDIUM'S COST VARIES BY MORE THAN
/// FORTY-FOLD.** Layer 3, 6.2.1 says a score *shall decrease with the cost of
/// sending on it* — and on LoRa a 20-byte frame at SF9 costs 185 ms while a
/// 222-byte frame at SF12 costs 8036 ms. **One number cannot carry that**, so
/// this offers the function the constant stands in for. *The profile keeps its
/// scalar for cross-bearer comparison; a router choosing between two LoRa
/// options should ask this instead.*
pub fn frame_cost_ms(phy: &LoraPhy, payload_len: usize) -> Result<u32, PhyRefusal> {
    airtime_ms(phy, payload_len)
}

/// **How much of the airtime budget is already spent, as a fraction.**
///
/// ‼ **BETWEEN *FINE* AND *UNAVAILABLE* THERE WAS NOTHING.** Layer 3, 6.1.2 c)
/// removes a bearer that reports itself unavailable, so a bearer 90 % through
/// its allowance scores **identically to an idle one** until it abruptly
/// vanishes — and the frames in flight at that moment are the ones that
/// discover it. *A route that degrades is one the layer above can plan
/// against; a route that disappears is one it can only react to.*
///
/// Returns `1.0` where the window is zero, because a budget with no window is
/// spent by definition rather than infinite.
pub fn budget_pressure(spent_ms: u32, allowance_ms: u32) -> f32 {
    if allowance_ms == 0 {
        return 1.0;
    }
    let p = spent_ms as f32 / allowance_ms as f32;
    if p > 1.0 {
        1.0
    } else {
        p
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ‼ **THE DEFECT, STATED AS A TEST**: a reception at −15 dB is unusable
    /// at SF7 and comfortable at SF12, and a constant floor cannot say both.
    #[test]
    fn the_same_snr_is_unusable_at_one_spreading_factor_and_good_at_another() {
        let snr = -150; // −15.0 dB
        assert_eq!(
            quality(snr, 7, DEFAULT_CEILING_DB10).unwrap(),
            LinkQuality(0.0),
            "−15 dB is 7.5 dB BELOW what SF7 can decode; scoring it usable \
             offers the router a peer that cannot be reached"
        );
        let q12 = quality(snr, 12, DEFAULT_CEILING_DB10).unwrap();
        assert!(
            q12.0 > 0.2,
            "−15 dB is 5 dB of headroom at SF12 and must not read as unusable, \
             because that is the range this bearer exists for; got {q12:?}"
        );
    }

    /// **Margin is measured from the modulation's own limit**, which is what
    /// makes two hives at different spreading factors comparable.
    #[test]
    fn equal_headroom_gives_equal_quality_at_any_spreading_factor() {
        // 10 dB of headroom at each SF: SNR = limit + 100.
        let mut seen = None;
        for sf in 7u8..=12 {
            let snr = DEMOD_LIMIT_DB10[(sf - 7) as usize] + 100;
            let q = quality(snr, sf, DEFAULT_CEILING_DB10).unwrap();
            match seen {
                None => seen = Some(q),
                Some(first) => assert_eq!(
                    q, first,
                    "SF{sf} reported different quality for the same headroom"
                ),
            }
        }
        assert_eq!(seen, Some(LinkQuality(0.5)), "10 dB of 20 is half");
    }

    /// The table is the published one and steps by 2.5 dB.
    #[test]
    fn the_demodulation_limits_step_by_two_and_a_half_decibels() {
        for w in DEMOD_LIMIT_DB10.windows(2) {
            assert_eq!(w[0] - w[1], 25, "the step between {w:?} is not 2.5 dB");
        }
        assert_eq!(DEMOD_LIMIT_DB10[0], -75, "SF7 is −7.5 dB");
        assert_eq!(DEMOD_LIMIT_DB10[5], -200, "SF12 is −20 dB");
    }

    /// ‼ **AN UNKNOWN SPREADING FACTOR IS REFUSED, NOT CLAMPED.** Clamping
    /// would score a link against another modulation's floor, which is the
    /// defect this module exists to remove.
    #[test]
    fn a_spreading_factor_outside_the_table_is_refused() {
        for sf in [0u8, 6, 13, 255] {
            assert_eq!(
                margin_db10(0, sf),
                Err(QualityRefusal::SpreadingFactor(sf)),
                "SF{sf} was accepted"
            );
        }
        assert!(margin_db10(0, 7).is_ok());
        assert!(margin_db10(0, 12).is_ok());
    }

    /// **A reception below the limit is reported, not floored away** — it
    /// happens, and a caller that cannot see it cannot tell a marginal link
    /// from an absent one.
    #[test]
    fn a_reception_below_the_demodulation_limit_reports_a_negative_margin() {
        let m = margin_db10(-220, 12).unwrap();
        assert_eq!(m, -20, "2 dB below SF12's limit");
        assert_eq!(
            quality(-220, 12, DEFAULT_CEILING_DB10).unwrap(),
            LinkQuality(0.0)
        );
        assert_eq!(spreading_factors_of_headroom(m), 0);
    }

    /// ‼ **THE ACTIONABLE HALF**: headroom in spreading factors, which is what
    /// turns a quality value into an airtime saving.
    #[test]
    fn headroom_counts_whole_spreading_factors() {
        assert_eq!(spreading_factors_of_headroom(0), 0);
        assert_eq!(spreading_factors_of_headroom(24), 0, "just under one step");
        assert_eq!(spreading_factors_of_headroom(25), 1);
        assert_eq!(spreading_factors_of_headroom(80), 3, "8 dB is three steps");
        // A link heard 8 dB above SF12's limit would decode at SF9.
        let m = margin_db10(-120, 12).unwrap();
        assert_eq!(m, 80);
        assert_eq!(12 - spreading_factors_of_headroom(m), 9);
    }

    /// **Budget pressure rises smoothly instead of cliffing**, so a router can
    /// plan against a bearer that is running out.
    #[test]
    fn budget_pressure_is_a_gradient_not_a_cliff() {
        assert_eq!(budget_pressure(0, 36_000), 0.0);
        assert_eq!(budget_pressure(18_000, 36_000), 0.5);
        assert_eq!(budget_pressure(36_000, 36_000), 1.0);
        assert_eq!(
            budget_pressure(99_000, 36_000),
            1.0,
            "clamped, not over one"
        );
        // A window of zero is spent by definition, not infinite.
        assert_eq!(budget_pressure(0, 0), 1.0);
    }

    /// **Cost is a function, not a constant** — the fortyfold spread B6's
    /// single byte cannot express.
    #[test]
    fn frame_cost_spans_more_than_fortyfold_across_this_medium() {
        let fast = LoraPhy {
            spreading_factor: 9,
            bandwidth_hz: 125_000,
            coding_rate: 1,
            preamble_symbols: 8,
        };
        let slow = LoraPhy {
            spreading_factor: 12,
            ..fast
        };
        let cheap = frame_cost_ms(&fast, 20).unwrap();
        let dear = frame_cost_ms(&slow, 222).unwrap();
        assert!(
            dear / cheap > 40,
            "the spread is {cheap} ms to {dear} ms, which one u8 is asked to carry"
        );
    }
}
