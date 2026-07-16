import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DailyReviewScreen } from './daily-review-modal';

const makeTask = (overrides: Record<string, unknown> = {}) => ({
    id: 'task-1',
    title: 'Today task',
    status: 'next',
    contexts: [],
    tags: [],
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
});

const flattenStyle = (style: unknown): Record<string, unknown> => {
    if (!style) return {};
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map(flattenStyle));
    }
    return typeof style === 'object' ? style as Record<string, unknown> : {};
};

const storeState = {
    tasks: [makeTask({ dueDate: '2026-07-15' })],
    projects: [],
    settings: {
        appearance: {},
        gtd: {
            dailyReview: { includeFocusStep: false },
            focusTaskLimit: 3,
        },
        taskSortBy: 'default',
    },
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
};

vi.mock('react-native', async () => {
    const actual = await vi.importActual<any>('react-native');
    return {
        ...actual,
        FlatList: ({ data = [], renderItem, keyExtractor, ...props }: any) => {
            const renderComponent = (component: any) => {
                if (!component) return null;
                return React.isValidElement(component) ? component : React.createElement(component);
            };
            return React.createElement(
                'FlatList',
                props,
                renderComponent(props.ListHeaderComponent),
                data.length === 0 ? renderComponent(props.ListEmptyComponent) : null,
                data.map((item: any, index: number) => React.createElement(
                    React.Fragment,
                    { key: keyExtractor?.(item, index) ?? item.id ?? index },
                    renderItem?.({ item, index }),
                )),
            );
        },
    };
});

vi.mock('@mindwtr/core', () => ({
    formatFocusTaskLimitText: vi.fn((value: string) => value),
    isDueForReview: vi.fn(() => false),
    isTaskInActiveProject: vi.fn(() => true),
    normalizeFocusTaskLimit: vi.fn(() => 3),
    safeFormatDate: vi.fn((value: Date | string) => String(value)),
    safeParseDate: vi.fn((value?: string) => (value ? new Date(value) : null)),
    safeParseDueDate: vi.fn((value?: string) => (
        value ? new Date(`${value.slice(0, 10)}T12:00:00`) : null
    )),
    shallow: vi.fn((a, b) => a === b),
    shouldShowTaskForStart: vi.fn(() => true),
    sortTasksBy: vi.fn((tasks: unknown[]) => tasks),
    tFallback: vi.fn((_t, _key: string, fallback: string) => fallback),
    useTaskStore: Object.assign(() => storeState, { getState: () => storeState }),
}));

vi.mock('expo-router', () => ({
    router: { push: vi.fn() },
}));

vi.mock('../contexts/theme-context', () => ({
    useTheme: () => ({ isDark: true }),
}));

vi.mock('../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({
            'agenda.noTasks': 'No tasks',
            'calendar.allDay': 'All day',
            'calendar.events': 'Events',
            'calendar.noTasks': 'No events',
            'common.close': 'Close',
            'common.loading': 'Loading',
            'common.tasks': 'tasks',
            'dailyReview.completeDesc': 'Complete',
            'dailyReview.completeTitle': 'Complete',
            'dailyReview.followUpToday': 'Follow up today',
            'dailyReview.inboxDesc': 'Process inbox',
            'dailyReview.inboxStep': 'Inbox',
            'dailyReview.title': 'Daily Review',
            'dailyReview.todayDesc': 'Check today and your calendar',
            'dailyReview.todayStep': 'Today & Calendar',
            'dailyReview.waitingDesc': 'Follow up on anything due',
            'dailyReview.waitingStep': 'Waiting For',
            'review.back': 'Back',
            'review.finish': 'Finish',
            'review.inboxEmpty': 'Inbox empty',
            'review.nextStepBtn': 'Next Step',
            'review.of': 'of',
            'review.step': 'Step',
            'review.waitingEmpty': 'Nothing waiting',
        }[key] ?? key),
    }),
}));

vi.mock('../contexts/toast-context', () => ({
    ToastViewport: () => null,
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#101214',
        border: '#334155',
        cardBg: '#1e293b',
        danger: '#ef4444',
        filterBg: '#273449',
        onTint: '#0f172a',
        secondaryText: '#94a3b8',
        taskItemBg: '#1e293b',
        text: '#f8fafc',
        tint: '#60a5fa',
    }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#60a5fa', textColor: '#0f172a' }),
}));

vi.mock('@/lib/task-meta-navigation', () => ({
    openContextsScreen: vi.fn(),
    openProjectScreen: vi.fn(),
}));

vi.mock('../lib/external-calendar', () => ({
    fetchExternalCalendarEvents: vi.fn().mockResolvedValue({ events: [] }),
}));

vi.mock('./swipeable-task-item', () => ({
    SwipeableTaskItem: (props: any) => React.createElement(
        'SwipeableTaskItem',
        props,
        props.footerContent,
    ),
}));

vi.mock('./task-edit-modal', () => ({
    TaskEditModal: (props: any) => React.createElement('TaskEditModal', props),
}));

vi.mock('./inbox-processing-modal', () => ({
    InboxProcessingModal: (props: any) => React.createElement('InboxProcessingModal', props),
}));

vi.mock('./ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('react-native-gesture-handler', () => ({
    GestureHandlerRootView: (props: any) => React.createElement('GestureHandlerRootView', props, props.children),
}));

vi.mock('lucide-react-native', () => {
    const icon = (name: string) => {
        const MockIcon = (props: any) => React.createElement(name, props);
        MockIcon.displayName = `Mock${name}`;
        return MockIcon;
    };
    return {
        Calendar: icon('Calendar'),
        CheckCircle2: icon('CheckCircle2'),
        ChevronDown: icon('ChevronDown'),
        ChevronUp: icon('ChevronUp'),
        Clock: icon('Clock'),
        Play: icon('Play'),
        Sparkles: icon('Sparkles'),
        Star: icon('Star'),
        X: icon('X'),
    };
});

describe('DailyReviewScreen', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
        storeState.tasks = [makeTask({ dueDate: '2026-07-15' })];
        storeState.updateTask.mockReset();
        storeState.deleteTask.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps Today & Calendar guidance and tasks in one scroll surface above the fixed footer', async () => {
        let tree!: ReturnType<typeof create>;
        await act(async () => {
            tree = create(<DailyReviewScreen onClose={vi.fn()} />);
            await Promise.resolve();
        });

        const scroll = tree.root.findByProps({ testID: 'daily-review-step-scroll-today' });

        expect(tree.root.findAll((node) => (node.type as unknown) === 'FlatList')).toHaveLength(1);
        expect(scroll.findAllByProps({ accessibilityLabel: 'Events' }).length).toBeGreaterThan(0);
        expect(scroll.findAll((node) => (node.type as unknown) === 'SwipeableTaskItem')).toHaveLength(1);
        expect(scroll.findAllByProps({ testID: 'daily-review-footer' })).toHaveLength(0);
        expect(tree.root.findAllByProps({ testID: 'daily-review-footer' }).length).toBeGreaterThan(0);
    });

    it('renders Follow up today as a compact action inside its waiting task card', async () => {
        storeState.tasks = [makeTask({
            id: 'waiting-1',
            title: 'Waiting task',
            status: 'waiting',
            dueDate: undefined,
        })];

        let tree!: ReturnType<typeof create>;
        await act(async () => {
            tree = create(<DailyReviewScreen onClose={vi.fn()} />);
            await Promise.resolve();
        });

        const scroll = tree.root.findByProps({ testID: 'daily-review-step-scroll-waiting' });
        const taskRow = scroll.find((node) => (node.type as unknown) === 'SwipeableTaskItem');
        const followUp = taskRow.findByProps({ accessibilityLabel: 'Follow up today: Waiting task' });
        const style = flattenStyle(followUp.props.style);

        expect(style.minHeight).toBe(32);
        expect(style.borderRadius).toBe(8);
        expect(style.borderWidth).toBeUndefined();
    });
});
