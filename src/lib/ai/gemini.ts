/**
 * Google Gemini behind the AiClient interface. Structured output via
 * responseSchema; the compact JSON schema is translated to Gemini's own
 * Schema type. Thinking is off for extraction-style work and given a small
 * budget for "medium" and "high" effort.
 */

import { GoogleGenAI, Type, type Schema } from '@google/genai';

import { env } from '@/lib/env';
import { extractJson, sanitiseError, validateResponse, type AiClient, type AiOutcome, type JsonSchema, type StructuredRequest } from '@/lib/ai/provider';
import { ZERO_USAGE, type TokenUsage } from '@/lib/types';

const DEFAULT_TIMEOUT_MS = 60_000;

let client: GoogleGenAI | null = null;
let clientKey: string | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (!client || clientKey !== apiKey) {
    client = new GoogleGenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

export function toGeminiSchema(schema: JsonSchema): Schema {
  switch (schema.type) {
    case 'object':
      return {
        type: Type.OBJECT,
        description: schema.description,
        properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)])),
        required: schema.required,
      };
    case 'array':
      return { type: Type.ARRAY, description: schema.description, items: toGeminiSchema(schema.items), maxItems: schema.maxItems !== undefined ? String(schema.maxItems) : undefined };
    case 'string':
      return { type: Type.STRING, description: schema.description, enum: schema.enum, format: schema.enum ? 'enum' : undefined };
    case 'integer':
      return { type: Type.INTEGER, description: schema.description, minimum: schema.minimum, maximum: schema.maximum };
    case 'number':
      return { type: Type.NUMBER, description: schema.description, minimum: schema.minimum, maximum: schema.maximum };
    case 'boolean':
      return { type: Type.BOOLEAN, description: schema.description };
  }
}

interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

function usageFromMetadata(meta: UsageMetadataLike | undefined | null): TokenUsage {
  if (!meta) return { ...ZERO_USAGE };
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { promptTokens: n(meta.promptTokenCount), outputTokens: n(meta.candidatesTokenCount), thoughtTokens: n(meta.thoughtsTokenCount), cachedTokens: n(meta.cachedContentTokenCount) };
}

const THINKING_BUDGET = { low: 0, medium: 1_024, high: 4_096 } as const;

export class GeminiClient implements AiClient {
  readonly provider = 'gemini' as const;

  configured(): boolean {
    return Boolean(env.geminiApiKey);
  }

  async generate<T>(request: StructuredRequest<T>): Promise<AiOutcome<T>> {
    const apiKey = env.geminiApiKey;
    const model = request.model;
    const started = Date.now();
    const base = { provider: this.provider, model, usage: { ...ZERO_USAGE } };
    if (!apiKey) return { ok: false, code: 'NO_API_KEY', reason: 'GEMINI_API_KEY is not configured.', ...base, latencyMs: 0 };

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let text: string | undefined;
    let usage: TokenUsage = { ...ZERO_USAGE };
    try {
      const response = await getClient(apiKey).models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        config: {
          systemInstruction: request.system,
          temperature: 0.3,
          maxOutputTokens: request.maxOutputTokens ?? 4_096,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(request.schema),
          thinkingConfig: { thinkingBudget: THINKING_BUDGET[request.effort] },
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
      text = response.text;
      usage = usageFromMetadata(response.usageMetadata);
    } catch (error) {
      const latencyMs = Date.now() - started;
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, code: 'TIMEOUT', reason: `Gemini did not respond within ${Math.round(timeoutMs / 1000)}s.`, ...base, latencyMs };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[scoresage] gemini request failed:', sanitiseError(message));
      return { ok: false, code: 'API_ERROR', reason: sanitiseError(message), ...base, latencyMs };
    }
    const latencyMs = Date.now() - started;
    const withUsage = { ...base, usage, latencyMs };
    if (!text || !text.trim()) return { ok: false, code: 'EMPTY_RESPONSE', reason: 'Gemini returned an empty response, most likely a safety block.', ...withUsage };
    let parsed: unknown;
    try {
      parsed = extractJson(text);
    } catch {
      return { ok: false, code: 'INVALID_JSON', reason: 'Gemini returned a response that was not valid JSON.', ...withUsage };
    }
    return validateResponse(parsed, request, withUsage);
  }
}
