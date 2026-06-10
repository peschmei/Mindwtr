import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskStore, type Task } from '@mindwtr/core';

import { DailyReviewGuideModal } from './DailyReviewModal';

vi.mock('../../../contexts/language-context', () => ({
    useLanguage: () => ({
        t: (key: string) => ({
            'agenda.addToFocus': 'Add to Focus',
            'agenda.focusHint': 'Pick focus tasks.',
            'agenda.maxFocusItems': 'Maximum focus items reached',
            'agenda.noTasks': 'No tasks',
            'agenda.removeFromFocus': 'Remove from Focus',
            'calendar.allDay': 'All day',
            'calendar.events': 'Events',
            'calendar.noTasks': 'No events',
            'common.close': 'Close',
            'common.loading': 'Loading',
            'common.tasks': 'tasks',
            'dailyReview.completeDesc': 'Ready to go.',
            'dailyReview.completeTitle': 'Ready',
            'dailyReview.focusDesc': 'Choose focus tasks.',
            'dailyReview.focusStep': "Today's Focus",
            'dailyReview.inboxDesc': 'Clarify inbox tasks.',
            'dailyReview.inboxStep': 'Process Inbox',
            'dailyReview.title': 'Daily Review',
            'dailyReview.todayDesc': 'Review today.',
            'dailyReview.todayStep': 'Today and Calendar',
            'dailyReview.waitingDesc': 'Follow up.',
            'dailyReview.waitingStep': 'Waiting For',
            'review.back': 'Back',
            'review.finish': 'Finish',
            'review.inboxEmpty': 'Inbox empty',
            'review.nextStepBtn': 'Next',
            'review.of': 'of',
            'review.step': 'Step',
            'review.waitingEmpty': 'Nothing waiting',
        }[key] ?? key),
    }),
}));

vi.mock('../../../lib/external-calendar-events', () => ({
    fetchExternalCalendarEvents: vi.fn(async () => ({ events: [], warnings: [] })),
    summarizeExternalCalendarWarnings: vi.fn(() => null),
}));

vi.mock('../../TaskItem', () => ({
    TaskItem: ({ task }: { task: Task }) => <div data-testid={`task-${task.id}`}>{task.title}</div>,
}));

vi.mock('../InboxProcessor', () => ({
    InboxProcessor: () => <div data-testid="inbox-processor" />,
}));

const storageKey = 'mindwtr:dailyReview:currentStep';
const now = '2026-02-01T00:00:00.000Z';

const makeTask = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    title: 'Task',
    status: 'next',
    createdAt: now,
    updatedAt: now,
    ...overrides,
} as Task);

describe('DailyReviewGuideModal', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({
            tasks: [],
            projects: [],
            areas: [],
            settings: { gtd: { dailyReview: { includeFocusStep: true } } },
            addProject: vi.fn(),
            updateTask: vi.fn(),
            deleteTask: vi.fn(),
        });
    });

    it('shows skipped empty steps as checked and lands on all clear when nothing needs review', () => {
        render(<DailyReviewGuideModal onClose={vi.fn()} />);

        expect(screen.getByRole('heading', { level: 1, name: /ready/i })).toBeInTheDocument();
        expect(screen.getByText('Today and Calendar')).toBeInTheDocument();
        expect(screen.getByText('Process Inbox')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });

    it('persists the current step across modal remounts and clears it when finished', async () => {
        useTaskStore.setState({
            tasks: [makeTask({ id: 'inbox-1', title: 'Inbox task', status: 'inbox' })],
        });

        const { unmount } = render(<DailyReviewGuideModal onClose={vi.fn()} />);

        await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('inbox'));

        unmount();
        render(<DailyReviewGuideModal onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1, name: /process inbox/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /next/i }));
        fireEvent.click(screen.getByRole('button', { name: /finish/i }));

        expect(window.localStorage.getItem(storageKey)).toBeNull();
    });

    it('does not restore a completed step when new daily review work appears', async () => {
        window.localStorage.setItem(storageKey, 'completed');
        useTaskStore.setState({
            tasks: [makeTask({ id: 'inbox-1', title: 'Inbox task', status: 'inbox' })],
        });

        render(<DailyReviewGuideModal onClose={vi.fn()} />);

        expect(screen.getByRole('heading', { level: 1, name: /process inbox/i })).toBeInTheDocument();
        await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('inbox'));
    });
});
