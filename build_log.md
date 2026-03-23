# Build Log — SEO-ilator

> Append-only. Add a new entry per session that makes meaningful changes.

---

## 2026-03-23 — Project scaffolding and CLAUDE.md

### Done
- Generated CLAUDE.md with full project conventions
- Scaffolded companion docs (build_log.md, CHANGELOG.md, README.md, docs/)
- Created Claude Code hooks to block direct pushes to main/develop

### Decisions
- Stack: TypeScript + Next.js + Prisma + PostgreSQL (Vercel/Railway)
- Architecture: Strategy registry pattern for extensible SEO plugins
- Crosslink matching: keyword/phrase + semantic similarity, configurable per-run

### Next
- Initialize Next.js project with TypeScript
- Set up Prisma schema and initial migration
- Implement SEOStrategy interface and StrategyRegistry
- Build crosslink strategy (first plugin)

## 2026-03-23 — Phase 0: Infrastructure & Foundation

### Done
- Next.js 16 scaffold with TypeScript strict, Tailwind v4, App Router
- Docker Compose with pgvector/pgvector:pg16
- GitHub Actions CI (4 jobs: lint, test, build, migration-test)
- Vercel config (3 crons, 5 function durations)
- Vitest with jsdom, path aliases, coverage
- Prisma stub schema with vector extension
- Cron secret verification with timing-safe comparison (TDD: 6 tests)
- Bundle analyzer with ANALYZE=true toggle

### Decisions
- Prisma v7 adaptation: datasource URL in prisma.config.ts (not schema)
- Tailwind v4 adaptation: @theme inline tokens in globals.css

### Next
- Phase 1: Database Schema & Auth

## 2026-03-23 — Phase 1: Database Schema & Auth

### Done
- Complete Prisma schema with all 11 models
- 5 sequential migrations with pgvector raw SQL (HNSW index) and [AAP-B3] partial unique index
- pgvector-setup.ts post-migration script (Prisma v7 workaround for vector type SQL)
- Auth.js v5 config: Google/GitHub/Email providers, Prisma adapter, database sessions
- [AAP-F5] 30-day session maxAge with activity refresh, 401 intercept + redirect
- signIn callback auto-creates default Project on first login
- session.ts as sole next-auth import point (requireAuth, getSession, getCurrentUser)
- [AAP-B5] db.ts with withProject() and scopedPrisma() tenant-scoped extension
- Lazy PrismaClient via Proxy (prevents build-time initialization errors)
- plan-guard.ts with checkPlanLimits() (TDD: 5 tests, red/green)
- Session cleanup cron endpoint
- [AAP-O5] Health endpoint with stuck job detection (15-min threshold)

### Decisions
- Prisma v7 silently skips vector type SQL in migrations — workaround: pgvector-setup.ts
- Auth.js v5 uses NextAuth(config) pattern (not v4's getServerSession)
- PrismaClient must be lazy (Proxy) to prevent build-time errors

### Next
- Phase 2: Dashboard Shell & Layout
