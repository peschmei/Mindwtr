import type { ExternalCalendarEvent, ExternalCalendarSubscription } from '@mindwtr/core';
import { isTauriRuntime } from './runtime';
import { reportError } from './report-error';

export type SystemCalendarPermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unsupported';

export type SystemCalendarPushTarget = {
    id: string;
    name: string;
    sourceName?: string;
    color?: string;
    isMindwtrDedicated: boolean;
};

export type SystemCalendarEventDetails = {
    calendarId: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    notes?: string;
    location?: string;
};

type MacOsCalendarReadResult = {
    permission: SystemCalendarPermissionStatus;
    calendars: ExternalCalendarSubscription[];
    events: ExternalCalendarEvent[];
};

type MacOsCalendarEventWriteResult = {
    ok?: boolean;
    eventId?: string;
    error?: string;
};

const UNSUPPORTED_RESULT: MacOsCalendarReadResult = {
    permission: 'unsupported',
    calendars: [],
    events: [],
};

const normalizePermissionStatus = (value: unknown): SystemCalendarPermissionStatus => {
    if (value === 'undetermined' || value === 'granted' || value === 'denied' || value === 'unsupported') {
        return value;
    }
    return 'denied';
};

const isMacOsEnvironment = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const source = `${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
    return source.includes('mac');
};

async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const mod = await import('@tauri-apps/api/core');
    return mod.invoke<T>(command as never, args as never);
}

export async function getSystemCalendarPermissionStatus(): Promise<SystemCalendarPermissionStatus> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return 'unsupported';
    try {
        const status = await tauriInvoke<string>('get_macos_calendar_permission_status');
        return normalizePermissionStatus(status);
    } catch (error) {
        reportError('Failed to read macOS calendar permission status', error);
        return 'denied';
    }
}

export async function requestSystemCalendarPermission(): Promise<SystemCalendarPermissionStatus> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return 'unsupported';
    try {
        const status = await tauriInvoke<string>('request_macos_calendar_permission');
        return normalizePermissionStatus(status);
    } catch (error) {
        reportError('Failed to request macOS calendar permission', error);
        return 'denied';
    }
}

export async function fetchSystemCalendarEvents(rangeStart: Date, rangeEnd: Date): Promise<MacOsCalendarReadResult> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return UNSUPPORTED_RESULT;
    try {
        const payload = await tauriInvoke<MacOsCalendarReadResult>('get_macos_calendar_events', {
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
        });
        return {
            permission: normalizePermissionStatus(payload?.permission),
            calendars: Array.isArray(payload?.calendars) ? payload.calendars : [],
            events: Array.isArray(payload?.events) ? payload.events : [],
        };
    } catch (error) {
        reportError('Failed to read macOS EventKit events', error);
        return {
            permission: 'denied',
            calendars: [],
            events: [],
        };
    }
}

const sanitizePushTarget = (target: SystemCalendarPushTarget): SystemCalendarPushTarget | null => {
    const id = typeof target?.id === 'string' ? target.id.trim() : '';
    if (!id) return null;
    const name = typeof target?.name === 'string' && target.name.trim().length > 0
        ? target.name.trim()
        : 'Calendar';
    return {
        id,
        name,
        sourceName: typeof target.sourceName === 'string' && target.sourceName.trim().length > 0
            ? target.sourceName.trim()
            : undefined,
        color: typeof target.color === 'string' && target.color.trim().length > 0 ? target.color.trim() : undefined,
        isMindwtrDedicated: target.isMindwtrDedicated === true,
    };
};

export async function getSystemCalendarPushTargets(): Promise<SystemCalendarPushTarget[]> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return [];
    try {
        const targets = await tauriInvoke<SystemCalendarPushTarget[]>('get_macos_writable_calendars');
        return Array.isArray(targets)
            ? targets.map(sanitizePushTarget).filter((target): target is SystemCalendarPushTarget => Boolean(target))
            : [];
    } catch (error) {
        reportError('Failed to read writable macOS calendars', error);
        return [];
    }
}

export async function ensureSystemMindwtrCalendar(storedCalendarId?: string | null): Promise<SystemCalendarPushTarget | null> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return null;
    try {
        const target = await tauriInvoke<SystemCalendarPushTarget | null>('ensure_macos_mindwtr_calendar', {
            storedCalendarId: storedCalendarId?.trim() || null,
        });
        return target ? sanitizePushTarget(target) : null;
    } catch (error) {
        reportError('Failed to create Mindwtr macOS calendar', error);
        return null;
    }
}

const resolveWriteResultEventId = (result: MacOsCalendarEventWriteResult | null | undefined): string | null => {
    if (!result?.ok) return null;
    const eventId = typeof result.eventId === 'string' ? result.eventId.trim() : '';
    return eventId || null;
};

export async function createSystemCalendarEvent(details: SystemCalendarEventDetails): Promise<string | null> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return null;
    try {
        const result = await tauriInvoke<MacOsCalendarEventWriteResult>('create_macos_calendar_event', { details });
        return resolveWriteResultEventId(result);
    } catch (error) {
        reportError('Failed to create macOS calendar event', error);
        return null;
    }
}

export async function updateSystemCalendarEvent(eventId: string, details: SystemCalendarEventDetails): Promise<string | null> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return null;
    try {
        const result = await tauriInvoke<MacOsCalendarEventWriteResult>('update_macos_calendar_event', { eventId, details });
        return resolveWriteResultEventId(result);
    } catch (error) {
        reportError('Failed to update macOS calendar event', error);
        return null;
    }
}

export async function deleteSystemCalendarEvent(eventId: string): Promise<boolean> {
    if (!isTauriRuntime() || !isMacOsEnvironment()) return false;
    try {
        const result = await tauriInvoke<MacOsCalendarEventWriteResult>('delete_macos_calendar_event', { eventId });
        return result?.ok === true;
    } catch (error) {
        reportError('Failed to delete macOS calendar event', error);
        return false;
    }
}
