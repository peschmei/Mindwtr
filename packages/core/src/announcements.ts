export type AppAnnouncementAction =
    | {
        type: 'url';
        label: string;
        url: string;
    }
    | {
        type: 'feedback';
        label: string;
    };

export type AppAnnouncement = {
    id: string;
    title: string;
    body: string;
    action?: AppAnnouncementAction;
};

export const APP_ANNOUNCEMENT_DISMISSED_VALUE = 'dismissed';

// Maintainers can replace null with one active announcement for a specific release.
export const ACTIVE_APP_ANNOUNCEMENT: AppAnnouncement | null = null;

export function getAnnouncementDismissalStorageKey(id: string): string {
    return `mindwtr:announcement-dismissed:${id.trim()}`;
}

export function shouldShowAppAnnouncement(
    announcement: AppAnnouncement | null | undefined,
    dismissedValue: string | null | undefined,
): announcement is AppAnnouncement {
    if (!announcement) return false;
    if (!announcement.id.trim() || !announcement.title.trim() || !announcement.body.trim()) return false;
    return dismissedValue !== APP_ANNOUNCEMENT_DISMISSED_VALUE;
}
