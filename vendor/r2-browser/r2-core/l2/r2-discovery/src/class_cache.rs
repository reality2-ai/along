//! **Learned class strings, and why one hive's class is never another's
//! (L2 5.5.3, 5.5.4, 7.2.1, 7.3.2).**
//!
//! # ‼ THIS CLAUSE PAIR EXISTS BECAUSE A DEPLOYED IMPLEMENTATION GOT IT
//! # WRONG, AND THE ATTACK NEEDED NO KEY
//!
//! Note 0 to 5.5.3, in the standard's own words: **the hash is not
//! collision-resistant and was never meant to carry a name.** *A deployed
//! implementation cached learned strings **keyed by hash** and served them
//! for every hive advertising that hash* — and because the hash is a 32-bit
//! non-cryptographic one, **an attacker could craft a string colliding with a
//! well-known class, pass the hash check honestly, and relabel every device
//! of that class on an operator's screen.** *No key and no delivery were
//! involved: the whole attack is a lie told to a human.*
//!
//! So this cache is **keyed by the peer, never by the hash.** A hash appears
//! in an entry only as the value the string was heard alongside, and there is
//! no lookup that takes a hash.
//!
//! # ‼ L4's OPPOSITE RULE IS NOT A CONTRADICTION AND MUST NOT BE COPIED HERE
//!
//! Note 3 says so explicitly: **L4 7.2.1 treats a hash match as a match and
//! survives collisions rather than preventing them, because *wrong delivery
//! is harmless delivery*** — a handler that does not understand an event
//! ignores it. **A wrong label is not harmless, because a person believes
//! it.** *Same hash width, same collision, opposite conclusion*, and an
//! implementer who carries one crate's reasoning into the other reproduces
//! the attack above.

use crate::l2::BeaconId;

/// One peer's learned class.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Learned<'a> {
    peer: BeaconId,
    class: &'a str,
    /// The hash this peer was advertising when the string was learned.
    ///
    /// ‼ **HELD TO DETECT STALENESS, NEVER TO SERVE A LOOKUP.** Nothing here
    /// finds an entry by hash — that is 5.5.3's forbidden step, and Note 0
    /// records it reached by exactly this route.
    heard_with_hash: u32,
}

/// What a beacon from a peer did to what this scanner holds (7.3.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BeaconEffect {
    /// **7.3.2: presence, and nothing else.** *For a peer already known, a
    /// beacon shall be treated as evidence of presence, and not as new
    /// information about class or capability.*
    PresenceOnly,
    /// The peer is advertising a **different** hash than the one its class
    /// was learned with, so the held string is stale and has been dropped.
    ///
    /// ‼ **DROPPED, NOT REPLACED.** 5.5.4 forbids replacing a held string *on
    /// the strength of a hash match alone*; a hash **mismatch** is evidence
    /// the class changed and no evidence at all of what it changed to. *The
    /// honest state is not knowing, and the scanner must ask again (7.2.2).*
    HeldClassNowStale,
    /// Nothing was held for this peer, so the beacon taught nothing.
    NothingHeld,
}

/// Class strings this scanner has learned, **keyed by peer**.
pub struct ClassCache<'a, const N: usize> {
    entries: [Option<Learned<'a>>; N],
}

impl<const N: usize> Default for ClassCache<'_, N> {
    fn default() -> Self {
        Self::new()
    }
}

impl<'a, const N: usize> ClassCache<'a, N> {
    pub const fn new() -> Self {
        Self { entries: [None; N] }
    }

    /// **Record a class string obtained by asking this peer (7.2.2).**
    ///
    /// ‼ **`learn_by_asking` AND ITS NAME IS THE AUDIT.** 5.5.3 says *a class
    /// learned from one hive is that hive's, and nothing else's* — a rule no
    /// type can enforce, because a string learned by asking and a string
    /// copied from another entry are the same bytes once they exist. So the
    /// only way in is named for the act 7.2.2 permits, and
    /// `git grep learn_by_asking` is how a reviewer checks nothing was
    /// copied across peers.
    pub fn learn_by_asking(
        &mut self,
        peer: BeaconId,
        class: &'a str,
        heard_with_hash: u32,
    ) -> bool {
        for e in self.entries.iter_mut().flatten() {
            if e.peer == peer {
                e.class = class;
                e.heard_with_hash = heard_with_hash;
                return true;
            }
        }
        for slot in self.entries.iter_mut() {
            if slot.is_none() {
                *slot = Some(Learned {
                    peer,
                    class,
                    heard_with_hash,
                });
                return true;
            }
        }
        false
    }

    /// **The class of THIS peer, if this scanner learned it from THIS peer**
    /// (5.5.3).
    ///
    /// There is deliberately no `class_for_hash`. *A lookup by hash is the
    /// forbidden step, and the way to not take it is to not have it.*
    pub fn class_of(&self, peer: BeaconId) -> Option<&'a str> {
        self.entries
            .iter()
            .flatten()
            .find(|e| e.peer == peer)
            .map(|e| e.class)
    }

    /// **7.2.1: match a class by any part of it — a family, a supplier, a
    /// role shared across suppliers — on the class ITSELF and not on a
    /// hash.**
    ///
    /// The predicate is given the **string**, so a caller cannot match on a
    /// hash through this door even by mistake. A peer whose class this
    /// scanner has not learned answers `false`: *not knowing is not a
    /// match*, and 7.2.2 says to ask.
    pub fn matches(&self, peer: BeaconId, predicate: impl Fn(&str) -> bool) -> bool {
        self.class_of(peer).is_some_and(predicate)
    }

    /// **7.3.2: a beacon from an already-known peer is presence, not news.**
    ///
    /// Returns what the beacon did. It never installs a class — *a beacon
    /// carries a hash and 5.5.2 forbids reading a class out of one.*
    pub fn note_beacon(&mut self, peer: BeaconId, advertised_hash: u32) -> BeaconEffect {
        for slot in self.entries.iter_mut() {
            let Some(e) = slot else { continue };
            if e.peer != peer {
                continue;
            }
            if e.heard_with_hash == advertised_hash {
                // 7.3.2: evidence of presence, and NOT new information about
                // class or capability.
                return BeaconEffect::PresenceOnly;
            }
            *slot = None;
            return BeaconEffect::HeldClassNowStale;
        }
        BeaconEffect::NothingHeld
    }

    /// Forget what was learned about a peer.
    pub fn forget(&mut self, peer: BeaconId) -> bool {
        for slot in self.entries.iter_mut() {
            if slot.as_ref().is_some_and(|e| e.peer == peer) {
                *slot = None;
                return true;
            }
        }
        false
    }

    pub fn len(&self) -> usize {
        self.entries.iter().flatten().count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(n: u8) -> BeaconId {
        BeaconId::new(&[n, n, n, n]).expect("four octets")
    }

    /// ‼ **THE ATTACK NOTE 0 RECORDS, AND IT NEEDS NO KEY.** *A deployed
    /// implementation cached learned strings keyed by hash and served them
    /// for every hive advertising that hash* — so an attacker crafting a
    /// string that collides with a well-known class could **pass the hash
    /// check honestly and relabel every device of that class on an
    /// operator's screen.** *The whole attack is a lie told to a human.*
    #[test]
    fn a_class_learned_from_one_hive_is_never_served_for_another() {
        let mut c: ClassCache<4> = ClassCache::new();
        let honest = peer(1);
        let attacker = peer(2);
        const COLLIDING_HASH: u32 = 0xE9F2_A935;

        c.learn_by_asking(honest, "acme/thermostat/v2", COLLIDING_HASH);

        // The attacker advertises the SAME hash. It must gain nothing.
        assert_eq!(
            c.class_of(attacker),
            None,
            "5.5.3: a class learned from one hive is that hive's, and nothing else's"
        );
        assert!(
            !c.matches(attacker, |class| class.starts_with("acme/")),
            "and it must not match the family either"
        );
        // The honest peer keeps its own.
        assert_eq!(c.class_of(honest), Some("acme/thermostat/v2"));
        assert!(c.matches(honest, |class| class.starts_with("acme/")));
    }

    /// **5.5.4: a held string is not replaced on the strength of a hash match
    /// alone** — and a hash MISMATCH drops it rather than replacing it,
    /// because *a mismatch is evidence the class changed and no evidence at
    /// all of what it changed to.* The honest state is not knowing.
    #[test]
    fn a_beacon_never_installs_or_replaces_a_class() {
        let mut c: ClassCache<4> = ClassCache::new();
        let p = peer(1);

        // Nothing held: a beacon teaches nothing at all.
        assert_eq!(c.note_beacon(p, 0x1111_1111), BeaconEffect::NothingHeld);
        assert_eq!(c.class_of(p), None, "5.5.2: no class is read out of a hash");

        c.learn_by_asking(p, "acme/thermostat/v2", 0x1111_1111);

        // Same hash: presence only, and the string is untouched.
        assert_eq!(c.note_beacon(p, 0x1111_1111), BeaconEffect::PresenceOnly);
        assert_eq!(c.class_of(p), Some("acme/thermostat/v2"));

        // Different hash: the held string is stale and goes. Nothing takes
        // its place.
        assert_eq!(
            c.note_beacon(p, 0x2222_2222),
            BeaconEffect::HeldClassNowStale
        );
        assert_eq!(
            c.class_of(p),
            None,
            "dropped, not replaced — the scanner must ask again (7.2.2)"
        );
    }

    /// ‼ **7.2.1: MATCHING IS ON THE CLASS ITSELF.** The predicate is handed
    /// the **string**, so a caller cannot match on a hash through this door
    /// even by mistake — *and there is deliberately no lookup that takes a
    /// hash, because the way to not take a forbidden step is to not have
    /// it.*
    #[test]
    fn matching_is_on_the_class_string_and_a_family_match_works() {
        let mut c: ClassCache<4> = ClassCache::new();
        c.learn_by_asking(peer(1), "acme/thermostat/v2", 1);
        c.learn_by_asking(peer(2), "acme/valve/v1", 2);
        c.learn_by_asking(peer(3), "other/thermostat/v9", 3);

        // A family across suppliers.
        assert!(c.matches(peer(1), |s| s.contains("/thermostat/")));
        assert!(c.matches(peer(3), |s| s.contains("/thermostat/")));
        assert!(!c.matches(peer(2), |s| s.contains("/thermostat/")));

        // A supplier.
        assert!(c.matches(peer(1), |s| s.starts_with("acme/")));
        assert!(!c.matches(peer(3), |s| s.starts_with("acme/")));

        // ‼ NOT KNOWING IS NOT A MATCH. 7.2.2 says to ask.
        assert!(!c.matches(peer(9), |_| true));
    }

    /// Asking again updates that peer's own entry, and touches no other.
    #[test]
    fn asking_again_updates_only_that_peer() {
        let mut c: ClassCache<4> = ClassCache::new();
        c.learn_by_asking(peer(1), "acme/thermostat/v2", 1);
        c.learn_by_asking(peer(2), "acme/thermostat/v2", 1);

        c.learn_by_asking(peer(1), "acme/thermostat/v3", 5);
        assert_eq!(c.class_of(peer(1)), Some("acme/thermostat/v3"));
        assert_eq!(
            c.class_of(peer(2)),
            Some("acme/thermostat/v2"),
            "two peers may share a class string and are still two entries"
        );
        assert_eq!(c.len(), 2);

        assert!(c.forget(peer(1)));
        assert_eq!(c.class_of(peer(1)), None);
        assert_eq!(c.class_of(peer(2)), Some("acme/thermostat/v2"));
    }

    /// A full cache reports rather than dropping silently: a scanner that
    /// believes it learned a class and holds none would ask, be answered,
    /// and forget — *presenting as an unresponsive peer.*
    #[test]
    fn a_full_cache_says_so() {
        let mut c: ClassCache<2> = ClassCache::new();
        assert!(c.learn_by_asking(peer(1), "a", 1));
        assert!(c.learn_by_asking(peer(2), "b", 2));
        assert!(!c.learn_by_asking(peer(3), "c", 3));
        assert_eq!(c.len(), 2);
    }
    /// ‼ **5.5.2: A SCANNER SHALL NOT RECOVER A CLASS FROM A HASH, AND THE
    /// VIOLATION IS SPECIFICALLY A COPY BETWEEN PEERS.** The hash is not
    /// invertible, so nobody would write an inverter — *the realistic breach
    /// is a lookup table*: peer A's class is known and hashes to H, peer B
    /// beacons with H, and B is credited with A's class. That is recovering a
    /// class from a hash by another name, and it is what the refutation
    /// injected (2026-09-04) while the whole module stayed green.
    ///
    /// The old falsifier could not see it because `note_beacon` was only ever
    /// exercised with ONE peer in the cache, so there was nothing to copy from.
    /// This puts a second peer there first, which is the only arrangement in
    /// which the breach is expressible.
    #[test]
    fn a_beacon_never_credits_one_peer_with_another_peers_class() {
        const H: u32 = 0xDEAD_BEEF;
        let a = BeaconId::new(&[1, 1, 1, 1]).expect("4 octets");
        let b = BeaconId::new(&[2, 2, 2, 2]).expect("4 octets");
        let mut cache: ClassCache<4> = ClassCache::new();

        // A's class was learned the one way 7.2.2 permits, and it hashes to H.
        assert!(cache.learn_by_asking(a, "nz.example.sentant.level", H));
        assert_eq!(cache.class_of(a), Some("nz.example.sentant.level"));

        // ‼ B ANNOUNCES THE SAME HASH. A hive that answered `class_of(b)` with
        //   A's class would have recovered a class from a hash.
        assert_eq!(cache.note_beacon(b, H), BeaconEffect::NothingHeld);
        assert_eq!(
            cache.class_of(b),
            None,
            "‼ 5.5.2: the same hash is not the same peer, and a beacon is not an answer"
        );
        assert!(
            !cache.matches(b, |c| c.starts_with("nz.example")),
            "and no predicate may be satisfied through a hash either"
        );

        // A's entry is untouched, so the assertion above is about B rather
        // than about a cache that lost everything.
        assert_eq!(cache.class_of(a), Some("nz.example.sentant.level"));
        assert_eq!(cache.len(), 1, "B was never installed at all");

        // THE CONTROL: asking B directly IS how it becomes known (7.2.2), and
        // the answer is B's own, not a copy of A's.
        assert!(cache.learn_by_asking(b, "nz.example.sentant.gate", H));
        assert_eq!(cache.class_of(b), Some("nz.example.sentant.gate"));
        assert_eq!(
            cache.class_of(a),
            Some("nz.example.sentant.level"),
            "two peers sharing a hash keep their own classes"
        );
    }
}
