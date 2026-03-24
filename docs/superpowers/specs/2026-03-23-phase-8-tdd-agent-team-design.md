# Phase 8: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Testing & Hardening (Implementation Plan Phase 8, tasks 8.1-8.6)
**Prerequisites:** All feature phases (0-7) complete

---

## Overview

Phase 8 is the testing and hardening phase -- the entire phase IS testing. The agent team is structured differently from feature phases: instead of a TDD Agent writing tests for feature agents, all three agents produce test artifacts, security verification, or operational hardening. The Integration Test Agent writes all integration test suites and implements rate limiting. The Security Agent conducts a full security review. The Ops Agent integrates monitoring, analytics, load testing, and seed data. All three work on entirely different file sets and run fully in parallel.

---

## Agent Team

### Integration Test Agent

**Domain:** Integration test suites across all API endpoints, rate limiter implementation.

**Tasks:** 8.1, 8.1a

**Files created:**

| File | Source Task |
|------|------------|
| `tests/api/articles.test.ts` | 8.1 (POST push -> DB -> GET -> DELETE cascades) |
| `tests/api/analyze.test.ts` | 8.1 (seed articles -> POST /api/analyze -> run completes -> recs with dedup) |
| `tests/api/recommendations.test.ts` | 8.1 (seed recs -> GET with filters -> CSV export -> verify columns) |
| `tests/api/cron/crawl.test.ts` | 8.1 (seed job + tasks -> invoke cron -> tasks processed, zombies recovered) |
| `tests/api/auth.test.ts` | 8.1 (protected routes 401, cross-tenant checks [AAP-B5]) |
| `tests/integration/full-flow.test.ts` | 8.1 (full ingest -> analyze -> review -> export flow) |
| `src/lib/rate-limit.ts` | 8.1a [AAP-B9] (in-memory token bucket rate limiter) |

**Notes:**
- [AAP-B5] Auth tests must create two users with separate projects and verify user A cannot read/modify user B's data. Cross-tenant checks on EVERY endpoint: articles, analyze, recommendations, runs, jobs, settings.
- [AAP-B9] Rate limiter implements in-memory token bucket (acceptable for single-region Vercel deployment). Per-user limits: `POST /api/articles` 10 req/min, `POST /api/analyze` 5 req/hour, all other endpoints 60 req/min. Returns 429 with `Retry-After` header.
- Integration tests use Prisma test database with transaction rollback for isolation.
- `full-flow.test.ts` exercises the complete user journey: ingest articles, trigger analysis, review recommendations, export CSV.

**Test cases:**

**`tests/api/articles.test.ts`:**
- `it("creates_article_via_post_and_retrieves_via_get")`
- `it("deletes_article_and_cascades_recommendations")`
- `it("returns_400_for_invalid_article_payload")`

**`tests/api/analyze.test.ts`:**
- `it("completes_analysis_run_and_creates_deduplicated_recommendations")`
- `it("returns_400_when_no_articles_in_project")`

**`tests/api/recommendations.test.ts`:**
- `it("filters_recommendations_by_severity_and_status")`
- `it("exports_csv_with_correct_columns")`
- `it("parses_exported_csv_correctly")`

**`tests/api/cron/crawl.test.ts`:**
- `it("processes_pending_tasks_in_batch")`
- `it("recovers_zombie_tasks_stuck_in_running_state")`

**`tests/api/auth.test.ts`:**
- `it("returns_401_for_unauthenticated_requests")`
- `it("prevents_cross_tenant_article_access")` [AAP-B5]
- `it("prevents_cross_tenant_analysis_access")` [AAP-B5]
- `it("prevents_cross_tenant_recommendation_access")` [AAP-B5]
- `it("prevents_cross_tenant_settings_access")` [AAP-B5]

**`tests/integration/full-flow.test.ts`:**
- `it("completes_full_ingest_analyze_review_export_flow")`

**Verification commands:**
- `npx vitest tests/api/ --run` -- all integration tests pass
- `npx vitest tests/integration/ --run` -- full flow test passes
- Rate limiter returns 429 after threshold exceeded

### Security Agent

**Domain:** Full security review checklist.

**Task:** 8.2

**Files created:**

| File | Source Task |
|------|------------|
| `docs/decisions/security-review-v1.md` | 8.2 (security review findings and verification) |

**Files modified:**

| File | Source Task | Change |
|------|------------|--------|
| Various source files | 8.2 (fixes for any critical findings) |

**Security checklist (all items from Implementation Plan):**
- [ ] Verify no API keys in client bundle (`NEXT_PUBLIC_` prefix audit)
- [ ] Verify SSRF protection test cases (internal IPs, localhost, non-HTTP schemes)
- [ ] [AAP-B1] Verify SSRF protection at fetch time (DNS rebinding test)
- [ ] Verify CORS is not enabled on authenticated endpoints
- [ ] Verify rate limiting on auth endpoints
- [ ] [AAP-B9] Verify rate limiting on `POST /api/articles` and `POST /api/analyze`
- [ ] Run `npm audit` and resolve critical vulnerabilities
- [ ] Verify file upload size limits
- [ ] Verify HTML sanitization on crawled content
- [ ] [AAP-F3] Verify CopySnippet escapes special characters in generated HTML
- [ ] [AAP-F10] Verify cheerio is not in client bundle (bundle analyzer check)

**Notes:**
- [AAP-B1] DNS rebinding test: verify that `dns.resolve4()` is called immediately before each HTTP request in the crawler, and that resolved IPs are validated against private ranges. Verify redirect chains are also validated.
- [AAP-F3] Verify that both `anchorText` and `targetUrl` are HTML-escaped (`<`, `>`, `"`, `&`, `'`) before assembling `<a>` tags in CopySnippet. Verify `document.execCommand('copy')` fallback works.
- [AAP-F10] Run `ANALYZE=true npm run build` and verify cheerio does not appear in client bundles.
- [AAP-B9] Verify the rate limiter implemented by the Integration Test Agent is correctly applied to endpoints.
- Security review findings are documented in a DECISION doc with pass/fail status for each item.

**Verification commands:**
- `npm audit --audit-level=critical` -- zero critical vulnerabilities
- `ANALYZE=true npm run build` -- cheerio absent from client chunks
- Manual SSRF test with internal IP URLs returns 400
- Manual rate limit test exceeding threshold returns 429

### Ops Agent

**Domain:** Sentry integration, analytics, load testing, seed data.

**Tasks:** 8.3, 8.4, 8.5, 8.6

**Files created:**

| File | Source Task |
|------|------------|
| `sentry.client.config.ts` | 8.3 (Sentry client-side config) |
| `sentry.server.config.ts` | 8.3 (Sentry server-side config) |
| `src/instrumentation.ts` | 8.3 (Sentry instrumentation, if needed) |
| `prisma/seed.ts` | 8.6 (development seed data) |
| `tests/helpers/factories.ts` | 8.6 (test factory functions) |

**Files modified:**

| File | Source Task | Change |
|------|------------|--------|
| `src/app/layout.tsx` | 8.4 (add `<Analytics />` and `<SpeedInsights />` components) |
| `.github/workflows/ci.yml` | 8.3 (source map upload step) |
| `package.json` | 8.3 (add `@sentry/nextjs` dependency) |

**Notes:**
- Sentry: install `@sentry/nextjs`, configure DSN from env, enable source map uploads in CI workflow.
- Analytics: add Vercel `<Analytics />` and `<SpeedInsights />` components to root layout.
- Load testing verifies performance at scale, not correctness (correctness is Integration Test Agent's domain).
- [AAP-O2] 2,000-article analysis must complete via chunked cron processing -- verify total wall time is reasonable, no single-invocation 300s limit hit.
- Seed data creates a realistic development environment per DBA plan Section 3.

**Load test targets (from Implementation Plan):**
- [ ] 500-URL sitemap crawl completes within cron timeout
- [ ] 2,000-article analysis completes via chunked cron processing [AAP-O2]
- [ ] 10,000-recommendation CSV export streams without timeout
- [ ] pgvector similarity queries complete in reasonable time at scale

**Seed data contents:**
- 1 test user (Pro plan)
- 1 project "Demo Blog"
- 15-20 realistic articles across 3-4 topic clusters
- 2 completed analysis runs
- 30-50 recommendations (mixed severity/status)
- 1 strategy config with defaults
- 2 ingestion jobs (1 completed, 1 partially failed)

**Factory functions (`tests/helpers/factories.ts`):**
- `createTestUser(overrides?)` -- minimal user record
- `createTestProject(overrides?)` -- minimal project record
- `createTestArticle(overrides?)` -- minimal article record
- `createTestRecommendation(overrides?)` -- minimal recommendation record
- `createTestAnalysisRun(overrides?)` -- minimal analysis run record

**Verification commands:**
- Sentry test event appears in Sentry dashboard
- `<Analytics />` and `<SpeedInsights />` render in production build
- `npx tsx prisma/seed.ts` populates all models
- Load test results documented with timings

---

## Execution Flow

```
Phase A -- parallel (all three agents work on entirely different file sets)
  Integration Test Agent  ─► feature/phase-8-integration (own worktree)
  Security Agent          ─► feature/phase-8-security    (own worktree)
  Ops Agent               ─► feature/phase-8-ops         (own worktree)

Phase B -- sequential merge into feature/phase-8
  1. Merge feature/phase-8-integration → feature/phase-8
  2. Merge feature/phase-8-security    → feature/phase-8
  3. Merge feature/phase-8-ops         → feature/phase-8
  4. Integration verification pass
  5. PR feature/phase-8 → develop
```

### Merge Order Rationale

Integration Test Agent first because it creates the rate limiter (`src/lib/rate-limit.ts`) that the Security Agent verifies, and test factories that other test files may reference. Security Agent second because it may produce fixes to source files based on its review. Ops Agent last because its files (Sentry config, analytics, seed data) are purely additive with no overlap.

### Expected Conflicts

- **`package.json`:** Low risk. Ops Agent adds `@sentry/nextjs`. Integration Test Agent does not modify package.json. Simple additive merge.
- **`src/app/layout.tsx`:** Low risk. Only Ops Agent modifies this file (adding Analytics/SpeedInsights). No other agent touches it.
- **`.github/workflows/ci.yml`:** Low risk. Only Ops Agent modifies this file (adding source map upload step).
- **Source files from security fixes:** Medium risk if Security Agent patches files also touched by other agents. Resolve case-by-case during merge.

---

## Integration Verification

After all three branches merge into `feature/phase-8`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Dependencies install | `npm install` | Exit 0 |
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Lint passes | `npm run lint` | Exit 0 |
| All tests pass | `npx vitest --run` | All passing (including new integration tests) |
| Build succeeds | `npm run build` | Exit 0 |
| No critical vulns | `npm audit --audit-level=critical` | Exit 0 |
| Seed data loads | `npx tsx prisma/seed.ts` | Exit 0, all models populated |

### Manual

| Check | Verification |
|-------|-------------|
| Sentry captures errors | Trigger test error, verify in Sentry dashboard |
| Source maps uploaded | Error stack traces show original TypeScript |
| Rate limiter works | Exceed threshold on /api/articles, get 429 |
| Cross-tenant isolation | Manual API test with two different auth sessions [AAP-B5] |
| Bundle analyzer clean | `ANALYZE=true npm run build`, no cheerio in client [AAP-F10] |
| CopySnippet escaping | Paste XSS payload in anchor text, verify escaped output [AAP-F3] |

### Documentation

| Check | Location |
|-------|----------|
| Security review findings | `docs/decisions/security-review-v1.md` |
| Load test results | Documented in build_log.md |
| Rate limiter configuration | `src/lib/rate-limit.ts` [AAP-B9] |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] All integration tests pass
- [ ] Security checklist completed with no critical findings
- [ ] Sentry captures errors and uploads source maps
- [ ] Load tests complete within timeout limits
- [ ] Seed data populates all UI screens with realistic content

---

## Tests Required (from Implementation Plan)

All integration test files listed above plus:

**File:** `tests/integration/full-flow.test.ts`
- `it("completes_full_ingest_analyze_review_export_flow")`

**File:** `tests/api/articles.test.ts`
- POST push -> article in DB -> GET returns -> DELETE cascades

**File:** `tests/api/analyze.test.ts`
- Seed articles -> POST /api/analyze -> run completes -> recommendations in DB with correct dedup

**File:** `tests/api/recommendations.test.ts`
- Seed recs -> GET with filters -> CSV export -> parse and verify columns

**File:** `tests/api/cron/crawl.test.ts`
- Seed job + tasks -> invoke cron -> tasks processed, zombies recovered

**File:** `tests/api/auth.test.ts`
- Protected routes return 401 without session
- [AAP-B5] Cross-tenant access prevented on every endpoint

---

## Task-to-Agent Assignment

| Task | Agent | Description |
|------|-------|-------------|
| 8.1 | Integration Test Agent | All integration test suites (articles CRUD, analyze e2e with dedup, recommendations with export, cron crawl with zombie recovery, auth with cross-tenant checks [AAP-B5], full flow) |
| 8.1a | Integration Test Agent | Rate limiter implementation [AAP-B9] |
| 8.2 | Security Agent | Full security review checklist (API key audit, SSRF tests including DNS rebinding [AAP-B1], CORS, rate limiting verification [AAP-B9], npm audit, file upload limits, HTML sanitization, CopySnippet escaping [AAP-F3], cheerio bundle check [AAP-F10]) |
| 8.3 | Ops Agent | Sentry integration (client/server config, source maps in CI) |
| 8.4 | Ops Agent | Vercel Analytics + SpeedInsights |
| 8.5 | Ops Agent | Load testing (500-URL sitemap, 2000-article analysis [AAP-O2], 10K CSV streaming, pgvector perf) |
| 8.6 | Ops Agent | Seed data (prisma/seed.ts + test factories) |

---

## AAP Tags Covered

| Tag | Where Applied |
|-----|---------------|
| [AAP-B1] | Security Agent: SSRF protection at fetch time, DNS rebinding test, redirect chain validation |
| [AAP-B5] | Integration Test Agent: cross-tenant access tests on every endpoint |
| [AAP-B9] | Integration Test Agent: rate limiter implementation; Security Agent: rate limiting verification |
| [AAP-F3] | Security Agent: CopySnippet escaping verification |
| [AAP-F10] | Security Agent: cheerio not in client bundle (bundle analyzer check) |
| [AAP-O2] | Ops Agent: 2,000-article analysis via chunked cron processing load test |
