import { describe, expect, it } from 'vitest';

import {
    isWhisperModelFileReady,
    isWhisperModelSafeDeleteTarget,
    type WhisperModelDescriptor,
} from './ai-settings-whisper-model';

const minBytes = 50 * 1024 * 1024;

const model: WhisperModelDescriptor = {
    id: 'whisper-tiny',
    fileName: 'ggml-tiny.bin',
    label: 'whisper-tiny',
    minBytes,
};

describe('ai settings whisper model helpers', () => {
    it('requires a complete-looking model file before marking it ready', () => {
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: false, size: minBytes })).toBe(true);
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: false, size: minBytes - 1 })).toBe(false);
        expect(isWhisperModelFileReady(model, { exists: true, isDirectory: true, size: minBytes })).toBe(false);
        expect(isWhisperModelFileReady(model, { exists: false, isDirectory: false, size: minBytes })).toBe(false);
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
});
