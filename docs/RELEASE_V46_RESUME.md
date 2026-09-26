# Resume v46 release verification

**Historical interruption checklist:** v46 has since been qualified, published
and verified. See [the completed release record](RELEASE_V46.md). The sequence
below documents the recovery from the temporary environment restriction; it is
not a request to rerun or republish the immutable release.
The app candidate remains unchanged: manifest SHA-256
`52153fbae3754d5b6deefc9124a6be3c1d312f8bd7ac3a0091fcdeeafed994a5`.

The latest local changes correct the installed-version test's observation of a
failed worker installation. Its focused v41 run passed before session restrictions
changed. See [release record](RELEASE_V46.md) and
[diagnostic evidence](evidence/v46-update-job-observation.json).

Access was restored later on 26 September. GitHub feedback was checked again
(no open issues), and no surviving qualification process or final report was
found. The sequence below remains the release checklist.

## Session restrictions verified on 26 September 2026

- Staging the five changed source/evidence files failed with
  `Unable to create .../.git/index.lock: Read-only file system`.
- `gh issue list --repo reality2-ai/along --state open --json number,title`
  failed with `error connecting to api.github.com`.
- `node test/check_static.mjs --regular` verified candidate file hashes, then
  failed before browser launch with `listen EPERM ... 127.0.0.1`.

These are environment failures, not successful tests or evidence of app defects.
Do not bypass the restrictions, remove qualification gates or publish the partial
report. No user coding is required; the agent resumes when repository writes,
normal network access and local test-server binding are available again.

## Agent resume sequence

1. Read the goal and current worktree. Recheck access and GitHub feedback.
   Check for any surviving test process before starting another run; the previous
   session handle `51284` was reported missing and no final report was saved.
2. Review and commit the test correction and its documentation/evidence. Preserve
   the initial failed report and second partial report. Push the source commit.
3. Rebuild the unchanged v46 candidate using the verified public runtime:
   `python3 scripts/build_upgrade_candidate.py --runtime releases/along-r2-runtime-public-82377f1`.
   Verify the candidate manifest remains the hash above.
4. Run `python3 scripts/qualify_regular_candidate.py` with `CHROMIUM_PATH` set to
   the installed Chromium executable and `R2_WASM_DIR` / `R2_BROWSER_DIR` set to
   the public runtime's `wasm` / `browser` directories. Keep source and candidate
   unchanged while it runs. Observe its actual process to terminal completion.
5. Require all 41 distinct scenarios to pass and the final report to confirm
   unchanged source and candidate. Run the static browser check serially after
   qualification. Investigate any failure without broad timeout increases.
6. Package only with `scripts/prepare_regular_release.py` and its matching passed
   report. Verify checksums, reproduction and all release files before publication.
7. Publish the exact package to the existing Pages branch `site-preview`, preserving
   historical `preview/` and `pairing-lab/` directories. Publish the versioned GitHub
   release. Verify served-file hashes, app version and offline browser behaviour.
8. Update README, installation/release documentation and the full-goal audit to the
   actually published version. Request the remaining physical-device checks.

Public-hive forwarding, S23/desktop installation and pairing, spoken TalkBack and
signed-in browser feedback submission remain separate acceptance items. Local
relay checks do not prove interoperability with the user's hive. Server changes
remain assigned to the server AI.
