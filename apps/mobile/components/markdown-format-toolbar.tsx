import React from 'react';
import {
    Dimensions,
    Keyboard,
    Pressable,
    Platform,
    ScrollView,
    Text,
    TextInput,
    View,
} from 'react-native';
import { FontAwesome, Ionicons } from '@expo/vector-icons';
import {
    MARKDOWN_TOOLBAR_ACTIONS,
    translateWithFallback,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
} from '@mindwtr/core';
import type { ThemeColors } from '@/hooks/use-theme-colors';

import { KeyboardAccessoryPortal } from './keyboard-accessory-host';
import { markdownFormatToolbarStyles as styles } from './markdown-format-toolbar.styles';

const TOOLBAR_MIN_BUTTON_SIZE = 32;
const TOOLBAR_MAX_BUTTON_SIZE = 40;
const TOOLBAR_OUTER_PADDING = 16;
const TOOLBAR_FIXED_CHROME = 18;
const TOOLBAR_ACTION_GAP = 2;

const getWindowWidth = () => {
    const width = Dimensions.get('window').width;
    return Number.isFinite(width) && width > 0 ? width : 390;
};

type MarkdownFormatToolbarProps = {
    selection: MarkdownSelection;
    onSelectionChange: (selection: MarkdownSelection) => void;
    inputRef: React.RefObject<TextInput | null>;
    t: (key: string) => string;
    tc: ThemeColors;
    visible: boolean;
    canUndo: boolean;
    onUndo: () => MarkdownSelection | undefined;
    onApplyAction: (actionId: MarkdownToolbarActionId, selection: MarkdownSelection) => MarkdownToolbarResult | void;
    onInteractionStart?: () => void;
    placement?: 'keyboard' | 'inline';
};

const renderActionLabel = (
    actionId: MarkdownToolbarActionId,
    shortLabel: string,
    color: string,
    iconSize: number,
    fontSize: number,
) => {
    switch (actionId) {
        case 'bulletList':
            return <Ionicons name="list-outline" size={iconSize} color={color} />;
        case 'orderedList':
            return <Ionicons name="list-circle-outline" size={iconSize} color={color} />;
        case 'taskList':
            return <Ionicons name="checkbox-outline" size={iconSize} color={color} />;
        case 'quote':
            return <Ionicons name="chatbox-ellipses-outline" size={iconSize} color={color} />;
        case 'link':
            return <Ionicons name="link-outline" size={iconSize} color={color} />;
        case 'code':
            return <Ionicons name="code-slash-outline" size={iconSize} color={color} />;
        case 'italic':
            return <FontAwesome name="italic" size={Math.max(12, Math.round(iconSize * 0.64))} color={color} />;
        default:
            return (
                <Text
                    style={[
                        styles.buttonText,
                        { color, fontSize },
                    ]}
                >
                    {shortLabel}
                </Text>
            );
    }
};

export function MarkdownFormatToolbar({
    selection,
    onSelectionChange,
    inputRef,
    t,
    tc,
    visible,
    canUndo,
    onUndo,
    onApplyAction,
    onInteractionStart,
    placement = 'keyboard',
}: MarkdownFormatToolbarProps) {
    const [windowWidth, setWindowWidth] = React.useState(getWindowWidth);
    const [keyboardInset, setKeyboardInset] = React.useState(0);
    const suppressPressUntilRef = React.useRef(0);

    React.useEffect(() => {
        const dimensions = Dimensions as typeof Dimensions & {
            addEventListener?: (
                type: 'change',
                handler: (event: { window?: { width?: number } }) => void,
            ) => { remove?: () => void } | undefined;
        };
        if (typeof dimensions.addEventListener !== 'function') return;
        const subscription = dimensions.addEventListener('change', (event) => {
            const nextWidth = event.window?.width;
            if (Number.isFinite(nextWidth) && nextWidth > 0) {
                setWindowWidth(nextWidth);
            }
        });
        return () => {
            subscription?.remove?.();
        };
    }, []);
    const buttonSize = React.useMemo(() => {
        const buttonCount = MARKDOWN_TOOLBAR_ACTIONS.length + 1;
        const gapsWidth = TOOLBAR_ACTION_GAP * Math.max(0, MARKDOWN_TOOLBAR_ACTIONS.length - 1);
        const availableWidth = Math.max(
            0,
            windowWidth - TOOLBAR_OUTER_PADDING - TOOLBAR_FIXED_CHROME - gapsWidth,
        );
        const fittedSize = Math.floor(availableWidth / buttonCount);
        return Math.max(TOOLBAR_MIN_BUTTON_SIZE, Math.min(TOOLBAR_MAX_BUTTON_SIZE, fittedSize));
    }, [windowWidth]);
    const iconSize = Math.max(18, Math.min(22, Math.round(buttonSize * 0.58)));
    const fontSize = Math.max(12, Math.min(14, Math.round(buttonSize * 0.36)));
    const adaptiveButtonStyle = React.useMemo(() => ({
        minHeight: buttonSize,
        minWidth: buttonSize,
        paddingHorizontal: 0,
        width: buttonSize,
    }), [buttonSize]);

    React.useEffect(() => {
        if (placement !== 'keyboard') return;
        if (typeof Keyboard?.addListener !== 'function') return;

        const updateKeyboardInset = (event: { endCoordinates?: { screenY?: number; height?: number } }) => {
            const metrics = typeof Keyboard.metrics === 'function' ? Keyboard.metrics() : undefined;
            const explicitInset = typeof event.endCoordinates?.height === 'number'
                ? Math.max(0, event.endCoordinates.height)
                : 0;
            const measuredInset = typeof metrics?.height === 'number'
                ? Math.max(0, metrics.height)
                : 0;
            setKeyboardInset(measuredInset || explicitInset);
        };

        const resetKeyboardInset = () => setKeyboardInset(0);

        const showListener = Keyboard.addListener('keyboardDidShow', updateKeyboardInset);
        const changeListener = Keyboard.addListener('keyboardDidChangeFrame', updateKeyboardInset);
        const hideListener = Keyboard.addListener('keyboardDidHide', resetKeyboardInset);

        return () => {
            showListener.remove();
            changeListener.remove();
            hideListener.remove();
        };
    }, [placement]);

    const restoreSelection = React.useCallback((nextSelection?: MarkdownSelection) => {
        if (!nextSelection) return;
        onSelectionChange(nextSelection);

        const focusInput = () => {
            inputRef.current?.focus();
            inputRef.current?.setNativeProps?.({ selection: nextSelection });
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(focusInput);
            return;
        }

        setTimeout(focusInput, 0);
    }, [inputRef, onSelectionChange]);

    const keepInputFocused = React.useCallback(() => {
        const targetSelection = selection;

        const focusInput = () => {
            inputRef.current?.focus();
            inputRef.current?.setNativeProps?.({ selection: targetSelection });
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(focusInput);
            return;
        }

        setTimeout(focusInput, 0);
    }, [inputRef, selection]);

    const handleUndo = React.useCallback(() => {
        if (!canUndo) return;
        restoreSelection(onUndo() ?? undefined);
    }, [canUndo, onUndo, restoreSelection]);

    const handleApplyAction = React.useCallback((actionId: MarkdownToolbarActionId) => {
        restoreSelection(onApplyAction(actionId, selection)?.selection);
    }, [onApplyAction, restoreSelection, selection]);
    const guardScrollPress = React.useCallback((durationMs = 180) => {
        suppressPressUntilRef.current = Date.now() + durationMs;
    }, []);
    const shouldSuppressPress = React.useCallback(() => (
        suppressPressUntilRef.current > Date.now()
    ), []);

    if (!visible) {
        return null;
    }

    const toolbarContent = (
        <View style={styles.row}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.scroll}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="always"
                onScrollBeginDrag={() => guardScrollPress(260)}
                onScrollEndDrag={() => guardScrollPress(120)}
                onMomentumScrollBegin={() => guardScrollPress(260)}
                onMomentumScrollEnd={() => guardScrollPress(80)}
            >
                {MARKDOWN_TOOLBAR_ACTIONS.map((action) => (
                    <Pressable
                        key={action.id}
                        focusable={false}
                        onPressIn={() => {
                            onInteractionStart?.();
                            keepInputFocused();
                        }}
                        onPress={() => {
                            if (shouldSuppressPress()) return;
                            handleApplyAction(action.id);
                        }}
                        style={({ pressed }) => [
                            styles.button,
                            adaptiveButtonStyle,
                            { backgroundColor: pressed ? tc.filterBg : 'transparent' },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={translateWithFallback(t, action.labelKey, action.fallbackLabel)}
                        hitSlop={8}
                    >
                        {renderActionLabel(action.id, action.shortLabel, tc.text, iconSize, fontSize)}
                    </Pressable>
                ))}
            </ScrollView>

            <View style={styles.trailingActions}>
                <View style={[styles.divider, { backgroundColor: tc.border }]} />

                <Pressable
                    focusable={false}
                    onPressIn={() => {
                        onInteractionStart?.();
                        keepInputFocused();
                    }}
                    onPress={() => {
                        if (shouldSuppressPress()) return;
                        handleUndo();
                    }}
                    disabled={!canUndo}
                    style={({ pressed }) => [
                        styles.button,
                        adaptiveButtonStyle,
                        !canUndo ? styles.buttonDisabled : null,
                        { backgroundColor: pressed ? tc.filterBg : 'transparent' },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={translateWithFallback(t, 'common.undo', 'Undo')}
                    hitSlop={8}
                >
                    <Ionicons name="arrow-undo-outline" size={iconSize} color={tc.text} />
                </Pressable>
            </View>
        </View>
    );

    if (placement === 'inline') {
        return (
            <View
                style={[
                    styles.inlineBar,
                    {
                        backgroundColor: tc.cardBg,
                        borderColor: tc.border,
                    },
                ]}
            >
                {toolbarContent}
            </View>
        );
    }

    if (keyboardInset <= 0) {
        return null;
    }

    const toolbarBottom = Platform.OS === 'android' ? 0 : keyboardInset;

    return (
        <KeyboardAccessoryPortal>
            <View pointerEvents="box-none" style={styles.overlay}>
                <View
                    style={[
                        styles.floatingBar,
                        {
                            bottom: toolbarBottom,
                            backgroundColor: tc.bg,
                            borderTopColor: tc.border,
                        },
                    ]}
                >
                    {toolbarContent}
                </View>
            </View>
        </KeyboardAccessoryPortal>
    );
}
