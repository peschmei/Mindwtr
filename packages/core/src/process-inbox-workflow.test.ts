import { describe, expect, it } from 'vitest';

import { resolveProcessInboxWorkflowEvent } from './process-inbox-workflow';

describe('resolveProcessInboxWorkflowEvent', () => {
    it('turns discard into a delete effect', () => {
        expect(resolveProcessInboxWorkflowEvent({ type: 'discard' })).toEqual({ type: 'delete' });
    });

    it.each([
        ['someday', 'someday'],
        ['reference', 'reference'],
        ['complete', 'done'],
    ] as const)('maps %s to the matching terminal status', (type, status) => {
        expect(resolveProcessInboxWorkflowEvent({ type })).toEqual({
            type: 'update',
            updates: { status },
        });
    });

    it('preserves the fields supplied by a platform for a next action', () => {
        expect(resolveProcessInboxWorkflowEvent({
            type: 'next',
            fields: {
                projectId: 'project-1',
                areaId: undefined,
                contexts: ['@office'],
                startTime: '2026-07-15',
            },
        })).toEqual({
            type: 'update',
            updates: {
                status: 'next',
                projectId: 'project-1',
                areaId: undefined,
                contexts: ['@office'],
                startTime: '2026-07-15',
            },
        });
    });

    it('uses next status for Later while retaining an explicit cleared date', () => {
        expect(resolveProcessInboxWorkflowEvent({
            type: 'later',
            fields: { startTime: undefined },
        })).toEqual({
            type: 'update',
            updates: { status: 'next', startTime: undefined },
        });
    });

    it('normalizes the assignee and lets delegate follow-up override review', () => {
        expect(resolveProcessInboxWorkflowEvent({
            type: 'waiting',
            fields: {
                assignedTo: '  Alice  ',
                reviewAt: '2026-07-16',
                dueDate: '2026-07-15',
            },
            followUpAt: '2026-07-20',
        })).toEqual({
            type: 'update',
            updates: {
                status: 'waiting',
                assignedTo: 'Alice',
                reviewAt: '2026-07-20',
                dueDate: '2026-07-15',
            },
        });
    });

    it('keeps an empty assignee as an explicit clear', () => {
        expect(resolveProcessInboxWorkflowEvent({
            type: 'waiting',
            fields: { assignedTo: '   ' },
        })).toEqual({
            type: 'update',
            updates: { status: 'waiting', assignedTo: undefined },
        });
    });
});
