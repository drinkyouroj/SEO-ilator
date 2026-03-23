# Phase 1: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Database Schema & Auth (Implementation Plan Phase 1, tasks 1.1-1.7)

---

## Overview

Phase 1 establishes the complete database schema (11 Prisma models across 5 sequential migrations), Auth.js v5 configuration with three providers, and the auth abstraction layer. This spec defines how three domain-specialized agents execute Phase 1, with the Schema Agent running first (its output is a hard dependency for auth and tenant-scoping), followed by the Auth Agent and TDD Agent in parallel using git worktree isolation.

---

## Agent Team

### Schema Agent

**Domain:** Prisma schema definition, sequential migrations, pgvector setup.

**Tasks:** 1.1, 1.2

**Files created:**

| File | Source Task |
|------|------------|
| `prisma/schema.prisma` | 1.1 (complete schema: User, Account, Session, VerificationToken, Project, Article, AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask) |
| `prisma/migrations/*_init_auth/migration.sql` | 1.2 (Migration 1: User, Account, Session, VerificationToken) |
| `prisma/migrations/*_add_project/migration.sql` | 1.2 (Migration 2: Project) |
| `prisma/migrations/*_add_articles_with_pgvector/migration.sql` | 1.2 (Migration 3: Article + pgvector extension + HNSW index) |
| `prisma/migrations/*_add_analysis_and_recommendations/migration.sql` | 1.2 (Migration 4: AnalysisRun, Recommendation, StrategyConfig + partial unique index [AAP-B3]) |
| `prisma/migrations/*_add_ingestion_queue/migration.sql` | 1.2 (Migration 5: IngestionJob, IngestionTask) |

**Notes:**
- Migrations must be created sequentially: comment out later models, run `prisma migrate dev`, uncomment next batch, repeat.
- Migration 3 requires manual SQL appended to the generated `migration.sql`: `CREATE EXTENSION IF NOT EXISTS vector`, `ALTER TABLE "Article" ADD COLUMN "embedding" vector(1536)`, and the HNSW index with `m = 16, ef_construction = 64`.
- Migration 4 requires manual SQL appended: [AAP-B3] partial unique index `AnalysisRun_projectId_active_unique` on `("projectId") WHERE status IN ('pending', 'running')`.
- Docker Postgres with pgvector must be running before migration execution: `docker compose up -d`.
- After all 5 migrations, run `npx prisma generate` to regenerate the client.

**Verification commands:**
- `npx prisma migrate dev` applies all 5 migrations without error
- `npx prisma studio` shows all 11 tables with correct columns and indexes
- `npx prisma generate` succeeds
- `docker compose exec postgres psql -U postgres -d seoilator -c "SELECT extversion FROM pg_available_extensions WHERE name = 'vector';"` returns >= 0.5.0
- `docker compose exec postgres psql -U postgres -d seoilator -c "\di Article_embedding_hnsw_idx"` shows HNSW index exists
- `docker compose exec postgres psql -U postgres -d seoilator -c "\di AnalysisRun_projectId_active_unique"` shows partial unique index exists

### Auth Agent

**Domain:** Auth.js v5 configuration, session helpers, middleware, API client.

**Tasks:** 1.4, 1.4a, 1.5

**Files created:**

| File | Source Task |
|------|------------|
| `src/lib/auth/config.ts` | 1.4 (Auth.js v5 config: Google/GitHub/Email providers, Prisma adapter, database sessions, signIn callback for auto-Project creation, session maxAge 30 days [AAP-F5]) |
| `src/lib/auth/session.ts` | 1.4 (getSession, requireAuth, getCurrentUser — sole next-auth import point) |
| `src/lib/auth/middleware.ts` | 1.4 (Auth.js middleware config for route protection) |
| `src/middleware.ts` | 1.5 (protects /dashboard/* and /api/* except /api/auth/* and /api/cron/*) |
| `src/lib/api-client.ts` | 1.4a (global fetch wrapper: 401 intercept → redirect to /auth/sign-in with callbackUrl, session expiry toast [AAP-F5]) |

**Notes:**
- Depends on Schema Agent output: Prisma client with User, Account, Session, VerificationToken, Project models must exist before Auth.js Prisma adapter can be configured.
- `src/lib/auth/session.ts` is the only file that imports from `next-auth`. All other code imports from this file.
- `requireAuth()` throws a 401 response if unauthenticated, returns `{ userId, projectId, user }`.
- `signIn` callback must auto-create a default Project on first login.
- `session` callback must attach `projectId` to the session object.
- [AAP-F5] Session duration: 30 days (`session.maxAge`), refreshed on authenticated activity.
- `api-client.ts` intercepts 401 responses and redirects to `/auth/sign-in?callbackUrl=<current_page>`. Shows toast: "Your session has expired. Please sign in again."
- All client-side fetch calls in dashboard components must use `apiFetch` instead of raw `fetch`.

**Verification commands:**
- `npx tsc --noEmit` passes with all auth files
- `npm run build` succeeds
- Manual test: unauthenticated request to `/dashboard` redirects to sign-in
- Manual test: unauthenticated request to `/api/articles` returns 401
- Manual test: `/api/auth/*` routes are NOT blocked by middleware
- Manual test: `/api/cron/*` routes are NOT blocked by middleware

### TDD Agent

**Domain:** Test-first development of plan-guard, scoped Prisma extension, session cleanup cron, health endpoint.

**Tasks:** 1.3, 1.6, 1.7

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/auth/plan-guard.test.ts` | 1.3 | RED: 5 failing tests |
| 2 | `src/lib/auth/plan-guard.ts` | 1.3 | GREEN: implementation passes all 5 |
| 3 | `src/lib/db.ts` | 1.3 | Prisma client singleton + `withProject()` + `scopedPrisma()` [AAP-B5] |
| 4 | `src/app/api/cron/cleanup-sessions/route.ts` | 1.6 | Session cleanup cron (delete expired sessions, verify CRON_SECRET) |
| 5 | `src/app/api/health/route.ts` | 1.7 | Health check: `{ status, database, timestamp }` + stuck jobs detection [AAP-O5] |

**Test cases (from Implementation Plan):**

**File:** `tests/lib/auth/plan-guard.test.ts`
- `it("allows_free_tier_user_first_three_runs")`
- `it("blocks_free_tier_user_after_three_runs")`
- `it("blocks_free_tier_semantic_matching")`
- `it("allows_pro_tier_unlimited_runs")`
- `it("returns_descriptive_message_on_limit")`

**Test environment setup:**
- Tests must mock the Prisma client using `vitest-mock-extended` to return controlled User and AnalysisRun data.
- Mock `prisma.analysisRun.count()` to simulate run counts for free/pro tier testing.
- Mock `prisma.user.findUnique()` to return users with different `plan`, `articleLimit`, and `runLimit` values.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum per testable unit (red, green).

**Notes on non-test files:**
- `src/lib/db.ts` (task 1.3): Creates the Prisma client singleton, `withProject()` helper, and [AAP-B5] `scopedPrisma()` tenant-scoped extension. The extension auto-injects `projectId` into where clauses on tenant-scoped models: `article`, `analysisRun`, `recommendation`, `strategyConfig`, `ingestionJob`, `ingestionTask`.
- `src/app/api/cron/cleanup-sessions/route.ts` (task 1.6): Deletes sessions where `expires < NOW()`. Verifies `CRON_SECRET` header via `verifyCronSecret()` from Phase 0. Runs daily per `vercel.json` schedule.
- `src/app/api/health/route.ts` (task 1.7): Returns `{ status: "ok", database: "connected", timestamp: "..." }` after `SELECT 1` via Prisma. [AAP-O5] Also checks for stuck jobs/runs: any IngestionJob or AnalysisRun in `running` status for over 15 minutes is included as `stuckJobs: [...]` and triggers a Sentry alert.

**Verification commands:**
- `npx vitest tests/lib/auth/plan-guard.test.ts` -- 5/5 passing
- `npx tsc --noEmit` passes
- `curl http://localhost:3000/api/health` returns 200 with `{ status: "ok", database: "connected" }`

---

## Execution Flow

```
Phase A ── sequential (schema foundation)
  Schema Agent creates Prisma schema + 5 migrations on feature/phase-1-schema
  Commits, verifies: all migrations apply, prisma studio shows tables, indexes exist

Phase B ── parallel (worktree isolation, branched from Schema output)
  Auth Agent  ─► feature/phase-1-auth (own worktree)
  TDD Agent   ─► feature/phase-1-tdd  (own worktree)

Phase C ── sequential merge into feature/phase-1
  1. Merge feature/phase-1-schema → feature/phase-1
  2. Merge feature/phase-1-auth   → feature/phase-1
  3. Merge feature/phase-1-tdd    → feature/phase-1
  4. Integration verification pass
  5. PR feature/phase-1 → develop
```

### Merge Order Rationale

Schema first because it creates `prisma/schema.prisma` and all migrations — both Auth Agent and TDD Agent depend on the generated Prisma client types (User, Project, Session, AnalysisRun, etc.). Auth second because it creates the auth config and session helpers that the health endpoint (TDD Agent) references indirectly. TDD last because its files (db.ts, plan-guard, cron route, health route) are additive and depend on both the schema types and the auth helpers.

### Expected Conflicts

- **`prisma/schema.prisma`:** No conflict. Only Schema Agent modifies this file.
- **`src/lib/db.ts`:** Low risk. TDD Agent creates this file. Auth Agent imports from it but does not create it. If Auth Agent creates a stub `db.ts`, resolve by keeping TDD Agent's version (which includes `scopedPrisma`).
- **`package.json`:** No conflict expected. No agents add dependencies in this phase (all deps installed in Phase 0).

---

## Integration Verification

After all three branches merge into `feature/phase-1`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Migrations apply | `npx prisma migrate dev` | Exit 0, all 5 migrations applied |
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Tests pass | `npx vitest --run` | 5/5 passing (plan-guard) + 3/3 from Phase 0 |
| Build succeeds | `npm run build` | Exit 0 |
| Health endpoint | `curl http://localhost:3000/api/health` | 200 with `{ status: "ok" }` |
| Prisma studio | `npx prisma studio` | All 11 tables visible |

### Documentation

| Check | Location |
|-------|----------|
| pgvector HNSW index present | `prisma/migrations/*_add_articles_with_pgvector/migration.sql` |
| Partial unique index [AAP-B3] present | `prisma/migrations/*_add_analysis_and_recommendations/migration.sql` |
| Session maxAge 30 days [AAP-F5] | `src/lib/auth/config.ts` |
| Auto-Project creation on first login | `src/lib/auth/config.ts` (signIn callback) |
| Tenant-scoped models listed [AAP-B5] | `src/lib/db.ts` (TENANT_SCOPED_MODELS) |
| Stuck job detection [AAP-O5] | `src/app/api/health/route.ts` |
| 401 intercept + redirect [AAP-F5] | `src/lib/api-client.ts` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] All 5 migrations apply cleanly to local Docker Postgres
- [ ] `npx prisma studio` shows all tables with correct columns and indexes
- [ ] pgvector extension is active (`SELECT * FROM pg_available_extensions WHERE name = 'vector'`)
- [ ] HNSW index exists on Article.embedding
- [ ] Auth.js sign-in page works with Google OAuth (manual test)
- [ ] Unauthenticated requests to `/dashboard` redirect to sign-in
- [ ] Unauthenticated requests to `/api/articles` return 401
- [ ] `/api/health` returns 200 with database status
- [ ] [AAP-B3] Partial unique index on AnalysisRun prevents concurrent runs per project
- [ ] [AAP-B5] `scopedPrisma(projectId)` auto-injects projectId on tenant-scoped models
- [ ] [AAP-F5] Session maxAge configured to 30 days with activity refresh
- [ ] Session cleanup cron deletes expired sessions
