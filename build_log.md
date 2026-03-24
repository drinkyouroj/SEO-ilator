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

## 2026-03-23 — Phase 2: Dashboard Shell & Layout

### Done
- AppShell, Sidebar, Header, UserMenu layout components
- DataTable with renderMobileCard prop [AAP-F6]
- Shared feedback components: ProgressBar, Spinner, Toast, ErrorBanner, SkeletonLoader
- Auth pages: sign-in, verify-request, error
- ConfirmDialog form component
- Pagination, SeverityBadge, StatusBadge data display components

### Next
- Phase 3: Ingestion Pipeline

## 2026-03-23 — Phase 3: Ingestion Pipeline

### Done
- Prisma migration: retryAfter field + composite index on IngestionTask
- HTML/Markdown parser (cheerio + marked) with metadata extraction and empty-body detection [AAP-O1]
- Article normalizer with SHA-256 body/title hashing
- SSRF guard with DNS resolution and private IP rejection [AAP-B1]
- robots.txt parser and per-domain cache [DECISION-002]
- Crawler with redirect chain validation and SSRF checks on each hop [AAP-B1]
- Database-backed queue: createJob, cancelJob, claimTasks (CAS), failTask (classified retry), recoverZombies (10-min threshold), finalizeJob [AAP-B2, AAP-F9]
- Sitemap parser with depth limit (2), size limit (50MB), URL cap (10k), dedup [AAP-O10]
- API: POST /api/articles — sitemap/URL-list ingestion with hybrid sync/async routing
- API: POST /api/articles/upload — file upload (HTML/MD/JSON) with size limits [AAP-F7]
- API: POST /api/articles/push — API push with existingLinks extraction [AAP-O7]
- API: GET /api/articles/[id] — article detail
- API: DELETE /api/articles/[id] — with active analysis check [AAP-B10]
- API: GET /api/jobs/[id] — job status with cursor-based task pagination
- API: POST /api/jobs/[id]/cancel — job cancellation [AAP-F9]
- Cron worker: /api/cron/crawl with zombie recovery and on-demand trigger
- 89 tests passing (13 test files), 0 type errors, 0 lint errors

### Decisions
- v1.0 uses sequential crawling (concurrency=1 for all presets); deviation from DECISION-002 documented
- File uploads use synthetic URL scheme: upload://<filename>
- On-demand cron trigger via Next.js after() with daily cron as safety net
- Crawler separates fetchRobotsTxt() from crawlUrl() for clean testing

### Next
- Phase 4: Embedding Provider & Cache
