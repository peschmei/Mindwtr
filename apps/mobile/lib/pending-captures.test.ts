import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project } from '@mindwtr/core';

const fileSystemMocks = vi.hoisted(() => ({
    documentDirectory: 'file:///data/Documents/',
    getInfoAsync: vi.fn(),
    readDirectoryAsync: vi.fn(),
    readAsStringAsync: vi.fn(),
    deleteAsync: vi.fn(),
}));

vi.mock('./file-system', () => fileSystemMocks);
vi.mock('./app-log', () => ({
    logError: vi.fn(async () => undefined),
    logWarn: vi.fn(async () => undefined),
}));

import { buildPendingCaptureTaskProps, ingestPendingCaptures, parsePendingCapture } from './pending-captures';

const project = (props: Partial<Project>): Project => ({
    id: 'p1',
    title: 'Errands',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...props,
} as Project);

describe('parsePendingCapture', () => {
    it('parses a full payload and splits tags', () => {
        expect(parsePendingCapture(JSON.stringify({
            id: 'abc',
            title: 'Take out the trash',
            note: 'Bins to the curb',
            tags: 'home, chores',
            project: 'Errands',
        }))).toEqual({
            id: 'abc',
            title: 'Take out the trash',
            note: 'Bins to the curb',
            tags: ['home', 'chores'],
            project: 'Errands',
        });
    });

    it('rejects payloads without id or title', () => {
        expect(parsePendingCapture(JSON.stringify({ title: 'No id' }))).toBeNull();
        expect(parsePendingCapture(JSON.stringify({ id: 'x', title: '   ' }))).toBeNull();
        expect(parsePendingCapture('not json')).toBeNull();
        expect(parsePendingCapture('[]')).toBeNull();
    });
});

describe('buildPendingCaptureTaskProps', () => {
    it('lands in inbox with normalized tags', () => {
        const props = buildPendingCaptureTaskProps(
            { id: 'a', title: 'T', note: 'N', tags: ['home', '#home', 'chores'] },
            [],
        );
        expect(props.status).toBe('inbox');
        expect(props.description).toBe('N');
        expect(props.tags).toEqual(['#home', '#chores']);
    });

    it('resolves selectable projects by id or title and drops unknown or archived ones', () => {
        const active = project({ id: 'p1', title: 'Errands' });
        const archived = project({ id: 'p2', title: 'Old', status: 'archived' as Project['status'] });

        expect(buildPendingCaptureTaskProps({ id: 'a', title: 'T', tags: [], project: 'errands' }, [active]).projectId).toBe('p1');
        expect(buildPendingCaptureTaskProps({ id: 'a', title: 'T', tags: [], project: 'p1' }, [active]).projectId).toBe('p1');
        expect(buildPendingCaptureTaskProps({ id: 'a', title: 'T', tags: [], project: 'Old' }, [archived]).projectId).toBeUndefined();
        expect(buildPendingCaptureTaskProps({ id: 'a', title: 'T', tags: [], project: 'Nope' }, [active]).projectId).toBeUndefined();
    });
});

describe('ingestPendingCaptures', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fileSystemMocks.getInfoAsync.mockResolvedValue({ exists: true });
        fileSystemMocks.deleteAsync.mockResolvedValue(undefined);
    });

    it('creates a task per queue file and deletes each file after the write resolves', async () => {
        fileSystemMocks.readDirectoryAsync.mockResolvedValue(['b.json', 'a.json', 'ignore.txt']);
        fileSystemMocks.readAsStringAsync.mockImplementation(async (uri: string) => JSON.stringify({
            id: uri.includes('a.json') ? 'a' : 'b',
            title: uri.includes('a.json') ? 'First' : 'Second',
            tags: 'home',
        }));
        const addTask = vi.fn(async () => ({ id: 'task-1' }));

        const ingested = await ingestPendingCaptures({ addTask, projects: [] });

        expect(ingested).toBe(2);
        expect(addTask).toHaveBeenNthCalledWith(1, 'First', { status: 'inbox', tags: ['#home'] });
        expect(addTask).toHaveBeenNthCalledWith(2, 'Second', { status: 'inbox', tags: ['#home'] });
        expect(fileSystemMocks.deleteAsync).toHaveBeenCalledTimes(2);
    });

    it('keeps the file when the store write reports failure', async () => {
        fileSystemMocks.readDirectoryAsync.mockResolvedValue(['a.json']);
        fileSystemMocks.readAsStringAsync.mockResolvedValue(JSON.stringify({ id: 'a', title: 'Keep me' }));
        const addTask = vi.fn(async () => ({ success: false }));

        const ingested = await ingestPendingCaptures({ addTask, projects: [] });

        expect(ingested).toBe(0);
        expect(fileSystemMocks.deleteAsync).not.toHaveBeenCalled();
    });

    it('discards malformed files without creating tasks', async () => {
        fileSystemMocks.readDirectoryAsync.mockResolvedValue(['bad.json']);
        fileSystemMocks.readAsStringAsync.mockResolvedValue('{broken');
        const addTask = vi.fn();

        const ingested = await ingestPendingCaptures({ addTask, projects: [] });

        expect(ingested).toBe(0);
        expect(addTask).not.toHaveBeenCalled();
        expect(fileSystemMocks.deleteAsync).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the queue directory does not exist', async () => {
        fileSystemMocks.getInfoAsync.mockResolvedValue({ exists: false });
        const addTask = vi.fn();

        expect(await ingestPendingCaptures({ addTask, projects: [] })).toBe(0);
        expect(fileSystemMocks.readDirectoryAsync).not.toHaveBeenCalled();
        expect(addTask).not.toHaveBeenCalled();
    });
});
