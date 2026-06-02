import React from 'react';
import { Platform, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TaskEditContentField } from './TaskEditContentField';
import { DESCRIPTION_END_KEYBOARD_SCROLL_TARGET } from './task-edit-keyboard';

vi.mock('../markdown-reference-autocomplete', () => ({
  MarkdownReferenceAutocomplete: (props: any) => React.createElement('MarkdownReferenceAutocomplete', props),
}));

vi.mock('../markdown-text', () => ({
  MarkdownText: (props: any) => React.createElement('MarkdownText', props),
}));

vi.mock('lucide-react-native', () => ({
  GripVertical: (props: any) => React.createElement('GripVertical', props),
}));

vi.mock('react-native-draggable-flatlist', () => ({
  NestableDraggableFlatList: (props: any) => React.createElement(
    'NestableDraggableFlatList',
    props,
    props.data?.map((item: any, index: number) => React.createElement(
      React.Fragment,
      { key: props.keyExtractor?.(item, index) ?? index },
      props.renderItem?.({
        item,
        index,
        drag: () => undefined,
        isActive: false,
        getIndex: () => index,
      })
    ))
  ),
  ScaleDecorator: (props: any) => React.createElement('ScaleDecorator', props, props.children),
}));

const withPlatform = (os: typeof Platform.OS, run: () => void) => {
  const originalPlatformOs = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
  try {
    run();
  } finally {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOs,
    });
  }
};

const baseProps: any = {
  addFileAttachment: vi.fn(),
  addImageAttachment: vi.fn(),
  applyAssignedToSuggestion: vi.fn(),
  applyContextSuggestion: vi.fn(),
  applyTagSuggestion: vi.fn(),
  areas: [],
  assignedToSuggestions: [],
  availableStatusOptions: ['inbox', 'next', 'waiting', 'scheduled', 'someday', 'completed'],
  applyQuickDate: vi.fn(),
  commitContextDraft: vi.fn(),
  commitTagDraft: vi.fn(),
  contextInputDraft: '',
  contextTokenSuggestions: [],
  customWeekdays: [],
  dailyInterval: 1,
  descriptionDraft: '# Heading\n\nLong description',
  descriptionInputRef: React.createRef<TextInput>(),
  descriptionSelection: { start: 0, end: 0 },
  descriptionSelectionRestorePending: false,
  setDescriptionSelection: vi.fn(),
  descriptionToolbarInteractionUntilRef: { current: 0 },
  isDescriptionInputFocused: false,
  setIsDescriptionInputFocused: vi.fn(),
  handleDescriptionChange: vi.fn(),
  handleDescriptionKeyPress: vi.fn(),
  applyDescriptionResult: vi.fn(),
  openDescriptionExpandedEditor: vi.fn(),
  downloadAttachment: vi.fn(),
  editedTask: { id: 'task-1', title: 'Task' },
  formatDate: vi.fn((value) => value ?? ''),
  formatDueDate: vi.fn((value) => value ?? ''),
  frequentContextSuggestions: [],
  frequentTagSuggestions: [],
  getSafePickerDateValue: vi.fn(() => new Date('2025-01-01T00:00:00.000Z')),
  handleInputFocus: vi.fn(),
  handleResetChecklist: vi.fn(),
  language: 'en',
  monthlyPattern: 'date',
  onDateChange: vi.fn(),
  openAttachment: vi.fn(),
  openCustomRecurrence: vi.fn(),
  pendingDueDate: null,
  pendingStartDate: null,
  prioritiesEnabled: true,
  energyLevelOptions: [],
  priorityOptions: [],
  projects: [],
  projectSections: [],
  recurrenceOptions: [],
  recurrenceRRuleValue: '',
  recurrenceRuleValue: '',
  recurrenceStrategyValue: 'due',
  recurrenceWeekdayButtons: [],
  removeAttachment: vi.fn(),
  selectedContextTokens: new Set<string>(),
  selectedTagTokens: new Set<string>(),
  setCustomWeekdays: vi.fn(),
  setEditedTask: vi.fn(),
  setIsContextInputFocused: vi.fn(),
  setIsTagInputFocused: vi.fn(),
  setLinkInputTouched: vi.fn(),
  setLinkModalVisible: vi.fn(),
  setShowAreaPicker: vi.fn(),
  setShowDatePicker: vi.fn(),
  setShowDescriptionPreview: vi.fn(),
  setShowProjectPicker: vi.fn(),
  setShowSectionPicker: vi.fn(),
  showDatePicker: null,
  showDescriptionPreview: false,
  styles: {
    formGroup: {},
    inlineHeader: {},
    label: {},
    inlineActions: {},
    inlineAction: {},
    input: {},
    textArea: {},
    markdownPreview: {},
    checklistContainer: {},
    checklistDragList: {},
    checklistItem: {},
    checklistItemDragging: {},
    checklistDragHandle: {},
    checklistDragHandleDisabled: {},
    checkboxTouch: {},
    checkbox: {},
    checkboxChecked: {},
    checkmark: {},
    checklistInput: {},
    completedText: {},
    deleteBtn: {},
    deleteBtnText: {},
    addChecklistBtn: {},
    addChecklistText: {},
    checklistActions: {},
    checklistActionButton: {},
    checklistActionText: {},
  },
  tagInputDraft: '',
  tagTokenSuggestions: [],
  task: null,
  t: (key: string) => key,
  tc: {
    bg: '#000',
    cardBg: '#111',
    taskItemBg: '#111',
    inputBg: '#111',
    filterBg: '#222',
    border: '#333',
    text: '#fff',
    secondaryText: '#aaa',
    icon: '#aaa',
    tint: '#3b82f6',
    onTint: '#fff',
    tabIconDefault: '#aaa',
    tabIconSelected: '#3b82f6',
    danger: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
  },
  timeEstimateOptions: [],
  timeEstimatesEnabled: true,
  titleDraft: 'Task',
  toggleQuickContextToken: vi.fn(),
  toggleQuickTagToken: vi.fn(),
  updateContextInput: vi.fn(),
  updateTagInput: vi.fn(),
  visibleAttachments: [],
};

const createChecklistState = (checklist = [{ id: 'check-1', title: 'Item 1', isCompleted: false }]) => {
  let state: any = {
    id: 'task-1',
    title: 'Task',
    checklist,
  };
  const setEditedTask = vi.fn((next: any) => {
    state = typeof next === 'function' ? next(state) : next;
  });
  return {
    getState: () => state,
    setEditedTask,
  };
};

describe('TaskEditContentField', () => {
  it('does not register the long description input as a keyboard auto-scroll target', () => {
    const handleInputFocus = vi.fn();
    const setIsDescriptionInputFocused = vi.fn();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditContentField
          {...baseProps}
          fieldId="description"
          handleInputFocus={handleInputFocus}
          setIsDescriptionInputFocused={setIsDescriptionInputFocused}
        />
      );
    });

    const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.descriptionLabel' });

    act(() => {
      input.props.onFocus({ nativeEvent: { target: 42 } });
    });

    expect(setIsDescriptionInputFocused).toHaveBeenCalledWith(true);
    expect(handleInputFocus).toHaveBeenCalledWith(undefined);
  });

  it('keeps the Android description editor in plain-text spellcheck mode', () => {
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditContentField
          {...baseProps}
          fieldId="description"
        />
      );
    });

    const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.descriptionLabel' });

    expect(input.props.spellCheck).toBe(true);
    expect(input.props.autoCorrect).toBe(true);
    expect(input.props.autoCapitalize).toBe('sentences');
    expect(input.props.autoComplete).toBe('off');
    expect(input.props.importantForAutofill).toBe('no');
    expect(input.props.inputMode).toBe('text');
    expect(input.props.textContentType).toBe('none');
    expect(input.props.keyboardType).toBe('default');
  });

  it('nudges Android keyboard scrolling when the inline description caret reaches the end', () => {
    const descriptionDraft = 'First line\nLast line';
    const handleInputFocus = vi.fn();
    const setDescriptionSelection = vi.fn();
    let tree!: ReturnType<typeof create>;

    withPlatform('android', () => {
      act(() => {
        tree = create(
          <TaskEditContentField
            {...baseProps}
            fieldId="description"
            descriptionDraft={descriptionDraft}
            isDescriptionInputFocused
            handleInputFocus={handleInputFocus}
            setDescriptionSelection={setDescriptionSelection}
          />
        );
      });

      const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.descriptionLabel' });
      const endSelection = { start: descriptionDraft.length, end: descriptionDraft.length };

      act(() => {
        input.props.onSelectionChange({ nativeEvent: { selection: endSelection } });
      });

      expect(setDescriptionSelection).toHaveBeenCalledWith(endSelection);
      expect(handleInputFocus).toHaveBeenCalledWith(DESCRIPTION_END_KEYBOARD_SCROLL_TARGET);
    });
  });

  it('temporarily controls Android description selection during caret restoration', () => {
    let tree!: ReturnType<typeof create>;

    withPlatform('android', () => {
      act(() => {
        tree = create(
          <TaskEditContentField
            {...baseProps}
            fieldId="description"
            descriptionSelection={{ start: 9, end: 9 }}
            descriptionSelectionRestorePending
          />
        );
      });

      const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.descriptionLabel' });

      expect(input.props.selection).toEqual({ start: 9, end: 9 });
    });
  });

  it('wraps selected checklist item text from mobile key presses', () => {
    const { getState, setEditedTask } = createChecklistState();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditContentField
          {...baseProps}
          fieldId="checklist"
          editedTask={getState()}
          setEditedTask={setEditedTask}
        />
      );
    });

    const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.checklist 1' });

    act(() => {
      input.props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 6 } } });
    });

    const preventDefault = vi.fn();
    act(() => {
      input.props.onKeyPress({ nativeEvent: { key: '[' }, preventDefault });
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(getState().checklist[0].title).toBe('[Item 1]');

    const callsAfterKeyPress = setEditedTask.mock.calls.length;
    act(() => {
      input.props.onChangeText('[');
    });

    expect(setEditedTask).toHaveBeenCalledTimes(callsAfterKeyPress);
  });

  it('wraps selected checklist item text from native mobile text changes', () => {
    const { getState, setEditedTask } = createChecklistState();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditContentField
          {...baseProps}
          fieldId="checklist"
          editedTask={getState()}
          setEditedTask={setEditedTask}
        />
      );
    });

    const input = tree.root.findByProps({ accessibilityLabel: 'taskEdit.checklist 1' });

    act(() => {
      input.props.onSelectionChange({ nativeEvent: { selection: { start: 0, end: 6 } } });
      input.props.onChangeText('~');
    });

    expect(getState().checklist[0].title).toBe('~~Item 1~~');
  });

  it('persists checklist order changes from the mobile drag list', () => {
    const checklist = [
      { id: 'check-1', title: 'Item 1', isCompleted: false },
      { id: 'check-2', title: 'Item 2', isCompleted: false },
      { id: 'check-3', title: 'Item 3', isCompleted: true },
    ];
    const { getState, setEditedTask } = createChecklistState(checklist);
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditContentField
          {...baseProps}
          fieldId="checklist"
          editedTask={getState()}
          setEditedTask={setEditedTask}
        />
      );
    });

    const dragList = tree.root.findByProps({ testID: 'mobile-checklist-reorder-list' });

    act(() => {
      dragList.props.onDragEnd({
        from: 0,
        to: 2,
        data: [checklist[1], checklist[2], checklist[0]],
      });
    });

    expect(getState().checklist.map((item: any) => item.id)).toEqual([
      'check-2',
      'check-3',
      'check-1',
    ]);
  });
});
