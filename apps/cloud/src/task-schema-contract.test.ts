import { describe, expect, it } from 'vitest';
import { TASK_SYNC_FIELD_SCHEMA } from '@mindwtr/core/task-sync-schema';
import {
    CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS,
    CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS,
} from './server-config';

const sorted = (values: Iterable<string>): string[] => Array.from(values).sort();

describe('cloud Task schema contract', () => {
    it('keeps creation validation aligned with schema write semantics', () => {
        const expected = TASK_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });

    it('keeps patch validation aligned with schema write semantics', () => {
        const expected = TASK_SYNC_FIELD_SCHEMA
            .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
            .map((field) => field.name);

        expect(sorted(CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS)).toEqual(sorted(expected));
    });
});
