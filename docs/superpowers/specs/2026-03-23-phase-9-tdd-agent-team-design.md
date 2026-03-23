# Phase 9: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Launch Preparation (Implementation Plan Phase 9, tasks 9.1-9.6)
**Prerequisites:** Phase 8 complete. All tests passing.

---

## Overview

Phase 9 is the launch preparation phase -- it contains zero testable code units. All tasks involve production infrastructure provisioning, monitoring configuration, manual QA, and deployment. The "TDD" discipline is replaced by verification checklists: each agent produces documentation of completed steps rather than code. The agent team is structured around infrastructure (must run first to create the environment), monitoring (configures alerts on the provisioned environment), and QA (validates everything end-to-end before tagging the release).

---

## Agent Team

### Infrastructure Agent

**Domain:** Production database, domain configuration, OAuth production credentials.

**Tasks:** 9.1, 9.2, 9.3

**Artifacts produced:**

| Artifact | Source Task |
|----------|------------|
| Railway PostgreSQL production instance | 9.1 |
| pgvector extension on production | 9.1 |
| PgBouncer connection pooling configuration | 9.1 |
| Production environment variables in Vercel | 9.1 |
| Preview/staging database | 9.1 |
| Domain added in Vercel project settings | 9.2 |
| DNS records configured (CNAME or A) | 9.2 |
| SSL certificate provisioned (automatic via Vercel) | 9.2 |
| Google OAuth production credentials with correct redirect URIs | 9.3 |
| GitHub OAuth production app with correct callback URLs | 9.3 |
| Resend production domain verified | 9.3 |

**Notes:**
- This agent runs FIRST. All other agents depend on the production environment existing.
- Railway PostgreSQL must have pgvector extension enabled before any migrations run.
- PgBouncer configuration must use `DIRECT_URL` for migrations and `DATABASE_URL` for pooled connections (matching the Prisma schema `datasource` block).
- All production environment variables from DevOps plan Section 1.5 must be set in Vercel.
- Preview/staging database enables Vercel preview deployments to run migrations safely.
- OAuth redirect URIs must point to the production domain, not localhost.

**Verification checklist:**
- [ ] Railway PostgreSQL instance is running and accessible
- [ ] `SELECT * FROM pg_extension WHERE extname = 'vector'` returns a row on production
- [ ] PgBouncer connection pooling is active (verify via connection string format)
- [ ] All environment variables set in Vercel (cross-reference `.env.example`)
- [ ] Preview database is provisioned and accessible from Vercel preview deployments
- [ ] Domain resolves to Vercel deployment
- [ ] SSL certificate is valid (check via browser or `curl -vI https://domain`)
- [ ] Google OAuth login works on production domain
- [ ] GitHub OAuth login works on production domain
- [ ] Magic link email sends from verified Resend domain

### Monitoring Agent

**Domain:** Production monitoring, alerting, external cron monitoring.

**Task:** 9.4

**Artifacts produced:**

| Artifact | Source Task |
|----------|------------|
| Sentry production DSN configured | 9.4 |
| OpenAI usage alerts ($50, $100, $500) | 9.4 |
| Railway disk alerts at 80% | 9.4 |
| Uptime monitor on `/api/health` | 9.4 |
| External cron monitor [AAP-O5] | 9.4 |

**Notes:**
- Sentry production DSN must be different from development/staging DSN to separate error streams.
- OpenAI usage alerts at three tiers ($50, $100, $500) to catch unexpected embedding cost spikes.
- Railway alerts at 80% disk usage to prevent database outages.
- Uptime monitor should check `/api/health` endpoint at 1-minute intervals with alerting on 2+ consecutive failures.
- [AAP-O5] External cron monitor (Cronitor or similar) on `/api/cron/crawl` and `/api/cron/analyze` -- alert if cron not invoked within 3 minutes of expected schedule. This catches Vercel cron failures that Sentry would not detect.

**Verification checklist:**
- [ ] Sentry production DSN is set and test event appears in Sentry
- [ ] OpenAI usage alert at $50 is configured and active
- [ ] OpenAI usage alert at $100 is configured and active
- [ ] OpenAI usage alert at $500 is configured and active
- [ ] Railway disk alert at 80% is configured
- [ ] Uptime monitor on `/api/health` is active and reporting UP
- [ ] [AAP-O5] External cron monitor on `/api/cron/crawl` is configured (3-minute alert threshold)
- [ ] [AAP-O5] External cron monitor on `/api/cron/analyze` is configured (3-minute alert threshold)

### QA Agent

**Domain:** Full QA checklist, production deployment, release tagging, changelog.

**Tasks:** 9.5, 9.6

**Artifacts produced:**

| Artifact | Source Task |
|----------|------------|
| QA checklist results (documented) | 9.5 |
| Release branch merged to `main` | 9.6 |
| Git tag `v1.0.0` on `main` | 9.6 |
| Updated `CHANGELOG.md` | 9.6 |
| Updated `build_log.md` | 9.6 |

**Files modified:**

| File | Source Task | Change |
|------|------------|--------|
| `CHANGELOG.md` | 9.6 (v1.0.0 release entry) |
| `build_log.md` | 9.6 (Phase 9 completion entry) |

**QA checklist (all items from Implementation Plan):**
- [ ] Full sign-up flow (Google, GitHub, magic link) on production domain
- [ ] Sitemap ingestion of a real site (20-50 pages)
- [ ] Keyword-only analysis on free tier
- [ ] Keyword+semantic analysis on Pro tier
- [ ] Recommendation accept/dismiss/bulk actions
- [ ] CSV export opens correctly in Excel and Google Sheets
- [ ] JSON export contains valid JSON
- [ ] Copy-snippet copies valid HTML
- [ ] Settings save and affect subsequent analysis
- [ ] Tier limits enforced (create free-tier test account)
- [ ] Responsive layout at 375px, 768px, 1280px widths
- [ ] Dark mode across all pages
- [ ] Error states: invalid sitemap, zero recommendations, analysis failure

**Deployment checklist:**
- [ ] Merge release branch to `main` (merge-commit, no squash per Git Flow rules)
- [ ] Tag `v1.0.0`
- [ ] Verify Vercel production deployment triggers and completes
- [ ] Verify Prisma migrations applied to production database
- [ ] Verify cron jobs running (check Vercel cron logs)
- [ ] Update `CHANGELOG.md` with v1.0.0 entry
- [ ] Update `build_log.md` with Phase 9 completion

**Notes:**
- QA must be performed on the production deployment, not preview/staging.
- Free-tier test account must be a fresh sign-up to verify the full onboarding flow.
- CSV export must be tested by actually opening in Excel and Google Sheets (not just parsing).
- Any QA failure blocks the v1.0.0 tag. Fix, re-deploy, re-test.

---

## Execution Flow

```
Phase A -- sequential (infrastructure must exist first)
  Infrastructure Agent provisions production environment
  Verifies: database, domain, SSL, OAuth credentials

Phase B -- parallel (both depend on infrastructure, independent of each other)
  Monitoring Agent  ─► configures alerts and monitors
  QA Agent          ─► begins QA checklist on production

Phase C -- sequential (release)
  1. Infrastructure Agent verification complete
  2. Monitoring Agent verification complete
  3. QA Agent verification complete
  4. QA Agent merges release branch → main
  5. QA Agent tags v1.0.0
  6. QA Agent verifies production deployment
  7. QA Agent updates CHANGELOG.md + build_log.md
```

### Execution Order Rationale

Infrastructure Agent runs first because it creates the production environment that all other agents depend on. Monitoring Agent and QA Agent then run in parallel -- Monitoring Agent configures alerts on the provisioned infrastructure while QA Agent runs the full checklist on the deployed application. The final release steps (merge, tag, verify) are sequential and owned by the QA Agent after all verifications pass.

### Expected Conflicts

- **No code conflicts.** Phase 9 agents work on infrastructure configuration (external services), monitoring configuration (external services), and documentation files (CHANGELOG.md, build_log.md). Only the QA Agent modifies repository files, and only documentation.
- **`CHANGELOG.md` and `build_log.md`:** No conflict. Only the QA Agent modifies these files.

---

## Integration Verification

Phase 9 does not merge code branches. Instead, verification is a sequential checklist confirming all production systems are operational.

### Infrastructure Verification

| Check | Method | Expected |
|-------|--------|----------|
| Database accessible | `psql` connection test | Connected to production PostgreSQL |
| pgvector enabled | `SELECT extname FROM pg_extension` | `vector` in results |
| PgBouncer active | Connection string uses pooler port | Pooled connections working |
| Domain resolves | `dig` or `nslookup` | Points to Vercel |
| SSL valid | `curl -vI https://domain` | Valid certificate |
| Google OAuth | Sign in on production | Redirects and completes |
| GitHub OAuth | Sign in on production | Redirects and completes |
| Magic link | Request magic link | Email received from verified domain |

### Monitoring Verification

| Check | Method | Expected |
|-------|--------|----------|
| Sentry production | Trigger test error | Event appears in Sentry production project |
| OpenAI alerts | Check OpenAI dashboard | Three alert thresholds configured |
| Railway alerts | Check Railway dashboard | Disk alert at 80% configured |
| Uptime monitor | Check monitoring service | `/api/health` reporting UP |
| Cron monitor [AAP-O5] | Check Cronitor/similar | Both cron endpoints monitored |

### QA Verification

| Check | Method | Expected |
|-------|--------|----------|
| All QA checklist items | Manual testing | All items pass |
| Vercel deployment | Vercel dashboard | Production deployment healthy |
| Migrations applied | Check database schema | All tables present |
| Crons running | Vercel cron logs | Recent invocations visible |

### Documentation

| Check | Location |
|-------|----------|
| v1.0.0 changelog entry | `CHANGELOG.md` |
| Phase 9 build log entry | `build_log.md` |
| v1.0.0 tag on main | `git tag -l v1.0.0` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] Production app accessible at domain
- [ ] Full user journey works end-to-end on production
- [ ] Monitoring alerts configured and tested
- [ ] `v1.0.0` tag created on `main` branch

---

## Tests Required

Phase 9 has zero testable code units. No new test files are created.

The "test" discipline for this phase is replaced by the verification checklists above. Each agent documents the results of their checklist items. Any failing checklist item must be resolved before proceeding to the next phase of the execution flow.

**Pre-existing tests must still pass:**
- `npx vitest --run` -- all tests from Phases 0-8 pass on the release branch before merging to `main`

---

## Task-to-Agent Assignment

| Task | Agent | Description |
|------|-------|-------------|
| 9.1 | Infrastructure Agent | Railway production PostgreSQL, pgvector, PgBouncer, env vars, preview DB |
| 9.2 | Infrastructure Agent | Vercel domain + DNS + SSL |
| 9.3 | Infrastructure Agent | OAuth production credentials (Google/GitHub/Resend) |
| 9.4 | Monitoring Agent | Sentry production DSN, OpenAI alerts ($50/$100/$500), Railway alerts (80% disk), uptime monitor, external cron monitor [AAP-O5] |
| 9.5 | QA Agent | Full QA checklist (sign-up flows, ingestion, analysis, export, settings, responsive, dark mode, error states) |
| 9.6 | QA Agent | Production deployment (merge release -> main, tag v1.0.0, verify, CHANGELOG + build_log) |

---

## AAP Tags Covered

| Tag | Where Applied |
|-----|---------------|
| [AAP-O5] | Monitoring Agent: external cron monitor on `/api/cron/crawl` and `/api/cron/analyze` with 3-minute alert threshold |
