import { describe, expect, it } from 'vitest';

import { fitPace, simulateRace, type PastRace } from '@/lib/engine/sports/f1';
import { mapRace } from '@/lib/providers/jolpica';

/** Twenty drivers, three seasons of races where driver order is stable with a little noise. */
function history(races: number, seed = 3): PastRace[] {
  let a = seed;
  const random = () => {
    a = (a * 1_103_515_245 + 12_345) % 2_147_483_648;
    return a / 2_147_483_648;
  };
  const drivers = Array.from({ length: 20 }, (_, i) => `d${i + 1}`);
  const out: PastRace[] = [];
  for (let r = 0; r < races; r += 1) {
    const order = drivers.map((id, i) => ({ id, key: i + (random() - 0.5) * 4 })).sort((x, y) => x.key - y.key);
    out.push({
      date: new Date(Date.UTC(2024, 0, 1) + r * 14 * 86_400_000),
      results: order.map((d, pos) => {
        const dnf = random() < (d.id === 'd20' ? 0.4 : 0.05);
        return { teamId: d.id, finishPosition: dnf ? null : pos + 1, gridPosition: pos + 1, statusNote: dnf ? 'Engine' : 'Finished' };
      }),
    });
  }
  return out;
}

describe('fitPace', () => {
  it('ranks drivers by their finishing record and measures retirements', () => {
    const fitted = fitPace(history(30), new Date('2025-06-01T00:00:00Z'), 0.006);
    expect(fitted.get('d1')!.pace).toBeGreaterThan(fitted.get('d10')!.pace);
    expect(fitted.get('d10')!.pace).toBeGreaterThan(fitted.get('d19')!.pace);
    expect(fitted.get('d20')!.dnf).toBeGreaterThan(fitted.get('d1')!.dnf + 0.15);
  });

  it('shrinks a single race toward the midfield', () => {
    const fitted = fitPace(history(1), new Date('2024-01-15T00:00:00Z'), 0.006);
    // One win scores 20; with the prior it lands well below.
    expect(fitted.get('d1')!.pace).toBeLessThan(18);
    expect(fitted.get('d1')!.pace).toBeGreaterThan(10);
  });
});

describe('simulateRace', () => {
  const entrants = Array.from({ length: 20 }, (_, i) => ({ teamId: `d${i + 1}`, name: `Driver ${i + 1}`, gridPosition: null }));

  it('returns win probabilities that sum to one and favour the fastest driver', () => {
    const forecast = simulateRace(entrants, history(30), new Date('2025-06-01T00:00:00Z'), { xi: 0.006, runs: 2_000, gridWeight: 0.6, noise: 0.35 });
    const total = Object.values(forecast.probs).reduce((s, p) => s + p, 0);
    expect(total).toBeCloseTo(1, 1);
    expect(forecast.entrants[0].teamId).toBe('d1');
    expect(forecast.entrants[0].win).toBeGreaterThan(0.2);
    expect(forecast.entrants[0].podium).toBeGreaterThan(forecast.entrants[0].win);
    expect(forecast.entrants[0].points).toBeGreaterThan(forecast.entrants[0].podium);
    expect(forecast.entrants[0].expectedPosition).toBeLessThan(forecast.entrants[10].expectedPosition);
    const last = forecast.entrants.find((e) => e.teamId === 'd20')!;
    expect(last.dnf).toBeGreaterThan(0.2);
  });

  it('lets a strong grid position lift a midfield driver', () => {
    const past = history(30);
    const asOf = new Date('2025-06-01T00:00:00Z');
    const noGrid = simulateRace(entrants, past, asOf, { xi: 0.006, runs: 2_000, gridWeight: 0.6, noise: 0.35 });
    const onPole = entrants.map((e) => ({ ...e, gridPosition: e.teamId === 'd10' ? 1 : e.teamId === 'd1' ? 10 : Number(e.teamId.slice(1)) }));
    const withGrid = simulateRace(onPole, past, asOf, { xi: 0.006, runs: 2_000, gridWeight: 0.6, noise: 0.35 });
    const before = noGrid.entrants.find((e) => e.teamId === 'd10')!;
    const after = withGrid.entrants.find((e) => e.teamId === 'd10')!;
    expect(after.win).toBeGreaterThan(before.win * 3);
    expect(after.expectedPosition).toBeLessThan(before.expectedPosition);
  });

  it('is deterministic for the same inputs and empty for no entrants', () => {
    const asOf = new Date('2025-06-01T00:00:00Z');
    const a = simulateRace(entrants, history(10), asOf, { xi: 0.006, runs: 500, gridWeight: 0.6, noise: 0.35 });
    const b = simulateRace(entrants, history(10), asOf, { xi: 0.006, runs: 500, gridWeight: 0.6, noise: 0.35 });
    expect(a.probs).toEqual(b.probs);
    expect(simulateRace([], [], asOf).entrants).toHaveLength(0);
  });
});

describe('mapRace (Jolpica)', () => {
  const driver = (id: string, family: string, code: string) => ({ driverId: id, code, givenName: 'A', familyName: family, nationality: 'X' });
  const base = {
    season: '2026',
    round: '3',
    raceName: 'Test Grand Prix',
    Circuit: { circuitId: 'test', circuitName: 'Test Circuit', Location: { lat: '1.5', long: '2.5', locality: 'Town', country: 'Land' } },
    date: '2026-04-05',
    time: '13:00:00Z',
  };

  it('maps a finished race with results, grid and winner', () => {
    const ref = mapRace(
      {
        ...base,
        Results: [
          { position: '1', positionText: '1', points: '25', grid: '2', status: 'Finished', Driver: driver('a', 'Alpha', 'ALP'), Constructor: { constructorId: 'c1', name: 'Team One' } },
          { position: '2', positionText: '2', points: '18', grid: '1', status: 'Finished', Driver: driver('b', 'Beta', 'BET'), Constructor: { constructorId: 'c2', name: 'Team Two' } },
          { position: '3', positionText: 'R', points: '0', grid: '0', status: 'Collision', Driver: driver('c', 'Gamma', 'GAM'), Constructor: { constructorId: 'c2', name: 'Team Two' } },
        ],
      },
      [],
      new Date('2026-05-01T00:00:00Z'),
    );
    expect(ref.status).toBe('FINISHED');
    expect(ref.externalId).toBe('2026-3');
    expect(ref.round).toBe('Round 3: Test Grand Prix');
    expect(ref.startsAt.toISOString()).toBe('2026-04-05T13:00:00.000Z');
    expect(ref.venue?.lat).toBe(1.5);
    expect(ref.entrants).toHaveLength(3);
    expect(ref.entrants?.[0]).toMatchObject({ gridPosition: 2, finishPosition: 1, score: 25, statusNote: 'Finished' });
    expect(ref.entrants?.[0].team).toMatchObject({ externalId: 'a', name: 'A Alpha', kind: 'DRIVER', country: 'Team One' });
    // A pit-lane start has grid 0 in the feed: unknown, not position zero.
    expect(ref.entrants?.[2].gridPosition).toBeUndefined();
    expect(ref.result?.extra).toMatchObject({ winnerName: 'A Alpha' });
  });

  it('uses qualifying for the grid before the race and the entry list before that', () => {
    const now = new Date('2026-04-01T00:00:00Z');
    const qualified = mapRace({ ...base, QualifyingResults: [{ position: '1', Driver: driver('b', 'Beta', 'BET'), Constructor: { constructorId: 'c2', name: 'Team Two' } }] }, [driver('a', 'Alpha', 'ALP')], now);
    expect(qualified.status).toBe('SCHEDULED');
    expect(qualified.entrants).toEqual([expect.objectContaining({ gridPosition: 1 })]);
    const entry = mapRace(base, [driver('a', 'Alpha', 'ALP'), driver('b', 'Beta', 'BET')], now);
    expect(entry.entrants).toHaveLength(2);
    expect(entry.entrants?.[0].gridPosition).toBeUndefined();
    expect(entry.result).toBeUndefined();
  });
});
