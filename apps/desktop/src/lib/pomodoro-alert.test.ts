import { afterEach, describe, expect, it, vi } from 'vitest';

import { playPomodoroCompletionSound, requestPomodoroWindowAttention } from './pomodoro-alert';

const attentionMocks = vi.hoisted(() => ({
    isTauriRuntime: vi.fn<() => boolean>(),
    isFocused: vi.fn<() => Promise<boolean>>(),
    requestUserAttention: vi.fn<(type: number) => Promise<void>>(),
}));

vi.mock('./runtime', () => ({
    isTauriRuntime: attentionMocks.isTauriRuntime,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        isFocused: attentionMocks.isFocused,
        requestUserAttention: attentionMocks.requestUserAttention,
    }),
    UserAttentionType: { Critical: 1, Informational: 2 },
}));

describe('pomodoro-alert', () => {
    const originalAudioContext = globalThis.AudioContext;
    const originalWebkitAudioContext = (globalThis as typeof globalThis & { webkitAudioContext?: unknown }).webkitAudioContext;

    afterEach(() => {
        globalThis.AudioContext = originalAudioContext;
        (globalThis as typeof globalThis & { webkitAudioContext?: unknown }).webkitAudioContext = originalWebkitAudioContext;
        vi.restoreAllMocks();
    });

    it('plays a short two-tone completion chime when Web Audio is available', async () => {
        const gainNode = {
            connect: vi.fn(),
            gain: {
                cancelScheduledValues: vi.fn(),
                setValueAtTime: vi.fn(),
                exponentialRampToValueAtTime: vi.fn(),
            },
        };
        const oscillators: Array<{
            frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
            connect: ReturnType<typeof vi.fn>;
            start: ReturnType<typeof vi.fn>;
            stop: ReturnType<typeof vi.fn>;
            type?: OscillatorType;
        }> = [];
        const audioContext = {
            currentTime: 10,
            destination: {},
            state: 'running',
            createGain: vi.fn(() => gainNode),
            createOscillator: vi.fn(() => {
                const oscillator = {
                    frequency: { setValueAtTime: vi.fn() },
                    connect: vi.fn(),
                    start: vi.fn(),
                    stop: vi.fn(),
                    type: undefined,
                };
                oscillators.push(oscillator);
                return oscillator;
            }),
        };

        globalThis.AudioContext = vi.fn(() => audioContext) as unknown as typeof AudioContext;

        await playPomodoroCompletionSound();

        expect(audioContext.createGain).toHaveBeenCalledTimes(1);
        expect(audioContext.createOscillator).toHaveBeenCalledTimes(2);
        expect(oscillators.map((oscillator) => oscillator.frequency.setValueAtTime.mock.calls[0]?.[0])).toEqual([880, 1174]);
        expect(oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)).toBe(true);
        expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 1)).toBe(true);
    });

    it('does nothing when Web Audio is unavailable', async () => {
        globalThis.AudioContext = undefined as unknown as typeof AudioContext;
        (globalThis as typeof globalThis & { webkitAudioContext?: unknown }).webkitAudioContext = undefined;

        await expect(playPomodoroCompletionSound()).resolves.toBeUndefined();
    });

    it('flashes the window attention cue when the window is unfocused', async () => {
        attentionMocks.isTauriRuntime.mockReturnValue(true);
        attentionMocks.isFocused.mockResolvedValue(false);
        attentionMocks.requestUserAttention.mockResolvedValue(undefined);

        await requestPomodoroWindowAttention();

        expect(attentionMocks.requestUserAttention).toHaveBeenCalledWith(1);
    });

    it('skips the attention cue when the window is focused', async () => {
        attentionMocks.isTauriRuntime.mockReturnValue(true);
        attentionMocks.isFocused.mockResolvedValue(true);

        await requestPomodoroWindowAttention();

        expect(attentionMocks.requestUserAttention).not.toHaveBeenCalled();
    });

    it('skips the attention cue outside the Tauri runtime', async () => {
        attentionMocks.isTauriRuntime.mockReturnValue(false);

        await requestPomodoroWindowAttention();

        expect(attentionMocks.isFocused).not.toHaveBeenCalled();
        expect(attentionMocks.requestUserAttention).not.toHaveBeenCalled();
    });
});
