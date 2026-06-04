import React from 'react';
import { FlatList, Modal, Platform, Text, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { QuickCaptureSheetBody } from './QuickCaptureSheetBody';
import { QuickCaptureSheetPickers } from './QuickCaptureSheetPickers';

vi.mock('@react-native-community/datetimepicker', () => ({
  default: (props: Record<string, unknown>) => React.createElement('DateTimePicker', props),
}));

const tc: any = {
  cardBg: '#111827',
  border: '#334155',
  danger: '#ef4444',
  filterBg: '#1f2937',
  inputBg: '#0f172a',
  onTint: '#ffffff',
  secondaryText: '#94a3b8',
  text: '#f8fafc',
  tint: '#3b82f6',
};

describe('Quick capture modal composition', () => {
  it('does not mount picker modals while every picker is closed', () => {
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <QuickCaptureSheetPickers
          areas={[]}
          contextInputRef={{ current: null }}
          contextOptionsLoading={false}
          contextQuery=""
          contextTags={[]}
          dueDate={null}
          filteredContexts={[]}
          filteredProjects={[]}
          hasAddableContextTokens={false}
          hasExactProjectMatch={false}
          onAddContextFromQuery={vi.fn()}
          onClearContexts={vi.fn()}
          onCloseAreaPicker={vi.fn()}
          onCloseContextPicker={vi.fn()}
          onClosePriorityPicker={vi.fn()}
          onCloseProjectPicker={vi.fn()}
          onContextQueryChange={vi.fn()}
          onDueDateChange={vi.fn()}
          onDueTimeChange={vi.fn()}
          onProjectQueryChange={vi.fn()}
          onRemoveContext={vi.fn()}
          onSelectArea={vi.fn()}
          onSelectContext={vi.fn()}
          onSelectPriority={vi.fn()}
          onSelectProject={vi.fn()}
          onStartTimeChange={vi.fn()}
          onSubmitContextQuery={vi.fn()}
          onSubmitProjectQuery={vi.fn()}
          pendingStartDate={null}
          prioritiesEnabled
          priorityOptions={['low', 'medium', 'high', 'urgent']}
          projectQuery=""
          selectedAreaId={null}
          selectedPriority={null}
          showAreaPicker={false}
          showContextPicker={false}
          showDatePicker={false}
          showDueTimePicker={false}
          showPriorityPicker={false}
          showProjectPicker={false}
          startPickerMode={null}
          startTime={null}
          t={(key) => key}
          tc={tc}
        />
      );
    });

    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
  });

  it('renders the requested picker overlay without a nested native modal', () => {
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <QuickCaptureSheetPickers
          areas={[]}
          contextInputRef={{ current: null }}
          contextOptionsLoading={false}
          contextQuery=""
          contextTags={[]}
          dueDate={null}
          filteredContexts={['@home']}
          filteredProjects={[]}
          hasAddableContextTokens={false}
          hasExactProjectMatch={false}
          onAddContextFromQuery={vi.fn()}
          onClearContexts={vi.fn()}
          onCloseAreaPicker={vi.fn()}
          onCloseContextPicker={vi.fn()}
          onClosePriorityPicker={vi.fn()}
          onCloseProjectPicker={vi.fn()}
          onContextQueryChange={vi.fn()}
          onDueDateChange={vi.fn()}
          onDueTimeChange={vi.fn()}
          onProjectQueryChange={vi.fn()}
          onRemoveContext={vi.fn()}
          onSelectArea={vi.fn()}
          onSelectContext={vi.fn()}
          onSelectPriority={vi.fn()}
          onSelectProject={vi.fn()}
          onStartTimeChange={vi.fn()}
          onSubmitContextQuery={vi.fn()}
          onSubmitProjectQuery={vi.fn()}
          pendingStartDate={null}
          prioritiesEnabled
          priorityOptions={['low', 'medium', 'high', 'urgent']}
          projectQuery=""
          selectedAreaId={null}
          selectedPriority={null}
          showAreaPicker={false}
          showContextPicker
          showDatePicker={false}
          showDueTimePicker={false}
          showPriorityPicker={false}
          showProjectPicker={false}
          startPickerMode={null}
          startTime={null}
          t={(key) => key}
          tc={tc}
        />
      );
    });

    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    const overlays = tree.root.findAll((node) => node.props.accessibilityViewIsModal === true);
    expect(overlays.length).toBeGreaterThan(0);
    expect(tree.root.findByType(FlatList).props.accessibilityRole).toBe('list');
    expect(tree.root.findByProps({ accessibilityRole: 'header' }).props.children).toBe('taskEdit.contextsLabel');
  });

  it('disables Android modal animation to avoid ghosted sheet trails', () => {
    let tree!: ReturnType<typeof create>;
    const originalPlatformOs = Platform.OS;

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    try {
      act(() => {
        tree = create(
          <QuickCaptureSheetBody
            addAnother={false}
            areaLabel="No Area"
            contextLabel="Contexts"
            dueDate={null}
            dueLabel="Due Date"
            dueTimeLabel="Change time"
            handleClose={vi.fn()}
            handleSave={vi.fn()}
            insetsBottom={0}
            inputRef={{ current: null }}
            onOpenAreaPicker={vi.fn()}
            onOpenContextPicker={vi.fn()}
            onOpenDueDatePicker={vi.fn()}
            onOpenDueTimePicker={vi.fn()}
            onOpenPriorityPicker={vi.fn()}
            onOpenProjectPicker={vi.fn()}
            onQuickDueDateSelect={vi.fn()}
            onResetArea={vi.fn()}
            onResetContexts={vi.fn()}
            onResetDueDate={vi.fn()}
            onResetDueTime={vi.fn()}
            onResetPriority={vi.fn()}
            onResetProject={vi.fn()}
            onToggleOptions={vi.fn()}
            onToggleAddAnother={vi.fn()}
            onToggleRecording={vi.fn()}
            onValueChange={vi.fn()}
            optionsExpanded={false}
            prioritiesEnabled
            priorityLabel="Priority"
            projectLabel="Project"
            recording={false}
            recordingBusy={false}
            recordingReady={false}
            sheetMaxHeight={500}
            showDueTime={false}
            t={(key) => key}
            tc={tc}
            value=""
            visible
          />
        );
      });
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatformOs,
      });
    }

    const modal = tree.root.findByType(Modal);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('none');
    expect(modal.props.hardwareAccelerated).toBe(true);
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(modal.props.accessibilityViewIsModal).toBe(true);
  });

  it('keeps collapsed capture focused on context and hides organizing fields behind More', () => {
    let tree!: ReturnType<typeof create>;
    const t = (key: string) => ({
      'common.close': 'Close',
      'common.more': 'More',
      'common.save': 'Save',
      'nav.addTask': 'Add Task',
      'quickAdd.addAnother': 'Add another',
      'quickAdd.audioRecord': 'Record',
      'quickAdd.inputHint': 'Capture task title',
      'quickAdd.inputLabel': 'Task title',
      'taskEdit.areaLabel': 'Area',
      'taskEdit.contextsLabel': 'Contexts',
      'taskEdit.dueDate': 'Due Date',
      'taskEdit.project': 'Project',
      'taskEdit.priorityLabel': 'Priority',
    })[key] ?? key;

    act(() => {
      tree = create(
        <QuickCaptureSheetBody
          addAnother={false}
          areaLabel="Work"
          contextLabel="@computer"
          dueDate={new Date('2026-06-04T12:00:00.000Z')}
          dueLabel="Tomorrow"
          dueTimeLabel="Change time"
          handleClose={vi.fn()}
          handleSave={vi.fn()}
          insetsBottom={0}
          inputRef={{ current: null }}
          onOpenAreaPicker={vi.fn()}
          onOpenContextPicker={vi.fn()}
          onOpenDueDatePicker={vi.fn()}
          onOpenDueTimePicker={vi.fn()}
          onOpenPriorityPicker={vi.fn()}
          onOpenProjectPicker={vi.fn()}
          onQuickDueDateSelect={vi.fn()}
          onResetArea={vi.fn()}
          onResetContexts={vi.fn()}
          onResetDueDate={vi.fn()}
          onResetDueTime={vi.fn()}
          onResetPriority={vi.fn()}
          onResetProject={vi.fn()}
          onToggleOptions={vi.fn()}
          onToggleAddAnother={vi.fn()}
          onToggleRecording={vi.fn()}
          onValueChange={vi.fn()}
          optionsExpanded={false}
          prioritiesEnabled
          priorityLabel="High"
          projectLabel="Launch"
          recording={false}
          recordingBusy={false}
          recordingReady={false}
          sheetMaxHeight={500}
          showDueTime={false}
          t={t}
          tc={tc}
          value=""
          visible
        />
      );
    });

    expect(tree.root.findAllByProps({ accessibilityLabel: 'Contexts: @computer' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'More' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Due Date: Tomorrow' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Area: Work' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Project: Launch' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Priority: High' })).toHaveLength(0);
    expect(tree.root.findAllByType(Text).some((node) => node.props.children === 'More')).toBe(true);
  });

  it('bounds compact sheet text scaling so tablet controls cannot overlap', () => {
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <QuickCaptureSheetBody
          addAnother={false}
          areaLabel="No Area"
          contextLabel="Very Long Context Label"
          dueDate={null}
          dueLabel="Due Date"
          dueTimeLabel="Change time"
          handleClose={vi.fn()}
          handleSave={vi.fn()}
          insetsBottom={0}
          inputRef={{ current: null }}
          onOpenAreaPicker={vi.fn()}
          onOpenContextPicker={vi.fn()}
          onOpenDueDatePicker={vi.fn()}
          onOpenDueTimePicker={vi.fn()}
          onOpenPriorityPicker={vi.fn()}
          onOpenProjectPicker={vi.fn()}
          onQuickDueDateSelect={vi.fn()}
          onResetArea={vi.fn()}
          onResetContexts={vi.fn()}
          onResetDueDate={vi.fn()}
          onResetDueTime={vi.fn()}
          onResetPriority={vi.fn()}
          onResetProject={vi.fn()}
          onToggleOptions={vi.fn()}
          onToggleAddAnother={vi.fn()}
          onToggleRecording={vi.fn()}
          onValueChange={vi.fn()}
          optionsExpanded={false}
          prioritiesEnabled
          priorityLabel="Priority"
          projectLabel="Very Long Project Label"
          recording={false}
          recordingBusy={false}
          recordingReady={false}
          sheetMaxHeight={500}
          showDueTime={false}
          t={(key) => key}
          tc={tc}
          value=""
          visible
        />
      );
    });

    expect(tree.root.findByType(TextInput).props.maxFontSizeMultiplier).toBe(1.2);
    expect(tree.root.findByType(TextInput).props.textAlignVertical).toBe('center');
    const compactTexts = tree.root
      .findAllByType(Text)
      .filter((node) => typeof node.props.children === 'string');
    expect(compactTexts.length).toBeGreaterThan(0);
    expect(compactTexts.every((node) => node.props.maxFontSizeMultiplier === 1.2)).toBe(true);
  });

  it('submits the quick capture input from the keyboard Done action on iOS', () => {
    const handleSave = vi.fn();
    let tree!: ReturnType<typeof create>;
    const originalPlatformOs = Platform.OS;

    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });

    try {
      act(() => {
        tree = create(
          <QuickCaptureSheetBody
            addAnother={false}
            areaLabel="No Area"
            contextLabel="Contexts"
            dueDate={null}
            dueLabel="Due Date"
            dueTimeLabel="Change time"
            handleClose={vi.fn()}
            handleSave={handleSave}
            insetsBottom={0}
            inputRef={{ current: null }}
            onOpenAreaPicker={vi.fn()}
            onOpenContextPicker={vi.fn()}
            onOpenDueDatePicker={vi.fn()}
            onOpenDueTimePicker={vi.fn()}
            onOpenPriorityPicker={vi.fn()}
            onOpenProjectPicker={vi.fn()}
            onQuickDueDateSelect={vi.fn()}
            onResetArea={vi.fn()}
            onResetContexts={vi.fn()}
            onResetDueDate={vi.fn()}
            onResetDueTime={vi.fn()}
            onResetPriority={vi.fn()}
            onResetProject={vi.fn()}
            onToggleOptions={vi.fn()}
            onToggleAddAnother={vi.fn()}
            onToggleRecording={vi.fn()}
            onValueChange={vi.fn()}
            optionsExpanded={false}
            prioritiesEnabled
            priorityLabel="Priority"
            projectLabel="Project"
            recording={false}
            recordingBusy={false}
            recordingReady={false}
            sheetMaxHeight={500}
            showDueTime={false}
            t={(key) => key}
            tc={tc}
            value="Capture me"
            visible
          />
        );
      });

      act(() => {
        tree.root.findByType(TextInput).props.onSubmitEditing();
      });
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatformOs,
      });
    }

    expect(handleSave).toHaveBeenCalledOnce();
  });
});
