# Make the likely next action clear

Standing design direction from the user:

> Always think: what is the user most likely to want to do next, and make sure
> that is the option that is most clearly afforded.

Apply this to every interface change, alongside calm computing, progressive
discovery, personal agency and disability inclusion. Likelihood is a design
hypothesis informed by the current task and explicit choices, not a claim to
know the person's intent.

## Review the flow by state

| Current situation | Likely next intention | Clearest affordance |
| --- | --- | --- |
| First visit, no places selected | Start a journey | Clearly labelled place entry, with an explicit current-location alternative |
| Returning with a relevant usual journey | Check that journey now | Recognisable destination and one-tap planning; keep a new journey easy to find |
| Destination selected | Choose a starting place | Origin entry and current-location action |
| Both places selected | Find a route | A prominent, clearly named search action |
| Results available | Understand and follow a suitable journey | Route comparison and obvious access to steps; saving is secondary |
| Reading a journey | Work out the next physical action | Stop or street name, direction, departure time and relevant walking details together |
| No result | Adjust the constraints and retry | A direct route back to relevant preferences, retaining entered places |
| Loading or failed download | Understand progress or recover | Clear status and an appropriate retry; never imply unavailable data is ready |

## Rules for applying the principle

- Use position, wording, contrast and semantic controls together. Colour alone
  must not carry the hierarchy.
- Make the next action clear within the active task. Do not add competing primary
  buttons to every panel.
- Keep control positions and keyboard order stable. Do not move focus or submit
  automatically merely because the app predicts a next action.
- Keep alternatives discoverable. Learning must not trap someone in a routine.
- Preserve access preferences and disclose material uncertainty before a person
  relies on a route. Likely intent must never override explicit needs.
- Do not describe a step as the person's current step without evidence of their
  progress. The current app presents itinerary instructions, not live navigation.

## Current interface review

Version 15 uses separate task screens: destination → origin → review → options →
follow → arrived. Nearby departures have a separate entry point. Only the active
screen is exposed to keyboard and assistive technology. Explicit navigation focuses
the screen heading; selecting an address never advances automatically. Back retains
entries. One route is prominent, with alternatives behind a disclosure.

Following shows one leg at a time, advanced by the person. The whole itinerary and
save action remain available. Arrival offers a return journey or a different journey.
Technical download details live in Settings. Access preferences remain available
before searching, with active constraints summarised on results.

Validate the hierarchy with task observation and keyboard, screen-reader and
mobile interaction, including people whose next action differs from the default.
The guided redesign needs fresh physical-device validation; earlier checks cannot
establish that the changed interaction works for everyone.

## Explore without losing the task

Version 17 makes routes and stops actionable rather than decorative labels.
Open a route for a direction/branch, map and stop times; open a stop for departures.
A stop list provides the same navigation without relying on map markers. Maps are
inside details, not another competing panel on the destination screen. Back and
Escape restore the parent layer, focus, filter and scroll without advancing the
journey. A persistent Back control stays available while scrolling long details.
