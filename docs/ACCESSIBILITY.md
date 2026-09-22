# Accessibility and device validation

Along aims to support varied perceptual, motor and cognitive needs. It is not
claimed to be universally usable or certified WCAG conformant. Interface access
and real-world transport access are separate responsibilities.

## Implemented supports

- Semantic forms, labels, keyboard-operable suggestions and native disclosures/dialogs.
- Text alongside transport colours; contrast corrections backed by axe checks.
- Visible focus, large touch controls, skip link and concise status announcements.
- Narrow layouts, reduced-motion rules and forced-colour support.
- Explicit refresh rather than constantly rearranging departure lists.
- Remembered walking pace and access preferences, with uncertainty stated in advance.

The form does not infer a wheelchair user's capabilities. “Avoid mapped steps and
barriers” only filters known flags. “Only confirmed accessible stops and vehicles”
requires affirmative source data and can return no verified journey. It does not
verify an entire street route, lift operation or the user's specific requirements.

## Automated and simulated checks

`npm run test:browser` checks mobile-size/touch contexts, real journeys, contrast
and selected WCAG rules. `npm run test:static` checks keyboard selection, focus,
accessible names/states, reflow, zoom-related layout, reduced motion and forced
colours, including offline operation on a repository subpath. Screenshots and an
accessibility-tree snapshot are written to `test-results/` for review.

These checks do not run a human screen reader, reproduce a physical phone's
performance, or establish real-world access. A DOM accessibility snapshot is
useful semantic evidence, not proof of intelligible spoken interaction.

## Physical Android and desktop checklist

Record device, OS/browser versions, app version and date. Use public example
addresses rather than sharing home/work locations.

1. Open the HTTPS site, check offline-ready in Settings and install it. Check the launcher
   icon, readable app name and standalone opening from the home screen/desktop.
2. Search **277 Broadway, Newmarket → 10 Victoria Road, Devonport** on a service
   date covered by the data. Set the reproducible test date/time only when checking
   the fixture; use current time for a real trip. Can you identify the next action?
3. Choose Use this journey, advance and return between steps, then expand Whole
   journey. Save and verify that it stays expanded. Use Back to return to options;
   check that your places remain selected. Start a different journey and confirm
   it is not trapped in the routine.
4. On Android, try touch suggestions, scrolling and a downward pull from the top.
   Confirm ordinary scrolling/pinch zoom do not trigger unwanted navigation.
5. Turn on flight mode/offline, reopen and search **277 Broadway → 1 Queen Street,
   Auckland Central**. Pull to refresh: no update error should interrupt the task.
6. Reconnect. Use Settings → Check for an app update, then Check for updates. Read the
   confirmed version and choose Open Along. Confirm saved journeys survive.
7. On desktop, use only Tab, Shift+Tab, arrow keys, Enter and Escape. Inspect focus
   when opening/closing suggestions, disclosures and dialogs; ensure no keyboard trap.
8. At 200% browser zoom and 400%/a 320 CSS-pixel viewport, check labels, buttons and
   routes for clipping or horizontal reading. Increase system text size on Android.
9. Enable Android TalkBack and a desktop screen reader where available. Check that
   From/To labels, suggestion names/selection, result status, disclosures and update
   actions are announced meaningfully and in a useful order.
10. Change pace and barrier preferences, then inspect nearby times and routes.
    Confirm the strict accessibility option explains unknown source data rather
    than promising a verified accessible trip.

11. Explore route **70**, open a direction, and search stop names for **Symonds**.
    Open a matching stop, then Back. Confirm the filter, focus and scroll context
    survive. Try this from a route badge during a planned journey too.
12. Use the stop list without touching the map. With a keyboard or screen reader,
    open route and stop details and back out using Back or Escape. Check the
    persistent Back control while scrolling a long list.
13. Repeat route exploration offline. Expect a downloaded path and stop locations;
    an online street background is optional. On touch devices, check that map
    panning/zooming and page scrolling remain manageable.

Report pass/fail and specific reproduction steps. Mark unavailable checks as
**not tested**, not passed. The release checklist tracks the current evidence.

## Participation beyond release checks

Arrange compensated testing with disabled commuters across relevant access needs,
including low vision/blindness, motor interaction, hearing and cognitive needs.
Use realistic travel contexts with consent and accessible reporting methods.
Record uncertainty and routes avoided; do not use one person's successful trip to
claim suitability for all disabled people. No such participant study has been
conducted in this project yet.

## Guided flow and contextual details

Only the current task screen is visible and keyboard reachable. Explicit screen
changes focus the main heading; address selection waits for Continue. Check the
Back action, collapsed alternatives and Whole journey with a screen reader.
Step advancement is manual, with a separate previous-step control. Automated
checks cover destination, options, follow, nearby and route/stop details. The user
accepted the version 15 flow; TalkBack and physical use of version 17 maps remain
unverified.
