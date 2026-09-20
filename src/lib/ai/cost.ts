/**
 * Token accounting: USD from the real token counts each call reports, the
 * monthly ledger, and the budget gate the predict job checks before calling.
 */

import { prisma, withDatabase } from '@/lib/prisma';
import { getGlobalSettings } from '@/lib/settings';
import { startOfDayUtc, zonedParts, zonedTimeToUtc } from '@/lib/time';
import type { TokenUsage } from '@/lib/types';
import type { AiFailureCode, AiOutcome, AiProvider } from '@/lib/ai/provider';

export function computeCostUsd(usage: TokenUsage, priceInputPerM: number, priceOutputPerM: number): number {
  const input = Math.max(0, usage.promptTokens - usage.cachedTokens) + usage.cachedTokens * 0.25;
  const output = usage.outputTokens + usage.thoughtTokens;
  return (input * priceInputPerM + output * priceOutputPerM) / 1_000_000;
}

/** First instant of the current calendar month in APP_TIMEZONE. */
export function monthStart(now = new Date()): Date {
  const p = zonedParts(now);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0);
}

export async function monthlySpend(now = new Date()): Promise<number> {
  const result = await withDatabase(() => prisma.aiCall.aggregate({ where: { createdAt: { gte: monthStart(now) } }, _sum: { costUsd: true } }));
  return result.ok ? result.data._sum.costUsd ?? 0 : 0;
}

export async function todaySpend(now = new Date()): Promise<number> {
  const result = await withDatabase(() => prisma.aiCall.aggregate({ where: { createdAt: { gte: startOfDayUtc(now) } }, _sum: { costUsd: true } }));
  return result.ok ? result.data._sum.costUsd ?? 0 : 0;
}

/** True while this month's spend is under the configured cap. */
export async function withinBudget(): Promise<{ ok: boolean; spent: number; budget: number }> {
  const settings = await getGlobalSettings();
  const spent = await monthlySpend();
  return { ok: settings.aiMonthlyBudgetUsd <= 0 || spent < settings.aiMonthlyBudgetUsd, spent, budget: settings.aiMonthlyBudgetUsd };
}

export async function recordAiCall(
  outcome: AiOutcome<unknown>,
  context: { purpose: string; eventId?: string | null; runId?: string | null; priceInputPerM: number; priceOutputPerM: number },
): Promise<number> {
  const costUsd = computeCostUsd(outcome.usage, context.priceInputPerM, context.priceOutputPerM);
  await withDatabase(() =>
    prisma.aiCall.create({
      data: {
        purpose: context.purpose,
        provider: outcome.provider as AiProvider,
        model: outcome.model,
        promptTokens: outcome.usage.promptTokens,
        outputTokens: outcome.usage.outputTokens,
        thoughtTokens: outcome.usage.thoughtTokens,
        cachedTokens: outcome.usage.cachedTokens,
        costUsd,
        latencyMs: outcome.latencyMs,
        ok: outcome.ok,
        errorCode: outcome.ok ? null : (outcome.code as AiFailureCode),
        eventId: context.eventId ?? null,
        runId: context.runId ?? null,
      },
    }),
  );
  return costUsd;
}
