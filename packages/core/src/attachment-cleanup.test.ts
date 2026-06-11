import { describe, expect, it } from 'vitest';
import {
    applyAttachmentCleanupResult,
    findDeletedAttachmentsForFileCleanup,
    findOrphanedAttachments,
    removeAttachmentsByIdFromData,
    removeOrphanedAttachmentsFromData,
} from './attachment-cleanup';
import type { AppData } from './types';

const buildData = (): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    settings: {},
});

describe('findOrphanedAttachments', () => {
    it('treats deleted attachments on active tasks as orphaned cleanup candidates', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((attachment) => attachment.id)).toEqual(['a1']);
    });

    it('detects attachments on deleted tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned.map((a) => a.id)).toEqual(['a1']);
    });

    it('keeps attachments referenced by active tasks', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        expect(orphaned).toHaveLength(0);
    });
});

describe('findDeletedAttachmentsForFileCleanup', () => {
    it('finds deleted attachments on active tasks and projects', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'inbox',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'audio',
                    uri: '',
                    cloudKey: 'attachments/a1.m4a',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });
        data.projects.push({
            id: 'p1',
            title: 'Project',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a2',
                    kind: 'file',
                    title: 'doc',
                    uri: '/tmp/doc',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    });

    it('returns deleted attachments even when parents are deleted', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: new Date().toISOString(),
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                },
            ],
        });

        const deleted = findDeletedAttachmentsForFileCleanup(data);
        expect(deleted.map((a) => a.id)).toEqual(['a1']);
    });
});

describe('removeOrphanedAttachmentsFromData', () => {
    it('removes orphaned attachments from tasks and projects', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'done',
                    contexts: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a1',
                            kind: 'file',
                            title: 'file',
                            uri: '/tmp/file',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            projects: [
                {
                    id: 'p1',
                    title: 'Project',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    deletedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'a2',
                            kind: 'file',
                            title: 'file2',
                            uri: '/tmp/file2',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            deletedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const cleaned = removeOrphanedAttachmentsFromData(data);
        expect(cleaned.tasks[0].attachments).toHaveLength(0);
        expect(cleaned.projects[0].attachments).toHaveLength(0);
    });
});

describe('removeAttachmentsByIdFromData', () => {
    it('removes only requested attachments', () => {
        const data: AppData = {
            tasks: [
                {
                    id: 't1',
                    title: 'Task',
                    status: 'inbox',
                    contexts: [],
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'keep-task',
                            kind: 'file',
                            title: 'keep-task',
                            uri: '/tmp/keep-task',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                        {
                            id: 'drop-task',
                            kind: 'file',
                            title: 'drop-task',
                            uri: '/tmp/drop-task',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            projects: [
                {
                    id: 'p1',
                    title: 'Project',
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    attachments: [
                        {
                            id: 'drop-project',
                            kind: 'file',
                            title: 'drop-project',
                            uri: '/tmp/drop-project',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        },
                    ],
                },
            ],
            sections: [],
            areas: [],
            settings: {},
        };

        const cleaned = removeAttachmentsByIdFromData(data, ['drop-task', 'drop-project']);
        expect(cleaned.tasks[0].attachments?.map((attachment) => attachment.id)).toEqual(['keep-task']);
        expect(cleaned.projects[0].attachments ?? []).toHaveLength(0);
    });
});

describe('applyAttachmentCleanupResult', () => {
    it('stores cleanup metadata and removes all orphaned attachments when not batch-limited', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'a1',
                    kind: 'file',
                    title: 'file',
                    uri: '/tmp/file',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const orphaned = findOrphanedAttachments(data);
        const cleaned = applyAttachmentCleanupResult(data, {
            lastCleanupAt: '2026-01-02T00:00:00.000Z',
            orphanedAttachments: orphaned,
            pendingRemoteDeletes: [{ cloudKey: 'attachments/missing.txt', attempts: 1 }],
        });

        expect(cleaned.tasks[0].attachments).toEqual([]);
        expect(cleaned.settings.attachments?.lastCleanupAt).toBe('2026-01-02T00:00:00.000Z');
        expect(cleaned.settings.attachments?.pendingRemoteDeletes).toEqual([
            { cloudKey: 'attachments/missing.txt', attempts: 1 },
        ]);
    });

    it('removes only processed orphaned attachments when batch-limited', () => {
        const data = buildData();
        data.tasks.push({
            id: 't1',
            title: 'Task',
            status: 'done',
            contexts: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: '2026-01-01T00:00:00.000Z',
            attachments: [
                {
                    id: 'processed',
                    kind: 'file',
                    title: 'processed',
                    uri: '/tmp/processed',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
                {
                    id: 'deferred',
                    kind: 'file',
                    title: 'deferred',
                    uri: '/tmp/deferred',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });

        const cleaned = applyAttachmentCleanupResult(data, {
            lastCleanupAt: '2026-01-02T00:00:00.000Z',
            orphanedAttachments: findOrphanedAttachments(data),
            processedOrphanedIds: ['processed'],
            reachedBatchLimit: true,
        });

        expect(cleaned.tasks[0].attachments?.map((attachment) => attachment.id)).toEqual(['deferred']);
        expect(cleaned.settings.attachments?.pendingRemoteDeletes).toBeUndefined();
    });
});
