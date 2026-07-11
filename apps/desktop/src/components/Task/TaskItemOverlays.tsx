import React from 'react';
import { translateWithFallback, type RecurrenceWeekday } from '@mindwtr/core';
import { ConfirmModal } from '../ConfirmModal';
import { PromptModal } from '../PromptModal';
import { AttachmentModals } from './AttachmentModals';
import { TaskItemRecurrenceModal } from './TaskItemRecurrenceModal';
import { WEEKDAY_ORDER } from './recurrence-constants';

type TaskItemOverlaysProps = {
    applyCustomRecurrence: () => void;
    audioAttachment: any;
    audioError: string | null;
    audioRef: React.RefObject<HTMLAudioElement | null>;
    audioSource: string | null;
    audioTranscribing: boolean;
    audioTranscriptionError: string | null;
    clearLinkPrompt: () => void;
    closeAudio: () => void;
    closeImage: () => void;
    closeText: () => void;
    customInterval: number;
    customMode: 'date' | 'nth';
    customMonthDay: number;
    customOrdinal: '1' | '2' | '3' | '4' | '-1';
    customWeekday: RecurrenceWeekday;
    handleAddLinkAttachment: (value: string) => boolean;
    handleAudioError: () => void;
    handleDiscardChanges: () => void;
    handleOpenDiscardConfirm: (open: boolean) => void;
    imageAttachment: any;
    imageSource: string | null;
    onOpenImageExternally: () => void;
    onOpenTextExternally: () => void;
    openAudioExternally: () => void;
    openDiscardConfirm: boolean;
    openLinkPrompt: boolean;
    linkPromptDefaultValue: string;
    linkPromptTitle: string;
    linkPromptDescription: string;
    linkPromptPlaceholder: string;
    linkPromptBrowseLabel?: string;
    onBrowseLinkFile?: () => Promise<string | null>;
    openWaitingAssignmentPrompt: boolean;
    onCancelWaitingAssignmentPrompt: () => void;
    onConfirmWaitingAssignmentPrompt: (value: string) => void;
    waitingAssignmentDefaultValue: string;
    waitingAssignmentSuggestions?: readonly string[];
    retryAudioTranscription: () => void;
    setCustomInterval: (value: number) => void;
    setCustomMode: (value: 'date' | 'nth') => void;
    setCustomMonthDay: (value: number) => void;
    setCustomOrdinal: (value: '1' | '2' | '3' | '4' | '-1') => void;
    setCustomWeekday: (value: RecurrenceWeekday) => void;
    setShowCustomRecurrence: (value: boolean) => void;
    showCustomRecurrence: boolean;
    t: (key: string) => string;
    textAttachment: any;
    textContent: string;
    textError: string | null;
    textLoading: boolean;
    weekdayLabels: Record<RecurrenceWeekday, string>;
};

export function TaskItemOverlays({
    applyCustomRecurrence,
    audioAttachment,
    audioError,
    audioRef,
    audioSource,
    audioTranscribing,
    audioTranscriptionError,
    clearLinkPrompt,
    closeAudio,
    closeImage,
    closeText,
    customInterval,
    customMode,
    customMonthDay,
    customOrdinal,
    customWeekday,
    handleAddLinkAttachment,
    handleAudioError,
    handleDiscardChanges,
    handleOpenDiscardConfirm,
    imageAttachment,
    imageSource,
    onOpenImageExternally,
    onOpenTextExternally,
    openAudioExternally,
    openDiscardConfirm,
    openLinkPrompt,
    linkPromptDefaultValue,
    linkPromptTitle,
    linkPromptDescription,
    linkPromptPlaceholder,
    linkPromptBrowseLabel,
    onBrowseLinkFile,
    openWaitingAssignmentPrompt,
    onCancelWaitingAssignmentPrompt,
    onConfirmWaitingAssignmentPrompt,
    waitingAssignmentDefaultValue,
    waitingAssignmentSuggestions,
    retryAudioTranscription,
    setCustomInterval,
    setCustomMode,
    setCustomMonthDay,
    setCustomOrdinal,
    setCustomWeekday,
    setShowCustomRecurrence,
    showCustomRecurrence,
    t,
    textAttachment,
    textContent,
    textError,
    textLoading,
    weekdayLabels,
}: TaskItemOverlaysProps) {
    const resolveText = (key: string, fallback: string) => {
        return translateWithFallback(t, key, fallback);
    };
    const waitingAssignmentPromptTitle = resolveText('process.waitingFor', 'Who/what are you waiting for?');
    const waitingAssignmentPromptDescription = resolveText(
        'process.waitingForDesc',
        "Add a note to remember what you're waiting on",
    );
    const waitingAssignmentPlaceholder = resolveText(
        'taskEdit.assignedToPlaceholder',
        'Who is this waiting for?',
    );

    return (
        <>
            {showCustomRecurrence && (
                <TaskItemRecurrenceModal
                    t={t}
                    weekdayOrder={WEEKDAY_ORDER}
                    weekdayLabels={weekdayLabels}
                    customInterval={customInterval}
                    customMode={customMode}
                    customOrdinal={customOrdinal}
                    customWeekday={customWeekday}
                    customMonthDay={customMonthDay}
                    onIntervalChange={setCustomInterval}
                    onModeChange={setCustomMode}
                    onOrdinalChange={setCustomOrdinal}
                    onWeekdayChange={setCustomWeekday}
                    onMonthDayChange={(value) => {
                        const safe = Number.isFinite(value) ? Math.min(Math.max(value, 1), 31) : 1;
                        setCustomMonthDay(safe);
                    }}
                    onClose={() => setShowCustomRecurrence(false)}
                    onApply={applyCustomRecurrence}
                />
            )}
            {openLinkPrompt && (
                <PromptModal
                    isOpen={openLinkPrompt}
                    title={linkPromptTitle}
                    description={linkPromptDescription}
                    placeholder={linkPromptPlaceholder}
                    defaultValue={linkPromptDefaultValue}
                    browseLabel={linkPromptBrowseLabel}
                    onBrowse={onBrowseLinkFile}
                    confirmLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                    onCancel={clearLinkPrompt}
                    onConfirm={(value) => {
                        const added = handleAddLinkAttachment(value);
                        if (!added) return;
                        clearLinkPrompt();
                    }}
                />
            )}
            {openWaitingAssignmentPrompt && (
                <PromptModal
                    isOpen={openWaitingAssignmentPrompt}
                    title={waitingAssignmentPromptTitle}
                    description={waitingAssignmentPromptDescription}
                    placeholder={waitingAssignmentPlaceholder}
                    defaultValue={waitingAssignmentDefaultValue}
                    suggestions={waitingAssignmentSuggestions}
                    allowEmptyConfirm
                    confirmLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                    onCancel={onCancelWaitingAssignmentPrompt}
                    onConfirm={onConfirmWaitingAssignmentPrompt}
                />
            )}
            {openDiscardConfirm && (
                <ConfirmModal
                    isOpen={openDiscardConfirm}
                    title={resolveText('taskEdit.discardChanges', 'Discard unsaved changes?')}
                    description={resolveText('taskEdit.discardChangesDesc', 'Your changes will be lost if you leave now.')}
                    confirmLabel={resolveText('common.discard', 'Discard')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => handleOpenDiscardConfirm(false)}
                    onConfirm={() => {
                        handleOpenDiscardConfirm(false);
                        handleDiscardChanges();
                    }}
                />
            )}
            <AttachmentModals
                audioAttachment={audioAttachment}
                audioSource={audioSource}
                audioRef={audioRef}
                audioError={audioError}
                audioTranscribing={audioTranscribing}
                audioTranscriptionError={audioTranscriptionError}
                onCloseAudio={closeAudio}
                onAudioError={handleAudioError}
                onOpenAudioExternally={openAudioExternally}
                onRetryAudioTranscription={retryAudioTranscription}
                imageAttachment={imageAttachment}
                imageSource={imageSource}
                onCloseImage={closeImage}
                onOpenImageExternally={onOpenImageExternally}
                textAttachment={textAttachment}
                textContent={textContent}
                textLoading={textLoading}
                textError={textError}
                onCloseText={closeText}
                onOpenTextExternally={onOpenTextExternally}
                t={t}
            />
        </>
    );
}
