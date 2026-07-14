import { tFallback } from '@mindwtr/core';
import { cn } from '../../../lib/utils';
import { ToolbarSelectShell, toolbarSelectClass } from './list-toolbar';
import { getGroupAxisLabel, type TaskGroupAxis } from './next-grouping';

type GroupBySelectProps<Axis extends TaskGroupAxis> = {
    value: Axis;
    axes: readonly Axis[];
    onChange: (value: Axis) => void;
    t: (key: string) => string;
    className?: string;
};

/** The labeled GROUP select shared by every list toolbar. */
export function GroupBySelect<Axis extends TaskGroupAxis>({
    value,
    axes,
    onChange,
    t,
    className,
}: GroupBySelectProps<Axis>) {
    const groupLabel = tFallback(t, 'list.groupBy', 'Group');
    return (
        <ToolbarSelectShell className={cn('min-w-[180px]', className)} label={groupLabel}>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value as Axis)}
                aria-label={groupLabel}
                className={toolbarSelectClass}
            >
                {axes.map((axis) => (
                    <option key={axis} value={axis}>{getGroupAxisLabel(axis, t)}</option>
                ))}
            </select>
        </ToolbarSelectShell>
    );
}
