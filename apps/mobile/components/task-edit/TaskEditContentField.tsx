import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { generateUUID, getAttachmentDisplayTitle, resolveAutoTextDirection } from '@mindwtr/core';

import { MarkdownReferenceAutocomplete } from '../markdown-reference-autocomplete';
import { MarkdownText } from '../markdown-text';
import { getControlledTextInputSelection } from '../text-input-selection';
import type { TaskEditFieldRendererProps } from './TaskEditFieldRenderer.types';

type ContentFieldId = 'description' | 'location' | 'attachments' | 'checklist';

type TaskEditContentFieldProps = TaskEditFieldRendererProps & {
    fieldId: ContentFieldId;
};

export function TaskEditContentField({
    addFileAttachment,
    addImageAttachment,
    applyDescriptionResult,
    descriptionDraft,
    descriptionInputRef,
    descriptionSelection,
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
                                onFocus={(event) => {
                                    setIsDescriptionInputFocused(true);
                                    handleInputFocus(event.nativeEvent.target);
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
                                onSelectionChange={(event) => setDescriptionSelection(event.nativeEvent.selection)}
                                selection={getControlledTextInputSelection(descriptionSelection)}
                                placeholder={t('taskEdit.descriptionPlaceholder')}
                                multiline
                                spellCheck={true}
                                autoCorrect={true}
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
        case 'checklist':
            return (
                <View style={styles.formGroup}>
                    <Text style={[styles.label, { color: tc.secondaryText }]}>{t('taskEdit.checklist')}</Text>
                    <View style={[styles.checklistContainer, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                        {editedTask.checklist?.map((item, index) => (
                            <View key={item.id || index} style={[styles.checklistItem, { borderBottomColor: tc.border }]}>
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
                                    onChangeText={(text) => {
                                        const nextChecklist = (editedTask.checklist || []).map((entry, entryIndex) =>
                                            entryIndex === index ? { ...entry, title: text } : entry
                                        );
                                        setEditedTask((prev) => ({ ...prev, checklist: nextChecklist }));
                                    }}
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
                        ))}
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
        default:
            return null;
    }
}
