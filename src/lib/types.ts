/**
 * Shared domain types used on both sides of the API.
 */

import type { Outcome } from '@/lib/sports/registry';

export type EventStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
export const EVENT_STATUSES: EventStatus[] = ['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED'];

export type Side = 'HOME' | 'AWAY' | 'ENTRANT';

export type RunTrigger = 'schedule' | 'manual' | 'cron';

/** What a finished event produced. Sport-specific extras live in `extra`. */
export interface EventResult {
  homeScore?: number;
  awayScore?: number;
  winner?: Outcome | null;
  /** Per-period breakdown where the provider gives one (halves, innings, sets). */
  periods?: { label: string; home: number; away: number }[];
  extra?: Record<string, unknown>;
}

export function parseResult(raw: string | null | undefined): EventResult {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as EventResult;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Which side (if any) won, derived from the scores when the winner is absent. */
export function resultWinner(result: EventResult): Outcome | null {
  if (result.winner) return result.winner;
  if (typeof result.homeScore !== 'number' || typeof result.awayScore !== 'number') return null;
  if (result.homeScore > result.awayScore) return 'HOME';
  if (result.homeScore < result.awayScore) return 'AWAY';
  return 'DRAW';
}

export interface Weather {
  tempC?: number;
  windKph?: number;
  rainProb?: number;
  precipMm?: number;
  conditions?: string;
  fetchedAt?: string;
}

/** Outcome (or entrant id) -> probability. */
export type ProbMap = Record<string, number>;

export interface ScoreForecast {
  expected: { home: number; away: number };
  mostLikely: { home: number; away: number; p: number };
  /** Top scorelines with probabilities, most likely first. */
  top: { home: number; away: number; p: number }[];
  /** Probability grid [home][away], truncated. */
  grid?: number[][];
  lines?: Record<string, number>;
}

export interface StatForecast {
  mean: number;
  low: number;
  high: number;
}

export type StatForecasts = Record<string, { home: StatForecast; away: StatForecast }>;

export interface Factor {
  key: string;
  label: string;
  /** Signed effect on the home side's win probability, in probability points. */
  effect: number;
  note?: string;
  source?: 'model' | 'ai';
}

export interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cachedTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
};

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function parseRecord<T = unknown>(raw: string | null | undefined): Record<string, T> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}
