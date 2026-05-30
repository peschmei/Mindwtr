import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';

import { getMonthlyRecurrenceAnchorDate } from './use-task-edit-derived-state';

const baseTask: Task = {
    id: 'task-1',
    title: 'Monthly check',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('getMonthlyRecurrenceAnchorDate', () => {
    it('uses the edited start date for start-only monthly recurrence setup', () => {
        const anchor = getMonthlyRecurrenceAnchorDate(
            {
                startTime: '2026-06-04T09:00',
            },
            baseTask,
        );

        expect(anchor.getFullYear()).toBe(2026);
        expect(anchor.getMonth()).toBe(5);
        expect(anchor.getDate()).toBe(4);
        expect(anchor.getDay()).toBe(4);
    });

    it('prefers the edited due date when both due and start dates are present', () => {
        const anchor = getMonthlyRecurrenceAnchorDate(
            {
                dueDate: '2026-06-10',
                startTime: '2026-06-04T09:00',
            },
            baseTask,
        );

        expect(anchor.getDate()).toBe(10);
    });
});
