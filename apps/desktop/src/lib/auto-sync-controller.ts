import { createSyncOrchestrator } from '@mindwtr/core';

type SyncResult = {
    success: boolean;
    error?: string;
};

type DesktopAutoSyncControllerOptions = {
    canSync: () => Promise<boolean>;
    performSync: () => Promise<SyncResult>;
    flushPendingSave: () => Promise<void>;
    reportError: (label: string, error: unknown) => void;
    onSyncFailure?: (error: string) => void;
    isRuntimeActive: () => boolean;
    shouldPauseWindowSync?: () => boolean;
    hasPendingLocalChanges?: () => boolean;
    logInfo?: (message: string, extra?: Record<string, string>) => void;
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    minIntervalMs?: number;
    focusMinIntervalMs?: number;
    debounceFirstChangeMs?: number;
    debounceContinuousChangeMs?: number;
    initialSyncDelayMs?: number;
    periodicSyncIntervalMs?: number | null;
};

export type DesktopAutoSyncController = {
    requestSync: (minIntervalMs?: number) => Promise<void>;
    handleFocus: () => void;
    handleBlur: () => void;
    handleDataChange: () => void;
    scheduleInitialSync: () => void;
    dispose: () => void;
};

const DEFAULT_MIN_INTERVAL_MS = 5_000;
const DEFAULT_FOCUS_MIN_INTERVAL_MS = 30_000;
const DEFAULT_DEBOUNCE_FIRST_CHANGE_MS = 2_000;
const DEFAULT_DEBOUNCE_CONTINUOUS_CHANGE_MS = 5_000;
const DEFAULT_INITIAL_SYNC_DELAY_MS = 1_500;
const DEFAULT_PERIODIC_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export const createDesktopAutoSyncController = (
    options: DesktopAutoSyncControllerOptions
): DesktopAutoSyncController => {
    const now = options.now ?? (() => Date.now());
    const setTimer = options.setTimer ?? setTimeout;
    const clearTimer = options.clearTimer ?? clearTimeout;
    const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    const focusMinIntervalMs = options.focusMinIntervalMs ?? DEFAULT_FOCUS_MIN_INTERVAL_MS;
    const debounceFirstChangeMs = options.debounceFirstChangeMs ?? DEFAULT_DEBOUNCE_FIRST_CHANGE_MS;
    const debounceContinuousChangeMs = options.debounceContinuousChangeMs ?? DEFAULT_DEBOUNCE_CONTINUOUS_CHANGE_MS;
    const initialSyncDelayMs = options.initialSyncDelayMs ?? DEFAULT_INITIAL_SYNC_DELAY_MS;
    const periodicSyncIntervalMs = options.periodicSyncIntervalMs ?? DEFAULT_PERIODIC_SYNC_INTERVAL_MS;
    const periodicSyncEnabled = typeof periodicSyncIntervalMs === 'number'
        && Number.isFinite(periodicSyncIntervalMs)
        && periodicSyncIntervalMs > 0;

    let lastAutoSyncAt = 0;
    let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let syncThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let initialSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let periodicSyncTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const trace = (message: string, extra?: Record<string, string>) => {
        options.logInfo?.(message, extra);
    };

    const clearSyncDebounce = () => {
        if (!syncDebounceTimer) return;
        clearTimer(syncDebounceTimer);
        syncDebounceTimer = null;
    };

    const clearSyncThrottle = () => {
        if (!syncThrottleTimer) return;
        clearTimer(syncThrottleTimer);
        syncThrottleTimer = null;
    };

    const clearInitialSync = () => {
        if (!initialSyncTimer) return;
        clearTimer(initialSyncTimer);
        initialSyncTimer = null;
    };

    const clearPeriodicSync = () => {
        if (!periodicSyncTimer) return;
        clearTimer(periodicSyncTimer);
        periodicSyncTimer = null;
    };

    const schedulePeriodicSync = () => {
        clearPeriodicSync();
        if (!periodicSyncEnabled || disposed) return;
        periodicSyncTimer = setTimer(() => {
            periodicSyncTimer = null;
            if (disposed) return;
            if (options.isRuntimeActive() && !options.shouldPauseWindowSync?.()) {
                trace('Auto sync trigger', { source: 'periodic' });
                void requestSync().catch((error) => options.reportError('Sync failed', error));
            }
            schedulePeriodicSync();
        }, periodicSyncIntervalMs);
    };

    const canRunWindowSync = () => (
        options.isRuntimeActive()
        && !options.shouldPauseWindowSync?.()
    );

    const shouldRunBlurSync = () => (
        canRunWindowSync()
        && (options.hasPendingLocalChanges?.() ?? true)
    );

    const autoSyncOrchestrator = createSyncOrchestrator<number | undefined, void>({
        runCycle: async (overrideMinIntervalMs) => {
            if (!options.isRuntimeActive()) return;

            const effectiveMinIntervalMs = typeof overrideMinIntervalMs === 'number'
                ? overrideMinIntervalMs
                : minIntervalMs;
            const nowMs = now();
            if (nowMs - lastAutoSyncAt < effectiveMinIntervalMs) {
                if (!syncThrottleTimer) {
                    const waitMs = Math.max(0, effectiveMinIntervalMs - (nowMs - lastAutoSyncAt));
                    trace('Auto sync throttled', {
                        waitMs: String(waitMs),
                        minIntervalMs: String(effectiveMinIntervalMs),
                    });
                    syncThrottleTimer = setTimer(() => {
                        syncThrottleTimer = null;
                        trace('Auto sync trigger', { source: 'throttle' });
                        void requestSync(0);
                    }, waitMs);
                }
                return;
            }

            if (!(await options.canSync())) return;

            lastAutoSyncAt = nowMs;
            trace('Auto sync run start', {
                minIntervalMs: String(effectiveMinIntervalMs),
            });
            await options.flushPendingSave().catch((error) => options.reportError('Save failed', error));

            const result = await options.performSync();
            trace('Auto sync run complete', {
                success: String(result.success),
                error: result.error ?? '',
            });
            if (!result.success && result.error) {
                options.onSyncFailure?.(result.error);
            }
        },
        onQueuedRunError: (error) => options.reportError('Sync failed', error),
    });

    const requestSync = async (overrideMinIntervalMs?: number): Promise<void> => {
        if (!options.isRuntimeActive()) return;
        await autoSyncOrchestrator.run(overrideMinIntervalMs);
    };

    schedulePeriodicSync();

    return {
        requestSync,
        handleFocus: () => {
            if (!canRunWindowSync()) return;
            if (now() - lastAutoSyncAt > focusMinIntervalMs) {
                trace('Auto sync trigger', { source: 'focus' });
                void requestSync().catch((error) => options.reportError('Sync failed', error));
            }
        },
        handleBlur: () => {
            if (!shouldRunBlurSync()) return;
            trace('Auto sync trigger', { source: 'blur' });
            void requestSync().catch((error) => options.reportError('Sync failed', error));
        },
        handleDataChange: () => {
            if (!options.isRuntimeActive()) return;
            const hadTimer = !!syncDebounceTimer;
            clearSyncDebounce();
            const debounceMs = hadTimer ? debounceContinuousChangeMs : debounceFirstChangeMs;
            trace('Auto sync data change queued', {
                debounceMs: String(debounceMs),
                hadTimer: String(hadTimer),
            });
            syncDebounceTimer = setTimer(() => {
                syncDebounceTimer = null;
                if (!options.isRuntimeActive()) return;
                trace('Auto sync trigger', { source: 'data-change' });
                void requestSync().catch((error) => options.reportError('Sync failed', error));
            }, debounceMs);
        },
        scheduleInitialSync: () => {
            clearInitialSync();
            initialSyncTimer = setTimer(() => {
                initialSyncTimer = null;
                if (!options.isRuntimeActive()) return;
                trace('Auto sync trigger', { source: 'initial' });
                void requestSync().catch((error) => options.reportError('Sync failed', error));
            }, initialSyncDelayMs);
        },
        dispose: () => {
            disposed = true;
            clearSyncDebounce();
            clearSyncThrottle();
            clearInitialSync();
            clearPeriodicSync();
            autoSyncOrchestrator.reset();
        },
    };
};
