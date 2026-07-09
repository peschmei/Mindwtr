import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PromptModal } from './PromptModal';

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const baseProps = {
    isOpen: true,
    title: 'Add link',
    confirmLabel: 'Save',
    cancelLabel: 'Cancel',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
};

describe('PromptModal browse', () => {
    it('fills the input from onBrowse and confirms with the picked value', async () => {
        const onConfirm = vi.fn();
        const onBrowse = vi.fn(async () => 'C:\\docs\\report.pdf');
        render(
            <PromptModal
                {...baseProps}
                onConfirm={onConfirm}
                browseLabel="Link to file…"
                onBrowse={onBrowse}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Link to file…' }));
        await waitFor(() => {
            expect(screen.getByRole('textbox')).toHaveValue('C:\\docs\\report.pdf');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(onConfirm).toHaveBeenCalledWith('C:\\docs\\report.pdf');
    });

    it('prevents the input blur on footer button mousedown so the first click is not swallowed', () => {
        render(
            <PromptModal
                {...baseProps}
                defaultValue="https://example.com"
                browseLabel="Link to file…"
                onBrowse={vi.fn(async () => null)}
            />
        );

        // fireEvent returns false when preventDefault was called; without it the
        // blur reveals the validation line mid-click and shifts the buttons away
        // from the pointer, eating the first click.
        expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Link to file…' }))).toBe(false);
        expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Cancel' }))).toBe(false);
        expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Save' }))).toBe(false);
        expect(screen.queryByText('common.validationRequired')).toBeNull();
    });
});
