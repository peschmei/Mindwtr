# Mindwtr Unreleased

Changes collected after `v1.0.0` and before the next version tag.

## Highlights

- **Repeat reminders for time-sensitive tasks.** Tasks with an explicit due *time* can now repeat their reminder every few minutes (Off / 5 / 10 / 15 / 30 / 60) until you complete or snooze the task, up to a limit. Set it from the "Repeat reminder" control under the Due Date in the task editor. Repeats are most reliable on mobile (delivered by on-device alarms); on desktop they only fire while the app is open.

## Full Change List

- Added a per-task "Repeat reminder" option (desktop and mobile) for tasks with a due time. It re-notifies at the chosen interval after the due time, with fewer repeats at shorter intervals (e.g. 5-minute covers about 40 minutes, longer intervals up to roughly 2 hours), and stops as soon as the task is completed. It reuses the existing "Due date reminders" setting — no new notification toggle — and is hidden when the task has no due time or uses calendar handoff.
