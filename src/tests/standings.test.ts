import { describe, expect, it } from 'vitest';

import { buildTable } from '@/lib/standings';

const team = (id: string) => ({ id, name: id.toUpperCase(), shortName: null, code: null, crestUrl: null });

function event(home: string, away: string, hs: number, as: number, day: number, status = 'FINISHED') {
  return {
    homeTeamId: home,
    awayTeamId: away,
    homeTeam: team(home),
    awayTeam: team(away),
    status,
    startsAt: new Date(Date.UTC(2026, 0, day)),
    resultJson: JSON.stringify({ homeScore: hs, awayScore: as }),
  };
}

describe('buildTable', () => {
  it('awards points, ranks by points then goal difference then goals for', () => {
    const table = buildTable([
      event('a', 'b', 2, 0, 1),
      event('c', 'd', 1, 1, 1),
      event('b', 'c', 0, 3, 2),
      event('d', 'a', 1, 1, 2),
    ]);
    // c and a both have 4 points; c's goal difference (+3) beats a's (+2).
    expect(table.map((r) => r.team.id)).toEqual(['c', 'a', 'd', 'b']);
    const a = table[1];
    expect(a.points).toBe(4);
    expect(a.played).toBe(2);
    expect(a.scoredFor - a.scoredAgainst).toBe(2);
    expect(a.form).toBe('WD');
    expect(table[3].points).toBe(0);
  });

  it('lists scheduled teams with zero games and ignores unplayed results', () => {
    const table = buildTable([event('a', 'b', 0, 0, 5, 'SCHEDULED')]);
    expect(table).toHaveLength(2);
    expect(table.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it('keeps only the last five results in the form string', () => {
    const events = Array.from({ length: 7 }, (_, i) => event('a', 'b', i % 2 === 0 ? 1 : 0, 0, i + 1));
    const table = buildTable(events);
    expect(table[0].form).toHaveLength(5);
  });
});
