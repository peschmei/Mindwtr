import { normalizeFocusTaskLimit, useTaskStore, type TaskStatus } from '@mindwtr/core';

// Completing a task force-clears its Today star (core applyTaskUpdates), so
// undoing a completion must restore the star along with the status. The star
// only comes back while the focus cap has room — same rule as starring by hand.
export async function undoTaskCompletion(
    taskId: string,
    previousStatus: TaskStatus,
    wasFocusedToday: boolean,
): Promise<void> {
    const state = useTaskStore.getState();
    const moveResult = await Promise.resolve(state.moveTask(taskId, previousStatus));
    if (moveResult && moveResult.success === false) return;
    if (!wasFocusedToday) return;

    const current = useTaskStore.getState();
    const focusTaskLimit = normalizeFocusTaskLimit(current.settings.gtd?.focusTaskLimit);
    if (current.getDerivedState().focusedCount >= focusTaskLimit) return;
    await Promise.resolve(current.updateTask(taskId, { isFocusedToday: true }));
}
