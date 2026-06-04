import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug, Lightbulb, MessageSquare, Send, X } from 'lucide-react';

import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '@mindwtr/core';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';

type Labels = {
    feedback: string;
    feedbackDesc: string;
    feedbackCategory: string;
    feedbackCategoryBug: string;
    feedbackCategoryFeature: string;
    feedbackCategoryOther: string;
    feedbackMessage: string;
    feedbackMessagePlaceholder: string;
    feedbackEmail: string;
    feedbackEmailPlaceholder: string;
    feedbackIncludeDiagnostics: string;
    feedbackIncludeDiagnosticsDesc: string;
    feedbackPrivacy: string;
    feedbackSubmit: string;
    feedbackSending: string;
    feedbackSent: string;
    feedbackFailed: string;
    feedbackUnavailable: string;
    feedbackRequired: string;
    feedbackInvalidEmail: string;
    close: string;
};

export type FeedbackSubmitInput = {
    category: FeedbackCategory;
    message: string;
    email?: string;
    includeDiagnostics: boolean;
};

type SettingsFeedbackModalProps = {
    isOpen: boolean;
    isConfigured: boolean;
    t: Labels;
    onClose: () => void;
    onSubmit: (input: FeedbackSubmitInput) => Promise<void>;
};

const categoryIcons: Record<FeedbackCategory, typeof Bug> = {
    bug: Bug,
    feature: Lightbulb,
    other: MessageSquare,
};

export function SettingsFeedbackModal({
    isConfigured,
    isOpen,
    onClose,
    onSubmit,
    t,
}: SettingsFeedbackModalProps) {
    const [category, setCategory] = useState<FeedbackCategory>('bug');
    const [message, setMessage] = useState('');
    const [email, setEmail] = useState('');
    const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const messageRef = useRef<HTMLTextAreaElement>(null);
    const titleId = useId();
    const descriptionId = useId();

    const categoryLabels: Record<FeedbackCategory, string> = {
        bug: t.feedbackCategoryBug,
        feature: t.feedbackCategoryFeature,
        other: t.feedbackCategoryOther,
    };

    useEffect(() => {
        if (!isOpen) return;
        setStatus('idle');
        setError(null);
        const timer = window.setTimeout(() => messageRef.current?.focus(), 50);
        return () => window.clearTimeout(timer);
    }, [isOpen]);

    useEffect(() => {
        if (category === 'bug') return;
        setIncludeDiagnostics(false);
    }, [category]);

    if (!isOpen || typeof document === 'undefined') return null;

    const trimmedMessage = message.trim();
    const trimmedEmail = email.trim();
    const emailValid = !trimmedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    const canSubmit = isConfigured && trimmedMessage.length > 0 && emailValid && status !== 'sending';
    const visibleError = error
        ?? (!isConfigured ? t.feedbackUnavailable : null)
        ?? (trimmedEmail && !emailValid ? t.feedbackInvalidEmail : null);

    const handleSubmit = async () => {
        if (!trimmedMessage) {
            setError(t.feedbackRequired);
            return;
        }
        if (!emailValid) {
            setError(t.feedbackInvalidEmail);
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
            setError(t.feedbackFailed);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClick={onClose}
        >
            <div
                ref={modalRef}
                className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') onClose();
                }}
            >
                <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
                    <div>
                        <h3 id={titleId} className="text-base font-semibold">{t.feedback}</h3>
                        <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t.feedbackDesc}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={t.close}
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {status === 'sent' ? (
                    <div className="space-y-4 p-4">
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            {t.feedbackSent}
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={onClose}>{t.close}</Button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 p-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t.feedbackCategory}
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {FEEDBACK_CATEGORIES.map((item) => {
                                    const Icon = categoryIcons[item];
                                    const selected = item === category;
                                    return (
                                        <button
                                            key={item}
                                            type="button"
                                            className={cn(
                                                'flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                                                selected
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                                            )}
                                            onClick={() => setCategory(item)}
                                        >
                                            <Icon className="h-4 w-4" />
                                            <span>{categoryLabels[item]}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <label className="block space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t.feedbackMessage}
                            </span>
                            <textarea
                                ref={messageRef}
                                value={message}
                                onChange={(event) => {
                                    setMessage(event.target.value);
                                    setError(null);
                                }}
                                placeholder={t.feedbackMessagePlaceholder}
                                maxLength={4000}
                                className="min-h-32 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40"
                            />
                        </label>

                        <label className="block space-y-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {t.feedbackEmail}
                            </span>
                            <input
                                type="email"
                                value={email}
                                onChange={(event) => {
                                    setEmail(event.target.value);
                                    setError(null);
                                }}
                                placeholder={t.feedbackEmailPlaceholder}
                                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/40"
                            />
                        </label>

                        {category === 'bug' && (
                            <label className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3">
                                <input
                                    type="checkbox"
                                    checked={includeDiagnostics}
                                    onChange={(event) => setIncludeDiagnostics(event.target.checked)}
                                    className="mt-1 h-4 w-4"
                                />
                                <span>
                                    <span className="block text-sm font-medium">{t.feedbackIncludeDiagnostics}</span>
                                    <span className="block text-xs leading-5 text-muted-foreground">
                                        {t.feedbackIncludeDiagnosticsDesc}
                                    </span>
                                </span>
                            </label>
                        )}

                        <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                            {t.feedbackPrivacy}
                        </p>

                        {visibleError && (
                            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                {visibleError}
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={onClose}>
                                {t.close}
                            </Button>
                            <Button onClick={handleSubmit} disabled={!canSubmit}>
                                <Send className="h-4 w-4" />
                                {status === 'sending' ? t.feedbackSending : t.feedbackSubmit}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
