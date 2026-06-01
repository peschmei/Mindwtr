import { describe, expect, it } from 'vitest';
import { shouldOpenDesktopFirstRunOnboarding } from './desktop-onboarding-events';

describe('desktop onboarding events', () => {
    it('opens automatically on a fresh install with empty local data and sync off', () => {
        expect(shouldOpenDesktopFirstRunOnboarding({
            hasHydratedSettings: true,
            isLoading: false,
            dismissed: false,
            visibleDataCount: 0,
            syncBackend: 'off',
        })).toBe(true);
    });

    it('does not reopen after the user dismisses it', () => {
        expect(shouldOpenDesktopFirstRunOnboarding({
            hasHydratedSettings: true,
            isLoading: false,
            dismissed: true,
            visibleDataCount: 0,
            syncBackend: 'off',
        })).toBe(false);
    });

    it('does not interrupt existing data or configured sync', () => {
        expect(shouldOpenDesktopFirstRunOnboarding({
            hasHydratedSettings: true,
            isLoading: false,
            dismissed: false,
            visibleDataCount: 1,
            syncBackend: 'off',
        })).toBe(false);

        expect(shouldOpenDesktopFirstRunOnboarding({
            hasHydratedSettings: true,
            isLoading: false,
            dismissed: false,
            visibleDataCount: 0,
            syncBackend: 'webdav',
        })).toBe(false);
    });
});
