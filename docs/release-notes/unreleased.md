# Mindwtr Unreleased

Changes collected after `v1.0.5` and before the next version tag.

## Highlights

- Permanently delete projects from Trash while keeping sync tombstones stable across desktop, CloudKit, and other synced devices.
- Capture tasks faster with `/energy:` quick-add syntax, default schedule times, clearer creation affordances, and restored desktop quick-add focus.
- Use refreshed AI providers with stricter structured outputs, bounded retries, and updated default models.
- Work more predictably with board cross-column drops, filter visibility cleanup, mobile capture-area modes, and focused list polish.

## Full Change List

- feat(review): surface stale tasks and projects as a Weekly Review step without requiring AI, and add a "Review in 1 week" action beside "Mark reviewed".
- feat(tasks): render Markdown consistently in description displays — desktop rows show a rendered first-line preview, and mobile Trash/Archived previews no longer show raw Markdown source.
- fix(mobile): keep the task description field visible when the Android keyboard opens.
- fix(mobile): keep full task titles visible in inbox and task lists after editing.
- fix(desktop): preserve relative start offsets and repeat reminder minutes through desktop SQLite restarts and sync cycles.
- fix(cloudkit): sync project archive restore metadata for tasks and sections across Apple CloudKit clients.
- fix(mobile): apply SQLite WAL/foreign-key/busy-timeout pragmas outside legacy transactions and reject stale JSON backup fallbacks after stalled writes.
- fix(recurrence): stamp recurring follow-up tasks with revision metadata and preserve task text direction.
- fix(sync): build task content signatures from an explicit allowlist and drop unknown legacy fields during sync normalization.
- fix(cloud): accept energy level, assignee, and reminder suppression fields through task REST create/patch calls.
- fix(mcp): remove unused raw-SQL task write helpers so MCP writes stay on the core-backed service path.
- fix(mobile): narrow mounted screen store subscriptions and align inline capture with Inbox-first capture.
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
- ci(release): publish RC Play uploads to internal testing and open testing by default, and run Android FOSS in parallel from the same versionCode preflight.
- fix(checklist): stop task checklist items from being silently lost when the description contains markdown checkbox lines, and keep in-progress checklist typing safe during background refreshes.
- feat(checklist): paste multi-line text into a checklist item to create one item per line, recognizing bullets, numbering, and `[x]` completion markers.
- feat(review): review Waiting For before choosing today's focus in the Daily Review, so items that unblocked can be promoted to Next and picked up in the focus step.
- feat(checklist)!: the checklist and description are now fully independent — markdown checkbox lines in notes no longer populate or update the task checklist, and checklist edits no longer rewrite the notes (ADR 0022). To bulk-add items, paste the lines into the checklist field.
- fix(mobile): keep the Calendar "add task" sheet above the Android keyboard.
- fix(recurrence): always show a recurring task's next occurrence date in task previews — newly created unscheduled recurring tasks no longer hide their date until the first completion.
- fix(recurrence): completing a date-less recurring task now defers the next instance with a date-only start instead of inheriting the completion's time of day (app and local API).
- feat(desktop): the quick action on Waiting and Someday rows now promotes the task to Next in one click (matching the mobile swipe action), including inside the review flows.
- feat(mobile): search no longer hides Done and Archived matches silently — a tappable "N more in Done and Archived" hint includes them in one tap.
- feat(projects): pick a project's area directly in the create form on desktop and mobile, defaulting to the active area filter.
- fix(desktop): quick add and capture fields keep the caret visible after accepting a suggestion, and long suggestion lists scroll to keep the highlighted entry in view.
- fix(quick-add): `+project` and `!area` shortcuts now match existing multi-word names without swallowing the rest of the title, an unrecognized `!area` token no longer silently disappears, and quoted names (`+"New Project Name"`) delimit multi-word project creation mid-sentence.
- feat(desktop): double-clicking a task title now renames it in place (Enter saves, Esc cancels); double-clicking elsewhere on the row still opens the full editor.
- feat(desktop): dragging a project now works onto collapsed area headers, and areas without projects appear as dashed drop targets while dragging, so a project can be moved into any area (or out to No area) by drag.
- fix(desktop): text in an expanded task description can now be selected and copied with the mouse (expanded rows no longer double as calendar drag sources; collapse the row to drag it onto the calendar).
- fix(mobile): description text in the task view tab can now be selected and copied with a long-press.
- fix(desktop): guided inbox processing buttons now use one font weight throughout, "No project needed" is neutral instead of completion-green, and text arrows/checkmarks were replaced with proper icons.
- fix(mobile): inbox processing, board, and capture labels keep their emoji AND their text on Samsung devices — non-stock Samsung fonts dropped the text that followed an emoji, leaving icon-only buttons.
- feat(desktop): drag a task from the open project's list onto another project in the sidebar to move it there (it lands after the target's existing tasks), or onto an area header to make it a direct area task; a "Moved to …" toast offers one-click Undo. Works in every sort mode; archived projects don't accept drops (ADR 0023).
- feat(tasks): relative start dates now accept 0 (start on the due date itself), so a task like "Wheel trash cans to curb" can stay hidden until the day it is due.
- feat(mobile): task rows, the swipe Done/Delete buttons, and the task editor's ••• menu items now darken while pressed on every theme (Material 3 keeps its ripple), so common taps give visible feedback.
- fix(desktop): a manual "Sync now" always reads the remote data instead of trusting the unchanged-check cache, so tasks added on another device can no longer be missed by a forced sync.
- fix(desktop): undoing a completed task restores its Today star along with its status (completing clears the star, and Undo used to bring the task back unstarred).
- fix(mobile): pull-to-refresh sync now works on short task lists (Inbox with a few tasks no longer refuses the pull gesture on iOS; it previously only worked on scrollable screens like Focus).
