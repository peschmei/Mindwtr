import type { TaskStatus } from '@mindwtr/core';

export type BoardDragEndAction =
    | { type: 'none' }
    | { type: 'move'; taskId: string; status: TaskStatus }
    | { type: 'reorder'; status: TaskStatus; orderedIds: string[] };

export type BoardDragEndArgs = {
    activeId: string;
    overId: string;
    columnIds: TaskStatus[];
    /** Status of the dragged task as currently stored */
    activeStatus: TaskStatus | undefined;
    /** Status of the card the drag ended over, when it ended over a card */
    overStatus: TaskStatus | undefined;
    /** Rendered task ids of the dragged task's column, top to bottom */
    columnTaskIds: string[];
    /** Manual reordering only applies while the default sort is active */
    canReorder: boolean;
};

export function resolveBoardDragEnd({
    activeId,
    overId,
    columnIds,
    activeStatus,
    overStatus,
    columnTaskIds,
    canReorder,
}: BoardDragEndArgs): BoardDragEndAction {
    if (!activeStatus || activeId === overId) return { type: 'none' };

    if (columnIds.includes(overId as TaskStatus)) {
        const status = overId as TaskStatus;
        if (status === activeStatus) return { type: 'none' };
        return { type: 'move', taskId: activeId, status };
    }

    if (!overStatus) return { type: 'none' };
    if (overStatus !== activeStatus) {
        return { type: 'move', taskId: activeId, status: overStatus };
    }

    if (!canReorder) return { type: 'none' };
    const fromIndex = columnTaskIds.indexOf(activeId);
    const toIndex = columnTaskIds.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return { type: 'none' };

    const orderedIds = [...columnTaskIds];
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, activeId);
    return { type: 'reorder', status: activeStatus, orderedIds };
}
