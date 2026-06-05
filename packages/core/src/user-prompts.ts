const DAY_MS = 24 * 60 * 60 * 1000;

export const PROMPT_COORDINATOR_COOLDOWN_MS = 7 * DAY_MS;
export const STORE_REVIEW_MIN_DAYS_SINCE_FIRST_SEEN = 14;
export const STORE_REVIEW_MIN_ACTIVE_DAYS = 7;
export const STORE_REVIEW_ATTEMPT_COOLDOWN_MS = 90 * DAY_MS;

export type UserPromptPlatform = 'ios' | 'android' | 'desktop' | 'web' | 'unknown';

export type UserPromptState = {
    firstSeenAt?: string;
    activeDayKeys?: string[];
    lastInterruptivePromptAt?: string;
    storeReview?: {
        lastAttemptAt?: string;
    };
    donation?: {
        askedEver?: boolean;
        lastShownAt?: string;
    };
    update?: {
        dismissedVersion?: string;
        lastCheckedAt?: string;
        lastShownAt?: string;
    };
};

export type StoreReviewPromptInput = {
    nowMs: number;
    platform: UserPromptPlatform;
    promptState: UserPromptState | null | undefined;
    recentNegativeSignal?: boolean;
    storeReviewAvailable: boolean;
};

export function getPromptLocalDayKey(nowMs: number): string {
    const date = new Date(nowMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseTimeMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

function daysSince(value: string | null | undefined, nowMs: number): number | null {
    const thenMs = parseTimeMs(value);
    if (thenMs === null) return null;
    return Math.floor((nowMs - thenMs) / DAY_MS);
}

function isCooldownElapsed(value: string | null | undefined, nowMs: number, cooldownMs: number): boolean {
    const thenMs = parseTimeMs(value);
    if (thenMs === null) return true;
    return nowMs - thenMs >= cooldownMs;
}

export function recordPromptActivity(
    promptState: UserPromptState | null | undefined,
    nowMs: number,
): UserPromptState {
    const nowIso = new Date(nowMs).toISOString();
    const todayKey = getPromptLocalDayKey(nowMs);
    const existingKeys = promptState?.activeDayKeys ?? [];
    const nextKeys = existingKeys.includes(todayKey)
        ? existingKeys
        : [...existingKeys, todayKey].slice(-180);

    return {
        ...(promptState ?? {}),
        activeDayKeys: nextKeys,
        firstSeenAt: promptState?.firstSeenAt ?? nowIso,
    };
}

export function shouldAttemptStoreReviewPrompt({
    nowMs,
    platform,
    promptState,
    recentNegativeSignal = false,
    storeReviewAvailable,
}: StoreReviewPromptInput): boolean {
    if (!storeReviewAvailable) return false;
    if (recentNegativeSignal) return false;
    if (platform !== 'ios' && platform !== 'android') return false;

    const daysSinceFirstSeen = daysSince(promptState?.firstSeenAt, nowMs);
    if (daysSinceFirstSeen === null || daysSinceFirstSeen < STORE_REVIEW_MIN_DAYS_SINCE_FIRST_SEEN) {
        return false;
    }

    const activeDayCount = new Set(promptState?.activeDayKeys ?? []).size;
    if (activeDayCount < STORE_REVIEW_MIN_ACTIVE_DAYS) return false;

    if (!isCooldownElapsed(
        promptState?.storeReview?.lastAttemptAt,
        nowMs,
        STORE_REVIEW_ATTEMPT_COOLDOWN_MS,
    )) {
        return false;
    }

    return isCooldownElapsed(
        promptState?.lastInterruptivePromptAt,
        nowMs,
        PROMPT_COORDINATOR_COOLDOWN_MS,
    );
}

export function recordStoreReviewPromptAttempt(
    promptState: UserPromptState | null | undefined,
    nowMs: number,
): UserPromptState {
    const nowIso = new Date(nowMs).toISOString();
    return {
        ...(promptState ?? {}),
        lastInterruptivePromptAt: nowIso,
        storeReview: {
            ...(promptState?.storeReview ?? {}),
            lastAttemptAt: nowIso,
        },
    };
}
