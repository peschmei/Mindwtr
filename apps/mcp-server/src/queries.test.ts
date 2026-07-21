import { describe, expect, test } from 'bun:test';
import {
    getPerson,
    getProject,
    getTask,
    listPeople,
    listProjects,
    listTasks,
    parseQuickAdd,
    type ProjectRef,
} from './queries.js';
import type { DbClient } from './db.js';

const createMockDb = (
    rows: any[] = [],
    options: { hasTasksFts?: boolean; hasPeopleTable?: boolean } = {},
): { db: DbClient; calls: { sql: string; params: any[] }[] } => {
    const calls: { sql: string; params: any[] }[] = [];
    const db: DbClient = {
        prepare: (sql: string) => ({
            all: (...params: any[]) => {
                calls.push({ sql, params });
                if (sql.startsWith('PRAGMA table_info(tasks)')) {
                    return [
                        { name: 'id' },
                        { name: 'title' },
                        { name: 'status' },
                        { name: 'priority' },
                        { name: 'energyLevel' },
                        { name: 'assignedTo' },
                        { name: 'taskMode' },
                        { name: 'startTime' },
                        { name: 'dueDate' },
                        { name: 'recurrence' },
                        { name: 'pushCount' },
                        { name: 'tags' },
                        { name: 'contexts' },
                        { name: 'checklist' },
                        { name: 'description' },
                        { name: 'textDirection' },
                        { name: 'attachments' },
                        { name: 'location' },
                        { name: 'projectId' },
                        { name: 'sectionId' },
                        { name: 'areaId' },
                        { name: 'orderNum' },
                        { name: 'isFocusedToday' },
                        { name: 'timeEstimate' },
                        { name: 'reviewAt' },
                        { name: 'completedAt' },
                        { name: 'createdAt' },
                        { name: 'updatedAt' },
                        { name: 'deletedAt' },
                        { name: 'purgedAt' },
                        { name: 'focusOrder' },
                    ];
                }
                if (sql.startsWith('PRAGMA table_info(projects)')) {
                    return [
                        { name: 'id' },
                        { name: 'title' },
                        { name: 'status' },
                        { name: 'color' },
                        { name: 'orderNum' },
                        { name: 'tagIds' },
                        { name: 'isSequential' },
                        { name: 'sequentialScope' },
                        { name: 'taskSortBy' },
                        { name: 'isFocused' },
                        { name: 'supportNotes' },
                        { name: 'attachments' },
                        { name: 'dueDate' },
                        { name: 'reviewAt' },
                        { name: 'areaId' },
                        { name: 'areaTitle' },
                        { name: 'rev' },
                        { name: 'revBy' },
                        { name: 'createdAt' },
                        { name: 'updatedAt' },
                        { name: 'deletedAt' },
                        { name: 'purgedAt' },
                    ];
                }
                if (sql.startsWith('PRAGMA table_info(people)')) {
                    if (options.hasPeopleTable === false) return [];
                    return [
                        { name: 'id' },
                        { name: 'name' },
                        { name: 'note' },
                        { name: 'referenceLink' },
                        { name: 'rev' },
                        { name: 'revBy' },
                        { name: 'createdAt' },
                        { name: 'updatedAt' },
                        { name: 'deletedAt' },
                    ];
                }
                if (sql.includes("FROM sqlite_master")) {
                    return options.hasTasksFts ? [{ name: 'tasks_fts' }] : [];
                }
                return rows;
            },
            get: (...params: any[]) => {
                calls.push({ sql, params });
                return rows[0];
            },
            run: (...params: any[]) => {
                calls.push({ sql, params });
                return { changes: 1 };
            },
        }),
        close: () => undefined,
    };
    return { db, calls };
};

describe('mcp queries', () => {
    test('parseQuickAdd resolves project by +Title token', () => {
        const projects: ProjectRef[] = [{ id: 'p1', title: 'Home' }];
        const parsed = parseQuickAdd('Buy milk +Home @errands #weekly', projects);
        expect(parsed.title).toBe('Buy milk');
        expect(parsed.props.projectId).toBe('p1');
        expect(parsed.props.contexts).toEqual(['@errands']);
        expect(parsed.props.tags).toEqual(['#weekly']);
    });

    test('parseQuickAdd parses focus token as implied next', () => {
        const parsed = parseQuickAdd('Call plumber /*', []);
        expect(parsed.title).toBe('Call plumber');
        expect(parsed.props.status).toBe('next');
        expect(parsed.props.isFocusedToday).toBe(true);
    });

    test('listTasks escapes wildcard characters in search input', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        const tasks = listTasks(db, { search: '100%_done\\now', includeDeleted: false });
        expect(tasks).toHaveLength(1);
        const queryCall = calls.find((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM tasks '));
        expect(queryCall).toBeTruthy();
        expect(queryCall?.params[0]).toBe('%100\\%\\_done\\\\now%');
        expect(queryCall?.params[1]).toBe('%100\\%\\_done\\\\now%');
    });

    test('listTasks uses FTS search when tasks_fts is available', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb(
            [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'inbox',
                    createdAt: now,
                    updatedAt: now,
                    isFocusedToday: 0,
                },
            ],
            { hasTasksFts: true },
        );

        listTasks(db, { search: 'project alpha', includeDeleted: false });
        const queryCall = calls.find((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM tasks '));
        expect(queryCall).toBeTruthy();
        expect(queryCall?.sql.includes('tasks_fts MATCH ?')).toBe(true);
        // tasks_fts is a contentless FTS5 table (content=''), so its id column is
        // always NULL; the lookup must join on rowid or it matches nothing.
        expect(queryCall?.sql.includes('rowid IN (SELECT rowid FROM tasks_fts')).toBe(true);
        expect(queryCall?.sql.includes('id IN (SELECT id FROM tasks_fts')).toBe(false);
        expect(queryCall?.params[0]).toBe('project* alpha*');
    });

    test('listTasks compares mixed date-only and datetime due filters as dates', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                dueDate: '2026-02-01',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        listTasks(db, {
            dueDateFrom: '2026-02-01T00:00:00.000Z',
            dueDateTo: '2026-02-01T23:59:59.999Z',
            includeDeleted: false,
        });

        const queryCall = calls.find((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM tasks '));
        expect(queryCall).toBeTruthy();
        expect(queryCall?.sql).toContain('date(dueDate) >= date(?)');
        expect(queryCall?.sql).toContain('date(dueDate) <= date(?)');
    });

    test('listTasks caches task column introspection per db client', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        listTasks(db, { includeDeleted: false });
        listTasks(db, { includeDeleted: false });

        const pragmaCalls = calls.filter((call) => call.sql.startsWith('PRAGMA table_info(tasks)'));
        expect(pragmaCalls).toHaveLength(1);
    });

    test('listTasks exposes sectionId, areaId, textDirection, and location fields', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                textDirection: 'rtl',
                location: 'Office',
                projectId: 'p1',
                sectionId: 's1',
                areaId: 'a1',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        const tasks = listTasks(db, { includeDeleted: false });

        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({
            textDirection: 'rtl',
            location: 'Office',
            projectId: 'p1',
            sectionId: 's1',
            areaId: 'a1',
        });
    });

    test('maps area, section, text direction, and location fields from task rows', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db } = createMockDb([
            {
                id: 't1',
                title: 'Task',
                status: 'inbox',
                textDirection: 'rtl',
                location: 'Office',
                projectId: 'p1',
                sectionId: 's1',
                areaId: 'a1',
                createdAt: now,
                updatedAt: now,
                isFocusedToday: 0,
            },
        ]);

        const [task] = listTasks(db, { includeDeleted: false });

        expect(task.textDirection).toBe('rtl');
        expect(task.location).toBe('Office');
        expect(task.projectId).toBe('p1');
        expect(task.sectionId).toBe('s1');
        expect(task.areaId).toBe('a1');
    });

    test('listTasks and getTask preserve focusOrder from sqlite', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 't1',
                title: 'Focused task',
                status: 'next',
                isFocusedToday: 1,
                focusOrder: 4,
                createdAt: now,
                updatedAt: now,
            },
        ]);

        expect(listTasks(db, { includeDeleted: false })[0]?.focusOrder).toBe(4);
        expect(getTask(db, { id: 't1' }).focusOrder).toBe(4);

        const taskSelects = calls.filter((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM tasks'));
        expect(taskSelects).toHaveLength(2);
        expect(taskSelects.every((call) => call.sql.includes('focusOrder'))).toBe(true);
    });

    test('listProjects and getProject preserve taskSortBy from sqlite', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 'p1',
                title: 'Release',
                status: 'active',
                color: '#3B82F6',
                orderNum: 0,
                tagIds: '[]',
                isSequential: 0,
                taskSortBy: 'due',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        expect(listProjects(db)[0]?.taskSortBy).toBe('due');
        expect(getProject(db, { id: 'p1' }).taskSortBy).toBe('due');

        const projectSelects = calls.filter((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM projects'));
        expect(projectSelects).toHaveLength(2);
        expect(projectSelects.every((call) => call.sql.includes('taskSortBy'))).toBe(true);
    });

    test('listPeople maps active managed people from sqlite rows', () => {
        const now = '2026-02-01T00:00:00.000Z';
        const { db, calls } = createMockDb([
            {
                id: 'person1',
                name: 'Alex',
                note: 'Design lead',
                referenceLink: 'https://example.com/alex',
                rev: 2,
                revBy: 'device-a',
                createdAt: now,
                updatedAt: now,
            },
        ]);

        const people = listPeople(db);

        expect(people).toEqual([
            {
                id: 'person1',
                name: 'Alex',
                note: 'Design lead',
                referenceLink: 'https://example.com/alex',
                rev: 2,
                revBy: 'device-a',
                createdAt: now,
                updatedAt: now,
                deletedAt: undefined,
            },
        ]);
        const queryCall = calls.find((call) => call.sql.startsWith('SELECT') && call.sql.includes('FROM people'));
        expect(queryCall?.sql).toContain('WHERE deletedAt IS NULL');
    });

    test('getPerson reports not found when the people table is absent', () => {
        const { db } = createMockDb([], { hasPeopleTable: false });

        expect(() => getPerson(db, { id: 'person1' })).toThrow('Person not found: person1');
        expect(listPeople(db)).toEqual([]);
    });
});
