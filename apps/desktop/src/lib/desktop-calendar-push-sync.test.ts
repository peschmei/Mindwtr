import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type CalendarSyncEntry, type Task } from '@mindwtr/core';

import {
    __desktopCalendarPushSyncTestUtils,
    runFullDesktopCalendarPushSync,
} from './desktop-calendar-push-sync';
import type { SystemCalendarEventDetails, SystemCalendarPushTarget } from './system-calendar';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Plan review',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T08:00:00.000Z',
    updatedAt: '2026-01-01T08:00:00.000Z',
    ...overrides,
});

const setStoreTasks = (tasks: Task[]) => {
    useTaskStore.setState((state) => ({
        ...state,
        tasks,
        _allTasks: tasks,
        _tasksById: new Map(tasks.map((task) => [task.id, task])),
    }));
};

describe('desktop calendar push sync', () => {
    let createEvent: ReturnType<typeof vi.fn<(details: SystemCalendarEventDetails) => Promise<string | null>>>;
    let updateEvent: ReturnType<typeof vi.fn<(eventId: string, details: SystemCalendarEventDetails) => Promise<string | null>>>;
    let deleteEvent: ReturnType<typeof vi.fn<(eventId: string) => Promise<boolean>>>;
    let upsertSyncEntry: ReturnType<typeof vi.fn<(entry: CalendarSyncEntry) => Promise<void>>>;
    let deleteSyncEntry: ReturnType<typeof vi.fn<(taskId: string, platform: string) => Promise<void>>>;
    let getSyncEntry: ReturnType<typeof vi.fn<(taskId: string, platform: string) => Promise<CalendarSyncEntry | null>>>;
    let getAllSyncEntries: ReturnType<typeof vi.fn<(platform: string) => Promise<CalendarSyncEntry[]>>>;
    let getTargetCalendarId: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
    let getTargets: ReturnType<typeof vi.fn<() => Promise<SystemCalendarPushTarget[]>>>;
    let ensureMindwtrCalendar: ReturnType<typeof vi.fn<() => Promise<SystemCalendarPushTarget | null>>>;

    const managedTarget: SystemCalendarPushTarget = {
        id: 'cal-mindwtr',
        name: 'Mindwtr',
        isMindwtrDedicated: true,
    };

    beforeEach(() => {
        (window as any).__TAURI_INTERNALS__ = {};
        __desktopCalendarPushSyncTestUtils.resetForTests();
        setStoreTasks([]);

        createEvent = vi.fn(async () => 'event-new');
        updateEvent = vi.fn(async (_eventId) => _eventId);
        deleteEvent = vi.fn(async () => true);
        upsertSyncEntry = vi.fn(async () => undefined);
        deleteSyncEntry = vi.fn(async () => undefined);
        getSyncEntry = vi.fn(async () => null);
        getAllSyncEntries = vi.fn(async () => []);
        getTargetCalendarId = vi.fn(async () => null);
        getTargets = vi.fn(async () => [managedTarget]);
        ensureMindwtrCalendar = vi.fn(async () => managedTarget);

        __desktopCalendarPushSyncTestUtils.setDependenciesForTests({
            createEvent,
            updateEvent,
            deleteEvent,
            upsertSyncEntry,
            deleteSyncEntry,
            getSyncEntry,
            getAllSyncEntries,
            getTargetCalendarId,
            getTargets,
            ensureMindwtrCalendar,
            getManagedCalendarId: async () => null,
            getPermissionStatus: async () => 'granted',
            getPushEnabled: async () => true,
            setManagedCalendarId: async () => undefined,
            removeManagedCalendarId: async () => undefined,
            setTargetCalendarId: async () => undefined,
            nowIso: () => '2026-01-01T12:00:00.000Z',
        });
    });

    it('creates all-day events for due-date tasks in the managed Mindwtr calendar', async () => {
        setStoreTasks([makeTask({ dueDate: '2026-01-10' })]);

        await runFullDesktopCalendarPushSync();

        expect(ensureMindwtrCalendar).toHaveBeenCalledTimes(1);
        expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
            calendarId: 'cal-mindwtr',
            title: 'Plan review',
            allDay: true,
        }));
        expect(upsertSyncEntry).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'task-1',
            calendarEventId: 'event-new',
            calendarId: 'cal-mindwtr',
            platform: 'macos',
        }));
    });

    it('prefixes titles when pushing to a shared selected calendar', async () => {
        getTargetCalendarId.mockResolvedValue('cal-shared');
        getTargets.mockResolvedValue([{
            id: 'cal-shared',
            name: 'Work',
            isMindwtrDedicated: false,
        }]);
        setStoreTasks([makeTask({ startTime: '2026-01-10T09:00:00' })]);

        await runFullDesktopCalendarPushSync();

        expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({
            calendarId: 'cal-shared',
            title: 'Mindwtr: Plan review',
            allDay: false,
        }));
    });

    it('removes pushed events when tasks are completed', async () => {
        const entry: CalendarSyncEntry = {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'cal-mindwtr',
            platform: 'macos',
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
        };
        getSyncEntry.mockResolvedValue(entry);
        setStoreTasks([makeTask({ dueDate: '2026-01-10', status: 'done' })]);

        await runFullDesktopCalendarPushSync();

        expect(deleteEvent).toHaveBeenCalledWith('event-old');
        expect(deleteSyncEntry).toHaveBeenCalledWith('task-1', 'macos');
        expect(createEvent).not.toHaveBeenCalled();
    });

    it('reconciles stale calendar sync entries on full sync', async () => {
        getAllSyncEntries.mockResolvedValue([{
            taskId: 'ghost-task',
            calendarEventId: 'event-ghost',
            calendarId: 'cal-mindwtr',
            platform: 'macos',
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
        }]);
        setStoreTasks([]);

        await runFullDesktopCalendarPushSync();

        expect(deleteEvent).toHaveBeenCalledWith('event-ghost');
        expect(deleteSyncEntry).toHaveBeenCalledWith('ghost-task', 'macos');
    });
});
