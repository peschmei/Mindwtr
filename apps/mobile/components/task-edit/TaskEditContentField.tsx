import React from 'react';
import {
    Text,
    TextInput,
    TouchableOpacity,
    View,
    Platform,
    type NativeSyntheticEvent,
    type TextInputKeyPressEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GripVertical } from 'lucide-react-native';
import {
    NestableDraggableFlatList,
    ScaleDecorator,
    type DragEndParams,
    type RenderItemParams,
} from 'react-native-draggable-flatlist';
import {
    generateUUID,
    getAttachmentDisplayTitle,
    resolveAutoTextDirection,
    type MarkdownSelection,
    type Task,
} from '@mindwtr/core';

import { MarkdownReferenceAutocomplete } from '../markdown-reference-autocomplete';
import { MarkdownText } from '../markdown-text';
import { getControlledTextInputSelection } from '../text-input-selection';
import {
    applyMarkdownPairInsertionWithSelectionFallback,
    applyMarkdownPairKeyPressWithSelectionFallback,
    isRangeSelection,
} from '../markdown-selection-utils';
import type { TaskEditFieldRendererProps } from './TaskEditFieldRenderer.types';
import { DESCRIPTION_END_KEYBOARD_SCROLL_TARGET } from './task-edit-keyboard';

type ContentFieldId = 'description' | 'location' | 'attachments' | 'checklist';

type TaskEditContentFieldProps = TaskEditFieldRendererProps & {
    fieldId: ContentFieldId;
};

const getChecklistItemKey = (item: { id?: string }, index: number) => item.id || `index:${index}`;
const DESCRIPTION_END_SELECTION_THRESHOLD = 2;
const DESCRIPTION_END_KEYBOARD_SCROLL_THROTTLE_MS = 900;

type ChecklistItem = NonNullable<Task['checklist']>[number];

export const reorderChecklistItems = (
    checklist: Task['checklist'],
    fromIndex: number,
    toIndex: number,
): Task['checklist'] => {
    const items = checklist || [];

    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= items.length ||
        toIndex >= items.length
    ) {
        return items;
    }

    const nextItems = [...items];
    const [movedItem] = nextItems.splice(fromIndex, 1);

    if (!movedItem) {
        return items;
    }

    nextItems.splice(toIndex, 0, movedItem);
    return nextItems;
};

export function TaskEditContentField({
    addFileAttachment,
    addImageAttachment,
    applyDescriptionResult,
    descriptionDraft,
    descriptionInputRef,
    descriptionSelection,
    descriptionSelectionRestorePending,
    descriptionToolbarInteractionUntilRef,
    downloadAttachment,
    editedTask,
    fieldId,
    handleDescriptionChange,
    handleDescriptionKeyPress,
    handleInputFocus,
    handleResetChecklist,
    isDescriptionInputFocused,
    language,
    openAttachment,
    openDescriptionExpandedEditor,
    removeAttachment,
    setDescriptionSelection,
    setEditedTask,
    setIsDescriptionInputFocused,
    setLinkInputTouched,
    setLinkModalVisible,
    setShowDescriptionPreview,
    showDescriptionPreview,
    styles,
    t,
    tc,
    titleDraft,
    visibleAttachments,
}: TaskEditContentFieldProps) {
    const inputStyle = { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text };
    const combinedText = `${titleDraft ?? ''}\n${descriptionDraft ?? ''}`.trim();
    const resolvedDirection = resolveAutoTextDirection(combinedText, language);
    const textDirectionStyle = {
        writingDirection: resolvedDirection,
        textAlign: resolvedDirection === 'rtl' ? 'right' : 'left',
    } as const;
    const checklistInputRefs = React.useRef<Record<string, TextInput | null>>({});
    const checklistTitleRefs = React.useRef<Record<string, string>>({});
    const checklistSelectionRefs = React.useRef<Record<string, MarkdownSelection>>({});
    const lastChecklistRangeRefs = React.useRef<Record<string, MarkdownSelection | null>>({});
    const ignoredNativePairChangeRefs = React.useRef<Record<string, {
        nativeValue: string;
        appliedValue: string;
        selection: MarkdownSelection;
    }>>({});
    const lastDescriptionEndKeyboardScrollAtRef = React.useRef(0);

    React.useEffect(() => {
        const activeKeys = new Set<string>();
        (editedTask.checklist || []).forEach((item, index) => {
            const key = getChecklistItemKey(item, index);
            activeKeys.add(key);
            checklistTitleRefs.current[key] = item.title;
        });
        for (const key of Object.keys(checklistInputRefs.current)) {
            if (activeKeys.has(key)) continue;
            delete checklistInputRefs.current[key];
            delete checklistTitleRefs.current[key];
            delete checklistSelectionRefs.current[key];
            delete lastChecklistRangeRefs.current[key];
            delete ignoredNativePairChangeRefs.current[key];
        }
    }, [editedTask.checklist]);

    const getChecklistSelection = React.useCallback((key: string, value: string): MarkdownSelection => (
        checklistSelectionRefs.current[key] ?? { start: value.length, end: value.length }
    ), []);

    const restoreChecklistSelection = React.useCallback((key: string, selection: MarkdownSelection) => {
        checklistSelectionRefs.current[key] = selection;
        const applySelection = () => {
            const input = checklistInputRefs.current[key];
            input?.focus?.();
            input?.setNativeProps?.({ selection });
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(applySelection);
        } else {
            setTimeout(applySelection, 0);
        }
        setTimeout(applySelection, 40);
        setTimeout(applySelection, 140);
        setTimeout(applySelection, 300);
    }, []);

    const updateChecklistTitle = React.useCallback((index: number, key: string, title: string) => {
        checklistTitleRefs.current[key] = title;
        setEditedTask((prev) => {
            const nextChecklist = (prev.checklist || []).map((entry, entryIndex) =>
                entryIndex === index ? { ...entry, title } : entry
            );
            return { ...prev, checklist: nextChecklist };
        });
    }, [setEditedTask]);

    const handleChecklistSelectionChange = React.useCallback((key: string, selection: MarkdownSelection) => {
        checklistSelectionRefs.current[key] = selection;
        if (isRangeSelection(selection)) {
            lastChecklistRangeRefs.current[key] = selection;
        }
    }, []);

    const handleDescriptionSelectionChange = React.useCallback((selection: MarkdownSelection) => {
        setDescriptionSelection(selection);

        if (Platform.OS !== 'android') return;
        if (selection.start !== selection.end) return;
        const descriptionLength = descriptionDraft.length;
        if (descriptionLength === 0) return;
        if (selection.end < Math.max(0, descriptionLength - DESCRIPTION_END_SELECTION_THRESHOLD)) return;

        const isFocused = isDescriptionInputFocused || descriptionInputRef.current?.isFocused?.();
        if (!isFocused) return;

        const now = Date.now();
        if (now - lastDescriptionEndKeyboardScrollAtRef.current < DESCRIPTION_END_KEYBOARD_SCROLL_THROTTLE_MS) return;
        lastDescriptionEndKeyboardScrollAtRef.current = now;
        handleInputFocus(DESCRIPTION_END_KEYBOARD_SCROLL_TARGET);
    }, [
        descriptionDraft,
        descriptionInputRef,
        handleInputFocus,
        isDescriptionInputFocused,
        setDescriptionSelection,
    ]);

    const handleChecklistTitleChange = React.useCallback((index: number, key: string, text: string) => {
        const previousValue = checklistTitleRefs.current[key] ?? '';
        const ignoredNativeChange = ignoredNativePairChangeRefs.current[key];
        if (
            ignoredNativeChange
            && text === ignoredNativeChange.nativeValue
            && previousValue === ignoredNativeChange.appliedValue
        ) {
            delete ignoredNativePairChangeRefs.current[key];
            restoreChecklistSelection(key, ignoredNativeChange.selection);
            return;
        }

        const currentSelection = getChecklistSelection(key, previousValue);
        const pairedInsertion = applyMarkdownPairInsertionWithSelectionFallback(
            previousValue,
            text,
            currentSelection,
            lastChecklistRangeRefs.current[key],
        );
        if (pairedInsertion) {
            lastChecklistRangeRefs.current[key] = null;
            updateChecklistTitle(index, key, pairedInsertion.result.value);
            restoreChecklistSelection(key, pairedInsertion.result.selection);
            return;
        }

        lastChecklistRangeRefs.current[key] = null;
        updateChecklistTitle(index, key, text);
    }, [getChecklistSelection, restoreChecklistSelection, updateChecklistTitle]);

    const handleChecklistKeyPress = React.useCallback((
        index: number,
        key: string,
        event: NativeSyntheticEvent<TextInputKeyPressEventData>,
    ) => {
        const previousValue = checklistTitleRefs.current[key] ?? '';
        const pairedInsertion = applyMarkdownPairKeyPressWithSelectionFallback(
            previousValue,
            event.nativeEvent.key,
            getChecklistSelection(key, previousValue),
            lastChecklistRangeRefs.current[key],
        );
        if (!pairedInsertion) return;

        event.preventDefault?.();
        lastChecklistRangeRefs.current[key] = null;
        ignoredNativePairChangeRefs.current[key] = {
            nativeValue: `${previousValue.slice(0, pairedInsertion.baseSelection.start)}${event.nativeEvent.key}${previousValue.slice(pairedInsertion.baseSelection.end)}`,
            appliedValue: pairedInsertion.result.value,
            selection: pairedInsertion.result.selection,
        };
        updateChecklistTitle(index, key, pairedInsertion.result.value);
        restoreChecklistSelection(key, pairedInsertion.result.selection);
    }, [getChecklistSelection, restoreChecklistSelection, updateChecklistTitle]);

    const handleChecklistDragEnd = React.useCallback(({ from, to }: DragEndParams<ChecklistItem>) => {
        if (from === to) return;

        setEditedTask((prev) => ({
            ...prev,
            checklist: reorderChecklistItems(prev.checklist, from, to),
        }));
    }, [setEditedTask]);

    switch (fieldId) {
        case 'description':
            return (
                <View style={styles.formGroup}>
                    <View style={styles.inlineHeader}>
                        <Text style={[styles.label, { color: tc.secondaryText }]}>{t('taskEdit.descriptionLabel')}</Text>
                        <View style={styles.inlineActions}>
                            <TouchableOpacity onPress={() => setShowDescriptionPreview((value) => !value)}>
                                <Text style={[styles.inlineAction, { color: tc.tint }]}>
                                    {showDescriptionPreview ? t('markdown.edit') : t('markdown.preview')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={openDescriptionExpandedEditor}
                                accessibilityRole="button"
                                accessibilityLabel={t('markdown.expand')}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <Ionicons name="expand-outline" size={20} color={tc.tint} />
                            </TouchableOpacity>
                        </View>
                    </View>
                    {showDescriptionPreview ? (
                        <View style={[styles.markdownPreview, { backgroundColor: tc.filterBg, borderColor: tc.border }]}>
                            <MarkdownText markdown={descriptionDraft || ''} tc={tc} direction={resolvedDirection} />
                        </View>
                    ) : (
                        <>
                            <MarkdownReferenceAutocomplete
                                currentTaskId={editedTask.id}
                                value={descriptionDraft}
                                selection={descriptionSelection}
                                inputRef={descriptionInputRef}
                                visible={isDescriptionInputFocused}
                                onApplyResult={applyDescriptionResult}
                                t={t}
                                tc={tc}
                            />
                            <TextInput
                                ref={descriptionInputRef}
                                style={[styles.input, styles.textArea, inputStyle, textDirectionStyle]}
                                value={descriptionDraft}
                                onFocus={() => {
                                    setIsDescriptionInputFocused(true);
                                    handleInputFocus(undefined);
                                }}
                                onBlur={() => {
                                    const preserveFocus = descriptionToolbarInteractionUntilRef.current > Date.now();
                                    if (preserveFocus) {
                                        requestAnimationFrame(() => {
                                            descriptionInputRef.current?.focus();
                                        });
                                        return;
                                    }
                                    setTimeout(() => {
                                        if (!descriptionInputRef.current?.isFocused?.()) {
                                            setIsDescriptionInputFocused(false);
                                        }
                                    }, 0);
                                }}
                                onChangeText={handleDescriptionChange}
                                onKeyPress={handleDescriptionKeyPress}
                                onSelectionChange={(event) => handleDescriptionSelectionChange(event.nativeEvent.selection)}
                                selection={getControlledTextInputSelection(descriptionSelection, {
                                    force: descriptionSelectionRestorePending,
                                })}
                                placeholder={t('taskEdit.descriptionPlaceholder')}
                                multiline
                                spellCheck={true}
                                autoCorrect={true}
                                autoCapitalize="sentences"
                                autoComplete="off"
                                importantForAutofill="no"
                                inputMode="text"
                                textContentType="none"
                                keyboardType="default"
                                placeholderTextColor={tc.secondaryText}
                                accessibilityLabel={t('taskEdit.descriptionLabel')}
                                accessibilityHint={t('taskEdit.descriptionPlaceholder')}
                            />
                        </>
                    )}
                </View>
            );
        case 'location':
            return (
                <View style={styles.formGroup}>
                    <Text style={[styles.label, { color: tc.secondaryText }]}>{t('taskEdit.locationLabel')}</Text>
                    <TextInput
                        style={[styles.input, inputStyle]}
                        value={String(editedTask.location ?? '')}
                        onChangeText={(location) => setEditedTask((prev) => ({ ...prev, location }))}
                        placeholder={t('taskEdit.locationPlaceholder')}
                        placeholderTextColor={tc.secondaryText}
                        accessibilityLabel={t('taskEdit.locationLabel')}
                        accessibilityHint={t('taskEdit.locationPlaceholder')}
                        onFocus={(event) => {
                            if (event.nativeEvent.target) {
                                handleInputFocus(event.nativeEvent.target);
                            }
                        }}
                    />
                </View>
            );
        case 'attachments':
            return (
                <View style={styles.formGroup}>
                    <View style={styles.attachmentHeader}>
                        <Text style={[styles.label, { color: tc.secondaryText }]}>{t('attachments.title')}</Text>
                    </View>
                    <View style={styles.attachmentActions}>
                        <TouchableOpacity
                            onPress={addFileAttachment}
                            style={[styles.attachmentButton, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                        >
                            <Ionicons name="document-attach-outline" size={16} color={tc.tint} />
                            <Text style={[styles.attachmentButtonText, { color: tc.tint }]} numberOfLines={1}>{t('attachments.addFile')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={addImageAttachment}
                            style={[styles.attachmentButton, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                        >
                            <Ionicons name="image-outline" size={16} color={tc.tint} />
                            <Text style={[styles.attachmentButtonText, { color: tc.tint }]} numberOfLines={1}>{t('attachments.addPhoto')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => {
                                setLinkInputTouched(false);
                                setLinkModalVisible(true);
                            }}
                            style={[styles.attachmentButton, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                        >
                            <Ionicons name="link-outline" size={16} color={tc.tint} />
                            <Text style={[styles.attachmentButtonText, { color: tc.tint }]} numberOfLines={1}>{t('attachments.addLink')}</Text>
                        </TouchableOpacity>
                    </View>
                    {visibleAttachments.length === 0 ? (
                        <Text style={[styles.helperText, { color: tc.secondaryText }]}>{t('common.none')}</Text>
                    ) : (
                        <View style={[styles.attachmentsList, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
                            {visibleAttachments.map((attachment) => {
                                const displayTitle = getAttachmentDisplayTitle(attachment);
                                const isMissing = attachment.kind === 'file'
                                    && (!attachment.uri || attachment.localStatus === 'missing');
                                const canDownload = isMissing && Boolean(attachment.cloudKey);
                                const isDownloading = attachment.localStatus === 'downloading';
                                return (
                                    <View key={attachment.id} style={[styles.attachmentRow, { borderBottomColor: tc.border }]}>
                                        <TouchableOpacity
                                            style={styles.attachmentTitleWrap}
                                            onPress={() => openAttachment(attachment)}
                                            disabled={isDownloading}
                                        >
                                            <Text style={[styles.attachmentTitle, { color: tc.tint }]} numberOfLines={1}>
                                                {displayTitle}
                                            </Text>
                                        </TouchableOpacity>
                                        {isDownloading ? (
                                            <Text style={[styles.attachmentStatus, { color: tc.secondaryText }]}>
                                                {t('common.loading')}
                                            </Text>
                                        ) : canDownload ? (
                                            <TouchableOpacity onPress={() => downloadAttachment(attachment)}>
                                                <Text style={[styles.attachmentDownload, { color: tc.tint }]}>
                                                    {t('attachments.download')}
                                                </Text>
                                            </TouchableOpacity>
                                        ) : isMissing ? (
                                            <Text style={[styles.attachmentStatus, { color: tc.secondaryText }]}>
                                                {t('attachments.missing')}
                                            </Text>
                                        ) : null}
                                        <TouchableOpacity onPress={() => removeAttachment(attachment.id)}>
                                            <Text style={[styles.attachmentRemove, { color: tc.secondaryText }]}>
                                                {t('attachments.remove')}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>
            );
        case 'checklist': {
            const checklistItems = editedTask.checklist || [];
            const canReorderChecklist = checklistItems.length > 1;

            return (
                <View style={styles.formGroup}>
                    <Text style={[styles.label, { color: tc.secondaryText }]}>{t('taskEdit.checklist')}</Text>
                    <View style={[styles.checklistContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                        <NestableDraggableFlatList
                            data={checklistItems}
                            keyExtractor={(item, index) => getChecklistItemKey(item, index)}
                            onDragEnd={handleChecklistDragEnd}
                            renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<ChecklistItem>) => {
                                const index = getIndex() ?? checklistItems.findIndex((entry) => entry === item);
                                if (index < 0) return null;

                                const checklistItemKey = getChecklistItemKey(item, index);
                                return (
                                    <ScaleDecorator>
                                        <View
                                            style={[
                                                styles.checklistItem,
                                                isActive && styles.checklistItemDragging,
                                                { borderBottomColor: tc.border },
                                            ]}
                                        >
                                            <TouchableOpacity
                                                accessibilityLabel={`${t('taskEdit.checklist')} ${index + 1} ${t('projects.reorderTasks')}`}
                                                accessibilityRole="button"
                                                disabled={!canReorderChecklist}
                                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                onLongPress={drag}
                                                delayLongPress={160}
                                                style={[
                                                    styles.checklistDragHandle,
                                                    !canReorderChecklist && styles.checklistDragHandleDisabled,
                                                ]}
                                                testID={`mobile-checklist-reorder-handle-${checklistItemKey}`}
                                            >
                                                <GripVertical
                                                    size={18}
                                                    color={canReorderChecklist ? tc.secondaryText : tc.border}
                                                />
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                onPress={() => {
                                                    const nextChecklist = (editedTask.checklist || []).map((entry, entryIndex) =>
                                                        entryIndex === index ? { ...entry, isCompleted: !entry.isCompleted } : entry
                                                    );
                                                    setEditedTask((prev) => ({ ...prev, checklist: nextChecklist }));
                                                }}
                                                style={styles.checkboxTouch}
                                            >
                                                <View style={[styles.checkbox, item.isCompleted && styles.checkboxChecked]}>
                                                    {item.isCompleted && <Text style={styles.checkmark}>✓</Text>}
                                                </View>
                                            </TouchableOpacity>
                                            <TextInput
                                                ref={(node) => {
                                                    checklistInputRefs.current[checklistItemKey] = node;
                                                }}
                                                style={[
                                                    styles.checklistInput,
                                                    textDirectionStyle,
                                                    { color: item.isCompleted ? tc.secondaryText : tc.text },
                                                    item.isCompleted && styles.completedText,
                                                ]}
                                                value={item.title}
                                                onFocus={(event) => {
                                                    handleInputFocus(event.nativeEvent.target);
                                                }}
                                                onChangeText={(text) => handleChecklistTitleChange(index, checklistItemKey, text)}
                                                onKeyPress={(event) => handleChecklistKeyPress(index, checklistItemKey, event)}
                                                onSelectionChange={(event) => handleChecklistSelectionChange(
                                                    checklistItemKey,
                                                    event.nativeEvent.selection,
                                                )}
                                                placeholder={t('taskEdit.itemNamePlaceholder')}
                                                placeholderTextColor={tc.secondaryText}
                                                accessibilityLabel={`${t('taskEdit.checklist')} ${index + 1}`}
                                                accessibilityHint={t('taskEdit.itemNamePlaceholder')}
                                            />
                                            <TouchableOpacity
                                                onPress={() => {
                                                    const nextChecklist = (editedTask.checklist || []).filter((_, entryIndex) => entryIndex !== index);
                                                    setEditedTask((prev) => ({ ...prev, checklist: nextChecklist }));
                                                }}
                                                style={styles.deleteBtn}
                                            >
                                                <Text style={[styles.deleteBtnText, { color: tc.secondaryText }]}>×</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </ScaleDecorator>
                                );
                            }}
                            activationDistance={4}
                            scrollEnabled={false}
                            style={styles.checklistDragList}
                            testID="mobile-checklist-reorder-list"
                        />
                        <TouchableOpacity
                            style={styles.addChecklistBtn}
                            onPress={() => {
                                const nextItem = {
                                    id: generateUUID(),
                                    title: '',
                                    isCompleted: false,
                                };
                                setEditedTask((prev) => ({
                                    ...prev,
                                    checklist: [...(prev.checklist || []), nextItem],
                                }));
                            }}
                        >
                            <Text style={styles.addChecklistText}>+ {t('taskEdit.addItem')}</Text>
                        </TouchableOpacity>
                        {(editedTask.checklist?.length ?? 0) > 0 && (
                            <View style={styles.checklistActions}>
                                <TouchableOpacity
                                    style={[styles.checklistActionButton, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                                    onPress={handleResetChecklist}
                                >
                                    <Text style={[styles.checklistActionText, { color: tc.secondaryText }]}>
                                        {t('taskEdit.resetChecklist')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </View>
            );
        }
        default:
            return null;
    }
}
