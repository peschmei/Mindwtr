import type { SyncBackend } from '@mindwtr/core';

export const MINDWTR_DESKTOP_ONBOARDING_EVENT = 'mindwtr:desktop-onboarding';

type DesktopFirstRunOnboardingState = {
    hasHydratedSettings: boolean;
    isLoading: boolean;
    dismissed: boolean;
    visibleDataCount: number;
    syncBackend: SyncBackend;
};

export function shouldOpenDesktopFirstRunOnboarding({
    hasHydratedSettings,
    isLoading,
    dismissed,
    visibleDataCount,
    syncBackend,
}: DesktopFirstRunOnboardingState): boolean {
    return hasHydratedSettings
        && !isLoading
        && !dismissed
        && visibleDataCount === 0
        && syncBackend === 'off';
}

export function dispatchDesktopOnboardingEvent(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MINDWTR_DESKTOP_ONBOARDING_EVENT));
}

export function subscribeDesktopOnboardingEvent(handler: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => undefined;
    }

    const listener: EventListener = () => handler();
    window.addEventListener(MINDWTR_DESKTOP_ONBOARDING_EVENT, listener);
    return () => window.removeEventListener(MINDWTR_DESKTOP_ONBOARDING_EVENT, listener);
}
