import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VirtualTaskRow } from './VirtualTaskRow';

vi.mock('@mindwtr/core', () => ({
    useTaskById: (id: string) => ({ id, title: 'Task' }),
}));

vi.mock('./StoreTaskItem', () => ({
    StoreTaskItem: () => <div data-testid="store-task-item" />,
}));

describe('VirtualTaskRow', () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    let resizeCallbacks: ResizeObserverCallback[];
    let observed: Element[];
    let disconnected: number;

    beforeEach(() => {
        resizeCallbacks = [];
        observed = [];
        disconnected = 0;
        globalThis.ResizeObserver = class {
            constructor(callback: ResizeObserverCallback) {
                resizeCallbacks.push(callback);
            }
            observe(target: Element) {
                observed.push(target);
            }
            unobserve() {}
            disconnect() {
                disconnected += 1;
            }
        } as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        globalThis.ResizeObserver = originalResizeObserver;
    });

    it('re-measures when the row resizes without a task change (#825)', () => {
        const onMeasure = vi.fn();
        const { unmount } = render(
            <VirtualTaskRow
                taskId="t1"
                index={0}
                top={0}
                onToggleSelectId={() => {}}
                onMeasure={onMeasure}
            />,
        );

        expect(onMeasure).toHaveBeenCalledTimes(1);
        expect(observed).toHaveLength(1);

        const node = observed[0] as HTMLElement;
        vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ height: 480 } as DOMRect);
        resizeCallbacks[0]([], {} as ResizeObserver);

        expect(onMeasure).toHaveBeenLastCalledWith('t1', 480);

        unmount();
        expect(disconnected).toBe(1);
    });
});
