# Mindwtr Unreleased

Changes collected after `v1.0.5-rc.1` and before the next version tag.

## Highlights

- Added Vietnamese localization and Czech dictation translations, plus local model downloads, local dictation, and safer offline Whisper audio capture.
- Improved mobile planning and capture with board search/project filters, area-aware quick add/capture, clearer project and board filter states, keyboard-safe editing, and CJK substring search.
- Hardened task data handling across imports, recurrence, relative start offsets, duplicate/project promotion, attachment paths, WebDAV reads, CloudKit sync, and cloud REST task validation.
- Tightened release automation around stable artifact immutability, internal RC tag pushes, AUR beta validation, stable tag guards, and Android FOSS versionCode reuse.
- Refreshed import/release docs, privacy routing, i18n coverage, and release metadata.

## Full Change List

- fix(mobile): keep iOS description input above keyboard
- fix(mobile): include existing tasks in calendar push (#775)
- fix(desktop): close date picker after selection (#777)
- feat(tasks): add relative start offsets (#776)
- fix: exclude bundled Wayland client from AppImage (#778)
- fix(mobile): group project actions in their own section
- feat(desktop): add date-only button to task and inbox date fields
- fix: support longer recurrence intervals (#779)
- fix(webdav): bypass caches for reads
- fix(tasks): improve duplicate and project promotion
- chore(release): use custom app service URLs
- fix(tasks): refine duplicate and project creation
- fix(task): align waiting and promotion actions
- fix(tasks): reset completion on duplicate and clarify project promotion
- feat(obsidian): bridge imported tasks into Mindwtr (#291)
- fix(android): reschedule reminders on notification startup (#607)
- fix(mobile): keep CJK substring search results (#780)
- fix(recurrence): preserve regenerated task fields
- fix(release): guard stable artifact immutability
- fix(cloudkit): sync relative start offsets
- fix(i18n): localize schedule and GTD labels
- fix(filters): prepare saved filter context once
- fix(release): keep RC tag pushes internal
- fix(mobile): lift bulk organize above keyboard
- fix(mobile): narrow board store subscription
- fix(projects): skip archived reuse on promotion
- fix(tasks): reject sub-day offsets for date-only due dates
- fix(attachments): avoid shared local URIs on duplicate
- fix(mobile): translate quick capture a11y labels
- docs: update import and release references
- fix(mobile): add board search and project filters
- fix(release): harden AUR package validation
- test: update i18n mocks for localized labels
- fix(focus): group tasks under every context
- fix(sync): normalize attachment file paths (#781)
- docs: point PRIVACY.md to canonical policy at mindwtr.app/privacy
- fix(mobile): harden local Whisper audio capture (#424)
- feat(asr): add local model downloads and dictation
- feat(desktop): polish sidebar hierarchy
- fix(core): add Czech dictation translations
- fix(desktop): restore sidebar contrast
- fix: open project quick-add edit target in long lists (#782)
- Added Vietnamese language selection and translation coverage, including locale loading, date formatting, and parity checks.
- fix(imports): preserve people during app imports
- fix(mobile): enforce FOSS speech provider at runtime
- fix(mobile): validate offline speech models
- fix(release): tighten release workflow guards
- fix(projects): reuse promoted projects by area
- fix(cloud): validate REST task prop values
- fix(mobile): apply area filter to new captures
- fix(mobile): clarify project and board filter states
