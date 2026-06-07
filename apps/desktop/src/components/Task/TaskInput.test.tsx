import { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@mindwtr/core';

import { TaskInput } from './TaskInput';

const buildProject = (title: string, status: Project['status'] = 'active'): Project => ({
    id: title.toLowerCase().replace(/\s+/g, '-'),
    title,
    status,
    color: '#3b82f6',
    order: 0,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

function TaskInputHarness({
    initialValue = '',
    contexts = [],
}: {
    initialValue?: string;
    contexts?: string[];
}) {
    const [value, setValue] = useState(initialValue);

    return (
        <TaskInput
            value={value}
            onChange={setValue}
            projects={[]}
            contexts={contexts}
        />
    );
}

describe('TaskInput autocomplete', () => {
    it('suggests custom contexts for @ trigger', () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <TaskInput
                value="@per"
                onChange={onChange}
                projects={[]}
                contexts={['@home', '@work', '@personal']}
            />
        );
        const input = getByRole('combobox') as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent.click(input);

        expect(getByRole('option', { name: '@personal' })).toBeInTheDocument();
    });

    it('hides archived projects from project suggestions', () => {
        const onChange = vi.fn();
        const { getByRole, queryByRole } = render(
            <TaskInput
                value="+Arc"
                onChange={onChange}
                projects={[buildProject('Active Roadmap'), buildProject('Arc', 'archived')]}
                contexts={[]}
            />
        );
        const input = getByRole('combobox') as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent.click(input);

        expect(queryByRole('option', { name: 'Arc' })).not.toBeInTheDocument();
        expect(getByRole('option', { name: /Create Project "Arc"/ })).toBeInTheDocument();
    });

    it('suggests tags for # trigger and inserts selected tag', () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <TaskInput
                value="#urg"
                onChange={onChange}
                projects={[]}
                contexts={['#urgent', '#ops', '@work']}
            />
        );
        const input = getByRole('combobox') as HTMLInputElement;
        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent.click(input);

        fireEvent.click(getByRole('option', { name: '#urgent' }));

        expect(onChange).toHaveBeenCalledWith('#urgent');
    });

    it('undoes task title edits with Ctrl+Z', async () => {
        const { getByRole } = render(<TaskInputHarness initialValue="Draft task" />);
        const input = getByRole('combobox') as HTMLInputElement;

        input.setSelectionRange(input.value.length, input.value.length);
        fireEvent.change(input, { target: { value: 'Draft task updated' } });

        expect(input.value).toBe('Draft task updated');

        fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

        await waitFor(() => {
            expect(input.value).toBe('Draft task');
        });
    });
});
