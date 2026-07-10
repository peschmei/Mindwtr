import { isSelectableProjectForTaskAssignment, type Project, type Task } from '@mindwtr/core';

import { logError, logWarn } from './app-log';
import { normalizeShortcutTags } from './capture-deeplink';
import { deleteAsync, documentDirectory, getInfoAsync, readAsStringAsync, readDirectoryAsync } from './file-system';

// Background Shortcuts captures (#845): native Swift only appends JSON files
// to this directory; every task write happens here, through the normal store
// path, so revisions, save tracking, and sync merge behavior stay intact.
export const PENDING_CAPTURES_DIRECTORY = 'pending-captures';

export type PendingCapture = {
    id: string;
    title: string;
    note?: string;
    tags: string[];
    project?: string;
};

const trimOrUndefined = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};

export function parsePendingCapture(raw: string): PendingCapture | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const record = parsed as Record<string, unknown>;
    const id = trimOrUndefined(record.id);
    const title = trimOrUndefined(record.title);
    if (!id || !title) return null;

    const note = trimOrUndefined(record.note);
    const project = trimOrUndefined(record.project);
    const tagsRaw = trimOrUndefined(record.tags);
    const tags = tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter(Boolean) : [];

    return {
        id,
        title,
        ...(note ? { note } : {}),
        tags,
        ...(project ? { project } : {}),
    };
}

export function buildPendingCaptureTaskProps(capture: PendingCapture, projects: Project[]): Partial<Task> {
    const props: Partial<Task> = { status: 'inbox' };
    if (capture.note) props.description = capture.note;

    const tags = normalizeShortcutTags(capture.tags);
    if (tags.length > 0) props.tags = tags;

    // The project field is contextual (an id or a title). Background captures
    // never create projects and silently drop unknown ones — the task still
    // lands in the Inbox where processing catches it.
    if (capture.project) {
        const ref = capture.project.toLowerCase();
        const match = projects.find((project) => (
            project.id === capture.project || project.title.toLowerCase() === ref
        ));
        if (match && isSelectableProjectForTaskAssignment(match)) {
            props.projectId = match.id;
        }
    }

    return props;
}

type IngestDeps = {
    addTask: (title: string, initialProps?: Partial<Task>) => Promise<unknown>;
    projects: Project[];
};

const isFailedResult = (result: unknown): boolean => (
    typeof result === 'object' && result !== null && (result as { success?: unknown }).success === false
);

export async function ingestPendingCaptures({ addTask, projects }: IngestDeps): Promise<number> {
    if (!documentDirectory) return 0;
    const dir = `${documentDirectory}${PENDING_CAPTURES_DIRECTORY}`;

    let names: string[];
    try {
        const info = await getInfoAsync(dir);
        if (!info.exists) return 0;
        names = await readDirectoryAsync(dir);
    } catch (error) {
        void logError(error, { scope: 'shortcuts', extra: { message: 'Failed to read pending captures' } });
        return 0;
    }

    let ingested = 0;
    for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
        const fileUri = `${dir}/${name}`;
        let capture: PendingCapture | null = null;
        try {
            capture = parsePendingCapture(await readAsStringAsync(fileUri));
        } catch (error) {
            void logError(error, { scope: 'shortcuts', extra: { message: 'Failed to read pending capture', name } });
            continue;
        }

        if (!capture) {
            // Only our own Swift intent writes here, so an unparsable file is
            // corruption, not a transient failure — retrying forever would
            // re-log on every foreground.
            void logWarn('Discarding malformed pending capture', { scope: 'shortcuts', extra: { name } });
            await deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
            continue;
        }

        const result = await addTask(capture.title, buildPendingCaptureTaskProps(capture, projects));
        if (isFailedResult(result)) continue;

        // Delete only after the store write resolved; a crash in between at
        // worst re-ingests one capture.
        await deleteAsync(fileUri, { idempotent: true }).catch(() => undefined);
        ingested += 1;
    }
    return ingested;
}
