# Deploying ScoreSage to an Ubuntu VPS

End-to-end setup: the same box that runs the trading dashboard and AutoMail,
to a working HTTPS URL at `scoresage.wharveytech.com` with Google sign-in.
Roughly twenty minutes, most of it waiting for the Docker build.

**What you need**

- The existing Ubuntu VPS with Docker, Nginx and Certbot already installed
  (from the AutoMail deployment). Ports 7888 and 7889 are taken there;
  ScoreSage uses **7890**.
- Control of the `wharveytech.com` DNS.
- A Google Cloud project for the OAuth client (the AutoMail one can be reused).
- Provider keys you want: a [football-data.org](https://www.football-data.org/client/register)
  key and an [API-Football](https://dashboard.api-football.com) key are free.
  A [Gemini](https://aistudio.google.com/apikey) or
  [Anthropic](https://console.anthropic.com) key turns on the AI analyst.

---

## 1. Point DNS at the server

| Type | Name        | Value            | TTL |
| ---- | ----------- | ---------------- | --- |
| A    | `scoresage` | your server's IP | 300 |

Check it has landed before requesting a certificate:

```bash
dig +short scoresage.wharveytech.com
```

---

## 2. Google Cloud: the OAuth client

ScoreSage only needs identity (`openid email`), never any Google data.

1. Open <https://console.cloud.google.com> and pick a project (the AutoMail
   one is fine).
2. **Credentials -> Create credentials -> OAuth client ID**, type **Web
   application**. Authorised redirect URI:
   - `https://scoresage.wharveytech.com/api/auth/google/callback`

   Copy the **Client ID** and **Client secret**.
3. If the consent screen is still in *Testing*, add your address as a test
   user. Sign-in tokens are not refreshed, so the 7-day limit that affects
   mailbox connections does not apply here.

---

## 3. Clone and configure

```bash
git clone https://github.com/Bill1083/Sport-Predictor.git /home/deploy/scoresage
```

```bash
cd /home/deploy/scoresage && cp .env.example .env
```

Generate the two secrets (run it twice, one value each):

```bash
openssl rand -base64 32
```

Then edit `.env`:

```bash
nano /home/deploy/scoresage/.env
```

Set at minimum:

```dotenv
PORT=7890
NEXT_PUBLIC_APP_URL=https://scoresage.wharveytech.com
APP_TIMEZONE=Europe/London
DATABASE_URL="file:/app/data/scoresage.db"

SESSION_SECRET=<first generated value>
CRON_SECRET=<second generated value>
DASHBOARD_ALLOWED_EMAILS=you@gmail.com
# Leave empty so only Google sign-in works:
DASHBOARD_PASSWORD=

GOOGLE_CLIENT_ID=<from step 2>
GOOGLE_CLIENT_SECRET=<from step 2>

FOOTBALL_DATA_API_KEY=<free key>
API_SPORTS_KEY=<free key>

AI_PROVIDER=gemini
GEMINI_API_KEY=<from aistudio.google.com/apikey>
AI_MONTHLY_BUDGET_USD=10

MOCK_SPORTS=false
```

Keep `DATABASE_URL` pointing at `/app/data/`: that path is the mounted volume
and the only directory whose contents survive a rebuild.

Lock the file down; it holds your keys:

```bash
chmod 600 /home/deploy/scoresage/.env
```

---

## 4. Build and start

```bash
cd /home/deploy/scoresage && docker compose up -d --build
```

The first build takes 3-8 minutes. Afterwards:

```bash
docker compose ps
```

`STATUS` should read `Up ... (healthy)`. Check the startup log:

```bash
docker compose logs app | grep scoresage
```

On a fresh volume you should see `applied N statements` and
`scheduler started`. Confirm the app answers locally on its port:

```bash
curl -s http://127.0.0.1:7890/api/health
```

Expected:

```json
{
  "status": "ok",
  "integrations": {
    "googleLogin": "configured",
    "footballData": "configured",
    "apiSports": "configured",
    "ai": "gemini:ready",
    "database": "reachable"
  }
}
```

---

## 5. Nginx reverse proxy

Copy the template from the repo:

```bash
sudo cp /home/deploy/scoresage/nginx.conf /etc/nginx/sites-available/scoresage
```

**Before the certificate exists**, comment out the entire
`server { listen 443 ssl; ... }` block and the `location / { return 301 ... }`
redirect inside the port-80 block:

```bash
sudo nano /etc/nginx/sites-available/scoresage
```

Then enable it, test and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/scoresage /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://scoresage.wharveytech.com`; the login page should load over
plain HTTP. Do not sign in yet: the session cookie is marked Secure.

---

## 6. Free SSL with Let's Encrypt

```bash
sudo certbot --nginx -d scoresage.wharveytech.com --agree-tos -m you@example.com --redirect
```

Certbot verifies the domain over HTTP, obtains the certificate and rewrites
the Nginx config. Once it succeeds, restore the hardened settings from the
repo template (security headers, the login rate limit, the
`x-middleware-subrequest` strip, the 180s timeouts), then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Renewal is handled by the timer Certbot already installed for the other
sites; confirm with `sudo certbot renew --dry-run`.

---

## 7. First sign-in and first sport

1. Visit `https://scoresage.wharveytech.com`, press **Sign in with Google**,
   and pick the address from `DASHBOARD_ALLOWED_EMAILS`. Any other address is
   refused and logged.
2. **Settings -> Sports and competitions**: switch on **Football**. The
   catalogue sync runs in the background and lists every competition your
   configured providers know, with the curated ones (Premier League, La Liga,
   and so on) first.
3. Follow the competitions you care about. Each one starts a fixture sync;
   the whole current season lands within a minute.
4. **Lab -> History backfill** pulls three past seasons per followed
   competition (from Football-Data.co.uk it costs nothing; from API-Football
   it spends the daily budget, so do one competition at a time if you have
   many). Then **Refit models**, then **Backtest** to see how the models
   would have done on those seasons.
5. From here the scheduler does everything: fixtures daily, results every 15
   minutes on match days, context (injuries, lineups, weather, headlines)
   hourly, predictions hourly, scoring every 30 minutes, a refit every week.

---

## 8. Day-to-day operations

### Deploying an update

```bash
cd /home/deploy/scoresage && git pull && docker compose up -d --build
```

The volume is untouched by rebuilds, so history and settings survive.
Database upgrades run on boot: the entrypoint creates the schema on a fresh
volume and, on an existing one, runs the migrations built into
`scripts/apply-schema.mjs`. Each checks the database's actual state first.

### Logs

```bash
docker compose logs -f app
```

Every job logs one line with its outcome; the Lab shows the same runs with
their full log.

### Backing up

Two things matter: the SQLite file (history, predictions, settings, fitted
models) and `.env` (keys).

```bash
mkdir -p /home/deploy/backups
```

```bash
docker compose exec app sh -c "cat /app/data/scoresage.db" > /home/deploy/backups/scoresage-$(date +%F).db && cp /home/deploy/scoresage/.env /home/deploy/backups/scoresage-env-$(date +%F)
```

A nightly cron for the database:

```bash
(crontab -l 2>/dev/null; echo "15 3 * * * cd /home/deploy/scoresage && docker compose exec -T app sh -c 'cat /app/data/scoresage.db' > /home/deploy/backups/scoresage-\$(date +\%F).db") | crontab -
```

### Restoring

```bash
docker compose down && docker compose run --rm -T app sh -c "cat > /app/data/scoresage.db" < /home/deploy/backups/scoresage-2026-09-20.db && docker compose up -d
```

### Rotating a key

Edit `.env`, then recreate the container so it picks up the new environment:

```bash
docker compose up -d --force-recreate app
```

Rotating `SESSION_SECRET` signs you out. Provider and AI keys take effect
immediately.

### Driving jobs from cron instead of the built-in scheduler

Set `SCHEDULER_ENABLED=false` and a `CRON_SECRET` in `.env`, recreate the
container, then:

```bash
(crontab -l 2>/dev/null; echo "*/15 * * * * curl -s -X POST -H 'Authorization: Bearer YOUR_CRON_SECRET' http://127.0.0.1:7890/api/jobs/run") | crontab -
```

Call `127.0.0.1:7890` directly rather than the public URL so the Nginx
timeout does not cut a long refit short. Without `?job=` it runs whatever is
due, exactly like a scheduler tick.

---

## Troubleshooting

**"you@gmail.com is not allowed to use this dashboard"**
That address is not in `DASHBOARD_ALLOWED_EMAILS`. Add it, recreate the
container, sign in again.

**`redirect_uri_mismatch` from Google**
The redirect URI in the Cloud console must be exactly
`NEXT_PUBLIC_APP_URL` + `/api/auth/google/callback`.

**A job says "budget exhausted, resumes tomorrow"**
The provider's free daily quota is spent. Raise
`PROVIDER_BUDGET_API_SPORTS` if you have a paid plan, follow fewer
competitions, or wait. Fixtures and results from football-data.org are only
rate-limited per minute, so they keep flowing.

**No predictions appear**
The engine needs history: run **History backfill** in the Lab, then
**Predict upcoming**. The Lab's recent runs table shows what each job did.

**AI factors never appear**
Check `AI_PROVIDER` and the matching key, then Settings -> AI. The monthly
budget may be spent; the Lab's run log says so.

**The container is `unhealthy` or Nginx returns 502**
`docker compose logs --tail=50 app`, then `curl -s http://127.0.0.1:7890/api/health`.

**`docker compose up` fails with "no space left on device"**

```bash
docker system prune -af
```

---

## Local development

```bash
npm install
```

```bash
cp .env.example .env
```

Set `DATABASE_URL="file:./dev.db"`, `MOCK_SPORTS=true`, a `DASHBOARD_PASSWORD`
and a `SESSION_SECRET`, then:

```bash
npx prisma db push
```

```bash
npm run dev
```

To try Google sign-in locally, add `http://localhost:3000/api/auth/google/callback`
as a redirect URI on the OAuth client and set `NEXT_PUBLIC_APP_URL=http://localhost:3000`.

> **Windows on ARM64** works: the Prisma client runs engine-free over the
> better-sqlite3 driver, which ships an ARM64 build.

Run the test suite:

```bash
npm test
```
