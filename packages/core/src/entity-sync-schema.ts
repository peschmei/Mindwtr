// Shared, zero-external-dependency building blocks for the per-entity generative sync-field
// schemas (project-sync-schema.ts, section-sync-schema.ts). Mirrors the derivation logic
// task-sync-schema.ts introduced for tasks, generalized so it isn't copy-pasted per entity.
//
// Nothing in this file may import a real npm dependency: scripts/check-synced-field-parity.ts
// (via project-sync-schema.ts / section-sync-schema.ts) runs in a "native-schema" CI job on a
// fresh checkout with no `bun install` step.

export type EntityFieldNullability = 'required' | 'optional' | 'optional-nullable';

// Whether a field can be written through the cloud API's generic create/patch prop bag:
// 'create-patch' = writable at both creation and patch time; 'patch' = writable via patch
// only (creation uses a dedicated param, or the field is never legitimately set at creation
// time, e.g. deletedAt); 'managed' = never client-writable through this mechanism.
export type EntityCloudWriteSemantics = 'create-patch' | 'patch' | 'managed';

export type EntitySqliteColumnType = 'TEXT' | 'INTEGER';

export type EntitySyncFieldSpec = {
    name: string;
    nullability: EntityFieldNullability;
    // Project/section CloudKit mappers (Swift/ObjC) are parity-checked by field name only
    // (no per-field storage-key/kind round-trip the way tasks need — see
    // TaskCloudKitFieldSpec in task-sync-schema.ts), so a boolean is enough here.
    cloudSynced: boolean;
    cloudWrite: EntityCloudWriteSemantics;
    sqliteColumn: string | null;
    /**
     * Position of `sqliteColumn` in the generated column list / upsert clause / migration
     * list. Required whenever sqliteColumn is set. SQL column order is load-bearing for
     * row-building call sites that zip the generated column list with positional row values.
     */
    sqliteOrder: number | null;
    /** SQL type for the ALTER TABLE migration. Null for base columns that ship in the
     *  CREATE TABLE itself and therefore never appear in the migration list. */
    sqliteType: EntitySqliteColumnType | null;
};

export type EntitySqliteColumnEntry = {
    column: string;
    order: number;
    sqlType: EntitySqliteColumnType | null;
};

// Derives the ordered, deduplicated-by-column-name list backing both the generated column
// list and the migration list, from a field schema. Fields that share a `sqliteColumn`
// collapse to one entry, keeping the position of whichever field is declared first.
export function deriveSqliteColumnEntries(
    fields: readonly EntitySyncFieldSpec[],
    schemaLabel: string,
): EntitySqliteColumnEntry[] {
    const seen = new Set<string>();
    const entries: EntitySqliteColumnEntry[] = [];
    for (const field of fields) {
        if (field.sqliteColumn === null || seen.has(field.sqliteColumn)) continue;
        if (field.sqliteOrder === null) {
            throw new Error(`${schemaLabel}: "${field.name}" declares sqliteColumn without sqliteOrder`);
        }
        seen.add(field.sqliteColumn);
        entries.push({ column: field.sqliteColumn, order: field.sqliteOrder, sqlType: field.sqliteType });
    }
    return entries.sort((a, b) => a.order - b.order);
}

export function sqliteColumnsFromEntries(entries: readonly EntitySqliteColumnEntry[]): readonly string[] {
    return entries.map((entry) => entry.column);
}

// The migration list an ensure*Columns() startup routine runs: every synced column except
// the base ones that ship in the CREATE TABLE itself (sqlType === null).
export function sqliteMigrationColumnsFromEntries(
    entries: readonly EntitySqliteColumnEntry[],
    table: string,
): readonly { name: string; sql: string }[] {
    return entries
        .filter((entry) => entry.sqlType !== null)
        .map((entry) => ({ name: entry.column, sql: `ALTER TABLE ${table} ADD COLUMN ${entry.column} ${entry.sqlType}` }));
}
