import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider } from './openai';

const mockOpenAiSuccess = () =>
    new Response(
        JSON.stringify({
            choices: [
                {
                    message: {
                        content: JSON.stringify({
                            question: 'What is the next action?',
                            options: [{ label: 'Do it', action: 'do' }],
                        }),
                    },
                },
            ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('openai provider auth behavior', () => {
    it('requires an API key for the default OpenAI endpoint', async () => {
        const provider = createOpenAIProvider({
            provider: 'openai',
            apiKey: '',
            model: 'gpt-4o-mini',
        });

        await expect(
            provider.clarifyTask({
                title: 'Plan trip',
            }),
        ).rejects.toThrow('OpenAI API key is required.');
    });

    it('allows empty API key for custom OpenAI-compatible endpoints', async () => {
        const fetchMock = vi.fn(async () => mockOpenAiSuccess());
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            endpoint: 'http://localhost:11434/v1/chat/completions',
            apiKey: '',
            model: 'llama3.2',
        });

        const result = await provider.clarifyTask({ title: 'Plan trip' });
        expect(result.question).toBe('What is the next action?');

        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const headers = (requestInit?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBeUndefined();
    });

    it('uses the configured fetcher instead of global fetch', async () => {
        const fetchMock = vi.fn(async () => mockOpenAiSuccess());
        globalThis.fetch = vi.fn(async () => {
            throw new Error('global fetch should not be used');
        }) as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            apiKey: 'test-key',
            model: 'gpt-4o-mini',
            fetcher: fetchMock as unknown as typeof fetch,
        });

        const result = await provider.clarifyTask({ title: 'Plan trip' });
        expect(result.question).toBe('What is the next action?');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('surfaces custom endpoint auth errors without implying official OpenAI auth', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    error: {
                        message: 'invalid token',
                    },
                }),
                { status: 401, headers: { 'Content-Type': 'application/json' } },
            ));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            endpoint: 'https://glm.example.com/v1/chat/completions',
            apiKey: 'bad-token',
            model: 'GLM-4.7',
        });

        await expect(
            provider.clarifyTask({
                title: 'Plan trip',
            }),
        ).rejects.toThrow('OpenAI-compatible endpoint rejected the request. Check the custom base URL, API key, and model.');
    });

    it('adds extra OpenAI-compatible body params without overriding core request fields', async () => {
        const fetchMock = vi.fn(async () => mockOpenAiSuccess());
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
            apiKey: 'test-key',
            model: 'glm-4.5-flash',
            extraBodyParams: {
                thinking: { type: 'disabled' },
                max_tokens: 1024,
                model: 'wrong-model',
                messages: [],
                response_format: { type: 'text' },
            },
        });

        await provider.clarifyTask({ title: 'Plan trip' });

        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(requestInit?.body ?? '{}')) as Record<string, unknown>;
        expect(body.thinking).toEqual({ type: 'disabled' });
        expect(body.max_tokens).toBe(1024);
        expect(body.model).toBe('glm-4.5-flash');
        expect(body.messages).toEqual([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
        ]);
        expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('falls back to reasoning_content when an OpenAI-compatible endpoint returns empty content', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: '',
                                reasoning_content: JSON.stringify({
                                    question: 'What is the next action?',
                                    options: [{ label: 'Do it', action: 'do' }],
                                }),
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            endpoint: 'http://localhost:11434/v1/chat/completions',
            apiKey: '',
            model: 'qwen-local',
        });

        const result = await provider.clarifyTask({ title: 'Plan trip' });

        expect(result.question).toBe('What is the next action?');
    });

    it('reads text from OpenAI-compatible content part arrays', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: [
                                    {
                                        type: 'text',
                                        text: JSON.stringify({
                                            question: 'What is the next action?',
                                            options: [{ label: 'Do it', action: 'do' }],
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
            ));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const provider = createOpenAIProvider({
            provider: 'openai',
            endpoint: 'http://localhost:11434/v1/chat/completions',
            apiKey: '',
            model: 'qwen-local',
        });

        const result = await provider.clarifyTask({ title: 'Plan trip' });

        expect(result.question).toBe('What is the next action?');
    });
});
