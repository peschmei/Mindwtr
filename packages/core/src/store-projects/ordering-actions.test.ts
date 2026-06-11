import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import type { AppData } from '../types';

const BASE_NOW = '2026-06-11T12:00:00.000Z';

describe('reorderBoardTasks', () => {
    let saveData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], settings: {} }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            settings: {},
            isLoading: false,
            error: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Date(BASE_NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const latestSavedData = (): AppData => {
        const saved = saveData.mock.calls.at(-1)?.[0] as AppData | undefined;
        expect(saved).toBeDefined();
        return saved!;
    };

    const addStatusTask = async (title: string, status: 'next' | 'waiting') => {
        const { addTask } = useTaskStore.getState();
        await addTask(title, { status });
        const task = useTaskStore.getState()._allTasks.find((item) => item.title === title);
        expect(task).toBeDefined();
        return task!;
    };

    it('assigns boardOrder by position and bumps revisions for the given status', async () => {
        const q = await addStatusTask('Task Q', 'next');
        const w = await addStatusTask('Task W', 'next');
        const e = await addStatusTask('Task E', 'next');
        const r = await addStatusTask('Task R', 'next');

        await useTaskStore.getState().reorderBoardTasks('next', [e.id, q.id, w.id, r.id]);

        const byId = new Map(useTaskStore.getState().tasks.map((task) => [task.id, task]));
        expect(byId.get(e.id)?.boardOrder).toBe(0);
        expect(byId.get(q.id)?.boardOrder).toBe(1);
        expect(byId.get(w.id)?.boardOrder).toBe(2);
        expect(byId.get(r.id)?.boardOrder).toBe(3);
        expect(byId.get(e.id)?.rev).toBe((e.rev ?? 0) + 1);

        await flushPendingSave();
        const saved = latestSavedData();
        expect(saved.tasks.find((task) => task.id === e.id)?.boardOrder).toBe(0);
    });

    it('leaves tasks in other statuses untouched', async () => {
        const next = await addStatusTask('Next Task', 'next');
        const waiting = await addStatusTask('Waiting Task', 'waiting');

        await useTaskStore.getState().reorderBoardTasks('next', [next.id]);

        const state = useTaskStore.getState();
        expect(state.tasks.find((task) => task.id === waiting.id)?.boardOrder).toBeUndefined();
        expect(state.tasks.find((task) => task.id === waiting.id)?.rev).toBe(waiting.rev);
    });

    it('appends same-status tasks missing from orderedIds after the ordered ones', async () => {
        const a = await addStatusTask('A', 'next');
        const b = await addStatusTask('B', 'next');
        const c = await addStatusTask('C', 'next');

        await useTaskStore.getState().reorderBoardTasks('next', [c.id, a.id]);

        const byId = new Map(useTaskStore.getState().tasks.map((task) => [task.id, task]));
        expect(byId.get(c.id)?.boardOrder).toBe(0);
        expect(byId.get(a.id)?.boardOrder).toBe(1);
        expect(byId.get(b.id)?.boardOrder).toBe(2);
    });

    it('ignores ids that are not tasks in the target status', async () => {
        const a = await addStatusTask('A', 'next');
        const waiting = await addStatusTask('W', 'waiting');

        await useTaskStore.getState().reorderBoardTasks('next', [waiting.id, 'missing-id', a.id]);

        const byId = new Map(useTaskStore.getState().tasks.map((task) => [task.id, task]));
        expect(byId.get(a.id)?.boardOrder).toBe(0);
        expect(byId.get(waiting.id)?.boardOrder).toBeUndefined();
    });

    it('clears boardOrder when a task changes status', async () => {
        const a = await addStatusTask('A', 'next');
        const b = await addStatusTask('B', 'next');
        await useTaskStore.getState().reorderBoardTasks('next', [b.id, a.id]);
        expect(useTaskStore.getState().tasks.find((task) => task.id === a.id)?.boardOrder).toBe(1);

        await useTaskStore.getState().moveTask(a.id, 'waiting');

        const moved = useTaskStore.getState().tasks.find((task) => task.id === a.id);
        expect(moved?.status).toBe('waiting');
        expect(moved?.boardOrder).toBeUndefined();
    });

    it('keeps boardOrder when a task updates without a status change', async () => {
        const a = await addStatusTask('A', 'next');
        const b = await addStatusTask('B', 'next');
        await useTaskStore.getState().reorderBoardTasks('next', [b.id, a.id]);

        await useTaskStore.getState().updateTask(a.id, { title: 'A renamed' });

        const updated = useTaskStore.getState().tasks.find((task) => task.id === a.id);
        expect(updated?.boardOrder).toBe(1);
    });
});
