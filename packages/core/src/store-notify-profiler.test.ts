import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeWithSelector } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';
import { consoleLogger, setLogger, type LogPayload } from './logger';
import { resetForTests, useTaskStore } from './store';
import {
    beginNotifyProfile,
    endNotifyProfile,
    instrumentStoreSubscribe,
} from './store-notify-profiler';

type TestState = {
    value: number;
};

const createTestStore = () => {
    const store = createStore<TestState>()(
        subscribeWithSelector(() => ({ value: 0 })),
    );
    instrumentStoreSubscribe(store);
    return store;
};

describe('store notify profiler', () => {
    afterEach(() => {
        endNotifyProfile();
        vi.restoreAllMocks();
    });

    it('counts and times hook-form listeners while profiling', () => {
        const store = createTestStore();
        const unsubscribeFirst = store.subscribe(() => undefined);
        const unsubscribeSecond = store.subscribe(() => undefined);
        vi.spyOn(performance, 'now')
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(14)
            .mockReturnValueOnce(20)
            .mockReturnValueOnce(28);

        beginNotifyProfile();
        store.setState({ value: 1 });
        const profile = endNotifyProfile();

        expect(profile).toEqual({
            listenerCount: 2,
            timedCalls: 2,
            timedTotalMs: 12,
            maxMs: 8,
            top5Ms: [8, 4],
        });
        unsubscribeFirst();
        unsubscribeSecond();
    });

    it('decrements the listener count exactly once on double unsubscribe', () => {
        const store = createTestStore();
        const unsubscribe = store.subscribe(() => undefined);

        unsubscribe();
        unsubscribe();
        beginNotifyProfile();

        expect(endNotifyProfile()?.listenerCount).toBe(0);
    });

    it('passes selector-form subscriptions through and counts them without timing', () => {
        const store = createTestStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe((state) => state.value, listener);

        beginNotifyProfile();
        store.setState({ value: 2 });
        const profile = endNotifyProfile();

        expect(listener).toHaveBeenCalledWith(2, 0);
        expect(profile).toMatchObject({ listenerCount: 1, timedCalls: 0 });
        unsubscribe();
    });

    it('does not time inactive profiling while listeners still fire', () => {
        const store = createTestStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.setState({ value: 3 });

        expect(listener).toHaveBeenCalledOnce();
        expect(endNotifyProfile()).toBeNull();
        unsubscribe();
    });
});

describe('fetchData notify profiling log fields', () => {
    const nowIso = '2026-07-21T12:00:00.000Z';
    let logs: LogPayload[];

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(nowIso));
        logs = [];
        setLogger((payload) => logs.push(payload));
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {},
            isLoading: false,
            error: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            lastDataChangeAt: 0,
        });
    });

    afterEach(() => {
        setLogger(consoleLogger);
        resetForTests();
        vi.useRealTimers();
    });

    const fetchSlowData = async (loggingEnabled: boolean) => {
        const unsubscribe = useTaskStore.subscribe(() =>
            vi.advanceTimersByTime(1_001),
        );
        try {
            await useTaskStore.getState().fetchData({
                silent: true,
                preloadedData: {
                    tasks: [],
                    projects: [],
                    sections: [],
                    areas: [],
                    people: [],
                    settings: {
                        deviceId: 'device-a',
                        diagnostics: { loggingEnabled },
                        migrations: {
                            version: 9999,
                            lastAutoArchiveAt: nowIso,
                            lastTombstoneCleanupAt: nowIso,
                        },
                        gtd: {
                            taskEditor: { defaultsVersion: 9999 },
                            focusGroupByDefaultsVersion: 1,
                        },
                    },
                },
            });
        } finally {
            unsubscribe();
        }
        return logs.find((entry) => entry.message === 'Slow data load pipeline')
            ?.context;
    };

    it('includes notify profiling fields when diagnostics logging is enabled', async () => {
        const context = await fetchSlowData(true);

        expect(context).toMatchObject({
            notifyListenerCount: '1',
            notifyTimedCalls: '1',
            notifyTimedMs: expect.any(String),
            notifyMaxMs: expect.any(String),
            notifyTop5Ms: expect.any(String),
        });
    });

    it('omits notify profiling fields when diagnostics logging is disabled', async () => {
        const context = await fetchSlowData(false);

        expect(context).toBeDefined();
        expect(context).not.toHaveProperty('notifyListenerCount');
        expect(context).not.toHaveProperty('notifyTimedCalls');
        expect(context).not.toHaveProperty('notifyTimedMs');
        expect(context).not.toHaveProperty('notifyMaxMs');
        expect(context).not.toHaveProperty('notifyTop5Ms');
    });
});
