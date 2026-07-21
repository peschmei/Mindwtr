import schemaFixture from './section-sync-schema.fixture.json';
import type { Section } from './types';
import {
    deriveSqliteColumnEntries,
    sqliteColumnsFromEntries,
    sqliteMigrationColumnsFromEntries,
    type EntityCloudWriteSemantics,
    type EntityFieldNullability,
    type EntitySqliteColumnType,
} from './entity-sync-schema';

export type SectionSyncFieldSpec = {
    name: keyof Section;
    nullability: EntityFieldNullability;
    cloudSynced: boolean;
    cloudWrite: EntityCloudWriteSemantics;
    sqliteColumn: string | null;
    sqliteOrder: number | null;
    sqliteType: EntitySqliteColumnType | null;
};

type SectionSyncSchemaFixture = {
    schemaVersion: number;
    fields: SectionSyncFieldSpec[];
    fixture: Section;
};

const schema = schemaFixture as SectionSyncSchemaFixture;

export const SECTION_SYNC_SCHEMA_VERSION = schema.schemaVersion;
export const SECTION_SYNC_FIELD_SCHEMA: readonly SectionSyncFieldSpec[] = schema.fields;
export const SECTION_SYNC_SCHEMA_FIXTURE: Section = schema.fixture;

// Generated SQLite column list + ensureSectionColumns migration list — see the equivalent
// comment in project-sync-schema.ts for why this lives here rather than sqlite-adapter.ts.
const SECTION_SQLITE_COLUMN_ENTRIES = deriveSqliteColumnEntries(SECTION_SYNC_FIELD_SCHEMA, 'section-sync-schema');

export const SECTION_SQLITE_COLUMNS: readonly string[] = sqliteColumnsFromEntries(SECTION_SQLITE_COLUMN_ENTRIES);
export const SECTION_SQLITE_MIGRATION_COLUMNS = sqliteMigrationColumnsFromEntries(SECTION_SQLITE_COLUMN_ENTRIES, 'sections');
