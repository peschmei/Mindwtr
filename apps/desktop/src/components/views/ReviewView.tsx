import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { ReviewHeader, ReviewListControls } from './review/ReviewHeader';
import { ReviewFiltersBar } from './review/ReviewFiltersBar';
import { ReviewBulkActions } from './review/ReviewBulkActions';
import { ReviewTaskList } from './review/ReviewTaskList';
import { BulkSelectionToolbar } from './list/BulkSelectionToolbar';
import { TaskBulkOrganizeModal } from './list/TaskBulkOrganizeModal';
import { DailyReviewGuideModal } from './review/DailyReviewModal';
import { WeeklyReviewGuideModal } from './review/WeeklyReviewModal';

import { buildBulkOrganizeTaskUpdates, shallow, sortTasksBy, updateRangeSelection, useTaskStore, type BulkOrganizeTaskUpdateInput, type Project, type RangeSelectionOptions, type Task, type TaskStatus, type TaskSortBy, isTaskInActiveProject } from '@mindwtr/core';

import { PromptModal } from '../PromptModal';
import { useLanguage } from '../../contexts/language-context';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import { checkBudget } from '../../config/performanceBudgets';
import { resolveAreaFilter, taskMatchesAreaFilter } from '@mindwtr/core';
import { useUiStore } from '../../store/ui-store';
import { usePersistedViewState } from '../../hooks/usePersistedViewState';
import { tFallback } from '@mindwtr/core';
import { cn } from '../../lib/utils';
import {
    groupTasksByArea,
    groupTasksByContext,
    groupTasksByProject,
    groupTasksByStatus,
    groupTasksByTag,
    type ContextsGroupBy,
    type TaskGroup,
} from './list/next-grouping';

const STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done'];
const REVIEW_VIEW_STATE_STORAGE_KEY = 'mindwtr:view:review:v1';
const REVIEW_GROUP_BY_VALUES: ContextsGroupBy[] = ['none', 'status', 'context', 'area', 'project', 'tag'];

type ReviewPersistedViewState = {
    filterStatus: TaskStatus | 'all';
    groupBy: ContextsGroupBy;
};

const DEFAULT_REVIEW_VIEW_STATE: ReviewPersistedViewState = {
    filterStatus: 'all',
    groupBy: 'none',
};

function sanitizeReviewViewState(value: unknown, fallback: ReviewPersistedViewState): ReviewPersistedViewState {
    const parsed = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Partial<ReviewPersistedViewState>
        : {};
    return {
        filterStatus: parsed.filterStatus === 'all' || STATUS_OPTIONS.includes(parsed.filterStatus as TaskStatus)
            ? parsed.filterStatus as TaskStatus | 'all'
            : fallback.filterStatus,
        groupBy: REVIEW_GROUP_BY_VALUES.includes(parsed.groupBy as ContextsGroupBy)
            ? parsed.groupBy as ContextsGroupBy
            : fallback.groupBy,
    };
}

export function ReviewView() {
    const perf = usePerformanceMonitor('ReviewView');
    const { tasks, projects, areas, settings, updateSettings, batchMoveTasks, batchDeleteTasks, batchUpdateTasks, highlightTaskId } = useTaskStore(
        (state) => ({
            tasks: state.tasks,
            projects: state.projects,
            areas: state.areas,
            settings: state.settings,
            updateSettings: state.updateSettings,
            batchMoveTasks: state.batchMoveTasks,
            batchDeleteTasks: state.batchDeleteTasks,
            batchUpdateTasks: state.batchUpdateTasks,
            highlightTaskId: state.highlightTaskId,
        }),
        shallow
    );
    const { t } = useLanguage();
    const [persistedViewState, setPersistedViewState] = usePersistedViewState(
        REVIEW_VIEW_STATE_STORAGE_KEY,
        DEFAULT_REVIEW_VIEW_STATE,
        sanitizeReviewViewState
    );
    const filterStatus = persistedViewState.filterStatus;
    const setFilterStatus = useCallback((value: TaskStatus | 'all') => {
        setPersistedViewState((current) => ({
            ...current,
            filterStatus: value,
        }));
    }, [setPersistedViewState]);
    const groupBy = persistedViewState.groupBy;
    const setGroupBy = useCallback((value: ContextsGroupBy) => {
        setPersistedViewState((current) => ({
            ...current,
            groupBy: value,
        }));
    }, [setPersistedViewState]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectionMode, setSelectionMode] = useState(false);
    const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
    const [tagPromptOpen, setTagPromptOpen] = useState(false);
    const [tagPromptIds, setTagPromptIds] = useState<string[]>([]);
    const [showGuide, setShowGuide] = useState(false);
    const [showDailyGuide, setShowDailyGuide] = useState(false);
    const [moveToStatus, setMoveToStatus] = useState<TaskStatus | ''>('');
    const [bulkOrganizeOpen, setBulkOrganizeOpen] = useState(false);
    const [isBulkOrganizing, setIsBulkOrganizing] = useState(false);
    const multiSelectAnchorIdRef = useRef<string | null>(null);
    const showListDetails = useUiStore((state) => state.listOptions.showDetails);
    const setListOptions = useUiStore((state) => state.setListOptions);
    const collapseAllTaskDetails = useUiStore((state) => state.collapseAllTaskDetails);

    const sortBy = (settings?.taskSortBy ?? 'default') as TaskSortBy;
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const statusOptions = STATUS_OPTIONS;
    const projectMapById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
    const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
    const resolvedAreaFilter = useMemo(
        () => resolveAreaFilter(settings?.filters?.areaId, areas),
        [settings?.filters?.areaId, areas],
    );

    useEffect(() => {
        if (!perf.enabled) return;
        const timer = window.setTimeout(() => {
            checkBudget('ReviewView', perf.metrics, 'complex');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [perf.enabled]);

    const { tasksById, statusCounts, filteredTasks } = useMemo(() => {
        perf.trackUseMemo();
        return perf.measure('reviewData', () => {
            const nextProjectMap: Record<string, Project> = {};
            const nextTasksById: Record<string, Task> = {};
            const nextStatusCounts: Record<string, number> = { all: 0 };
            statusOptions.forEach((status) => {
                nextStatusCounts[status] = 0;
            });

            projects.forEach((project) => {
                nextProjectMap[project.id] = project;
            });

            const nextVisibleTasks: Task[] = [];
            const nextOpenTasks: Task[] = [];
            tasks.forEach((task) => {
                nextTasksById[task.id] = task;
                if (task.deletedAt) return;
                if (task.status === 'reference') return;
                if (!isTaskInActiveProject(task, nextProjectMap)) return;
                if (!taskMatchesAreaFilter(task, resolvedAreaFilter, projectMapById, areaById)) return;
                nextVisibleTasks.push(task);
                if (task.status !== 'done') {
                    nextOpenTasks.push(task);
                    nextStatusCounts.all += 1;
                }
                if (nextStatusCounts[task.status] !== undefined) {
                    nextStatusCounts[task.status] += 1;
                }
            });

            const list = filterStatus === 'all'
                ? nextOpenTasks
                : nextVisibleTasks.filter((task) => task.status === filterStatus);
            const sortedTasks = sortTasksBy(list, sortBy);
            const searchFilteredTasks = normalizedSearchQuery
                ? sortedTasks.filter((task) => task.title.toLowerCase().includes(normalizedSearchQuery))
                : sortedTasks;

            return {
                tasksById: nextTasksById,
                statusCounts: nextStatusCounts,
                filteredTasks: searchFilteredTasks,
            };
        });
    }, [filterStatus, normalizedSearchQuery, projects, sortBy, tasks, resolvedAreaFilter, projectMapById, areaById]);

    const selectedIdsArray = useMemo(() => Array.from(multiSelectedIds), [multiSelectedIds]);
    const filteredTaskIds = useMemo(() => filteredTasks.map((task) => task.id), [filteredTasks]);
    const selectedVisibleCount = useMemo(
        () => filteredTaskIds.filter((id) => multiSelectedIds.has(id)).length,
        [filteredTaskIds, multiSelectedIds],
    );
    const allVisibleTasksSelected = filteredTaskIds.length > 0 && selectedVisibleCount === filteredTaskIds.length;
    const resolveText = useCallback((key: string, fallback: string) => tFallback(t, key, fallback), [t]);
    const groupedTasks = useMemo<TaskGroup[]>(() => {
        if (groupBy === 'none') return [];
        if (groupBy === 'status') {
            return groupTasksByStatus({
                tasks: filteredTasks,
                getStatusLabel: (status) => t(`status.${status}`),
            });
        }
        if (groupBy === 'area') {
            return groupTasksByArea({
                areas,
                tasks: filteredTasks,
                projectMap: projectMapById,
                generalLabel: resolveText('settings.general', 'General'),
            });
        }
        if (groupBy === 'project') {
            return groupTasksByProject({
                tasks: filteredTasks,
                projectMap: projectMapById,
                noProjectLabel: resolveText('taskEdit.noProjectOption', 'No project'),
            });
        }
        if (groupBy === 'tag') {
            return groupTasksByTag({
                tasks: filteredTasks,
                noTagLabel: resolveText('projects.noTags', 'No tags'),
            });
        }
        return groupTasksByContext({
            tasks: filteredTasks,
            noContextLabel: resolveText('contexts.none', 'No context'),
        });
    }, [areas, filteredTasks, groupBy, projectMapById, resolveText, t]);
    const isGrouping = groupBy !== 'none' && filteredTasks.length > 0;

    const bulkStatuses: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done'];

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false);
        setMultiSelectedIds(new Set());
        multiSelectAnchorIdRef.current = null;
    }, []);

    useEffect(() => {
        exitSelectionMode();
    }, [filterStatus, exitSelectionMode]);

    useEffect(() => {
        setMultiSelectedIds((prev) => {
            const visible = new Set(filteredTaskIds);
            const next = new Set(Array.from(prev).filter((id) => visible.has(id)));
            if (next.size === prev.size) return prev;
            return next;
        });
        if (multiSelectAnchorIdRef.current && !filteredTaskIds.includes(multiSelectAnchorIdRef.current)) {
            multiSelectAnchorIdRef.current = null;
        }
    }, [filteredTaskIds]);

    const toggleMultiSelect = useCallback((taskId: string, options: RangeSelectionOptions = {}) => {
        if (!selectionMode) setSelectionMode(true);
        setMultiSelectedIds(prev => {
            const result = updateRangeSelection({
                anchorId: multiSelectAnchorIdRef.current,
                range: options.range,
                selectedIds: prev,
                targetId: taskId,
                visibleIds: filteredTaskIds,
            });
            multiSelectAnchorIdRef.current = result.anchorId;
            return result.selectedIds;
        });
    }, [filteredTaskIds, selectionMode]);

    const selectAllVisibleTasks = useCallback(() => {
        setSelectionMode(true);
        multiSelectAnchorIdRef.current = filteredTaskIds[0] ?? null;
        setMultiSelectedIds(new Set(filteredTaskIds));
    }, [filteredTaskIds]);

    const clearTaskSelection = useCallback(() => {
        multiSelectAnchorIdRef.current = null;
        setMultiSelectedIds(new Set());
    }, []);

    const handleBatchMove = useCallback(async (newStatus: TaskStatus) => {
        if (selectedIdsArray.length === 0) return;
        await batchMoveTasks(selectedIdsArray, newStatus);
        setMoveToStatus('');
        exitSelectionMode();
    }, [batchMoveTasks, selectedIdsArray, exitSelectionMode]);

    const handleBatchDelete = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await batchDeleteTasks(selectedIdsArray);
        exitSelectionMode();
    }, [batchDeleteTasks, selectedIdsArray, exitSelectionMode]);

    const handleApplyTaskBulkOrganize = useCallback(async (input: BulkOrganizeTaskUpdateInput) => {
        if (selectedIdsArray.length === 0 || isBulkOrganizing) return;
        const updates = buildBulkOrganizeTaskUpdates(selectedIdsArray, tasksById, input);
        if (updates.length === 0) return;
        setIsBulkOrganizing(true);
        try {
            await batchUpdateTasks(updates);
            setBulkOrganizeOpen(false);
            exitSelectionMode();
        } finally {
            setIsBulkOrganizing(false);
        }
    }, [batchUpdateTasks, exitSelectionMode, isBulkOrganizing, selectedIdsArray, tasksById]);

    const handleBatchAddTag = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        setTagPromptIds(selectedIdsArray);
        setTagPromptOpen(true);
    }, [batchUpdateTasks, selectedIdsArray, tasksById, t, exitSelectionMode]);

    const handleToggleDetails = useCallback(() => {
        if (showListDetails) {
            collapseAllTaskDetails();
            setListOptions({ showDetails: false });
            return;
        }
        setListOptions({ showDetails: true });
    }, [collapseAllTaskDetails, setListOptions, showListDetails]);

    return (
        <ErrorBoundary>
            <div className="space-y-6">
                <ReviewHeader
                    title={t('review.title')}
                    taskCountLabel={`${filteredTasks.length} ${t('common.tasks')}`}
                    onShowDailyGuide={() => setShowDailyGuide(true)}
                    onShowGuide={() => setShowGuide(true)}
                    labels={{
                        dailyReview: t('dailyReview.title'),
                        weeklyReview: t('review.openGuide'),
                    }}
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <ReviewFiltersBar
                        filterStatus={filterStatus}
                        statusOptions={statusOptions}
                        statusCounts={statusCounts}
                        onSelect={setFilterStatus}
                        t={t}
                    />
                    <ReviewListControls
                        selectionMode={selectionMode}
                        onToggleSelection={() => {
                            if (selectionMode) exitSelectionMode();
                            else setSelectionMode(true);
                        }}
                        sortBy={sortBy}
                        onChangeSortBy={(value) => updateSettings({ taskSortBy: value })}
                        groupBy={groupBy}
                        onChangeGroupBy={setGroupBy}
                        showListDetails={showListDetails}
                        onToggleDetails={handleToggleDetails}
                        t={t}
                        labels={{
                            select: t('bulk.select'),
                            exitSelect: t('bulk.exitSelect'),
                        }}
                    />
                </div>
                <input
                    type="text"
                    data-view-filter-input
                    placeholder={t('common.search')}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full text-sm px-3 py-2 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                />

                {selectionMode && (
                    <div className="space-y-3">
                        <BulkSelectionToolbar
                            selectionCount={selectedIdsArray.length}
                            totalCount={filteredTasks.length}
                            allSelected={allVisibleTasksSelected}
                            onSelectAll={selectAllVisibleTasks}
                            onClearSelection={clearTaskSelection}
                            t={t}
                        />
                        <ReviewBulkActions
                            selectionCount={selectedIdsArray.length}
                            moveToStatus={moveToStatus}
                            onMoveToStatus={handleBatchMove}
                            onChangeMoveToStatus={setMoveToStatus}
                            onBulkOrganize={() => setBulkOrganizeOpen(true)}
                            onAddTag={handleBatchAddTag}
                            onDelete={handleBatchDelete}
                            statusOptions={bulkStatuses}
                            t={t}
                        />
                    </div>
                )}

                {isGrouping ? (
                    <div className="space-y-2">
                        {groupedTasks.map((group) => (
                            <div key={group.id} className="rounded-md border border-border/40 bg-card/30">
                                <div className={cn(
                                    'flex items-center justify-between gap-3 border-b border-border/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide',
                                    group.muted ? 'text-muted-foreground' : 'text-foreground/90',
                                )}>
                                    <span className="inline-flex min-w-0 items-center gap-1.5">
                                        {group.dotColor && (
                                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.dotColor }} aria-hidden="true" />
                                        )}
                                        <span className="truncate">{group.title}</span>
                                    </span>
                                    <span className="shrink-0 text-muted-foreground">{group.tasks.length}</span>
                                </div>
                                <ReviewTaskList
                                    tasks={group.tasks}
                                    showListDetails={showListDetails}
                                    selectionMode={selectionMode}
                                    multiSelectedIds={multiSelectedIds}
                                    highlightTaskId={highlightTaskId}
                                    onToggleSelect={toggleMultiSelect}
                                    t={t}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <ReviewTaskList
                        tasks={filteredTasks}
                        showListDetails={showListDetails}
                        selectionMode={selectionMode}
                        multiSelectedIds={multiSelectedIds}
                        highlightTaskId={highlightTaskId}
                        onToggleSelect={toggleMultiSelect}
                        emptyMessage={normalizedSearchQuery ? t('filters.noMatch') : t('review.noTasks')}
                        t={t}
                    />
                )}

                {showGuide && (
                    <WeeklyReviewGuideModal onClose={() => setShowGuide(false)} />
                )}

                {showDailyGuide && (
                    <DailyReviewGuideModal onClose={() => setShowDailyGuide(false)} />
                )}

                <TaskBulkOrganizeModal
                    isOpen={bulkOrganizeOpen}
                    selectedCount={selectedIdsArray.length}
                    projects={projects}
                    areas={areas}
                    isApplying={isBulkOrganizing}
                    t={t}
                    onCancel={() => setBulkOrganizeOpen(false)}
                    onApply={handleApplyTaskBulkOrganize}
                />

                <PromptModal
                    isOpen={tagPromptOpen}
                    title={t('bulk.addTag')}
                    description={t('bulk.addTag')}
                    placeholder={t('bulk.tagPlaceholder')}
                    defaultValue=""
                    confirmLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setTagPromptOpen(false)}
                    onConfirm={async (value) => {
                        const input = value.trim();
                        if (!input) return;
                        const tag = input.startsWith('#') ? input : `#${input}`;
                        await batchUpdateTasks(tagPromptIds.map((id) => {
                            const task = tasksById[id];
                            const existingTags = task?.tags || [];
                            const nextTags = Array.from(new Set([...existingTags, tag]));
                            return { id, updates: { tags: nextTags } };
                        }));
                        setTagPromptOpen(false);
                        exitSelectionMode();
                    }}
                />
            </div>
        </ErrorBoundary>
    );
}
