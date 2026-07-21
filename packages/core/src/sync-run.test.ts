import { describe, expect, it, vi } from 'vitest';

import type { AppData, Task } from './types';
import type {
    SyncBackendIO,
    SyncRunNotifier,
    SyncRunPlatformHooks,
    SyncRunPolicy,
    SyncRunStorage,
    SyncRunStoreBridge,
    SyncStatusUpdates,
} from './sync-run-ports';
import { SyncRemoteWriteConflict } from './sync-run-ports';
import { normalizeRemoteWriteResult, runSharedSyncCycle } from './sync-run';
import { normalizeAppData } from './sync-normalization';
import { cloneAppData } from './sync-runtime-utils';
import type { FastSyncState } from './sync-fast-sync';
import type { SyncBackend } from './sync-service-utils';
import type { SyncCycleIO, SyncCycleResult } from './sync-types';
import { performSyncCycle } from './sync';

const NOW = new Date('2026-07-13T10:00:00.000Z');
const STAMP = '2026-07-01T00:00:00.000Z';

const createTask = (id: string, title: string): Task => ({
    id,
    title,
    status: 'inbox',
    createdAt: STAMP,
    updatedAt: STAMP,
} as Task);

const createData = (tasks: Task[] = [], settings: AppData['settings'] = {}): AppData => normalizeAppData({
    tasks,
    projects: [],
    sections: [],
    areas: [],
    people: [],
    settings,
});

type HarnessConfig = {
    local?: AppData;
    remote?: AppData | null;
    backend?: SyncBackend;
    fastSyncScope?: string | null;
    manual?: boolean;
    policy?: Partial<SyncRunPolicy>;
    io?: Partial<SyncBackendIO>;
    hooks?: Partial<SyncRunPlatformHooks>;
    storage?: Partial<SyncRunStorage>;
    attachmentCleanupIntervalMs?: number;
    performSyncCycle?: (io: SyncCycleIO) => Promise<SyncCycleResult>;
};

const createHarness = (config: HarnessConfig = {}) => {
    const initial = config.local ?? createData([createTask('t-local', 'Local task')]);
    const harness = {
        lastDataChangeAt: 1,
        inMemory: cloneAppData(initial),
        persisted: cloneAppData(initial),
        remote: (config.remote === undefined ? null : config.remote) as AppData | null,
        fastStates: new Map<string, FastSyncState>(),
        statusUpdates: [] as SyncStatusUpdates[],
        steps: [] as string[],
        warnings: [] as { message: string; error?: unknown }[],
        infos: [] as { message: string; extra?: Record<string, string> }[],
        diagnostics: [] as string[],
        uiErrors: [] as (string | null)[],
        callOrder: [] as string[],
    };

    const io: SyncBackendIO = {
        readRemote: vi.fn(async () => {
            harness.callOrder.push('readRemote');
            return harness.remote ? cloneAppData(harness.remote) : null;
        }),
        writeRemote: vi.fn(async (sanitized: AppData) => {
            harness.callOrder.push('writeRemote');
            harness.remote = cloneAppData(sanitized);
            return { fingerprint: `remote-fp-${JSON.stringify(sanitized.tasks.map((task) => task.id).sort())}` };
        }),
        readRemoteFingerprint: vi.fn(async () => (
            harness.remote
                ? `remote-fp-${JSON.stringify(harness.remote.tasks.map((task) => task.id).sort())}`
                : null
        )),
        ...config.io,
    };

    const store: SyncRunStoreBridge = {
        getLastDataChangeAt: () => harness.lastDataChangeAt,
        getInMemorySnapshot: () => cloneAppData(harness.inMemory),
        flushPendingSave: vi.fn(async () => {
            harness.callOrder.push('flush');
        }),
        setUiError: (message) => harness.uiErrors.push(message),
        getSettings: () => harness.inMemory.settings,
    };

    const storage: SyncRunStorage = {
        readPersistedLocal: vi.fn(async () => cloneAppData(harness.persisted)),
        persistLocal: vi.fn(async (data: AppData) => {
            harness.callOrder.push('persistLocal');
            harness.persisted = cloneAppData(data);
        }),
        persistSyncStatus: vi.fn(async (updates) => {
            harness.statusUpdates.push(updates);
        }),
        readFastSyncState: vi.fn(async (scope: string) => harness.fastStates.get(scope) ?? null),
        writeFastSyncState: vi.fn(async (state: FastSyncState) => {
            harness.fastStates.set(state.scope, state);
        }),
        injectExternalCalendars: vi.fn(async (data: AppData) => data),
        persistExternalCalendars: vi.fn(async () => {}),
        ...config.storage,
    };

    const notifier: SyncRunNotifier = {
        setStep: (step) => harness.steps.push(step),
        logInfo: (message, extra) => harness.infos.push({ message, extra }),
        logWarning: (message, error) => harness.warnings.push({ message, error }),
        logWarningExtra: (message) => harness.warnings.push({ message }),
        sanitizeLogMessage: (message) => message,
        logSyncError: vi.fn(async () => '/tmp/sync-error.log'),
        logMergeSummary: vi.fn(),
        onDiagnostic: (event) => harness.diagnostics.push(event.event),
    };

    const hooks: SyncRunPlatformHooks = {
        setupCycle: vi.fn(async () => ({
            kind: 'ready' as const,
            backend: config.backend ?? 'cloud',
            cloudProvider: 'selfhosted' as const,
            io,
            fastSyncScope: config.fastSyncScope ?? null,
        })),
        requestFollowUp: vi.fn(),
        formatErrorMessage: (error, backend) => `[${backend}] ${error instanceof Error ? error.message : String(error)}`,
        finalizeErrorStatus: vi.fn(async () => {}),
        finalizeSuccess: vi.fn(async () => {}),
        ...config.hooks,
    };

    const policy: SyncRunPolicy = {
        preSyncAttachmentsBeforeFastCheck: false,
        enableReadCheckSkip: false,
        postMergeAttachmentErrorPolicy: 'warn',
        attachmentPhasesEnabled: true,
        ...config.policy,
    };

    const run = (options: { manual?: boolean } = {}) => runSharedSyncCycle({
        options: { manual: config.manual ?? options.manual },
        storage,
        notifier,
        store,
        hooks,
        policy,
        now: () => NOW,
        attachmentCleanupIntervalMs: config.attachmentCleanupIntervalMs,
        performSyncCycle: config.performSyncCycle,
    });

    return { harness, io, store, storage, notifier, hooks, policy, run };
};

describe('runSharedSyncCycle', () => {
    it('returns success without any IO when setup reports the backend disabled', async () => {
        const { harness, io, storage, run, hooks } = createHarness({
            hooks: { setupCycle: vi.fn(async () => ({ kind: 'disabled' as const })) },
        });

        const result = await run();

        expect(result).toEqual({ success: true });
        expect(hooks.setupCycle).toHaveBeenCalledTimes(1);
        expect(io.readRemote).not.toHaveBeenCalled();
        expect(storage.persistLocal).not.toHaveBeenCalled();
        expect(harness.callOrder).toEqual(['flush']);
    });

    it('merges local and remote data, persists both sides, and finalizes success', async () => {
        const local = createData([createTask('t-local', 'Local task')]);
        const remote = createData([createTask('t-remote', 'Remote task')]);
        const { harness, io, hooks, run } = createHarness({ local, remote, fastSyncScope: 'scope-1' });

        const result = await run();

        expect(result.success).toBe(true);
        expect(result.stats).toBeDefined();
        expect(result.skipped).toBeUndefined();
        const persistedIds = harness.persisted.tasks.map((task) => task.id).sort();
        expect(persistedIds).toEqual(['t-local', 't-remote']);
        const remoteIds = harness.remote?.tasks.map((task) => task.id).sort();
        expect(remoteIds).toEqual(['t-local', 't-remote']);
        expect(io.writeRemote).toHaveBeenCalledTimes(1);
        expect(hooks.finalizeSuccess).toHaveBeenCalledTimes(1);
        expect(hooks.finalizeSuccess).toHaveBeenCalledWith(
            expect.objectContaining({ tasks: expect.any(Array) }),
            expect.objectContaining({ status: 'success', wroteLocal: true }),
        );
        // Merged data persists locally without the pending-remote-write flag.
        expect(harness.persisted.settings.pendingRemoteWriteAt).toBeUndefined();
        expect(harness.persisted.settings.lastSyncStatus).toBe('success');
        // Fast-sync state recorded from the remote write fingerprint.
        expect(harness.fastStates.get('scope-1')?.remoteFingerprint).toContain('remote-fp-');
        expect(harness.steps).toEqual(expect.arrayContaining(['flush', 'fast-check', 'read-local', 'read-remote', 'merge', 'write-local', 'write-remote', 'refresh']));
        expect(harness.diagnostics).toEqual(expect.arrayContaining(['flush', 'merge-complete']));
    });

    it('skips the second run as unchanged via the recorded fast-sync state', async () => {
        const { harness, io, run } = createHarness({ fastSyncScope: 'scope-1' });

        const first = await run();
        expect(first.skipped).toBeUndefined();
        const readsAfterFirst = vi.mocked(io.readRemote).mock.calls.length;

        const second = await run();
        expect(second).toMatchObject({ success: true, skipped: 'unchanged' });
        expect(vi.mocked(io.readRemote).mock.calls.length).toBe(readsAfterFirst);
        expect(harness.statusUpdates.at(-1)).toMatchObject({ lastSyncStatus: 'success' });
        expect(harness.uiErrors.at(-1)).toBeNull();
        expect(harness.infos.some((info) => info.message === 'Sync fast check found no changes')).toBe(true);
    });

    it('never takes the fingerprint fast-check for manual syncs', async () => {
        const { io, run } = createHarness({ fastSyncScope: 'scope-1' });

        await run();
        await run({ manual: true });

        // The manual second run performed a full cycle including the remote read.
        expect(vi.mocked(io.readRemote).mock.calls.length).toBe(2);
    });

    it('skips via the read-check when the remote payload equals local (no fingerprint scope)', async () => {
        const { io, run } = createHarness({ fastSyncScope: null, policy: { enableReadCheckSkip: true } });

        const first = await run();
        expect(first.skipped).toBeUndefined();
        const writesAfterFirst = vi.mocked(io.writeRemote).mock.calls.length;

        const second = await run();
        expect(second).toMatchObject({ success: true, skipped: 'unchanged' });
        expect(vi.mocked(io.writeRemote).mock.calls.length).toBe(writesAfterFirst);
    });

    it('reuses the read-check remote payload in the merge phase instead of reading twice', async () => {
        const local = createData([createTask('t-local', 'Local task')]);
        const remote = createData([createTask('t-remote', 'Remote task')]);
        const { io, run } = createHarness({
            local,
            remote,
            fastSyncScope: null,
            policy: { enableReadCheckSkip: true },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(result.skipped).toBeUndefined();
        expect(io.readRemote).toHaveBeenCalledTimes(1);
    });

    it('requests a follow-up and skips fast-state recording when the server merged remote data', async () => {
        const { harness, hooks, run } = createHarness({
            fastSyncScope: 'scope-1',
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                writeRemote: vi.fn(async () => ({ fingerprint: 'fp-1', serverMergedRemoteData: true })),
            },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(hooks.requestFollowUp).toHaveBeenCalled();
        expect(harness.fastStates.size).toBe(0);
    });

    it('requeues on a remote write conflict and clears the pending-remote-write flag', async () => {
        const { harness, hooks, run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                writeRemote: vi.fn(async () => {
                    throw new SyncRemoteWriteConflict();
                }),
            },
        });

        const result = await run();

        expect(result).toMatchObject({ success: true, skipped: 'requeued' });
        expect(hooks.requestFollowUp).toHaveBeenCalled();
        expect(harness.persisted.settings.pendingRemoteWriteAt).toBeUndefined();
        expect(harness.diagnostics).toContain('requeued');
    });

    it('marks the retry backoff locally and reports the error when the remote write fails', async () => {
        const { harness, hooks, notifier, run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                writeRemote: vi.fn(async () => {
                    throw new Error('boom');
                }),
            },
        });

        const result = await run();

        expect(result.success).toBe(false);
        expect(result.error).toContain('[cloud] boom');
        expect(result.error).toContain('(log: /tmp/sync-error.log)');
        expect(harness.persisted.settings.pendingRemoteWriteAt).toBeDefined();
        expect(harness.persisted.settings.pendingRemoteWriteRetryAt).toBeDefined();
        expect(harness.persisted.settings.pendingRemoteWriteAttempts).toBe(1);
        expect(notifier.logSyncError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ backend: 'cloud' }));
        expect(hooks.finalizeErrorStatus).toHaveBeenCalledWith(expect.objectContaining({
            message: result.error,
            history: expect.arrayContaining([expect.objectContaining({ status: 'error' })]),
        }));
    });

    it('skips the cycle while the pending-remote-write backoff is active and surfaces the deferred write', async () => {
        const retryAt = new Date(Date.now() + 60_000).toISOString();
        const local = createData([createTask('t-local', 'Local task')], {
            pendingRemoteWriteAt: STAMP,
            pendingRemoteWriteRetryAt: retryAt,
            pendingRemoteWriteAttempts: 2,
            lastSyncStatus: 'error',
            lastSyncError: 'Remote write failed. Retrying in the background.',
        });
        const { io, run } = createHarness({ local });

        const result = await run();

        expect(result).toMatchObject({
            success: true,
            skipped: 'pendingRemoteWriteBackoff',
            remoteWriteDeferred: true,
            error: 'Remote write failed. Retrying in the background.',
        });
        expect(io.readRemote).not.toHaveBeenCalled();
    });

    it('surfaces a deferred remote write on a completed merge without failing the run', async () => {
        const { run } = createHarness({
            performSyncCycle: async (io) => {
                const result = await performSyncCycle(io);
                if (result.status === 'skipped') return result;
                return {
                    ...result,
                    data: {
                        ...result.data,
                        settings: {
                            ...result.data.settings,
                            pendingRemoteWriteRetryAt: new Date(NOW.getTime() + 30_000).toISOString(),
                            pendingRemoteWriteAttempts: 1,
                            lastSyncStatus: 'error',
                            lastSyncError: 'Remote write failed. Retrying in the background.',
                        },
                    },
                };
            },
        });

        const result = await run();

        expect(result).toMatchObject({
            success: true,
            remoteWriteDeferred: true,
            error: 'Remote write failed. Retrying in the background.',
        });
    });

    it('leaves remoteWriteDeferred falsy on a clean successful run', async () => {
        const { run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(result.remoteWriteDeferred).toBeFalsy();
    });

    it('aborts to a requeued skip when local data changes mid-cycle', async () => {
        const staleEvents: unknown[] = [];
        const { harness, hooks, io, run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            hooks: {
                onStaleSnapshot: (details) => staleEvents.push(details),
            },
        });
        // Simulate a user edit while the remote read is in flight.
        vi.mocked(io.readRemote).mockImplementation(async () => {
            harness.lastDataChangeAt += 1;
            return cloneAppData(harness.remote!);
        });

        const result = await run();

        expect(result).toMatchObject({ success: true, skipped: 'requeued' });
        expect(hooks.requestFollowUp).toHaveBeenCalled();
        expect(staleEvents.length).toBeGreaterThan(0);
    });

    it('accepts a covered snapshot instead of aborting when the platform hook approves it', async () => {
        const { harness, hooks, io, run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            hooks: {
                acceptCoveredSnapshot: vi.fn(() => true),
            },
        });
        vi.mocked(io.readRemote).mockImplementation(async () => {
            harness.lastDataChangeAt += 1;
            return cloneAppData(harness.remote!);
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(result.skipped).toBeUndefined();
        expect(hooks.acceptCoveredSnapshot).toHaveBeenCalled();
    });

    it('runs the attachment pre-sync before the fast-check only under the mobile ordering policy', async () => {
        const syncAttachments = vi.fn(async () => false);
        const desktop = createHarness({
            fastSyncScope: 'scope-1',
            io: { syncAttachments },
        });
        await desktop.run();
        const callsAfterFirstMerge = syncAttachments.mock.calls.length;
        await desktop.run();
        // Desktop order: the second run fast-skips before the attachment phase.
        expect(syncAttachments.mock.calls.length).toBe(callsAfterFirstMerge);

        const mobileAttachments = vi.fn(async () => false);
        const mobile = createHarness({
            fastSyncScope: 'scope-1',
            policy: { preSyncAttachmentsBeforeFastCheck: true },
            io: { syncAttachments: mobileAttachments },
        });
        await mobile.run();
        const mobileCalls = mobileAttachments.mock.calls.length;
        const second = await mobile.run();
        expect(second.skipped).toBe('unchanged');
        // Mobile order: the pre-sync ran again even though the cycle then skipped.
        expect(mobileAttachments.mock.calls.length).toBeGreaterThan(mobileCalls);
    });

    it('persists attachment pre-sync mutations when the cycle aborts before writing locally', async () => {
        const local = createData([createTask('t-local', 'Local task')]);
        const mutated = createData([createTask('t-local', 'Local task'), createTask('t-presync', 'Uploaded attachment task')]);
        const { harness, run } = createHarness({
            local,
            remote: createData([createTask('t-remote', 'Remote task')]),
            policy: { preSyncAttachmentsBeforeFastCheck: true },
            io: {
                syncAttachments: vi.fn(async () => cloneAppData(mutated)),
                readRemote: vi.fn(async () => {
                    harness.lastDataChangeAt += 1;
                    return cloneAppData(harness.remote!);
                }),
            },
        });

        const result = await run();

        expect(result).toMatchObject({ success: true, skipped: 'requeued' });
        expect(harness.persisted.tasks.map((task) => task.id)).toContain('t-presync');
    });

    it('continues with a warning when the attachment pre-sync fails', async () => {
        const { harness, run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                syncAttachments: vi.fn(async () => {
                    throw new Error('upload failed');
                }),
            },
            // Restrict the failure to the pre-sync phase.
            hooks: {
                shouldRunAttachmentPhase: vi.fn(async (_data, phase) => phase === 'prepare'),
            },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(result.hadAttachmentWarning).toBe(true);
        expect(harness.warnings.some((warning) => warning.message === 'Attachment pre-sync warning')).toBe(true);
    });

    it('rethrows attachment pre-sync errors when the cycle was aborted', async () => {
        const { run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                syncAttachments: vi.fn(async () => {
                    throw new Error('aborted mid-upload');
                }),
            },
            hooks: {
                isCycleAborted: () => true,
                shouldRunAttachmentPhase: vi.fn(async (_data, phase) => phase === 'prepare'),
            },
        });

        const result = await run();

        expect(result.success).toBe(false);
        expect(result.error).toContain('aborted mid-upload');
    });

    it('persists post-merge attachment mutations and skips fast-state recording', async () => {
        const { harness, run } = createHarness({
            fastSyncScope: 'scope-1',
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                syncAttachments: vi.fn(async (data: AppData) => {
                    data.tasks.push(createTask('t-downloaded', 'Downloaded attachment task'));
                    return true;
                }),
            },
            hooks: {
                shouldRunAttachmentPhase: vi.fn(async (_data, phase) => phase === 'post-merge'),
            },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(harness.persisted.tasks.map((task) => task.id)).toContain('t-downloaded');
        expect(harness.fastStates.size).toBe(0);
        expect(harness.diagnostics).toContain('attachment-sync-applied');
    });

    it('applies the platform post-merge attachment error policy', async () => {
        const failingIo = {
            syncAttachments: vi.fn(async () => {
                throw new Error('download failed');
            }),
        };
        const postMergeOnly = {
            shouldRunAttachmentPhase: vi.fn(async (_data: AppData, phase: string) => phase === 'post-merge'),
        };

        const warn = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: failingIo,
            hooks: postMergeOnly,
            policy: { postMergeAttachmentErrorPolicy: 'warn' },
        });
        const warnResult = await warn.run();
        expect(warnResult.success).toBe(true);
        expect(warnResult.hadAttachmentWarning).toBe(true);
        expect(warn.harness.warnings.some((warning) => warning.message === 'Attachment sync warning')).toBe(true);

        const fail = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: failingIo,
            hooks: postMergeOnly,
            policy: { postMergeAttachmentErrorPolicy: 'fail' },
        });
        const failResult = await fail.run();
        expect(failResult.success).toBe(false);
        expect(failResult.error).toContain('download failed');
    });

    it('runs the periodic attachment cleanup through the platform hook and persists its result', async () => {
        const local = createData([createTask('t-local', 'Local task')], {
            attachments: { lastCleanupAt: '2026-01-01T00:00:00.000Z' },
        });
        const cleaned = createData([createTask('t-local', 'Local task')], {
            attachments: { lastCleanupAt: NOW.toISOString() },
        });
        const runAttachmentCleanup = vi.fn(async () => ({ data: cloneAppData(cleaned), invalidateFastSyncState: true }));
        const { harness, run } = createHarness({
            local,
            fastSyncScope: 'scope-1',
            remote: createData([createTask('t-remote', 'Remote task')]),
            hooks: { runAttachmentCleanup },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(runAttachmentCleanup).toHaveBeenCalledTimes(1);
        expect(harness.persisted.settings.attachments?.lastCleanupAt).toBe(NOW.toISOString());
        // invalidateFastSyncState suppressed the fast-state record.
        expect(harness.fastStates.size).toBe(0);
    });

    it('requeues instead of persisting a cleanup snapshot when local data changes inside the hook', async () => {
        const previousCleanupAt = '2026-01-01T00:00:00.000Z';
        const local = createData([createTask('t-local', 'Local task')], {
            attachments: { lastCleanupAt: previousCleanupAt },
        });
        const cleaned = createData([createTask('t-local', 'Local task')], {
            attachments: { lastCleanupAt: NOW.toISOString() },
        });
        let mutateLocalData: () => void = () => {
            throw new Error('Harness mutation was not initialized');
        };
        const runAttachmentCleanup = vi.fn(async () => {
            mutateLocalData();
            return { data: cloneAppData(cleaned), invalidateFastSyncState: true };
        });
        const { harness, hooks, storage, run } = createHarness({
            local,
            remote: createData([createTask('t-remote', 'Remote task')]),
            hooks: { runAttachmentCleanup },
        });
        mutateLocalData = () => {
            harness.inMemory.tasks[0] = {
                ...harness.inMemory.tasks[0],
                title: 'Edited during cleanup',
                updatedAt: '2026-07-13T10:00:01.000Z',
            };
            harness.lastDataChangeAt += 1;
        };

        const result = await run();

        expect(result).toMatchObject({ success: true, skipped: 'requeued' });
        expect(hooks.requestFollowUp).toHaveBeenCalled();
        expect(hooks.finalizeSuccess).not.toHaveBeenCalled();
        expect(vi.mocked(storage.persistLocal).mock.calls.some(
            ([data]) => data.settings.attachments?.lastCleanupAt === NOW.toISOString(),
        )).toBe(false);
        expect(harness.inMemory.tasks[0]?.title).toBe('Edited during cleanup');
    });

    it('skips the attachment cleanup inside the interval window', async () => {
        const local = createData([createTask('t-local', 'Local task')], {
            attachments: { lastCleanupAt: new Date(Date.now() - 60_000).toISOString() },
        });
        const runAttachmentCleanup = vi.fn(async () => null);
        const { run } = createHarness({
            local,
            remote: createData([createTask('t-remote', 'Remote task')]),
            hooks: { runAttachmentCleanup },
        });

        await run();

        expect(runAttachmentCleanup).not.toHaveBeenCalled();
    });

    it('lets the pre-requeue platform hook short-circuit error handling (mobile lifecycle abort)', async () => {
        const { hooks, run } = createHarness({
            hooks: {
                setupCycle: vi.fn(async () => {
                    throw new Error('aborted');
                }),
                handleRunErrorBeforeRequeue: vi.fn(async () => ({ success: true })),
            },
        });

        const result = await run();

        expect(result).toEqual({ success: true });
        expect(hooks.finalizeErrorStatus).not.toHaveBeenCalled();
    });

    it('lets the post-requeue platform hook classify offline skips (mobile)', async () => {
        const { hooks, run } = createHarness({
            io: {
                readRemote: vi.fn(async () => {
                    throw new Error('network request failed');
                }),
            },
            hooks: {
                handleRunErrorAfterRequeue: vi.fn(async (error) => (
                    error instanceof Error && error.message.includes('network')
                        ? { success: true, skipped: 'offline' as const }
                        : null
                )),
            },
        });

        const result = await run();

        expect(result).toMatchObject({ success: true, skipped: 'offline' });
        expect(hooks.finalizeErrorStatus).not.toHaveBeenCalled();
    });

    it('treats a corrupted WebDAV remote as missing and repairs it with the merged data', async () => {
        const { harness, io, run } = createHarness({
            backend: 'webdav',
            io: {
                readRemote: vi.fn(async () => {
                    throw new Error('WebDAV get failed: invalid JSON');
                }),
            },
        });

        const result = await run();

        expect(result.success).toBe(true);
        expect(io.writeRemote).toHaveBeenCalledTimes(1);
        expect(harness.remote?.tasks.map((task) => task.id)).toContain('t-local');
        expect(harness.warnings.some((warning) => warning.message.includes('appears corrupted'))).toBe(true);
        expect(harness.infos.some((info) => info.message.includes('Repairing corrupted WebDAV'))).toBe(true);
    });

    it('still reports the unchanged skip when persisting the status fails', async () => {
        const failing = createHarness({
            fastSyncScope: 'scope-1',
            storage: {
                persistSyncStatus: vi.fn(async () => {
                    throw new Error('disk full');
                }),
            },
        });

        const first = await failing.run();
        expect(first.success).toBe(true);
        const second = await failing.run();

        expect(second).toMatchObject({ success: true, skipped: 'unchanged' });
        expect(failing.harness.warnings.some((warning) => warning.message === 'Failed to persist unchanged sync status')).toBe(true);
    });

    it('surfaces the attachment warning flag on failed runs too', async () => {
        const { run } = createHarness({
            remote: createData([createTask('t-remote', 'Remote task')]),
            io: {
                syncAttachments: vi.fn(async () => {
                    throw new Error('upload failed');
                }),
                writeRemote: vi.fn(async () => {
                    throw new Error('server exploded');
                }),
            },
            hooks: {
                shouldRunAttachmentPhase: vi.fn(async (_data, phase) => phase === 'prepare'),
            },
        });

        const result = await run();

        expect(result.success).toBe(false);
        expect(result.hadAttachmentWarning).toBe(true);
    });
});

describe('normalizeRemoteWriteResult', () => {
    it('prefers an explicit fingerprint and reads the server-merge flag', () => {
        expect(normalizeRemoteWriteResult('cloud', {
            fingerprint: 'fp-explicit',
            serverMergedRemoteData: true,
        })).toEqual({ fingerprint: 'fp-explicit', serverMergedRemoteData: true });
    });

    it('builds an HTTP fingerprint from headers when none is provided', () => {
        const normalized = normalizeRemoteWriteResult('webdav', {
            etag: '"abc"',
            lastModified: 'Mon, 13 Jul 2026 10:00:00 GMT',
            contentLength: '123',
        });
        expect(normalized.fingerprint).toBeTruthy();
        expect(normalized.serverMergedRemoteData).toBe(false);
    });

    it('handles boolean and missing results', () => {
        expect(normalizeRemoteWriteResult('webdav', true)).toEqual({ fingerprint: null, serverMergedRemoteData: false });
        expect(normalizeRemoteWriteResult('cloud', null)).toEqual({ fingerprint: null, serverMergedRemoteData: false });
    });
});
