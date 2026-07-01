# Mindwtr Unreleased

Changes collected after `v1.0.5` and before the next version tag.

## Highlights

- Permanently delete projects from Trash while keeping sync tombstones stable across desktop, CloudKit, and other synced devices.
- Capture tasks faster with `/energy:` quick-add syntax, default schedule times, clearer creation affordances, and restored desktop quick-add focus.
- Use refreshed AI providers with stricter structured outputs, bounded retries, and updated default models.
- Work more predictably with board cross-column drops, filter visibility cleanup, mobile capture-area modes, and focused list polish.

## Full Change List

- fix(mobile): keep the task description field visible when the Android keyboard opens.
- fix(mobile): keep full task titles visible in inbox and task lists after editing.
- ci(android): publish profileable builds to Google Play internal testing while keeping production/beta on the normal release build.
- fix(desktop): preserve purged project tombstones across SQLite save/load cycles.
- fix(cloudkit): sync purged project tombstones on Apple devices.
- fix(trash): show deleted projects in Trash and support deleting them forever.
- fix(desktop): snap board drops to the nearest card for consistent cross-column moves.
- feat(quick-add): parse `/energy:` values and apply default schedule times.
- feat(tasks): improve add controls, entity creation affordances, list grouping, and quick-add focus handling.
- fix(desktop): restore focus to quick-add after adding a task.
- fix(desktop): keep inline capture limited to Inbox.
- fix(desktop): use the Windows native certificate trust path for WebDAV sync.
- fix(filters): hide unused metadata filters and keep hidden criteria from affecting visible task lists.
- fix(mobile): expose priority in the task editor default view and show status chips on review-due focus rows.
- fix(mobile): add active-area capture mode copy, split context/tag filters, show filter-only search results, and reduce project swipe sensitivity.
- feat(donations): refine in-app donation prompts and routing.
- feat(ai): modernize OpenAI, Anthropic, and Gemini provider handling with stricter structured output parsing and bounded retries.
- fix(mobile): tolerate missing RNFS, avoid native module crashes, and improve SQLite read/write diagnostics.
- fix(release): check out requested tags in platform workflows and fail closed on untracked Android versionCode overrides.
- fix(i18n): localize new active-area and desktop search-scope strings.
