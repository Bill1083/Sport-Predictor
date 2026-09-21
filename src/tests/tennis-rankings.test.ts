import { describe, expect, it } from 'vitest';

import { archiveDate, latestRankings, type ArchiveRow } from '@/lib/providers/tennis-archive';

describe('archiveDate', () => {
  it('reads the archive\'s compact date as UTC', () => {
    expect(archiveDate('20260608')?.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(archiveDate('20260101')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects anything that is not eight digits', () => {
    for (const bad of ['', '2026', '2026-06-08', 'ranking_date', '2026060', '202606081', 'abcdefgh']) {
      expect(archiveDate(bad)).toBeNull();
    }
  });
});

describe('latestRankings', () => {
  const names = new Map([
    ['207989', 'Mirra Andreeva'],
    ['206173', 'Coco Gauff'],
    ['100644', 'Iga Swiatek'],
    ['999999', 'Someone Else'],
  ]);
  const rows: ArchiveRow[] = [
    { ranking_date: '20260601', rank: '1', player: '206173', points: '9000', tours: '18' },
    { ranking_date: '20260601', rank: '2', player: '207989', points: '8000', tours: '18' },
    { ranking_date: '20260608', rank: '1', player: '207989', points: '12050', tours: '19' },
    { ranking_date: '20260608', rank: '2', player: '206173', points: '11500', tours: '19' },
    { ranking_date: '20260608', rank: '3', player: '100644', points: '5105', tours: '19' },
    // A ranked player we have never seen play, so there is no name for them.
    { ranking_date: '20260608', rank: '4', player: '123456', points: '4000', tours: '19' },
  ];

  it('keeps only the newest weekly list', () => {
    const out = latestRankings(rows, names);
    expect(out.every((r) => r.asOf.toISOString().startsWith('2026-06-08'))).toBe(true);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(out[0]).toMatchObject({ externalId: '207989', name: 'Mirra Andreeva', rank: 1, points: 12050 });
  });

  it('drops players with no name and sorts by rank', () => {
    const out = latestRankings(rows, names);
    expect(out.map((r) => r.name)).toEqual(['Mirra Andreeva', 'Coco Gauff', 'Iga Swiatek']);
    expect(out.find((r) => r.externalId === '123456')).toBeUndefined();
  });

  it('returns nothing when the file has no usable date', () => {
    expect(latestRankings([], names)).toEqual([]);
    expect(latestRankings([{ ranking_date: 'bad', rank: '1', player: '207989' }], names)).toEqual([]);
  });

  it('survives missing points', () => {
    const out = latestRankings([{ ranking_date: '20260608', rank: '5', player: '100644' }], names);
    expect(out).toHaveLength(1);
    expect(out[0].points).toBeNull();
  });
});
