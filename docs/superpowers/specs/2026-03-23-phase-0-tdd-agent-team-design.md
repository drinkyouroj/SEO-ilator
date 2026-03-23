# Phase 0: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Infrastructure & Foundation (Implementation Plan Phase 0, tasks 0.1-0.16)

---

## Overview

Phase 0 establishes the project scaffold, Docker environment, CI/CD, and configuration so that a developer can clone, install, and run. This spec defines how three domain-specialized agents execute Phase 0 in parallel using git worktree isolation, with TDD discipline applied to all testable code.

---

## Agent Team

### Config Agent

**Domain:** Next.js scaffolding, dependencies, tooling configuration.

**Tasks:** 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 0.11, 0.15

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/layout.tsx` | 0.1 (create-next-app) |
| `src/app/page.tsx` | 0.1 (create-next-app) |
| `tsconfig.json` | 0.1 (strict: true, path alias @/* -> src/*) |
| `tailwind.config.ts` | 0.8 (semantic color tokens, darkMode: "class") |
| `postcss.config.js` | 0.1 (create-next-app default) |
| `vitest.config.ts` | 0.9 (jsdom, path aliases, coverage) |
| `next.config.js` | 0.7 + 0.15 (serverComponentsExternalPackages + bundle analyzer) |
| `.env.example` | 0.3 (all 16 env vars) |
| `package.json` | 0.2 + 0.11 + 0.15 (all deps incl. @next/bundle-analyzer, all scripts) |
| `prisma/schema.prisma` | Stub: datasource + generator blocks only (no models until Phase 1) |

**Notes:**
- `@next/bundle-analyzer` must be installed as a dev dependency (task 0.15).
- `tsx` must be installed as a dev dependency for the Prisma seed script in package.json.
- The Prisma schema stub enables `prisma generate` to succeed in CI and build steps. Models are added in Phase 1.

**Verification commands:**
- `npm install` succeeds
- `npm run dev` starts Next.js dev server on port 3000
- `npm run lint` passes
- `npx tsc --noEmit` passes
- `npx prisma generate` succeeds (stub schema)
- `npx vitest` initializes cleanly (zero tests)
- `npm run build` completes

### DevOps Agent

**Domain:** Docker, CI/CD, Vercel deployment, infrastructure documentation.

**Tasks:** 0.4, 0.5, 0.6, 0.10, 0.12, 0.13, 0.14

**Files created:**

| File | Source Task |
|------|------------|
| `docker-compose.yml` | 0.4 (pgvector:pg16, healthcheck, volumes) |
| `docker/init.sql` | 0.4 (CREATE EXTENSION vector) |
| `vercel.json` | 0.5 (3 cron jobs, 5 function duration configs) |
| `.github/workflows/ci.yml` | 0.6 + 0.14 (4 jobs: lint-typecheck, test, build, migration-test) |
| `.gitignore` | 0.10 (additions if create-next-app missed anything) |
| `README.md` | 0.12 + 0.13 (pgvector prerequisite, preview DB docs) |

**Verification commands:**
- `docker compose config` validates without errors
- YAML lint on `.github/workflows/ci.yml`

### TDD Agent

**Domain:** Test-first development of the cron secret verification helper.

**Task:** 0.16

**Files created (in strict order):**

| Order | File | Commit |
|-------|------|--------|
| 1 | `tests/lib/auth/cron-guard.test.ts` | RED: 3 failing tests |
| 2 | `src/lib/auth/cron-guard.ts` | GREEN: implementation passes all 3 |

**Test cases (from Implementation Plan):**
- `it("returns_false_without_authorization_header")`
- `it("returns_false_with_wrong_secret")`
- `it("returns_true_with_correct_secret")`

**Test environment setup:** Tests must stub `process.env.CRON_SECRET` via `vi.stubEnv('CRON_SECRET', 'test-secret')` in a `beforeEach` block and restore via `vi.unstubAllEnvs()` in `afterEach`.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum (red, green).

---

## Execution Flow

```
Phase A ── sequential (foundation)
  Config Agent creates Next.js scaffold on feature/phase-0-config
  Commits, verifies: install, lint, typecheck, vitest init, build

Phase B ── parallel (worktree isolation, branched from Config output)
  DevOps Agent  ─► feature/phase-0-devops (own worktree)
  TDD Agent     ─► feature/phase-0-tdd    (own worktree)

Phase C ── sequential merge into feature/phase-0
  1. Merge feature/phase-0-config → feature/phase-0
  2. Merge feature/phase-0-devops → feature/phase-0
  3. Merge feature/phase-0-tdd   → feature/phase-0
  4. Integration verification pass
  5. PR feature/phase-0 → develop
```

### Merge Order Rationale

Config first because it creates the project scaffold (package.json, tsconfig, etc.) that other branches reference. DevOps second because its files are mostly additive (new files with no overlap). TDD last because it adds source + test files that depend on the vitest config from Config.

### Expected Conflicts

- **package.json:** Low risk. Config Agent installs all dependencies. DevOps and TDD agents create new files, not modify package.json.
- **.gitignore:** Low risk. Config Agent creates via create-next-app. DevOps Agent may append entries. Simple concatenation merge.
- **next.config.js:** Low risk. Config Agent creates with both serverComponentsExternalPackages and bundle analyzer in one pass.

---

## Integration Verification

After all three branches merge into `feature/phase-0`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Dependencies install | `npm install` | Exit 0 |
| Dev server starts | `npm run dev` | Starts on port 3000 |
| Lint passes | `npm run lint` | Exit 0 |
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Tests pass | `npx vitest --run` | 3/3 passing (cron-guard) |
| Build succeeds | `npm run build` | Exit 0 |
| Docker config valid | `docker compose config` | Valid YAML output |

### Documentation

| Check | Location |
|-------|----------|
| All 16 env vars present | `.env.example` |
| 3 cron paths + 5 function configs | `vercel.json` |
| pgvector >= 0.5.0 documented | `README.md` |
| Preview DB provisioning documented | `README.md` |
| 4 CI jobs defined | `.github/workflows/ci.yml` |
| Bundle analyzer documented | `next.config.js` (ANALYZE=true) |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] `docker compose up -d` starts PostgreSQL with pgvector
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts the Next.js dev server on port 3000
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] `npx vitest` runs and cron-guard tests pass (3/3)
- [ ] `.env.example` contains all required variable names
- [ ] [AAP] pgvector version >= 0.5.0 documented as prerequisite
- [ ] [AAP] Preview database provisioning documented
- [ ] [AAP] CI migration test job present in workflow
- [ ] [AAP] Bundle analyzer configured with ANALYZE=true toggle
- [ ] [AAP] Cron secret verification uses timing-safe comparison
