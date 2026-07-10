import { useEffect, useState } from 'react';
import type { Attachment } from '@mindwtr/core';
import { normalizeAttachmentPathForUrl } from './attachment-paths';
import { stripFileScheme } from './sync-service-utils';
import { isTauriRuntime } from './runtime';

type AttachmentRef = Pick<Attachment, 'kind' | 'uri' | 'cloudKey'>;

// A bare reference is a file attachment the app does not own: its path lies
// outside the managed attachments dir and no synced copy (cloudKey) exists to
// restore it. Pure string comparison — never stats the disk, safe in render paths.
export function isBareFileReference(attachment: AttachmentRef, managedDirPrefix: string | null): boolean {
    if (attachment.kind !== 'file') return false;
    if (attachment.cloudKey) return false;
    if (!managedDirPrefix) return false;
    const uri = (attachment.uri || '').trim();
    if (!uri || /^https?:\/\//i.test(uri)) return false;
    const normalized = normalizeAttachmentPathForUrl(stripFileScheme(uri));
    return !normalized.startsWith(managedDirPrefix);
}

let cachedManagedDirPrefix: string | null = null;
let managedDirPrefixPromise: Promise<string | null> | null = null;

async function loadManagedDirPrefix(): Promise<string | null> {
    if (!isTauriRuntime()) return null;
    if (cachedManagedDirPrefix) return cachedManagedDirPrefix;
    if (!managedDirPrefixPromise) {
        managedDirPrefixPromise = import('@tauri-apps/api/path')
            .then(async ({ dataDir }) => {
                const base = await dataDir();
                // Owned copies live only in the managed attachments dir
                // (BaseDirectory.Data + mindwtr/attachments, same as imports and
                // sync downloads). The trailing slash keeps sibling dirs like
                // ".../mindwtr/attachments-old" from matching by prefix.
                cachedManagedDirPrefix = `${normalizeAttachmentPathForUrl(base).replace(/\/+$/, '')}/mindwtr/attachments/`;
                return cachedManagedDirPrefix;
            })
            .catch(() => null);
    }
    return managedDirPrefixPromise;
}

// Resolves the managed attachments dir once per session; until it resolves,
// every attachment counts as owned (paperclip) so icons never flicker.
export function useBareFileReferenceCheck(): (attachment: AttachmentRef) => boolean {
    const [prefix, setPrefix] = useState<string | null>(cachedManagedDirPrefix);
    useEffect(() => {
        if (prefix) return;
        let cancelled = false;
        void loadManagedDirPrefix().then((resolved) => {
            if (!cancelled && resolved) setPrefix(resolved);
        });
        return () => {
            cancelled = true;
        };
    }, [prefix]);
    return (attachment) => isBareFileReference(attachment, prefix);
}
