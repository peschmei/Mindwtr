import type { Attachment, Task } from '@mindwtr/core';
import {
    areDraftAttachmentsDirty,
    createTaskDraft,
    isTaskDraftDirty,
    setTaskDraftField,
    TASK_DRAFT_FIELD_KEYS,
    taskDraftToUpdatePatch,
    type TaskDraft,
    type TaskDraftField,
} from '@mindwtr/core/task-draft';
import { areTaskFieldValuesEqual } from './task-edit-modal.helpers';

/**
 * Mobile keeps checklist and attachment buffers beside the shared TaskDraft:
 * both have their own editing lifecycle and deliberately do not live in the
 * scalar field table (ADR 0022 and attachment soft-delete semantics).
 */
export type TaskEditDraft = {
    draft: TaskDraft;
    checklist: Task['checklist'];
    attachments: Attachment[] | undefined;
};

export function createTaskEditDraft(task: Task): TaskEditDraft {
    return {
        draft: createTaskDraft(task),
        checklist: task.checklist,
        attachments: task.attachments,
    };
}

export type TaskEditUpdate = Partial<Task> | ((current: Partial<Task>) => Partial<Task>);

const replayTaskDraftField = <K extends TaskDraftField>(
    draft: TaskDraft,
    requestedDraft: TaskDraft,
    field: K,
) => setTaskDraftField(draft, field, requestedDraft[field]);

/**
 * Compatibility boundary for the existing mobile field components. They can
 * keep returning Task-shaped updates while the actual state remains one
 * TaskDraft. Every scalar field is replayed through setTaskDraftField, so its
 * cascades and no-op identity behavior are never bypassed.
 */
export function applyTaskEditUpdate(
    state: TaskEditDraft,
    task: Task,
    update: TaskEditUpdate,
): TaskEditDraft {
    const current = projectTaskEditDraft(state, task);
    const requested = typeof update === 'function' ? update(current) : update;
    const nextTask: Task = { ...task, ...current, ...requested };
    const requestedDraft = createTaskDraft(nextTask);
    const changedDraftFields = TASK_DRAFT_FIELD_KEYS.filter((field) => (
        field === 'relativeStartOffset'
            ? JSON.stringify(state.draft[field] ?? null) !== JSON.stringify(requestedDraft[field] ?? null)
            : state.draft[field] !== requestedDraft[field]
    ));
    const orderedDraftFields = changedDraftFields.includes('status')
        ? ['status' as const, ...changedDraftFields.filter((field) => field !== 'status')]
        : changedDraftFields;

    let draft = state.draft;
    // Status is the discriminator for focus and completion invariants. Apply it
    // before explicitly requested dependent values so core can accept a Done
    // completion time while still rejecting invalid values for active tasks.
    for (const field of orderedDraftFields) {
        draft = replayTaskDraftField(draft, requestedDraft, field);
    }

    const checklist = nextTask.checklist;
    const attachments = nextTask.attachments;

    if (draft === state.draft && checklist === state.checklist && attachments === state.attachments) {
        return state;
    }
    return { draft, checklist, attachments };
}

export function projectTaskEditDraft(state: TaskEditDraft, task: Task): Partial<Task> {
    const patch = taskDraftToUpdatePatch(state.draft, task, { attachments: state.attachments }) ?? {};
    return {
        ...task,
        ...patch,
        // The editing projection keeps the raw Container choices. Core applies
        // exclusivity only when serializing the saved patch; hiding an existing
        // area here would make clearing a legacy project+area pair erase data
        // the user never changed.
        projectId: state.draft.projectId || undefined,
        sectionId: state.draft.sectionId || undefined,
        areaId: state.draft.areaId || undefined,
        checklist: state.checklist,
        attachments: state.attachments,
    };
}

const areChecklistsDirty = (state: TaskEditDraft, task: Task) => (
    JSON.stringify(state.checklist ?? null) !== JSON.stringify(task.checklist ?? null)
);

export function isTaskEditDraftDirty(state: TaskEditDraft, task: Task): boolean {
    return isTaskDraftDirty(state.draft, task)
        || areChecklistsDirty(state, task)
        || areDraftAttachmentsDirty(state.attachments, task);
}

export type TaskEditDraftOverrides = {
    title?: string;
    description?: string;
    contexts?: string[];
    tags?: string[];
};

const RAW_CONTAINER_FIELDS = new Set<keyof Task>(['projectId', 'sectionId', 'areaId']);

const applyDraftOverrides = (
    state: TaskEditDraft,
    task: Task,
    overrides: TaskEditDraftOverrides,
): TaskEditDraft => {
    if (Object.keys(overrides).length === 0) return state;
    return applyTaskEditUpdate(state, task, (current) => ({ ...current, ...overrides }));
};

/** Serialize a narrow update patch while comparing against TaskDraft's own
 * normalized baseline. This prevents an unrelated edit from rewriting dates
 * merely because the draft uses datetime-local values internally. */
export function buildTaskEditUpdatePatch(
    state: TaskEditDraft,
    task: Task,
    overrides: TaskEditDraftOverrides = {},
): Partial<Task> | null {
    const finalState = applyDraftOverrides(state, task, overrides);
    const patch = taskDraftToUpdatePatch(finalState.draft, task, {
        attachments: finalState.attachments,
    });
    if (!patch) return null;

    const baseline = taskDraftToUpdatePatch(createTaskDraft(task), task, {
        attachments: task.attachments,
    }) ?? {};
    const narrowed: Partial<Task> = { ...patch };
    for (const key of Object.keys(narrowed) as (keyof Task)[]) {
        const baselineValue = RAW_CONTAINER_FIELDS.has(key) ? task[key] : baseline[key];
        if (areTaskFieldValuesEqual(narrowed[key], baselineValue)) {
            delete narrowed[key];
        }
    }
    if (areChecklistsDirty(finalState, task)) {
        narrowed.checklist = finalState.checklist;
    }
    return narrowed;
}
