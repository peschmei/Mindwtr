import { describe, expect, it } from 'vitest';

import {
    getPromptLocalDayKey,
    recordPromptActivity,
    recordStoreReviewPromptAttempt,
    shouldAttemptStoreReviewPrompt,
    type UserPromptState,
} from './user-prompts';

const dayMs = 24 * 60 * 60 * 1000;
const baseMs = new Date('2026-06-01T12:00:00.000Z').getTime();

const buildEligibleState = (): UserPromptState => {
    let state: UserPromptState = {
        firstSeenAt: new Date(baseMs - 30 * dayMs).toISOString(),
    };
    for (let index = 0; index < 7; index += 1) {
        state = recordPromptActivity(state, baseMs - index * dayMs);
    }
    return state;
};

describe('user prompt state', () => {
    it('records first seen and distinct local active days', () => {
        const first = recordPromptActivity(null, baseMs);
        const second = recordPromptActivity(first, baseMs + 60 * 60 * 1000);
        const third = recordPromptActivity(second, baseMs + dayMs);

        expect(first.firstSeenAt).toBe(new Date(baseMs).toISOString());
        expect(second.firstSeenAt).toBe(first.firstSeenAt);
        expect(third.activeDayKeys).toEqual([
            getPromptLocalDayKey(baseMs),
            getPromptLocalDayKey(baseMs + dayMs),
        ]);
    });

    it('allows store review after enough usage and native availability', () => {
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: buildEligibleState(),
            storeReviewAvailable: true,
        })).toBe(true);
    });

    it('blocks store review before engagement thresholds', () => {
        const newInstall = recordPromptActivity(null, baseMs);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs + 15 * dayMs,
            platform: 'android',
            promptState: newInstall,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('blocks store review on unsupported platforms or unavailable native API', () => {
        const state = buildEligibleState();
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'desktop',
            promptState: state,
            storeReviewAvailable: true,
        })).toBe(false);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: state,
            storeReviewAvailable: false,
        })).toBe(false);
    });

    it('blocks store review after recent attempts or other interruptive prompts', () => {
        const attempted = recordStoreReviewPromptAttempt(buildEligibleState(), baseMs - 10 * dayMs);
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: attempted,
            storeReviewAvailable: true,
        })).toBe(false);

        const otherPrompt: UserPromptState = {
            ...buildEligibleState(),
            lastInterruptivePromptAt: new Date(baseMs - 2 * dayMs).toISOString(),
        };
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'android',
            promptState: otherPrompt,
            storeReviewAvailable: true,
        })).toBe(false);
    });

    it('blocks store review after recent negative signals', () => {
        expect(shouldAttemptStoreReviewPrompt({
            nowMs: baseMs,
            platform: 'ios',
            promptState: buildEligibleState(),
            recentNegativeSignal: true,
            storeReviewAvailable: true,
        })).toBe(false);
    });
});
