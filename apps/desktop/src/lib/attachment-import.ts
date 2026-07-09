import { type Attachment, DEFAULT_MAX_FILE_SIZE_BYTES, generateUUID } from '@mindwtr/core';
import { logWarn } from './app-log';
import { extractExtension } from './sync-service-utils';

export type ImportPickedFileResult =
    | { attachment: Attachment }
    | { errorKey: 'attachments.fileTooLarge' | 'attachments.fileNotReadable' };

// Copies the picked file into the app-managed attachments dir (via the Rust
// side, which is not bound by the webview fs scope) so the attachment owns its
// bytes and never depends on the original path again.
export async function importPickedFileAttachment(selectedPath: string): Promise<ImportPickedFileResult> {
    const title = selectedPath.split(/[/\\]/).pop() || selectedPath;
    const id = generateUUID();
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const imported = await invoke<{ uri: string; size: number }>('import_attachment_file', {
            path: selectedPath,
            fileName: `${id}${extractExtension(title)}`,
            maxBytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        });
        const now = new Date().toISOString();
        return {
            attachment: {
                id,
                kind: 'file',
                title,
                uri: imported.uri,
                size: imported.size,
                localStatus: 'available',
                createdAt: now,
                updatedAt: now,
            },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void logWarn('Failed to import attachment file', {
            scope: 'attachment',
            extra: { error: message },
        });
        return {
            errorKey: message === 'file_too_large'
                ? 'attachments.fileTooLarge'
                : 'attachments.fileNotReadable',
        };
    }
}
