# Architecture Overview — SEO-ilator

> Living document. Update when a PR meaningfully changes system topology, data flow,
> or key component responsibilities.

**Last updated:** 2026-03-23 (v1.0 implementation plan, AAP review — DECISION-006)

---

## System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Next.js App (Vercel)                          │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  Auth Pages  │  │  Dashboard   │  │  API Routes │  │   Cron    │ │
│  │  /auth/*     │  │  /dashboard/*│  │  /api/*     │  │  Workers  │ │
│  │              │  │              │  │             │  │  crawl    │ │
│  │              │  │              │  │             │  │  analyze  │ │
│  │              │  │              │  │             │  │  cleanup  │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └─────┬─────┘ │
│         │                │                  │                │       │
│  ┌──────┴────────────────┴──────────────────┴────────────────┴────┐  │
│  │                     Auth Abstraction Layer                     │  │
│  │  src/lib/auth/ (session.ts, config.ts, plan-guard.ts)         │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │                     Service Layer                              │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐  │  │
│  │  │  Ingestion   │  │   Analysis    │  │  Strategy Registry │  │  │
│  │  │  Pipeline    │  │  Orchestrator │  │                    │  │  │
│  │  │              │  │               │  │  ┌──────────────┐  │  │  │
│  │  │  crawler     │  │  orchestrator │  │  │  Crosslink   │  │  │  │
│  │  │  parser      │  │  re-analysis  │  │  │  Strategy    │  │  │  │
│  │  │  normalizer  │  │  dedup-ranker │  │  └──────────────┘  │  │  │
│  │  │  sitemap     │  │               │  │  ┌──────────────┐  │  │  │
│  │  │  queue       │  │               │  │  │  (future     │  │  │  │
│  │  └──────────────┘  └───────┬───────┘  │  │  strategies) │  │  │  │
│  │                            │          │  └──────────────┘  │  │  │
│  │  ┌──────────────┐          │          └────────────────────┘  │  │
│  │  │  Embedding   │◄─────────┘                                  │  │
│  │  │  Provider    │                                             │  │
│  │  │              │  ┌──────────────┐                           │  │
│  │  │  cache.ts    │  │   Export     │                           │  │
│  │  │  openai.ts   │  │   csv.ts    │                           │  │
│  │  │  cohere.ts   │  │   json.ts   │                           │  │
│  │  │  similarity  │  │   sanitize  │                           │  │
│  │  └──────────────┘  └──────────────┘                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │                     Prisma ORM + Raw SQL                       │  │
│  │  src/lib/db.ts (singleton, withProject helper, $queryRaw)     │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │    PostgreSQL        │
                    │    (Railway)         │
                    │                     │
                    │  pgvector extension  │
                    │  HNSW index          │
                    │  PgBouncer pooling   │
                    └─────────────────────┘
```

---

## Data Flow

### Ingestion Flow

```
User Input                   Processing                        Storage
───────────                  ──────────                        ───────

Sitemap URL ──┐
              │
URL List ─────┤─► POST /api/articles ─► Validate (Zod + SSRF)
              │       │
File Upload ──┤       ├─► <50 URLs: Synchronous path
              │       │     │
API Push ─────┘       │     ├─► fetch URL (crawler.ts)
                      │     ├─► parse HTML (parser.ts)
                      │     ├─► normalize (normalizer.ts)
                      │     └─► upsert Article ──────────────► PostgreSQL
                      │
                      └─► >=50 URLs: Async path
                            │
                            ├─► Create IngestionJob + Tasks ──► PostgreSQL
                            ├─► Return 202 with jobId
                            │
                            └─► Vercel Cron (/api/cron/crawl)
                                  runs every 1 minute
                                  │
                                  ├─► Recover zombie tasks
                                  ├─► Claim batch (FOR UPDATE SKIP LOCKED)
                                  ├─► Process: fetch → parse → normalize
                                  ├─► Upsert Articles (batch of 50)
                                  └─► Update job progress
                                        │
                                        └─► Dashboard polls GET /api/jobs/[id]
                                            every 3 seconds for progress
```

### Analysis Flow

```
User triggers               Processing                         Storage
POST /api/analyze            ──────────                         ───────
      │
      ├─► If dryRun: compute estimate only ──────────────────► Return 200
      │     (no AnalysisRun created) [AAP-O8]
      │
      ├─► Validate plan limits (plan-guard.ts)
      ├─► Create AnalysisRun (status: pending) ────────────────► PostgreSQL
      │     Enforced: partial unique index prevents concurrent
      │     runs per project [AAP-B3]
      ├─► Return 202 with { runId, embeddingEstimate }
      │
      └─► Vercel Cron (/api/cron/analyze) [AAP-O2]
            runs every 1 minute, processes in batches of 200
            │
            ├─► Claim pending/running AnalysisRun (SKIP LOCKED)
            ├─► Zombie recovery: running > 10 min → failed [AAP-F4]
            │
            ├─► Compute re-analysis scope (re-analysis.ts)
            │     Skip: accepted recs, unchanged dismissed recs
            │     Include: new articles, changed articles
            │     Mark previous pending recs as superseded [AAP-B4]
            │
            ├─► Load article metadata (ArticleSummary) [AAP-B7]
            │     No full body text in memory
            │     Bodies loaded on-demand in batches of 200
            │
            ├─► If semantic enabled:
            │     ├─► Check embedding cache (cache.ts)
            │     │     Compare bodyHash + titleHash + embeddingModel
            │     ├─► Generate missing embeddings (OpenAI/Cohere)
            │     └─► Store embeddings via $executeRaw
            │
            ├─► Run strategies via StrategyRegistry
            │     │
            │     └─► CrosslinkStrategy.analyze()
            │           ├─► Keyword matching (DOM-aware, Dice fuzzy)
            │           │     Title prefix stripping [AAP-O6]
            │           ├─► Semantic matching (pgvector <=> cosine)
            │           │     Phase 1: coarse filter (top 20 per article)
            │           │     Phase 2: chunk-to-chunk similarity
            │           ├─► Apply quality safeguards (12 rules)
            │           │     Conservative defaults when existingLinks
            │           │     is null [AAP-O7]
            │           └─► Return Recommendation[]
            │
            ├─► Deduplicate & rank (dedup-ranker.ts)
            │     Merge keyword+semantic, boost confidence,
            │     sort by severity/confidence, apply maxLinksPerPage
            │
            ├─► Save recommendations atomically ────────────────► PostgreSQL
            │     (transaction: all or none)
            │     Handle FK violations gracefully [AAP-B10]
            │
            └─► Status: completed (or failed with error)
                  │
                  └─► Dashboard polls GET /api/runs/[id]
                      every 5s with backoff [AAP-F1]
                      Cancel via POST /api/runs/[id]/cancel [AAP-F4]
```

### Recommendation Review Flow

```
Dashboard                    API                                Storage
─────────                    ───                                ───────

View recs ──────────► GET /api/recommendations ◄───────────── PostgreSQL
  (filtered by          ?severity=critical                    (3-table join:
   severity,             &status=pending                      Recommendation +
   status,               &articleId=...                       source Article +
   article)                                                   target Article)

Accept rec ─────────► PATCH /api/recommendations/[id]
                        { status: "accepted" } ────────────► UPDATE status

Dismiss rec ────────► PATCH /api/recommendations/[id]
                        { status: "dismissed",
                          dismissReason: "..." } ──────────► UPDATE status

Bulk action ────────► PATCH /api/recommendations/bulk
                        { ids: [...], status } ────────────► BATCH UPDATE

Copy snippet ───────► (client-side clipboard)
                        <a href="target">anchor</a>

Export CSV ─────────► GET /api/recommendations?format=csv
                        Stream with UTF-8 BOM ─────────────► Download
```

---

## Directory Structure

Every file planned for v1.0:

```
SEO-ilator/
├── .env.example
├── .github/
│   └── workflows/
│       └── ci.yml                          # GitHub Actions CI
├── docker/
│   └── init.sql                            # pgvector extension init
├── docker-compose.yml                      # Local PostgreSQL with pgvector
├── vercel.json                             # Cron jobs + function timeouts
├── next.config.js
├── tailwind.config.ts
├── vitest.config.ts
├── tsconfig.json
├── package.json
├── CLAUDE.md
├── CHANGELOG.md
├── build_log.md
├── README.md
│
├── prisma/
│   ├── schema.prisma                       # Complete schema (13 models)
│   ├── seed.ts                             # Development seed data
│   └── migrations/
│       ├── <ts>_init_auth/                 # User, Account, Session, VerificationToken
│       ├── <ts>_add_project/               # Project
│       ├── <ts>_add_articles_with_pgvector/ # Article + pgvector raw SQL
│       ├── <ts>_add_analysis_and_recs/     # AnalysisRun, Recommendation, StrategyConfig
│       └── <ts>_add_ingestion_queue/       # IngestionJob, IngestionTask
│
├── docs/
│   ├── architecture.md                     # This file
│   ├── PRD.md                              # Product requirements
│   ├── IMPLEMENTATION_PLAN.md              # Phase-by-phase build plan
│   └── decisions/
│       ├── 001-embedding-cost-management.md
│       ├── 002-crawl-rate-limiting.md
│       ├── 003-export-format.md
│       ├── 004-authentication-provider.md
│       └── 005-one-click-link-insertion.md
│
├── public/                                 # Static assets
│
├── sentry.client.config.ts
├── sentry.server.config.ts
│
├── src/
│   ├── middleware.ts                       # Auth.js route protection
│   │
│   ├── app/
│   │   ├── layout.tsx                      # Root layout (SessionProvider, ThemeProvider, Analytics)
│   │   ├── error.tsx                       # Global error boundary
│   │   │
│   │   ├── auth/
│   │   │   ├── sign-in/
│   │   │   │   └── page.tsx               # OAuth + magic link sign-in
│   │   │   └── verify-request/
│   │   │       └── page.tsx               # "Check your email" confirmation
│   │   │
│   │   ├── dashboard/
│   │   │   ├── layout.tsx                 # Dashboard shell (AppShell wrapper)
│   │   │   ├── error.tsx                  # Dashboard error boundary
│   │   │   ├── page.tsx                   # Redirects to /dashboard/articles
│   │   │   │
│   │   │   ├── articles/
│   │   │   │   ├── page.tsx               # Article index (table, search, pagination)
│   │   │   │   ├── loading.tsx            # Skeleton loader
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx           # Article detail + recommendations
│   │   │   │
│   │   │   ├── analyze/
│   │   │   │   ├── page.tsx               # Analysis config form + progress
│   │   │   │   └── loading.tsx
│   │   │   │
│   │   │   ├── runs/
│   │   │   │   ├── page.tsx               # Analysis run history
│   │   │   │   └── loading.tsx
│   │   │   │
│   │   │   ├── ingest/
│   │   │   │   └── page.tsx               # Ingestion form (sitemap/URL/upload tabs)
│   │   │   │
│   │   │   └── settings/
│   │   │       └── page.tsx               # Strategy config + account + plan
│   │   │
│   │   └── api/
│   │       ├── auth/
│   │       │   └── [...nextauth]/
│   │       │       └── route.ts           # Auth.js catch-all handler
│   │       │
│   │       ├── health/
│   │       │   └── route.ts               # Health check endpoint
│   │       │
│   │       ├── articles/
│   │       │   ├── route.ts               # POST (ingest), GET (list)
│   │       │   └── [id]/
│   │       │       └── route.ts           # GET (detail), DELETE
│   │       │
│   │       ├── analyze/
│   │       │   └── route.ts               # POST (trigger analysis)
│   │       │
│   │       ├── runs/
│   │       │   ├── route.ts               # GET (list runs)
│   │       │   └── [id]/
│   │       │       └── route.ts           # GET (run detail)
│   │       │
│   │       ├── recommendations/
│   │       │   ├── route.ts               # GET (list/export CSV/JSON)
│   │       │   ├── [id]/
│   │       │   │   └── route.ts           # PATCH (accept/dismiss)
│   │       │   └── bulk/
│   │       │       └── route.ts           # PATCH (bulk update)
│   │       │
│   │       ├── jobs/
│   │       │   └── [id]/
│   │       │       └── route.ts           # GET (ingestion job progress)
│   │       │
│   │       ├── settings/
│   │       │   └── route.ts               # GET, PUT (strategy config)
│   │       │
│   │       └── cron/
│   │           ├── crawl/
│   │           │   └── route.ts           # Crawl queue worker (every 1 min)
│   │           ├── analyze/
│   │           │   └── route.ts           # Analysis queue worker (every 1 min) [AAP-O2]
│   │           └── cleanup-sessions/
│   │               └── route.ts           # Session cleanup (daily 3 AM)
│   │
│   ├── components/
│   │   ├── ThemeProvider.tsx               # Dark mode (class strategy, localStorage)
│   │   │
│   │   ├── layout/
│   │   │   ├── AppShell.tsx               # Sidebar + header + content
│   │   │   ├── Sidebar.tsx                # Navigation links, collapse
│   │   │   ├── Header.tsx                 # Page title + UserMenu
│   │   │   ├── UserMenu.tsx               # Avatar, dropdown, sign-out
│   │   │   ├── AuthLayout.tsx             # Centered card (no sidebar)
│   │   │   └── PageContainer.tsx          # Max-width, padding
│   │   │
│   │   ├── data/
│   │   │   ├── DataTable.tsx              # Generic sortable/paginated table
│   │   │   ├── SeverityBadge.tsx          # critical/warning/info badges
│   │   │   ├── StatusBadge.tsx            # pending/accepted/dismissed/running/etc.
│   │   │   ├── EmptyState.tsx             # Title, description, CTA
│   │   │   ├── Pagination.tsx             # Cursor-based prev/next
│   │   │   ├── BodyPreview.tsx            # Truncated text with expand
│   │   │   └── StatCard.tsx               # Single metric display
│   │   │
│   │   ├── forms/
│   │   │   ├── SitemapInput.tsx           # URL input with validation
│   │   │   ├── UrlListInput.tsx           # Textarea, newline-separated
│   │   │   ├── FileDropzone.tsx           # Drag-and-drop upload
│   │   │   ├── CrawlRateSelector.tsx      # Gentle/Standard/Fast radio
│   │   │   ├── ThresholdSlider.tsx        # Range input with value display
│   │   │   ├── MatchingApproachSelector.tsx # Checkbox group
│   │   │   ├── ArticleSubsetSelector.tsx  # Multi-select dropdown
│   │   │   └── ConfirmDialog.tsx          # Modal with confirm/cancel
│   │   │
│   │   ├── feedback/
│   │   │   ├── Toast.tsx                  # Non-blocking notification
│   │   │   ├── ToastProvider.tsx          # Context provider for toasts
│   │   │   ├── ProgressBar.tsx            # Determinate/indeterminate
│   │   │   ├── UrlStatusFeed.tsx          # Per-URL crawl status list
│   │   │   ├── Spinner.tsx                # Inline loading
│   │   │   ├── SkeletonLoader.tsx         # Loading placeholders
│   │   │   └── ErrorBanner.tsx            # Full-width error with retry
│   │   │
│   │   └── recommendations/
│   │       ├── RecommendationCard.tsx     # Single rec with actions
│   │       ├── CopySnippet.tsx            # Editable anchor + copy HTML
│   │       ├── RecommendationFilters.tsx  # Severity/status filters
│   │       └── BulkActionBar.tsx          # Select all, bulk accept/dismiss
│   │
│   ├── lib/
│   │   ├── db.ts                          # Prisma singleton + scopedPrisma extension [AAP-B5]
│   │   ├── api-client.ts                  # Global fetch wrapper with 401 redirect [AAP-F5]
│   │   ├── rate-limit.ts                  # In-memory token bucket rate limiter [AAP-B9]
│   │   │
│   │   ├── auth/
│   │   │   ├── config.ts                  # Auth.js v5 config (providers, adapter, callbacks)
│   │   │   ├── session.ts                 # getSession, requireAuth, getCurrentUser
│   │   │   ├── middleware.ts              # Route protection config
│   │   │   ├── plan-guard.ts             # Tier limit enforcement
│   │   │   └── cron-guard.ts             # Cron secret verification [AAP-B8]
│   │   │
│   │   ├── ingestion/
│   │   │   ├── normalizer.ts             # Normalize all inputs, compute hashes
│   │   │   ├── parser.ts                 # Cheerio HTML parser (metadata extraction)
│   │   │   ├── crawler.ts                # HTTP fetcher, robots.txt, rate limiting
│   │   │   ├── sitemap-parser.ts         # Parse sitemap.xml to URL list
│   │   │   ├── queue.ts                  # IngestionJob/Task queue management
│   │   │   └── url-validator.ts          # SSRF protection
│   │   │
│   │   ├── embeddings/
│   │   │   ├── types.ts                  # EmbeddingProvider interface
│   │   │   ├── index.ts                  # Provider factory (getProvider)
│   │   │   ├── providers.ts              # Provider-to-dimension mapping
│   │   │   ├── cache.ts                  # Embedding cache check (hash comparison)
│   │   │   ├── batch.ts                  # Batch embedding generation
│   │   │   ├── similarity.ts             # pgvector cosine similarity queries
│   │   │   └── providers/
│   │   │       ├── openai.ts             # OpenAI text-embedding-3-small
│   │   │       └── cohere.ts             # Cohere embed-english-v3.0
│   │   │
│   │   ├── strategies/
│   │   │   ├── types.ts                  # SEOStrategy, AnalysisContext, Recommendation
│   │   │   ├── registry.ts              # StrategyRegistry class
│   │   │   ├── crosslink.ts             # Crosslink strategy (keyword + semantic)
│   │   │   └── index.ts                 # Strategy registration entrypoint
│   │   │
│   │   ├── analysis/
│   │   │   ├── orchestrator.ts          # Analysis run lifecycle management
│   │   │   ├── re-analysis.ts           # Change detection, scope computation
│   │   │   └── dedup-ranker.ts          # Cross-approach dedup, ranking, capping
│   │   │
│   │   ├── export/
│   │   │   ├── csv.ts                   # CsvSerializer (streaming, BOM)
│   │   │   ├── json.ts                  # JSON download mode
│   │   │   └── sanitize.ts             # Formula injection prevention
│   │   │
│   │   └── validation/
│   │       ├── common.ts                # Shared primitives (pagination, UUID, URL)
│   │       ├── articleSchemas.ts        # Ingestion request schemas
│   │       ├── analysisSchemas.ts       # Analysis request schemas
│   │       ├── recommendationSchemas.ts # Filter, update, bulk schemas
│   │       └── settingsSchemas.ts       # Settings update schema
│   │
│   └── utils/                           # Shared utility functions
│
└── tests/
    ├── helpers/
    │   └── factories.ts                  # Test data factory functions
    │
    ├── lib/
    │   ├── auth/
    │   │   └── plan-guard.test.ts
    │   ├── ingestion/
    │   │   ├── normalizer.test.ts
    │   │   ├── parser.test.ts
    │   │   ├── crawler.test.ts
    │   │   ├── sitemap-parser.test.ts
    │   │   └── queue.test.ts
    │   ├── embeddings/
    │   │   ├── cache.test.ts
    │   │   └── providers/
    │   │       └── openai.test.ts
    │   ├── strategies/
    │   │   ├── crosslink.test.ts
    │   │   └── registry.test.ts
    │   ├── analysis/
    │   │   ├── orchestrator.test.ts
    │   │   ├── re-analysis.test.ts
    │   │   └── dedup-ranker.test.ts
    │   └── export/
    │       ├── csv.test.ts
    │       └── sanitize.test.ts
    │
    ├── components/
    │   ├── data/
    │   │   ├── SeverityBadge.test.tsx
    │   │   ├── DataTable.test.tsx
    │   │   └── RecommendationCard.test.tsx
    │   ├── forms/
    │   │   └── ThresholdSlider.test.tsx
    │   ├── feedback/
    │   │   └── Toast.test.tsx
    │   └── recommendations/
    │       └── CopySnippet.test.tsx
    │
    ├── api/                              # Integration tests
    │   ├── articles.test.ts
    │   ├── analyze.test.ts
    │   ├── recommendations.test.ts
    │   ├── auth.test.ts
    │   └── cron/
    │       └── crawl.test.ts
    │
    └── integration/
        └── full-flow.test.ts
```

---

## Database Schema

13 models across 5 migrations. See `prisma/schema.prisma` for the complete definition.

```
┌──────────────────────────────────────────────────────────────┐
│                     Auth Layer                                │
│  User ──< Account                                            │
│  User ──< Session                                            │
│  VerificationToken (standalone)                              │
└──────────────────────┬───────────────────────────────────────┘
                       │ User.id
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Multi-Tenancy                             │
│  User ──< Project                                            │
└──────────────────────┬───────────────────────────────────────┘
                       │ Project.id (projectId FK on all below)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Core Data                                 │
│                                                              │
│  Project ──< Article                                         │
│               │  embedding vector(1536) [pgvector, HNSW]     │
│               │  @@unique([projectId, url])                  │
│               │                                              │
│  Project ──< AnalysisRun ──< Recommendation                 │
│                                │                             │
│                   Recommendation.sourceArticleId ──> Article │
│                   Recommendation.targetArticleId ──> Article │
│                   @@unique([runId, sourceId, targetId, strategyId]) │
│                                                              │
│  Project ──< StrategyConfig                                  │
│               @@unique([projectId, strategyId])              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     Async Queue                               │
│  Project ──< IngestionJob ──< IngestionTask                  │
│              (status tracking)  (per-URL processing)         │
│              @@index([status, createdAt])                     │
│                                 @@index([status, startedAt]) │
└──────────────────────────────────────────────────────────────┘
```

**Key schema decisions:**
- `embedding vector(1536)` column managed via raw SQL, not Prisma (pgvector not natively supported)
- HNSW index (`m=16, ef_construction=64`) for cosine similarity search
- All tenant data scoped by `projectId` FK, enforced by `scopedPrisma(projectId)` extension [AAP-B5] which auto-injects projectId into all queries on tenant-scoped models
- Cascade deletes: User -> Project -> Article -> Recommendation
- Database sessions for server-side revocation capability (per DECISION-004)

---

## Component Architecture

### Strategy Registry Pattern

All SEO strategies implement the `SEOStrategy` interface and register with `StrategyRegistry`:

```
StrategyRegistry
  ├── register(strategy)
  ├── unregister(id)
  ├── getStrategy(id)
  ├── getAllStrategies()
  └── analyzeWithAll(context) ──► iterates strategies, concatenates results

SEOStrategy interface:
  ├── id: string
  ├── name: string
  ├── description: string
  ├── analyze(context): Promise<Recommendation[]>
  └── configure?(settings): void

v1.0 strategies:
  └── CrosslinkStrategy
        ├── KeywordMatcher (DOM-aware, Dice fuzzy, n-gram tokenization)
        │     Title prefix stripping for common phrases [AAP-O6]
        ├── SemanticMatcher (pgvector cosine, two-phase: coarse + chunk)
        ├── Quality safeguards (12 hard rules)
        │     Conservative defaults when existingLinks is null [AAP-O7]
        └── ArticleSummary index (no full body in memory) [AAP-B7]
              Bodies loaded on-demand via loadArticleBodies() callback

Future strategies (v1.1+):
  ├── MetaTagStrategy
  ├── KeywordDensityStrategy
  └── ContentQualityStrategy
```

**Design principle:** Strategies receive data via `AnalysisContext`, never query the database directly, never make HTTP calls. This keeps them testable and isolated.

### Embedding Provider Abstraction

```
EmbeddingProvider interface:
  ├── modelId: string
  ├── dimensions: number
  └── embed(texts: string[]): Promise<number[][]>

Providers:
  ├── OpenAIProvider (text-embedding-3-small, 1536 dims)
  └── CohereProvider (embed-english-v3.0, 1024 dims)

Cache layer (per DECISION-001):
  Check: bodyHash + titleHash + embeddingModel match?
  ├── Yes → skip API call (cached)
  └── No → call provider, store result + hashes
```

### Auth Abstraction Layer (per DECISION-004)

```
src/lib/auth/session.ts ──── ONLY file that imports from next-auth
  ├── getSession()       → Session | null
  ├── requireAuth()      → { userId, projectId, user } | throws 401
  └── getCurrentUser()   → User & { project: Project }

src/lib/auth/config.ts
  ├── Providers: Google, GitHub, Email (magic link via Resend)
  ├── Adapter: Prisma
  ├── Session strategy: database
  └── Callbacks: auto-create Project on first login

src/lib/auth/plan-guard.ts
  └── checkPlanLimits(projectId, action) → { allowed, message? }
```

**Migration surface:** If auth provider changes (e.g., to Clerk), only `config.ts` and `session.ts` need modification.

---

## Infrastructure

### Hosting

| Component | Service | Plan |
|-----------|---------|------|
| Application | Vercel | Pro (300s timeout, cron jobs) |
| Database | Railway PostgreSQL 16 | Starter → Pro as needed |
| Email (magic link) | Resend | Free tier |
| Error tracking | Sentry | Free tier |
| Embeddings | OpenAI API | Pay-per-use |

### Cron Jobs

| Endpoint | Schedule | Purpose | Timeout |
|----------|----------|---------|---------|
| `/api/cron/crawl` | Every minute | Process ingestion queue | 300s |
| `/api/cron/analyze` | Every minute | Process analysis runs in batches [AAP-O2] | 300s |
| `/api/cron/cleanup-sessions` | Daily 3 AM UTC | Delete expired sessions | 60s |

### Port Assignments

| Service | Port |
|---------|------|
| Next.js app | 3000 |
| PostgreSQL | 5432 |

### Connection Management

- Application queries: pooled connection via PgBouncer (`DATABASE_URL`)
- Migrations: direct connection (`DIRECT_URL`)
- Connection limit per serverless instance: 5
- Prisma client singleton pattern (global in dev, per-lifecycle in prod)

---

## Key Interfaces (Type Reference)

### API Request/Response Types

**POST /api/articles** -- Discriminated union:
- `{ method: "sitemap", sitemapUrl, crawlPreset? }`
- `{ method: "url_list", urls, crawlPreset? }`
- `{ method: "push", articles: [{ url, title, body, bodyFormat?, metadata? }] }`

**POST /api/analyze:**
```typescript
{ approaches: ["keyword" | "semantic"][],
  articleIds?: string[],
  settings?: { similarityThreshold?, fuzzyTolerance?, maxLinksPerPage?, forceReEmbed? } }
```

**GET /api/recommendations** query params: `page, limit, severity, status, analysisRunId, articleId, format (json|csv), download`

**PATCH /api/recommendations/[id]:** `{ status: "accepted" | "dismissed", dismissReason? }`

**PATCH /api/recommendations/bulk:** `{ ids: string[], status, dismissReason? }`

### API Error Shape

```typescript
{ error: { code: string, message: string, details?: unknown } }
```

Standard codes: `VALIDATION_ERROR`, `NOT_FOUND`, `RATE_LIMITED`, `PLAN_LIMIT_EXCEEDED`, `ANALYSIS_IN_PROGRESS`, `NO_ARTICLES`, `URL_NOT_ALLOWED`, `CONFLICT` [AAP-B12], `ANALYSIS_ACTIVE_DELETE_BLOCKED` [AAP-B10]

---

## Quality Safeguards (Crosslink Strategy)

Per SEO Expert -- hard rules enforced before any recommendation is persisted:

1. No self-links (after canonicalization)
2. No duplicate links (check existing internal links on page)
3. No linking to noindex pages
4. No linking to error pages (4xx/5xx)
5. No linking to non-canonical URLs
6. Max links per page (existing + pending + new <= configured max)
7. No cross-language linking
8. Anchor text: 2-8 words
9. No anchors in forbidden DOM zones (headings, existing links, code, nav, footer)
10. No generic anchors ("click here", "read more", etc.)
11. Source articles must have >= 300 words
12. Index must have >= 2 articles

---

## DECISION Document Index

| # | Title | Status | Key Impact |
|---|-------|--------|------------|
| 001 | Embedding Cost Management | Accepted | Cache via bodyHash + embeddingModel; HNSW index; track cached/generated counters |
| 002 | Crawl Rate Limiting | Accepted | Conservative default (1 req/s); async queue; sync path for <50 URLs; zombie recovery |
| 003 | Export Format | Accepted | CSV + JSON in v1.0; BOM + formula injection prevention; >10K rows via background job |
| 004 | Authentication Provider | Accepted | NextAuth v5; database sessions; Google + GitHub + magic link; Project model for multi-tenancy |
| 005 | One-Click Link Insertion | Accepted | Copy-snippet in v1.0; sourceContext/charOffset fields; CMS connector interface for v2.0 |
| 006 | Implementation Plan AAP Review | Accepted | 33 objections reviewed; async analysis via cron; scopedPrisma tenant isolation; SSRF at fetch time; embedding provider switch atomicity; title prefix stripping |
