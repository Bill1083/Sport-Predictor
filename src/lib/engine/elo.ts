/**
 * Elo ratings with home advantage, a margin-of-victory multiplier and
 * between-season regression to the mean. Works for every two-sided sport;
 * the draw model turns a rating gap into home / draw / away probabilities
 * for sports that can draw.
 */

export interface EloParams {
  k: number;
  /** Rating points added to the home side before comparing. */
  homeAdvantage: number;
  /** Apply the FiveThirtyEight-style margin multiplier. */
  marginMultiplier: boolean;
  /** Fraction of the distance to the mean a team gives back at a new season. */
  seasonRegression: number;
  initialRating: number;
  /** Share of results that are draws when the sides are level; 0 for no-draw sports. */
  drawBase: number;
  /** How the draw probability falls as the gap grows: fitted from history. */
  drawSlope: number;
}

export const DEFAULT_ELO_PARAMS: EloParams = {
  k: 20,
  homeAdvantage: 60,
  marginMultiplier: true,
  seasonRegression: 1 / 3,
  initialRating: 1500,
  drawBase: 0.28,
  drawSlope: 1.0,
};

export interface EloMatch {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  date: Date;
  season: string;
}

export interface EloHistoryPoint {
  team: string;
  date: Date;
  value: number;
}

export interface EloState {
  ratings: Record<string, number>;
  lastSeason: Record<string, string>;
  games: Record<string, number>;
  history: EloHistoryPoint[];
  params: EloParams;
  updatedThrough: string | null;
}

export function emptyElo(params: EloParams = DEFAULT_ELO_PARAMS): EloState {
  return { ratings: {}, lastSeason: {}, games: {}, history: [], params, updatedThrough: null };
}

/** Win expectation of the side with rating advantage `diff`. */
export function eloExpected(diff: number): number {
  return 1 / (1 + 10 ** (-diff / 400));
}

/** FiveThirtyEight NFL-style margin multiplier; `diff` is the winner's pre-match edge. */
export function marginMultiplier(margin: number, winnerDiff: number): number {
  return (Math.log(Math.abs(margin) + 1) * 2.2) / (winnerDiff * 0.001 + 2.2);
}

/**
 * Outcome probabilities from a rating gap (home minus away, before home
 * advantage). The draw share is highest for level sides and shrinks with
 * the gap; what is left splits by the Elo expectation.
 */
export function eloOutcomeProbs(diff: number, params: EloParams, hasDraws: boolean): Record<string, number> {
  const e = eloExpected(diff + params.homeAdvantage);
  if (!hasDraws || params.drawBase <= 0) return { HOME: e, AWAY: 1 - e };
  const evenness = 1 - Math.abs(2 * e - 1);
  const draw = params.drawBase * evenness ** params.drawSlope;
  return { HOME: (1 - draw) * e, DRAW: draw, AWAY: (1 - draw) * (1 - e) };
}

function rating(state: EloState, team: string): number {
  return state.ratings[team] ?? state.params.initialRating;
}

function regressForSeason(state: EloState, team: string, season: string): void {
  const last = state.lastSeason[team];
  if (last && last !== season) {
    const r = rating(state, team);
    state.ratings[team] = r + (state.params.initialRating - r) * state.params.seasonRegression;
  }
  state.lastSeason[team] = season;
}

/** Apply one result, in date order. Records the pre-match ratings' successor for both teams. */
export function applyEloMatch(state: EloState, match: EloMatch): void {
  regressForSeason(state, match.home, match.season);
  regressForSeason(state, match.away, match.season);
  const rh = rating(state, match.home);
  const ra = rating(state, match.away);
  const diff = rh + state.params.homeAdvantage - ra;
  const expectedHome = eloExpected(diff);
  const actualHome = match.homeScore > match.awayScore ? 1 : match.homeScore < match.awayScore ? 0 : 0.5;
  const margin = Math.abs(match.homeScore - match.awayScore);
  let k = state.params.k;
  if (state.params.marginMultiplier && margin > 0) {
    const winnerDiff = actualHome === 1 ? diff : -diff;
    k *= marginMultiplier(margin, winnerDiff);
  }
  const delta = k * (actualHome - expectedHome);
  state.ratings[match.home] = rh + delta;
  state.ratings[match.away] = ra - delta;
  state.games[match.home] = (state.games[match.home] ?? 0) + 1;
  state.games[match.away] = (state.games[match.away] ?? 0) + 1;
  state.history.push({ team: match.home, date: match.date, value: state.ratings[match.home] });
  state.history.push({ team: match.away, date: match.date, value: state.ratings[match.away] });
  state.updatedThrough = match.date.toISOString();
}

/** Ratings after every match in `matches` (sorted here), starting from `initial`. */
export function computeElo(matches: EloMatch[], params: EloParams = DEFAULT_ELO_PARAMS, initial?: EloState): EloState {
  const state = initial ?? emptyElo(params);
  const sorted = [...matches].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const match of sorted) applyEloMatch(state, match);
  return state;
}

/** Pre-match probabilities for a fixture from the current ratings. */
export function eloPredict(state: EloState, home: string, away: string, hasDraws: boolean): Record<string, number> {
  return eloOutcomeProbs(rating(state, home) - rating(state, away), state.params, hasDraws);
}

export function eloRating(state: EloState, team: string): number {
  return rating(state, team);
}

/**
 * Choose drawBase so the model's average draw probability over the fitted
 * matches equals the observed draw rate. One pass, closed form.
 */
export function calibrateDrawBase(matches: EloMatch[], params: EloParams): number {
  if (matches.length < 30) return params.drawBase;
  const state = emptyElo({ ...params, drawBase: 1 });
  let modelDraw = 0;
  let observed = 0;
  const sorted = [...matches].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const match of sorted) {
    const probs = eloPredict(state, match.home, match.away, true);
    modelDraw += probs.DRAW; // with drawBase 1, this is the evenness term
    if (match.homeScore === match.awayScore) observed += 1;
    applyEloMatch(state, match);
  }
  if (modelDraw <= 0) return params.drawBase;
  return Math.min(0.45, Math.max(0.05, observed / modelDraw));
}
