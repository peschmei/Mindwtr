# Mindwtr

A local-first GTD task manager (desktop, mobile, self-hosted cloud sync) built around tasks organized into projects, sections, and areas.

## Language

### Task placement

**Container**:
The single place a task lives: either a project (optionally inside one of that project's sections) or an area — never both at once. Assigning a project clears any direct area; a section is only valid inside its own project.
_Avoid_: parent, folder, bucket

**Move** (of a task):
Reassigning a task's container. A move never changes the task's status, dates, or flags — only where it lives.
_Avoid_: transfer, re-file

**Area task**:
A task assigned directly to an area with no project. Dropping or assigning a task to an area makes it an area task.
_Avoid_: orphan task, loose task

**Unsectioned**:
The tasks of a project that sit outside every section. Tasks moved into a project from elsewhere land at the end of the unsectioned group.

### Project lifecycle

**Deferred project**:
A someday/set-aside project. Still a valid home for tasks — moving a task into a deferred project is a legitimate GTD action.
_Avoid_: paused project, inactive project

**Archived project**:
A closed project. It accepts no new tasks; tasks are only read there.
_Avoid_: deleted project, hidden project

### Today's Focus

**Focus star**:
The per-task mark that commits a task to Today's Focus. Removing a star is always allowed; adding one is gated by focus eligibility and the focus cap. Starring an unprocessed inbox task clarifies it to next; starring a review-due waiting/someday task keeps its status — "chase this today" does not stop the task being waiting-for.
_Avoid_: favorite, pin, priority flag

### Editing

**Task draft**:
The editor's private working copy of a task's fields. Edits accumulate in the draft and reach the task only on save; discarding the draft leaves the task untouched. A draft obeys the same field rules the save enforces — sending a draft back to Inbox drops its focus star. Attachments are buffered alongside the draft and count toward its pending edits.
_Avoid_: edit state, form state, pending changes

### Filtering

**Filter selections**:
What a view's filter pickers currently hold: mixed @context/#tag tokens, projects, and metadata choices. Selections build the filter criteria that narrow a list; applying a saved filter turns its criteria back into selections, dropping values the pickers cannot show (unknown enum values, custom time estimates, the criteria-only 'none' priority).
_Avoid_: filter state, active filters

### Capture

**Capture**:
Turning quick-add input into a new inbox task. A capture is never dropped: a `+Project` naming only an archived project behaves like an unknown name and creates a fresh project. Parsed tokens are untrusted (validated against assignable projects); the capturing surface's own context (its current project, pickers) is trusted.
_Avoid_: quick task, note

### Syncing

**Sync run**:
One execution of the shared sync cycle state machine (`runSharedSyncCycle` in core, ADR 0014): flush, backend setup, unchanged-skip checks, attachment phases, the merge cycle, cleanup, fast-sync bookkeeping, and error/requeue handling. Desktop and mobile supply transport, storage, and notification ports; deliberate platform differences are policy switches on the run, never re-implemented phases.
_Avoid_: sync loop, sync pass, per-platform orchestrator
