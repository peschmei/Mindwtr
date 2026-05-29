import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MARKDOWN_TOOLBAR_ACTIONS } from '@mindwtr/core';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownFormatToolbar } from './markdown-format-toolbar';

vi.mock('@expo/vector-icons', () => ({
    FontAwesome: (props: any) => React.createElement('FontAwesome', props),
    Ionicons: (props: any) => React.createElement('Ionicons', props),
}));

const themeColors = {
    bg: '#ffffff',
    cardBg: '#ffffff',
    taskItemBg: '#ffffff',
    inputBg: '#ffffff',
    filterBg: '#f2f2f7',
    border: '#d1d5db',
    text: '#111827',
    secondaryText: '#6b7280',
    icon: '#6b7280',
    tint: '#2563eb',
    onTint: '#ffffff',
    tabIconDefault: '#6b7280',
    tabIconSelected: '#2563eb',
    danger: '#dc2626',
    success: '#16a34a',
    warning: '#d97706',
};

const baseProps = {
    selection: { start: 0, end: 0 },
    onSelectionChange: vi.fn(),
    inputRef: { current: null },
    t: (key: string) => key,
    tc: themeColors,
    visible: true,
    canUndo: false,
    onUndo: vi.fn(),
    onApplyAction: vi.fn(() => ({ value: '', selection: { start: 0, end: 0 } })),
};

describe('MarkdownFormatToolbar', () => {
    it('renders inline without waiting for keyboard metrics', () => {
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} placement="inline" />);
        });

        expect(tree!.root.findAllByType(Pressable)).toHaveLength(MARKDOWN_TOOLBAR_ACTIONS.length + 1);
    });

    it('sizes toolbar buttons adaptively above the compact minimum on phone-width screens', () => {
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} placement="inline" />);
        });

        const firstAction = tree!.root.findAllByType(Pressable)[0];
        const styles = firstAction.props.style({ pressed: false });
        const adaptiveStyle = styles.find((entry: Record<string, unknown> | null) => entry && entry.width);

        expect(adaptiveStyle).toEqual(expect.objectContaining({
            width: 34,
            minHeight: 34,
            minWidth: 34,
        }));
    });

    it('uses a vector italic icon instead of Android italic text rendering', () => {
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} placement="inline" />);
        });

        const italicIcons = tree!.root.findAll((node) => (
            String(node.type) === 'FontAwesome' && node.props.name === 'italic'
        ));

        expect(italicIcons).toHaveLength(1);
        expect(italicIcons[0].props.size).toBe(13);
    });

    it('keeps keyboard placement hidden until the keyboard inset is known', () => {
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} />);
        });

        expect(tree!.root.findAllByType(Pressable)).toHaveLength(0);
    });

    it('applies toolbar actions on tap release so horizontal drags do not format text', () => {
        const onApplyAction = vi.fn(() => ({ value: '', selection: { start: 0, end: 0 } }));
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} onApplyAction={onApplyAction} placement="inline" />);
        });

        const firstAction = tree!.root.findAllByType(Pressable)[0];

        act(() => {
            firstAction.props.onPressIn();
        });
        expect(onApplyAction).not.toHaveBeenCalled();

        act(() => {
            firstAction.props.onPress();
        });
        expect(onApplyAction).toHaveBeenCalledTimes(1);
    });

    it('ignores toolbar button release while the horizontal action strip is scrolling', () => {
        const onApplyAction = vi.fn(() => ({ value: '', selection: { start: 0, end: 0 } }));
        let tree: ReactTestRenderer | undefined;
        act(() => {
            tree = create(<MarkdownFormatToolbar {...baseProps} onApplyAction={onApplyAction} placement="inline" />);
        });

        const actionStrip = tree!.root.findByType(ScrollView);
        const firstAction = tree!.root.findAllByType(Pressable)[0];

        act(() => {
            actionStrip.props.onScrollBeginDrag();
            firstAction.props.onPress();
        });

        expect(onApplyAction).not.toHaveBeenCalled();
    });
});
