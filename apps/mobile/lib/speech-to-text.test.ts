import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileSystemMock = vi.hoisted(() => ({
  bytes: vi.fn(),
  existingUris: null as Set<string> | null,
  fileSizes: new Map<string, number>(),
}));

const appLogMock = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const constantsMock = vi.hoisted(() => ({
  default: {
    appOwnership: 'standalone',
    expoConfig: {
      extra: {
        isFossBuild: false,
      },
    },
  },
}));

const whisperMock = vi.hoisted(() => ({
  initWhisper: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

vi.mock('expo-constants', () => constantsMock);

vi.mock('expo-file-system', () => ({
  Directory: class MockDirectory {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }
  },
  File: class MockFile {
    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get name() {
      return this.uri.split('/').pop() ?? 'audio.wav';
    }

    get type() {
      return this.uri.endsWith('.wav') ? 'audio/wav' : 'audio/mp4';
    }

    get exists() {
      return fileSystemMock.existingUris ? fileSystemMock.existingUris.has(this.uri) : true;
    }

    get size() {
      return fileSystemMock.fileSizes.get(this.uri) ?? 44;
    }

    bytes() {
      return fileSystemMock.bytes(this.uri);
    }
  },
  Paths: {
    cache: { uri: 'file:///cache/' },
    document: { uri: 'file:///document/' },
    info: vi.fn((uri: string) => ({
      exists: fileSystemMock.existingUris ? fileSystemMock.existingUris.has(uri) : true,
      isDirectory: false,
      size: fileSystemMock.fileSizes.get(uri),
    })),
  },
}));

vi.mock('./app-log', () => appLogMock);
vi.mock('whisper.rn/src/index', () => whisperMock);
vi.mock('whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter.js', () => ({}));
vi.mock('whisper.rn/realtime-transcription/index.js', () => ({}));

import {
  prepareAudioForLocalWhisper,
  processAudioCapture,
  REMOTE_SPEECH_TO_TEXT_FOSS_ERROR,
  resolveSpeechToTextRuntimeSettings,
  resolveWhisperModelPathForConfig,
  startWhisperRealtimeCapture,
} from './speech-to-text';

const makePcmWav = ({
  sampleRate = 16000,
  channels = 1,
  bitsPerSample = 16,
  dataBytes = 6400,
} = {}) => {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      bytes[offset + i] = value.charCodeAt(i);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
};

const makeM4aHeader = () => new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x4d, 0x34, 0x41, 0x20,
  0x00, 0x00, 0x00, 0x00,
]);

describe('speech-to-text', () => {
  beforeEach(() => {
    constantsMock.default.expoConfig.extra.isFossBuild = false;
    fileSystemMock.existingUris = null;
    fileSystemMock.fileSizes.clear();
    vi.clearAllMocks();
  });

  it('forces synced remote speech settings to local Whisper in FOSS builds', () => {
    expect(
      resolveSpeechToTextRuntimeSettings(
        {
          enabled: true,
          provider: 'openai',
          model: 'gpt-4o-transcribe',
          offlineModelPath: 'file:///document/whisper-models/ggml-tiny.bin',
          language: 'en',
          mode: 'transcribe_only',
          fieldStrategy: 'description_only',
        },
        { isFossBuild: true }
      )
    ).toMatchObject({
      provider: 'whisper',
      enabled: true,
      model: 'whisper-tiny',
      modelPath: 'file:///document/whisper-models/ggml-tiny.bin',
      language: 'en',
      mode: 'transcribe_only',
      fieldStrategy: 'description_only',
      isFossBuild: true,
    });
  });

  it('keeps synced Parakeet disabled outside FOSS builds', () => {
    expect(
      resolveSpeechToTextRuntimeSettings(
        { enabled: true, provider: 'parakeet', model: 'parakeet-tdt-0.6b-v3-int8' },
        { isFossBuild: false }
      )
    ).toMatchObject({
      provider: 'whisper',
      enabled: false,
      model: 'whisper-tiny',
      isFossBuild: false,
    });
  });

  it('blocks remote speech-to-text transport in FOSS builds', async () => {
    constantsMock.default.expoConfig.extra.isFossBuild = true;

    await expect(
      processAudioCapture('file:///tmp/audio.m4a', {
        provider: 'gemini',
        apiKey: 'secret',
        model: 'gemini-2.5-flash',
        isFossBuild: true,
      })
    ).rejects.toThrow(REMOTE_SPEECH_TO_TEXT_FOSS_ERROR);
    expect(appLogMock.logWarn).toHaveBeenCalledWith(
      'Remote speech-to-text blocked in FOSS build',
      expect.objectContaining({
        extra: { provider: 'gemini' },
      })
    );
  });

  it('finds a downloaded Whisper model when the stored root path is stale', () => {
    fileSystemMock.existingUris = new Set([
      'file:///document/whisper-models/ggml-tiny.en.bin',
    ]);
    fileSystemMock.fileSizes.set('file:///document/whisper-models/ggml-tiny.en.bin', 77704715);

    expect(resolveWhisperModelPathForConfig(
      'whisper-tiny.en',
      'file:///document/ggml-tiny.en.bin'
    )).toMatchObject({
      uri: 'file:///document/whisper-models/ggml-tiny.en.bin',
      exists: true,
      size: 77704715,
    });
  });

  it('fails cleanly when Android Whisper realtime helper modules are unavailable', async () => {
    await expect(
      startWhisperRealtimeCapture('/tmp/mindwtr-audio.wav', {
        provider: 'whisper',
        model: 'whisper-tiny',
        modelPath: '/tmp/ggml-tiny.en.bin',
      })
    ).rejects.toThrow('Whisper realtime transcription requires native audio stream modules.');
  });

  it('accepts 16 kHz mono PCM WAV input for local Whisper', async () => {
    fileSystemMock.bytes.mockResolvedValueOnce(makePcmWav());

    await expect(
      prepareAudioForLocalWhisper({
        uri: 'file:///tmp/audio.wav',
        platform: 'android',
        source: 'pcm-recorder',
        extension: '.wav',
      })
    ).resolves.toMatchObject({
      uri: 'file:///tmp/audio.wav',
      format: 'wav-pcm',
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      bytes: 6444,
      durationMs: 200,
    });
    expect(appLogMock.logInfo).toHaveBeenCalledWith(
      'ASR_INPUT_ACCEPTED_LOCAL_WHISPER',
      expect.objectContaining({
        extra: expect.objectContaining({
          local_whisper_called: 'false',
          sniffed_format: 'wav',
        }),
      })
    );
  });

  it('rejects compressed audio before local Whisper can run', async () => {
    fileSystemMock.bytes.mockResolvedValueOnce(makeM4aHeader());

    await expect(
      prepareAudioForLocalWhisper({
        uri: 'file:///tmp/audio.m4a',
        platform: 'android',
        source: 'expo-recorder',
        extension: '.m4a',
      })
    ).resolves.toBeNull();
    expect(appLogMock.logWarn).toHaveBeenCalledWith(
      'ASR_INPUT_REJECTED_UNSUPPORTED_FORMAT',
      expect.objectContaining({
        extra: expect.objectContaining({
          extension: '.m4a',
          local_whisper_called: 'false',
          reject_reason: 'too_short',
        }),
      })
    );
  });

  it('does not initialize local Whisper for m4a input', async () => {
    fileSystemMock.bytes.mockResolvedValueOnce(makeM4aHeader());

    await expect(
      processAudioCapture('file:///tmp/audio.m4a', {
        provider: 'whisper',
        model: 'whisper-tiny',
        modelPath: '/tmp/ggml-tiny.en.bin',
      })
    ).rejects.toThrow('Local Whisper can only transcribe 16 kHz mono PCM WAV audio.');
    expect(whisperMock.initWhisper).not.toHaveBeenCalled();
  });
});
