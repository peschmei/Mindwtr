import type { ReactNode } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { tFallback, type TaskSortBy } from '@mindwtr/core';
import { cn } from '../../../lib/utils';

// One toolbar style for every list view. Focus, Review, Contexts and the status
// lists all render the same row of controls, and each kept its own copy until
// they drifted apart in height, radius and labelling (#861).
export const TOOLBAR_CONTROL_BASE = 'h-9 text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40';
export const TOOLBAR_CONTROL_MUTED = 'bg-card text-muted-foreground border-border hover:bg-muted/70 hover:text-foreground';
export const TOOLBAR_CONTROL_ACTIVE = 'bg-primary/10 text-primary border-primary';

const TOOLBAR_SELECT_SHELL = 'relative flex h-9 items-center rounded-lg border border-border bg-card pl-2 text-xs transition-colors hover:bg-muted/70 focus-within:ring-2 focus-within:ring-primary/40';
const TOOLBAR_SELECT_LABEL = 'text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
// The gap after the label is the select's own padding rather than a margin on
// the label: Windows draws the native option list with the select's padding, so
// the popup entries line up under the value instead of hugging the frame.
const TOOLBAR_SELECT_INPUT = 'h-full min-w-0 flex-1 appearance-none bg-transparent pl-2 pr-8 text-xs text-foreground focus:outline-none';

const SORT_OPTIONS: TaskSortBy[] = ['default', 'due', 'start', 'review', 'title', 'created', 'created-desc'];

type ToolbarButtonProps = {
    active?: boolean;
    children: ReactNode;
    icon?: ReactNode;
    onClick: () => void;
    title?: string;
    'aria-controls'?: string;
    'aria-expanded'?: boolean;
    'aria-pressed'?: boolean;
};

/** A toggle in a list toolbar: same height and radius as the selects beside it. */
export function ToolbarButton({ active = false, children, icon, onClick, title, ...aria }: ToolbarButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            {...aria}
            className={cn(
                TOOLBAR_CONTROL_BASE,
                'inline-flex items-center gap-1.5 rounded-lg px-3',
                active ? TOOLBAR_CONTROL_ACTIVE : TOOLBAR_CONTROL_MUTED,
            )}
        >
            {icon}
            {children}
        </button>
    );
}

type ToolbarSelectShellProps = {
    children: ReactNode;
    className?: string;
    icon?: ReactNode;
    label: string;
};

/** The labelled select frame: icon, SORT/GROUP caption, value, chevron. */
export function ToolbarSelectShell({ children, className, icon, label }: ToolbarSelectShellProps) {
    return (
        <div className={cn(TOOLBAR_SELECT_SHELL, className)}>
            {icon}
            <span className={TOOLBAR_SELECT_LABEL}>{label}</span>
            {children}
            <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
            />
        </div>
    );
}

export const toolbarSelectClass = TOOLBAR_SELECT_INPUT;

type SortBySelectProps = {
    value: TaskSortBy;
    onChange: (value: TaskSortBy) => void;
    t: (key: string) => string;
    className?: string;
    iconTestId?: string;
};

/** The labelled SORT select shared by every list toolbar. */
export function SortBySelect({ value, onChange, t, className, iconTestId }: SortBySelectProps) {
    const sortLabel = tFallback(t, 'sort.label', 'Sort');
    return (
        <ToolbarSelectShell
            className={cn('min-w-[160px]', className)}
            label={sortLabel}
            icon={(
                <ArrowUpDown
                    className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                    data-testid={iconTestId}
                />
            )}
        >
            <select
                value={value}
                onChange={(event) => onChange(event.target.value as TaskSortBy)}
                aria-label={sortLabel}
                className={TOOLBAR_SELECT_INPUT}
            >
                {SORT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{t(`sort.${option}`)}</option>
                ))}
            </select>
        </ToolbarSelectShell>
    );
}
