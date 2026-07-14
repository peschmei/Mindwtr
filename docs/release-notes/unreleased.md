# Mindwtr Unreleased

Changes collected after `v1.1.0` and before the next version tag.

## Highlights

_None yet._

## Full Change List

- Switched mobile local storage to a native SQLite engine (op-sqlite): SQL now executes on a dedicated native thread with a faster call path, the first step of moving storage and sync work off the UI thread on large libraries. Existing data is picked up in place; no migration.
- Finishing or editing a task on mobile no longer waits for the full-library backup snapshot: saves complete after the database write, and the backup and widget refresh land coalesced in the background (bursts of saves now write one backup instead of one each — a single save had spent up to 12 seconds on this with large libraries). Reminder rescheduling also coalesces the several store updates a sync cycle makes into one scan. (#766)
- Friendlier first run for people new to GTD: the welcome screen and the Getting Started project now use plain language, a new starter task shows how to hide task-editor fields you don't use, and an empty Focus view now explains how tasks get there (with capture guidance when the app has no tasks yet).
- The Getting Started project, its tutorial tasks, and the sample inbox items are now created in your app language (17 languages). Re-adding the content after switching languages repairs it in place instead of duplicating it. The first-run welcome screen is translated too.
- The AI assistant now works with newer Claude models (Sonnet 5, Opus 4.7/4.8): requests no longer send a temperature these models reject, and the thinking toggle uses their adaptive thinking mode. Enabling thinking on older Claude models no longer fails either. (#857)
- Android text no longer loses its last letter or line on Android 15/16 at large font sizes ("Off" showing as "Of", settings descriptions ending mid-sentence): the app now pins the pre-Android-15 text drawing behavior so drawn text always matches its measured space. Settings rows and the welcome screen also adapt their layout at large font scales instead of squeezing text into narrow columns. (#632)
- On Android, reopening into Archive or another non-tab screen now keeps the main tabs in the navigation stack, so Back returns to the app instead of closing it. (#842)
- Desktop settings toggles no longer get squashed into ovals when the window is narrow — the switch now keeps its shape and the label text wraps instead. (#858)
- Desktop keyboard shortcuts no longer act on the task list behind an open dialog: with search, quick add, or a prompt open, a stray Enter or action key could complete or open a task in the background list (reported as an accidental Done from inside search). Keys pressed inside the search dialog outside its input now also keep driving the search — arrows and Enter navigate results, and typing returns to the query field.
- Updated bundled dependencies to pick up upstream security fixes (hono, undici, tar, vite, js-yaml, Babel on the JS side; plist/quick-xml, quinn-proto, anyhow in the desktop app).
- The "What's the next action?" prompt (shown after finishing a project's last action) now understands quick-add syntax, so `Chase the reply /waiting %Bob` creates the follow-up as a Waiting For task directly — no need to create it as a next action and edit it afterwards. (#859)
- The Focus toolbar now matches every other list: its buttons and the grouping dropdown share one height and shape, the grouping dropdown carries the same `GROUP` label as elsewhere, and its text is no longer clipped at the bottom. (#861)
- Desktop lists now set a task's status straight from the keyboard: press `s` then a letter — `si` Inbox, `sn` Next, `sw` Waiting, `ss` Someday, `sd` Done, `sa` Archived — with an undo toast after the change. The chord works in all three keybinding styles, and `Insert` jumps to the add-task input (or opens quick add). (#860)
