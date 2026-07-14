import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgendaHeader } from './AgendaHeader';

const resolveText = (key: string, fallback: string) => {
    if (key === 'tags.title') return 'Tags';
    return fallback;
};

const t = (key: string) => resolveText(key, key);

const renderHeader = (overrides: Partial<Parameters<typeof AgendaHeader>[0]> = {}) => render(
    <AgendaHeader
        filterCount={0}
        filtersOpen={false}
        nextActionsCount={3}
        nextGroupBy="none"
        onChangeGroupBy={vi.fn()}
        onToggleDetails={vi.fn()}
        onToggleFilters={vi.fn()}
        onToggleTop3={vi.fn()}
        resolveText={resolveText}
        showListDetails={false}
        t={t}
        top3Only={false}
        {...overrides}
    />
);

describe('AgendaHeader', () => {
    it('offers tag as a Focus grouping option', () => {
        const onChangeGroupBy = vi.fn();
        const { getByLabelText } = renderHeader({ onChangeGroupBy });

        const groupSelect = getByLabelText('Group') as HTMLSelectElement;

        expect([...groupSelect.options].map((option) => option.value)).toContain('tag');

        fireEvent.change(groupSelect, { target: { value: 'tag' } });

        expect(onChangeGroupBy).toHaveBeenCalledWith('tag');
    });

    // Focus used to draw its own pill buttons and a bare select, so its controls
    // sat at a different height and radius than every other list toolbar, and the
    // grouping value rendered without the GROUP caption (#861).
    it('renders its controls in the shared list-toolbar style', () => {
        const { container, getByLabelText, getByText } = renderHeader();

        const groupShell = (getByLabelText('Group') as HTMLSelectElement).parentElement;
        expect(groupShell?.className).toContain('h-9');
        expect(groupShell?.className).toContain('rounded-lg');
        expect(getByText('Group')).toBeInTheDocument();

        const buttons = [...container.querySelectorAll('button')];
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach((button) => {
            expect(button.className).toContain('h-9');
            expect(button.className).toContain('rounded-lg');
            expect(button.className).not.toContain('rounded-full');
        });
    });
});
