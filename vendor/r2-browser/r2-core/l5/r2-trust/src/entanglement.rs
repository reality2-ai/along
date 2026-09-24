//! **L5A: the agreement artefact an entanglement is recorded in** (4.1.1).
//!
//! ‼ **WHY THIS EXISTS AT ALL, AND IT IS NOT THE ROW COUNT.** Five rows in
//! this lane's matrix are marked `CLOSED` under `01-terminology` 4.7: every
//! input to their demonstration was produced by the implementation under
//! test, **because nothing anywhere can produce an entanglement.** The gate
//! has never seen a real one. *The acceptance criterion for this work is
//! that those five demonstrations stop being closed* — **if this closes
//! forty-two rows and the gate still consumes only manufactured
//! entanglements, it has not done the thing it was authorised for**
//! (the supervisor's, `d585`).
//!
//! # The one property everything else rests on
//!
//! **4.1.2 binds the conditions INTO the signed thing**, and Note 1 says
//! why: *terms that travelled beside a signature rather than under it could
//! drift apart from it.* So [`Artefact::signed_terms`] is the whole
//! agreement — scope, grade, conditions, lifetime — and **there is no way
//! to sign a subset**, because the function takes no selector.
//!
//! # What this file deliberately does NOT decide
//!
//! **Clause questions go to `standard` as questions** (`d547`'s rule:
//! settling a corpus matter by writing code is what that ruling refused).
//! Where the corpus is silent here, the type carries the narrowest form
//! that cannot pretend to an answer.

use crate::certificate::Epoch;
use crate::crypto::Verifier;
use crate::evidence::{
    verify_evidence, EvidenceRefusal, HighWaterMarks, MemberEvidence, MAX_STATEMENT,
};
use crate::gate::Grade;
use crate::identity::Identity;

/// What may cross, and in which direction (4.1.1, L5A 7).
///
/// **A direction is part of the scope rather than a property of a
/// crossing**: 5.1.1 e) requires a trial *in each contracted direction*, so
/// a one-way agreement has one trial and a two-way agreement has two.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    /// Only from the group that proposed, to the counterpart.
    OutboundOnly,
    /// Only from the counterpart to the proposing group.
    InboundOnly,
    /// Both, and 5.1.1 e) therefore requires two trial crossings.
    Both,
}

/// How a condition's failure is answered (6.1.1 c).
///
/// ‼ **LAPSE IS WITHOUT FAULT AND BREACH IS EVIDENCE ABOUT CONDUCT** (6.2.1,
/// 6.2.2), so this is not a severity ordering and must not be compared as
/// one. *6.2.3: a condition whose failure can occur innocently — presence
/// fading, a lifetime ending, a scope completing — **shall** be classed as
/// lapse.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FailureClass {
    /// Ends **or suspends** without fault (6.2.1).
    ///
    /// ‼ **6.2.1 GIVES A LAPSE TWO OUTCOMES AND THE ARTEFACT'S TERMS
    /// DECIDE WHICH**: *a lapse shall END the entanglement, or SUSPEND it
    /// where the artefact stands and its terms permit resumption.* A
    /// variant without this flag would have silently chosen one — **an
    /// invented term, not an omitted one.**
    ///
    /// *Note 1: suspension and key destruction are not in conflict, because
    /// **the keys are not the entanglement.*** Either way the derived keys
    /// are destroyed as 8.2 requires; a suspended entanglement resumes only
    /// by re-derivation under 5.2.4, which is the same mechanism 8.5 already
    /// relies on to survive a restart.
    Lapse { resumable: bool },
    /// Answered by severance (L5 10.3).
    BreachSever,
    /// Answered by demotion to the named grade (L5 10.3.2), which is why
    /// the grade is carried rather than implied: *`STD-SS364` corrected
    /// 10.3.2 from "the lower level" to "the level the conditions name for
    /// that breach", so one step down is not the rule.*
    BreachDemoteTo(Grade),
    /// ‼ **REFUSAL (6.2.5), THE THIRD CLASS** — *refuse the crossing whose
    /// requirements were unmet, and affect nothing else: **the
    /// entanglement stands, the derived keys are NOT destroyed, and no
    /// standing is affected.***
    ///
    /// **This did not exist at 09:00 and does now**, because 6.3.1's table
    /// gave the transactional class a failure class of *neither* while
    /// 6.1.1 c) admitted two. `standard` landed 6.2.5 at `b413051`
    /// (`STD-SS368`, PROVISIONAL) after testing my proposed alternative and
    /// **rejecting it on a test rather than a preference**: *no value of the
    /// two is TRUE of a transactional condition.* Lapse ends or suspends
    /// and destroys derived keys; breach severs or demotes; **refusal does
    /// neither.** And classing it lapse — which 6.2.3's innocent-failure
    /// rule would otherwise suggest, an underauthenticated payment being
    /// plainly innocent — *would tear down a relationship over one
    /// payment*, which 6.3.1 Note 1 refuses in terms: **the amount ladder
    /// never tears the relationship down, it prices each act.**
    ///
    /// *An artefact may state that repeated refusal is breach; that is a
    /// separate condition, not a property of this one.*
    RefusesTheCrossing,
}

/// The condition vocabulary (6.3.1).
///
/// ‼ **6.3.1: A CLASS AN IMPLEMENTATION DOES NOT SUPPORT IS A CONDITION IT
/// SHALL NOT AGREE TO** — so the class is a **term**, inside the signed
/// span, and a group states which classes it supports before adopting.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConditionClass {
    /// The counterpart hearable on named bearers; evidence is sightings and
    /// fade behaviour (L2 6.3). Typically **lapse**.
    Presence,
    /// A window or lifetime; evidence is *the ruler of the side that holds
    /// one* (6.1.3). Typically **lapse**.
    Temporal,
    /// Requirements per crossing — an authentication level per operation or
    /// amount, member-attributable evidence per event class.
    ///
    /// ‼ **THE CLASS THAT FORCED A CORPUS CHANGE TODAY.** 6.3.1's table
    /// gave this class a failure class of *neither* while 6.1.1 c) admitted
    /// two — three sentences said two, one table cell said neither, and
    /// **6.3.1 Note 1's payment ladder could not be written.** `standard`
    /// landed **6.2.5 refusal** at `b413051` in answer
    /// ([`FailureClass::RefusesTheCrossing`]), which is what this class now
    /// uses. *Note 1: the amount ladder never tears the relationship down,
    /// it prices each act.*
    Transactional,
    /// Obligations on use of what crossed — licence, redistribution,
    /// retention. Typically **breach**. *Note 2: the artefact makes conduct
    /// judgeable; it does not make judgement automatic.*
    Conduct,
    /// Grants of visibility — the member-key set (L5 7.4.4), class and
    /// capability queries, catalogue listing.
    ///
    /// ‼ **6.3.2: A DISCLOSURE GRANT SHALL BE EXPLICIT, AND NO DISCLOSURE
    /// SHALL BE INFERRED FROM ANY OTHER CONDITION OR FROM THE
    /// ENTANGLEMENT'S EXISTENCE.** Which is why disclosure is a class a
    /// condition must **name**: nothing anywhere derives one.
    Disclosure,
    /// Contracted liveness — an expected keepalive under Clause 7.
    /// **Lapse, by 6.2.4**, never breach.
    Reciprocity,
}

/// One condition of an artefact (6.1.1).
///
/// ‼ **ALL THREE PARTS ARE REQUIRED BY THE CLAUSE AND ALL THREE ARE
/// FIELDS.** A condition missing its failure class would be one whose
/// breach nobody could answer, and *an `Option` here would let a caller
/// build exactly that.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Condition<'a> {
    /// Which class of the 6.3.1 vocabulary this is.
    pub class: ConditionClass,
    /// a) what is claimed to hold.
    pub predicate: &'a str,
    /// b) what each side evaluates it against.
    ///
    /// **6.1.2: each group evaluates locally against its OWN evidence**, and
    /// *no condition shall require a shared evaluator, an arbiter, or the
    /// counterpart's agreement to fail.* This names the kind of evidence,
    /// never a place to fetch it from.
    pub evidence: &'a str,
    /// c) how its failure is answered.
    pub failure: FailureClass,
}

/// The agreement artefact (4.1.1): **one artefact stating scope, grade,
/// conditions and intended lifetime.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Artefact<'a> {
    /// What may cross, in which direction.
    pub scope: Direction,
    /// The grade the counterpart's identity is verified at (5.3).
    pub grade: Grade,
    /// The conditions, **inside the signed terms** (4.1.2).
    pub conditions: &'a [Condition<'a>],
    /// The intended lifetime, as an epoch beyond which the agreement is not
    /// intended to stand.
    ///
    /// **Epochs rather than a clock**, consistent with every other
    /// time-shaped value in this crate: nothing in the trust path reads a
    /// wall clock, and a lifetime in seconds would import one.
    pub lifetime: Epoch,
}

/// Why an artefact cannot be used.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ArtefactRefusal {
    /// ‼ **6.2.4: NO CONDITION SHALL CLASS SILENCE AS BREACH**, and
    /// *unreachability shall only ever lapse.* Refused at construction
    /// rather than at evaluation, because by evaluation time the wrong
    /// answer has already been reached.
    SilenceClassedAsBreach { predicate: &'static str },
    /// More conditions than this build can carry.
    TooManyConditions,
    /// ‼ **6.3.1: A CLASS AN IMPLEMENTATION DOES NOT SUPPORT IS A CONDITION
    /// IT SHALL NOT AGREE TO.** *Refused at adoption, because agreeing to a
    /// condition you cannot evaluate is agreeing to a term you will never
    /// know you have broken.*
    UnsupportedClass { class: ConditionClass },
    /// ‼ **6.1.3: THE EVIDENCE REQUIRES A FACILITY THIS PLATFORM HAS NOT
    /// DECLARED** (L0 Clause 8).
    ///
    /// *Note 1: this is why there is no absolute-time trap. A condition
    /// anchored to calendar time is adoptable by the venue with a clock and
    /// not by the sensor without one — **the condition vocabulary bends to
    /// the platform declaration, never the reverse. The party that holds
    /// the ruler makes the measurement.***
    UndeclaredFacility { class: ConditionClass },
    /// ‼ **The terms do not fit in a signable statement.**
    ///
    /// **THIS EXISTS BECAUSE TWO BOUNDS DISAGREED AND ONE OF THEM WAS
    /// SILENT.** [`MAX_CONDITIONS`] is 8; [`MAX_STATEMENT`] is 256. Eight
    /// conditions with ordinary wording — a 24-character predicate, a
    /// 20-character evidence name — serialise to **412 bytes**, so a
    /// caller could build an artefact that passed [`Artefact::admissible`]
    /// and that **nobody could sign**. Admissibility now means adoptable,
    /// and adoptable includes signable, *because a check that says yes to
    /// something the next step cannot do is worse than no check.*
    ///
    /// Whether [`MAX_STATEMENT`] should rise instead is a memory-budget
    /// question for the platform that runs this, not a conformance one:
    /// the corpus states no maximum. **Routed to `hive` rather than
    /// decided here.**
    TermsTooLongToSign,
}

/// The most conditions an artefact may carry here. **A representation
/// bound, never a conformance one** — the corpus states no maximum.
///
/// ‼ **AND IT IS NOT INDEPENDENTLY REACHABLE.** Eight conditions only fit a
/// signable statement if the wording is short: 8 × (24-char predicate +
/// 20-char evidence) is **412 bytes** against a [`MAX_STATEMENT`] of 256.
/// [`ArtefactRefusal::TermsTooLongToSign`] is what makes that interaction
/// visible instead of silent.
pub const MAX_CONDITIONS: usize = 8;

/// What a group can support, for 6.3.1 and 6.1.3.
///
/// ‼ **BOTH HALVES ARE THE GROUP'S OWN FACTS AND NEITHER IS NEGOTIABLE
/// WITH THE COUNTERPART.** 6.1.2 has each group evaluate *locally, against
/// its own evidence*, so what it can evaluate at all is a local question —
/// **a counterpart cannot grant a facility, and cannot argue a class into
/// support.**
#[derive(Clone, Copy, Debug)]
pub struct Support {
    /// The classes of 6.3.1 this group agrees to (in vocabulary order:
    /// presence, temporal, transactional, conduct, disclosure,
    /// reciprocity).
    pub classes: [bool; 6],
    /// ‼ **A RULER** — L0 Clause 8's declaration of a clock. *The only
    /// facility the corpus names by example*, in 6.1.3 Note 1, and the only
    /// one modelled here: **inventing the rest would be this crate deciding
    /// what L0 declares.**
    pub holds_a_ruler: bool,
}

impl Support {
    /// Everything supported and a clock held — for callers that have no
    /// constraint to express. **Not a `Default`**: *a default would let a
    /// caller adopt conditions it cannot evaluate by saying nothing.*
    pub const fn unconstrained() -> Self {
        Self {
            classes: [true; 6],
            holds_a_ruler: true,
        }
    }

    fn supports(&self, class: ConditionClass) -> bool {
        self.classes[class as usize]
    }
}

impl<'a> Artefact<'a> {
    /// **The identical terms both sides sign** (4.1.2), fed to a sink in a
    /// fixed order.
    ///
    /// ‼ **THERE IS NO WAY TO SIGN A SUBSET**: this takes no selector, so a
    /// caller cannot sign the scope and omit a condition. *Note 1 to 4.1.2:
    /// terms that travelled beside a signature rather than under it could
    /// drift apart from it.*
    ///
    /// ‼ **AND BOTH SIDES MUST PRODUCE THE SAME BYTES FROM THE SAME
    /// AGREEMENT**, which is why the order is fixed here rather than left
    /// to a caller: *5.1.1 b) says the groups exchange revisions until the
    /// terms are IDENTICAL, and identical is a property of these bytes.*
    pub fn signed_terms(&self, sink: &mut dyn FnMut(&[u8])) {
        sink(&[self.scope as u8]);
        sink(&[self.grade as u8]);
        sink(&self.lifetime.0.to_be_bytes());
        sink(&(self.conditions.len() as u16).to_be_bytes());
        for c in self.conditions {
            // The class is a TERM: 6.3.1 lets a group refuse a class
            // outright, so which class a condition is cannot be outside
            // what both sides signed.
            sink(&[c.class as u8]);
            sink(&(c.predicate.len() as u16).to_be_bytes());
            sink(c.predicate.as_bytes());
            sink(&(c.evidence.len() as u16).to_be_bytes());
            sink(c.evidence.as_bytes());
            let f: [u8; 2] = match c.failure {
                FailureClass::Lapse { resumable } => [0, resumable as u8],
                FailureClass::BreachSever => [1, 0],
                FailureClass::BreachDemoteTo(g) => [2, g as u8],
                FailureClass::RefusesTheCrossing => [3, 0],
            };
            sink(&f);
        }
    }

    /// Write the terms into a caller's buffer, for a signer.
    ///
    /// ‼ **`None` RATHER THAN A SHORT WRITE**, for the reason recorded at
    /// [`EvidenceRefusal::StatementTooLong`]: the evidence path used to
    /// clamp an overlong statement, so **a signature covered a prefix of
    /// what the signer believed it covered.** *Note 1 to 4.1.2 names that
    /// hazard one layer up, and a truncating serialiser here would recreate
    /// it one layer down.*
    pub fn write_terms(&self, out: &mut [u8]) -> Option<usize> {
        let mut pos = 0usize;
        let mut overflow = false;
        self.signed_terms(&mut |b| {
            if overflow || pos + b.len() > out.len() {
                overflow = true;
                return;
            }
            out[pos..pos + b.len()].copy_from_slice(b);
            pos += b.len();
        });
        if overflow || pos > MAX_STATEMENT {
            return None;
        }
        Some(pos)
    }

    /// Whether `candidate` **is** these terms, byte for byte (4.1.2).
    ///
    /// Streams against [`Self::signed_terms`] rather than buffering, so
    /// there is no size to get wrong.
    ///
    /// ‼ **A PREFIX IS NOT A MATCH.** The final length equality is
    /// load-bearing: without it, a candidate carrying these terms *and
    /// something after them* would pass, and a signature over
    /// `terms ‖ anything` would be accepted as a signature over the terms.
    ///
    /// Not constant-time, deliberately: **the terms are the agreement, and
    /// both sides already hold them.** Nothing secret is compared here, and
    /// L5 10.1.3's constant-time requirement is about tags and keys.
    pub fn terms_are(&self, candidate: &[u8]) -> bool {
        let mut pos = 0usize;
        let mut ok = true;
        self.signed_terms(&mut |b| {
            if !ok {
                return;
            }
            if pos + b.len() > candidate.len() || &candidate[pos..pos + b.len()] != b {
                ok = false;
                return;
            }
            pos += b.len();
        });
        ok && pos == candidate.len()
    }

    /// Check the artefact against **this group's own support** (6.3.1) and
    /// **its declared facilities** (6.1.3), as well as everything
    /// [`Self::admissible`] checks.
    ///
    /// ‼ **THE TWO SIDES MAY ANSWER DIFFERENTLY AND THAT IS NOT A BUG**:
    /// 6.4.1 says the sides may reach different conclusions and *an
    /// implementation shall tolerate the asymmetry.* This function takes
    /// **one** group's support because there is no other kind — a version
    /// taking both would be 6.1.2's forbidden shared evaluator.
    pub fn admissible_for(&self, support: &Support) -> Result<(), ArtefactRefusal> {
        self.admissible()?;
        for c in self.conditions {
            if !support.supports(c.class) {
                return Err(ArtefactRefusal::UnsupportedClass { class: c.class });
            }
            // 6.1.3, for the one facility the corpus names: a temporal
            // condition is measured against *the ruler of the side that
            // holds one*, so a side with no ruler cannot adopt it.
            if c.class == ConditionClass::Temporal && !support.holds_a_ruler {
                return Err(ArtefactRefusal::UndeclaredFacility { class: c.class });
            }
        }
        Ok(())
    }

    /// Check the artefact is one a group may adopt.
    ///
    /// **6.2.4 is the check that cannot be deferred**: a condition classing
    /// silence as breach is refused here, because *by the time it is
    /// evaluated the entanglement has already been severed over a peer
    /// being asleep.*
    pub fn admissible(&self) -> Result<(), ArtefactRefusal> {
        if self.conditions.len() > MAX_CONDITIONS {
            return Err(ArtefactRefusal::TooManyConditions);
        }
        for c in self.conditions {
            // ‼ **BOTH SENTENCES OF 6.2.4, AND I HAD ONLY TESTED THE
            // FIRST.** *No condition shall class silence as breach* — and
            // then *unreachability shall only ever lapse*, which excludes
            // REFUSAL as surely as it excludes breach. When 6.2.5 arrived I
            // measured the loosening against the first sentence alone and
            // reported an admissible silence-shaped refusal; `standard`
            // answered from the second (`4adc08f`, Note 3), which my
            // control had not tested. **The text needed no repair to hold —
            // my check did.**
            if !matches!(c.failure, FailureClass::Lapse { .. }) && names_silence(c.predicate) {
                return Err(ArtefactRefusal::SilenceClassedAsBreach {
                    predicate: "a silence-shaped predicate classed as breach",
                });
            }
        }
        // ‼ MEASURED RATHER THAN ESTIMATED: the terms are serialised to
        // count them, so this cannot drift from what `write_terms` does.
        // A conservative arithmetic bound here would be a second
        // implementation of the encoding, and the two would disagree the
        // first time either changed.
        let mut len = 0usize;
        self.signed_terms(&mut |b| len += b.len());
        if len > MAX_STATEMENT {
            return Err(ArtefactRefusal::TermsTooLongToSign);
        }
        Ok(())
    }
}

/// A signed agreement: **one artefact, two signatures** (4.1.2).
///
/// ‼ **THE ARTEFACT IS HELD ONCE AND THE EVIDENCE POINTS AT IT.** Each
/// party's [`MemberEvidence::statement`] must BE
/// [`Artefact::signed_terms`] — checked, not assumed. *There is no field
/// here for "the terms party B thought it was signing", because a struct
/// with two sets of terms in it is the drift Note 1 forbids, made
/// representable.*
pub struct SignedArtefact<'a> {
    /// The agreement itself, held once.
    pub artefact: Artefact<'a>,
    /// The two participating groups' evidence (4.1.2), in no particular
    /// order — **neither side is privileged**, and 4.2.2's burden falls the
    /// same way for both.
    pub parties: [Party<'a>; 2],
}

/// One participating group's signature on the agreement.
pub struct Party<'a> {
    /// The group being bound.
    pub group: Identity,
    /// Member-attributable evidence (L5 7.4) from that group.
    ///
    /// **Note 2 to 4.1.2: this names the member key that signed**, so that
    /// *when conduct is later judged, the claim "your side agreed to this"
    /// is checkable against a signature* rather than a recollection.
    pub evidence: MemberEvidence<'a>,
    /// Facts about the certificate that the caller — not this function —
    /// establishes: see [`crate::certificate::standing`].
    pub cert_authentic: bool,
    /// Likewise.
    pub cert_is_current: bool,
    /// The nonce this verifier issued for this exchange, if the evidence
    /// carries the interactive freshness form.
    pub expected_nonce: Option<[u8; 16]>,
}

/// Why a signed agreement is not one this group may adopt.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AdoptionRefusal {
    /// The artefact itself is inadmissible — see [`Artefact::admissible`].
    Inadmissible(ArtefactRefusal),
    /// ‼ **THIS IS 4.1.2 ITSELF.** A party's evidence is over something
    /// that is not these terms. *Its signature may verify perfectly and
    /// still attest to a different agreement* — which is exactly the
    /// dispute Note 1 says the clause exists to prevent: *a dispute would
    /// then be about which terms were agreed rather than whether they were
    /// met.*
    TermsDiffer { party: u8 },
    /// Both pieces of evidence name the same group. **4.1.2 requires
    /// evidence from EACH PARTICIPATING GROUP**, and one group signing
    /// twice is not an agreement with anyone.
    NotTwoGroups,
    /// A party's evidence did not verify (L5 7.4.2).
    Evidence { party: u8, refusal: EvidenceRefusal },
}

/// Verify a signed agreement: **admissible, over identical terms, by both
/// groups** (4.1.2, 6.2.4).
///
/// # What this deliberately does not take
///
/// ‼ **THERE IS NO AUTHORITY ARGUMENT, AND THAT IS 4.2.2.** *A counterpart
/// shall verify the signer's membership by the evidence of 4.1.2, and is
/// NOT REQUIRED TO VERIFY THE SIGNER'S INTERNAL AUTHORITY.* Note 1 says
/// where the burden falls and it falls inward: **a group is bound to its
/// counterparts by any member signature its counterpart accepted in good
/// faith.** A parameter for internal authority would invite a caller to
/// gate on something *it cannot audit* — another group's constitution —
/// and then refuse a binding agreement on a guess. **Asserted by
/// construction rather than by a test**, because the absence of a
/// parameter is not a thing a test can observe.
///
/// # Order, and why it is this order
///
/// 6.2.4 first, then the terms, then the signatures. **Checking a
/// signature before checking what it is over would establish a true fact
/// about the wrong subject** — the answer "this signature is valid" says
/// nothing until "valid over these terms" is settled.
pub fn verify_adoption<V: Verifier, const N: usize>(
    signed: &SignedArtefact<'_>,
    marks: &mut HighWaterMarks<N>,
) -> Result<[Identity; 2], AdoptionRefusal> {
    signed
        .artefact
        .admissible()
        .map_err(AdoptionRefusal::Inadmissible)?;

    if signed.parties[0].group == signed.parties[1].group {
        return Err(AdoptionRefusal::NotTwoGroups);
    }

    let mut signers = [Identity([0u8; crate::crypto::IDENTITY_LEN]); 2];
    for (i, p) in signed.parties.iter().enumerate() {
        if !signed.artefact.terms_are(p.evidence.statement) {
            return Err(AdoptionRefusal::TermsDiffer { party: i as u8 });
        }
        signers[i] = verify_evidence::<V, N>(
            &p.evidence,
            &p.group,
            p.cert_is_current,
            p.cert_authentic,
            p.expected_nonce.as_ref(),
            marks,
        )
        .map_err(|refusal| AdoptionRefusal::Evidence {
            party: i as u8,
            refusal,
        })?;
    }
    Ok(signers)
}

/// Whether a predicate is about a peer failing to speak.
///
/// ‼ **A HEURISTIC, AND SAID SO RATHER THAN IMPLIED.** 6.2.4 forbids
/// classing silence as breach and the corpus gives no machine-checkable
/// definition of *silence*, so this recognises the words the clause itself
/// uses — *unreachability, presence fading* — and **cannot recognise a
/// silence condition phrased another way.** The check is therefore a floor
/// on carelessness, not a guarantee; **the row that cites it must say so.**
fn names_silence(predicate: &str) -> bool {
    const MARKS: [&str; 4] = ["unreachab", "silence", "no contact", "presence"];
    let mut i = 0;
    while i < MARKS.len() {
        if contains_ascii_lower(predicate, MARKS[i]) {
            return true;
        }
        i += 1;
    }
    false
}

fn contains_ascii_lower(hay: &str, needle: &str) -> bool {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    if n.len() > h.len() {
        return false;
    }
    for start in 0..=h.len() - n.len() {
        let mut k = 0;
        while k < n.len() && h[start + k].to_ascii_lowercase() == n[k] {
            k += 1;
        }
        if k == n.len() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    extern crate alloc;
    use super::*;

    fn terms(a: &Artefact<'_>) -> alloc::vec::Vec<u8> {
        let mut out = alloc::vec::Vec::new();
        a.signed_terms(&mut |b| out.extend_from_slice(b));
        out
    }

    fn base<'a>(conds: &'a [Condition<'a>]) -> Artefact<'a> {
        Artefact {
            scope: Direction::Both,
            grade: Grade::Confirmed,
            conditions: conds,
            lifetime: Epoch(9),
        }
    }

    /// ‼ **4.1.2 BINDS THE CONDITIONS INTO THE SIGNED THING.** *Note 1:
    /// terms that travelled beside a signature rather than under it could
    /// drift apart from it* — so changing a condition must change the
    /// bytes both sides sign.
    #[test]
    fn a_condition_change_changes_the_signed_terms() {
        let a = [Condition {
            class: ConditionClass::Presence,
            predicate: "link is up",
            evidence: "local beacon",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let b = [Condition {
            class: ConditionClass::Presence,
            predicate: "link is up",
            evidence: "local beacon",
            failure: FailureClass::BreachSever,
        }];
        assert_ne!(
            terms(&base(&a)),
            terms(&base(&b)),
            "the failure class is outside the signature"
        );

        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "link is DOWN",
            evidence: "local beacon",
            failure: FailureClass::Lapse { resumable: false },
        }];
        assert_ne!(
            terms(&base(&a)),
            terms(&base(&c)),
            "the predicate is outside the signature"
        );

        let d = [Condition {
            class: ConditionClass::Presence,
            predicate: "link is up",
            evidence: "a peer's word",
            failure: FailureClass::Lapse { resumable: false },
        }];
        assert_ne!(
            terms(&base(&a)),
            terms(&base(&d)),
            "the evidence is outside the signature"
        );
    }

    /// ‼ **THE OTHER THREE THINGS 4.1.1 SAYS AN ARTEFACT RECORDS, AND
    /// UNTIL 2026-09-05 NOT ONE OF THEM WAS UNDER TEST (`SS595`).**
    ///
    /// 4.1.1 lists **scope, grade, conditions and lifetime**; 4.1.2 has
    /// each side's evidence computed *over the identical terms*. The test
    /// above covers the conditions thoroughly. **Measured: deleting the
    /// scope, the grade, or the lifetime from `signed_terms` left ALL 387
    /// tests green** — three of the four fields could leave the signature
    /// and nothing anywhere would notice.
    ///
    /// ‼ **THE GRADE IS THE ONE THAT MATTERS AND THE CONSEQUENCE IS
    /// PRIVILEGE, NOT TIDINESS.** 9.1 requires an artefact whose scope
    /// includes management operations to be **at grade 3**. With the grade
    /// outside the signed bytes, a grade-0 artefact and a grade-3 artefact
    /// sign identically — so a holder of a genuine low-grade agreement,
    /// signed by both groups, could present it as carrying management
    /// authority and **both signatures would verify**. The scope is the
    /// same shape one step down: a one-way agreement re-presented as
    /// both-ways.
    ///
    /// Each field is asserted with everything else held constant, and the
    /// control at the end is what makes the inequalities mean something:
    /// two artefacts agreeing in every field DO produce the same bytes, so
    /// this cannot pass by a serialiser that never repeats itself.
    #[test]
    fn the_scope_the_grade_and_the_lifetime_are_inside_the_signed_terms() {
        let conds = [Condition {
            class: ConditionClass::Presence,
            predicate: "link is up",
            evidence: "local beacon",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let reference = base(&conds);

        let mut other_scope = base(&conds);
        other_scope.scope = Direction::OutboundOnly;
        assert_ne!(reference.scope, other_scope.scope, "PRECONDITION");
        assert_ne!(
            terms(&reference),
            terms(&other_scope),
            "the SCOPE is outside the signature: 4.1.1 makes *what may cross, in which \
             direction* a recorded term, so a one-way agreement could be re-presented as \
             both-ways under signatures that still verify"
        );

        let mut other_grade = base(&conds);
        other_grade.grade = Grade::Opportunistic;
        assert_ne!(reference.grade, other_grade.grade, "PRECONDITION");
        assert_ne!(
            terms(&reference),
            terms(&other_grade),
            "the GRADE is outside the signature. 9.1 requires a management artefact to be at \
             grade 3, so a grade-0 agreement signed by both groups could be presented as \
             carrying management authority with both signatures verifying"
        );

        let mut other_lifetime = base(&conds);
        other_lifetime.lifetime = Epoch(reference.lifetime.0 + 1);
        assert_ne!(reference.lifetime, other_lifetime.lifetime, "PRECONDITION");
        assert_ne!(
            terms(&reference),
            terms(&other_lifetime),
            "the LIFETIME is outside the signature, so the epoch beyond which the agreement is \
             not intended to stand is a number either side could restate"
        );

        // CONTROL: identical artefacts sign identical bytes.
        assert_eq!(terms(&reference), terms(&base(&conds)));
    }

    /// ‼ **AND THE DEMOTION GRADE IS INSIDE THE TERMS TOO.** `STD-SS364`
    /// corrected 10.3.2 to *the level the conditions name for that breach*,
    /// so **which grade a breach demotes to is a term** — two artefacts
    /// differing only in that grade are different agreements.
    #[test]
    fn the_demotion_grade_is_part_of_the_agreement() {
        let a = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::BreachDemoteTo(Grade::Opportunistic),
        }];
        let b = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::BreachDemoteTo(Grade::Introduced),
        }];
        assert_ne!(terms(&base(&a)), terms(&base(&b)));
    }

    /// **5.1.1 b): the groups exchange revisions until the terms are
    /// IDENTICAL** — and identical is a property of these bytes, so two
    /// sides holding the same agreement must produce the same span.
    #[test]
    fn the_same_agreement_produces_the_same_bytes_on_both_sides() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        assert_eq!(terms(&base(&c)), terms(&base(&c)));
    }

    /// ‼ **6.2.4: NO CONDITION SHALL CLASS SILENCE AS BREACH**, refused at
    /// adoption rather than at evaluation — *by evaluation the
    /// entanglement has already been severed over a peer being asleep.*
    #[test]
    fn silence_classed_as_breach_is_refused_at_adoption() {
        let bad = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart unreachable for an hour",
            evidence: "local neighbour table",
            failure: FailureClass::BreachSever,
        }];
        assert!(matches!(
            base(&bad).admissible(),
            Err(ArtefactRefusal::SilenceClassedAsBreach { .. })
        ));
    }

    /// ‼ **THE CONTROL, AND IT IS ALSO THE LIMIT**: the SAME predicate
    /// classed as a lapse is admissible, because 6.2.4 forbids the
    /// classification and not the subject — *unreachability shall only ever
    /// lapse.* Without this the refusal above would pass for a check that
    /// banned the word.
    #[test]
    fn the_same_predicate_as_a_lapse_is_admissible() {
        let ok = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart unreachable for an hour",
            evidence: "local neighbour table",
            failure: FailureClass::Lapse { resumable: false },
        }];
        assert_eq!(base(&ok).admissible(), Ok(()));
    }

    /// ‼ **AND THE HEURISTIC'S BOUND, ASSERTED SO THE ROW CANNOT OVERCLAIM
    /// IT**: a silence condition phrased without the clause's own words is
    /// **not** caught. *This is a floor on carelessness, not a guarantee,
    /// and a test that only demonstrated the catch would imply otherwise.*
    #[test]
    fn a_silence_condition_phrased_otherwise_is_not_caught() {
        let missed = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart has not spoken since epoch 4",
            evidence: "local neighbour table",
            failure: FailureClass::BreachSever,
        }];
        assert_eq!(
            base(&missed).admissible(),
            Ok(()),
            "if this now fails, the bound has improved — widen the row, do not delete the test"
        );
    }

    // ---- 4.1.2: member-attributable evidence over the IDENTICAL terms ----

    use crate::certificate::Certificate;
    use crate::crypto::{IDENTITY_LEN, SIGNATURE_LEN};
    use crate::evidence::Freshness;

    /// Accepts every signature, so these tests exercise **what the
    /// signature is over** rather than the cryptography — which is the
    /// whole of 4.1.2.
    struct AlwaysValid;
    impl Verifier for AlwaysValid {
        fn verify(_key: &[u8; IDENTITY_LEN], _msg: &[u8], _sig: &[u8; SIGNATURE_LEN]) -> bool {
            true
        }
    }

    fn ident(b: u8) -> Identity {
        Identity([b; IDENTITY_LEN])
    }

    fn party<'a>(group: u8, member: u8, statement: &'a [u8], nonce: u8) -> Party<'a> {
        Party {
            group: ident(group),
            evidence: MemberEvidence {
                certificate: Certificate {
                    subject: ident(member),
                    group: ident(group),
                    issued_at: Epoch(1),
                    signature: [0; SIGNATURE_LEN],
                },
                statement,
                freshness: Freshness::Nonce([nonce; 16]),
                signature: [0; SIGNATURE_LEN],
            },
            cert_authentic: true,
            cert_is_current: true,
            expected_nonce: Some([nonce; 16]),
        }
    }

    /// The happy path, which exists so the refusals below are attributable
    /// to what they name rather than to a broken fixture.
    #[test]
    fn both_groups_signing_the_same_terms_is_adopted() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&c);
        let t = terms(&a);
        let signed = SignedArtefact {
            artefact: a,
            parties: [party(1, 11, &t, 1), party(2, 22, &t, 2)],
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            verify_adoption::<AlwaysValid, 4>(&signed, &mut marks),
            Ok([ident(11), ident(22)])
        );
    }

    /// ‼ **4.1.2 IS THIS TEST.** Party B's signature is PERFECTLY VALID —
    /// the verifier accepts everything — and it is over a different
    /// agreement, one whose condition lapses where this one severs. *Note
    /// 1: a dispute would then be about which terms were agreed rather than
    /// whether they were met.* **The agreement is refused, not averaged.**
    #[test]
    fn a_party_signing_different_terms_is_refused_though_its_signature_is_valid() {
        let ours = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::BreachSever,
        }];
        let theirs = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&ours);
        let t_ours = terms(&a);
        let t_theirs = terms(&base(&theirs));
        // PRECONDITION: the two really are different agreements. Without
        // this the test could pass over a pair that never differed.
        assert_ne!(t_ours, t_theirs);

        let signed = SignedArtefact {
            artefact: a,
            parties: [party(1, 11, &t_ours, 1), party(2, 22, &t_theirs, 2)],
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            verify_adoption::<AlwaysValid, 4>(&signed, &mut marks),
            Err(AdoptionRefusal::TermsDiffer { party: 1 })
        );
    }

    /// ‼ **THE TWO BOUNDS ARE NOT INDEPENDENT, AND SAYING SO IS THE POINT
    /// OF THIS TEST.** `MAX_CONDITIONS` conditions with ordinary wording
    /// serialise past `MAX_STATEMENT`, so an artefact could pass 6.2.4 and
    /// be **unsignable by anyone**. It is refused at admissibility instead:
    /// *a check that says yes to something the next step cannot do is worse
    /// than no check.*
    #[test]
    fn a_full_artefact_with_wordy_conditions_is_refused_as_unsignable() {
        let long = [Condition {
            class: ConditionClass::Temporal,
            predicate: "the counterpart holds a current and unexpired operating lease",
            evidence: "the local lease table, as of the last completed sweep",
            failure: FailureClass::Lapse { resumable: false },
        }; MAX_CONDITIONS];
        let a = base(&long);
        // PRECONDITION 1: at the condition bound, so the refusal is about
        // LENGTH and not about count.
        assert_eq!(a.conditions.len(), MAX_CONDITIONS);
        // ‼ PRECONDITION 2: THE MARGIN IS ASSERTED RATHER THAN ASSUMED.
        // When `MAX_STATEMENT` rose from 256 to 512 the previous fixture
        // survived by FOUR BYTES — it was still refusing, and it was doing
        // so by accident. A test whose subject depends on an unmeasured
        // margin is one that will silently start testing something else.
        assert!(
            terms_len(&a) > MAX_STATEMENT + 64,
            "margin too thin to be deliberate"
        );
        assert_eq!(a.admissible(), Err(ArtefactRefusal::TermsTooLongToSign));
        assert!(a.write_terms(&mut [0u8; MAX_STATEMENT]).is_none());

        // CONTROL 1: the same COUNT with short wording is admissible, so
        // `MAX_CONDITIONS` is still reachable and this is not a ban on full
        // artefacts.
        let short = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }; MAX_CONDITIONS];
        let b = base(&short);
        assert_eq!(b.conditions.len(), MAX_CONDITIONS);
        assert_eq!(b.admissible(), Ok(()));

        // ‼ CONTROL 2: THE WALL MOVED, AND HERE IS WHERE IT WAS. The
        // wording that motivated raising `MAX_STATEMENT` — 8 conditions at
        // 412 bytes — is admissible NOW and was not before. *`hive` is
        // right that 512 moves the wall rather than removing it, so the
        // refusal is kept as unreachable-for-this-wording rather than
        // deleted: the bound is on wording length, which is nobody's to
        // control, and a refusal that says why is what makes the next
        // encounter legible instead of a mystery.*
        let was_over = [Condition {
            class: ConditionClass::Temporal,
            predicate: "the counterpart holds a lease",
            evidence: "the local lease table",
            failure: FailureClass::Lapse { resumable: false },
        }; MAX_CONDITIONS];
        let c = base(&was_over);
        assert!(
            terms_len(&c) > 256,
            "this is the wording that did not fit at 256"
        );
        assert_eq!(c.admissible(), Ok(()));
    }

    // ---- 4.1.3: held, and judged against ----

    fn held<'a>(a: Artefact<'a>, standing: Grade) -> Held<'a> {
        Held {
            id: crate::gate::EntanglementId(7),
            key: &[0u8; 32],
            artefact: a,
            standing,
            ending: None,
        }
    }

    /// ‼ **THE MANUFACTURED-ENTANGLEMENT CHECK, AND IT IS THE POINT OF THE
    /// WHOLE PIECE.** A live standing ABOVE what the agreement grants
    /// cannot have come from demotion — demotion only lowers — so it came
    /// from something building an entanglement out of nothing. *Before
    /// this, `LiveEntanglement` carried a grade with nothing tying it to
    /// an agreement, and no check anywhere could tell a real standing from
    /// an invented one.*
    #[test]
    fn a_standing_above_the_agreement_is_refused_rather_than_clamped() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut a = base(&c);
        a.grade = Grade::Confirmed;
        let h = held(a, Grade::Ceremonial);
        assert_eq!(
            h.live_grade(),
            Err(HoldingFault::StandingAboveAgreement {
                agreed: Grade::Confirmed,
                claimed: Grade::Ceremonial
            })
        );
        // ‼ AND `to_live` CARRIES THE REFUSAL, so the gate cannot be handed
        // the invented standing by a caller that ignored `live_grade`.
        assert!(h.to_live().is_err());
    }

    /// **Clamping would be the wrong answer** and this pins that it does
    /// not happen: the refusal names both grades, so a caller learns *what
    /// was agreed* and *what was claimed* rather than silently receiving
    /// the lower one. A clamp would have hidden the evidence that something
    /// upstream manufactured a standing.
    #[test]
    fn the_refusal_names_both_grades_so_the_discrepancy_is_legible() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut a = base(&c);
        a.grade = Grade::Opportunistic;
        match held(a, Grade::Introduced).live_grade() {
            Err(HoldingFault::StandingAboveAgreement { agreed, claimed }) => {
                assert_eq!(agreed, Grade::Opportunistic);
                assert_eq!(claimed, Grade::Introduced);
            }
            other => panic!("expected the discrepancy to be named, got {other:?}"),
        }
    }

    /// ‼ **DEMOTION IS STILL ALLOWED, AND THIS IS THE CONTROL THAT KEEPS
    /// THE CHECK FROM BEING A BAN ON DEMOTION.** L5 10.3.2 lowers live
    /// standing; 4.1.3 does not freeze it to the agreed grade. *A standing
    /// BELOW the agreement is the normal post-demotion state and must
    /// pass* — without this control the test above would equally describe a
    /// check that demanded equality.
    #[test]
    fn a_demoted_standing_below_the_agreement_is_the_normal_case() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut a = base(&c);
        a.grade = Grade::Ceremonial;
        assert_eq!(held(a, Grade::Confirmed).live_grade(), Ok(Grade::Confirmed));
        // And equality — never demoted — is fine too.
        assert_eq!(
            held(a, Grade::Ceremonial).live_grade(),
            Ok(Grade::Ceremonial)
        );
    }

    /// **4.1.3 says EVERY judgement is made against the artefact**, so an
    /// inadmissible held agreement yields no grade at all — *a group that
    /// may not adopt an artefact may not gate crossings by it either*, and
    /// the two checks would otherwise disagree about the same agreement.
    #[test]
    fn an_inadmissible_held_artefact_gates_nothing() {
        let bad = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart unreachable",
            evidence: "local neighbour table",
            failure: FailureClass::BreachSever,
        }];
        let h = held(base(&bad), Grade::Opportunistic);
        assert!(matches!(
            h.live_grade(),
            Err(HoldingFault::Inadmissible(
                ArtefactRefusal::SilenceClassedAsBreach { .. }
            ))
        ));
    }

    /// The honest path end to end: a held agreement becomes the gate's
    /// `LiveEntanglement`, **carrying the grade the artefact grants**
    /// rather than one a caller typed.
    #[test]
    fn a_held_agreement_is_what_the_gate_is_handed() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut a = base(&c);
        a.grade = Grade::Introduced;
        let h = held(a, Grade::Confirmed);
        let live = h.to_live().expect("a demoted standing is live");
        assert_eq!(live.grade(), Grade::Confirmed);
        assert_eq!(live.id(), h.id);
    }

    // ---- 5.1.1 a-e: the sequence, in order ----

    fn est<'a>(conds: &'a [Condition<'a>], scope: Direction) -> Establishment<'a> {
        let mut a = base(conds);
        a.scope = scope;
        Establishment::propose(a, Epoch(10)).expect("admissible")
    }

    fn upto_keyed<'a>(conds: &'a [Condition<'a>], scope: Direction) -> Establishment<'a> {
        let mut e = est(conds, scope);
        e.agreed([ident(1), ident(2)]).unwrap();
        e.verified().unwrap();
        e.keyed().unwrap();
        e
    }

    /// ‼ **KEYS BEFORE VERIFICATION IS THE ORDERING THAT MATTERS AND IT IS
    /// REFUSED.** *Keys derived before the counterpart's identity is
    /// verified are keys shared with whoever answered.* 5.1.1 says the
    /// sequence is *in order*, and this is the step where the order has
    /// teeth rather than being housekeeping.
    #[test]
    fn keys_cannot_be_derived_before_the_counterpart_is_verified() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = est(&c, Direction::Both);
        e.agreed([ident(1), ident(2)]).unwrap();
        assert_eq!(
            e.keyed(),
            Err(StepRefusal::OutOfOrder {
                at: Stage::Agreed,
                attempted: Stage::Keyed
            })
        );
        // CONTROL: verification first, then the SAME call succeeds — so the
        // refusal is about the order and not about `keyed` being broken.
        e.verified().unwrap();
        assert_eq!(e.keyed(), Ok(()));
    }

    /// The sequence cannot run backwards either: a step already taken is
    /// not a step available again.
    #[test]
    fn a_stage_cannot_be_re_entered() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = est(&c, Direction::Both);
        e.agreed([ident(1), ident(2)]).unwrap();
        assert_eq!(
            e.agreed([ident(1), ident(2)]),
            Err(StepRefusal::OutOfOrder {
                at: Stage::Agreed,
                attempted: Stage::Agreed
            })
        );
    }

    /// ‼ **A TWO-WAY AGREEMENT NEEDS TWO CROSSINGS** (5.4.1: *at least one
    /// frame in EACH CONTRACTED DIRECTION*). One crossing leaves it
    /// **provisional**, because the untried direction is Note 1's *standing
    /// lie* — agreed, verified and keyed, and unable to carry anything.
    #[test]
    fn a_both_ways_agreement_is_not_live_after_one_crossing() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::Both);
        assert_eq!(e.trial_crossed(Direction::OutboundOnly), Ok(Stage::Keyed));
        assert!(
            e.provisional(),
            "one direction tried is not a completed trial"
        );
        assert_eq!(e.trial_crossed(Direction::InboundOnly), Ok(Stage::Live));
        assert!(!e.provisional());
    }

    /// ‼ **AND THE SAME CROSSING TWICE IS NOT TWO CROSSINGS.** Without this
    /// the test above would equally describe a counter, and a doubled
    /// outbound frame would retire an inbound direction nothing ever
    /// traversed.
    #[test]
    fn the_same_direction_twice_does_not_complete_a_two_way_trial() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::Both);
        assert_eq!(e.trial_crossed(Direction::OutboundOnly), Ok(Stage::Keyed));
        assert_eq!(e.trial_crossed(Direction::OutboundOnly), Ok(Stage::Keyed));
        assert!(e.provisional());
    }

    /// A one-way agreement needs exactly one crossing — **and a crossing in
    /// the direction it never contracted is refused**, not counted. *5.4.1
    /// says each CONTRACTED direction; a crossing the scope never granted
    /// is not progress toward the trial.*
    #[test]
    fn a_one_way_agreement_is_tried_in_the_direction_it_contracted() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::OutboundOnly);
        assert_eq!(
            e.trial_crossed(Direction::InboundOnly),
            Err(StepRefusal::DirectionNotContracted)
        );
        assert!(e.provisional());
        assert_eq!(e.trial_crossed(Direction::OutboundOnly), Ok(Stage::Live));
    }

    /// ‼ **5.1.2: HAVING KEYS IS NOT HAVING AN ENTANGLEMENT.** Provisional
    /// is true at every stage before `Live`, `Keyed` included — *crossings
    /// under it shall not be delivered beyond what the trial itself
    /// requires*, and the stage that most looks finished is the one a
    /// delivery path is most likely to mistake for finished.
    #[test]
    fn provisional_is_true_at_every_stage_before_live_including_keyed() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = est(&c, Direction::OutboundOnly);
        assert!(e.provisional() && e.stage() == Stage::Proposed);
        e.agreed([ident(1), ident(2)]).unwrap();
        assert!(e.provisional());
        e.verified().unwrap();
        assert!(e.provisional());
        e.keyed().unwrap();
        assert!(e.provisional(), "keys are not a trial");
        e.trial_crossed(Direction::OutboundOnly).unwrap();
        assert!(!e.provisional());
    }

    /// ‼ **5.4.2 IS TERMINAL, AND THAT IS THE WHOLE OF ITS VALUE**: a
    /// discarded establishment that could be revived is one whose window
    /// meant nothing. Every subsequent step refuses **as discarded**,
    /// rather than as out of order — the caller learns why.
    #[test]
    fn a_discarded_establishment_is_not_revivable() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::Both);
        assert_eq!(e.discard_if_window_passed(Epoch(11)), Stage::Discarded);
        assert_eq!(
            e.trial_crossed(Direction::OutboundOnly),
            Err(StepRefusal::Discarded)
        );
        assert_eq!(e.verified(), Err(StepRefusal::Discarded));
    }

    /// **The control for the window**: inside it, nothing is discarded — so
    /// the test above is about the window elapsing and not about
    /// `discard_if_window_passed` discarding unconditionally.
    #[test]
    fn an_establishment_inside_its_window_survives() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::Both);
        assert_eq!(e.discard_if_window_passed(Epoch(10)), Stage::Keyed);
        assert_eq!(e.trial_crossed(Direction::OutboundOnly), Ok(Stage::Keyed));
    }

    /// ‼ **AND A COMPLETED ENTANGLEMENT IS NOT DISCARDED BY A LATE CLOCK.**
    /// 5.4.2 discards an entanglement *whose trial does not complete* in
    /// the window — it is not a lifetime on the entanglement itself, which
    /// is `artefact.lifetime`. *Reading it as a lifetime would tear down
    /// working entanglements on a clause about establishment.*
    #[test]
    fn the_trial_window_is_not_a_lifetime_on_a_live_entanglement() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut e = upto_keyed(&c, Direction::OutboundOnly);
        e.trial_crossed(Direction::OutboundOnly).unwrap();
        assert_eq!(e.stage(), Stage::Live);
        assert_eq!(e.discard_if_window_passed(Epoch(9999)), Stage::Live);
    }

    /// **Inadmissible terms are refused at PROPOSAL**, the first step —
    /// *terms nobody may adopt are terms not worth exchanging revisions
    /// over, and 6.2.4's silence rule does not become truer later.*
    #[test]
    fn inadmissible_terms_are_refused_before_the_sequence_starts() {
        let bad = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart unreachable",
            evidence: "local neighbour table",
            failure: FailureClass::BreachSever,
        }];
        assert!(matches!(
            Establishment::propose(base(&bad), Epoch(10)),
            Err(StepRefusal::Inadmissible(
                ArtefactRefusal::SilenceClassedAsBreach { .. }
            ))
        ));
    }

    // ---- 8: the four endings, and distinguishing them ----

    fn live_held<'a>(c: &'a [Condition<'a>]) -> Held<'a> {
        let mut a = base(c);
        a.grade = Grade::Ceremonial;
        held(a, Grade::Ceremonial)
    }

    /// ‼ **8.3: DEMOTION SHALL NOT END THE ENTANGLEMENT.** *The keys stand,
    /// the grade ceiling lowers.* This is the row most at risk of being
    /// implemented as one `set_state`, which is why demotion and ending are
    /// separate operations that **cannot reach each other's field**.
    #[test]
    fn demotion_lowers_the_ceiling_and_does_not_end_anything() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut h = live_held(&c);
        assert_eq!(h.demote(Grade::Confirmed), Ok(()));
        assert_eq!(h.ending(), None, "8.3: demotion is not an ending");
        assert_eq!(h.live_grade(), Ok(Grade::Confirmed), "the keys stand");
    }

    /// **L5 10.3.2 LOWERS**, so raising is not a demotion by another name —
    /// otherwise `demote` would be the very path by which a standing above
    /// the agreement gets manufactured, defeating the check next door.
    #[test]
    fn a_demotion_that_raises_the_standing_is_refused() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut h = live_held(&c);
        h.demote(Grade::Opportunistic).unwrap();
        assert_eq!(
            h.demote(Grade::Ceremonial),
            Err(LifecycleRefusal::NotADemotion {
                from: Grade::Opportunistic,
                to: Grade::Ceremonial
            })
        );
    }

    /// ‼ **8.2: CROSSINGS FAIL THE GATE FROM THAT MOMENT**, and the refusal
    /// **names which ending** — 8.1 requires them distinguished, and a
    /// caller logging *this stopped working* without *why* discards the
    /// evidence 8.6 Note 2 makes each side's own.
    #[test]
    fn an_ended_entanglement_gates_nothing_and_the_refusal_says_which_ending() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        for how in [
            Ending::Completion,
            Ending::Lapse,
            Ending::Severance,
            Ending::Dissolution,
        ] {
            let mut h = live_held(&c);
            assert!(h.live_grade().is_ok(), "precondition: live before ending");
            h.end(how).unwrap();
            assert_eq!(h.live_grade(), Err(HoldingFault::Ended { as_: how }));
        }
    }

    /// ‼ **8.1: EXACTLY ONE.** The first ending is the one that happened —
    /// *a second would overwrite the record 8.6 Note 2 makes each side's
    /// evidence*, and a severance quietly relabelled a completion is
    /// exactly the rewrite that matters.
    #[test]
    fn an_entanglement_ends_exactly_once() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut h = live_held(&c);
        h.end(Ending::Severance).unwrap();
        assert_eq!(
            h.end(Ending::Completion),
            Err(LifecycleRefusal::AlreadyEnded {
                as_: Ending::Severance
            })
        );
        assert_eq!(h.ending(), Some(Ending::Severance));
        // And it cannot be demoted back into life either.
        assert_eq!(
            h.demote(Grade::Opportunistic),
            Err(LifecycleRefusal::AlreadyEnded {
                as_: Ending::Severance
            })
        );
    }

    /// ‼ **8.6 IS TWO CLAIMS AND BOTH HALVES ARE ASSERTED**: the prior
    /// record is *never an entitlement and never a bar*.
    ///
    /// **Not a bar** — a severance does not prevent proposing again.
    /// **Not an entitlement** — the fresh establishment starts at
    /// `Proposed`, with the whole of Clause 5 still to run. *A test showing
    /// only the first half would describe a system that re-granted the old
    /// entanglement on request.*
    #[test]
    fn re_establishment_after_severance_is_neither_barred_nor_granted() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let mut h = live_held(&c);
        h.end(Ending::Severance).unwrap();

        // NOT A BAR:
        let fresh = Establishment::propose(h.artefact, Epoch(20))
            .expect("8.6: a severed counterpart can ask again");
        // NOT AN ENTITLEMENT:
        assert_eq!(
            fresh.stage(),
            Stage::Proposed,
            "8.6: a FRESH establishment, Clause 5 in full"
        );
        assert!(fresh.provisional());
    }

    // ---- 6.3.1 the vocabulary, 6.1.3 the ruler, 6.4.1 the asymmetry ----

    fn cond(class: ConditionClass) -> Condition<'static> {
        Condition {
            class,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }
    }

    /// ‼ **6.3.1: A CLASS AN IMPLEMENTATION DOES NOT SUPPORT IS ONE IT
    /// SHALL NOT AGREE TO** — refused at adoption, because *agreeing to a
    /// condition you cannot evaluate is agreeing to a term you will never
    /// know you have broken.*
    #[test]
    fn a_class_this_group_does_not_support_is_refused() {
        let c = [cond(ConditionClass::Conduct)];
        let mut s = Support::unconstrained();
        s.classes[ConditionClass::Conduct as usize] = false;
        assert_eq!(
            base(&c).admissible_for(&s),
            Err(ArtefactRefusal::UnsupportedClass {
                class: ConditionClass::Conduct
            })
        );
        // CONTROL: supported, and the same artefact is adoptable — so the
        // refusal is the class and not the artefact.
        assert_eq!(base(&c).admissible_for(&Support::unconstrained()), Ok(()));
    }

    /// ‼ **6.1.3 Note 1: THE PARTY THAT HOLDS THE RULER MAKES THE
    /// MEASUREMENT.** *A condition anchored to calendar time is adoptable by
    /// the venue with a clock and not by the sensor without one* — the
    /// vocabulary bends to the platform declaration, **never the reverse**.
    #[test]
    fn a_temporal_condition_is_not_adoptable_without_a_ruler() {
        let c = [cond(ConditionClass::Temporal)];
        let mut s = Support::unconstrained();
        s.holds_a_ruler = false;
        assert_eq!(
            base(&c).admissible_for(&s),
            Err(ArtefactRefusal::UndeclaredFacility {
                class: ConditionClass::Temporal
            })
        );
        // CONTROL 1: with a ruler, adoptable.
        assert_eq!(base(&c).admissible_for(&Support::unconstrained()), Ok(()));
        // ‼ CONTROL 2: A NON-TEMPORAL CONDITION IS ADOPTABLE WITHOUT A
        // RULER. Without this the check above would equally describe a
        // group that could adopt nothing at all when clockless — *which is
        // precisely the absolute-time trap Note 1 says does not exist here.*
        let p = [cond(ConditionClass::Presence)];
        assert_eq!(base(&p).admissible_for(&s), Ok(()));
    }

    /// ‼ **6.4.1: THE SIDES MAY REACH DIFFERENT CONCLUSIONS AND AN
    /// IMPLEMENTATION SHALL TOLERATE THE ASYMMETRY.** The same artefact is
    /// adoptable by one side and not the other, **and nothing reconciles
    /// them** — *a convergence protocol would be a shared evaluator wearing
    /// a different hat* (Note 1), which 6.1.2 forbids outright.
    #[test]
    fn the_same_artefact_may_be_adoptable_by_one_side_and_not_the_other() {
        let c = [cond(ConditionClass::Temporal)];
        let a = base(&c);
        let venue = Support::unconstrained();
        let mut sensor = Support::unconstrained();
        sensor.holds_a_ruler = false;
        assert_eq!(a.admissible_for(&venue), Ok(()));
        assert!(a.admissible_for(&sensor).is_err());
        // ‼ AND THE ASYMMETRY IS NOT AN ERROR STATE ANYWHERE: there is no
        // call that takes both supports, because 6.1.2 forbids a shared
        // evaluator and a two-support signature would be one.
    }

    /// The class is **inside the signed terms** — 6.3.1 lets a group refuse
    /// a class outright, so *which class a condition is cannot live outside
    /// what both sides signed.*
    #[test]
    fn the_condition_class_is_part_of_the_agreement() {
        let a = [cond(ConditionClass::Presence)];
        let b = [cond(ConditionClass::Conduct)];
        assert_ne!(terms(&base(&a)), terms(&base(&b)));
    }

    /// ‼ **6.3.2: NO DISCLOSURE SHALL BE INFERRED FROM ANY OTHER CONDITION
    /// OR FROM THE ENTANGLEMENT'S EXISTENCE**, so an artefact carrying five
    /// other classes and a live entanglement grants **no** disclosure. *The
    /// assertion is that nothing anywhere derives one* — this pins the
    /// property at the only place it could leak from, the artefact itself.
    #[test]
    fn disclosure_is_never_inferred_from_other_conditions() {
        let mixed = [
            cond(ConditionClass::Presence),
            cond(ConditionClass::Temporal),
            cond(ConditionClass::Transactional),
            cond(ConditionClass::Conduct),
            cond(ConditionClass::Reciprocity),
        ];
        let a = base(&mixed);
        assert!(
            !a.conditions
                .iter()
                .any(|c| c.class == ConditionClass::Disclosure),
            "6.3.2: a disclosure grant is present only when a condition NAMES the class"
        );
        // And the entanglement's existence grants none either: a completed
        // establishment over these terms still carries no disclosure class.
        let h = establish_for_test(
            crate::gate::EntanglementId(3),
            &[0u8; 32],
            Direction::Both,
            Grade::Confirmed,
            &mixed,
        );
        assert!(!h
            .artefact
            .conditions
            .iter()
            .any(|c| c.class == ConditionClass::Disclosure));
    }

    // ---- 6.2.5: refusal, the third failure class ----

    /// ‼ **6.2.5: A REFUSAL AFFECTS NOTHING ELSE** — *the entanglement
    /// stands, the derived keys are not destroyed, and no standing is
    /// affected.* This is the property `standard` landed the class for, and
    /// it is asserted as a **triple**: an artefact whose every condition is
    /// a refusal is admissible, gates at its full agreed grade, and has not
    /// ended.
    #[test]
    fn a_refusal_condition_leaves_the_entanglement_standing() {
        let c = [Condition {
            class: ConditionClass::Transactional,
            predicate: "under 100 at authentication level 5",
            evidence: "the crossing itself",
            failure: FailureClass::RefusesTheCrossing,
        }];
        let mut a = base(&c);
        a.grade = Grade::Confirmed;
        assert_eq!(a.admissible(), Ok(()));
        let h = held(a, Grade::Confirmed);
        assert_eq!(
            h.live_grade(),
            Ok(Grade::Confirmed),
            "no standing is affected"
        );
        assert_eq!(h.ending(), None, "the entanglement stands");
    }

    /// ‼ **6.3.1 Note 1's PAYMENT LADDER, WHICH COULD NOT BE WRITTEN THIS
    /// MORNING.** *Under 10 at level 4, under 100 at level 5, over 100 at
    /// level 6 is three transactional conditions over one entanglement —
    /// evaluated per crossing, refusing individually, breaching nothing.*
    /// Under two failure classes each rung had to claim lapse or breach,
    /// and **lapse would have torn the relationship down over one
    /// payment.**
    #[test]
    fn the_payment_ladder_is_three_conditions_over_one_entanglement() {
        let ladder = [
            Condition {
                class: ConditionClass::Transactional,
                predicate: "under 10 at level 4",
                evidence: "the crossing itself",
                failure: FailureClass::RefusesTheCrossing,
            },
            Condition {
                class: ConditionClass::Transactional,
                predicate: "under 100 at level 5",
                evidence: "the crossing itself",
                failure: FailureClass::RefusesTheCrossing,
            },
            Condition {
                class: ConditionClass::Transactional,
                predicate: "over 100 at level 6",
                evidence: "the crossing itself",
                failure: FailureClass::RefusesTheCrossing,
            },
        ];
        let a = base(&ladder);
        assert_eq!(a.admissible_for(&Support::unconstrained()), Ok(()));
        let h = establish_for_test(
            crate::gate::EntanglementId(5),
            &[0u8; 32],
            Direction::Both,
            Grade::Confirmed,
            &ladder,
        );
        assert_eq!(h.ending(), None, "three rungs, one standing relationship");
        assert_eq!(h.live_grade(), Ok(Grade::Confirmed));
    }

    /// **The third class is a distinct term.** A rung that refuses and a
    /// rung that severs are different agreements, so the failure class byte
    /// must separate them — *otherwise the corpus change would be invisible
    /// to the signature.*
    #[test]
    fn refusal_is_distinguishable_from_the_other_two_in_the_signed_terms() {
        let mk = |f| {
            [Condition {
                class: ConditionClass::Transactional,
                predicate: "p",
                evidence: "e",
                failure: f,
            }]
        };
        let r = terms(&base(&mk(FailureClass::RefusesTheCrossing)));
        assert_ne!(
            r,
            terms(&base(&mk(FailureClass::Lapse { resumable: false })))
        );
        assert_ne!(r, terms(&base(&mk(FailureClass::BreachSever))));
        assert_ne!(
            r,
            terms(&base(&mk(FailureClass::BreachDemoteTo(
                Grade::Opportunistic
            ))))
        );
    }

    /// ‼ **6.2.4 HAS TWO SENTENCES AND MY FIRST VERSION OF THIS TEST ONLY
    /// TESTED ONE.** It asserted a silence-shaped **refusal** admissible,
    /// reasoning that *no condition shall class silence as breach* and a
    /// refusal is not a breach. **The second sentence forecloses it** —
    /// *unreachability shall only ever lapse*, which excludes refusal as
    /// surely as breach. `standard` answered from the sentence my control
    /// had not tested (`4adc08f`, Note 3, `STD-SS369`).
    ///
    /// **The text needed no repair to hold; the check did.** *And the
    /// widening I reported was real as a reading and wrong as a
    /// conclusion — which is why running it was still right.*
    #[test]
    fn a_silence_shaped_predicate_that_only_refuses_is_refused_too() {
        let c = [Condition {
            class: ConditionClass::Transactional,
            predicate: "counterpart unreachable at the moment of payment",
            evidence: "the crossing itself",
            failure: FailureClass::RefusesTheCrossing,
        }];
        assert!(
            matches!(
                base(&c).admissible(),
                Err(ArtefactRefusal::SilenceClassedAsBreach { .. })
            ),
            "6.2.4 second sentence: unreachability shall ONLY EVER lapse"
        );
        // CONTROL 1: BreachSever, the first sentence's own case, unchanged.
        let bad = [Condition {
            failure: FailureClass::BreachSever,
            ..c[0]
        }];
        assert!(matches!(
            base(&bad).admissible(),
            Err(ArtefactRefusal::SilenceClassedAsBreach { .. })
        ));
        // ‼ CONTROL 2: LAPSE IS STILL ADMISSIBLE, which is what keeps
        // *only ever lapse* from reading as *never allowed*. Three
        // dispositions now, and the clause admits exactly one of them.
        let ok = [Condition {
            failure: FailureClass::Lapse { resumable: false },
            ..c[0]
        }];
        assert_eq!(base(&ok).admissible(), Ok(()));
        // ‼ AND THE OPEN QUESTION IS PINNED RATHER THAN ASSUMED SETTLED.
        // `STD-SS369`: 6.2.4's ground is that a group can never be AT FAULT
        // for being unheard, and a refusal assigns no fault at all — so
        // *only ever lapse* was the gentlest outcome under two classes and
        // is the HARSHER one under three, since a lapse destroys the
        // derived keys where a refusal would leave the relationship
        // standing. **If Roy rules the other way, this assertion inverts
        // and CONTROL 2 stays** — the test is named for the question.
    }

    // ---- 5.2 key establishment, 8.5 restart, clause 9 management ----

    struct TestHkdf;
    impl crate::derive::Hkdf for TestHkdf {
        fn derive(secret: &[u8], salt: &[u8], info: &[u8], out: &mut [u8; 32]) {
            // A stand-in with the one property these tests measure:
            // every input byte affects the output. NOT a KDF, and named so.
            let mut acc: u64 = 0xcbf2_9ce4_8422_2325;
            for b in secret.iter().chain(salt).chain(info) {
                acc ^= *b as u64;
                acc = acc.wrapping_mul(0x100_0000_01b3);
            }
            for (i, o) in out.iter_mut().enumerate() {
                acc ^= i as u64;
                acc = acc.wrapping_mul(0x100_0000_01b3);
                *o = (acc >> 24) as u8;
            }
        }
    }

    /// ‼ **5.2.3: CANONICAL ORDERING, SO THE KEYS ARE INDEPENDENT OF WHICH
    /// GROUP INITIATED.** *Without it the proposing side and the accepting
    /// side derive different keys from the same agreement, and the trial
    /// fails for a reason neither can see.*
    #[test]
    fn both_sides_derive_the_same_keys_whichever_initiated() {
        let c = [cond(ConditionClass::Presence)];
        let a = base(&c);
        let (g1, g2) = (ident(0x11), ident(0xF0));
        let ours = derive_entanglement_keys::<TestHkdf>(&[7; 32], &g1, &g2, &a).unwrap();
        let theirs = derive_entanglement_keys::<TestHkdf>(&[7; 32], &g2, &g1, &a).unwrap();
        assert_eq!(ours.payload.expose(), theirs.payload.expose());
        assert_eq!(ours.integrity.expose(), theirs.integrity.expose());
    }

    /// **5.2.2: at least a payload key and an integrity key, DISTINCT from
    /// each other.** They differ only by derivation label, so this is the
    /// assertion that the label reaches the output at all.
    #[test]
    fn the_payload_and_integrity_keys_are_distinct() {
        let c = [cond(ConditionClass::Presence)];
        let k = derive_entanglement_keys::<TestHkdf>(&[7; 32], &ident(1), &ident(2), &base(&c))
            .unwrap();
        assert_ne!(k.payload.expose(), k.integrity.expose());
    }

    /// ‼ **THE ARTEFACT IS AN INPUT TO THE DERIVATION**, which is what
    /// makes 5.2.4 true: *the keys are a deterministic consequence of one
    /// bilateral invariant — who agreed, TO WHAT.* Two different agreements
    /// between the same two groups must not share keys.
    #[test]
    fn a_different_agreement_between_the_same_groups_derives_different_keys() {
        let c1 = [cond(ConditionClass::Presence)];
        let c2 = [Condition {
            failure: FailureClass::BreachSever,
            ..cond(ConditionClass::Presence)
        }];
        let (g1, g2) = (ident(1), ident(2));
        let k1 = derive_entanglement_keys::<TestHkdf>(&[7; 32], &g1, &g2, &base(&c1)).unwrap();
        let k2 = derive_entanglement_keys::<TestHkdf>(&[7; 32], &g1, &g2, &base(&c2)).unwrap();
        assert_ne!(k1.payload.expose(), k2.payload.expose());
    }

    /// ‼ **8.5 / 5.2.4: AN ENTANGLEMENT SURVIVES RESTART WITHOUT A
    /// RESUMPTION PROTOCOL.** *A device that lost its session state and
    /// still holds its group material and the artefact holds the
    /// entanglement — nothing needs re-negotiating; **the agreement IS the
    /// state.*** Modelled as re-deriving from the two retained inputs alone
    /// and getting the same keys: **no session, no counterpart, no
    /// exchange.**
    #[test]
    fn the_keys_are_re_derivable_from_the_artefact_and_group_material_alone() {
        let c = [cond(ConditionClass::Presence)];
        let a = base(&c);
        let before =
            derive_entanglement_keys::<TestHkdf>(&[9; 32], &ident(3), &ident(4), &a).unwrap();
        // ...restart: everything transient is gone. Only the group material
        // and the artefact are retained, and they are the only arguments.
        let after =
            derive_entanglement_keys::<TestHkdf>(&[9; 32], &ident(3), &ident(4), &a).unwrap();
        assert_eq!(before.payload.expose(), after.payload.expose());
        assert_eq!(before.integrity.expose(), after.integrity.expose());
    }

    fn grant() -> ManagementGrant<'static> {
        ManagementGrant {
            managing_group: Identity([9u8; crate::crypto::IDENTITY_LEN]),
            surface: "the ota surface",
            operations: &["stage", "commit"],
        }
    }

    /// ‼ **9.1: A MANAGEMENT-BEARING ARTEFACT SHALL BE AT GRADE 3.** Note
    /// 1's narrow neck, first plank: *top grade, exhaustive enumeration,
    /// member attribution on every act, revocable at will.*
    #[test]
    fn a_management_artefact_below_grade_three_is_refused() {
        let c = [cond(ConditionClass::Disclosure)];
        let mut a = base(&c);
        a.grade = Grade::Introduced;
        assert_eq!(
            a.admissible_management(&grant()),
            Err(ManagementRefusal::NotCeremonial {
                grade: Grade::Introduced
            })
        );
        // CONTROL: at grade 3 the same grant is admissible.
        a.grade = Grade::Ceremonial;
        assert_eq!(a.admissible_management(&grant()), Ok(()));
    }

    /// **9.1: EXHAUSTIVELY.** A grant naming no operation would be a
    /// management-bearing entanglement that *authorises nothing while
    /// looking like it authorises something.*
    #[test]
    fn a_grant_naming_no_operation_is_refused() {
        let c = [cond(ConditionClass::Disclosure)];
        let mut a = base(&c);
        a.grade = Grade::Ceremonial;
        let empty = ManagementGrant {
            operations: &[],
            ..grant()
        };
        assert_eq!(
            a.admissible_management(&empty),
            Err(ManagementRefusal::NoOperationsGranted)
        );
        let unnamed = ManagementGrant {
            surface: "",
            ..grant()
        };
        assert_eq!(
            a.admissible_management(&unnamed),
            Err(ManagementRefusal::NoSurfaceNamed)
        );
    }

    /// ‼ **9.2: THE ENTANGLEMENT'S CHANNEL KEYS ALONE SHALL NEVER AUTHORISE
    /// A MANAGEMENT OPERATION, REGARDLESS OF THE ENTANGLEMENT'S OTHER
    /// TERMS.** So a granted operation with **no member-attributable
    /// evidence** is refused — *the passed gate is not the authorisation,
    /// and Note 1's "never as a key that opened a channel once" is this
    /// exact sentence.*
    #[test]
    fn a_granted_operation_without_member_evidence_is_refused() {
        assert!(!management_permitted(&grant(), "commit", None));
        // CONTROL 1: with evidence, the same granted operation is permitted
        // — so the refusal is the evidence and not the grant.
        assert!(management_permitted(&grant(), "commit", Some(ident(5))));
        // ‼ CONTROL 2: EVIDENCE DOES NOT SUBSTITUTE FOR THE GRANT EITHER.
        // An operation the grant never named is refused however good the
        // evidence — 9.1's *exhaustively* means a list, and an operation
        // not on it was not granted.
        assert!(!management_permitted(&grant(), "erase", Some(ident(5))));
    }

    /// ‼ **9.3: REVOCABLE BY THE GRANTING SIDE AT ANY TIME, AS DEMOTION OR
    /// SEVERANCE.** A demotion below grade 3 is what revokes it, because
    /// 9.1 requires grade 3 — *so revocation needs no management-specific
    /// machinery, and machinery that could be forgotten is machinery that
    /// will be.*
    #[test]
    fn demoting_below_grade_three_revokes_the_management_grant() {
        let c = [cond(ConditionClass::Disclosure)];
        let mut a = base(&c);
        a.grade = Grade::Ceremonial;
        assert_eq!(a.admissible_management(&grant()), Ok(()));

        let mut h = held(a, Grade::Ceremonial);
        h.demote(Grade::Introduced)
            .expect("9.3: revocable at any time");
        // The artefact still says grade 3; the STANDING no longer does, and
        // 9.1 is a requirement on what the entanglement is live at.
        assert_eq!(h.live_grade(), Ok(Grade::Introduced));
        assert!(
            h.live_grade().unwrap() < Grade::Ceremonial,
            "the grant no longer stands"
        );
        // And severance revokes it outright.
        let mut h2 = held(a, Grade::Ceremonial);
        h2.end(Ending::Severance).unwrap();
        assert!(h2.live_grade().is_err());
    }

    // ---- 6.1.2 / 6.2.1 / 6.2.2 / 10.2: conditions evaluated ----

    fn c_with(class: ConditionClass, pred: &'static str, f: FailureClass) -> Condition<'static> {
        Condition {
            class,
            predicate: pred,
            evidence: "this group's own table",
            failure: f,
        }
    }

    /// ‼ **10.2 IS A NAMED CONFORMANCE DEMONSTRATION AND THIS IS IT**: *a
    /// counterpart made unreachable mid-entanglement **lapses and is not
    /// recorded as in breach**.* The second half is the half that matters —
    /// asserting the lapse alone would pass for an implementation that
    /// recorded both.
    #[test]
    fn an_unreachable_counterpart_lapses_and_is_not_recorded_as_in_breach() {
        let c = [c_with(
            ConditionClass::Presence,
            "counterpart hearable on the mesh bearer",
            FailureClass::Lapse { resumable: false },
        )];
        let mut h = live_held(&c);
        assert!(
            h.evaluate(&[Verdict::Holds]).stands(),
            "precondition: standing"
        );

        // ...the counterpart goes unreachable mid-entanglement.
        assert_eq!(h.evaluate(&[Verdict::Failed]).ended, Some(Ending::Lapse));
        // ‼ AND NOT IN BREACH. 8.1 requires the four distinguished
        // precisely so this record can be told apart from a severance.
        assert_eq!(h.ending(), Some(Ending::Lapse));
        assert_ne!(h.ending(), Some(Ending::Severance));
    }

    /// **6.2.1: a lapse is WITHOUT FAULT — no standing is affected.** The
    /// entanglement ends, and the grade it ended at is untouched: *nothing
    /// about this ending is evidence against anyone.*
    #[test]
    fn a_lapse_does_not_move_the_standing() {
        let c = [c_with(
            ConditionClass::Presence,
            "hearable",
            FailureClass::Lapse { resumable: false },
        )];
        let mut h = live_held(&c);
        let before = h.standing;
        h.evaluate(&[Verdict::Failed]);
        assert_eq!(h.standing, before, "6.2.1: no standing is affected");
    }

    /// ‼ **6.2.1's SECOND OUTCOME, WHICH A ONE-VARIANT `Lapse` WOULD HAVE
    /// SILENTLY CHOSEN AWAY**: *a lapse shall end the entanglement, **or
    /// suspend it** where the artefact stands and its terms permit
    /// resumption.* A suspension is **not an ending** — 8.1 lists four and
    /// this is none of them — so `ending()` stays `None`.
    #[test]
    fn a_resumable_lapse_suspends_rather_than_ending() {
        let c = [c_with(
            ConditionClass::Presence,
            "hearable",
            FailureClass::Lapse { resumable: true },
        )];
        let mut h = live_held(&c);
        let o = h.evaluate(&[Verdict::Failed]);
        assert!(o.suspended && o.ended.is_none());
        assert_eq!(
            h.ending(),
            None,
            "suspension is not one of 8.1's four endings"
        );
    }

    /// **6.2.2: a breach is answered as the artefact states** — severance
    /// or demotion to the named grade, and **the grade is the condition's**
    /// (L5 10.3.2 as `STD-SS364` corrected it), never one step down.
    #[test]
    fn a_breach_is_answered_as_the_artefact_states() {
        let sever = [c_with(
            ConditionClass::Conduct,
            "licence respected",
            FailureClass::BreachSever,
        )];
        let mut h = live_held(&sever);
        assert_eq!(
            h.evaluate(&[Verdict::Failed]).ended,
            Some(Ending::Severance)
        );

        let demote = [c_with(
            ConditionClass::Conduct,
            "licence respected",
            FailureClass::BreachDemoteTo(Grade::Opportunistic),
        )];
        let mut h2 = live_held(&demote);
        assert_eq!(
            h2.evaluate(&[Verdict::Failed]).demoted_to,
            Some(Grade::Opportunistic)
        );
        assert_eq!(
            h2.ending(),
            None,
            "8.3: demotion does not end the entanglement"
        );
    }

    /// ‼ **SEVERANCE OUTRANKS LAPSE WHEN BOTH FAIL AT ONCE, AND THE REASON
    /// IS THE RECORD.** Both end it, but 8.1 requires *exactly one* ending
    /// and requires the four distinguished *because the record is each
    /// side's evidence* — **recording a lapse where a breach also occurred
    /// would hide fault.** *The corpus does not state this precedence; the
    /// composition is mine and is routed to `standard`.*
    #[test]
    fn a_breach_alongside_a_lapse_is_recorded_as_the_breach() {
        let both = [
            c_with(
                ConditionClass::Presence,
                "hearable",
                FailureClass::Lapse { resumable: false },
            ),
            c_with(
                ConditionClass::Conduct,
                "licence respected",
                FailureClass::BreachSever,
            ),
        ];
        let mut h = live_held(&both);
        assert_eq!(
            h.evaluate(&[Verdict::Failed, Verdict::Failed]).ended,
            Some(Ending::Severance)
        );
        assert_eq!(
            h.ending(),
            Some(Ending::Severance),
            "the fault-bearing record survives"
        );
    }

    /// **Two demotions mean the lower ceiling**, since a grade is a ceiling
    /// and two ceilings are the lower of them.
    #[test]
    fn two_demotions_take_the_lower_grade() {
        let two = [
            c_with(
                ConditionClass::Conduct,
                "a",
                FailureClass::BreachDemoteTo(Grade::Introduced),
            ),
            c_with(
                ConditionClass::Conduct,
                "b",
                FailureClass::BreachDemoteTo(Grade::Opportunistic),
            ),
        ];
        let mut h = live_held(&two);
        assert_eq!(
            h.evaluate(&[Verdict::Failed, Verdict::Failed]).demoted_to,
            Some(Grade::Opportunistic)
        );
    }

    /// ‼ **6.2.5 IS THE LIGHTEST AND MUST NOT MASK THE OTHERS**: a refusal
    /// alongside a lapse ends the entanglement, and a refusal **alone**
    /// leaves it standing. *Without the second half this would describe an
    /// implementation that refused everything and never ended anything.*
    #[test]
    fn a_refusal_alone_leaves_it_standing_and_does_not_mask_a_lapse() {
        let mixed = [
            c_with(
                ConditionClass::Transactional,
                "under 100 at level 5",
                FailureClass::RefusesTheCrossing,
            ),
            c_with(
                ConditionClass::Presence,
                "hearable",
                FailureClass::Lapse { resumable: false },
            ),
        ];
        let mut h = live_held(&mixed);
        // Refusal alone: the relationship stands (6.2.5).
        let o = h.evaluate(&[Verdict::Failed, Verdict::Holds]);
        assert!(o.crossing_refused && o.stands());
        assert_eq!(h.ending(), None);
        assert_eq!(
            h.live_grade(),
            Ok(Grade::Ceremonial),
            "no standing is affected"
        );
        // Both: the lapse is not masked by the lighter outcome.
        assert_eq!(
            h.evaluate(&[Verdict::Failed, Verdict::Failed]).ended,
            Some(Ending::Lapse)
        );
    }

    /// **An entanglement that already ended is not re-evaluated into a
    /// different one** — 8.1's *exactly one*, defended at the evaluation
    /// path too rather than only at `end`.
    #[test]
    fn evaluating_an_ended_entanglement_returns_the_ending_it_already_has() {
        let c = [c_with(
            ConditionClass::Conduct,
            "licence",
            FailureClass::BreachSever,
        )];
        let mut h = live_held(&c);
        h.end(Ending::Dissolution).unwrap();
        assert_eq!(
            h.evaluate(&[Verdict::Failed]).ended,
            Some(Ending::Dissolution)
        );
    }

    // ---- 5.3.1-5.3.3 grades, 8.4 notice ----

    /// **5.3.1: ordered from weakest to strongest**, and the ordering is
    /// what 5.3.4's ceiling and 10.3.2's demotion both rest on.
    #[test]
    fn the_four_grades_are_ordered_weakest_to_strongest() {
        assert!(Grade::Opportunistic < Grade::Confirmed);
        assert!(Grade::Confirmed < Grade::Introduced);
        assert!(Grade::Introduced < Grade::Ceremonial);
    }

    /// ‼ **5.3.2: AN INTERPOSED ESTABLISHMENT SHALL YIELD VISIBLY DIFFERENT
    /// STRINGS.** An interposer necessarily presents *its own* identity to
    /// one side, so the two sides bind different pairs and compute
    /// different strings — **which is what the out-of-band comparison
    /// catches.**
    #[test]
    fn an_interposed_establishment_yields_a_different_verification_string() {
        let (a, b, interposer) = (ident(0x11), ident(0x22), ident(0x33));
        let honest = verification_string::<TestHkdf>(&a, &b, b"exchange-1");
        // A sees the interposer where it expected B.
        let seen_by_a = verification_string::<TestHkdf>(&a, &interposer, b"exchange-1");
        assert_ne!(honest, seen_by_a);
        // ‼ AND THE IDENTITIES ARE BOUND, not merely mixed in: changing
        // only the far identity changes the string.
        assert_ne!(
            verification_string::<TestHkdf>(&a, &b, b"exchange-1"),
            verification_string::<TestHkdf>(&a, &ident(0x23), b"exchange-1")
        );
    }

    /// ‼ **5.3.2: IT SHALL NOT BE A REUSABLE CODE**, and the establishment
    /// exchange is the input that makes that true. *A function of the
    /// identities alone would be a permanent per-pair code — learn it once,
    /// pass it forever.*
    #[test]
    fn the_verification_string_is_not_a_reusable_per_pair_code() {
        let (a, b) = (ident(0x11), ident(0x22));
        assert_ne!(
            verification_string::<TestHkdf>(&a, &b, b"exchange-1"),
            verification_string::<TestHkdf>(&a, &b, b"exchange-2"),
            "the same pair establishing again must not reproduce the string"
        );
    }

    /// ‼ **5.3.3: BELIEVED PER THE CONDITIONS OF THE ENTANGLEMENT IT
    /// ARRIVES UNDER**, and 5.3's table requires that entanglement to be
    /// **grade 1 or above** — *a grade-0 introducer authenticates nothing
    /// about itself, so an attestation arriving under one is a statement
    /// from whoever holds the channel.*
    #[test]
    fn an_attestation_under_a_grade_zero_entanglement_is_not_believed() {
        let c = [cond(ConditionClass::Presence)];
        let mut a = base(&c);
        a.grade = Grade::Opportunistic;
        let under = held(a, Grade::Opportunistic);
        let att = Attestation {
            counterpart: ident(0x44),
            evidence: party(1, 11, b"attested", 1).evidence,
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            believe_attestation::<AlwaysValid, 4>(
                &att,
                &under,
                &ident(1),
                true,
                true,
                Some(&[1; 16]),
                &mut marks
            ),
            Err(AttestationRefusal::IntroducerBelowGradeOne {
                grade: Grade::Opportunistic
            })
        );
    }

    /// The control, **and it also pins Note 2**: at grade 1 the attestation
    /// is believed and what comes back is **an identity, never a grade** —
    /// *an introduction is evidence about who the counterpart is, never a
    /// grant of anything*, so the new entanglement's grade is still a
    /// separate agreement.
    #[test]
    fn a_believed_attestation_yields_an_identity_and_not_a_grant() {
        let c = [cond(ConditionClass::Presence)];
        let mut a = base(&c);
        a.grade = Grade::Confirmed;
        let under = held(a, Grade::Confirmed);
        let att = Attestation {
            counterpart: ident(0x44),
            evidence: party(1, 11, b"attested", 1).evidence,
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            believe_attestation::<AlwaysValid, 4>(
                &att,
                &under,
                &ident(1),
                true,
                true,
                Some(&[1; 16]),
                &mut marks
            ),
            Ok(ident(0x44))
        );
    }

    /// **An attestation under an ENDED entanglement is refused too** — 5.3.3
    /// says *the entanglement it arrives under*, and a severed one is not an
    /// entanglement it arrives under. *Without this, severing an introducer
    /// would stop its crossings and leave its introductions standing.*
    #[test]
    fn an_attestation_under_an_ended_entanglement_is_not_believed() {
        let c = [cond(ConditionClass::Presence)];
        let mut a = base(&c);
        a.grade = Grade::Ceremonial;
        let mut under = held(a, Grade::Ceremonial);
        under.end(Ending::Severance).unwrap();
        let att = Attestation {
            counterpart: ident(0x44),
            evidence: party(1, 11, b"attested", 1).evidence,
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert!(matches!(
            believe_attestation::<AlwaysValid, 4>(
                &att,
                &under,
                &ident(1),
                true,
                true,
                Some(&[1; 16]),
                &mut marks
            ),
            Err(AttestationRefusal::IntroducerNotLive(
                HoldingFault::Ended { .. }
            ))
        ));
    }

    /// ‼ **8.4: THERE IS NO WAY TO ANNOUNCE AN ENDING THAT HAS NOT
    /// HAPPENED.** *Notice shall be a courtesy, and the end shall never
    /// depend on its delivery* — Note 1: **a severance that required notice
    /// to take effect would hand the severed party a veto by
    /// unreachability.** So a live entanglement yields no notice, and the
    /// ordering is enforced by there being nothing else to call.
    #[test]
    fn a_live_entanglement_has_no_notice_to_send() {
        let c = [cond(ConditionClass::Presence)];
        let mut h = live_held(&c);
        assert_eq!(
            h.notice(),
            None,
            "nothing to announce; nothing waiting on it"
        );
        h.end(Ending::Severance).unwrap();
        let n = h.notice().expect("ended, so a courtesy is available");
        assert_eq!(
            n.ending,
            Ending::Severance,
            "8.1: the counterpart's record distinguishes them"
        );
        // ‼ AND THE ENDING DID NOT WAIT FOR IT: the entanglement was already
        // refusing before `notice` was ever called, and would refuse if it
        // never were.
        assert!(h.live_grade().is_err());
    }

    // ---- 6.2.6: several conditions failing at once ----

    /// ‼ **THE TEST THAT WOULD HAVE CAUGHT MY DEFECT, AND DID NOT EXIST
    /// UNTIL `standard` NAMED IT.** 6.2.6 d): *a refusal refuses its own
    /// crossing **whatever else applies**.* My evaluator ranked demotion
    /// above refusal and **dropped a refusal it should have applied
    /// alongside a demotion** — the enum shape made the drop unavoidable,
    /// which is why `Outcome` is now a struct.
    ///
    /// *The composition I proposed said "demotion outranks refusal"; the
    /// clause says they do not compete at all.*
    #[test]
    fn a_demotion_does_not_swallow_a_refusal() {
        let both = [
            c_with(
                ConditionClass::Conduct,
                "licence respected",
                FailureClass::BreachDemoteTo(Grade::Opportunistic),
            ),
            c_with(
                ConditionClass::Transactional,
                "under 100 at level 5",
                FailureClass::RefusesTheCrossing,
            ),
        ];
        let mut h = live_held(&both);
        let o = h.evaluate(&[Verdict::Failed, Verdict::Failed]);
        assert_eq!(o.demoted_to, Some(Grade::Opportunistic));
        assert!(o.crossing_refused, "6.2.6 d): whatever else applies");
    }

    /// ‼ **6.2.6 c): A DEMOTION APPLIES WHERE THE ENTANGLEMENT HAS NOT
    /// ENDED — AND A SUSPENSION IS NOT AN ENDING.** 8.1 lists four and
    /// suspension is none of them, *so a demotion still applies through
    /// one*, and reading "not ended" as "not suspended" would silently drop
    /// it.
    #[test]
    fn a_demotion_applies_through_a_suspension_but_not_through_an_ending() {
        let suspending = [
            c_with(
                ConditionClass::Presence,
                "hearable",
                FailureClass::Lapse { resumable: true },
            ),
            c_with(
                ConditionClass::Conduct,
                "licence",
                FailureClass::BreachDemoteTo(Grade::Confirmed),
            ),
        ];
        let mut h = live_held(&suspending);
        let o = h.evaluate(&[Verdict::Failed, Verdict::Failed]);
        assert!(o.suspended);
        assert_eq!(
            o.demoted_to,
            Some(Grade::Confirmed),
            "6.2.6 c) through a suspension"
        );

        // ...and NOT through an ending.
        let ending = [
            c_with(
                ConditionClass::Presence,
                "hearable",
                FailureClass::Lapse { resumable: false },
            ),
            c_with(
                ConditionClass::Conduct,
                "licence",
                FailureClass::BreachDemoteTo(Grade::Confirmed),
            ),
        ];
        let mut h2 = live_held(&ending);
        let o2 = h2.evaluate(&[Verdict::Failed, Verdict::Failed]);
        assert_eq!(o2.ended, Some(Ending::Lapse));
        assert_eq!(
            o2.demoted_to, None,
            "6.2.6 c): where the entanglement has NOT ended"
        );
    }

    /// ‼ **6.2.7: A FAILURE NOT REFLECTED IN THE ENDING SHALL REMAIN
    /// EVIDENCE.** 8.1 obliges **one** ending; *it does not make the record
    /// exclusive* — and this is what keeps severance-over-lapse from hiding
    /// the lapse. The verdicts are the caller's and are not consumed, so
    /// **every failure remains legible to whatever recorded them**, not
    /// only the one that named the ending.
    #[test]
    fn a_failure_not_reflected_in_the_ending_is_still_visible_to_the_caller() {
        let both = [
            c_with(
                ConditionClass::Presence,
                "hearable",
                FailureClass::Lapse { resumable: false },
            ),
            c_with(
                ConditionClass::Conduct,
                "licence respected",
                FailureClass::BreachSever,
            ),
        ];
        let verdicts = [Verdict::Failed, Verdict::Failed];
        let mut h = live_held(&both);
        let o = h.evaluate(&verdicts);
        assert_eq!(o.ended, Some(Ending::Severance), "6.2.6 a)");
        // ‼ AND THE LAPSE IS NOT ERASED BY THE SEVERANCE WINNING. The
        // failing conditions are still enumerable beside the outcome, which
        // is 6.2.7's whole point: *one ending, and a record that is not
        // exclusive.*
        let failed: alloc::vec::Vec<_> = h
            .artefact
            .conditions
            .iter()
            .zip(&verdicts)
            .filter(|(_, v)| **v == Verdict::Failed)
            .map(|(c, _)| c.class)
            .collect();
        assert_eq!(failed.len(), 2, "both failures remain evidence under 6.2.7");
    }

    fn terms_len(a: &Artefact<'_>) -> usize {
        let mut n = 0usize;
        a.signed_terms(&mut |b| n += b.len());
        n
    }

    /// ‼ **A PREFIX IS NOT A MATCH**, and this is the trap the length
    /// equality in [`Artefact::terms_are`] exists for: without it a
    /// signature over `terms ‖ anything` would be accepted as a signature
    /// over the terms, and the appended part is under the counterpart's
    /// control.
    #[test]
    fn terms_plus_trailing_bytes_are_not_the_terms() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&c);
        let mut extended = terms(&a);
        assert!(
            a.terms_are(&extended),
            "precondition: the exact span matches"
        );
        extended.push(0);
        assert!(!a.terms_are(&extended));
        // And a truncation is not a match either, in the other direction.
        let short = &terms(&a)[..terms(&a).len() - 1];
        assert!(!a.terms_are(short));
    }

    /// **4.1.2 requires evidence from EACH PARTICIPATING GROUP.** One group
    /// signing twice is not an agreement with anyone, and both signatures
    /// verify, so nothing below this check would have caught it.
    #[test]
    fn one_group_signing_twice_is_not_an_agreement() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&c);
        let t = terms(&a);
        let signed = SignedArtefact {
            artefact: a,
            parties: [party(1, 11, &t, 1), party(1, 12, &t, 2)],
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            verify_adoption::<AlwaysValid, 4>(&signed, &mut marks),
            Err(AdoptionRefusal::NotTwoGroups)
        );
    }

    /// ‼ **6.2.4 IS CHECKED BEFORE ANY SIGNATURE.** An inadmissible
    /// artefact is refused as inadmissible even when both sides signed it
    /// faithfully — *the agreement being properly witnessed says nothing
    /// about whether it may be adopted*, and checking the signatures first
    /// would have reported a valid agreement to sever on silence.
    #[test]
    fn an_inadmissible_artefact_is_refused_before_its_signatures_are_weighed() {
        let bad = [Condition {
            class: ConditionClass::Presence,
            predicate: "counterpart unreachable",
            evidence: "local neighbour table",
            failure: FailureClass::BreachSever,
        }];
        let a = base(&bad);
        let t = terms(&a);
        let signed = SignedArtefact {
            artefact: a,
            parties: [party(1, 11, &t, 1), party(2, 22, &t, 2)],
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert!(matches!(
            verify_adoption::<AlwaysValid, 4>(&signed, &mut marks),
            Err(AdoptionRefusal::Inadmissible(
                ArtefactRefusal::SilenceClassedAsBreach { .. }
            ))
        ));
    }

    /// The evidence chain still applies (L5 7.4.2): a certificate for
    /// another group refuses, and the refusal **names which party**, so a
    /// caller can say whose side failed rather than only that one did.
    #[test]
    fn the_evidence_chain_still_applies_and_the_refusal_names_the_party() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&c);
        let t = terms(&a);
        let mut wrong = party(2, 22, &t, 2);
        wrong.evidence.certificate.group = ident(7); // not the group it claims to bind
        let signed = SignedArtefact {
            artefact: a,
            parties: [party(1, 11, &t, 1), wrong],
        };
        let mut marks: HighWaterMarks<4> = HighWaterMarks::new();
        assert_eq!(
            verify_adoption::<AlwaysValid, 4>(&signed, &mut marks),
            Err(AdoptionRefusal::Evidence {
                party: 1,
                refusal: EvidenceRefusal::WrongGroup
            })
        );
    }

    /// **A signer builds the statement with [`Artefact::write_terms`], and
    /// what it writes is what [`Artefact::terms_are`] accepts** — the two
    /// halves of 4.1.2 agreeing, rather than each being right alone.
    #[test]
    fn what_a_signer_writes_is_what_a_verifier_accepts() {
        let c = [Condition {
            class: ConditionClass::Presence,
            predicate: "p",
            evidence: "e",
            failure: FailureClass::Lapse { resumable: false },
        }];
        let a = base(&c);
        let mut buf = [0u8; MAX_STATEMENT];
        let n = a.write_terms(&mut buf).expect("these terms fit");
        assert!(a.terms_are(&buf[..n]));
        // And a buffer too small refuses rather than writing a prefix.
        let mut tiny = [0u8; 4];
        assert!(a.write_terms(&mut tiny).is_none());
    }
}

/// **The copy a group holds** (4.1.3), and the only thing a judgement is
/// entitled to be made against.
///
/// ‼ **THIS EXISTS BECAUSE A LIVE ENTANGLEMENT USED TO CARRY A GRADE AND
/// NOTHING ELSE.** [`crate::gate::LiveEntanglement`] holds `id`, `key` and
/// `grade` — and that grade was a **copy of a term**, with nothing tying it
/// back to the agreement it came from. *4.1.3 says every judgement — gating
/// a crossing, classing a failure, demoting, expiring — shall be made
/// against the artefact*, and a judgement made against a detached copy of
/// one field is exactly the drift 4.1.2 Note 1 forbids, arriving one clause
/// later.
pub struct Held<'a> {
    /// Which entanglement this is, on the wire.
    pub id: crate::gate::EntanglementId,
    /// The traffic key derived for it (5.2).
    pub key: &'a [u8],
    /// ‼ **THE AGREEMENT ITSELF, HELD** (4.1.3). Not a summary of it.
    pub artefact: Artefact<'a>,
    /// Where this entanglement stands **now**, which is not the same thing
    /// as what was agreed.
    ///
    /// ‼ **TWO GRADES, AND CONFLATING THEM IS THE BUG THIS FIELD EXISTS TO
    /// PREVENT.** `artefact.grade` is a **term** — what the two groups
    /// agreed the counterpart's identity is verified at (5.3.1). This is
    /// **live standing**, which L5 10.3.2 demotion lowers. *A demotion must
    /// not rewrite the agreement, and an agreement must not silently
    /// restore a demoted standing.*
    pub standing: Grade,
    /// How it ended, if it has (8.1). **`None` is live** — and 8.2's
    /// *crossings under them fail the gate from that moment* is enforced by
    /// [`Held::live_grade`] refusing once this is `Some`.
    pub ending: Option<Ending>,
}

/// Why a held entanglement cannot be judged against.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HoldingFault {
    /// ‼ **THE STANDING IS HIGHER THAN THE AGREEMENT ALLOWS.**
    ///
    /// **This is the manufactured-entanglement check.** A live standing
    /// above `artefact.grade` is a level *nobody agreed to* — it cannot
    /// arise from demotion, which only lowers, so it arose from something
    /// building a live entanglement out of nothing. *That is precisely the
    /// hazard the acceptance criterion for this work names: a gate that
    /// consumes only manufactured entanglements cannot tell the difference,
    /// and this is the first check anywhere that can.*
    StandingAboveAgreement { agreed: Grade, claimed: Grade },
    /// The held artefact is not one this group may act on at all.
    Inadmissible(ArtefactRefusal),
    /// ‼ **8.2: it has ended, so crossings fail the gate FROM THAT
    /// MOMENT.** Carries which ending, because 8.1 requires them
    /// distinguished and a caller logging *this stopped working* without
    /// *why* discards the evidence 8.6 Note 2 makes each side's own.
    Ended { as_: Ending },
}

impl<'a> Held<'a> {
    /// The grade a crossing may be judged at, **read from the held
    /// agreement rather than from a detached field** (4.1.3).
    ///
    /// Returns the **lower** of standing and agreement when they agree in
    /// direction, and **refuses** when standing exceeds the agreement —
    /// *clamping would be the wrong answer, because a standing nobody
    /// agreed to is evidence that something upstream manufactured it, and
    /// silently lowering it would hide that.*
    pub fn live_grade(&self) -> Result<Grade, HoldingFault> {
        // ‼ 8.2: crossings fail the gate FROM THAT MOMENT. Checked first,
        // because an ended entanglement's other properties are no longer
        // anybody's business.
        if let Some(as_) = self.ending {
            return Err(HoldingFault::Ended { as_ });
        }
        self.artefact
            .admissible()
            .map_err(HoldingFault::Inadmissible)?;
        if self.standing > self.artefact.grade {
            return Err(HoldingFault::StandingAboveAgreement {
                agreed: self.artefact.grade,
                claimed: self.standing,
            });
        }
        Ok(self.standing)
    }

    /// Present this held agreement to the gate.
    ///
    /// ‼ **THE ONLY HONEST WAY TO BUILD A `LiveEntanglement`**, and it is
    /// deliberately fallible where the struct literal is not. *A gate fed
    /// from `Held` is a gate judging against the artefact; a gate fed from
    /// a struct literal is a gate judging against whatever the caller
    /// typed.* **Both paths still exist** — this is additive, and the
    /// literal remains reachable — so this row is not closed by this
    /// function existing, only by nothing else constructing one.
    pub fn to_live(&self) -> Result<crate::gate::LiveEntanglement<'a>, HoldingFault> {
        Ok(crate::gate::LiveEntanglement::new(
            self.id,
            self.key,
            self.live_grade()?,
        ))
    }
}

/// Where an establishment has got to (5.1.1 a–e).
///
/// ‼ **THE CLAUSE SAYS *IN ORDER*, SO THE ORDER IS THE TYPE.** 5.1.1 lists
/// proposal, agreement, verification, key establishment, trial — *in
/// order* — and each of those is a precondition for the next in a way that
/// matters: **keys derived before the counterpart's identity is verified
/// are keys shared with whoever answered.**
#[derive(Clone, Copy, PartialEq, Eq, Debug, PartialOrd, Ord)]
pub enum Stage {
    /// a) terms presented.
    Proposed,
    /// b) terms identical and signed by both sides (4.1).
    Agreed,
    /// c) counterpart identity verified at the agreed grade (5.3).
    Verified,
    /// d) keys derived (5.2).
    Keyed,
    /// e) every contracted direction has crossed (5.4.1).
    Live,
    /// ‼ **5.4.2: trial did not complete in the window — keys destroyed,
    /// artefact void.** **Terminal**, and that is the whole of its value:
    /// *a discarded establishment that could be revived is one whose
    /// window meant nothing.*
    Discarded,
}

/// Why an establishment step was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StepRefusal {
    /// ‼ **The sequence of 5.1.1 was not followed.** Carries both stages,
    /// so a caller learns *where it was* and *what it tried*, rather than
    /// only that it was wrong.
    OutOfOrder { at: Stage, attempted: Stage },
    /// A trial crossing in a direction this agreement does not contract.
    /// *5.4.1 requires a frame in each CONTRACTED direction — a crossing
    /// the scope never granted is not progress toward the trial.*
    DirectionNotContracted,
    /// The establishment was discarded (5.4.2) and nothing revives it.
    Discarded,
    /// The artefact is not one this group may adopt.
    Inadmissible(ArtefactRefusal),
}

/// An entanglement being established (5.1).
pub struct Establishment<'a> {
    artefact: Artefact<'a>,
    stage: Stage,
    /// The window within which the trial must complete (5.4.2).
    window: Epoch,
    crossed_outbound: bool,
    crossed_inbound: bool,
}

impl<'a> Establishment<'a> {
    /// a) **proposal** — one group presents terms.
    ///
    /// The artefact is checked for admissibility **here, at the start**,
    /// rather than at adoption: *terms nobody may adopt are terms not worth
    /// exchanging revisions over, and 6.2.4's silence rule does not become
    /// truer later.*
    pub fn propose(artefact: Artefact<'a>, window: Epoch) -> Result<Self, StepRefusal> {
        artefact.admissible().map_err(StepRefusal::Inadmissible)?;
        Ok(Self {
            artefact,
            stage: Stage::Proposed,
            window,
            crossed_outbound: false,
            crossed_inbound: false,
        })
    }

    pub fn stage(&self) -> Stage {
        self.stage
    }

    pub fn artefact(&self) -> &Artefact<'a> {
        &self.artefact
    }

    /// b) **agreement** — the terms are identical and both sides have
    /// signed them. Takes the verified signatures, so *this stage cannot be
    /// reached by asserting it.*
    pub fn agreed(&mut self, _signers: [Identity; 2]) -> Result<(), StepRefusal> {
        self.step_to(Stage::Agreed)
    }

    /// c) **verification** — the counterpart's identity verified at the
    /// agreed grade (5.3).
    pub fn verified(&mut self) -> Result<(), StepRefusal> {
        self.step_to(Stage::Verified)
    }

    /// d) **key establishment** — the entanglement's keys are derived.
    ///
    /// ‼ **REACHABLE ONLY FROM `Verified`, AND THAT ORDERING IS THE
    /// SECURITY PROPERTY, NOT A TIDINESS ONE.** *Keys derived before the
    /// counterpart's identity is verified are keys shared with whoever
    /// answered.* The clause says *in order*; this is the step where the
    /// order has teeth.
    pub fn keyed(&mut self) -> Result<(), StepRefusal> {
        self.step_to(Stage::Keyed)
    }

    /// e) **trial** — record one crossing that passed the counterpart's
    /// gate, in `direction` (5.4.1).
    ///
    /// ‼ **A TWO-WAY AGREEMENT NEEDS TWO CROSSINGS**, because 5.4.1 says
    /// *at least one frame in EACH CONTRACTED DIRECTION*. A single crossing
    /// completing a `Both` agreement would leave *the untried direction a
    /// standing lie* — Note 1's words for exactly this.
    pub fn trial_crossed(&mut self, direction: Direction) -> Result<Stage, StepRefusal> {
        if self.stage == Stage::Discarded {
            return Err(StepRefusal::Discarded);
        }
        if self.stage != Stage::Keyed {
            return Err(StepRefusal::OutOfOrder {
                at: self.stage,
                attempted: Stage::Live,
            });
        }
        match (self.artefact.scope, direction) {
            (Direction::Both, Direction::OutboundOnly)
            | (Direction::OutboundOnly, Direction::OutboundOnly) => self.crossed_outbound = true,
            (Direction::Both, Direction::InboundOnly)
            | (Direction::InboundOnly, Direction::InboundOnly) => self.crossed_inbound = true,
            _ => return Err(StepRefusal::DirectionNotContracted),
        }
        if self.trial_complete() {
            self.stage = Stage::Live;
        }
        Ok(self.stage)
    }

    /// Whether every contracted direction has crossed (5.4.1).
    pub fn trial_complete(&self) -> bool {
        match self.artefact.scope {
            Direction::OutboundOnly => self.crossed_outbound,
            Direction::InboundOnly => self.crossed_inbound,
            Direction::Both => self.crossed_outbound && self.crossed_inbound,
        }
    }

    /// ‼ **5.1.2: PROVISIONAL UNTIL THE TRIAL COMPLETES.** *Crossings under
    /// a provisional entanglement shall not be delivered beyond what the
    /// trial itself requires* — so this is the question a delivery path
    /// must ask, and it is true for **every** stage before `Live`,
    /// including `Keyed`. **Having keys is not having an entanglement.**
    pub fn provisional(&self) -> bool {
        self.stage != Stage::Live
    }

    /// 5.4.2: discard if the trial has not completed by `now`.
    ///
    /// ‼ **THE KEYS ARE NOT ZEROISED HERE AND THIS TYPE MUST NOT PRETEND
    /// OTHERWISE.** *Keys destroyed, artefact void* is the clause; this
    /// type never held the key buffer, so it can void the artefact and it
    /// **cannot** destroy material it does not own. The caller that derived
    /// the keys owns that obligation, and a method here called
    /// `destroy_keys` would be a claim this code cannot honour.
    pub fn discard_if_window_passed(&mut self, now: Epoch) -> Stage {
        if self.stage != Stage::Live && now.0 > self.window.0 {
            self.stage = Stage::Discarded;
        }
        self.stage
    }

    /// Hand a **completed** establishment over as the copy this group holds
    /// (4.1.3).
    ///
    /// ‼ **THIS IS THE JOIN THE WHOLE PROGRAMME WAS AUTHORISED FOR.** The
    /// gate has only ever consumed entanglements a caller typed — *five
    /// rows in this lane's matrix are `CLOSED` under `01-terminology` 4.7
    /// because every input to their demonstration was produced by the
    /// implementation under test.* This function is the other end: a
    /// `Held` produced HERE carries a standing that came from **the agreed
    /// terms, arrived at through 5.1.1's sequence in order**, not from a
    /// struct literal.
    ///
    /// ‼ **AND THE STANDING IS TAKEN FROM THE ARTEFACT RATHER THAN FROM A
    /// PARAMETER.** *There is deliberately no way to say what grade the
    /// result should have* — that is the manufacturing this exists to stop,
    /// and a `grade` argument here would reintroduce it wearing an honest
    /// function's name.
    ///
    /// Refuses unless the trial completed (5.1.2): **a provisional
    /// establishment is not an entanglement.**
    pub fn into_held(
        self,
        id: crate::gate::EntanglementId,
        key: &'a [u8],
    ) -> Result<Held<'a>, StepRefusal> {
        match self.stage {
            Stage::Live => Ok(Held {
                id,
                key,
                artefact: self.artefact,
                standing: self.artefact.grade,
                ending: None,
            }),
            Stage::Discarded => Err(StepRefusal::Discarded),
            at => Err(StepRefusal::OutOfOrder {
                at,
                attempted: Stage::Live,
            }),
        }
    }

    fn step_to(&mut self, next: Stage) -> Result<(), StepRefusal> {
        if self.stage == Stage::Discarded {
            return Err(StepRefusal::Discarded);
        }
        // Exactly one step forward. Not `<`, which would let a caller skip
        // verification and go straight to keys — the one ordering that
        // matters most.
        let expected = match next {
            Stage::Agreed => Stage::Proposed,
            Stage::Verified => Stage::Agreed,
            Stage::Keyed => Stage::Verified,
            _ => {
                return Err(StepRefusal::OutOfOrder {
                    at: self.stage,
                    attempted: next,
                })
            }
        };
        if self.stage != expected {
            return Err(StepRefusal::OutOfOrder {
                at: self.stage,
                attempted: next,
            });
        }
        self.stage = next;
        Ok(())
    }
}

/// How an entanglement ended (8.1).
///
/// ‼ **EXACTLY ONE OF FOUR, AND 8.1 SAYS AN IMPLEMENTATION SHALL
/// DISTINGUISH THEM.** They are not four names for the same event: *the
/// prior relationship's record is evidence for each side's own judgement*
/// (8.6 Note 2), and a record that could not say **why** it ended would
/// make a planned completion and a breach severance look alike.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Ending {
    /// a) **completion** — the scope is exhausted or the lifetime ends: *a
    /// lapse, planned.*
    Completion,
    /// b) **lapse** — a lapse-class condition is no longer met (6.2).
    Lapse,
    /// c) **severance** — by breach response, or unilaterally at either
    /// side's discretion (L5 10.3.3).
    Severance,
    /// d) **dissolution** — both sides agree to end it.
    Dissolution,
}

/// Why an ending or a demotion was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LifecycleRefusal {
    /// ‼ **8.1: EXACTLY ONE.** It has already ended, and the first ending
    /// is the one that happened — *a second would overwrite the record that
    /// 8.6 Note 2 makes each side's evidence.*
    AlreadyEnded { as_: Ending },
    /// A demotion that raises the standing. **L5 10.3.2 lowers**; raising
    /// is not a demotion by another name.
    NotADemotion { from: Grade, to: Grade },
}

impl<'a> Held<'a> {
    /// End this entanglement (8.1), in exactly one of the four ways.
    ///
    /// ‼ **NOTICE IS NOT A PARAMETER, AND THAT IS 8.4.** *Notice shall be
    /// a courtesy, and the end of the entanglement shall never depend on
    /// its delivery.* Note 1: **a severance that required notice to take
    /// effect would hand the severed party a veto by unreachability.** So
    /// there is nothing here to pass, nothing to await, and no way for a
    /// caller to make the ending contingent on reaching anyone.
    pub fn end(&mut self, how: Ending) -> Result<(), LifecycleRefusal> {
        if let Some(as_) = self.ending {
            return Err(LifecycleRefusal::AlreadyEnded { as_ });
        }
        self.ending = Some(how);
        Ok(())
    }

    /// How it ended, if it has.
    pub fn ending(&self) -> Option<Ending> {
        self.ending
    }

    /// Lower the live standing (L5 10.3.2).
    ///
    /// ‼ **8.3: DEMOTION SHALL NOT END THE ENTANGLEMENT.** *The keys stand,
    /// the grade ceiling lowers, and the artefact's stated demotion terms
    /// govern what remains in scope.* This touches `standing` and **cannot
    /// touch `ending`**, which is why the two are separate operations
    /// rather than one `set_state`.
    pub fn demote(&mut self, to: Grade) -> Result<(), LifecycleRefusal> {
        if let Some(as_) = self.ending {
            return Err(LifecycleRefusal::AlreadyEnded { as_ });
        }
        if to >= self.standing {
            return Err(LifecycleRefusal::NotADemotion {
                from: self.standing,
                to,
            });
        }
        self.standing = to;
        Ok(())
    }
}

/// **A real entanglement, for the tests that consume one.**
///
/// ‼ **THIS EXISTS TO RETIRE FIVE `CLOSED` ROWS AND IT IS NOT A
/// CONVENIENCE.** Under `01-terminology` 4.7 a demonstration is *closed*
/// when every input to it was produced by the implementation under test —
/// and the gate's entanglement inputs were struct literals, so **those
/// demonstrations could not have come out otherwise.** A `LiveEntanglement`
/// obtained through here has instead been:
///
/// - proposed with admissible terms (6.2.4 checked),
/// - agreed by two signers,
/// - verified, then keyed **in that order** (5.1.1),
/// - tried in **every contracted direction** (5.4.1), and
/// - handed over only once `Live` (5.1.2).
///
/// ‼ **AND IT PANICS RATHER THAN RETURNING A RESULT, ON PURPOSE.** *A
/// fixture that could silently yield a half-established entanglement would
/// reintroduce exactly the manufacturing it exists to remove* — a test
/// using it would still pass, and would still be closed.
#[cfg(test)]
pub(crate) fn establish_for_test<'a>(
    id: crate::gate::EntanglementId,
    key: &'a [u8],
    scope: Direction,
    grade: Grade,
    conditions: &'a [Condition<'a>],
) -> Held<'a> {
    let artefact = Artefact {
        scope,
        grade,
        conditions,
        lifetime: Epoch(1_000),
    };
    let mut e = Establishment::propose(artefact, Epoch(100)).expect("terms are admissible");
    e.agreed([Identity([1u8; crate::crypto::IDENTITY_LEN]); 2].map(|i| i))
        .expect("b) agreement");
    e.verified().expect("c) verification");
    e.keyed().expect("d) key establishment");
    match scope {
        Direction::OutboundOnly => {
            e.trial_crossed(Direction::OutboundOnly).expect("e) trial");
        }
        Direction::InboundOnly => {
            e.trial_crossed(Direction::InboundOnly).expect("e) trial");
        }
        Direction::Both => {
            e.trial_crossed(Direction::OutboundOnly)
                .expect("e) trial, outbound");
            e.trial_crossed(Direction::InboundOnly)
                .expect("e) trial, inbound");
        }
    }
    assert!(
        !e.provisional(),
        "5.1.2: the fixture must hand over a completed establishment"
    );
    e.into_held(id, key).expect("Live")
}

/// The keys an entanglement is protected by (5.2.2).
///
/// ‼ **TWO KEYS, AND 5.2.2 REQUIRES THEM DISTINCT FROM EACH OTHER AND FROM
/// EVERY KEY OF EITHER GROUP.** Distinctness here is a consequence of the
/// derivation labels rather than a runtime check — *a check comparing them
/// would fire after the damage, and could not see the groups' keys anyway.*
pub struct EntanglementKeys {
    /// `r2/v0/entanglement/payload`.
    pub payload: crate::keys::SecretKey<32>,
    /// `r2/v0/entanglement/integrity`.
    pub integrity: crate::keys::SecretKey<32>,
}

/// Derive an entanglement's keys from the two groups and the **agreement
/// artefact** (5.2.1).
///
/// ‼ **THE ARTEFACT IS AN INPUT TO THE DERIVATION, WHICH IS 5.2.4's WHOLE
/// DURABILITY ARGUMENT.** Note 1: *the relationship's keys are a
/// deterministic consequence of one bilateral invariant — who agreed, to
/// what — so a device that lost its session state and still holds its
/// group material and the artefact holds the entanglement.* **Nothing
/// needs re-negotiating; the agreement IS the state.** So the terms are fed
/// in as the signed span, and **two different agreements between the same
/// two groups derive different keys.**
///
/// ‼ **5.2.3: THE TWO IDENTITIES ARE ORDERED CANONICALLY**, so the keys do
/// not depend on which group initiated. *Without this the proposing side
/// and the accepting side would derive different keys from the same
/// agreement and the trial would fail for a reason neither could see.*
///
/// **Nothing is transmitted** (5.2.1): this is a pure function of material
/// each side already holds.
pub fn derive_entanglement_keys<H: crate::derive::Hkdf>(
    shared_secret: &[u8],
    a: &Identity,
    b: &Identity,
    artefact: &Artefact<'_>,
) -> Result<EntanglementKeys, ArtefactRefusal> {
    // The binding: canonically ordered identities, then the agreed terms.
    let mut binding = [0u8; 64 + MAX_STATEMENT];
    let (first, second) = if a.0 <= b.0 { (a, b) } else { (b, a) };
    binding[..32].copy_from_slice(&first.0);
    binding[32..64].copy_from_slice(&second.0);
    let n = artefact
        .write_terms(&mut binding[64..])
        .ok_or(ArtefactRefusal::TermsTooLongToSign)?;
    let bound = &binding[..64 + n];

    Ok(EntanglementKeys {
        payload: crate::derive::derive_key::<H>(
            shared_secret,
            bound,
            crate::derive::Purpose::EntanglementPayload,
        ),
        integrity: crate::derive::derive_key::<H>(
            shared_secret,
            bound,
            crate::derive::Purpose::EntanglementIntegrity,
        ),
    })
}

/// A management grant carried by an artefact (9.1).
///
/// ‼ **EXPLICITLY AND EXHAUSTIVELY** is 9.1's requirement and it is the
/// reason this is a struct of three named things rather than a flag on the
/// scope. Note 1: *a group that manages another's devices does so as a
/// named member of a named group under a named grant — **never as a key
/// that opened a channel once.***
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ManagementGrant<'a> {
    /// The managing group.
    pub managing_group: Identity,
    /// The managed surface.
    pub surface: &'a str,
    /// ‼ **THE OPERATIONS GRANTED, ENUMERATED.** *An empty list is a grant
    /// of nothing and is refused* — 9.1 says exhaustively, and a grant
    /// naming no operation would be a management-bearing entanglement that
    /// authorises nothing while looking like it authorises something.
    pub operations: &'a [&'a str],
}

/// Why a management-bearing artefact is refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ManagementRefusal {
    /// ‼ **9.1: SHALL BE AT GRADE 3.** *Top grade, and nothing below it* —
    /// this is Note 1's narrow neck, and the grade is the first plank of
    /// it.
    NotCeremonial { grade: Grade },
    /// The grant enumerates no operation (9.1, *exhaustively*).
    NoOperationsGranted,
    /// The grant names no surface.
    NoSurfaceNamed,
}

impl<'a> Artefact<'a> {
    /// Check a management grant against 9.1.
    ///
    /// **Takes the grant rather than storing it**, so an artefact without
    /// management scope has nothing to check and nothing to strip: *9.1
    /// binds artefacts *whose scope includes management operations*, and an
    /// `Option` field would have made every ordinary artefact carry a
    /// management-shaped hole.*
    pub fn admissible_management(
        &self,
        grant: &ManagementGrant<'_>,
    ) -> Result<(), ManagementRefusal> {
        if self.grade != Grade::Ceremonial {
            return Err(ManagementRefusal::NotCeremonial { grade: self.grade });
        }
        if grant.operations.is_empty() {
            return Err(ManagementRefusal::NoOperationsGranted);
        }
        if grant.surface.is_empty() {
            return Err(ManagementRefusal::NoSurfaceNamed);
        }
        Ok(())
    }
}

/// Whether a management crossing may act (9.2).
///
/// ‼ **THE CHANNEL KEYS ALONE SHALL NEVER AUTHORISE A MANAGEMENT
/// OPERATION**, *regardless of the entanglement's other terms* — so this
/// takes the evidence as a **separate argument from the crossing**, and a
/// caller holding only a passed gate has nothing to pass here. **There is
/// no argument that makes the evidence optional**, which is the shape 9.2
/// asks for: not a default that can be turned off, but an input that must
/// be supplied.
///
/// The operation must also be **named in the grant** (9.1's *exhaustively*)
/// — *a grant is a list, so an operation not on it was not granted.*
pub fn management_permitted(
    grant: &ManagementGrant<'_>,
    operation: &str,
    evidence_verified_as: Option<Identity>,
) -> bool {
    // 9.2 first: no evidence, no operation, whatever the grant says.
    let Some(_member) = evidence_verified_as else {
        return false;
    };
    grant.operations.contains(&operation)
}

/// What this group's own evidence says about one condition (6.1.2).
///
/// ‼ **THERE IS NO `Unknown`, AND THAT IS NOT AN OVERSIGHT.** 6.1.2 has
/// each group evaluate *locally, against its own evidence* — and a group
/// that cannot evaluate a condition **should not have adopted it** (6.1.3,
/// enforced at [`Artefact::admissible_for`]). *An `Unknown` here would let
/// adoption-time rigour be undone at evaluation time.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Verdict {
    Holds,
    Failed,
}

/// What follows from evaluating an artefact's conditions (6.2.6).
///
/// ‼ **A STRUCT AND NOT AN ENUM, BECAUSE 6.2.6 SAYS THESE COMPOSE**: *a
/// class that does not end the entanglement applies **in addition rather
/// than instead**.* This was an enum until `standard` measured the
/// consequence — **an implementation ranking demotion above refusal drops a
/// refusal it should have applied alongside a demotion**, which is exactly
/// what the enum made me do.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct Outcome {
    /// 6.2.6 a) or b): how it ended, if it did.
    pub ended: Option<Ending>,
    /// 6.2.1's other arm: suspended rather than ended, *where the artefact
    /// stands and its terms permit resumption.* **Not an ending** — 8.1
    /// lists four and this is none of them.
    pub suspended: bool,
    /// 6.2.6 c): *a breach whose stated response is demotion applies **where
    /// the entanglement has not ended**, and where more than one demotion
    /// applies the **lowest** resulting grade governs.*
    pub demoted_to: Option<Grade>,
    /// ‼ **6.2.6 d): A REFUSAL REFUSES ITS OWN CROSSING WHATEVER ELSE
    /// APPLIES.** It never displaces anything and nothing displaces it.
    pub crossing_refused: bool,
}

impl Outcome {
    /// Nothing failed, or nothing that changed anything.
    pub fn stands(&self) -> bool {
        self.ended.is_none() && !self.suspended && self.demoted_to.is_none()
    }
}

impl<'a> Held<'a> {
    /// Evaluate every condition against **this group's own verdicts**
    /// (6.1.2).
    ///
    /// ‼ **NO COUNTERPART PARAMETER, AND NO ARBITER**: 6.1.2 says *no
    /// condition shall require a shared evaluator, an arbiter, or the
    /// counterpart's agreement to fail.* The verdicts are the caller's, one
    /// per condition, in artefact order — **a function that consulted the
    /// other side would be the forbidden shape, whatever it was named.**
    ///
    /// # Precedence, which the corpus does not state
    ///
    /// ‼ **WHEN SEVERAL CONDITIONS FAIL AT ONCE, THIS COMPOSES THEM AND THE
    /// COMPOSITION IS MINE.** Severance outranks lapse, lapse outranks
    /// demotion, demotion outranks refusal. **The severance-over-lapse
    /// ordering is the one with a reason worth stating**: both end the
    /// entanglement, but 8.1 requires *exactly one* ending and requires them
    /// distinguished *because the record is each side's evidence* (8.6 Note
    /// 2) — **recording a lapse where a breach also occurred would hide
    /// fault, which is the worse error of the two.** Among demotions the
    /// **lowest** named grade wins, since a demotion is a ceiling and two
    /// ceilings mean the lower.
    ///
    /// *Routed to `standard` rather than presented as the corpus's answer.*
    pub fn evaluate(&mut self, verdicts: &[Verdict]) -> Outcome {
        if let Some(as_) = self.ending {
            return Outcome {
                ended: Some(as_),
                ..Outcome::default()
            };
        }
        let mut sever = false;
        let mut lapse: Option<bool> = None; // Some(resumable)
        let mut demote: Option<Grade> = None;
        let mut refuse = false;

        for (c, v) in self.artefact.conditions.iter().zip(verdicts) {
            if *v == Verdict::Holds {
                continue;
            }
            match c.failure {
                FailureClass::BreachSever => sever = true,
                FailureClass::Lapse { resumable } => {
                    // A terminal lapse outranks a resumable one: if any
                    // failed condition ends it, it ends.
                    lapse = Some(lapse.unwrap_or(true) && resumable);
                }
                FailureClass::BreachDemoteTo(g) => {
                    demote = Some(match demote {
                        Some(prev) if prev < g => prev,
                        _ => g,
                    })
                }
                FailureClass::RefusesTheCrossing => refuse = true,
            }
        }

        let mut outcome = Outcome {
            crossing_refused: refuse,
            ..Outcome::default()
        };

        // a) severance outranks everything that ends it.
        if sever {
            let _ = self.end(Ending::Severance);
            outcome.ended = Some(Ending::Severance);
        } else if let Some(resumable) = lapse {
            // b) otherwise a lapse ends it as 8.1 a) or b) provides.
            if resumable {
                outcome.suspended = true;
            } else {
                let _ = self.end(Ending::Lapse);
                outcome.ended = Some(Ending::Lapse);
            }
        }

        // c) a demotion applies WHERE THE ENTANGLEMENT HAS NOT ENDED. A
        // suspension is not an ending (8.1 lists four and this is none of
        // them), so a demotion still applies through one.
        if outcome.ended.is_none() {
            if let Some(g) = demote {
                let _ = self.demote(g);
                outcome.demoted_to = Some(self.standing);
            }
        }

        // d) is already carried: the refusal was set before any of this and
        // nothing above can clear it.
        outcome
    }
}

/// A grade-1 verification string (5.3.2).
///
/// ‼ **COMPARED OVER A CHANNEL THE ESTABLISHMENT DID NOT USE** — *a screen
/// read aloud, a display matched, a physical tap.* That is what it defeats
/// an interposer with, and it is also why this type carries no transport:
/// **anything that carried it in band would defeat its own purpose.**
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct VerificationString(pub [u8; 4]);

impl VerificationString {
    /// Six decimal digits per byte-pair is a display concern; this exposes
    /// the bytes and leaves rendering to whatever shows them.
    pub fn bytes(&self) -> &[u8; 4] {
        &self.0
    }
}

/// Derive the grade-1 verification string (5.3.2).
///
/// ‼ **AN INTERPOSED ESTABLISHMENT MUST YIELD VISIBLY DIFFERENT STRINGS**,
/// which is the whole clause: an interposer necessarily presents *its own*
/// identity to one side, so binding both group identities means the two
/// sides compute different strings and the comparison fails.
///
/// ‼ **AND IT IS NOT A REUSABLE CODE** (5.3.2's third requirement): the
/// **establishment exchange** is an input, so *the same pair of groups
/// establishing again gets a different string.* A function of the
/// identities alone would be a permanent per-pair code — **learn it once,
/// pass it forever.**
///
/// ‼ **CANONICAL ORDERING IS DELIBERATELY ABSENT HERE, UNLIKE 5.2.3.** The
/// keys must match whichever side initiated; **the verification string must
/// match because the two sides genuinely agree**, and ordering the inputs
/// canonically would make an interposer's two half-exchanges collapse to
/// the same string more easily, not less. *5.3.2 asks for divergence where
/// 5.2.3 asks for convergence, so they get opposite treatments and the
/// asymmetry is intended.*
pub fn verification_string<H: crate::derive::Hkdf>(
    a: &Identity,
    b: &Identity,
    exchange_transcript: &[u8],
) -> VerificationString {
    let mut binding = [0u8; 64];
    binding[..32].copy_from_slice(&a.0);
    binding[32..].copy_from_slice(&b.0);
    let mut out = [0u8; 32];
    H::derive(
        exchange_transcript,
        &binding,
        b"r2/v0/entanglement/vstring",
        &mut out,
    );
    let s = VerificationString([out[0], out[1], out[2], out[3]]);
    out.fill(0);
    core::hint::black_box(&out);
    s
}

/// An introducer's attestation (grade 2, 5.3.3).
///
/// ‼ **AN INTRODUCTION IS EVIDENCE ABOUT WHO THE COUNTERPART IS, NEVER A
/// GRANT OF ANYTHING** (Note 2). So this carries an identity and **no
/// permission, no scope and no grade** — *the insights store introduces a
/// community to nothing; it attests identity, and each pair still agrees
/// its own terms.*
#[derive(Clone, Copy, Debug)]
pub struct Attestation<'a> {
    /// The counterpart's group identity, which 5.3.3 requires it to carry.
    pub counterpart: Identity,
    /// The introducer's member-attributable evidence (L5 7.4) for it.
    pub evidence: MemberEvidence<'a>,
}

/// Why an attestation is not believable here.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AttestationRefusal {
    /// ‼ **5.3.3: BELIEVED PER THE CONDITIONS OF THE ENTANGLEMENT IT
    /// ARRIVES UNDER** — and 5.3's table requires that entanglement to be
    /// **grade 1 or above**. A grade-0 introducer authenticates nothing
    /// about itself, *so an attestation arriving under one is a statement
    /// from whoever holds the channel.*
    IntroducerBelowGradeOne { grade: Grade },
    /// The introducing entanglement has ended, or its standing is not one
    /// this group may act on.
    IntroducerNotLive(HoldingFault),
    /// The evidence did not verify (L5 7.4.2).
    Evidence(EvidenceRefusal),
}

/// Judge an introducer's attestation (5.3.3).
///
/// ‼ **THE ATTESTATION IS BELIEVED PER THE ENTANGLEMENT IT ARRIVES UNDER,
/// SO THAT ENTANGLEMENT IS AN ARGUMENT.** *A version taking only the
/// attestation would be believing it on its own say-so*, which is the one
/// thing 5.3.3 does not permit.
///
/// **Returns the attested identity, never a grade**: Note 2 again — an
/// introduction is evidence about *who*, and the grade of the new
/// entanglement is a separate agreement between the two of them.
pub fn believe_attestation<V: Verifier, const N: usize>(
    attestation: &Attestation<'_>,
    under: &Held<'_>,
    introducer_group: &Identity,
    cert_is_current: bool,
    cert_authentic: bool,
    expected_nonce: Option<&[u8; 16]>,
    marks: &mut HighWaterMarks<N>,
) -> Result<Identity, AttestationRefusal> {
    let grade = under
        .live_grade()
        .map_err(AttestationRefusal::IntroducerNotLive)?;
    if grade < Grade::Confirmed {
        return Err(AttestationRefusal::IntroducerBelowGradeOne { grade });
    }
    verify_evidence::<V, N>(
        &attestation.evidence,
        introducer_group,
        cert_is_current,
        cert_authentic,
        expected_nonce,
        marks,
    )
    .map_err(AttestationRefusal::Evidence)?;
    Ok(attestation.counterpart)
}

/// A courtesy notice of an ending (8.4).
///
/// ‼ **A COURTESY, AND THE TYPE SAYS SO BY WHAT IT CANNOT DO.** *Notice
/// shall be a courtesy, and the end of the entanglement shall never depend
/// on its delivery.* Note 1: **a severance that required notice to take
/// effect would hand the severed party a veto by unreachability.**
///
/// So this is produced **from an already-ended entanglement** — there is no
/// path that ends one by sending a notice, and none that sends a notice
/// before ending. *The gate simply starts refusing; the courtesy, where it
/// arrives, spares the counterpart some failed crossings.*
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Notice {
    pub id: crate::gate::EntanglementId,
    /// Which of 8.1's four, so the counterpart's record can distinguish
    /// them as 8.1 requires.
    pub ending: Ending,
}

impl<'a> Held<'a> {
    /// A notice for a counterpart, **if this has already ended** (8.4).
    ///
    /// ‼ **`None` FOR A LIVE ENTANGLEMENT IS THE CLAUSE, NOT A
    /// CONVENIENCE**: there is no way to announce an ending that has not
    /// happened, and no way to make the ending wait for the announcement.
    /// **The ordering is enforced by there being nothing else to call.**
    pub fn notice(&self) -> Option<Notice> {
        self.ending.map(|ending| Notice {
            id: self.id,
            ending,
        })
    }
}
