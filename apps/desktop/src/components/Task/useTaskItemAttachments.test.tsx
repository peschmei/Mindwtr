import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Task } from '@mindwtr/core';
import { useTaskItemAttachments } from './useTaskItemAttachments';

const openMock = vi.fn();
const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/path', () => ({
    dataDir: vi.fn(async () => '/data'),
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { Data: 1 },
    readFile: vi.fn(),
    readTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: (...args: unknown[]) => openMock(...args),
}));

vi.mock('../../lib/runtime', () => ({
    isTauriRuntime: () => true,
}));

vi.mock('../../lib/app-log', () => ({
    logWarn: vi.fn(async () => undefined),
}));

vi.mock('../../lib/ai-config', () => ({
    loadAIKey: vi.fn(async () => ''),
}));

vi.mock('../../lib/speech-to-text', () => ({
    processAudioCapture: vi.fn(),
}));

vi.mock('../../lib/open-attachment-target', () => ({
    openAttachmentTarget: vi.fn(async () => undefined),
}));

const task = {
    id: 'task-1',
    title: 'Task',
    status: 'inbox',
    attachments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
} as unknown as Task;

const t = (key: string) => key;

describe('useTaskItemAttachments addFileAttachment', () => {
    beforeEach(() => {
        openMock.mockReset();
        invokeMock.mockReset();
    });

    it('copies the picked file into app storage and attaches the managed copy', async () => {
        openMock.mockResolvedValue('C:\\docs\\notes.txt');
        invokeMock.mockResolvedValue({ uri: '/data/mindwtr/attachments/id-1.txt', size: 1024 });

        const { result } = renderHook(() => useTaskItemAttachments({ task, t }));
        await act(async () => {
            await result.current.addFileAttachment();
        });

        expect(invokeMock).toHaveBeenCalledWith('import_attachment_file', expect.objectContaining({
            path: 'C:\\docs\\notes.txt',
            fileName: expect.stringMatching(/\.txt$/),
            maxBytes: expect.any(Number),
        }));
        expect(result.current.attachmentError).toBeNull();
        expect(result.current.editAttachments).toHaveLength(1);
        expect(result.current.editAttachments[0]).toMatchObject({
            kind: 'file',
            title: 'notes.txt',
            uri: '/data/mindwtr/attachments/id-1.txt',
            size: 1024,
            localStatus: 'available',
        });
    });

    it('rejects the file and shows an error when the picked file cannot be read', async () => {
        openMock.mockResolvedValue('R:\\notes.txt');
        invokeMock.mockRejectedValue('File does not exist or cannot be accessed.');

        const { result } = renderHook(() => useTaskItemAttachments({ task, t }));
        await act(async () => {
            await result.current.addFileAttachment();
        });

        expect(result.current.editAttachments).toHaveLength(0);
        expect(result.current.attachmentError).toBe('attachments.fileNotReadable');
    });

    it('shows the size error when the picked file exceeds the limit', async () => {
        openMock.mockResolvedValue('C:\\docs\\huge.iso');
        invokeMock.mockRejectedValue(new Error('file_too_large'));

        const { result } = renderHook(() => useTaskItemAttachments({ task, t }));
        await act(async () => {
            await result.current.addFileAttachment();
        });

        expect(result.current.editAttachments).toHaveLength(0);
        expect(result.current.attachmentError).toBe('attachments.fileTooLarge');
    });
});
