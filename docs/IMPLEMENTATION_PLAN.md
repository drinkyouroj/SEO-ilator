# SEO-ilator v1.0 Implementation Plan

**Date:** 2026-03-23
**Status:** Authoritative
**Purpose:** Phase-by-phase build plan for Claude Code to implement the full v1.0 product.

This plan synthesizes input from six specialists (Backend Engineer, Frontend Engineer, DBA, Client Success, DevOps, SEO Expert) and five DECISION documents. Each phase contains every file path, interface, function, and acceptance criterion needed to begin coding immediately.

---

## Phase 0: Infrastructure & Foundation

**Goal:** Establish the project scaffold, Docker environment, Vercel/Railway provisioning, CI/CD, and environment configuration so that a developer can clone, install, and run.

**Prerequisites:** None. This is the starting point.

### Tasks

#### 0.1 Initialize Next.js project

```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*"
```

- Configure `tsconfig.json` with `strict: true`
- Configure path alias `@/*` -> `src/*`

#### 0.2 Install dependencies

```bash
npm install prisma @prisma/client next-auth@5 @auth/prisma-adapter zod cheerio openai csv-stringify class-variance-authority
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom msw vitest-mock-extended @types/node
```

#### 0.3 Create `.env.example`

**File:** `SEO-ilator/.env.example`

```env
# Database (Railway PostgreSQL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/seoilator"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/seoilator"

# Auth.js
AUTH_SECRET="generate-with-openssl-rand-base64-32"
AUTH_URL="http://localhost:3000"

# OAuth Providers
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""

# Email (Magic Link)
RESEND_API_KEY=""
EMAIL_FROM="noreply@seo-ilator.com"

# Embedding Providers
OPENAI_API_KEY=""
COHERE_API_KEY=""

# Monitoring
SENTRY_DSN=""
SENTRY_AUTH_TOKEN=""

# Vercel Cron
CRON_SECRET="test-secret"

# Public
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

#### 0.4 Create `docker-compose.yml`

**File:** `SEO-ilator/docker-compose.yml`

Per DevOps plan: local PostgreSQL with pgvector, no containerized Next.js.

```yaml
version: "3.8"
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: seoilator
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

**File:** `SEO-ilator/docker/init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

#### 0.5 Create `vercel.json`

**File:** `SEO-ilator/vercel.json`

Per DevOps plan:

```json
{
  "crons": [
    {
      "path": "/api/cron/crawl",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/analyze",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/cleanup-sessions",
      "schedule": "0 3 * * *"
    }
  ],
  "functions": {
    "src/app/api/cron/crawl/route.ts": {
      "maxDuration": 300
    },
    "src/app/api/cron/analyze/route.ts": {
      "maxDuration": 300
    },
    "src/app/api/analyze/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/articles/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/recommendations/route.ts": {
      "maxDuration": 60
    }
  }
}
```

#### 0.6 Create GitHub Actions CI workflow

**File:** `SEO-ilator/.github/workflows/ci.yml`

Per DevOps plan:

```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npx vitest --reporter=verbose --coverage

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
```

#### 0.7 Configure `next.config.js`

**File:** `SEO-ilator/next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "cheerio"], // [AAP-F10] cheerio must not leak into client bundle
  },
};

module.exports = nextConfig;
```

#### 0.8 Configure Tailwind

**File:** `SEO-ilator/tailwind.config.ts`

Per Frontend plan -- semantic color tokens, dark mode via `class` strategy:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2563eb", // blue-600
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        destructive: "#dc2626", // red-600
        warning: "#f59e0b",     // amber-500
        success: "#16a34a",     // green-600
        muted: "#9ca3af",       // gray-400
      },
    },
  },
  plugins: [],
};
export default config;
```

#### 0.9 Configure Vitest

**File:** `SEO-ilator/vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "lcov"],
      exclude: ["node_modules/", "tests/"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

#### 0.10 Create `.gitignore`

Ensure `.env.local`, `node_modules/`, `.next/`, `.vercel/` are ignored.

#### 0.11 Add build script to `package.json`

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "vercel-build": "prisma generate && next build",
    "migrate:deploy": "prisma migrate deploy",
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

### Acceptance Criteria

- [ ] `docker compose up -d` starts PostgreSQL with pgvector
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts the Next.js dev server on port 3000
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] `npx vitest` runs (with zero tests, exits cleanly)
- [ ] `.env.example` contains all required variable names

#### 0.12 [AAP-O3] Verify pgvector version on Railway

Before proceeding to Phase 1, verify that the target PostgreSQL instance has pgvector >= 0.5.0 (required for HNSW indexes):

```sql
SELECT extversion FROM pg_available_extensions WHERE name = 'vector';
```

Document the minimum version (0.5.0) as a deployment prerequisite in README.md.

#### 0.13 [AAP-O4] Configure preview database provisioning

Provision a separate Railway PostgreSQL instance (or branch) for preview deployments. Modify `vercel-build` to run `prisma generate` only (no `migrate deploy`). Migrations run as a separate CI step or manually before deployment.

Add environment variable branching in Vercel:
- Production: `DATABASE_URL` points to production Railway instance
- Preview: `DATABASE_URL` points to preview/staging Railway instance

#### 0.14 [AAP-O9] Add CI migration test job

Add a job to `.github/workflows/ci.yml` that spins up a temporary pgvector PostgreSQL and runs all migrations against it:

```yaml
  migration-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: seoilator_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy
        env:
          DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/seoilator_test"
          DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/seoilator_test"
```

#### 0.15 [AAP-F10] Add bundle analyzer

```bash
npm install -D @next/bundle-analyzer
```

Configure in `next.config.js` with `ANALYZE=true` toggle. Set client bundle size budget of 250KB gzipped.

#### 0.16 [AAP-B8] Create reusable cron secret verification helper

**File:** `src/lib/auth/cron-guard.ts`

```typescript
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Timing-safe comparison
  if (token.length !== secret.length) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);
  return crypto.subtle.timingSafeEqual(a, b);
}
```

Test: `tests/lib/auth/cron-guard.test.ts` -- verify 401 without correct header, 200 with correct header.

### Acceptance Criteria

- [ ] `docker compose up -d` starts PostgreSQL with pgvector
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts the Next.js dev server on port 3000
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] `npx vitest` runs (with zero tests, exits cleanly)
- [ ] `.env.example` contains all required variable names
- [ ] [AAP] pgvector version >= 0.5.0 confirmed
- [ ] [AAP] Preview database provisioned separately from production
- [ ] [AAP] CI migration test job passes against fresh database

### Tests Required

**File:** `tests/lib/auth/cron-guard.test.ts` [AAP-B8]
- `it("returns_false_without_authorization_header")`
- `it("returns_false_with_wrong_secret")`
- `it("returns_true_with_correct_secret")`

---

## Phase 1: Database Schema & Auth

**Goal:** Complete Prisma schema with all models, run migrations, configure Auth.js v5 with Google/GitHub/magic link providers, and establish the auth abstraction layer.

**Prerequisites:** Phase 0 complete. Docker Postgres running. `pgvector` verified.

### Tasks

#### 1.1 Create the complete Prisma schema

**File:** `SEO-ilator/prisma/schema.prisma`

Per DBA's full schema (this is the authoritative schema for the project):

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  directUrl  = env("DIRECT_URL")
  extensions = [vector]
}

// ── AUTH MODELS (Auth.js v5 Prisma Adapter) ──

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?

  plan         String   @default("free") // "free" | "pro" | "enterprise"
  articleLimit Int      @default(50)
  runLimit     Int      @default(3)

  accounts Account[]
  sessions Session[]
  projects Project[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expires])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
  @@index([expires])
}

// ── PROJECT (multi-tenancy foundation, per DECISION-004) ──

model Project {
  id     String @id @default(cuid())
  userId String
  name   String

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  articles        Article[]
  analysisRuns    AnalysisRun[]
  recommendations Recommendation[]
  strategyConfigs StrategyConfig[]
  ingestionJobs   IngestionJob[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

// ── ARTICLE ──

model Article {
  id        String @id @default(cuid())
  projectId String

  url       String
  title     String
  body      String  @db.Text
  bodyHash  String  // SHA-256 of normalized body
  titleHash String  // SHA-256 of normalized title
  wordCount Int

  // Metadata captured during crawl (per DECISION-002)
  metadata       Json?   // canonical URL, headings, meta title/desc, etc.
  sourceType     String? // "sitemap" | "upload" | "api_push" (per DECISION-005)
  httpStatus     Int?
  existingLinks  Json?   // Array of internal links already on the page

  // Embedding cache (per DECISION-001)
  // NOTE: embedding column added via raw SQL (pgvector type)
  embeddingModel String?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  sourceRecommendations Recommendation[] @relation("SourceArticle")
  targetRecommendations Recommendation[] @relation("TargetArticle")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([projectId, url])
  @@index([projectId, updatedAt])
  @@index([projectId, bodyHash])
}

// ── ANALYSIS RUN ──

model AnalysisRun {
  id        String @id @default(cuid())
  projectId String

  status              String   // "pending" | "running" | "completed" | "failed"
  strategiesUsed      Json     // e.g. ["crosslink"]
  configuration       Json     // thresholds, matching approaches, etc.
  articleCount        Int      @default(0)
  recommendationCount Int      @default(0)

  // Embedding cost observability (per DECISION-001)
  embeddingsCached    Int      @default(0)
  embeddingsGenerated Int      @default(0)

  error       String? @db.Text
  startedAt   DateTime?
  completedAt DateTime?

  project         Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  recommendations Recommendation[]

  createdAt DateTime @default(now())

  @@index([projectId, status])
  @@index([projectId, createdAt])
}

// ── RECOMMENDATION ──

model Recommendation {
  id              String @id @default(cuid())
  projectId       String
  analysisRunId   String
  strategyId      String
  sourceArticleId String
  targetArticleId String

  type        String  // "crosslink" | "meta" | "keyword" | "content_quality"
  severity    String  // "info" | "warning" | "critical"
  title       String
  description String  @db.Text
  anchorText  String?
  confidence  Float   @default(0)

  matchingApproach String? // "keyword" | "semantic" | "both"

  status        String  @default("pending") // "pending" | "accepted" | "dismissed" | "superseded" [AAP-B4]
  dismissReason String?

  // One-click insertion prep (per DECISION-005)
  sourceContext   String? @db.Text
  charOffsetStart Int?
  charOffsetEnd   Int?

  suggestion Json? // for non-crosslink strategies in future

  project       Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  analysisRun   AnalysisRun @relation(fields: [analysisRunId], references: [id], onDelete: Cascade)
  sourceArticle Article     @relation("SourceArticle", fields: [sourceArticleId], references: [id], onDelete: Cascade)
  targetArticle Article     @relation("TargetArticle", fields: [targetArticleId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([projectId, analysisRunId, status, severity])
  @@index([sourceArticleId, status])
  @@index([targetArticleId])
  @@unique([analysisRunId, sourceArticleId, targetArticleId, strategyId])
}

// ── STRATEGY CONFIG ──

model StrategyConfig {
  id         String @id @default(cuid())
  projectId  String
  strategyId String

  settings Json

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  updatedAt DateTime @updatedAt

  @@unique([projectId, strategyId])
}

// ── INGESTION JOB + TASK (per DECISION-002) ──

model IngestionJob {
  id        String @id @default(cuid())
  projectId String

  status        String  // "pending" | "running" | "completed" | "failed" | "cancelled" [AAP-F9]
  totalUrls     Int     @default(0)
  completedUrls Int     @default(0)
  failedUrls    Int     @default(0)
  preset        String  @default("gentle") // "gentle" | "standard" | "fast"

  completedAt DateTime?

  project Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   IngestionTask[]

  createdAt DateTime @default(now())

  @@index([projectId, status])
  @@index([status, createdAt])
}

model IngestionTask {
  id    String @id @default(cuid())
  jobId String

  url          String
  status       String  @default("pending") // "pending" | "processing" | "completed" | "failed"
  errorMessage String?
  httpStatus   Int?
  responseTimeMs Int?
  retryCount   Int     @default(0)

  startedAt   DateTime?
  processedAt DateTime?

  job IngestionJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId, status])
  @@index([status, startedAt])
}
```

#### 1.2 Create migrations in order

Per DBA's migration strategy, create 5 migrations:

**Migration 1: `init-auth`** -- User, Account, Session, VerificationToken tables.

```bash
npx prisma migrate dev --name init-auth
```

(Only include auth models in schema, comment out the rest, run migrate, then uncomment next batch.)

**Migration 2: `add-project`** -- Project table.

**Migration 3: `add-articles-with-pgvector`** -- Article table. After Prisma generates the migration file, manually append to `migration.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Article" ADD COLUMN "embedding" vector(1536);
CREATE INDEX "Article_embedding_hnsw_idx"
  ON "Article"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Migration 4: `add-analysis-and-recommendations`** -- AnalysisRun, Recommendation, StrategyConfig. After Prisma generates the migration file, manually append to `migration.sql`:

```sql
-- [AAP-B3] Prevent concurrent analysis runs per project at the database level
CREATE UNIQUE INDEX "AnalysisRun_projectId_active_unique"
  ON "AnalysisRun" ("projectId")
  WHERE status IN ('pending', 'running');
```

**Migration 5: `add-ingestion-queue`** -- IngestionJob, IngestionTask.

#### 1.3 Create Prisma client singleton

**File:** `src/lib/db.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Returns a where clause fragment scoped to the given project.
 * Every tenant-data query MUST use this.
 */
export function withProject(projectId: string) {
  return { projectId };
}

// [AAP-B5] Tenant-scoped Prisma extension. Use scopedPrisma(projectId) for all
// tenant-data queries. This automatically injects projectId into where clauses
// on tenant-scoped models, preventing accidental cross-tenant data leaks.
const TENANT_SCOPED_MODELS = [
  "article", "analysisRun", "recommendation", "strategyConfig",
  "ingestionJob", "ingestionTask"
] as const;

export function scopedPrisma(projectId: string) {
  return prisma.$extends({
    query: {
      ...Object.fromEntries(
        TENANT_SCOPED_MODELS.map((model) => [
          model,
          {
            $allOperations({ args, query }: { args: any; query: any }) {
              if (args.where) {
                args.where.projectId = projectId;
              } else if (args.data && !args.where) {
                // For create operations, ensure projectId is set
              }
              return query(args);
            },
          },
        ])
      ),
    },
  });
}
```

#### 1.4 Configure Auth.js v5

**File:** `src/lib/auth/config.ts`

Per DECISION-004: Auth.js v5 with Prisma adapter, database sessions, Google + GitHub + Email magic link providers. Auto-create default Project on first login via `signIn` callback.

Exports:
- `authConfig` -- the Auth.js configuration object
- Providers: `Google`, `GitHub`, `Email` (via Resend)
- Prisma adapter pointing at `prisma` from `src/lib/db.ts`
- Session strategy: `"database"`
- [AAP-F5] Session duration: 30 days, refreshed on authenticated activity. Configure `session.maxAge` in Auth.js config.
- Callbacks: `signIn` (auto-create Project on first login), `session` (attach `projectId` to session)

**File:** `src/lib/auth/session.ts`

Per DECISION-004: the only file that imports from `next-auth`. Exports:

```typescript
export async function getSession(): Promise<Session | null>;
export async function requireAuth(): Promise<{ userId: string; projectId: string; user: User }>;
export async function getCurrentUser(): Promise<User & { project: Project }>;
```

`requireAuth()` throws a 401 response if unauthenticated. Returns validated `userId` and `projectId`.

**File:** `src/lib/auth/middleware.ts`

Exports the Auth.js middleware config for route protection. Used by `src/middleware.ts`.

**File:** `src/lib/auth/plan-guard.ts`

Exports:

```typescript
export async function checkPlanLimits(
  projectId: string,
  action: "analyze" | "analyze_semantic" | "api_access"
): Promise<{ allowed: boolean; message?: string }>;
```

Checks:
- Free tier: max 3 runs/month, max 50 articles, single approach only, no API access
- Pro tier: unlimited runs, 2000 articles, both approaches, full API
- Returns `{ allowed: false, message: "..." }` with tier-appropriate messaging per Client Success plan

#### 1.4a [AAP-F5] Create global fetch wrapper for client-side 401 handling

**File:** `src/lib/api-client.ts`

A wrapper around `fetch` used by all client-side API calls. Intercepts 401 responses and redirects to `/auth/sign-in?callbackUrl=<current_page>`. Shows a toast on session expiry during optimistic updates: "Your session has expired. Please sign in again."

```typescript
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    const callbackUrl = encodeURIComponent(window.location.pathname);
    window.location.href = `/auth/sign-in?callbackUrl=${callbackUrl}`;
    throw new Error("Session expired");
  }
  return res;
}
```

All client-side fetch calls in dashboard components must use `apiFetch` instead of raw `fetch`.

#### 1.5 Create middleware

**File:** `src/middleware.ts`

Protects:
- `/dashboard/*` -- redirect to `/auth/sign-in` if unauthenticated
- `/api/*` (except `/api/auth/*` and `/api/cron/*`) -- return 401 if unauthenticated

#### 1.6 Create session cleanup cron

**File:** `src/app/api/cron/cleanup-sessions/route.ts`

Per DECISION-004: delete sessions where `expires < NOW()`. Verify `CRON_SECRET` header. Run daily.

#### 1.7 Create health check endpoint

**File:** `src/app/api/health/route.ts`

Per DevOps plan: returns `{ status: "ok", database: "connected", timestamp: "..." }` after running `SELECT 1` via Prisma.

[AAP-O5] Also checks for stuck jobs/runs: if any IngestionJob or AnalysisRun has been in `running` status for over 15 minutes, include `stuckJobs: [...]` in the response and trigger a Sentry alert.

### Acceptance Criteria

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

### Tests Required

**File:** `tests/lib/auth/plan-guard.test.ts`
- `it("allows_free_tier_user_first_three_runs")`
- `it("blocks_free_tier_user_after_three_runs")`
- `it("blocks_free_tier_semantic_matching")`
- `it("allows_pro_tier_unlimited_runs")`
- `it("returns_descriptive_message_on_limit")`

---

## Phase 2: Dashboard Shell & Layout

**Goal:** Build the dashboard layout shell, auth UI, all placeholder pages, and shared component library foundations.

**Prerequisites:** Phase 1 complete. Auth working.

### Tasks

#### 2.1 Root layout

**File:** `src/app/layout.tsx`

- Global styles, Inter font loading, metadata
- `SessionProvider` wrapper for client components
- `ThemeProvider` for dark mode (class strategy, localStorage persistence)

#### 2.2 Auth pages

**File:** `src/app/auth/sign-in/page.tsx`

Per Frontend plan component hierarchy:
- `AuthLayout` (centered card, no sidebar)
  - `SignInCard`
    - `OAuthButton` (Google) -- per Client Success: full-width, provider icon + "Continue with Google"
    - `OAuthButton` (GitHub)
    - `Divider` ("or")
    - `MagicLinkForm` (email input + "Send magic link" button)
    - `ErrorAlert` (maps Auth.js error codes per Client Success plan Section 3.3)

Error code mapping per Client Success plan:
- `OAuthAccountNotLinked` -> [AAP-F11] "This email is associated with your [provider] account. Please sign in with [provider]." (Query Account table for provider name.)
- `EmailSignin` -> "Could not send the magic link. Please try again."
- `Callback` -> "Something went wrong. Please try again. If the problem persists, try a different sign-in method."
- `Verification` -> [AAP-F8] "This sign-in link has expired. Please request a new one." (Link back to sign-in page.)

**File:** `src/app/auth/verify-request/page.tsx`

Magic link confirmation: "Check your email. We sent a sign-in link to [email]. The link expires in 10 minutes." Resend button (throttled 60s).

[AAP-F8] Include:
- "Sign in a different way" link back to sign-in page
- Troubleshooting tips: "Check your spam folder. Make sure you entered the correct email. If you use a corporate email, ask your IT team to whitelist noreply@seo-ilator.com."

#### 2.3 Layout components

**File:** `src/components/layout/AppShell.tsx`

Top-level wrapper: sidebar + header + main content slot. Sidebar collapse state.

**File:** `src/components/layout/Sidebar.tsx`

Navigation links: Articles, Analyze, Runs, Ingest, Settings. Active state highlighting. Collapsible to icon-only below `md` breakpoint. Hamburger menu on mobile.

**File:** `src/components/layout/Header.tsx`

Dynamic page title + `UserMenu` on right.

**File:** `src/components/layout/UserMenu.tsx`

Avatar (OAuth provider image or initials fallback), dropdown: name + email, plan badge, "Settings" link, "Sign out" button.

**File:** `src/components/layout/AuthLayout.tsx`

Centered card layout for sign-in (no sidebar).

**File:** `src/components/layout/PageContainer.tsx`

Max-width constraint, padding. `p-6` desktop, `p-4` mobile.

#### 2.4 Dashboard layout

**File:** `src/app/dashboard/layout.tsx`

Wraps all `/dashboard/*` routes with `AppShell`.

#### 2.5 Placeholder pages

Create page files with heading + `EmptyState` component for each:

- `src/app/dashboard/page.tsx` -- redirects to `/dashboard/articles`
- `src/app/dashboard/articles/page.tsx`
- `src/app/dashboard/articles/[id]/page.tsx`
- `src/app/dashboard/runs/page.tsx`
- `src/app/dashboard/analyze/page.tsx`
- `src/app/dashboard/ingest/page.tsx`
- `src/app/dashboard/settings/page.tsx`

#### 2.6 Shared UI components (foundations)

**File:** `src/components/data/SeverityBadge.tsx`

Color-coded badge: critical (red), warning (amber), info (blue). Use `cva` for variants.

**File:** `src/components/data/StatusBadge.tsx`

Pending (gray), accepted (green), dismissed (muted), running (blue spinner), completed (green), failed (red).

**File:** `src/components/data/EmptyState.tsx`

Title, description, optional CTA button. Reused on all pages.

**File:** `src/components/data/Pagination.tsx`

Prev/Next with page indicator. Cursor-based.

**File:** `src/components/data/DataTable.tsx`

Generic sortable, paginated table. Column definitions, row data, loading skeletons, empty state slot. [AAP-F6] Include a `renderMobileCard` prop that accepts a row data object and returns a card layout for screens below `md` breakpoint. This avoids a Phase 7 rewrite -- the responsive pass becomes a configuration exercise.

**File:** `src/components/feedback/Toast.tsx` + `src/components/feedback/ToastProvider.tsx`

Non-blocking notifications. Variants: success, error, info. Auto-dismiss 5s. Stack bottom-right.

**File:** `src/components/feedback/ProgressBar.tsx`

Determinate (X/Y) and indeterminate modes.

**File:** `src/components/feedback/Spinner.tsx`

Inline loading indicator.

**File:** `src/components/feedback/SkeletonLoader.tsx`

Configurable shapes for loading states.

**File:** `src/components/feedback/ErrorBanner.tsx`

Full-width banner with retry button slot.

**File:** `src/components/forms/ConfirmDialog.tsx`

Modal with title, description, confirm/cancel buttons.

#### 2.7 Theme provider

**File:** `src/components/ThemeProvider.tsx`

Dark mode toggle using `class` strategy. Reads/writes `localStorage`. Default to system preference.

### Acceptance Criteria

- [ ] Sign-in page renders with Google, GitHub, and magic link options
- [ ] After sign-in, user lands on dashboard with sidebar navigation
- [ ] All 6 dashboard routes render placeholder pages
- [ ] Sidebar highlights the active route
- [ ] User menu shows name, avatar, plan badge, and sign-out
- [ ] Dark mode toggles correctly
- [ ] Layout is responsive: sidebar collapses on mobile
- [ ] Empty states show appropriate messaging per Client Success plan

### Tests Required

**File:** `tests/components/data/SeverityBadge.test.tsx`
- `it("renders_critical_badge_in_red")`
- `it("renders_warning_badge_in_amber")`
- `it("renders_info_badge_in_blue")`

**File:** `tests/components/data/DataTable.test.tsx`
- `it("renders_column_headers_and_rows")`
- `it("shows_skeleton_during_loading")`
- `it("shows_empty_state_when_no_rows")`

**File:** `tests/components/feedback/Toast.test.tsx`
- `it("renders_message_and_auto_dismisses")`

---

## Phase 3: Ingestion Pipeline

**Goal:** Build all three ingestion methods (sitemap, URL list, API push), the async crawl queue, cron worker, and the ingestion dashboard UI.

**Prerequisites:** Phase 1 (schema), Phase 2 (layout shell).

### Tasks

#### 3.1 Validation schemas

**File:** `src/lib/validation/common.ts`

```typescript
import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const uuidSchema = z.string().cuid();

export const urlSchema = z.string().url().refine(
  (url) => url.startsWith("http://") || url.startsWith("https://"),
  "URL must use HTTP or HTTPS"
);
```

**File:** `src/lib/validation/articleSchemas.ts`

Per Backend plan -- discriminated union by `method` field:

```typescript
export const ingestSitemapSchema = z.object({
  method: z.literal("sitemap"),
  sitemapUrl: urlSchema,
  crawlPreset: z.enum(["gentle", "standard", "fast"]).default("gentle"),
});

export const ingestUrlListSchema = z.object({
  method: z.literal("url_list"),
  urls: z.array(urlSchema).min(1).max(2000),
  crawlPreset: z.enum(["gentle", "standard", "fast"]).default("gentle"),
});

export const ingestPushSchema = z.object({
  method: z.literal("push"),
  articles: z.array(z.object({
    url: urlSchema,
    title: z.string().min(1).max(500),
    body: z.string().min(1),
    bodyFormat: z.enum(["html", "markdown", "text"]).default("html"),
    metadata: z.record(z.unknown()).optional(),
  })).min(1).max(500),
});

export const ingestRequestSchema = z.discriminatedUnion("method", [
  ingestSitemapSchema,
  ingestUrlListSchema,
  ingestPushSchema,
]);
```

#### 3.2 SSRF URL validator

**File:** `src/lib/ingestion/url-validator.ts`

Per DevOps plan Section 5.4. Exports:

```typescript
export function validatePublicUrl(url: string): { valid: boolean; reason?: string };
```

Rejects: private IP ranges (10.x, 172.16.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7), `localhost`, `file://`, `ftp://`, `data://` schemes. Validates resolved hostname against private ranges.

[AAP-B1] IP validation must occur at TWO points: (1) at submission time for fast user feedback, and (2) at fetch time inside `crawler.ts` by resolving the hostname immediately before the HTTP request using `dns.resolve4()`. This prevents DNS rebinding attacks where the hostname resolves to a private IP between submission and fetch. Every URL in a redirect chain must also be validated against private IP ranges.

#### 3.3 Normalizer

**File:** `src/lib/ingestion/normalizer.ts`

Per Backend plan. Single entry point for all ingestion paths. Exports:

```typescript
export interface NormalizedArticle {
  url: string;
  title: string;
  body: string;          // plain text, HTML stripped
  bodyHash: string;      // SHA-256 of normalized body
  titleHash: string;     // SHA-256 of normalized title
  wordCount: number;
  metadata: Record<string, unknown>;
  sourceType: "sitemap" | "upload" | "api_push";
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }>;
}

export function normalizeArticle(input: RawArticleInput): NormalizedArticle;
export function computeBodyHash(body: string): string;
export function computeTitleHash(title: string): string;
```

Hash scope: `bodyHash` = SHA-256 of normalized body only. `titleHash` = SHA-256 of normalized title. Per DECISION-001 JUDGE modification.

#### 3.4 HTML parser

**File:** `src/lib/ingestion/parser.ts`

Per Backend + SEO Expert plans. Cheerio-based. Exports:

```typescript
export interface ParsedPage {
  title: string;              // from <title> or <h1> or og:title
  body: string;               // extracted body text
  headings: Array<{ level: number; text: string }>;
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }>;
  canonicalUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  robotsDirectives: { index: boolean; follow: boolean };
  language: string | null;    // from <html lang="">
}

export function parsePage(html: string, sourceUrl: string): ParsedPage;
```

Per SEO Expert: capture headings, existing links, canonical, meta tags, robots directives, language.

#### 3.5 Sitemap parser

**File:** `src/lib/ingestion/sitemap-parser.ts`

Per Backend plan. Exports:

```typescript
export async function parseSitemap(url: string): Promise<string[]>;
```

Handles: sitemap.xml, sitemap index files, gzipped sitemaps, malformed XML (graceful error).

[AAP-O10] Enforce the following safety limits:
- Recursion depth limit of 2 for sitemap index files (index -> sub-sitemap, never deeper)
- Maximum decompressed size limit of 50MB for gzipped sitemaps
- Maximum total URL count of 10,000 per submission (clear error if exceeded)
- Deduplicate URLs after parsing all sub-sitemaps, before creating IngestionTask records
- Handle XML namespace variations (namespace-aware and namespace-unaware parsing)

#### 3.6 Crawler

**File:** `src/lib/ingestion/crawler.ts`

Per Backend + DECISION-002. Exports:

```typescript
export interface CrawlResult {
  url: string;
  html: string;
  httpStatus: number;
  responseTimeMs: number;
  redirectChain?: Array<{ url: string; status: number }>;
}

export async function fetchUrl(url: string, options: CrawlOptions): Promise<CrawlResult>;
export async function fetchRobotsTxt(domain: string): Promise<RobotsTxtRules>;
export function isUrlAllowed(url: string, rules: RobotsTxtRules): boolean;
```

Rate presets per DECISION-002:
| Preset | Requests/sec | Concurrency |
|--------|-------------|-------------|
| gentle | 1 | 1 |
| standard | 3 | 2 |
| fast | 10 | 5 |

User-Agent: `SEO-ilator/1.0 (+https://seo-ilator.com/bot)`. 10-second per-URL timeout. SSRF validation on every URL.

[AAP-B1] Perform `dns.resolve4()` immediately before each HTTP request and validate the resolved IP against private ranges. Disable following redirects automatically; instead, manually follow redirects and validate each redirect target URL against SSRF rules before following. This prevents SSRF via DNS rebinding and redirect-to-private-IP attacks.

[AAP-O1] After parsing, detect empty/near-empty body (< 50 words when HTTP response was 200 and content-length > 1KB). Flag such articles with `parseWarning: "This page may use client-side rendering. The extracted content appears empty. Consider using the API push method instead."` Surface warnings in the ingestion progress feed and articles table.

#### 3.7 Ingestion queue manager

**File:** `src/lib/ingestion/queue.ts`

Per Backend plan. Exports:

```typescript
export async function createJob(projectId: string, urls: string[], preset: string): Promise<IngestionJob>;
export async function claimBatch(batchSize: number): Promise<IngestionTask[]>;
export async function completeTask(taskId: string, articleData: NormalizedArticle): Promise<void>;
export async function failTask(taskId: string, error: string, httpStatus?: number): Promise<void>;
export async function recoverZombieTasks(): Promise<number>;
export async function getJobStatus(jobId: string): Promise<IngestionJob & { tasks: IngestionTask[] }>;
export async function cancelJob(jobId: string): Promise<void>; // [AAP-F9]
```

Uses `FOR UPDATE SKIP LOCKED` for claim pattern per DBA plan. [AAP-B2] Zombie recovery: tasks in `processing` > **10 min** (not 5 min -- must exceed the 300s function timeout) reset to `pending` with `retryCount++`. Tasks with `retryCount >= 3` marked `failed`. Task completion uses compare-and-swap: `UPDATE SET status = 'completed' WHERE id = ? AND status = 'processing'` -- if 0 rows affected, log the conflict but do not treat as error.

[AAP-F9] `cancelJob()` sets job status to `cancelled` and marks all remaining `pending` tasks as `cancelled`. Cron worker must skip tasks for cancelled jobs.

#### 3.8 API routes

**File:** `src/app/api/articles/route.ts`

`POST /api/articles` -- Per Backend plan:
- Discriminated union request by `method`
- Sitemap/URL list <50 URLs: synchronous processing, return `201` per DECISION-002 JUDGE modification
- Sitemap/URL list >=50 URLs: async via queue, return `202 Accepted` with `{ jobId, totalUrls, status: "pending" }`
- Push: synchronous upsert, return `201` with `{ articles, created, updated }`. [AAP-O7] For `bodyFormat: "html"`, run `parsePage()` on the body to extract `existingLinks`, headings, and metadata. For `bodyFormat: "text"` or `"markdown"`, set `existingLinks` to `[]` (empty array, not null) meaning "no existing link data available."
- Validation via Zod schemas
- SSRF check on all URLs
- Upsert by `projectId + url` unique constraint

`GET /api/articles` -- Paginated list with search, sort. Response type per Backend plan:
```typescript
type ArticleListResponse = {
  articles: Array<{
    id: string; url: string; title: string; wordCount: number;
    sourceType: string | null; recommendationCount: number;
    lastAnalyzedAt: string | null; createdAt: string; updatedAt: string;
  }>;
  pagination: { page: number; limit: number; total: number; totalPages: number };
};
```

**File:** `src/app/api/articles/[id]/route.ts`

`GET /api/articles/[id]` -- Full article with body preview, embedding status, recommendation count by severity.
`DELETE /api/articles/[id]` -- [AAP-B10] Before deleting, check for active analysis runs (`status IN ('pending', 'running')`) on the project. If analysis is in progress, return 409: "Cannot delete articles while an analysis is running." Otherwise 204, cascades to recommendations.

**File:** `src/app/api/jobs/[id]/route.ts`

`GET /api/jobs/[id]` -- Per Backend plan. Returns job status with per-task detail for progress polling.

**File:** `src/app/api/jobs/[id]/cancel/route.ts` [AAP-F9]

`POST /api/jobs/[id]/cancel` -- Calls `cancelJob()` from queue.ts. Returns 200 with updated job status. Returns 404 if job not found, 409 if job already completed/failed.

#### 3.9 Cron worker for crawling

**File:** `src/app/api/cron/crawl/route.ts`

Per Backend plan Section 4.2. Execution flow per invocation:
1. Verify `CRON_SECRET` header
2. Zombie recovery (reset stuck tasks)
3. Claim batch (up to 60 tasks, grouped by domain, respecting rate limits)
4. Process each task: fetch -> parse -> normalize -> upsert Article
5. Update task status and job counters
6. Check job completion

Timeout safety: stop at ~280s elapsed. Per-domain rate limiting via last-completed-task timestamp.

Per DBA plan, article upsert uses:
```sql
INSERT ... ON CONFLICT ("projectId", url) DO UPDATE SET ...
-- Clear embedding cache when content changes
embedding = CASE WHEN "Article"."bodyHash" != EXCLUDED."bodyHash" ...
```

#### 3.10 Ingestion UI

**File:** `src/app/dashboard/ingest/page.tsx`

Per Frontend plan Section 2.2 component hierarchy:
- `IngestionPage`
  - `IngestionTabs` (Sitemap | URL List | File Upload)
    - `SitemapForm` -- URL input, `CrawlRateSelector`, submit
    - `UrlListForm` -- textarea, `CrawlRateSelector`, submit
    - `FileUploadForm` -- drag-and-drop zone
  - `IngestionProgress` (shown after submission)
    - `ProgressBar`
    - `UrlStatusFeed` (scrollable per-URL status)
    - `IngestionStats` (completed, failed, skipped)
    - `CancelButton`
    - `ETADisplay`

**File:** `src/components/forms/CrawlRateSelector.tsx`

Per Frontend plan: radio group with Gentle/Standard/Fast presets. Fast shows warning: "This may impact your site's performance for visitors. Only use for sites on dedicated infrastructure." (per DECISION-002).

**File:** `src/components/forms/SitemapInput.tsx`

URL input with validation. Per Client Success plan: hint "Tip: Most sites serve their sitemap at yoursite.com/sitemap.xml. WordPress sites use /wp-sitemap.xml."

**File:** `src/components/forms/UrlListInput.tsx`

Textarea, newline-separated, per-line validation.

**File:** `src/components/forms/FileDropzone.tsx`

Drag-and-drop, click-to-browse. Accept .html, .md, .json. [AAP-F7] File size limits: 10MB per file, 50MB total. For HTML files, submit via a `multipart/form-data` API route that parses server-side with cheerio. For .md and .json files, parse client-side and submit via `method: "push"`. Cheerio must NEVER be imported in client components. Show upload progress via `XMLHttpRequest` progress events.

**File:** `src/components/feedback/UrlStatusFeed.tsx`

Scrollable list of per-URL status during ingestion. Each row: URL, status icon, error message.

Progress polling: `GET /api/jobs/[id]` every 3 seconds (per Frontend plan Section 4). [AAP-F1] Use exponential backoff on consecutive failures (3s -> 6s -> 12s -> 30s cap, reset on success). Pause polling when `document.visibilityState === 'hidden'`. Stop polling when job status is `completed`, `failed`, or `cancelled`.

Empty state per Client Success plan: "Your article index is empty. Add your site's articles to get started." [Button: "Add articles via sitemap"]

Error messages per Client Success plan Section 3.1 (all error scenarios).

**File:** `src/app/dashboard/ingest/loading.tsx` [AAP-F9]

Skeleton loader for ingestion page.

#### 3.11 Articles index page

**File:** `src/app/dashboard/articles/page.tsx`

Per Frontend plan Section 2.3:
- `ArticlesToolbar` (search, count badge)
- `ArticlesTable` (DataTable with columns: title, URL, word count, last analyzed, rec count)
- `Pagination`
- `EmptyState`: "No articles yet. Import your first articles to get started." [CTA -> /dashboard/ingest]

Server-side initial fetch, client-side for subsequent pages/search/sort.

### Acceptance Criteria

- [ ] `POST /api/articles` with `method: "push"` creates articles and returns 201
- [ ] `POST /api/articles` with `method: "sitemap"` for <50 URLs processes synchronously
- [ ] `POST /api/articles` with `method: "sitemap"` for >=50 URLs creates IngestionJob and returns 202
- [ ] Cron worker processes pending tasks and upserts articles
- [ ] Zombie recovery resets stuck tasks
- [ ] `GET /api/articles` returns paginated list with search
- [ ] `DELETE /api/articles/[id]` cascades to recommendations
- [ ] `GET /api/jobs/[id]` returns per-task status
- [ ] Ingestion UI shows progress with per-URL status feed
- [ ] Articles page shows indexed articles with sorting and search
- [ ] SSRF protection rejects private IPs
- [ ] [AAP-B1] SSRF validation occurs at fetch time (not just submission time)
- [ ] [AAP-B1] Redirect chains are validated against SSRF rules
- [ ] [AAP-B2] Zombie recovery threshold is 10 minutes (exceeds 300s function timeout)
- [ ] [AAP-F9] Cancel button triggers `POST /api/jobs/[id]/cancel` and stops processing
- [ ] [AAP-O1] Articles with < 50 words from 200-OK responses show parseWarning
- [ ] [AAP-O7] Push-ingested HTML articles have existingLinks extracted
- [ ] [AAP-O10] Sitemap parser enforces recursion, size, and URL count limits
- [ ] robots.txt is respected during crawl

### Tests Required

**File:** `tests/lib/ingestion/normalizer.test.ts`
- `it("computes_consistent_hash_across_input_formats")`
- `it("strips_html_tags_for_plain_text_body")`
- `it("computes_correct_word_count")`
- `it("handles_empty_body_without_error")`
- `it("handles_unicode_content")`

**File:** `tests/lib/ingestion/parser.test.ts`
- `it("extracts_title_from_title_tag")`
- `it("falls_back_to_h1_when_no_title_tag")`
- `it("extracts_existing_internal_links")`
- `it("detects_noindex_directive")`
- `it("extracts_meta_description")`
- `it("extracts_heading_structure")`

**File:** `tests/lib/ingestion/crawler.test.ts`
- `it("rejects_private_ip_urls")`
- `it("respects_robots_txt_disallow")`
- `it("sets_correct_user_agent_header")`
- `it("handles_timeout_gracefully")`

**File:** `tests/lib/ingestion/sitemap-parser.test.ts`
- `it("parses_standard_sitemap")`
- `it("handles_sitemap_index")`
- `it("handles_malformed_xml")`
- `it("returns_empty_for_empty_sitemap")`

**File:** `tests/lib/ingestion/queue.test.ts`
- `it("creates_job_with_pending_tasks")`
- `it("claims_batch_respecting_rate_limits")`
- `it("recovers_zombie_tasks")`
- `it("fails_tasks_exceeding_retry_limit")`
- `it("marks_job_complete_when_all_tasks_done")`

---

## Phase 4: Embedding Provider & Cache

**Goal:** Build the embedding provider abstraction, OpenAI integration, cache-check logic, and pgvector similarity queries.

**Prerequisites:** Phase 1 (schema with pgvector), Phase 3 (articles in database).

### Tasks

#### 4.1 Embedding types

**File:** `src/lib/embeddings/types.ts`

```typescript
export interface EmbeddingProvider {
  readonly modelId: string;     // e.g. "openai/text-embedding-3-small"
  readonly dimensions: number;  // e.g. 1536
  embed(texts: string[]): Promise<number[][]>;
}
```

#### 4.2 OpenAI provider

**File:** `src/lib/embeddings/providers/openai.ts`

Implements `EmbeddingProvider`. Uses `openai` SDK. Model: `text-embedding-3-small`. Dimensions: 1536. Batch support (up to 2048 inputs per call).

#### 4.3 Cohere provider

**File:** `src/lib/embeddings/providers/cohere.ts`

Implements `EmbeddingProvider`. Model: `embed-english-v3.0`. Dimensions: 1024.

#### 4.4 Provider factory

**File:** `src/lib/embeddings/index.ts`

```typescript
export function getProvider(providerName?: string): EmbeddingProvider;
```

Reads from project settings or env var. Default: OpenAI.

[AAP-B6] Provider switching must be an atomic operation. When the embedding provider changes for a project:
1. Clear all embeddings: `UPDATE "Article" SET embedding = NULL, "embeddingModel" = NULL WHERE "projectId" = ?`
2. The HNSW index operates on the same `vector(1536)` column regardless -- pgvector handles NULL values by excluding them from the index.
3. Force a full re-embed on the next analysis run.
4. The settings endpoint must warn the user: "Switching providers invalidates all cached embeddings. A full re-embed will be required on the next analysis run."
5. Never allow mixed-dimension vectors in the same project. The batch processor must zero-pad shorter vectors (e.g., Cohere 1024-dim) to 1536 dimensions before storage, per DECISION-001 JUDGE verdict.

**File:** `src/lib/embeddings/providers.ts`

Maps provider names to dimension sizes:
```typescript
export const PROVIDER_DIMENSIONS: Record<string, number> = {
  "openai/text-embedding-3-small": 1536,
  "cohere/embed-english-v3.0": 1024,
};
```

#### 4.5 Cache check logic

**File:** `src/lib/embeddings/cache.ts`

Per DECISION-001. Exports:

```typescript
export interface CacheCheckResult {
  cached: Article[];
  needsGeneration: Article[];
}

export function checkEmbeddingCache(
  articles: Article[],
  currentModel: string
): CacheCheckResult;
```

Logic: article is cached if `bodyHash` matches, `titleHash` matches, `embeddingModel === currentModel`, and `embedding IS NOT NULL`. Otherwise needs generation.

#### 4.6 Embedding batch processor

**File:** `src/lib/embeddings/batch.ts`

```typescript
export async function generateEmbeddings(
  articles: Article[],
  provider: EmbeddingProvider
): Promise<Map<string, number[]>>;
```

Processes in chunks (OpenAI: up to 2048 per call). Updates Article records with embedding + embeddingModel + hash values via raw SQL `$executeRaw`.

#### 4.7 Vector similarity queries

**File:** `src/lib/embeddings/similarity.ts`

Per DBA plan Section 4.2. Exports:

```typescript
export async function findSimilarArticles(
  embedding: number[],
  projectId: string,
  excludeArticleId: string,
  limit: number
): Promise<Array<{ id: string; title: string; url: string; distance: number }>>;
```

Uses `prisma.$queryRaw` with pgvector `<=>` operator. Sets `hnsw.ef_search = 100` for analysis sessions per DBA recommendation.

### Acceptance Criteria

- [ ] OpenAI provider generates embeddings for test articles
- [ ] Cache check correctly identifies cached vs. needing-generation articles
- [ ] Embeddings are persisted to Article records via raw SQL
- [ ] `findSimilarArticles` returns ranked results using pgvector cosine distance
- [ ] `embeddingModel` is stored on Article records
- [ ] Provider switch causes cache miss (different model ID)
- [ ] [AAP-B6] Provider switch clears all embeddings atomically
- [ ] [AAP-B6] Cohere vectors are zero-padded to 1536 dimensions before storage

### Tests Required

**File:** `tests/lib/embeddings/cache.test.ts`
- `it("returns_cached_when_all_hashes_match")`
- `it("returns_needs_generation_when_body_changed")`
- `it("returns_needs_generation_when_title_changed")`
- `it("returns_needs_generation_when_model_changed")`
- `it("returns_needs_generation_when_no_embedding")`
- `it("splits_mixed_batch_correctly")`

**File:** `tests/lib/embeddings/providers/openai.test.ts`
- `it("returns_embeddings_with_correct_dimensions")`
- `it("handles_batch_input")`
- `it("throws_on_api_error")`

---

## Phase 5: Crosslink Strategy & Analysis

**Goal:** Build the strategy registry, crosslink strategy (keyword + semantic matching), deduplication, analysis orchestrator, and re-analysis logic.

**Prerequisites:** Phase 3 (articles), Phase 4 (embeddings).

### Tasks

#### 5.1 Strategy types

**File:** `src/lib/strategies/types.ts`

Per CLAUDE.md:

```typescript
export interface SEOStrategy {
  id: string;
  name: string;
  description: string;
  analyze(context: AnalysisContext): Promise<Recommendation[]>;
  configure?(settings: Record<string, unknown>): void;
}

// [AAP-B7] ArticleSummary is a slimmed-down type without full body text,
// used in the articleIndex to prevent OOM on large indexes.
export interface ArticleSummary {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  existingLinks: Array<{ href: string; anchorText: string; isFollow: boolean }> | null;
  hasEmbedding: boolean;
  canonicalUrl: string | null;
  robotsDirectives: { index: boolean; follow: boolean } | null;
  language: string | null;
  parseWarning: string | null; // [AAP-O1]
}

export interface AnalysisContext {
  article: Article;
  articleIndex: ArticleSummary[]; // [AAP-B7] Slimmed-down, no full body text
  settings: Record<string, unknown>;
  embeddingProvider?: EmbeddingProvider;
  // [AAP-B7] Callback to load full body text in batches during keyword matching
  loadArticleBodies: (ids: string[]) => Promise<Map<string, string>>;
}

export interface Recommendation {
  strategyId: string;
  articleId: string;
  type: "crosslink" | "meta" | "keyword" | "content_quality" | string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestion?: {
    anchorText?: string;
    targetUrl?: string;
    currentValue?: string;
    suggestedValue?: string;
  };
  // Extended fields for crosslink:
  targetArticleId?: string;
  confidence?: number;
  matchingApproach?: "keyword" | "semantic" | "both";
  sourceContext?: string;
  charOffsetStart?: number;
  charOffsetEnd?: number;
}
```

#### 5.2 Strategy registry

**File:** `src/lib/strategies/registry.ts`

Per CLAUDE.md:

```typescript
export class StrategyRegistry {
  register(strategy: SEOStrategy): void;
  unregister(id: string): void;
  getStrategy(id: string): SEOStrategy | undefined;
  getAllStrategies(): SEOStrategy[];
  async analyzeWithAll(context: Omit<AnalysisContext, "settings">): Promise<Recommendation[]>;
}

export const registry = new StrategyRegistry();
```

Per SEO Expert plan: registry does NOT handle cross-strategy dedup. Each strategy operates independently.

#### 5.3 Crosslink strategy

**File:** `src/lib/strategies/crosslink.ts`

This is the core file. Per Backend + SEO Expert plans. Internal modules:

**KeywordMatcher:**
- Text normalization: lowercase, strip HTML, normalize Unicode (NFC), collapse whitespace per SEO Expert plan Section 1.1
- Tokenization: 2-6 word n-grams from body text. Track character offsets for DECISION-005
- DOM-aware matching via cheerio: skip `<a>`, `<h1>`-`<h6>`, `<img alt>`, `<code>`, `<pre>`, `<nav>`, `<footer>`, `<header>` per SEO Expert plan Section 3 Rule 9
- [AAP-O6] Title prefix stripping: before matching, strip common prefixes from target titles ("How to", "A Guide to", "The Best", "What is", "Introduction to", "Getting Started with", numbered list prefixes like "10 Ways to"). Match on the distinctive portion.
- [AAP-O6] Minimum distinctive word coverage: matched n-gram must cover at least 60% of the target title's distinctive words (after prefix stripping). Penalize matches with < 3 distinctive words even if Dice coefficient is high.
- Exact matching: Set/Map lookup of normalized n-grams vs target titles/keywords
- Fuzzy matching: Dice coefficient with threshold (default 0.8) per SEO Expert recommendation
- Scoring per SEO Expert plan Section 1.1: base score + position boost + target quality boost - concentration penalty
- Severity: critical (score >= 0.85), warning (>= 0.6), info (< 0.6)

**SemanticMatcher:**
- Per SEO Expert plan Section 1.2: two-phase approach
  - Phase 1 (coarse): pgvector `<=>` top 20 candidates per article
  - Phase 2 (fine): chunk-to-chunk similarity for candidate pairs
- Chunks: ~500 tokens with 50-token overlap. Not persisted, computed at runtime per SEO Expert plan
- Anchor text derivation: from highest-similarity chunk pair, find sentence most similar to target title, extract 2-6 word n-gram
- Threshold: article-level similarity > configured threshold (default 0.75) AND chunk-pair > 0.80

**Quality safeguards (per SEO Expert plan Section 3):**

Hard rules (never violate):
1. No self-links (check after canonicalization)
2. No duplicate links (check `existingLinks` array). [AAP-O7] If `existingLinks` is `null` (data unavailable, e.g., API push with text format), apply conservative defaults: assume 5 existing links.
3. No linking to noindex pages
4. No linking to error pages (4xx/5xx)
5. No linking to non-canonical URLs
6. Max links per page (existing + pending + new <= maxLinksPerPage). [AAP-O7] When `existingLinks` is `null`, use conservative estimate (5 existing links) rather than 0.
7. No cross-language linking

Anchor text rules:
8. Minimum 2 words, maximum 8 words
9. No anchoring in forbidden DOM zones
10. No generic anchors ("click here", "read more", etc.)

Content quality filters:
11. Minimum 300 words for source articles
12. Minimum 2 articles for analysis

#### 5.4 Strategy registration

**File:** `src/lib/strategies/index.ts`

```typescript
import { registry } from "./registry";
import { CrosslinkStrategy } from "./crosslink";

registry.register(new CrosslinkStrategy());

export { registry };
```

#### 5.5 Deduplication and ranking

**File:** `src/lib/analysis/dedup-ranker.ts`

Per Backend + SEO Expert plans:

```typescript
export function deduplicateAndRank(
  keywordRecs: Recommendation[],
  semanticRecs: Recommendation[],
  maxLinksPerPage: number
): Recommendation[];
```

- Key by (sourceArticleId, targetArticleId)
- If both found: merge to `matchingApproach: "both"`, higher severity, confidence +0.15 (cap 1.0)
- Prefer keyword anchor text unless fuzzy and semantic found better
- Sort: severity desc, confidence desc, source wordCount desc
- Apply `maxLinksPerPage` cap per source article

#### 5.6 Re-analysis logic

**File:** `src/lib/analysis/re-analysis.ts`

Per Backend + SEO Expert plans:

```typescript
export interface ReAnalysisScope {
  newArticles: Article[];
  changedArticles: Article[];
  unchangedArticles: Article[];
  preservedRecommendations: Recommendation[]; // accepted, kept as-is
  staleRecommendations: Recommendation[];      // to mark stale
}

export async function computeReAnalysisScope(
  projectId: string,
  lastRunId: string | null
): Promise<ReAnalysisScope>;
```

Per SEO Expert plan Section 1.4:
- Accepted: never regenerated
- Dismissed: not regenerated unless source content changed
- Pending from previous run: replaced if either article changed, preserved if both unchanged
- [AAP-B4] When saving new recommendations in a transaction, mark all `pending` recommendations from previous runs for the same (sourceArticleId, targetArticleId, strategyId) triple as `superseded`. This prevents cross-run duplicate accumulation.
- Mark stale: target deleted, 404, noindex, or anchor text no longer in body

#### 5.7 Analysis orchestrator

**File:** `src/lib/analysis/orchestrator.ts`

Per Backend plan:

```typescript
export async function runAnalysis(
  projectId: string,
  config: AnalysisConfig
): Promise<AnalysisRun>;
```

Flow (redesigned per [AAP-B7, B11, O2] for chunked async processing):

**Initial call (from `POST /api/analyze`):**
1. Create `AnalysisRun` record (status: `pending`)
2. Compute re-analysis scope and embedding estimate (used for `dryRun` response)
3. Return the AnalysisRun record (the API route returns 202)

**Async processing (via cron worker `POST /api/cron/analyze`):**
The analysis cron runs every minute (add to `vercel.json`). Each invocation:
1. Claim one pending/running AnalysisRun (`FOR UPDATE SKIP LOCKED`)
2. Load article metadata (ArticleSummary, no body text) using cursor-based pagination
3. Update status to `running`, set `startedAt` (if not already running)
4. If semantic enabled: check embedding cache, generate missing embeddings in batches of 200, track `embeddingsCached`/`embeddingsGenerated`
5. Run strategies via registry, processing articles in batches of 200. Load full body text on-demand via `loadArticleBodies()` callback during keyword matching.
6. Deduplicate and rank
7. [AAP-B4] Mark previous-run pending recommendations as `superseded` for same (source, target, strategy) triples
8. Save recommendations atomically (transaction: all or none per PRD Section 10)
9. Update run: `recommendationCount`, `completedAt`, status `completed`
10. On any error: status `failed`, error message, no partial recommendations saved
11. [AAP-B10] Handle foreign key violations gracefully (article deleted during analysis): skip the recommendation for that article, log the skip, continue processing. Do not fail the entire run.

**Zombie recovery [AAP-F4]:** If an AnalysisRun has been in `running` status for > 10 minutes, mark as `failed` with error "Analysis timed out. Please try again."

#### 5.8 Analysis API routes

**File:** `src/app/api/analyze/route.ts`

`POST /api/analyze` -- Per Backend plan:

Request:
```typescript
type AnalyzeRequest = {
  approaches: Array<"keyword" | "semantic">;
  articleIds?: string[];
  dryRun?: boolean; // [AAP-O8] If true, return estimate without starting analysis
  settings?: {
    similarityThreshold?: number;
    fuzzyTolerance?: number;
    maxLinksPerPage?: number;
    forceReEmbed?: boolean;
  };
};
```

[AAP-O8] When `dryRun: true`: compute re-analysis scope and embedding estimate, return `200 OK` with `{ articleCount, embeddingEstimate: { cached, needsGeneration }, estimatedCost }` without creating an AnalysisRun. The analyze page calls with `dryRun: true` first, shows the estimate to the user, then calls again without `dryRun` after confirmation.

When `dryRun: false` (default): `202 Accepted` with `{ runId, status: "pending", articleCount, embeddingEstimate: { cached, needsGeneration } }`.

Plan limit check via `checkPlanLimits()`. Error per Client Success plan:
- No articles: 400 `"NO_ARTICLES"`
- Run in progress: 409 `"ANALYSIS_IN_PROGRESS"` (enforced by [AAP-B3] partial unique index)
- Free tier exceeded: 403 with upgrade messaging

**File:** `src/app/api/cron/analyze/route.ts` [AAP-B7, B11, O2]

Analysis cron worker. Runs every minute. Picks up pending/running AnalysisRun records and processes them in batches. Verifies `CRON_SECRET` via `verifyCronSecret()`. Includes zombie recovery for runs stuck in `running` > 10 minutes.

Add to `vercel.json`:
```json
{
  "path": "/api/cron/analyze",
  "schedule": "* * * * *"
}
```
And function config:
```json
"src/app/api/cron/analyze/route.ts": {
  "maxDuration": 300
}
```

**File:** `src/app/api/runs/route.ts`

`GET /api/runs` -- Paginated list of AnalysisRun records.

**File:** `src/app/api/runs/[id]/route.ts`

`GET /api/runs/[id]` -- Full run detail with recommendation summary.

**File:** `src/app/api/runs/[id]/cancel/route.ts` [AAP-F4]

`POST /api/runs/[id]/cancel` -- Sets AnalysisRun status to `cancelled`. Returns 200 with updated run. Returns 404 if not found, 409 if already completed/failed.

### Acceptance Criteria

- [ ] Keyword matching finds exact title matches in article bodies
- [ ] Fuzzy matching finds near-matches using Dice coefficient
- [ ] DOM-aware matching skips headings, existing links, code blocks
- [ ] Semantic matching returns similar articles via pgvector
- [ ] Deduplication merges keyword+semantic for same pair with confidence boost
- [ ] Re-analysis preserves accepted recommendations
- [ ] Re-analysis skips dismissed unless content changed
- [ ] Analysis fails cleanly with no partial recommendations
- [ ] `POST /api/analyze` returns 202 with run ID and embedding estimate
- [ ] Free tier limits enforced correctly
- [ ] All quality safeguards (self-link, noindex, max links, etc.) are enforced
- [ ] [AAP-O2] Analysis processes via cron worker, not inline in the API route
- [ ] [AAP-O8] `dryRun: true` returns estimate without starting analysis
- [ ] [AAP-F4] Cancel endpoint stops in-progress analysis
- [ ] [AAP-F4] Zombie recovery marks stuck analysis runs as failed after 10 minutes
- [ ] [AAP-B4] Previous-run pending recommendations are superseded on new run
- [ ] [AAP-O6] Common title prefixes do not generate false positive matches
- [ ] [AAP-O7] Articles with null existingLinks use conservative defaults in safeguards

### Tests Required

**File:** `tests/lib/strategies/crosslink.test.ts`
- `it("finds_exact_title_match_in_body_text")`
- `it("finds_fuzzy_match_with_dice_coefficient")`
- `it("skips_self_links")`
- `it("skips_existing_linked_pairs")`
- `it("skips_noindex_targets")`
- `it("respects_max_links_per_page")`
- `it("skips_anchors_inside_headings")`
- `it("skips_anchors_inside_existing_links")`
- `it("rejects_generic_anchor_text")`
- `it("enforces_minimum_word_count_for_sources")`
- `it("returns_empty_for_single_article_index")`
- `it("returns_empty_for_empty_index")`
- `it("captures_source_context_and_char_offsets")`
- `it("strips_common_title_prefixes_before_matching")` [AAP-O6]
- `it("rejects_matches_with_fewer_than_3_distinctive_words")` [AAP-O6]
- `it("uses_conservative_defaults_when_existingLinks_is_null")` [AAP-O7]

**File:** `tests/lib/strategies/registry.test.ts`
- `it("registers_and_retrieves_strategy")`
- `it("analyzeWithAll_runs_all_registered_strategies")`

**File:** `tests/lib/analysis/orchestrator.test.ts`
- `it("creates_run_and_transitions_to_completed")`
- `it("transitions_to_failed_with_no_partial_recs")`
- `it("tracks_embedding_cache_counters")`

**File:** `tests/lib/analysis/re-analysis.test.ts`
- `it("identifies_new_articles_since_last_run")`
- `it("identifies_changed_articles_by_hash")`
- `it("preserves_accepted_recommendations")`
- `it("skips_dismissed_when_content_unchanged")`
- `it("regenerates_dismissed_when_content_changed")`

**File:** `tests/lib/analysis/dedup-ranker.test.ts`
- `it("merges_keyword_and_semantic_for_same_pair")`
- `it("boosts_confidence_on_dual_match")`
- `it("ranks_by_severity_then_confidence")`
- `it("applies_max_links_per_page_cap")`

---

## Phase 6: Recommendations UI & Export

**Goal:** Build the recommendations display, filters, bulk actions, accept/dismiss workflow, copy-snippet, and CSV/JSON export.

**Prerequisites:** Phase 5 (analysis produces recommendations).

### Tasks

#### 6.1 Recommendations API routes

**File:** `src/app/api/recommendations/route.ts`

`GET /api/recommendations` -- Per Backend plan:
- Query params: `page`, `limit`, `severity` (comma-separated), `status` (comma-separated), `analysisRunId`, `articleId`, `format` (json/csv), `download` (boolean)
- JSON response: paginated with source/target article details
- CSV response: streamed with UTF-8 BOM, formula injection prevention per DECISION-003

CSV columns per DECISION-003:
| Column | Description |
|--------|-------------|
| source_title | Source article title |
| source_url | Source article URL |
| anchor_text | Suggested anchor text |
| target_title | Target article title |
| target_url | Target article URL |
| severity | critical/warning/info |
| confidence | 0.0-1.0 |
| matching_approach | keyword/semantic/both |
| status | pending/accepted/dismissed |
| recommendation_id | Unique ID |

For >10K rows: return 202 with export job ID per DECISION-003 JUDGE modification.

**File:** `src/app/api/recommendations/[id]/route.ts`

`PATCH /api/recommendations/[id]` -- Accept/dismiss with optional reason. [AAP-B12] Include `updatedAt` in the request body for optimistic locking. Update uses `WHERE id = ? AND updatedAt = ?`. If 0 rows affected, return 409: "This recommendation was modified since you loaded it. Please refresh."

**File:** `src/app/api/recommendations/bulk/route.ts`

`PATCH /api/recommendations/bulk` -- Bulk status update (max 500 IDs). [AAP-B12] Use `updateMany` with `projectId` filter (tenant isolation). Return `{ updated: number }` so the client can compare expected vs actual count.

#### 6.2 Export modules

**File:** `src/lib/export/csv.ts`

Per DECISION-003 ARCHITECT section:
```typescript
export class CsvSerializer {
  serialize(recommendations: RecommendationExportRow[]): ReadableStream;
}
```

Uses `csv-stringify`. Adds UTF-8 BOM. Streams response.

**File:** `src/lib/export/json.ts`

Adds `Content-Disposition` header for download mode.

**File:** `src/lib/export/sanitize.ts`

```typescript
export function sanitizeCell(value: string): string;
```

Prefixes cells starting with `=`, `+`, `-`, `@` with single quote for formula injection prevention per DECISION-003.

#### 6.3 Validation schemas

**File:** `src/lib/validation/recommendationSchemas.ts`

```typescript
export const updateRecommendationSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
});

export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(500),
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
});

export const recommendationFilterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  severity: z.string().optional(), // comma-separated
  status: z.string().optional(),
  analysisRunId: z.string().optional(),
  articleId: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  download: z.coerce.boolean().default(false),
});
```

#### 6.4 Article detail page with recommendations

**File:** `src/app/dashboard/articles/[id]/page.tsx`

Per Frontend plan Section 2.4:
- `ArticleDetailPage`
  - `ArticleMeta` (title, URL, word count, source type, dates)
  - `BodyPreview` (collapsible, truncated)
  - `RecommendationsSection`
    - `RecommendationFilters` (severity checkboxes, status tabs)
    - `BulkActionBar` (appears on selection: "Accept Selected", "Dismiss Selected")
    - `RecommendationCard` (repeated)
      - Checkbox, SeverityBadge, title + description
      - Anchor text -> target article link
      - Source context with anchor highlighted
      - `CopySnippet`
      - Accept/Dismiss buttons
    - `Pagination`

Optimistic UI: accept/dismiss updates state immediately, PATCH in background per Frontend plan. [AAP-F2] On PATCH failure, revert local state and show error toast. Disable individual action buttons on items currently selected for a pending bulk operation. Use `apiFetch` wrapper for 401 detection [AAP-F5].

Empty state per Client Success plan: "No recommendations yet. Run an analysis to generate crosslink suggestions." [Link -> /dashboard/analyze]

Zero-results state per Client Success plan: "No crosslink opportunities found for this run. This typically means your articles already have good internal linking, or the content topics don't overlap enough. You can try lowering the similarity threshold in Settings."

#### 6.5 CopySnippet component

**File:** `src/components/recommendations/CopySnippet.tsx`

Per DECISION-005 Phase 2:
- Editable anchor text field
- Generated HTML: `<a href="[targetUrl]">[anchorText]</a>`. [AAP-F3] HTML-escape both `anchorText` and `targetUrl` before assembling the `<a>` tag. Escape `<`, `>`, `"`, `&`, and `'` to prevent XSS when pasted into CMSes.
- "Copy HTML" button using `navigator.clipboard.writeText()`. [AAP-F3] Add `document.execCommand('copy')` fallback for non-HTTPS contexts.
- Source context paragraph with anchor text highlighted. [AAP-F10] Use simple string operations (indexOf + slice) for highlighting, NOT cheerio.
- Toast on successful copy

#### 6.6 Analysis page

**File:** `src/app/dashboard/analyze/page.tsx`

Per Frontend plan Section 2.6:
- `AnalysisConfigForm`
  - `MatchingApproachSelector` (checkboxes)
  - `ThresholdSlider` (0.5-1.0 for similarity)
  - `FuzzinessSlider` (0.6-1.0 for keyword)
  - `MaxLinksPerPageInput`
  - `ArticleScopeSelector` (all or subset)
- `PreRunSummary` (after Preview click): articles to analyze, embeddings cached vs needing generation, estimated cost. [AAP-O8] This calls `POST /api/analyze` with `dryRun: true` to get the estimate without starting analysis. User must click "Confirm" to start.
- `RunAnalysisButton` -- triggers `POST /api/analyze` (without dryRun) after user confirms the estimate
- `CancelButton` [AAP-F4] -- triggers `POST /api/runs/[id]/cancel` when analysis is in progress
- `AnalysisProgress` (poll `GET /api/runs/[id]` every 5s). [AAP-F1] Use exponential backoff on consecutive failures (5s -> 10s -> 20s -> 30s cap). Pause when tab hidden. Stop on `completed`, `failed`, `cancelled`.

Per Client Success plan onboarding hints:
- "Tip: Keyword matching is fast and finds obvious opportunities. Semantic matching takes longer but discovers deeper connections."

Free tier messaging per Client Success plan Section 3.4:
- Semantic locked: "Keyword matching found [X] opportunities. Unlock semantic matching on Pro to discover connections based on topic similarity."

#### 6.7 Runs history page

**File:** `src/app/dashboard/runs/page.tsx`

Per Frontend plan Section 2.5:
- `RunsTable` (timestamp, article count, strategies badges, rec count, status badge, duration)
- Running rows auto-update (poll every 5s)
- Empty state: "You haven't run any analyses yet."

#### 6.8 Export UI integration

Add export buttons to the article detail and recommendations pages:
- "Export CSV" button triggers `window.location = "/api/recommendations?format=csv&articleId=..."`
- "Export JSON" button triggers download with `download=true`
- Toast: "Exported [X] recommendations as [format]."

### Acceptance Criteria

- [ ] Recommendations display with severity badges, anchor text, source context
- [ ] Accept/dismiss updates recommendation status
- [ ] Bulk accept/dismiss works for up to 500 items
- [ ] Severity and status filters work
- [ ] CopySnippet generates correct HTML and copies to clipboard
- [ ] CSV export downloads with correct columns, BOM, and formula sanitization
- [ ] JSON export downloads with Content-Disposition header
- [ ] Analysis page shows pre-run summary with embedding estimate
- [ ] Analysis progress polls and shows completion
- [ ] Runs history shows all past runs with status
- [ ] [AAP-F2] Optimistic UI rollback works on PATCH failure
- [ ] [AAP-F3] CopySnippet escapes special characters in anchor text and URL
- [ ] [AAP-F3] CopySnippet fallback works in non-HTTPS contexts
- [ ] [AAP-B12] Concurrent update on same recommendation returns 409
- [ ] [AAP-F4] Cancel button stops in-progress analysis
- [ ] [AAP-O8] Dry run shows estimate before starting analysis

### Tests Required

**File:** `tests/lib/export/csv.test.ts`
- `it("outputs_correct_column_order")`
- `it("escapes_commas_and_quotes_in_titles")`
- `it("includes_utf8_bom_prefix")`
- `it("handles_empty_result_set")`

**File:** `tests/lib/export/sanitize.test.ts`
- `it("prefixes_equals_sign_with_quote")`
- `it("prefixes_plus_sign_with_quote")`
- `it("passes_through_normal_text")`
- `it("handles_empty_string")`

**File:** `tests/components/recommendations/CopySnippet.test.tsx`
- `it("generates_correct_html_from_anchor_and_url")`
- `it("updates_html_when_anchor_text_edited")`
- `it("escapes_special_characters_in_anchor_text")` [AAP-F3]
- `it("escapes_special_characters_in_target_url")` [AAP-F3]
- `it("falls_back_to_execCommand_when_clipboard_api_unavailable")` [AAP-F3]
- `it("calls_clipboard_api_on_copy")`

**File:** `tests/components/data/RecommendationCard.test.tsx`
- `it("renders_severity_badge_correctly")`
- `it("calls_accept_api_on_accept_click")`
- `it("calls_dismiss_api_on_dismiss_click")`

---

## Phase 7: Settings, Billing Placeholders & Polish

**Goal:** Build settings page, tier limit enforcement UI, responsive design pass, accessibility, and error handling polish.

**Prerequisites:** Phase 6 complete.

### Tasks

#### 7.1 Settings API

**File:** `src/app/api/settings/route.ts`

`GET /api/settings` -- Returns current strategy config for project.
`PUT /api/settings` -- Updates config.

**File:** `src/lib/validation/settingsSchemas.ts`

```typescript
export const settingsUpdateSchema = z.object({
  defaultApproaches: z.array(z.enum(["keyword", "semantic"])).optional(),
  similarityThreshold: z.number().min(0.5).max(0.95).optional(),
  fuzzyTolerance: z.number().min(0.6).max(1.0).optional(),
  maxLinksPerPage: z.number().int().min(1).max(50).optional(),
  embeddingProvider: z.enum(["openai", "cohere"]).optional(),
  forceReEmbed: z.boolean().optional(),
});
```

#### 7.2 Settings page

**File:** `src/app/dashboard/settings/page.tsx`

Per Frontend plan Section 2.7:
- `StrategySettingsSection`
  - Similarity threshold slider (0.5-0.95, default 0.75)
  - Fuzziness slider (0.6-1.0, default 0.8)
  - Max links per page input (1-50, default 10)
  - Default matching approach selector
- `AdvancedSection` (collapsible)
  - Force re-embed toggle with warning
  - Embedding provider selector. [AAP-B6] When switching providers, show warning: "Switching providers invalidates all cached embeddings. A full re-embed will be required on the next analysis run." Require explicit confirmation before saving.
- `AccountSection`
  - Plan badge (Free/Pro/Enterprise)
  - Usage stats (runs this month / limit, articles indexed / limit)
  - "Upgrade to Pro" button (placeholder for v1.0)
- Save button with toast confirmation

Per Client Success plan: show plan-gated features with lock icon and tooltip, not hidden.

#### 7.3 Tier limit UI integration

Per Client Success plan Section 3.4 -- upgrade prompts throughout the UI:
- Analysis page: if free tier, show lock icon on semantic matching with tooltip
- Analysis page: if runs exhausted, show message with reset date and upgrade CTA
- Settings: show current plan prominently with usage
- API: 403 responses include `upgrade_url`

Tone per Client Success: informative not punitive. Show value not restrictions.

#### 7.4 Responsive design pass

Per Frontend plan Section 6:
- Tables become card lists on mobile (below `md` breakpoint) via `renderMobileCard` prop [AAP-F6]. For recommendations: show severity, title, anchor text, and accept/dismiss buttons; collapse description and source context into expandable section.
- Sidebar: hidden below `md`, hamburger menu slide-over
- Bulk action bar fixed at bottom on mobile. [AAP-F6] Add bottom padding to compensate for fixed bar covering content.
- Forms stack vertically on mobile
- Minimum touch target: 44x44px

#### 7.5 Accessibility pass

- All interactive elements have `focus-visible:ring-2`
- Keyboard navigation for sidebar, tables, modals
- Screen reader labels on icon-only buttons
- Color contrast verification (WCAG AA)
- `aria-label` on severity badges, status badges

#### 7.6 Error boundary components

**File:** `src/app/error.tsx` (global error boundary)
**File:** `src/app/dashboard/error.tsx` (dashboard error boundary)

Per Client Success plan: "Something went wrong. Our team has been notified. Try refreshing the page."

#### 7.7 Loading states

**File:** `src/app/dashboard/articles/loading.tsx`
**File:** `src/app/dashboard/runs/loading.tsx`
**File:** `src/app/dashboard/analyze/loading.tsx`

Skeleton loaders per Frontend plan.

**File:** `src/app/dashboard/settings/loading.tsx` [AAP-F9]

Skeleton loader for settings page.

### Acceptance Criteria

- [ ] Settings save and persist across sessions
- [ ] [AAP-B6] Provider switch warning shown and confirmation required
- [ ] Plan limits visible in settings with usage stats
- [ ] Upgrade prompts appear at appropriate limit boundaries
- [ ] Layout is responsive at mobile/tablet/desktop
- [ ] Keyboard navigation works for all interactive elements
- [ ] Error boundaries catch and display errors gracefully
- [ ] Loading skeletons appear during data fetching

### Tests Required

**File:** `tests/components/forms/ThresholdSlider.test.tsx`
- `it("renders_with_default_value")`
- `it("updates_value_on_change")`
- `it("clamps_to_min_max_range")`

---

## Phase 8: Testing & Hardening

**Goal:** Integration tests, security review, load testing, monitoring setup.

**Prerequisites:** All feature phases (0-7) complete.

### Tasks

#### 8.1 Integration tests

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
- [AAP-B5] Project scoping prevents cross-tenant access on EVERY endpoint: articles, analyze, recommendations, runs, jobs, settings. Each test creates two users with separate projects and verifies user A cannot read/modify user B's data.

#### 8.1a [AAP-B9] Basic rate limiting

**File:** `src/lib/rate-limit.ts`

In-memory token bucket rate limiter (acceptable for single-region Vercel deployment). Per-user limits:
- `POST /api/articles`: 10 requests/minute
- `POST /api/analyze`: 5 requests/hour
- All other endpoints: 60 requests/minute

Returns 429 Too Many Requests with `Retry-After` header.

#### 8.2 Security review

Per DevOps plan Section 5:
- [ ] Verify no API keys in client bundle (`NEXT_PUBLIC_` prefix audit)
- [ ] Verify SSRF protection test cases (internal IPs, localhost, non-HTTP schemes)
- [ ] [AAP-B1] Verify SSRF protection at fetch time (DNS rebinding test)
- [ ] Verify CORS is not enabled on authenticated endpoints
- [ ] Verify rate limiting on auth endpoints
- [ ] [AAP-B9] Verify rate limiting on POST /api/articles and POST /api/analyze
- [ ] Run `npm audit` and resolve critical vulnerabilities
- [ ] Verify file upload size limits
- [ ] Verify HTML sanitization on crawled content
- [ ] [AAP-F3] Verify CopySnippet escapes special characters in generated HTML
- [ ] [AAP-F10] Verify cheerio is not in client bundle (bundle analyzer check)

#### 8.3 Sentry integration

**File:** `sentry.client.config.ts`
**File:** `sentry.server.config.ts`
**File:** `src/instrumentation.ts` (if needed)

Per DevOps plan: install `@sentry/nextjs`, configure DSN, enable source map uploads in CI.

#### 8.4 Analytics integration

In `src/app/layout.tsx`:
- Add Vercel `<Analytics />` component
- Add Vercel `<SpeedInsights />` component

#### 8.5 Load testing

Per DevOps plan Phase 2:
- [ ] 500-URL sitemap crawl completes within cron timeout
- [ ] 2,000-article analysis completes via chunked cron processing [AAP-O2] (no single-invocation 300s limit; verify total wall time is reasonable)
- [ ] 10,000-recommendation CSV export streams without timeout
- [ ] pgvector similarity queries complete in reasonable time at scale

#### 8.6 Seed data for development/testing

**File:** `prisma/seed.ts`

Per DBA plan Section 3:
- 1 test user (Pro plan)
- 1 project "Demo Blog"
- 15-20 realistic articles across 3-4 topic clusters
- 2 completed analysis runs
- 30-50 recommendations (mixed severity/status)
- 1 strategy config with defaults
- 2 ingestion jobs (1 completed, 1 partially failed)

**File:** `tests/helpers/factories.ts`

Factory functions for creating minimal test records without relying on seed data.

### Acceptance Criteria

- [ ] All integration tests pass
- [ ] Security checklist completed with no critical findings
- [ ] Sentry captures errors and uploads source maps
- [ ] Load tests complete within timeout limits
- [ ] Seed data populates all UI screens with realistic content

### Tests Required

All integration test files listed above plus:

**File:** `tests/integration/full-flow.test.ts`
- `it("completes_full_ingest_analyze_review_export_flow")`

---

## Phase 9: Launch Preparation

**Goal:** Production database, domain configuration, final QA, deployment.

**Prerequisites:** Phase 8 complete. All tests passing.

### Tasks

#### 9.1 Production infrastructure

Per DevOps plan:
- [ ] Railway PostgreSQL production instance provisioned
- [ ] pgvector extension enabled on production
- [ ] PgBouncer connection pooling configured
- [ ] Production environment variables set in Vercel (all variables from DevOps plan Section 1.5)
- [ ] Preview/staging database provisioned

#### 9.2 Domain configuration

Per DevOps plan Section 1.7:
- [ ] Domain added in Vercel project settings
- [ ] DNS configured (CNAME or A records)
- [ ] SSL certificate provisioned (automatic via Vercel)

#### 9.3 OAuth production setup

Per DevOps plan Section 1.6:
- [ ] Google OAuth production credentials with correct redirect URIs
- [ ] GitHub OAuth production app with correct callback URLs
- [ ] Resend production domain verified

#### 9.4 Monitoring setup

Per DevOps plan Section 4:
- [ ] Sentry production DSN configured
- [ ] OpenAI usage alerts set ($50, $100, $500)
- [ ] Railway connection and disk alerts at 80%
- [ ] Uptime monitor on `/api/health`
- [ ] [AAP-O5] External cron monitor (Cronitor or similar) on `/api/cron/crawl` and `/api/cron/analyze` -- alert if cron not invoked in 3 minutes

#### 9.5 Final QA checklist

- [ ] Full sign-up flow (Google, GitHub, magic link) on production domain
- [ ] Sitemap ingestion of a real site (20-50 pages)
- [ ] Keyword-only analysis on free tier
- [ ] Keyword+semantic analysis on Pro tier
- [ ] Recommendation accept/dismiss/bulk actions
- [ ] CSV export opens correctly in Excel and Google Sheets
- [ ] Copy-snippet copies valid HTML
- [ ] Settings save and affect subsequent analysis
- [ ] Tier limits enforced (create free-tier test account)
- [ ] Responsive layout at 375px, 768px, 1280px widths
- [ ] Dark mode across all pages
- [ ] Error states: invalid sitemap, zero recommendations, analysis failure

#### 9.6 Production deployment

- [ ] Merge release branch to `main`
- [ ] Tag `v1.0.0`
- [ ] Verify Vercel production deployment
- [ ] Verify migrations applied to production database
- [ ] Verify cron jobs running (check Vercel cron logs)
- [ ] Update CHANGELOG.md
- [ ] Update build_log.md

### Acceptance Criteria

- [ ] Production app accessible at domain
- [ ] Full user journey works end-to-end on production
- [ ] Monitoring alerts configured and tested
- [ ] `v1.0.0` tag created on `main` branch

---

## Appendix A: Error Messages Reference

Per Client Success plan Section 3. Every error follows: What happened + Why + What to do next.

### Ingestion Errors

| Scenario | Message |
|----------|---------|
| Sitemap 404 | "We couldn't find a sitemap at that URL. Most sites serve their sitemap at `/sitemap.xml`. Try entering `https://yoursite.com/sitemap.xml` directly." |
| Non-XML content | "That URL doesn't appear to be a sitemap. We found an HTML page instead. Check that the URL points to your sitemap.xml file, not your homepage." |
| Unreachable (timeout) | "We couldn't reach that URL. The server didn't respond within 10 seconds. Check that the URL is correct and the site is online." |
| robots.txt blocks | "Your site's robots.txt file blocks our crawler. You can add `User-agent: SEO-ilator` with `Allow: /` to your robots.txt to permit access." |
| Individual URL fail | "Failed to fetch [URL]: server returned [status code]. This page was skipped." |
| SSRF attempt | "That URL points to an internal network address. SEO-ilator can only crawl public websites." |
| noindex page | "Skipped: [URL] has a `noindex` directive. Pages marked noindex are excluded from crosslink recommendations." |
| Partial failure | "[X] of [Y] pages were crawled successfully. [Z] pages failed. View failed pages for details." |

### Analysis Errors

| Scenario | Message |
|----------|---------|
| Embedding rate limit | "Analysis is taking longer than expected because the embedding service is rate-limited. Your analysis is still running." |
| Embedding API down | "The embedding service is temporarily unavailable. Your analysis has been paused and will retry automatically." |
| Analysis timeout | "This analysis run took longer than expected and was stopped. Try running on a smaller subset or switch to keyword matching only." |
| Zero recommendations | "No crosslink opportunities were found. This can happen when articles cover very different topics, already link extensively, or the similarity threshold is too high." |
| Run in progress | "An analysis is already running for this project. Please wait for it to complete." |

### Auth Errors

| Scenario | Message |
|----------|---------|
| OAuth failure | "Sign-in with [provider] failed. This is usually temporary. Try again or use a different method." |
| Magic link expired | "This sign-in link has expired. Magic links are valid for 10 minutes. Request a new one below." |
| Session expired | "Your session has expired. Please sign in again." |

### Tier Limit Errors

| Scenario | Message |
|----------|---------|
| Article limit | "The free plan supports up to 50 articles per run. You have [X] articles. Upgrade to Pro for up to 2,000." |
| Run limit | "You've used all 3 analysis runs this month. Runs reset on [date]. Upgrade to Pro for unlimited runs." |
| Semantic locked | "Semantic matching is available on the Pro plan. Free includes keyword matching." |
| API locked | "API access requires a Pro plan." |

---

## Appendix B: Hardcoded Configuration Constants

Per SEO Expert plan Section 5:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `MIN_WORD_COUNT_FOR_SOURCE` | 300 | Articles below this are too thin for meaningful recommendations |
| `MIN_ANCHOR_WORDS` | 2 | Single-word anchors are too generic |
| `MAX_ANCHOR_WORDS` | 8 | Longer anchors are unnatural |
| `CHUNK_SIZE_TOKENS` | 500 | Balances embedding quality and cost |
| `CHUNK_OVERLAP_TOKENS` | 50 | Prevents losing context at chunk boundaries |
| `MAX_CANDIDATE_PAIRS_PER_ARTICLE` | 20 | Coarse filter limit for semantic similarity |
| `GENERIC_ANCHOR_BLOCKLIST` | ["click here", "read more", "this article", "learn more", "check out", "here", "link"] | SEO anti-patterns |

---

## Appendix C: User-Configurable Settings

Per SEO Expert plan Section 5:

| Setting | Type | Default | Range | Stored In |
|---------|------|---------|-------|-----------|
| `similarityThreshold` | Float | 0.75 | 0.5-0.95 | StrategyConfig.settings |
| `fuzzyMatchTolerance` | Float | 0.8 | 0.6-1.0 | StrategyConfig.settings |
| `maxLinksPerPage` | Int | 10 | 1-50 | StrategyConfig.settings |
| `matchingApproach` | Enum | "both" | keyword/semantic/both | Per-run in AnalysisRun.configuration |
| `crawlPreset` | Enum | "gentle" | gentle/standard/fast | Per-job in IngestionJob.preset |

---

## Appendix D: Success Metrics Instrumentation

Per Client Success plan Section 5. Track these events from day one:

### Activation Funnel

1. `signup.started` -- user clicks "Get started"
2. `signup.completed` -- account created (`authMethod`)
3. `ingestion.started` -- first URL/sitemap submitted
4. `ingestion.completed` -- first articles indexed
5. `analysis.started` -- first analysis triggered
6. `analysis.completed` -- first analysis finishes
7. `recommendation.first_viewed` -- user views recommendation detail
8. `recommendation.first_action` -- user accepts/dismisses first recommendation

### Quality Metrics

- `recommendation.accepted` (target: >40% acceptance rate)
- `recommendation.dismissed` (target: <30% dismissal-without-reason)
- `analysis.failed` (target: <2% failure rate)
- `recommendation.snippet_copied` (proxy for implementation)

### Engagement Metrics

- `user.first_run_completed` (`minutesSinceSignup`, target: <10 min)
- `analysis.reanalysis_triggered` (target: 30%+ within 7 days of adding articles)
- `export.downloaded` (format, count)
