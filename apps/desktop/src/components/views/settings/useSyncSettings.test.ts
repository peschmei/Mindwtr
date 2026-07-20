import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../lib/app-log', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../lib/app-log')>();
    return {
        ...actual,
        logError: vi.fn(),
    };
});

vi.mock('../../../lib/settings-open-diagnostics', () => ({
    markSettingsOpenTrace: vi.fn(),
    measureSettingsOpenStep: vi.fn(async (_step: string, fn: () => unknown) => fn()),
}));

vi.mock('../../../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));

import { SyncService } from '../../../lib/sync-service';
import { useUiStore } from '../../../store/ui-store';
import { useSyncSettings } from './useSyncSettings';

const initialUiState = useUiStore.getState();

describe('useSyncSettings cloud token validation', () => {
    beforeEach(() => {
        act(() => {
            useUiStore.setState(initialUiState, true);
        });
        vi.spyOn(SyncService, 'getSyncPath').mockResolvedValue('');
        vi.spyOn(SyncService, 'getSyncBackend').mockResolvedValue('off');
        vi.spyOn(SyncService, 'getWebDavConfig').mockResolvedValue({
            url: '',
            username: '',
            password: '',
            hasPassword: false,
            allowInsecureHttp: false,
        });
        vi.spyOn(SyncService, 'getCloudConfig').mockResolvedValue({
            url: '',
            token: '',
            rememberToken: false,
            allowInsecureHttp: false,
        });
        vi.spyOn(SyncService, 'getCloudProvider').mockResolvedValue('selfhosted');
        vi.spyOn(SyncService, 'getDropboxAppKey').mockResolvedValue('');
        vi.spyOn(SyncService, 'getDropboxRedirectUri').mockResolvedValue('http://127.0.0.1:53682/oauth/dropbox/callback');
        vi.spyOn(SyncService, 'listDataSnapshots').mockResolvedValue([]);
        vi.spyOn(SyncService, 'subscribeSyncStatus').mockImplementation(() => () => {});
        vi.spyOn(SyncService, 'setCloudConfig').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const setup = () => renderHook(() => useSyncSettings({
        appVersion: '1.0.0',
        isTauri: false,
        showSaved: vi.fn(),
        selectSyncFolderTitle: 'Select folder',
        requestConfirmation: vi.fn().mockResolvedValue(true),
    }));

    it('rejects a short cloud token and does not save', async () => {
        const { result } = setup();
        await waitFor(() => expect(SyncService.getCloudConfig).toHaveBeenCalled());

        act(() => {
            result.current.setCloudUrl('https://example.com');
            result.current.setCloudToken('short-token');
        });

        await act(async () => {
            await result.current.handleSaveCloud();
        });

        expect(SyncService.setCloudConfig).not.toHaveBeenCalled();
        expect(result.current.syncError).toBe(
            'Sync token must be 20-512 characters using letters, numbers, or . _ ~ + / = -'
        );
    });

    it('treats an empty token as "unchanged, use keyring" and saves', async () => {
        const { result } = setup();
        await waitFor(() => expect(SyncService.getCloudConfig).toHaveBeenCalled());

        act(() => {
            result.current.setCloudUrl('https://example.com');
            result.current.setCloudToken('');
        });

        await act(async () => {
            await result.current.handleSaveCloud();
        });

        expect(SyncService.setCloudConfig).toHaveBeenCalledWith(
            expect.objectContaining({ token: '' })
        );
    });

    it('saves a valid cloud token', async () => {
        const { result } = setup();
        await waitFor(() => expect(SyncService.getCloudConfig).toHaveBeenCalled());

        const validToken = 'a'.repeat(24);
        act(() => {
            result.current.setCloudUrl('https://example.com');
            result.current.setCloudToken(validToken);
        });

        await act(async () => {
            await result.current.handleSaveCloud();
        });

        expect(SyncService.setCloudConfig).toHaveBeenCalledWith(
            expect.objectContaining({ token: validToken })
        );
    });
});
