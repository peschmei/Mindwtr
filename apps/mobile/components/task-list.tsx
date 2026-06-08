import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, FlatList, Text, RefreshControl, Keyboard, TouchableOpacity, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { router } from 'expo-router';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, MoveVertical } from 'lucide-react-native';
import { NestableDraggableFlatList, ScaleDecorator, type DragEndParams, type RenderItemParams } from 'react-native-draggable-flatlist';
import {
  useTaskStore,
  Task,
  TaskStatus,
  TaskEnergyLevel,
  TaskPriority,
  TimeEstimate,
  sortTasksBy,
  splitCompletedTasks,
  parseQuickAdd,
  getQuickAddProjectInitialProps,
  getUsedTaskTokens,
  createAIProvider,
  type AIProviderId,
  type TaskSortBy,
  type ProjectSequenceTaskCue,
  DEFAULT_PROJECT_COLOR,
  getTranslationsSync,
  shallow,
  tFallback,
  isSelectableProjectForTaskAssignment,
  isTaskInActiveProject,
} from '@mindwtr/core';

import { TaskEditModal } from './task-edit-modal';
import { ErrorBoundary } from './ErrorBoundary';
import { ListEmptyState } from './list-empty-state';
import { SwipeableTaskItem } from './swipeable-task-item';
import { useTheme } from '../contexts/theme-context';
import { useLanguage } from '../contexts/language-context';

import { useThemeColors } from '@/hooks/use-theme-colors';
import { useMobileAreaFilter } from '@/hooks/use-mobile-area-filter';
import { useToast } from '@/contexts/toast-context';
import { PullSyncIndicator } from '@/components/PullSyncIndicator';
import { useManualPullSync } from '@/hooks/use-manual-pull-sync';
import { taskMatchesAreaFilter } from '@/lib/area-filter';
import { openContextsScreen, openProjectScreen } from '@/lib/task-meta-navigation';
import { buildCopilotConfig, isAIKeyRequired, loadAIKey } from '../lib/ai-config';
import { logError } from '../lib/app-log';
import {
  TaskListBulkBar,
} from './task-list/TaskListBulkBar';
import {
  TaskListBulkOrganizeModal,
} from './task-list/TaskListBulkOrganizeModal';
import {
  TaskListHeader,
  type TaskListActiveFilterChip,
} from './task-list/TaskListHeader';
import {
  TaskListFiltersSheet,
} from './task-list/TaskListFiltersSheet';
import {
  TaskListQuickAdd,
} from './task-list/TaskListQuickAdd';
import {
  TaskListSortModal,
} from './task-list/TaskListSortModal';
import {
  TaskListTagModal,
} from './task-list/TaskListTagModal';
import { styles } from './task-list/task-list.styles';
import {
  buildProjectTaskReorderGroups,
  buildStaticListVirtualWindow,
  resolveStaticListViewportHeight,
  type ProjectTaskReorderGroup,
  sortProjectTasksByOrder,
} from './task-list-utils';
import {
  countActiveMobileTaskFilters,
  taskMatchesMobileTaskFilters,
  type MobileTaskListFilters,
} from './task-list/task-list-filter-utils';
import { useTaskListSelection } from './use-task-list-selection';

const REMOVE_CLIPPED_SUBVIEWS_MIN_ITEMS = 15;
const STATIC_LIST_VIRTUALIZATION_THRESHOLD = 80;
const STATIC_LIST_ROW_ESTIMATE = 88;
const STATIC_LIST_OVERSCAN = 8;
const PRIORITY_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const ENERGY_LEVEL_OPTIONS: TaskEnergyLevel[] = ['low', 'medium', 'high'];

type StaticListVirtualizationWindow = {
  scrollOffsetY: number;
  viewportHeight: number;
};

export interface TaskListProps {
  statusFilter: TaskStatus | 'all';
  title: string;
  taskSource?: Task[];
  showHeader?: boolean;
  showTimeEstimateFilters?: boolean;
  allowAdd?: boolean;
  projectId?: string;
  staticList?: boolean;
  staticListVirtualization?: StaticListVirtualizationWindow;
  enableBulkActions?: boolean;
  enableInboxBulkOrganize?: boolean;
  showSort?: boolean;
  showQuickAddHelp?: boolean;
  emptyText?: string;
  emptyHint?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  headerAccessory?: React.ReactNode;
  filterSheetAccessory?: React.ReactNode;
  extraFilterActiveCount?: number;
  onClearExtraFilters?: () => void;
  enableCopilot?: boolean;
  defaultEditTab?: 'task' | 'view';
  contentPaddingBottom?: number;
  enableProjectReorder?: boolean;
  projectSortBy?: TaskSortBy;
  onQuickAddInputFocus?: (targetInput?: number | string) => void;
  projectReorderMode?: boolean;
  onProjectReorderModeChange?: (active: boolean) => void;
  includeArchived?: boolean;
  includeDone?: boolean;
  groupCompletedTasksLast?: boolean;
  getTaskSequenceCue?: (task: Task) => ProjectSequenceTaskCue | undefined;
  sequenceCueLabels?: Record<ProjectSequenceTaskCue, string>;
}

// ... inside TaskList component
function TaskListComponent({
  statusFilter,
  title,
  taskSource,
  showHeader = true,
  showTimeEstimateFilters: showTimeEstimateFiltersProp = true,
  allowAdd = true,
  projectId,
  staticList = false,
  staticListVirtualization,
  enableBulkActions = true,
  enableInboxBulkOrganize = false,
  showSort = true,
  showQuickAddHelp = true,
  emptyText,
  emptyHint,
  emptyActionLabel,
  onEmptyAction,
  headerAccessory,
  filterSheetAccessory,
  extraFilterActiveCount = 0,
  onClearExtraFilters,
  enableCopilot = true,
  defaultEditTab,
  contentPaddingBottom,
  enableProjectReorder = false,
  projectSortBy,
  onQuickAddInputFocus,
  projectReorderMode: projectReorderModeProp,
  onProjectReorderModeChange,
  includeArchived = false,
  includeDone = true,
  groupCompletedTasksLast = false,
  getTaskSequenceCue,
  sequenceCueLabels,
}: TaskListProps) {
  const { isDark } = useTheme();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const {
    tasks,
    projects,
    sections,
    areas,
    addTask,
    addProject,
    updateTask,
    deleteTask,
    restoreTask,
    batchMoveTasks,
    batchDeleteTasks,
    batchUpdateTasks,
    reorderProjectTasks,
    reorderSections,
    settings,
    updateSettings,
    highlightTaskId,
    setHighlightTask,
  } = useTaskStore((state) => ({
    tasks: taskSource ?? (includeArchived ? state._allTasks : state.tasks),
    projects: state.projects,
    sections: state.sections,
    areas: state.areas,
    addTask: state.addTask,
    addProject: state.addProject,
    updateTask: state.updateTask,
    deleteTask: state.deleteTask,
    restoreTask: state.restoreTask,
    batchMoveTasks: state.batchMoveTasks,
    batchDeleteTasks: state.batchDeleteTasks,
    batchUpdateTasks: state.batchUpdateTasks,
    reorderProjectTasks: state.reorderProjectTasks,
    reorderSections: state.reorderSections,
    settings: state.settings,
    updateSettings: state.updateSettings,
    highlightTaskId: state.highlightTaskId,
    setHighlightTask: state.setHighlightTask,
  }), shallow);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [copilotSuggestion, setCopilotSuggestion] = useState<{ context?: string; timeEstimate?: Task['timeEstimate']; tags?: string[] } | null>(null);
  const [copilotApplied, setCopilotApplied] = useState(false);
  const [copilotContext, setCopilotContext] = useState<string | undefined>(undefined);
  const [copilotTags, setCopilotTags] = useState<string[]>([]);
  const [copilotThinking, setCopilotThinking] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [bulkOrganizeVisible, setBulkOrganizeVisible] = useState(false);
  const [internalProjectReorderMode, setInternalProjectReorderMode] = useState(false);
  const [completedTasksCollapsed, setCompletedTasksCollapsed] = useState(true);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<TaskPriority[]>([]);
  const [selectedEnergyLevels, setSelectedEnergyLevels] = useState<TaskEnergyLevel[]>([]);
  const [selectedTimeEstimates, setSelectedTimeEstimates] = useState<TimeEstimate[]>([]);
  const [inputSelection, setInputSelection] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const [typeaheadIndex, setTypeaheadIndex] = useState(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copilotAbortRef = useRef<AbortController | null>(null);
  const copilotRequestIdRef = useRef(0);
  const restoreActionLabel = getTranslationsSync(language)['trash.restoreToInbox']
    || getTranslationsSync('en')['trash.restoreToInbox']
    || 'Restore';
  const pullSync = useManualPullSync();

  // Dynamic colors based on theme
  const themeColors = useThemeColors();
  const themeColorsMemo = useMemo(
    () => ({
      bg: themeColors.bg,
      cardBg: themeColors.cardBg,
      taskItemBg: themeColors.taskItemBg,
      text: themeColors.text,
      secondaryText: themeColors.secondaryText,
      icon: themeColors.icon,
      border: themeColors.border,
      tint: themeColors.tint,
      onTint: themeColors.onTint,
      tabIconDefault: themeColors.tabIconDefault,
      tabIconSelected: themeColors.tabIconSelected,
      inputBg: themeColors.inputBg,
      danger: themeColors.danger,
      success: themeColors.success,
      warning: themeColors.warning,
      filterBg: themeColors.filterBg,
    }),
    [
      themeColors.bg,
      themeColors.cardBg,
      themeColors.taskItemBg,
      themeColors.text,
      themeColors.secondaryText,
      themeColors.icon,
      themeColors.border,
      themeColors.tint,
      themeColors.onTint,
      themeColors.tabIconDefault,
      themeColors.tabIconSelected,
      themeColors.inputBg,
      themeColors.danger,
      themeColors.success,
      themeColors.warning,
      themeColors.filterBg,
    ],
  );

  const listContentStyle = useMemo(() => {
    if (!contentPaddingBottom || contentPaddingBottom <= 0) {
      return styles.listContent;
    }
    return [styles.listContent, { paddingBottom: 12 + contentPaddingBottom }];
  }, [contentPaddingBottom]);
  const [taskListRootOffsetY, setTaskListRootOffsetY] = useState(0);
  const [staticListOffsetY, setStaticListOffsetY] = useState(0);
  const handleTaskListRootLayout = useCallback((event: LayoutChangeEvent) => {
    if (!staticListVirtualization) return;
    setTaskListRootOffsetY(event.nativeEvent.layout.y);
  }, [staticListVirtualization]);
  const handleStaticListLayout = useCallback((event: LayoutChangeEvent) => {
    if (!staticListVirtualization) return;
    setStaticListOffsetY(event.nativeEvent.layout.y);
  }, [staticListVirtualization]);
  const emptyMessage = emptyText || t('list.noTasks');

  const tasksById = useMemo(() => {
    return tasks.reduce((acc, task) => {
      acc[task.id] = task;
      return acc;
    }, {} as Record<string, Task>);
  }, [tasks]);
  const {
    bulkActionLabel,
    bulkActionLoading,
    exitSelectionMode,
    handleBatchAddTag,
    handleBatchDelete,
    handleBatchOrganize,
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
  } = useTaskListSelection({
    batchDeleteTasks,
    batchMoveTasks,
    batchUpdateTasks,
    restoreActionLabel,
    restoreTask,
    t,
    tasksById,
  });

  const sortBy = (projectSortBy ?? settings?.taskSortBy ?? 'default') as TaskSortBy;
  const canUseProjectReorder = Boolean(enableProjectReorder && projectId && sortBy === 'default');
  const shouldGroupCompletedTasks = Boolean(groupCompletedTasksLast && projectId && statusFilter === 'all');
  const projectReorderMode = projectReorderModeProp ?? internalProjectReorderMode;
  const quickAddAvailable = allowAdd && !projectReorderMode;
  const aiEnabled = settings?.ai?.enabled === true;
  const quickAddCopilotEnabled = quickAddAvailable && enableCopilot && aiEnabled;
  const aiProvider = (settings?.ai?.provider ?? 'openai') as AIProviderId;
  const keyRequired = isAIKeyRequired(settings);
  const prioritiesEnabled = settings?.features?.priorities !== false;
  const timeEstimatesEnabled = settings?.features?.timeEstimates !== false;
  const showTimeEstimateFilters = showTimeEstimateFiltersProp && timeEstimatesEnabled && statusFilter !== 'inbox';
  const canBulkOrganizeInbox = enableInboxBulkOrganize && statusFilter === 'inbox';
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const { areaById, resolvedAreaFilter, selectedAreaIdForNewTasks } = useMobileAreaFilter();

  useEffect(() => {
    if (!showTimeEstimateFilters && selectedTimeEstimates.length > 0) {
      setSelectedTimeEstimates([]);
    }
  }, [selectedTimeEstimates.length, showTimeEstimateFilters]);

  useEffect(() => {
    if (!prioritiesEnabled && selectedPriorities.length > 0) {
      setSelectedPriorities([]);
    }
  }, [prioritiesEnabled, selectedPriorities.length]);

  const lastProjectIdRef = useRef(projectId);
  const setProjectReorderMode = useCallback((active: boolean) => {
    if (projectReorderModeProp === undefined) {
      setInternalProjectReorderMode(active);
    }
    onProjectReorderModeChange?.(active);
  }, [onProjectReorderModeChange, projectReorderModeProp]);

  useEffect(() => {
    if (lastProjectIdRef.current === projectId) return;
    lastProjectIdRef.current = projectId;
    setProjectReorderMode(false);
  }, [projectId, setProjectReorderMode]);

  useEffect(() => {
    setCompletedTasksCollapsed(true);
  }, [groupCompletedTasksLast, projectId]);

  useEffect(() => {
    if (!canUseProjectReorder && projectReorderMode) {
      setProjectReorderMode(false);
    }
  }, [canUseProjectReorder, projectReorderMode, setProjectReorderMode]);

  useEffect(() => {
    if (projectReorderMode && selectionMode) {
      exitSelectionMode();
    }
  }, [exitSelectionMode, projectReorderMode, selectionMode]);

  const toggleTimeEstimate = useCallback((estimate: TimeEstimate) => {
    setSelectedTimeEstimates((prev) => (
      prev.includes(estimate)
        ? prev.filter((value) => value !== estimate)
        : [...prev, estimate]
    ));
  }, []);
  const toggleTokenFilter = useCallback((token: string) => {
    setSelectedTokens((prev) => (
      prev.includes(token)
        ? prev.filter((value) => value !== token)
        : [...prev, token]
    ));
  }, []);
  const togglePriorityFilter = useCallback((priority: TaskPriority) => {
    setSelectedPriorities((prev) => (
      prev.includes(priority)
        ? prev.filter((value) => value !== priority)
        : [...prev, priority]
    ));
  }, []);
  const toggleEnergyLevelFilter = useCallback((energyLevel: TaskEnergyLevel) => {
    setSelectedEnergyLevels((prev) => (
      prev.includes(energyLevel)
        ? prev.filter((value) => value !== energyLevel)
        : [...prev, energyLevel]
    ));
  }, []);
  const clearTaskFilters = useCallback(() => {
    setTaskSearchQuery('');
    setLocationFilter('');
    setSelectedTokens([]);
    setSelectedPriorities([]);
    setSelectedEnergyLevels([]);
    setSelectedTimeEstimates([]);
  }, []);
  const clearAllFilters = useCallback(() => {
    clearTaskFilters();
    onClearExtraFilters?.();
  }, [clearTaskFilters, onClearExtraFilters]);

  const filterableTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.deletedAt) return false;
      if (statusFilter === 'all' && task.status === 'reference') return false;
      if (statusFilter === 'all' && !includeDone && task.status === 'done') return false;
      const matchesStatus = statusFilter === 'all' ? true : task.status === statusFilter;
      const matchesProject = projectId ? task.projectId === projectId : true;
      if (!projectId && !isTaskInActiveProject(task, projectById)) return false;
      if (!taskMatchesAreaFilter(task, resolvedAreaFilter, projectById, areaById)) return false;
      return matchesStatus && matchesProject;
    });
  }, [areaById, includeDone, projectById, projectId, resolvedAreaFilter, statusFilter, tasks]);
  const tokenFilterOptions = useMemo(() => {
    if (!filtersVisible) return selectedTokens;
    return getUsedTaskTokens(filterableTasks, (task) => [...(task.contexts ?? []), ...(task.tags ?? [])]);
  }, [filterableTasks, filtersVisible, selectedTokens]);
  const showLocationFilter = useMemo(() => {
    if (locationFilter.trim().length > 0) return true;
    if (!filtersVisible) return false;
    return filterableTasks.some((task) => String(task.location ?? '').trim().length > 0);
  }, [filterableTasks, filtersVisible, locationFilter]);
  const taskListFilters = useMemo<MobileTaskListFilters>(() => ({
    energyLevels: selectedEnergyLevels,
    locationQuery: locationFilter,
    priorities: prioritiesEnabled ? selectedPriorities : [],
    searchQuery: taskSearchQuery,
    timeEstimates: showTimeEstimateFilters ? selectedTimeEstimates : [],
    tokens: selectedTokens,
  }), [
    locationFilter,
    prioritiesEnabled,
    selectedEnergyLevels,
    selectedPriorities,
    selectedTimeEstimates,
    selectedTokens,
    showTimeEstimateFilters,
    taskSearchQuery,
  ]);
  const activeTaskFilterCount = countActiveMobileTaskFilters(taskListFilters);
  const hasActiveTaskFilters = activeTaskFilterCount > 0;
  const totalFilterActiveCount = activeTaskFilterCount + extraFilterActiveCount;
  const hasAnyActiveFilters = hasActiveTaskFilters || extraFilterActiveCount > 0;
  const activeFilterChips = useMemo<TaskListActiveFilterChip[]>(() => {
    const chips: TaskListActiveFilterChip[] = [];
    const normalizedSearch = taskSearchQuery.trim();
    if (normalizedSearch) {
      chips.push({
        id: 'search',
        label: `${t('common.search')}: ${normalizedSearch}`,
        onPress: () => setTaskSearchQuery(''),
      });
    }
    selectedTokens.forEach((token) => {
      chips.push({
        id: `token:${token}`,
        label: token,
        onPress: () => toggleTokenFilter(token),
      });
    });
    if (prioritiesEnabled) {
      selectedPriorities.forEach((priority) => {
        chips.push({
          id: `priority:${priority}`,
          label: t(`priority.${priority}`),
          onPress: () => togglePriorityFilter(priority),
        });
      });
    }
    selectedEnergyLevels.forEach((energyLevel) => {
      chips.push({
        id: `energy:${energyLevel}`,
        label: t(`energyLevel.${energyLevel}`),
        onPress: () => toggleEnergyLevelFilter(energyLevel),
      });
    });
    if (showTimeEstimateFilters) {
      selectedTimeEstimates.forEach((estimate) => {
        chips.push({
          id: `time:${estimate}`,
          label: estimate.replace('min', 'm').replace('hr+', 'h+').replace('hr', 'h'),
          onPress: () => toggleTimeEstimate(estimate),
        });
      });
    }
    const normalizedLocation = locationFilter.trim();
    if (normalizedLocation) {
      chips.push({
        id: 'location',
        label: `${tFallback(t, 'taskEdit.locationLabel', 'Location')}: ${normalizedLocation}`,
        onPress: () => setLocationFilter(''),
      });
    }
    return chips;
  }, [
    locationFilter,
    prioritiesEnabled,
    selectedEnergyLevels,
    selectedPriorities,
    selectedTimeEstimates,
    selectedTokens,
    showTimeEstimateFilters,
    t,
    taskSearchQuery,
    toggleEnergyLevelFilter,
    togglePriorityFilter,
    toggleTimeEstimate,
    toggleTokenFilter,
  ]);
  const filteredEmptyMessage = hasActiveTaskFilters
    ? tFallback(t, 'filters.noMatch', 'No tasks match these filters.')
    : emptyMessage;
  const filteredEmptyHint = hasActiveTaskFilters
    ? activeFilterChips.slice(0, 3).map((chip) => chip.label).join(', ')
    : emptyHint;
  const filteredEmptyActionLabel = hasActiveTaskFilters
    ? tFallback(t, 'filters.clear', 'Clear')
    : emptyActionLabel;
  const filteredEmptyAction = hasActiveTaskFilters ? clearTaskFilters : onEmptyAction;

  // Memoize filtered and sorted tasks for performance
  const filteredTasks = useMemo(() => {
    return filterableTasks.filter((task) => taskMatchesMobileTaskFilters(task, taskListFilters));
  }, [filterableTasks, taskListFilters]);

  const orderedTasks = useMemo(() => {
    if (projectId && enableProjectReorder && sortBy === 'default') {
      return sortProjectTasksByOrder(filteredTasks);
    }
    return sortTasksBy(filteredTasks, sortBy);
  }, [enableProjectReorder, filteredTasks, projectId, sortBy]);
  const { activeTasks: orderedActiveTasks, completedTasks: orderedCompletedTasks } = useMemo(() => {
    if (!shouldGroupCompletedTasks) {
      return { activeTasks: orderedTasks, completedTasks: [] as Task[] };
    }
    return splitCompletedTasks(orderedTasks);
  }, [orderedTasks, shouldGroupCompletedTasks]);

  const projectSections = useMemo(() => {
    if (!projectId) return [];
    return sections
      .filter((section) => section.projectId === projectId && !section.deletedAt)
      .sort((a, b) => {
        const aOrder = Number.isFinite(a.order) ? a.order : 0;
        const bOrder = Number.isFinite(b.order) ? b.order : 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.title.localeCompare(b.title);
      });
  }, [projectId, sections]);

  type ListItem =
    | { type: 'section'; id: string; title: string; count: number; muted?: boolean; collapsible?: boolean; collapsed?: boolean }
    | { type: 'task'; task: Task; reorderSectionId?: string | null };

  const LIST_CONTENT_VERTICAL_PADDING = 12;
  const ESTIMATED_SECTION_HEIGHT = 32;
  const ESTIMATED_TASK_HEIGHT = 86;

  const listItems = useMemo<ListItem[]>(() => {
    if (statusFilter === 'reference' && !projectId) {
      const activeAreas = [...areas].filter((area) => !area.deletedAt).sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      });
      const areaIds = new Set(activeAreas.map((area) => area.id));
      const grouped = new Map<string, Task[]>();
      const generalTasks: Task[] = [];

      orderedActiveTasks.forEach((task) => {
        const projectAreaId = task.projectId ? projectById.get(task.projectId)?.areaId : undefined;
        const resolvedAreaId = task.areaId || projectAreaId;
        if (resolvedAreaId && areaIds.has(resolvedAreaId)) {
          const items = grouped.get(resolvedAreaId) ?? [];
          items.push(task);
          grouped.set(resolvedAreaId, items);
        } else {
          generalTasks.push(task);
        }
      });

      const items: ListItem[] = [];
      if (generalTasks.length > 0) {
        items.push({
          type: 'section',
          id: 'general',
          title: tFallback(t, 'settings.general', 'General'),
          count: generalTasks.length,
          muted: true,
        });
        generalTasks.forEach((task) => items.push({ type: 'task', task }));
      }

      activeAreas.forEach((area) => {
        const tasksForArea = grouped.get(area.id) ?? [];
        if (tasksForArea.length === 0) return;
        items.push({ type: 'section', id: area.id, title: area.name, count: tasksForArea.length });
        tasksForArea.forEach((task) => items.push({ type: 'task', task }));
      });
      return items;
    }

    const appendCompletedTasks = (items: ListItem[]) => {
      if (!shouldGroupCompletedTasks || orderedCompletedTasks.length === 0) return items;
      items.push({
        type: 'section',
        id: 'project-completed-tasks',
        title: tFallback(t, 'list.done', tFallback(t, 'status.done', 'Completed')),
        count: orderedCompletedTasks.length,
        muted: true,
        collapsible: true,
        collapsed: completedTasksCollapsed,
      });
      if (!completedTasksCollapsed) {
        orderedCompletedTasks.forEach((task) => items.push({ type: 'task', task }));
      }
      return items;
    };

    const shouldGroup = Boolean(projectId) && (projectSections.length > 0 || orderedActiveTasks.some((task) => task.sectionId));
    if (!shouldGroup) {
      return appendCompletedTasks(orderedActiveTasks.map((task) => ({ type: 'task', task, reorderSectionId: projectId ? undefined : task.sectionId })));
    }
    const sectionIds = new Set(projectSections.map((section) => section.id));
    const tasksBySection = new Map<string, Task[]>();
    const unsectioned: Task[] = [];
    orderedActiveTasks.forEach((task) => {
      const sectionId = task.sectionId && sectionIds.has(task.sectionId) ? task.sectionId : null;
      if (sectionId) {
        const list = tasksBySection.get(sectionId) ?? [];
        list.push(task);
        tasksBySection.set(sectionId, list);
      } else {
        unsectioned.push(task);
      }
    });
    const items: ListItem[] = [];
    projectSections.forEach((section) => {
      const tasksForSection = tasksBySection.get(section.id) ?? [];
      if (tasksForSection.length === 0 && !projectReorderMode) return;
      items.push({ type: 'section', id: section.id, title: section.title, count: tasksForSection.length });
      tasksForSection.forEach((task) => items.push({ type: 'task', task, reorderSectionId: section.id }));
    });
    if (unsectioned.length > 0) {
      const reorderSectionId = projectSections.length > 0 ? null : undefined;
      items.push({
        type: 'section',
        id: 'no-section',
        title: t('projects.noSection'),
        count: unsectioned.length,
        muted: true,
      });
      unsectioned.forEach((task) => items.push({ type: 'task', task, reorderSectionId }));
    }
    return appendCompletedTasks(items);
  }, [areas, completedTasksCollapsed, orderedActiveTasks, orderedCompletedTasks, projectById, projectId, projectReorderMode, projectSections, shouldGroupCompletedTasks, statusFilter, t]);
  const orderedTaskIds = useMemo(
    () => listItems.flatMap((item) => (item.type === 'task' ? [item.task.id] : [])),
    [listItems],
  );
  const itemHeightsRef = useRef<Record<string, number>>({});
  const [itemLayoutVersion, setItemLayoutVersion] = useState(0);
  const getListItemKey = useCallback((item: ListItem) => (
    item.type === 'section' ? `section-${item.id}` : item.task.id
  ), []);
  const estimateItemHeight = useCallback((item: ListItem) => (
    item.type === 'section' ? ESTIMATED_SECTION_HEIGHT : ESTIMATED_TASK_HEIGHT
  ), []);
  const registerItemHeight = useCallback((itemKey: string, height: number) => {
    const rounded = Math.round(height);
    if (!Number.isFinite(rounded) || rounded <= 0) return;
    if (itemHeightsRef.current[itemKey] === rounded) return;
    itemHeightsRef.current[itemKey] = rounded;
    setItemLayoutVersion((prev) => prev + 1);
  }, []);
  const itemLayouts = useMemo(() => {
    // itemLayoutVersion invalidates memoized offsets when ref-backed row heights change.
    void itemLayoutVersion;
    let offset = LIST_CONTENT_VERTICAL_PADDING;
    return listItems.map((item) => {
      const key = getListItemKey(item);
      const length = itemHeightsRef.current[key] ?? estimateItemHeight(item);
      const layout = { length, offset };
      offset += length;
      return layout;
    });
  }, [estimateItemHeight, getListItemKey, itemLayoutVersion, listItems]);
  const getItemLayout = useCallback((_: ArrayLike<ListItem> | null | undefined, index: number) => {
    const measured = itemLayouts[index];
    if (measured) {
      return { index, length: measured.length, offset: measured.offset };
    }
    return {
      index,
      length: ESTIMATED_TASK_HEIGHT,
      offset: LIST_CONTENT_VERTICAL_PADDING + (ESTIMATED_TASK_HEIGHT * index),
    };
  }, [itemLayouts]);

  const projectReorderGroups = useMemo<ProjectTaskReorderGroup<Task>[]>(() => {
    if (!canUseProjectReorder) return [];
    const reorderItems = shouldGroupCompletedTasks
      ? listItems.filter((item) => (item.type === 'section' ? item.id !== 'project-completed-tasks' : item.task.status !== 'done'))
      : listItems;
    return buildProjectTaskReorderGroups<Task>(reorderItems, { includeEmptySections: projectSections.length > 0 });
  }, [canUseProjectReorder, listItems, projectSections.length, shouldGroupCompletedTasks]);
  const projectSectionIds = useMemo(() => projectSections.map((section) => section.id), [projectSections]);
  const hasProjectReorderItems = projectReorderGroups.some((group) => group.tasks.length > 0) || projectSections.length > 1;
  const staticListVirtualWindow = useMemo(() => {
    const effectiveViewportHeight = resolveStaticListViewportHeight(
      staticListVirtualization?.viewportHeight ?? 0,
      windowHeight,
    );
    if (
      !staticList
      || projectReorderMode
      || !staticListVirtualization
      || effectiveViewportHeight <= 0
      || listItems.length <= STATIC_LIST_VIRTUALIZATION_THRESHOLD
    ) {
      return null;
    }

    return buildStaticListVirtualWindow(listItems, {
      listOffsetY: taskListRootOffsetY + staticListOffsetY,
      overscan: STATIC_LIST_OVERSCAN,
      rowEstimate: STATIC_LIST_ROW_ESTIMATE,
      scrollOffsetY: staticListVirtualization.scrollOffsetY,
      viewportHeight: effectiveViewportHeight,
    });
  }, [
    listItems,
    projectReorderMode,
    staticList,
    staticListOffsetY,
    staticListVirtualization,
    taskListRootOffsetY,
    windowHeight,
  ]);
  // Keep the draggable pan handler on the handle strip so vertical scrolling still works.
  // DraggableFlatList gesture props: https://github.com/computerjazz/react-native-draggable-flatlist#props
  const projectDragHitSlop = useMemo(() => ({
    bottom: 0,
    left: -Math.max(windowWidth - 96, 0),
    right: 0,
    top: 0,
  }), [windowWidth]);

  const handleToggleProjectReorderMode = useCallback(() => {
    if (!canUseProjectReorder) return;
    exitSelectionMode();
    setProjectReorderMode(!projectReorderMode);
  }, [canUseProjectReorder, exitSelectionMode, projectReorderMode, setProjectReorderMode]);

  const handleProjectTaskDragEnd = useCallback((
    sectionId: string | null | undefined,
    params: DragEndParams<Task>,
  ) => {
    if (!projectId) return;
    if (params.from === params.to) return;
    const orderedIds = params.data.map((task) => task.id);

    void Promise.resolve(reorderProjectTasks(projectId, orderedIds, sectionId)).catch((error) => {
      void logError(error, { scope: 'project', extra: { message: 'Failed to reorder project tasks' } });
      showToast({
        title: t('common.notice'),
        message: tFallback(t, 'projects.taskReorderFailed', 'Failed to reorder tasks.'),
        tone: 'error',
      });
    });
  }, [projectId, reorderProjectTasks, showToast, t]);

  const handleProjectSectionMove = useCallback((sectionId: string, offset: -1 | 1) => {
    if (!projectId) return;
    const currentIndex = projectSectionIds.indexOf(sectionId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= projectSectionIds.length) return;
    const nextIds = [...projectSectionIds];
    const [moved] = nextIds.splice(currentIndex, 1);
    if (!moved) return;
    nextIds.splice(nextIndex, 0, moved);
    void Promise.resolve(reorderSections(projectId, nextIds)).catch((error) => {
      void logError(error, { scope: 'project', extra: { message: 'Failed to reorder project sections' } });
      showToast({
        title: t('common.notice'),
        message: tFallback(t, 'projects.sectionReorderFailed', 'Failed to reorder sections.'),
        tone: 'error',
      });
    });
  }, [projectId, projectSectionIds, reorderSections, showToast, t]);

  const contextOptions = useMemo(() => {
    if (!quickAddAvailable) return [];
    return getUsedTaskTokens(tasks, (task) => task.contexts, { prefix: '@' });
  }, [quickAddAvailable, tasks]);
  const tagOptions = useMemo(() => {
    if (!quickAddCopilotEnabled) return [];
    return getUsedTaskTokens(tasks, (task) => task.tags, { prefix: '#' });
  }, [quickAddCopilotEnabled, tasks]);

  type TriggerType = 'project' | 'context';
  type TriggerState = { type: TriggerType; start: number; end: number; query: string };
  type Option =
    | { kind: 'create'; label: string; value: string }
    | { kind: 'project'; label: string; value: string }
    | { kind: 'context'; label: string; value: string };

  const getTrigger = useCallback((text: string, caret: number): TriggerState | null => {
    if (caret < 0) return null;
    const before = text.slice(0, caret);
    const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t'));
    const start = lastSpace + 1;
    const token = before.slice(start);
    if (!token.startsWith('+') && !token.startsWith('@')) return null;
    return {
      type: token.startsWith('+') ? 'project' : 'context',
      start,
      end: caret,
      query: token.slice(1),
    };
  }, []);

  const trigger = useMemo(() => {
    return getTrigger(newTaskTitle, inputSelection.start ?? newTaskTitle.length);
  }, [getTrigger, inputSelection.start, newTaskTitle]);

  const typeaheadOptions = useMemo<Option[]>(() => {
    if (!quickAddAvailable || !trigger) return [];
    const query = trigger.query.trim().toLowerCase();
    if (trigger.type === 'project') {
      const matches = projects
        .filter(isSelectableProjectForTaskAssignment)
        .filter((project) => project.title.toLowerCase().includes(query));
      const hasExact = query.length > 0 && projects.some((project) => project.title.toLowerCase() === query);
      const result: Option[] = [];
      if (!hasExact && query.length > 0) {
        const title = trigger.query.trim();
        result.push({
          kind: 'create' as const,
          label: `${tFallback(t, 'projects.create', 'Create')} "${title}"`,
          value: title,
        });
      }
      result.push(
        ...matches.map((project) => ({
          kind: 'project' as const,
          label: project.title,
          value: project.title,
        }))
      );
      return result;
    }
    const matches = contextOptions.filter((context) => {
      const raw = context.startsWith('@') || context.startsWith('#') ? context.slice(1) : context;
      return raw.toLowerCase().includes(query);
    });
    return matches.map((context) => ({
      kind: 'context' as const,
      label: context,
      value: context,
    }));
  }, [contextOptions, projects, quickAddAvailable, t, trigger]);

  useEffect(() => {
    if (!trigger || typeaheadOptions.length === 0) {
      setTypeaheadOpen(false);
      return;
    }
    setTypeaheadOpen(true);
  }, [trigger, typeaheadOptions.length]);

  useEffect(() => {
    if (!quickAddCopilotEnabled) {
      setAiKey('');
      return;
    }
    loadAIKey(aiProvider).then(setAiKey).catch((error) => {
      void logError(error, { scope: 'ai', extra: { message: 'Failed to load AI key' } });
      showToast({
        title: t('ai.errorTitle'),
        message: t('ai.disabledBody'),
        tone: 'warning',
        durationMs: 4200,
      });
    });
  }, [aiProvider, quickAddCopilotEnabled, showToast, t]);

  useEffect(() => {
    if (!quickAddCopilotEnabled || (keyRequired && !aiKey)) {
      setCopilotSuggestion(null);
      setCopilotThinking(false);
      return;
    }
    const title = newTaskTitle.trim();
    if (title.length < 4) {
      setCopilotSuggestion(null);
      setCopilotThinking(false);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const requestId = copilotRequestIdRef.current + 1;
      copilotRequestIdRef.current = requestId;
      setCopilotThinking(true);
      try {
        if (copilotAbortRef.current) copilotAbortRef.current.abort();
        const abortController = typeof AbortController === 'function' ? new AbortController() : null;
        copilotAbortRef.current = abortController;
        const provider = createAIProvider(buildCopilotConfig(settings, aiKey));
        const suggestion = await provider.predictMetadata(
          { title, contexts: contextOptions, tags: tagOptions },
          abortController ? { signal: abortController.signal } : undefined
        );
        if (cancelled) return;
        if (!suggestion.context && (!timeEstimatesEnabled || !suggestion.timeEstimate) && !suggestion.tags?.length) {
          setCopilotSuggestion(null);
        } else {
          setCopilotSuggestion(suggestion);
        }
      } catch {
        if (!cancelled) {
          setCopilotSuggestion(null);
        }
      } finally {
        if (!cancelled && copilotRequestIdRef.current === requestId) {
          setCopilotThinking(false);
        }
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      if (copilotAbortRef.current) {
        copilotAbortRef.current.abort();
        copilotAbortRef.current = null;
      }
    };
  }, [aiKey, aiProvider, contextOptions, keyRequired, newTaskTitle, quickAddCopilotEnabled, settings, statusFilter, tagOptions, timeEstimatesEnabled]);

  useEffect(() => {
    if (!highlightTaskId) return;
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightTask(null);
    }, 3500);
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightTaskId, setHighlightTask]);

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    const defaultStatus: TaskStatus = projectId
      ? 'next'
      : (statusFilter !== 'all' ? statusFilter : 'inbox');

    const { title: parsedTitle, props, projectTitle, invalidDateCommands } = parseQuickAdd(newTaskTitle, projects, new Date(), areas);
    if (invalidDateCommands && invalidDateCommands.length > 0) {
      showToast({
        title: t('common.notice'),
        message: `${t('quickAdd.invalidDateCommand')}: ${invalidDateCommands.join(', ')}`,
        tone: 'warning',
        durationMs: 4200,
      });
      return;
    }
    const finalTitle = parsedTitle || newTaskTitle;
    if (!finalTitle.trim()) return;

    const initialProps: Partial<Task> = { projectId, status: defaultStatus, ...props };
    if (
      initialProps.projectId
      && !projects.some((project) => project.id === initialProps.projectId && isSelectableProjectForTaskAssignment(project))
    ) {
      delete initialProps.projectId;
    }
    if (!props.status) initialProps.status = defaultStatus;
    if (!props.projectId && projectId) initialProps.projectId = projectId;
    if (!initialProps.projectId && projectTitle) {
      const inactiveProject = projects.find((project) => (
        project.title.toLowerCase() === projectTitle.toLowerCase()
        && !isSelectableProjectForTaskAssignment(project)
      ));
      if (inactiveProject) return;
      const created = await addProject(
        projectTitle,
        DEFAULT_PROJECT_COLOR,
        getQuickAddProjectInitialProps(initialProps, selectedAreaIdForNewTasks)
      );
      if (!created) return;
      initialProps.projectId = created.id;
    }
    if (!initialProps.projectId && !initialProps.areaId && selectedAreaIdForNewTasks) {
      initialProps.areaId = selectedAreaIdForNewTasks;
    }
    if (initialProps.projectId) {
      initialProps.areaId = undefined;
    }
    if (copilotContext) {
      const nextContexts = Array.from(new Set([...(initialProps.contexts ?? []), copilotContext]));
      initialProps.contexts = nextContexts;
    }
    if (copilotTags.length) {
      const nextTags = Array.from(new Set([...(initialProps.tags ?? []), ...copilotTags]));
      initialProps.tags = nextTags;
    }

    await addTask(finalTitle, initialProps);
    setNewTaskTitle('');
    setTypeaheadOpen(false);
    setCopilotSuggestion(null);
    setCopilotApplied(false);
    setCopilotContext(undefined);
    setCopilotTags([]);
    Keyboard.dismiss();
  };

  const applyTypeaheadOption = useCallback(async (option: Option) => {
    if (!trigger) return;
    let tokenValue = option.value;
    if (option.kind === 'create') {
      const title = option.value.trim();
      if (title) {
        await addProject(
          title,
          DEFAULT_PROJECT_COLOR,
          getQuickAddProjectInitialProps({}, selectedAreaIdForNewTasks)
        );
      }
    }
    if (trigger.type === 'project') {
      tokenValue = `+${tokenValue}`;
    } else {
      tokenValue = tokenValue.startsWith('@') ? tokenValue : `@${tokenValue}`;
    }
    const before = newTaskTitle.slice(0, trigger.start);
    const after = newTaskTitle.slice(trigger.end);
    const needsSpace = after.length > 0 && !/^\s/.test(after);
    const nextValue = `${before}${tokenValue}${needsSpace ? ' ' : ''}${after}`;
    setNewTaskTitle(nextValue);
    const caret = before.length + tokenValue.length + (needsSpace ? 1 : 0);
    setInputSelection({ start: caret, end: caret });
    setTypeaheadOpen(false);
    setTypeaheadIndex(0);
  }, [addProject, newTaskTitle, selectedAreaIdForNewTasks, trigger]);

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task);
    setIsModalVisible(true);
  }, []);

  const onSaveTask = useCallback((taskId: string, updates: Partial<Task>) => {
    updateTask(taskId, updates);
    setIsModalVisible(false);
    setEditingTask(null);
  }, [updateTask]);

  const sortOptions: TaskSortBy[] = ['default', 'due', 'start', 'review', 'title', 'created', 'created-desc'];
  const hideStatusBadgeForList = statusFilter === 'inbox' || statusFilter === 'next' || statusFilter === 'waiting';
  const hideChecklistProgressForList = statusFilter === 'inbox';

  const renderTask = useCallback(({ item }: { item: Task }) => {
    const sequenceCue = getTaskSequenceCue?.(item);
    const sequenceLabel = sequenceCue ? sequenceCueLabels?.[sequenceCue] : undefined;

    return (
      <ErrorBoundary>
        <SwipeableTaskItem
          task={item}
          isDark={isDark}
          tc={themeColorsMemo}
          onPress={() => handleEditTask(item)}
          selectionMode={enableBulkActions ? selectionMode : false}
          isMultiSelected={enableBulkActions && multiSelectedIds.has(item.id)}
          onToggleSelect={enableBulkActions ? () => toggleMultiSelect(item.id, { visibleTaskIds: orderedTaskIds }) : undefined}
          onStatusChange={(status) => updateTask(item.id, { status: status as TaskStatus })}
          onDelete={() => { void deleteTask(item.id); }}
          isHighlighted={item.id === highlightTaskId}
          hideStatusBadge={hideStatusBadgeForList}
          hideChecklistProgress={hideChecklistProgressForList}
          hideProjectMeta={Boolean(projectId)}
          sequenceCue={sequenceCue}
          sequenceLabel={sequenceLabel}
          onProjectPress={projectId ? undefined : openProjectScreen}
          onContextPress={openContextsScreen}
          onTagPress={openContextsScreen}
        />
      </ErrorBoundary>
    );
  }, [
    deleteTask,
    enableBulkActions,
    getTaskSequenceCue,
    handleEditTask,
    highlightTaskId,
    isDark,
    multiSelectedIds,
    orderedTaskIds,
    selectionMode,
    hideChecklistProgressForList,
    hideStatusBadgeForList,
    themeColorsMemo,
    toggleMultiSelect,
    updateTask,
    projectId,
    sequenceCueLabels,
  ]);

  const renderProjectReorderTask = useCallback(({ drag, isActive, item }: RenderItemParams<Task>) => (
    <ScaleDecorator activeScale={1.02}>
      <View style={[styles.projectDragTaskRow, isActive && styles.projectDragTaskRowActive]}>
        <View style={styles.projectDragTaskContent}>
          <ErrorBoundary>
            <SwipeableTaskItem
              task={item}
              isDark={isDark}
              tc={themeColorsMemo}
              onPress={() => undefined}
              selectionMode={false}
              isMultiSelected={false}
              onStatusChange={(status) => updateTask(item.id, { status: status as TaskStatus })}
              onDelete={() => { void deleteTask(item.id); }}
              isHighlighted={item.id === highlightTaskId}
              hideStatusBadge
              disableSwipe
              interactionDisabled
              hideChecklistProgress={hideChecklistProgressForList}
              hideProjectMeta={Boolean(projectId)}
            />
          </ErrorBoundary>
        </View>
        <TouchableOpacity
          accessibilityLabel={`${tFallback(t, 'board.dragTask', 'Drag task')}: ${item.title}`}
          accessibilityRole="button"
          activeOpacity={0.85}
          disabled={isActive}
          onPressIn={drag}
          style={[
            styles.projectDragHandle,
            { backgroundColor: themeColorsMemo.filterBg, borderColor: themeColorsMemo.border },
          ]}
          testID={`project-task-drag-handle-${item.id}`}
        >
          <GripVertical size={20} color={themeColorsMemo.secondaryText} />
        </TouchableOpacity>
      </View>
    </ScaleDecorator>
  ), [
    deleteTask,
    hideChecklistProgressForList,
    highlightTaskId,
    isDark,
    projectId,
    t,
    themeColorsMemo,
    updateTask,
  ]);

  const renderListItem = useCallback(({ item }: { item: ListItem }) => {
    const itemKey = getListItemKey(item);
    if (item.type === 'section') {
      if (item.collapsible) {
        return (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: item.collapsed !== true }}
            onPress={() => setCompletedTasksCollapsed((value) => !value)}
            style={styles.sectionHeader}
            onLayout={(event) => registerItemHeight(itemKey, event.nativeEvent.layout.height)}
          >
            <View style={styles.sectionHeaderTitleBlock}>
              {item.collapsed ? (
                <ChevronRight size={15} color={themeColorsMemo.secondaryText} />
              ) : (
                <ChevronDown size={15} color={themeColorsMemo.secondaryText} />
              )}
              <Text style={[styles.sectionTitle, { color: item.muted ? themeColorsMemo.secondaryText : themeColorsMemo.text }]}>
                {item.title}
              </Text>
            </View>
            <Text style={[styles.sectionCount, { color: themeColorsMemo.secondaryText }]}>
              {item.count}
            </Text>
          </TouchableOpacity>
        );
      }

      return (
        <View
          style={styles.sectionHeader}
          onLayout={(event) => registerItemHeight(itemKey, event.nativeEvent.layout.height)}
        >
          <Text style={[styles.sectionTitle, { color: item.muted ? themeColorsMemo.secondaryText : themeColorsMemo.text }]}>
            {item.title}
          </Text>
          <Text style={[styles.sectionCount, { color: themeColorsMemo.secondaryText }]}>
            {item.count}
          </Text>
        </View>
      );
    }
    return (
      <View onLayout={(event) => registerItemHeight(itemKey, event.nativeEvent.layout.height)}>
        {renderTask({ item: item.task })}
      </View>
    );
  }, [getListItemKey, registerItemHeight, renderTask, themeColorsMemo.secondaryText, themeColorsMemo.text]);

  const renderProjectReorderGroup = useCallback((group: ProjectTaskReorderGroup<Task>) => {
    const sectionIndex = typeof group.sectionId === 'string' ? projectSectionIds.indexOf(group.sectionId) : -1;
    const canReorderSection = sectionIndex >= 0 && projectSectionIds.length > 1;
    const canMoveSectionUp = canReorderSection && sectionIndex > 0;
    const canMoveSectionDown = canReorderSection && sectionIndex < projectSectionIds.length - 1;
    const moveSectionUpLabel = tFallback(t, 'projects.moveSectionUp', 'Move section up');
    const moveSectionDownLabel = tFallback(t, 'projects.moveSectionDown', 'Move section down');

    return (
      <View key={group.id} style={styles.projectDragGroup}>
        {group.title ? (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderTitleBlock}>
              <Text style={[styles.sectionTitle, { color: group.muted ? themeColorsMemo.secondaryText : themeColorsMemo.text }]} numberOfLines={1}>
                {group.title}
              </Text>
              <Text style={[styles.sectionCount, { color: themeColorsMemo.secondaryText }]}>
                {group.tasks.length}
              </Text>
            </View>
            {canReorderSection && typeof group.sectionId === 'string' ? (
              <View style={styles.sectionReorderControls}>
                <TouchableOpacity
                  accessibilityLabel={`${moveSectionUpLabel}: ${group.title}`}
                  accessibilityRole="button"
                  disabled={!canMoveSectionUp}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => handleProjectSectionMove(group.sectionId as string, -1)}
                  style={[
                    styles.sectionReorderButton,
                    { borderColor: themeColorsMemo.border, backgroundColor: themeColorsMemo.filterBg },
                    !canMoveSectionUp && styles.sectionReorderButtonDisabled,
                  ]}
                >
                  <ArrowUp size={16} color={themeColorsMemo.secondaryText} />
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityLabel={`${moveSectionDownLabel}: ${group.title}`}
                  accessibilityRole="button"
                  disabled={!canMoveSectionDown}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => handleProjectSectionMove(group.sectionId as string, 1)}
                  style={[
                    styles.sectionReorderButton,
                    { borderColor: themeColorsMemo.border, backgroundColor: themeColorsMemo.filterBg },
                    !canMoveSectionDown && styles.sectionReorderButtonDisabled,
                  ]}
                >
                  <ArrowDown size={16} color={themeColorsMemo.secondaryText} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
        {group.tasks.length > 0 ? (
          <NestableDraggableFlatList
            data={group.tasks}
            keyExtractor={(task) => task.id}
            renderItem={renderProjectReorderTask}
            onDragEnd={(params) => handleProjectTaskDragEnd(group.sectionId, params)}
            activationDistance={2}
            autoscrollThreshold={80}
            autoscrollSpeed={120}
            dragItemOverflow
            dragHitSlop={projectDragHitSlop}
            style={styles.projectDragList}
          />
        ) : null}
      </View>
    );
  }, [
    handleProjectSectionMove,
    handleProjectTaskDragEnd,
    projectDragHitSlop,
    projectSectionIds,
    renderProjectReorderTask,
    t,
    themeColorsMemo.border,
    themeColorsMemo.filterBg,
    themeColorsMemo.secondaryText,
    themeColorsMemo.text,
  ]);

  const projectReorderToggle = canUseProjectReorder && hasProjectReorderItems && !projectReorderMode ? (
    <TouchableOpacity
      accessibilityLabel={tFallback(t, 'projects.reorderTasks', 'Order')}
      accessibilityRole="button"
      onPress={handleToggleProjectReorderMode}
      style={[
        styles.projectReorderIconButton,
        { backgroundColor: themeColorsMemo.filterBg, borderColor: themeColorsMemo.border },
      ]}
      testID="project-task-reorder-toggle"
    >
      <MoveVertical size={20} color={themeColorsMemo.secondaryText} />
    </TouchableOpacity>
  ) : null;

  return (
    <View
      style={[styles.container, { backgroundColor: themeColorsMemo.bg }]}
      onLayout={handleTaskListRootLayout}
    >
      <TaskListHeader
        activeFilterChips={activeFilterChips}
        count={orderedTasks.length}
        filterActiveCount={totalFilterActiveCount}
        hasActiveFilters={hasAnyActiveFilters}
        headerAccessory={headerAccessory}
        onClearFilters={clearAllFilters}
        onOpenFilters={() => setFiltersVisible(true)}
        onOpenSort={() => setSortModalVisible(true)}
        showHeader={showHeader}
        showSort={showSort}
        sortByLabel={t(`sort.${sortBy}`)}
        t={t}
        themeColors={themeColorsMemo}
        title={title}
      />

      <TaskListFiltersSheet
        energyLevelOptions={ENERGY_LEVEL_OPTIONS}
        extraContent={filterSheetAccessory}
        hasFilters={hasAnyActiveFilters}
        locationQuery={locationFilter}
        onChangeLocationQuery={setLocationFilter}
        onChangeSearchQuery={setTaskSearchQuery}
        onClearFilters={clearAllFilters}
        onClose={() => setFiltersVisible(false)}
        prioritiesEnabled={prioritiesEnabled}
        priorityOptions={PRIORITY_OPTIONS}
        searchQuery={taskSearchQuery}
        selectedEnergyLevels={selectedEnergyLevels}
        selectedPriorities={selectedPriorities}
        selectedTimeEstimates={selectedTimeEstimates}
        selectedTokens={selectedTokens}
        showLocationFilter={showLocationFilter}
        showTimeEstimateFilters={showTimeEstimateFilters}
        t={t}
        themeColors={themeColorsMemo}
        toggleEnergyLevel={toggleEnergyLevelFilter}
        togglePriority={togglePriorityFilter}
        toggleTimeEstimate={toggleTimeEstimate}
        toggleToken={toggleTokenFilter}
        tokenOptions={tokenFilterOptions}
        visible={filtersVisible}
      />

      {enableBulkActions && selectionMode && !projectReorderMode && (
        <TaskListBulkBar
          bulkActionLabel={bulkActionLabel}
          bulkActionLoading={bulkActionLoading}
          handleBatchDelete={handleBatchDelete}
          handleBatchMove={handleBatchMove}
          hasSelection={hasSelection}
          onExitSelectionMode={exitSelectionMode}
          onOpenOrganize={canBulkOrganizeInbox ? () => setBulkOrganizeVisible(true) : undefined}
          onToggleRangeSelectMode={toggleRangeSelectMode}
          onOpenTagModal={() => setTagModalVisible(true)}
          rangeSelectMode={rangeSelectMode}
          selectedCount={selectedIdsArray.length}
          t={t}
          themeColors={themeColorsMemo}
        />
      )}

      {canUseProjectReorder && hasProjectReorderItems && projectReorderMode && (
        <View style={[styles.projectReorderModeBar, { backgroundColor: themeColorsMemo.cardBg, borderBottomColor: themeColorsMemo.border }]}>
          <Text style={[styles.projectReorderTitle, { color: themeColorsMemo.text }]}>
            {projectSections.length > 1
              ? tFallback(t, 'projects.projectOrder', 'Project order')
              : tFallback(t, 'projects.taskOrder', 'Task order')}
          </Text>
          <TouchableOpacity
            accessibilityLabel={projectReorderMode
              ? t('common.done')
              : tFallback(t, 'projects.reorderTasks', 'Order tasks')}
            accessibilityRole="button"
            onPress={handleToggleProjectReorderMode}
            style={[
              styles.projectReorderModeButton,
              {
                backgroundColor: themeColorsMemo.tint,
                borderColor: themeColorsMemo.tint,
              },
            ]}
            testID="project-task-reorder-toggle"
          >
            <Text style={[
              styles.projectReorderModeButtonText,
              { color: themeColorsMemo.onTint },
            ]}>
              {t('common.done')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {quickAddAvailable && (
        <TaskListQuickAdd
          aiEnabled={aiEnabled}
          applyTypeaheadOption={applyTypeaheadOption}
          copilotApplied={copilotApplied}
          copilotContext={copilotContext}
          copilotSuggestion={copilotSuggestion}
          copilotTags={copilotTags}
          copilotThinking={copilotThinking}
          enableCopilot={enableCopilot}
          handleAddTask={handleAddTask}
          newTaskTitle={newTaskTitle}
          onApplyCopilot={() => {
            setCopilotContext(copilotSuggestion?.context);
            setCopilotTags(copilotSuggestion?.tags ?? []);
            setCopilotApplied(true);
          }}
          onChangeText={(text) => {
            setNewTaskTitle(text);
            setInputSelection({ start: text.length, end: text.length });
            setCopilotApplied(false);
            setCopilotContext(undefined);
            setCopilotTags([]);
          }}
          onInputFocus={onQuickAddInputFocus}
          onSelectionChange={(selection) => {
            setInputSelection(selection);
            setTypeaheadOpen(Boolean(getTrigger(newTaskTitle, selection.start ?? newTaskTitle.length)));
          }}
          projectId={projectId}
          setTypeaheadIndex={setTypeaheadIndex}
          showQuickAddHelp={showQuickAddHelp}
          t={t}
          themeColors={themeColorsMemo}
          title={title}
          trailingAccessory={projectReorderToggle}
          trigger={trigger}
          typeaheadIndex={typeaheadIndex}
          typeaheadOpen={typeaheadOpen}
          typeaheadOptions={typeaheadOptions}
        />
      )}

      {projectReorderMode && canUseProjectReorder ? (
        <View style={styles.staticList}>
          {projectReorderGroups.map(renderProjectReorderGroup)}
        </View>
      ) : staticList ? (
        <View style={styles.staticList} onLayout={handleStaticListLayout}>
          {listItems.length === 0 ? (
            <ListEmptyState
              message={filteredEmptyMessage}
              hint={filteredEmptyHint}
              backgroundColor={themeColorsMemo.cardBg}
              borderColor={themeColorsMemo.border}
              textColor={themeColorsMemo.text}
              mutedTextColor={themeColorsMemo.secondaryText}
              actionLabel={filteredEmptyActionLabel}
              onAction={filteredEmptyAction}
            />
          ) : staticListVirtualWindow ? (
            <>
              {staticListVirtualWindow.topSpacerHeight > 0 ? (
                <View style={{ height: staticListVirtualWindow.topSpacerHeight }} />
              ) : null}
              {staticListVirtualWindow.items.map((item) => (
                <View key={item.type === 'section' ? `section-${item.id}` : item.task.id} style={styles.staticItem}>
                  {renderListItem({ item })}
                </View>
              ))}
              {staticListVirtualWindow.bottomSpacerHeight > 0 ? (
                <View style={{ height: staticListVirtualWindow.bottomSpacerHeight }} />
              ) : null}
            </>
          ) : (
            listItems.map((item) => (
              <View key={item.type === 'section' ? `section-${item.id}` : item.task.id} style={styles.staticItem}>
                {renderListItem({ item })}
              </View>
            ))
          )}
        </View>
      ) : (
        <FlatList
          data={listItems}
          renderItem={renderListItem}
          keyExtractor={(item) => (item.type === 'section' ? `section-${item.id}` : item.task.id)}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          getItemLayout={getItemLayout}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={listItems.length >= REMOVE_CLIPPED_SUBVIEWS_MIN_ITEMS}
          refreshControl={
            <RefreshControl
              refreshing={pullSync.refreshing}
              onRefresh={pullSync.onRefresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
          ListEmptyComponent={
            <ListEmptyState
              message={filteredEmptyMessage}
              hint={filteredEmptyHint}
              backgroundColor={themeColorsMemo.cardBg}
              borderColor={themeColorsMemo.border}
              textColor={themeColorsMemo.text}
              mutedTextColor={themeColorsMemo.secondaryText}
              actionLabel={filteredEmptyActionLabel}
              onAction={filteredEmptyAction}
            />
          }
        />
      )}

      <PullSyncIndicator state={pullSync.indicatorState} />

      <TaskListTagModal
        onChangeTag={setTagInput}
        onClose={() => {
          setTagModalVisible(false);
          setTagInput('');
        }}
        onSave={handleBatchAddTag}
        t={t}
        tagInput={tagInput}
        themeColors={themeColorsMemo}
        visible={tagModalVisible}
      />

      <TaskListBulkOrganizeModal
        areas={areas}
        isApplying={bulkActionLoading}
        onApply={async (input) => {
          await handleBatchOrganize(input);
          setBulkOrganizeVisible(false);
        }}
        onClose={() => setBulkOrganizeVisible(false)}
        projects={projects}
        selectedCount={selectedIdsArray.length}
        t={t}
        themeColors={themeColorsMemo}
        visible={bulkOrganizeVisible}
      />

      <TaskListSortModal
        onClose={() => setSortModalVisible(false)}
        onSelect={(option) => {
          updateSettings({ taskSortBy: option });
          setSortModalVisible(false);
        }}
        sortBy={sortBy}
        sortOptions={sortOptions}
        t={t}
        themeColors={themeColorsMemo}
        visible={sortModalVisible}
      />

      <ErrorBoundary>
        <TaskEditModal
          visible={isModalVisible}
          task={editingTask}
          onClose={() => setIsModalVisible(false)}
          onSave={onSaveTask}
          defaultTab={defaultEditTab}
          onProjectNavigate={projectId ? undefined : openProjectScreen}
          onContextNavigate={openContextsScreen}
          onTagNavigate={openContextsScreen}
          onFocusMode={(taskId) => {
            setIsModalVisible(false);
            router.push(`/check-focus?id=${taskId}`);
          }}
        />
      </ErrorBoundary>
    </View>
  );
}

export const TaskList = React.memo(TaskListComponent);
