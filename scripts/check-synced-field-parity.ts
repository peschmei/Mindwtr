#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { TASK_SYNC_FIELD_SCHEMA } from '../packages/core/src/task-sync-schema';

type Entity = 'task' | 'project' | 'section';
type Surface = 'cloud' | 'sqlite';

const expectedTaskCloudFields = TASK_SYNC_FIELD_SCHEMA
    .filter((field) => field.cloudKit !== null)
    .map((field) => field.name);
const expectedTaskSqliteFields = Array.from(new Set(
    TASK_SYNC_FIELD_SCHEMA
        .map((field) => field.sqliteColumn)
        .filter((column): column is string => column !== null),
));

const EXPECTED: Record<Entity, Record<Surface, string[]>> = {
    task: {
        cloud: expectedTaskCloudFields,
        sqlite: expectedTaskSqliteFields,
    },
    project: {
        cloud: [
            'title', 'status', 'color', 'order', 'tagIds', 'isSequential', 'sequentialScope',
            'isFocused', 'supportNotes', 'attachments', 'dueDate', 'reviewAt', 'areaId', 'areaTitle',
            'rev', 'revBy', 'createdAt', 'updatedAt', 'deletedAt', 'purgedAt',
        ],
        sqlite: [
            'id', 'title', 'status', 'color', 'orderNum', 'tagIds', 'isSequential', 'sequentialScope',
            'isFocused', 'supportNotes', 'attachments', 'dueDate', 'reviewAt', 'areaId', 'areaTitle',
            'rev', 'revBy', 'createdAt', 'updatedAt', 'deletedAt', 'purgedAt',
        ],
    },
    section: {
        cloud: [
            'projectId', 'title', 'description', 'order', 'isCollapsed', 'rev', 'revBy', 'createdAt',
            'updatedAt', 'deletedAt', 'deletedAtBeforeProjectArchive', 'projectArchivedAt',
        ],
        sqlite: [
            'id', 'projectId', 'title', 'description', 'orderNum', 'isCollapsed', 'rev', 'revBy',
            'createdAt', 'updatedAt', 'deletedAt', 'deletedAtBeforeProjectArchive', 'projectArchivedAt',
        ],
    },
};

const PATHS = {
    coreTypes: 'packages/core/src/types.ts',
    coreSqliteAdapter: 'packages/core/src/sqlite-adapter.ts',
    coreSqliteSchema: 'packages/core/src/sqlite-schema.ts',
    desktopRustSchema: 'apps/desktop/src-tauri/src/lib.rs',
    desktopRustStorage: 'apps/desktop/src-tauri/src/storage.rs',
    swiftMapper: 'apps/mobile/modules/cloudkit-sync/ios/CloudKitRecordMapper.swift',
    objcMapper: 'apps/desktop/src-tauri/src/macos_cloudkit_bridge.m',
};

const read = (path: string) => readFileSync(path, 'utf8');

const unique = (fields: string[], label: string): string[] => {
    const seen = new Set<string>();
    const duplicates = fields.filter((field) => {
        if (seen.has(field)) return true;
        seen.add(field);
        return false;
    });
    if (duplicates.length > 0) {
        throw new Error(`${label} has duplicate fields: ${Array.from(new Set(duplicates)).join(', ')}`);
    }
    return fields;
};

const parseCoreTaskColumns = (source: string): string[] => {
    const match = source.match(/export const TASK_SQLITE_COLUMNS = \[([\s\S]*?)\] as const;/);
    if (!match) throw new Error('Could not find TASK_SQLITE_COLUMNS.');
    return unique(Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1]), 'TASK_SQLITE_COLUMNS');
};

const parseCreateTableColumns = (source: string, table: string): string[] => {
    const match = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    if (!match) throw new Error(`Could not find CREATE TABLE for ${table}.`);
    return unique(match[1]
        .split('\n')
        .map((line) => line.trim().replace(/,$/, ''))
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[0])
        .filter((name) => !name.startsWith('FOREIGN') && !name.startsWith('PRIMARY')),
    `CREATE TABLE ${table}`);
};

const parseRustInsertColumns = (source: string, table: string): string[] => {
    const match = source.match(new RegExp(`INSERT OR REPLACE INTO ${table} \\(([^)]*)\\) VALUES`));
    if (!match) throw new Error(`Could not find Rust INSERT columns for ${table}.`);
    return unique(match[1].split(',').map((column) => column.trim()).filter(Boolean), `Rust INSERT ${table}`);
};

const parseCoreTaskUpdateColumns = (source: string): string[] => {
    const match = source.match(/const TASK_UPSERT_UPDATE_CLAUSE = \x60([\s\S]*?)\x60;/);
    if (!match) throw new Error('Could not find TASK_UPSERT_UPDATE_CLAUSE.');
    return unique(
        Array.from(match[1].matchAll(/^([A-Za-z][A-Za-z0-9]*)=excluded\./gm), (entry) => entry[1]),
        'TASK_UPSERT_UPDATE_CLAUSE',
    );
};

const parseCoreTaskMigrationColumns = (source: string): string[] => {
    const match = source.match(/private async ensureTaskColumns\(\) \{([\s\S]*?)\n    \}/);
    if (!match) throw new Error('Could not find ensureTaskColumns.');
    return unique(
        Array.from(match[1].matchAll(/\{ name: '([^']+)', sql:/g), (entry) => entry[1]),
        'ensureTaskColumns',
    );
};

type ParsedTaskField = {
    name: string;
    nullability: 'required' | 'optional' | 'optional-nullable';
};

const parseTaskInterfaceFields = (source: string): ParsedTaskField[] => {
    const match = source.match(/export interface Task \{([\s\S]*?)\n\}/);
    if (!match) throw new Error('Could not find Task interface.');
    return match[1]
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .map((line) => line.match(/^([A-Za-z][A-Za-z0-9]*)(\?)?:\s*([^;]+);$/))
        .filter((entry): entry is RegExpMatchArray => entry !== null)
        .map((entry) => ({
            name: entry[1],
            nullability: entry[2]
                ? /\bnull\b/.test(entry[3])
                    ? 'optional-nullable' as const
                    : 'optional' as const
                : 'required' as const,
        }));
};

type NativeTaskFieldSpec = {
    jsKey: string;
    storageKey: string;
    kind: string;
};

const SWIFT_KIND_MAP: Record<string, string> = {
    string: 'string',
    date: 'date',
    jsonString: 'json-string',
    bool: 'boolean',
    int: 'integer',
    stringArray: 'string-array',
};

const OBJC_KIND_MAP: Record<string, string> = {
    String: 'string',
    Date: 'date',
    JsonString: 'json-string',
    Bool: 'boolean',
    Int: 'integer',
    StringArray: 'string-array',
};

const parseSwiftTaskFieldSpecs = (source: string): NativeTaskFieldSpec[] => {
    const match = source.match(/private static let taskFieldSpecs: \[FieldSpec\] = \[([\s\S]*?)\n    \]/);
    if (!match) throw new Error('Could not find Swift taskFieldSpecs.');
    const specs = Array.from(
        match[1].matchAll(/FieldSpec\(jsKey: "([^"]+)", ckKey: "([^"]+)", kind: \.([A-Za-z]+)\)/g),
        (entry) => ({
            jsKey: entry[1],
            storageKey: entry[2],
            kind: SWIFT_KIND_MAP[entry[3]] ?? entry[3],
        }),
    );
    unique(specs.map((spec) => spec.jsKey), 'Swift taskFieldSpecs');
    return specs;
};

const parseObjcTaskFieldSpecs = (source: string): NativeTaskFieldSpec[] => {
    const match = source.match(/static const MWFieldSpec kTaskFields\[\] = \{([\s\S]*?)\n\};/);
    if (!match) throw new Error('Could not find ObjC kTaskFields.');
    const specs = Array.from(
        match[1].matchAll(/\{"([^"]+)",\s*"([^"]+)",\s*MWFieldKind([A-Za-z]+)\}/g),
        (entry) => ({
            jsKey: entry[1],
            storageKey: entry[2],
            kind: OBJC_KIND_MAP[entry[3]] ?? entry[3],
        }),
    );
    unique(specs.map((spec) => spec.jsKey), 'ObjC kTaskFields');
    return specs;
};

const parseSwiftFields = (source: string, entity: Entity): string[] => {
    const name = `${entity}FieldSpecs`;
    const match = source.match(new RegExp(`private static let ${name}: \\[FieldSpec\\] = \\[([\\s\\S]*?)\\n    \\]`));
    if (!match) throw new Error(`Could not find Swift ${name}.`);
    return unique(Array.from(match[1].matchAll(/jsKey: "([^"]+)"/g), (entry) => entry[1]), `Swift ${name}`);
};

const parseObjcFields = (source: string, entity: Entity): string[] => {
    const name = `k${entity[0].toUpperCase()}${entity.slice(1)}Fields`;
    const match = source.match(new RegExp(`static const MWFieldSpec ${name}\\[\\] = \\{([\\s\\S]*?)\\n\\};`));
    if (!match) throw new Error(`Could not find ObjC ${name}.`);
    return unique(Array.from(match[1].matchAll(/\{"([^"]+)"/g), (entry) => entry[1]), `ObjC ${name}`);
};

const compareSet = (label: string, actual: string[], expected: string[]): string[] => {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((field) => !actualSet.has(field));
    const extra = actual.filter((field) => !expectedSet.has(field));
    if (missing.length === 0 && extra.length === 0) return [];
    const lines = [`${label}:`];
    if (missing.length > 0) lines.push(`  missing: ${missing.join(', ')}`);
    if (extra.length > 0) lines.push(`  extra: ${extra.join(', ')}`);
    return lines;
};

const compareTaskInterface = (source: string): string[] => {
    const actual = parseTaskInterfaceFields(source);
    unique(actual.map((field) => field.name), 'Task interface');
    const failures = compareSet(
        'core Task interface',
        actual.map((field) => field.name),
        TASK_SYNC_FIELD_SCHEMA.map((field) => field.name),
    );
    const actualByName = new Map(actual.map((field) => [field.name, field]));
    const mismatches = TASK_SYNC_FIELD_SCHEMA
        .filter((field) => actualByName.get(field.name)?.nullability !== field.nullability)
        .map((field) => {
            const actualNullability = actualByName.get(field.name)?.nullability ?? 'missing';
            return field.name + ' expected ' + field.nullability + ', got ' + actualNullability;
        });
    if (mismatches.length > 0) {
        failures.push('core Task interface nullability:');
        failures.push('  ' + mismatches.join('; '));
    }
    return failures;
};

const compareNativeTaskFieldSpecs = (
    label: string,
    actual: NativeTaskFieldSpec[],
): string[] => {
    const expected = TASK_SYNC_FIELD_SCHEMA.flatMap((field) => (
        field.cloudKit
            ? [{
                jsKey: field.name,
                storageKey: field.cloudKit.key,
                kind: field.cloudKit.kind,
            }]
            : []
    ));
    const failures = compareSet(
        label,
        actual.map((field) => field.jsKey),
        expected.map((field) => field.jsKey),
    );
    const actualByName = new Map(actual.map((field) => [field.jsKey, field]));
    const mismatches = expected
        .filter((field) => {
            const actualField = actualByName.get(field.jsKey);
            return actualField
                && (actualField.storageKey !== field.storageKey || actualField.kind !== field.kind);
        })
        .map((field) => {
            const actualField = actualByName.get(field.jsKey)!;
            return field.jsKey
                + ' expected ' + field.storageKey + '/' + field.kind
                + ', got ' + actualField.storageKey + '/' + actualField.kind;
        });
    if (mismatches.length > 0) {
        failures.push(label + ' storage mapping:');
        failures.push('  ' + mismatches.join('; '));
    }
    return failures;
};

const failures: string[] = [];

const coreTypes = read(PATHS.coreTypes);
const coreSqliteAdapter = read(PATHS.coreSqliteAdapter);
const coreSqliteSchema = read(PATHS.coreSqliteSchema);
const desktopRustSchema = read(PATHS.desktopRustSchema);
const desktopRustStorage = read(PATHS.desktopRustStorage);
const swiftMapper = read(PATHS.swiftMapper);
const objcMapper = read(PATHS.objcMapper);

failures.push(...compareTaskInterface(coreTypes));
failures.push(...compareSet('core TASK_SQLITE_COLUMNS', parseCoreTaskColumns(coreSqliteAdapter), EXPECTED.task.sqlite));
failures.push(...compareSet(
    'core TASK_UPSERT_UPDATE_CLAUSE',
    parseCoreTaskUpdateColumns(coreSqliteAdapter),
    EXPECTED.task.sqlite.filter((field) => field !== 'id'),
));
failures.push(...compareSet(
    'core ensureTaskColumns',
    parseCoreTaskMigrationColumns(coreSqliteAdapter),
    EXPECTED.task.sqlite.filter((field) => !['id', 'title', 'status'].includes(field)),
));
failures.push(...compareNativeTaskFieldSpecs(
    'iOS CloudKit task fields',
    parseSwiftTaskFieldSpecs(swiftMapper),
));
failures.push(...compareNativeTaskFieldSpecs(
    'macOS CloudKit task fields',
    parseObjcTaskFieldSpecs(objcMapper),
));

for (const entity of ['task', 'project', 'section'] as const) {
    const table = `${entity}s`;
    const expectedSqlite = EXPECTED[entity].sqlite;
    const expectedCloud = EXPECTED[entity].cloud;

    failures.push(...compareSet(`core SQLite schema ${table}`, parseCreateTableColumns(coreSqliteSchema, table), expectedSqlite));
    failures.push(...compareSet(`desktop Rust schema ${table}`, parseCreateTableColumns(desktopRustSchema, table), expectedSqlite));
    failures.push(...compareSet(`desktop Rust storage INSERT ${table}`, parseRustInsertColumns(desktopRustStorage, table), expectedSqlite));
    failures.push(...compareSet(`iOS CloudKit ${entity} fields`, parseSwiftFields(swiftMapper, entity), expectedCloud));
    failures.push(...compareSet(`macOS CloudKit ${entity} fields`, parseObjcFields(objcMapper, entity), expectedCloud));
}

if (failures.length > 0) {
    console.error('Synced field parity check failed. Update all schema/mapper field lists together.');
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log('Synced field parity check passed.');
