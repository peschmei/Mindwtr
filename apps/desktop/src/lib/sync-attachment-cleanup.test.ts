import { describe, expect, it, vi } from 'vitest';
import { LocalSyncAbort, type AppData } from '@mindwtr/core';

import {
    cleanupOrphanedAttachments,
    type AttachmentCleanupDeps,
} from './sync-attachment-cleanup';

const fsMocks = vi.hoisted(() => ({
    readDir: vi.fn(),
    remove: vi.fn(),
}));

const pathMocks = vi.hoisted(() => ({
    join: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => fsMocks);
vi.mock('@tauri-apps/api/path', () => pathMocks);

const buildData = (): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    people: [],
    settings: {
        attachments: {
            pendingRemoteDeletes: [{
                cloudKey: 'attachments/orphan.pdf',
                title: 'orphan.pdf',
            }],
        },
    },
});

const buildDeps = (): AttachmentCleanupDeps => ({
    getCloudConfig: vi.fn(async () => ({ url: '', token: '' })),
    getCloudProvider: vi.fn(async () => 'selfhosted' as const),
    getDropboxAccessToken: vi.fn(async () => ''),
    getDropboxAppKey: vi.fn(async () => ''),
    getSyncPath: vi.fn(async () => '/sync/data.json'),
    getTauriFetch: vi.fn(async () => undefined),
    getWebDavConfig: vi.fn(async () => ({ url: '', username: '' })),
    isTauriRuntimeEnv: vi.fn(() => true),
    logSyncInfo: vi.fn(),
    logSyncWarning: vi.fn(),
    resolveWebdavPassword: vi.fn(async () => ''),
});

describe('desktop attachment cleanup freshness', () => {
    it('aborts after resolving a file target when a local edit makes the snapshot stale', async () => {
        let stale = false;
        pathMocks.join.mockImplementation(async (...parts: string[]) => {
            stale = true;
            return parts.join('/');
        });
        const ensureLocalSnapshotFresh = vi.fn(() => {
            if (stale) throw new LocalSyncAbort();
        });

        await expect(cleanupOrphanedAttachments(
            buildData(),
            'file',
            buildDeps(),
            { ensureLocalSnapshotFresh },
        )).rejects.toBeInstanceOf(LocalSyncAbort);

        expect(pathMocks.join).toHaveBeenCalled();
        expect(ensureLocalSnapshotFresh).toHaveBeenCalledTimes(2);
        expect(fsMocks.remove).not.toHaveBeenCalled();
    });
});
