# Mindwtr Unreleased

Changes collected after `v1.1.0` and before the next version tag.

## Highlights

_None yet._

## Full Change List

- Switched mobile local storage to a native SQLite engine (op-sqlite): SQL now executes on a dedicated native thread with a faster call path, the first step of moving storage and sync work off the UI thread on large libraries. Existing data is picked up in place; no migration.
- Friendlier first run for people new to GTD: the welcome screen and the Getting Started project now use plain language, a new starter task shows how to hide task-editor fields you don't use, and an empty Focus view now explains how tasks get there (with capture guidance when the app has no tasks yet).
- The Getting Started project, its tutorial tasks, and the sample inbox items are now created in your app language (17 languages). Re-adding the content after switching languages repairs it in place instead of duplicating it. The first-run welcome screen is translated too.
- The AI assistant now works with newer Claude models (Sonnet 5, Opus 4.7/4.8): requests no longer send a temperature these models reject, and the thinking toggle uses their adaptive thinking mode. Enabling thinking on older Claude models no longer fails either. (#857)
- Android text no longer loses its last letter or line on Android 15/16 at large font sizes ("Off" showing as "Of", settings descriptions ending mid-sentence): the app now pins the pre-Android-15 text drawing behavior so drawn text always matches its measured space. Settings rows and the welcome screen also adapt their layout at large font scales instead of squeezing text into narrow columns. (#632)
