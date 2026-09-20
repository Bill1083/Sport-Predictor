import { NextResponse } from 'next/server';

import { guard } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';
import { parseJson } from '@/lib/prisma';
import { parseResult, resultWinner, type ProbMap } from '@/lib/types';

export const dynamic = 'force-dynamic';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * GET /api/export?sport=&days=365 - every scored final prediction as CSV,
 * one row per model per event, for your own analysis elsewhere.
 */
export async function GET(request: Request) {
  return guard(async () => {
    const url = new URL(request.url);
    const sportKey = url.searchParams.get('sport');
    const days = Math.min(3650, Math.max(1, Number(url.searchParams.get('days') ?? 365) || 365));
    const rows = await withDatabase(() =>
      prisma.evaluation.findMany({
        where: { createdAt: { gte: new Date(Date.now() - days * 86_400_000) }, ...(sportKey && sportKey !== 'all' ? { event: { sportKey } } : {}) },
        include: {
          prediction: { select: { probsJson: true, scoreJson: true, version: true, minutesToKickoff: true, mode: true } },
          event: { include: { competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20_000,
      }),
    );
    const header = ['event_id', 'date', 'sport', 'competition', 'home', 'away', 'model', 'version', 'minutes_to_kickoff', 'mode', 'p_home', 'p_draw', 'p_away', 'predicted_home', 'predicted_away', 'actual_home', 'actual_away', 'outcome', 'correct', 'brier', 'log_loss', 'rps'];
    const lines = [header.join(',')];
    for (const row of rows.ok ? rows.data : []) {
      const probs = parseJson<ProbMap>(row.prediction.probsJson, {});
      const score = parseJson<{ mostLikely?: { home: number; away: number } } | null>(row.prediction.scoreJson, null);
      const result = parseResult(row.event.resultJson);
      lines.push(
        [
          row.eventId,
          row.event.startsAt.toISOString(),
          row.event.sportKey,
          row.event.competition.name,
          row.event.homeTeam?.name ?? '',
          row.event.awayTeam?.name ?? '',
          row.modelKey,
          row.prediction.version,
          row.prediction.minutesToKickoff ?? '',
          row.prediction.mode,
          probs.HOME?.toFixed(4) ?? '',
          probs.DRAW?.toFixed(4) ?? '',
          probs.AWAY?.toFixed(4) ?? '',
          score?.mostLikely?.home ?? '',
          score?.mostLikely?.away ?? '',
          result.homeScore ?? '',
          result.awayScore ?? '',
          resultWinner(result) ?? '',
          row.correct ? 1 : 0,
          row.brier.toFixed(4),
          row.logLoss.toFixed(4),
          row.rps !== null ? row.rps.toFixed(4) : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return new NextResponse(lines.join('\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="scoresage-predictions-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }, 'GET /api/export');
}
