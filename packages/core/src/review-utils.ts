import { addDays, format } from 'date-fns';

import type { ReviewSnapshotItem } from './ai/types';
import type { Project, Task } from './types';
import { hasTimeComponent, isDueForReview, safeParseDate } from './date';
import { filterProjectsNeedingNextAction, isTaskInActiveProject } from './project-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_REVIEW_ADVANCE_DAYS = 7;

/**
 * Next review date after marking an item reviewed: `days` from now, preserving
 * the original value's date-only vs datetime shape (time-of-day carries over).
 */
export function getAdvancedReviewDate(
    reviewAt: string | undefined | null,
    now: Date = new Date(),
    days: number = DEFAULT_REVIEW_ADVANCE_DAYS,
): string {
    const target = addDays(now, days);
    if (reviewAt && hasTimeComponent(reviewAt)) {
        const parsed = safeParseDate(reviewAt);
        if (parsed) {
            const withTime = new Date(target);
            withTime.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
            return format(withTime, "yyyy-MM-dd'T'HH:mm");
        }
    }
    return format(target, 'yyyy-MM-dd');
}

function isFutureDate(value: string | undefined | null, now: Date): boolean {
    if (!value) return false;
    const date = safeParseDate(value);
    return date ? date.getTime() > now.getTime() : false;
}

export type ReviewSchedulePartition<T> = {
    due: T[];
    scheduled: T[];
    unscheduled: T[];
};

/**
 * Splits reviewable items by review date: `due` (review date reached),
 * `scheduled` (explicitly deferred to a future review date), `unscheduled`
 * (no review date set).
 */
export function partitionByReviewDate<T extends { reviewAt?: string | null }>(
    items: T[],
    now: Date = new Date(),
): ReviewSchedulePartition<T> {
    const due: T[] = [];
    const scheduled: T[] = [];
    const unscheduled: T[] = [];
    items.forEach((item) => {
        if (isDueForReview(item.reviewAt, now)) {
            due.push(item);
        } else if (isFutureDate(item.reviewAt, now)) {
            scheduled.push(item);
        } else {
            unscheduled.push(item);
        }
    });
    return { due, scheduled, unscheduled };
}

export type WeeklyReviewSummary = {
    inboxCount: number;
    activeProjectCount: number;
    projectsWithoutNextAction: number;
    staleWaitingCount: number;
};

/**
 * Factual snapshot for the weekly review's completed step. Every count mirrors
 * the filter a review step itself uses, so the summary can never disagree with
 * what the user just saw:
 * - `inboxCount` matches the inbox step's `inboxTasks` filter.
 * - `projectsWithoutNextAction` matches the projects step's next-action predicate.
 * - `staleWaitingCount` is derived from `getStaleItems`, inheriting its
 *   future-reviewAt/startTime exemption rather than re-deriving staleness.
 */
export function getWeeklyReviewSummary(
    tasks: Task[],
    projects: Project[],
    now: Date = new Date(),
): WeeklyReviewSummary {
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    const inboxCount = tasks.filter((task) => (
        task.status === 'inbox'
        && !task.deletedAt
        && isTaskInActiveProject(task, projectMap)
    )).length;

    const activeProjects = projects.filter((project) => project.status === 'active' && !project.deletedAt);
    const projectsWithoutNextAction = filterProjectsNeedingNextAction(projects, tasks).length;

    const staleWaitingCount = getStaleItems(tasks, projects, 14, now)
        .filter((item) => item.status === 'waiting').length;

    return {
        inboxCount,
        activeProjectCount: activeProjects.length,
        projectsWithoutNextAction,
        staleWaitingCount,
    };
}

export function getStaleItems(
    tasks: Task[],
    projects: Project[],
    staleThresholdDays = 14,
    now: Date = new Date(),
): ReviewSnapshotItem[] {
    const items: ReviewSnapshotItem[] = [];
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    tasks.forEach((task) => {
        if (task.deletedAt) return;
        if (task.status !== 'next' && task.status !== 'waiting') return;
        if (!isTaskInActiveProject(task, projectMap)) return;
        // An explicit future review or start date outranks the staleness heuristic.
        if (isFutureDate(task.reviewAt, now) || isFutureDate(task.startTime, now)) return;
        const updated = new Date(task.updatedAt || task.createdAt);
        if (Number.isNaN(updated.getTime())) return;
        const daysStale = Math.ceil((now.getTime() - updated.getTime()) / DAY_MS);
        if (daysStale <= staleThresholdDays) return;
        items.push({
            id: task.id,
            title: task.title,
            daysStale,
            status: task.status === 'waiting' ? 'waiting' : 'next',
            startTime: task.startTime,
            dueDate: task.dueDate,
            reviewAt: task.reviewAt,
        });
    });

    projects.forEach((project) => {
        if (project.deletedAt) return;
        if (project.status !== 'active') return;
        if (isFutureDate(project.reviewAt, now)) return;
        const updated = new Date(project.updatedAt || project.createdAt);
        if (Number.isNaN(updated.getTime())) return;
        const daysStale = Math.ceil((now.getTime() - updated.getTime()) / DAY_MS);
        if (daysStale <= staleThresholdDays) return;
        items.push({
            id: `project:${project.id}`,
            title: project.title,
            daysStale,
            status: 'project',
            dueDate: project.dueDate,
            reviewAt: project.reviewAt,
        });
    });

    return items.sort((a, b) => b.daysStale - a.daysStale);
}
