import { describe, expect, it } from 'vitest';
import type { Task } from '@mindwtr/core';

import {
    areDraftAttachmentsDirty,
    createTaskDraft,
    isTaskDraftDirty,
    taskDraftToUpdatePatch,
} from './task-draft';

const baseTask: Task = {
    id: 'task-1',
    title: 'Write report',
    status: 'next',
    tags: ['#work'],
    contexts: ['@office'],
    description: 'First pass',
    projectId: 'project-1',
    sectionId: 'section-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('task-draft', () => {
    it('a fresh draft is never dirty', () => {
        expect(isTaskDraftDirty(createTaskDraft(baseTask), baseTask)).toBe(false);
    });

    it('detects a change in any field and ignores token whitespace', () => {
        const draft = createTaskDraft(baseTask);
        expect(isTaskDraftDirty({ ...draft, title: 'Write report v2' }, baseTask)).toBe(true);
        expect(isTaskDraftDirty({ ...draft, focusedToday: true }, baseTask)).toBe(true);
        expect(isTaskDraftDirty({ ...draft, contexts: ' @office ' }, baseTask)).toBe(false);
        expect(isTaskDraftDirty({ ...draft, repeatReminderMinutes: undefined }, baseTask)).toBe(false);
    });

    it('compares relative start offsets structurally', () => {
        const withOffset: Task = { ...baseTask, relativeStartOffset: { amount: 2, unit: 'day' } };
        const draft = createTaskDraft(withOffset);
        expect(isTaskDraftDirty(draft, withOffset)).toBe(false);
        expect(isTaskDraftDirty({ ...draft, relativeStartOffset: undefined }, withOffset)).toBe(true);
    });

    it('counts attachment record changes as dirty', () => {
        const withAttachment: Task = {
            ...baseTask,
            attachments: [{ id: 'a1', kind: 'link', uri: 'https://a', title: 'A', createdAt: baseTask.createdAt, updatedAt: baseTask.updatedAt }],
        };
        const same = withAttachment.attachments;
        expect(areDraftAttachmentsDirty(same, withAttachment)).toBe(false);
        expect(areDraftAttachmentsDirty([], withAttachment)).toBe(true);
        expect(areDraftAttachmentsDirty(
            [{ ...same![0], uri: 'https://b' }],
            withAttachment,
        )).toBe(true);
    });

    it('serializes container exclusivity: project home clears area, no project drops section', () => {
        const draft = createTaskDraft(baseTask);
        const withProject = taskDraftToUpdatePatch({ ...draft, areaId: 'area-9' }, baseTask);
        expect(withProject).toMatchObject({ projectId: 'project-1', sectionId: 'section-1', areaId: undefined });

        const noProject = taskDraftToUpdatePatch({ ...draft, projectId: '', areaId: 'area-9' }, baseTask);
        expect(noProject).toMatchObject({ projectId: undefined, sectionId: undefined, areaId: 'area-9' });
    });

    it('falls back to the task title and refuses an unusable one', () => {
        const draft = createTaskDraft(baseTask);
        expect(taskDraftToUpdatePatch({ ...draft, title: '   ' }, baseTask)).toMatchObject({ title: 'Write report' });

        const untitled: Task = { ...baseTask, title: '' };
        expect(taskDraftToUpdatePatch({ ...createTaskDraft(untitled), title: ' ' }, untitled)).toBeNull();
    });

    it('assembles recurrence from the rrule and preserves completed occurrences', () => {
        const recurringTask: Task = {
            ...baseTask,
            recurrence: { rule: 'weekly', strategy: 'strict', completedOccurrences: 3 } as Task['recurrence'],
        };
        const draft = createTaskDraft(recurringTask);
        const patch = taskDraftToUpdatePatch(
            { ...draft, recurrenceRRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5' },
            recurringTask,
        );
        expect(patch?.recurrence).toMatchObject({
            rule: 'weekly',
            strategy: 'strict',
            count: 5,
            completedOccurrences: 3,
            rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5',
        });
    });

    it('splits token fields and drops empties in the patch', () => {
        const draft = createTaskDraft(baseTask);
        const patch = taskDraftToUpdatePatch({ ...draft, contexts: '@office, , @home ', tags: '' }, baseTask);
        expect(patch).toMatchObject({ contexts: ['@office', '@home'], tags: [] });
    });
});
