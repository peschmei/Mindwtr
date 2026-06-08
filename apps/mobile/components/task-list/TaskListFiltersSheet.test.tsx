import React from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { TaskEnergyLevel } from '@mindwtr/core';

vi.mock('lucide-react-native', () => ({
  X: () => null,
}));

import { TaskListFiltersSheet } from './TaskListFiltersSheet';

const themeColors = {
  bg: '#0f172a',
  border: '#334155',
  cardBg: '#111827',
  filterBg: '#1f2937',
  onTint: '#ffffff',
  secondaryText: '#94a3b8',
  text: '#f8fafc',
  tint: '#3b82f6',
};

const createProps = (
  overrides: Partial<React.ComponentProps<typeof TaskListFiltersSheet>> = {}
): React.ComponentProps<typeof TaskListFiltersSheet> => ({
  energyLevelOptions: ['low', 'medium', 'high'] as TaskEnergyLevel[],
  hasFilters: false,
  locationQuery: '',
  onChangeLocationQuery: vi.fn(),
  onChangeSearchQuery: vi.fn(),
  onClearFilters: vi.fn(),
  onClose: vi.fn(),
  prioritiesEnabled: false,
  priorityOptions: [],
  searchQuery: '',
  selectedEnergyLevels: [],
  selectedPriorities: [],
  selectedTimeEstimates: [],
  selectedTokens: [],
  showLocationFilter: false,
  showTimeEstimateFilters: false,
  t: (key: string) => ({
    'common.close': 'Close',
    'common.search': 'Search',
    'filters.label': 'Filters',
    'search.placeholder': 'Search tasks',
    'taskEdit.energyLevel': 'Energy level',
    'energyLevel.low': 'Low energy',
    'energyLevel.medium': 'Medium energy',
    'energyLevel.high': 'High energy',
  }[key] ?? key),
  themeColors,
  toggleEnergyLevel: vi.fn(),
  togglePriority: vi.fn(),
  toggleTimeEstimate: vi.fn(),
  toggleToken: vi.fn(),
  tokenOptions: [],
  visible: true,
  ...overrides,
});

const elementProps = (child: unknown): { children?: React.ReactNode; testID?: string } | null => (
  React.isValidElement(child)
    ? child.props as { children?: React.ReactNode; testID?: string }
    : null
);

describe('TaskListFiltersSheet', () => {
  it('keeps search above injected filter content', () => {
    let tree!: ReturnType<typeof create>;

    act(() => {
      tree = create(
        <TaskListFiltersSheet
          {...createProps({
            extraContent: (
              <View testID="project-filter-content">
                <Text>Project controls</Text>
              </View>
            ),
          })}
        />
      );
    });

    const scroll = tree.root.findByType(ScrollView);
    const children = React.Children.toArray(scroll.props.children);
    const searchLabelIndex = children.findIndex((child) => (
      React.isValidElement(child)
      && child.type === Text
      && elementProps(child)?.children === 'Search'
    ));
    const searchInputIndex = children.findIndex((child) => (
      React.isValidElement(child) && child.type === TextInput
    ));
    const extraContentIndex = children.findIndex((child) => (
      React.isValidElement(child) && elementProps(child)?.testID === 'project-filter-content'
    ));

    expect(searchLabelIndex).toBeGreaterThanOrEqual(0);
    expect(searchInputIndex).toBeGreaterThan(searchLabelIndex);
    expect(extraContentIndex).toBeGreaterThan(searchInputIndex);
  });
});
