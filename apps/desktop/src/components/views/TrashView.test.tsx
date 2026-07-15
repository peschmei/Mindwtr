import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, Task } from '@mindwtr/core';
import { useTaskStore } from '@mindwtr/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../contexts/language-context';
import { TrashView } from './TrashView';

const initialTaskState = useTaskStore.getState();

const recentTask: Task = {
    id: 'recent-task',
    title: 'Recently deleted task',
    status: 'inbox',
    tags: [],
    contexts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-13T12:00:00.000Z',
    deletedAt: '2026-07-13T12:00:00.000Z',
};

const olderProject: Project = {
    id: 'older-project',
    title: 'Older deleted project',
    status: 'archived',
    color: '#64748b',
    order: 0,
    tagIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    deletedAt: '2026-07-01T12:00:00.000Z',
};

describe('TrashView', () => {
    beforeEach(() => {
        useTaskStore.setState(initialTaskState, true);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            _allTasks: [recentTask],
            _allProjects: [olderProject],
            _tasksById: new Map([[recentTask.id, recentTask]]),
            settings: {},
        });
    });

    it('shows tasks and projects in one newest-deleted-first timeline', () => {
        const { getByText } = render(
            <LanguageProvider>
                <TrashView />
            </LanguageProvider>
        );

        const taskTitle = getByText(recentTask.title);
        const projectTitle = getByText(olderProject.title);

        expect(taskTitle.compareDocumentPosition(projectTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('bulk restores selected trashed tasks and projects', async () => {
        render(
            <LanguageProvider>
                <TrashView />
            </LanguageProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Select' }));
        fireEvent.click(screen.getByRole('button', { name: /Select all/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore to Inbox' }));

        await waitFor(() => {
            expect(useTaskStore.getState()._allTasks.find((task) => task.id === recentTask.id)?.deletedAt).toBeUndefined();
            expect(useTaskStore.getState()._allProjects.find((project) => project.id === olderProject.id)?.deletedAt).toBeUndefined();
        });
    });

    it('bulk purges selected trashed items after confirmation', async () => {
        render(
            <LanguageProvider>
                <TrashView />
            </LanguageProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: 'Select' }));
        fireEvent.click(screen.getByRole('checkbox', { name: `Select ${recentTask.title}` }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete Permanently' }));

        await waitFor(() => {
            const purgedTask = useTaskStore.getState()._allTasks.find((task) => task.id === recentTask.id);
            expect(purgedTask?.purgedAt).toBeTruthy();
        });
        // The unselected project stays in the trash untouched.
        expect(useTaskStore.getState()._allProjects.find((project) => project.id === olderProject.id)?.purgedAt).toBeUndefined();
    });
});
