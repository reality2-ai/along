//! **The BLE announcement's advertising structure (`L1-BINDING-BLE.md` 3, 5.2).**
//!
//! # Why this is here and not in a BLE bearer crate
//!
//! The portable BLE bearer calls this module, while an actual radio controller
//! remains platform-specific and cannot be exercised by a host test alone.
//! That is the same split as `hive-bearer-espnow`: the byte arithmetic belongs
//! here, where the gate can test it, rather than being duplicated in a driver.
//!
//! # The structure
//!
//! A BLE advertising-data sequence containing Flags followed by the Reality2
//! Service Data structure. Each structure is `length | AD type | data`, where
//! length counts the type octet and data but not itself. The Reality2 structure
//! has type **Service Data — 128-bit UUID** (`0x21`), the first sixteen data
//! octets are the marker UUID, and the rest is the announcement body every
//! binding shares (see `r2-discovery`'s `announcement` module — a doc reference,
//! not an import: the body belongs to L2 and this L1 binding carries it opaque).
//!
//! ‼ **THE UUID GOES ON THE WIRE LEAST-SIGNIFICANT OCTET FIRST**, which is the
//! Bluetooth convention for UUIDs in advertising data and is **the opposite of
//! how the binding writes it**. The binding gives the value in the standard
//! text form, `52324e54-0001-4000-8000-52324e540001`, because that is what a
//! person reads; the advertisement carries it reversed. *A marker written in
//! the order it is printed is a marker no scanner matches, and it would fail
//! silently — the advertisement is well-formed, the scanner simply never sees
//! one of ours.* Binding 3.1a states the order.

/// The discovery marker (3.1), in the **text order the binding writes it** —
/// `52324e54-0001-4000-8000-52324e540001`.
///
/// Use [`advertising_data`] to place it; it reverses for the wire.
pub const MARKER_UUID: [u8; 16] = [
    0x52, 0x32, 0x4e, 0x54, 0x00, 0x01, 0x40, 0x00, 0x80, 0x00, 0x52, 0x32, 0x4e, 0x54, 0x00, 0x01,
];

/// AD type: Service Data — 128-bit UUID.
pub const AD_TYPE_SERVICE_DATA_128: u8 = 0x21;

/// AD type for the mandatory Bluetooth LE Flags structure used by the
/// connectable extended-advertising mode selected by the ESP32 host.
pub const AD_TYPE_FLAGS: u8 = 0x01;

/// General-discoverable LE-only advertising flags.
pub const FLAGS_VALUE: u8 = 0x06;

/// `length | type | flags` before the Reality2 Service Data structure.
pub const FLAGS_STRUCTURE_OVERHEAD: usize = 3;

/// Octets a legacy advertising payload carries.
///
/// Named because 5.2.3's requirement to use **extended** advertising is
/// arithmetic rather than preference, and [`fits_in_legacy_advertising`] is
/// the arithmetic.
pub const LEGACY_ADVERTISING_CAPACITY: usize = 31;

/// Octets an extended advertising payload carries.
pub const EXTENDED_ADVERTISING_CAPACITY: usize = 254;

/// Overhead before any body: one length octet, one type octet, sixteen of UUID.
pub const STRUCTURE_OVERHEAD: usize = 1 + 1 + 16;

/// Full connectable advertising-data overhead before the announcement body.
pub const ADVERTISING_OVERHEAD: usize = FLAGS_STRUCTURE_OVERHEAD + STRUCTURE_OVERHEAD;

/// Why an advertisement could not be assembled.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AdvertError {
    /// The output buffer is shorter than the structure.
    TooSmall { needed: usize },
    /// The whole structure exceeds what extended advertising carries.
    ///
    /// **Not reachable by any body this corpus defines** — the mandatory body
    /// is fifteen octets and the ceiling is 254 — and present because a
    /// silently truncated advertisement is a well-formed advertisement
    /// carrying a body that is not the one the hive meant to send.
    TooLongForExtendedAdvertising { needed: usize },
}

/// Assemble connectable advertising data carrying `body`.
///
/// The Service Data structure remains the binding's discovery marker. Flags
/// are a separate, required BLE structure; treating the marker as the complete
/// advertising payload made a real controller's valid connectable payload look
/// foreign to our scanner.
///
/// Returns the octets written.
pub fn advertising_data(body: &[u8], out: &mut [u8]) -> Result<usize, AdvertError> {
    let needed = ADVERTISING_OVERHEAD + body.len();
    if needed > EXTENDED_ADVERTISING_CAPACITY {
        return Err(AdvertError::TooLongForExtendedAdvertising { needed });
    }
    if out.len() < needed {
        return Err(AdvertError::TooSmall { needed });
    }

    out[0] = 2;
    out[1] = AD_TYPE_FLAGS;
    out[2] = FLAGS_VALUE;
    // The length octet counts the type and the data, not itself.
    out[FLAGS_STRUCTURE_OVERHEAD] = (STRUCTURE_OVERHEAD - 1 + body.len()) as u8;
    out[FLAGS_STRUCTURE_OVERHEAD + 1] = AD_TYPE_SERVICE_DATA_128;
    // Least-significant octet first — see the module header.
    for (i, b) in MARKER_UUID.iter().rev().enumerate() {
        out[FLAGS_STRUCTURE_OVERHEAD + 2 + i] = *b;
    }
    out[ADVERTISING_OVERHEAD..needed].copy_from_slice(body);
    Ok(needed)
}

/// Whether an announcement of `body_len` octets would fit a **legacy**
/// advertisement.
///
/// ‼ **5.2.3 IS ARITHMETIC, NOT PREFERENCE, AND THIS IS THE ARITHMETIC.** The
/// structure costs eighteen octets before any body, the mandatory body is
/// fifteen, and legacy carries thirty-one. *Thirty-three into thirty-one does
/// not go* — which is why the binding requires extended advertising and
/// therefore Bluetooth 5.0, and why a 4.x device **cannot satisfy this
/// binding at all.**
pub const fn fits_in_legacy_advertising(body_len: usize) -> bool {
    ADVERTISING_OVERHEAD + body_len <= LEGACY_ADVERTISING_CAPACITY
}

/// Read the marker back out of an advertising data structure.
///
/// `None` where the structure is not ours — wrong type, wrong length, short —
/// which is Layer 2 **7.1.1 step 1** answered from the advertisement alone,
/// *before connecting, before a scan request and before parsing any frame.*
pub fn body_if_marked(advert: &[u8]) -> Option<&[u8]> {
    let mut at = 0;
    while at < advert.len() {
        let declared = *advert.get(at)? as usize;
        if declared == 0 {
            return None;
        }
        let end = at.checked_add(declared + 1)?;
        if end > advert.len() {
            return None;
        }
        if advert[at + 1] == AD_TYPE_SERVICE_DATA_128 && declared >= 17 {
            let uuid_start = at + 2;
            let uuid_end = uuid_start + 16;
            let mut expected = MARKER_UUID;
            expected.reverse();
            if advert[uuid_start..uuid_end] == expected {
                return Some(&advert[uuid_end..end]);
            }
        }
        at = end;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The mandatory body of 5.3: beacon identifier and class hash, plus the
    /// build-mode element a development image carries.
    const DEV_BODY_LEN: usize = 15;

    /// ‼ **5.2.3's ARITHMETIC, WHICH IS THE WHOLE REASON THE BINDING EXCLUDES
    /// BLUETOOTH 4.x.** *Thirty-six into thirty-one does not go.*
    #[test]
    fn the_announcement_does_not_fit_a_legacy_advertisement() {
        assert_eq!(STRUCTURE_OVERHEAD, 18, "one length, one type, sixteen UUID");
        assert_eq!(
            ADVERTISING_OVERHEAD + DEV_BODY_LEN,
            36,
            "the whole announcement"
        );
        assert!(!fits_in_legacy_advertising(DEV_BODY_LEN));
        // And the boundary, so the predicate is not simply always false.
        assert!(fits_in_legacy_advertising(10));
        assert!(!fits_in_legacy_advertising(11));
    }

    #[test]
    fn an_advertisement_round_trips_through_the_marker_check() {
        let body = [0xABu8; DEV_BODY_LEN];
        let mut out = [0u8; 64];
        let n = advertising_data(&body, &mut out).expect("assembles");
        assert_eq!(n, 36);
        assert_eq!(
            &out[..3],
            &[2, AD_TYPE_FLAGS, FLAGS_VALUE],
            "connectable BLE advertising carries Flags before Service Data"
        );
        assert_eq!(out[3], 32, "the Service Data length excludes its own octet");
        assert_eq!(out[4], AD_TYPE_SERVICE_DATA_128);
        assert_eq!(body_if_marked(&out[..n]), Some(&body[..]));
    }

    /// ‼ **THE UUID IS REVERSED ON THE WIRE, AND GETTING IT WRONG FAILS
    /// SILENTLY.** Bluetooth carries UUIDs in advertising data
    /// least-significant octet first; the binding prints the value in text
    /// order. *A marker written in the order it is printed produces a
    /// well-formed advertisement that no scanner ever matches* — nothing is
    /// malformed, ours simply never sees one of ours.
    #[test]
    fn the_marker_goes_on_the_wire_least_significant_octet_first() {
        let mut out = [0u8; 64];
        let n = advertising_data(&[], &mut out).expect("assembles");
        // The last UUID octet on the wire is the FIRST of the text form.
        assert_eq!(out[FLAGS_STRUCTURE_OVERHEAD + 2], MARKER_UUID[15]);
        assert_eq!(out[ADVERTISING_OVERHEAD - 1], MARKER_UUID[0]);
        // And the text order is what the binding prints: `52324e54…`.
        assert_eq!(&MARKER_UUID[..4], b"R2NT");

        // The negative: an advertisement carrying the UUID in text order is
        // NOT ours, which is what a scanner would conclude — correctly, and
        // uselessly.
        let mut wrong = out;
        wrong[FLAGS_STRUCTURE_OVERHEAD + 2..ADVERTISING_OVERHEAD].copy_from_slice(&MARKER_UUID);
        assert_eq!(
            body_if_marked(&wrong[..n]),
            None,
            "the un-reversed marker matches nothing, and silently"
        );
    }

    /// 7.1.1 step 1, answered from the advertisement alone. The negatives are
    /// the point: a scanner on a shared medium meets far more traffic that is
    /// not ours than traffic that is.
    #[test]
    fn traffic_that_is_not_ours_is_rejected_before_anything_is_parsed() {
        let mut out = [0u8; 64];
        let n = advertising_data(&[0x01, 0x02], &mut out).expect("assembles");

        // Wrong AD type.
        let mut other_type = out;
        other_type[4] = 0x16; // Service Data — 16-bit UUID
        assert_eq!(body_if_marked(&other_type[..n]), None);

        // A length octet that disagrees with the structure.
        let mut bad_len = out;
        bad_len[3] = 99;
        assert_eq!(body_if_marked(&bad_len[..n]), None);

        // Too short to hold a marker at all.
        assert_eq!(body_if_marked(&out[..4]), None);
        assert_eq!(body_if_marked(&[]), None);
    }

    /// A body too long is refused rather than truncated. **Not reachable by
    /// any body this corpus defines** — the ceiling is 254 and the mandatory
    /// body is fifteen — and present because a truncated advertisement is a
    /// well-formed advertisement carrying a body nobody meant to send.
    #[test]
    fn an_oversize_body_is_refused_rather_than_truncated() {
        let huge = [0u8; 300];
        let mut out = [0u8; 512];
        assert_eq!(
            advertising_data(&huge, &mut out),
            Err(AdvertError::TooLongForExtendedAdvertising { needed: 321 })
        );
        assert_eq!(out[0], 0, "and nothing partial was written");
    }

    #[test]
    fn a_short_buffer_refuses_and_names_what_it_needed() {
        let mut out = [0u8; 8];
        assert_eq!(
            advertising_data(&[0u8; 15], &mut out),
            Err(AdvertError::TooSmall { needed: 36 })
        );
    }

    /// **`BND2-011` (`L1-BINDING-BLE.md` 3.1): the marker is the 128-bit UUID
    /// `52324e54-0001-4000-8000-52324e540001`, carried as a *Service Data —
    /// 128-bit UUID* structure (AD type `0x21`).** The tests above compare the
    /// wire against `MARKER_UUID` and `AD_TYPE_SERVICE_DATA_128`, so a wrong
    /// constant agreed with itself; here the type octet and all sixteen marker
    /// octets are literals at their wire positions, on both the assembling and
    /// the scanning side. Goes red when any marker octet or the `0x21` changes
    /// value (e.g. `MARKER_UUID[6]` `0x40` → `0x41`, or
    /// `AD_TYPE_SERVICE_DATA_128` `0x21` → `0x22`).
    #[test]
    fn the_marker_and_ad_type_are_the_binding_s_literal_octets_on_the_wire() {
        // The binding's text form, least-significant octet first (3.1a): the
        // last group `52324e540001` leads, reversed; the first group
        // `52324e54` trails, reversed.
        const MARKER_ON_THE_WIRE: [u8; 16] = [
            0x01, 0x00, 0x54, 0x4e, 0x32, 0x52, // 52324e540001
            0x00, 0x80, // 8000
            0x00, 0x40, // 4000
            0x01, 0x00, // 0001
            0x54, 0x4e, 0x32, 0x52, // 52324e54
        ];
        let body = [0xC3u8; 5];
        let mut out = [0u8; 64];
        let n = advertising_data(&body, &mut out).expect("assembles");
        assert_eq!(
            n, 26,
            "flags (3) + length (1) + type (1) + UUID (16) + body (5)"
        );
        assert_eq!(out[3], 0x16, "the length counts type, UUID and body: 22");
        assert_eq!(out[4], 0x21, "3.1: AD type Service Data — 128-bit UUID");
        assert_eq!(
            out[5..21],
            MARKER_ON_THE_WIRE,
            "3.1: the marker, octet by octet"
        );
        assert_eq!(
            out[21..26],
            body,
            "3.1: the data field after the UUID is the body"
        );

        // The scanner side matches the same literal octets, so the two halves
        // are pinned to the document rather than to each other.
        let mut literal = [0u8; 26];
        literal[..5].copy_from_slice(&[0x02, 0x01, 0x06, 0x16, 0x21]);
        literal[5..21].copy_from_slice(&MARKER_ON_THE_WIRE);
        literal[21..].copy_from_slice(&body);
        assert_eq!(body_if_marked(&literal), Some(&body[..]));
    }

    /// **`BND2-069` (`L1-BINDING-BLE.md` 3.1a): the first octet on air shall
    /// be `0x01` and the last `0x52`.** The reversal test above proves the
    /// wire is `MARKER_UUID` backwards, not what it is: a marker ending in the
    /// wrong octet reverses just as well. Goes red when `MARKER_UUID[15]` is
    /// no longer `0x01` or `MARKER_UUID[0]` no longer `0x52` (e.g. `0x01` →
    /// `0x02`), or when the reversal is dropped.
    #[test]
    fn the_first_marker_octet_on_air_is_0x01_and_the_last_is_0x52() {
        let mut out = [0u8; 64];
        advertising_data(&[], &mut out).expect("assembles");
        let first_on_air = FLAGS_STRUCTURE_OVERHEAD + 2;
        let last_on_air = ADVERTISING_OVERHEAD - 1;
        assert_eq!(
            out[first_on_air], 0x01,
            "3.1a: the first marker octet on air"
        );
        assert_eq!(out[last_on_air], 0x52, "3.1a: the last marker octet on air");
    }
    /// ‼ **3.2 IS A FILTER AND A FILTER IS PROVED BY WHAT IT REJECTS.** *A
    /// receiver shall be able to reach the marker without connecting, without
    /// a scan request and without parsing any frame* — so `body_if_marked`
    /// answers from the advertisement alone, and the question that matters is
    /// whether it answers NO to somebody else's advertisement.
    ///
    /// The refutation was exact: deleting the marker equality check, so any
    /// service-data structure of that width is accepted as ours, left the
    /// named test green because **it asserted only the positive path**. A
    /// filter tested only on what it admits is not tested at all.
    ///
    /// Every negative below is well-formed BLE advertising data — right
    /// structure, right AD type, right width — differing only in the bytes the
    /// check exists to compare. *A malformed fixture would be rejected by the
    /// length arithmetic and prove nothing about the marker.*
    #[test]
    fn an_advertisement_that_is_not_ours_is_refused_by_the_marker_alone() {
        const BODY: [u8; 8] = [0xAA; 8];
        // len octet + AD type + 16 marker octets + body.
        let mut ours = [0u8; 2 + 16 + BODY.len()];
        ours[0] = (1 + 16 + BODY.len()) as u8;
        ours[1] = AD_TYPE_SERVICE_DATA_128;
        for (i, b) in MARKER_UUID.iter().rev().enumerate() {
            ours[2 + i] = *b;
        }
        ours[18..].copy_from_slice(&BODY);
        let body = BODY;
        assert_eq!(
            body_if_marked(&ours),
            Some(&body[..]),
            "precondition: our own advertisement is recognised"
        );

        // ‼ SOMEBODY ELSE'S SERVICE DATA: identical in every way except the
        //   sixteen octets the marker occupies.
        for flip in [0usize, 7, 15] {
            let mut theirs = ours;
            theirs[2 + flip] ^= 0xFF;
            assert_eq!(
                body_if_marked(&theirs),
                None,
                "a structure differing only at marker octet {flip} is not ours"
            );
        }

        // The byte ORDER is part of the marker, not a detail: the UUID goes on
        // air reversed, so an advertisement carrying it forwards is a different
        // service and must be refused.
        let mut forwards = ours;
        forwards[2..18].copy_from_slice(&MARKER_UUID);
        assert_eq!(
            body_if_marked(&forwards),
            None,
            "the marker is reversed on air; forwards is somebody else"
        );

        // A different AD type carrying our exact marker is also not ours: 3.2
        // names the structure as well as the value.
        let mut wrong_type = ours;
        wrong_type[1] = AD_TYPE_FLAGS;
        assert_eq!(body_if_marked(&wrong_type), None, "wrong AD type");
    }
}
