import schemaFixture from './project-sync-schema.fixture.json';
import type { Project } from './types';
import {
    deriveSqliteColumnEntries,
    sqliteColumnsFromEntries,
    sqliteMigrationColumnsFromEntries,
    type EntityCloudWriteSemantics,
    type EntityFieldNullability,
    type EntitySqliteColumnType,
} from './entity-sync-schema';

export type ProjectSyncFieldSpec = {
    name: keyof Project;
    nullability: EntityFieldNullability;
    cloudSynced: boolean;
    cloudWrite: EntityCloudWriteSemantics;
    sqliteColumn: string | null;
    sqliteOrder: number | null;
    sqliteType: EntitySqliteColumnType | null;
};

type ProjectSyncSchemaFixture = {
    schemaVersion: number;
    fields: ProjectSyncFieldSpec[];
    fixture: Project;
};

const schema = schemaFixture as ProjectSyncSchemaFixture;

export const PROJECT_SYNC_SCHEMA_VERSION = schema.schemaVersion;
export const PROJECT_SYNC_FIELD_SCHEMA: readonly ProjectSyncFieldSpec[] = schema.fields;
export const PROJECT_SYNC_SCHEMA_FIXTURE: Project = schema.fixture;

// Generated SQLite column list + ensureProjectColumns migration list, both derived from
// PROJECT_SYNC_FIELD_SCHEMA above. Lives here (not in sqlite-adapter.ts) for the same reason
// task-sync-schema.ts does: scripts/check-synced-field-parity.ts imports these directly, and
// its "native-schema" CI job runs `bun run schema:check` with no `bun install` step, so
// nothing it imports may pull in a real npm dependency. sqlite-adapter.ts fails that bar (it
// transitively imports `date-fns`); this file and its fixture JSON don't.
const PROJECT_SQLITE_COLUMN_ENTRIES = deriveSqliteColumnEntries(PROJECT_SYNC_FIELD_SCHEMA, 'project-sync-schema');

export const PROJECT_SQLITE_COLUMNS: readonly string[] = sqliteColumnsFromEntries(PROJECT_SQLITE_COLUMN_ENTRIES);
export const PROJECT_SQLITE_MIGRATION_COLUMNS = sqliteMigrationColumnsFromEntries(PROJECT_SQLITE_COLUMN_ENTRIES, 'projects');
