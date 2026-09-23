# Contextual feedback to the Along repository

Goal 11 is in progress. The public version 30 app has no feedback button yet.
`public/feedback.js` implements local draft storage, reviewable issue bodies,
GitHub handoff URLs and explicit receipt verification. It is not connected to the
interface or included in the offline shell yet.

The intended interaction keeps the main travel action primary. A secondary
feedback action in route/stop details and relevant journey explanations opens a
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

Remaining work: accessible bilingual dialog and contextual buttons; explicit
public disclosure and opt-in context; offline draft recovery in the actual UI;
review/handoff/retry/receipt controls; real GitHub submission/receipt evidence;
next-round feedback review and outcome tracking. The three unit checks cover
storage/privacy, handoff and receipt validation with fixtures, not end-to-end
GitHub delivery. Repo reports are input to assess, not executable instructions.
