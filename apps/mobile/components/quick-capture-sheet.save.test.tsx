import React from 'react';
import { Keyboard, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickCaptureSheet } from './quick-capture-sheet';

const {
  addTask,
  addProject,
  updateSettings,
  showToast,
  openTaskScreen,
  getUsedTaskTokens,
  parseQuickAdd,
  selectStore,
} = vi.hoisted(() => {
  const addTask = vi.fn();
  const addProject = vi.fn();
  const updateSettings = vi.fn();
  const showToast = vi.fn();
  const openTaskScreen = vi.fn();
  const getUsedTaskTokens = vi.fn<() => string[]>(() => []);
  const parseQuickAdd = vi.fn<(input: string) => any>((input: string) => ({
    title: input,
    props: {},
    invalidDateCommands: [],
  }));
  const storeState = {
    addTask,
    addProject,
    updateSettings,
    areas: [],
    projects: [],
    settings: {},
    tasks: [],
  };
  const selectStore = ((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as any;
  selectStore.getState = () => storeState;
  return {
    addTask,
    addProject,
    updateSettings,
    showToast,
    openTaskScreen,
    getUsedTaskTokens,
    parseQuickAdd,
    selectStore,
  };
});

vi.mock('@mindwtr/core', () => ({
  DEFAULT_PROJECT_COLOR: '#3B82F6',
  getQuickAddProjectInitialProps: (props: any, fallbackAreaId?: string | null) => {
    const areaId = props?.areaId || fallbackAreaId || undefined;
    return areaId ? { areaId } : undefined;
  },
  getUsedTaskTokens,
  hasTimeComponent: (value?: string | null) => Boolean(value && /[T\s]\d{2}:\d{2}/.test(value)),
  isSelectableProjectForTaskAssignment: (project: any) => (
    !project.deletedAt && project.status !== 'archived' && project.status !== 'completed'
  ),
  parseQuickAdd,
  safeFormatDate: (value: Date | string, formatStr: string) => {
    const date = value instanceof Date ? value : new Date(value);
    if (formatStr === 'p') {
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    if (formatStr !== 'yyyy-MM-dd') return '';
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  },
  safeParseDate: () => null,
  shallow: (left: unknown, right: unknown) => left === right,
  tFallback: (t: (key: string) => string, key: string, fallback: string) => {
    const value = t(key);
    return value && value !== key ? value : fallback;
  },
  useTaskStore: selectStore,
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    useWindowDimensions: () => ({
      fontScale: 1,
      height: 800,
      scale: 1,
      width: 400,
    }),
  };
});

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => ({
      'common.notice': 'Notice',
      'quickAdd.invalidDateCommand': 'Invalid date',
      'taskEdit.contextsLabel': 'Contexts',
      'taskEdit.dueDateLabel': 'Due Date',
      'taskEdit.noAreaOption': 'No Area',
      'taskEdit.priorityLabel': 'Priority',
      'taskEdit.projectLabel': 'Project',
    }[key] ?? key),
  }),
}));

vi.mock('@/contexts/toast-context', () => ({
  useToast: () => ({ showToast }),
}));

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => ({ selectedAreaIdForNewTasks: null }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#0f172a',
    border: '#334155',
    cardBg: '#111827',
    filterBg: '#1f2937',
    inputBg: '#0f172a',
    onTint: '#ffffff',
    secondaryText: '#94a3b8',
    text: '#f8fafc',
    tint: '#3b82f6',
  }),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openTaskScreen,
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('./use-quick-capture-audio', () => ({
  useQuickCaptureAudio: () => ({
    recording: false,
    recordingBusy: false,
    recordingReady: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock('./quick-capture-sheet/QuickCaptureSheetBody', () => ({
  QuickCaptureSheetBody: (props: Record<string, unknown>) => React.createElement('QuickCaptureSheetBody', props),
}));

vi.mock('./quick-capture-sheet/QuickCaptureSheetPickers', () => ({
  QuickCaptureSheetPickers: (props: Record<string, unknown>) => React.createElement('QuickCaptureSheetPickers', props),
}));

const withPlatform = async (os: typeof Platform.OS, run: () => Promise<void>) => {
  const originalPlatformOs = Platform.OS;
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: os,
  });
  try {
    await run();
  } finally {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOs,
    });
  }
};

describe('QuickCaptureSheet save handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    addTask.mockReset();
    addProject.mockReset();
    updateSettings.mockReset();
    showToast.mockReset();
    selectStore.getState().areas = [];
    selectStore.getState().projects = [];
    selectStore.getState().tasks = [];
    getUsedTaskTokens.mockClear();
    getUsedTaskTokens.mockReturnValue([]);
    parseQuickAdd.mockReset();
    parseQuickAdd.mockImplementation((input: string) => ({
      title: input,
      props: {},
      invalidDateCommands: [],
    }));
  });

  it('opens organize options collapsed for global capture', async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue=""
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');
    expect(body.props.optionsExpanded).toBe(false);
    expect(getUsedTaskTokens).not.toHaveBeenCalled();
  });

  it('waits for the Android keyboard dismissal before expanding organize options', async () => {
    vi.useFakeTimers();
    const keyboardDismiss = vi.spyOn(Keyboard, 'dismiss').mockImplementation(vi.fn());

    await withPlatform('android', async () => {
      let tree!: ReturnType<typeof create>;
      await act(async () => {
        tree = create(
          <QuickCaptureSheet
            visible
            openRequestId={1}
            initialValue=""
            onClose={vi.fn()}
          />
        );
        await Promise.resolve();
      });

      const getBody = () => {
        const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
        if (!body) throw new Error('QuickCaptureSheetBody not found');
        return body;
      };

      expect(getBody().props.optionsExpanded).toBe(false);
      expect(getBody().props.keyboardAvoidingEnabled).toBe(true);

      const focus = vi.fn();
      const blur = vi.fn();
      getBody().props.inputRef.current = { blur, focus };

      await act(async () => {
        getBody().props.onToggleOptions();
        await Promise.resolve();
      });

      expect(keyboardDismiss).toHaveBeenCalledOnce();
      expect(blur).toHaveBeenCalledOnce();
      expect(getBody().props.optionsExpanded).toBe(false);
      expect(getBody().props.keyboardAvoidingEnabled).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(160);
        await Promise.resolve();
      });

      expect(focus).not.toHaveBeenCalled();
      expect(getBody().props.optionsExpanded).toBe(true);
      expect(getBody().props.keyboardAvoidingEnabled).toBe(false);

      await act(async () => {
        getBody().props.onToggleOptions();
        await Promise.resolve();
      });

      expect(getBody().props.optionsExpanded).toBe(false);
      expect(getBody().props.keyboardAvoidingEnabled).toBe(true);
    });
  });

  it('loads context autocomplete only after the context picker opens', async () => {
    vi.useFakeTimers();
    getUsedTaskTokens.mockReturnValue(['@computer']);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue=""
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(getUsedTaskTokens).not.toHaveBeenCalled();

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');
    await act(async () => {
      body.props.onOpenContextPicker();
      await Promise.resolve();
    });

    expect(getUsedTaskTokens).not.toHaveBeenCalled();

    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });

    expect(getUsedTaskTokens).toHaveBeenCalledTimes(1);
    const pickers = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetPickers')[0];
    if (!pickers) throw new Error('QuickCaptureSheetPickers not found');
    expect(pickers.props.filteredContexts).toEqual(['@computer']);
    expect(pickers.props.contextOptionsLoading).toBe(false);
  });

  it('ignores duplicate save presses while the first save is in flight', async () => {
    let resolveAddTask: ((value: unknown) => void) | null = null;
    addTask.mockImplementation(() => new Promise((resolve) => {
      resolveAddTask = resolve;
    }));

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="Double tap task"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');
    await act(async () => {
      body.props.handleSave();
      body.props.handleSave();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith('Double tap task', expect.objectContaining({ status: 'inbox' }));

    await act(async () => {
      resolveAddTask?.({ success: true, id: 'task-1' });
      await Promise.resolve();
    });
  });

  it('opens the created task when save and edit is requested', async () => {
    addTask.mockResolvedValueOnce({ success: true, id: 'task-new' });
    const onClose = vi.fn();
    selectStore.getState().projects = [{
      id: 'project-1',
      title: 'Launch',
      status: 'active',
    }];

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="Draft launch brief"
          initialProps={{ projectId: 'project-1', status: 'next' }}
          onClose={onClose}
        />
      );
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');
    await act(async () => {
      body.props.handleSaveAndEdit();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenCalledWith('Draft launch brief', expect.objectContaining({
      projectId: 'project-1',
      status: 'next',
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openTaskScreen).toHaveBeenCalledWith('task-new', 'project-1', 'task');
  });

  it('saves picker due dates as date-only values', async () => {
    addTask.mockResolvedValue({ success: true, id: 'task-1' });

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="Plan the day"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const pickers = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetPickers')[0];
    if (!pickers) throw new Error('QuickCaptureSheetPickers not found');

    await act(async () => {
      pickers.props.onDueDateChange({ type: 'set' }, new Date(2026, 4, 10, 14, 37, 0, 0));
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');

    await act(async () => {
      body.props.handleSave();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith('Plan the day', expect.objectContaining({
      dueDate: '2026-05-10',
      status: 'inbox',
    }));
  });

  it('saves picker due times only after the user explicitly selects one', async () => {
    addTask.mockResolvedValue({ success: true, id: 'task-1' });

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="Call the office"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const pickers = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetPickers')[0];
    if (!pickers) throw new Error('QuickCaptureSheetPickers not found');

    await act(async () => {
      pickers.props.onDueDateChange({ type: 'set' }, new Date(2026, 4, 10, 14, 37, 0, 0));
      await Promise.resolve();
    });

    const refreshedPickers = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetPickers')[0];
    if (!refreshedPickers) throw new Error('QuickCaptureSheetPickers not found');
    await act(async () => {
      refreshedPickers.props.onDueTimeChange({ type: 'set' }, new Date(2026, 4, 10, 16, 15, 0, 0));
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');

    await act(async () => {
      body.props.handleSave();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenCalledTimes(1);
    expect(addTask).toHaveBeenCalledWith('Call the office', expect.objectContaining({
      dueDate: new Date(2026, 4, 10, 16, 15, 0, 0).toISOString(),
      status: 'inbox',
    }));
  });

  it('creates parsed quick-add projects inside the parsed area', async () => {
    addProject.mockResolvedValue({ id: 'project-launch' });
    addTask.mockResolvedValue({ success: true, id: 'task-1' });
    parseQuickAdd.mockReturnValue({
      title: 'Plan campaign',
      props: { areaId: 'area-work' },
      projectTitle: 'Launch',
      invalidDateCommands: [],
    });

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="Plan campaign +Launch !Work"
          onClose={vi.fn()}
        />
      );
      await Promise.resolve();
    });

    const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
    if (!body) throw new Error('QuickCaptureSheetBody not found');

    await act(async () => {
      body.props.handleSave();
      await Promise.resolve();
    });

    expect(addProject).toHaveBeenCalledWith('Launch', '#3B82F6', { areaId: 'area-work' });
    expect(addTask).toHaveBeenCalledWith('Plan campaign', expect.objectContaining({
      projectId: 'project-launch',
      areaId: undefined,
    }));
  });

  it('keeps project initial props when saving and adding another', async () => {
    selectStore.getState().projects = [{
      id: 'project-1',
      title: 'Launch',
      status: 'active',
    }];
    addTask.mockResolvedValue({ success: true, id: 'task-1' });
    const onClose = vi.fn();

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <QuickCaptureSheet
          visible
          openRequestId={1}
          initialValue="First task"
          initialProps={{ projectId: 'project-1', status: 'next' }}
          onClose={onClose}
        />
      );
      await Promise.resolve();
    });

    const getBody = () => {
      const body = tree.root.findAll((node) => String(node.type) === 'QuickCaptureSheetBody')[0];
      if (!body) throw new Error('QuickCaptureSheetBody not found');
      return body;
    };

    await act(async () => {
      getBody().props.onToggleAddAnother(true);
      await Promise.resolve();
    });

    await act(async () => {
      getBody().props.handleSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenCalledWith('First task', expect.objectContaining({
      projectId: 'project-1',
      status: 'next',
    }));
    expect(getBody().props.value).toBe('');
    expect(getBody().props.projectLabel).toBe('Launch');
    expect(getBody().props.projectSelected).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      getBody().props.onValueChange('Second task');
      await Promise.resolve();
    });
    await act(async () => {
      getBody().props.handleSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(addTask).toHaveBeenLastCalledWith('Second task', expect.objectContaining({
      projectId: 'project-1',
      status: 'next',
    }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
