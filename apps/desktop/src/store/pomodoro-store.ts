import { createWithEqualityFn } from 'zustand/traditional';
import {
    addTimeSpentMinutes,
    advancePomodoroState,
    createPomodoroState,
    DEFAULT_POMODORO_DURATIONS,
    recordPomodoroFocusSessions,
    resetPomodoroState,
    sanitizePomodoroDurations,
    sanitizePomodoroSessionHistory,
    useTaskStore,
    type PomodoroAutoStartOptions,
    type PomodoroDurations,
    type PomodoroEvent,
    type PomodoroSessionHistory,
    type PomodoroState,
} from '@mindwtr/core';

export const DESKTOP_POMODORO_SESSION_STORAGE_KEY = 'mindwtr:pomodoro:session:v1';

export type PomodoroSnapshot = {
    durations: PomodoroDurations;
    timerState: PomodoroState;
    selectedTaskId?: string;
    lastEvent: PomodoroEvent | null;
    updatedAtMs: number;
    sessionHistory: PomodoroSessionHistory;
};

const createInitialSnapshot = (nowMs = Date.now()): PomodoroSnapshot => ({
    durations: DEFAULT_POMODORO_DURATIONS,
    timerState: createPomodoroState(DEFAULT_POMODORO_DURATIONS),
    selectedTaskId: undefined,
    lastEvent: null,
    updatedAtMs: nowMs,
    sessionHistory: sanitizePomodoroSessionHistory(),
});

export const reconcilePomodoroSnapshot = (
    snapshot: PomodoroSnapshot,
    nowMs: number,
    autoStartOptions: PomodoroAutoStartOptions
): PomodoroSnapshot => {
    if (!snapshot.timerState.isRunning) {
        return { ...snapshot, updatedAtMs: nowMs };
    }
    const elapsedSeconds = Math.floor((nowMs - snapshot.updatedAtMs) / 1000);
    if (elapsedSeconds <= 0) return snapshot;
    const advanced = advancePomodoroState(snapshot.timerState, snapshot.durations, elapsedSeconds, autoStartOptions);
    const completedSessionDelta = advanced.state.completedFocusSessions - snapshot.timerState.completedFocusSessions;
    const sessionHistory = completedSessionDelta > 0
        ? recordPomodoroFocusSessions(snapshot.sessionHistory, snapshot.selectedTaskId, completedSessionDelta)
        : snapshot.sessionHistory;
    const updatedAtMs = snapshot.updatedAtMs + elapsedSeconds * 1000;
    return {
        ...snapshot,
        timerState: {
            ...advanced.state,
            completedFocusSessions: Math.max(
                advanced.state.completedFocusSessions,
                sessionHistory.totalCompletedFocusSessions
            ),
        },
        sessionHistory,
        lastEvent: advanced.lastEvent ?? snapshot.lastEvent,
        updatedAtMs,
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    !!value && typeof value === 'object' && !Array.isArray(value)
);

const sanitizeStoredPomodoroState = (
    value: unknown,
    durations: PomodoroDurations
): PomodoroState => {
    const record = isRecord(value) ? value : {};
    const phase = record.phase === 'break' ? 'break' : 'focus';
    const baseState = createPomodoroState(
        durations,
        phase,
        typeof record.completedFocusSessions === 'number' ? record.completedFocusSessions : 0
    );
    const remainingSeconds = typeof record.remainingSeconds === 'number' && Number.isFinite(record.remainingSeconds)
        ? Math.max(0, Math.min(baseState.remainingSeconds, Math.floor(record.remainingSeconds)))
        : baseState.remainingSeconds;

    return {
        ...baseState,
        remainingSeconds,
        isRunning: record.isRunning === true,
    };
};

const parseStoredPomodoroSnapshot = (value: unknown, nowMs: number): PomodoroSnapshot => {
    if (!isRecord(value)) return createInitialSnapshot(nowMs);

    const durations = sanitizePomodoroDurations(isRecord(value.durations) ? value.durations : undefined);
    const sanitizedTimerState = sanitizeStoredPomodoroState(value.timerState, durations);
    const sessionHistory = sanitizePomodoroSessionHistory(
        isRecord(value.sessionHistory) ? value.sessionHistory : undefined,
        sanitizedTimerState.completedFocusSessions
    );
    const timerState = {
        ...sanitizedTimerState,
        completedFocusSessions: Math.max(
            sanitizedTimerState.completedFocusSessions,
            sessionHistory.totalCompletedFocusSessions
        ),
    };
    const updatedAtMs = typeof value.updatedAtMs === 'number' && Number.isFinite(value.updatedAtMs)
        ? value.updatedAtMs
        : nowMs;
    const selectedTaskId = typeof value.selectedTaskId === 'string' && value.selectedTaskId.trim().length > 0
        ? value.selectedTaskId
        : undefined;

    return {
        durations,
        timerState,
        selectedTaskId,
        lastEvent: null,
        updatedAtMs,
        sessionHistory,
    };
};

const readStoredPomodoroSnapshot = (nowMs: number): PomodoroSnapshot => {
    if (typeof window === 'undefined') return createInitialSnapshot(nowMs);
    try {
        const raw = window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY);
        if (!raw) return createInitialSnapshot(nowMs);
        return parseStoredPomodoroSnapshot(JSON.parse(raw) as unknown, nowMs);
    } catch {
        return createInitialSnapshot(nowMs);
    }
};

const saveStoredPomodoroSnapshot = (snapshot: PomodoroSnapshot) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
            durations: snapshot.durations,
            timerState: snapshot.timerState,
            selectedTaskId: snapshot.selectedTaskId,
            updatedAtMs: snapshot.updatedAtMs,
            sessionHistory: snapshot.sessionHistory,
        }));
    } catch {
        // Pomodoro state is device-local convenience data; storage failures should not block timer controls.
    }
};

// Completed focus sessions add their focus minutes to the linked task's
// synced time-spent total. Runs on every snapshot commit, so panel ticks,
// startup reconciles, and quick-starts all credit through one path.
const creditCompletedFocusSessions = (prev: PomodoroSnapshot, next: PomodoroSnapshot) => {
    const prevByTask = prev.sessionHistory.completedFocusSessionsByTaskId;
    const nextByTask = next.sessionHistory.completedFocusSessionsByTaskId;
    if (prevByTask === nextByTask) return;
    const { tasks, updateTask } = useTaskStore.getState();
    for (const [taskId, count] of Object.entries(nextByTask)) {
        const delta = count - (prevByTask[taskId] ?? 0);
        if (delta <= 0) continue;
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task) continue;
        const nextTotal = addTimeSpentMinutes(task.timeSpentMinutes, delta * next.durations.focusMinutes);
        if (nextTotal !== undefined && nextTotal !== task.timeSpentMinutes) {
            void updateTask(taskId, { timeSpentMinutes: nextTotal });
        }
    }
};

type PomodoroStoreState = {
    snapshot: PomodoroSnapshot;
    hasHydrated: boolean;
    /** Re-read persisted state and reconcile elapsed time (crediting offline sessions). */
    hydratePomodoro: (autoStartOptions: PomodoroAutoStartOptions) => void;
    /** Apply an updater to the snapshot; persists and credits completed sessions. */
    commitPomodoro: (updater: (prev: PomodoroSnapshot) => PomodoroSnapshot) => void;
    /** Link a task and start a focus session for it (never a free-running clock). */
    startPomodoroFocusForTask: (taskId: string, autoStartOptions: PomodoroAutoStartOptions) => void;
};

export const usePomodoroStore = createWithEqualityFn<PomodoroStoreState>((set, get) => ({
    snapshot: createInitialSnapshot(),
    hasHydrated: false,
    hydratePomodoro: (autoStartOptions) => {
        const nowMs = Date.now();
        const stored = readStoredPomodoroSnapshot(nowMs);
        const reconciled = reconcilePomodoroSnapshot(stored, nowMs, autoStartOptions);
        creditCompletedFocusSessions(stored, reconciled);
        saveStoredPomodoroSnapshot(reconciled);
        set({ snapshot: reconciled, hasHydrated: true });
    },
    commitPomodoro: (updater) => {
        const prev = get().snapshot;
        const next = updater(prev);
        creditCompletedFocusSessions(prev, next);
        saveStoredPomodoroSnapshot(next);
        set({ snapshot: next });
    },
    startPomodoroFocusForTask: (taskId, autoStartOptions) => {
        if (!get().hasHydrated) {
            get().hydratePomodoro(autoStartOptions);
        }
        get().commitPomodoro((prev) => {
            const reconciled = reconcilePomodoroSnapshot(prev, Date.now(), autoStartOptions);
            return {
                ...reconciled,
                selectedTaskId: taskId,
                timerState: {
                    ...resetPomodoroState(reconciled.timerState, reconciled.durations, 'focus'),
                    isRunning: true,
                },
                lastEvent: null,
                updatedAtMs: Date.now(),
            };
        });
    },
}));
