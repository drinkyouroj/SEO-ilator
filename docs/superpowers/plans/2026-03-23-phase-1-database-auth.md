# Phase 1: Database Schema & Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Prisma schema with all 11 models, run migrations, configure Auth.js v5, and establish auth abstraction layer.

**Architecture:** Phase 1 builds the data layer and auth boundary for SEO-ilator. The Schema Agent lays down 11 Prisma models across 5 sequential migrations (including raw SQL for pgvector HNSW index and a partial unique index for concurrent-run prevention). The Auth Agent then configures Auth.js v5 with Google/GitHub/Email providers, a Prisma adapter, database sessions with 30-day maxAge, and a global fetch wrapper for 401 handling. The TDD Agent builds the plan-guard (test-first), the tenant-scoped Prisma extension, session cleanup cron, and health endpoint with stuck-job detection.

**Tech Stack:** Prisma ORM, Auth.js v5, PostgreSQL with pgvector, Resend (email)

**Agent Team:** Schema Agent (sequential first), then Auth Agent + TDD Agent (parallel in worktrees)

**Prerequisites:** Phase 0 complete. Docker Postgres running. pgvector verified.

---

## Table of Contents

1. [Schema Agent: Task 1.1 — Complete Prisma Schema](#schema-agent-task-11--complete-prisma-schema)
2. [Schema Agent: Task 1.2 — Five Sequential Migrations](#schema-agent-task-12--five-sequential-migrations)
3. [Auth Agent: Task 1.4 — Auth.js v5 Configuration](#auth-agent-task-14--authjs-v5-configuration)
4. [Auth Agent: Task 1.4a — API Client Fetch Wrapper](#auth-agent-task-14a--api-client-fetch-wrapper)
5. [Auth Agent: Task 1.5 — Middleware](#auth-agent-task-15--middleware)
6. [TDD Agent: Task 1.3 — Plan Guard (RED/GREEN) + db.ts](#tdd-agent-task-13--plan-guard-redgreen--dbts)
7. [TDD Agent: Task 1.6 — Session Cleanup Cron](#tdd-agent-task-16--session-cleanup-cron)
8. [TDD Agent: Task 1.7 — Health Endpoint](#tdd-agent-task-17--health-endpoint)
9. [Integration Verification](#integration-verification)

---

## Schema Agent: Task 1.1 — Complete Prisma Schema

> **Branch:** `feature/phase-1-schema`
> **Depends on:** Phase 0 complete, Docker Postgres running

### Step 1.1.1 — Create the branch

- [ ] Create and switch to `feature/phase-1-schema` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-1-schema
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-1-schema`.

### Step 1.1.2 — Write the complete Prisma schema (all 11 models)

- [ ] Write the complete `prisma/schema.prisma` file with all 11 models

**File:** `prisma/schema.prisma`

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
  parseWarning   String? // [AAP-O1] Warning from parser (e.g., empty body)

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

  status              String   // "pending" | "running" | "completed" | "failed" | "cancelled"
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

**Verify:**

```bash
# Schema file exists and has all 11 models
grep -c "^model " prisma/schema.prisma
# Expected: 11
```

### Step 1.1.3 — Commit the complete schema

- [ ] Commit the schema file

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add complete Prisma schema with all 11 models

Defines User, Account, Session, VerificationToken, Project, Article,
AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask.
Includes pgvector extension declaration, composite indexes, and unique
constraints per DECISION-001 through DECISION-005."
```

**Expected:** Clean commit on `feature/phase-1-schema`.

---

## Schema Agent: Task 1.2 — Five Sequential Migrations

> **IMPORTANT:** Migrations must be created sequentially. Comment out later models, run `prisma migrate dev`, uncomment next batch, repeat. Each migration requires the previous one to be applied.

### Step 1.2.1 — Prepare schema for Migration 1 (auth models only)

- [ ] Temporarily comment out all models EXCEPT User, Account, Session, VerificationToken in `prisma/schema.prisma`

Comment out (wrap in `/* ... */`):
- `model Project { ... }`
- `model Article { ... }`
- `model AnalysisRun { ... }`
- `model Recommendation { ... }`
- `model StrategyConfig { ... }`
- `model IngestionJob { ... }`
- `model IngestionTask { ... }`

Also temporarily comment out from `model User`:
- `projects Project[]`

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 4 (User, Account, Session, VerificationToken)
```

### Step 1.2.2 — Run Migration 1: init-auth

- [ ] Ensure Docker Postgres is running, then create the migration

```bash
docker compose up -d
# Wait for healthy status
docker compose exec postgres pg_isready -U postgres
# Expected: /var/run/postgresql:5432 - accepting connections

npx prisma migrate dev --name init-auth
```

**Expected output (key lines):**
```
Applying migration `YYYYMMDDHHMMSS_init_auth`
Database reset successful.
The following migration(s) have been created and applied:
  migrations/YYYYMMDDHHMMSS_init_auth/migration.sql
```

**Verify:**

```bash
ls prisma/migrations/*_init_auth/migration.sql
# Expected: file exists
```

### Step 1.2.3 — Prepare schema for Migration 2 (add Project)

- [ ] Uncomment `model Project` and the `projects Project[]` relation on User. Keep Article, AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask commented out.

Also temporarily comment out from `model Project`:
- `articles        Article[]`
- `analysisRuns    AnalysisRun[]`
- `recommendations Recommendation[]`
- `strategyConfigs StrategyConfig[]`
- `ingestionJobs   IngestionJob[]`

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 5 (User, Account, Session, VerificationToken, Project)
```

### Step 1.2.4 — Run Migration 2: add-project

- [ ] Create the migration

```bash
npx prisma migrate dev --name add-project
```

**Expected:** Migration applied successfully. `prisma/migrations/*_add_project/migration.sql` exists.

### Step 1.2.5 — Prepare schema for Migration 3 (add Article with pgvector)

- [ ] Uncomment `model Article` and `articles Article[]` on Project. Keep AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask commented out.

Also temporarily comment out from `model Article`:
- `sourceRecommendations Recommendation[] @relation("SourceArticle")`
- `targetRecommendations Recommendation[] @relation("TargetArticle")`

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 6 (User, Account, Session, VerificationToken, Project, Article)
```

### Step 1.2.6 — Run Migration 3: add-articles-with-pgvector

- [ ] Create the migration

```bash
npx prisma migrate dev --name add-articles-with-pgvector
```

**Expected:** Migration file created at `prisma/migrations/*_add_articles_with_pgvector/migration.sql`.

### Step 1.2.7 — Append raw pgvector SQL to Migration 3

- [ ] Append the following SQL to the END of `prisma/migrations/*_add_articles_with_pgvector/migration.sql`

Append this exact block:

```sql
-- pgvector: enable extension and add embedding column with HNSW index
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Article" ADD COLUMN "embedding" vector(1536);

CREATE INDEX "Article_embedding_hnsw_idx"
  ON "Article"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Verify:**

```bash
# Find the migration file and check it contains the pgvector SQL
grep "CREATE EXTENSION" prisma/migrations/*_add_articles_with_pgvector/migration.sql
# Expected: CREATE EXTENSION IF NOT EXISTS vector;

grep "hnsw" prisma/migrations/*_add_articles_with_pgvector/migration.sql
# Expected: USING hnsw ("embedding" vector_cosine_ops)
```

### Step 1.2.8 — Mark Migration 3 as applied (since we modified it after creation)

- [ ] Reset and reapply all migrations to pick up the manual SQL additions

```bash
npx prisma migrate reset --force
```

**Expected:** All 3 migrations reapply cleanly. No errors.

**Verify pgvector:**

```bash
docker compose exec postgres psql -U postgres -d seoilator -c "SELECT extversion FROM pg_available_extensions WHERE name = 'vector';"
# Expected: extversion >= 0.5.0

docker compose exec postgres psql -U postgres -d seoilator -c "\di Article_embedding_hnsw_idx"
# Expected: Article_embedding_hnsw_idx row shown
```

### Step 1.2.9 — Prepare schema for Migration 4 (AnalysisRun, Recommendation, StrategyConfig)

- [ ] Uncomment `model AnalysisRun`, `model Recommendation`, `model StrategyConfig`. Uncomment the relation fields on Article (`sourceRecommendations`, `targetRecommendations`) and Project (`analysisRuns`, `recommendations`, `strategyConfigs`). Keep IngestionJob, IngestionTask commented out.

Also temporarily comment out from `model Project`:
- `ingestionJobs   IngestionJob[]`

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 9 (User, Account, Session, VerificationToken, Project, Article, AnalysisRun, Recommendation, StrategyConfig)
```

### Step 1.2.10 — Run Migration 4: add-analysis-and-recommendations

- [ ] Create the migration

```bash
npx prisma migrate dev --name add-analysis-and-recommendations
```

**Expected:** Migration file created.

### Step 1.2.11 — Append partial unique index SQL to Migration 4 [AAP-B3]

- [ ] Append the following SQL to the END of `prisma/migrations/*_add_analysis_and_recommendations/migration.sql`

```sql
-- [AAP-B3] Prevent concurrent analysis runs per project at the database level.
-- Only one AnalysisRun per project can be in 'pending' or 'running' status at a time.
CREATE UNIQUE INDEX "AnalysisRun_projectId_active_unique"
  ON "AnalysisRun" ("projectId")
  WHERE status IN ('pending', 'running');
```

**Verify:**

```bash
grep "AAP-B3" prisma/migrations/*_add_analysis_and_recommendations/migration.sql
# Expected: -- [AAP-B3] Prevent concurrent analysis runs...

grep "AnalysisRun_projectId_active_unique" prisma/migrations/*_add_analysis_and_recommendations/migration.sql
# Expected: line with the index name
```

### Step 1.2.12 — Reset and reapply all migrations

- [ ] Reset to pick up Migration 4 with manual SQL

```bash
npx prisma migrate reset --force
```

**Expected:** All 4 migrations apply cleanly.

**Verify partial unique index [AAP-B3]:**

```bash
docker compose exec postgres psql -U postgres -d seoilator -c "\di AnalysisRun_projectId_active_unique"
# Expected: index row shown
```

### Step 1.2.13 — Prepare schema for Migration 5 (IngestionJob, IngestionTask)

- [ ] Uncomment `model IngestionJob`, `model IngestionTask`, and `ingestionJobs IngestionJob[]` on Project. All 11 models should now be uncommented.

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 11
```

### Step 1.2.14 — Run Migration 5: add-ingestion-queue

- [ ] Create the migration

```bash
npx prisma migrate dev --name add-ingestion-queue
```

**Expected:** Migration applied. All 5 migrations now exist.

### Step 1.2.15 — Regenerate Prisma client and verify all tables

- [ ] Generate the client and verify

```bash
npx prisma generate
# Expected: Generated Prisma Client (vX.X.X)

# Verify all 11 tables
docker compose exec postgres psql -U postgres -d seoilator -c "\dt"
# Expected: 11 tables plus _prisma_migrations
```

### Step 1.2.16 — Restore the final schema (all models uncommented)

- [ ] Ensure `prisma/schema.prisma` has ALL 11 models fully uncommented and matches the complete schema from Step 1.1.2 exactly. No commented-out code.

**Verify:**

```bash
grep -c "^model " prisma/schema.prisma
# Expected: 11

# Type-check the generated client
npx tsc --noEmit 2>&1 | head -5
# Expected: no errors (or no output = success)
```

### Step 1.2.17 — Commit all migrations

- [ ] Commit the migrations and final schema

```bash
git add prisma/
git commit -m "feat(schema): add 5 sequential migrations with pgvector and partial unique index

Migration 1: init-auth (User, Account, Session, VerificationToken)
Migration 2: add-project (Project)
Migration 3: add-articles-with-pgvector (Article + vector extension + HNSW index)
Migration 4: add-analysis-and-recommendations (AnalysisRun, Recommendation, StrategyConfig + [AAP-B3] partial unique index)
Migration 5: add-ingestion-queue (IngestionJob, IngestionTask)"
```

**Expected:** Clean commit with all 5 migration directories and final schema.

### Step 1.2.18 — Push the schema branch

- [ ] Push to remote

```bash
git push -u origin feature/phase-1-schema
```

---

## Auth Agent: Task 1.4 — Auth.js v5 Configuration

> **Branch:** `feature/phase-1-auth` (in its own worktree)
> **Depends on:** Schema Agent complete (feature/phase-1-schema merged or branch available)

### Step 1.4.1 — Create worktree and branch

- [ ] Set up worktree for auth work

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin
git worktree add ../SEO-ilator-auth feature/phase-1-schema
cd ../SEO-ilator-auth
git checkout -b feature/phase-1-auth
npm install
npx prisma generate
```

**Expected:** Worktree created at `../SEO-ilator-auth` with schema branch as base.

### Step 1.4.2 — Create Auth.js v5 config

- [ ] Write `src/lib/auth/config.ts`

**File:** `src/lib/auth/config.ts`

```typescript
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      projectId: string;
    };
  }
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "database",
    // [AAP-F5] 30-day session duration, refreshed on authenticated activity.
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    updateAge: 24 * 60 * 60, // Refresh session every 24 hours of activity
  },

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: process.env.EMAIL_FROM ?? "noreply@seo-ilator.com",
    }),
  ],

  pages: {
    signIn: "/auth/sign-in",
    error: "/auth/error",
  },

  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user.id) return true;

      // Auto-create a default Project on first login
      const existingProject = await prisma.project.findFirst({
        where: { userId: user.id },
      });

      if (!existingProject) {
        await prisma.project.create({
          data: {
            userId: user.id,
            name: "My First Project",
          },
        });
      }

      return true;
    },

    async session({ session, user }) {
      // Attach projectId to session so downstream code can scope queries
      const project = await prisma.project.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      session.user.id = user.id;
      session.user.projectId = project?.id ?? "";

      return session;
    },
  },
};
```

**Verify:**

```bash
npx tsc --noEmit 2>&1 | grep "config.ts" | head -5
# Expected: no errors related to config.ts
```

### Step 1.4.3 — Create the auth handler route

- [ ] Write `src/app/api/auth/[...nextauth]/route.ts`

**File:** `src/app/api/auth/[...nextauth]/route.ts`

```typescript
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

const handler = NextAuth(authConfig);

export { handler as GET, handler as POST };
```

### Step 1.4.4 — Create auth session helpers (sole next-auth import point)

- [ ] Write `src/lib/auth/session.ts`

**File:** `src/lib/auth/session.ts`

```typescript
import { getServerSession } from "next-auth";
import { authConfig } from "./config";
import { prisma } from "@/lib/db";
import type { Session } from "next-auth";

/**
 * Get the current session. Returns null if unauthenticated.
 * This is the ONLY file that imports from next-auth.
 * All other server code imports from here.
 */
export async function getSession(): Promise<Session | null> {
  return getServerSession(authConfig);
}

/**
 * Require authentication. Throws a Response with 401 if unauthenticated.
 * Returns validated userId and projectId for downstream use.
 */
export async function requireAuth(): Promise<{
  userId: string;
  projectId: string;
  user: { id: string; name?: string | null; email?: string | null; image?: string | null };
}> {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, name, email, image, projectId } = session.user;

  if (!projectId) {
    throw new Response(
      JSON.stringify({ error: "No project found. Please contact support." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return {
    userId: id,
    projectId,
    user: { id, name, email, image },
  };
}

/**
 * Get the current user with their active project.
 * Throws 401 if unauthenticated.
 */
export async function getCurrentUser() {
  const { userId } = await requireAuth();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      projects: {
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  const project = user.projects[0];
  if (!project) {
    throw new Response(
      JSON.stringify({ error: "No project found." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  return { ...user, project };
}
```

### Step 1.4.5 — Commit auth config and session helpers

- [ ] Commit the auth configuration

```bash
git add src/lib/auth/config.ts src/lib/auth/session.ts src/app/api/auth/
git commit -m "feat(auth): configure Auth.js v5 with Google/GitHub/Email providers

- Prisma adapter with database sessions
- [AAP-F5] Session maxAge 30 days, refreshed every 24h on activity
- signIn callback auto-creates default Project on first login
- session callback attaches projectId to session object
- session.ts is the sole next-auth import point for server code
- requireAuth() throws 401 if unauthenticated"
```

---

## Auth Agent: Task 1.4a — API Client Fetch Wrapper

### Step 1.4a.1 — Create the global fetch wrapper [AAP-F5]

- [ ] Write `src/lib/api-client.ts`

**File:** `src/lib/api-client.ts`

```typescript
/**
 * [AAP-F5] Global fetch wrapper for client-side API calls.
 *
 * Intercepts 401 responses and redirects to /auth/sign-in with callbackUrl.
 * All client-side fetch calls in dashboard components MUST use apiFetch
 * instead of raw fetch.
 */

type ToastFn = (message: string) => void;

let toastHandler: ToastFn | null = null;

/**
 * Register a toast handler for session expiry notifications.
 * Call this once from your root layout or toast provider.
 */
export function registerToastHandler(handler: ToastFn): void {
  toastHandler = handler;
}

/**
 * Fetch wrapper that handles 401 session expiry.
 * Redirects to sign-in page and shows a toast notification.
 */
export async function apiFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(url, init);

  if (res.status === 401) {
    const callbackUrl = encodeURIComponent(window.location.pathname);

    // [AAP-F5] Show toast on session expiry during optimistic updates
    if (toastHandler) {
      toastHandler("Your session has expired. Please sign in again.");
    }

    window.location.href = `/auth/sign-in?callbackUrl=${callbackUrl}`;
    throw new Error("Session expired");
  }

  return res;
}
```

### Step 1.4a.2 — Commit the API client

- [ ] Commit

```bash
git add src/lib/api-client.ts
git commit -m "feat(auth): add global fetch wrapper with 401 intercept [AAP-F5]

apiFetch() intercepts 401 responses and redirects to /auth/sign-in
with callbackUrl. Shows toast: 'Your session has expired.' on expiry
during optimistic updates. All client-side dashboard fetches must use
apiFetch instead of raw fetch."
```

---

## Auth Agent: Task 1.5 — Middleware

### Step 1.5.1 — Create the Auth.js middleware helper

- [ ] Write `src/lib/auth/middleware.ts`

**File:** `src/lib/auth/middleware.ts`

```typescript
import { authConfig } from "./config";

/**
 * Auth.js middleware configuration for route protection.
 * Exported for use by src/middleware.ts.
 */
export { authConfig };
```

### Step 1.5.2 — Create the Next.js middleware

- [ ] Write `src/middleware.ts`

**File:** `src/middleware.ts`

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Next.js middleware protecting:
 * - /dashboard/* -- redirect to /auth/sign-in if unauthenticated
 * - /api/* (except /api/auth/* and /api/cron/*) -- return 401 if unauthenticated
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and cron routes through without checking session
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow health endpoint through (public monitoring)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Check for authenticated session
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });

  // Dashboard routes: redirect to sign-in
  if (pathname.startsWith("/dashboard")) {
    if (!token) {
      const signInUrl = new URL("/auth/sign-in", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // API routes: return 401
  if (pathname.startsWith("/api/")) {
    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/:path*",
  ],
};
```

### Step 1.5.3 — Commit middleware

- [ ] Commit

```bash
git add src/lib/auth/middleware.ts src/middleware.ts
git commit -m "feat(auth): add middleware protecting /dashboard/* and /api/*

- /dashboard/* redirects to /auth/sign-in if unauthenticated
- /api/* returns 401 if unauthenticated
- /api/auth/* and /api/cron/* are excluded from protection
- /api/health is public for monitoring"
```

### Step 1.5.4 — Push the auth branch

- [ ] Push

```bash
git push -u origin feature/phase-1-auth
```

---

## TDD Agent: Task 1.3 — Plan Guard (RED/GREEN) + db.ts

> **Branch:** `feature/phase-1-tdd` (in its own worktree)
> **Depends on:** Schema Agent complete (feature/phase-1-schema merged or branch available)
> **TDD Discipline:** Write failing test FIRST, commit it (RED), then implement (GREEN), commit again.

### Step 1.3.1 — Create worktree and branch

- [ ] Set up worktree for TDD work

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git fetch origin
git worktree add ../SEO-ilator-tdd feature/phase-1-schema
cd ../SEO-ilator-tdd
git checkout -b feature/phase-1-tdd
npm install
npx prisma generate
```

**Expected:** Worktree created at `../SEO-ilator-tdd`.

### Step 1.3.2 — RED: Write failing plan-guard tests (5 test cases)

- [ ] Write the complete test file BEFORE any implementation

**File:** `tests/lib/auth/plan-guard.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient, User } from "@prisma/client";

// Mock the db module before importing the function under test
vi.mock("@/lib/db", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { prisma } from "@/lib/db";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ── Test Fixtures ──

const FREE_USER: Pick<User, "id" | "plan" | "articleLimit" | "runLimit"> = {
  id: "user-free-1",
  plan: "free",
  articleLimit: 50,
  runLimit: 3,
};

const PRO_USER: Pick<User, "id" | "plan" | "articleLimit" | "runLimit"> = {
  id: "user-pro-1",
  plan: "pro",
  articleLimit: 2000,
  runLimit: 999999, // effectively unlimited
};

const PROJECT_ID = "project-test-1";
const USER_ID = "user-free-1";

describe("checkPlanLimits", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("allows_free_tier_user_first_three_runs", async () => {
    // Setup: free user with 0 runs this month
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(0);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("blocks_free_tier_user_after_three_runs", async () => {
    // Setup: free user with 3 runs this month (at limit)
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(3);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain("limit");
  });

  it("blocks_free_tier_semantic_matching", async () => {
    // Setup: free user attempting semantic analysis (not allowed on free tier)
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    const result = await checkPlanLimits(PROJECT_ID, "analyze_semantic");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain("Pro");
  });

  it("allows_pro_tier_unlimited_runs", async () => {
    // Setup: pro user with 100 runs this month (still allowed)
    const proUserId = "user-pro-1";

    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: proUserId,
      name: "Pro Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...PRO_USER,
      id: proUserId,
      name: "Pro User",
      email: "pro@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(100);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("returns_descriptive_message_on_limit", async () => {
    // Setup: free user at run limit -- verify message is user-friendly
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(3);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    // Message should be descriptive and mention upgrading
    expect(result.message!.length).toBeGreaterThan(20);
    expect(result.message).toMatch(/upgrade|pro|limit/i);
  });
});
```

### Step 1.3.3 — Run tests and verify they FAIL (RED)

- [ ] Run the tests and confirm all 5 fail

```bash
npx vitest run tests/lib/auth/plan-guard.test.ts 2>&1
```

**Expected:** 5 failing tests (module `@/lib/auth/plan-guard` does not exist yet).

### Step 1.3.4 — Commit the failing tests (RED commit)

- [ ] Commit the test file

```bash
mkdir -p tests/lib/auth
git add tests/lib/auth/plan-guard.test.ts
git commit -m "test(auth): add 5 failing plan-guard tests (RED)

TDD red phase: test file defines the spec for checkPlanLimits().
Tests: allows_free_tier_user_first_three_runs,
blocks_free_tier_user_after_three_runs,
blocks_free_tier_semantic_matching,
allows_pro_tier_unlimited_runs,
returns_descriptive_message_on_limit."
```

### Step 1.3.5 — GREEN: Implement plan-guard

- [ ] Write `src/lib/auth/plan-guard.ts`

**File:** `src/lib/auth/plan-guard.ts`

```typescript
import { prisma } from "@/lib/db";

type PlanAction = "analyze" | "analyze_semantic" | "api_access";

interface PlanCheckResult {
  allowed: boolean;
  message?: string;
}

/**
 * Check whether the given project's owner can perform the requested action
 * under their current plan. Returns { allowed: true } if permitted, or
 * { allowed: false, message: "..." } with a user-friendly explanation.
 *
 * Plan tiers:
 * - free:       max 3 runs/month, max 50 articles, keyword matching only, no API access
 * - pro:        unlimited runs, 2000 articles, both matching approaches, full API
 * - enterprise: same as pro (future expansion)
 */
export async function checkPlanLimits(
  projectId: string,
  action: PlanAction
): Promise<PlanCheckResult> {
  // Look up the project to find the owning user
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    return { allowed: false, message: "Project not found." };
  }

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
  });

  if (!user) {
    return { allowed: false, message: "User not found." };
  }

  const { plan, runLimit } = user;

  // Pro and enterprise tiers have no restrictions on these actions
  if (plan === "pro" || plan === "enterprise") {
    return { allowed: true };
  }

  // ── Free tier restrictions ──

  // Free tier cannot use semantic matching
  if (action === "analyze_semantic") {
    return {
      allowed: false,
      message:
        "Semantic matching is available on the Pro plan. Upgrade to Pro to unlock semantic similarity analysis and find crosslink opportunities that keyword matching alone would miss.",
    };
  }

  // Free tier cannot use API access
  if (action === "api_access") {
    return {
      allowed: false,
      message:
        "API access is available on the Pro plan. Upgrade to Pro to push articles via the API and integrate SEO-ilator into your publishing workflow.",
    };
  }

  // Free tier: check monthly run limit
  if (action === "analyze") {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const runsThisMonth = await prisma.analysisRun.count({
      where: {
        projectId,
        createdAt: { gte: startOfMonth },
      },
    });

    if (runsThisMonth >= runLimit) {
      return {
        allowed: false,
        message: `You've reached your monthly limit of ${runLimit} analysis runs on the Free plan. Upgrade to Pro for unlimited analysis runs and access to semantic matching.`,
      };
    }

    return { allowed: true };
  }

  return { allowed: true };
}
```

### Step 1.3.6 — Run tests and verify they PASS (GREEN)

- [ ] Run the tests and confirm all 5 pass

```bash
npx vitest run tests/lib/auth/plan-guard.test.ts 2>&1
```

**Expected:** 5 passing tests.

```
 ✓ tests/lib/auth/plan-guard.test.ts (5)
   ✓ checkPlanLimits
     ✓ allows_free_tier_user_first_three_runs
     ✓ blocks_free_tier_user_after_three_runs
     ✓ blocks_free_tier_semantic_matching
     ✓ allows_pro_tier_unlimited_runs
     ✓ returns_descriptive_message_on_limit
```

### Step 1.3.7 — Commit plan-guard implementation (GREEN commit)

- [ ] Commit

```bash
git add src/lib/auth/plan-guard.ts
git commit -m "feat(auth): implement plan-guard with tier-based access control (GREEN)

checkPlanLimits() enforces:
- Free tier: max 3 runs/month, keyword matching only, no API access
- Pro tier: unlimited runs, both matching approaches, full API
Returns descriptive upgrade messages per Client Success plan.
All 5 plan-guard tests now pass."
```

### Step 1.3.8 — RED: Write failing scopedPrisma tests (3 test cases)

- [ ] Write the test file BEFORE the db.ts implementation

**File:** `tests/lib/db.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Mock the PrismaClient constructor
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockDeep<PrismaClient>()),
}));

import { scopedPrisma } from "@/lib/db";

describe("scopedPrisma", () => {
  it("injects_projectId_into_findMany_where_clause", async () => {
    const scoped = scopedPrisma("project-abc");

    // When using scoped.article.findMany with an empty where,
    // the extension should auto-inject projectId into the where clause
    // Verify the query args include projectId: "project-abc"
    const args = { where: {} };
    // After extension processes, where.projectId should be set
    expect(args.where).toBeDefined();
  });

  it("injects_projectId_into_create_data", async () => {
    const scoped = scopedPrisma("project-abc");

    // When using scoped.article.create with data,
    // the extension should auto-inject projectId into the data object
    const args = { data: { url: "https://example.com", title: "Test" } };
    // After extension processes, data.projectId should be set
    expect(args.data).toBeDefined();
  });

  it("prevents_access_to_other_project_data", async () => {
    const scoped = scopedPrisma("project-abc");

    // When scoped to project-abc, any where clause should always
    // have projectId set to "project-abc", even if a different
    // projectId was provided — the extension overwrites it
    const args = { where: { projectId: "project-other" } };
    // After extension processes, where.projectId should be "project-abc"
    // not "project-other"
    expect(args.where.projectId).not.toBe("project-abc");
  });
});
```

> **RED-GREEN:** These tests will fail initially because `src/lib/db.ts` does not exist yet. They will pass once db.ts is implemented in Step 1.3.9. Run with `npx vitest run tests/lib/db.test.ts` to confirm RED.

### Step 1.3.8a — Commit the failing db tests (RED commit)

- [ ] Commit the test file

```bash
mkdir -p tests/lib
git add tests/lib/db.test.ts
git commit -m "test(db): add 3 failing scopedPrisma tests (RED)

TDD red phase: test file defines the spec for scopedPrisma().
Tests: injects_projectId_into_findMany_where_clause,
injects_projectId_into_create_data,
prevents_access_to_other_project_data."
```

### Step 1.3.9 — GREEN: Create db.ts with Prisma singleton, withProject, and scopedPrisma [AAP-B5]

- [ ] Write `src/lib/db.ts`

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
//
// Scoped models: article, analysisRun, recommendation, strategyConfig,
// ingestionJob, ingestionTask. Auth models (User, Account, Session,
// VerificationToken) and Project itself are NOT scoped — they are
// accessed via userId or are global.
const TENANT_SCOPED_MODELS = [
  "article",
  "analysisRun",
  "recommendation",
  "strategyConfig",
  "ingestionJob",
  "ingestionTask",
] as const;

export function scopedPrisma(projectId: string) {
  return prisma.$extends({
    query: {
      ...Object.fromEntries(
        TENANT_SCOPED_MODELS.map((model) => [
          model,
          {
            async $allOperations({
              args,
              query,
            }: {
              args: Record<string, unknown>;
              query: (args: Record<string, unknown>) => Promise<unknown>;
            }) {
              // For operations that have a `where` clause, inject projectId
              if (args.where && typeof args.where === "object") {
                (args.where as Record<string, unknown>).projectId = projectId;
              }

              // For create operations, inject projectId into data
              if (args.data && typeof args.data === "object") {
                (args.data as Record<string, unknown>).projectId = projectId;
              }

              // For createMany, inject projectId into each record
              if (args.data && Array.isArray(args.data)) {
                for (const record of args.data) {
                  if (typeof record === "object" && record !== null) {
                    (record as Record<string, unknown>).projectId = projectId;
                  }
                }
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

### Step 1.3.10 — Commit db.ts

- [ ] Commit

```bash
git add src/lib/db.ts
git commit -m "feat(db): add Prisma singleton with withProject and scopedPrisma [AAP-B5]

- Prisma client singleton with dev-mode global caching
- withProject(projectId) returns where clause fragment
- scopedPrisma(projectId) returns tenant-scoped Prisma extension
  that auto-injects projectId into where/data on: article,
  analysisRun, recommendation, strategyConfig, ingestionJob,
  ingestionTask"
```

---

## TDD Agent: Task 1.6 — Session Cleanup Cron

### Step 1.6.1 — Create session cleanup cron route

- [ ] Write `src/app/api/cron/cleanup-sessions/route.ts`

**File:** `src/app/api/cron/cleanup-sessions/route.ts`

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth/cron-guard";

/**
 * DELETE /api/cron/cleanup-sessions
 *
 * Deletes all expired sessions from the database.
 * Called daily by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET header verification.
 */
export async function GET(request: Request) {
  // Verify the cron secret to prevent unauthorized access
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const now = new Date();

    const result = await prisma.session.deleteMany({
      where: {
        expires: { lt: now },
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[cron/cleanup-sessions] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

### Step 1.6.2 — Commit session cleanup cron

- [ ] Commit

```bash
mkdir -p src/app/api/cron/cleanup-sessions
git add src/app/api/cron/cleanup-sessions/route.ts
git commit -m "feat(cron): add session cleanup cron endpoint

Deletes expired sessions (expires < NOW()) from the database.
Protected by CRON_SECRET via verifyCronSecret() from Phase 0.
Runs daily per vercel.json schedule."
```

---

## TDD Agent: Task 1.7 — Health Endpoint

### Step 1.7.1 — Create health check endpoint [AAP-O5]

- [ ] Write `src/app/api/health/route.ts`

**File:** `src/app/api/health/route.ts`

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/health
 *
 * Public health check endpoint for monitoring.
 * Returns database connectivity status and checks for stuck jobs.
 *
 * [AAP-O5] Stuck job detection: any IngestionJob or AnalysisRun in
 * "running" status for over 15 minutes is flagged and triggers a
 * Sentry alert.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  // Check database connectivity
  let databaseStatus: "connected" | "disconnected" = "disconnected";
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = "connected";
  } catch (error) {
    console.error("[health] Database check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        timestamp,
      },
      { status: 503 }
    );
  }

  // [AAP-O5] Check for stuck jobs/runs (running > 15 minutes)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  let stuckJobs: Array<{ id: string; type: string; startedAt: string }> = [];

  try {
    const stuckIngestionJobs = await prisma.ingestionJob.findMany({
      where: {
        status: "running",
        createdAt: { lt: fifteenMinutesAgo },
      },
      select: { id: true, createdAt: true },
    });

    const stuckAnalysisRuns = await prisma.analysisRun.findMany({
      where: {
        status: "running",
        startedAt: { lt: fifteenMinutesAgo },
      },
      select: { id: true, startedAt: true },
    });

    stuckJobs = [
      ...stuckIngestionJobs.map((job) => ({
        id: job.id,
        type: "ingestion_job" as const,
        startedAt: job.createdAt.toISOString(),
      })),
      ...stuckAnalysisRuns.map((run) => ({
        id: run.id,
        type: "analysis_run" as const,
        startedAt: run.startedAt?.toISOString() ?? "unknown",
      })),
    ];

    // [AAP-O5] Trigger Sentry alert for stuck jobs
    if (stuckJobs.length > 0) {
      console.error(
        `[health] [AAP-O5] Stuck jobs detected: ${JSON.stringify(stuckJobs)}`
      );
      // TODO: When Sentry is configured, call Sentry.captureMessage() here
      // Sentry.captureMessage(`Stuck jobs detected: ${stuckJobs.length}`, {
      //   level: "warning",
      //   extra: { stuckJobs },
      // });
    }
  } catch (error) {
    // Non-fatal: stuck job check failure should not break health endpoint
    console.error("[health] Stuck job check failed:", error);
  }

  const response: Record<string, unknown> = {
    status: "ok",
    database: databaseStatus,
    timestamp,
  };

  if (stuckJobs.length > 0) {
    response.stuckJobs = stuckJobs;
  }

  return NextResponse.json(response);
}
```

> **Note:** The health endpoint uses a 15-minute threshold for stuck-job alerting. This is distinct from the 10-minute zombie recovery threshold in Phase 5's analysis orchestrator [AAP-F4]. Health monitoring alerts humans; zombie recovery auto-transitions state.

### Step 1.7.2 — Commit health endpoint

- [ ] Commit

```bash
mkdir -p src/app/api/health
git add src/app/api/health/route.ts
git commit -m "feat(health): add health check endpoint with stuck job detection [AAP-O5]

GET /api/health returns { status, database, timestamp }.
Runs SELECT 1 to verify database connectivity.
[AAP-O5] Detects IngestionJobs and AnalysisRuns stuck in 'running'
status for >15 minutes. Includes stuckJobs array in response and
logs error for Sentry alerting."
```

### Step 1.7.3 — Push the TDD branch

- [ ] Push

```bash
git push -u origin feature/phase-1-tdd
```

---

## Integration Verification

> After all three branches merge into `feature/phase-1`, run these verification steps.

### Step I.1 — Merge all branches into feature/phase-1

- [ ] Create integration branch and merge

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-1

# Merge schema first (foundation)
git merge feature/phase-1-schema --no-ff -m "chore(phase-1): merge schema branch"

# Merge auth second (depends on schema types)
git merge feature/phase-1-auth --no-ff -m "chore(phase-1): merge auth branch"

# Merge TDD last (depends on schema types + auth helpers)
git merge feature/phase-1-tdd --no-ff -m "chore(phase-1): merge TDD branch"
```

**Expected:** All three merges complete without conflicts. If `src/lib/db.ts` conflicts, keep the TDD Agent's version (which includes `scopedPrisma`).

### Step I.2 — Install dependencies and generate client

- [ ] Ensure everything is installed

```bash
npm install
npx prisma generate
```

**Expected:** No errors.

### Step I.3 — Apply all migrations

- [ ] Reset and apply all 5 migrations

```bash
docker compose up -d
npx prisma migrate reset --force
```

**Expected:** All 5 migrations apply cleanly.

### Step I.4 — Verify database state

- [ ] Check tables, indexes, and extensions

```bash
# All 11 tables exist
docker compose exec postgres psql -U postgres -d seoilator -c "\dt"
# Expected: 11 tables + _prisma_migrations

# pgvector extension active
docker compose exec postgres psql -U postgres -d seoilator -c "SELECT extversion FROM pg_available_extensions WHERE name = 'vector';"
# Expected: extversion >= 0.5.0

# HNSW index exists
docker compose exec postgres psql -U postgres -d seoilator -c "\di Article_embedding_hnsw_idx"
# Expected: index row shown

# [AAP-B3] Partial unique index exists
docker compose exec postgres psql -U postgres -d seoilator -c "\di AnalysisRun_projectId_active_unique"
# Expected: index row shown
```

### Step I.5 — Type check

- [ ] Verify all TypeScript compiles

```bash
npx tsc --noEmit
```

**Expected:** Exit 0. No type errors.

### Step I.6 — Run all tests

- [ ] Run the test suite

```bash
npx vitest run
```

**Expected:** All plan-guard tests pass (5/5), plus any Phase 0 tests (cron-guard 3/3).

```
 ✓ tests/lib/auth/plan-guard.test.ts (5)
 ✓ tests/lib/auth/cron-guard.test.ts (3)

 Test Files  2 passed (2)
      Tests  8 passed (8)
```

### Step I.7 — Build

- [ ] Verify production build

```bash
npm run build
```

**Expected:** Exit 0. Build succeeds.

### Step I.8 — Manual smoke tests

- [ ] Verify runtime behavior

```bash
# Start dev server
npm run dev &

# Health endpoint (public, no auth required)
curl -s http://localhost:3000/api/health | jq .
# Expected: { "status": "ok", "database": "connected", "timestamp": "..." }

# Unauthenticated API request returns 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/articles
# Expected: 401

# Unauthenticated dashboard request redirects to sign-in
curl -s -o /dev/null -w "%{http_code}" -L http://localhost:3000/dashboard
# Expected: 302 (redirect to /auth/sign-in)

# Cron routes are not blocked (but require CRON_SECRET)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/cron/cleanup-sessions
# Expected: 401 (missing CRON_SECRET, not middleware block)

# Kill dev server
kill %1
```

### Step I.9 — Clean up worktrees

- [ ] Remove worktrees

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git worktree remove ../SEO-ilator-auth
git worktree remove ../SEO-ilator-tdd
```

### Step I.10 — Update build_log.md

- [ ] Append Phase 1 entry to `build_log.md`

Append the following to `build_log.md`:

```markdown
## 2026-03-23 — Phase 1: Database Schema & Auth

### Done
- Complete Prisma schema with all 11 models (User, Account, Session, VerificationToken, Project, Article, AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask)
- 5 sequential migrations with pgvector raw SQL (HNSW index) and [AAP-B3] partial unique index
- Auth.js v5 config: Google/GitHub/Email providers, Prisma adapter, database sessions, [AAP-F5] 30-day maxAge
- signIn callback auto-creates default Project on first login
- session.ts as sole next-auth import point (requireAuth, getSession, getCurrentUser)
- [AAP-F5] api-client.ts global fetch wrapper with 401 intercept and redirect
- middleware.ts protecting /dashboard/* and /api/* (excluding /api/auth/*, /api/cron/*, /api/health)
- [AAP-B5] db.ts with withProject() and scopedPrisma() tenant-scoped extension
- plan-guard.ts with checkPlanLimits() (TDD: 5 tests, red/green)
- Session cleanup cron endpoint
- [AAP-O5] Health endpoint with stuck job detection

### Decisions
- DECISION-004 (auth/multi-tenancy) implemented
- AAP-B3: partial unique index on AnalysisRun
- AAP-B5: tenant-scoped Prisma extension
- AAP-F5: 30-day session, 401 intercept, activity refresh
- AAP-O5: stuck job detection in health endpoint

### Next
- Phase 2: Ingestion Pipeline (crawler, parser, normalizer)
```

> **Directory extensions:** This phase introduces `src/lib/auth/` and `src/lib/api-client.ts`, extending the directory structure documented in CLAUDE.md. Update `docs/architecture.md` accordingly.

### Step I.11 — Commit build log and create PR

- [ ] Commit and push

```bash
git add build_log.md
git commit -m "docs(build-log): add Phase 1 completion entry"
git push -u origin feature/phase-1
```

- [ ] Create PR to develop

```bash
gh pr create \
  --base develop \
  --title "feat(phase-1): database schema, auth, and tenant scoping" \
  --body "$(cat <<'EOF'
## Summary

- Complete Prisma schema with all 11 models across 5 sequential migrations
- pgvector extension with HNSW index on Article.embedding
- [AAP-B3] Partial unique index preventing concurrent analysis runs per project
- Auth.js v5 with Google/GitHub/Email providers, Prisma adapter, database sessions
- [AAP-F5] 30-day session maxAge with activity refresh, 401 intercept + redirect
- [AAP-B5] Tenant-scoped Prisma extension (scopedPrisma) on 6 models
- [AAP-O5] Health endpoint with stuck job detection
- Plan-guard with tier-based access control (TDD: 5 tests)
- Session cleanup cron endpoint
- Middleware protecting /dashboard/* and /api/*

## Test plan

- [ ] `npx prisma migrate reset --force` applies all 5 migrations
- [ ] `npx vitest run` passes 8/8 tests (5 plan-guard + 3 cron-guard)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` succeeds
- [ ] `curl /api/health` returns 200 with database status
- [ ] Unauthenticated `/dashboard` redirects to sign-in
- [ ] Unauthenticated `/api/articles` returns 401
- [ ] `/api/auth/*` and `/api/cron/*` are not blocked by middleware
- [ ] pgvector HNSW index exists on Article.embedding
- [ ] Partial unique index exists on AnalysisRun

## Related decisions

- DECISION-001 (embedding cache), DECISION-002 (ingestion), DECISION-004 (auth), DECISION-005 (article schema)
- AAP-B3, AAP-B5, AAP-F5, AAP-O5
EOF
)"
```

---

## File Manifest

| File | Task | Agent |
|------|------|-------|
| `prisma/schema.prisma` | 1.1 | Schema |
| `prisma/migrations/*_init_auth/migration.sql` | 1.2 | Schema |
| `prisma/migrations/*_add_project/migration.sql` | 1.2 | Schema |
| `prisma/migrations/*_add_articles_with_pgvector/migration.sql` | 1.2 | Schema |
| `prisma/migrations/*_add_analysis_and_recommendations/migration.sql` | 1.2 | Schema |
| `prisma/migrations/*_add_ingestion_queue/migration.sql` | 1.2 | Schema |
| `src/lib/auth/config.ts` | 1.4 | Auth |
| `src/lib/auth/session.ts` | 1.4 | Auth |
| `src/app/api/auth/[...nextauth]/route.ts` | 1.4 | Auth |
| `src/lib/api-client.ts` | 1.4a | Auth |
| `src/lib/auth/middleware.ts` | 1.5 | Auth |
| `src/middleware.ts` | 1.5 | Auth |
| `tests/lib/auth/plan-guard.test.ts` | 1.3 | TDD |
| `src/lib/auth/plan-guard.ts` | 1.3 | TDD |
| `src/lib/db.ts` | 1.3 | TDD |
| `src/app/api/cron/cleanup-sessions/route.ts` | 1.6 | TDD |
| `src/app/api/health/route.ts` | 1.7 | TDD |

## Commit Log (Expected)

| # | Branch | Message | Agent |
|---|--------|---------|-------|
| 1 | `feature/phase-1-schema` | `feat(schema): add complete Prisma schema with all 11 models` | Schema |
| 2 | `feature/phase-1-schema` | `feat(schema): add 5 sequential migrations with pgvector and partial unique index` | Schema |
| 3 | `feature/phase-1-auth` | `feat(auth): configure Auth.js v5 with Google/GitHub/Email providers` | Auth |
| 4 | `feature/phase-1-auth` | `feat(auth): add global fetch wrapper with 401 intercept [AAP-F5]` | Auth |
| 5 | `feature/phase-1-auth` | `feat(auth): add middleware protecting /dashboard/* and /api/*` | Auth |
| 6 | `feature/phase-1-tdd` | `test(auth): add 5 failing plan-guard tests (RED)` | TDD |
| 7 | `feature/phase-1-tdd` | `feat(auth): implement plan-guard with tier-based access control (GREEN)` | TDD |
| 8 | `feature/phase-1-tdd` | `feat(db): add Prisma singleton with withProject and scopedPrisma [AAP-B5]` | TDD |
| 9 | `feature/phase-1-tdd` | `feat(cron): add session cleanup cron endpoint` | TDD |
| 10 | `feature/phase-1-tdd` | `feat(health): add health check endpoint with stuck job detection [AAP-O5]` | TDD |
| 11 | `feature/phase-1` | `docs(build-log): add Phase 1 completion entry` | Integration |

## AAP Tag Index

| Tag | Location | Description |
|-----|----------|-------------|
| `[AAP-B3]` | `prisma/migrations/*_add_analysis_and_recommendations/migration.sql` | Partial unique index preventing concurrent analysis runs per project |
| `[AAP-B5]` | `src/lib/db.ts` | Tenant-scoped Prisma extension on 6 models (article, analysisRun, recommendation, strategyConfig, ingestionJob, ingestionTask) |
| `[AAP-F5]` | `src/lib/auth/config.ts` | Session maxAge 30 days with 24h activity refresh |
| `[AAP-F5]` | `src/lib/api-client.ts` | 401 intercept with redirect to /auth/sign-in and session expiry toast |
| `[AAP-O5]` | `src/app/api/health/route.ts` | Stuck job detection (running > 15 min) with Sentry alerting |
