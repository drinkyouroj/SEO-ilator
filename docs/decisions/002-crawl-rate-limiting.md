# DECISION: Crawl Rate Limiting

**Date:** 2026-03-23
**Status:** Accepted

## Context

When users ingest articles via sitemap URL, SEO-ilator crawls their (or their client's) web server. The crawl rate directly affects three things: user-perceived ingestion speed, the target server's stability, and SEO-ilator's IP reputation. The PRD (Section 13, Question 2) flags this as requiring a DECISION doc. Additionally, Vercel's serverless function timeout constraints (60s Hobby / 300s Pro) make synchronous crawling of large sitemaps impossible, requiring an async job architecture.

## Options Considered

1. **Aggressive crawling (5-10 req/s), no user controls** -- Pros: fast ingestion, simple implementation. Cons: can overwhelm shared hosting (the Backend Engineer warns this "creates real-world harm"); risks Vercel IP blocks; violates robots.txt norms; the Client Success advocate calls site downtime "the single worst outcome imaginable."

2. **Conservative default (1 req/s) with user-selectable presets, async job architecture** -- Default to safe behavior, offer Gentle/Standard/Fast presets, respect robots.txt unconditionally, run crawling as background jobs. Pros: protects vulnerable users (solo creators on cheap hosting); gives power users an escape hatch; fits Vercel's execution model. Cons: more complex to implement; slow default for large sitemaps.

3. **Adaptive rate limiting based on server response time** -- Dynamically adjust crawl speed based on target server latency. Pros: optimal throughput per-server. Cons: significantly more complex; unpredictable behavior hard to explain in UI; the SEO Expert notes Google does this but Google has different scale and trust requirements.

## Decision

**Option 2: Conservative default with user-selectable presets and async job architecture.**

The team unanimously agreed that conservative defaults are essential. The Backend Engineer's framing is definitive: "you are hitting the user's own server -- being aggressive creates real-world harm." The Client Success advocate emphasized the user-segment-specific risk: solo creators on shared hosting are the most vulnerable, and agencies crawling client sites are the most reputation-sensitive. The SEO Expert confirmed this aligns with industry norms: "Screaming Frog defaults to 5 URLs/s but most professionals immediately reduce to 1-2/s."

### Crawl rate defaults and presets

| Preset | Requests/sec | Concurrency | Target segment |
|--------|-------------|-------------|----------------|
| Gentle | 1 | 1 | Default. Solo creators, shared hosting. |
| Standard | 3 | 2 | SEO professionals, managed hosting. |
| Fast | 10 | 5 | Enterprise infrastructure. Warning displayed. |

Users select the preset on the `/dashboard/ingest` page. The Fast preset shows a warning: "This may impact your site's performance for visitors. Only use for sites on dedicated infrastructure."

### robots.txt compliance

- Fetch and parse `robots.txt` for each domain before crawling. This is unconditional -- no override.
- Respect `Crawl-delay` directive. If `Crawl-delay` is specified and is more conservative than the user's selected preset, `Crawl-delay` wins.
- Pages blocked by robots.txt are skipped with a clear status message: "Skipped: blocked by robots.txt."
- Per the SEO Expert: pages with `noindex` robots meta tags should be flagged during crawl and excluded from crosslink targets (a recommendation pointing to a noindex page is a bad recommendation).

### Async job architecture (database-backed queue)

The DevOps engineer's recommendation for a database-backed queue is the right v1.0 approach, avoiding additional infrastructure (Redis, SQS).

**Flow:**
1. `POST /api/articles` (sitemap ingestion) parses the sitemap XML, creates an `IngestionJob` record (status: `pending`), inserts rows into an `IngestionTask` table (one per URL, status: `pending`), and returns `202 Accepted` with the job ID.
2. A Vercel Cron Job (runs every minute on Pro plan) picks up a batch of pending `IngestionTask` rows (up to 60 per invocation, respecting the per-domain rate limit) and processes them.
3. Each task updates to `processing`, then `completed` or `failed` with error detail.
4. The dashboard polls `GET /api/jobs/[id]` for progress, showing per-URL status in a real-time feed.

**New schema additions:**
- `IngestionJob` -- `id`, `userId`, `status` (pending/running/completed/failed), `totalUrls`, `completedUrls`, `failedUrls`, `preset` (gentle/standard/fast), `createdAt`, `completedAt`.
- `IngestionTask` -- `id`, `jobId` (FK), `url`, `status` (pending/processing/completed/failed), `errorMessage`, `httpStatus`, `responseTimeMs`, `processedAt`.

**Per-domain rate limiting:** Track last request timestamp per domain in a `CrawlDomainState` table or in-memory Map within the cron worker. Enforce the minimum gap dictated by the user's preset or the domain's `Crawl-delay`, whichever is larger.

### Metadata capture during crawl

Per the SEO Expert's recommendation, capture rich metadata during crawling that improves downstream analysis quality:
- HTTP status codes (301/302 redirects flagged; redirect targets stored)
- Existing internal links on each page
- Canonical URL
- H1/H2 heading structure
- Meta title and description (prepares for v1.1 meta tag strategy)
- `noindex` / `nofollow` directives
- Response time per URL

### User-Agent

Set `User-Agent: SEO-ilator/1.0 (+https://seo-ilator.com/bot)` per the Backend Engineer's recommendation.

### SSRF protection

Per the DevOps engineer: validate that URLs are public HTTP(S) only. Reject internal IPs (10.x, 192.168.x, 127.x, 169.254.x, ::1). This is a security requirement.

## Consequences

- Ingestion of large sitemaps becomes asynchronous. The `POST /api/articles` endpoint returns immediately; the dashboard shows live progress. This is a better UX but adds architectural complexity.
- The database-backed queue (IngestionJob + IngestionTask tables) is a new subsystem. It sets the foundation for other async operations (batch analysis, scheduled re-crawls).
- Conservative default crawling means a 200-page sitemap takes ~3.5 minutes at the Gentle preset. The Frontend Engineer's real-time progress feed (per-URL status, ETA, cancel-and-keep-partial) is essential to making this feel acceptable.
- Cron-based processing adds up to 60 seconds of latency before crawling begins (worst case: task inserted just after cron fires). This is acceptable for v1.0.
- Capturing rich metadata during crawl increases storage per article but avoids a re-crawl when the meta tag strategy ships in v1.1.

## AAP: Crawl Rate Limiting

### ARCHITECT

The ingestion pipeline becomes a three-component system: (1) the API endpoint (`POST /api/articles`) that parses the sitemap and enqueues tasks, (2) the `IngestionTask` table serving as a durable queue, and (3) a Vercel Cron worker (`/api/cron/crawl`) that processes batches every minute. Per-domain rate limiting uses a `CrawlDomainState` record tracking `lastRequestAt` per domain. The cron worker queries pending tasks, groups by domain, enforces the rate limit, fetches pages using cheerio with a 10-second per-URL timeout, and upserts results into the `Article` table in batches of 50 (per the DBA's recommendation for transaction efficiency). Failed URLs get up to 2 retries with exponential backoff, then are marked failed with a user-readable error.

Files affected: `src/app/api/articles/route.ts` (sitemap handling), `src/app/api/cron/crawl/route.ts` (new), `src/lib/ingestion/crawler.ts` (rate limiter, robots.txt parser), `src/lib/ingestion/parser.ts` (metadata extraction), `prisma/schema.prisma` (IngestionJob, IngestionTask models).

### ADVERSARY

**Objection 1:** A database-backed queue polled by a 1-minute cron job introduces up to 60 seconds of dead time before crawling even starts. For a solo creator ingesting 20 URLs, this means they submit and then stare at a "pending" screen for a minute. That violates the PRD's "time to first analysis < 10 minutes" goal and creates a terrible first impression. A real queue system (Inngest, Trigger.dev) would start processing within seconds.

**Objection 2:** The cron worker shares Vercel's serverless execution timeout (300s on Pro). If it picks up 60 URLs and several are slow-responding (5-10 second response times), it can timeout mid-batch, leaving tasks in a `processing` state permanently. There is no described mechanism for detecting and recovering from stale `processing` tasks (zombie recovery).

**Objection 3:** Global per-domain rate limiting across users is mentioned but not designed. If two users submit sitemaps for the same domain simultaneously, who gets priority? The `CrawlDomainState` table needs a locking strategy that does not serialize all crawling through a single bottleneck.

### JUDGE

**Verdict:** Accept the database-backed queue design for v1.0, with modifications for Objections 1 and 2. Objection 3 is valid but unlikely at launch scale and can be addressed post-MVP.

On Objection 1: Valid concern. **Modification:** For small ingestion jobs (under 50 URLs), process them synchronously in the API request handler if the Vercel function timeout permits (under 60 seconds at ~1 req/s means up to 50 URLs). Only fall back to the async queue for larger jobs. This gives solo creators instant feedback while using the queue for Pro-tier large sitemaps.

On Objection 2: This is a real operational risk. **Modification:** Add a `startedAt` timestamp on `IngestionTask`. The cron worker, on each invocation, first checks for tasks stuck in `processing` for more than 5 minutes and resets them to `pending` (with a retry counter increment). Tasks that exceed 3 total attempts are marked `failed` with a "timeout" error.

On Objection 3: Acknowledged but deferred. At launch scale (< 100 users), simultaneous crawls of the same domain are rare. If this becomes an issue, implement a global domain lock using PostgreSQL advisory locks. Document this as a known limitation.
