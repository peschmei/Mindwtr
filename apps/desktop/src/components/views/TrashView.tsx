import { useMemo, useState, useEffect, useCallback } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';
import { buildTrashTimeline, shallow, useTaskStore, safeFormatDate, tFallback } from '@mindwtr/core';
import type { Project } from '@mindwtr/core';
import { Undo2, Trash2 } from 'lucide-react';
import { useLanguage } from '../../contexts/language-context';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import { checkBudget } from '../../config/performanceBudgets';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { BulkSelectionToolbar } from './list/BulkSelectionToolbar';

export function TrashView() {
    const perf = usePerformanceMonitor('TrashView');
    const {
        _allTasks,
        _allProjects,
        restoreTask,
        restoreTasks,
        restoreProject,
        purgeTask,
        purgeTasks,
        purgeProject,
        purgeDeletedTasks,
        purgeDeletedProjects,
    } = useTaskStore(
        (state) => ({
            _allTasks: state._allTasks,
            _allProjects: state._allProjects,
            restoreTask: state.restoreTask,
            restoreTasks: state.restoreTasks,
            restoreProject: state.restoreProject,
            purgeTask: state.purgeTask,
            purgeTasks: state.purgeTasks,
            purgeProject: state.purgeProject,
            purgeDeletedTasks: state.purgeDeletedTasks,
            purgeDeletedProjects: state.purgeDeletedProjects,
        }),
        shallow
    );
    const { t } = useLanguage();
    const { requestConfirmation, confirmModal } = useConfirmDialog();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!perf.enabled) return;
        const timer = window.setTimeout(() => {
            checkBudget('TrashView', perf.metrics, 'simple');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [perf.enabled]);

    const trashedTasks = useMemo(() => {
        const filtered = _allTasks.filter((task) => task.deletedAt && !task.purgedAt);
        if (!searchQuery) return filtered;
        const query = searchQuery.toLowerCase();
        return filtered.filter((task) => task.title.toLowerCase().includes(query));
    }, [_allTasks, searchQuery]);

    const trashedProjects = useMemo(() => {
        const filtered = _allProjects.filter((project) => project.deletedAt && !project.purgedAt);
        if (!searchQuery) return filtered;
        const query = searchQuery.toLowerCase();
        return filtered.filter((project) => project.title.toLowerCase().includes(query));
    }, [_allProjects, searchQuery]);

    const trashItems = useMemo(
        () => buildTrashTimeline(trashedTasks, trashedProjects),
        [trashedProjects, trashedTasks]
    );

    const trashedItemCount = trashItems.length;
    const selectionCount = selectedTaskIds.size + selectedProjectIds.size;
    const allVisibleSelected = trashedItemCount > 0 && selectionCount === trashedItemCount;

    useEffect(() => {
        const visibleTaskIds = new Set(trashedTasks.map((task) => task.id));
        setSelectedTaskIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => visibleTaskIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
        const visibleProjectIds = new Set(trashedProjects.map((project) => project.id));
        setSelectedProjectIds((previous) => {
            const next = new Set(Array.from(previous).filter((id) => visibleProjectIds.has(id)));
            return next.size === previous.size ? previous : next;
        });
    }, [trashedProjects, trashedTasks]);

    const exitSelectionMode = useCallback(() => {
        setSelectionMode(false);
        setSelectedTaskIds(new Set());
        setSelectedProjectIds(new Set());
    }, []);

    const toggleSelectionMode = useCallback(() => {
        if (selectionMode) {
            exitSelectionMode();
            return;
        }
        setSelectionMode(true);
    }, [exitSelectionMode, selectionMode]);

    const toggleTaskSelection = useCallback((taskId: string) => {
        setSelectedTaskIds((previous) => {
            const next = new Set(previous);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    }, []);

    const toggleProjectSelection = useCallback((projectId: string) => {
        setSelectedProjectIds((previous) => {
            const next = new Set(previous);
            if (next.has(projectId)) next.delete(projectId);
            else next.add(projectId);
            return next;
        });
    }, []);

    const selectAllVisible = useCallback(() => {
        setSelectedTaskIds(new Set(trashedTasks.map((task) => task.id)));
        setSelectedProjectIds(new Set(trashedProjects.map((project) => project.id)));
    }, [trashedProjects, trashedTasks]);

    const clearSelection = useCallback(() => {
        setSelectedTaskIds(new Set());
        setSelectedProjectIds(new Set());
    }, []);

    const handleBulkRestore = useCallback(async () => {
        if (selectionCount === 0) return;
        const taskIds = Array.from(selectedTaskIds);
        const projectIds = Array.from(selectedProjectIds);
        await Promise.all([
            taskIds.length > 0 ? restoreTasks(taskIds) : Promise.resolve(),
            ...projectIds.map((projectId) => restoreProject(projectId)),
        ]);
        exitSelectionMode();
    }, [exitSelectionMode, restoreProject, restoreTasks, selectedProjectIds, selectedTaskIds, selectionCount]);

    const handleBulkPurge = useCallback(async () => {
        if (selectionCount === 0) return;
        const confirmed = await requestConfirmation({
            title: t('trash.deleteConfirm'),
            description: t('trash.deleteConfirmBody'),
            confirmLabel: t('trash.deletePermanently'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        const taskIds = Array.from(selectedTaskIds);
        const projectIds = Array.from(selectedProjectIds);
        await Promise.all([
            taskIds.length > 0 ? purgeTasks(taskIds) : Promise.resolve(),
            ...projectIds.map((projectId) => purgeProject(projectId)),
        ]);
        exitSelectionMode();
    }, [exitSelectionMode, purgeProject, purgeTasks, requestConfirmation, selectedProjectIds, selectedTaskIds, selectionCount, t]);

    const handleClearTrash = async () => {
        if (trashedItemCount === 0) return;
        const confirmed = await requestConfirmation({
            title: t('trash.clearAllConfirm'),
            description: trashedProjects.length > 0
                ? t('trash.clearAllConfirmBodyWithProjects')
                : t('trash.clearAllConfirmBody'),
            confirmLabel: t('trash.clearAll'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        await Promise.all([purgeDeletedTasks(), purgeDeletedProjects()]);
    };

    const handlePurgeTask = async (taskId: string) => {
        const task = _allTasks.find((item) => item.id === taskId);
        if (!task) return;
        const confirmed = await requestConfirmation({
            title: task.title,
            description: t('trash.deleteConfirmBody'),
            confirmLabel: t('common.delete'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        purgeTask(taskId);
    };

    const handlePurgeProject = async (project: Project) => {
        const confirmed = await requestConfirmation({
            title: project.title,
            description: t('trash.deleteConfirmBody'),
            confirmLabel: t('common.delete'),
            cancelLabel: t('common.cancel') || 'Cancel',
        });
        if (!confirmed) return;
        purgeProject(project.id);
    };

    const renderDeletedAt = (deletedAt?: string) => (
        deletedAt ? [t('trash.deletedAt'), safeFormatDate(deletedAt, 'P')].join(': ') : null
    );

    const renderSelectCheckbox = (checked: boolean, onChange: () => void, title: string) => (
        <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            aria-label={`${tFallback(t, 'bulk.select', 'Select')} ${title}`}
            className="h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-primary"
        />
    );

    return (
        <ErrorBoundary>
            <div className="space-y-6">
            <header className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">{t('trash.title')}</h2>
                <div className="flex items-center gap-3">
                    <div className="text-sm text-muted-foreground">
                        {trashedTasks.length} {t('common.tasks')} · {trashedProjects.length} {t('projects.title')}
                    </div>
                    {trashedItemCount > 0 && (
                        <button
                            type="button"
                            onClick={toggleSelectionMode}
                            className="text-xs px-3 py-1 rounded-md border transition-colors bg-card text-foreground border-border hover:bg-muted"
                        >
                            {selectionMode ? t('common.done') : t('bulk.select')}
                        </button>
                    )}
                    <button
                        onClick={handleClearTrash}
                        disabled={trashedItemCount === 0}
                        className="text-xs px-3 py-1 rounded-md border transition-colors bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {t('trash.clearAll')}
                    </button>
                </div>
            </header>

            {selectionMode && (
                <div className="space-y-2">
                    <BulkSelectionToolbar
                        selectionCount={selectionCount}
                        totalCount={trashedItemCount}
                        allSelected={allVisibleSelected}
                        onSelectAll={selectAllVisible}
                        onClearSelection={clearSelection}
                        t={t}
                    />
                    <div className="flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { void handleBulkRestore(); }}
                            disabled={selectionCount === 0}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Undo2 className="h-3.5 w-3.5" />
                            {t('trash.restoreToInbox')}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleBulkPurge(); }}
                            disabled={selectionCount === 0}
                            className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('trash.deletePermanently')}
                        </button>
                    </div>
                </div>
            )}

            <div className="relative">
                <input
                    type="text"
                    placeholder={t('trash.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-card border border-border rounded-lg py-2 pl-4 pr-4 shadow-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                />
            </div>

            <div className="space-y-6">
                {trashedItemCount === 0 ? (
                    <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
                        <p>{t('trash.noTasksFound')}</p>
                        <p className="text-xs mt-2">{t('trash.emptyHintWithProjects')}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-border/30">
                        {trashItems.map((item) => {
                            if (item.type === 'project') {
                                const { project } = item;
                                return (
                                    <div
                                        key={`project-${project.id}`}
                                        className="rounded-lg px-3 py-3 flex items-center justify-between group hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            {selectionMode && renderSelectCheckbox(
                                                selectedProjectIds.has(project.id),
                                                () => toggleProjectSelection(project.id),
                                                project.title,
                                            )}
                                            <div>
                                                <h4 className="font-medium text-foreground line-through opacity-70">{project.title}</h4>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {t('trash.projectType')} · {renderDeletedAt(project.deletedAt)}
                                                </p>
                                            </div>
                                        </div>
                                        {!selectionMode && <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => restoreProject(project.id)}
                                                className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"
                                                title={t('trash.restoreProject')}
                                            >
                                                <Undo2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    void handlePurgeProject(project);
                                                }}
                                                className="p-2 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                                                title={t('trash.deletePermanently')}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>}
                                    </div>
                                );
                            }

                            const { task } = item;
                            return (
                                <div
                                    key={`task-${task.id}`}
                                    className="rounded-lg px-3 py-3 flex items-center justify-between group hover:bg-muted/50 transition-colors"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        {selectionMode && renderSelectCheckbox(
                                            selectedTaskIds.has(task.id),
                                            () => toggleTaskSelection(task.id),
                                            task.title,
                                        )}
                                        <div>
                                            <h4 className="font-medium text-foreground line-through opacity-70">{task.title}</h4>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {t('trash.taskType')} · {renderDeletedAt(task.deletedAt)}
                                            </p>
                                        </div>
                                    </div>
                                    {!selectionMode && <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => restoreTask(task.id)}
                                            className="p-2 hover:bg-muted rounded-md text-muted-foreground hover:text-primary transition-colors"
                                            title={t('trash.restoreToInbox')}
                                        >
                                            <Undo2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => {
                                                void handlePurgeTask(task.id);
                                            }}
                                            className="p-2 hover:bg-destructive/10 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                                            title={t('trash.deletePermanently')}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            </div>
            {confirmModal}
        </ErrorBoundary>
    );
}
