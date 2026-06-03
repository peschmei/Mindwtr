import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { TaskListBulkBar } from './TaskListBulkBar';

vi.mock('react-native', () => ({
  ActivityIndicator: ({ color, size }: any) => React.createElement('span', { 'data-activity': size, style: { color } }),
  ScrollView: ({ children, contentContainerStyle, horizontal, showsHorizontalScrollIndicator, style, ...props }: any) =>
    React.createElement('div', props, children),
  StyleSheet: { create: (styles: any) => styles },
  Text: ({ accessibilityLabel, accessibilityRole, ...props }: any) =>
    React.createElement('span', { ...props, 'aria-label': accessibilityLabel, role: accessibilityRole }, props.children),
  TouchableOpacity: ({ accessibilityLabel, accessibilityRole, accessibilityState, activeOpacity, disabled, onPress, style, testID, ...props }: any) =>
    React.createElement('button', {
      ...props,
      'aria-label': accessibilityLabel,
      'aria-selected': accessibilityState?.selected,
      'data-testid': testID,
      disabled: disabled || accessibilityState?.disabled,
      role: accessibilityRole,
      onClick: onPress,
    }, props.children),
  View: ({ accessibilityLabel, accessibilityRole, style, ...props }: any) =>
    React.createElement('div', { ...props, 'aria-label': accessibilityLabel, role: accessibilityRole }, props.children),
}));

const themeColors = {
  border: '#d1d5db',
  cardBg: '#ffffff',
  filterBg: '#f3f4f6',
  onTint: '#ffffff',
  secondaryText: '#6b7280',
  text: '#111827',
  tint: '#2563eb',
};

const t = (key: string) => ({
  'bulk.addTag': 'Add tag',
  'bulk.delete': 'Delete selected',
  'bulk.moveTo': 'Move to',
  'bulk.selectRange': 'Range',
  'bulk.selectRangeActive': 'Pick end',
  'bulk.selected': 'selected',
  'common.loading': 'Loading',
  'status.done': 'Done',
  'status.inbox': 'Inbox',
  'status.next': 'Next',
  'status.reference': 'Reference',
  'status.someday': 'Someday',
  'status.waiting': 'Waiting',
}[key] ?? key);

const renderBulkBar = (overrides: Partial<React.ComponentProps<typeof TaskListBulkBar>> = {}) => renderToStaticMarkup(
  <TaskListBulkBar
    bulkActionLabel=""
    bulkActionLoading={false}
    handleBatchDelete={vi.fn()}
    handleBatchMove={vi.fn()}
    hasSelection
    onOpenTagModal={vi.fn()}
    onToggleRangeSelectMode={vi.fn()}
    rangeSelectMode={false}
    selectedCount={2}
    t={t}
    themeColors={themeColors}
    {...overrides}
  />
);

describe('TaskListBulkBar', () => {
  it('shows a compact range toggle when bulk selection is active', () => {
    const html = renderBulkBar();

    expect(html).toContain('aria-label="Range"');
    expect(html).toContain('data-testid="task-list-range-select-toggle"');
    expect(html).toContain('Range');
  });

  it('exposes range mode as a selected toggle state', () => {
    const html = renderBulkBar({ rangeSelectMode: true });

    expect(html).toContain('aria-label="Pick end"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Pick end');
  });
});
