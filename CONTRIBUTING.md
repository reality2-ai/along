# Contributing

Start with the README, architecture and interaction principles. Describe a real
commuter scenario and the behaviour you want to improve before changing code.

Keep likely next actions clear, alternatives discoverable, and access needs
explicit. Do not turn missing accessibility data into a positive claim. Avoid
collecting private journeys, precise locations or credentials in issues and logs.

For changes, explain the trigger, before/after behaviour, verification and limits.
Use small synthetic fixtures for routing rules and real datasets for integration
checks. Run `npm test`; use the browser, update and static suites for affected
behaviour. Reversible wording-only edits do not need tests that merely repeat the
implementation. Check the release checklist before claiming readiness.

Data downloads, `.env`, local agent state and generated release archives are
ignored. Review what you publish; a clean-looking screenshot is not a security,
accessibility or route-correctness audit. Keep attribution with redistributed data.

The project has no published security contact yet. Do not publish credentials or
private travel records when reporting a problem. Coordinate sensitive reports
privately with the maintainer of the instance you use.

For contextual details, test nested Back/Escape, focus and scroll restoration,
branch selection and offline maps. Use the text stop list as the parallel
interaction; a map-only control is insufficient. Intercept street tiles in
automated tests rather than exercising a public tile service with a bot.

Rebuild the static package after app or notice changes. Keep source, deployment,
archive and service-worker version consistent. Do not expose an AT key in Pages
or other static builds. See [hosting](docs/HOSTING.md) for AWS and GitHub Pages.
