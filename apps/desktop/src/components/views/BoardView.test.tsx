import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BoardView } from './BoardView';
import { LanguageProvider } from '../../contexts/language-context';
import { useTaskStore } from '@mindwtr/core';
import { useUiStore } from '../../store/ui-store';

vi.mock('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PointerSensor: class {},
    useDroppable: () => ({ setNodeRef: () => {} }),
    useSensor: () => ({}),
    useSensors: () => ([]),
    closestCorners: () => null,
}));

vi.mock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    verticalListSortingStrategy: {},
    useSortable: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => {},
        transform: null,
        transition: undefined,
        isDragging: false,
    }),
}));

const renderWithProviders = () => {
    return render(
        <LanguageProvider>
            <BoardView />
        </LanguageProvider>
    );
};

describe('BoardView', () => {
    beforeEach(() => {
        window.localStorage.clear();
        useTaskStore.setState({
            tasks: [],
            projects: [],
            areas: [],
            settings: {},
        });
        useUiStore.setState({
            boardFilters: { selectedProjectIds: [] },
        });
    });

    it('renders the column headers', () => {
        const { getByRole } = renderWithProviders();
        expect(getByRole('heading', { name: /inbox/i })).toBeInTheDocument();
        expect(getByRole('heading', { name: /next actions/i })).toBeInTheDocument();
    });

    it('exposes the project filter panel state with aria-expanded', () => {
        const { getByRole } = renderWithProviders();

        const filtersButton = getByRole('button', { name: /show/i });
        expect(filtersButton).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(filtersButton);
        expect(getByRole('button', { name: /hide/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('allows hiding the project filter panel after selecting a filter', () => {
        useTaskStore.setState({
            tasks: [],
            projects: [{
                id: 'project-1',
                title: 'Alpha project',
                status: 'active',
                color: '#123456',
                order: 0,
                tagIds: [],
                createdAt: '2026-02-28T12:00:00.000Z',
                updatedAt: '2026-02-28T12:00:00.000Z',
            }],
            areas: [],
            settings: {},
        });

        const { getByRole, queryByRole } = renderWithProviders();

        fireEvent.click(getByRole('button', { name: /^show$/i }));
        fireEvent.click(getByRole('button', { name: 'Alpha project' }));
        fireEvent.click(getByRole('button', { name: /^hide$/i }));

        expect(getByRole('button', { name: /^show$/i })).toHaveAttribute('aria-expanded', 'false');
        expect(queryByRole('button', { name: 'Alpha project' })).not.toBeInTheDocument();
    });

    it('hides tasks that belong to deferred projects', () => {
        useTaskStore.setState({
            tasks: [
                {
                    id: 'active-task',
                    title: 'Active project next action',
                    status: 'next',
                    projectId: 'active-project',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'someday-task',
                    title: 'Someday project next action',
                    status: 'next',
                    projectId: 'someday-project',
                    tags: [],
                    contexts: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            projects: [
                {
                    id: 'active-project',
                    title: 'Active project',
                    status: 'active',
                    color: '#123456',
                    order: 0,
                    tagIds: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
                {
                    id: 'someday-project',
                    title: 'Someday project',
                    status: 'someday',
                    color: '#654321',
                    order: 1,
                    tagIds: [],
                    createdAt: '2026-05-18T12:00:00.000Z',
                    updatedAt: '2026-05-18T12:00:00.000Z',
                },
            ],
            areas: [],
            settings: {},
        });

        const { getByText, queryByText } = renderWithProviders();

        expect(getByText('Active project next action')).toBeInTheDocument();
        expect(queryByText('Someday project next action')).not.toBeInTheDocument();
    });

    it('orders column tasks by boardOrder ahead of tasks without one', () => {
        const baseTask = {
            status: 'next' as const,
            tags: [],
            contexts: [],
            createdAt: '2026-05-18T12:00:00.000Z',
            updatedAt: '2026-05-18T12:00:00.000Z',
        };
        useTaskStore.setState({
            tasks: [
                { ...baseTask, id: 'task-q', title: 'Task Q', boardOrder: 1 },
                { ...baseTask, id: 'task-w', title: 'Task W', boardOrder: 2 },
                { ...baseTask, id: 'task-e', title: 'Task E', boardOrder: 0 },
                { ...baseTask, id: 'task-r', title: 'Task R' },
            ],
            projects: [],
            areas: [],
            settings: {},
        });

        const { getByRole } = renderWithProviders();

        const column = getByRole('list', { name: /next actions tasks list/i });
        const titles = Array.from(column.querySelectorAll('[role="listitem"]')).map(
            (item) => ['Task Q', 'Task W', 'Task E', 'Task R'].find((title) => item.textContent?.includes(title)),
        );
        expect(titles).toEqual(['Task E', 'Task Q', 'Task W', 'Task R']);
    });
});
