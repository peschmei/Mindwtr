import type { Task } from './types';

export type ProcessInboxWorkflowFields = Partial<Pick<
    Task,
    | 'projectId'
    | 'areaId'
    | 'contexts'
    | 'tags'
    | 'priority'
    | 'energyLevel'
    | 'assignedTo'
    | 'timeEstimate'
    | 'startTime'
    | 'dueDate'
    | 'reviewAt'
>>;

type ProcessInboxReferenceFields = Partial<Pick<Task, 'contexts' | 'tags'>>;

/**
 * Domain decisions emitted by an Inbox-processing UI.
 *
 * Platforms remain responsible for collecting and validating UI input. This
 * event boundary owns the status/effect mapping so every client commits the
 * same GTD decision once input is ready.
 */
export type ProcessInboxWorkflowEvent =
    | { type: 'discard' }
    | { type: 'someday' }
    | { type: 'reference'; fields?: ProcessInboxReferenceFields }
    | { type: 'complete' }
    | { type: 'later'; fields: ProcessInboxWorkflowFields }
    | { type: 'waiting'; fields: ProcessInboxWorkflowFields; followUpAt?: string }
    | { type: 'next'; fields: ProcessInboxWorkflowFields };

export type ProcessInboxWorkflowEffect =
    | { type: 'delete' }
    | { type: 'update'; updates: Partial<Task> };

function normalizeFields(fields: ProcessInboxWorkflowFields): ProcessInboxWorkflowFields {
    if (!Object.prototype.hasOwnProperty.call(fields, 'assignedTo')) return fields;
    const assignedTo = fields.assignedTo?.trim() || undefined;
    return assignedTo === fields.assignedTo ? fields : { ...fields, assignedTo };
}

function updateEffect(
    status: Task['status'],
    fields: ProcessInboxWorkflowFields = {},
): ProcessInboxWorkflowEffect {
    return {
        type: 'update',
        updates: { status, ...normalizeFields(fields) },
    };
}

export function resolveProcessInboxWorkflowEvent(
    event: ProcessInboxWorkflowEvent,
): ProcessInboxWorkflowEffect {
    switch (event.type) {
        case 'discard':
            return { type: 'delete' };
        case 'someday':
            return updateEffect('someday');
        case 'reference':
            return updateEffect('reference', event.fields);
        case 'complete':
            return updateEffect('done');
        case 'later':
        case 'next':
            return updateEffect('next', event.fields);
        case 'waiting': {
            const fields = event.followUpAt === undefined
                ? event.fields
                : { ...event.fields, reviewAt: event.followUpAt };
            return updateEffect('waiting', fields);
        }
    }
}
