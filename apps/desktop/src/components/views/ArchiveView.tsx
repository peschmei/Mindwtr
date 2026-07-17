import { memo, useMemo, useState, useEffect, useCallback, useLayoutEffect, useRef, type UIEvent } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { shallow, useTaskStore, sortTasksBy, safeFormatDate, tFallback } from '@mindwtr/core';
import type { Task, TaskSortBy, Project } from '@mindwtr/core';

import { CheckCircle2, Undo2, Trash2 } from 'lucide-react';
import { useLanguage } from '../../contexts/language-context';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import { checkBudget } from '../../config/performanceBudgets';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { PromptModal } from '../PromptModal';
import { cn } from '../../lib/utils';
import { toDateTimeLocalValue } from '../Task/task-item-helpers';
import {
    LIST_VIRTUALIZATION_THRESHOLD,
    LIST_VIRTUAL_ROW_ESTIMATE,
    LIST_VIRTUAL_OVERSCAN,
    useVirtualList,
} from './list/useVirtualList';
import { BulkSelectionToolbar } from './list/BulkSelectionToolbar';

type ArchiveTaskRowInnerProps = {
    task: Task;
    onRestore: (taskId: string) => void;
    onDelete: (taskId: string) => void;
    onEditCompletedAt: (taskId: string) => void;
    onToggleSelect: (taskId: string) => void;
    selectionMode: boolean;
    isSelected: boolean;
    t: (key: string) => string;
};

const ArchiveTaskRowInner = memo(function ArchiveTaskRowInner({
    task,
    onRestore,
    onDelete,
    onEditCompletedAt,
    onToggleSelect,
    selectionMode,
    isSelected,
    t,
}: ArchiveTaskRowInnerProps) {
    const handleRestore = useCallback(() => onRestore(task.id), [onRestore, task.id]);
    const handleDelete = useCallback(() => onDelete(task.id), [onDelete, task.id]);
    const handleEditCompletedAt = useCallback(() => onEditCompletedAt(task.id), [onEditCompletedAt, task.id]);
    const handleToggleSelect = useCallback(() => onToggleSelect(task.id), [onToggleSelect, task.id]);
    const completionTimestamp = task.completedAt || task.updatedAt;
    const completedLabel = t('list.done') || 'Completed';
    const editCompletedAtLabel = tFallback(t, 'task.editCompletedAt', 'Edit completion time');
    const completedText = `${completedLabel}: ${completionTimestamp ? safeFormatDate(completionTimestamp, 'Pp', completionTimestamp) : 'Unknown'}`;
    const otherMetadataParts = [
        task.dueDate ? `${t('taskEdit.dueDateLabel')}: ${safeFormatDate(task.dueDate, 'P')}` : '',
        ...(task.contexts ?? []),
    ].filter(Boolean);

    return (
        <div className="rounded-lg px-3 py-3 flex items-center justify-between group hover:bg-muted/50 transition-colors">
            <div className="flex min-w-0 items-center gap-3">
                {selectionMode && (
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={handleToggleSelect}
                        aria-label={`${tFallback(t, 'bulk.select', 'Select')} ${task.title}`}
                        className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
                    />
                )}
                <div>
                    <h3 className="font-medium text-foreground line-through opacity-70">{task.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        <button
                            type="button"
                            onClick={handleEditCompletedAt}
                            title={editCompletedAtLabel}
                            aria-label={editCompletedAtLabel}
                            className="hover:text-foreground hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
                        >
                            {completedText}
                        </button>
                        {otherMetadataParts.length > 0 ? ` • ${otherMetadataParts.join(' • ')}` : ''}
                    </p>
                </div>
            </div>
            {!selectionMode && <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                    onClick={handleRestore}
                    className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"
                    title={t('archived.restoreToInbox')}
                >
                    <Undo2 className="w-4 h-4" />
                </button>
                <button
                    onClick={handleDelete}
                    className="p-2 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                    title={t('common.delete')}
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>}
        </div>
    );
});

type VirtualArchiveTaskRowProps = ArchiveTaskRowInnerProps & {
    top: number;
    onMeasure: (id: string, height: number) => void;
};

const VirtualArchiveTaskRow = memo(function VirtualArchiveTaskRow({
    task,
    top,
    onRestore,
    onDelete,
    onEditCompletedAt,
    onToggleSelect,
    selectionMode,
    isSelected,
    onMeasure,
    t,
}: VirtualArchiveTaskRowProps) {
    const rowRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
        const node = rowRef.current;
        if (!node) return;
        const nextHeight = Math.ceil(node.getBoundingClientRect().height);
        onMeasure(task.id, nextHeight);
    }, [task.id, task.updatedAt, onMeasure]);

    return (
        <div ref={rowRef} style={{ position: 'absolute', top, left: 0, right: 0 }}>
            <div className="border-b border-border/30">
                <ArchiveTaskRowInner
                    task={task}
                    onRestore={onRestore}
                    onDelete={onDelete}
                    onEditCompletedAt={onEditCompletedAt}
                    onToggleSelect={onToggleSelect}
                    selectionMode={selectionMode}
                    isSelected={isSelected}
                    t={t}
                />
            </div>
        </div>
    );
});

type ArchiveProjectRowProps = {
    project: Project;
    areaName?: string;
    onRestore: (projectId: string) => void;
    onDelete: (project: Project) => void;
    t: (key: string) => string;
};

const ArchiveProjectRow = memo(function ArchiveProjectRow({
    project,
    areaName,
    onRestore,
    onDelete,
    t,
}: ArchiveProjectRowProps) {
    const handleRestore = useCallback(() => onRestore(project.id), [onRestore, project.id]);
    const handleDelete = useCallback(() => onDelete(project), [onDelete, project]);
    const archivedText = `${t('list.done') || 'Completed'}: ${project.updatedAt ? safeFormatDate(project.updatedAt, 'Pp', project.updatedAt) : 'Unknown'}`;

    return (
        <div className="rounded-lg px-3 py-3 flex items-center justify-between group hover:bg-muted/50 transition-colors">
            <div className="flex min-w-0 items-center gap-3">
                <div>
                    <h3 className="font-medium text-foreground line-through opacity-70">{project.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                        {archivedText}
                        {areaName ? ` • ${areaName}` : ''}
                    </p>
                </div>
            </div>
            <div className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                    onClick={handleRestore}
                    className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"
                    title={tFallback(t, 'archived.restoreProject', 'Restore project')}
                >
                    <Undo2 className="w-4 h-4" />
                </button>
                <button
                    onClick={handleDelete}
                    className="p-2 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                    title={t('common.delete')}
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
});

type ArchiveSegment = 'tasks' | 'projects';

export function ArchiveView() {
    const perf = usePerformanceMonitor('ArchiveView');
    const {
        _allTasks,
        projects,
        areas,
        updateTask,
        deleteTask,
        updateProject,
        deleteProject,
        batchMoveTasks,
        batchDeleteTasks,
        settings,
    } = useTaskStore(
        (state) => ({
            _allTasks: state._allTasks,
            projects: state.projects,
            areas: state.areas,
            updateTask: state.updateTask,
            deleteTask: state.deleteTask,
            updateProject: state.updateProject,
            deleteProject: state.deleteProject,
            batchMoveTasks: state.batchMoveTasks,
            batchDeleteTasks: state.batchDeleteTasks,
            settings: state.settings,
        }),
        shallow
    );
    const { t } = useLanguage();
    const { requestConfirmation, confirmModal } = useConfirmDialog();
    const [segment, setSegment] = useState<ArchiveSegment>('tasks');
    const [searchQuery, setSearchQuery] = useState('');
    const [completedAtTaskId, setCompletedAtTaskId] = useState<string | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const listScrollRef = useRef<HTMLDivElement>(null);
    const rowHeightsRef = useRef<Map<string, number>>(new Map());
    const [measureVersion, setMeasureVersion] = useState(0);
    const [listScrollTop, setListScrollTop] = useState(0);
    const [listHeight, setListHeight] = useState(0);
    const sortBy = (settings?.taskSortBy ?? 'default') as TaskSortBy;

    useEffect(() => {
        if (!perf.enabled) return;
        const timer = window.setTimeout(() => {
            checkBudget('ArchiveView', perf.metrics, 'simple');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [perf.enabled]);

    useEffect(() => {
        const element = listScrollRef.current;
        if (!element) return;
        const updateHeight = () => {
            const nextHeight = element.clientHeight;
            setListHeight((current) => (current === nextHeight ? current : nextHeight));
        };
        updateHeight();
        window.addEventListener('resize', updateHeight);
        const resizeObserver = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => updateHeight())
            : null;
        resizeObserver?.observe(element);
        return () => {
            window.removeEventListener('resize', updateHeight);
            resizeObserver?.disconnect();
        };
    }, []);

    const archivedTasks = useMemo(() => {
        const filtered = _allTasks.filter((t) => t.status === 'archived' && !t.deletedAt);

        // Use standard sort
        const sorted = sortTasksBy(filtered, sortBy);

        if (!searchQuery) return sorted;

        return sorted.filter(t =>
            t.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [_allTasks, searchQuery, sortBy]);

    const areaNameById = useMemo(
        () => new Map(areas.filter((area) => !area.deletedAt).map((area) => [area.id, area.name])),
        [areas]
    );

    const archivedProjects = useMemo(() => {
        const filtered = projects
            .filter((project) => project.status === 'archived')
            .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        if (!searchQuery) return filtered;
        const query = searchQuery.toLowerCase();
        return filtered.filter((project) => project.title.toLowerCase().includes(query));
    }, [projects, searchQuery]);
    const selectedIdsArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
    const allVisibleSelected = archivedTasks.length > 0
        && selectedIds.size === archivedTasks.length;

    useEffect(() => {
        const visibleIds = new Set(archivedTasks.map((task) => task.id));
        setSelectedIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => visibleIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [archivedTasks]);
    const shouldVirtualize = archivedTasks.length > LIST_VIRTUALIZATION_THRESHOLD;
    const handleVirtualRowMeasure = useCallback((id: string, height: number) => {
        if (rowHeightsRef.current.get(id) === height) return;
        rowHeightsRef.current.set(id, height);
        setMeasureVersion((current) => current + 1);
    }, []);
    const handleVirtualScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
        setListScrollTop(event.currentTarget.scrollTop);
    }, []);
    const { rowOffsets, totalHeight, startIndex, visibleTasks } = useVirtualList({
        tasks: archivedTasks,
        shouldVirtualize,
        rowHeightsRef,
        measureVersion,
        listScrollTop,
        listHeight,
        rowEstimate: LIST_VIRTUAL_ROW_ESTIMATE,
        overscan: LIST_VIRTUAL_OVERSCAN,
    });

    const handleRestore = useCallback((taskId: string) => {
        updateTask(taskId, { status: 'inbox' }); // Restore to inbox? Or previous status? Inbox is safest.
    }, [updateTask]);

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false);
        setSelectedIds(new Set());
    }, []);

    const toggleSelectionMode = useCallback(() => {
        if (selectionMode) {
            exitSelectionMode();
            return;
        }
        setSelectionMode(true);
    }, [exitSelectionMode, selectionMode]);

    const toggleTaskSelection = useCallback((taskId: string) => {
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    }, []);

    const selectAllVisible = useCallback(() => {
        setSelectedIds(new Set(archivedTasks.map((task) => task.id)));
    }, [archivedTasks]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
    }, []);

    const handleBulkRestore = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await batchMoveTasks(selectedIdsArray, 'inbox');
        exitSelectionMode();
    }, [batchMoveTasks, exitSelectionMode, selectedIdsArray]);

    const handleBulkMoveToDone = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        await batchMoveTasks(selectedIdsArray, 'done');
        exitSelectionMode();
    }, [batchMoveTasks, exitSelectionMode, selectedIdsArray]);

    const handleBulkDelete = useCallback(async () => {
        if (selectedIdsArray.length === 0) return;
        const confirmed = await requestConfirmation({
            title: t('bulk.confirmDeleteTitle'),
            description: t('bulk.confirmDeleteBody'),
            confirmLabel: t('common.delete'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        await batchDeleteTasks(selectedIdsArray);
        exitSelectionMode();
    }, [batchDeleteTasks, exitSelectionMode, requestConfirmation, selectedIdsArray, t]);

    const handleEditCompletedAt = useCallback((taskId: string) => {
        setCompletedAtTaskId(taskId);
    }, []);

    const applyCompletedAt = useCallback((value: string) => {
        const taskId = completedAtTaskId;
        setCompletedAtTaskId(null);
        if (!taskId) return;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return;
        updateTask(taskId, { completedAt: parsed.toISOString() });
    }, [completedAtTaskId, updateTask]);

    const handleDelete = useCallback(async (taskId: string) => {
        const task = _allTasks.find((item) => item.id === taskId);
        if (!task) return;
        const confirmed = await requestConfirmation({
            title: task.title,
            description: t('task.deleteConfirmBody'),
            confirmLabel: t('common.delete'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        await deleteTask(taskId);
    }, [_allTasks, deleteTask, requestConfirmation, t]);

    const handleRestoreProject = useCallback((projectId: string) => {
        void updateProject(projectId, { status: 'active' });
    }, [updateProject]);

    const handleDeleteProject = useCallback(async (project: Project) => {
        const confirmed = await requestConfirmation({
            title: project.title,
            description: t('projects.deleteConfirm'),
            confirmLabel: t('common.delete'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        await deleteProject(project.id);
    }, [deleteProject, requestConfirmation, t]);

    const handleSegmentChange = useCallback((next: ArchiveSegment) => {
        setSegment((current) => {
            if (current === next) return current;
            exitSelectionMode();
            return next;
        });
    }, [exitSelectionMode]);

    return (
        <ErrorBoundary>
            <div className={shouldVirtualize ? "flex h-full min-h-0 flex-col gap-6" : "flex flex-col gap-6"}>
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <h2 className="text-3xl font-bold tracking-tight">{t('archived.title')}</h2>
                    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                        <button
                            type="button"
                            onClick={() => handleSegmentChange('tasks')}
                            className={cn(
                                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                                segment === 'tasks'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {t('common.tasks')}
                        </button>
                        <button
                            type="button"
                            onClick={() => handleSegmentChange('projects')}
                            className={cn(
                                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                                segment === 'projects'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                        >
                            {t('projects.title')}
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                        {segment === 'tasks'
                            ? `${archivedTasks.length} ${t('common.tasks')}`
                            : `${archivedProjects.length} ${t('projects.title')}`}
                    </div>
                    {segment === 'tasks' && archivedTasks.length > 0 && (
                        <button
                            type="button"
                            onClick={toggleSelectionMode}
                            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                        >
                            {selectionMode ? t('common.done') : t('bulk.select')}
                        </button>
                    )}
                </div>
            </header>

            {segment === 'tasks' && selectionMode && (
                <div className="space-y-2">
                    <BulkSelectionToolbar
                        selectionCount={selectedIds.size}
                        totalCount={archivedTasks.length}
                        allSelected={allVisibleSelected}
                        onSelectAll={selectAllVisible}
                        onClearSelection={clearSelection}
                        t={t}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { void handleBulkMoveToDone(); }}
                            disabled={selectedIds.size === 0}
                            aria-label={`${t('bulk.moveTo')} ${t('status.done')}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t('status.done')}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleBulkRestore(); }}
                            disabled={selectedIds.size === 0}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                            {t('trash.restoreToInbox')}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleBulkDelete(); }}
                            disabled={selectedIds.size === 0}
                            className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('common.delete')}
                        </button>
                    </div>
                </div>
            )}

            <div className="relative">
                <input
                    type="text"
                    placeholder={segment === 'projects'
                        ? tFallback(t, 'archived.searchProjectsPlaceholder', 'Search archived projects...')
                        : t('archived.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg py-2 pl-4 pr-4 shadow-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                />
            </div>

            {segment === 'projects' ? (
                <div className={shouldVirtualize ? "flex-1 min-h-0 overflow-y-auto" : undefined}>
                    {archivedProjects.length === 0 ? (
                        <div className="px-1 py-8 text-left text-sm text-muted-foreground">
                            <p>{tFallback(t, 'archived.emptyProjects', 'No archived projects')}</p>
                            <p className="text-xs mt-2">{tFallback(t, 'archived.emptyProjectsHint', 'Projects you archive will appear here')}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {archivedProjects.map((project) => (
                                <ArchiveProjectRow
                                    key={project.id}
                                    project={project}
                                    areaName={project.areaId ? areaNameById.get(project.areaId) : undefined}
                                    onRestore={handleRestoreProject}
                                    onDelete={handleDeleteProject}
                                    t={t}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
            <div
                ref={listScrollRef}
                onScroll={handleVirtualScroll}
                className={shouldVirtualize ? "flex-1 min-h-0 overflow-y-auto" : undefined}
            >
                {archivedTasks.length === 0 ? (
                    <div className="px-1 py-8 text-left text-sm text-muted-foreground">
                        <p>{t('archived.noTasksFound')}</p>
                        <p className="text-xs mt-2">{t('archived.emptyHint')}</p>
                    </div>
                ) : shouldVirtualize ? (
                    <div style={{ height: totalHeight, position: 'relative' }}>
                        {visibleTasks.map((task, visibleIndex) => {
                            const taskIndex = startIndex + visibleIndex;
                            return (
                                <VirtualArchiveTaskRow
                                    key={task.id}
                                    task={task}
                                    top={rowOffsets[taskIndex] ?? 0}
                                    onMeasure={handleVirtualRowMeasure}
                                    onRestore={handleRestore}
                                    onDelete={handleDelete}
                                    onEditCompletedAt={handleEditCompletedAt}
                                    onToggleSelect={toggleTaskSelection}
                                    selectionMode={selectionMode}
                                    isSelected={selectedIds.has(task.id)}
                                    t={t}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <div className="divide-y divide-border/30">
                        {archivedTasks.map(task => (
                            <ArchiveTaskRowInner
                                key={task.id}
                                task={task}
                                onRestore={handleRestore}
                                onDelete={handleDelete}
                                onEditCompletedAt={handleEditCompletedAt}
                                onToggleSelect={toggleTaskSelection}
                                selectionMode={selectionMode}
                                isSelected={selectedIds.has(task.id)}
                                t={t}
                            />
                        ))}
                    </div>
                )}
            </div>
            )}
            </div>
            {confirmModal}
            {completedAtTaskId && (
                <PromptModal
                    isOpen
                    title={tFallback(t, 'task.completedAtPromptTitle', 'Completion time')}
                    defaultValue={toDateTimeLocalValue(
                        (() => {
                            const task = _allTasks.find((item) => item.id === completedAtTaskId);
                            return task ? (task.completedAt || task.updatedAt) : undefined;
                        })()
                    )}
                    inputType="datetime-local"
                    confirmLabel={t('common.save')}
                    cancelLabel={t('common.cancel')}
                    onCancel={() => setCompletedAtTaskId(null)}
                    onConfirm={applyCompletedAt}
                />
            )}
        </ErrorBoundary>
    );
}
