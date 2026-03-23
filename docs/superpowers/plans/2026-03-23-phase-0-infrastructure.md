# Phase 0: Infrastructure & Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the project scaffold, Docker environment, CI/CD pipeline, and environment configuration so that a developer can clone, install, and run SEO-ilator from scratch.

**Architecture:** A Next.js 14+ App Router project with TypeScript strict mode, Tailwind CSS for styling, Prisma ORM connecting to PostgreSQL with pgvector for embeddings, and Vitest for testing. The project uses a strategy registry pattern where SEO analysis plugins conform to a standard interface. Infrastructure includes Docker Compose for local PostgreSQL, GitHub Actions CI with 4 jobs, and Vercel deployment with cron configuration.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Prisma, PostgreSQL + pgvector, Vitest, Docker Compose, GitHub Actions, Vercel

**Agent Team:** Config Agent (sequential first), then DevOps Agent + TDD Agent (parallel in worktrees)

---

## Phase A: Config Agent (Sequential — Foundation)

> Config Agent runs first on `feature/phase-0-config`. All other agents branch from its output.

### Task 1: Initialize Next.js Project (0.1)

**Agent:** Config Agent
**Files:**
- Create: `src/app/layout.tsx` (via create-next-app)
- Create: `src/app/page.tsx` (via create-next-app)
- Create: `tsconfig.json` (via create-next-app, then verify strict)
- Create: `postcss.config.js` (via create-next-app)
- Create: `package.json` (via create-next-app)

- [ ] **Step 1: Create the Next.js project**
```bash
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --no-turbo
```

- [ ] **Step 2: Verify tsconfig.json has strict mode and path alias**
Open `tsconfig.json` and confirm it contains:
```json
{
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```
If `strict` is not `true`, edit `tsconfig.json` to set `"strict": true`.

- [ ] **Step 3: Verify the scaffold works**
Run: `npm run dev -- --port 3000 &` then `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` then kill the background process.
Expected: HTTP status `200`

- [ ] **Step 4: Verify lint passes**
Run: `npm run lint`
Expected: Exit code 0, no errors

- [ ] **Step 5: Commit**
```bash
git init
git checkout -b feature/phase-0-config
git add .
git commit -m "chore(init): scaffold Next.js project with TypeScript, Tailwind, App Router"
```

---

### Task 2: Install Dependencies (0.2)

**Agent:** Config Agent
**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production dependencies**
```bash
npm install prisma @prisma/client next-auth@5 @auth/prisma-adapter zod cheerio openai csv-stringify class-variance-authority
```

- [ ] **Step 2: Install dev dependencies**
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom msw vitest-mock-extended @types/node @next/bundle-analyzer tsx
```

- [ ] **Step 3: Verify install succeeded**
Run: `npm ls --depth=0`
Expected: All packages listed without `MISSING` or `ERR!` entries. Key packages visible: `prisma`, `@prisma/client`, `next-auth`, `zod`, `cheerio`, `openai`, `vitest`, `@next/bundle-analyzer`, `tsx`

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json
git commit -m "chore(deps): install all Phase 0 production and dev dependencies"
```

---

### Task 3: Create .env.example (0.3)

**Agent:** Config Agent
**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create the .env.example file**
Create `.env.example` with the following content:
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

- [ ] **Step 2: Verify all 16 env vars are present**
Run: `grep -c "^[A-Z_]*=" .env.example`
Expected: `16`

- [ ] **Step 3: Commit**
```bash
git add .env.example
git commit -m "chore(env): add .env.example with all 16 required environment variables"
```

---

### Task 4: Configure next.config.ts (0.7 + 0.15)

**Agent:** Config Agent
**Files:**
- Modify: `next.config.ts` (the ESM config file that create-next-app generates)

- [ ] **Step 1: Replace next.config with bundle analyzer and external packages**
Overwrite the existing `next.config.ts` (which create-next-app generates by default) with:
```typescript
import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "cheerio"],
};

const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default analyzer(nextConfig);
```

- [ ] **Step 2: Verify config loads without error**
Run: `npx next info`
Expected: Exit code 0, shows Next.js version and config info without errors.

- [ ] **Step 3: Commit**
```bash
git add next.config.ts
git commit -m "chore(config): configure next.config.ts with bundle analyzer and external packages"
```

---

### Task 5: Configure Tailwind (0.8)

**Agent:** Config Agent
**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Replace tailwind.config.ts with semantic color tokens**
Overwrite `tailwind.config.ts` with:
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2563eb",
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        destructive: "#dc2626",
        warning: "#f59e0b",
        success: "#16a34a",
        muted: "#9ca3af",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 2: Verify TypeScript accepts the config**
Run: `npx tsc --noEmit tailwind.config.ts --esModuleInterop --module nodenext --moduleResolution nodenext`
Expected: Exit code 0 (if this command fails due to isolated config, simply verify `npm run build` later)

- [ ] **Step 3: Commit**
```bash
git add tailwind.config.ts
git commit -m "chore(ui): configure Tailwind with semantic color tokens and dark mode"
```

---

### Task 6: Configure Vitest (0.9)

**Agent:** Config Agent
**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest.config.ts**
Create `vitest.config.ts` at the project root with:
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

- [ ] **Step 2: Create empty tests directory**
```bash
mkdir -p tests
```

- [ ] **Step 3: Verify vitest initializes cleanly**
Run: `npx vitest --run 2>&1`
Expected: Output contains "no test files found" or exits cleanly with 0 tests. No crash or config errors.

- [ ] **Step 4: Commit**
```bash
git add vitest.config.ts
git commit -m "chore(test): configure Vitest with jsdom, path aliases, and coverage"
```

---

### Task 7: Update package.json Scripts (0.11)

**Agent:** Config Agent
**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add all required scripts and prisma seed config**
Edit the `"scripts"` section and add `"prisma"` section in `package.json`. The final scripts block must contain:
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
Preserve any existing scripts from create-next-app that are not listed above. The key additions are: `vercel-build`, `migrate:deploy`, `test`, `test:coverage`, and the `prisma.seed` config.

- [ ] **Step 2: Verify scripts are registered**
Run: `node -e "const pkg = require('./package.json'); const s = pkg.scripts; console.log(['vercel-build','migrate:deploy','test','test:coverage'].every(k => s[k]) && pkg.prisma?.seed ? 'OK' : 'MISSING')"`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "chore(scripts): add vercel-build, migrate, test scripts and prisma seed config"
```

---

### Task 8: Stub Prisma Schema

**Agent:** Config Agent
**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Create prisma directory and stub schema**
```bash
mkdir -p prisma
```
Create `prisma/schema.prisma` with:
```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

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
```

- [ ] **Step 2: Create empty seed file placeholder**
Create `prisma/seed.ts` with:
```typescript
// Prisma seed file — populated in Phase 1
async function main() {
  console.log("Seed: no-op (Phase 0 stub)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Verify prisma generate succeeds**
Run: `npx prisma generate`
Expected: Exit code 0, output includes "Generated Prisma Client"

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/seed.ts
git commit -m "chore(prisma): add stub schema with PostgreSQL datasource and vector extension"
```

---

### Task 9: Final Config Agent Verification

**Agent:** Config Agent

- [ ] **Step 1: Run full verification suite**
```bash
npm install && npm run lint && npx tsc --noEmit && npx prisma generate && npm run build
```
Expected: All commands exit 0. Build completes successfully.

- [ ] **Step 2: Tag the Config Agent branch as ready**
```bash
git log --oneline
```
Expected: 8 commits visible on `feature/phase-0-config`:
1. `chore(init): scaffold Next.js project...`
2. `chore(deps): install all Phase 0...`
3. `chore(env): add .env.example...`
4. `chore(config): configure next.config.ts...`
5. `chore(ui): configure Tailwind...`
6. `chore(test): configure Vitest...`
7. `chore(scripts): add vercel-build...`
8. `chore(prisma): add stub schema...`

---

## Phase B: DevOps Agent + TDD Agent (Parallel in Worktrees)

> Both agents branch from the Config Agent's completed `feature/phase-0-config` and work in isolated git worktrees. They run in parallel.

---

## DevOps Agent

### Task 10: Create Docker Compose + Init SQL (0.4)

**Agent:** DevOps Agent
**Files:**
- Create: `docker-compose.yml`
- Create: `docker/init.sql`

- [ ] **Step 1: Create the feature branch in a worktree**
```bash
git worktree add ../SEO-ilator-devops feature/phase-0-config
cd ../SEO-ilator-devops
git checkout -b feature/phase-0-devops
```

- [ ] **Step 2: Create docker directory**
```bash
mkdir -p docker
```

- [ ] **Step 3: Create docker/init.sql**
Create `docker/init.sql` with:
```sql
-- Enable pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 4: Create docker-compose.yml**
Create `docker-compose.yml` with:
```yaml
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

- [ ] **Step 5: Verify Docker Compose config is valid**
Run: `docker compose config`
Expected: Valid YAML output showing the postgres service, pgdata volume, and port mapping. No errors.

- [ ] **Step 6: Commit**
```bash
git add docker-compose.yml docker/init.sql
git commit -m "chore(docker): add docker-compose.yml with pgvector PostgreSQL and init script"
```

---

### Task 11: Create vercel.json (0.5)

**Agent:** DevOps Agent
**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create vercel.json**
Create `vercel.json` with:
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

- [ ] **Step 2: Verify JSON is valid**
Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('VALID')"`
Expected: `VALID`

- [ ] **Step 3: Verify cron count and function count**
Run: `node -e "const v=JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('crons:'+v.crons.length+' functions:'+Object.keys(v.functions).length)"`
Expected: `crons:3 functions:5`

- [ ] **Step 4: Commit**
```bash
git add vercel.json
git commit -m "chore(vercel): add vercel.json with 3 cron jobs and 5 function duration configs"
```

---

### Task 12: Create CI Workflow (0.6 + 0.14)

**Agent:** DevOps Agent
**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow directory**
```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create .github/workflows/ci.yml**
Create `.github/workflows/ci.yml` with:
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
      - run: npx vitest --run --reporter=verbose --coverage

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

- [ ] **Step 3: Verify YAML syntax**
Run: `node -e "const yaml=require('yaml'); yaml.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('VALID')" 2>/dev/null || npx -y yaml-lint .github/workflows/ci.yml`
Expected: `VALID` or lint passes. If the `yaml` package is not installed, use: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('VALID')"`

- [ ] **Step 4: Verify 4 jobs are defined**
Run: `grep -c "runs-on:" .github/workflows/ci.yml`
Expected: `4`

- [ ] **Step 5: Commit**
```bash
git add .github/workflows/ci.yml
git commit -m "ci(github): add CI workflow with lint, test, build, and migration-test jobs"
```

---

### Task 13: Update .gitignore (0.10)

**Agent:** DevOps Agent
**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Verify and append missing entries to .gitignore**
Check the existing `.gitignore` (created by create-next-app) and append any missing entries. The final file must include at minimum:
```gitignore
# dependencies
/node_modules
/.pnp
.pnp.js
.yarn/install-state.gz

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# local env files
.env*.local
.env

# vercel
.vercel

# typescript
*.tsbuildinfo
next-env.d.ts

# prisma
prisma/generated/

# bundle analyzer
.next/analyze/
```
Only append lines that are not already present. Do not duplicate entries.

- [ ] **Step 2: Verify critical entries are present**
Run: `grep -c ".env" .gitignore && grep -c ".vercel" .gitignore && grep -c "node_modules" .gitignore`
Expected: Each grep returns at least `1`

- [ ] **Step 3: Commit**
```bash
git add .gitignore
git commit -m "chore(git): update .gitignore with Prisma, Vercel, and bundle analyzer entries"
```

---

### Task 14: Create README with pgvector + Preview DB Docs (0.12 + 0.13)

**Agent:** DevOps Agent
**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README.md with project documentation**
Overwrite `README.md` with:
```markdown
# SEO-ilator

Extensible SEO engine that analyzes article indexes and recommends internal crosslinks, with a plugin architecture for additional SEO strategies (meta tag optimization, keyword density analysis, content quality scoring).

## Prerequisites

- **Node.js** >= 20.x
- **Docker** and **Docker Compose** (for local PostgreSQL)
- **PostgreSQL** with **pgvector >= 0.5.0** (required for HNSW indexes on embedding vectors)

> **pgvector version requirement:** The production database (Railway PostgreSQL) must have pgvector >= 0.5.0 installed. Verify with:
> ```sql
> SELECT extversion FROM pg_available_extensions WHERE name = 'vector';
> ```
> HNSW index support was added in pgvector 0.5.0. Earlier versions only support IVFFlat.

## Local Setup

```bash
# 1. Clone the repository
git clone <repo-url> && cd SEO-ilator

# 2. Start PostgreSQL with pgvector
docker compose up -d

# 3. Install dependencies
npm install

# 4. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your actual values

# 5. Run Prisma migrations
npx prisma migrate dev

# 6. Start the dev server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Running Tests

```bash
# All tests
npx vitest

# With coverage
npx vitest --coverage

# Specific file
npx vitest tests/lib/auth/cron-guard.test.ts
```

## Database Environments

### Production
- `DATABASE_URL` points to the production Railway PostgreSQL instance.
- Migrations are deployed via `npx prisma migrate deploy` in CI or manually before release.

### Preview (Vercel Preview Deployments)
- A separate Railway PostgreSQL instance (or database branch) is provisioned for preview deployments.
- `DATABASE_URL` in Vercel preview environment points to this staging instance.
- The `vercel-build` script runs `prisma generate` only (no `migrate deploy`) to avoid accidental schema changes from preview branches.
- Migrations for preview must be applied manually or via a dedicated CI step.

### Local Development
- `docker compose up -d` starts a local PostgreSQL with pgvector.
- Default credentials: `postgres:postgres@localhost:5432/seoilator` (see `.env.example`).

## Key Documentation

- [CLAUDE.md](./CLAUDE.md) — AI agent instructions and project conventions
- [Architecture Overview](./docs/architecture.md) — System design and component diagram
- [Decision Records](./docs/decisions/) — ADRs for significant technical decisions
```

- [ ] **Step 2: Verify pgvector prerequisite is documented**
Run: `grep -c "pgvector >= 0.5.0" README.md`
Expected: `1` (or more)

- [ ] **Step 3: Verify preview DB section is documented**
Run: `grep -c "Preview" README.md`
Expected: At least `2` (heading + content)

- [ ] **Step 4: Commit**
```bash
git add README.md
git commit -m "docs(readme): add setup guide with pgvector prerequisite and preview DB provisioning"
```

---

### Task 15: DevOps Agent Final Verification

**Agent:** DevOps Agent

- [ ] **Step 1: Verify all DevOps files exist**
```bash
ls -la docker-compose.yml docker/init.sql vercel.json .github/workflows/ci.yml .gitignore README.md
```
Expected: All 6 files listed without errors.

- [ ] **Step 2: Verify commit log**
```bash
git log --oneline
```
Expected: 5 DevOps commits on top of the Config Agent commits:
1. `chore(docker): add docker-compose.yml...`
2. `chore(vercel): add vercel.json...`
3. `ci(github): add CI workflow...`
4. `chore(git): update .gitignore...`
5. `docs(readme): add setup guide...`

---

## TDD Agent

### Task 16: Cron Guard — RED Phase (0.16)

**Agent:** TDD Agent
**Files:**
- Create: `tests/lib/auth/cron-guard.test.ts`

- [ ] **Step 1: Create the feature branch in a worktree**
```bash
git worktree add ../SEO-ilator-tdd feature/phase-0-config
cd ../SEO-ilator-tdd
git checkout -b feature/phase-0-tdd
```

- [ ] **Step 2: Create the test directory structure**
```bash
mkdir -p tests/lib/auth
```

- [ ] **Step 3: Write the failing test file**
Create `tests/lib/auth/cron-guard.test.ts` with:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyCronSecret } from "@/lib/auth/cron-guard";

describe("verifyCronSecret", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-secret-value");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns_false_without_authorization_header", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: {},
    });

    const result = verifyCronSecret(request);

    expect(result).toBe(false);
  });

  it("returns_false_with_wrong_secret", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: {
        authorization: "Bearer wrong-secret-value",
      },
    });

    const result = verifyCronSecret(request);

    expect(result).toBe(false);
  });

  it("returns_true_with_correct_secret", () => {
    const request = new Request("https://example.com/api/cron/crawl", {
      headers: {
        authorization: "Bearer test-secret-value",
      },
    });

    const result = verifyCronSecret(request);

    expect(result).toBe(true);
  });

  it("returns_false_when_cron_secret_env_is_unset", () => {
    vi.unstubAllEnvs(); // Remove the CRON_SECRET stub set in beforeEach

    const request = new Request("https://example.com/api/cron/crawl", {
      headers: {
        authorization: "Bearer any-value",
      },
    });

    const result = verifyCronSecret(request);

    expect(result).toBe(false);
  });
});
```

- [ ] **Step 4: Verify tests FAIL (RED)**
Run: `npx vitest --run tests/lib/auth/cron-guard.test.ts 2>&1`
Expected: 4 tests fail. Output contains errors like `Cannot find module '@/lib/auth/cron-guard'` or similar import failure because the implementation file does not exist yet. This confirms the RED state.

- [ ] **Step 5: Commit RED tests**
```bash
git add tests/lib/auth/cron-guard.test.ts
git commit -m "test(auth): add failing tests for cron secret verification (RED)"
```

---

### Task 17: Cron Guard — GREEN Phase (0.16)

**Agent:** TDD Agent
**Files:**
- Create: `src/lib/auth/cron-guard.ts`

- [ ] **Step 1: Create the implementation directory**
```bash
mkdir -p src/lib/auth
```

- [ ] **Step 2: Write the cron-guard implementation**
Create `src/lib/auth/cron-guard.ts` with:
```typescript
/**
 * Verifies that an incoming request carries the correct cron secret
 * in the Authorization header. Uses timing-safe comparison to prevent
 * timing attacks on the secret value.
 *
 * Usage in cron route handlers:
 *   if (!verifyCronSecret(request)) {
 *     return new Response("Unauthorized", { status: 401 });
 *   }
 */
export function verifyCronSecret(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Length check before timing-safe comparison (different lengths
  // are already distinguishable by response time in most runtimes,
  // and crypto.subtle.timingSafeEqual throws on mismatched lengths)
  if (token.length !== secret.length) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);

  return crypto.subtle.timingSafeEqual(a, b);
}
```

- [ ] **Step 3: Verify all 3 tests PASS (GREEN)**
Run: `npx vitest --run tests/lib/auth/cron-guard.test.ts`
Expected: Output shows 4 tests passing:
```
 ✓ tests/lib/auth/cron-guard.test.ts (4)
   ✓ verifyCronSecret
     ✓ returns_false_without_authorization_header
     ✓ returns_false_with_wrong_secret
     ✓ returns_true_with_correct_secret
     ✓ returns_false_when_cron_secret_env_is_unset

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 4: Verify TypeScript compiles**
Run: `npx tsc --noEmit`
Expected: Exit code 0, no type errors.

- [ ] **Step 5: Commit GREEN implementation**
```bash
git add src/lib/auth/cron-guard.ts
git commit -m "feat(auth): implement cron secret verification with timing-safe comparison (GREEN)"
```

---

### Task 18: TDD Agent Final Verification

**Agent:** TDD Agent

- [ ] **Step 1: Run full test suite**
Run: `npx vitest --run`
Expected: 4/4 tests pass, 0 failures.

- [ ] **Step 2: Verify commit log**
```bash
git log --oneline
```
Expected: 2 TDD commits on top of the Config Agent commits:
1. `test(auth): add failing tests for cron secret verification (RED)`
2. `feat(auth): implement cron secret verification with timing-safe comparison (GREEN)`

---

## Phase C: Integration Merge

> Sequential merge of all three branches into a single `feature/phase-0` branch.

### Task 19: Merge All Branches

**Agent:** Any (orchestrator)

- [ ] **Step 1: Create the integration branch**
```bash
git checkout feature/phase-0-config
git checkout -b feature/phase-0
```

- [ ] **Step 2: Merge DevOps branch**
```bash
git merge feature/phase-0-devops --no-ff -m "chore(merge): integrate DevOps agent work into phase-0"
```
Expected: Clean merge. DevOps files are all new files with no overlap.

- [ ] **Step 3: Merge TDD branch**
```bash
git merge feature/phase-0-tdd --no-ff -m "chore(merge): integrate TDD agent work into phase-0"
```
Expected: Clean merge. TDD files are all new files with no overlap.

- [ ] **Step 4: Remove worktrees**
```bash
git worktree remove ../SEO-ilator-devops
git worktree remove ../SEO-ilator-tdd
```

---

### Task 20: Integration Verification

**Agent:** Any (orchestrator)

- [ ] **Step 1: Install and verify**
```bash
npm install
```
Expected: Exit code 0

- [ ] **Step 2: Lint**
```bash
npm run lint
```
Expected: Exit code 0

- [ ] **Step 3: Type check**
```bash
npx tsc --noEmit
```
Expected: Exit code 0

- [ ] **Step 4: Run all tests**
```bash
npx vitest --run
```
Expected: 4/4 tests pass (cron-guard)

- [ ] **Step 5: Build**
```bash
npm run build
```
Expected: Exit code 0, build completes successfully

- [ ] **Step 6: Validate Docker Compose**
```bash
docker compose config
```
Expected: Valid YAML output

- [ ] **Step 7: Verify all acceptance criteria**
```bash
# Count env vars
grep -c "^[A-Z_]*=" .env.example
# Expected: 16

# Count cron jobs
node -e "console.log(JSON.parse(require('fs').readFileSync('vercel.json','utf8')).crons.length)"
# Expected: 3

# Count function configs
node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('vercel.json','utf8')).functions).length)"
# Expected: 5

# Count CI jobs
grep -c "runs-on:" .github/workflows/ci.yml
# Expected: 4

# Verify pgvector docs
grep -c "pgvector >= 0.5.0" README.md
# Expected: >= 1

# Verify preview DB docs
grep -c "Preview" README.md
# Expected: >= 2

# Verify bundle analyzer
grep -c "ANALYZE" next.config.ts
# Expected: 1

# Verify timing-safe comparison
grep -c "timingSafeEqual" src/lib/auth/cron-guard.ts
# Expected: 1
```

- [ ] **Step 8: Final commit log review**
```bash
git log --oneline --graph
```
Expected: Config Agent commits at base, with two merge commits bringing in DevOps and TDD work.

---

## Summary Checklist

| # | Task | Agent | Commits |
|---|------|-------|---------|
| 1 | Initialize Next.js project (0.1) | Config | 1 |
| 2 | Install dependencies (0.2) | Config | 1 |
| 3 | Create .env.example (0.3) | Config | 1 |
| 4 | Configure next.config.ts (0.7 + 0.15) | Config | 1 |
| 5 | Configure Tailwind (0.8) | Config | 1 |
| 6 | Configure Vitest (0.9) | Config | 1 |
| 7 | Update package.json scripts (0.11) | Config | 1 |
| 8 | Stub Prisma schema | Config | 1 |
| 9 | Config verification | Config | 0 |
| 10 | Docker Compose + init.sql (0.4) | DevOps | 1 |
| 11 | vercel.json (0.5) | DevOps | 1 |
| 12 | CI workflow (0.6 + 0.14) | DevOps | 1 |
| 13 | .gitignore (0.10) | DevOps | 1 |
| 14 | README pgvector + preview DB (0.12 + 0.13) | DevOps | 1 |
| 15 | DevOps verification | DevOps | 0 |
| 16 | Cron guard RED tests (0.16) | TDD | 1 |
| 17 | Cron guard GREEN impl (0.16) | TDD | 1 |
| 18 | TDD verification | TDD | 0 |
| 19 | Merge all branches | Orchestrator | 2 |
| 20 | Integration verification | Orchestrator | 0 |

**Total commits:** 15 (8 Config + 5 DevOps + 2 TDD) + 2 merge commits = 17
