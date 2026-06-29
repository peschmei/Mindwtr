import { describe, expect, it } from 'vitest';
import {
    buildCaptureExtra,
    buildCaptureFileUri,
    getCaptureFileExtension,
    getCaptureMimeType,
    isQuickCaptureSpeechReady,
    normalizeContextToken,
    parseContextQueryTokens,
    selectQuickCaptureSettings,
} from './quick-capture-sheet.utils';

describe('quick-capture utils', () => {
    it('extracts file extension with fallback', () => {
        expect(getCaptureFileExtension('/tmp/clip.wav')).toBe('.wav');
        expect(getCaptureFileExtension('/tmp/clip')).toBe('.m4a');
    });

    it('maps mime types for supported extensions', () => {
        expect(getCaptureMimeType('.wav')).toBe('audio/wav');
        expect(getCaptureMimeType('.mp3')).toBe('audio/mpeg');
        expect(getCaptureMimeType('.unknown')).toBe('audio/mp4');
    });

    it('builds capture file URIs inside the target directory', () => {
        expect(buildCaptureFileUri('file:///document/audio-captures', 'mindwtr-audio.m4a'))
            .toBe('file:///document/audio-captures/mindwtr-audio.m4a');
        expect(buildCaptureFileUri('file:///document/audio-captures/', 'mindwtr-audio.wav'))
            .toBe('file:///document/audio-captures/mindwtr-audio.wav');
    });

    it('builds structured capture error metadata', () => {
        const error = new Error('boom');
        const extra = buildCaptureExtra('Failed capture', error);
        expect(extra).toMatchObject({
            message: 'Failed capture',
            error: 'boom',
        });
        expect(buildCaptureExtra()).toBeUndefined();
    });

    it('normalizes context tokens with @ prefix', () => {
        expect(normalizeContextToken(' @Work ')).toBe('@Work');
        expect(normalizeContextToken('＠home')).toBe('@home');
        expect(normalizeContextToken('')).toBe('');
    });

    it('parses context query tokens with dedupe', () => {
        expect(parseContextQueryTokens(' @work,home,@Work,, ＠errands ')).toEqual([
            '@work',
            '@home',
            '@errands',
        ]);
    });

    it('treats a ready local Whisper model as quick-capture speech ready', () => {
        expect(isQuickCaptureSpeechReady({
            speechEnabled: true,
            provider: 'whisper',
            whisperModelReady: true,
        })).toBe(true);
        expect(isQuickCaptureSpeechReady({
            speechEnabled: true,
            provider: 'whisper',
            whisperModelReady: false,
        })).toBe(false);
        expect(isQuickCaptureSpeechReady({
            speechEnabled: true,
            provider: 'gemini',
            apiKey: '',
            whisperModelReady: true,
        })).toBe(false);
    });

    it('uses the latest store speech settings over a stale capture snapshot', () => {
        const staleSettings = {
            ai: {
                speechToText: {
                    provider: 'whisper',
                    model: 'whisper-tiny.en',
                    offlineModelPath: 'file:///document/ggml-tiny.en.bin',
                },
            },
        };
        const latestSettings = {
            ai: {
                speechToText: {
                    provider: 'whisper',
                    model: 'whisper-tiny.en',
                    offlineModelPath: 'file:///document/whisper-models/ggml-tiny.en.bin',
                },
            },
        };

        expect(selectQuickCaptureSettings(staleSettings, latestSettings)).toBe(latestSettings);
        expect(selectQuickCaptureSettings(staleSettings, undefined)).toBe(staleSettings);
    });
});
