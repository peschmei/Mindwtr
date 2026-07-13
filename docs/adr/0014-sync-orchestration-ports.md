# ADR 0014: Shared Sync Orchestration Ports

Date: 2026-05-04
Status: Accepted (implemented 2026-07-13)

## Context

Desktop and mobile both run the same sync orchestration shape: read local state, dispatch to file/WebDAV/cloud/Dropbox backends, reconcile warnings, update status, and surface notifications. Today those flows live in app-specific services, so fixes often need to be applied twice.

The merge algorithm is already shared in `@mindwtr/core`; the remaining duplication is the orchestration state machine around backend IO and UI notification.

## Decision

Plan a follow-up refactor that moves the platform-independent sync orchestration state machine into `@mindwtr/core`.

The core package should own:

1. sync cycle state transitions
2. retry and pending-write policy
3. conflict diagnostics shaping
4. backend dispatch contracts

Apps should provide ports:

1. `BackendIO` for file/WebDAV/cloud/Dropbox/iCloud transport calls
2. `Storage` for reading and writing local snapshots
3. `Notifier` for toasts, badges, and platform logs
4. `Clock` or test-time hooks where deterministic timing is needed

## Consequences

- Sync behavior can be covered once with core unit tests.
- Desktop and mobile keep platform-specific backends without duplicating policy.
- The refactor should be done as its own change set because it touches high-risk sync lifecycle code.
- Until this is implemented, sync bug fixes must keep checking both app orchestrators.

## Implementation plan (added 2026-07-05)

Measured duplication at time of writing: desktop `sync-service.ts` 2,448 lines with 32 `backend ===` dispatch sites; mobile `sync-service.ts` 1,615 lines with 30; both implement the same ~10-phase pipeline (`readRemoteDataByBackend`, `prepareRemoteWriteData`, `writeRemoteDataByBackend`, fast-check fingerprints, pre/post attachment phases, status/history persistence) around the shared core merge. Test seams differ per platform: desktop mutates a 21-key module-global dependency bag (`__syncServiceTestUtils.setDependenciesForTests`); mobile has no injection point and needs 13 module mocks per test run.

Stages, each its own commit and each gated on both platforms' full sync suites plus a manual two-device smoke:

1. **Ports in core (types only).** Derive `BackendIO`, `Storage`, `Notifier`, `Clock` from the union of the two orchestrators' current method sets — do not idealize; codify what exists.
2. **State machine into core.** Move cycle phases, fast-check/skip policy, retry and pending-write policy, and conflict-diagnostics shaping into `packages/core` behind those ports. Unit-test against in-memory fakes; the fake is the second adapter that makes the seam real. Apps keep running on their old orchestrators — this stage changes no app behavior.
3. **Desktop adapts first.** Its existing internal DI seam makes migration mechanical: each backend branch becomes a `BackendIO` adapter; delete `setDependenciesForTests` in favor of injecting fakes at the port seam.
4. **Mobile adapts.** Same ports plus the CloudKit adapter; the 13-mock forest in `sync-service.runtime.test.ts` collapses to port fakes.
5. **Deletion pass.** Remove the duplicated skip/status/fingerprint plumbing from both apps; what remains per platform is transport code only.

Scheduling constraint: land in a release-quiet window, never alongside an active RC — a sync regression here is the project's worst failure mode.

## Implementation notes (2026-07-13)

Landed right after stable v1.1.0, in the staged commits this plan prescribed.

- `packages/core/src/sync-run-ports.ts` holds the ports; `sync-run.ts` is the
  state machine (`runSharedSyncCycle`), unit-tested against in-memory fakes in
  `sync-run.test.ts`. The port groupings map to this ADR as: `SyncBackendIO`
  (BackendIO), `SyncRunStorage` (Storage), `SyncRunNotifier` (Notifier),
  `now()` injection (Clock), plus `SyncRunStoreBridge` for shared-store access
  and `SyncRunPlatformHooks`/`SyncRunPolicy` for codified platform divergences.
- Deliberate divergences became explicit policy switches instead of being
  unified: mobile runs the attachment pre-sync before the fast-check and has a
  second read-and-compare skip; mobile fails the cycle on post-merge attachment
  errors where desktop degrades to a warning; the desktop web runtime disables
  attachment phases.
- Deviation from stage 3 as written: desktop's `setDependenciesForTests` was
  kept, not deleted. It now covers transport-level dependencies only (Tauri
  invoke, fetch, CloudKit, store access); cycle policy is fake-tested once in
  core, while both app suites exercise the real machine through real adapters
  over mocked transports — strictly more coverage than replacing those suites
  with port fakes.
- Known benign behavior deltas from the extraction: desktop persists merged
  external calendars after (not before) the mid-cycle freshness check; desktop
  gained mobile's "Attachment final sync start/done" log lines; mobile gained
  desktop's "Sync failed" warning plus step logs for flush/refresh; mobile's
  unchanged-skip log lines lost their elapsed/payload-shape extras.
- Line counts: desktop `sync-service.ts` 2,456 → ~1,860; mobile
  `sync-service.ts` 1,651 → ~1,250; the machine plus ports add ~1,000 lines to
  core, written once.
