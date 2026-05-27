import React from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TaskEditFormTab } from './TaskEditFormTab';

vi.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: any) => React.createElement('DateTimePicker', props, props.children),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    border: '#333',
    secondaryText: '#aaa',
    text: '#fff',
    tint: '#3b82f6',
  }),
}));

const originalPlatformOs = Platform.OS;

const setPlatform = (os: typeof Platform.OS) => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
};

const baseProps = {
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
  styles: {
    tabPage: {},
    content: {},
    contentContainer: { paddingBottom: 32, flexGrow: 1 },
    formGroup: {},
    label: {},
    input: {},
    aiRow: {},
    aiButton: {},
    aiButtonText: {},
    aiWorking: {},
    aiWorkingText: {},
    copilotPill: {},
    copilotText: {},
    copilotHint: {},
    emptySectionHint: {},
    emptySectionHintText: {},
  },
  inputStyle: {},
  editedTask: {},
  setEditedTask: vi.fn(),
  aiEnabled: false,
  isAIWorking: false,
  handleAIClarify: vi.fn(),
  handleAIBreakdown: vi.fn(),
  copilotSuggestion: null,
  copilotApplied: false,
  applyCopilotSuggestion: vi.fn(),
  copilotContext: undefined,
  copilotEstimate: undefined,
  copilotTags: [],
  timeEstimatesEnabled: true,
  renderField: vi.fn(),
  basicFields: [],
  schedulingFields: [],
  organizationFields: [],
  detailsFields: [],
  sectionOpenDefaults: {
    basic: true,
    scheduling: false,
    organization: false,
    details: false,
  },
  showDatePicker: null,
  pendingStartDate: null,
  pendingDueDate: null,
  getSafePickerDateValue: vi.fn(() => new Date('2025-01-01T00:00:00.000Z')),
  onDateChange: vi.fn(),
  containerWidth: 390,
  textDirectionStyle: {},
  titleDraft: 'Task',
  onTitleDraftChange: vi.fn(),
};

describe('TaskEditFormTab keyboard handling', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOs,
    });
    vi.restoreAllMocks();
  });

  it('adds an iOS keyboard bottom inset so focused lower inputs can scroll above the keyboard', () => {
    setPlatform('ios');
    vi.spyOn(Dimensions, 'get').mockReturnValue({
      width: 390,
      height: 800,
      scale: 3,
      fontScale: 1,
    });
    const listeners = new Map<string, (event?: unknown) => void>();
    vi.spyOn(Keyboard, 'addListener').mockImplementation(((eventName: string, listener: (event?: unknown) => void) => {
      listeners.set(eventName, listener);
      return { remove: () => listeners.delete(eventName) };
    }) as any);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TaskEditFormTab {...baseProps} />);
    });

    expect(tree.root.findByType(KeyboardAvoidingView).props.behavior).toBeUndefined();
    expect(tree.root.findByType(ScrollView).props.keyboardDismissMode).toBe('interactive');
    expect(listeners.has('keyboardWillShow')).toBe(true);
    expect(listeners.has('keyboardWillChangeFrame')).toBe(true);
    expect(listeners.has('keyboardWillHide')).toBe(true);

    act(() => {
      listeners.get('keyboardWillShow')?.({ endCoordinates: { screenY: 500 } });
    });

    expect(tree.root.findByType(ScrollView).props.contentContainerStyle).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 332 })])
    );

    act(() => {
      listeners.get('keyboardWillHide')?.();
    });

    expect(tree.root.findByType(ScrollView).props.contentContainerStyle).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 332 })])
    );
  });

  it('keeps Android height-based keyboard avoidance', () => {
    setPlatform('android');
    const listeners = new Map<string, (event?: unknown) => void>();
    vi.spyOn(Keyboard, 'addListener').mockImplementation(((eventName: string, listener: (event?: unknown) => void) => {
      listeners.set(eventName, listener);
      return { remove: () => listeners.delete(eventName) };
    }) as any);

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<TaskEditFormTab {...baseProps} />);
    });

    expect(tree.root.findByType(KeyboardAvoidingView).props.behavior).toBe('height');
    expect(tree.root.findByType(ScrollView).props.keyboardDismissMode).toBe('on-drag');
    expect(listeners.has('keyboardDidShow')).toBe(true);
    expect(listeners.has('keyboardDidChangeFrame')).toBe(true);
    expect(listeners.has('keyboardDidHide')).toBe(true);
  });

  it('tracks title focus without forcing fallback scrolling when no native handle is reported', () => {
    const onTitleInputFocusChange = vi.fn();
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditFormTab
          {...baseProps}
          onTitleInputFocusChange={onTitleInputFocusChange}
        />
      );
    });

    const titleInput = tree.root.findAllByType(TextInput)[0];

    act(() => {
      titleInput.props.onFocus({ nativeEvent: {} });
    });

    expect(onTitleInputFocusChange).toHaveBeenCalledWith(true);

    act(() => {
      titleInput.props.onBlur();
    });

    expect(onTitleInputFocusChange).toHaveBeenCalledWith(false);
  });

  it('does not schedule measured scrolling when the title input reports a native handle', () => {
    const onTitleInputFocusChange = vi.fn();
    const requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditFormTab
          {...baseProps}
          onTitleInputFocusChange={onTitleInputFocusChange}
        />
      );
    });

    requestAnimationFrameSpy.mockClear();

    const titleInput = tree.root.findAllByType(TextInput)[0];

    act(() => {
      titleInput.props.onFocus({ nativeEvent: { target: 42 } });
    });

    expect(onTitleInputFocusChange).toHaveBeenCalledWith(true);
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
  });

  it('renders a configured mobile location field in the details section', () => {
    const renderField = vi.fn((fieldId) => (
      <TextInput accessibilityLabel={fieldId} value={`field:${fieldId}`} />
    ));
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskEditFormTab
          {...baseProps}
          detailsFields={['location']}
          renderField={renderField}
          sectionOpenDefaults={{ ...baseProps.sectionOpenDefaults, details: true }}
        />
      );
    });

    const inputs = tree.root.findAllByType(TextInput);
    const locationInput = inputs.find((input) => input.props.accessibilityLabel === 'location');

    expect(locationInput?.props.value).toBe('field:location');
    expect(renderField).toHaveBeenCalledWith('location');
  });
});
