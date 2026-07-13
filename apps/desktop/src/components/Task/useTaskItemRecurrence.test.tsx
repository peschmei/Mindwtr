import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTaskDraft, type Task } from '@mindwtr/core';

import { useTaskItemRecurrence } from './useTaskItemRecurrence';

const baseTask: Task = {
    id: 'task-1',
    title: 'Monthly check',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('useTaskItemRecurrence', () => {
    it('anchors custom monthly recurrence controls to the start date when no due date is set', () => {
        const setField = vi.fn();
        const task: Task = {
            ...baseTask,
            startTime: '2026-06-04T09:00',
        };
        const { result } = renderHook(() => useTaskItemRecurrence({
            task,
            draft: {
                ...createTaskDraft(task),
                startTime: '2026-06-04T09:00',
                dueDate: '',
                recurrence: 'monthly',
                recurrenceRRule: '',
            },
            setField,
        }));

        act(() => {
            result.current.openCustomRecurrence();
        });

        expect(result.current.customMonthDay).toBe(4);
        expect(result.current.customWeekday).toBe('TH');

        act(() => {
            result.current.setCustomMode('nth');
        });
        act(() => {
            result.current.applyCustomRecurrence();
        });

        expect(setField).toHaveBeenCalledWith('recurrence', 'monthly');
        expect(setField).toHaveBeenCalledWith('recurrenceRRule', 'FREQ=MONTHLY;BYDAY=1TH');
    });
});
