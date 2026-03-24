# Phase 3: Ingestion Pipeline — Design Spec

**Date:** 2026-03-23
**Status:** Approved
**Phase:** 3 of 9
**Depends on:** Phase 0 (infrastructure), Phase 1 (schema + auth), Phase 2 (dashboard shell)

---

## Overview

The ingestion pipeline is the data acquisition layer of SEO-ilator. It accepts article content through three input methods (sitemap/URL-list crawl, file upload, API push), processes them through a shared parsing and normalization pipeline, and stores them as `Article` records in PostgreSQL. This phase implements the full pipeline with all AAP-required security and reliability safeguards.

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| File upload handling | Server-side (multipart API route) | Same `parser.ts` for all paths; trustworthy validation; no cheerio in client bundle |
| Sync/async boundary | Hybrid: sync <50 URLs, async + on-demand cron trigger ≥50 | Instant feedback for small jobs; daily cron is safety net, not primary driver |
| robots.txt compliance | Strict, no bypass, user education on skipped pages | Matches DECISION-002; no abuse vector; simpler code |
| Retry strategy | Classified — only retry transient failures, 2 retries with backoff | Avoids wasting cron time on permanent failures |
| Upload file formats | HTML + Markdown + JSON manifest | Covers solo creators through power users |
| Implementation approach | Vertical slice (sitemap crawl end-to-end first, then broaden) | Exercises every component; validates AAP security requirements on real crawl path |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INPUT METHODS                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  Sitemap URL  │  │  File Upload │  │  API Push            │  │
│  │  / URL List   │  │  (multipart) │  │  POST /api/articles  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ sitemap.ts   │  │ upload.ts    │  │ push-handler.ts      │  │
│  │ [AAP-O10]    │  │ [AAP-F7]     │  │ [AAP-O7]             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼──────────────────────┼──────────────┘
          │                 │                      │
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PROCESSING LAYER                            │
│                                                                 │
│  queue.ts → crawler.ts → parser.ts → normalizer.ts              │
│  [AAP-B2,F9]  [AAP-B1]    [AAP-O1]                             │
│                                                                 │
│  Sync path (<50 URLs): process inline, return completed job     │
│  Async path (≥50 URLs): return 202, trigger cron on-demand      │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│  PostgreSQL: Article, IngestionJob, IngestionTask               │
└─────────────────────────────────────────────────────────────────┘
```

## Module Specifications

### 1. Parser — `src/lib/ingestion/parser.ts`

Extracts structured data from raw HTML using cheerio.

```typescript
parseHTML(html: string, url: string, httpStatus?: number, responseTimeMs?: number)
  → ParsedArticle

parseMarkdown(md: string, url: string)
  → ParsedArticle  // converts markdown → HTML via `marked`, then delegates to parseHTML

// For file uploads, the `url` parameter is synthesized as `upload://<filename>`.
// This ensures upsert keying on (projectId, url) works correctly.
// Two uploads of the same filename intentionally overwrite the previous version.
// Users who need distinct articles from same-named files should rename before uploading.
```

**`ParsedArticle` fields:**
- `title`: from `<title>`, fallback to first `<h1>`
- `body`: text from `<main>`, `<article>`, or `<body>` (priority order), tags stripped
- `wordCount`: whitespace-split count of body
- `existingLinks`: internal `<a href>` links as `{ href, anchorText }[]`
- `metadata`: `{ canonical, metaTitle, metaDescription, h1, h2s[], noindex, nofollow, httpStatus, responseTimeMs }`
- `parseWarning`: `"near-empty-body"` when wordCount < 50 and HTTP 200 with substantial response (AAP-O1)

### 2. Normalizer — `src/lib/ingestion/normalizer.ts`

Transforms `ParsedArticle` into the Prisma `Article` upsert shape.

```typescript
normalizeArticle(parsed: ParsedArticle, projectId: string, sourceType: "crawl" | "upload" | "push")
  → NormalizedArticle
```

- Computes `bodyHash` (SHA-256 of body) and `titleHash` (SHA-256 of title)
- Sets `sourceType` for traceability
- Upsert keyed on `(projectId, url)` — updates only if `bodyHash` changed

### 3. SSRF Guard — `src/lib/ingestion/ssrf-guard.ts`

Validates URLs before any network request (AAP-B1).

```typescript
validateUrl(url: string) → { safe: boolean, resolvedIp?: string, reason?: string }
```

- Rejects non-HTTP(S) schemes
- Resolves hostname via `dns.resolve4()`, rejects private/reserved IPs: `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, `0.x`, `::1`, `fc00::/7`
- Returns resolved IP for use in fetch (prevents DNS rebinding)

### 4. Robots — `src/lib/ingestion/robots.ts`

Fetches and caches `robots.txt` per domain within a cron invocation.

```typescript
checkRobots(url: string, userAgent: string) → { allowed: boolean, crawlDelay?: number }
```

- In-memory cache per domain (scoped to invocation lifetime)
- Parses `User-agent`, `Allow`, `Disallow`, `Crawl-delay`
- Matches our user-agent (`SEO-ilator/1.0`) and `*` wildcard
- Returns `crawlDelay` — crawler uses `max(crawlDelay, presetDelay)`

### 5. Crawler — `src/lib/ingestion/crawler.ts`

Per-URL fetch with security and rate-limiting compliance.

```typescript
crawlUrl(url: string, preset: CrawlPreset) → CrawlResult
```

Per-URL sequence:
1. `ssrf-guard.validateUrl(url)` — reject if unsafe
2. `robots.checkRobots(url)` — skip if disallowed
3. `fetch(url)` with manual redirect following (`redirect: "manual"`), 10s timeout, `User-Agent: SEO-ilator/1.0`
4. On each redirect: `ssrf-guard.validateUrl(redirectUrl)` — max 5 redirects
5. Return raw HTML + metadata

**Rate presets** (sequential processing, concurrency=1 for v1.0):

| Preset | Delay | DECISION-002 concurrency | v1.0 behavior |
|---|---|---|---|
| Gentle | 1000ms | 1 | Sequential, 1 req/s |
| Standard | 333ms | 2 | Sequential, 3 req/s (concurrency deferred to v1.1) |
| Fast | 100ms | 5 | Sequential, 10 req/s (concurrency deferred to v1.1) |

**v1.0 deviation from DECISION-002:** DECISION-002 specifies concurrency > 1 for Standard and Fast presets. v1.0 implements sequential-only processing (concurrency=1) for all presets to keep the cron worker simple and avoid complex concurrent rate limiting within a single serverless invocation. The delay between requests achieves the target request rate for the single-connection case. Concurrent processing can be added in v1.1 if throughput is insufficient.

`Crawl-delay` from robots.txt overrides the preset delay if it's slower.

### 6. Queue — `src/lib/ingestion/queue.ts`

Database-backed job/task queue with all AAP safeguards.

**Functions:**

| Function | Behavior |
|---|---|
| `createJob(projectId, urls[], preset)` | Creates IngestionJob + deduped IngestionTask rows |
| `cancelJob(jobId, projectId)` | Sets job status to "cancelled" AND atomically transitions all `pending` tasks to `cancelled`. In-flight `processing` tasks are not aborted, but the cron worker checks job status before writing results — if cancelled, discards the result and marks the task `cancelled`. (AAP-F9) |
| `claimTasks(jobId, batchSize)` | CAS: `UPDATE SET status='processing' WHERE status='pending' AND retryAfter < now()` (AAP-B2) |
| `completeTask(taskId, result)` | CAS: `SET status='completed' WHERE status='processing'` (AAP-B2) |
| `failTask(taskId, error, isTransient)` | Transient + retries < 2: reset to pending with backoff (30s, 60s). Otherwise: mark failed. |
| `recoverZombies()` | Reset tasks stuck in processing > 10 min (AAP-B2) |
| `finalizeJob(jobId)` | Mark job completed/failed when all tasks are done |

**Retry classification:**

| Failure Type | Examples | Retry? |
|---|---|---|
| Transient | 429, 503, network timeout | Yes (2 retries, 30s/60s backoff) |
| Permanent | 404, 403, DNS failure | No — fail immediately |
| SSRF blocked | Private IP resolved | No — security violation |
| robots.txt blocked | Disallowed by robots.txt | No — policy, not error |

**Job state machine:**
```
Job:    pending → running → completed | failed | cancelled
Task:   pending → processing → completed | failed
              ↑←────────────┘ (transient retry only)
        pending → cancelled (via cancelJob, atomic bulk transition)
        processing → cancelled (cron worker discards result if job cancelled)
```

### 7. Sitemap Parser — `src/lib/ingestion/sitemap.ts`

Parses sitemap XML with AAP-O10 safeguards.

```typescript
parseSitemap(url: string) → { urls: string[], warnings: string[] }
```

- Recursion depth limit: 2 (sitemap index → sitemap → stop)
- Decompressed size limit: 50MB
- URL count cap: 10,000
- Deduplication via URL normalization (lowercase scheme+host, remove trailing slash)
- Also supports plain text URL lists (one per line)

## API Routes

### `POST /api/articles` — Sitemap/URL-list ingestion

- Input: `{ method: "sitemap", url: string, preset } | { method: "url_list", urls: string[], preset }`
- Auth: `requireAuth()` → `scopedPrisma(projectId)`
- Validation: zod schema
- Flow: parse sitemap → create job → route sync (<50 URLs, return 200) or async (≥50, return 202 + fire on-demand cron trigger)
- **On-demand cron trigger mechanism:** Uses Next.js `after()` (post-response callback) to fire a `fetch()` to `/api/cron/crawl` with `Authorization: Bearer ${CRON_SECRET}`. This is fire-and-forget — the 202 response is sent immediately. If the trigger fetch fails (network error, function cold start timeout), the job remains in `pending` status and will be picked up by the daily scheduled cron as a safety net. The `GET /api/jobs/[id]` endpoint surfaces job status so the user can see if processing has started; if stuck in `pending` for >2 minutes, the UI can show a "Processing will begin shortly" message.

### `POST /api/articles/upload` — File upload

- Input: `multipart/form-data` with `.html`, `.md`, `.json` files
- Limits: 10MB/file, 50MB total (AAP-F7)
- Always synchronous (no crawling needed — just parse and normalize)
- `.html` → `parseHTML()` → normalizer
- `.md` → `parseMarkdown()` → normalizer
- `.json` → zod validate → normalizer
- Returns 200 with article count and warnings

### `POST /api/articles/push` — API push

- Input: `{ url, title, body, bodyFormat: "html"|"text"|"markdown", metadata? }`
- Auth: `requireAuth()` + `checkPlanLimits("api_access")` (Pro+ only)
- If `bodyFormat: "html"`: run `parseHTML()` to extract `existingLinks` (AAP-O7)
- If text/markdown: set `existingLinks` to `[]` not `null` (AAP-O7)
- Returns 200 with upserted article

### `POST /api/jobs/[id]/cancel` — Cancel job (AAP-F9)

- Auth: verify job belongs to user's project
- Calls `queue.cancelJob()`
- Returns 200 with updated job

### `GET /api/jobs/[id]` — Job status

- Returns job + task summary (completed/failed/pending counts)
- Paginated task list: 100 per page, cursor-based using `id` field (cuid), sorted by `id` ascending. Client passes `?cursor=<lastTaskId>` for next page.

### `GET /api/cron/crawl` — Cron worker

- Auth: `verifyCronSecret()`
- Step 1: `recoverZombies()` — reset stale tasks
- Step 2: Process pending/running jobs in task batches, respecting rate limits
- Step 3: `finalizeJob()` for completed jobs
- Time budget: ~270s of the 300s max duration
- On-demand trigger: same handler, called with `Authorization: Bearer CRON_SECRET`

## Schema Migration

Additive changes to `IngestionTask`:

```prisma
retryAfter DateTime?

@@index([status, retryAfter])  // Required for claimTasks() CAS query performance
```

The new composite index on `(status, retryAfter)` supports the `claimTasks()` query which filters on `WHERE status='pending' AND retryAfter < now()`. Without this index, every cron invocation would sequential-scan the task table. No destructive changes.

## Testing Plan

Each module gets focused unit tests in `tests/lib/ingestion/`:

| Test file | Key cases |
|---|---|
| `parser.test.ts` | Well-formed HTML, empty body detection (AAP-O1), title fallback, markdown conversion |
| `ssrf-guard.test.ts` | Private IP rejection, public IP allow, non-HTTP scheme rejection, DNS failure handling |
| `robots.test.ts` | Disallow respect, Crawl-delay extraction, missing/malformed robots.txt |
| `sitemap.test.ts` | Standard urlset, sitemapindex recursion, depth limit, URL cap (10k), dedup, malformed XML |
| `queue.test.ts` | createJob dedup, cancelJob, CAS claimTasks, transient vs permanent failure, zombie recovery, finalize |
| `normalizer.test.ts` | Hash computation, upsert on (projectId, url), skip update when bodyHash unchanged |

API route tests are lighter — focused on auth, validation, and sync/async routing.

## AAP Requirements Coverage

| AAP ID | Requirement | Where addressed |
|---|---|---|
| AAP-B1 | SSRF: DNS resolve at fetch time, validate redirect chains | `ssrf-guard.ts`, `crawler.ts` |
| AAP-B2 | Zombie recovery 10 min, CAS on task completion | `queue.ts` |
| AAP-O1 | Empty-body detection, parseWarning field | `parser.ts` |
| AAP-O7 | Extract existingLinks from HTML push; [] not null for text/md | API push handler |
| AAP-O10 | Sitemap: depth 2, 50MB, 10k URLs, dedup | `sitemap.ts` |
| AAP-F7 | File upload: multipart API, 10MB/file, 50MB total | Upload API route |
| AAP-F9 | cancelJob(), cancel endpoint, cron skips cancelled | `queue.ts`, cancel route |

## Known Deviations from DECISION-002

- **Zombie threshold:** DECISION-002 body text says 5 minutes. AAP-B2 (DECISION-006) overruled to 10 minutes because 5 min < 300s function timeout guarantees collisions. This spec uses 10 minutes per the AAP ruling. DECISION-002 should be updated to reflect this.
- **Concurrency:** DECISION-002 specifies concurrency > 1 for Standard and Fast presets. v1.0 uses sequential processing only (see crawler section above).

## Implementation Order (Vertical Slice)

1. Schema migration (retryAfter field)
2. Parser + normalizer (shared core)
3. SSRF guard
4. Robots.txt handler
5. Crawler
6. Queue system
7. Sitemap parser
8. API route: sitemap/URL-list ingestion (with sync/async routing + on-demand cron trigger)
9. Cron worker
10. API route: file upload
11. API route: API push
12. API route: job cancel + status
