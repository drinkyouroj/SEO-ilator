# Changelog

All notable changes to SEO-ilator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.3] — 2026-03-26

### Added
- Manual trigger buttons on Ingest page for crawl and analysis jobs (#37)
- Auto-trigger crawl processing after sitemap/URL list submission (#37)
- Standalone recommendations page for viewing run results (#29)
- Contextual anchor text extraction from source article body for semantic matches (#40)

### Fixed
- scopedPrisma injecting `where` into `create` operations causing 500 errors (#28, #38)
- Analyze page showing 0 recommendations — runs API now includes `recommendationsFound` (#38)
- Rate limiting blocking dry-run requests (#25) and overly aggressive 5/hr limit (#26)
- Crosslink strategy producing 0 recs for articles with 10+ existing links (#35)
- URL normalization for dedup — relative paths and language-variant self-links now matched (#36)
- Semantic similarity threshold not reading from project settings (#32)
- MIN_SOURCE_WORDS too high (300→50) excluding most articles (#31)
- Theme selector not working — CSS variables and Tailwind v4 class-based dark mode (#41)
- ToastProvider missing from dashboard layout (#30)

### Changed
- Cron frequency increased to every 6 hours for crawl and analyze (requires Pro plan) (#37)
- Semantic anchor text now extracts concise phrases from source body instead of echoing target title (#39, #40)
- Site name suffixes stripped from recommendation display titles (#38)

### Removed
- Debug similarity endpoint (temporary diagnostic tool)

## [1.0.0] — 2026-03-24

### Added
- **Landing page**: Hero section, 3-step feature cards, navigation with sign-in/get-started CTAs
- **Ingestion pipeline**: Sitemap crawl, URL list, file upload (HTML/MD/JSON), API push with SSRF protection [AAP-B1]
- **Embedding providers**: OpenAI (text-embedding-3-small), Cohere (embed-english-v3.0), and Groq (llama3-embedding-large) with cache, batch processing, and atomic provider switching [AAP-B6]
- **Crosslink strategy**: Keyword matching (exact + Dice fuzzy), semantic matching (pgvector cosine similarity), 12 quality safeguards, XSS-safe anchor text
- **Analysis orchestrator**: Chunked processing with heartbeat liveness, cancellation support, FK violation fallback, conditional completion writes
- **Recommendations API**: Paginated list with severity/status/run/article filters, optimistic locking (updatedAt), bulk update (max 500), CSV/JSON export with formula injection prevention [DECISION-003]
- **Dashboard UI**: AppShell with sidebar, articles list, article detail with recommendations section, analysis page with dry-run/polling/cancel, runs history, settings page
- **Settings**: Strategy configuration sliders (similarity threshold, fuzzy tolerance, max links), embedding provider switch with confirmation dialog [AAP-B6], account section with plan badge and usage stats
- **Auth**: Auth.js v5 with Google/GitHub/Email providers, database sessions, 30-day maxAge with activity refresh, tenant-scoped Prisma extension [AAP-B5]
- **Rate limiting**: In-memory token bucket — POST /api/articles (10/min), POST /api/analyze (5/hr), default (60/min) [AAP-B9]
- **Error boundaries**: Global and dashboard-scoped with Sentry reporting
- **Loading skeletons**: For all dashboard pages [AAP-F9]
- **Accessibility**: focus-visible:ring-2 on all interactive elements, 44px touch targets, aria-labels on icon-only buttons and badges, keyboard navigation
- **Responsive design**: Mobile slide-over sidebar, 44px touch targets [AAP-F6]
- **Sentry integration**: Client/server config with DSN gating, source map support, instrumentation hook
- **Vercel Analytics**: Web Analytics and Speed Insights
- **Security review**: 10-item checklist documented in DECISION doc (9 PASS, 1 deferred)
- **Test suite**: 280 tests across 47 files — unit tests, API route tests, integration tests, component tests, accessibility tests
- **Seed data**: Development seed with 15 articles, 30 recommendations, factory functions for all models
- **CI/CD**: GitHub Actions (lint, test, build, migration-test), Vercel deployment

### Security
- SSRF guard with DNS resolution and private IP rejection on all resolved addresses [AAP-B1]
- Tenant isolation via scopedPrisma on all data access [AAP-B5]
- Formula injection prevention in CSV exports [DECISION-003]
- XSS sanitization on anchor text from crawled titles
- Parameterized SQL throughout (no raw string concatenation)
- Rate limiting on mutation endpoints [AAP-B9]
- File upload size limits and extension allowlist
