import { describe, expect, it, vi } from 'vitest';
import type { AppData } from '@mindwtr/core';

import { syncCloudAttachments, syncCloudKitAttachments, type AttachmentBackendDeps } from './sync-attachment-backends';

const fsMocks = vi.hoisted(() => ({
    BaseDirectory: { Data: 'Data' },
    exists: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    writeFile: vi.fn(),
}));

const pathMocks = vi.hoisted(() => ({
    dataDir: vi.fn(),
    join: vi.fn(),
}));

const cloudKitMocks = vi.hoisted(() => ({
    deleteCloudKitAttachmentAssets: vi.fn(),
    fetchCloudKitAttachmentAsset: vi.fn(),
    saveCloudKitAttachmentAsset: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);
vi.mock('@tauri-apps/api/path', () => pathMocks);
vi.mock('./cloudkit-sync', () => cloudKitMocks);

const errorResponse = (status: number, statusText: string): Response =>
    ({
        ok: false,
        status,
        statusText,
        headers: new Headers(),
        body: null,
        arrayBuffer: async () => new ArrayBuffer(0),
    }) as Response;

describe('desktop sync attachment backends', () => {
    it('marks cloud attachments unrecoverable when the remote file is missing', async () => {
        const fetcher = vi.fn(async () => errorResponse(404, 'Not Found'));
        const logSyncWarning = vi.fn();
        const appData: AppData = {
            tasks: [
                {
                    id: 'task-1',
                    title: 'Task',
                    status: 'next',
                    tags: [],
                    contexts: [],
                    attachments: [
                        {
                            id: 'attachment-1',
                            kind: 'file',
                            title: 'PXL_20260604_232051859.jpg',
                            uri: '',
                            cloudKey: 'attachments/attachment-1.jpg',
                            localStatus: 'missing',
                            fileHash: 'a'.repeat(64),
                            createdAt: '2026-06-07T00:00:00.000Z',
                            updatedAt: '2026-06-07T00:00:00.000Z',
                        },
                    ],
                    createdAt: '2026-06-07T00:00:00.000Z',
                    updatedAt: '2026-06-07T00:00:00.000Z',
                },
            ],
            projects: [],
            sections: [],
            areas: [],
            settings: {},
        };
        const deps: AttachmentBackendDeps = {
            getTauriFetch: async () => fetcher as unknown as typeof fetch,
            isTauriRuntimeEnv: () => true,
            logSyncInfo: vi.fn(),
            logSyncWarning,
            resolveWebdavPassword: vi.fn(),
        };

        pathMocks.dataDir.mockResolvedValue('/app-data');
        pathMocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
        fsMocks.mkdir.mockResolvedValue(undefined);

        await expect(
            syncCloudAttachments(
                appData,
                { url: 'https://cloud.example/v1/data', token: 'token' },
                'https://cloud.example/v1',
                deps,
            ),
        ).resolves.toBe(true);

        const attachment = appData.tasks[0].attachments?.[0];
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(attachment?.cloudKey).toBeUndefined();
        expect(attachment?.fileHash).toBeUndefined();
        expect(attachment?.localStatus).toBe('missing');
        expect(attachment?.deletedAt).toBeDefined();
        expect(logSyncWarning).not.toHaveBeenCalledWith(
            expect.stringContaining('Failed to download attachment'),
            expect.anything(),
        );
    });

    it('uploads local attachments to CloudKit and flushes CloudKit pending deletes', async () => {
        vi.clearAllMocks();
        const bytes = new Uint8Array([1, 2, 3]);
        const logSyncWarning = vi.fn();
        const appData: AppData = {
            tasks: [
                {
                    id: 'task-1',
                    title: 'Task',
                    status: 'next',
                    tags: [],
                    contexts: [],
                    attachments: [
                        {
                            id: 'attachment-1',
                            kind: 'file',
                            title: 'photo.jpg',
                            uri: '/app-data/mindwtr/attachments/photo.jpg',
                            localStatus: 'available',
                            createdAt: '2026-06-07T00:00:00.000Z',
                            updatedAt: '2026-06-07T00:00:00.000Z',
                        },
                    ],
                    createdAt: '2026-06-07T00:00:00.000Z',
                    updatedAt: '2026-06-07T00:00:00.000Z',
                },
            ],
            projects: [],
            sections: [],
            areas: [],
            settings: {
                attachments: {
                    pendingRemoteDeletes: [
                        { cloudKey: 'cloudkit:old-attachment' },
                        { cloudKey: 'attachments/legacy-file.jpg' },
                    ],
                },
            },
        };
        const deps: AttachmentBackendDeps = {
            getTauriFetch: vi.fn(),
            isTauriRuntimeEnv: () => true,
            logSyncInfo: vi.fn(),
            logSyncWarning,
            resolveWebdavPassword: vi.fn(),
        };

        pathMocks.dataDir.mockResolvedValue('/app-data');
        pathMocks.join.mockImplementation(async (...parts: string[]) => parts.join('/'));
        fsMocks.mkdir.mockResolvedValue(undefined);
        fsMocks.exists.mockResolvedValue(true);
        fsMocks.readFile.mockResolvedValue(bytes);
        cloudKitMocks.deleteCloudKitAttachmentAssets.mockResolvedValue(undefined);
        cloudKitMocks.saveCloudKitAttachmentAsset.mockResolvedValue({
            recordName: 'attachment-1',
            attachmentId: 'attachment-1',
            ownerType: 'task',
            ownerId: 'task-1',
            title: 'photo.jpg',
            size: 3,
            updatedAt: '2026-06-07T00:00:00.000Z',
        });

        await expect(syncCloudKitAttachments(appData, deps)).resolves.toBe(true);

        const attachment = appData.tasks[0].attachments?.[0];
        expect(cloudKitMocks.deleteCloudKitAttachmentAssets).toHaveBeenCalledWith(['old-attachment']);
        expect(cloudKitMocks.saveCloudKitAttachmentAsset).toHaveBeenCalledWith(
            'attachment-1',
            '/app-data/mindwtr/attachments/photo.jpg',
            expect.objectContaining({
                attachmentId: 'attachment-1',
                ownerType: 'task',
                ownerId: 'task-1',
                title: 'photo.jpg',
                size: 3,
            }),
        );
        expect(attachment?.cloudKey).toBe('cloudkit:attachment-1');
        expect(attachment?.localStatus).toBe('available');
        expect(attachment?.size).toBe(3);
        expect(appData.settings.attachments?.pendingRemoteDeletes).toEqual([
            { cloudKey: 'attachments/legacy-file.jpg' },
        ]);
        expect(logSyncWarning).not.toHaveBeenCalled();
    });
});
