import { Filter, List } from 'lucide-react';

import { GroupBySelect } from '../list/GroupBySelect';
import { ToolbarButton } from '../list/list-toolbar';
import type { NextGroupBy } from '../list/next-grouping';

const AGENDA_GROUP_BY_AXES: NextGroupBy[] = ['none', 'context', 'area', 'project', 'tag', 'energy', 'priority', 'person'];

type AgendaHeaderProps = {
    filterCount: number;
    filtersOpen: boolean;
    nextActionsCount: number;
    nextGroupBy: NextGroupBy;
    onChangeGroupBy: (value: NextGroupBy) => void;
    onToggleFilters: () => void;
    onToggleDetails: () => void;
    onToggleTop3: () => void;
    resolveText: (key: string, fallback: string) => string;
    showListDetails: boolean;
    t: (key: string) => string;
    top3Only: boolean;
};

export function AgendaHeader({
    filterCount,
    filtersOpen,
    nextActionsCount,
    nextGroupBy,
    onChangeGroupBy,
    onToggleFilters,
    onToggleDetails,
    onToggleTop3,
    resolveText,
    showListDetails,
    t,
    top3Only,
}: AgendaHeaderProps) {
    const filtersActive = filtersOpen || filterCount > 0;
    const filtersLabel = resolveText('filters.label', 'Filters');
    const detailsLabel = showListDetails
        ? (t('list.details') || 'Details')
        : (t('list.detailsOff') || 'Details off');

    return (
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">
                    {t('agenda.title')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    {nextActionsCount} {t('list.next') || t('agenda.nextActions')}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <ToolbarButton active={top3Only} onClick={onToggleTop3} aria-pressed={top3Only}>
                    {t('agenda.top3Only')}
                </ToolbarButton>
                <ToolbarButton
                    active={filtersActive}
                    onClick={onToggleFilters}
                    aria-expanded={filtersOpen}
                    aria-controls="agenda-filters-panel"
                    aria-pressed={filtersActive}
                    title={filtersLabel}
                    icon={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    <span>{filtersLabel}</span>
                    {filterCount > 0 && (
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                            {filterCount}
                        </span>
                    )}
                </ToolbarButton>
                <ToolbarButton
                    active={showListDetails}
                    onClick={onToggleDetails}
                    aria-pressed={showListDetails}
                    title={showListDetails ? (t('list.details') || 'Details on') : (t('list.detailsOff') || 'Details off')}
                    icon={<List className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {detailsLabel}
                </ToolbarButton>
                <GroupBySelect
                    value={nextGroupBy}
                    axes={AGENDA_GROUP_BY_AXES}
                    onChange={onChangeGroupBy}
                    t={t}
                />
            </div>
        </header>
    );
}
