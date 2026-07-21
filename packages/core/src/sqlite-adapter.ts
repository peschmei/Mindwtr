import type { AppData, Area, Attachment, Person, Project, SavedFilter, Task, Section } from './types';

export type CalendarSyncEntry = {
    taskId: string;
    calendarEventId: string;
    calendarId: string;
    platform: string;
    lastSyncedAt: string;
};
import { SEARCH_RESULT_LIMIT, type SearchProjectResult, type SearchResults, type SearchTaskResult, type TaskQueryOptions } from './storage';
import { SQLITE_BASE_SCHEMA, SQLITE_FTS_SCHEMA, SQLITE_INDEX_SCHEMA } from './sqlite-schema';
import { normalizeTaskStatus } from './task-status';
import { normalizeRecurrenceForLoad } from './recurrence';
import { normalizeRelativeStartOffset } from './task-relative-start';
import { logWarn } from './logger';
import { normalizeSavedFilter, normalizeSavedFilters } from './saved-filters';
import { normalizeProjectSequentialScope, normalizeProjectTaskSortBy } from './project-utils';
import { sleep } from './async-utils';
import { TASK_SQLITE_COLUMNS, TASK_SQLITE_MIGRATION_COLUMNS } from './task-sync-schema';
import { PROJECT_SQLITE_COLUMNS, PROJECT_SQLITE_MIGRATION_COLUMNS } from './project-sync-schema';
import { SECTION_SQLITE_COLUMNS, SECTION_SQLITE_MIGRATION_COLUMNS } from './section-sync-schema';

export interface SqliteClient {
    run(sql: string, params?: unknown[]): Promise<void>;
    all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
    exec?(sql: string): Promise<void>;
}

const SQL_WORD_CHAR = /[A-Za-z0-9_]/;

// Splits a multi-statement SQL script for engines whose execute() prepares a
// single statement at a time (op-sqlite). A naive split on ';' breaks
// CREATE TRIGGER bodies apart ("incomplete input"), so track quoted strings,
// comments, and BEGIN/CASE...END blocks and only split at top-level ';'.
export const splitSqlStatements = (sql: string): string[] => {
    const statements: string[] = [];
    let current = '';
    let blockDepth = 0;
    let i = 0;
    while (i < sql.length) {
        const ch = sql[i];
        const next = sql[i + 1];
        if (ch === "'" || ch === '"') {
            let j = i + 1;
            while (j < sql.length) {
                if (sql[j] === ch) {
                    if (sql[j + 1] === ch) {
                        j += 2;
                        continue;
                    }
                    j += 1;
                    break;
                }
                j += 1;
            }
            current += sql.slice(i, j);
            i = j;
            continue;
        }
        if (ch === '-' && next === '-') {
            let j = sql.indexOf('\n', i);
            if (j === -1) j = sql.length;
            current += sql.slice(i, j);
            i = j;
            continue;
        }
        if (ch === '/' && next === '*') {
            let j = sql.indexOf('*/', i + 2);
            j = j === -1 ? sql.length : j + 2;
            current += sql.slice(i, j);
            i = j;
            continue;
        }
        if (SQL_WORD_CHAR.test(ch)) {
            let j = i + 1;
            while (j < sql.length && SQL_WORD_CHAR.test(sql[j])) j += 1;
            const word = sql.slice(i, j).toUpperCase();
            // A statement-leading BEGIN is transaction control and terminates at
            // its own ';'. Mid-statement BEGIN (trigger body) opens a block.
            if (word === 'CASE' || (word === 'BEGIN' && current.trim() !== '')) {
                blockDepth += 1;
            } else if (word === 'END') {
                blockDepth = Math.max(0, blockDepth - 1);
            }
            current += sql.slice(i, j);
            i = j;
            continue;
        }
        if (ch === ';' && blockDepth === 0) {
            const statement = current.trim();
            if (statement) statements.push(statement);
            current = '';
            blockDepth = 0;
            i += 1;
            continue;
        }
        current += ch;
        i += 1;
    }
    const tail = current.trim();
    if (tail) statements.push(tail);
    return statements;
};

const toJson = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
const fromJson = <T>(value: unknown, fallback: T): T => {
    if (value === null || value === undefined || value === '') return fallback;
    try {
        const parsed = JSON.parse(String(value));
        if (fallback === undefined) {
            return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
        }
        if (Array.isArray(fallback)) {
            return Array.isArray(parsed) ? (parsed as T) : fallback;
        }
        if (typeof fallback === 'object' && fallback !== null) {
            return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
        }
        return parsed as T;
    } catch (error) {
        logWarn('Failed to parse JSON value, falling back to defaults', {
            scope: 'sqlite',
            category: 'storage',
            error,
        });
        return fallback;
    }
};

const toBool = (value?: boolean) => (value ? 1 : 0);
const fromBool = (value: unknown) => Boolean(value);
const toNullableBool = (value?: boolean | null) => value === null || value === undefined ? null : toBool(value);
const fromNullableBool = (value: unknown): boolean | null | undefined => {
    if (value === null) return null;
    if (value === undefined) return undefined;
    return Boolean(value);
};

type SqliteReferenceIssue = {
    kind: string;
    id: string;
    missingId: string;
};

const optionalId = (value: unknown): string | undefined => (
    typeof value === 'string' && value.trim().length > 0 ? value : undefined
);

const collectSqliteReferenceIssues = (data: AppData): SqliteReferenceIssue[] => {
    const areaIds = new Set(data.areas.map((area) => area.id));
    const projectIds = new Set(data.projects.map((project) => project.id));
    const sectionIds = new Set(data.sections.map((section) => section.id));
    const issues: SqliteReferenceIssue[] = [];
    const addIssue = (kind: string, id: string, missingId: string) => {
        issues.push({ kind, id, missingId });
    };

    data.projects.forEach((project) => {
        const areaId = optionalId(project.areaId);
        if (areaId && !areaIds.has(areaId)) {
            addIssue('project.areaId', project.id, areaId);
        }
    });
    data.sections.forEach((section) => {
        const projectId = optionalId(section.projectId);
        if (projectId && !projectIds.has(projectId)) {
            addIssue('section.projectId', section.id, projectId);
        }
    });
    data.tasks.forEach((task) => {
        const projectId = optionalId(task.projectId);
        if (projectId && !projectIds.has(projectId)) {
            addIssue('task.projectId', task.id, projectId);
        }
        const sectionId = optionalId(task.sectionId);
        if (sectionId && !sectionIds.has(sectionId)) {
            addIssue('task.sectionId', task.id, sectionId);
        }
        const areaId = optionalId(task.areaId);
        if (areaId && !areaIds.has(areaId)) {
            addIssue('task.areaId', task.id, areaId);
        }
    });

    return issues;
};

const buildSqliteSaveFailureContext = (data: AppData, step: string): Record<string, unknown> => {
    const referenceIssues = collectSqliteReferenceIssues(data);
    return {
        step,
        tasks: data.tasks.length,
        projects: data.projects.length,
        sections: data.sections.length,
        areas: data.areas.length,
        people: Array.isArray(data.people) ? data.people.length : 0,
        taskAttachments: data.tasks.reduce((count, task) => count + (task.attachments?.length ?? 0), 0),
        projectAttachments: data.projects.reduce((count, project) => count + (project.attachments?.length ?? 0), 0),
        referenceIssues: referenceIssues.length,
        referenceIssueSamples: referenceIssues.slice(0, 8),
    };
};

// TASK_SQLITE_COLUMNS and TASK_SQLITE_MIGRATION_COLUMNS are generated from
// TASK_SYNC_FIELD_SCHEMA in task-sync-schema.ts (see the comment there for why the
// derivation itself lives in that dependency-free file rather than here). Re-exported here
// under their existing names/values for this module's existing consumers
// (index.ts, apps/mcp-server/src/queries.ts).
export { TASK_SQLITE_COLUMNS, TASK_SQLITE_MIGRATION_COLUMNS };
// Same generation story as tasks (see the comment above), for projects and sections.
export { PROJECT_SQLITE_COLUMNS, PROJECT_SQLITE_MIGRATION_COLUMNS };
export { SECTION_SQLITE_COLUMNS, SECTION_SQLITE_MIGRATION_COLUMNS };

const TASK_UPSERT_COLUMNS = TASK_SQLITE_COLUMNS;

// `id` is the upsert conflict target, so it's excluded from the SET clause.
export const TASK_UPSERT_UPDATE_CLAUSE = `${TASK_SQLITE_COLUMNS
    .filter((column) => column !== 'id')
    .map((column) => `${column}=excluded.${column}`)
    .join(',\n')}
WHERE tasks.rev IS NULL OR tasks.rev <= excluded.rev`;

const PROJECT_UPSERT_COLUMNS = PROJECT_SQLITE_COLUMNS;
export const PROJECT_UPSERT_UPDATE_CLAUSE = `${PROJECT_SQLITE_COLUMNS
    .filter((column) => column !== 'id')
    .map((column) => `${column}=excluded.${column}`)
    .join(',\n')}
WHERE projects.rev IS NULL OR projects.rev <= excluded.rev`;

const SECTION_UPSERT_COLUMNS = SECTION_SQLITE_COLUMNS;
export const SECTION_UPSERT_UPDATE_CLAUSE = `${SECTION_SQLITE_COLUMNS
    .filter((column) => column !== 'id')
    .map((column) => `${column}=excluded.${column}`)
    .join(',\n')}
WHERE sections.rev IS NULL OR sections.rev <= excluded.rev`;

export const taskToSqliteRow = (task: Task): unknown[] => {
    const taskOrder = Number.isFinite(task.order) ? task.order : task.orderNum;
    return [
        task.id,
        task.title,
        task.status,
        task.priority ?? null,
        task.energyLevel ?? null,
        task.assignedTo ?? null,
        task.taskMode ?? null,
        task.startTime ?? null,
        toJson(task.relativeStartOffset),
        task.dueDate ?? null,
        toJson(task.recurrence),
        toBool(task.showFutureRecurrence),
        task.pushCount ?? null,
        task.repeatReminderMinutes ?? null,
        toJson(task.tags ?? []),
        toJson(task.contexts ?? []),
        toJson(task.checklist),
        task.description ?? null,
        task.textDirection ?? null,
        toJson(task.attachments),
        task.location ?? null,
        task.projectId ?? null,
        task.sectionId ?? null,
        task.areaId ?? null,
        Number.isFinite(taskOrder) ? taskOrder : null,
        Number.isFinite(task.boardOrder) ? task.boardOrder : null,
        Number.isFinite(task.focusOrder) ? task.focusOrder : null,
        toBool(task.isFocusedToday),
        task.timeEstimate ?? null,
        task.timeSpentMinutes ?? null,
        toBool(task.suppressMindwtrReminders),
        task.reviewAt ?? null,
        task.completedAt ?? null,
        task.statusBeforeProjectArchive ?? null,
        task.completedAtBeforeProjectArchive ?? null,
        toNullableBool(task.isFocusedTodayBeforeProjectArchive),
        task.projectArchivedAt ?? null,
        task.rev ?? null,
        task.revBy ?? null,
        task.createdAt,
        task.updatedAt,
        task.deletedAt ?? null,
        task.purgedAt ?? null,
    ];
};
// Serialized row + fingerprint cache keyed by task object identity. Store and
// sync updates are immutable — a changed task is a new object — and
// taskToSqliteRow is pure, so an unchanged object always serializes to the
// same row. The one in-place writer, the attachment transfer lifecycle
// (attachment-transfer.ts), operates on cloned AppData for this reason.
// This turns the per-save serialization/fingerprint pass over every
// task into a lookup for unchanged rows, which dominated saveData time on
// large mobile libraries (#766).
type TaskRowEntry = { row: unknown[]; fingerprint: string };
const taskRowEntryCache = new WeakMap<Task, TaskRowEntry>();
const getTaskRowEntry = (task: Task): TaskRowEntry => {
    const cached = taskRowEntryCache.get(task);
    if (cached) return cached;
    const row = taskToSqliteRow(task);
    const entry: TaskRowEntry = { row, fingerprint: JSON.stringify(row) };
    taskRowEntryCache.set(task, entry);
    return entry;
};

const READ_PAGE_SIZE = 1000;
const FTS_LOCK_TTL_MS = 5 * 60 * 1000;
const FTS_LOCK_REFRESH_INTERVAL_MS = Math.max(15_000, Math.floor(FTS_LOCK_TTL_MS / 3));
const SQLITE_ROW_VERSION_INSERT_BATCH_SIZE = 200;
const SEARCH_TASK_SELECT = [
    't.id AS id',
    't.title AS title',
    't.status AS status',
    't.startTime AS startTime',
    't.dueDate AS dueDate',
    't.projectId AS projectId',
    't.areaId AS areaId',
    't.tags AS tags',
    't.contexts AS contexts',
    't.location AS location',
].join(', ');
const SEARCH_PROJECT_SELECT = [
    'p.id AS id',
    'p.title AS title',
    'p.status AS status',
    'p.areaId AS areaId',
].join(', ');

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

let tempIdTableCounter = 0;

type SqliteEntityTable = 'tasks' | 'projects' | 'sections' | 'areas' | 'people' | 'saved_filters';

type SqliteKnownRowVersion = {
    rowId: number | null;
    rev: number | null;
    updatedAt: string | null;
};

const createTempIdTableName = (table: SqliteEntityTable): string => {
    tempIdTableCounter = (tempIdTableCounter + 1) % Number.MAX_SAFE_INTEGER;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10) || '0';
    return `temp_${table}_ids_${timestamp}_${tempIdTableCounter.toString(36)}_${random}`;
};

const normalizeProjectStatus = (value: unknown): Project['status'] => {
    if (value === 'active' || value === 'someday' || value === 'waiting' || value === 'archived') {
        return value;
    }
    if (typeof value === 'string') {
        const lowered = value.toLowerCase().trim();
        if (lowered === 'active' || lowered === 'someday' || lowered === 'waiting' || lowered === 'archived') {
            return lowered as Project['status'];
        }
    }
    return 'active';
};

const toStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
};

const toChecklist = (value: unknown): Task['checklist'] => {
    if (!Array.isArray(value)) return undefined;
    const cleaned = value
        .filter(isRecord)
        .filter((item) => typeof item.id === 'string' && typeof item.title === 'string')
        .map((item) => ({
            id: item.id as string,
            title: item.title as string,
            isCompleted: Boolean(item.isCompleted),
        }));
    return cleaned.length > 0 ? cleaned : undefined;
};

const toAttachments = (value: unknown): Attachment[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const allowedStatuses = new Set<Attachment['localStatus']>([
        'available',
        'missing',
        'uploading',
        'downloading',
    ]);
    const cleaned = value
        .filter(isRecord)
        .filter(
            (item) =>
                typeof item.id === 'string' &&
                typeof item.kind === 'string' &&
                typeof item.title === 'string' &&
                typeof item.uri === 'string'
        )
        .map((item) => ({
            id: item.id as string,
            kind: item.kind as Attachment['kind'],
            title: item.title as string,
            uri: item.uri as string,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
            size: typeof item.size === 'number' ? item.size : undefined,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
            deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : undefined,
            cloudKey: typeof item.cloudKey === 'string' ? item.cloudKey : undefined,
            fileHash: typeof item.fileHash === 'string' ? item.fileHash : undefined,
            localStatus: typeof item.localStatus === 'string' && allowedStatuses.has(item.localStatus as Attachment['localStatus'])
                ? (item.localStatus as Attachment['localStatus'])
                : undefined,
        }));
    return cleaned.length > 0 ? cleaned : undefined;
};

export function mapSqliteTaskRow(row: Record<string, unknown>): Task {
    const orderNumRaw = row.orderNum;
    const order = orderNumRaw === null || orderNumRaw === undefined ? undefined : Number(orderNumRaw);
    return {
        id: String(row.id),
        title: String(row.title ?? ''),
        status: normalizeTaskStatus(row.status),
        priority: row.priority as Task['priority'] | undefined,
        energyLevel: row.energyLevel as Task['energyLevel'] | undefined,
        assignedTo: row.assignedTo as string | undefined,
        taskMode: row.taskMode as Task['taskMode'] | undefined,
        startTime: row.startTime as string | undefined,
        relativeStartOffset: normalizeRelativeStartOffset(fromJson<unknown>(row.relativeStartOffset, undefined)),
        dueDate: row.dueDate as string | undefined,
        recurrence: normalizeRecurrenceForLoad(fromJson<unknown>(row.recurrence, null)),
        showFutureRecurrence: fromBool(row.showFutureRecurrence),
        pushCount: row.pushCount === null || row.pushCount === undefined ? undefined : Number(row.pushCount),
        repeatReminderMinutes: row.repeatReminderMinutes === null || row.repeatReminderMinutes === undefined
            ? undefined
            : Number(row.repeatReminderMinutes),
        tags: toStringArray(fromJson<unknown>(row.tags, [])),
        contexts: toStringArray(fromJson<unknown>(row.contexts, [])),
        checklist: toChecklist(fromJson<unknown>(row.checklist, undefined)),
        description: row.description as string | undefined,
        textDirection: row.textDirection as Task['textDirection'] | undefined,
        attachments: toAttachments(fromJson<unknown>(row.attachments, undefined)),
        location: row.location as string | undefined,
        projectId: row.projectId as string | undefined,
        sectionId: row.sectionId as string | undefined,
        areaId: row.areaId as string | undefined,
        order,
        orderNum: order,
        boardOrder: row.boardOrder === null || row.boardOrder === undefined ? undefined : Number(row.boardOrder),
        focusOrder: row.focusOrder === null || row.focusOrder === undefined ? undefined : Number(row.focusOrder),
        isFocusedToday: fromBool(row.isFocusedToday),
        timeEstimate: row.timeEstimate as Task['timeEstimate'] | undefined,
        timeSpentMinutes: row.timeSpentMinutes === null || row.timeSpentMinutes === undefined
            ? undefined
            : Number(row.timeSpentMinutes),
        suppressMindwtrReminders: fromBool(row.suppressMindwtrReminders),
        reviewAt: row.reviewAt as string | undefined,
        completedAt: row.completedAt as string | undefined,
        statusBeforeProjectArchive: row.statusBeforeProjectArchive as Task['statusBeforeProjectArchive'] | undefined,
        completedAtBeforeProjectArchive: row.completedAtBeforeProjectArchive as string | null | undefined,
        isFocusedTodayBeforeProjectArchive: fromNullableBool(row.isFocusedTodayBeforeProjectArchive),
        projectArchivedAt: row.projectArchivedAt as string | undefined,
        rev: row.rev === null || row.rev === undefined ? undefined : Number(row.rev),
        revBy: row.revBy as string | undefined,
        createdAt: String(row.createdAt ?? ''),
        updatedAt: String(row.updatedAt ?? ''),
        deletedAt: row.deletedAt as string | undefined,
        purgedAt: row.purgedAt as string | undefined,
    };
}

export type SqliteSaveDataStats = {
    incremental: boolean;
    writtenRows: number;
    removedRows: number;
    totalRows: number;
    settingsWritten: boolean;
    /** Await time spent on BEGIN IMMEDIATE (long values point at writer-lock contention). */
    beginMs: number;
    /** Await time spent on COMMIT (long values point at fsync/checkpoint cost). */
    commitMs: number;
    /** Total await time across all SQL statements in this save, including begin/commit. */
    sqlMs: number;
    /** Number of SQL statements executed (per-statement average separates bridge latency from statement volume). */
    sqlCount: number;
};

export class SqliteAdapter {
    private client: SqliteClient;
    private schemaReadyPromise: Promise<void> | null = null;
    // Fingerprints of rows submitted by this adapter's last committed save.
    // Revision-guarded upserts make it safe for another process to advance a row;
    // this cache is nulled whenever a transaction fails, and only repopulated
    // after a successful COMMIT.
    private lastSavedFingerprints: { tables: Map<string, Map<string, string>>; settingsJson: string | null } | null = null;
    // Rows this adapter has actually observed or successfully written. Snapshot
    // omission may physically delete only one of these rows, and only while its
    // database version still matches. This keeps a stale full snapshot from
    // deleting rows added or advanced by another process between read and save.
    private lastKnownRowVersions: Map<SqliteEntityTable, Map<string, SqliteKnownRowVersion>> | null = null;
    private lastSaveDataStats: SqliteSaveDataStats | null = null;

    constructor(client: SqliteClient) {
        this.client = client;
    }

    private async loadAllRows(table: 'tasks' | 'projects' | 'sections' | 'areas' | 'people'): Promise<Record<string, unknown>[]> {
        const rows: Record<string, unknown>[] = [];
        try {
            let lastRowId = 0;
            while (true) {
                const page = await this.client.all<Record<string, unknown> & { _rowid: number }>(
                    `SELECT rowid as _rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
                    [lastRowId, READ_PAGE_SIZE]
                );
                if (page.length === 0) break;
                page.forEach((row) => {
                    if (typeof row._rowid === 'number') {
                        lastRowId = row._rowid;
                    }
                    rows.push(row);
                });
                if (page.length < READ_PAGE_SIZE) break;
            }
            return rows;
        } catch (error) {
            logWarn('Failed to page with rowid, falling back to offset pagination', {
                scope: 'sqlite',
                category: 'storage',
                error,
            });
        }
        let offset = 0;
        while (true) {
            const page = await this.client.all<Record<string, unknown> & { _rowid: number }>(
                `SELECT rowid as _rowid, * FROM ${table} ORDER BY rowid LIMIT ? OFFSET ?`,
                [READ_PAGE_SIZE, offset]
            );
            rows.push(...page);
            if (page.length < READ_PAGE_SIZE) break;
            offset += READ_PAGE_SIZE;
        }
        return rows;
    }

    private knownRowVersionsFromRows(rows: Record<string, unknown>[]): Map<string, SqliteKnownRowVersion> {
        const versions = new Map<string, SqliteKnownRowVersion>();
        for (const row of rows) {
            const rawRev = row.rev;
            const parsedRev = rawRev === null || rawRev === undefined ? null : Number(rawRev);
            versions.set(String(row.id), {
                rowId: typeof row._rowid === 'number' ? row._rowid : null,
                rev: parsedRev !== null && Number.isFinite(parsedRev) ? parsedRev : null,
                updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
            });
        }
        return versions;
    }

    private async acquireFtsLock(): Promise<string | null> {
        const owner = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        const staleBefore = now - FTS_LOCK_TTL_MS;
        await this.client.run(
            'CREATE TABLE IF NOT EXISTS fts_lock (id INTEGER PRIMARY KEY, owner TEXT, acquiredAt INTEGER)'
        );
        const row = await this.client.get<{ owner?: string }>(
            `INSERT INTO fts_lock (id, owner, acquiredAt)
             VALUES (1, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               owner = excluded.owner,
               acquiredAt = excluded.acquiredAt
             WHERE fts_lock.acquiredAt < ?
             RETURNING owner`,
            [owner, now, staleBefore]
        );
        return row?.owner === owner ? owner : null;
    }

    private async releaseFtsLock(owner: string): Promise<void> {
        await this.client.run('DELETE FROM fts_lock WHERE id = 1 AND owner = ?', [owner]);
    }

    private async refreshFtsLock(owner: string): Promise<void> {
        await this.client.run('UPDATE fts_lock SET acquiredAt = ? WHERE id = 1 AND owner = ?', [Date.now(), owner]);
    }

    private startFtsLockHeartbeat(owner: string): ReturnType<typeof setInterval> {
        const timer = setInterval(() => {
            void this.refreshFtsLock(owner).catch((error) => {
                logWarn('Failed to refresh FTS rebuild lock', {
                    scope: 'sqlite',
                    category: 'fts',
                    error,
                });
            });
        }, FTS_LOCK_REFRESH_INTERVAL_MS);
        const unref = (timer as { unref?: () => void }).unref;
        if (typeof unref === 'function') {
            unref.call(timer);
        }
        return timer;
    }

    private async ensureSchemaInternal(): Promise<void> {
        if (this.client.exec) {
            await this.client.exec(SQLITE_BASE_SCHEMA);
        } else {
            await this.client.run(SQLITE_BASE_SCHEMA);
        }
        await this.ensureTaskColumns();
        await this.ensureProjectColumns();
        await this.ensureSectionColumns();
        await this.ensureAreaColumns();
        await this.ensurePeopleTable();
        await this.ensureSavedFilterTable();
        if (this.client.exec) {
            await this.client.exec(SQLITE_FTS_SCHEMA);
            await this.client.exec(SQLITE_INDEX_SCHEMA);
        } else {
            await this.client.run(SQLITE_FTS_SCHEMA);
            await this.client.run(SQLITE_INDEX_SCHEMA);
        }
        // FTS operations are optional - don't block startup if they fail
        try {
            await this.ensureFtsSchema();
            await this.ensureFtsTriggers();
            await this.ensureFtsPopulated();
        } catch (error) {
            logWarn('FTS setup failed, search may not work', {
                scope: 'sqlite',
                category: 'fts',
                error,
            });
        }
    }

    async ensureSchema(): Promise<void> {
        if (!this.schemaReadyPromise) {
            this.schemaReadyPromise = this.ensureSchemaInternal().catch((error) => {
                this.schemaReadyPromise = null;
                throw error;
            });
        }
        await this.schemaReadyPromise;
    }

    private async ensureFtsSchema() {
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(tasks_fts)');
        const hasChecklist = columns.some((column) => column.name === 'checklist');
        const hasAssignedTo = columns.some((column) => column.name === 'assignedTo');
        if (hasChecklist && hasAssignedTo) return;

        await this.client.run('DROP TRIGGER IF EXISTS tasks_ai');
        await this.client.run('DROP TRIGGER IF EXISTS tasks_ad');
        await this.client.run('DROP TRIGGER IF EXISTS tasks_au');
        await this.client.run('DROP TABLE IF EXISTS tasks_fts');
        await this.client.run(`
            CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
              id UNINDEXED,
              title,
              description,
              tags,
              contexts,
              checklist,
              location,
              assignedTo,
              content=''
            )
        `);
    }

    private async ensureFtsTriggers() {
        // Recreate FTS triggers to use proper contentless FTS5 delete syntax
        // Old triggers used "DELETE FROM tasks_fts WHERE id = ..." which fails on contentless tables
        try {
            // Drop old triggers and recreate with current indexed columns.
            await this.client.run('DROP TRIGGER IF EXISTS tasks_ai');
            await this.client.run('DROP TRIGGER IF EXISTS tasks_ad');
            await this.client.run('DROP TRIGGER IF EXISTS tasks_au');
            await this.client.run('DROP TRIGGER IF EXISTS projects_ad');
            await this.client.run('DROP TRIGGER IF EXISTS projects_au');

            await this.client.run(`
                CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
                  INSERT INTO tasks_fts (rowid, title, description, tags, contexts, checklist, location, assignedTo)
                  VALUES (new.rowid, new.title, coalesce(new.description, ''), coalesce(new.tags, ''), coalesce(new.contexts, ''), coalesce((SELECT group_concat(json_extract(value, '$.title'), ' ') FROM json_each(new.checklist)), ''), coalesce(new.location, ''), coalesce(new.assignedTo, ''));
                END
            `);
            await this.client.run(`
                CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
                  INSERT INTO tasks_fts (tasks_fts, rowid, title, description, tags, contexts, checklist, location, assignedTo)
                  VALUES ('delete', old.rowid, old.title, coalesce(old.description, ''), coalesce(old.tags, ''), coalesce(old.contexts, ''), coalesce((SELECT group_concat(json_extract(value, '$.title'), ' ') FROM json_each(old.checklist)), ''), coalesce(old.location, ''), coalesce(old.assignedTo, ''));
                END
            `);
            await this.client.run(`
                CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
                  INSERT INTO tasks_fts (tasks_fts, rowid, title, description, tags, contexts, checklist, location, assignedTo)
                  VALUES ('delete', old.rowid, old.title, coalesce(old.description, ''), coalesce(old.tags, ''), coalesce(old.contexts, ''), coalesce((SELECT group_concat(json_extract(value, '$.title'), ' ') FROM json_each(old.checklist)), ''), coalesce(old.location, ''), coalesce(old.assignedTo, ''));
                  INSERT INTO tasks_fts (rowid, title, description, tags, contexts, checklist, location, assignedTo)
                  VALUES (new.rowid, new.title, coalesce(new.description, ''), coalesce(new.tags, ''), coalesce(new.contexts, ''), coalesce((SELECT group_concat(json_extract(value, '$.title'), ' ') FROM json_each(new.checklist)), ''), coalesce(new.location, ''), coalesce(new.assignedTo, ''));
                END
            `);
            await this.client.run(`
                CREATE TRIGGER IF NOT EXISTS projects_ad AFTER DELETE ON projects BEGIN
                  INSERT INTO projects_fts (projects_fts, rowid, title, supportNotes, tagIds, areaTitle)
                  VALUES ('delete', old.rowid, old.title, coalesce(old.supportNotes, ''), coalesce(old.tagIds, ''), coalesce(old.areaTitle, ''));
                END
            `);
            await this.client.run(`
                CREATE TRIGGER IF NOT EXISTS projects_au AFTER UPDATE ON projects BEGIN
                  INSERT INTO projects_fts (projects_fts, rowid, title, supportNotes, tagIds, areaTitle)
                  VALUES ('delete', old.rowid, old.title, coalesce(old.supportNotes, ''), coalesce(old.tagIds, ''), coalesce(old.areaTitle, ''));
                  INSERT INTO projects_fts (rowid, title, supportNotes, tagIds, areaTitle)
                  VALUES (new.rowid, new.title, coalesce(new.supportNotes, ''), coalesce(new.tagIds, ''), coalesce(new.areaTitle, ''));
                END
            `);

            await this.client.run('INSERT OR IGNORE INTO schema_migrations (version) VALUES (2)');
        } catch (error) {
            logWarn('Failed to migrate FTS triggers', {
                scope: 'sqlite',
                category: 'fts',
                error,
            });
            // Continue without migrating - triggers may still work or will fail gracefully
        }
    }

    private async ensureTaskColumns() {
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(tasks)');
        const names = new Set(columns.map((col) => col.name));
        const definitions = TASK_SQLITE_MIGRATION_COLUMNS;
        for (const definition of definitions) {
            if (!names.has(definition.name)) {
                await this.client.run(definition.sql);
            }
        }
        const taskIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_deletedAt ON tasks(deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_dueDate ON tasks(dueDate)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_startTime ON tasks(startTime)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_reviewAt ON tasks(reviewAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_completedAt ON tasks(completedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_createdAt ON tasks(createdAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt_rev ON tasks(updatedAt, rev)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt_deletedAt ON tasks(updatedAt, deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_status_deletedAt ON tasks(status, deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_project_deletedAt ON tasks(projectId, deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_project_status_deletedAt ON tasks(projectId, status, deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_project_status_updatedAt ON tasks(projectId, status, updatedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_projectId_orderNum ON tasks(projectId, orderNum)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_area_deletedAt ON tasks(areaId, deletedAt)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(areaId)',
            'CREATE INDEX IF NOT EXISTS idx_tasks_section_id ON tasks(sectionId)',
        ];
        for (const sql of taskIndexes) {
            await this.client.run(sql);
        }
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_sections_project_deletedAt ON sections(projectId, deletedAt)'
        );
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_sections_updatedAt_rev ON sections(updatedAt, rev)'
        );
    }

    private async ensureProjectColumns() {
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(projects)');
        const names = new Set(columns.map((col) => col.name));
        const definitions = PROJECT_SQLITE_MIGRATION_COLUMNS;
        for (const definition of definitions) {
            if (!names.has(definition.name)) {
                await this.client.run(definition.sql);
            }
        }
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_projects_area_deletedAt ON projects(areaId, deletedAt)'
        );
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_projects_area_order ON projects(areaId, orderNum)'
        );
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_projects_dueDate ON projects(dueDate)'
        );
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_projects_updatedAt_rev ON projects(updatedAt, rev)'
        );
    }

    private async ensureSectionColumns() {
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(sections)');
        const names = new Set(columns.map((col) => col.name));
        const definitions = SECTION_SQLITE_MIGRATION_COLUMNS;
        for (const definition of definitions) {
            if (!names.has(definition.name)) {
                await this.client.run(definition.sql);
            }
        }
        await this.client.run(
            'CREATE INDEX IF NOT EXISTS idx_areas_updatedAt_rev ON areas(updatedAt, rev)'
        );
    }

    private async ensureAreaColumns() {
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(areas)');
        const names = new Set(columns.map((col) => col.name));
        const definitions: Array<{ name: string; sql: string }> = [
            { name: 'color', sql: 'ALTER TABLE areas ADD COLUMN color TEXT' },
            { name: 'icon', sql: 'ALTER TABLE areas ADD COLUMN icon TEXT' },
            { name: 'orderNum', sql: 'ALTER TABLE areas ADD COLUMN orderNum INTEGER' },
            { name: 'rev', sql: 'ALTER TABLE areas ADD COLUMN rev INTEGER' },
            { name: 'revBy', sql: 'ALTER TABLE areas ADD COLUMN revBy TEXT' },
            { name: 'createdAt', sql: 'ALTER TABLE areas ADD COLUMN createdAt TEXT' },
            { name: 'updatedAt', sql: 'ALTER TABLE areas ADD COLUMN updatedAt TEXT' },
            { name: 'deletedAt', sql: 'ALTER TABLE areas ADD COLUMN deletedAt TEXT' },
        ];
        for (const definition of definitions) {
            if (!names.has(definition.name)) {
                await this.client.run(definition.sql);
            }
        }
    }

    private async ensurePeopleTable() {
        await this.client.run(`
            CREATE TABLE IF NOT EXISTS people (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              note TEXT,
              referenceLink TEXT,
              rev INTEGER,
              revBy TEXT,
              createdAt TEXT NOT NULL,
              updatedAt TEXT NOT NULL,
              deletedAt TEXT
            )
        `);
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(people)');
        const names = new Set(columns.map((col) => col.name));
        const definitions: Array<{ name: string; sql: string }> = [
            { name: 'note', sql: 'ALTER TABLE people ADD COLUMN note TEXT' },
            { name: 'referenceLink', sql: 'ALTER TABLE people ADD COLUMN referenceLink TEXT' },
            { name: 'rev', sql: 'ALTER TABLE people ADD COLUMN rev INTEGER' },
            { name: 'revBy', sql: 'ALTER TABLE people ADD COLUMN revBy TEXT' },
            { name: 'createdAt', sql: 'ALTER TABLE people ADD COLUMN createdAt TEXT' },
            { name: 'updatedAt', sql: 'ALTER TABLE people ADD COLUMN updatedAt TEXT' },
            { name: 'deletedAt', sql: 'ALTER TABLE people ADD COLUMN deletedAt TEXT' },
        ];
        for (const definition of definitions) {
            if (!names.has(definition.name)) {
                await this.client.run(definition.sql);
            }
        }
        await this.client.run('CREATE INDEX IF NOT EXISTS idx_people_updatedAt_rev ON people(updatedAt, rev)');
    }

    private async ensureSavedFilterTable() {
        await this.client.run(`
            CREATE TABLE IF NOT EXISTS saved_filters (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              icon TEXT,
              view TEXT NOT NULL,
              criteria TEXT NOT NULL,
              sortBy TEXT,
              sortOrder TEXT,
              groupBy TEXT,
              createdAt TEXT NOT NULL,
              updatedAt TEXT NOT NULL,
              deletedAt TEXT
            )
        `);
        const columns = await this.client.all<{ name?: string }>('PRAGMA table_info(saved_filters)');
        const columnNames = new Set(columns.map((column) => column.name));
        if (!columnNames.has('groupBy')) {
            await this.client.run('ALTER TABLE saved_filters ADD COLUMN groupBy TEXT');
        }
        if (!columnNames.has('deletedAt')) {
            await this.client.run('ALTER TABLE saved_filters ADD COLUMN deletedAt TEXT');
        }
        await this.client.run('CREATE INDEX IF NOT EXISTS idx_saved_filters_view ON saved_filters(view)');
    }

    private async ensureFtsPopulated(forceRebuild = false) {
        try {
            const totals = await this.client.get<{
                tasks_total?: number;
                tasks_fts_total?: number;
                projects_total?: number;
                projects_fts_total?: number;
            }>(
                `SELECT
                    (SELECT COUNT(*) FROM tasks) as tasks_total,
                    (SELECT COUNT(*) FROM tasks_fts) as tasks_fts_total,
                    (SELECT COUNT(*) FROM projects) as projects_total,
                    (SELECT COUNT(*) FROM projects_fts) as projects_fts_total
                `
            );
            const tasksTotal = Number(totals?.tasks_total ?? 0);
            const tasksFtsTotal = Number(totals?.tasks_fts_total ?? 0);
            const projectsTotal = Number(totals?.projects_total ?? 0);
            const projectsFtsTotal = Number(totals?.projects_fts_total ?? 0);

            if (!forceRebuild && tasksTotal === tasksFtsTotal && projectsTotal === projectsFtsTotal && tasksTotal > 0) {
                return;
            }

            const counts = await this.client.get<{
                task_count?: number;
                task_missing?: number;
                task_extra?: number;
                project_count?: number;
                project_missing?: number;
                project_extra?: number;
            }>(
                `SELECT
                    (SELECT COUNT(*) FROM tasks_fts) as task_count,
                    (SELECT COUNT(*) FROM (SELECT rowid FROM tasks EXCEPT SELECT rowid FROM tasks_fts)) as task_missing,
                    (SELECT COUNT(*) FROM (SELECT rowid FROM tasks_fts EXCEPT SELECT rowid FROM tasks)) as task_extra,
                    (SELECT COUNT(*) FROM projects_fts) as project_count,
                    (SELECT COUNT(*) FROM (SELECT rowid FROM projects EXCEPT SELECT rowid FROM projects_fts)) as project_missing,
                    (SELECT COUNT(*) FROM (SELECT rowid FROM projects_fts EXCEPT SELECT rowid FROM projects)) as project_extra
                `
            );
            const taskCount = Number(counts?.task_count ?? tasksFtsTotal ?? 0);
            const taskMissing = Number(counts?.task_missing ?? 0);
            const taskExtra = Number(counts?.task_extra ?? 0);
            const needsTaskRebuild = forceRebuild || taskCount === 0 || taskMissing > 0 || taskExtra > 0;

            const projectCount = Number(counts?.project_count ?? projectsFtsTotal ?? 0);
            const projectMissing = Number(counts?.project_missing ?? 0);
            const projectExtra = Number(counts?.project_extra ?? 0);
            const needsProjectRebuild = forceRebuild || projectCount === 0 || projectMissing > 0 || projectExtra > 0;

            if (!needsTaskRebuild && !needsProjectRebuild) return;

            const maxAttempts = 3;
            let lockOwner = await this.acquireFtsLock();
            for (let attempt = 1; !lockOwner && attempt < maxAttempts; attempt += 1) {
                const baseDelayMs = Math.min(2000, 200 * Math.pow(2, attempt - 1));
                const jitterMs = Math.floor(Math.random() * (baseDelayMs * 0.5));
                const delayMs = baseDelayMs + jitterMs;
                logWarn('FTS rebuild lock unavailable, retrying', {
                    scope: 'sqlite',
                    category: 'fts',
                    context: {
                        attempt: attempt + 1,
                        baseDelayMs,
                        jitterMs,
                        delayMs,
                    },
                });
                await sleep(delayMs);
                lockOwner = await this.acquireFtsLock();
            }
            if (!lockOwner) {
                logWarn('FTS rebuild skipped: lock unavailable after retries', {
                    scope: 'sqlite',
                    category: 'fts',
                    context: {
                        attempts: maxAttempts,
                    },
                });
                return;
            }

            const lockHeartbeat = this.startFtsLockHeartbeat(lockOwner);
            try {
                await this.client.run('BEGIN');
                try {
                    if (needsTaskRebuild) {
                        // Use FTS5 delete-all command for contentless tables (content='')
                        await this.client.run("INSERT INTO tasks_fts(tasks_fts) VALUES('delete-all')");
                        await this.client.run(
                            `INSERT INTO tasks_fts (rowid, title, description, tags, contexts, checklist, location, assignedTo)
                             SELECT rowid, title, coalesce(description, ''), coalesce(tags, ''), coalesce(contexts, ''), coalesce((SELECT group_concat(json_extract(value, '$.title'), ' ') FROM json_each(tasks.checklist)), ''), coalesce(location, ''), coalesce(assignedTo, '') FROM tasks`
                        );
                    }
                    if (needsProjectRebuild) {
                        // Use FTS5 delete-all command for contentless tables (content='')
                        await this.client.run("INSERT INTO projects_fts(projects_fts) VALUES('delete-all')");
                        await this.client.run(
                            `INSERT INTO projects_fts (rowid, title, supportNotes, tagIds, areaTitle)
                             SELECT rowid, title, coalesce(supportNotes, ''), coalesce(tagIds, ''), coalesce(areaTitle, '') FROM projects`
                        );
                    }
                    await this.client.run('COMMIT');
                } catch (error) {
                    await this.client.run('ROLLBACK');
                    throw error;
                }
            } finally {
                clearInterval(lockHeartbeat);
                await this.releaseFtsLock(lockOwner);
            }
        } catch (error) {
            logWarn('Failed to populate FTS index', {
                scope: 'sqlite',
                category: 'fts',
                error,
            });
            // Continue without FTS - search will fail gracefully
        }
    }

    private mapTaskRow(row: Record<string, unknown>): Task {
        return mapSqliteTaskRow(row);
    }

    private mapProjectRow(row: Record<string, unknown>): Project {
        const orderNumRaw = row.orderNum;
        const fallbackOrder = typeof row._rowid === 'number' ? row._rowid : 0;
        return {
            id: String(row.id),
            title: String(row.title ?? ''),
            status: normalizeProjectStatus(row.status),
            color: String(row.color ?? '#6B7280'),
            order: orderNumRaw === null || orderNumRaw === undefined ? fallbackOrder : Number(orderNumRaw),
            tagIds: toStringArray(fromJson<unknown>(row.tagIds, [])),
            isSequential: fromBool(row.isSequential),
            sequentialScope: normalizeProjectSequentialScope(row.sequentialScope),
            taskSortBy: normalizeProjectTaskSortBy(row.taskSortBy),
            isFocused: fromBool(row.isFocused),
            supportNotes: row.supportNotes as string | undefined,
            attachments: toAttachments(fromJson<unknown>(row.attachments, undefined)),
            dueDate: row.dueDate as string | undefined,
            reviewAt: row.reviewAt as string | undefined,
            areaId: row.areaId as string | undefined,
            areaTitle: row.areaTitle as string | undefined,
            rev: row.rev === null || row.rev === undefined ? undefined : Number(row.rev),
            revBy: row.revBy as string | undefined,
            createdAt: String(row.createdAt ?? ''),
            updatedAt: String(row.updatedAt ?? ''),
            deletedAt: row.deletedAt as string | undefined,
            purgedAt: row.purgedAt as string | undefined,
        };
    }

    private mapSearchTaskRow(row: Record<string, unknown>): SearchTaskResult {
        return {
            id: String(row.id),
            title: String(row.title ?? ''),
            status: normalizeTaskStatus(row.status),
            startTime: row.startTime as string | undefined,
            dueDate: row.dueDate as string | undefined,
            projectId: row.projectId as string | undefined,
            areaId: row.areaId as string | undefined,
            tags: toStringArray(fromJson<unknown>(row.tags, [])),
            contexts: toStringArray(fromJson<unknown>(row.contexts, [])),
            location: row.location as string | undefined,
        };
    }

    private mapSearchProjectRow(row: Record<string, unknown>): SearchProjectResult {
        return {
            id: String(row.id),
            title: String(row.title ?? ''),
            status: normalizeProjectStatus(row.status),
            areaId: row.areaId as string | undefined,
        };
    }

    private mapSectionRow(row: Record<string, unknown>): Section {
        const orderNumRaw = row.orderNum;
        const fallbackOrder = typeof row._rowid === 'number' ? row._rowid : 0;
        return {
            id: String(row.id),
            projectId: String(row.projectId ?? ''),
            title: String(row.title ?? ''),
            description: row.description as string | undefined,
            order: orderNumRaw === null || orderNumRaw === undefined ? fallbackOrder : Number(orderNumRaw),
            isCollapsed: fromBool(row.isCollapsed),
            rev: row.rev === null || row.rev === undefined ? undefined : Number(row.rev),
            revBy: row.revBy as string | undefined,
            createdAt: String(row.createdAt ?? ''),
            updatedAt: String(row.updatedAt ?? ''),
            deletedAt: row.deletedAt as string | undefined,
            deletedAtBeforeProjectArchive: row.deletedAtBeforeProjectArchive as string | null | undefined,
            projectArchivedAt: row.projectArchivedAt as string | undefined,
        };
    }

    private mapSavedFilterRow(row: Record<string, unknown>): SavedFilter | null {
        return normalizeSavedFilter({
            id: row.id,
            name: row.name,
            icon: row.icon,
            view: row.view,
            criteria: fromJson<unknown>(row.criteria, {}),
            sortBy: row.sortBy,
            sortOrder: row.sortOrder,
            groupBy: row.groupBy,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
        });
    }

    async getData(): Promise<AppData> {
        await this.ensureSchema();
        const [tasksRows, projectsRows, sectionsRows, areasRows, peopleRows, settingsRow, savedFilterRows] = await Promise.all([
            this.loadAllRows('tasks'),
            this.loadAllRows('projects'),
            this.loadAllRows('sections'),
            this.loadAllRows('areas'),
            this.loadAllRows('people'),
            this.client.get<Record<string, unknown>>('SELECT data FROM settings WHERE id = 1'),
            this.client.all<Record<string, unknown>>('SELECT rowid as _rowid, * FROM saved_filters ORDER BY createdAt, name'),
        ]);

        const tasks: Task[] = tasksRows.map((row) => this.mapTaskRow(row));
        const projects: Project[] = projectsRows.map((row) => this.mapProjectRow(row));
        const sections: Section[] = sectionsRows.map((row) => this.mapSectionRow(row));
        const nowIso = new Date().toISOString();

        const areas: Area[] = areasRows.map((row) => {
            const createdAtRaw = typeof row.createdAt === 'string' && row.createdAt.trim().length > 0
                ? row.createdAt
                : undefined;
            const updatedAtRaw = typeof row.updatedAt === 'string' && row.updatedAt.trim().length > 0
                ? row.updatedAt
                : undefined;
            const createdAt = createdAtRaw ?? updatedAtRaw ?? nowIso;
            const updatedAt = updatedAtRaw ?? createdAtRaw ?? nowIso;
            return {
                id: String(row.id),
                name: String(row.name ?? ''),
                color: row.color as string | undefined,
                icon: row.icon as string | undefined,
                order: Number(row.orderNum ?? 0),
                rev: row.rev === null || row.rev === undefined ? undefined : Number(row.rev),
                revBy: row.revBy as string | undefined,
                createdAt,
                updatedAt,
                deletedAt: row.deletedAt as string | undefined,
            };
        });
        const people: Person[] = peopleRows.map((row) => {
            const createdAtRaw = typeof row.createdAt === 'string' && row.createdAt.trim().length > 0
                ? row.createdAt
                : undefined;
            const updatedAtRaw = typeof row.updatedAt === 'string' && row.updatedAt.trim().length > 0
                ? row.updatedAt
                : undefined;
            const createdAt = createdAtRaw ?? updatedAtRaw ?? nowIso;
            const updatedAt = updatedAtRaw ?? createdAtRaw ?? nowIso;
            return {
                id: String(row.id),
                name: String(row.name ?? ''),
                note: row.note as string | undefined,
                referenceLink: row.referenceLink as string | undefined,
                rev: row.rev === null || row.rev === undefined ? undefined : Number(row.rev),
                revBy: row.revBy as string | undefined,
                createdAt,
                updatedAt,
                deletedAt: row.deletedAt as string | undefined,
            };
        });

        const settings = settingsRow?.data ? fromJson<AppData['settings']>(settingsRow.data, {}) : {};
        const savedFiltersFromTable = savedFilterRows
            .map((row) => this.mapSavedFilterRow(row))
            .filter((item): item is SavedFilter => Boolean(item));
        if (!Array.isArray(settings.savedFilters) && savedFiltersFromTable.length > 0) {
            settings.savedFilters = savedFiltersFromTable;
        } else if (Array.isArray(settings.savedFilters)) {
            settings.savedFilters = normalizeSavedFilters(settings.savedFilters);
        }

        // A read is the deletion baseline for this adapter. Retain exact row
        // versions so later snapshot omissions can use compare-and-swap deletion.
        this.lastKnownRowVersions = new Map<SqliteEntityTable, Map<string, SqliteKnownRowVersion>>([
            ['tasks', this.knownRowVersionsFromRows(tasksRows)],
            ['projects', this.knownRowVersionsFromRows(projectsRows)],
            ['sections', this.knownRowVersionsFromRows(sectionsRows)],
            ['areas', this.knownRowVersionsFromRows(areasRows)],
            ['people', this.knownRowVersionsFromRows(peopleRows)],
            ['saved_filters', this.knownRowVersionsFromRows(savedFilterRows)],
        ]);

        return { tasks, projects, sections, areas, people, settings };
    }

    async queryTasks(options: TaskQueryOptions): Promise<Task[]> {
        await this.ensureSchema();
        const where: string[] = [];
        const params: unknown[] = [];
        const includeDeleted = options.includeDeleted === true;
        const includeArchived = options.includeArchived === true;

        if (!includeDeleted) {
            where.push('deletedAt IS NULL');
        }
        if (!includeArchived) {
            where.push("status != 'archived'");
        }
        if (options.status && options.status !== 'all') {
            where.push('status = ?');
            params.push(options.status);
        }
        if (options.excludeStatuses && options.excludeStatuses.length > 0) {
            where.push(`status NOT IN (${options.excludeStatuses.map(() => '?').join(', ')})`);
            params.push(...options.excludeStatuses);
        }
        if (options.projectId) {
            where.push('projectId = ?');
            params.push(options.projectId);
        }

        const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
        const rows = await this.client.all<Record<string, unknown>>(sql, params);
        return rows.map((row) => this.mapTaskRow(row));
    }

    async searchAll(query: string): Promise<SearchResults> {
        await this.ensureSchema();
        const safeQuery = typeof query === 'string' ? query : '';
        const cleaned = safeQuery
            .replace(/[^\p{L}\p{N}#@]+/gu, ' ')
            .trim();
        if (!cleaned) {
            return { tasks: [], projects: [] };
        }
        const reservedTokens = new Set(['AND', 'OR', 'NOT', 'NEAR']);
        const tokens = cleaned
            .split(/\s+/)
            .filter(Boolean)
            .filter((token) => !reservedTokens.has(token.toUpperCase()));
        if (tokens.length === 0) {
            return { tasks: [], projects: [] };
        }
        const ftsQuery = tokens.map((token) => `${token}*`).join(' ');
        const runSearch = async (): Promise<SearchResults> => {
            const [taskRows, projectRows] = await Promise.all([
                this.client.all<Record<string, unknown>>(
                    `SELECT ${SEARCH_TASK_SELECT} FROM tasks_fts f JOIN tasks t ON f.rowid = t.rowid WHERE tasks_fts MATCH ? AND t.deletedAt IS NULL ORDER BY bm25(tasks_fts) LIMIT ?`,
                    [ftsQuery, SEARCH_RESULT_LIMIT + 1]
                ),
                this.client.all<Record<string, unknown>>(
                    `SELECT ${SEARCH_PROJECT_SELECT} FROM projects_fts f JOIN projects p ON f.rowid = p.rowid WHERE projects_fts MATCH ? AND p.deletedAt IS NULL ORDER BY bm25(projects_fts) LIMIT ?`,
                    [ftsQuery, SEARCH_RESULT_LIMIT + 1]
                ),
            ]);
            const limited = taskRows.length > SEARCH_RESULT_LIMIT || projectRows.length > SEARCH_RESULT_LIMIT;
            return {
                tasks: taskRows.slice(0, SEARCH_RESULT_LIMIT).map((row) => this.mapSearchTaskRow(row)),
                projects: projectRows.slice(0, SEARCH_RESULT_LIMIT).map((row) => this.mapSearchProjectRow(row)),
                limited: limited || undefined,
                limit: limited ? SEARCH_RESULT_LIMIT : undefined,
            };
        };

        try {
            return await runSearch();
        } catch (error) {
            try {
                await this.ensureFtsPopulated(true);
                return await runSearch();
            } catch (retryError) {
                logWarn('Search failed', { scope: 'sqlite', category: 'fts', error: retryError });
                return { tasks: [], projects: [] };
            }
        }
    }

    getLastSaveDataStats(): SqliteSaveDataStats | null {
        return this.lastSaveDataStats;
    }

    async saveTask(task: Task): Promise<void> {
        await this.ensureSchema();
        await this.client.run('BEGIN IMMEDIATE');
        try {
            const columnList = TASK_UPSERT_COLUMNS.join(', ');
            const placeholders = TASK_UPSERT_COLUMNS.map(() => '?').join(', ');
            const entry = getTaskRowEntry(task);
            await this.client.run(
                `INSERT INTO tasks (${columnList}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${TASK_UPSERT_UPDATE_CLAUSE}`,
                entry.row
            );
            await this.client.run('COMMIT');
            this.lastSavedFingerprints?.tables.get('tasks')?.set(String(entry.row[0]), entry.fingerprint);
            const knownTables = new Map(this.lastKnownRowVersions ?? []);
            const knownTasks = new Map(knownTables.get('tasks') ?? []);
            const previousVersion = knownTasks.get(task.id);
            const rawRev = entry.row[TASK_UPSERT_COLUMNS.indexOf('rev')];
            const parsedRev = rawRev === null || rawRev === undefined ? null : Number(rawRev);
            const rawUpdatedAt = entry.row[TASK_UPSERT_COLUMNS.indexOf('updatedAt')];
            knownTasks.set(task.id, {
                rowId: previousVersion?.rowId ?? null,
                rev: parsedRev !== null && Number.isFinite(parsedRev) ? parsedRev : null,
                updatedAt: typeof rawUpdatedAt === 'string' ? rawUpdatedAt : null,
            });
            knownTables.set('tasks', knownTasks);
            this.lastKnownRowVersions = knownTables;
        } catch (error) {
            this.lastSavedFingerprints = null;
            await this.client.run('ROLLBACK').catch(() => undefined);
            throw error;
        }
    }

    async saveData(data: AppData): Promise<void> {
        await this.ensureSchema();
        // A snapshot with zero entities while the database still holds rows
        // means the caller lost its in-memory state: real mass-deletions keep
        // tombstoned rows in the snapshot (#852). Desktop's Rust storage layer
        // refuses this at its own layer; this is the same backstop for every
        // consumer of the shared adapter (mobile, MCP local mode).
        const incomingEntityCount = (data.tasks?.length ?? 0)
            + (data.projects?.length ?? 0)
            + (data.sections?.length ?? 0)
            + (data.areas?.length ?? 0)
            + (data.people?.length ?? 0);
        if (incomingEntityCount === 0) {
            let storedEntityCount = 0;
            for (const table of ['tasks', 'projects', 'sections', 'areas', 'people'] as const) {
                const rows = await this.client.all<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
                storedEntityCount += Number(rows[0]?.count ?? 0);
                if (storedEntityCount > 0) break;
            }
            if (storedEntityCount > 0) {
                throw new Error('Refusing to overwrite existing data with an empty snapshot; local data left untouched');
            }
        }
        const previousSave = this.lastSavedFingerprints;
        const previousKnownRows = this.lastKnownRowVersions;
        const nextSave: { tables: Map<string, Map<string, string>>; settingsJson: string | null } = {
            tables: new Map(),
            settingsJson: null,
        };
        const nextKnownRows = new Map<SqliteEntityTable, Map<string, SqliteKnownRowVersion>>();
        const stats: SqliteSaveDataStats = {
            incremental: previousSave !== null,
            writtenRows: 0,
            removedRows: 0,
            totalRows: 0,
            settingsWritten: false,
            beginMs: 0,
            commitMs: 0,
            sqlMs: 0,
            sqlCount: 0,
        };
        const runTimed = async (sql: string, args?: unknown[]) => {
            const statementStartedAt = Date.now();
            try {
                return await this.client.run(sql, args);
            } finally {
                stats.sqlMs += Date.now() - statementStartedAt;
                stats.sqlCount += 1;
            }
        };
        this.lastSavedFingerprints = null;
        const beginStartedAt = Date.now();
        await runTimed('BEGIN IMMEDIATE');
        stats.beginMs = Date.now() - beginStartedAt;
        let saveStep = 'begin';
        try {
            const nowIso = new Date().toISOString();
            const chunkArray = <T>(items: T[], size: number): T[][] => {
                const chunks: T[][] = [];
                for (let i = 0; i < items.length; i += size) {
                    chunks.push(items.slice(i, i + size));
                }
                return chunks;
            };

            const upsertBatch = async (
                table: SqliteEntityTable,
                columns: string[],
                rows: unknown[][],
                updateClause: string,
                chunkSize = 200,
                precomputedFingerprints?: string[],
                versionColumns?: { rev?: number; updatedAt: number },
            ) => {
                const previousRows = previousSave?.tables.get(table);
                const previousVersions = previousKnownRows?.get(table);
                const fingerprints = new Map<string, string>();
                const knownVersions = new Map<string, SqliteKnownRowVersion>();
                const changedRows: unknown[][] = [];
                for (let i = 0; i < rows.length; i += 1) {
                    const row = rows[i];
                    const id = String(row[0]);
                    const fingerprint = precomputedFingerprints?.[i] ?? JSON.stringify(row);
                    fingerprints.set(id, fingerprint);
                    if (versionColumns) {
                        const rawRev = versionColumns.rev === undefined ? null : row[versionColumns.rev];
                        const parsedRev = rawRev === null || rawRev === undefined ? null : Number(rawRev);
                        const rawUpdatedAt = row[versionColumns.updatedAt];
                        knownVersions.set(id, {
                            rowId: previousVersions?.get(id)?.rowId ?? null,
                            rev: parsedRev !== null && Number.isFinite(parsedRev) ? parsedRev : null,
                            updatedAt: typeof rawUpdatedAt === 'string' ? rawUpdatedAt : null,
                        });
                    }
                    if (previousRows?.get(id) !== fingerprint) {
                        changedRows.push(row);
                    }
                }
                nextSave.tables.set(table, fingerprints);
                nextKnownRows.set(table, knownVersions);
                stats.totalRows += rows.length;
                stats.writtenRows += changedRows.length;
                if (changedRows.length === 0) return;
                const columnList = columns.join(', ');
                const placeholders = `(${columns.map(() => '?').join(', ')})`;
                for (const batch of chunkArray(changedRows, chunkSize)) {
                    const values: unknown[] = [];
                    const valuePlaceholders = batch
                        .map((row) => {
                            values.push(...row);
                            return placeholders;
                        })
                        .join(', ');
                    await runTimed(
                        `INSERT INTO ${table} (${columnList}) VALUES ${valuePlaceholders} ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
                        values
                    );
                }
            };

            const syncIds = async (table: SqliteEntityTable, ids: string[]) => {
                const knownRows = previousKnownRows?.get(table);
                if (!knownRows) return;
                const keptIds = new Set(ids);
                const removedRows: Array<[string, number | null, number | null, string | null]> = [];
                for (const [id, version] of knownRows) {
                    if (!keptIds.has(id)) {
                        removedRows.push([id, version.rowId, version.rev, version.updatedAt]);
                    }
                }
                if (removedRows.length === 0) return;
                stats.removedRows += removedRows.length;
                const tempTable = createTempIdTableName(table);
                try {
                    await runTimed(`CREATE TEMP TABLE ${tempTable} (id TEXT PRIMARY KEY, rowId INTEGER, rev INTEGER, updatedAt TEXT)`);
                    for (const batch of chunkArray(removedRows, SQLITE_ROW_VERSION_INSERT_BATCH_SIZE)) {
                        const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
                        await runTimed(
                            `INSERT OR IGNORE INTO ${tempTable} (id, rowId, rev, updatedAt) VALUES ${placeholders}`,
                            batch.flat()
                        );
                    }
                    const revGuard = table === 'saved_filters'
                        ? ''
                        : `AND known.rev IS ${table}.rev`;
                    await runTimed(
                        `DELETE FROM ${table}
                         WHERE EXISTS (
                           SELECT 1 FROM ${tempTable} known
                           WHERE known.id = ${table}.id
                             AND (known.rowId IS NULL OR known.rowId = ${table}.rowid)
                             ${revGuard}
                             AND known.updatedAt IS ${table}.updatedAt
                         )`
                    );
                } finally {
                    try {
                        await runTimed(`DROP TABLE ${tempTable}`);
                    } catch (dropError) {
                        logWarn(`Failed to drop temp table ${tempTable}`, {
                            scope: 'sqlite',
                            category: 'storage',
                            error: dropError,
                        });
                    }
                }
            };

            saveStep = 'areas';
            await upsertBatch(
                'areas',
                [
                    'id',
                    'name',
                    'color',
                    'icon',
                    'orderNum',
                    'rev',
                    'revBy',
                    'createdAt',
                    'updatedAt',
                    'deletedAt',
                ],
                data.areas.map((area) => {
                    const createdAt = area.createdAt ?? area.updatedAt ?? nowIso;
                    const updatedAt = area.updatedAt ?? area.createdAt ?? nowIso;
                    return [
                        area.id,
                        area.name,
                        area.color ?? null,
                        area.icon ?? null,
                        area.order,
                        area.rev ?? null,
                        area.revBy ?? null,
                        createdAt,
                        updatedAt,
                        area.deletedAt ?? null,
                    ];
                }),
                `name=excluded.name,
                 color=excluded.color,
                 icon=excluded.icon,
                 orderNum=excluded.orderNum,
                 rev=excluded.rev,
                 revBy=excluded.revBy,
                 createdAt=excluded.createdAt,
                 updatedAt=excluded.updatedAt,
                 deletedAt=excluded.deletedAt
                 WHERE areas.rev IS NULL OR areas.rev <= excluded.rev`,
                200,
                undefined,
                { rev: 5, updatedAt: 8 },
            );

            saveStep = 'projects';
            await upsertBatch(
                'projects',
                [...PROJECT_UPSERT_COLUMNS],
                data.projects.map((project) => [
                    project.id,
                    project.title,
                    project.status,
                    project.color,
                    Number.isFinite(project.order) ? project.order : 0,
                    toJson(project.tagIds ?? []),
                    toBool(project.isSequential),
                    normalizeProjectSequentialScope(project.sequentialScope) ?? null,
                    normalizeProjectTaskSortBy(project.taskSortBy) ?? null,
                    toBool(project.isFocused),
                    project.supportNotes ?? null,
                    toJson(project.attachments),
                    project.dueDate ?? null,
                    project.reviewAt ?? null,
                    project.areaId ?? null,
                    project.areaTitle ?? null,
                    project.rev ?? null,
                    project.revBy ?? null,
                    project.createdAt,
                    project.updatedAt,
                    project.deletedAt ?? null,
                    project.purgedAt ?? null,
                ]),
                PROJECT_UPSERT_UPDATE_CLAUSE,
                200,
                undefined,
                {
                    rev: PROJECT_UPSERT_COLUMNS.indexOf('rev'),
                    updatedAt: PROJECT_UPSERT_COLUMNS.indexOf('updatedAt'),
                },
            );

            const people = Array.isArray(data.people) ? data.people : [];
            saveStep = 'people';
            await upsertBatch(
                'people',
                [
                    'id',
                    'name',
                    'note',
                    'referenceLink',
                    'rev',
                    'revBy',
                    'createdAt',
                    'updatedAt',
                    'deletedAt',
                ],
                people.map((person) => {
                    const createdAt = person.createdAt ?? person.updatedAt ?? nowIso;
                    const updatedAt = person.updatedAt ?? person.createdAt ?? nowIso;
                    return [
                        person.id,
                        person.name,
                        person.note ?? null,
                        person.referenceLink ?? null,
                        person.rev ?? null,
                        person.revBy ?? null,
                        createdAt,
                        updatedAt,
                        person.deletedAt ?? null,
                    ];
                }),
                `name=excluded.name,
                 note=excluded.note,
                 referenceLink=excluded.referenceLink,
                 rev=excluded.rev,
                 revBy=excluded.revBy,
                 createdAt=excluded.createdAt,
                 updatedAt=excluded.updatedAt,
                 deletedAt=excluded.deletedAt
                 WHERE people.rev IS NULL OR people.rev <= excluded.rev`,
                200,
                undefined,
                { rev: 4, updatedAt: 7 },
            );

            saveStep = 'sections';
            await upsertBatch(
                'sections',
                [...SECTION_UPSERT_COLUMNS],
                data.sections.map((section) => [
                    section.id,
                    section.projectId,
                    section.title,
                    section.description ?? null,
                    Number.isFinite(section.order) ? section.order : 0,
                    toBool(section.isCollapsed),
                    section.rev ?? null,
                    section.revBy ?? null,
                    section.createdAt,
                    section.updatedAt,
                    section.deletedAt ?? null,
                    section.deletedAtBeforeProjectArchive ?? null,
                    section.projectArchivedAt ?? null,
                ]),
                SECTION_UPSERT_UPDATE_CLAUSE,
                200,
                undefined,
                {
                    rev: SECTION_UPSERT_COLUMNS.indexOf('rev'),
                    updatedAt: SECTION_UPSERT_COLUMNS.indexOf('updatedAt'),
                },
            );

            saveStep = 'tasks';
            const taskRowEntries = data.tasks.map(getTaskRowEntry);
            await upsertBatch(
                'tasks',
                [...TASK_UPSERT_COLUMNS],
                taskRowEntries.map((entry) => entry.row),
                TASK_UPSERT_UPDATE_CLAUSE,
                200,
                taskRowEntries.map((entry) => entry.fingerprint),
                {
                    rev: TASK_UPSERT_COLUMNS.indexOf('rev'),
                    updatedAt: TASK_UPSERT_COLUMNS.indexOf('updatedAt'),
                },
            );

            saveStep = 'sync-task-ids';
            await syncIds('tasks', data.tasks.map((task) => task.id));
            saveStep = 'sync-section-ids';
            await syncIds('sections', data.sections.map((section) => section.id));
            saveStep = 'sync-project-ids';
            await syncIds('projects', data.projects.map((project) => project.id));
            saveStep = 'sync-area-ids';
            await syncIds('areas', data.areas.map((area) => area.id));
            saveStep = 'sync-people-ids';
            await syncIds('people', people.map((person) => person.id));

            const rawSavedFilters = data.settings?.savedFilters;
            const savedFilters = normalizeSavedFilters(rawSavedFilters);
            saveStep = 'saved-filters';
            await upsertBatch(
                'saved_filters',
                [
                    'id',
                    'name',
                    'icon',
                    'view',
                    'criteria',
                    'sortBy',
                    'sortOrder',
                    'groupBy',
                    'createdAt',
                    'updatedAt',
                    'deletedAt',
                ],
                savedFilters.map((filter) => [
                    filter.id,
                    filter.name,
                    filter.icon ?? null,
                    filter.view,
                    toJson(filter.criteria),
                    filter.sortBy ?? null,
                    filter.sortOrder ?? null,
                    filter.groupBy ?? null,
                    filter.createdAt,
                    filter.updatedAt,
                    filter.deletedAt ?? null,
                ]),
                `name=excluded.name,
                 icon=excluded.icon,
                 view=excluded.view,
                 criteria=excluded.criteria,
                 sortBy=excluded.sortBy,
                 sortOrder=excluded.sortOrder,
                 groupBy=excluded.groupBy,
                 createdAt=excluded.createdAt,
                 updatedAt=excluded.updatedAt,
                 deletedAt=excluded.deletedAt`,
                200,
                undefined,
                { updatedAt: 9 },
            );
            saveStep = 'sync-saved-filter-ids';
            await syncIds('saved_filters', savedFilters.map((filter) => filter.id));

            const settingsForSave = { ...(data.settings ?? {}) };
            if (Array.isArray(rawSavedFilters)) {
                settingsForSave.savedFilters = savedFilters;
            } else {
                delete settingsForSave.savedFilters;
            }

            saveStep = 'settings';
            const settingsJson = toJson(settingsForSave);
            nextSave.settingsJson = settingsJson;
            if (previousSave?.settingsJson !== settingsJson) {
                stats.settingsWritten = true;
                await runTimed(
                    'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
                    [settingsJson]
                );
            }

            saveStep = 'commit';
            const commitStartedAt = Date.now();
            await runTimed('COMMIT');
            stats.commitMs = Date.now() - commitStartedAt;
            this.lastSavedFingerprints = nextSave;
            this.lastKnownRowVersions = nextKnownRows;
            this.lastSaveDataStats = stats;
        } catch (error) {
            await this.client.run('ROLLBACK').catch((rollbackError) => {
                logWarn('SQLite saveData rollback failed', {
                    scope: 'sqlite',
                    category: 'storage',
                    error: rollbackError,
                    context: { step: saveStep },
                });
            });
            logWarn('SQLite saveData failed', {
                scope: 'sqlite',
                category: 'storage',
                error,
                context: buildSqliteSaveFailureContext(data, saveStep),
            });
            throw error;
        }
    }

    // MARK: - Calendar Sync CRUD

    async getCalendarSyncEntry(taskId: string, platform: string): Promise<CalendarSyncEntry | null> {
        await this.ensureSchema();
        const row = await this.client.get<{
            task_id: string;
            calendar_event_id: string;
            calendar_id: string;
            platform: string;
            last_synced_at: string;
        }>('SELECT * FROM calendar_sync WHERE task_id = ? AND platform = ?', [taskId, platform]);
        if (!row) return null;
        return {
            taskId: row.task_id,
            calendarEventId: row.calendar_event_id,
            calendarId: row.calendar_id,
            platform: row.platform,
            lastSyncedAt: row.last_synced_at,
        };
    }

    async upsertCalendarSyncEntry(entry: CalendarSyncEntry): Promise<void> {
        await this.ensureSchema();
        await this.client.run(
            `INSERT INTO calendar_sync (task_id, calendar_event_id, calendar_id, platform, last_synced_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(task_id, platform) DO UPDATE SET
               calendar_event_id = excluded.calendar_event_id,
               calendar_id = excluded.calendar_id,
               last_synced_at = excluded.last_synced_at`,
            [entry.taskId, entry.calendarEventId, entry.calendarId, entry.platform, entry.lastSyncedAt]
        );
    }

    async deleteCalendarSyncEntry(taskId: string, platform: string): Promise<void> {
        await this.ensureSchema();
        await this.client.run(
            'DELETE FROM calendar_sync WHERE task_id = ? AND platform = ?',
            [taskId, platform]
        );
    }

    async getAllCalendarSyncEntries(platform: string): Promise<CalendarSyncEntry[]> {
        await this.ensureSchema();
        const rows = await this.client.all<{
            task_id: string;
            calendar_event_id: string;
            calendar_id: string;
            platform: string;
            last_synced_at: string;
        }>('SELECT * FROM calendar_sync WHERE platform = ?', [platform]);
        return rows.map((row) => ({
            taskId: row.task_id,
            calendarEventId: row.calendar_event_id,
            calendarId: row.calendar_id,
            platform: row.platform,
            lastSyncedAt: row.last_synced_at,
        }));
    }
}
