import schemaFixture from './task-sync-schema.fixture.json';
import type { Task } from './types';

export type TaskFieldSyncSemantics =
    | 'identity'
    | 'content'
    | 'archive-metadata'
    | 'revision-metadata'
    | 'tombstone'
    | 'order'
    | 'legacy-alias';

export type TaskFieldNullability = 'required' | 'optional' | 'optional-nullable';
export type TaskFieldSignatureSemantics = 'content' | 'ignored' | 'opaque';
export type TaskCloudWriteSemantics = 'create-patch' | 'patch' | 'managed';
export type TaskCloudKitFieldKind =
    | 'string'
    | 'date'
    | 'json-string'
    | 'boolean'
    | 'integer'
    | 'string-array';

export type TaskCloudKitFieldSpec = {
    key: string;
    kind: TaskCloudKitFieldKind;
};

export type TaskSyncFieldSpec = {
    name: keyof Task;
    sync: TaskFieldSyncSemantics;
    nullability: TaskFieldNullability;
    sinceVersion: number;
    signature: TaskFieldSignatureSemantics;
    sqliteColumn: string | null;
    cloudKit: TaskCloudKitFieldSpec | null;
    cloudWrite: TaskCloudWriteSemantics;
};

type TaskSyncSchemaFixture = {
    schemaVersion: number;
    sinceVersionPolicy: string;
    fields: TaskSyncFieldSpec[];
    fixture: Task;
};

const schema = schemaFixture as TaskSyncSchemaFixture;

export const TASK_SYNC_SCHEMA_VERSION = schema.schemaVersion;
export const TASK_SYNC_SCHEMA_VERSION_POLICY = schema.sinceVersionPolicy;
export const TASK_SYNC_FIELD_SCHEMA: readonly TaskSyncFieldSpec[] = schema.fields;
export const TASK_SYNC_SCHEMA_FIXTURE: Task = schema.fixture;
