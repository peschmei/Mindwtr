import React, { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { Task, TaskStatus } from '@mindwtr/core';

import { openContextsScreen, openProjectScreen } from '@/lib/task-meta-navigation';
import type { ThemeColors } from '@/hooks/use-theme-colors';
import { SwipeableTaskItem, type SwipeableTaskItemRowContext } from './swipeable-task-item';
import { TaskListBulkBar } from './task-list/TaskListBulkBar';
import { TaskListTagModal } from './task-list/TaskListTagModal';
import type { useTaskListSelection } from './use-task-list-selection';

/**
 * The subset of {@link useTaskListSelection}'s return value that the shared list
 * scaffolding drives. Callers pass the whole hook result — this alias keeps the
 * prop typed without re-listing every field.
 */
export type TaskListViewSelection = ReturnType<typeof useTaskListSelection>;

export interface TaskListViewProps {
  /** Flat, already filtered + sorted rows. The view owns no data logic. */
  tasks: Task[];
  isDark: boolean;
  themeColors: ThemeColors;
  t: (key: string) => string;

  /** Row interaction handlers. */
  onPressTask: (task: Task) => void;
  onChangeTaskStatus: (task: Task, status: TaskStatus) => void | Promise<unknown>;
  onDeleteTask: (task: Task) => void;
  highlightTaskId?: string | null;
  rowContext?: SwipeableTaskItemRowContext;

  /** Selection + bulk-action scaffolding, from useTaskListSelection. */
  selection: TaskListViewSelection;
  /** Statuses offered by the bulk "Move to" control, from getBulkMoveStatusOptions. */
  bulkStatusOptions: readonly TaskStatus[];

  /** Per-view chrome slots rendered inside / around the list. */
  ListHeaderComponent?: React.ComponentProps<typeof FlatList>['ListHeaderComponent'];
  ListFooterComponent?: React.ComponentProps<typeof FlatList>['ListFooterComponent'];
  ListEmptyComponent?: React.ComponentProps<typeof FlatList>['ListEmptyComponent'];

  contentContainerStyle?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
}

/**
 * Chrome-free task list body shared by the simple single-status screens
 * (waiting, someday, ...). It renders the selection bulk bar, a FlatList of
 * SwipeableTaskItem rows, and the tag modal that the bulk bar opens — nothing
 * view-specific. Stat headers, filter chips, deferred-project sections and
 * empty states are passed in as slots so each screen keeps only what is
 * genuinely its own.
 *
 * Presentational only: it subscribes to no store, so it is testable with plain
 * fixtures. The FlatList perf tuning matches the hand-rolled screens exactly
 * (see #766) — do not change it without re-checking the perf budgets.
 */
export function TaskListView({
  tasks,
  isDark,
  themeColors,
  t,
  onPressTask,
  onChangeTaskStatus,
  onDeleteTask,
  highlightTaskId,
  rowContext,
  selection,
  bulkStatusOptions,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  contentContainerStyle,
  listStyle,
}: TaskListViewProps) {
  const {
    bulkActionLabel,
    bulkActionLoading,
    exitSelectionMode,
    handleBatchAddTag,
    handleBatchDelete,
    handleBatchMove,
    hasSelection,
    multiSelectedIds,
    rangeSelectMode,
    selectedIdsArray,
    selectionMode,
    setTagInput,
    setTagModalVisible,
    tagInput,
    tagModalVisible,
    toggleRangeSelectMode,
    toggleMultiSelect,
  } = selection;

  const visibleTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);

  const renderTask = useCallback(({ item: task }: { item: Task }) => (
    <SwipeableTaskItem
      task={task}
      isDark={isDark}
      tc={themeColors}
      onPress={() => onPressTask(task)}
      selectionMode={selectionMode}
      isMultiSelected={multiSelectedIds.has(task.id)}
      onToggleSelect={() => toggleMultiSelect(task.id, { visibleTaskIds })}
      onStatusChange={(status) => onChangeTaskStatus(task, status)}
      onDelete={() => onDeleteTask(task)}
      isHighlighted={task.id === highlightTaskId}
      statusBadgeAsIcon
      rowContext={rowContext}
      onProjectPress={openProjectScreen}
      onContextPress={openContextsScreen}
      onTagPress={openContextsScreen}
    />
  ), [
    highlightTaskId,
    isDark,
    multiSelectedIds,
    onChangeTaskStatus,
    onDeleteTask,
    onPressTask,
    rowContext,
    selectionMode,
    themeColors,
    toggleMultiSelect,
    visibleTaskIds,
  ]);

  return (
    <>
      {selectionMode ? (
        <TaskListBulkBar
          bulkActionLabel={bulkActionLabel}
          bulkActionLoading={bulkActionLoading}
          handleBatchDelete={handleBatchDelete}
          handleBatchMove={handleBatchMove}
          hasSelection={hasSelection}
          onExitSelectionMode={exitSelectionMode}
          onOpenTagModal={() => setTagModalVisible(true)}
          onToggleRangeSelectMode={toggleRangeSelectMode}
          rangeSelectMode={rangeSelectMode}
          selectedCount={selectedIdsArray.length}
          statusOptions={bulkStatusOptions}
          t={t}
          themeColors={themeColors}
        />
      ) : null}

      <FlatList
        data={tasks}
        renderItem={renderTask}
        keyExtractor={(task) => task.id}
        style={listStyle ?? styles.list}
        contentContainerStyle={contentContainerStyle}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
      />

      <TaskListTagModal
        onChangeTag={setTagInput}
        onClose={() => {
          setTagModalVisible(false);
          setTagInput('');
        }}
        onSave={handleBatchAddTag}
        t={t}
        tagInput={tagInput}
        themeColors={themeColors}
        visible={tagModalVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
