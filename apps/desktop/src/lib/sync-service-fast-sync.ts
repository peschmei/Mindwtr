import {
    buildFastSyncScope as buildCoreFastSyncScope,
    parseFastSyncState,
    serializeFastSyncState,
    type CloudProvider,
    type FastSyncState,
} from '@mindwtr/core';

import type { CloudConfig, WebDavConfig } from './sync-attachment-backends';
import type { SyncBackend } from './sync-service-utils';

export { hasPendingSyncSideEffects } from '@mindwtr/core';
export type { FastSyncState } from '@mindwtr/core';

const FAST_SYNC_STATE_KEY = 'mindwtr-fast-sync-state-v1';

type FastSyncScopeContext = {
    backend: SyncBackend;
    webdavConfig: WebDavConfig | null;
    cloudProvider: CloudProvider;
    cloudConfig: CloudConfig | null;
    dropboxAppKey: string;
};

export function readFastSyncState(scope: string): FastSyncState | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(FAST_SYNC_STATE_KEY);
        return parseFastSyncState(raw, scope);
    } catch {
        return null;
    }
}

export function writeFastSyncState(
    state: FastSyncState,
    logWarning: (message: string, error?: unknown) => void
): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(FAST_SYNC_STATE_KEY, serializeFastSyncState(state));
    } catch (error) {
        logWarning('Failed to cache sync fast-check state', error);
    }
}

export function clearFastSyncState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(FAST_SYNC_STATE_KEY);
    } catch {
        // Best-effort local cache cleanup.
    }
}

export function buildFastSyncScope(context: FastSyncScopeContext): string | null {
    return buildCoreFastSyncScope(context);
}
