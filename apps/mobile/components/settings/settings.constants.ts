import type { Language } from '@/contexts/language-context';

export type SettingsScreen =
    | 'main'
    | 'general'
    | 'notifications'
    | 'ai'
    | 'calendar'
    | 'advanced'
    | 'gtd'
    | 'gtd-archive'
    | 'gtd-capture'
    | 'gtd-inbox'
    | 'gtd-pomodoro'
    | 'gtd-review'
    | 'gtd-time-estimates'
    | 'gtd-task-editor'
    | 'manage'
    | 'sync'
    | 'data'
    | 'about';

export const SETTINGS_SCREEN_SET: Record<SettingsScreen, true> = {
    main: true,
    general: true,
    notifications: true,
    ai: true,
    calendar: true,
    advanced: true,
    gtd: true,
    'gtd-archive': true,
    'gtd-capture': true,
    'gtd-inbox': true,
    'gtd-pomodoro': true,
    'gtd-review': true,
    'gtd-time-estimates': true,
    'gtd-task-editor': true,
    manage: true,
    sync: true,
    data: true,
    about: true,
};

// Root settings-menu rows the search field filters (see settings.tsx). Each id
// maps to the i18n keys of the settings its sub-screen(s) render, so the search
// keywords come from the *translated* setting labels and can't drift when new
// settings are added. Keep in step with the sub-screens under components/settings.
export type SettingsMenuRowId =
    | 'general'
    | 'gtd'
    | 'manage'
    | 'notifications'
    | 'sync'
    | 'data'
    | 'advanced'
    | 'about';

// Every key here must be a REAL i18n key that the row's sub-screen actually
// renders — verified against packages/core/src/i18n/locales/en.ts and the
// screen source. Mobile namespaces mobile-only labels under settings.mobile.*,
// settings.gtdMobile.*, settings.syncMobile.*, settings.calendarMobile.*, and
// some settings live on non-"settings" screens (areas.manage, contexts.title,
// tags.title). settings.search.test.ts asserts every key resolves, so a wrong
// or invented key fails CI rather than silently contributing nothing.
export const SETTINGS_MENU_KEYWORD_KEYS: Record<SettingsMenuRowId, readonly string[]> = {
    general: [
        'settings.appearance', 'settings.theme', 'settings.language', 'settings.weekStart',
        'settings.dateFormat', 'settings.timeFormat', 'settings.calendarSystem',
        'settings.mobile.showTaskAge', 'settings.mobile.appLock', 'settings.privacy',
    ],
    gtd: [
        'settings.features', 'settings.featurePomodoro', 'settings.gtdMobile.pomodoroSettings',
        'settings.timeEstimatePresets', 'settings.autoArchive', 'settings.taskEditorLayout',
        'settings.captureDefault', 'settings.inboxProcessing', 'settings.gtdMobile.defaultScheduleTime',
        'settings.focusTaskLimit', 'settings.defaultProjectFlowMode', 'settings.defaultArea',
        'settings.weeklyReviewConfig', 'settings.dailyReviewConfig',
    ],
    // manage-settings-screen renders areas/contexts/tags via non-settings keys.
    // People has no dedicated title key in en.ts, so it is intentionally omitted.
    manage: ['settings.manage', 'areas.manage', 'contexts.title', 'tags.title', 'settings.unassignedAreaColor'],
    notifications: [
        'settings.notifications', 'settings.dailyDigest', 'settings.weeklyReview',
        'settings.dueDateNotifications', 'settings.startDateNotifications', 'settings.persistentCaptureLabel',
    ],
    // Sync screen (mode === 'sync'): backends + recovery snapshots.
    sync: [
        'settings.sync', 'settings.syncBackend', 'settings.syncBackendWebdav',
        'settings.cloudProviderDropbox', 'settings.syncHistory', 'settings.recoverySnapshots',
    ],
    // Data screen (mode === 'data'): backup/export/restore, per-source imports, diagnostics.
    data: [
        'settings.data', 'settings.backup', 'settings.exportBackup', 'settings.syncMobile.restoreBackup',
        'settings.syncMobile.importFromTodoist', 'settings.syncMobile.importFromTicktick',
        'settings.syncMobile.importFromDgtGtd', 'settings.syncMobile.importFromOmnifocus',
        'settings.diagnostics', 'settings.debugLogging',
    ],
    // Advanced is a two-level menu; index the real AI + Calendar leaf settings.
    advanced: [
        'settings.advanced', 'settings.ai', 'settings.aiProvider', 'settings.aiModel', 'settings.aiApiKey',
        'settings.aiProviderOpenAI', 'settings.aiProviderAnthropic', 'settings.aiProviderGemini',
        'settings.calendar', 'settings.calendarMobile.icsSubscriptions',
    ],
    about: ['settings.about', 'settings.changelog', 'settings.checkForUpdates', 'settings.documentation'],
};

// Build the searchable haystack for a menu row: its title, description, and the
// translated labels of the settings its sub-screen renders. `t` returns the key
// itself when a translation is missing, so those non-labels are dropped.
export function buildSettingsMenuSearchText(
    id: SettingsMenuRowId,
    title: string,
    description: string | undefined,
    t: (key: string) => string,
): string {
    const keywordLabels = (SETTINGS_MENU_KEYWORD_KEYS[id] ?? [])
        .map((key) => ({ key, value: t(key) }))
        // `t` returns the key when a translation is missing; drop those non-labels.
        .filter(({ key, value }) => value && value !== key)
        .map(({ value }) => value);
    return [title, description ?? '', ...keywordLabels].join(' ').toLowerCase();
}

export function settingsMenuMatchesQuery(searchText: string, query: string): boolean {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return true;
    return searchText.includes(trimmed);
}

export const LANGUAGES: { id: Language; native: string }[] = [
    { id: 'en', native: 'English' },
    { id: 'vi', native: 'Tiếng Việt' },
    { id: 'zh', native: '中文（简体）' },
    { id: 'zh-Hant', native: '中文（繁體）' },
    { id: 'es', native: 'Español' },
    { id: 'hi', native: 'हिन्दी' },
    { id: 'ar', native: 'العربية' },
    { id: 'de', native: 'Deutsch' },
    { id: 'ru', native: 'Русский' },
    { id: 'ja', native: '日本語' },
    { id: 'fr', native: 'Français' },
    { id: 'pt', native: 'Português' },
    { id: 'pl', native: 'Polski' },
    { id: 'cs', native: 'Čeština' },
    { id: 'ko', native: '한국어' },
    { id: 'it', native: 'Italiano' },
    { id: 'tr', native: 'Türkçe' },
    { id: 'nl', native: 'Nederlands' },
];

export const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
export const WHISPER_MODELS: { id: string; fileName: string; label: string; minBytes: number; sha256: string; sizeBytes: number }[] = [
    { id: 'whisper-tiny', fileName: 'ggml-tiny.bin', label: 'whisper-tiny', minBytes: 77691713, sizeBytes: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
    { id: 'whisper-tiny.en', fileName: 'ggml-tiny.en.bin', label: 'whisper-tiny.en', minBytes: 77704715, sizeBytes: 77704715, sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f' },
    { id: 'whisper-base', fileName: 'ggml-base.bin', label: 'whisper-base', minBytes: 147951465, sizeBytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
    { id: 'whisper-base.en', fileName: 'ggml-base.en.bin', label: 'whisper-base.en', minBytes: 147964211, sizeBytes: 147964211, sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002' },
];
export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0]?.id ?? 'whisper-tiny';

export const UPDATE_BADGE_AVAILABLE_KEY = 'mindwtr-update-available';
export const UPDATE_BADGE_LAST_CHECK_KEY = 'mindwtr-update-last-check';
export const UPDATE_BADGE_LATEST_KEY = 'mindwtr-update-latest';
export const UPDATE_BADGE_INTERVAL_MS = 1000 * 60 * 60 * 24;
export const AI_PROVIDER_CONSENT_KEY = 'mindwtr-ai-provider-consent-v1';

export const FOSS_LOCAL_LLM_MODEL_OPTIONS = ['llama3.2', 'qwen2.5', 'mistral', 'phi-4-mini'];
export const FOSS_LOCAL_LLM_COPILOT_OPTIONS = ['llama3.2', 'qwen2.5', 'mistral', 'phi-4-mini'];

export type MobileExtraConfig = {
    analyticsHeartbeatUrl?: string;
    analyticsHeartbeatChannel?: string;
    analyticsReleaseVersion?: string;
    feedbackEndpointUrl?: string;
    isFossBuild?: boolean | string;
    dropboxAppKey?: string;
    promptTestControlsEnabled?: boolean | string;
};

export type CloudProvider = 'selfhosted' | 'dropbox' | 'cloudkit';

export const isValidHttpUrl = (value: string): boolean => {
    if (!value.trim()) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
};
