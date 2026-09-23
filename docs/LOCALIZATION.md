# English and te reo Māori implementation

This is work in progress under [goal requirement 10](PROJECT_GOAL.md).
The deployed version 28 interface remains English. The new localisation module
and initial phrase catalogue are not yet connected to its screens. No phrase has
received fluent-speaker review. Technical tests do not establish translation quality.

## Implemented foundation

- `public/locales.js` holds named interface phrases, language names and tags.
  Missing translations are explicit `null` values rather than fabricated text.
- `public/i18n.js` stores the language under a separate device-local key. It makes
  no network requests and does not read or change saved journeys or navigation.
  Storage failure leaves switching usable for the current session.
- Phrases carry their actual language. An English fallback must be marked
  `lang="en-NZ"` even when the containing interface is Māori. A Māori phrase is
  marked `mi-NZ`; pronunciation also depends on the installed speech engine.
- Named substitutions preserve official names and route identifiers. Insert
  phrases with `textContent`, or escape them before building HTML. Translations
  themselves are plain text; links and controls remain structured elements.
- Unit checks cover persistence, blocked storage, invalid languages, fallback,
  substitutions, notifications and placeholder agreement.

## Remaining implementation

1. Complete the phrase catalogue for static markup, generated journey and stop
   details, walking instructions, saved-service labels, accessibility information,
   loading and failure states, updates and recovery, installation guidance and
   screen-reader announcements. The initial catalogue covers flow headings and
   common actions only.
2. Add the English / Te reo Māori selector with persistent draft labelling. Apply
   language changes to the current screen and any open detail view without
   restarting a search, losing input, changing a journey or resetting Back.
3. Include language modules and both installation guides in the offline shell;
   verify the static `/along/` build without a backend and installed-app updates.
4. Verify bilingual place lookup against names actually present in source data.
   Stop and address search already remove combining accents when matching; this
   alone does not establish bilingual alias support. Do not invent translations
   of official addresses, street names, stops or route identifiers.
5. Check both languages across the full flow, offline reopening, narrow screens,
   zoom, keyboard navigation and spoken screen readers. Verify readable fallback
   notices and that saved endpoints and service preferences remain unchanged.
6. Obtain fluent-speaker review before presenting the Māori interface as finished.

## Language review without coding

[The review sheet](LANGUAGE_REVIEW.csv) contains the current English source,
draft Māori wording and status. It is an initial subset, not a complete translation.
The AI regenerates it with `node scripts/export_language_review.mjs` as the
catalogue grows. Keep reviewer feedback separately so regeneration cannot erase it.

A fluent reviewer can supply corrections as ordinary text, annotated screenshots
or a copy of the sheet. Review natural phrasing, the meaning of each action in
context, Auckland names, travel and accessibility terminology, and consistency.
The AI applies corrections and repeats technical checks. Record the reviewed
phrase IDs, source revision, date and reviewer attribution with their consent;
changed source wording needs renewed review. Never infer approval from silence or
from an automated test passing. Until review is complete, label the translation as
a draft and disclose any remaining English text.
