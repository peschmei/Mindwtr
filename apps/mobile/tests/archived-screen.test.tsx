import React from 'react';
import renderer from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ArchivedScreen from '../app/(drawer)/archived';

const mocks = vi.hoisted(() => {
  const alert = vi.fn();
  const batchDeleteTasks = vi.fn();
  const batchMoveTasks = vi.fn();
  const deleteTask = vi.fn();
  const updateTask = vi.fn();
  const purgeTask = vi.fn();
  const setHighlightTask = vi.fn();
  return {
    alert,
    batchDeleteTasks,
    batchMoveTasks,
    deleteTask,
    updateTask,
    purgeTask,
    setHighlightTask,
    storeState: {
      _allTasks: [] as any[],
      projects: [] as any[],
      batchDeleteTasks,
      batchMoveTasks,
      deleteTask,
      updateTask,
      purgeTask,
      highlightTaskId: null as string | null,
      setHighlightTask,
    },
  };
});

vi.mock('react-native', async () => {
  const actual = await vi.importActual<any>('react-native');
  return {
    ...actual,
    Alert: {
      ...actual.Alert,
      alert: mocks.alert,
    },
    Pressable: ({ children, ...props }: any) => React.createElement(
      'Pressable',
      props,
      typeof children === 'function' ? children({ pressed: false }) : children,
    ),
    FlatList: ({ data = [], renderItem, keyExtractor, ListEmptyComponent, ...props }: any) => {
      const children = data.length > 0
        ? data.map((item: any, index: number) => (
          <React.Fragment key={keyExtractor?.(item, index) ?? item.id ?? index}>
            {renderItem?.({ item, index })}
          </React.Fragment>
        ))
        : typeof ListEmptyComponent === 'function'
          ? <ListEmptyComponent />
          : ListEmptyComponent;

      return React.createElement('FlatList', props, children);
    },
  };
});

vi.mock('@mindwtr/core', () => ({
  shallow: Object.is,
  useTaskStore: () => mocks.storeState,
  getInlineMarkdownPreview: vi.fn((markdown: string) => (markdown || '').split('\n')[0] ?? ''),
  safeFormatDate: vi.fn(() => 'May 12, 2026, 8:30 AM'),
  taskMatchesAreaFilter: vi.fn(() => true),
  tFallback: (t: (key: string) => string, key: string, fallback: string) => t(key) || fallback,
}));

vi.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/markdown-text', () => ({
  MarkdownInlineText: ({ markdown, ...props }: any) => React.createElement('MarkdownInlineText', props, markdown),
}));

vi.mock('../contexts/language-context', () => ({
  useLanguage: () => ({
    t: (key: string) => ({
      'archived.empty': 'No archived tasks',
      'archived.emptyHint': 'Archived tasks appear here',
      'bulk.confirmDeleteBody': 'Delete selected tasks?',
      'bulk.confirmDeleteTitle': 'Delete tasks',
      'bulk.select': 'Select',
      'bulk.selected': 'selected',
      'common.all': 'all',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.done': 'Done',
      'common.tasks': 'tasks',
      'list.done': 'Completed',
      'task.deleteConfirmBody': 'Move this task to Trash?',
      'trash.restoreToInbox': 'Restore to Inbox',
    }[key] ?? key),
  }),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
  useThemeColors: () => ({
    bg: '#000000',
    taskItemBg: '#111111',
    text: '#ffffff',
    secondaryText: '#999999',
    tint: '#3b82f6',
  }),
}));

vi.mock('@/hooks/use-mobile-area-filter', () => ({
  useMobileAreaFilter: () => ({
    areaById: new Map(),
    resolvedAreaFilter: '__all__',
  }),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openContextsScreen: vi.fn(),
  openProjectScreen: vi.fn(),
}));

vi.mock('@/components/task-edit-modal', () => ({
  TaskEditModal: (props: any) => React.createElement('TaskEditModal', props),
}));

vi.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: ({ children, ...props }: any) => (
    React.createElement('GestureHandlerRootView', props, children)
  ),
  Swipeable: ({ children, renderLeftActions, renderRightActions }: any) => (
    React.createElement(
      'Swipeable',
      { renderLeftActions, renderRightActions },
      renderLeftActions?.(),
      renderRightActions?.(),
      children,
    )
  ),
}));

vi.mock('lucide-react-native', () => ({
  Archive: (props: any) => React.createElement('Archive', props),
}));

describe('ArchivedScreen', () => {
  const taskEditModalType = 'TaskEditModal' as unknown as React.ElementType;
  const flattenText = (value: unknown): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map((item) => flattenText(item)).join('');
    return '';
  };
  const hasText = (tree: renderer.ReactTestRenderer, text: string) =>
    tree.root.findAll((node) => flattenText(node.props?.children).includes(text)).length > 0;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storeState.projects = [];
    mocks.storeState.highlightTaskId = null;
    mocks.storeState._allTasks = [
      {
        id: 'task-1',
        title: 'Archived task',
        description: 'Full archived details',
        status: 'archived',
        completedAt: '2026-05-12T08:30:00.000Z',
        createdAt: '2026-05-10T08:30:00.000Z',
        updatedAt: '2026-05-12T08:30:00.000Z',
      },
    ];
  });

  it('opens archived task details from the row and saves through the task editor', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    let modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(false);
    expect(modal.props.defaultTab).toBe('view');
    expect(hasText(tree, 'Completed: May 12, 2026, 8:30 AM')).toBe(true);

    const row = tree.root.find(
      (node) => node.props.accessibilityLabel === 'Open archived task details: Archived task',
    );

    renderer.act(() => {
      row.props.onPress();
    });

    modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.task).toMatchObject({
      id: 'task-1',
      title: 'Archived task',
      description: 'Full archived details',
    });

    renderer.act(() => {
      modal.props.onSave('task-1', { description: 'Updated archived details' });
    });

    expect(mocks.updateTask).toHaveBeenCalledWith('task-1', { description: 'Updated archived details' });
    modal = tree.root.findByType(taskEditModalType);
    expect(modal.props.visible).toBe(false);
  });

  it('moves an archived task to Trash instead of purging it', () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    const swipeable = tree.root.findByType('Swipeable' as unknown as React.ElementType);
    const deleteAction = swipeable.props.renderRightActions();

    renderer.act(() => {
      deleteAction.props.onPress();
    });

    const alertButtons = mocks.alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[];
    const confirmButton = alertButtons.find((button) => button.style === 'destructive');
    renderer.act(() => {
      confirmButton?.onPress?.();
    });

    expect(mocks.deleteTask).toHaveBeenCalledWith('task-1');
    expect(mocks.purgeTask).not.toHaveBeenCalled();
  });

  it('bulk restores selected archived tasks to Inbox', async () => {
    mocks.storeState._allTasks = [
      ...mocks.storeState._allTasks,
      {
        ...mocks.storeState._allTasks[0],
        id: 'task-2',
        title: 'Second archived task',
      },
    ];
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select all').props.onPress();
    });
    await renderer.act(async () => {
      await tree.root.find((node) => node.props.accessibilityLabel === 'Restore to Inbox').props.onPress();
    });

    expect(mocks.batchMoveTasks).toHaveBeenCalledWith(['task-1', 'task-2'], 'inbox');
    expect(mocks.updateTask).not.toHaveBeenCalledWith('task-1', { status: 'inbox' });
  });

  it('bulk moves selected archived tasks to Trash', async () => {
    let tree!: renderer.ReactTestRenderer;
    renderer.act(() => {
      tree = renderer.create(<ArchivedScreen />);
    });

    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Select Archived task').props.onPress();
    });
    renderer.act(() => {
      tree.root.find((node) => node.props.accessibilityLabel === 'Delete').props.onPress();
    });

    const alertButtons = mocks.alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => Promise<void> | void }[];
    const confirmButton = alertButtons.find((button) => button.style === 'destructive');
    await renderer.act(async () => {
      await confirmButton?.onPress?.();
    });

    expect(mocks.batchDeleteTasks).toHaveBeenCalledWith(['task-1']);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });
});
