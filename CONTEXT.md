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

### Capture

**Capture**:
Turning quick-add input into a new inbox task. A capture is never dropped: a `+Project` naming only an archived project behaves like an unknown name and creates a fresh project. Parsed tokens are untrusted (validated against assignable projects); the capturing surface's own context (its current project, pickers) is trusted.
_Avoid_: quick task, note
