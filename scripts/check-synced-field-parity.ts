#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Every import in this script (and everything it transitively imports) must resolve
// without `bun install`: the "native-schema" CI job runs `bun run schema:check` on a
// fresh checkout with no install step. That's why these come from task-sync-schema.ts
// (TASK_SQLITE_COLUMNS/TASK_SQLITE_MIGRATION_COLUMNS live there, not in sqlite-adapter.ts,
// specifically so this script can import them — sqlite-adapter.ts transitively pulls in
// `date-fns` via recurrence.ts/saved-filters.ts and would break this job) and from
// sync-signatures.ts / server-config.ts, neither of which has a real npm dependency.
import {
    TASK_SQLITE_COLUMNS,
    TASK_SQLITE_MIGRATION_COLUMNS,
    TASK_SYNC_FIELD_SCHEMA,
    TASK_SYNC_SCHEMA_FIXTURE,
} from '../packages/core/src/task-sync-schema';
import { PROJECT_SYNC_FIELD_SCHEMA } from '../packages/core/src/project-sync-schema';
import { SECTION_SYNC_FIELD_SCHEMA } from '../packages/core/src/section-sync-schema';
import {
    normalizeTaskForContentComparison,
    TASK_CONTENT_COMPARISON_EXCLUDED_KEYS,
} from '../packages/core/src/sync-signatures';
import { CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS } from '../apps/cloud/src/server-config';

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

// Same derivation as the task lists above, generalized: every entity's EXPECTED cloud/sqlite
// field list comes from its own descriptor module, never a hand-maintained literal here.
const expectedCloudFields = (schema: readonly { name: string; cloudSynced: boolean }[]): string[] =>
    schema.filter((field) => field.cloudSynced).map((field) => field.name);
const expectedSqliteFields = (schema: readonly { sqliteColumn: string | null }[]): string[] => Array.from(new Set(
    schema
        .map((field) => field.sqliteColumn)
        .filter((column): column is string => column !== null),
));

const EXPECTED: Record<Entity, Record<Surface, string[]>> = {
    task: {
        cloud: expectedTaskCloudFields,
        sqlite: expectedTaskSqliteFields,
    },
    project: {
        cloud: expectedCloudFields(PROJECT_SYNC_FIELD_SCHEMA),
        sqlite: expectedSqliteFields(PROJECT_SYNC_FIELD_SCHEMA),
    },
    section: {
        cloud: expectedCloudFields(SECTION_SYNC_FIELD_SCHEMA),
        sqlite: expectedSqliteFields(SECTION_SYNC_FIELD_SCHEMA),
    },
};

const PATHS = {
    coreTypes: 'packages/core/src/types.ts',
    coreSqliteSchema: 'packages/core/src/sqlite-schema.ts',
    desktopRustSchema: 'apps/desktop/src-tauri/src/lib.rs',
    desktopRustStorage: 'apps/desktop/src-tauri/src/storage.rs',
    swiftMapper: 'apps/mobile/modules/cloudkit-sync/ios/CloudKitRecordMapper.swift',
    objcMapper: 'apps/desktop/src-tauri/src/macos_cloudkit_bridge.m',
    mcpQueries: 'apps/mcp-server/src/queries.ts',
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

// TASK_SQLITE_COLUMNS, TASK_UPSERT_UPDATE_CLAUSE, and the ensureTaskColumns migration
// list are now generated from TASK_SYNC_FIELD_SCHEMA in sqlite-adapter.ts itself (same
// module-load pass, same source array), so they can no longer drift from each other
// independently — imported directly below instead of regex-parsed from source text.
// TASK_UPSERT_UPDATE_CLAUSE has no standalone check for the same reason: it's built from
// TASK_SQLITE_COLUMNS by construction (packages/core/src/sqlite-adapter.ts), verified by
// a snapshot-equality test in task-sync-schema.test.ts.
const coreTaskUpdateColumns = (): string[] => unique(
    TASK_SQLITE_COLUMNS.filter((column) => column !== 'id'),
    'TASK_UPSERT_UPDATE_CLAUSE',
);

const coreTaskMigrationColumns = (): string[] => unique(
    TASK_SQLITE_MIGRATION_COLUMNS.map((entry) => entry.name),
    'ensureTaskColumns',
);

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
    const match = source.match(/private static let taskFieldSpecs: \[FieldSpec\] = \[([\s\S]*?)\n {4}\]/);
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
    unique(specs.map((spec) => spec.storageKey), 'Swift taskFieldSpecs storage keys');
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
    unique(specs.map((spec) => spec.storageKey), 'ObjC kTaskFields storage keys');
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

const assertSuperset = (label: string, actual: Iterable<string>, required: string[]): string[] => {
    const actualSet = new Set(actual);
    const missing = required.filter((field) => !actualSet.has(field));
    return missing.length > 0 ? [`${label} missing: ${missing.join(', ')}`] : [];
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

const requireSourcePattern = (label: string, source: string, pattern: RegExp): string[] => (
    pattern.test(source) ? [] : [`${label} is not derived from the synced SQLite schema.`]
);

const parseMcpProjectMapperFields = (source: string): string[] => {
    const match = source.match(/const mapProjectRow = \(row: ProjectSqliteRow\): Project => \(\{([\s\S]*?)\n\}\);/);
    if (!match) throw new Error('Could not find MCP mapProjectRow.');
    return unique(
        Array.from(match[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm), (entry) => entry[1]),
        'MCP mapProjectRow',
    );
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

const encodeNativeFixtureValue = (kind: string, value: unknown): unknown => {
    switch (kind) {
        case 'string':
        case 'date':
            return typeof value === 'string' ? value : undefined;
        case 'integer':
            return typeof value === 'number' ? Math.trunc(value) : undefined;
        case 'boolean':
            return typeof value === 'boolean' ? (value ? 1 : 0) : undefined;
        case 'string-array':
            return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
                ? [...value]
                : undefined;
        case 'json-string':
            return typeof value === 'string' ? value : JSON.stringify(value);
        default:
            return undefined;
    }
};

const decodeNativeFixtureValue = (kind: string, value: unknown): unknown => {
    switch (kind) {
        case 'boolean':
            return value === 1;
        case 'json-string':
            if (typeof value !== 'string') return undefined;
            try {
                return JSON.parse(value);
            } catch {
                return value;
            }
        default:
            return value;
    }
};

const fixtureValuesEqual = (actual: unknown, expected: unknown): boolean => (
    JSON.stringify(actual) === JSON.stringify(expected)
);

const compareNativeTaskFixtureRoundTrip = (
    label: string,
    specs: NativeTaskFieldSpec[],
): string[] => {
    const fixture = TASK_SYNC_SCHEMA_FIXTURE as unknown as Record<string, unknown>;
    const failures: string[] = [];
    const stored = new Map<string, unknown>();

    for (const spec of specs) {
        if (!Object.prototype.hasOwnProperty.call(fixture, spec.jsKey)) {
            failures.push(`  fixture missing ${spec.jsKey}`);
            continue;
        }
        const encoded = encodeNativeFixtureValue(spec.kind, fixture[spec.jsKey]);
        if (encoded === undefined) {
            failures.push(`  ${spec.jsKey} cannot encode as ${spec.kind}`);
            continue;
        }
        stored.set(spec.storageKey, encoded);
    }

    const roundTrip: Record<string, unknown> = { id: fixture.id };
    for (const spec of specs) {
        if (!stored.has(spec.storageKey)) continue;
        roundTrip[spec.jsKey] = decodeNativeFixtureValue(spec.kind, stored.get(spec.storageKey));
    }

    for (const field of TASK_SYNC_FIELD_SCHEMA.filter((entry) => entry.cloudKit !== null)) {
        if (!fixtureValuesEqual(roundTrip[field.name], fixture[field.name])) {
            failures.push(
                `  ${field.name} expected ${JSON.stringify(fixture[field.name])}, got ${JSON.stringify(roundTrip[field.name])}`,
            );
        }
    }

    return failures.length > 0 ? [label + ' fixture round-trip:', ...failures] : [];
};

const runCommand = (label: string, command: string, args: string[]): string[] => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) return [`${label}: ${result.error.message}`];
    if (result.status === 0) return [];

    const output = [result.stdout, result.stderr]
        .filter((value): value is string => Boolean(value?.trim()))
        .join('\n')
        .trim();
    return [`${label} failed${result.status === null ? '' : ` (exit ${result.status})`}:`, output || '  no output'];
};

const runNativeTaskMapperFixtureChecks = (): string[] => {
    if (process.platform !== 'darwin') return [];

    const fixturePath = resolve('packages/core/src/task-sync-schema.fixture.json');
    const fixtureFields = TASK_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudKit !== null)
        .map((field) => field.name);
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'mindwtr-task-mapper-'));
    const failures: string[] = [];

    try {
        const swiftBinary = join(temporaryDirectory, 'swift-task-mapper-check');
        const swiftCompileFailures = runCommand('compile Swift task mapper fixture', 'xcrun', [
            '--sdk', 'macosx', 'swiftc',
            resolve(PATHS.swiftMapper),
            resolve('scripts/swift-task-mapper-fixture-check.swift'),
            '-o', swiftBinary,
        ]);
        failures.push(...swiftCompileFailures);
        if (swiftCompileFailures.length === 0) {
            failures.push(...runCommand(
                'Swift task mapper fixture round-trip',
                swiftBinary,
                [fixturePath, ...fixtureFields],
            ));
        }

        const objcBinary = join(temporaryDirectory, 'objc-task-mapper-check');
        const objcCompileFailures = runCommand('compile Objective-C task mapper fixture', 'xcrun', [
            '--sdk', 'macosx', 'clang',
            '-fobjc-arc',
            '-fblocks',
            '-DMINDWTR_NATIVE_MAPPER_FIXTURE_CHECK',
            resolve(PATHS.objcMapper),
            resolve('scripts/objc-task-mapper-fixture-check.m'),
            '-framework', 'Foundation',
            '-framework', 'AppKit',
            '-framework', 'CloudKit',
            '-o', objcBinary,
        ]);
        failures.push(...objcCompileFailures);
        if (objcCompileFailures.length === 0) {
            failures.push(...runCommand(
                'Objective-C task mapper fixture round-trip',
                objcBinary,
                [fixturePath, ...fixtureFields],
            ));
        }
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    return failures;
};

const failures: string[] = [];

const coreTypes = read(PATHS.coreTypes);
const coreSqliteSchema = read(PATHS.coreSqliteSchema);
const desktopRustSchema = read(PATHS.desktopRustSchema);
const desktopRustStorage = read(PATHS.desktopRustStorage);
const swiftMapper = read(PATHS.swiftMapper);
const objcMapper = read(PATHS.objcMapper);
const mcpQueries = read(PATHS.mcpQueries);
const swiftTaskFieldSpecs = parseSwiftTaskFieldSpecs(swiftMapper);
const objcTaskFieldSpecs = parseObjcTaskFieldSpecs(objcMapper);

failures.push(...compareTaskInterface(coreTypes));

// Check: every Task field the schema knows about must be tracked in
// sync-signatures.ts, either as a content-comparable key (returned by
// normalizeTaskForContentComparison) or as one of the deliberately-excluded
// keys (TaskContentComparisonExcludedKey). A new Task field that lands in
// neither list would silently never take part in conflict-signature
// comparison — this must fail loudly instead.
const syncSignatureComparableKeys = Object.keys(
    normalizeTaskForContentComparison(TASK_SYNC_SCHEMA_FIXTURE),
);
const syncSignatureExcludedKeys: readonly string[] = TASK_CONTENT_COMPARISON_EXCLUDED_KEYS;
const syncSignatureTaskFieldUnion = Array.from(new Set([
    ...syncSignatureComparableKeys,
    ...syncSignatureExcludedKeys,
]));
// Fields the schema declares but that sync-signatures.ts is deliberately not
// expected to track. Empty today — every schema field is tracked either as a
// comparable key or in TaskContentComparisonExcludedKey. Add an entry here
// (with a one-line reason) only once a real, defensible gap is found; do not
// use this to silence an actual drift.
const SYNC_SIGNATURE_FIELD_UNION_EXCEPTIONS: string[] = [];
failures.push(...compareSet(
    'sync-signatures.ts task field union',
    syncSignatureTaskFieldUnion,
    TASK_SYNC_FIELD_SCHEMA
        .map((field) => field.name)
        .filter((name) => !SYNC_SIGNATURE_FIELD_UNION_EXCEPTIONS.includes(name)),
));

// Check: CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS must be a superset of the fields
// the schema marks as writable via a cloud API patch (cloudWrite
// 'create-patch' or 'patch'), so a future schema field promoted to
// client-writable can't be forgotten on the server allowlist.
const requiredCloudTaskPatchFields = Array.from(new Set(
    TASK_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
        .map((field) => field.name)
));
failures.push(...assertSuperset(
    'cloud CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS',
    CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS as Iterable<string>,
    requiredCloudTaskPatchFields,
));
failures.push(...compareSet('core TASK_SQLITE_COLUMNS', Array.from(TASK_SQLITE_COLUMNS), EXPECTED.task.sqlite));
failures.push(...compareSet(
    'core TASK_UPSERT_UPDATE_CLAUSE',
    coreTaskUpdateColumns(),
    EXPECTED.task.sqlite.filter((field) => field !== 'id'),
));
failures.push(...compareSet(
    'core ensureTaskColumns',
    coreTaskMigrationColumns(),
    EXPECTED.task.sqlite.filter((field) => !['id', 'title', 'status'].includes(field)),
));
failures.push(...compareNativeTaskFieldSpecs(
    'iOS CloudKit task fields',
    swiftTaskFieldSpecs,
));
failures.push(...compareNativeTaskFieldSpecs(
    'macOS CloudKit task fields',
    objcTaskFieldSpecs,
));
failures.push(...compareNativeTaskFixtureRoundTrip('iOS CloudKit task mapper', swiftTaskFieldSpecs));
failures.push(...compareNativeTaskFixtureRoundTrip('macOS CloudKit task mapper', objcTaskFieldSpecs));
failures.push(...runNativeTaskMapperFixtureChecks());

// MCP read tools promise core Task/Project entities. Keep their SELECT lists
// schema-derived, and ensure the manual Project row mapper exposes every core
// project field so a newly persisted field cannot silently disappear there.
failures.push(...requireSourcePattern(
    'MCP task projection',
    mcpQueries,
    /const BASE_TASK_COLUMNS = \[\.\.\.TASK_SQLITE_COLUMNS\];/,
));
failures.push(...requireSourcePattern(
    'MCP project projection',
    mcpQueries,
    /const BASE_PROJECT_COLUMNS = \[\.\.\.PROJECT_SQLITE_COLUMNS\];/,
));
failures.push(...assertSuperset(
    'MCP project row mapper',
    parseMcpProjectMapperFields(mcpQueries),
    PROJECT_SYNC_FIELD_SCHEMA.map((field) => String(field.name)),
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
