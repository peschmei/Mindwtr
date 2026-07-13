import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncOrchestrator } from './sync-orchestrator';

describe('sync orchestrator', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('re-runs a queued cycle after the in-flight cycle completes', async () => {
        const calls: number[] = [];
        const orchestrator = createSyncOrchestrator<string | undefined, number>({
            runCycle: async (arg) => {
                calls.push(calls.length + 1);
                if (arg === 'initial') {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                }
                return calls.length;
            },
        });

        const first = orchestrator.run('initial');
        const second = orchestrator.run('queued');

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult).toBe(1);
        expect(secondResult).toBe(1);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toHaveLength(2);
    });

    it('uses the latest queued argument for follow-up runs', async () => {
        const args: Array<string | undefined> = [];
        const orchestrator = createSyncOrchestrator<string | undefined, string>({
            runCycle: async (arg) => {
                args.push(arg);
                if (args.length === 1) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                return arg ?? 'none';
            },
        });

        const first = orchestrator.run('first');
        const second = orchestrator.run('second');
        const third = orchestrator.run('third');

        await Promise.all([first, second, third]);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(args).toEqual(['first', 'third']);
    });

    it('can clear a queued follow-up before the in-flight cycle drains', async () => {
        const calls: string[] = [];
        const orchestrator = createSyncOrchestrator<string, string>({
            runCycle: async (arg) => {
                calls.push(arg);
                if (arg === 'first') {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                return arg;
            },
        });

        const first = orchestrator.run('first');
        const second = orchestrator.run('second');
        expect(orchestrator.getState()).toEqual({ inFlight: true, queued: true });

        orchestrator.clearFollowUp();
        expect(orchestrator.getState()).toEqual({ inFlight: true, queued: false });

        await expect(first).resolves.toBe('first');
        await expect(second).resolves.toBe('first');
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(calls).toEqual(['first']);
    });

    it('supports requesting follow-up from inside a running cycle', async () => {
        let calls = 0;
        const orchestrator = createSyncOrchestrator<string | undefined, number>({
            runCycle: async (_arg, { requestFollowUp }) => {
                calls += 1;
                if (calls === 1) {
                    requestFollowUp();
                    await new Promise((resolve) => setTimeout(resolve, 10));
                }
                return calls;
            },
        });

        const result = await orchestrator.run(undefined);
        expect(result).toBe(1);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toBe(2);
    });

    it('delays a queued follow-up by getFollowUpDelayMs instead of re-running immediately', async () => {
        vi.useFakeTimers();
        try {
            const calls: number[] = [];
            const orchestrator = createSyncOrchestrator<undefined, number>({
                getFollowUpDelayMs: () => 5_000,
                runCycle: async (_arg, { requestFollowUp }) => {
                    calls.push(calls.length + 1);
                    if (calls.length === 1) {
                        requestFollowUp();
                    }
                    return calls.length;
                },
            });

            await orchestrator.run(undefined);
            expect(calls).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(4_999);
            expect(calls).toHaveLength(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(calls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets a direct run during the follow-up delay absorb the queued cycle', async () => {
        vi.useFakeTimers();
        try {
            const calls: Array<string | undefined> = [];
            const orchestrator = createSyncOrchestrator<string | undefined, number>({
                getFollowUpDelayMs: () => 5_000,
                runCycle: async (arg, { requestFollowUp }) => {
                    calls.push(arg);
                    if (calls.length === 1) {
                        requestFollowUp();
                    }
                    return calls.length;
                },
            });

            await orchestrator.run('first');
            expect(calls).toHaveLength(1);

            await orchestrator.run('manual');
            expect(calls).toHaveLength(2);

            await vi.advanceTimersByTimeAsync(10_000);
            expect(calls).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats synchronous re-entrant calls as queued while the first cycle is in flight', async () => {
        const args: Array<string | undefined> = [];
        const nestedCallStates: Array<{ inFlight: boolean; queued: boolean }> = [];
        const orchestrator = createSyncOrchestrator<string | undefined, string>({
            runCycle: async (arg) => {
                args.push(arg);
                if (arg === 'first') {
                    void orchestrator.run('second');
                    nestedCallStates.push(orchestrator.getState());
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
                return arg ?? 'none';
            },
        });

        const result = await orchestrator.run('first');
        expect(result).toBe('first');
        expect(nestedCallStates).toEqual([{ inFlight: true, queued: true }]);

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(args).toEqual(['first', 'second']);
    });
});
