import { ArrowUpDown, CheckSquare, ChevronDown, List } from 'lucide-react';
import type { TaskSortBy } from '@mindwtr/core';
import { tFallback } from '@mindwtr/core';
import { cn } from '../../../lib/utils';
import type { ContextsGroupBy } from '../list/next-grouping';

type ReviewHeaderProps = {
    title: string;
    taskCountLabel: string;
    onShowDailyGuide: () => void;
    onShowGuide: () => void;
    labels: {
        dailyReview: string;
        weeklyReview: string;
    };
};

// The header carries only the review actions themselves; list utilities
// (sort/group/select/details) live in ReviewListControls beside the status
// chips, next to the list they operate on.
export function ReviewHeader({
    title,
    taskCountLabel,
    onShowDailyGuide,
    onShowGuide,
    labels,
}: ReviewHeaderProps) {
    return (
        <header className="flex items-center justify-between">
            <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                <p className="text-sm text-muted-foreground">{taskCountLabel}</p>
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={onShowDailyGuide}
                    className="bg-muted/50 text-foreground px-4 py-2 rounded-xl hover:bg-muted transition-colors"
                >
                    {labels.dailyReview}
                </button>
                <button
                    onClick={onShowGuide}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-xl hover:bg-primary/90 transition-colors"
                >
                    {labels.weeklyReview}
                </button>
            </div>
        </header>
    );
}

type ReviewListControlsProps = {
    selectionMode: boolean;
    onToggleSelection: () => void;
    sortBy: TaskSortBy;
    onChangeSortBy: (value: TaskSortBy) => void;
    groupBy: ContextsGroupBy;
    onChangeGroupBy: (value: ContextsGroupBy) => void;
    showListDetails: boolean;
    onToggleDetails: () => void;
    t: (key: string) => string;
    labels: {
        select: string;
        exitSelect: string;
    };
};

export function ReviewListControls({
    selectionMode,
    onToggleSelection,
    sortBy,
    onChangeSortBy,
    groupBy,
    onChangeGroupBy,
    showListDetails,
    onToggleDetails,
    t,
    labels,
}: ReviewListControlsProps) {
    const controlBaseClass = "h-9 text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40";
    const controlMutedClass = "bg-card text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground";
    const controlActiveClass = "bg-primary/10 text-primary border-primary";
    const sortLabel = tFallback(t, 'sort.label', 'Sort');
    const groupLabel = tFallback(t, 'list.groupBy', 'Group');

    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className={cn(controlBaseClass, controlMutedClass, "relative flex min-w-[150px] items-center rounded-lg pl-2")}>
                <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="mr-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {sortLabel}
                </span>
                <select
                    value={sortBy}
                    onChange={(event) => onChangeSortBy(event.target.value as TaskSortBy)}
                    aria-label={sortLabel}
                    className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-8 text-xs text-foreground focus:outline-none"
                >
                    <option value="default">{t('sort.default')}</option>
                    <option value="due">{t('sort.due')}</option>
                    <option value="start">{t('sort.start')}</option>
                    <option value="review">{t('sort.review')}</option>
                    <option value="title">{t('sort.title')}</option>
                    <option value="created">{t('sort.created')}</option>
                    <option value="created-desc">{t('sort.created-desc')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className={cn(controlBaseClass, controlMutedClass, "relative flex min-w-[150px] items-center rounded-lg pl-2")}>
                <span className="mr-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {groupLabel}
                </span>
                <select
                    value={groupBy}
                    onChange={(event) => onChangeGroupBy(event.target.value as ContextsGroupBy)}
                    aria-label={groupLabel}
                    className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-8 text-xs text-foreground focus:outline-none"
                >
                    <option value="none">{tFallback(t, 'list.groupByNone', 'No grouping')}</option>
                    <option value="status">{tFallback(t, 'taskEdit.statusLabel', 'Status')}</option>
                    <option value="tag">{tFallback(t, 'taskEdit.tagsLabel', 'Tags')}</option>
                    <option value="context">{tFallback(t, 'list.groupByContext', 'Context')}</option>
                    <option value="area">{tFallback(t, 'list.groupByArea', 'Area')}</option>
                    <option value="project">{tFallback(t, 'list.groupByProject', 'Project')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
            <button
                type="button"
                onClick={onToggleSelection}
                className={cn(
                    controlBaseClass,
                    "inline-flex items-center gap-1.5 rounded-lg px-3",
                    selectionMode ? controlActiveClass : controlMutedClass,
                )}
            >
                <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
                {selectionMode ? labels.exitSelect : labels.select}
            </button>
            <button
                type="button"
                onClick={onToggleDetails}
                aria-pressed={showListDetails}
                className={cn(
                    controlBaseClass,
                    "inline-flex items-center gap-1.5 rounded-lg px-3",
                    showListDetails ? controlActiveClass : controlMutedClass,
                )}
                title={showListDetails ? (t('list.details') || 'Details on') : (t('list.detailsOff') || 'Details off')}
            >
                <List className="h-3.5 w-3.5" aria-hidden="true" />
                {showListDetails ? (t('list.details') || 'Details') : (t('list.detailsOff') || 'Details off')}
            </button>
        </div>
    );
}
