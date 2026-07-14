import { CheckSquare, ChevronsUpDown, List, SlidersHorizontal } from 'lucide-react';
import type { TaskSortBy } from '@mindwtr/core';
import type { TaskListGroupBy } from './next-grouping';
import { GroupBySelect } from './GroupBySelect';
import { SortBySelect, ToolbarButton } from './list-toolbar';

const DEFAULT_GROUP_BY_OPTIONS: TaskListGroupBy[] = ['none', 'context', 'area', 'project', 'tag', 'energy', 'priority', 'person'];

type ListHeaderProps = {
    title: string;
    showNextCount: boolean;
    nextCount: number;
    taskCount: number;
    hasFilters: boolean;
    filterSummaryLabel: string;
    filterSummarySuffix: string;
    sortBy: TaskSortBy;
    onChangeSortBy: (value: TaskSortBy) => void;
    showGroupBy?: boolean;
    groupBy?: TaskListGroupBy;
    groupByOptions?: TaskListGroupBy[];
    onChangeGroupBy?: (value: TaskListGroupBy) => void;
    selectionMode: boolean;
    onToggleSelection: () => void;
    showListDetails: boolean;
    onToggleDetails: () => void;
    densityMode: 'comfortable' | 'compact';
    onToggleDensity: () => void;
    t: (key: string) => string;
};

export function ListHeader({
    title,
    showNextCount,
    nextCount,
    taskCount,
    hasFilters,
    filterSummaryLabel,
    filterSummarySuffix,
    sortBy,
    onChangeSortBy,
    showGroupBy = false,
    groupBy = 'none',
    groupByOptions = DEFAULT_GROUP_BY_OPTIONS,
    onChangeGroupBy,
    selectionMode,
    onToggleSelection,
    showListDetails,
    onToggleDetails,
    densityMode,
    onToggleDensity,
    t,
}: ListHeaderProps) {
    const densityTitle = (() => {
        const value = t('list.density');
        return value === 'list.density' ? 'Density' : value;
    })();
    const densityLabel = densityMode === 'compact'
        ? (() => {
            const value = t('list.densityCompact');
            return value === 'list.densityCompact' ? 'Compact' : value;
        })()
        : (() => {
            const value = t('list.densityComfortable');
            return value === 'list.densityComfortable' ? 'Comfortable' : value;
        })();

    return (
        <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 space-y-1">
                <h2 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {title}
                    {showNextCount && (
                        <span className="ml-2 align-baseline text-base font-medium text-muted-foreground sm:text-lg">
                            ({nextCount})
                        </span>
                    )}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                    <span>{taskCount} {t('common.tasks')}</span>
                    {hasFilters && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:max-w-[420px]">
                            <SlidersHorizontal className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{filterSummaryLabel}{filterSummarySuffix}</span>
                        </span>
                    )}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <ToolbarButton
                    active={selectionMode}
                    onClick={onToggleSelection}
                    aria-pressed={selectionMode}
                    icon={<CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {selectionMode ? t('bulk.exitSelect') : t('bulk.select')}
                </ToolbarButton>
                <SortBySelect
                    value={sortBy}
                    onChange={onChangeSortBy}
                    t={t}
                    iconTestId="list-sort-icon"
                />
                {showGroupBy && onChangeGroupBy && (
                    <GroupBySelect
                        value={groupBy}
                        axes={groupByOptions}
                        onChange={onChangeGroupBy}
                        t={t}
                    />
                )}
                <ToolbarButton
                    active={showListDetails}
                    onClick={onToggleDetails}
                    aria-pressed={showListDetails}
                    title={showListDetails ? (t('list.details') || 'Details on') : (t('list.detailsOff') || 'Details off')}
                    icon={<List className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {showListDetails ? (t('list.details') || 'Details') : (t('list.detailsOff') || 'Details off')}
                </ToolbarButton>
                <ToolbarButton
                    active={densityMode === 'compact'}
                    onClick={onToggleDensity}
                    aria-pressed={densityMode === 'compact'}
                    title={densityTitle}
                    icon={<ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {densityLabel}
                </ToolbarButton>
            </div>
        </header>
    );
}
