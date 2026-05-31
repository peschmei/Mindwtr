import { useRef, type KeyboardEvent } from 'react';
import type { TaskEnergyLevel, TaskPriority, TaskStatus, TimeEstimate } from '@mindwtr/core';

import { cn } from '../../../lib/utils';
import { taskEditorLabelClassName } from '../task-editor-label';

type PillOption<TValue extends string> = {
    value: TValue;
    label: string;
};

const selectedPillClassName = 'border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90';

function PillOptionField<TValue extends string>({
    ariaLabel,
    label,
    options,
    value,
    onChange,
    activeClassName,
}: {
    ariaLabel: string;
    label: string;
    options: Array<PillOption<TValue>>;
    value: TValue;
    onChange: (value: TValue) => void;
    activeClassName?: string;
}) {
    const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const focusOption = (index: number) => {
        buttonRefs.current[index]?.focus();
        onChange(options[index].value);
    };
    const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            focusOption((index + 1) % options.length);
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            event.preventDefault();
            focusOption((index - 1 + options.length) % options.length);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            focusOption(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            focusOption(options.length - 1);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <label className={taskEditorLabelClassName}>{label}</label>
            <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
                {options.map((option, index) => {
                    const isActive = value === option.value;
                    return (
                        <button
                            key={option.value || 'none'}
                            ref={(element) => {
                                buttonRefs.current[index] = element;
                            }}
                            type="button"
                            aria-pressed={isActive}
                            onKeyDown={(event) => handleOptionKeyDown(event, index)}
                            onClick={() => onChange(option.value)}
                            className={cn(
                                'inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                                isActive
                                    ? activeClassName ?? selectedPillClassName
                                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                            )}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function ToggleTokenField({
    ariaLabel,
    label,
    options,
    placeholder,
    value,
    onChange,
}: {
    ariaLabel: string;
    label: string;
    options: string[];
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1 w-full">
            <label className={taskEditorLabelClassName}>{label}</label>
            <input
                type="text"
                aria-label={ariaLabel}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="text-xs bg-muted/50 border border-border rounded px-2 py-1 w-full text-foreground placeholder:text-muted-foreground"
            />
            <div className="flex flex-wrap gap-2 pt-1">
                {options.map((token) => {
                    const currentTokens = value.split(',').map((item) => item.trim()).filter(Boolean);
                    const isActive = currentTokens.includes(token);
                    return (
                        <button
                            key={token}
                            type="button"
                            onClick={() => {
                                const nextTokens = isActive
                                    ? currentTokens.filter((item) => item !== token)
                                    : [...currentTokens, token];
                                onChange(nextTokens.join(', '));
                            }}
                            className={cn(
                                'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                                isActive
                                    ? selectedPillClassName
                                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/50'
                            )}
                        >
                            {token}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function StatusField({
    t,
    value,
    onChange,
}: {
    t: (key: string) => string;
    value: TaskStatus;
    onChange: (value: TaskStatus) => void;
}) {
    const options: Array<PillOption<TaskStatus>> = [
        { value: 'inbox', label: t('status.inbox') },
        { value: 'next', label: t('status.next') },
        { value: 'waiting', label: t('status.waiting') },
        { value: 'someday', label: t('status.someday') },
        ...(value === 'reference' ? [{ value: 'reference' as const, label: t('status.reference') }] : []),
        { value: 'done', label: t('status.done') },
        { value: 'archived', label: t('status.archived') },
    ];

    return (
        <PillOptionField
            ariaLabel={t('task.aria.status')}
            label={t('taskEdit.statusLabel')}
            options={options}
            value={value}
            onChange={onChange}
        />
    );
}

export function PriorityField({
    t,
    value,
    onChange,
}: {
    t: (key: string) => string;
    value: TaskPriority | '';
    onChange: (value: TaskPriority | '') => void;
}) {
    const options: Array<PillOption<TaskPriority | ''>> = [
        { value: '', label: t('common.none') },
        { value: 'low', label: t('priority.low') },
        { value: 'medium', label: t('priority.medium') },
        { value: 'high', label: t('priority.high') },
        { value: 'urgent', label: t('priority.urgent') },
    ];

    return (
        <PillOptionField
            ariaLabel={t('taskEdit.priorityLabel')}
            label={t('taskEdit.priorityLabel')}
            options={options}
            value={value}
            onChange={onChange}
        />
    );
}

export function EnergyLevelField({
    t,
    value,
    onChange,
}: {
    t: (key: string) => string;
    value: NonNullable<TaskEnergyLevel> | '';
    onChange: (value: NonNullable<TaskEnergyLevel> | '') => void;
}) {
    const options: Array<PillOption<NonNullable<TaskEnergyLevel> | ''>> = [
        { value: '', label: t('common.none') },
        { value: 'low', label: t('energyLevel.low') },
        { value: 'medium', label: t('energyLevel.medium') },
        { value: 'high', label: t('energyLevel.high') },
    ];

    return (
        <PillOptionField
            ariaLabel={t('taskEdit.energyLevel')}
            label={t('taskEdit.energyLevel')}
            options={options}
            value={value}
            onChange={onChange}
        />
    );
}

export function AssignedToField({
    t,
    value,
    onChange,
}: {
    t: (key: string) => string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-1">
            <label className={taskEditorLabelClassName}>{t('taskEdit.assignedTo')}</label>
            <input
                type="text"
                value={value}
                aria-label={t('taskEdit.assignedTo')}
                onChange={(event) => onChange(event.target.value)}
                placeholder={t('taskEdit.assignedToPlaceholder')}
                className="text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground"
            />
        </div>
    );
}

export function TimeEstimateField({
    t,
    value,
    onChange,
}: {
    t: (key: string) => string;
    value: TimeEstimate | '';
    onChange: (value: TimeEstimate | '') => void;
}) {
    return (
        <div className="flex flex-col gap-1 w-full">
            <label className={taskEditorLabelClassName}>{t('taskEdit.timeEstimateLabel')}</label>
            <select
                value={value}
                aria-label={t('task.aria.timeEstimate')}
                onChange={(event) => onChange(event.target.value as TimeEstimate | '')}
                className="text-xs bg-muted/50 border border-border rounded px-2 py-1 w-full text-foreground"
            >
                <option value="">{t('common.none')}</option>
                <option value="5min">5m</option>
                <option value="10min">10m</option>
                <option value="15min">15m</option>
                <option value="30min">30m</option>
                <option value="1hr">1h</option>
                <option value="2hr">2h</option>
                <option value="3hr">3h</option>
                <option value="4hr">4h</option>
                <option value="4hr+">4h+</option>
            </select>
        </div>
    );
}

export function ContextsField({
    t,
    value,
    options,
    onChange,
}: {
    t: (key: string) => string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <ToggleTokenField
            ariaLabel={t('task.aria.contexts')}
            label={t('taskEdit.contextsLabel')}
            options={options}
            placeholder={t('taskEdit.contextsPlaceholder')}
            value={value}
            onChange={onChange}
        />
    );
}

export function TagsField({
    t,
    value,
    options,
    onChange,
}: {
    t: (key: string) => string;
    value: string;
    options: string[];
    onChange: (value: string) => void;
}) {
    return (
        <ToggleTokenField
            ariaLabel={t('task.aria.tags')}
            label={t('taskEdit.tagsLabel')}
            options={options}
            placeholder={t('taskEdit.tagsPlaceholder')}
            value={value}
            onChange={onChange}
        />
    );
}
