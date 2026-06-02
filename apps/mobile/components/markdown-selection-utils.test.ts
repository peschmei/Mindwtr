import { describe, expect, it } from 'vitest';

import {
    applyMarkdownPairKeyPressWithSelectionFallback,
    applyMarkdownPairInsertionWithSelectionFallback,
    applyMarkdownUrlPasteWithSelectionFallback,
} from './markdown-selection-utils';

describe('markdown selection replacement fallbacks', () => {
    it('uses the last range selection when mobile paste collapses the current selection first', () => {
        expect(
            applyMarkdownUrlPasteWithSelectionFallback(
                'read docs today',
                'read https://example.com today',
                { start: 24, end: 24 },
                { start: 5, end: 9 },
            ),
        ).toEqual({
            result: {
                value: 'read [docs](https://example.com) today',
                selection: { start: 32, end: 32 },
            },
            baseSelection: { start: 5, end: 9 },
        });
    });

    it('does not use a stale range when the text change is not a matching replacement', () => {
        expect(
            applyMarkdownUrlPasteWithSelectionFallback(
                'read docs today',
                'read docs today https://example.com',
                { start: 35, end: 35 },
                { start: 5, end: 9 },
            ),
        ).toBeNull();
    });

    it('also keeps pair insertion working when selection collapses before the text change', () => {
        expect(
            applyMarkdownPairInsertionWithSelectionFallback(
                'read docs',
                'read [',
                { start: 6, end: 6 },
                { start: 5, end: 9 },
            ),
        ).toEqual({
            result: {
                value: 'read [docs]',
                selection: { start: 6, end: 10 },
            },
            baseSelection: { start: 5, end: 9 },
        });
    });

    it('wraps selected text from a mobile key press before Android replaces the range', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'read docs',
                '[',
                { start: 5, end: 9 },
            ),
        ).toEqual({
            result: {
                value: 'read [docs]',
                selection: { start: 6, end: 10 },
            },
            baseSelection: { start: 5, end: 9 },
        });
    });

    it('uses the last range selection for mobile key press pairing after selection collapses', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'read docs',
                '[',
                { start: 5, end: 5 },
                { start: 5, end: 9 },
            ),
        ).toEqual({
            result: {
                value: 'read [docs]',
                selection: { start: 6, end: 10 },
            },
            baseSelection: { start: 5, end: 9 },
        });
    });

    it('wraps selected text from a mobile quote key press', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'read docs',
                '"',
                { start: 5, end: 9 },
            ),
        ).toEqual({
            result: {
                value: 'read "docs"',
                selection: { start: 6, end: 10 },
            },
            baseSelection: { start: 5, end: 9 },
        });
    });

    it('auto-pairs a mobile key press without a range selection', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'read docs',
                '[',
                { start: 5, end: 5 },
            ),
        ).toEqual({
            result: {
                value: 'read []docs',
                selection: { start: 6, end: 6 },
            },
            baseSelection: { start: 5, end: 5 },
        });
    });

    it('wraps selected text from a mobile backtick key press', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'run tests',
                '`',
                { start: 0, end: 9 },
            ),
        ).toEqual({
            result: {
                value: '`run tests`',
                selection: { start: 1, end: 10 },
            },
            baseSelection: { start: 0, end: 9 },
        });
    });

    it('wraps selected text from a mobile triple-backtick text change', () => {
        expect(
            applyMarkdownPairInsertionWithSelectionFallback(
                'run tests',
                '```',
                { start: 0, end: 9 },
            ),
        ).toEqual({
            result: {
                value: '```\nrun tests\n```',
                selection: { start: 4, end: 13 },
            },
            baseSelection: { start: 0, end: 9 },
        });
    });

    it('auto-pairs a mobile text change when native selection has already advanced', () => {
        expect(
            applyMarkdownPairInsertionWithSelectionFallback(
                'read docs',
                'read [docs',
                { start: 6, end: 6 },
            ),
        ).toEqual({
            result: {
                value: 'read []docs',
                selection: { start: 6, end: 6 },
            },
            baseSelection: { start: 6, end: 6 },
        });
    });

    it('ignores non-pair mobile key presses without a range selection', () => {
        expect(
            applyMarkdownPairKeyPressWithSelectionFallback(
                'read docs',
                'a',
                { start: 5, end: 5 },
            ),
        ).toBeNull();
    });
});
