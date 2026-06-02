import React from 'react';
import type { RefObject } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AtSign, CalendarDays, ChevronDown, ChevronUp, Clock, Flag, Folder, Mic, SlidersHorizontal, Square, X } from 'lucide-react-native';
import type { ThemeColors } from '@/hooks/use-theme-colors';
import { QuickDateChips } from '../QuickDateChips';
import { styles } from './quick-capture-sheet.styles';

const COMPACT_TEXT_MAX_SCALE = 1.2;

interface QuickCaptureSheetBodyProps {
  addAnother: boolean;
  areaLabel: string;
  children?: React.ReactNode;
  contextLabel: string;
  dueLabel: string;
  dueDate: Date | null;
  dueTimeLabel: string;
  handleClose: () => void;
  handleSave: () => void;
  insetsBottom: number;
  inputRef: RefObject<TextInput | null>;
  onOpenAreaPicker: () => void;
  onOpenContextPicker: () => void;
  onOpenDueDatePicker: () => void;
  onOpenDueTimePicker: () => void;
  onOpenPriorityPicker: () => void;
  onOpenProjectPicker: () => void;
  onQuickDueDateSelect: (date: Date | null) => void;
  onResetArea: () => void;
  onResetContexts: () => void;
  onResetDueDate: () => void;
  onResetDueTime: () => void;
  onResetPriority: () => void;
  onResetProject: () => void;
  onToggleOptions: () => void;
  onToggleAddAnother: (value: boolean) => void;
  onToggleRecording: () => void;
  onValueChange: (value: string) => void;
  optionsExpanded: boolean;
  hasArea: boolean;
  hasContexts: boolean;
  hasPriority: boolean;
  hasProject: boolean;
  prioritiesEnabled: boolean;
  priorityLabel: string;
  projectLabel: string;
  recording: boolean;
  recordingBusy: boolean;
  recordingReady: boolean;
  sheetMaxHeight: number;
  showDueTime: boolean;
  t: (key: string) => string;
  tc: ThemeColors;
  value: string;
  visible: boolean;
}

export function QuickCaptureSheetBody({
  addAnother,
  areaLabel,
  children,
  contextLabel,
  dueDate,
  dueLabel,
  dueTimeLabel,
  handleClose,
  handleSave,
  insetsBottom,
  inputRef,
  onOpenAreaPicker,
  onOpenContextPicker,
  onOpenDueDatePicker,
  onOpenDueTimePicker,
  onOpenPriorityPicker,
  onOpenProjectPicker,
  onQuickDueDateSelect,
  onResetArea,
  onResetContexts,
  onResetDueDate,
  onResetDueTime,
  onResetPriority,
  onResetProject,
  onToggleOptions,
  onToggleAddAnother,
  onToggleRecording,
  onValueChange,
  optionsExpanded,
  hasArea,
  hasContexts,
  hasPriority,
  hasProject,
  prioritiesEnabled,
  priorityLabel,
  projectLabel,
  recording,
  recordingBusy,
  recordingReady,
  sheetMaxHeight,
  showDueTime,
  t,
  tc,
  value,
  visible,
}: QuickCaptureSheetBodyProps) {
  const hasMetadataSummary = Boolean(dueDate || hasContexts || hasArea || hasProject || hasPriority);
  const optionsToggleLabel = optionsExpanded ? t('taskEdit.hideOptions') : t('taskEdit.moreOptions');

  return (
    <Modal
      visible={visible}
      transparent
      // Transparent Android modal animations can blend stale frames on some tablet GPUs.
      animationType={Platform.OS === 'android' ? 'none' : 'slide'}
      hardwareAccelerated={Platform.OS === 'android'}
      navigationBarTranslucent={Platform.OS === 'android'}
      statusBarTranslucent={Platform.OS === 'android'}
      accessibilityViewIsModal
      onRequestClose={handleClose}
    >
      <View style={styles.modalRoot} accessibilityViewIsModal>
        <Pressable
          style={styles.backdrop}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
          style={styles.keyboardAvoiding}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: tc.cardBg,
                paddingBottom: Math.max(20, insetsBottom + 12),
                maxHeight: sheetMaxHeight,
              },
            ]}
          >
            <View style={styles.headerRow}>
              <Text
                style={[styles.title, { color: tc.text }]}
                numberOfLines={1}
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
              >
                {t('nav.addTask')}
              </Text>
              <TouchableOpacity onPress={handleClose} accessibilityLabel={t('common.close')}>
                <X size={18} color={tc.secondaryText} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={[styles.input, { backgroundColor: tc.inputBg, borderColor: tc.border, color: tc.text }]}
                placeholder={t('quickAdd.inputLabel')}
                placeholderTextColor={tc.secondaryText}
                value={value}
                onChangeText={onValueChange}
                accessibilityLabel={t('quickAdd.inputLabel')}
                accessibilityHint={t('quickAdd.inputHint')}
                onSubmitEditing={() => {
                  inputRef.current?.blur();
                  handleSave();
                }}
                returnKeyType="done"
                blurOnSubmit
                numberOfLines={1}
                textAlignVertical="center"
                maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
              />
              <TouchableOpacity
                onPress={onToggleRecording}
                accessibilityRole="button"
                accessibilityLabel={recording ? t('quickAdd.audioStop') : t('quickAdd.audioRecord')}
                style={[
                  styles.recordButton,
                  {
                    backgroundColor: recordingReady ? tc.danger : tc.filterBg,
                    borderColor: tc.border,
                    opacity: recordingBusy ? 0.6 : 1,
                  },
                ]}
                disabled={recordingBusy}
              >
                {recordingReady ? (
                  <Square size={16} color={tc.onTint} />
                ) : (
                  <Mic size={16} color={tc.text} />
                )}
              </TouchableOpacity>
            </View>

            {recordingReady && (
              <View style={styles.recordingRow}>
                <View style={[styles.recordingDot, { backgroundColor: tc.danger }]} />
                <Text
                  style={[styles.recordingText, { color: tc.danger }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                >
                  {t('quickAdd.audioRecording')}
                </Text>
              </View>
            )}

            <View style={styles.optionsHeaderRow}>
              <TouchableOpacity
                style={[styles.optionsToggle, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                onPress={onToggleOptions}
                accessibilityRole="button"
                accessibilityLabel={optionsToggleLabel}
                accessibilityState={{ expanded: optionsExpanded }}
              >
                <SlidersHorizontal size={16} color={tc.text} />
                <Text
                  style={[styles.optionsToggleText, { color: tc.text }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                >
                  {optionsToggleLabel}
                </Text>
                {optionsExpanded ? (
                  <ChevronUp size={16} color={tc.secondaryText} />
                ) : (
                  <ChevronDown size={16} color={tc.secondaryText} />
                )}
              </TouchableOpacity>
            </View>

            {!optionsExpanded && hasMetadataSummary && (
              <View style={styles.summaryRow}>
                {dueDate && (
                  <TouchableOpacity
                    style={[styles.summaryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenDueDatePicker}
                    onLongPress={onResetDueDate}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.dueDate')}: ${dueLabel}`}
                  >
                    <CalendarDays size={14} color={tc.secondaryText} />
                    <Text
                      style={[styles.summaryChipText, { color: tc.secondaryText }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {dueLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                {hasContexts && (
                  <TouchableOpacity
                    style={[styles.summaryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenContextPicker}
                    onLongPress={onResetContexts}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.contextsLabel')}: ${contextLabel}`}
                  >
                    <AtSign size={14} color={tc.secondaryText} />
                    <Text
                      style={[styles.summaryChipText, { color: tc.secondaryText }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {contextLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                {hasArea && (
                  <TouchableOpacity
                    style={[styles.summaryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenAreaPicker}
                    onLongPress={onResetArea}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.areaLabel')}: ${areaLabel}`}
                  >
                    <Text
                      style={[styles.summaryChipText, { color: tc.secondaryText }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {areaLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                {hasProject && (
                  <TouchableOpacity
                    style={[styles.summaryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenProjectPicker}
                    onLongPress={onResetProject}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.project')}: ${projectLabel}`}
                  >
                    <Folder size={14} color={tc.secondaryText} />
                    <Text
                      style={[styles.summaryChipText, { color: tc.secondaryText }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {projectLabel}
                    </Text>
                  </TouchableOpacity>
                )}

                {hasPriority && (
                  <TouchableOpacity
                    style={[styles.summaryChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenPriorityPicker}
                    onLongPress={onResetPriority}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.priorityLabel')}: ${priorityLabel}`}
                  >
                    <Flag size={14} color={tc.secondaryText} />
                    <Text
                      style={[styles.summaryChipText, { color: tc.secondaryText }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {priorityLabel}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {optionsExpanded && (
              <>
                <View style={styles.optionsRow}>
                  {showDueTime && (
                    <TouchableOpacity
                      style={[styles.optionChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                      onPress={onOpenDueTimePicker}
                      onLongPress={onResetDueTime}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('task.aria.dueTime')}: ${dueTimeLabel}`}
                    >
                      <Clock size={16} color={tc.text} />
                      <Text
                        style={[styles.optionText, { color: tc.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                      >
                        {dueTimeLabel}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.optionChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenContextPicker}
                    onLongPress={onResetContexts}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.contextsLabel')}: ${contextLabel}`}
                  >
                    <AtSign size={16} color={tc.text} />
                    <Text
                      style={[styles.optionText, { color: tc.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {contextLabel}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.optionChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenAreaPicker}
                    onLongPress={onResetArea}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.areaLabel')}: ${areaLabel}`}
                  >
                    <Text
                      style={[styles.optionText, { color: tc.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {areaLabel}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.optionChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                    onPress={onOpenProjectPicker}
                    onLongPress={onResetProject}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('taskEdit.project')}: ${projectLabel}`}
                  >
                    <Folder size={16} color={tc.text} />
                    <Text
                      style={[styles.optionText, { color: tc.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                    >
                      {projectLabel}
                    </Text>
                  </TouchableOpacity>

                  {prioritiesEnabled && (
                    <TouchableOpacity
                      style={[styles.optionChip, { backgroundColor: tc.filterBg, borderColor: tc.border }]}
                      onPress={onOpenPriorityPicker}
                      onLongPress={onResetPriority}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('taskEdit.priorityLabel')}: ${priorityLabel}`}
                    >
                      <Flag size={16} color={tc.text} />
                      <Text
                        style={[styles.optionText, { color: tc.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                      >
                        {priorityLabel}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text
                  style={[styles.syntaxHint, { color: tc.secondaryText }]}
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                >
                  {t('quickAdd.placeholder')}
                </Text>

                <QuickDateChips
                  t={t}
                  tc={tc}
                  selectedDate={dueDate}
                  onSelect={(date) => onQuickDueDateSelect(date)}
                />

                <TouchableOpacity
                  style={[styles.customDateButton, { borderColor: tc.border }]}
                  onPress={onOpenDueDatePicker}
                  onLongPress={onResetDueDate}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('taskEdit.dueDate')}: ${dueLabel}`}
                >
                  <CalendarDays size={14} color={tc.secondaryText} />
                  <Text
                    style={[styles.customDateButtonText, { color: tc.secondaryText }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                  >
                    {t('recurrence.custom')}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.footerRow}>
              <View style={styles.toggleRow}>
                <Switch
                  value={addAnother}
                  onValueChange={onToggleAddAnother}
                  thumbColor={addAnother ? tc.tint : tc.border}
                  trackColor={{ false: tc.border, true: `${tc.tint}55` }}
                  accessibilityLabel={t('quickAdd.addAnother')}
                />
                <Text
                  style={[styles.toggleText, { color: tc.text }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                >
                  {t('quickAdd.addAnother')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handleSave}
                style={[styles.saveButton, { backgroundColor: tc.tint, opacity: value.trim() ? 1 : 0.5 }]}
                disabled={!value.trim()}
                accessibilityRole="button"
                accessibilityLabel={t('common.save')}
              >
                <Text
                  style={styles.saveText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={COMPACT_TEXT_MAX_SCALE}
                >
                  {t('common.save')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
        {children}
      </View>
    </Modal>
  );
}
