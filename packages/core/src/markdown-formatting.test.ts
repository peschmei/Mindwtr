import { describe, expect, it } from 'vitest';

import {
    applyMarkdownKeyboardShortcut,
    applyMarkdownPairInsertion,
    applyMarkdownToolbarAction,
    applyMarkdownUrlPaste,
    continueMarkdownOnEnter,
    continueMarkdownOnTextChange,
} from './markdown';

describe('applyMarkdownToolbarAction', () => {
    it('inserts bold markers around an empty selection', () => {
        expect(
            applyMarkdownToolbarAction('', { start: 0, end: 0 }, 'bold'),
        ).toEqual({
            value: '****',
            selection: { start: 2, end: 2 },
        });
    });

    it('wraps a selected range in emphasis markers', () => {
        expect(
            applyMarkdownToolbarAction('finish note', { start: 7, end: 11 }, 'italic'),
        ).toEqual({
            value: 'finish *note*',
            selection: { start: 8, end: 12 },
        });
    });

    it('puts the cursor inside the url part when linking selected text', () => {
        expect(
            applyMarkdownToolbarAction('read docs', { start: 5, end: 9 }, 'link'),
        ).toEqual({
            value: 'read [docs]()',
            selection: { start: 12, end: 12 },
        });
    });

    it('prefixes the active line for heading insertion', () => {
        expect(
            applyMarkdownToolbarAction('title', { start: 3, end: 3 }, 'heading'),
        ).toEqual({
            value: '# title',
            selection: { start: 5, end: 5 },
        });
    });

    it('prefixes each selected line for lists', () => {
        expect(
            applyMarkdownToolbarAction('alpha\nbeta', { start: 1, end: 9 }, 'bulletList'),
        ).toEqual({
            value: '- alpha\n- beta',
            selection: { start: 0, end: 14 },
        });
    });

    it('inserts heading markup on an empty line', () => {
        expect(
            applyMarkdownToolbarAction('', { start: 0, end: 0 }, 'heading'),
        ).toEqual({
            value: '# ',
            selection: { start: 2, end: 2 },
        });
    });

    it('prefixes the active line for blockquotes', () => {
        expect(
            applyMarkdownToolbarAction('capture thought', { start: 4, end: 4 }, 'quote'),
        ).toEqual({
            value: '> capture thought',
            selection: { start: 6, end: 6 },
        });
    });

    it('inserts task list markup on an empty line', () => {
        expect(
            applyMarkdownToolbarAction('', { start: 0, end: 0 }, 'taskList'),
        ).toEqual({
            value: '- [ ] ',
            selection: { start: 6, end: 6 },
        });
    });

    it('prefixes each selected line for task lists', () => {
        expect(
            applyMarkdownToolbarAction('alpha\nbeta', { start: 0, end: 10 }, 'taskList'),
        ).toEqual({
            value: '- [ ] alpha\n- [ ] beta',
            selection: { start: 0, end: 22 },
        });
    });

    it('keeps link and code actions in the toolbar action list behavior', () => {
        expect(
            applyMarkdownToolbarAction('read docs', { start: 5, end: 9 }, 'code'),
        ).toEqual({
            value: 'read `docs`',
            selection: { start: 6, end: 10 },
        });
    });
});

describe('applyMarkdownPairInsertion', () => {
    it('wraps selected text when an opening bracket replaces the selection', () => {
        expect(
            applyMarkdownPairInsertion('read docs', 'read [', { start: 5, end: 9 }),
        ).toEqual({
            value: 'read [docs]',
            selection: { start: 6, end: 10 },
        });
    });

    it('supports repeated backtick wrapping for fenced code', () => {
        const replaceSelectionWithBacktick = (value: string, selection: { start: number; end: number }) => (
            `${value.slice(0, selection.start)}\`${value.slice(selection.end)}`
        );
        const once = applyMarkdownPairInsertion('code sample', '`', { start: 0, end: 11 });
        expect(once).toEqual({
            value: '`code sample`',
            selection: { start: 1, end: 12 },
        });
        const twice = applyMarkdownPairInsertion(once!.value, replaceSelectionWithBacktick(once!.value, once!.selection), once!.selection);
        const three = applyMarkdownPairInsertion(twice!.value, replaceSelectionWithBacktick(twice!.value, twice!.selection), twice!.selection);
        expect(three).toEqual({
            value: '```code sample```',
            selection: { start: 3, end: 14 },
        });
    });

    it('ignores normal typing without a selected range', () => {
        expect(
            applyMarkdownPairInsertion('read docs', 'read [docs', { start: 5, end: 5 }),
        ).toBeNull();
    });
});

describe('applyMarkdownUrlPaste', () => {
    it('turns selected text into a markdown link when a url replaces the selection', () => {
        expect(
            applyMarkdownUrlPaste('read docs today', 'read https://example.com today', { start: 5, end: 9 }),
        ).toEqual({
            value: 'read [docs](https://example.com) today',
            selection: { start: 32, end: 32 },
        });
    });

    it('ignores non-url replacements', () => {
        expect(
            applyMarkdownUrlPaste('read docs', 'read note', { start: 5, end: 9 }),
        ).toBeNull();
    });
});

describe('applyMarkdownKeyboardShortcut', () => {
    it('wraps selected text with bold markers for Ctrl+B', () => {
        expect(
            applyMarkdownKeyboardShortcut('read docs', { start: 5, end: 9 }, { key: 'b', ctrlKey: true }),
        ).toEqual({
            value: 'read **docs**',
            selection: { start: 7, end: 11 },
        });
    });

    it('inserts two spaces for Tab at the cursor', () => {
        expect(
            applyMarkdownKeyboardShortcut('read docs', { start: 5, end: 5 }, { key: 'Tab' }),
        ).toEqual({
            value: 'read   docs',
            selection: { start: 7, end: 7 },
        });
    });

    it('indents selected lines with two spaces for Tab', () => {
        expect(
            applyMarkdownKeyboardShortcut('alpha\nbeta', { start: 0, end: 10 }, { key: 'Tab' }),
        ).toEqual({
            value: '  alpha\n  beta',
            selection: { start: 0, end: 14 },
        });
    });
});

describe('continueMarkdownOnEnter', () => {
    it('continues unordered lists on a new line', () => {
        expect(
            continueMarkdownOnEnter('- item', { start: 6, end: 6 }),
        ).toEqual({
            value: '- item\n- ',
            selection: { start: 9, end: 9 },
        });
    });

    it('increments ordered list markers', () => {
        expect(
            continueMarkdownOnEnter('1. item', { start: 7, end: 7 }),
        ).toEqual({
            value: '1. item\n2. ',
            selection: { start: 11, end: 11 },
        });
    });

    it('continues task lists with unchecked items', () => {
        expect(
            continueMarkdownOnEnter('  - [x] done', { start: 12, end: 12 }),
        ).toEqual({
            value: '  - [x] done\n  - [ ] ',
            selection: { start: 21, end: 21 },
        });
    });

    it('continues blockquotes on a new line', () => {
        expect(
            continueMarkdownOnEnter('> quoted', { start: 8, end: 8 }),
        ).toEqual({
            value: '> quoted\n> ',
            selection: { start: 11, end: 11 },
        });
    });

    it('does nothing when enter is pressed away from the line end', () => {
        expect(
            continueMarkdownOnEnter('- item', { start: 3, end: 3 }),
        ).toBeNull();
    });
});

describe('continueMarkdownOnTextChange', () => {
    it('recognizes a raw newline insertion on mobile and continues the list', () => {
        expect(
            continueMarkdownOnTextChange('- item', '- item\n', { start: 6, end: 6 }),
        ).toEqual({
            value: '- item\n- ',
            selection: { start: 9, end: 9 },
        });
    });

    it('ignores unrelated text changes', () => {
        expect(
            continueMarkdownOnTextChange('- item', '- items', { start: 6, end: 6 }),
        ).toBeNull();
    });
});
