# Phase 9: Launch Preparation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production database, domain configuration, OAuth setup, monitoring, final QA, and v1.0.0 deployment.

**Architecture:** Railway PostgreSQL (production) with PgBouncer pooling, Vercel deployment with custom domain, external monitoring via Cronitor.

**Tech Stack:** Railway, Vercel, Google/GitHub OAuth, Resend, Sentry, Cronitor

**Agent Team:** Infrastructure Agent (sequential first), then Monitoring Agent + QA Agent (parallel)

**Prerequisites:** Phase 8 complete. All tests passing.

---

## Table of Contents

1. [Infrastructure Agent: Task 9.1 — Railway PostgreSQL Production](#infrastructure-agent-task-91--railway-postgresql-production)
2. [Infrastructure Agent: Task 9.2 — Domain + DNS + SSL](#infrastructure-agent-task-92--domain--dns--ssl)
3. [Infrastructure Agent: Task 9.3 — OAuth Production Credentials](#infrastructure-agent-task-93--oauth-production-credentials)
4. [Monitoring Agent: Task 9.4 — Monitoring & Alerting](#monitoring-agent-task-94--monitoring--alerting)
5. [QA Agent: Task 9.5 — Full QA Checklist](#qa-agent-task-95--full-qa-checklist)
6. [QA Agent: Task 9.6 — Production Deployment & Release](#qa-agent-task-96--production-deployment--release)
7. [Integration Verification](#integration-verification)

---

## Execution Flow

```
Phase A — sequential (infrastructure must exist first)
  Infrastructure Agent: 9.1 → 9.2 → 9.3

Phase B — parallel (both depend on Phase A, independent of each other)
  Monitoring Agent: 9.4
  QA Agent: 9.5

Phase C — sequential (release, after all verifications pass)
  QA Agent: 9.6
```

---

## Infrastructure Agent: Task 9.1 — Railway PostgreSQL Production

> **Depends on:** Phase 8 complete. All tests passing on `develop`.

### Step 9.1.1 — Provision Railway PostgreSQL production instance

- [ ] Create a new Railway project (or use existing) with a PostgreSQL service for production
- [ ] Note the connection credentials (host, port, user, password, database name)

```bash
# Railway CLI — create project and add PostgreSQL
railway login
railway init
railway add --plugin postgresql
```

- [ ] Verify the instance is running and accessible:

```bash
# Test connection (substitute actual credentials)
psql "postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=require" -c "SELECT version();"
```

**Expected:** PostgreSQL 16.x version string returned.

### Step 9.1.2 — Enable pgvector extension on production

- [ ] Connect to the production database and enable pgvector:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] Verify pgvector is enabled and meets minimum version:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

**Expected:** `vector` row with version >= 0.5.0 (required for HNSW indexes).

### Step 9.1.3 — Configure PgBouncer connection pooling

- [ ] Enable PgBouncer on the Railway PostgreSQL instance (Railway dashboard > PostgreSQL service > Networking > Enable TCP Proxy / Connection Pooling)
- [ ] Record two connection strings:
  - **Pooled** (`DATABASE_URL`): Uses PgBouncer port (e.g., `postgresql://...@<host>:<pooler-port>/<db>?pgbouncer=true`)
  - **Direct** (`DIRECT_URL`): Uses direct PostgreSQL port (for migrations)
- [ ] Verify pooled connection works:

```bash
psql "<pooled-connection-string>" -c "SELECT 1;"
```

- [ ] Verify direct connection works:

```bash
psql "<direct-connection-string>" -c "SELECT 1;"
```

**Expected:** Both connections succeed. Pooled connection uses PgBouncer port; direct connection uses PostgreSQL port. This matches the Prisma schema `datasource` block which expects `url` (pooled) and `directUrl` (direct).

### Step 9.1.4 — Set production environment variables in Vercel

- [ ] Open Vercel project settings > Environment Variables
- [ ] Set all production environment variables, cross-referencing `.env.example`:

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | Pooled Railway connection string | Production |
| `DIRECT_URL` | Direct Railway connection string | Production |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` | Production |
| `AUTH_URL` | `https://<production-domain>` | Production |
| `GOOGLE_CLIENT_ID` | (from Step 9.3) | Production |
| `GOOGLE_CLIENT_SECRET` | (from Step 9.3) | Production |
| `GITHUB_CLIENT_ID` | (from Step 9.3) | Production |
| `GITHUB_CLIENT_SECRET` | (from Step 9.3) | Production |
| `RESEND_API_KEY` | (from Step 9.3) | Production |
| `EMAIL_FROM` | `noreply@<production-domain>` | Production |
| `OPENAI_API_KEY` | Production OpenAI key | Production |
| `COHERE_API_KEY` | Production Cohere key (if used) | Production |
| `SENTRY_DSN` | (from Step 9.4) | Production |
| `SENTRY_AUTH_TOKEN` | Sentry auth token for source maps | Production |
| `CRON_SECRET` | Generate with `openssl rand -base64 32` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://<production-domain>` | Production |

- [ ] Verify no variables are missing by comparing against `.env.example`:

```bash
# List all variable names in .env.example
cd /Users/justin/CascadeProjects/SEO-ilator
grep -E '^[A-Z_]+=' .env.example | cut -d= -f1 | sort
```

**Expected:** Every variable name from `.env.example` has a corresponding entry in Vercel production environment variables.

### Step 9.1.5 — Provision preview/staging database

- [ ] Create a second Railway PostgreSQL instance (or Railway database branch) for preview deployments
- [ ] Enable pgvector on the preview database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] Set preview environment variables in Vercel (Environment: Preview):

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | Preview Railway pooled connection string | Preview |
| `DIRECT_URL` | Preview Railway direct connection string | Preview |

- [ ] Verify Vercel preview deployments will use the preview database (not production)

**Expected:** Production and preview databases are isolated. Preview deployments can run migrations safely without affecting production data.

### Step 9.1.6 — Run Prisma migrations on production

- [ ] Run migrations against the production database using the direct connection:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
DATABASE_URL="<direct-connection-string>" DIRECT_URL="<direct-connection-string>" npx prisma migrate deploy
```

- [ ] Verify all tables exist:

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

**Expected:** All Prisma-managed tables present (Account, AnalysisRun, Article, IngestionJob, IngestionTask, Project, Recommendation, Session, StrategyConfig, User, VerificationToken, and any migration-related tables).

### Infrastructure Agent: Task 9.1 — Verification Checklist

- [ ] Railway PostgreSQL instance is running and accessible
- [ ] `SELECT * FROM pg_extension WHERE extname = 'vector'` returns a row on production
- [ ] PgBouncer connection pooling is active (verified via pooled connection string)
- [ ] All environment variables set in Vercel (cross-referenced with `.env.example`)
- [ ] Preview database is provisioned and accessible from Vercel preview deployments
- [ ] Prisma migrations applied successfully to production

---

## Infrastructure Agent: Task 9.2 — Domain + DNS + SSL

> **Depends on:** Task 9.1 complete (Vercel project configured).

### Step 9.2.1 — Add domain in Vercel

- [ ] Open Vercel project settings > Domains
- [ ] Add the production domain (e.g., `seo-ilator.com` or `app.seo-ilator.com`)
- [ ] Note the DNS configuration Vercel provides (CNAME target or A record IP)

```bash
# Vercel CLI alternative
vercel domains add <production-domain>
```

**Expected:** Domain added to Vercel project. Vercel displays required DNS records.

### Step 9.2.2 — Configure DNS records

- [ ] Log in to the domain registrar / DNS provider
- [ ] Add the required DNS records:

For apex domain (`seo-ilator.com`):
```
Type: A
Name: @
Value: 76.76.21.21 (Vercel's IP — confirm in Vercel dashboard)
```

For subdomain (`app.seo-ilator.com`):
```
Type: CNAME
Name: app
Value: cname.vercel-dns.com
```

- [ ] Verify DNS propagation:

```bash
# Check A record
dig <production-domain> A +short

# Check CNAME (if subdomain)
dig <production-domain> CNAME +short

# Alternative
nslookup <production-domain>
```

**Expected:** DNS resolves to Vercel's IP or CNAME target.

### Step 9.2.3 — Verify SSL certificate

- [ ] Wait for Vercel to automatically provision the SSL certificate (usually < 5 minutes after DNS propagation)
- [ ] Verify SSL is valid:

```bash
curl -vI https://<production-domain> 2>&1 | grep -E "SSL certificate|subject:|expire"
```

- [ ] Verify the site loads over HTTPS in a browser
- [ ] Verify HTTP redirects to HTTPS:

```bash
curl -sI http://<production-domain> | head -5
```

**Expected:** Valid SSL certificate. HTTP 301 redirects to HTTPS. Site loads correctly.

### Infrastructure Agent: Task 9.2 — Verification Checklist

- [ ] Domain resolves to Vercel deployment (`dig` or `nslookup` confirms)
- [ ] SSL certificate is valid (`curl -vI https://<domain>` shows valid cert)
- [ ] HTTP redirects to HTTPS
- [ ] Site loads correctly at `https://<production-domain>`

---

## Infrastructure Agent: Task 9.3 — OAuth Production Credentials

> **Depends on:** Task 9.2 complete (domain configured, so redirect URIs can be set).

### Step 9.3.1 — Google OAuth production credentials

- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/) > APIs & Services > Credentials
- [ ] Create a new OAuth 2.0 Client ID (or update existing) for the production domain
- [ ] Set authorized redirect URIs:
  - `https://<production-domain>/api/auth/callback/google`
- [ ] Set authorized JavaScript origins:
  - `https://<production-domain>`
- [ ] Copy Client ID and Client Secret
- [ ] Update Vercel production environment variables:
  - `GOOGLE_CLIENT_ID` = copied Client ID
  - `GOOGLE_CLIENT_SECRET` = copied Client Secret
- [ ] Verify by attempting Google sign-in on the production domain

**Expected:** Google OAuth redirects correctly and completes authentication on the production domain.

### Step 9.3.2 — GitHub OAuth production app

- [ ] Go to [GitHub Developer Settings](https://github.com/settings/developers) > OAuth Apps
- [ ] Create a new OAuth App (or update existing) for the production domain
- [ ] Set:
  - Homepage URL: `https://<production-domain>`
  - Authorization callback URL: `https://<production-domain>/api/auth/callback/github`
- [ ] Copy Client ID and Client Secret
- [ ] Update Vercel production environment variables:
  - `GITHUB_CLIENT_ID` = copied Client ID
  - `GITHUB_CLIENT_SECRET` = copied Client Secret
- [ ] Verify by attempting GitHub sign-in on the production domain

**Expected:** GitHub OAuth redirects correctly and completes authentication on the production domain.

### Step 9.3.3 — Resend production domain verification

- [ ] Log in to [Resend](https://resend.com/domains)
- [ ] Add the production domain for email sending
- [ ] Add the required DNS records (DKIM, SPF, DMARC) to the domain's DNS:
  - Resend provides specific TXT and CNAME records during domain verification
- [ ] Wait for domain verification to complete (check Resend dashboard)
- [ ] Verify the Resend API key is set in Vercel:
  - `RESEND_API_KEY` = production Resend API key
  - `EMAIL_FROM` = `noreply@<production-domain>`
- [ ] Test magic link email by requesting a sign-in link on the production domain
- [ ] Verify the email is received and the magic link works

**Expected:** Magic link email sends from the verified production domain. Email arrives in inbox (not spam). Link completes authentication.

### Infrastructure Agent: Task 9.3 — Verification Checklist

- [ ] Google OAuth login works on production domain
- [ ] GitHub OAuth login works on production domain
- [ ] Magic link email sends from verified Resend domain
- [ ] All three auth methods complete the full sign-in flow on production

---

## Monitoring Agent: Task 9.4 — Monitoring & Alerting

> **Depends on:** Infrastructure Agent (Tasks 9.1-9.3) complete.
> **Runs in parallel with:** QA Agent (Task 9.5).

### Step 9.4.1 — Configure Sentry production DSN

- [ ] Log in to [Sentry](https://sentry.io/)
- [ ] Create a new Sentry project for SEO-ilator production (separate from any dev/staging project)
- [ ] Copy the production DSN
- [ ] Set `SENTRY_DSN` in Vercel production environment variables
- [ ] Set `SENTRY_AUTH_TOKEN` in Vercel for source map uploads
- [ ] Trigger a test error to verify Sentry receives events:

```bash
# After deploying with the new DSN, visit a page that triggers Sentry.captureException
# Or use the Sentry CLI:
sentry-cli send-event -m "Test event from SEO-ilator production"
```

- [ ] Verify the test event appears in the Sentry production project dashboard

**Expected:** Sentry production project receives events. Source maps resolve correctly. Production errors are separated from dev/staging.

### Step 9.4.2 — Configure OpenAI usage alerts

- [ ] Log in to [OpenAI Platform](https://platform.openai.com/account/limits)
- [ ] Navigate to Settings > Limits (or Billing > Usage limits)
- [ ] Configure three usage alert thresholds:

| Threshold | Action |
|-----------|--------|
| $50/month | Email notification |
| $100/month | Email notification |
| $500/month | Email notification + hard limit (optional) |

- [ ] Verify each alert is listed as active in the OpenAI dashboard

**Expected:** Three alert thresholds configured. Notifications will fire at $50, $100, and $500 monthly spend to catch unexpected embedding cost spikes.

### Step 9.4.3 — Configure Railway disk alerts

- [ ] Open Railway dashboard > PostgreSQL service > Metrics
- [ ] Configure an alert for disk usage at 80% threshold:
  - Navigate to Settings > Alerts (or Observability > Alerts)
  - Set: Disk usage > 80% triggers email notification
- [ ] Verify the alert rule is active

**Expected:** Railway will send an alert when PostgreSQL disk usage exceeds 80%, preventing database outages from disk exhaustion.

### Step 9.4.4 — Configure uptime monitor on /api/health

- [ ] Sign up for or log in to an uptime monitoring service (e.g., [Cronitor](https://cronitor.io/), [UptimeRobot](https://uptimerobot.com/), or [Better Uptime](https://betteruptime.com/))
- [ ] Create a new HTTP monitor:
  - URL: `https://<production-domain>/api/health`
  - Check interval: 1 minute
  - Alert after: 2 consecutive failures
  - Expected status: 200
  - Alert channels: email (and Slack/PagerDuty if configured)
- [ ] Verify the monitor shows status UP:

```bash
# Manually verify the health endpoint
curl -s -o /dev/null -w "%{http_code}" https://<production-domain>/api/health
```

**Expected:** Returns `200`. Uptime monitor is active and reporting UP status.

### Step 9.4.5 — [AAP-O5] Configure external cron monitors

- [ ] Create a Cronitor account (or use existing monitoring service)
- [ ] Create a monitor for `/api/cron/crawl`:
  - Type: Heartbeat / Cron job monitor
  - Expected schedule: every 1 minute (per `vercel.json` cron config)
  - Alert threshold: 3 minutes (alert if no ping received within 3 minutes of expected time)
  - Name: `seo-ilator-cron-crawl`
- [ ] Create a monitor for `/api/cron/analyze`:
  - Type: Heartbeat / Cron job monitor
  - Expected schedule: every 1 minute
  - Alert threshold: 3 minutes
  - Name: `seo-ilator-cron-analyze`
- [ ] Integrate the cron endpoints to ping Cronitor on each invocation:
  - Each cron route should call the Cronitor telemetry URL (or use the Cronitor SDK) at the start and end of execution
  - The Cronitor ping URLs should be stored as environment variables (`CRONITOR_CRAWL_MONITOR_KEY`, `CRONITOR_ANALYZE_MONITOR_KEY`) in Vercel
- [ ] Verify both monitors show as active in the Cronitor dashboard
- [ ] Verify monitors detect a missed invocation (temporarily disable cron and confirm alert fires)

**Expected:** Both cron monitors are active. Alerts fire if cron jobs are not invoked within 3 minutes of their expected schedule. This catches Vercel cron failures that Sentry would not detect (e.g., Vercel fails to invoke the route at all).

### Monitoring Agent: Task 9.4 — Verification Checklist

- [ ] Sentry production DSN is set and test event appears in Sentry
- [ ] OpenAI usage alert at $50 is configured and active
- [ ] OpenAI usage alert at $100 is configured and active
- [ ] OpenAI usage alert at $500 is configured and active
- [ ] Railway disk alert at 80% is configured
- [ ] Uptime monitor on `/api/health` is active and reporting UP
- [ ] [AAP-O5] External cron monitor on `/api/cron/crawl` is configured (3-minute alert threshold)
- [ ] [AAP-O5] External cron monitor on `/api/cron/analyze` is configured (3-minute alert threshold)

---

## QA Agent: Task 9.5 — Full QA Checklist

> **Depends on:** Infrastructure Agent (Tasks 9.1-9.3) complete. Production deployment accessible.
> **Runs in parallel with:** Monitoring Agent (Task 9.4).

**Important:** All QA must be performed on the production deployment, not preview/staging. Any QA failure blocks the v1.0.0 tag. Fix, re-deploy, re-test.

### Step 9.5.1 — Authentication flows

- [ ] **Google sign-up:** Create a new account using Google OAuth on `https://<production-domain>`
  - Verify: redirects to Google, returns to app, user record created, session active
- [ ] **GitHub sign-up:** Create a new account using GitHub OAuth on `https://<production-domain>`
  - Verify: redirects to GitHub, returns to app, user record created, session active
- [ ] **Magic link sign-up:** Request a magic link email on `https://<production-domain>`
  - Verify: email received from `noreply@<production-domain>`, link works, user record created, session active
- [ ] **Sign-out and sign-in:** Sign out, then sign back in with each method
  - Verify: session destroyed on sign-out, new session created on sign-in, existing user record reused

### Step 9.5.2 — Ingestion of a real site

- [ ] **Sitemap ingestion:** Submit a real sitemap URL (20-50 pages) on the production domain
  - Suggested test sites: a blog with 20-50 published posts
  - Verify: ingestion job created, articles appear in the dashboard, article count matches expected
- [ ] **Ingestion progress:** Monitor the ingestion job progress
  - Verify: status updates from pending to processing to completed, article list populates
- [ ] **Article content:** Spot-check 3-5 ingested articles
  - Verify: title, URL, and body content are correctly parsed and stored

### Step 9.5.3 — Analysis: free tier (keyword-only)

- [ ] **Create a free-tier test account** (fresh sign-up, do not use an existing account)
- [ ] **Trigger keyword-only analysis** on the ingested articles
  - Verify: analysis starts, runs to completion, recommendations generated
- [ ] **Verify semantic matching is locked** on free tier
  - Verify: UI shows upgrade prompt when attempting semantic matching
- [ ] **Verify run limit enforcement** on free tier
  - Verify: after 3 runs, the 4th run is blocked with the correct tier limit error message

### Step 9.5.4 — Analysis: Pro tier (keyword + semantic)

- [ ] **Upgrade a test account to Pro** (manually update the user record in the database or use an admin flow)

```sql
-- Manually upgrade for testing
UPDATE "User" SET plan = 'pro', "articleLimit" = 2000, "runLimit" = 999999 WHERE email = '<test-email>';
```

- [ ] **Trigger keyword+semantic analysis** on the ingested articles
  - Verify: analysis completes, recommendations include both keyword-match and semantic-match types
- [ ] **Verify article limit is higher** (2000 on Pro)
- [ ] **Verify unlimited runs** (no run limit reached)

### Step 9.5.5 — Recommendation actions

- [ ] **View recommendations:** Open the recommendations list after analysis
  - Verify: recommendations display with strategy ID, severity, title, description, and suggestion
- [ ] **Accept a recommendation:**
  - Verify: status changes to accepted, UI reflects the change
- [ ] **Dismiss a recommendation:**
  - Verify: status changes to dismissed, UI reflects the change
- [ ] **Bulk actions:** Select multiple recommendations and accept/dismiss in bulk
  - Verify: all selected recommendations update correctly

### Step 9.5.6 — Export

- [ ] **CSV export:** Export recommendations as CSV
  - Verify: file downloads, opens correctly in Excel, opens correctly in Google Sheets
  - Verify: all recommendation fields are present in the CSV
- [ ] **JSON export:** Export recommendations as JSON
  - Verify: file downloads, contains valid JSON (parse with `JSON.parse()` or `jq`)

```bash
# Validate JSON export
cat <downloaded-file>.json | jq . > /dev/null && echo "Valid JSON" || echo "Invalid JSON"
```

- [ ] **Copy-snippet:** Click copy-snippet on a crosslink recommendation
  - Verify: clipboard contains valid HTML anchor tag
  - Verify: pasting into an HTML document produces a working link

### Step 9.5.7 — Settings

- [ ] **Open settings page** and adjust strategy configuration:
  - Change similarity threshold
  - Change max links per page
  - Change matching approach
- [ ] **Save settings**
  - Verify: settings persist after page reload
- [ ] **Run analysis after settings change**
  - Verify: analysis uses the updated settings (e.g., different threshold produces different recommendation count)

### Step 9.5.8 — Responsive layout

- [ ] **375px width** (mobile): Open the app in Chrome DevTools at 375px width
  - Verify: all pages render without horizontal scroll, navigation is usable, content is readable
  - Test pages: dashboard, recommendations list, recommendation detail, settings
- [ ] **768px width** (tablet): Open at 768px width
  - Verify: layout adapts appropriately, no broken components
- [ ] **1280px width** (desktop): Open at 1280px width
  - Verify: full desktop layout renders correctly, no wasted space

### Step 9.5.9 — Dark mode

- [ ] **Toggle dark mode** (or set system preference to dark)
- [ ] **Verify all pages in dark mode:**
  - Dashboard
  - Recommendations list
  - Recommendation detail / accept / dismiss
  - Settings
  - Sign-in page
  - Error pages
- [ ] Verify: no unreadable text, no missing backgrounds, no broken contrast

### Step 9.5.10 — Error states

- [ ] **Invalid sitemap:** Submit a URL that is not a valid sitemap (e.g., a homepage URL)
  - Verify: appropriate error message displayed (per Appendix A error messages)
- [ ] **Zero recommendations:** Run analysis on articles that produce no recommendations
  - Verify: "No crosslink opportunities found" message displayed (not a blank page or error)
- [ ] **Analysis failure:** Simulate a failure scenario (e.g., disconnect embedding API key)
  - Verify: error message displayed, analysis run status reflects failure, no data corruption

### QA Agent: Task 9.5 — Verification Checklist

- [ ] All three authentication flows work on production domain
- [ ] Sitemap ingestion of a real site (20-50 pages) completes successfully
- [ ] Keyword-only analysis works on free tier
- [ ] Keyword+semantic analysis works on Pro tier
- [ ] Tier limits enforced (free-tier test account)
- [ ] Recommendation accept/dismiss/bulk actions work
- [ ] CSV export opens correctly in Excel and Google Sheets
- [ ] JSON export contains valid JSON
- [ ] Copy-snippet copies valid HTML
- [ ] Settings save and affect subsequent analysis
- [ ] Responsive layout at 375px, 768px, 1280px
- [ ] Dark mode across all pages
- [ ] Error states display appropriate messages

---

## QA Agent: Task 9.6 — Production Deployment & Release

> **Depends on:** Task 9.5 QA checklist fully passed. Monitoring Agent Task 9.4 complete. All verification checklists green.

### Step 9.6.1 — Pre-release verification

- [ ] Confirm all tests pass on the release branch:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout release/v1.0.0
npx vitest --run
```

**Expected:** All tests pass. Zero failures.

- [ ] Confirm TypeScript compiles cleanly:

```bash
npx tsc --noEmit
```

- [ ] Confirm lint passes:

```bash
npm run lint
```

- [ ] Confirm build succeeds:

```bash
npm run build
```

### Step 9.6.2 — Merge release branch to main

Per Git Flow rules: merge-commit (no squash) for release branches into main.

- [ ] Merge release branch to `main`:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout main
git pull origin main
git merge release/v1.0.0 --no-ff -m "chore(release): merge release/v1.0.0 into main"
git push origin main
```

**Expected:** Merge commit on `main`. Full commit history preserved (no squash per Git Flow rules in CLAUDE.md).

- [ ] Merge release branch back to `develop`:

```bash
git checkout develop
git pull origin develop
git merge release/v1.0.0 --no-ff -m "chore(release): merge release/v1.0.0 back into develop"
git push origin develop
```

- [ ] Delete the release branch:

```bash
git branch -d release/v1.0.0
git push origin --delete release/v1.0.0
```

### Step 9.6.3 — Tag v1.0.0

- [ ] Create and push the version tag:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout main
git tag -a v1.0.0 -m "v1.0.0 — SEO-ilator launch release

Production-ready release with:
- Article ingestion (sitemap, URL list, API push)
- Crosslink strategy with keyword and semantic matching
- Meta tag, keyword density, and content quality strategies
- Dashboard with recommendations, accept/dismiss/bulk, export
- Google/GitHub/magic link authentication
- Free and Pro tier enforcement
- Cron-based crawling and analysis
- Sentry monitoring, Cronitor cron monitoring
- Full test suite passing"
git push origin v1.0.0
```

- [ ] Verify the tag exists:

```bash
git tag -l v1.0.0
git log --oneline -1 v1.0.0
```

**Expected:** Tag `v1.0.0` exists on `main` at the merge commit.

### Step 9.6.4 — Verify Vercel production deployment

- [ ] Check Vercel dashboard for the production deployment triggered by the push to `main`
- [ ] Verify the deployment completed successfully (green status)

```bash
# Vercel CLI check
vercel ls --prod
```

- [ ] Verify the site is live at `https://<production-domain>`

```bash
curl -s -o /dev/null -w "%{http_code}" https://<production-domain>
```

**Expected:** HTTP 200. Production deployment is live.

### Step 9.6.5 — Verify Prisma migrations applied to production

- [ ] Connect to the production database and verify all tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

- [ ] Verify the Prisma migrations table shows all migrations applied:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;
```

**Expected:** All migrations present and finished. No failed migrations.

### Step 9.6.6 — Verify cron jobs running

- [ ] Check Vercel cron logs for recent invocations:
  - Vercel Dashboard > Project > Crons tab
  - Verify `/api/cron/crawl` has recent invocations
  - Verify `/api/cron/analyze` has recent invocations
  - Verify `/api/cron/cleanup-sessions` is scheduled

```bash
# Vercel CLI — list recent function invocations
vercel logs --prod --filter "/api/cron"
```

**Expected:** Cron jobs are being invoked at the scheduled intervals.

### Step 9.6.7 — Update CHANGELOG.md

- [ ] Update `CHANGELOG.md` with the v1.0.0 release entry:

Add the following at the top of `CHANGELOG.md` (below the `## [Unreleased]` section):

```markdown
## [1.0.0] — 2026-03-23
### Added
- Article ingestion pipeline (sitemap crawler, URL list, API push)
- Strategy registry with plugin architecture
- Crosslink strategy with keyword matching and semantic similarity
- Meta tag optimization strategy
- Keyword density analysis strategy
- Content quality scoring strategy
- Web dashboard with recommendation management
- Recommendation accept/dismiss/bulk actions
- CSV and JSON export
- Copy-snippet for crosslink HTML
- Google, GitHub, and magic link authentication (Auth.js v5)
- Free and Pro tier enforcement (article limits, run limits, semantic gating)
- User-configurable strategy settings
- Cron-based crawling and analysis pipelines
- Rate limiting on API endpoints
- Sentry error monitoring with source maps
- Vercel Analytics and Speed Insights
- External cron monitoring via Cronitor [AAP-O5]
- Uptime monitoring on /api/health
- OpenAI usage alerts ($50/$100/$500)
- Railway disk alerts (80%)
- Full integration test suite
- Security review checklist
- Seed data and test factories
- Dark mode support
- Responsive layout (375px, 768px, 1280px)
```

- [ ] Commit the CHANGELOG update:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout main
git add CHANGELOG.md
git commit -m "docs(changelog): add v1.0.0 release entry"
git push origin main
```

### Step 9.6.8 — Update build_log.md

- [ ] Append a Phase 9 completion entry to `build_log.md`:

```markdown
## 2026-03-23 — Phase 9: Launch Preparation

### Done
- Railway PostgreSQL production instance provisioned with pgvector and PgBouncer
- Preview/staging database provisioned for Vercel preview deployments
- Production domain configured with DNS and SSL
- Google OAuth, GitHub OAuth, and Resend production credentials configured
- Sentry production DSN configured and verified
- OpenAI usage alerts set at $50, $100, $500
- Railway disk alert configured at 80%
- Uptime monitor on /api/health (1-minute interval, 2-failure alert)
- [AAP-O5] External cron monitors on /api/cron/crawl and /api/cron/analyze (3-minute threshold)
- Full QA checklist passed (auth flows, ingestion, analysis, export, settings, responsive, dark mode, error states)
- Release branch merged to main (merge-commit, no squash)
- Tagged v1.0.0
- Vercel production deployment verified
- Prisma migrations verified on production
- Cron jobs verified running

### Decisions
- [AAP-O5] External cron monitoring via Cronitor to catch Vercel cron invocation failures

### Next
- Post-launch monitoring and iteration
- User feedback collection
- v1.1.0 planning
```

- [ ] Commit the build_log update:

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout main
git add build_log.md
git commit -m "docs(build-log): add Phase 9 launch preparation entry"
git push origin main
```

### QA Agent: Task 9.6 — Verification Checklist

- [ ] All tests pass on release branch (`npx vitest --run`)
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Release branch merged to `main` (merge-commit, no squash)
- [ ] Release branch merged back to `develop`
- [ ] Release branch deleted
- [ ] Tag `v1.0.0` exists on `main` (`git tag -l v1.0.0`)
- [ ] Vercel production deployment completed successfully
- [ ] Production site accessible at `https://<production-domain>`
- [ ] All Prisma migrations applied to production database
- [ ] Cron jobs running (visible in Vercel cron logs)
- [ ] `CHANGELOG.md` updated with v1.0.0 entry
- [ ] `build_log.md` updated with Phase 9 entry

---

## Integration Verification

After all agents complete their tasks, verify the full system end-to-end.

### Infrastructure Verification

| Check | Command / Method | Expected |
|-------|-----------------|----------|
| Database accessible | `psql` connection test | Connected to production PostgreSQL |
| pgvector enabled | `SELECT extname FROM pg_extension WHERE extname = 'vector'` | Row returned |
| PgBouncer active | Connection string uses pooler port | Pooled connections working |
| Domain resolves | `dig <production-domain> +short` | Points to Vercel IP |
| SSL valid | `curl -vI https://<production-domain>` | Valid certificate |
| Google OAuth | Sign in on production | Completes successfully |
| GitHub OAuth | Sign in on production | Completes successfully |
| Magic link | Request magic link on production | Email received, link works |

### Monitoring Verification

| Check | Method | Expected |
|-------|--------|----------|
| Sentry production | Trigger test error | Event in Sentry production project |
| OpenAI alerts | Check OpenAI dashboard | Three thresholds configured |
| Railway alerts | Check Railway dashboard | Disk alert at 80% |
| Uptime monitor | Check monitoring dashboard | `/api/health` reporting UP |
| Cron monitor [AAP-O5] | Check Cronitor dashboard | Both cron endpoints monitored |

### QA Verification

| Check | Method | Expected |
|-------|--------|----------|
| All QA items | Manual testing | All items pass |
| Vercel deployment | Vercel dashboard | Production deployment healthy |
| Migrations applied | `SELECT * FROM _prisma_migrations` | All migrations finished |
| Crons running | Vercel cron logs | Recent invocations visible |

### Documentation Verification

| Check | Location | Expected |
|-------|----------|----------|
| v1.0.0 changelog | `CHANGELOG.md` | Entry present |
| Phase 9 build log | `build_log.md` | Entry present |
| v1.0.0 tag | `git tag -l v1.0.0` | Tag exists on `main` |

### Acceptance Criteria (from Implementation Plan)

- [ ] Production app accessible at domain
- [ ] Full user journey works end-to-end on production
- [ ] Monitoring alerts configured and tested
- [ ] `v1.0.0` tag created on `main` branch

---

## Tests Required

Phase 9 has zero testable code units. No new test files are created.

The "test" discipline for this phase is replaced by the verification checklists above. Each agent documents the results of their checklist items. Any failing checklist item must be resolved before proceeding.

**Pre-existing tests must still pass:**

```bash
npx vitest --run
```

All tests from Phases 0-8 must pass on the release branch before merging to `main`.

---

## AAP Tags Covered

| Tag | Where Applied |
|-----|---------------|
| [AAP-O5] | Monitoring Agent Step 9.4.5: external cron monitor on `/api/cron/crawl` and `/api/cron/analyze` with 3-minute alert threshold |
