import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@mindwtr/core';

import { TaskListView, type TaskListViewProps } from './task-list-view';

vi.mock('react-native', () => ({
  FlatList: ({ data, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, renderItem }: any) => React.createElement(
    'FlatList',
    null,
    typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent,
    data?.length
      ? data.map((item: unknown, index: number) => renderItem?.({ item, index }))
      : (typeof ListEmptyComponent === 'function' ? React.createElement(ListEmptyComponent) : ListEmptyComponent),
    typeof ListFooterComponent === 'function' ? React.createElement(ListFooterComponent) : ListFooterComponent,
  ),
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  View: ({ children, ...props }: any) => React.createElement('View', props, children),
}));

vi.mock('./swipeable-task-item', () => ({
  SwipeableTaskItem: (props: any) => React.createElement('SwipeableTaskItem', props),
}));

vi.mock('./task-list/TaskListBulkBar', () => ({
  TaskListBulkBar: (props: any) => React.createElement('TaskListBulkBar', props),
}));

vi.mock('./task-list/TaskListTagModal', () => ({
  TaskListTagModal: (props: any) => React.createElement('TaskListTagModal', props),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
  openContextsScreen: vi.fn(),
  openProjectScreen: vi.fn(),
}));

const themeColors = {
  bg: '#ffffff',
  border: '#d1d5db',
  cardBg: '#ffffff',
  danger: '#dc2626',
  filterBg: '#f8fafc',
  icon: '#64748b',
  inputBg: '#ffffff',
  onTint: '#ffffff',
  secondaryText: '#64748b',
  success: '#16a34a',
  tabIconDefault: '#64748b',
  tabIconSelected: '#2563eb',
  taskItemBg: '#ffffff',
  text: '#0f172a',
  tint: '#2563eb',
  warning: '#f59e0b',
} as unknown as TaskListViewProps['themeColors'];

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  status: 'waiting',
  tags: [],
  contexts: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...overrides,
} as Task);

const makeSelection = (overrides: Record<string, unknown> = {}) => ({
  bulkActionLabel: 'Move',
  bulkActionLoading: false,
  exitSelectionMode: vi.fn(),
  handleBatchAddTag: vi.fn(),
  handleBatchDelete: vi.fn(),
  handleBatchMove: vi.fn(),
  hasSelection: false,
  multiSelectedIds: new Set<string>(),
  rangeSelectMode: false,
  selectedIdsArray: [] as string[],
  selectionMode: false,
  setTagInput: vi.fn(),
  setTagModalVisible: vi.fn(),
  tagInput: '',
  tagModalVisible: false,
  toggleRangeSelectMode: vi.fn(),
  toggleMultiSelect: vi.fn(),
  ...overrides,
}) as unknown as TaskListViewProps['selection'];

const renderView = (props: Partial<TaskListViewProps> = {}) => {
  const merged: TaskListViewProps = {
    tasks: [makeTask('a'), makeTask('b')],
    isDark: false,
    themeColors,
    t: (key: string) => key,
    onPressTask: vi.fn(),
    onChangeTaskStatus: vi.fn(),
    onDeleteTask: vi.fn(),
    highlightTaskId: null,
    selection: makeSelection(),
    bulkStatusOptions: ['next', 'someday'],
    ...props,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(TaskListView, merged));
  });
  return renderer;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('TaskListView', () => {
  it('renders one row per task', () => {
    const renderer = renderView({ tasks: [makeTask('a'), makeTask('b'), makeTask('c')] });
    expect(renderer.root.findAllByType('SwipeableTaskItem' as never)).toHaveLength(3);
  });

  it('wires selection state and the visible-id list into each row', () => {
    const selection = makeSelection({
      selectionMode: true,
      multiSelectedIds: new Set(['a']),
    });
    const renderer = renderView({ tasks: [makeTask('a'), makeTask('b')], selection });
    const rows = renderer.root.findAllByType('SwipeableTaskItem' as never);

    expect(rows[0].props.selectionMode).toBe(true);
    expect(rows[0].props.isMultiSelected).toBe(true);
    expect(rows[1].props.isMultiSelected).toBe(false);

    act(() => {
      rows[1].props.onToggleSelect();
    });
    expect((selection as any).toggleMultiSelect).toHaveBeenCalledWith('b', { visibleTaskIds: ['a', 'b'] });
  });

  it('shows the bulk bar only in selection mode', () => {
    const hidden = renderView({ selection: makeSelection({ selectionMode: false }) });
    expect(hidden.root.findAllByType('TaskListBulkBar' as never)).toHaveLength(0);

    const shown = renderView({ selection: makeSelection({ selectionMode: true }) });
    const bulkBars = shown.root.findAllByType('TaskListBulkBar' as never);
    expect(bulkBars).toHaveLength(1);
    expect(bulkBars[0].props.statusOptions).toEqual(['next', 'someday']);
  });

  it('renders the empty-state slot when there are no tasks', () => {
    const renderer = renderView({
      tasks: [],
      ListEmptyComponent: React.createElement('Text', null, 'Nothing here'),
    });
    expect(renderer.root.findAllByType('SwipeableTaskItem' as never)).toHaveLength(0);
    const texts = renderer.root.findAllByType('Text' as never);
    expect(texts.some((node) => node.props.children === 'Nothing here')).toBe(true);
  });

  it('renders the header and footer slots', () => {
    const renderer = renderView({
      ListHeaderComponent: React.createElement('View', { testID: 'header-slot' }),
      ListFooterComponent: React.createElement('View', { testID: 'footer-slot' }),
    });
    const views = renderer.root.findAllByType('View' as never);
    expect(views.some((node) => node.props.testID === 'header-slot')).toBe(true);
    expect(views.some((node) => node.props.testID === 'footer-slot')).toBe(true);
  });
});
