import { buildSaveSnapshot, ensureDeviceId, getNextDataChangeAt, getTaskOrder, nextRevision, selectVisibleTasks } from '../store-helpers';
import type { OrderingActions, Project, ProjectActionContext, Section, Task, TaskStatus } from './shared';

export const createOrderingActions = ({
    set,
    debouncedSave,
}: ProjectActionContext): OrderingActions => ({
    reorderProjects: async (orderedIds: string[], areaId?: string) => {
        if (orderedIds.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        const targetAreaId = areaId ?? undefined;
        let snapshot = null;
        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            const allProjects = state._allProjects;
            const isInArea = (project: Project) => (project.areaId ?? undefined) === targetAreaId && !project.deletedAt;

            const areaProjects = allProjects.filter(isInArea);
            const orderedSet = new Set(orderedIds);
            const remaining = areaProjects
                .filter((project) => !orderedSet.has(project.id))
                .sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0));

            const finalIds = [...orderedIds, ...remaining.map((project) => project.id)];
            const orderById = new Map<string, number>();
            finalIds.forEach((id, index) => {
                orderById.set(id, index);
            });

            const newAllProjects = allProjects.map((project) => {
                if (!isInArea(project)) return project;
                const nextOrder = orderById.get(project.id);
                if (!Number.isFinite(nextOrder)) return project;
                return {
                    ...project,
                    order: nextOrder as number,
                    updatedAt: now,
                    rev: nextRevision(project.rev),
                    revBy: deviceState.deviceId,
                };
            });

            const newVisibleProjects = newAllProjects.filter((p) => !p.deletedAt);
            snapshot = buildSaveSnapshot(state, {
                projects: newAllProjects,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                projects: newVisibleProjects,
                _allProjects: newAllProjects,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    reorderSections: async (projectId: string, orderedIds: string[]) => {
        if (!projectId || orderedIds.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot = null;
        set((state) => {
            const projectExists = state._allProjects.some((project) => project.id === projectId && !project.deletedAt);
            if (!projectExists) return state;

            const deviceState = ensureDeviceId(state.settings);
            const allSections = state._allSections;
            const isInProject = (section: Section) => section.projectId === projectId && !section.deletedAt;
            const projectSections = allSections.filter(isInProject);
            const projectSectionIds = new Set(projectSections.map((section) => section.id));
            const validOrderedIds = orderedIds.filter((id) => projectSectionIds.has(id));
            if (validOrderedIds.length === 0) return state;

            const orderedSet = new Set(validOrderedIds);
            const remaining = projectSections
                .filter((section) => !orderedSet.has(section.id))
                .sort((a, b) => {
                    const aOrder = Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
                    const bOrder = Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    return a.title.localeCompare(b.title);
                });

            const finalIds = [...validOrderedIds, ...remaining.map((section) => section.id)];
            const orderById = new Map<string, number>();
            finalIds.forEach((id, index) => {
                orderById.set(id, index);
            });

            const newAllSections = allSections.map((section) => {
                if (!isInProject(section)) return section;
                const nextOrder = orderById.get(section.id);
                if (!Number.isFinite(nextOrder)) return section;
                return {
                    ...section,
                    order: nextOrder as number,
                    updatedAt: now,
                    rev: nextRevision(section.rev),
                    revBy: deviceState.deviceId,
                };
            });

            const newVisibleSections = newAllSections.filter((section) => !section.deletedAt);
            snapshot = buildSaveSnapshot(state, {
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                sections: newVisibleSections,
                _allSections: newAllSections,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    reorderProjectTasks: async (projectId: string, orderedIds: string[], sectionId?: string | null) => {
        if (!projectId || orderedIds.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot = null;
        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            const allTasks = state._allTasks;
            const hasSectionFilter = sectionId !== undefined;
            const isInProject = (task: Task) => {
                if (task.projectId !== projectId || task.deletedAt) return false;
                if (!hasSectionFilter) return true;
                if (!sectionId) {
                    return !task.sectionId;
                }
                return task.sectionId === sectionId;
            };

            const projectTasks = allTasks.filter(isInProject);
            const orderedSet = new Set(orderedIds);
            const remaining = projectTasks
                .filter((task) => !orderedSet.has(task.id))
                .sort((a, b) => {
                    const aOrder = getTaskOrder(a) ?? Number.POSITIVE_INFINITY;
                    const bOrder = getTaskOrder(b) ?? Number.POSITIVE_INFINITY;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                });

            const finalIds = [...orderedIds, ...remaining.map((task) => task.id)];
            const orderById = new Map<string, number>();
            finalIds.forEach((id, index) => {
                orderById.set(id, index);
            });

            const newAllTasks = allTasks.map((task) => {
                if (!isInProject(task)) return task;
                const nextOrder = orderById.get(task.id);
                if (!Number.isFinite(nextOrder)) return task;
                return {
                    ...task,
                    order: nextOrder as number,
                    orderNum: nextOrder as number,
                    updatedAt: now,
                    rev: nextRevision(task.rev),
                    revBy: deviceState.deviceId,
                };
            });

            const newVisibleTasks = selectVisibleTasks(newAllTasks);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },

    reorderBoardTasks: async (status: TaskStatus, orderedIds: string[]) => {
        if (!status || orderedIds.length === 0) return;
        const changeAt = Date.now();
        const now = new Date().toISOString();
        let snapshot = null;
        set((state) => {
            const deviceState = ensureDeviceId(state.settings);
            const allTasks = state._allTasks;
            const isInColumn = (task: Task) => task.status === status && !task.deletedAt;

            const columnTasks = allTasks.filter(isInColumn);
            const columnTaskIds = new Set(columnTasks.map((task) => task.id));
            const validOrderedIds = orderedIds.filter((id) => columnTaskIds.has(id));
            if (validOrderedIds.length === 0) return state;

            const orderedSet = new Set(validOrderedIds);
            const remaining = columnTasks
                .filter((task) => !orderedSet.has(task.id))
                .sort((a, b) => {
                    const aOrder = Number.isFinite(a.boardOrder) ? (a.boardOrder as number) : Number.POSITIVE_INFINITY;
                    const bOrder = Number.isFinite(b.boardOrder) ? (b.boardOrder as number) : Number.POSITIVE_INFINITY;
                    if (aOrder !== bOrder) return aOrder - bOrder;
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                });

            const finalIds = [...validOrderedIds, ...remaining.map((task) => task.id)];
            const orderById = new Map<string, number>();
            finalIds.forEach((id, index) => {
                orderById.set(id, index);
            });

            const newAllTasks = allTasks.map((task) => {
                if (!isInColumn(task)) return task;
                const nextOrder = orderById.get(task.id);
                if (!Number.isFinite(nextOrder)) return task;
                if (task.boardOrder === nextOrder) return task;
                return {
                    ...task,
                    boardOrder: nextOrder as number,
                    updatedAt: now,
                    rev: nextRevision(task.rev),
                    revBy: deviceState.deviceId,
                };
            });

            const newVisibleTasks = selectVisibleTasks(newAllTasks);
            snapshot = buildSaveSnapshot(state, {
                tasks: newAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                tasks: newVisibleTasks,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (snapshot) {
            debouncedSave(snapshot, (msg) => set({ error: msg }));
        }
    },
});
