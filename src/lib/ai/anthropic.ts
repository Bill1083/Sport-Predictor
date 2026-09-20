/**
 * Anthropic Claude behind the AiClient interface. Structured output via
 * `messages.parse` with the Zod validator as the output format, adaptive
 * thinking, and the effort level from Settings. A refusal stop reason is
 * reported as such rather than treated as a parse failure.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';

import { env } from '@/lib/env';
import { extractJson, sanitiseError, validateResponse, type AiClient, type AiOutcome, type StructuredRequest } from '@/lib/ai/provider';
import { ZERO_USAGE, type TokenUsage } from '@/lib/types';

const DEFAULT_TIMEOUT_MS = 90_000;

let client: Anthropic | null = null;
let clientKey: string | null = null;

function getClient(apiKey: string, timeoutMs: number): Anthropic {
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

export class AnthropicClient implements AiClient {
  readonly provider = 'anthropic' as const;

  configured(): boolean {
    return Boolean(env.anthropicApiKey);
  }

  async generate<T>(request: StructuredRequest<T>): Promise<AiOutcome<T>> {
    const apiKey = env.anthropicApiKey;
    const model = request.model;
    const started = Date.now();
    const base = { provider: this.provider, model, usage: { ...ZERO_USAGE } };
    if (!apiKey) return { ok: false, code: 'NO_API_KEY', reason: 'ANTHROPIC_API_KEY is not configured.', ...base, latencyMs: 0 };

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Haiku 4.5 still uses a fixed thinking budget; every current model takes adaptive thinking.
    const adaptive = !/haiku/i.test(model);
    let usage: TokenUsage = { ...ZERO_USAGE };
    let parsed: unknown;
    let stopReason: string | null = null;
    try {
      const response = await getClient(apiKey, timeoutMs).messages.parse({
        model,
        max_tokens: request.maxOutputTokens ?? 4_096,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        ...(adaptive ? { thinking: { type: 'adaptive' as const } } : {}),
        output_config: {
          ...(adaptive ? { effort: request.effort } : {}),
          format: zodOutputFormat(request.validator as unknown as ZodType),
        },
      });
      stopReason = response.stop_reason;
      usage = {
        promptTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
        thoughtTokens: 0,
        cachedTokens: response.usage.cache_read_input_tokens ?? 0,
      };
      if (stopReason === 'refusal') {
        return { ok: false, code: 'REFUSED', reason: 'Claude declined the request.', ...base, usage, latencyMs: Date.now() - started };
      }
      parsed = response.parsed_output ?? null;
      if (parsed === null) {
        const text = response.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
          .trim();
        if (!text) return { ok: false, code: 'EMPTY_RESPONSE', reason: 'Claude returned no text.', ...base, usage, latencyMs: Date.now() - started };
        parsed = extractJson(text);
      }
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        return { ok: false, code: 'TIMEOUT', reason: `Claude did not respond within ${Math.round(timeoutMs / 1000)}s.`, ...base, latencyMs };
      }
      if (error instanceof SyntaxError) {
        return { ok: false, code: 'INVALID_JSON', reason: 'Claude returned a response that was not valid JSON.', ...base, usage, latencyMs };
      }
      const message = error instanceof Anthropic.APIError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : 'Unknown error';
      console.error('[scoresage] anthropic request failed:', sanitiseError(message));
      return { ok: false, code: 'API_ERROR', reason: sanitiseError(message), ...base, latencyMs };
    }
    return validateResponse(parsed, request, { ...base, usage, latencyMs: Date.now() - started });
  }
}
