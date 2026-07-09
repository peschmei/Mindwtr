import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, Project } from '@mindwtr/core';

import { useProjectAttachmentActions } from './useProjectAttachmentActions';

vi.mock('../../../lib/runtime', () => ({
    isTauriRuntime: vi.fn(() => false),
}));

const baseProject: Project = {
    id: 'project-1',
    title: 'Project 1',
    status: 'active',
    color: '#94a3b8',
    order: 0,
    tagIds: [],
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useProjectAttachmentActions', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    const setup = (selectedProject: Project | undefined = baseProject) => {
        const params: Parameters<typeof useProjectAttachmentActions>[0] = {
            t: (key) => key,
            selectedProject,
            updateProject: vi.fn(),
        };

        const hook = renderHook(() => useProjectAttachmentActions(params));
        return { hook, params };
    };

    it('reports file attachments as unsupported on web runtime', async () => {
        const { hook } = setup();

        await act(async () => {
            await hook.result.current.addProjectFileAttachment();
        });

        expect(hook.result.current.attachmentError).toBe('attachments.fileNotSupported');
    });

    it('opens attachments in a browser tab on web runtime', async () => {
        const { hook } = setup();
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        const attachment: Attachment = {
            id: 'attachment-1',
            kind: 'file',
            title: 'Notes',
            uri: '/tmp/notes.txt',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        await act(async () => {
            await hook.result.current.openAttachment(attachment);
        });

        expect(openSpy).toHaveBeenCalledWith('file:///tmp/notes.txt', '_blank');
    });
});
