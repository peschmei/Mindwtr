import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import { applyCapturedProject, buildCaptureTaskProps } from './capture';

const makeProject = (overrides: Partial<Project>): Project => ({
    id: 'project-1',
    title: 'Launch',
    color: '#3b82f6',
    order: 0,
    status: 'active',
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const parsedBase = { title: 'Write brief', props: {}, projectTitle: undefined, detectedDate: undefined, invalidDateCommands: undefined };

describe('buildCaptureTaskProps', () => {
    it('defaults to an inbox capture with the parsed title', () => {
        const result = buildCaptureTaskProps({ parsed: parsedBase, rawInput: 'Write brief', projects: [] });
        expect(result).toMatchObject({ ok: true, title: 'Write brief', props: { status: 'inbox' } });
    });

    it('walks the title fallback chain and refuses an empty capture', () => {
        const noTitle = { ...parsedBase, title: '' };
        expect(buildCaptureTaskProps({ parsed: noTitle, rawInput: '  ', fallbackTitle: 'Screenshot', projects: [] }))
            .toMatchObject({ ok: true, title: 'Screenshot' });
        expect(buildCaptureTaskProps({ parsed: noTitle, rawInput: ' ', projects: [] }))
            .toEqual({ ok: false, reason: 'empty-title' });
    });

    it('reuses a selectable project matched by +Project title', () => {
        const active = makeProject({ id: 'p-active', title: 'Launch' });
        const result = buildCaptureTaskProps({
            parsed: { ...parsedBase, projectTitle: 'launch' },
            rawInput: 'Write brief +Launch',
            projects: [active],
        });
        expect(result).toMatchObject({ ok: true, props: { projectId: 'p-active' } });
        expect((result as { projectToCreate?: unknown }).projectToCreate).toBeUndefined();
    });

    it('requests a fresh project when the title matches only an archived project — the capture is never dropped', () => {
        const archived = makeProject({ id: 'p-archived', title: 'Launch', status: 'archived' });
        const result = buildCaptureTaskProps({
            parsed: { ...parsedBase, projectTitle: 'Launch' },
            rawInput: 'Write brief +Launch',
            projects: [archived],
        });
        expect(result).toMatchObject({
            ok: true,
            projectToCreate: { title: 'Launch' },
        });
        expect((result as { props: { projectId?: string } }).props.projectId).toBeUndefined();
    });

    it('drops a parsed projectId that is no longer assignable', () => {
        const archived = makeProject({ id: 'p-archived', status: 'archived' });
        const result = buildCaptureTaskProps({
            parsed: { ...parsedBase, props: { projectId: 'p-archived' } },
            rawInput: 'Write brief',
            projects: [archived],
            selectedAreaId: 'area-1',
        });
        expect(result).toMatchObject({ ok: true, props: { areaId: 'area-1' } });
        expect((result as { props: { projectId?: string } }).props.projectId).toBeUndefined();
    });

    it('keeps Container exclusivity: a project home clears the area fallback', () => {
        const active = makeProject({ id: 'p-active' });
        const withProject = buildCaptureTaskProps({
            parsed: { ...parsedBase, props: { projectId: 'p-active' } },
            rawInput: 'x',
            projects: [active],
            selectedAreaId: 'area-1',
        });
        expect(withProject).toMatchObject({ ok: true, props: { projectId: 'p-active', areaId: undefined } });

        const pendingCreate = buildCaptureTaskProps({
            parsed: { ...parsedBase, projectTitle: 'Brand new' },
            rawInput: 'x +Brand new',
            projects: [],
            selectedAreaId: 'area-1',
        });
        expect((pendingCreate as { props: { areaId?: string } }).props.areaId).toBeUndefined();
    });

    it('applies the detected natural-language date only when nothing explicit set one', () => {
        const detected = { date: '2026-08-01', matchedText: 'aug 1', titleWithoutDate: 'Pay rent' };
        const applied = buildCaptureTaskProps({
            parsed: { ...parsedBase, title: 'Pay rent aug 1', detectedDate: detected },
            rawInput: 'Pay rent aug 1',
            projects: [],
        });
        expect(applied).toMatchObject({ ok: true, title: 'Pay rent', props: { dueDate: '2026-08-01' } });

        const suppressed = buildCaptureTaskProps({
            parsed: { ...parsedBase, title: 'Pay rent aug 1', detectedDate: detected },
            rawInput: 'Pay rent aug 1',
            projects: [],
            suppressDetectedDate: true,
        });
        expect(suppressed).toMatchObject({ ok: true, title: 'Pay rent aug 1' });
        expect((suppressed as { props: { dueDate?: string } }).props.dueDate).toBeUndefined();
    });

    it('stars the capture and leaves the gating to the store', () => {
        const result = buildCaptureTaskProps({
            parsed: parsedBase,
            rawInput: 'x',
            projects: [],
            starNewTask: true,
        });
        expect(result).toMatchObject({ ok: true, props: { isFocusedToday: true } });
    });
});

describe('buildCaptureTaskProps project fallback', () => {
    it('falls back to the surface project when the parsed +Project is unassignable', () => {
        const archived = makeProject({ id: 'p-archived', status: 'archived' });
        const current = makeProject({ id: 'p-current', title: 'Current' });
        const result = buildCaptureTaskProps({
            parsed: { ...parsedBase, props: { projectId: 'p-archived' } },
            rawInput: 'x',
            projects: [archived, current],
            initialProps: { projectId: 'p-current' },
        });
        expect(result).toMatchObject({ ok: true, props: { projectId: 'p-current' } });
    });
});

describe('applyCapturedProject', () => {
    it('attaches the created project and clears the direct area', () => {
        expect(applyCapturedProject({ status: 'inbox', areaId: 'area-1' }, 'p-new'))
            .toEqual({ status: 'inbox', areaId: undefined, projectId: 'p-new' });
    });
});
