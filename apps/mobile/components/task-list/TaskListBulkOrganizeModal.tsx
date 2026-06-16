import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ClipboardCheck, X } from 'lucide-react-native';
import {
  isSelectableProjectForTaskAssignment,
  parseBulkOrganizeTokenInput,
  tFallback,
  type Area,
  type BulkOrganizeStatus,
  type BulkOrganizeTaskUpdateInput,
  type Project,
} from '@mindwtr/core';

import { styles } from './task-list.styles';

type ThemeColors = {
  border: string;
  cardBg: string;
  danger: string;
  filterBg: string;
  inputBg: string;
  onTint: string;
  secondaryText: string;
  text: string;
  tint: string;
};

type TaskListBulkOrganizeModalProps = {
  areas: Area[];
  isApplying: boolean;
  onApply: (input: BulkOrganizeTaskUpdateInput) => void | Promise<void>;
  onClose: () => void;
  projects: Project[];
  selectedCount: number;
  t: (key: string) => string;
  themeColors: ThemeColors;
  visible: boolean;
};

const STATUS_OPTIONS: BulkOrganizeStatus[] = ['next', 'waiting', 'someday', 'reference', 'done'];
const KEEP_VALUE = '__KEEP__';
const NONE_VALUE = '__NONE__';

export function TaskListBulkOrganizeModal({
  areas,
  isApplying,
  onApply,
  onClose,
  projects,
  selectedCount,
  t,
  themeColors,
  visible,
}: TaskListBulkOrganizeModalProps) {
  const [status, setStatus] = useState<BulkOrganizeStatus>('next');
  const [projectChoice, setProjectChoice] = useState(KEEP_VALUE);
  const [areaChoice, setAreaChoice] = useState(KEEP_VALUE);
  const [contextsInput, setContextsInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const [delegateWho, setDelegateWho] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStatus('next');
    setProjectChoice(KEEP_VALUE);
    setAreaChoice(KEEP_VALUE);
    setContextsInput('');
    setTagsInput('');
    setStartDate('');
    setDueDate('');
    setReviewDate('');
    setDelegateWho('');
    setShowValidation(false);
  }, [visible]);

  const activeProjects = useMemo(
    () => projects
      .filter(isSelectableProjectForTaskAssignment)
      .sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );
  const activeAreas = useMemo(
    () => areas
      .filter((area) => !area.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [areas],
  );

  const selectedProjectId = projectChoice !== KEEP_VALUE && projectChoice !== NONE_VALUE ? projectChoice : undefined;
  const isWaiting = status === 'waiting';
  const canApply = selectedCount > 0 && (!isWaiting || delegateWho.trim().length > 0);

  const renderChip = (label: string, selected: boolean, onPress: () => void, disabled = false) => (
    <TouchableOpacity
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled || isApplying}
      onPress={onPress}
      style={[
        styles.bulkOrganizeChip,
        {
          backgroundColor: selected ? themeColors.tint : themeColors.filterBg,
          borderColor: selected ? themeColors.tint : themeColors.border,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.bulkOrganizeChipText, { color: selected ? themeColors.onTint : themeColors.text }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const apply = () => {
    if (!canApply) {
      setShowValidation(true);
      return;
    }
    const input: BulkOrganizeTaskUpdateInput = {
      status,
      contexts: parseBulkOrganizeTokenInput(contextsInput, '@'),
      tags: parseBulkOrganizeTokenInput(tagsInput, '#'),
    };

    if (projectChoice !== KEEP_VALUE) {
      input.projectId = projectChoice === NONE_VALUE ? null : projectChoice;
    }
    if (!selectedProjectId && areaChoice !== KEEP_VALUE) {
      input.areaId = areaChoice === NONE_VALUE ? null : areaChoice;
    }
    if (startDate.trim()) input.startTime = startDate.trim();
    if (dueDate.trim()) input.dueDate = dueDate.trim();
    if (reviewDate.trim()) input.reviewAt = reviewDate.trim();
    if (isWaiting) input.assignedTo = delegateWho.trim();

    void onApply(input);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable
          style={[styles.bulkOrganizeCard, { backgroundColor: themeColors.cardBg, borderColor: themeColors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.bulkOrganizeHeader}>
            <View style={styles.bulkOrganizeTitleRow}>
              <ClipboardCheck size={18} color={themeColors.tint} />
              <View style={styles.bulkOrganizeTitleBlock}>
                <Text style={[styles.bulkOrganizeTitle, { color: themeColors.text }]}>
                  {tFallback(t, 'bulk.organize', 'Bulk organize')}
                </Text>
                <Text style={[styles.bulkOrganizeSubtitle, { color: themeColors.secondaryText }]}>
                  {selectedCount} {tFallback(t, 'bulk.selected', 'selected')} - {tFallback(t, 'bulk.organizeHintShort', 'Titles and descriptions stay unchanged.')}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={tFallback(t, 'common.close', 'Close')}
              hitSlop={8}
              onPress={onClose}
              style={styles.bulkOrganizeCloseButton}
            >
              <X size={20} color={themeColors.secondaryText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.bulkOrganizeScroll}
            contentContainerStyle={styles.bulkOrganizeContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.bulkOrganizeSection}>
              <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'bulk.organizeStatus', 'Status')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkOrganizeChipRow}>
                {STATUS_OPTIONS.map((option) => renderChip(
                  tFallback(t, `status.${option}`, option),
                  status === option,
                  () => {
                    setStatus(option);
                    setShowValidation(false);
                  },
                ))}
              </ScrollView>
            </View>

            <View style={styles.bulkOrganizeSection}>
              <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'taskEdit.projectLabel', 'Project')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkOrganizeChipRow}>
                {renderChip(tFallback(t, 'bulk.keepProject', 'Keep project'), projectChoice === KEEP_VALUE, () => setProjectChoice(KEEP_VALUE))}
                {renderChip(tFallback(t, 'taskEdit.noProjectOption', 'No project'), projectChoice === NONE_VALUE, () => setProjectChoice(NONE_VALUE))}
                {activeProjects.map((project) => renderChip(project.title, projectChoice === project.id, () => {
                  setProjectChoice(project.id);
                  setAreaChoice(KEEP_VALUE);
                }))}
              </ScrollView>
            </View>

            <View style={styles.bulkOrganizeSection}>
              <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'projects.areaLabel', 'Area')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bulkOrganizeChipRow}>
                {renderChip(tFallback(t, 'bulk.keepArea', 'Keep area'), areaChoice === KEEP_VALUE, () => setAreaChoice(KEEP_VALUE), Boolean(selectedProjectId))}
                {renderChip(tFallback(t, 'taskEdit.noAreaOption', 'No area'), areaChoice === NONE_VALUE, () => setAreaChoice(NONE_VALUE), Boolean(selectedProjectId))}
                {activeAreas.map((area) => renderChip(area.name, areaChoice === area.id, () => setAreaChoice(area.id), Boolean(selectedProjectId)))}
              </ScrollView>
            </View>

            {isWaiting && (
              <View style={styles.bulkOrganizeSection}>
                <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                  {tFallback(t, 'process.delegateWhoLabel', 'Waiting for')}
                </Text>
                <TextInput
                  value={delegateWho}
                  onChangeText={(value) => {
                    setDelegateWho(value);
                    setShowValidation(false);
                  }}
                  placeholder={tFallback(t, 'process.delegateWhoPlaceholder', 'Person or team')}
                  placeholderTextColor={themeColors.secondaryText}
                  style={[
                    styles.bulkOrganizeInput,
                    { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                  ]}
                />
              </View>
            )}

            <View style={styles.bulkOrganizeDateGrid}>
              <View style={styles.bulkOrganizeDateField}>
                <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                  {tFallback(t, 'taskEdit.startDateLabel', 'Start')}
                </Text>
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={themeColors.secondaryText}
                  style={[
                    styles.bulkOrganizeInput,
                    { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                  ]}
                />
              </View>
              <View style={styles.bulkOrganizeDateField}>
                <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                  {tFallback(t, 'taskEdit.dueDateLabel', 'Due')}
                </Text>
                <TextInput
                  value={dueDate}
                  onChangeText={setDueDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={themeColors.secondaryText}
                  style={[
                    styles.bulkOrganizeInput,
                    { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                  ]}
                />
              </View>
              <View style={styles.bulkOrganizeDateField}>
                <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                  {isWaiting ? tFallback(t, 'process.followUpLabel', 'Follow-up') : tFallback(t, 'taskEdit.reviewDateLabel', 'Review')}
                </Text>
                <TextInput
                  value={reviewDate}
                  onChangeText={setReviewDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={themeColors.secondaryText}
                  style={[
                    styles.bulkOrganizeInput,
                    { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                  ]}
                />
              </View>
            </View>

            <View style={styles.bulkOrganizeSection}>
              <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'taskEdit.contextsLabel', 'Contexts')}
              </Text>
              <TextInput
                value={contextsInput}
                onChangeText={setContextsInput}
                placeholder="@computer, @office"
                placeholderTextColor={themeColors.secondaryText}
                style={[
                  styles.bulkOrganizeInput,
                  { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                ]}
              />
            </View>

            <View style={styles.bulkOrganizeSection}>
              <Text style={[styles.bulkOrganizeLabel, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'taskEdit.tagsLabel', 'Tags')}
              </Text>
              <TextInput
                value={tagsInput}
                onChangeText={setTagsInput}
                placeholder="#project, #admin"
                placeholderTextColor={themeColors.secondaryText}
                style={[
                  styles.bulkOrganizeInput,
                  { backgroundColor: themeColors.inputBg, borderColor: themeColors.border, color: themeColors.text },
                ]}
              />
            </View>

            {showValidation && (
              <Text style={[styles.bulkOrganizeValidation, { color: themeColors.danger }]}>
                {tFallback(t, 'bulk.waitingPersonRequired', 'Choose who these items are waiting for.')}
              </Text>
            )}
          </ScrollView>

          <View style={[styles.bulkOrganizeFooter, { borderTopColor: themeColors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isApplying}
              style={styles.bulkOrganizeFooterButton}
              accessibilityRole="button"
            >
              <Text style={[styles.bulkOrganizeFooterText, { color: themeColors.secondaryText }]}>
                {tFallback(t, 'common.cancel', 'Cancel')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={apply}
              disabled={isApplying || selectedCount === 0}
              style={[
                styles.bulkOrganizeApplyButton,
                { backgroundColor: themeColors.tint, opacity: isApplying || selectedCount === 0 ? 0.6 : 1 },
              ]}
              accessibilityRole="button"
            >
              {isApplying ? (
                <ActivityIndicator size="small" color={themeColors.onTint} />
              ) : null}
              <Text style={[styles.bulkOrganizeApplyText, { color: themeColors.onTint }]}>
                {tFallback(t, 'bulk.applyToSelected', 'Apply to selected')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
