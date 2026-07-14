import { describe, expect, it, vi } from 'vitest';
import type { CalendarSyncEntry } from './sqlite-adapter';
import type { Task } from './types';
import {
    runCalendarPushFullSync,
    runCalendarPushPartialSync,
    type CalendarPushRunPorts,
} from './calendar-push-run';

const now = '2026-07-14T12:00:00.000Z';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Plan review',
    status: 'next',
    tags: [],
    contexts: [],
    dueDate: '2026-07-20',
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const createHarness = () => {
    const entries = new Map<string, CalendarSyncEntry>();
    const createEvent = vi.fn(async () => 'event-new');
    const updateEvent = vi.fn(async (entry: CalendarSyncEntry) => ({
        status: 'updated' as const,
        eventId: entry.calendarEventId,
    }));
    const deleteEvent = vi.fn(async () => undefined);
    const ports: CalendarPushRunPorts = {
        platform: 'test',
        nowIso: () => now,
        createEvent,
        updateEvent,
        deleteEvent,
        getSyncEntry: async (taskId) => entries.get(taskId) ?? null,
        getAllSyncEntries: async () => Array.from(entries.values()),
        upsertSyncEntry: async (entry) => {
            entries.set(entry.taskId, entry);
        },
        deleteSyncEntry: async (taskId) => {
            entries.delete(taskId);
        },
    };
    return {
        entries,
        createEvent,
        updateEvent,
        deleteEvent,
        ports,
    };
};

describe('runCalendarPushFullSync', () => {
    it('creates an event and persists its mapping for an eligible task', async () => {
        const harness = createHarness();

        const result = await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.createEvent).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'task-1' }),
        );
        expect(harness.entries.get('task-1')).toEqual({
            taskId: 'task-1',
            calendarEventId: 'event-new',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: now,
        });
        expect(result).toEqual({
            total: 1,
            failed: 0,
            stale: 0,
            staleFailed: 0,
        });
    });

    it('deletes the event and mapping when a task becomes completed', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: now,
        });

        const result = await runCalendarPushFullSync({
            tasks: [makeTask({ status: 'done' })],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.deleteEvent).toHaveBeenCalledWith(
            expect.objectContaining({ calendarEventId: 'event-old' }),
        );
        expect(harness.entries.has('task-1')).toBe(false);
        expect(harness.createEvent).not.toHaveBeenCalled();
        expect(result.stale).toBe(0);
        expect(result.staleFailed).toBe(0);
    });

    it('updates an existing event in place and refreshes its mapping', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: '2026-07-13T12:00:00.000Z',
        });

        await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.updateEvent).toHaveBeenCalledWith(
            expect.objectContaining({ calendarEventId: 'event-old' }),
            expect.objectContaining({ id: 'task-1' }),
        );
        expect(harness.createEvent).not.toHaveBeenCalled();
        expect(harness.entries.get('task-1')?.lastSyncedAt).toBe(now);
    });

    it('recreates an event when the native adapter reports the old event missing', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: now,
        });
        harness.updateEvent.mockResolvedValue({ status: 'missing' });

        await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.createEvent).toHaveBeenCalledTimes(1);
        expect(harness.entries.get('task-1')?.calendarEventId).toBe('event-new');
    });

    it('deletes then recreates an event when the target calendar changes', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-old',
            platform: 'test',
            lastSyncedAt: now,
        });

        await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-new' },
            ports: harness.ports,
        });

        expect(harness.deleteEvent).toHaveBeenCalledWith(
            expect.objectContaining({ calendarEventId: 'event-old' }),
        );
        expect(harness.createEvent).toHaveBeenCalledTimes(1);
        expect(harness.entries.get('task-1')?.calendarId).toBe('calendar-new');
    });

    it('keeps the mapping and avoids a duplicate when updating fails', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: now,
        });
        harness.updateEvent.mockRejectedValue(new Error('calendar unavailable'));

        const result = await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(result.failed).toBe(1);
        expect(harness.createEvent).not.toHaveBeenCalled();
        expect(harness.entries.get('task-1')?.calendarEventId).toBe('event-old');
    });

    it('keeps the old mapping and avoids a duplicate when a target move cannot delete', async () => {
        const harness = createHarness();
        harness.entries.set('task-1', {
            taskId: 'task-1',
            calendarEventId: 'event-old',
            calendarId: 'calendar-old',
            platform: 'test',
            lastSyncedAt: now,
        });
        harness.deleteEvent.mockRejectedValue(new Error('calendar unavailable'));

        const result = await runCalendarPushFullSync({
            tasks: [makeTask()],
            target: { id: 'calendar-new' },
            ports: harness.ports,
        });

        expect(result.failed).toBe(1);
        expect(harness.createEvent).not.toHaveBeenCalled();
        expect(harness.entries.get('task-1')?.calendarId).toBe('calendar-old');
    });

    it('reconciles stale mappings that no longer have a task', async () => {
        const harness = createHarness();
        harness.entries.set('ghost', {
            taskId: 'ghost',
            calendarEventId: 'event-ghost',
            calendarId: 'calendar-1',
            platform: 'test',
            lastSyncedAt: now,
        });

        const result = await runCalendarPushFullSync({
            tasks: [],
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.deleteEvent).toHaveBeenCalledTimes(1);
        expect(harness.entries.size).toBe(0);
        expect(result.stale).toBe(1);
        expect(result.staleFailed).toBe(0);
    });

    it('honors the configured concurrency limit', async () => {
        const harness = createHarness();
        let active = 0;
        let peak = 0;
        harness.createEvent.mockImplementation(async (task) => {
            active += 1;
            peak = Math.max(peak, active);
            await Promise.resolve();
            active -= 1;
            return 'event-' + task.id;
        });
        const tasks = Array.from({ length: 6 }, (_value, index) =>
            makeTask({ id: 'task-' + index })
        );

        await runCalendarPushFullSync({
            tasks,
            target: { id: 'calendar-1' },
            ports: harness.ports,
            concurrency: 2,
        });

        expect(peak).toBe(2);
    });
});

describe('runCalendarPushPartialSync', () => {
    it('removes mappings for a missing task and its projected occurrence', async () => {
        const harness = createHarness();
        for (const taskId of ['missing', 'missing:projected-recurrence']) {
            harness.entries.set(taskId, {
                taskId,
                calendarEventId: 'event-' + taskId,
                calendarId: 'calendar-1',
                platform: 'test',
                lastSyncedAt: now,
            });
        }

        const result = await runCalendarPushPartialSync({
            taskIds: ['missing'],
            tasksById: new Map(),
            target: { id: 'calendar-1' },
            ports: harness.ports,
        });

        expect(harness.deleteEvent).toHaveBeenCalledTimes(2);
        expect(harness.entries.size).toBe(0);
        expect(result).toEqual({
            total: 0,
            failed: 0,
            removed: 2,
            removedFailed: 0,
        });
    });
});
