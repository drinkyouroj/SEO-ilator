# Phase 3: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Ingestion Pipeline (Implementation Plan Phase 3, tasks 3.1-3.11)

---

## Overview

Phase 3 is the most complex phase, building all three ingestion methods (sitemap, URL list, API push), the async crawl queue, cron worker, and the ingestion dashboard UI. With 24+ testable units across 11 tasks, this spec uses five domain-specialized agents. The Validation Agent runs first (its schemas are imported everywhere), then four agents run in parallel using git worktree isolation. Merge order is carefully sequenced to resolve dependencies: Validation, then Parser, then Queue, then API, then UI.

---

## Agent Team

### Validation Agent

**Domain:** Zod validation schemas, SSRF URL validation.

**Tasks:** 3.1, 3.2

**Files created:**

| File | Source Task |
|------|------------|
| `src/lib/validation/common.ts` | 3.1 (paginationSchema, uuidSchema, urlSchema) |
| `src/lib/validation/articleSchemas.ts` | 3.1 (ingestSitemapSchema, ingestUrlListSchema, ingestPushSchema, ingestRequestSchema — discriminated union by `method` field) |
| `src/lib/ingestion/url-validator.ts` | 3.2 (validatePublicUrl: rejects private IPs 10.x/172.16.x/192.168.x/127.x/169.254.x/::1/fc00::/7, localhost, file:///ftp:///data:// schemes) |

**Notes:**
- `urlSchema` in `common.ts` validates URL format (http/https only).
- `articleSchemas.ts` uses `z.discriminatedUnion("method", [...])` for the three ingestion methods.
- `ingestSitemapSchema`: `sitemapUrl` (urlSchema) + `crawlPreset` (enum: gentle/standard/fast, default gentle).
- `ingestUrlListSchema`: `urls` (array of urlSchema, min 1, max 2000) + `crawlPreset`.
- `ingestPushSchema`: `articles` array (url, title, body, bodyFormat enum html/markdown/text, optional metadata), min 1, max 500.
- [AAP-B1] `validatePublicUrl()` performs IP validation at submission time for fast user feedback. A second validation point occurs at fetch time in `crawler.ts` via `dns.resolve4()`. This dual-point validation prevents DNS rebinding attacks.
- `validatePublicUrl()` must also reject redirect targets — every URL in a redirect chain must be validated.

**Verification commands:**
- `npx tsc --noEmit` passes
- All schemas parse valid input and reject invalid input (verified via tests in parallel agents)

### Parser Agent

**Domain:** Article normalizer, HTML parser, sitemap parser.

**Tasks:** 3.3, 3.4, 3.5

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/ingestion/normalizer.test.ts` | 3.3 | RED: 5 failing tests |
| 2 | `src/lib/ingestion/normalizer.ts` | 3.3 | GREEN: implementation passes all 5 |
| 3 | `tests/lib/ingestion/parser.test.ts` | 3.4 | RED: 6 failing tests |
| 4 | `src/lib/ingestion/parser.ts` | 3.4 | GREEN: implementation passes all 6 |
| 5 | `tests/lib/ingestion/sitemap-parser.test.ts` | 3.5 | RED: 4 failing tests |
| 6 | `src/lib/ingestion/sitemap-parser.ts` | 3.5 | GREEN: implementation passes all 4 |

**Test cases (from Implementation Plan):**

**File:** `tests/lib/ingestion/normalizer.test.ts`
- `it("computes_consistent_hash_across_input_formats")`
- `it("strips_html_tags_for_plain_text_body")`
- `it("computes_correct_word_count")`
- `it("handles_empty_body_without_error")`
- `it("handles_unicode_content")`

**File:** `tests/lib/ingestion/parser.test.ts`
- `it("extracts_title_from_title_tag")`
- `it("falls_back_to_h1_when_no_title_tag")`
- `it("extracts_existing_internal_links")`
- `it("detects_noindex_directive")`
- `it("extracts_meta_description")`
- `it("extracts_heading_structure")`

**File:** `tests/lib/ingestion/sitemap-parser.test.ts`
- `it("parses_standard_sitemap")`
- `it("handles_sitemap_index")`
- `it("handles_malformed_xml")`
- `it("returns_empty_for_empty_sitemap")`

**Test environment setup:**
- Normalizer tests provide raw HTML/markdown/text inputs and assert consistent SHA-256 hashes, stripped body text, correct word counts.
- Parser tests provide HTML strings and assert cheerio-based extraction of title, headings, links, meta tags, robots directives.
- Sitemap parser tests use MSW or inline XML strings to mock HTTP responses. Tests must mock `fetch` for sitemap URL fetching.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. Two commits minimum per module (red, green).

**Notes on implementation details:**
- `normalizer.ts` exports: `NormalizedArticle` interface, `normalizeArticle()`, `computeBodyHash()`, `computeTitleHash()`. Hash = SHA-256 of normalized text. `sourceType` tracks origin: "sitemap", "upload", or "api_push".
- `parser.ts` exports: `ParsedPage` interface, `parsePage(html, sourceUrl)`. Cheerio-based. Extracts: title (from `<title>`, fallback `<h1>`, fallback `og:title`), body text, headings array, existing internal links with `isFollow`, canonical URL, meta title/description, robots directives (`index`/`follow`), language.
- `sitemap-parser.ts` exports: `parseSitemap(url): Promise<string[]>`. Handles: sitemap.xml, sitemap index files, gzipped sitemaps, malformed XML. [AAP-O10] Safety limits: recursion depth 2, decompressed size 50MB, max 10,000 URLs per submission, deduplication after parsing, namespace-aware and namespace-unaware XML parsing.

**Verification commands:**
- `npx vitest tests/lib/ingestion/normalizer.test.ts` -- 5/5 passing
- `npx vitest tests/lib/ingestion/parser.test.ts` -- 6/6 passing
- `npx vitest tests/lib/ingestion/sitemap-parser.test.ts` -- 4/4 passing
- `npx tsc --noEmit` passes

### Queue Agent

**Domain:** Crawler, ingestion queue manager, cron worker.

**Tasks:** 3.6, 3.7, 3.9

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/ingestion/crawler.test.ts` | 3.6 | RED: 4 failing tests |
| 2 | `src/lib/ingestion/crawler.ts` | 3.6 | GREEN: implementation passes all 4 |
| 3 | `tests/lib/ingestion/queue.test.ts` | 3.7 | RED: 5 failing tests |
| 4 | `src/lib/ingestion/queue.ts` | 3.7 | GREEN: implementation passes all 5 |
| 5 | `src/app/api/cron/crawl/route.ts` | 3.9 | Cron worker implementation |

**Test cases (from Implementation Plan):**

**File:** `tests/lib/ingestion/crawler.test.ts`
- `it("rejects_private_ip_urls")`
- `it("respects_robots_txt_disallow")`
- `it("sets_correct_user_agent_header")`
- `it("handles_timeout_gracefully")`

**File:** `tests/lib/ingestion/queue.test.ts`
- `it("creates_job_with_pending_tasks")`
- `it("claims_batch_respecting_rate_limits")`
- `it("recovers_zombie_tasks")`
- `it("fails_tasks_exceeding_retry_limit")`
- `it("marks_job_complete_when_all_tasks_done")`

**Test environment setup:**
- Crawler tests mock `fetch` and `dns.resolve4()` to simulate SSRF scenarios, robots.txt responses, timeouts.
- Queue tests mock Prisma client to verify SQL patterns: `FOR UPDATE SKIP LOCKED` claim, compare-and-swap completion, zombie recovery threshold.
- Crawler tests must verify User-Agent header is `SEO-ilator/1.0 (+https://seo-ilator.com/bot)`.

**TDD discipline:** Two commits minimum per module (red, green).

**Notes on implementation details:**
- `crawler.ts` exports: `CrawlResult` interface, `fetchUrl()`, `fetchRobotsTxt()`, `isUrlAllowed()`. Rate presets: gentle (1 req/s, concurrency 1), standard (3 req/s, concurrency 2), fast (10 req/s, concurrency 5). 10-second per-URL timeout. [AAP-B1] Performs `dns.resolve4()` immediately before each HTTP request and validates resolved IP against private ranges. Disables automatic redirect following; manually follows redirects and validates each redirect target. [AAP-O1] After parsing, detects empty/near-empty body (< 50 words when HTTP 200 and content-length > 1KB) and flags with `parseWarning`.
- `queue.ts` exports: `createJob()`, `claimBatch()`, `completeTask()`, `failTask()`, `recoverZombieTasks()`, `getJobStatus()`, `cancelJob()` [AAP-F9]. Uses `FOR UPDATE SKIP LOCKED` for claim pattern. [AAP-B2] Zombie recovery: tasks in `processing` > 10 min (exceeds 300s function timeout) reset to `pending` with `retryCount++`. Tasks with `retryCount >= 3` marked `failed`. Task completion uses compare-and-swap: `UPDATE SET status = 'completed' WHERE id = ? AND status = 'processing'`. [AAP-F9] `cancelJob()` sets job status to `cancelled` and marks all remaining `pending` tasks as `cancelled`.
- `src/app/api/cron/crawl/route.ts` (task 3.9): Verifies `CRON_SECRET`. Execution flow: zombie recovery, claim batch (up to 60 tasks grouped by domain), process each task (fetch -> parse -> normalize -> upsert Article), update task status and job counters, check job completion. Timeout safety: stop at ~280s elapsed. Per-domain rate limiting. Article upsert uses `ON CONFLICT ("projectId", url) DO UPDATE` with embedding cache clearing when `bodyHash` changes.

**Verification commands:**
- `npx vitest tests/lib/ingestion/crawler.test.ts` -- 4/4 passing
- `npx vitest tests/lib/ingestion/queue.test.ts` -- 5/5 passing
- `npx tsc --noEmit` passes

### API Agent

**Domain:** All ingestion and article API routes.

**Task:** 3.8

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/api/articles/route.ts` | 3.8 (POST: discriminated union by method, sync <50 URLs / async >=50 URLs, push upsert; GET: paginated list with search/sort) |
| `src/app/api/articles/[id]/route.ts` | 3.8 (GET: full article detail; DELETE: with active analysis check [AAP-B10]) |
| `src/app/api/jobs/[id]/route.ts` | 3.8 (GET: job status with per-task detail for progress polling) |
| `src/app/api/jobs/[id]/cancel/route.ts` | 3.8 (POST: cancel job [AAP-F9], returns 200/404/409) |

**Notes:**
- `POST /api/articles`:
  - Discriminated union request by `method` field, validated via `ingestRequestSchema`.
  - Sitemap/URL list <50 URLs: synchronous processing, return `201`.
  - Sitemap/URL list >=50 URLs: async via queue, return `202 Accepted` with `{ jobId, totalUrls, status: "pending" }`.
  - Push: synchronous upsert, return `201` with `{ articles, created, updated }`.
  - [AAP-O7] For `bodyFormat: "html"`, run `parsePage()` to extract `existingLinks`, headings, metadata. For `bodyFormat: "text"` or `"markdown"`, set `existingLinks` to `[]`.
  - SSRF check on all URLs via `validatePublicUrl()`.
  - Upsert by `projectId + url` unique constraint.
- `GET /api/articles`: Paginated list with search, sort. Response includes `recommendationCount` and `lastAnalyzedAt`.
- `DELETE /api/articles/[id]`: [AAP-B10] Before deleting, check for active analysis runs (`status IN ('pending', 'running')`). If analysis in progress, return 409: "Cannot delete articles while an analysis is running." Otherwise 204, cascades to recommendations.
- `GET /api/jobs/[id]`: Returns job status with per-task detail for progress polling.
- `POST /api/jobs/[id]/cancel`: [AAP-F9] Calls `cancelJob()`. Returns 200 with updated status, 404 if not found, 409 if already completed/failed.
- All routes use `requireAuth()` from session helpers for authentication.

**Verification commands:**
- `npx tsc --noEmit` passes
- `npm run build` succeeds
- Manual test: `POST /api/articles` with push method returns 201
- Manual test: `GET /api/articles` returns paginated list
- Manual test: `DELETE /api/articles/[id]` returns 204 (or 409 during analysis)

### UI Agent

**Domain:** Ingestion dashboard UI, articles index page.

**Tasks:** 3.10, 3.11

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/dashboard/ingest/page.tsx` | 3.10 (IngestionPage: IngestionTabs > SitemapForm/UrlListForm/FileUploadForm, IngestionProgress > ProgressBar/UrlStatusFeed/IngestionStats/CancelButton/ETADisplay) |
| `src/app/dashboard/ingest/loading.tsx` | 3.10 (skeleton loader [AAP-F9]) |
| `src/components/forms/CrawlRateSelector.tsx` | 3.10 (radio group: Gentle/Standard/Fast, Fast shows performance warning) |
| `src/components/forms/SitemapInput.tsx` | 3.10 (URL input with validation, hint: "Tip: Most sites serve their sitemap at yoursite.com/sitemap.xml") |
| `src/components/forms/UrlListInput.tsx` | 3.10 (textarea, newline-separated, per-line validation) |
| `src/components/forms/FileDropzone.tsx` | 3.10 (drag-and-drop, accept .html/.md/.json, [AAP-F7] 10MB per file / 50MB total, HTML via multipart/form-data server-side, .md/.json parsed client-side via method: "push", cheerio NEVER in client, XMLHttpRequest progress events) |
| `src/components/feedback/UrlStatusFeed.tsx` | 3.10 (scrollable per-URL status during ingestion, [AAP-F1] exponential backoff polling: 3s -> 6s -> 12s -> 30s cap, reset on success, pause on document.visibilityState === 'hidden', stop on completed/failed/cancelled) |
| `src/app/dashboard/articles/page.tsx` | 3.11 (replaces Phase 2 placeholder: ArticlesToolbar + ArticlesTable + Pagination + EmptyState with CTA -> /dashboard/ingest) |

**Notes:**
- Depends on Layout Agent output from Phase 2 (AppShell, PageContainer) and shared UI components (DataTable, ProgressBar, EmptyState, Spinner, Pagination).
- `IngestionTabs`: Sitemap | URL List | File Upload tabs.
- `CrawlRateSelector`: Fast preset shows warning: "This may impact your site's performance for visitors. Only use for sites on dedicated infrastructure."
- `SitemapInput`: Hint per Client Success plan: "Tip: Most sites serve their sitemap at yoursite.com/sitemap.xml. WordPress sites use /wp-sitemap.xml."
- [AAP-F7] `FileDropzone`: File size limits enforced client-side. HTML files submitted via `multipart/form-data` to server-side route (cheerio server-only). `.md` and `.json` parsed client-side, submitted via `method: "push"`. Upload progress via `XMLHttpRequest` progress events.
- [AAP-F1] `UrlStatusFeed`: Polls `GET /api/jobs/[id]` with exponential backoff on consecutive failures (3s -> 6s -> 12s -> 30s cap, reset on success). Pauses polling when tab is hidden. Stops on terminal states.
- Empty state per Client Success plan: "Your article index is empty. Add your site's articles to get started." [Button: "Add articles via sitemap"]
- Articles page (task 3.11): Server-side initial fetch, client-side for subsequent pages/search/sort. Columns: title, URL, word count, last analyzed, recommendation count.
- All client-side fetch calls use `apiFetch` from Phase 1.

**Verification commands:**
- `npx tsc --noEmit` passes
- `npm run build` succeeds
- Manual test: ingestion page renders with three tabs
- Manual test: submitting a sitemap URL starts ingestion with progress feed
- Manual test: articles page shows indexed articles with search and sort

---

## Execution Flow

```
Phase A ── sequential (validation foundation)
  Validation Agent creates schemas + URL validator on feature/phase-3-validation
  Commits, verifies: tsc passes, schemas parse valid/invalid input

Phase B ── parallel (worktree isolation, branched from Validation output)
  Parser Agent ─► feature/phase-3-parser  (own worktree)
  Queue Agent  ─► feature/phase-3-queue   (own worktree)
  API Agent    ─► feature/phase-3-api     (own worktree)
  UI Agent     ─► feature/phase-3-ui      (own worktree)

Phase C ── sequential merge into feature/phase-3
  1. Merge feature/phase-3-validation → feature/phase-3
  2. Merge feature/phase-3-parser     → feature/phase-3
  3. Merge feature/phase-3-queue      → feature/phase-3
  4. Merge feature/phase-3-api        → feature/phase-3
  5. Merge feature/phase-3-ui         → feature/phase-3
  6. Integration verification pass
  7. PR feature/phase-3 → develop
```

### Merge Order Rationale

Validation first because `articleSchemas.ts` and `url-validator.ts` are imported by Parser Agent (normalizer uses schemas), Queue Agent (crawler uses URL validator), and API Agent (routes use schemas for request validation). Parser second because `normalizer.ts` and `parser.ts` are imported by Queue Agent (cron worker uses parse -> normalize pipeline) and API Agent (push endpoint uses parsePage for HTML). Queue third because `queue.ts` and `crawler.ts` are imported by API Agent (article routes create jobs, invoke queue manager) and contain the core ingestion logic. API fourth because it creates the routes that UI Agent's polling and form submissions target. UI last because it depends on all prior agents' outputs: validation schemas (form validation), API routes (form submission targets, polling endpoints), and queue types (job status).

### Expected Conflicts

- **`src/app/dashboard/articles/page.tsx`:** Expected conflict. UI Agent replaces Phase 2 placeholder. No other Phase 3 agent touches this file. Resolve by keeping UI Agent's version.
- **`src/app/dashboard/ingest/page.tsx`:** Expected conflict. UI Agent replaces Phase 2 placeholder. No other Phase 3 agent touches this file. Resolve by keeping UI Agent's version.
- **`src/lib/ingestion/` directory:** No conflict. Each agent creates different files within this directory. Validation Agent creates `url-validator.ts`, Parser Agent creates `normalizer.ts`, `parser.ts`, `sitemap-parser.ts`, Queue Agent creates `crawler.ts`, `queue.ts`.
- **`package.json`:** No conflict expected. No agents add dependencies in this phase (cheerio, zod already installed in Phase 0).

---

## Integration Verification

After all five branches merge into `feature/phase-3`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Tests pass | `npx vitest --run` | 24/24 new (normalizer 5, parser 6, sitemap 4, crawler 4, queue 5) + prior phases |
| Build succeeds | `npm run build` | Exit 0 |
| Lint passes | `npm run lint` | Exit 0 |

### Documentation

| Check | Location |
|-------|----------|
| Discriminated union schema | `src/lib/validation/articleSchemas.ts` |
| SSRF dual-point validation [AAP-B1] | `src/lib/ingestion/url-validator.ts` (submission) + `src/lib/ingestion/crawler.ts` (fetch time dns.resolve4) |
| Redirect chain SSRF validation [AAP-B1] | `src/lib/ingestion/crawler.ts` |
| Zombie recovery 10min threshold [AAP-B2] | `src/lib/ingestion/queue.ts` |
| FOR UPDATE SKIP LOCKED claim pattern | `src/lib/ingestion/queue.ts` |
| Compare-and-swap task completion | `src/lib/ingestion/queue.ts` |
| Cancel job [AAP-F9] | `src/lib/ingestion/queue.ts` + `src/app/api/jobs/[id]/cancel/route.ts` |
| Active analysis check on delete [AAP-B10] | `src/app/api/articles/[id]/route.ts` |
| Sitemap safety limits [AAP-O10] | `src/lib/ingestion/sitemap-parser.ts` (recursion 2, size 50MB, URLs 10K) |
| CSR parseWarning [AAP-O1] | `src/lib/ingestion/crawler.ts` |
| existingLinks extraction for HTML push [AAP-O7] | `src/app/api/articles/route.ts` |
| Exponential backoff polling [AAP-F1] | `src/components/feedback/UrlStatusFeed.tsx` |
| File upload limits [AAP-F7] | `src/components/forms/FileDropzone.tsx` (10MB per file, 50MB total) |
| Cheerio server-only [AAP-F7] | `src/components/forms/FileDropzone.tsx` (HTML via multipart, not client cheerio) |
| Rate presets documented | `src/lib/ingestion/crawler.ts` (gentle/standard/fast) |
| Skeleton loader [AAP-F9] | `src/app/dashboard/ingest/loading.tsx` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] `POST /api/articles` with `method: "push"` creates articles and returns 201
- [ ] `POST /api/articles` with `method: "sitemap"` for <50 URLs processes synchronously
- [ ] `POST /api/articles` with `method: "sitemap"` for >=50 URLs creates IngestionJob and returns 202
- [ ] Cron worker processes pending tasks and upserts articles
- [ ] Zombie recovery resets stuck tasks
- [ ] `GET /api/articles` returns paginated list with search
- [ ] `DELETE /api/articles/[id]` cascades to recommendations
- [ ] `GET /api/jobs/[id]` returns per-task status
- [ ] Ingestion UI shows progress with per-URL status feed
- [ ] Articles page shows indexed articles with sorting and search
- [ ] SSRF protection rejects private IPs
- [ ] [AAP-B1] SSRF validation occurs at fetch time (not just submission time)
- [ ] [AAP-B1] Redirect chains are validated against SSRF rules
- [ ] [AAP-B2] Zombie recovery threshold is 10 minutes (exceeds 300s function timeout)
- [ ] [AAP-F9] Cancel button triggers `POST /api/jobs/[id]/cancel` and stops processing
- [ ] [AAP-O1] Articles with < 50 words from 200-OK responses show parseWarning
- [ ] [AAP-O7] Push-ingested HTML articles have existingLinks extracted
- [ ] [AAP-O10] Sitemap parser enforces recursion, size, and URL count limits
- [ ] robots.txt is respected during crawl
