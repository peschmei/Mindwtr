import { beforeEach, describe, expect, it } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';

import { undoTaskCompletion } from './undo-task-completion';

const initialTaskState = useTaskStore.getState();
const now = new Date().toISOString();

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
    id,
    title: `Task ${id}`,
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
});

const getTask = (id: string): Task | undefined =>
    useTaskStore.getState()._allTasks.find((task) => task.id === id);

describe('undoTaskCompletion', () => {
    beforeEach(() => {
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState({
            _allTasks: [],
            _allProjects: [],
            _allAreas: [],
            settings: {},
            lastDataChangeAt: 0,
        });
    });

    it('restores the Today star along with the status', async () => {
        useTaskStore.setState({
            _allTasks: [makeTask('t1', { isFocusedToday: true })],
        });
        const store = useTaskStore.getState();
        await store.moveTask('t1', 'done');
        expect(getTask('t1')?.status).toBe('done');
        expect(getTask('t1')?.isFocusedToday).toBe(false);

        await undoTaskCompletion('t1', 'next', true);

        expect(getTask('t1')?.status).toBe('next');
        expect(getTask('t1')?.isFocusedToday).toBe(true);
    });

    it('does not add a star the task never had', async () => {
        useTaskStore.setState({
            _allTasks: [makeTask('t2')],
        });
        await useTaskStore.getState().moveTask('t2', 'done');

        await undoTaskCompletion('t2', 'next', false);

        expect(getTask('t2')?.status).toBe('next');
        expect(getTask('t2')?.isFocusedToday ?? false).toBe(false);
    });

    it('skips the star when the focus cap has been refilled meanwhile', async () => {
        useTaskStore.setState({
            _allTasks: [
                makeTask('t3', { isFocusedToday: true }),
                makeTask('f1'),
                makeTask('f2'),
                makeTask('f3'),
            ],
            settings: { gtd: { focusTaskLimit: 3 } },
        });
        const store = useTaskStore.getState();
        await store.moveTask('t3', 'done');
        // Cap refills while the undo toast is on screen.
        await store.updateTask('f1', { isFocusedToday: true });
        await store.updateTask('f2', { isFocusedToday: true });
        await store.updateTask('f3', { isFocusedToday: true });

        await undoTaskCompletion('t3', 'next', true);

        expect(getTask('t3')?.status).toBe('next');
        expect(getTask('t3')?.isFocusedToday ?? false).toBe(false);
    });
});
