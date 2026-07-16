import { useState } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Task } from '@mindwtr/core';
import { useInboxProcessingController } from './useInboxProcessingController';

const makeTask = (id: string, status: Task['status'] = 'inbox'): Task => ({
    id,
    title: `Task ${id}`,
    status,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
} as Task);

describe('useInboxProcessingController session reconciliation', () => {
    it('advances when the current task leaves Inbox and closes when none remain', async () => {
        const setProcessingSpy = vi.fn();
        const initialTasks = [makeTask('one'), makeTask('two')];
        const { result, rerender } = renderHook(
            ({ tasks }: { tasks: Task[] }) => {
                const [isProcessing, setIsProcessingState] = useState(true);
                const setIsProcessing = (value: boolean) => {
                    setProcessingSpy(value);
                    setIsProcessingState(value);
                };
                return {
                    isProcessing,
                    controller: useInboxProcessingController({
                        t: (key) => key,
                        tasks,
                        projects: [],
                        areas: [],
                        settings: {},
                        addProject: async () => null,
                        addTask: async () => undefined,
                        updateTask: async () => undefined,
                        deleteTask: async () => undefined,
                        allContexts: [],
                        allTags: [],
                        isProcessing,
                        setIsProcessing,
                    }),
                };
            },
            { initialProps: { tasks: initialTasks } },
        );

        await waitFor(() => {
            expect(result.current.controller.wizardProps.processingTask?.id).toBe('one');
        });

        rerender({ tasks: [makeTask('one', 'next'), makeTask('two')] });

        await waitFor(() => {
            expect(result.current.controller.wizardProps.processingTask?.id).toBe('two');
        });

        rerender({ tasks: [makeTask('one', 'next'), makeTask('two', 'done')] });

        await waitFor(() => {
            expect(result.current.isProcessing).toBe(false);
        });
        expect(setProcessingSpy).toHaveBeenLastCalledWith(false);
    });
});
