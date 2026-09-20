/**
 * The sports ScoreSage knows how to model.
 *
 * A sport is described statically here (what a fixture looks like, which
 * stats can be forecast, which models apply) and enabled per user in the
 * `sports` table. Adding a sport means adding an entry here, a provider
 * adapter, and a sport model under lib/engine/sports.
 */

export type SportKey =
  | 'football'
  | 'rugby_union'
  | 'rugby_league'
  | 'cricket'
  | 'tennis'
  | 'f1'
  | 'basketball'
  | 'american_football'
  | 'ice_hockey'
  | 'baseball';

/** How many sides an event has, and what they are. */
export type ParticipantShape = 'TEAM_VS_TEAM' | 'PLAYER_VS_PLAYER' | 'MULTI_ENTRANT';

export type Outcome = 'HOME' | 'DRAW' | 'AWAY';

export type StatDistribution = 'poisson' | 'normal' | 'percent' | 'count';

export interface StatDefinition {
  key: string;
  label: string;
  /** Short unit for the forecast table, e.g. "%", "" for counts. */
  unit: string;
  distribution: StatDistribution;
  decimals: number;
  /** Shown first in the match centre when true. */
  headline?: boolean;
}

export type SportIconKey =
  | 'football'
  | 'rugby'
  | 'cricket'
  | 'tennis'
  | 'f1'
  | 'basketball'
  | 'american-football'
  | 'hockey'
  | 'baseball';

export interface SportDefinition {
  key: SportKey;
  name: string;
  shortName: string;
  icon: SportIconKey;
  shape: ParticipantShape;
  hasDraws: boolean;
  /** What a "score" is called: goals, points, runs, sets, position. */
  scoreLabel: string;
  /** Labels for the three (or two) outcomes as shown to the user. */
  outcomeLabels: { HOME: string; DRAW?: string; AWAY: string };
  stats: StatDefinition[];
  /** Model keys available for this sport, in the order the Lab lists them. */
  models: string[];
  /** Which delivery phase adds this sport; informs the Settings copy. */
  phase: 1 | 2 | 3;
  description: string;
  /** Typical values used to seed models before any data exists. */
  priors: { homeAdvantage: number; avgScore: number; scoreSd: number };
}

const FOOTBALL_STATS: StatDefinition[] = [
  { key: 'goals', label: 'Goals', unit: '', distribution: 'poisson', decimals: 2, headline: true },
  { key: 'xg', label: 'Expected goals (xG)', unit: '', distribution: 'normal', decimals: 2 },
  { key: 'possession', label: 'Possession', unit: '%', distribution: 'percent', decimals: 0, headline: true },
  { key: 'shots', label: 'Shots', unit: '', distribution: 'poisson', decimals: 1, headline: true },
  { key: 'shotsOnTarget', label: 'Shots on target', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'passes', label: 'Passes', unit: '', distribution: 'normal', decimals: 0, headline: true },
  { key: 'passAccuracy', label: 'Pass accuracy', unit: '%', distribution: 'percent', decimals: 0 },
  { key: 'corners', label: 'Corners', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'fouls', label: 'Fouls', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'yellowCards', label: 'Yellow cards', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'redCards', label: 'Red cards', unit: '', distribution: 'poisson', decimals: 2 },
  { key: 'offsides', label: 'Offsides', unit: '', distribution: 'poisson', decimals: 1 },
];

const RUGBY_STATS: StatDefinition[] = [
  { key: 'points', label: 'Points', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'tries', label: 'Tries', unit: '', distribution: 'poisson', decimals: 1, headline: true },
  { key: 'conversions', label: 'Conversions', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'penalties', label: 'Penalty goals', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'possession', label: 'Possession', unit: '%', distribution: 'percent', decimals: 0 },
  { key: 'metres', label: 'Metres carried', unit: 'm', distribution: 'normal', decimals: 0 },
  { key: 'tackles', label: 'Tackles', unit: '', distribution: 'normal', decimals: 0 },
  { key: 'turnovers', label: 'Turnovers conceded', unit: '', distribution: 'poisson', decimals: 1 },
];

const CRICKET_STATS: StatDefinition[] = [
  { key: 'runs', label: 'Runs', unit: '', distribution: 'normal', decimals: 0, headline: true },
  { key: 'wickets', label: 'Wickets lost', unit: '', distribution: 'poisson', decimals: 1, headline: true },
  { key: 'runRate', label: 'Run rate', unit: '', distribution: 'normal', decimals: 2 },
  { key: 'boundaries', label: 'Boundaries', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'sixes', label: 'Sixes', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'extras', label: 'Extras', unit: '', distribution: 'poisson', decimals: 1 },
];

const TENNIS_STATS: StatDefinition[] = [
  { key: 'sets', label: 'Sets', unit: '', distribution: 'count', decimals: 1, headline: true },
  { key: 'games', label: 'Games', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'aces', label: 'Aces', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'doubleFaults', label: 'Double faults', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'firstServePct', label: 'First serve in', unit: '%', distribution: 'percent', decimals: 0 },
  { key: 'breakPointsWon', label: 'Break points won', unit: '', distribution: 'poisson', decimals: 1 },
];

const F1_STATS: StatDefinition[] = [
  { key: 'position', label: 'Finishing position', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'points', label: 'Points', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'dnf', label: 'Retirement risk', unit: '%', distribution: 'percent', decimals: 0 },
  { key: 'pitStops', label: 'Pit stops', unit: '', distribution: 'poisson', decimals: 1 },
];

const BASKETBALL_STATS: StatDefinition[] = [
  { key: 'points', label: 'Points', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'rebounds', label: 'Rebounds', unit: '', distribution: 'normal', decimals: 1 },
  { key: 'assists', label: 'Assists', unit: '', distribution: 'normal', decimals: 1 },
  { key: 'threes', label: 'Three-pointers', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'turnovers', label: 'Turnovers', unit: '', distribution: 'poisson', decimals: 1 },
];

const GRIDIRON_STATS: StatDefinition[] = [
  { key: 'points', label: 'Points', unit: '', distribution: 'normal', decimals: 1, headline: true },
  { key: 'totalYards', label: 'Total yards', unit: 'yd', distribution: 'normal', decimals: 0 },
  { key: 'passingYards', label: 'Passing yards', unit: 'yd', distribution: 'normal', decimals: 0 },
  { key: 'rushingYards', label: 'Rushing yards', unit: 'yd', distribution: 'normal', decimals: 0 },
  { key: 'turnovers', label: 'Turnovers', unit: '', distribution: 'poisson', decimals: 1 },
];

const HOCKEY_STATS: StatDefinition[] = [
  { key: 'goals', label: 'Goals', unit: '', distribution: 'poisson', decimals: 2, headline: true },
  { key: 'shots', label: 'Shots', unit: '', distribution: 'normal', decimals: 1 },
  { key: 'powerPlayGoals', label: 'Power-play goals', unit: '', distribution: 'poisson', decimals: 2 },
  { key: 'penaltyMinutes', label: 'Penalty minutes', unit: 'min', distribution: 'poisson', decimals: 1 },
];

const BASEBALL_STATS: StatDefinition[] = [
  { key: 'runs', label: 'Runs', unit: '', distribution: 'poisson', decimals: 2, headline: true },
  { key: 'hits', label: 'Hits', unit: '', distribution: 'poisson', decimals: 1 },
  { key: 'homeRuns', label: 'Home runs', unit: '', distribution: 'poisson', decimals: 2 },
  { key: 'strikeouts', label: 'Strikeouts', unit: '', distribution: 'poisson', decimals: 1 },
];

export const SPORTS: readonly SportDefinition[] = [
  {
    key: 'football',
    name: 'Football',
    shortName: 'Football',
    icon: 'football',
    shape: 'TEAM_VS_TEAM',
    hasDraws: true,
    scoreLabel: 'goals',
    outcomeLabels: { HOME: 'Home win', DRAW: 'Draw', AWAY: 'Away win' },
    stats: FOOTBALL_STATS,
    models: ['elo', 'dixon-coles', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 1,
    description: 'Leagues and cups worldwide. Dixon-Coles scorelines, Elo, stat forecasts and the AI layer.',
    priors: { homeAdvantage: 0.25, avgScore: 1.35, scoreSd: 1.2 },
  },
  {
    key: 'rugby_union',
    name: 'Rugby union',
    shortName: 'Rugby',
    icon: 'rugby',
    shape: 'TEAM_VS_TEAM',
    hasDraws: true,
    scoreLabel: 'points',
    outcomeLabels: { HOME: 'Home win', DRAW: 'Draw', AWAY: 'Away win' },
    stats: RUGBY_STATS,
    models: ['elo', 'margin', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 2,
    description: 'Premiership, URC, Top 14, Six Nations, Rugby Championship. Margin model on rating exchange.',
    priors: { homeAdvantage: 3.5, avgScore: 24, scoreSd: 13 },
  },
  {
    key: 'rugby_league',
    name: 'Rugby league',
    shortName: 'League',
    icon: 'rugby',
    shape: 'TEAM_VS_TEAM',
    hasDraws: true,
    scoreLabel: 'points',
    outcomeLabels: { HOME: 'Home win', DRAW: 'Draw', AWAY: 'Away win' },
    stats: RUGBY_STATS,
    models: ['elo', 'margin', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 2,
    description: 'Super League and NRL. Same margin model as union with league-specific priors.',
    priors: { homeAdvantage: 3, avgScore: 22, scoreSd: 14 },
  },
  {
    key: 'cricket',
    name: 'Cricket',
    shortName: 'Cricket',
    icon: 'cricket',
    shape: 'TEAM_VS_TEAM',
    hasDraws: true,
    scoreLabel: 'runs',
    outcomeLabels: { HOME: 'Home win', DRAW: 'Draw / no result', AWAY: 'Away win' },
    stats: CRICKET_STATS,
    models: ['elo', 'totals', 'ml', 'ai', 'ensemble'],
    phase: 2,
    description: 'Tests, ODIs, T20Is, IPL, The Hundred. Format-specific ratings, totals and rain-aware draw odds.',
    priors: { homeAdvantage: 0.08, avgScore: 160, scoreSd: 35 },
  },
  {
    key: 'tennis',
    name: 'Tennis',
    shortName: 'Tennis',
    icon: 'tennis',
    shape: 'PLAYER_VS_PLAYER',
    hasDraws: false,
    scoreLabel: 'sets',
    outcomeLabels: { HOME: 'Player 1 wins', AWAY: 'Player 2 wins' },
    stats: TENNIS_STATS,
    models: ['elo', 'markov', 'ml', 'ai', 'ensemble'],
    phase: 2,
    description: 'ATP and WTA tours. Surface-specific Elo and a serve/return Markov chain for sets and games.',
    priors: { homeAdvantage: 0, avgScore: 2, scoreSd: 0.6 },
  },
  {
    key: 'f1',
    name: 'Formula 1',
    shortName: 'F1',
    icon: 'f1',
    shape: 'MULTI_ENTRANT',
    hasDraws: false,
    scoreLabel: 'position',
    outcomeLabels: { HOME: 'Winner', AWAY: 'Field' },
    stats: F1_STATS,
    models: ['pace', 'race-sim', 'ai', 'ensemble'],
    phase: 2,
    description: 'Every Grand Prix. Driver and constructor pace, grid position and a Monte Carlo race simulation.',
    priors: { homeAdvantage: 0, avgScore: 10, scoreSd: 5 },
  },
  {
    key: 'basketball',
    name: 'Basketball',
    shortName: 'NBA',
    icon: 'basketball',
    shape: 'TEAM_VS_TEAM',
    hasDraws: false,
    scoreLabel: 'points',
    outcomeLabels: { HOME: 'Home win', AWAY: 'Away win' },
    stats: BASKETBALL_STATS,
    models: ['elo', 'margin', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 3,
    description: 'NBA and EuroLeague. Pace and efficiency ratings behind a margin model.',
    priors: { homeAdvantage: 2.5, avgScore: 112, scoreSd: 12 },
  },
  {
    key: 'american_football',
    name: 'American football',
    shortName: 'NFL',
    icon: 'american-football',
    shape: 'TEAM_VS_TEAM',
    hasDraws: true,
    scoreLabel: 'points',
    outcomeLabels: { HOME: 'Home win', DRAW: 'Tie', AWAY: 'Away win' },
    stats: GRIDIRON_STATS,
    models: ['elo', 'margin', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 3,
    description: 'NFL. Margin model with EPA-style efficiency features from nflverse.',
    priors: { homeAdvantage: 2, avgScore: 23, scoreSd: 10 },
  },
  {
    key: 'ice_hockey',
    name: 'Ice hockey',
    shortName: 'NHL',
    icon: 'hockey',
    shape: 'TEAM_VS_TEAM',
    hasDraws: false,
    scoreLabel: 'goals',
    outcomeLabels: { HOME: 'Home win', AWAY: 'Away win' },
    stats: HOCKEY_STATS,
    models: ['elo', 'poisson', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 3,
    description: 'NHL. Poisson goals with goaltender adjustments.',
    priors: { homeAdvantage: 0.15, avgScore: 3, scoreSd: 1.7 },
  },
  {
    key: 'baseball',
    name: 'Baseball',
    shortName: 'MLB',
    icon: 'baseball',
    shape: 'TEAM_VS_TEAM',
    hasDraws: false,
    scoreLabel: 'runs',
    outcomeLabels: { HOME: 'Home win', AWAY: 'Away win' },
    stats: BASEBALL_STATS,
    models: ['elo', 'poisson', 'stats', 'ml', 'ai', 'ensemble'],
    phase: 3,
    description: 'MLB. Log5 with starting-pitcher adjustments.',
    priors: { homeAdvantage: 0.2, avgScore: 4.5, scoreSd: 3 },
  },
];

const BY_KEY = new Map(SPORTS.map((sport) => [sport.key, sport]));

export function sportDefinition(key: string): SportDefinition | undefined {
  return BY_KEY.get(key as SportKey);
}

export function isSportKey(value: string): value is SportKey {
  return BY_KEY.has(value as SportKey);
}

/** Outcomes a sport can have, in display order. */
export function outcomesFor(sport: SportDefinition): Outcome[] {
  return sport.hasDraws ? ['HOME', 'DRAW', 'AWAY'] : ['HOME', 'AWAY'];
}

export const MODEL_LABELS: Record<string, string> = {
  elo: 'Elo rating',
  poisson: 'Poisson',
  'dixon-coles': 'Dixon-Coles',
  margin: 'Margin model',
  totals: 'Totals model',
  markov: 'Serve/return Markov',
  pace: 'Pace ratings',
  'race-sim': 'Race simulation',
  stats: 'Stat forecasts',
  ml: 'Feature model',
  ai: 'AI',
  ensemble: 'Ensemble',
  market: 'Market implied',
  baseline: 'Home-advantage baseline',
};
