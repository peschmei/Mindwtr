import { describe, expect, it } from 'vitest';
import { getEnglishI18nValue } from '@mindwtr/core';

import {
    buildSettingsMenuSearchText,
    SETTINGS_MENU_KEYWORD_KEYS,
    settingsMenuMatchesQuery,
    type SettingsMenuRowId,
} from './settings.constants';

// Real English translator backed by the actual core en locale table. Mirrors
// language-context's `t`, which returns the key itself when a translation is
// missing — so this catches any keyword key that doesn't resolve.
const t = (key: string): string => getEnglishI18nValue(key) ?? key;

const ROW_TITLE_KEY: Record<SettingsMenuRowId, string> = {
    general: 'settings.general',
    gtd: 'settings.gtd',
    manage: 'settings.manage',
    notifications: 'settings.notifications',
    sync: 'settings.sync',
    data: 'settings.data',
    advanced: 'settings.advanced',
    about: 'settings.about',
};
const ROW_IDS = Object.keys(ROW_TITLE_KEY) as SettingsMenuRowId[];

function visibleRowIds(query: string): SettingsMenuRowId[] {
    return ROW_IDS.filter((id) =>
        settingsMenuMatchesQuery(buildSettingsMenuSearchText(id, t(ROW_TITLE_KEY[id]), undefined, t), query),
    );
}

describe('settings menu search index', () => {
    // Regression guard for the review's HIGH finding: keyword keys were guessed
    // from desktop naming and silently resolved to nothing. Every listed key
    // must be a real English translation, or search misses that content.
    it('every keyword key resolves to a real English translation', () => {
        const unresolved: string[] = [];
        for (const keys of Object.values(SETTINGS_MENU_KEYWORD_KEYS)) {
            for (const key of keys) {
                const value = getEnglishI18nValue(key);
                if (!value || value === key) unresolved.push(key);
            }
        }
        expect(unresolved).toEqual([]);
    });

    it('surfaces the right row for real setting labels and hides unrelated rows', () => {
        // "pomodoro" is a GTD sub-screen setting, not a menu title.
        expect(visibleRowIds('pomodoro')).toEqual(['gtd']);
        // The exact content the review flagged as missing before the fix:
        expect(visibleRowIds('todoist')).toEqual(['data']);
        expect(visibleRowIds('ticktick')).toEqual(['data']);
        expect(visibleRowIds('omnifocus')).toEqual(['data']);
        // "areas" is a Manage sub-setting (areas.manage -> "Areas").
        expect(visibleRowIds('areas')).toEqual(['manage']);
        // AI provider indexed on the Advanced row.
        expect(visibleRowIds('anthropic')).toEqual(['advanced']);
    });

    it('shows every row for an empty or whitespace query', () => {
        expect(visibleRowIds('')).toEqual(ROW_IDS);
        expect(visibleRowIds('   ')).toEqual(ROW_IDS);
    });

    it('drops keys with no translation instead of leaking raw keys into the text', () => {
        const text = buildSettingsMenuSearchText('gtd', t('settings.gtd'), undefined, t);
        expect(text).not.toContain('settings.');
        expect(text).toContain('pomodoro timer');
    });
});
