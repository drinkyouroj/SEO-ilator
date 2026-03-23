# SEO-ilator

Extensible SEO engine that analyzes article indexes and recommends internal crosslinks. Built around a strategy registry pattern so additional SEO capabilities (meta tag optimization, keyword density analysis, content quality scoring) plug in through a standard interface.

## Stack

- **App:** TypeScript, Next.js (App Router)
- **Database:** PostgreSQL with pgvector (Railway in production)
- **ORM:** Prisma
- **Hosting:** Vercel (app) + Railway (database)
- **Key deps:** cheerio, openai/cohere SDK, zod, tailwindcss

## Prerequisites

- **Node.js** 20+
- **Docker** & Docker Compose (for local PostgreSQL)
- **pgvector** >= 0.5.0 (included in the `pgvector/pgvector:pg16` Docker image)
- A PostgreSQL connection string (or use `docker compose up -d` for local dev)

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in values
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL, OPENAI_API_KEY, etc.

# 3. Start PostgreSQL with pgvector via Docker
docker compose up -d

# 4. Run Prisma migrations
npx prisma migrate dev

# 5. Generate Prisma client
npx prisma generate

# 6. Start dev server
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

## Running Tests

```bash
# All tests
npx vitest

# Specific file
npx vitest tests/lib/strategies/crosslink.test.ts

# With coverage
npx vitest --coverage

# Watch mode (local dev)
npx vitest --watch
```

## Database Environments

| Environment | Provider | pgvector | Notes |
|---|---|---|---|
| **Production** | Railway (PostgreSQL 16) | Pre-installed via Railway template | `DATABASE_URL` set in Vercel env vars |
| **Preview** | Railway preview database | Provisioned automatically per PR | Uses `DATABASE_URL` from Vercel preview env |
| **Local** | Docker (`pgvector/pgvector:pg16`) | Installed via `docker/init.sql` | `postgresql://postgres:postgres@localhost:5432/seoilator` |

### Preview Database Provisioning

Vercel preview deployments connect to isolated Railway preview databases. Each pull request gets its own database instance with migrations applied automatically via the CI pipeline. This ensures preview environments are fully functional without sharing state with production.

## CI/CD

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs on every push and PR to `main` and `develop`:

1. **Lint & Type Check** -- ESLint and TypeScript compiler
2. **Unit Tests** -- Vitest with coverage
3. **Production Build** -- Next.js build verification
4. **Migration Test** -- Prisma migrations against a live pgvector PostgreSQL service

## Docker

```bash
# Start local PostgreSQL with pgvector
docker compose up -d

# Rebuild after changes
docker compose up -d --build

# Tear down (data volumes preserved)
docker compose down
```

## Key Docs

- [CLAUDE.md](./CLAUDE.md) -- AI agent conventions and project guide
- [Architecture](./docs/architecture.md) -- System overview and diagrams
- [Decision Log](./docs/decisions/) -- Architectural decision records
- [Changelog](./CHANGELOG.md) -- Release history
