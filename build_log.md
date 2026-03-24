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

## 2026-03-23 — Phase 4: Embedding Provider & Cache

### Done
- EmbeddingProvider interface with modelId, dimensions, batchSize, embed()
- OpenAI adapter: text-embedding-3-small, 1536 dims, batch 2048 (SDK-based)
- Cohere adapter: embed-english-v3.0, 1024 dims, batch 96 (direct fetch, no SDK)
- Provider factory: StrategyConfig table lookup → env var fallback → default OpenAI
- PROVIDER_DIMENSIONS map + STORAGE_DIMENSIONS constant
- Cache check: defensive bodyHash + titleHash + embeddingModel + embedding presence [DECISION-001]
- Batch processor: cache split, empty-body filter, chunked embedding, zero-padding to 1536 [AAP-B6]
- pgvector similarity: cosine distance with ef_search=100, threshold in SQL WHERE, SET LOCAL in separate statement
- Atomic provider switching: clear embeddings + update config + REINDEX CONCURRENTLY [AAP-B6]
- Embedding invalidation in all 4 ingestion routes (cron, articles, upload, push)
- 24 new tests (cache 6, OpenAI 3, Cohere 3, batch 6, similarity 4, switch 2)

### Decisions
- Cohere uses direct fetch (no SDK) — single endpoint doesn't justify a dependency
- Provider config is per-project via StrategyConfig, with EMBEDDING_PROVIDER env fallback
- Cache check includes defensive hash comparison per DECISION-001 (defense in depth)
- Blind-upsert routes use unconditional embedding invalidation; hash-comparing routes invalidate conditionally
- SET LOCAL for ef_search must be in separate $executeRaw inside $transaction (PostgreSQL rejects multi-statement prepared statements)

### Next
- Phase 5: Crosslink Strategy & Analysis

## 2026-03-24 — Phase 5: Crosslink Strategy & Analysis

### Done
- SEOStrategy interface with ArticleSummary (no body text) [AAP-B7] and loadArticleBodies callback
- StrategyRegistry: register, unregister, getStrategy, analyzeWithAll
- CrosslinkStrategy: keyword matching (exact + Dice fuzzy), semantic matching (pgvector findSimilarArticles)
- 12 quality safeguards: self-link, existing link, noindex, error pages, max links, generic anchors, min/max anchor length, DOM-aware zones, min source words, min distinctive words
- Title prefix stripping and distinctive word coverage [AAP-O6]
- Conservative defaults for null existingLinks (assume 5) [AAP-O7]
- XSS sanitization on anchor text derived from crawled article titles
- Dedup-ranker: merge keyword+semantic matches with +0.15 confidence boost, per-page cap
- Re-analysis scope: preserve accepted, skip dismissed if unchanged, supersede pending [AAP-B4]
- Analysis orchestrator: chunked processing with lastHeartbeatAt liveness signal, embedding processing, FK violation handling [AAP-B7/B10]
- POST /api/analyze: dryRun mode for cost estimation [AAP-O8], 202 Accepted, plan limit checks, P2002 → 409
- Analysis cron worker: zombie recovery with lastHeartbeatAt (10 min threshold) [AAP-F4], FOR UPDATE SKIP LOCKED
- Runs API: list, detail, cancel endpoints [AAP-F4]
- Schema migration: lastHeartbeatAt field + AAP-B3 partial unique index on AnalysisRun
- 31 new tests (crosslink 17, registry 2, dedup 4, re-analysis 5, orchestrator 3)

### Decisions
- Crosslink strategy combines keyword and semantic in one class (not separate strategies)
- Semantic matching skipped when source article has no embedding, threshold 0.751 for strict > 0.75
- lastHeartbeatAt prevents zombie recovery from killing legitimate long-running analyses
- AAP-B3 partial unique index prevents concurrent active analysis runs at database level
- Anchor text sanitized against XSS from crawled article titles
- On-demand cron trigger via after() — same pattern as Phase 3 crawl

### Next
- Phase 6: Recommendations UI & Export

## 2026-03-24 — Phase 6: Recommendations UI & Export

### Done
- Zod validation schemas for recommendation update, bulk update, and filter params
- Cell sanitizer for formula injection prevention (=, +, -, @ prefixed with ') [DECISION-003]
- CSV serializer: sync with UTF-8 BOM, formula sanitization, correct column order [DECISION-003]
- JSON serializer with Content-Disposition for download
- GET /api/recommendations: paginated list with severity/status/run/article filters + CSV/JSON export + 10K count check
- PATCH /api/recommendations/[id]: accept/dismiss with optimistic locking via updatedAt [AAP-B12]
- PATCH /api/recommendations/bulk: bulk status update (max 500) with tenant isolation [AAP-B12]
- CopySnippet: editable anchor text, HTML escaping, clipboard API with execCommand fallback [AAP-F3]
- RecommendationCard: severity badge, accept/dismiss callbacks, CopySnippet integration
- Article detail page: recommendations section with filters, bulk actions, optimistic UI [AAP-F2]
- Analysis page: dryRun pre-summary [AAP-O8], progress polling with exponential backoff [AAP-F1], cancel [AAP-F4]
- Runs history page: auto-updating running rows, pagination, empty state
- 19 new tests (sanitize 6, CSV 4, CopySnippet 6, RecommendationCard 3), 172 total

### Decisions
- CSV uses csv-stringify/sync — 10K count check provides the safety boundary per DECISION-003
- Optimistic locking uses updatedAt comparison via updateMany (not findFirst + update TOCTOU)
- RecommendationCard uses callback-prop interface (parent handles PATCH + rollback per AAP-F2)
- Analysis polling backoff: 5s → 10s → 20s → 30s cap, pause on tab hidden

### Next
- Phase 7: Settings, Polish

## 2026-03-24 — Phase 7: Settings, Polish

### Done
- Settings validation schema (settingsUpdateSchema) with constraints for all strategy parameters
- Settings API (GET/PUT) with zod validation, default settings fallback, AAP-B6 provider switch confirmation
- ThresholdSlider component with clamping, ARIA attributes, disabled state
- Settings page: StrategySettingsSection (sliders, max links, approach checkboxes), AdvancedSection (provider switch with confirmation dialog), AccountSection (plan badge, usage stats, upgrade CTA)
- Tier limit UI: lock icon placeholder, runs exhausted message, upgrade_url in 403 responses
- Global and dashboard error boundaries (error.tsx)
- Loading skeletons for articles, runs, analyze, settings pages [AAP-F9]
- Responsive touch targets (min-h-[44px]) on all interactive elements [AAP-F6]
- Accessibility: focus-visible:ring-2 on all buttons/links, aria-labels on icon-only buttons, aria-current on active nav, aria-label on severity/status badges
- 22 new tests (settings schema 7, settings API 6, ThresholdSlider 3, responsive 3, accessibility 3), 230 total

### Decisions
- Settings use StrategyConfig model with JSON settings field (per-project, per-strategy)
- Provider switch requires forceReEmbed confirmation (clears article embeddings via raw SQL)
- Sidebar already had mobile slide-over from Phase 2; Phase 7 added touch targets and ARIA
- Error boundaries use Client Success messaging pattern

### Next
- Phase 8: Testing & Hardening

## 2026-03-24 — Phase 8: Testing & Hardening

### Done
- In-memory token bucket rate limiter [AAP-B9]: POST /api/articles 10/min, POST /api/analyze 5/hr, default 60/min
- Rate limiter wired into POST /api/articles and POST /api/analyze routes
- Integration tests: articles CRUD (6), analyze E2E (4), recommendations filters (4), cron crawl (4), auth cross-tenant [AAP-B5] (5), full flow (3) — 26 new tests
- Security review v1.0 DECISION doc: 10-item checklist, 8 PASS, 1 FAIL (rate limiter now wired), 1 deferred (npm audit)
- Sentry client/server config with DSN gating and source map support
- Next.js instrumentation hook for server-side Sentry
- Vercel Analytics and SpeedInsights in root layout
- Error boundaries now report to Sentry via dynamic import
- Test factory functions: createTestUser, createTestProject, createTestArticle, createTestAnalysisRun, createTestRecommendation
- Development seed data: 1 user, 1 project, 15 articles, 2 runs, 30 recommendations, 1 strategy config, 1 job
- 276 total tests passing (33 new in this phase)

### Decisions
- Rate limiter uses in-memory token bucket (acceptable for single-region Vercel); Redis-backed (@upstash/ratelimit) needed for multi-region
- Integration tests use mock-based approach (vi.mock for Prisma/auth) rather than live database
- Sentry DSN gated via NEXT_PUBLIC_SENTRY_DSN env var (disabled if not set)
- Security review identified IPv6 SSRF bypass gap (documented, low priority for v1.0)

### Next
- Phase 9: Deployment & Launch

## 2026-03-24 — Phase 9: Launch Preparation & v1.0.0

### Done
- Release branch `release/v1.0.0` created from develop
- All 276 tests passing, 0 type errors on release branch
- CHANGELOG.md updated with v1.0.0 entry (Added + Security sections)
- Production infrastructure provisioning checklist prepared
- Monitoring configuration checklist prepared
- QA checklist prepared

### Pending (requires manual action)
- Railway PostgreSQL production instance with pgvector + PgBouncer
- Vercel domain + DNS + SSL configuration
- Google/GitHub OAuth production credentials + Resend domain
- Sentry production DSN, OpenAI/Railway alerts, uptime + cron monitors
- Full QA checklist on production deployment
- Merge release/v1.0.0 → main, tag v1.0.0
