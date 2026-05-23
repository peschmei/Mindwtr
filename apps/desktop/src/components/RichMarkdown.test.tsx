import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RichMarkdown } from './RichMarkdown';

describe('RichMarkdown', () => {
    it('renders markdown headings with desktop heading styles', () => {
        render(<RichMarkdown markdown={'# Heading\n\n## Section\n\nBody'} />);

        expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toHaveClass('text-lg', 'font-semibold');
        expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toHaveClass('text-base', 'font-semibold');
        expect(screen.getByText('Body')).toBeInTheDocument();
    });

    it('preserves soft line breaks inside paragraphs', () => {
        render(<RichMarkdown markdown={'line 1\nline 2'} />);

        expect(screen.getByText(/line 1/)).toHaveClass('whitespace-pre-line');
    });

    it('adds an accessible copy button to fenced code blocks', () => {
        render(<RichMarkdown markdown={'```ts\nconst value = 1;\n```'} />);

        expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
        expect(screen.getByText('const value = 1;')).toBeInTheDocument();
    });
});
