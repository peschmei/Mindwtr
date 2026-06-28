export type WhisperModelDescriptor = {
    id: string;
    fileName: string;
    label: string;
    minBytes?: number;
    sha256?: string;
    sizeBytes?: number;
};

export type WhisperModelPathInfo = {
    exists?: boolean;
    isDirectory?: boolean | null;
    size?: number | null;
};

const normalizeForCompare = (uri: string): string => uri.trim().replace(/\\/gu, '/').replace(/\/+$/u, '');

const basename = (uri: string): string => {
    const normalized = normalizeForCompare(uri);
    return normalized.split('/').pop() ?? '';
};

export const getWhisperModelMinimumBytes = (model: WhisperModelDescriptor): number => Math.max(1, model.minBytes ?? 1);

export const getWhisperModelExpectedBytes = (model: WhisperModelDescriptor): number | undefined => (
    typeof model.sizeBytes === 'number' && Number.isFinite(model.sizeBytes) && model.sizeBytes > 0
        ? model.sizeBytes
        : undefined
);

export const isWhisperModelFileReady = (
    model: WhisperModelDescriptor,
    info: WhisperModelPathInfo | null | undefined
): boolean => {
    if (!info?.exists || info.isDirectory !== false) return false;
    const size = info.size ?? 0;
    const expectedBytes = getWhisperModelExpectedBytes(model);
    if (expectedBytes !== undefined) return size === expectedBytes;
    return size >= getWhisperModelMinimumBytes(model);
};

export type WhisperModelHashFile = (uri: string) => Promise<string>;

export const verifyWhisperModelFileHash = async (
    model: WhisperModelDescriptor,
    uri: string,
    hashFile: WhisperModelHashFile
): Promise<void> => {
    const expected = model.sha256?.trim().toLowerCase();
    if (!expected) return;
    const actual = (await hashFile(uri)).trim().toLowerCase();
    if (actual !== expected) {
        throw new Error(`Whisper model SHA-256 mismatch for ${model.label}: expected ${expected}, got ${actual}`);
    }
};

export const isWhisperModelSafeDeleteTarget = ({
    uri,
    fileName,
    allowedUris,
}: {
    uri: string;
    fileName: string;
    allowedUris: string[];
}): boolean => {
    if (!uri || !fileName || basename(uri) !== fileName) return false;
    const normalizedUri = normalizeForCompare(uri);
    return allowedUris.some((allowedUri) => normalizeForCompare(allowedUri) === normalizedUri);
};
