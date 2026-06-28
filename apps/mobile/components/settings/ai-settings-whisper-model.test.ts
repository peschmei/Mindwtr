import { describe, expect, it } from 'vitest';

import {
    isWhisperModelFileReady,
    isWhisperModelSafeDeleteTarget,
    verifyWhisperModelFileHash,
    type WhisperModelDescriptor,
} from './ai-settings-whisper-model';

const minBytes = 50 * 1024 * 1024;
const sizeBytes = 77691713;
const sha256 = 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21';

const model: WhisperModelDescriptor = {
    id: 'whisper-tiny',
    fileName: 'ggml-tiny.bin',
    label: 'whisper-tiny',
    minBytes,
    sizeBytes,
    sha256,
};

describe('ai settings whisper model helpers', () => {
    it('requires a complete-looking model file before marking it ready', () => {
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: false, size: sizeBytes })).toBe(true);
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: false, size: sizeBytes - 1 })).toBe(false);
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: false, size: sizeBytes + 1 })).toBe(false);
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: true, size: sizeBytes })).toBe(false);
        expect(isWhisperModelFileReady(model, { exists: false, isDirectory: false, size: sizeBytes })).toBe(false);
    });

    it('only allows deletion of exact known model files', () => {
        const allowed = ['file:///document/whisper-models/ggml-tiny.bin'];

        expect(isWhisperModelSafeDeleteTarget({
            uri: 'file:///document/whisper-models/ggml-tiny.bin',
            fileName: model.fileName,
            allowedUris: allowed,
        })).toBe(true);
        expect(isWhisperModelSafeDeleteTarget({
            uri: 'file:///document/notes/ggml-tiny.bin',
            fileName: model.fileName,
            allowedUris: allowed,
        })).toBe(false);
        expect(isWhisperModelSafeDeleteTarget({
            uri: 'file:///document/whisper-models/other.bin',
            fileName: model.fileName,
            allowedUris: allowed,
        })).toBe(false);
    });

    it('rejects model files whose SHA-256 does not match the pinned digest', async () => {
        await expect(verifyWhisperModelFileHash(
            model,
            'file:///document/whisper-models/ggml-tiny.bin',
            async () => '0000000000000000000000000000000000000000000000000000000000000000'
        )).rejects.toThrow('Whisper model SHA-256 mismatch');

        await expect(verifyWhisperModelFileHash(
            model,
            'file:///document/whisper-models/ggml-tiny.bin',
            async () => sha256.toUpperCase()
        )).resolves.toBeUndefined();
    });
});
