import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTaskStore } from '@mindwtr/core';
import type { ComponentProps } from 'react';

import { LanguageProvider } from '../contexts/language-context';
import { QuickAddModal } from './QuickAddModal';
import { QUICK_ADD_MAIN_WINDOW_LABEL, QUICK_ADD_SAVED_EVENT } from '../lib/quick-add-saved-event';

const tauriMocks = vi.hoisted(() => ({
    emitTo: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    invoke: vi.fn(async () => false),
    listen: vi.fn(async () => () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
    emitTo: tauriMocks.emitTo,
    listen: tauriMocks.listen,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        hide: tauriMocks.hide,
    }),
}));

const initialTaskState = useTaskStore.getState();

const renderQuickAddModal = (props?: ComponentProps<typeof QuickAddModal>) => render(
    <LanguageProvider>
        <QuickAddModal {...props} />
    </LanguageProvider>
);

const createDeferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

beforeEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
    act(() => {
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState((state) => ({
            ...state,
            projects: [],
            areas: [],
            settings: {
                ...state.settings,
                filters: {
                    ...(state.settings?.filters ?? {}),
                    areaId: 'all',
                },
                gtd: {
                    ...(state.settings?.gtd ?? {}),
                    defaultCaptureMethod: 'text',
                },
            },
        }));
    });
});

describe('QuickAddModal', () => {
    it('ignores duplicate open requests while the first open is still committing', async () => {
        renderQuickAddModal();

        await act(async () => {
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
                detail: { initialValue: 'First capture' },
            }));
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
                detail: { initialValue: 'Second capture' },
            }));
            await Promise.resolve();
        });

        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        expect(screen.getByPlaceholderText('Add Task')).toHaveValue('First capture');
    });

    it('opens the standalone quick add window before data refresh resolves', async () => {
        const deferred = createDeferred();
        const fetchData = vi.fn(() => deferred.promise) as unknown as typeof initialTaskState.fetchData;
        act(() => {
            useTaskStore.setState((state) => ({
                ...state,
                fetchData,
            }));
        });

        renderQuickAddModal({ standaloneWindow: true });

        await act(async () => {
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
                detail: { initialValue: 'Fast capture' },
            }));
            await Promise.resolve();
        });

        expect(fetchData).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('bg-transparent');
        expect(screen.getByRole('button', { name: 'Close' })).not.toHaveClass('bg-background');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Add Task')).toHaveValue('Fast capture');

        await act(async () => {
            deferred.resolve();
            await deferred.promise;
        });
    });

    it('notifies the main window after a standalone text quick add is saved', async () => {
        (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        const addTask = vi.fn(async () => ({ success: true, id: 'task-id' }));
        const fetchData = vi.fn(async () => undefined) as unknown as typeof initialTaskState.fetchData;
        act(() => {
            useTaskStore.setState((state) => ({
                ...state,
                addTask,
                fetchData,
            }));
        });

        renderQuickAddModal({ standaloneWindow: true });

        await act(async () => {
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
                detail: { initialValue: 'Fast capture' },
            }));
            await Promise.resolve();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(tauriMocks.emitTo).toHaveBeenCalledWith(
                QUICK_ADD_MAIN_WINDOW_LABEL,
                QUICK_ADD_SAVED_EVENT,
                expect.objectContaining({ savedAt: expect.any(String) }),
            );
        });
        expect(addTask).toHaveBeenCalledWith('Fast capture', expect.objectContaining({ status: 'inbox' }));
    });

    it('creates a new quick-add project in the parsed area', async () => {
        const addProject = vi.fn(async () => ({
            id: 'project-launch',
            title: 'Launch',
            color: '#3b82f6',
            order: 0,
            status: 'active' as const,
            tagIds: [],
            createdAt: '2026-04-01T00:00:00.000Z',
            updatedAt: '2026-04-01T00:00:00.000Z',
        }));
        const addTask = vi.fn(async () => ({ success: true, id: 'task-id' }));
        act(() => {
            useTaskStore.setState((state) => ({
                ...state,
                addProject,
                addTask,
                areas: [{
                    id: 'area-work',
                    name: 'Work',
                    color: '#3b82f6',
                    order: 0,
                    createdAt: '2026-04-01T00:00:00.000Z',
                    updatedAt: '2026-04-01T00:00:00.000Z',
                }],
            }));
        });

        renderQuickAddModal();

        await act(async () => {
            window.dispatchEvent(new CustomEvent('mindwtr:quick-add', {
                detail: { initialValue: 'Plan campaign +Launch !Work' },
            }));
            await Promise.resolve();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(addProject).toHaveBeenCalledWith('Launch', expect.any(String), { areaId: 'area-work' });
        });
        expect(addTask).toHaveBeenCalledWith('Plan campaign', expect.objectContaining({
            projectId: 'project-launch',
            areaId: undefined,
        }));
    });
});
