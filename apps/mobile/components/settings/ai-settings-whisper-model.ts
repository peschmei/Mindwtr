export type WhisperModelDescriptor = {
    id: string;
    fileName: string;
    label: string;
    minBytes?: number;
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

export const isWhisperModelFileReady = (
    model: WhisperModelDescriptor,
    info: WhisperModelPathInfo | null | undefined
): boolean => Boolean(
    info?.exists
    && info.isDirectory === false
    && (info.size ?? 0) >= getWhisperModelMinimumBytes(model)
);

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
