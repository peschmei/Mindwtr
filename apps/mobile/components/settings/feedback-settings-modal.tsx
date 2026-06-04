import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Bug, Lightbulb, MessageSquare, X, type LucideIcon } from 'lucide-react-native';

import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@mindwtr/core';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { styles } from './settings.styles';

export type FeedbackSubmitInput = {
    category: FeedbackCategory;
    message: string;
    email?: string;
    includeDiagnostics: boolean;
};

type FeedbackSettingsModalProps = {
    visible: boolean;
    isConfigured: boolean;
    tr: (key: string) => string;
    onClose: () => void;
    onSubmit: (input: FeedbackSubmitInput) => Promise<void>;
};

const categoryIcons: Record<FeedbackCategory, LucideIcon> = {
    bug: Bug,
    feature: Lightbulb,
    other: MessageSquare,
};

export function FeedbackSettingsModal({
    isConfigured,
    onClose,
    onSubmit,
    tr,
    visible,
}: FeedbackSettingsModalProps) {
    const tc = useThemeColors();
    const [category, setCategory] = useState<FeedbackCategory>('bug');
    const [message, setMessage] = useState('');
    const [email, setEmail] = useState('');
    const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!visible) return;
        setStatus('idle');
        setError(null);
    }, [visible]);

    useEffect(() => {
        if (category === 'bug') return;
        setIncludeDiagnostics(false);
    }, [category]);

    const categoryLabels = useMemo<Record<FeedbackCategory, string>>(() => ({
        bug: tr('settings.feedbackCategoryBug'),
        feature: tr('settings.feedbackCategoryFeature'),
        other: tr('settings.feedbackCategoryOther'),
    }), [tr]);

    const trimmedMessage = message.trim();
    const trimmedEmail = email.trim();
    const emailValid = !trimmedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    const canSubmit = isConfigured && trimmedMessage.length > 0 && emailValid && status !== 'sending';
    const visibleError = error
        ?? (!isConfigured ? tr('settings.feedbackUnavailable') : null)
        ?? (trimmedEmail && !emailValid ? tr('settings.feedbackInvalidEmail') : null);

    const submit = async () => {
        if (!trimmedMessage) {
            setError(tr('settings.feedbackRequired'));
            return;
        }
        if (!emailValid) {
            setError(tr('settings.feedbackInvalidEmail'));
            return;
        }
        setStatus('sending');
        setError(null);
        try {
            await onSubmit({
                category,
                email: trimmedEmail || undefined,
                includeDiagnostics: category === 'bug' && includeDiagnostics,
                message: trimmedMessage,
            });
            setStatus('sent');
            setMessage('');
            setEmail('');
            setIncludeDiagnostics(false);
        } catch {
            setStatus('error');
            setError(tr('settings.feedbackFailed'));
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.feedbackModalOverlay}
            >
                <Pressable style={styles.feedbackModalBackdrop} onPress={onClose}>
                    <Pressable
                        style={[styles.feedbackModalCard, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
                        onPress={(event) => event.stopPropagation()}
                    >
                        <View style={[styles.feedbackModalHeader, { borderBottomColor: tc.border }]}>
                            <View style={styles.feedbackModalTitleBlock}>
                                <Text style={[styles.feedbackModalTitle, { color: tc.text }]}>
                                    {tr('settings.feedback')}
                                </Text>
                                <Text style={[styles.feedbackModalSubtitle, { color: tc.secondaryText }]}>
                                    {tr('settings.feedbackDesc')}
                                </Text>
                            </View>
                            <TouchableOpacity
                                accessibilityLabel={tr('common.close')}
                                onPress={onClose}
                                style={styles.feedbackCloseButton}
                            >
                                <X size={20} color={tc.secondaryText} />
                            </TouchableOpacity>
                        </View>

                        {status === 'sent' ? (
                            <View style={styles.feedbackModalBody}>
                                <View style={[styles.feedbackNotice, { backgroundColor: `${tc.success}22`, borderColor: `${tc.success}55` }]}>
                                    <Text style={[styles.feedbackNoticeText, { color: tc.success }]}>
                                        {tr('settings.feedbackSent')}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    style={[styles.feedbackPrimaryButton, { backgroundColor: tc.tint }]}
                                    onPress={onClose}
                                >
                                    <Text style={[styles.feedbackPrimaryButtonText, { color: tc.onTint }]}>
                                        {tr('common.close')}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <ScrollView
                                style={styles.feedbackModalScroll}
                                contentContainerStyle={styles.feedbackModalBody}
                                keyboardShouldPersistTaps="handled"
                            >
                                <Text style={[styles.feedbackFieldLabel, { color: tc.secondaryText }]}>
                                    {tr('settings.feedbackCategory')}
                                </Text>
                                <View style={styles.feedbackCategoryGrid}>
                                    {FEEDBACK_CATEGORIES.map((item) => {
                                        const selected = item === category;
                                        const Icon = categoryIcons[item];
                                        return (
                                            <TouchableOpacity
                                                key={item}
                                                style={[
                                                    styles.feedbackCategoryButton,
                                                    {
                                                        backgroundColor: selected ? `${tc.tint}18` : tc.bg,
                                                        borderColor: selected ? tc.tint : tc.border,
                                                    },
                                                ]}
                                                onPress={() => setCategory(item)}
                                            >
                                                <Icon size={17} color={selected ? tc.tint : tc.secondaryText} />
                                                <Text
                                                    style={[
                                                        styles.feedbackCategoryText,
                                                        { color: selected ? tc.tint : tc.secondaryText },
                                                    ]}
                                                    numberOfLines={1}
                                                >
                                                    {categoryLabels[item]}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                <Text style={[styles.feedbackFieldLabel, { color: tc.secondaryText }]}>
                                    {tr('settings.feedbackMessage')}
                                </Text>
                                <TextInput
                                    value={message}
                                    onChangeText={(next) => {
                                        setMessage(next);
                                        setError(null);
                                    }}
                                    placeholder={tr('settings.feedbackMessagePlaceholder')}
                                    placeholderTextColor={tc.secondaryText}
                                    multiline
                                    maxLength={4000}
                                    style={[
                                        styles.feedbackTextArea,
                                        {
                                            backgroundColor: tc.bg,
                                            borderColor: tc.border,
                                            color: tc.text,
                                        },
                                    ]}
                                    textAlignVertical="top"
                                />

                                <Text style={[styles.feedbackFieldLabel, { color: tc.secondaryText }]}>
                                    {tr('settings.feedbackEmail')}
                                </Text>
                                <TextInput
                                    value={email}
                                    onChangeText={(next) => {
                                        setEmail(next);
                                        setError(null);
                                    }}
                                    placeholder={tr('settings.feedbackEmailPlaceholder')}
                                    placeholderTextColor={tc.secondaryText}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="email-address"
                                    style={[
                                        styles.feedbackInput,
                                        {
                                            backgroundColor: tc.bg,
                                            borderColor: tc.border,
                                            color: tc.text,
                                        },
                                    ]}
                                />

                                {category === 'bug' ? (
                                    <View style={[styles.feedbackDiagnosticsRow, { backgroundColor: tc.bg, borderColor: tc.border }]}>
                                        <View style={styles.feedbackDiagnosticsCopy}>
                                            <Text style={[styles.feedbackDiagnosticsTitle, { color: tc.text }]}>
                                                {tr('settings.feedbackIncludeDiagnostics')}
                                            </Text>
                                            <Text style={[styles.feedbackDiagnosticsDescription, { color: tc.secondaryText }]}>
                                                {tr('settings.feedbackIncludeDiagnosticsDesc')}
                                            </Text>
                                        </View>
                                        <Switch
                                            value={includeDiagnostics}
                                            onValueChange={setIncludeDiagnostics}
                                            trackColor={{ false: tc.border, true: `${tc.tint}66` }}
                                            thumbColor={includeDiagnostics ? tc.tint : tc.secondaryText}
                                        />
                                    </View>
                                ) : null}

                                <Text style={[styles.feedbackPrivacyText, { color: tc.secondaryText, backgroundColor: tc.bg }]}>
                                    {tr('settings.feedbackPrivacy')}
                                </Text>

                                {visibleError ? (
                                    <View style={[styles.feedbackNotice, { backgroundColor: `${tc.danger}18`, borderColor: `${tc.danger}55` }]}>
                                        <Text style={[styles.feedbackNoticeText, { color: tc.danger }]}>
                                            {visibleError}
                                        </Text>
                                    </View>
                                ) : null}

                                <View style={styles.feedbackActions}>
                                    <TouchableOpacity
                                        style={[styles.feedbackSecondaryButton, { borderColor: tc.border }]}
                                        onPress={onClose}
                                    >
                                        <Text style={[styles.feedbackSecondaryButtonText, { color: tc.secondaryText }]}>
                                            {tr('common.cancel')}
                                        </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        disabled={!canSubmit}
                                        style={[
                                            styles.feedbackPrimaryButton,
                                            { backgroundColor: tc.tint },
                                            !canSubmit && styles.feedbackButtonDisabled,
                                        ]}
                                        onPress={() => void submit()}
                                    >
                                        {status === 'sending' ? (
                                            <ActivityIndicator size="small" color={tc.onTint} />
                                        ) : null}
                                        <Text style={[styles.feedbackPrimaryButtonText, { color: tc.onTint }]}>
                                            {status === 'sending'
                                                ? tr('settings.feedbackSending')
                                                : tr('settings.feedbackSubmit')}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </ScrollView>
                        )}
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}
