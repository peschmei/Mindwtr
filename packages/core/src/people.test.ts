import { describe, expect, it } from 'vitest';
import {
    getPersonOptionNames,
    getPersonSuggestionNames,
    normalizePeopleForLoad,
} from './people';
import type { Person, Task } from './types';

const task = (overrides: Partial<Task>): Task => ({
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    status: overrides.status ?? 'next',
    tags: [],
    contexts: [],
    createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-01T00:00:00.000Z',
    ...overrides,
});

const person = (overrides: Partial<Person>): Person => ({
    id: overrides.id ?? 'person-1',
    name: overrides.name ?? 'Alex',
    createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-01T00:00:00.000Z',
    ...overrides,
});

describe('people helpers', () => {
    it('backfills unique people from task assignments and honors deleted-person tombstones', () => {
        const result = normalizePeopleForLoad(
            [
                person({ id: 'person-alex', name: 'Alex' }),
                person({ id: 'person-sam', name: 'Sam', deletedAt: '2026-04-02T00:00:00.000Z' }),
            ],
            [
                task({ id: 'task-1', assignedTo: 'alex' }),
                task({ id: 'task-2', assignedTo: 'Jordan' }),
                task({ id: 'task-3', assignedTo: 'Sam' }),
                task({ id: 'task-4', assignedTo: 'Casey', deletedAt: '2026-04-02T00:00:00.000Z' }),
            ],
            '2026-04-03T00:00:00.000Z',
            'device-a',
        );

        expect(result.didChange).toBe(true);
        expect(result.people.map((item) => item.name).sort()).toEqual(['Alex', 'Jordan', 'Sam']);
        const jordan = result.people.find((item) => item.name === 'Jordan');
        expect(jordan).toMatchObject({
            createdAt: '2026-04-03T00:00:00.000Z',
            updatedAt: '2026-04-03T00:00:00.000Z',
            rev: 1,
            revBy: 'device-a',
        });
    });

    it('tombstones duplicate active people by name instead of dropping synced ids', () => {
        const result = normalizePeopleForLoad(
            [
                person({
                    id: 'person-alex-original',
                    name: ' Alex ',
                    rev: 2,
                    revBy: 'device-old',
                    updatedAt: '2026-04-02T00:00:00.000Z',
                }),
                person({
                    id: 'person-alex-duplicate',
                    name: 'alex',
                    note: 'Remote note',
                    referenceLink: ' https://example.com/alex ',
                    rev: 4,
                    revBy: 'device-remote',
                    createdAt: '2026-04-02T00:00:00.000Z',
                    updatedAt: '2026-04-04T00:00:00.000Z',
                }),
            ],
            [],
            '2026-04-05T00:00:00.000Z',
            'device-local',
        );

        expect(result.didChange).toBe(true);
        expect(result.people).toHaveLength(2);
        expect(result.people.filter((item) => !item.deletedAt).map((item) => item.id)).toEqual(['person-alex-original']);
        expect(result.people.find((item) => item.id === 'person-alex-original')).toMatchObject({
            id: 'person-alex-original',
            name: 'Alex',
            note: 'Remote note',
            referenceLink: 'https://example.com/alex',
            rev: 4,
            revBy: 'device-old',
            updatedAt: '2026-04-04T00:00:00.000Z',
        });
        expect(result.people.find((item) => item.id === 'person-alex-duplicate')).toMatchObject({
            id: 'person-alex-duplicate',
            name: 'alex',
            deletedAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            rev: 5,
            revBy: 'device-local',
        });

        const stableReload = normalizePeopleForLoad(
            result.people,
            [],
            '2026-04-05T00:00:00.000Z',
            'device-local',
        );
        expect(stableReload.didChange).toBe(false);
        expect(stableReload.people).toEqual(result.people);
    });

    it('prefers managed people in options and suggestions while keeping ad hoc task names', () => {
        const people = [
            person({ id: 'person-jordan', name: 'Jordan', updatedAt: '2026-04-01T00:00:00.000Z' }),
        ];
        const tasks = [
            task({ id: 'task-1', assignedTo: 'Alex', updatedAt: '2026-04-04T00:00:00.000Z' }),
            task({ id: 'task-2', assignedTo: 'Jordan', updatedAt: '2026-04-02T00:00:00.000Z' }),
        ];

        expect(getPersonOptionNames(people, tasks)).toEqual(['Jordan', 'Alex']);
        expect(getPersonSuggestionNames(people, tasks, 'jo', 5)).toEqual(['Jordan']);
    });
});
