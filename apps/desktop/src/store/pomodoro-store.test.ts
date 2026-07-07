import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';

import {
    DESKTOP_POMODORO_SESSION_STORAGE_KEY,
    usePomodoroStore,
} from './pomodoro-store';

const NOW_ISO = new Date().toISOString();

const task = (updates: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Write report',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...updates,
});

const seedRunningSession = (options: {
    selectedTaskId?: string;
    focusMinutes?: number;
    remainingSeconds?: number;
    updatedAtMs?: number;
}) => {
    const focusMinutes = options.focusMinutes ?? 25;
    window.localStorage.setItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY, JSON.stringify({
        durations: { focusMinutes, breakMinutes: 5 },
        timerState: {
            phase: 'focus',
            remainingSeconds: options.remainingSeconds ?? 5,
            isRunning: true,
            completedFocusSessions: 0,
        },
        selectedTaskId: options.selectedTaskId,
        updatedAtMs: options.updatedAtMs ?? Date.now() - 10_000,
        sessionHistory: { totalCompletedFocusSessions: 0, completedFocusSessionsByTaskId: {} },
    }));
};

describe('pomodoro store', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({ tasks: [task()], _allTasks: [task()] } as never);
        usePomodoroStore.setState({ hasHydrated: false });
    });

    it('credits a focus session completed while the app was closed to the linked task', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 25 } }]);
        const history = usePomodoroStore.getState().snapshot.sessionHistory;
        expect(history.completedFocusSessionsByTaskId['task-1']).toBe(1);
    });

    it('adds to an existing time-spent total instead of replacing it', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            tasks: [task({ timeSpentMinutes: 50 })],
            _allTasks: [task({ timeSpentMinutes: 50 })],
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ selectedTaskId: 'task-1', focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([{ id: 'task-1', patch: { timeSpentMinutes: 75 } }]);
    });

    it('does not touch tasks when the completed session has no linked task', () => {
        const updates: Array<{ id: string; patch: Partial<Task> }> = [];
        useTaskStore.setState({
            updateTask: async (id: string, patch: Partial<Task>) => {
                updates.push({ id, patch });
            },
        } as never);
        seedRunningSession({ focusMinutes: 25 });

        usePomodoroStore.getState().hydratePomodoro({});

        expect(updates).toEqual([]);
        expect(usePomodoroStore.getState().snapshot.sessionHistory.totalCompletedFocusSessions).toBe(1);
    });

    it('starts a linked focus session from a task via quick start', () => {
        usePomodoroStore.getState().hydratePomodoro({});
        usePomodoroStore.getState().startPomodoroFocusForTask('task-1', {});

        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('task-1');
        expect(snapshot.timerState.phase).toBe('focus');
        expect(snapshot.timerState.isRunning).toBe(true);

        const stored = JSON.parse(window.localStorage.getItem(DESKTOP_POMODORO_SESSION_STORAGE_KEY) ?? '{}');
        expect(stored.selectedTaskId).toBe('task-1');
        expect(stored.timerState.isRunning).toBe(true);
    });

    it('hydrates lazily when quick start is the first pomodoro interaction', () => {
        seedRunningSession({ selectedTaskId: undefined, focusMinutes: 25, remainingSeconds: 120 });

        usePomodoroStore.getState().startPomodoroFocusForTask('task-1', {});

        const snapshot = usePomodoroStore.getState().snapshot;
        expect(snapshot.selectedTaskId).toBe('task-1');
        expect(snapshot.timerState.isRunning).toBe(true);
        expect(snapshot.durations.focusMinutes).toBe(25);
    });
});
