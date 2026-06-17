import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
    applyMarkdownKeyboardShortcut,
    applyMarkdownPairInsertion,
    applyMarkdownToolbarAction,
    applyMarkdownUrlPaste,
    addCalendarMonths,
    buildRRuleString,
    continueMarkdownOnEnter,
    formatCalendarInputDate,
    getCalendarDayOfMonth,
    getCalendarMonthIndex,
    getProjectedRecurringTaskCalendarDate,
    getRecurrenceCompletedOccurrencesValue,
    getTaskDateCoherenceIssues,
    hasTimeComponent,
    isJalaliCalendarLocale,
    isMarkdownEditorAssistEnabled,
    normalizeClockTimeInput,
    normalizeDateFormatSetting,
    parseCalendarInputDate,
    parseRRuleString,
    REPEAT_REMINDER_INTERVAL_OPTIONS,
    resolveAutoTextDirection,
    safeFormatDate,
    safeParseDate,
    startOfCalendarMonth,
    tFallback,
    useTaskStore,
    type Attachment,
    type MarkdownSelection,
    type MarkdownToolbarActionId,
    type MarkdownToolbarResult,
    type RecurrenceByDay,
    type Recurrence,
    type RecurrenceRule,
    type RecurrenceStrategy,
    type Task,
    type TaskEditorFieldId,
    type TaskEnergyLevel,
    type TaskPriority,
    type TaskStatus,
    type TimeEstimate,
} from '@mindwtr/core';

import { useMarkdownReferenceAutocomplete } from '../MarkdownReferenceAutocomplete';
import { AttachmentsField } from './TaskForm/AttachmentsField';
import { ChecklistField } from './TaskForm/ChecklistField';
import { normalizeDateInputValue } from './task-item-helpers';
import { taskEditorLabelClassName } from './task-editor-label';
import { DescriptionField } from './fields/DescriptionField';
import { RecurrenceField } from './fields/RecurrenceField';
import {
    AssignedToField,
    ContextsField,
    EnergyLevelField,
    PriorityField,
    StatusField,
    TagsField,
    TimeEstimateField,
} from './fields/TaskMetadataFields';
import { QuickDateChips } from '../QuickDateChips';
import {
    captureScrollSnapshot,
    focusElementWithoutScroll,
    keepTextareaSelectionVisible,
    restoreScrollSnapshotSoon,
} from '../../lib/scroll-preservation';

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_POPOVER_WIDTH = 288;
const DATE_POPOVER_APPROX_HEIGHT = 340;
const DATE_POPOVER_MARGIN = 8;

const isRangeSelection = (selection: MarkdownSelection | null | undefined): selection is MarkdownSelection => (
    selection != null && selection.start !== selection.end
);

const getPairInsertionSelection = (
    currentValue: string,
    eventSelection: MarkdownSelection,
    pairSnapshot: { value: string; selection: MarkdownSelection } | null | undefined,
    fallbackSelection: MarkdownSelection | null | undefined,
): MarkdownSelection => {
    if (eventSelection.start !== eventSelection.end) {
        return eventSelection;
    }
    if (pairSnapshot?.value === currentValue && isRangeSelection(pairSnapshot.selection)) {
        return pairSnapshot.selection;
    }
    if (isRangeSelection(fallbackSelection)) {
        return fallbackSelection;
    }
    return eventSelection;
};

type DateInputOrder = 'dmy' | 'mdy' | 'ymd';

function parseDateInputDate(value: string): Date | null {
    if (!DATE_INPUT_PATTERN.test(value)) return safeParseDate(value);
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    const parsed = new Date(year, month - 1, day);
    if (
        parsed.getFullYear() !== year
        || parsed.getMonth() !== month - 1
        || parsed.getDate() !== day
    ) {
        return null;
    }
    return parsed;
}

function getCalendarLocale(locale: string): string | undefined {
    const normalized = locale.trim();
    if (!normalized) return undefined;
    return normalized.split('-u-')[0] || normalized;
}

function getWeekStartIndex(locale: string): number {
    const normalized = locale.toLowerCase();
    if (normalized.includes('fw-mon')) return 1;
    if (normalized.includes('fw-sat')) return 6;
    return 0;
}

function getCalendarGridDays(monthDate: Date, weekStartIndex: number, calendarSystem: string): Date[] {
    const firstOfMonth = startOfCalendarMonth(monthDate, calendarSystem);
    const offset = (firstOfMonth.getDay() - weekStartIndex + 7) % 7;
    const start = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    );
}

function getWeekdayLabels(locale: string, weekStartIndex: number): string[] {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(locale), { weekday: 'short' });
    const sunday = new Date(2026, 0, 4);
    return Array.from({ length: 7 }, (_, index) => {
        const dayIndex = (weekStartIndex + index) % 7;
        const date = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + dayIndex);
        return formatter.format(date);
    });
}

function getDateInputOrder(dateFormatSetting: string | null | undefined, locale: string): DateInputOrder {
    const dateFormat = normalizeDateFormatSetting(dateFormatSetting);
    if (dateFormat === 'dmy') return 'dmy';
    if (dateFormat === 'mdy') return 'mdy';
    if (dateFormat === 'ymd') return 'ymd';

    const formatter = new Intl.DateTimeFormat(getCalendarLocale(locale), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const order = formatter
        .formatToParts(new Date(2026, 10, 22))
        .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
        .map((part) => part.type[0])
        .join('');
    if (order === 'dmy' || order === 'mdy' || order === 'ymd') return order;
    return 'mdy';
}

function getDateInputPlaceholder(order: DateInputOrder): string {
    if (order === 'dmy') return 'DD/MM/YYYY';
    if (order === 'mdy') return 'MM/DD/YYYY';
    return 'YYYY-MM-DD';
}

function formatDateInputDisplay(value: string, order: DateInputOrder, calendarSystem: string): string {
    if (!value) return '';
    if (calendarSystem === 'jalali') {
        return formatCalendarInputDate(value, calendarSystem);
    }
    const parsed = parseDateInputDate(value);
    if (!parsed) return value;

    const year = String(parsed.getFullYear()).padStart(4, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    if (order === 'dmy') return `${day}/${month}/${year}`;
    if (order === 'mdy') return `${month}/${day}/${year}`;
    return `${year}-${month}-${day}`;
}

function parseDateInputDisplay(value: string, order: DateInputOrder, calendarSystem: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (calendarSystem === 'jalali') {
        if (DATE_INPUT_PATTERN.test(trimmed)) {
            return parseCalendarInputDate(trimmed, calendarSystem);
        }
        const parts = trimmed.match(/\d{1,4}/g);
        if (!parts || parts.length !== 3 || parts[0].length !== 4) return null;
        const [year, month, day] = parts;
        return parseCalendarInputDate(
            `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
            calendarSystem
        );
    }

    if (DATE_INPUT_PATTERN.test(trimmed)) {
        const normalized = normalizeDateInputValue(trimmed);
        return parseDateInputDate(normalized) ? normalized : null;
    }

    const parts = trimmed.match(/\d{1,4}/g);
    if (!parts || parts.length !== 3) return null;

    let year: string;
    let month: string;
    let day: string;
    if (parts[0].length === 4) {
        [year, month, day] = parts;
    } else if (order === 'dmy') {
        [day, month, year] = parts;
    } else if (order === 'mdy') {
        [month, day, year] = parts;
    } else {
        [year, month, day] = parts;
    }

    if (year.length !== 4) return null;
    const normalized = normalizeDateInputValue(
        `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    );
    return parseDateInputDate(normalized) ? normalized : null;
}

type DateFieldProps = {
    t: (key: string) => string;
    label: string;
    dateAriaLabel: string;
    dateValue: string;
    selectedDate: Date | null;
    dateFormatSetting?: string | null;
    nativeDateInputLocale: string;
    dateInputClassName: string;
    timeInput: ReactNode;
    onDateChange: (value: string) => void;
    onCalendarSelect?: (value: string) => void;
    onClear: () => void;
    hasValue: boolean;
};

export function DateField({
    t,
    label,
    dateAriaLabel,
    dateValue,
    selectedDate,
    dateFormatSetting,
    nativeDateInputLocale,
    dateInputClassName,
    timeInput,
    onDateChange,
    onCalendarSelect,
    onClear,
    hasValue,
}: DateFieldProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [calendarPosition, setCalendarPosition] = useState({ top: 0, left: 0 });
    const calendarSystem = isJalaliCalendarLocale(nativeDateInputLocale) ? 'jalali' : 'gregorian';
    const [calendarMonth, setCalendarMonth] = useState(() =>
        startOfCalendarMonth(selectedDate ?? parseDateInputDate(dateValue) ?? new Date(), calendarSystem)
    );
    const clearText = tFallback(t, 'common.clear', 'Clear');
    const dateInputOrder = calendarSystem === 'jalali'
        ? 'ymd'
        : getDateInputOrder(dateFormatSetting, nativeDateInputLocale);
    const [draftDateValue, setDraftDateValue] = useState(() => (
        formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem)
    ));
    const weekStartIndex = getWeekStartIndex(nativeDateInputLocale);
    const calendarLocale = getCalendarLocale(nativeDateInputLocale);
    const monthLabel = new Intl.DateTimeFormat(calendarLocale, { month: 'long', year: 'numeric' }).format(calendarMonth);
    const fullDateFormatter = new Intl.DateTimeFormat(calendarLocale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const weekdayLabels = getWeekdayLabels(nativeDateInputLocale, weekStartIndex);
    const days = getCalendarGridDays(calendarMonth, weekStartIndex, calendarSystem);
    const todayValue = safeFormatDate(new Date(), 'yyyy-MM-dd');

    const updateCalendarPosition = useCallback(() => {
        const anchor = inputRef.current?.parentElement ?? inputRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const maxLeft = Math.max(DATE_POPOVER_MARGIN, window.innerWidth - DATE_POPOVER_WIDTH - DATE_POPOVER_MARGIN);
        const left = Math.min(Math.max(rect.left, DATE_POPOVER_MARGIN), maxLeft);
        const wouldOverflowBottom = rect.bottom + DATE_POPOVER_APPROX_HEIGHT + DATE_POPOVER_MARGIN > window.innerHeight;
        const top = wouldOverflowBottom
            ? Math.max(DATE_POPOVER_MARGIN, rect.top - DATE_POPOVER_APPROX_HEIGHT - 4)
            : rect.bottom + 4;
        setCalendarPosition({ top, left });
    }, []);
    const openCalendar = useCallback(() => {
        updateCalendarPosition();
        setIsCalendarOpen(true);
    }, [updateCalendarPosition]);

    useEffect(() => {
        setDraftDateValue(formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem));
    }, [calendarSystem, dateInputOrder, dateValue]);

    useEffect(() => {
        if (!isCalendarOpen) return;
        const nextDate = selectedDate ?? parseDateInputDate(dateValue) ?? new Date();
        setCalendarMonth(startOfCalendarMonth(nextDate, calendarSystem));
    }, [calendarSystem, dateValue, isCalendarOpen, selectedDate]);

    useEffect(() => {
        if (!isCalendarOpen) return;
        updateCalendarPosition();

        const handlePointerDown = (event: MouseEvent | PointerEvent | TouchEvent) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) return;
            setIsCalendarOpen(false);
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsCalendarOpen(false);
            }
        };
        const handleViewportChange = () => updateCalendarPosition();

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('mousedown', handlePointerDown, true);
        document.addEventListener('touchstart', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('mousedown', handlePointerDown, true);
            document.removeEventListener('touchstart', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [isCalendarOpen, updateCalendarPosition]);

    const handleDateInputChange = (value: string) => {
        setDraftDateValue(value);
        const parsed = parseDateInputDisplay(value, dateInputOrder, calendarSystem);
        if (parsed === null) return;
        if (!parsed) {
            onClear();
            return;
        }
        onDateChange(parsed);
    };
    const applyCalendarDate = (date: Date, closeAfterSelect: boolean) => {
        const nextDateValue = safeFormatDate(date, 'yyyy-MM-dd');
        setDraftDateValue(formatDateInputDisplay(nextDateValue, dateInputOrder, calendarSystem));
        onDateChange(nextDateValue);
        onCalendarSelect?.(nextDateValue);
        if (!closeAfterSelect) return;
        setIsCalendarOpen(false);
        window.setTimeout(() => inputRef.current?.focus(), 0);
    };

    return (
        <div className="relative flex flex-col gap-1" ref={rootRef}>
            <label className={taskEditorLabelClassName}>{label}</label>
            <div className="flex w-full max-w-[min(22rem,100%)] items-center gap-2">
                <div className="relative min-w-0 flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        inputMode="numeric"
                        placeholder={getDateInputPlaceholder(dateInputOrder)}
                        lang={nativeDateInputLocale}
                        aria-label={dateAriaLabel}
                        aria-haspopup="dialog"
                        aria-expanded={isCalendarOpen}
                        value={draftDateValue}
                        onFocus={openCalendar}
                        onClick={openCalendar}
                        onChange={(event) => handleDateInputChange(event.target.value)}
                        onBlur={() => {
                            window.setTimeout(() => {
                                if (rootRef.current?.contains(document.activeElement)) return;
                                setDraftDateValue(formatDateInputDisplay(dateValue, dateInputOrder, calendarSystem));
                            }, 0);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setIsCalendarOpen(false);
                                event.stopPropagation();
                            } else if (event.key === 'ArrowDown') {
                                setIsCalendarOpen(true);
                                event.preventDefault();
                            }
                        }}
                        className={`${dateInputClassName} w-full pr-8`}
                    />
                    <CalendarDays
                        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                </div>
                {timeInput}
                {hasValue ? (
                    <button
                        type="button"
                        onClick={() => {
                            setDraftDateValue('');
                            onClear();
                            setIsCalendarOpen(false);
                        }}
                        className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={`${clearText} ${label}`}
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : (
                    <span aria-hidden="true" className="h-7 w-7 shrink-0" />
                )}
            </div>
            {isCalendarOpen && (
                <div
                    role="dialog"
                    aria-label={`${label} calendar`}
                    className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
                    style={{ top: calendarPosition.top, left: calendarPosition.left }}
                >
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            aria-label="Previous month"
                            onClick={() => setCalendarMonth((current) => addCalendarMonths(current, -1, calendarSystem))}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="min-w-0 flex-1 text-center text-sm font-medium text-foreground">
                            {monthLabel}
                        </div>
                        <button
                            type="button"
                            aria-label="Next month"
                            onClick={() => setCalendarMonth((current) => addCalendarMonths(current, 1, calendarSystem))}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                        {weekdayLabels.map((weekday, index) => (
                            <div key={`${weekday}-${index}`} className="py-1">
                                {weekday}
                            </div>
                        ))}
                    </div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                        {days.map((day) => {
                            const value = safeFormatDate(day, 'yyyy-MM-dd');
                            const isSelected = value === dateValue;
                            const isToday = value === todayValue;
                            const isOutsideMonth = getCalendarMonthIndex(day, calendarSystem) !== getCalendarMonthIndex(calendarMonth, calendarSystem);
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    aria-label={fullDateFormatter.format(day)}
                                    aria-pressed={isSelected}
                                    onPointerDown={(event) => {
                                        event.preventDefault();
                                        applyCalendarDate(day, true);
                                    }}
                                    onClick={() => applyCalendarDate(day, true)}
                                    onDoubleClick={() => applyCalendarDate(day, true)}
                                    className={[
                                        'h-8 rounded text-xs transition-colors',
                                        isSelected
                                            ? 'bg-primary text-primary-foreground'
                                            : isToday
                                                ? 'border border-primary/60 text-primary hover:bg-primary/10'
                                                : 'text-foreground hover:bg-muted',
                                        isOutsideMonth && !isSelected ? 'text-muted-foreground/50' : '',
                                    ].filter(Boolean).join(' ')}
                                >
                                    {getCalendarDayOfMonth(day, calendarSystem)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            <QuickDateChips
                t={t}
                selectedDate={selectedDate}
                wrap
                onSelect={(date) => {
                    if (!date) {
                        setDraftDateValue('');
                        onClear();
                        setIsCalendarOpen(false);
                        return;
                    }
                    const nextDateValue = safeFormatDate(date, 'yyyy-MM-dd');
                    setDraftDateValue(formatDateInputDisplay(nextDateValue, dateInputOrder, calendarSystem));
                    onDateChange(nextDateValue);
                }}
                className="w-full"
            />
        </div>
    );
}

export type MonthlyRecurrenceInfo = {
    pattern: 'date' | 'custom';
    interval: number;
};

export type TaskItemFieldRendererData = {
    t: (key: string) => string;
    task: Task;
    taskId: string;
    showDescriptionPreview: boolean;
    editDescription: string;
    attachmentError: string | null;
    visibleEditAttachments: Attachment[];
    editStartTime: string;
    editDueDate: string;
    editReviewAt: string;
    editRepeatReminderMinutes: number | undefined;
    editStatus: TaskStatus;
    editPriority: TaskPriority | '';
    editEnergyLevel: NonNullable<TaskEnergyLevel> | '';
    editAssignedTo: string;
    editRecurrence: RecurrenceRule | '';
    editRecurrenceStrategy: RecurrenceStrategy;
    editRecurrenceRRule: string;
    editShowFutureRecurrence: boolean;
    monthlyRecurrence: MonthlyRecurrenceInfo;
    editTimeEstimate: TimeEstimate | '';
    editContexts: string;
    editTags: string;
    editLocation: string;
    language: string;
    dateFormatSetting?: string | null;
    nativeDateInputLocale: string;
    defaultScheduleTime: string;
    allContextOptions: string[];
    allTagOptions: string[];
    popularContextOptions: string[];
    popularTagOptions: string[];
    assignedToOptions: string[];
};

export type TaskItemFieldRendererHandlers = {
    toggleDescriptionPreview: () => void;
    editDescriptionFromPreview: () => void;
    setEditDescription: (value: string) => void;
    addFileAttachment: () => void;
    addLinkAttachment: () => void;
    editLinkAttachment: (attachment: Attachment) => void;
    openAttachment: (attachment: Attachment) => void;
    removeAttachment: (id: string) => void;
    setEditStartTime: (value: string) => void;
    setEditDueDate: (value: string) => void;
    setEditReviewAt: (value: string) => void;
    setEditRepeatReminderMinutes: (value: number | undefined) => void;
    setEditStatus: (value: TaskStatus) => void;
    setEditPriority: (value: TaskPriority | '') => void;
    setEditEnergyLevel: (value: NonNullable<TaskEnergyLevel> | '') => void;
    setEditAssignedTo: (value: string) => void;
    setEditRecurrence: (value: RecurrenceRule | '') => void;
    setEditRecurrenceStrategy: (value: RecurrenceStrategy) => void;
    setEditRecurrenceRRule: (value: string) => void;
    setEditShowFutureRecurrence: (value: boolean) => void;
    openCustomRecurrence: () => void;
    setEditTimeEstimate: (value: TimeEstimate | '') => void;
    setEditContexts: (value: string) => void;
    setEditTags: (value: string) => void;
    setEditLocation: (value: string) => void;
    updateTask: (taskId: string, updates: Partial<Task>) => void;
    resetTaskChecklist: (taskId: string) => void;
};

type TaskItemFieldRendererProps = {
    fieldId: TaskEditorFieldId;
    data: TaskItemFieldRendererData;
    handlers: TaskItemFieldRendererHandlers;
};

export function TaskItemFieldRenderer({
    fieldId,
    data,
    handlers,
}: TaskItemFieldRendererProps) {
    const {
        t,
        task,
        taskId,
        showDescriptionPreview,
        editDescription,
        attachmentError,
        visibleEditAttachments,
        editStartTime,
        editDueDate,
        editReviewAt,
        editRepeatReminderMinutes,
        editStatus,
        editPriority,
        editEnergyLevel,
        editAssignedTo,
        editRecurrence,
        editRecurrenceStrategy,
        editRecurrenceRRule,
        editShowFutureRecurrence,
        monthlyRecurrence,
        editTimeEstimate,
        editContexts,
        editTags,
        editLocation,
        language,
        dateFormatSetting,
        nativeDateInputLocale,
        defaultScheduleTime,
        allContextOptions,
        allTagOptions,
        popularContextOptions,
        popularTagOptions,
        assignedToOptions,
    } = data;

    const markdownEditorAssist = useTaskStore((state) => isMarkdownEditorAssistEnabled(state.settings));

    const [reviewTimeDraft, setReviewTimeDraft] = useState('');
    const [descriptionExpanded, setDescriptionExpanded] = useState(false);
    const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastDescriptionPairSelectionRef = useRef<{ value: string; selection: MarkdownSelection } | null>(null);
    const descriptionSelectionRef = useRef<MarkdownSelection>({
        start: editDescription.length,
        end: editDescription.length,
    });
    const descriptionUndoRef = useRef<Array<{ value: string; selection: MarkdownSelection }>>([]);
    const [descriptionUndoDepth, setDescriptionUndoDepth] = useState(0);
    useEffect(() => {
        const parsed = editReviewAt ? safeParseDate(editReviewAt) : null;
        const hasTime = hasTimeComponent(editReviewAt);
        const next = hasTime && parsed ? safeFormatDate(parsed, 'HH:mm') : '';
        setReviewTimeDraft(next);
    }, [editReviewAt]);
    useEffect(() => {
        descriptionSelectionRef.current = {
            start: editDescription.length,
            end: editDescription.length,
        };
        lastDescriptionPairSelectionRef.current = null;
        descriptionUndoRef.current = [];
        setDescriptionUndoDepth(0);
    }, [taskId]);
    const {
        toggleDescriptionPreview,
        editDescriptionFromPreview,
        setEditDescription,
        addFileAttachment,
        addLinkAttachment,
        editLinkAttachment,
        openAttachment,
        removeAttachment,
        setEditStartTime,
        setEditDueDate,
        setEditReviewAt,
        setEditRepeatReminderMinutes,
        setEditStatus,
        setEditPriority,
        setEditEnergyLevel,
        setEditAssignedTo,
        setEditRecurrence,
        setEditRecurrenceStrategy,
        setEditRecurrenceRRule,
        setEditShowFutureRecurrence,
        openCustomRecurrence,
        setEditTimeEstimate,
        setEditContexts,
        setEditTags,
        setEditLocation,
        updateTask,
        resetTaskChecklist,
    } = handlers;
    const parsedRecurrenceRRule = parseRRuleString(editRecurrenceRRule);
    const recurrenceEndMode: 'never' | 'until' | 'count' = parsedRecurrenceRRule.count
        ? 'count'
        : parsedRecurrenceRRule.until
            ? 'until'
            : 'never';
    const recurrenceDefaultEndDate = parsedRecurrenceRRule.until
        || safeFormatDate(
            safeParseDate(editDueDate || editStartTime || task.dueDate || task.startTime) ?? new Date(),
            'yyyy-MM-dd'
        );
    const buildRecurrenceRRule = (
        rule: RecurrenceRule,
        overrides: {
            byDay?: RecurrenceByDay[];
            interval?: number;
            byMonthDay?: number[];
            count?: number;
            until?: string;
        } = {}
    ) => {
        const hasOverride = <TKey extends keyof typeof overrides>(key: TKey) =>
            Object.prototype.hasOwnProperty.call(overrides, key);
        return buildRRuleString(
            rule,
            hasOverride('byDay') ? overrides.byDay : parsedRecurrenceRRule.byDay,
            hasOverride('interval') ? overrides.interval : parsedRecurrenceRRule.interval,
            {
                byMonthDay: hasOverride('byMonthDay') ? overrides.byMonthDay : parsedRecurrenceRRule.byMonthDay,
                count: hasOverride('count') ? overrides.count : parsedRecurrenceRRule.count,
                until: hasOverride('until') ? overrides.until : parsedRecurrenceRRule.until,
            }
        );
    };
    const recurrencePreviewValue: Recurrence | undefined = editRecurrence
        ? { rule: editRecurrence, strategy: editRecurrenceStrategy }
        : undefined;
    if (recurrencePreviewValue && editRecurrenceRRule) {
        if (parsedRecurrenceRRule.byDay && parsedRecurrenceRRule.byDay.length > 0) {
            recurrencePreviewValue.byDay = parsedRecurrenceRRule.byDay;
        }
        if (parsedRecurrenceRRule.byMonthDay && parsedRecurrenceRRule.byMonthDay.length > 0) {
            recurrencePreviewValue.byMonthDay = parsedRecurrenceRRule.byMonthDay;
        }
        if (parsedRecurrenceRRule.count) {
            recurrencePreviewValue.count = parsedRecurrenceRRule.count;
        }
        if (parsedRecurrenceRRule.until) {
            recurrencePreviewValue.until = parsedRecurrenceRRule.until;
        }
        const completedOccurrences = getRecurrenceCompletedOccurrencesValue(task.recurrence);
        if (typeof completedOccurrences === 'number') {
            recurrencePreviewValue.completedOccurrences = completedOccurrences;
        }
        recurrencePreviewValue.rrule = editRecurrenceRRule;
    }
    const projectedRecurrenceDateLabel = recurrencePreviewValue
        ? safeFormatDate(getProjectedRecurringTaskCalendarDate({
            ...task,
            startTime: editStartTime || undefined,
            dueDate: editDueDate || undefined,
            recurrence: recurrencePreviewValue,
            showFutureRecurrence: true,
        }), 'PP')
        : '';

    const resolvedDirection = resolveAutoTextDirection([task.title, editDescription].filter(Boolean).join(' '), language);
    const isRtl = resolvedDirection === 'rtl';
    const pushDescriptionUndoEntry = (value: string, selection: MarkdownSelection) => {
        const previousEntry = descriptionUndoRef.current[descriptionUndoRef.current.length - 1];
        if (
            previousEntry
            && previousEntry.value === value
            && previousEntry.selection.start === selection.start
            && previousEntry.selection.end === selection.end
        ) {
            return;
        }
        const nextUndoEntries = [...descriptionUndoRef.current, { value, selection }];
        descriptionUndoRef.current = nextUndoEntries.length > 100
            ? nextUndoEntries.slice(nextUndoEntries.length - 100)
            : nextUndoEntries;
        setDescriptionUndoDepth(descriptionUndoRef.current.length);
    };
    const applyDescriptionValue = (
        value: string,
        options?: {
            nextSelection?: MarkdownSelection;
            recordUndo?: boolean;
            baseSelection?: MarkdownSelection;
        },
    ) => {
        if ((options?.recordUndo ?? true) && value !== editDescription) {
            pushDescriptionUndoEntry(editDescription, options?.baseSelection ?? descriptionSelectionRef.current);
        }
        setEditDescription(value);
        if (options?.nextSelection) {
            descriptionSelectionRef.current = options.nextSelection;
        } else {
            lastDescriptionPairSelectionRef.current = null;
        }
    };
    const restoreDescriptionTextareaSelection = (
        textarea: HTMLTextAreaElement,
        selection: MarkdownSelection,
    ) => {
        requestAnimationFrame(() => {
            const target = textarea.isConnected ? textarea : descriptionTextareaRef.current;
            if (!target) return;
            const scrollSnapshot = captureScrollSnapshot(target);
            const surroundingScrollSnapshot = scrollSnapshot.filter(
                (snapshot) => snapshot.kind === 'window' || snapshot.target !== target,
            );
            focusElementWithoutScroll(target, scrollSnapshot);
            target.setSelectionRange(selection.start, selection.end);
            keepTextareaSelectionVisible(target);
            restoreScrollSnapshotSoon(surroundingScrollSnapshot);
        });
    };
    const handleDescriptionUndo = () => {
        const previousEntry = descriptionUndoRef.current[descriptionUndoRef.current.length - 1];
        if (!previousEntry) return undefined;
        descriptionUndoRef.current = descriptionUndoRef.current.slice(0, -1);
        setDescriptionUndoDepth(descriptionUndoRef.current.length);
        applyDescriptionValue(previousEntry.value, {
            nextSelection: previousEntry.selection,
            recordUndo: false,
        });
        return previousEntry.selection;
    };
    const handleDescriptionApplyAction = (actionId: MarkdownToolbarActionId, selection: MarkdownSelection): MarkdownToolbarResult => {
        const next = applyMarkdownToolbarAction(editDescription, selection, actionId);
        applyDescriptionValue(next.value, {
            baseSelection: selection,
            nextSelection: next.selection,
        });
        return next;
    };
    const descriptionAutocomplete = useMarkdownReferenceAutocomplete({
        currentTaskId: taskId,
        value: editDescription,
        selection: descriptionSelectionRef.current,
        textareaRef: descriptionTextareaRef,
        onApplyResult: (next) => {
            lastDescriptionPairSelectionRef.current = null;
            applyDescriptionValue(next.value, {
                baseSelection: descriptionSelectionRef.current,
                nextSelection: next.selection,
            });
            descriptionSelectionRef.current = next.selection;
        },
    });
    const handleDescriptionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (descriptionAutocomplete.handleKeyDown(event)) {
            return;
        }
        const eventTextarea = event.currentTarget;
        const currentValue = event.currentTarget.value;
        const selection = {
            start: event.currentTarget.selectionStart ?? currentValue.length,
            end: event.currentTarget.selectionEnd ?? currentValue.length,
        };
        const applyDescriptionKeyboardResult = (
            next: MarkdownToolbarResult,
            baseSelection = selection,
            rememberPairRange = false,
        ) => {
            applyDescriptionValue(next.value, {
                baseSelection,
                nextSelection: next.selection,
            });
            descriptionSelectionRef.current = next.selection;
            lastDescriptionPairSelectionRef.current = rememberPairRange && isRangeSelection(next.selection)
                ? { value: next.value, selection: next.selection }
                : null;
            restoreDescriptionTextareaSelection(eventTextarea, next.selection);
        };
        const lowerKey = event.key.toLowerCase();
        if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            if (lowerKey === 'b' || lowerKey === 'i') {
                const next = applyMarkdownKeyboardShortcut(currentValue, selection, {
                    key: event.key,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                });
                if (!next) return;
                event.preventDefault();
                applyDescriptionKeyboardResult(next);
                return;
            }
            if (lowerKey !== 'z') return;
            if (descriptionUndoRef.current.length === 0) return;
            event.preventDefault();
            const restoredSelection = handleDescriptionUndo();
            if (restoredSelection) {
                restoreDescriptionTextareaSelection(eventTextarea, restoredSelection);
            }
            return;
        }

        const isPairInsertionKey = !event.altKey && !event.ctrlKey && !event.metaKey && event.key.length === 1;
        if (!isPairInsertionKey && event.key !== 'Tab') {
            lastDescriptionPairSelectionRef.current = null;
        }
        if (event.key === 'Tab' || isPairInsertionKey) {
            const pairSelection = isPairInsertionKey
                ? getPairInsertionSelection(currentValue, selection, lastDescriptionPairSelectionRef.current, descriptionSelectionRef.current)
                : selection;
            const next = event.key === 'Tab'
                ? applyMarkdownKeyboardShortcut(currentValue, selection, {
                    key: event.key,
                    shiftKey: event.shiftKey,
                })
                : applyMarkdownPairInsertion(
                    currentValue,
                    `${currentValue.slice(0, pairSelection.start)}${event.key}${currentValue.slice(pairSelection.end)}`,
                    pairSelection,
                    { assist: markdownEditorAssist },
                );
            if (!next) return;
            event.preventDefault();
            applyDescriptionKeyboardResult(next, pairSelection, isPairInsertionKey);
            return;
        }

        if (event.key !== 'Enter' || event.shiftKey || event.altKey) return;
        const next = continueMarkdownOnEnter(currentValue, selection, { assist: markdownEditorAssist });
        if (!next) return;

        event.preventDefault();
        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionKeyboardResult(next);
    };
    const handleDescriptionPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const pastedText = event.clipboardData.getData('text/plain');
        if (!pastedText) return;
        const eventTextarea = event.currentTarget;
        const currentValue = event.currentTarget.value;
        const selection = {
            start: event.currentTarget.selectionStart ?? currentValue.length,
            end: event.currentTarget.selectionEnd ?? currentValue.length,
        };
        const next = applyMarkdownUrlPaste(
            currentValue,
            `${currentValue.slice(0, selection.start)}${pastedText}${currentValue.slice(selection.end)}`,
            selection,
            { assist: markdownEditorAssist },
        );
        if (!next) return;
        event.preventDefault();
        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionValue(next.value, {
            baseSelection: selection,
            nextSelection: next.selection,
        });
        descriptionSelectionRef.current = next.selection;
        restoreDescriptionTextareaSelection(eventTextarea, next.selection);
    };
    const handleDescriptionInput = (
        value: string,
        selection: MarkdownSelection,
        source: HTMLTextAreaElement,
    ) => {
        const previousSelection = descriptionSelectionRef.current;
        const pairedInsertion = applyMarkdownPairInsertion(editDescription, value, previousSelection, { assist: markdownEditorAssist });
        if (pairedInsertion) {
            applyDescriptionValue(pairedInsertion.value, {
                baseSelection: previousSelection,
                nextSelection: pairedInsertion.selection,
            });
            descriptionSelectionRef.current = pairedInsertion.selection;
            lastDescriptionPairSelectionRef.current = isRangeSelection(pairedInsertion.selection)
                ? { value: pairedInsertion.value, selection: pairedInsertion.selection }
                : null;
            restoreDescriptionTextareaSelection(source, pairedInsertion.selection);
            return;
        }

        lastDescriptionPairSelectionRef.current = null;
        applyDescriptionValue(value);
        descriptionSelectionRef.current = selection;
    };
    const handleEditDescriptionFromPreview = (source?: HTMLElement) => {
        const scrollSnapshot = captureScrollSnapshot(source);
        editDescriptionFromPreview();
        restoreScrollSnapshotSoon(scrollSnapshot);
        requestAnimationFrame(() => {
            const textarea = descriptionTextareaRef.current;
            if (!textarea) return;
            focusElementWithoutScroll(textarea, scrollSnapshot);
            restoreScrollSnapshotSoon(scrollSnapshot);
        });
    };
    const dateInputClassName = 'min-w-0 flex-1 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground';
    const timeInputClassName = 'w-24 shrink-0 text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground';
    const dateIssueLabel = getTaskDateCoherenceIssues({
        startTime: editStartTime || undefined,
        dueDate: editDueDate || undefined,
    }).some((issue) => issue.code === 'start_after_due')
        ? tFallback(t, 'task.dateIssue.startAfterDue', 'Starts after due date')
        : '';
    const renderDateField = ({
        label,
        dateAriaLabel,
        dateValue,
        selectedDate,
        onDateChange,
        timeInput,
        onClear,
        hasValue,
        warning,
    }: {
        label: string;
        dateAriaLabel: string;
        dateValue: string;
        selectedDate: Date | null;
        onDateChange: (value: string) => void;
        timeInput: ReactNode;
        onClear: () => void;
        hasValue: boolean;
        warning?: string;
    }) => (
        <div className="space-y-1">
            <DateField
                t={t}
                label={label}
                dateAriaLabel={dateAriaLabel}
                dateValue={dateValue}
                selectedDate={selectedDate}
                dateFormatSetting={dateFormatSetting}
                nativeDateInputLocale={nativeDateInputLocale}
                dateInputClassName={dateInputClassName}
                timeInput={timeInput}
                onDateChange={onDateChange}
                onClear={onClear}
                hasValue={hasValue}
            />
            {warning && (
                <p className="text-xs text-amber-500 dark:text-amber-300" role="note">
                    {warning}
                </p>
            )}
        </div>
    );

    switch (fieldId) {
        case 'description':
            return (
                <DescriptionField
                    t={t}
                    taskTitle={task.title}
                    taskId={taskId}
                    showDescriptionPreview={showDescriptionPreview}
                    editDescription={editDescription}
                    isRtl={isRtl}
                    resolvedDirection={resolvedDirection}
                    descriptionExpanded={descriptionExpanded}
                    descriptionUndoDepth={descriptionUndoDepth}
                    descriptionTextareaRef={descriptionTextareaRef}
                    descriptionSelection={descriptionSelectionRef.current}
                    descriptionAutocomplete={descriptionAutocomplete}
                    onTogglePreview={toggleDescriptionPreview}
                    onEditFromPreview={handleEditDescriptionFromPreview}
                    onExpand={() => setDescriptionExpanded(true)}
                    onCloseExpanded={() => setDescriptionExpanded(false)}
                    onDescriptionInput={handleDescriptionInput}
                    onDescriptionChange={applyDescriptionValue}
                    onSelectionChange={(selection) => {
                        descriptionSelectionRef.current = selection;
                        if (isRangeSelection(selection)) {
                            lastDescriptionPairSelectionRef.current = null;
                        }
                    }}
                    onUndo={handleDescriptionUndo}
                    onApplyAction={handleDescriptionApplyAction}
                    onKeyDown={handleDescriptionKeyDown}
                    onPaste={handleDescriptionPaste}
                />
            );
        case 'attachments':
            return (
                <AttachmentsField
                    t={t}
                    attachmentError={attachmentError}
                    visibleEditAttachments={visibleEditAttachments}
                    addFileAttachment={addFileAttachment}
                    addLinkAttachment={addLinkAttachment}
                    editLinkAttachment={editLinkAttachment}
                    openAttachment={openAttachment}
                    removeAttachment={removeAttachment}
                />
            );
        case 'startTime':
            {
                const hasTime = hasTimeComponent(editStartTime);
                const parsed = editStartTime ? safeParseDate(editStartTime) : null;
                const dateValue = parsed ? safeFormatDate(parsed, 'yyyy-MM-dd') : '';
                const timeValue = hasTime && parsed ? safeFormatDate(parsed, 'HH:mm') : '';
                const handleDateChange = (value: string) => {
                    const normalizedDate = normalizeDateInputValue(value);
                    if (!normalizedDate) {
                        setEditStartTime('');
                        return;
                    }
                    if (hasTime && timeValue) {
                        setEditStartTime(`${normalizedDate}T${timeValue}`);
                        return;
                    }
                    if (defaultScheduleTime) {
                        setEditStartTime(`${normalizedDate}T${defaultScheduleTime}`);
                        return;
                    }
                    setEditStartTime(normalizedDate);
                };
                const handleTimeChange = (value: string) => {
                    if (!value) {
                        if (dateValue) setEditStartTime(dateValue);
                        else setEditStartTime('');
                        return;
                    }
                    const datePart = dateValue || safeFormatDate(new Date(), 'yyyy-MM-dd');
                    setEditStartTime(`${datePart}T${value}`);
                };
                return renderDateField({
                    label: t('taskEdit.startDateLabel'),
                    dateAriaLabel: t('task.aria.startDate'),
                    dateValue,
                    selectedDate: parsed,
                    onDateChange: handleDateChange,
                    timeInput: (
                        <input
                            type="time"
                            lang={nativeDateInputLocale}
                            aria-label={t('task.aria.startTime')}
                            value={timeValue}
                            onChange={(event) => handleTimeChange(event.target.value)}
                            className={timeInputClassName}
                        />
                    ),
                    onClear: () => setEditStartTime(''),
                    hasValue: Boolean(editStartTime),
                    warning: dateIssueLabel,
                });
            }
        case 'dueDate':
            {
                const hasTime = hasTimeComponent(editDueDate);
                const parsed = editDueDate ? safeParseDate(editDueDate) : null;
                const dateValue = parsed ? safeFormatDate(parsed, 'yyyy-MM-dd') : '';
                const timeValue = hasTime && parsed ? safeFormatDate(parsed, 'HH:mm') : '';
                const handleDateChange = (value: string) => {
                    const normalizedDate = normalizeDateInputValue(value);
                    if (!normalizedDate) {
                        setEditDueDate('');
                        return;
                    }
                    if (hasTime && timeValue) {
                        setEditDueDate(`${normalizedDate}T${timeValue}`);
                        return;
                    }
                    if (defaultScheduleTime) {
                        setEditDueDate(`${normalizedDate}T${defaultScheduleTime}`);
                        return;
                    }
                    setEditDueDate(normalizedDate);
                };
                const handleTimeChange = (value: string) => {
                    if (!value) {
                        if (dateValue) setEditDueDate(dateValue);
                        else setEditDueDate('');
                        return;
                    }
                    const datePart = dateValue || safeFormatDate(new Date(), 'yyyy-MM-dd');
                    setEditDueDate(`${datePart}T${value}`);
                };
                return (
                    <>
                        {renderDateField({
                            label: t('taskEdit.dueDateLabel'),
                            dateAriaLabel: t('task.aria.dueDate'),
                            dateValue,
                            selectedDate: parsed,
                            onDateChange: handleDateChange,
                            timeInput: (
                                <input
                                    type="time"
                                    lang={nativeDateInputLocale}
                                    aria-label={t('task.aria.dueTime')}
                                    value={timeValue}
                                    onChange={(event) => handleTimeChange(event.target.value)}
                                    className={timeInputClassName}
                                />
                            ),
                            onClear: () => setEditDueDate(''),
                            hasValue: Boolean(editDueDate),
                            warning: dateIssueLabel,
                        })}
                        {hasTime && !task.suppressMindwtrReminders && (
                            <div className="mt-1 flex items-center gap-2">
                                <label
                                    htmlFor={`repeat-reminder-${taskId}`}
                                    className="text-xs text-muted-foreground shrink-0"
                                >
                                    {tFallback(t, 'taskEdit.repeatReminderLabel', 'Repeat reminder')}
                                </label>
                                <select
                                    id={`repeat-reminder-${taskId}`}
                                    aria-label={tFallback(t, 'taskEdit.repeatReminderLabel', 'Repeat reminder')}
                                    className="text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground"
                                    value={editRepeatReminderMinutes ?? 0}
                                    onChange={(event) => {
                                        const next = Number(event.target.value);
                                        setEditRepeatReminderMinutes(next > 0 ? next : undefined);
                                    }}
                                >
                                    <option value={0}>{tFallback(t, 'taskEdit.repeatReminderOff', 'Off')}</option>
                                    {REPEAT_REMINDER_INTERVAL_OPTIONS.map((minutes) => (
                                        <option key={minutes} value={minutes}>
                                            {tFallback(t, 'taskEdit.repeatReminderEveryMinutes', 'Every {count} min').replace('{count}', String(minutes))}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </>
                );
            }
        case 'reviewAt':
            {
                const hasTime = hasTimeComponent(editReviewAt);
                const parsed = editReviewAt ? safeParseDate(editReviewAt) : null;
                const dateValue = parsed ? safeFormatDate(parsed, 'yyyy-MM-dd') : '';
                const timeValue = hasTime && parsed ? safeFormatDate(parsed, 'HH:mm') : '';
                const handleDateChange = (value: string) => {
                    const normalizedDate = normalizeDateInputValue(value);
                    if (!normalizedDate) {
                        setEditReviewAt('');
                        return;
                    }
                    if (hasTime && timeValue) {
                        setEditReviewAt(`${normalizedDate}T${timeValue}`);
                        return;
                    }
                    if (defaultScheduleTime) {
                        setEditReviewAt(`${normalizedDate}T${defaultScheduleTime}`);
                        return;
                    }
                    setEditReviewAt(normalizedDate);
                };
                const handleTimeChange = (value: string) => {
                    if (!value) {
                        if (dateValue) setEditReviewAt(dateValue);
                        else setEditReviewAt('');
                        return;
                    }
                    const datePart = dateValue || safeFormatDate(new Date(), 'yyyy-MM-dd');
                    setEditReviewAt(`${datePart}T${value}`);
                };
                return renderDateField({
                    label: t('taskEdit.reviewDateLabel'),
                    dateAriaLabel: t('task.aria.reviewDate'),
                    dateValue,
                    selectedDate: parsed,
                    onDateChange: handleDateChange,
                    timeInput: (
                        <input
                            type="text"
                            aria-label={t('task.aria.reviewTime')}
                            value={reviewTimeDraft}
                            inputMode="numeric"
                            placeholder="HH:MM"
                            onChange={(event) => setReviewTimeDraft(event.target.value)}
                            onBlur={() => {
                                const normalized = normalizeClockTimeInput(reviewTimeDraft);
                                if (normalized === null) {
                                    setReviewTimeDraft(timeValue);
                                    return;
                                }
                                setReviewTimeDraft(normalized);
                                handleTimeChange(normalized);
                            }}
                            className={timeInputClassName}
                        />
                    ),
                    onClear: () => setEditReviewAt(''),
                    hasValue: Boolean(editReviewAt),
                });
            }
        case 'status':
            return <StatusField t={t} value={editStatus} onChange={setEditStatus} />;
        case 'priority':
            return <PriorityField t={t} value={editPriority} onChange={setEditPriority} />;
        case 'energyLevel':
            return <EnergyLevelField t={t} value={editEnergyLevel} onChange={setEditEnergyLevel} />;
        case 'assignedTo':
            return <AssignedToField t={t} value={editAssignedTo} options={assignedToOptions} onChange={setEditAssignedTo} />;
        case 'recurrence':
            return (
                <RecurrenceField
                    t={t}
                    editRecurrence={editRecurrence}
                    editRecurrenceStrategy={editRecurrenceStrategy}
                    editRecurrenceRRule={editRecurrenceRRule}
                    editShowFutureRecurrence={editShowFutureRecurrence}
                    monthlyRecurrence={monthlyRecurrence}
                    parsedRecurrenceRRule={parsedRecurrenceRRule}
                    recurrenceEndMode={recurrenceEndMode}
                    recurrenceDefaultEndDate={recurrenceDefaultEndDate}
                    projectedRecurrenceDateLabel={projectedRecurrenceDateLabel}
                    onRecurrenceChange={setEditRecurrence}
                    onRecurrenceStrategyChange={setEditRecurrenceStrategy}
                    onRecurrenceRRuleChange={setEditRecurrenceRRule}
                    onShowFutureRecurrenceChange={setEditShowFutureRecurrence}
                    openCustomRecurrence={openCustomRecurrence}
                    buildRecurrenceRRule={buildRecurrenceRRule}
                />
            );
        case 'timeEstimate':
            return <TimeEstimateField t={t} value={editTimeEstimate} onChange={setEditTimeEstimate} />;
        case 'contexts':
            return (
                <ContextsField
                    t={t}
                    value={editContexts}
                    options={popularContextOptions}
                    suggestions={allContextOptions}
                    onChange={setEditContexts}
                />
            );
        case 'tags':
            return (
                <TagsField
                    t={t}
                    value={editTags}
                    options={popularTagOptions}
                    suggestions={allTagOptions}
                    onChange={setEditTags}
                />
            );
        case 'location':
            return (
                <div className="flex flex-col gap-1">
                    <label className={taskEditorLabelClassName}>{t('taskEdit.locationLabel')}</label>
                    <input
                        type="text"
                        aria-label={t('task.aria.location')}
                        value={editLocation}
                        onChange={(event) => setEditLocation(event.target.value)}
                        placeholder={t('taskEdit.locationPlaceholder')}
                        className="text-xs bg-muted/50 border border-border rounded px-2 py-1 text-foreground placeholder:text-muted-foreground"
                    />
                </div>
            );
        case 'checklist':
            return (
                <ChecklistField
                    t={t}
                    taskId={taskId}
                    checklist={task.checklist}
                    description={editDescription}
                    onDescriptionSync={setEditDescription}
                    updateTask={updateTask}
                    resetTaskChecklist={resetTaskChecklist}
                />
            );
        default:
            return null;
    }
}
