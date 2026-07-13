# Mindwtr Unreleased

Changes collected after `v1.1.0` and before the next version tag.

## Highlights

_None yet._

## Full Change List

- Switched mobile local storage to a native SQLite engine (op-sqlite): SQL now executes on a dedicated native thread with a faster call path, the first step of moving storage and sync work off the UI thread on large libraries. Existing data is picked up in place; no migration.
