# SEO-ilator

Extensible SEO engine that analyzes article indexes and recommends internal crosslinks. Built around a strategy registry pattern so additional SEO capabilities (meta tag optimization, keyword density analysis, content quality scoring) plug in through a standard interface.

## Stack

- **App:** TypeScript, Next.js (App Router)
- **Database:** PostgreSQL (Railway) via Prisma ORM
- **Hosting:** Vercel (app) + Railway (database)
- **Key deps:** cheerio, openai/cohere SDK, zod, tailwindcss

## Prerequisites

- Node 20+
- Docker & Docker Compose (for local PostgreSQL)
- A PostgreSQL connection string (or use `docker compose up -d`)

## Local Setup

```bash
# Install dependencies
npm install

# Copy environment template and fill in values
cp .env.example .env.local

# Start PostgreSQL via Docker
docker compose up -d

# Run Prisma migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

## Running Tests

```bash
# All tests
npx vitest

# Specific file
npx vitest tests/lib/strategies/crosslink.test.ts

# With coverage
npx vitest --coverage
```

## Key Docs

- [CLAUDE.md](./CLAUDE.md) — AI agent conventions and project guide
- [Architecture](./docs/architecture.md) — System overview and diagrams
- [Decision Log](./docs/decisions/) — Architectural decision records
