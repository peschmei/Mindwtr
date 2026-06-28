export const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export type WhisperModelOption = {
    id: string;
    fileName: string;
    label: string;
    sizeBytes: number;
};

export type ParakeetModelOption = {
    id: string;
    label: string;
    modelDirName: string;
    sizeBytes: number;
};

export const WHISPER_MODELS: WhisperModelOption[] = [
    { id: 'whisper-tiny', fileName: 'ggml-tiny.bin', label: 'whisper-tiny', sizeBytes: 77691713 },
    { id: 'whisper-tiny.en', fileName: 'ggml-tiny.en.bin', label: 'whisper-tiny.en', sizeBytes: 77704715 },
    { id: 'whisper-base', fileName: 'ggml-base.bin', label: 'whisper-base', sizeBytes: 147951465 },
    { id: 'whisper-base.en', fileName: 'ggml-base.en.bin', label: 'whisper-base.en', sizeBytes: 147964211 },
    { id: 'whisper-large-v3-turbo', fileName: 'ggml-large-v3-turbo.bin', label: 'whisper-large-v3-turbo', sizeBytes: 1624555275 },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[0]?.id ?? 'whisper-tiny';

export const PARAKEET_MODELS: ParakeetModelOption[] = [
    {
        id: 'parakeet-tdt-0.6b-v3-int8',
        label: 'Parakeet-TDT-0.6B v3 int8 (experimental)',
        modelDirName: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
        sizeBytes: 670478772,
    },
];

export const DEFAULT_PARAKEET_MODEL = PARAKEET_MODELS[0]?.id ?? 'parakeet-tdt-0.6b-v3-int8';
export const PARAKEET_MODEL_INSTALL_DIR = 'parakeet-model';
export const PARAKEET_REQUIRED_FILES = [
    'encoder.int8.onnx',
    'decoder.int8.onnx',
    'joiner.int8.onnx',
    'tokens.txt',
] as const;

export const OPENAI_SPEECH_MODELS = [
    'gpt-4o-mini-transcribe',
    'gpt-4o-transcribe',
    'whisper-1',
];

export const GEMINI_SPEECH_MODELS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
];
