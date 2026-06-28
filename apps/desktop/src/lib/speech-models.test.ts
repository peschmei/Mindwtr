import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PARAKEET_MODEL,
    PARAKEET_MODELS,
    WHISPER_MODELS,
} from './speech-models';

describe('speech model metadata', () => {
    it('includes Whisper large-v3-turbo as an optional local Whisper model', () => {
        expect(WHISPER_MODELS).toContainEqual({
            id: 'whisper-large-v3-turbo',
            fileName: 'ggml-large-v3-turbo.bin',
            label: 'whisper-large-v3-turbo',
            sizeBytes: 1624555275,
        });
    });

    it('includes Parakeet v3 int8 as the desktop experimental local ASR model', () => {
        expect(DEFAULT_PARAKEET_MODEL).toBe('parakeet-tdt-0.6b-v3-int8');
        expect(PARAKEET_MODELS).toContainEqual({
            id: 'parakeet-tdt-0.6b-v3-int8',
            label: 'Parakeet-TDT-0.6B v3 int8 (experimental)',
            modelDirName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
            sizeBytes: 670478772,
        });
    });
});
