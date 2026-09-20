# ScoreSage

*Know the game before it's played.*

A personal sport prediction dashboard. It pulls fixtures, results, statistics
and context from public sports data sources, runs a layered prediction engine
(ratings, scoreline models, a trained feature model and, if you want it, an
AI analyst reading the news), and shows every fixture with its win
probabilities, predicted score, stat forecasts and the reasons why. Every
final prediction is scored against the result, so the Accuracy page always
tells you whether it is any good.

Single user, Google sign-in only, one Docker container behind nginx on your
own VPS. It is a passion project for one person's curiosity: **not betting
advice, not for sale, not for anyone else.**

---

## Stack

| Layer     | Choice                                                                     |
| --------- | -------------------------------------------------------------------------- |
| Framework | Next.js 14 (App Router) + TypeScript                                       |
| UI        | Tailwind CSS, shadcn/ui, Lucide, Recharts; "floodlit stadium" theme       |
| Database  | SQLite via Prisma (engine-free client over better-sqlite3)                 |
| Engine    | Elo, Dixon-Coles, ratio-of-averages stat forecasts, logistic feature model, log-linear ensemble with temperature calibration |
| AI        | Google Gemini or Anthropic Claude, structured output only, optional        |
| Data      | football-data.org, API-Football, TheSportsDB, Football-Data.co.uk, ClubElo, Open-Meteo, Google News RSS |
| Auth      | Sign in with Google (allowlisted addresses) or a password for local work   |
| Tests     | Vitest over the models, metrics, parsers, linking and settings             |
| Deploy    | Docker + Nginx + Certbot on a single VPS                                   |

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

For local work set these in `.env`:

```dotenv
DATABASE_URL="file:./dev.db"
NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=<openssl rand -base64 32>
DASHBOARD_PASSWORD=anything-for-dev
MOCK_SPORTS=true
AI_PROVIDER=none
```

Then:

```bash
npx prisma db push
```

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with the password, go to **Settings**,
switch on **Football**, press **Load competitions**, and follow the two demo
leagues. Within seconds the Today and Fixtures pages fill with invented but
realistic fixtures. In the **Lab**, press **History backfill**, **Refit
models**, **Predict upcoming** and **Backtest** in that order to see the
whole engine work on three seasons of generated history, with no keys at all.

---

## How it predicts

For every upcoming fixture, 48 hours out, again 24 hours out, and once more
when the lineups are known:

1. **Ratings.** Elo per team with home advantage, a margin-of-victory
   multiplier and regression to the mean between seasons. Gives home / draw /
   away probabilities on its own.
2. **Scorelines.** For football, a Dixon-Coles model: attack and defence
   strengths per team fitted by maximum likelihood with time decay, a home
   advantage, and the low-score correction that fixes the draw rate. It yields
   the full score grid: expected goals, most likely scoreline, over/under
   lines, both-to-score. Points sports use a margin model instead. A
   Grand Prix is a multi-entrant event: each driver's pace and retirement
   rate come from recent classifications, the grid shifts pace once
   qualifying is known, and a Monte Carlo gives win, podium, points and
   expected finish for the whole field.
3. **Stat forecasts.** Passes, possession, shots, corners, cards and the rest
   from a ratio-of-averages model: the league mean scaled by what a side
   produces and what its opponent concedes, shrunk toward the mean for thin
   samples, with Poisson or normal ranges.
4. **Feature model.** A multinomial logistic regression over rating gap,
   recent form, home/away record, rest, head-to-head, table position and
   absences. Trained in the weekly refit from a walk-forward pass, so it only
   ever learns from out-of-sample rows.
5. **AI analyst (optional).** In *hybrid* mode the model reads the stat pack,
   the injury list, the confirmed lineups, the weather and recent headlines,
   and returns bounded factors (a key absence, a new manager, a dead rubber)
   with an effect in percentage points, plus a narrative. Every factor is
   clipped and the total is capped by a setting. In *AI* mode it forecasts on
   its own, with the algorithm running silently for comparison.
6. **Ensemble.** A log-linear blend by weight, temperature-scaled to fix any
   over- or under-confidence, clipped away from 0 and 1.

After the result: every model's final prediction is scored with Brier, log
loss and the ranked probability score, the stat forecasts are checked against
the real statistics, and the ratings move on.

### The Lab

Run any job by hand, watch it work, edit each model's weight and parameters,
and run a **backtest**: a walk-forward replay of the history in weekly chunks
where each week is predicted by models fitted only on the weeks before it. It
reports every model against the home-advantage baseline, fits the ensemble
temperature and finds the blend weights that minimised log loss; the weekly
refit applies them.

---

## The pages

- **Today** - the fixtures today and tomorrow with probability bars and
  predicted scores, the live badge, API budget used, the setup checklist.
- **Fixtures** - a week at a time, grouped by day and competition.
- **Match centre** - probabilities, the predicted scoreline, stat forecasts
  with ranges, the factors as a diverging bar chart, model-by-model
  comparison, form, head-to-head, lineups, absences, weather, the headlines
  the AI read, and the table. Predict now for a fresh version.
- **Leagues** - tables computed from results, with form.
- **Teams** - crest, venue, rating, fixtures, results, absences.
- **Accuracy** - Brier, log loss, RPS and accuracy per model and per
  competition, a weekly log-loss timeline, a reliability diagram, stat
  forecast coverage and the biggest upsets.
- **Lab** - jobs, models, backtests, recent runs.
- **Settings** - sports and competitions, prediction mode per sport, sync
  cadences, provider order, AI provider and budget, schedule, the market
  benchmark toggle, what is configured on the server.

The header switches between sports (or shows all of them). Switching is a
cookie and a server render; every page follows it.

---

## Data sources

| Source | Free tier | Used for |
| --- | --- | --- |
| [football-data.org](https://www.football-data.org) | 12 competitions, 10 req/min | fixtures, results, tables, history |
| [API-Football](https://www.api-football.com) | 100 req/day, all endpoints | match statistics, lineups, injuries, standings |
| [TheSportsDB](https://www.thesportsdb.com) | public key, ~30 req/min | crests, stadiums, fixtures for many sports |
| [Football-Data.co.uk](https://www.football-data.co.uk) | CSV, no key | thirty seasons of results and match stats for backtests |
| [ClubElo](http://clubelo.com/API) | CSV, no key | external Elo benchmark |
| [Open-Meteo](https://open-meteo.com) | no key | venue weather |
| Google News RSS | no key | headlines for the AI analyst |
| [The Odds API](https://the-odds-api.com) | 500 credits/month, optional | "market implied %" comparison column, off by default |
| [API-Sports Rugby](https://api-sports.io) | 100 req/day (same key as API-Football) | rugby union and league fixtures, results, tables |
| [Jolpica F1](https://api.jolpi.ca) | no key, paced | every Grand Prix since 1950: schedule, grid, classification |
| [Sackmann tennis archive](https://github.com/Aneeshers/tennis-sackmann-archive) | CSV mirror, no key | ATP and WTA results and serve statistics for history |
| ESPN tennis scoreboard | no key, unofficial | upcoming matches and results on the tours |
| [cricketdata.org](https://cricketdata.org) | 100 hits/day | series, fixtures, results and innings scores |

Each provider has a daily budget in `.env`. A job stops when the budget is
spent and resumes the next day; the Today page shows what is used. With
`MOCK_SPORTS=true` two invented leagues are served instead and no provider is
called.

---

## Security

- **Sign in with Google**, restricted to the addresses in
  `DASHBOARD_ALLOWED_EMAILS`, with PKCE and CSRF state checks. The password
  is an optional fallback for local work and is disabled while
  `DASHBOARD_PASSWORD` is empty.
- Sessions are signed, HttpOnly, Secure cookies that last `SESSION_TTL_DAYS`.
- API keys live in `.env` on the server only; the dashboard shows whether
  each exists, never its value.
- The middleware refuses cross-site state changes, login attempts are rate
  limited in the app and again in Nginx, and Nginx strips the header behind
  the Next.js middleware-bypass CVE.

---

## Environment

Nothing is required to boot: the dashboard shows a setup checklist. See
`.env.example` for every variable with comments. The ones that matter:

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs login cookies. Required to sign in at all. |
| `DASHBOARD_ALLOWED_EMAILS` | Who may sign in with Google. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | OAuth client for sign-in. |
| `FOOTBALL_DATA_API_KEY` | football-data.org fixtures, results and tables. |
| `API_SPORTS_KEY` | API-Football statistics, lineups and injuries. |
| `AI_PROVIDER` | `gemini`, `anthropic` or `none`. |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | The chosen provider's key. |
| `AI_MONTHLY_BUDGET_USD` | Spending cap; the algorithm carries on when it is hit. |
| `APP_TIMEZONE` | Defines "today" and the job times. |
| `MOCK_SPORTS` | `true` serves the demo leagues instead of any provider. |
| `CRON_SECRET` | Optional bearer token for `POST /api/jobs/run`. |

Engine defaults (`DEFAULT_PREDICTION_MODE`, `PREDICT_HORIZON_DAYS`, and so
on) only seed the Settings page on first boot; the dashboard owns them
afterwards.

---

## API

Every route except the ones marked public needs the session cookie.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness and which integrations are configured (public) |
| GET | `/api/auth/methods`, `/api/auth/google/start`, `/callback` | Sign in (public) |
| POST | `/api/auth/login`, `/logout` | Password sign-in / sign out |
| POST | `/api/jobs/run?job=` | Cron entry point, bearer `CRON_SECRET` (public) |
| GET/PATCH | `/api/sports` | Sports, enable and prediction mode |
| POST | `/api/sports/select` | Choose the sport the dashboard shows |
| GET/PATCH | `/api/competitions` | Competitions, follow and unfollow |
| GET | `/api/events`, `/api/events/:id` | Fixtures with predictions |
| POST | `/api/events/:id/predict` | A fresh prediction version now |
| GET | `/api/standings/:competitionId` | The table computed from results |
| GET/POST | `/api/runs`, `/api/runs/:id` | Start a job, inspect runs |
| GET | `/api/live` | The numbers that move while a job works |
| GET/PATCH | `/api/models?sport=` | Model weights, parameters, reset |
| GET/PATCH | `/api/settings?scope=` | Global and per-sport settings |
| GET | `/api/providers` | Provider status and today's usage |

---

## Tests

```bash
npm test
```

Covers the parts that must be right whether or not any key is present: the
Poisson and Dixon-Coles maths, the Elo update and draw calibration, the stat
forecast model, the logistic regression, the ensemble blend and temperature
fit, the scoring rules and calibration bins, the provider parsers, team name
linking, the mock generator, standings and settings.

---

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full Ubuntu VPS walkthrough:
Google Cloud setup, Docker, Nginx reverse proxy, DNS and free Let's Encrypt
SSL. The short version:

```bash
cp .env.example .env && docker compose up -d --build
```
