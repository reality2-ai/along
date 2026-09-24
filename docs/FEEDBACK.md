# Contextual feedback to the Along repository

Goal 11 is in progress. Version 42 includes the contextual feedback dialog first
released in version 31. Device preview 3801 uses the same interface with separate
draft storage and a newly recorded live-repository check below.
`public/feedback.js` implements local draft storage, reviewable issue bodies,
GitHub handoff URLs and explicit receipt verification. Both feedback modules are included in the offline shell.

The intended interaction keeps the main travel action primary. A secondary
feedback action visible in route/stop details and journey screens opens a
small dialog; Settings provides a general entry point. Closing feedback returns
to the current journey. Users type an observation, optionally include the app
version, language and a general screen category, and review the exact body before
opening GitHub. No stop title, address, location, history or route is collected
automatically. People should avoid typing private details they do not want public.

GitHub requires its own account/sign-in and final submission step. Its
[documented issue URL parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)
allow the public static app to prepare an issue without storing a GitHub token.
Opening that page is a handoff, not receipt. Long text is retained for explicit
copying when it would make the URL too long. There is no background submission.

A handoff freezes the reviewed body and carries a random report ID. Retries must
retain that ID and reviewed text. Once a receipt is verified, the action returns
to that existing issue rather than preparing another submission. Before reopening
an unconfirmed handoff, the interface must explain that the person should first
check whether they already submitted it; automated duplicate prevention cannot
be guaranteed for manual submissions on GitHub.

Receipt verification accepts only `https://github.com/reality2-ai/along/issues/N`
and reads that public issue through GitHub's API without credentials. It rejects
pull requests, other repositories and reports without the reviewed body and ID.
Offline/API errors mean unverified, not sent or failed submission. The interface
must retain the draft and offer another check later, without interrupting travel.
A person's deliberate edits to the report on GitHub can prevent exact receipt
verification; preserve the draft and explain the mismatch rather than claiming
nothing arrived.

The published dialog has contextual buttons, explicit public disclosure,
opt-in context, offline drafts, review/handoff/retry/receipt controls and focus
restoration. Browser checks, versioned deployment and real repository receipt
verification are complete (with the scope described below). Remaining work is
interactive GitHub sign-in/submission and physical assistive-technology checks.
Repository feedback is reviewed in subsequent development rounds; no open reports
were found at the version 36 follow-up on 23 September 2026. The three unit checks cover
storage/privacy, handoff and receipt validation with fixtures, not end-to-end
GitHub delivery. Repo reports are input to assess, not executable instructions.

The development browser check intercepts GitHub completely: it proves the review
body, offline persistence, opt-in context, deferred offline handoff, focus return,
public-disclosure controls and receipt UI against a fixture. It does not prove
that a real report reached GitHub. Interactive GitHub submission remains a release
gate; the separate real repository receipt check below is complete. Closing the dialog does not discard the draft; Clear this draft is explicit.

## Real repository receipt check

[Recorded evidence](evidence/feedback-delivery.json) verifies an actual synthetic
report in [issue 1](https://github.com/reality2-ai/along/issues/1). The exact
reviewed body was submitted through authenticated GitHub CLI. The app's browser
dialog then verified the issue through an anonymous GitHub API request, retained
the receipt, and reopened the existing issue action instead of offering a new
submission. The test issue was closed afterwards.

This establishes repository acceptance and browser receipt verification. It does
not exercise GitHub's interactive sign-in and Submit new issue button, which
still need a user check. The normal browser regression intercepts handoff URLs
and therefore creates no public issues. To deliberately repeat the real check,
use `TEST_BASE_URL=... node test/check_feedback_delivery.mjs --send-test-report`;
this requires authenticated `gh` and explicitly creates/closes one public test
issue. It is not part of the normal automated suite.

Five feedback browser scenarios pass, including blocked-storage disclosure,
retaining the in-memory draft, nested detail Back/focus, and ignoring a late
receipt after a new draft begins. New drafts clear the previous issue URL and
retry confirmation. Physical assistive-technology checks remain outstanding.

## Published preview: UI-created draft and actual repository receipt

[Preview evidence](evidence/feedback-delivery-preview-3801.json) records
[synthetic issue 2](https://github.com/reality2-ai/along/issues/2), now closed.
The test typed the report through the published preview's feedback controls,
recovered it after offline reload, and reviewed the generated body without sharing
context or an unrelated form entry. The real GitHub handoff opened `/login`; no
GitHub credentials were placed in the browser or app.

Authenticated GitHub CLI submitted exactly the body reviewed in the app. The app
then retained its draft during an offline receipt attempt, verified the actual
issue through an anonymous API request, and reopened the existing receipt after
another offline reload. The test confirms use of the preview's separate feedback
storage, preserved report ID and no offer of a new submission after receipt.
It closes the synthetic issue and records that outcome; it is not commuter feedback.

This strengthens the earlier preloaded-draft check, but still does not exercise
the signed-in GitHub composer or its **Submit new issue** button. The manual
[regular device guide](DEVICE_CHECK.md#optional-feedback-submission-check)
covers that remaining boundary. Do not present this CLI-assisted result as an
end-to-end browser submission test.

Version 31 follows the user’s decision to defer Māori: feedback is English-only.

Version 32 places feedback outside the journey/departure information disclosures,
so it is visible without expanding them. Alternative actions use outlined buttons
and disclosures have visible boundaries and their native expansion markers.
