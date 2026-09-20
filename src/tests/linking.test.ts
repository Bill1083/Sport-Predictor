import { describe, expect, it } from 'vitest';

import { normaliseName, similarity } from '@/lib/entities/linking';

describe('normaliseName', () => {
  it('strips club suffixes, accents and punctuation', () => {
    expect(normaliseName('Manchester City FC')).toBe('manchester city');
    expect(normaliseName('Man City')).toBe('manchester city');
    expect(normaliseName('Atlético de Madrid')).toBe('atletico madrid');
    expect(normaliseName('Brighton & Hove Albion')).toBe('brighton');
    expect(normaliseName("Nott'm Forest")).toBe("nott'm forest");
    expect(normaliseName('Nottingham Forest')).toBe("nott'm forest");
  });

  it('maps the common short forms onto one canonical spelling', () => {
    expect(normaliseName('Spurs')).toBe(normaliseName('Tottenham Hotspur FC'));
    expect(normaliseName('Wolverhampton Wanderers')).toBe(normaliseName('Wolves'));
    expect(normaliseName('FC Internazionale Milano')).toBe(normaliseName('Inter'));
    expect(normaliseName('Paris Saint-Germain')).toBe('psg');
  });

  it('keeps a name made only of stop words rather than returning nothing', () => {
    expect(normaliseName('The Club')).toBe('the club');
  });
});

describe('similarity', () => {
  it('is 1 for identical strings and 0 for empty ones', () => {
    expect(similarity('arsenal', 'arsenal')).toBe(1);
    expect(similarity('', 'arsenal')).toBe(0);
  });

  it('rates near-duplicates highly and unrelated names low', () => {
    expect(similarity('harbourside athletic', 'harbourside athletc')).toBeGreaterThan(0.9);
    expect(similarity('harbourside athletic', 'greywater celtic')).toBeLessThan(0.7);
  });
});
