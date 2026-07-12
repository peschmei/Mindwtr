import { useCallback, useEffect, useRef } from 'react';
import * as FileSystem from 'expo-file-system';

import { generateUUID, validateAttachmentForUpload, type Attachment, type Task } from '@mindwtr/core';

import type { ToastOptions } from '@/contexts/toast-context';
import { logError, logWarn } from '@/lib/app-log';
import { persistAttachmentLocallyDetailed } from '@/lib/attachment-sync';
import {
    isOpenFeatureUrl,
    isShortcutCaptureUrl,
    normalizeShortcutTags,
    parseOpenFeatureUrl,
    parseShortcutCaptureUrl,
    resolveOpenFeaturePath,
    type ShortcutCapturePayload,
} from '@/lib/capture-deeplink';

type ResolveText = (key: string, fallback: string) => string;

type RouterLike = {
    canGoBack: () => boolean;
    push: (...args: any[]) => void;
    replace: (...args: any[]) => void;
};

type SharedIntentFile = {
    fileName?: string | null;
    mimeType?: string | null;
    path?: string | null;
    size?: number | null;
};

type UseRootLayoutExternalCaptureParams = {
    dataReady: boolean;
    hasShareIntent: boolean;
    incomingUrl: string | null;
    resolveText: ResolveText;
    resetShareIntent: () => void;
    router: RouterLike;
    shareFiles?: SharedIntentFile[] | null;
    shareText?: string | null;
    shareWebUrl?: string | null;
    showToast: (options: ToastOptions) => void;
};

const trimSharedValue = (value: string | null | undefined): string => (
    typeof value === 'string' ? value.trim() : ''
);

const SHARE_INTENT_MAX_FILES = 6;

const stripFileExtension = (value: string): string => value.replace(/\.[A-Za-z0-9]{1,8}$/, '');

type ShareIntentFileCaptureResult = {
    params: Record<string, string> | null;
    candidateCount: number;
    attachedCount: number;
};

// Shared files (PDFs, images, audio, ...) become copied attachments on the
// capture draft, mirroring the in-app attach flow: the share-extension file
// lives in a temporary container, so the bytes must be re-homed into the
// managed attachments dir before the capture sheet ever sees them.
async function buildShareIntentFileCaptureParams({
    files,
    shareText,
}: {
    files?: SharedIntentFile[] | null;
    shareText?: string | null;
}): Promise<ShareIntentFileCaptureResult> {
    const candidates = (files ?? [])
        .filter((file): file is SharedIntentFile & { path: string } => (
            typeof file?.path === 'string' && file.path.trim().length > 0
        ))
        .slice(0, SHARE_INTENT_MAX_FILES);
    if (candidates.length === 0) return { params: null, candidateCount: 0, attachedCount: 0 };

    const attachments: Attachment[] = [];
    for (const file of candidates) {
        const now = new Date().toISOString();
        const sourceUri = file.path.startsWith('/') ? `file://${file.path}` : file.path;
        const attachment: Attachment = {
            id: generateUUID(),
            kind: 'file',
            title: trimSharedValue(file.fileName) || 'Shared file',
            uri: sourceUri,
            mimeType: trimSharedValue(file.mimeType) || undefined,
            size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : undefined,
            createdAt: now,
            updatedAt: now,
            localStatus: 'available',
        };
        try {
            // Some providers omit the size; 0 still runs the mime blocklist,
            // and the post-copy check below enforces the size cap.
            const validation = await validateAttachmentForUpload(attachment, attachment.size ?? 0);
            if (!validation.valid) {
                void logWarn('Skipped shared file failing attachment validation', {
                    scope: 'share-intent',
                    extra: { error: validation.error ?? 'unknown', size: String(attachment.size ?? 'unknown') },
                });
                continue;
            }
            const persisted = await persistAttachmentLocallyDetailed(attachment);
            if (persisted.status !== 'copied' && persisted.status !== 'already-local') {
                // A share-container path goes stale as soon as the intent is
                // consumed, so a failed copy means the file is lost to us.
                void logWarn('Failed to copy shared file into attachments', {
                    scope: 'share-intent',
                    extra: { status: persisted.status },
                });
                continue;
            }
            const cached = persisted.attachment;
            if (typeof attachment.size !== 'number' && typeof cached.size === 'number') {
                // The copy revealed the real size of a sizeless share; drop the
                // bytes again if they exceed the attachment cap.
                const sizeValidation = await validateAttachmentForUpload(cached, cached.size);
                if (!sizeValidation.valid) {
                    void FileSystem.deleteAsync(cached.uri, { idempotent: true }).catch(() => undefined);
                    void logWarn('Skipped shared file failing attachment validation', {
                        scope: 'share-intent',
                        extra: { error: sizeValidation.error ?? 'unknown', size: String(cached.size) },
                    });
                    continue;
                }
            }
            attachments.push(cached);
        } catch (error) {
            void logError(error, { scope: 'share-intent', extra: { step: 'copy-shared-file' } });
        }
    }
    if (attachments.length === 0) {
        return { params: null, candidateCount: candidates.length, attachedCount: 0 };
    }

    const title = trimSharedValue(shareText) || stripFileExtension(attachments[0].title);
    return {
        params: {
            initialValue: encodeURIComponent(title),
            initialProps: encodeURIComponent(JSON.stringify({ attachments } satisfies Partial<Task>)),
        },
        candidateCount: candidates.length,
        attachedCount: attachments.length,
    };
}

function buildShareIntentCaptureParams({
    shareText,
    shareWebUrl,
}: {
    shareText?: string | null;
    shareWebUrl?: string | null;
}): Record<string, string> | null {
    const title = trimSharedValue(shareText) || trimSharedValue(shareWebUrl);
    if (!title) return null;

    const params: Record<string, string> = {
        initialValue: encodeURIComponent(title),
    };
    const url = trimSharedValue(shareWebUrl);
    if (url && url !== title) {
        params.initialProps = encodeURIComponent(JSON.stringify({
            description: url,
        } satisfies Partial<Task>));
    }

    return params;
}

export function useRootLayoutExternalCapture({
    dataReady,
    hasShareIntent,
    incomingUrl,
    resolveText,
    resetShareIntent,
    router,
    shareFiles,
    shareText,
    shareWebUrl,
    showToast,
}: UseRootLayoutExternalCaptureParams) {
    const lastHandledUrl = useRef<string | null>(null);
    // The async file-copy branch outlives a render; a dep-identity change
    // mid-copy (language load swaps resolveText, for instance) must not start
    // a second copy of the same share.
    const shareHandlingRef = useRef(false);

    const openCaptureConfirmation = useCallback((payload: ShortcutCapturePayload) => {
        const tags = normalizeShortcutTags(payload.tags);
        const initialProps: Partial<Task> = {
            ...(payload.note ? { description: payload.note } : {}),
            ...(tags.length > 0 ? { tags } : {}),
        };
        const params: Record<string, string> = {
            initialValue: encodeURIComponent(payload.title),
        };
        if (Object.keys(initialProps).length > 0) {
            params.initialProps = encodeURIComponent(JSON.stringify(initialProps));
        }
        if (payload.project) {
            params.project = encodeURIComponent(payload.project);
        }

        if (router.canGoBack()) {
            router.push({
                pathname: '/capture-modal',
                params,
            });
        } else {
            router.replace({
                pathname: '/capture-modal',
                params,
            });
        }
    }, [router]);

    useEffect(() => {
        if (!hasShareIntent) return;
        if (shareHandlingRef.current) return;
        shareHandlingRef.current = true;
        const finish = (params: Record<string, string> | null) => {
            if (params) {
                router.replace({
                    pathname: '/capture-modal',
                    params,
                });
            } else {
                void logError(new Error('Share intent payload missing text and files'), { scope: 'share-intent' });
                showToast({
                    title: resolveText('share.unavailable', 'Share unavailable'),
                    message: resolveText('share.readFailed', 'Mindwtr could not read text, a URL, or a file from the shared item.'),
                    tone: 'warning',
                });
            }
        };
        const hasSharedFiles = (shareFiles ?? []).some((file) => typeof file?.path === 'string' && file.path.trim().length > 0);
        if (!hasSharedFiles) {
            // Text/URL shares stay synchronous; only file shares need the
            // async copy into the managed attachments dir.
            finish(buildShareIntentCaptureParams({ shareText, shareWebUrl }));
            resetShareIntent();
            shareHandlingRef.current = false;
            return;
        }
        void buildShareIntentFileCaptureParams({ files: shareFiles, shareText })
            .then((result) => {
                const skippedCount = result.candidateCount - result.attachedCount;
                if (skippedCount > 0) {
                    showToast({
                        title: resolveText('common.notice', 'Notice'),
                        message: resolveText(
                            'share.filesSkipped',
                            '{{count}} shared file(s) could not be attached (too large, blocked file type, or unreadable).',
                        ).replace('{{count}}', String(skippedCount)),
                        tone: 'warning',
                    });
                }
                const params = result.params ?? buildShareIntentCaptureParams({ shareText, shareWebUrl });
                if (params) {
                    router.replace({
                        pathname: '/capture-modal',
                        params,
                    });
                } else if (skippedCount === 0) {
                    // Nothing readable at all; when files were skipped the
                    // toast above already explains why nothing arrived.
                    finish(null);
                }
            })
            .finally(() => {
                resetShareIntent();
                shareHandlingRef.current = false;
            });
    }, [hasShareIntent, resolveText, resetShareIntent, router, shareFiles, shareText, shareWebUrl, showToast]);

    useEffect(() => {
        if (!dataReady) return;
        if (!incomingUrl) return;
        if (lastHandledUrl.current === incomingUrl) return;

        const featurePayload = parseOpenFeatureUrl(incomingUrl);
        if (featurePayload) {
            lastHandledUrl.current = incomingUrl;
            router.replace(resolveOpenFeaturePath(featurePayload.feature));
            return;
        }
        if (isOpenFeatureUrl(incomingUrl)) {
            lastHandledUrl.current = incomingUrl;
            router.replace('/inbox');
            return;
        }

        const payload = parseShortcutCaptureUrl(incomingUrl);
        if (!payload) {
            if (!isShortcutCaptureUrl(incomingUrl)) return;
            lastHandledUrl.current = incomingUrl;
            void logWarn('Invalid shortcut capture URL', {
                scope: 'shortcuts',
                extra: { url: incomingUrl },
            });
            showToast({
                title: resolveText('shortcuts.captureUnavailable', 'Capture shortcut unavailable'),
                message: resolveText('shortcuts.missingTitle', 'Mindwtr could not read a task title from that shortcut link.'),
                tone: 'warning',
            });
            return;
        }

        lastHandledUrl.current = incomingUrl;
        try {
            openCaptureConfirmation(payload);
        } catch (error) {
            lastHandledUrl.current = null;
            void logError(error, { scope: 'shortcuts', extra: { url: incomingUrl } });
        }
    }, [dataReady, incomingUrl, resolveText, openCaptureConfirmation, router, showToast]);
}
