import React from 'react';
import {
    Dimensions,
    InteractionManager,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    type TextInputKeyPressEventData,
    type TextInputSelectionChangeEventData,
    type NativeSyntheticEvent,
    type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
    applyMarkdownKeyboardShortcut,
    applyMarkdownToolbarAction,
    continueMarkdownOnTextChange,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
} from '@mindwtr/core';

import { useThemeColors } from '@/hooks/use-theme-colors';

import { expandedMarkdownEditorStyles as styles } from './expanded-markdown-editor.styles';
import { KeyboardAccessoryHost } from './keyboard-accessory-host';
import { MarkdownFormatToolbar } from './markdown-format-toolbar';
import { MarkdownReferenceAutocomplete } from './markdown-reference-autocomplete';
import {
    applyMarkdownPairKeyPressWithSelectionFallback,
    applyMarkdownPairInsertionWithSelectionFallback,
    applyMarkdownUrlPasteWithSelectionFallback,
    isRangeSelection,
} from './markdown-selection-utils';
import { MarkdownText } from './markdown-text';
import { getControlledTextInputSelection } from './text-input-selection';

const EDITOR_CONTENT_BASE_PADDING = 16;

const selectionsEqual = (left: MarkdownSelection, right: MarkdownSelection) => (
    left.start === right.start && left.end === right.end
);

type ExpandedMarkdownEditorProps = {
    isOpen: boolean;
    onClose: () => void;
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
    title: string;
    headerTitle?: string;
    placeholder: string;
    t: (key: string) => string;
    initialMode?: 'edit' | 'preview';
    direction?: 'ltr' | 'rtl';
    selection: MarkdownSelection;
    onSelectionChange: (selection: MarkdownSelection) => void;
    canUndo: boolean;
    onUndo: () => MarkdownSelection | undefined;
    onApplyAction?: (actionId: MarkdownToolbarActionId, selection: MarkdownSelection) => MarkdownToolbarResult | void;
    currentTaskId?: string;
};

export function ExpandedMarkdownEditor({
    isOpen,
    onClose,
    value,
    onChange,
    onCommit,
    title,
    headerTitle,
    placeholder,
    t,
    initialMode = 'edit',
    direction,
    selection,
    onSelectionChange,
    canUndo,
    onUndo,
    onApplyAction,
    currentTaskId,
}: ExpandedMarkdownEditorProps) {
    const tc = useThemeColors();
    const inputRef = React.useRef<TextInput | null>(null);
    const focusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusInteractionRef = React.useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
    const openedAtRef = React.useRef(0);
    const pendingInitialFocusRef = React.useRef(false);
    const wasOpenRef = React.useRef(false);
    const toolbarInteractionUntilRef = React.useRef(0);
    const pendingSelectionRef = React.useRef<MarkdownSelection | null>(null);
    const lastRangeSelectionRef = React.useRef<MarkdownSelection | null>(isRangeSelection(selection) ? selection : null);
    const ignoredNativePairChangeRef = React.useRef<{
        nativeValue: string;
        appliedValue: string;
        selection: MarkdownSelection;
    } | null>(null);
    const valueRef = React.useRef(value);
    const selectionRef = React.useRef(selection);
    // Keep a local mirror while the fullscreen editor is open so Android
    // focus/toolbar interactions do not have to wait on parent rerenders.
    const [editorValue, setEditorValue] = React.useState(value);
    const [editorSelection, setEditorSelection] = React.useState(selection);
    const [mode, setMode] = React.useState<'edit' | 'preview'>(initialMode);
    const [isInputFocused, setIsInputFocused] = React.useState(false);
    const [keyboardBottomInset, setKeyboardBottomInset] = React.useState(0);
    const resolvedHeaderTitle = (headerTitle || '').trim() || title;
    const directionStyle: TextStyle | undefined = direction
        ? {
            writingDirection: direction,
            textAlign: direction === 'rtl' ? 'right' : 'left',
        }
        : undefined;
    React.useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            openedAtRef.current = Date.now();
            pendingInitialFocusRef.current = true;
            setMode(initialMode);
            valueRef.current = value;
            selectionRef.current = selection;
            lastRangeSelectionRef.current = isRangeSelection(selection) ? selection : null;
            pendingSelectionRef.current = null;
            ignoredNativePairChangeRef.current = null;
            setEditorValue(value);
            setEditorSelection(selection);
        }
        wasOpenRef.current = isOpen;
    }, [initialMode, isOpen, selection, value]);

    React.useEffect(() => {
        if (!isOpen) {
            pendingSelectionRef.current = null;
            lastRangeSelectionRef.current = null;
            ignoredNativePairChangeRef.current = null;
            setIsInputFocused(false);
            setKeyboardBottomInset(0);
        }
    }, [isOpen]);
    React.useEffect(() => {
        if (!isOpen || mode !== 'edit') {
            setKeyboardBottomInset(0);
            return;
        }
        if (typeof Keyboard?.addListener !== 'function') return;

        const updateKeyboardInset = (event: { endCoordinates?: { screenY?: number; height?: number } }) => {
            const windowHeight = Dimensions.get('window').height;
            const endCoords = event.endCoordinates;
            let keyboardTop = windowHeight;
            if (typeof endCoords?.screenY === 'number') {
                keyboardTop = endCoords.screenY;
            } else if (typeof endCoords?.height === 'number') {
                keyboardTop = Math.max(0, windowHeight - endCoords.height);
            }
            setKeyboardBottomInset(Platform.OS === 'android' ? Math.max(0, windowHeight - keyboardTop) : 0);
        };
        const resetKeyboardInset = () => setKeyboardBottomInset(0);
        const showListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            updateKeyboardInset,
        );
        const changeListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidChangeFrame',
            updateKeyboardInset,
        );
        const hideListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            resetKeyboardInset,
        );
        return () => {
            showListener.remove();
            changeListener.remove();
            hideListener.remove();
        };
    }, [isOpen, mode]);

    const scheduleEditorFocus = React.useCallback(() => {
        if (focusInteractionRef.current?.cancel) {
            focusInteractionRef.current.cancel();
        }
        if (focusTimerRef.current) {
            clearTimeout(focusTimerRef.current);
            focusTimerRef.current = null;
        }
        focusInteractionRef.current = InteractionManager.runAfterInteractions(() => {
            focusTimerRef.current = setTimeout(() => {
                inputRef.current?.focus();
                if (selectionRef.current) {
                    inputRef.current?.setNativeProps?.({ selection: selectionRef.current });
                }
            }, Platform.OS === 'android' ? 120 : 30);
        });
    }, []);

    React.useEffect(() => {
        if (!isOpen || mode !== 'edit') return;
        if (pendingInitialFocusRef.current) return;
        if (wasOpenRef.current) {
            scheduleEditorFocus();
        }
    }, [isOpen, mode, scheduleEditorFocus]);

    React.useEffect(() => {
        if (value === valueRef.current) return;
        valueRef.current = value;
        setEditorValue(value);
    }, [value]);

    React.useEffect(() => {
        if (
            selection.start === selectionRef.current.start
            && selection.end === selectionRef.current.end
        ) {
            return;
        }
        selectionRef.current = selection;
        if (isRangeSelection(selection)) {
            lastRangeSelectionRef.current = selection;
        }
        setEditorSelection(selection);
    }, [selection]);
    React.useEffect(() => () => {
        if (focusInteractionRef.current?.cancel) {
            focusInteractionRef.current.cancel();
        }
        if (focusTimerRef.current) {
            clearTimeout(focusTimerRef.current);
            focusTimerRef.current = null;
        }
    }, []);

    const handleClose = React.useCallback(() => {
        onCommit?.();
        onClose();
    }, [onClose, onCommit]);
    const handleRequestClose = React.useCallback(() => {
        const elapsed = Date.now() - openedAtRef.current;
        if (Platform.OS === 'android' && elapsed < 750) {
            if (mode === 'edit') {
                requestAnimationFrame(() => {
                    inputRef.current?.focus();
                });
            }
            return;
        }
        handleClose();
    }, [handleClose, mode]);

    const handleToggleMode = React.useCallback(() => {
        setMode((prev) => {
            const next = prev === 'edit' ? 'preview' : 'edit';
            if (next === 'preview') {
                Keyboard.dismiss();
                setIsInputFocused(false);
            }
            return next;
        });
    }, []);

    const handleSelectionChange = React.useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const nextSelection = event.nativeEvent.selection;
        const pendingSelection = pendingSelectionRef.current;
        if (pendingSelection) {
            if (!selectionsEqual(pendingSelection, nextSelection)) {
                return;
            }
            pendingSelectionRef.current = null;
        }
        selectionRef.current = nextSelection;
        if (isRangeSelection(nextSelection)) {
            lastRangeSelectionRef.current = nextSelection;
        }
        setEditorSelection(nextSelection);
        onSelectionChange(nextSelection);
    }, [onSelectionChange]);
    const handleToolbarSelectionChange = React.useCallback((nextSelection: MarkdownSelection) => {
        pendingSelectionRef.current = null;
        selectionRef.current = nextSelection;
        if (isRangeSelection(nextSelection)) {
            lastRangeSelectionRef.current = nextSelection;
        }
        setEditorSelection(nextSelection);
        onSelectionChange(nextSelection);
    }, [onSelectionChange]);
    const restoreEditorFocus = React.useCallback((selectionOverride?: MarkdownSelection) => {
        const targetSelection = selectionOverride ?? selectionRef.current;
        if (targetSelection) {
            pendingSelectionRef.current = targetSelection;
        }
        const focusInput = () => {
            inputRef.current?.focus();
            if (targetSelection) {
                inputRef.current?.setNativeProps?.({ selection: targetSelection });
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(focusInput);
        } else {
            setTimeout(focusInput, 0);
        }
        const applyDelayedFocus = (shouldClearPending: boolean) => {
            focusInput();
            if (
                targetSelection
                && pendingSelectionRef.current
                && shouldClearPending
                && selectionsEqual(pendingSelectionRef.current, targetSelection)
            ) {
                pendingSelectionRef.current = null;
            }
        };
        setTimeout(() => {
            applyDelayedFocus(false);
        }, 40);
        setTimeout(() => {
            applyDelayedFocus(false);
        }, 140);
        setTimeout(() => {
            applyDelayedFocus(true);
        }, 300);
    }, []);
    const handleToolbarInteractionStart = React.useCallback(() => {
        toolbarInteractionUntilRef.current = Date.now() + 300;
        setIsInputFocused(true);
    }, []);

    const handleChangeText = React.useCallback((nextValue: string) => {
        const ignoredNativeChange = ignoredNativePairChangeRef.current;
        if (ignoredNativeChange) {
            ignoredNativePairChangeRef.current = null;
            if (
                nextValue === ignoredNativeChange.nativeValue
                && valueRef.current === ignoredNativeChange.appliedValue
            ) {
                restoreEditorFocus(ignoredNativeChange.selection);
                return;
            }
        }

        const currentSelection = selectionRef.current;
        const previousValue = valueRef.current;
        const fallbackSelection = lastRangeSelectionRef.current;
        const pastedUrl = applyMarkdownUrlPasteWithSelectionFallback(
            previousValue,
            nextValue,
            currentSelection,
            fallbackSelection,
        );
        if (pastedUrl) {
            lastRangeSelectionRef.current = null;
            valueRef.current = pastedUrl.result.value;
            selectionRef.current = pastedUrl.result.selection;
            setEditorValue(pastedUrl.result.value);
            setEditorSelection(pastedUrl.result.selection);
            onChange(pastedUrl.result.value);
            onSelectionChange(pastedUrl.result.selection);
            restoreEditorFocus(pastedUrl.result.selection);
            return;
        }

        const pairedInsertion = applyMarkdownPairInsertionWithSelectionFallback(
            valueRef.current,
            nextValue,
            selectionRef.current,
            fallbackSelection,
        );
        if (pairedInsertion) {
            lastRangeSelectionRef.current = null;
            valueRef.current = pairedInsertion.result.value;
            selectionRef.current = pairedInsertion.result.selection;
            setEditorValue(pairedInsertion.result.value);
            setEditorSelection(pairedInsertion.result.selection);
            onChange(pairedInsertion.result.value);
            onSelectionChange(pairedInsertion.result.selection);
            restoreEditorFocus(pairedInsertion.result.selection);
            return;
        }

        const continued = continueMarkdownOnTextChange(
            valueRef.current,
            nextValue,
            selectionRef.current,
        );
        if (continued) {
            lastRangeSelectionRef.current = null;
            valueRef.current = continued.value;
            selectionRef.current = continued.selection;
            setEditorValue(continued.value);
            setEditorSelection(continued.selection);
            onChange(continued.value);
            onSelectionChange(continued.selection);
            restoreEditorFocus(continued.selection);
            return;
        }

        lastRangeSelectionRef.current = null;
        valueRef.current = nextValue;
        setEditorValue(nextValue);
        onChange(nextValue);
    }, [onChange, onSelectionChange, restoreEditorFocus]);
    const handleKeyPress = React.useCallback((event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const pairedInsertion = applyMarkdownPairKeyPressWithSelectionFallback(
            valueRef.current,
            event.nativeEvent.key,
            selectionRef.current,
            lastRangeSelectionRef.current,
        );
        if (pairedInsertion) {
            event.preventDefault?.();
            lastRangeSelectionRef.current = null;
            ignoredNativePairChangeRef.current = {
                nativeValue: `${valueRef.current.slice(0, pairedInsertion.baseSelection.start)}${event.nativeEvent.key}${valueRef.current.slice(pairedInsertion.baseSelection.end)}`,
                appliedValue: pairedInsertion.result.value,
                selection: pairedInsertion.result.selection,
            };
            valueRef.current = pairedInsertion.result.value;
            selectionRef.current = pairedInsertion.result.selection;
            setEditorValue(pairedInsertion.result.value);
            setEditorSelection(pairedInsertion.result.selection);
            onChange(pairedInsertion.result.value);
            onSelectionChange(pairedInsertion.result.selection);
            restoreEditorFocus(pairedInsertion.result.selection);
            return;
        }

        const next = applyMarkdownKeyboardShortcut(
            valueRef.current,
            selectionRef.current,
            { key: event.nativeEvent.key },
        );
        if (!next) return;
        event.preventDefault?.();
        lastRangeSelectionRef.current = null;
        valueRef.current = next.value;
        selectionRef.current = next.selection;
        setEditorValue(next.value);
        setEditorSelection(next.selection);
        onChange(next.value);
        onSelectionChange(next.selection);
        restoreEditorFocus(next.selection);
    }, [onChange, onSelectionChange, restoreEditorFocus]);

    const handleApplyAction = React.useCallback((actionId: MarkdownToolbarActionId, currentSelection: MarkdownSelection) => {
        const liveSelection = selectionRef.current ?? currentSelection;
        const next = onApplyAction
            ? onApplyAction(actionId, liveSelection)
            : applyMarkdownToolbarAction(valueRef.current, liveSelection, actionId);
        if (!next) {
            return undefined;
        }

        valueRef.current = next.value;
        selectionRef.current = next.selection;
        lastRangeSelectionRef.current = null;
        setEditorValue(next.value);
        setEditorSelection(next.selection);

        if (!onApplyAction) {
            onChange(next.value);
            onSelectionChange(next.selection);
        }

        restoreEditorFocus(next.selection);
        return next;
    }, [onApplyAction, onChange, onSelectionChange, restoreEditorFocus]);
    const handleAutocompleteApply = React.useCallback((next: MarkdownToolbarResult) => {
        valueRef.current = next.value;
        selectionRef.current = next.selection;
        lastRangeSelectionRef.current = null;
        setEditorValue(next.value);
        setEditorSelection(next.selection);
        onChange(next.value);
        onSelectionChange(next.selection);
        restoreEditorFocus(next.selection);
    }, [onChange, onSelectionChange, restoreEditorFocus]);
    const editContentStyle = React.useMemo(() => [
        styles.content,
        keyboardBottomInset > 0 ? { paddingBottom: EDITOR_CONTENT_BASE_PADDING + keyboardBottomInset } : null,
    ], [keyboardBottomInset]);

    return (
        <Modal
            visible={isOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={handleRequestClose}
            onShow={() => {
                if (initialMode === 'edit') {
                    pendingInitialFocusRef.current = false;
                    scheduleEditorFocus();
                }
            }}
        >
            <KeyboardAccessoryHost>
                <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['top', 'bottom']}>
                    <View style={[styles.header, { borderBottomColor: tc.border }]}>
                        <TouchableOpacity
                            onPress={() => handleClose()}
                            style={[
                                styles.closeButton,
                                direction === 'rtl' ? { left: undefined, right: 16 } : null,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={t('markdown.collapse')}
                        >
                            <Ionicons name="close" size={24} color={tc.text} />
                        </TouchableOpacity>

                        <Text style={[styles.title, { color: tc.text }]} numberOfLines={1}>
                            {resolvedHeaderTitle}
                        </Text>

                        <TouchableOpacity
                            onPress={handleToggleMode}
                            style={[
                                styles.modeButton,
                                direction === 'rtl' ? { right: undefined, left: 16 } : null,
                                { backgroundColor: tc.cardBg, borderColor: tc.border },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={mode === 'edit' ? t('markdown.preview') : t('markdown.edit')}
                        >
                            <Text style={[styles.modeButtonText, { color: tc.tint }]}>
                                {mode === 'edit' ? t('markdown.preview') : t('markdown.edit')}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        keyboardVerticalOffset={0}
                        style={styles.body}
                    >
                        {mode === 'edit' ? (
                            <View style={editContentStyle}>
                                <MarkdownReferenceAutocomplete
                                    currentTaskId={currentTaskId}
                                    value={editorValue}
                                    selection={editorSelection}
                                    inputRef={inputRef}
                                    visible={isInputFocused}
                                    onApplyResult={handleAutocompleteApply}
                                    t={t}
                                    tc={tc}
                                />
                                <TextInput
                                    ref={inputRef}
                                    style={[
                                        styles.editorInput,
                                        directionStyle,
                                        { color: tc.text, backgroundColor: tc.inputBg, borderColor: tc.border },
                                    ]}
                                    value={editorValue}
                                    onChangeText={handleChangeText}
                                    onKeyPress={handleKeyPress}
                                    onFocus={() => {
                                        setIsInputFocused(true);
                                    }}
                                    onBlur={() => {
                                        const preserveFocus = toolbarInteractionUntilRef.current > Date.now();
                                        if (preserveFocus) {
                                            restoreEditorFocus();
                                            return;
                                        }
                                        setTimeout(() => {
                                            if (!inputRef.current?.isFocused?.()) {
                                                setIsInputFocused(false);
                                            }
                                        }, 0);
                                    }}
                                    selection={getControlledTextInputSelection(editorSelection)}
                                    onSelectionChange={handleSelectionChange}
                                    placeholder={placeholder}
                                    placeholderTextColor={tc.secondaryText}
                                    multiline
                                    spellCheck={true}
                                    autoCorrect={true}
                                    accessibilityLabel={title}
                                    accessibilityHint={placeholder}
                                />
                                <MarkdownFormatToolbar
                                    selection={editorSelection}
                                    onSelectionChange={handleToolbarSelectionChange}
                                    inputRef={inputRef}
                                    t={t}
                                    tc={tc}
                                    visible={isInputFocused}
                                    canUndo={canUndo}
                                    onUndo={onUndo}
                                    onApplyAction={handleApplyAction}
                                    onInteractionStart={handleToolbarInteractionStart}
                                />
                            </View>
                        ) : (
                            <ScrollView
                                style={styles.previewScroll}
                                contentContainerStyle={styles.previewContent}
                                keyboardShouldPersistTaps="handled"
                            >
                                <View style={[styles.previewSurface, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                                    <MarkdownText markdown={editorValue} tc={tc} direction={direction} />
                                </View>
                            </ScrollView>
                        )}
                    </KeyboardAvoidingView>
                </SafeAreaView>
            </KeyboardAccessoryHost>
        </Modal>
    );
}
