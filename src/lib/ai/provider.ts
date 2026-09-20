/**
 * The AI provider abstraction.
 *
 * Every call is structured-output only: the caller supplies a JSON schema
 * and a Zod validator, the provider returns a parsed object or a typed
 * failure, never free text. Both Gemini and Claude implement this, and the
 * rest of the app never imports an SDK directly.
 */

import type { ZodType, ZodTypeDef } from 'zod';

import type { TokenUsage } from '@/lib/types';

export type AiProvider = 'gemini' | 'anthropic';

export type AiFailureCode = 'NO_API_KEY' | 'BUDGET' | 'TIMEOUT' | 'EMPTY_RESPONSE' | 'INVALID_JSON' | 'SCHEMA_MISMATCH' | 'REFUSED' | 'API_ERROR';

export type AiOutcome<T> =
  | { ok: true; data: T; provider: AiProvider; model: string; usage: TokenUsage; latencyMs: number }
  | { ok: false; code: AiFailureCode; reason: string; provider: AiProvider; model: string; usage: TokenUsage; latencyMs: number };

/** A compact JSON-Schema subset both providers understand. */
export type JsonSchema =
  | { type: 'object'; properties: Record<string, JsonSchema>; required?: string[]; description?: string }
  | { type: 'array'; items: JsonSchema; description?: string; maxItems?: number }
  | { type: 'string'; enum?: string[]; description?: string }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number; description?: string }
  | { type: 'boolean'; description?: string };

export type AiEffort = 'low' | 'medium' | 'high';

export interface StructuredRequest<T> {
  purpose: 'context' | 'adjust' | 'predict' | 'explain' | 'review';
  system: string;
  prompt: string;
  schema: JsonSchema;
  validator: ZodType<T, ZodTypeDef, unknown>;
  model: string;
  effort: AiEffort;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface AiClient {
  readonly provider: AiProvider;
  configured(): boolean;
  generate<T>(request: StructuredRequest<T>): Promise<AiOutcome<T>>;
}

/**
 * Pull a JSON object out of a model response. Structured output normally
 * guarantees bare JSON, but a fenced block still shows up occasionally and
 * is cheap to recover from.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new SyntaxError('No JSON object found in the model response');
  }
}

/** Keep API keys and URLs out of anything shown to the user. */
export function sanitiseError(message: string): string {
  const cleaned = message
    .replace(/key=[^&\s"']+/gi, 'key=***')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '***')
    .replace(/sk-ant-[0-9A-Za-z_-]{10,}/g, '***');
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}...` : cleaned;
}

/** Validate a parsed response, turning schema problems into a typed failure. */
export function validateResponse<T>(
  parsed: unknown,
  request: StructuredRequest<T>,
  base: { provider: AiProvider; model: string; usage: TokenUsage; latencyMs: number },
): AiOutcome<T> {
  const validated = request.validator.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const path = issue?.path.join('.') || 'response';
    return { ok: false, code: 'SCHEMA_MISMATCH', reason: `Response failed validation at "${path}": ${issue?.message ?? 'unknown issue'}.`, ...base };
  }
  return { ok: true, data: validated.data, ...base };
}

export function describeFailure(code: AiFailureCode): string {
  switch (code) {
    case 'NO_API_KEY':
      return 'No API key is configured for the AI provider.';
    case 'BUDGET':
      return 'The monthly AI budget is spent.';
    case 'TIMEOUT':
      return 'The AI provider timed out.';
    case 'EMPTY_RESPONSE':
      return 'The AI provider returned nothing usable.';
    case 'REFUSED':
      return 'The AI provider declined the request.';
    case 'INVALID_JSON':
    case 'SCHEMA_MISMATCH':
      return 'The AI provider returned data that did not match the required schema.';
    default:
      return 'The AI request failed.';
  }
}
