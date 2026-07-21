import { describe, expect, it } from 'vitest';
import {
    PROJECT_SQLITE_COLUMNS,
    PROJECT_SQLITE_MIGRATION_COLUMNS,
    PROJECT_UPSERT_UPDATE_CLAUSE,
} from './sqlite-adapter';
import {
    PROJECT_SYNC_FIELD_SCHEMA,
    PROJECT_SYNC_SCHEMA_FIXTURE,
    PROJECT_SYNC_SCHEMA_VERSION,
} from './project-sync-schema';

// Frozen snapshot of the hand-written literals these lists replaced (as of the
// generative-schema refactor, 2026-07-20; parity-entities follow-up to f7ac5a0a). These
// arrays must NEVER be updated to match a code change — they exist to prove today's derived
// output is byte-identical (columns/migrations) or functionally identical (update clause,
// which is whitespace-reformatted but covers the same columns in the same order) to
// yesterday's literal. A legitimate schema change (a new synced field) should grow
// PROJECT_SYNC_FIELD_SCHEMA and leave these arrays alone; the mismatch this then produces
// here is expected and this block should be deleted, not "fixed", once that lands.
const PRE_REFACTOR_PROJECT_SQLITE_COLUMNS = [
    'id', 'title', 'status', 'color', 'orderNum', 'tagIds', 'isSequential', 'sequentialScope',
    'taskSortBy', 'isFocused', 'supportNotes', 'attachments', 'dueDate', 'reviewAt', 'areaId',
    'areaTitle', 'rev', 'revBy', 'createdAt', 'updatedAt', 'deletedAt', 'purgedAt',
];

const PRE_REFACTOR_PROJECT_UPSERT_UPDATE_CLAUSE = `title=excluded.title,
status=excluded.status,
color=excluded.color,
orderNum=excluded.orderNum,
tagIds=excluded.tagIds,
isSequential=excluded.isSequential,
sequentialScope=excluded.sequentialScope,
taskSortBy=excluded.taskSortBy,
isFocused=excluded.isFocused,
supportNotes=excluded.supportNotes,
attachments=excluded.attachments,
dueDate=excluded.dueDate,
reviewAt=excluded.reviewAt,
areaId=excluded.areaId,
areaTitle=excluded.areaTitle,
rev=excluded.rev,
revBy=excluded.revBy,
createdAt=excluded.createdAt,
updatedAt=excluded.updatedAt,
deletedAt=excluded.deletedAt,
purgedAt=excluded.purgedAt
WHERE projects.rev IS NULL OR projects.rev <= excluded.rev`;

const PRE_REFACTOR_ENSURE_PROJECT_COLUMNS_NAMES = [
    'orderNum', 'tagIds', 'isSequential', 'sequentialScope', 'taskSortBy', 'isFocused',
    'supportNotes', 'attachments', 'dueDate', 'reviewAt', 'areaId', 'areaTitle', 'rev', 'revBy',
    'createdAt', 'updatedAt', 'deletedAt', 'purgedAt',
];

const PRE_REFACTOR_ENSURE_PROJECT_COLUMNS_SQL = [
    'ALTER TABLE projects ADD COLUMN orderNum INTEGER',
    'ALTER TABLE projects ADD COLUMN tagIds TEXT',
    'ALTER TABLE projects ADD COLUMN isSequential INTEGER',
    'ALTER TABLE projects ADD COLUMN sequentialScope TEXT',
    'ALTER TABLE projects ADD COLUMN taskSortBy TEXT',
    'ALTER TABLE projects ADD COLUMN isFocused INTEGER',
    'ALTER TABLE projects ADD COLUMN supportNotes TEXT',
    'ALTER TABLE projects ADD COLUMN attachments TEXT',
    'ALTER TABLE projects ADD COLUMN dueDate TEXT',
    'ALTER TABLE projects ADD COLUMN reviewAt TEXT',
    'ALTER TABLE projects ADD COLUMN areaId TEXT',
    'ALTER TABLE projects ADD COLUMN areaTitle TEXT',
    'ALTER TABLE projects ADD COLUMN rev INTEGER',
    'ALTER TABLE projects ADD COLUMN revBy TEXT',
    'ALTER TABLE projects ADD COLUMN createdAt TEXT',
    'ALTER TABLE projects ADD COLUMN updatedAt TEXT',
    'ALTER TABLE projects ADD COLUMN deletedAt TEXT',
    'ALTER TABLE projects ADD COLUMN purgedAt TEXT',
];

const sorted = (values: Iterable<string>): string[] => Array.from(values).sort();

describe('Project sync schema contract', () => {
    const fieldNames = PROJECT_SYNC_FIELD_SCHEMA.map((field) => field.name);

    it('has one unique entry and fixture value for every Project field', () => {
        expect(new Set(fieldNames).size).toBe(fieldNames.length);
        expect(Object.keys(PROJECT_SYNC_SCHEMA_FIXTURE).sort()).toEqual(sorted(fieldNames));
        expect(PROJECT_SYNC_SCHEMA_VERSION).toBeGreaterThan(0);
    });

    it('keeps SQLite columns exhaustive', () => {
        const expectedColumns = new Set(
            PROJECT_SYNC_FIELD_SCHEMA
                .map((field) => field.sqliteColumn)
                .filter((column): column is string => column !== null),
        );
        expect(sorted(PROJECT_SQLITE_COLUMNS)).toEqual(sorted(expectedColumns));
    });

    // Snapshot-equality guards: PROJECT_SQLITE_COLUMNS, PROJECT_SQLITE_MIGRATION_COLUMNS, and
    // PROJECT_UPSERT_UPDATE_CLAUSE are all generated from PROJECT_SYNC_FIELD_SCHEMA now
    // instead of hand-maintained literals.
    it('derives PROJECT_SQLITE_COLUMNS identical to the pre-refactor literal, in order', () => {
        expect(PROJECT_SQLITE_COLUMNS).toEqual(PRE_REFACTOR_PROJECT_SQLITE_COLUMNS);
    });

    it('derives PROJECT_UPSERT_UPDATE_CLAUSE identical to the pre-refactor literal', () => {
        expect(PROJECT_UPSERT_UPDATE_CLAUSE).toBe(PRE_REFACTOR_PROJECT_UPSERT_UPDATE_CLAUSE);
    });

    it('derives the ensureProjectColumns migration list identical to the pre-refactor literal, in order', () => {
        expect(PROJECT_SQLITE_MIGRATION_COLUMNS.map((entry) => entry.name)).toEqual(PRE_REFACTOR_ENSURE_PROJECT_COLUMNS_NAMES);
        expect(PROJECT_SQLITE_MIGRATION_COLUMNS.map((entry) => entry.sql)).toEqual(PRE_REFACTOR_ENSURE_PROJECT_COLUMNS_SQL);
    });
});
