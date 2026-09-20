/**
 * What the AI is told. The system prompt fixes the role and the rules; the
 * user prompt is the stat pack for one event, rendered as compact JSON so
 * nothing is lost to prose. Both are deliberately short: the point is a
 * bounded, evidence-backed adjustment, not an essay.
 */

import type { Headline } from '@/lib/ai/news';
import type { SportDefinition } from '@/lib/sports/registry';
import type { Factor, ProbMap, ScoreForecast } from '@/lib/types';

export interface TeamPack {
  name: string;
  position: number | null;
  played: number | null;
  points: number | null;
  form: string;
  elo: number;
  /** Goals-for and goals-against multipliers from the score model, when fitted. */
  attack: number | null;
  defence: number | null;
  recent: string[];
  injuries: string[];
  lineup: { formation: string | null; confirmed: boolean; starters: string[] } | null;
  restDays: number | null;
  headlines: Headline[];
}

export interface StatPack {
  sport: string;
  competition: string;
  season: string;
  round: string | null;
  kickoff: string;
  venue: string | null;
  weather: string | null;
  home: TeamPack;
  away: TeamPack;
  headToHead: string[];
  algorithm: {
    probabilities: ProbMap;
    expectedScore: ScoreForecast['expected'] | null;
    mostLikely: ScoreForecast['mostLikely'] | null;
    factors: Factor[];
  };
}

const COMMON_RULES = `Rules:
- Never mention betting, odds, bookmakers, staking or value. This is analysis for one person's curiosity.
- The statistical forecast already accounts for ratings, recent form, table position, home advantage, goal rates and head-to-head. Do not restate those as factors.
- A factor is something the statistics cannot see: a key absence and how important that player is, a suspension, a new manager, motivation (title race, relegation, dead rubber, a cup final days away), fixture congestion or long travel, weather that suits one side, a confirmed lineup that differs from the usual one, or a credible headline that changes the picture.
- Effects are in percentage points on the HOME side's win probability; positive favours the home side. Most real factors are worth 1 to 3 points. Only a decisive absence or a dead rubber reaches 6 or more. When nothing material is known, return an empty factor list rather than inventing one.
- Cite the headline source in the note when a factor comes from the news; say "injury list" when it comes from that.
- Absences: list players you believe are unavailable, from the injury list and the headlines, with how important each is to the side.
- The narrative is two or three sentences a knowledgeable fan would find useful: the shape of the match and what decides it. No boilerplate about uncertainty.`;

export function systemPrompt(sport: SportDefinition, mode: 'HYBRID' | 'AI'): string {
  const role = `You are ScoreSage's ${sport.name.toLowerCase()} analyst. You read a stat pack for one upcoming fixture and reply with structured JSON only.`;
  if (mode === 'AI') {
    return `${role}

Task: produce your own forecast. Use the statistical forecast as a prior and move it only for context it cannot see. Return probabilities for ${sport.hasDraws ? 'HOME, DRAW and AWAY' : 'HOME and AWAY'} that sum to 1, a most likely scoreline, your factors, absences, a narrative and how confident the context makes you.

${COMMON_RULES}`;
  }
  return `${role}

Task: adjust, do not replace. The statistical ensemble has produced the forecast in the pack. Return only factors the statistics cannot see, each with a bounded effect, plus absences, a narrative and how confident the context makes you. Do not return probabilities or a scoreline.

${COMMON_RULES}`;
}

function teamText(t: TeamPack): Record<string, unknown> {
  return {
    name: t.name,
    table: t.position !== null ? `${t.position}${t.played !== null ? ` after ${t.played} games` : ''}${t.points !== null ? `, ${t.points} pts` : ''}` : 'unknown',
    form: t.form || 'n/a',
    elo: Math.round(t.elo),
    attack: t.attack !== null ? `${t.attack.toFixed(2)}x league` : undefined,
    defence: t.defence !== null ? `${t.defence.toFixed(2)}x league (lower is better)` : undefined,
    recent: t.recent,
    restDays: t.restDays,
    injuryList: t.injuries.length > 0 ? t.injuries : 'none known',
    lineup: t.lineup ? { formation: t.lineup.formation, confirmed: t.lineup.confirmed, starters: t.lineup.starters } : 'not announced',
    headlines: t.headlines.map((h) => `${h.title} (${h.source || 'unknown source'}, ${h.publishedAt.toISOString().slice(0, 10)})`),
  };
}

export function userPrompt(pack: StatPack): string {
  const body = {
    fixture: {
      sport: pack.sport,
      competition: pack.competition,
      season: pack.season,
      round: pack.round,
      kickoff: pack.kickoff,
      venue: pack.venue,
      weather: pack.weather,
    },
    home: teamText(pack.home),
    away: teamText(pack.away),
    headToHead: pack.headToHead,
    statisticalForecast: {
      probabilities: Object.fromEntries(Object.entries(pack.algorithm.probabilities).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      expectedScore: pack.algorithm.expectedScore,
      mostLikelyScore: pack.algorithm.mostLikely ? `${pack.algorithm.mostLikely.home}-${pack.algorithm.mostLikely.away}` : null,
      alreadyCountedFactors: pack.algorithm.factors.map((f) => `${f.label}: ${f.effect > 0 ? '+' : ''}${f.effect} pts`),
    },
  };
  return `Stat pack:\n${JSON.stringify(body, null, 1)}`;
}

export function reviewSystemPrompt(sport: SportDefinition): string {
  return `You are ScoreSage's ${sport.name.toLowerCase()} analyst reviewing last week's forecasts. You are given each scored fixture with the forecast, the result and the factors that were used. Reply with structured JSON only: a few specific lessons and, if any, concrete suggestions for the model lab. Do not mention betting.`;
}

export function reviewUserPrompt(rows: { fixture: string; forecast: string; result: string; factors: string[] }[]): string {
  return `Scored fixtures:\n${JSON.stringify(rows, null, 1)}`;
}
