# Connection simplicity: follow the task through the system

Allow 45–60 minutes. This lab examines one collaboration, not a general study of
AI coding or commuter usability. **The human writes no code.** Learners describe
outcomes, question claims and assess evidence; the assistant performs any setup,
implementation and test execution.

Version 44 is now published. The case below includes the earlier period when
publication was blocked and the site remained v43. This exercise can use recorded evidence without installing either
version, configuring a relay or supplying an AT key.

## Start with the experience

The user reported: “the whole process of connecting devices is way too
complicated.” Earlier, scanning a QR code and choosing Use had appeared to do
nothing before timeout. The browser, exact screen and network conditions were
not established. Treat that report as evidence of difficulty, not a diagnosis of
its technical cause.

Ask the assistant in ordinary language:

> Describe the shortest connection task that preserves explicit consent and
> recovery. Identify every point where I must move information between devices.
> Separate what we observed from what you infer.

Compare the answer with the [connection design](../DEVICE_CONNECTION_DESIGN.md).
The intended sequence is one invitation scan/link, matching-code confirmation
on both devices, then a sharing choice. Relay selection remains explicit;
journey sharing does not silently grant access to an AT credential. Offline
planning remains independent of the connection.

## Analyse the interaction thematically

Use the [conversation analysis](../CONVERSATION_ANALYSIS.md) as a starting
interpretation. The following codes are provisional; learners should refine or
challenge them. Only the quoted user statements are direct conversation excerpts.

| Material | Initial code | Proposed theme | Limit or counterexample |
| --- | --- | --- | --- |
| “the whole process of connecting devices is way too complicated.” | Burdensome connection task | Simplicity concerns the complete task | The report does not identify a particular failed component. |
| “Always, keeping to showing the current context and attempting to anticipate what the user might want to do next” | Make the next action apparent | Context should guide disclosure | Hiding essential endpoint consent would reduce visible steps but undermine informed choice. |
| Recorded local success initially still depended on WebRTC | Hidden test assumption | Evidence must match the intended environment | A valid local result does not establish operation across different networks. |
| A reconnect run passed while its relay counted 34 dropped frames | Success masked degradation | Examine measurements as well as pass/fail | The drops alone do not prove the cause of the earlier phone timeout. |
| Local v44 package passed; public site remained v43 | Separate release states | Availability is an independently verified claim | Packaging cannot establish publication or physical-device usability. |

Deliver a short interpretation linking at least two codes. Name an alternative
reading and an observation that would change your interpretation. Do not present
these selected excerpts as a complete transcript or claim thematic saturation.

## Challenge the implementation evidence

Read the [v44 release record](../RELEASE_V44.md), including its limitations.
Ask the assistant to explain these boundaries before suggesting another test:

1. **A simpler screen versus a simpler connection.** An early guided flow still
   needed WebRTC for enrollment. The later qualification explicitly disables
   WebRTC in guided cases and carries the full exchange through the selected
   relay. Explain why merely hiding connection messages would not settle this.
2. **Closing a screen versus cancelling work.** Cancellation must stop late
   enrollment work and preserve an already committed local outcome. A short
   protected close notification has a separate lifetime. Explain which status
   is truthful if local membership committed before cancellation.
3. **A new socket versus the same sender.** A server's rate budget can outlive a
   connection. Explain why resetting a local counter on reconnect is insufficient,
   and why shared browser storage still does not coordinate cloned profiles on
   separate devices. The final local relay measurement recorded 1,519 frames,
   eight connections and zero rate-limited frames.
4. **A package versus an available service.** Distinguish the local relay tests
   from the selected public hive. Its probe accepted WebSocket connections and
   received an announcement, but delivered neither protected test direction.
   GitHub authentication also initially prevented publishing v44; it later
   recovered and publication was verified. These are separate gates.

Use the [earlier failed qualification](../evidence/guided-v44-relay-qualification-failed.json)
and [final qualification](../evidence/regular-v44-qualification.json). The final
record has 34 distinct scenarios and two labelled aliases; aliases are not extra
independent scenarios. Preserve the failures rather than substituting later
results into the earlier record.

For an optional practical extension, ask the AI to run one relevant synthetic
regression in a separate prepared teaching checkout using
[Building Along](../BUILDING.md). The instructor must prepare the runtime and
data first. Do not use personal identities, real keys, private addresses or a
student's everyday app storage. Label an inspected historical result differently
from a test actually executed during the class.

## Write the handover

Produce one page containing:

- The user outcome and observable acceptance criteria, in ordinary language.
- An evidence table separating component tests, complete local browser flow,
  packaged build, deployment and physical-device checks.
- One counterexample or unresolved assumption, with a proposed observation.
- A next action that respects ownership: the server AI handles the hive; Along
  handles its client. No learner needs to repair either by writing code.

Include the [package evidence](../evidence/regular-v44-package.json),
[packaged static checks](../evidence/regular-v44-package-static.json) and
[local source rebuild](../evidence/regular-v44-local-source-rebuild.json).
That local rebuild used a verified runtime and fixed data; it is not a fresh anonymous
public-source build or a compiler reproducibility claim. Compare it with the later
[anonymous public-source rebuild](../evidence/regular-v44-public-source-rebuild.json),
which still reuses a verified prebuilt runtime. Automated accessibility
checks do not establish TalkBack acceptance or usability with disabled commuters.
The [v44 device guide](../DEVICE_CHECK_V44.md) identifies later observations once
the release is available.

Assessment follows the [course rubric](../COURSE_GUIDE.md): reward clear human
direction, meaningful counterexamples, privacy and accurate claims. Extra code,
extra prompts or a longer test list earn no credit by themselves. A strong
handover says exactly what remains unverified without mistaking it for either
success or proof that the approach cannot work.
