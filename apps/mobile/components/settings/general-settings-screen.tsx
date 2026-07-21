import React, { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
    canUseJalaliCalendar,
    normalizeDateFormatSetting,
    normalizeTimeFormatSetting,
    normalizeWeekStartPreference,
    resolveCalendarSystemSetting,
    tFallback,
    useTaskStore,
} from '@mindwtr/core';

import { useTheme } from '@/contexts/theme-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import {
    coerceMobileQuickAccessView,
    MOBILE_QUICK_ACCESS_VIEWS,
} from '@/lib/mobile-quick-access-view';
import { authenticateWithDeviceLock, getMobileAppLockErrorKey } from '@/lib/mobile-app-lock';

import { SettingRow, SettingToggleRow } from './setting-row';
import { LANGUAGES } from './settings.constants';
import { useSettingsLocalization, useSettingsScrollContent } from './settings.hooks';
import { SettingsTopBar } from './settings.shell';
import { styles } from './settings.styles';

export function GeneralSettingsScreen() {
    const { themeMode, setThemeMode } = useTheme();
    const { language, tr, setLanguage, t } = useSettingsLocalization();
    const { settings, updateSettings } = useTaskStore();
    const tc = useThemeColors();
    const scrollContentStyle = useSettingsScrollContent();
    const [themePickerOpen, setThemePickerOpen] = useState(false);
    const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
    const [weekStartPickerOpen, setWeekStartPickerOpen] = useState(false);
    const [dateFormatPickerOpen, setDateFormatPickerOpen] = useState(false);
    const [calendarSystemPickerOpen, setCalendarSystemPickerOpen] = useState(false);
    const [timeFormatPickerOpen, setTimeFormatPickerOpen] = useState(false);
    const [quickAccessPickerOpen, setQuickAccessPickerOpen] = useState(false);
    const [appLockBusy, setAppLockBusy] = useState(false);
    const [appLockErrorKey, setAppLockErrorKey] = useState<string | null>(null);

    const weekStart = normalizeWeekStartPreference(settings.weekStart);
    const dateFormat = normalizeDateFormatSetting(settings.dateFormat);
    const timeFormat = normalizeTimeFormatSetting(settings.timeFormat);
    const systemLocale = typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
        ? Intl.DateTimeFormat().resolvedOptions().locale
        : '';
    const showCalendarSystem = canUseJalaliCalendar({ language, systemLocale });
    const calendarSystem = resolveCalendarSystemSetting(settings.calendarSystem, { language, systemLocale });
    const showTaskAge = settings.appearance?.showTaskAge === true;
    const quickAccessView = coerceMobileQuickAccessView(settings.appearance?.mobileQuickAccessView);
    const appLockEnabled = settings.security?.mobileAppLockEnabled === true;
    const baseThemeOptions: { value: typeof themeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
        { value: 'system', label: t('settings.system'), icon: 'phone-portrait-outline' },
        { value: 'light', label: t('settings.light'), icon: 'sunny-outline' },
        { value: 'dark', label: t('settings.dark'), icon: 'moon-outline' },
    ];
    const styledThemeOptions: { value: typeof themeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
        { value: 'material3-light', label: t('settings.material3Light'), icon: 'color-palette-outline' },
        { value: 'material3-dark', label: t('settings.material3Dark'), icon: 'color-palette-outline' },
        { value: 'eink', label: t('settings.eink'), icon: 'document-text-outline' },
        { value: 'nord', label: t('settings.nord'), icon: 'snow-outline' },
        { value: 'sepia', label: t('settings.sepia'), icon: 'book-outline' },
        { value: 'oled', label: t('settings.oled'), icon: 'contrast-outline' },
    ];
    const themeOptions = [...baseThemeOptions, ...styledThemeOptions];
    const currentThemeLabel = themeOptions.find((opt) => opt.value === themeMode)?.label ?? t('settings.system');
    const quickAccessOptions = MOBILE_QUICK_ACCESS_VIEWS.map((value) => ({
        value,
        label: value === 'review'
            ? t('tab.review')
            : value === 'projects'
                ? t('nav.projects')
                : value === 'calendar'
                    ? t('nav.calendar')
                    : t('nav.contexts'),
    }));
    const currentQuickAccessLabel = quickAccessOptions.find((opt) => opt.value === quickAccessView)?.label ?? t('tab.review');
    const weekStartOptions: { value: 'system' | 'sunday' | 'monday' | 'saturday'; label: string }[] = [
        { value: 'system', label: tFallback(t, 'settings.weekStartSystem', 'System default') },
        { value: 'sunday', label: t('settings.weekStartSunday') },
        { value: 'monday', label: t('settings.weekStartMonday') },
        { value: 'saturday', label: t('settings.weekStartSaturday') },
    ];
    const currentWeekStartLabel = weekStartOptions.find((opt) => opt.value === weekStart)?.label ?? tFallback(t, 'settings.weekStartSystem', 'System default');
    const dateFormatOptions: { value: 'system' | 'dmy' | 'mdy' | 'ymd'; label: string }[] = [
        { value: 'system', label: t('settings.dateFormatSystem') },
        { value: 'dmy', label: t('settings.dateFormatDmy') },
        { value: 'mdy', label: t('settings.dateFormatMdy') },
        { value: 'ymd', label: t('settings.dateFormatYmd') },
    ];
    const currentDateFormatLabel = dateFormatOptions.find((opt) => opt.value === dateFormat)?.label ?? t('settings.dateFormatSystem');
    const calendarSystemOptions: { value: 'gregorian' | 'jalali'; label: string }[] = [
        { value: 'gregorian', label: t('settings.calendarSystemGregorian') },
        { value: 'jalali', label: t('settings.calendarSystemJalali') },
    ];
    const currentCalendarSystemLabel = calendarSystemOptions.find((opt) => opt.value === calendarSystem)?.label
        ?? t('settings.calendarSystemGregorian');
    const timeFormatOptions: { value: 'system' | '12h' | '24h'; label: string }[] = [
        { value: 'system', label: t('settings.timeFormatSystem') },
        { value: '12h', label: t('settings.timeFormat12h') },
        { value: '24h', label: t('settings.timeFormat24h') },
    ];
    const currentTimeFormatLabel = timeFormatOptions.find((opt) => opt.value === timeFormat)?.label ?? t('settings.timeFormatSystem');
    const handleAppLockToggle = useCallback((value: boolean) => {
        setAppLockErrorKey(null);
        if (!value) {
            updateSettings({
                security: {
                    ...(settings.security ?? {}),
                    mobileAppLockEnabled: false,
                },
            }).catch(console.error);
            return;
        }

        if (appLockBusy) return;
        setAppLockBusy(true);
        authenticateWithDeviceLock({
            promptMessage: tr('appLock.enablePrompt'),
            cancelLabel: tr('common.cancel'),
            fallbackLabel: tr('appLock.useDevicePasscode'),
        })
            .then((result) => {
                if (!result.success) {
                    setAppLockErrorKey(getMobileAppLockErrorKey(result.reason));
                    return;
                }
                updateSettings({
                    security: {
                        ...(settings.security ?? {}),
                        mobileAppLockEnabled: true,
                    },
                }).catch(console.error);
            })
            .catch(() => setAppLockErrorKey('appLock.failed'))
            .finally(() => setAppLockBusy(false));
    }, [appLockBusy, settings.security, tr, updateSettings]);
    const appLockError = appLockErrorKey ? tr(appLockErrorKey) : null;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: tc.bg }]} edges={['bottom']}>
            <SettingsTopBar title={t('settings.general')} />
            <ScrollView style={styles.scrollView} contentContainerStyle={scrollContentStyle}>
                <Text style={[styles.sectionTitle, { color: tc.secondaryText }]}>{t('settings.appearance')}</Text>
                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <SettingRow
                        onPress={() => setThemePickerOpen(true)}
                        label={t('settings.theme')}
                        description={currentThemeLabel}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                    <SettingToggleRow
                        divider
                        label={tr('settings.mobile.showTaskAge')}
                        description={tr('settings.mobile.displayHowLongAgoATaskWasCreatedInTask')}
                        value={showTaskAge}
                        onChange={(value) => {
                            updateSettings({
                                appearance: {
                                    ...(settings.appearance ?? {}),
                                    showTaskAge: value,
                                },
                            }).catch(console.error);
                        }}
                        trackColor={{ false: tc.secondaryText, true: tc.tint }}
                    />
                    <SettingRow
                        divider
                        onPress={() => setQuickAccessPickerOpen(true)}
                        label={tr('settings.mobile.quickAccessView')}
                        description={currentQuickAccessLabel}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                </View>

                <Text style={[styles.sectionTitle, { color: tc.secondaryText, marginTop: 16 }]}>{tr('settings.privacy')}</Text>
                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <View style={styles.settingRow}>
                        <View style={styles.settingInfo}>
                            <Text style={[styles.settingLabel, { color: tc.text }]}>{tr('settings.mobile.appLock')}</Text>
                            <Text style={[styles.settingDescription, { color: tc.secondaryText }]}>
                                {tr('settings.mobile.appLockDesc')}
                            </Text>
                            {appLockError && (
                                <Text style={[styles.settingDescription, { color: tc.danger, marginTop: 6 }]}>
                                    {appLockError}
                                </Text>
                            )}
                        </View>
                        <Switch
                            disabled={appLockBusy}
                            value={appLockEnabled}
                            onValueChange={handleAppLockToggle}
                            trackColor={{ false: tc.secondaryText, true: tc.tint }}
                        />
                    </View>
                </View>

                <Modal
                    transparent
                    visible={themePickerOpen}
                    animationType="fade"
                    onRequestClose={() => setThemePickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setThemePickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.theme')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {themeOptions.map((option, index) => {
                                    const selected = option.value === themeMode;
                                    const startsStyledThemes = index === baseThemeOptions.length;
                                    return (
                                        <React.Fragment key={option.value}>
                                            {startsStyledThemes && (
                                                <View style={{ borderTopWidth: 1, borderTopColor: tc.border, marginVertical: 8 }} />
                                            )}
                                            <TouchableOpacity
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected }}
                                                style={[
                                                    styles.pickerOption,
                                                    { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                                ]}
                                                onPress={() => {
                                                    setThemeMode(option.value);
                                                    updateSettings({ theme: option.value }).catch(console.error);
                                                    setThemePickerOpen(false);
                                                }}
                                            >
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                                                    <View
                                                        style={{
                                                            width: 32,
                                                            height: 32,
                                                            borderRadius: 16,
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            backgroundColor: tc.filterBg,
                                                            borderWidth: 1,
                                                            borderColor: selected ? tc.tint : tc.border,
                                                        }}
                                                    >
                                                        <Ionicons
                                                            color={selected ? tc.tint : tc.secondaryText}
                                                            name={option.icon}
                                                            size={17}
                                                        />
                                                    </View>
                                                    <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                        {option.label}
                                                    </Text>
                                                </View>
                                                {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                            </TouchableOpacity>
                                        </React.Fragment>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>
                <Modal
                    transparent
                    visible={quickAccessPickerOpen}
                    animationType="fade"
                    onRequestClose={() => setQuickAccessPickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setQuickAccessPickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{tr('settings.mobile.quickAccessView')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {quickAccessOptions.map((option) => {
                                    const selected = quickAccessView === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={[
                                                styles.pickerOption,
                                                { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                            ]}
                                            onPress={() => {
                                                updateSettings({
                                                    appearance: {
                                                        ...(settings.appearance ?? {}),
                                                        mobileQuickAccessView: option.value,
                                                    },
                                                }).catch(console.error);
                                                setQuickAccessPickerOpen(false);
                                            }}
                                        >
                                            <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                {option.label}
                                            </Text>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>

                <Text style={[styles.sectionTitle, { color: tc.secondaryText, marginTop: 16 }]}>{t('settings.language')}</Text>
                <Text style={[styles.description, { color: tc.secondaryText }]}>{t('settings.selectLang')}</Text>
                <View style={[styles.settingCard, { backgroundColor: tc.cardBg }]}>
                    <SettingRow
                        onPress={() => setLanguagePickerOpen(true)}
                        label={t('settings.language')}
                        description={LANGUAGES.find((lang) => lang.id === language)?.native ?? language}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                </View>
                <Modal
                    transparent
                    visible={languagePickerOpen}
                    animationType="fade"
                    onRequestClose={() => setLanguagePickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setLanguagePickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.language')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {LANGUAGES.map((lang) => {
                                    const selected = language === lang.id;
                                    return (
                                        <TouchableOpacity
                                            key={lang.id}
                                            style={[
                                                styles.pickerOption,
                                                { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                            ]}
                                            onPress={() => {
                                                setLanguage(lang.id);
                                                updateSettings({ language: lang.id }).catch(console.error);
                                                setLanguagePickerOpen(false);
                                            }}
                                        >
                                            <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                {lang.native}
                                            </Text>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginTop: 12 }]}>
                    <SettingRow
                        onPress={() => setWeekStartPickerOpen(true)}
                        label={t('settings.weekStart')}
                        description={currentWeekStartLabel}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                </View>
                <Modal
                    transparent
                    visible={weekStartPickerOpen}
                    animationType="fade"
                    onRequestClose={() => setWeekStartPickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setWeekStartPickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.weekStart')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {weekStartOptions.map((option) => {
                                    const selected = weekStart === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={[
                                                styles.pickerOption,
                                                { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                            ]}
                                            onPress={() => {
                                                updateSettings({ weekStart: option.value }).catch(console.error);
                                                setWeekStartPickerOpen(false);
                                            }}
                                        >
                                            <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                {option.label}
                                            </Text>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginTop: 12 }]}>
                    <SettingRow
                        onPress={() => setDateFormatPickerOpen(true)}
                        label={t('settings.dateFormat')}
                        description={currentDateFormatLabel}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                </View>
                <Modal
                    transparent
                    visible={dateFormatPickerOpen}
                    animationType="fade"
                    onRequestClose={() => setDateFormatPickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setDateFormatPickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.dateFormat')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {dateFormatOptions.map((option) => {
                                    const selected = dateFormat === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={[
                                                styles.pickerOption,
                                                { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                            ]}
                                            onPress={() => {
                                                updateSettings({ dateFormat: option.value }).catch(console.error);
                                                setDateFormatPickerOpen(false);
                                            }}
                                        >
                                            <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                {option.label}
                                            </Text>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>

                {showCalendarSystem && (
                    <>
                        <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginTop: 12 }]}>
                            <SettingRow
                                onPress={() => setCalendarSystemPickerOpen(true)}
                                label={t('settings.calendarSystem')}
                                description={currentCalendarSystemLabel}
                            >
                                <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                            </SettingRow>
                        </View>
                        <Modal
                            transparent
                            visible={calendarSystemPickerOpen}
                            animationType="fade"
                            onRequestClose={() => setCalendarSystemPickerOpen(false)}
                        >
                            <Pressable style={styles.pickerOverlay} onPress={() => setCalendarSystemPickerOpen(false)}>
                                <View
                                    style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                                    onStartShouldSetResponder={() => true}
                                >
                                    <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.calendarSystem')}</Text>
                                    <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                        {calendarSystemOptions.map((option) => {
                                            const selected = calendarSystem === option.value;
                                            return (
                                                <TouchableOpacity
                                                    key={option.value}
                                                    style={[
                                                        styles.pickerOption,
                                                        { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                                    ]}
                                                    onPress={() => {
                                                        updateSettings({ calendarSystem: option.value }).catch(console.error);
                                                        setCalendarSystemPickerOpen(false);
                                                    }}
                                                >
                                                    <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                        {option.label}
                                                    </Text>
                                                    {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                </View>
                            </Pressable>
                        </Modal>
                    </>
                )}

                <View style={[styles.settingCard, { backgroundColor: tc.cardBg, marginTop: 12 }]}>
                    <SettingRow
                        onPress={() => setTimeFormatPickerOpen(true)}
                        label={t('settings.timeFormat')}
                        description={currentTimeFormatLabel}
                    >
                        <Ionicons color={tc.secondaryText} name="chevron-down" size={18} />
                    </SettingRow>
                </View>
                <Modal
                    transparent
                    visible={timeFormatPickerOpen}
                    animationType="fade"
                    onRequestClose={() => setTimeFormatPickerOpen(false)}
                >
                    <Pressable style={styles.pickerOverlay} onPress={() => setTimeFormatPickerOpen(false)}>
                        <View
                            style={[styles.pickerCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                            onStartShouldSetResponder={() => true}
                        >
                            <Text style={[styles.pickerTitle, { color: tc.text }]}>{t('settings.timeFormat')}</Text>
                            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
                                {timeFormatOptions.map((option) => {
                                    const selected = timeFormat === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={[
                                                styles.pickerOption,
                                                { borderColor: tc.border, backgroundColor: selected ? tc.filterBg : 'transparent' },
                                            ]}
                                            onPress={() => {
                                                updateSettings({ timeFormat: option.value }).catch(console.error);
                                                setTimeFormatPickerOpen(false);
                                            }}
                                        >
                                            <Text style={[styles.pickerOptionText, { color: selected ? tc.tint : tc.text }]}>
                                                {option.label}
                                            </Text>
                                            {selected && <Ionicons color={tc.tint} name="checkmark" size={18} />}
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </Pressable>
                </Modal>
            </ScrollView>
        </SafeAreaView>
    );
}
