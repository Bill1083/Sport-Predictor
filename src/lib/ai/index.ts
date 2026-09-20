/**
 * The configured AI client, or null for "none".
 */

import { AnthropicClient } from '@/lib/ai/anthropic';
import { GeminiClient } from '@/lib/ai/gemini';
import type { AiClient } from '@/lib/ai/provider';
import type { AiProviderKey } from '@/lib/env';

const clients: Partial<Record<AiProviderKey, AiClient>> = {};

export function aiClient(provider: AiProviderKey): AiClient | null {
  if (provider === 'none') return null;
  if (!clients[provider]) clients[provider] = provider === 'anthropic' ? new AnthropicClient() : new GeminiClient();
  return clients[provider] ?? null;
}
