import type { ReactNode } from 'react';
import { closestCenter, pointerWithin, useDroppable, type CollisionDetection } from '@dnd-kit/core';
import { cn } from '../../../lib/utils';

const PROJECT_AREA_CONTAINER_PREFIX = 'project-area:';

export const getProjectAreaContainerId = (areaId: string) => `${PROJECT_AREA_CONTAINER_PREFIX}${areaId}`;

export const getProjectAreaIdFromContainer = (containerId: string) =>
    containerId.startsWith(PROJECT_AREA_CONTAINER_PREFIX)
        ? containerId.slice(PROJECT_AREA_CONTAINER_PREFIX.length)
        : null;

// Area groups are droppable as whole blocks (header included, so collapsed and
// empty areas accept drops). Prefer project-row hits under the pointer so
// within-list reordering is not hijacked by the surrounding group container.
export const projectAreaCollisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
        const rowCollisions = pointerCollisions.filter(
            (collision) => getProjectAreaIdFromContainer(String(collision.id)) === null
        );
        return rowCollisions.length > 0 ? rowCollisions : pointerCollisions;
    }
    return closestCenter(args);
};

type ComputeProjectAreaDragResultArgs = {
    activeId: string;
    overId: string;
    projectIdsByArea: Map<string, string[]>;
    projectAreaById: Map<string, string>;
};

export type ProjectAreaDragResult = {
    sourceAreaId: string;
    destinationAreaId: string;
    nextSourceIds: string[];
    nextDestinationIds: string[];
    movedProjectId: string;
    movedAcrossAreas: boolean;
};

const reorderIds = (items: string[], fromIndex: number, toIndex: number) => {
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
};

export function computeProjectAreaDragResult({
    activeId,
    overId,
    projectIdsByArea,
    projectAreaById,
}: ComputeProjectAreaDragResultArgs): ProjectAreaDragResult | null {
    const sourceAreaId = projectAreaById.get(activeId);
    if (!sourceAreaId) return null;

    const destinationAreaId = projectAreaById.get(overId) ?? getProjectAreaIdFromContainer(overId);
    if (!destinationAreaId) return null;

    const sourceIds = projectIdsByArea.get(sourceAreaId) ?? [];
    const destinationIds = projectIdsByArea.get(destinationAreaId) ?? [];

    if (sourceAreaId === destinationAreaId) {
        const fromIndex = sourceIds.indexOf(activeId);
        if (fromIndex === -1) return null;
        const overIndex = projectAreaById.has(overId) ? sourceIds.indexOf(overId) : -1;
        const toIndex = overIndex === -1 ? sourceIds.length - 1 : overIndex;
        if (toIndex === -1 || fromIndex === toIndex) return null;
        const reordered = reorderIds(sourceIds, fromIndex, toIndex);
        return {
            sourceAreaId,
            destinationAreaId,
            nextSourceIds: reordered,
            nextDestinationIds: reordered,
            movedProjectId: activeId,
            movedAcrossAreas: false,
        };
    }

    const sourceIndex = sourceIds.indexOf(activeId);
    if (sourceIndex === -1) return null;

    const nextSourceIds = sourceIds.filter((id) => id !== activeId);
    const nextDestinationIds = [...destinationIds];
    const overIndex = projectAreaById.has(overId) ? nextDestinationIds.indexOf(overId) : -1;
    const insertIndex = overIndex === -1 ? nextDestinationIds.length : overIndex;
    nextDestinationIds.splice(insertIndex, 0, activeId);

    return {
        sourceAreaId,
        destinationAreaId,
        nextSourceIds,
        nextDestinationIds,
        movedProjectId: activeId,
        movedAcrossAreas: true,
    };
}

type ProjectAreaDropZoneProps = {
    id: string;
    className?: string;
    children: ReactNode;
};

export function ProjectAreaDropZone({ id, className, children }: ProjectAreaDropZoneProps) {
    const { setNodeRef, isOver } = useDroppable({ id });
    return (
        <div ref={setNodeRef} className={cn(className, isOver && 'ring-2 ring-primary/40 rounded-lg')}>
            {children}
        </div>
    );
}
