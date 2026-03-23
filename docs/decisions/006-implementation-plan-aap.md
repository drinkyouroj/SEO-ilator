# DECISION: Implementation Plan AAP Review

**Date:** 2026-03-23
**Status:** Accepted

## Context

AAP review of the v1.0 implementation plan and architecture documents. Three adversary agents reviewed the plan from different angles: backend architecture/security (B1-B12), frontend UX/reliability (F1-F11), and operations/infrastructure/SEO correctness (O1-O10). This document records the JUDGE's ruling on each of the 33 objections and consolidates required modifications to the implementation plan.

---

## AAP Verdicts

### Backend Objections (B1-B12)

**B1: SSRF Bypass via DNS Rebinding**
**Verdict: Upheld.**
This is a textbook attack and the time window between submission and async fetch makes it worse. The fix is straightforward: validate resolved IP at fetch time inside `crawler.ts`, not just at submission time. Redirect chains must also be validated. Must fix before implementation.

**B2: Cron Worker Race Condition -- Duplicate Processing via Zombie Recovery**
**Verdict: Upheld.**
The 5-minute zombie threshold is shorter than the 300-second function timeout. This is a guaranteed collision. Fix: increase zombie threshold to 10 minutes, and use compare-and-swap on task completion (`WHERE status = 'processing'`). Must fix before implementation.

**B3: Analysis Orchestrator Has No Concurrency Guard at the Database Level**
**Verdict: Upheld.**
TOCTOU on the "is a run active?" check is a real risk, especially with double-click or retry behavior. The partial unique index solution (`WHERE status IN ('pending', 'running')`) is elegant and correct. Must fix before implementation.

**B4: Recommendation Dedup Unique Constraint Allows Cross-Run Staleness Accumulation**
**Verdict: Upheld.**
After multiple runs, users will see duplicate pending recommendations for the same article pair. The fix is to mark previous-run pending recommendations as `superseded` when a new run produces the same (source, target, strategy) triple. Add a `superseded` status. Must fix before implementation.

**B5: `withProject()` Is a Convention, Not an Enforcement Mechanism**
**Verdict: Upheld.**
This is the single highest-risk tenant isolation issue. A missed `withProject()` call leaks data. The Prisma client extension approach is the right fix -- automatically inject `projectId` into queries on tenant-scoped models. Additionally, cross-tenant access integration tests are mandatory. Must fix before implementation (Phase 1).

**B6: Embedding Dimension Mismatch Is a Data Corruption Time Bomb**
**Verdict: Upheld.**
Mixed-dimension vectors in the same HNSW index produce garbage similarity scores. The plan silently deviates from DECISION-001's JUDGE verdict on zero-padding. Fix: provider switching must atomically clear all embeddings for the project and force a full re-embed. The settings endpoint must warn the user. Must fix before implementation (Phase 4 and Phase 7).

**B7: Unbounded `articleIndex` in `AnalysisContext` Causes OOM on Pro Tier**
**Verdict: Partially upheld.**
The memory concern is valid for 2,000 articles with full body text. However, the fix should not require a complete redesign of the strategy interface. Fix: the orchestrator should load article metadata (id, title, url, wordCount, existingLinks) into the index, and load full bodies in batches during keyword matching. The `AnalysisContext.articleIndex` type should use a slimmed-down `ArticleSummary` type rather than full `Article`. The semantic path already queries pgvector in the database, which is fine. This overlaps with O2 (timeout) -- consolidated fix below. Must fix before implementation.

**B8: Cron Secret Verification Is Bypassable on Vercel**
**Verdict: Partially upheld.**
The risk is real but the fix described in the plan (verify `CRON_SECRET` header) is correct if implemented properly. The concern about checking the wrong header name or using timing-unsafe comparison is speculative -- these are implementation bugs, not design flaws. Fix: add a reusable `verifyCronSecret()` helper with a test that verifies 401 without the correct header. Add this helper to Phase 1 infrastructure. The middleware exclusion concern is valid -- document that cron routes skip session auth but require the cron secret. Must fix before implementation.

**B9: No Rate Limiting on Authenticated API Endpoints**
**Verdict: Partially upheld.**
Rate limiting is important but the severity is overstated. The plan already has plan-based limits (article count, run count) which provide coarse protection. Fine-grained per-minute rate limiting via Redis adds infrastructure complexity (KV store) that is not justified for v1.0 launch. Fix: add in-memory rate limiting (using a simple token bucket per userId in a Map, acceptable for single-region Vercel deployment) on the most abusable endpoints: `POST /api/articles` and `POST /api/analyze`. Defer comprehensive Redis-based rate limiting to post-launch. Can defer full implementation, but basic protection must exist before launch.

**B10: Article Deletion During Active Analysis Causes Foreign Key Violations**
**Verdict: Upheld.**
This is a concrete data integrity issue. Fix: `DELETE /api/articles/[id]` must check for active analysis runs and return 409 if one is in progress. Additionally, the orchestrator's recommendation insertion should handle FK violations gracefully (skip, log, continue) rather than failing the entire run. Must fix before implementation.

**B11: No Pagination on Analysis Orchestrator's Article Fetch**
**Verdict: Upheld.**
This is the same root cause as B7. Consolidated fix: the orchestrator must use cursor-based pagination to load articles in batches. This is part of the B7/O2 consolidated fix. Must fix before implementation.

**B12: No Handling of Concurrent Recommendation Status Updates**
**Verdict: Partially upheld.**
The last-write-wins problem is real for the single-item PATCH. Fix: add `updatedAt` optimistic locking on the single-item PATCH endpoint. For the bulk endpoint, the concern about superseded/deleted IDs is valid but the fix is simpler: use `updateMany` with `projectId` filter and return the count of updated records. The client can compare expected vs actual count. The two-tab race condition is an edge case acceptable for v1.0. Must fix before launch (not blocking implementation).

---

### Frontend Objections (F1-F11)

**F1: Polling Has No Exponential Backoff, No Tab-Visibility Awareness, No Multi-Tab Coordination**
**Verdict: Partially upheld.**
Exponential backoff on failure and tab-visibility pausing are must-haves. Multi-tab coordination via BroadcastChannel is over-engineering for v1.0 -- the additional load from a second tab is negligible. SSE is a better long-term solution but adds complexity to v1.0. Fix: implement backoff (3s -> 6s -> 12s -> 30s cap on consecutive failures, reset on success), pause polling when `document.visibilityState === 'hidden'`, and explicitly specify termination conditions (stop on `completed`, `failed`, `cancelled`). Must fix before implementation.

**F2: Optimistic UI for Accept/Dismiss Has No Rollback Mechanism**
**Verdict: Upheld.**
Silent failure on PATCH is unacceptable UX. Fix: on PATCH failure, revert local state and show a toast with the error message. Disable individual action buttons on items selected for a pending bulk operation. This pairs with B12's optimistic locking. Must fix before implementation.

**F3: CopySnippet Has No Fallback for Non-HTTPS Contexts and No XSS Sanitization**
**Verdict: Upheld.**
The XSS concern is the critical part -- users will paste generated HTML into CMSes that render it. The clipboard fallback is a minor polish item. Fix: HTML-escape both `anchorText` and `targetUrl` before assembling the `<a>` tag. Add a `document.execCommand('copy')` fallback. Add a test for special characters in anchor text. Must fix before implementation.

**F4: No Cancel Mechanism for Analysis Runs, and No Recovery from 300s Timeout**
**Verdict: Upheld.**
This is the most impactful frontend objection and overlaps with O2 (timeout). A stuck analysis run with no cancel and no zombie recovery blocks the user permanently. Fix: (1) Add zombie recovery for analysis runs (running > 10 minutes -> failed with "Analysis timed out"). (2) Add `POST /api/runs/[id]/cancel` endpoint. (3) Add CancelButton to analysis progress UI. (4) The async processing fix from O2/B7 addresses the root cause. Must fix before implementation.

**F5: Session Expiry During Active Work Silently Breaks the Experience**
**Verdict: Upheld.**
A user working for 45 minutes and having every action silently fail is unacceptable. Fix: (1) Specify session duration (30 days, refreshed on activity). (2) Add a global fetch wrapper that intercepts 401 responses and redirects to sign-in with `callbackUrl`. (3) On 401 during optimistic updates, show a toast with sign-in link. Must fix before implementation.

**F6: Table-Heavy UI Has No Mobile Story**
**Verdict: Partially upheld.**
The concern is valid -- "responsive design pass" in Phase 7 is vague. However, this is not a v1.0 blocker. The target audience (SEO professionals, bloggers) primarily uses desktop for this type of tool. Fix: add a `renderMobileCard` prop to DataTable from the start (Phase 2) so the Phase 7 responsive pass is a configuration exercise, not a rewrite. Specify which recommendation fields are visible vs. expandable on mobile. Can defer detailed mobile design to Phase 7, but the DataTable prop must be in Phase 2.

**F7: File Upload Ingestion Has No Server-Side Handling**
**Verdict: Upheld.**
The discriminated union has no `method: "upload"` variant. The FileDropzone component exists but has no corresponding API handler. Fix: clarify the design -- file upload parses client-side (markdown/JSON) or via a dedicated API route (`multipart/form-data` for HTML files). Add a `method: "upload"` variant or document that files are parsed client-side and submitted as `method: "push"`. Add file size limits (10MB per file, 50MB total). Cheerio must not be bundled client-side. Must fix before implementation (Phase 3).

**F8: Magic Link Dead-End UX**
**Verdict: Partially upheld.**
The dead-end UX is a real problem but the fix is mostly copy and UI, not architecture. Fix: add "Sign in a different way" link on verify-request page. Map the Auth.js `Verification` error to an expired-link-specific message with a link back to sign-in. Add troubleshooting tips (check spam, whitelist domain). Must fix before launch.

**F9: Ingestion Cancel Has No Server-Side Implementation**
**Verdict: Upheld.**
A cancel button that does nothing is worse than no cancel button. Fix: add `cancelJob()` to `queue.ts`, add `POST /api/jobs/[id]/cancel` endpoint, modify cron worker to skip tasks for cancelled jobs. Add `loading.tsx` for the ingest page. Must fix before implementation.

**F10: Cheerio Risks Being Bundled into the Client**
**Verdict: Partially upheld.**
The risk is real but manageable with standard Next.js configuration. Fix: add `cheerio` to `serverComponentsExternalPackages` in `next.config.js` (Phase 0). Add bundle analyzer to CI with a client bundle size budget. The source context highlighting in CopySnippet must use string operations, not cheerio. Must fix before implementation (Phase 0 config change).

**F11: OAuth Callback Edge Cases Strand Users**
**Verdict: Partially upheld.**
The `OAuthAccountNotLinked` error should tell the user which provider they originally used -- this is a significant UX improvement with minimal effort. The provider outage handling is polish. Fix: on `OAuthAccountNotLinked`, include the provider name in the error message. Defer "Linked accounts" settings page to post-launch. Must fix before launch.

---

### Ops/SEO Objections (O1-O10)

**O1: Cheerio Cannot Parse JavaScript-Rendered Pages**
**Verdict: Upheld.**
This is the most common "works in demo, fails in production" bug for any web crawler. The target audience absolutely uses JS-rendered sites. A full headless browser solution is too heavy for v1.0, but silent failure is unacceptable. Fix: detect empty/near-empty body after parsing (< 50 words when response was 200 with substantial content-length). Flag articles with a `parseWarning` field. Surface warnings in the ingestion feed and articles table. Document the limitation in UI help text. Plan Playwright fallback for v1.1. Must fix before implementation.

**O2: Vercel 300s Timeout Insufficient for Semantic Analysis at Scale**
**Verdict: Upheld.**
The math checks out -- 2,000 articles with semantic matching will exceed 300 seconds. This overlaps with B7 (memory) and B11 (pagination). Consolidated fix: make the analysis orchestrator process articles in batches across multiple cron invocations, similar to the crawl queue pattern. `POST /api/analyze` creates the run and returns 202. A dedicated analysis cron (or the existing crawl cron with a second duty) picks up pending/running analyses and processes them in chunks of 200 articles per invocation. Intermediate state is stored on the AnalysisRun record. Must fix before implementation.

**O3: Railway pgvector Version Assumption and HNSW Index Fragility**
**Verdict: Upheld.**
Deploying without verifying pgvector version is reckless. Fix: add a Phase 0 verification task for pgvector version. Add a health check that confirms HNSW support. For the dimension issue -- this is consolidated with B6. Must fix before implementation.

**O4: Prisma Migrations Are Unsafe in Vercel Preview Deployments**
**Verdict: Upheld.**
Preview deployments running migrations against a shared database is a data loss risk. Fix: move preview database provisioning to Phase 0. Modify `vercel-build` to conditionally run `prisma migrate deploy` only on production/staging branches. For previews, run `prisma generate` only. Must fix before implementation.

**O5: No Operational Runbook for Cron Worker Failure, OpenAI Outage, or Railway Downtime**
**Verdict: Partially upheld.**
Runbooks are important but not implementation-blocking. Fix: add an external cron monitor (Cronitor or similar) in Phase 9. Add a "stuck job/run detector" to the health check endpoint. Document that embedding writes are idempotent via the cache check (hash mismatch = regenerate). Defer full runbooks to post-launch, but the stuck-job detector must be in before launch.

**O6: Keyword Matching False Positives from Common Title Phrases**
**Verdict: Upheld.**
"How to" and "A Guide to" flooding the recommendations with false positives will erode trust. Fix: add common title prefix stripping before keyword matching. Require matched n-gram to cover at least 60% of the target title's distinctive words. Penalize matches with fewer than 3 distinctive words. Must fix before implementation (Phase 5).

**O7: Cross-Phase Data Contract Gap for API-Push Articles**
**Verdict: Upheld.**
API push articles missing `existingLinks` silently disables quality safeguards 2 and 6. Fix: for `method: "push"` with `bodyFormat: "html"`, run the HTML parser to extract existingLinks. For text/markdown, set `existingLinks` to empty array (not null). The strategy must distinguish empty array (zero links known) from null (data unavailable -- apply conservative defaults). Must fix before implementation.

**O8: Embedding Cost Estimates Not Shown Before Commitment**
**Verdict: Upheld.**
Starting analysis before the user sees the cost estimate violates DECISION-001's intent. Fix: add a `dryRun: true` parameter to `POST /api/analyze` that computes the estimate without creating an AnalysisRun. The analyze page calls with `dryRun` first, shows the estimate, then calls again without `dryRun` after confirmation. This pairs with F4's cancel mechanism. Must fix before implementation.

**O9: No Rollback Strategy for Failed Migrations**
**Verdict: Partially upheld.**
Rollback SQL scripts are good practice but writing them for all 5 migrations before implementation is premature -- the schema may change during development. Fix: decouple migration from build by running `prisma migrate deploy` as a separate CI step, not in `vercel-build`. Add a CI job that tests migrations against a fresh database (using the pgvector Docker image). Rollback scripts can be written as each migration stabilizes. The CI migration test must exist before launch. The decoupling from `vercel-build` must happen before implementation.

**O10: Sitemap Edge Cases Will Cause Silent Data Loss**
**Verdict: Upheld.**
Unbounded recursion and gzip bombs are real risks. Fix: enforce recursion depth limit of 2, decompressed size limit of 50MB, maximum URL count of 10,000 per submission, and deduplicate URLs before creating tasks. Add test cases for each edge case. Must fix before implementation.

---

## Required Plan Modifications

### Consolidated Fixes by Phase

#### Phase 0: Infrastructure & Foundation
1. **[AAP-O3]** Add task: verify Railway pgvector version (>= 0.5.0) with `SELECT extversion`. Document minimum version as deployment prerequisite.
2. **[AAP-O4]** Add task: configure preview database provisioning. Modify `vercel-build` to run `prisma migrate deploy` only on production/staging branches; run `prisma generate` only for previews.
3. **[AAP-O9]** Decouple `prisma migrate deploy` from `vercel-build`. Run migrations as a separate CI step. Add CI job that tests migrations against a fresh pgvector database.
4. **[AAP-F10]** Add `cheerio` to `serverComponentsExternalPackages` in `next.config.js`. Add `@next/bundle-analyzer` to dev dependencies with client bundle size budget.
5. **[AAP-B8]** Create a reusable `verifyCronSecret()` helper in `src/lib/auth/cron-guard.ts` with independent test.

#### Phase 1: Database Schema & Auth
6. **[AAP-B3]** Add partial unique index on `AnalysisRun`: `CREATE UNIQUE INDEX ON "AnalysisRun" ("projectId") WHERE status IN ('pending', 'running')` in Migration 4.
7. **[AAP-B4]** Add `superseded` to the Recommendation status enum. Re-analysis logic must mark previous-run pending recommendations as `superseded` for the same (source, target, strategy) triple.
8. **[AAP-B5]** Implement Prisma client extension in `db.ts` that auto-injects `projectId` into queries on tenant-scoped models (Article, AnalysisRun, Recommendation, StrategyConfig, IngestionJob, IngestionTask). Add cross-tenant access integration tests.
9. **[AAP-F5]** Specify session duration: 30 days, refreshed on authenticated activity. Add global fetch wrapper that intercepts 401 and redirects to `/auth/sign-in?callbackUrl=<current>`.

#### Phase 2: Dashboard Shell & Layout
10. **[AAP-F6]** Add `renderMobileCard` prop to DataTable component from the start. Specify which recommendation fields are visible vs. expandable on mobile.

#### Phase 3: Ingestion Pipeline
11. **[AAP-B1]** Perform IP validation at fetch time in `crawler.ts` using `dns.resolve4()`. Validate every URL in redirect chains. Disable redirects to private IPs.
12. **[AAP-B2]** Increase zombie recovery threshold to 10 minutes. Use compare-and-swap on task completion: `WHERE status = 'processing'`.
13. **[AAP-O1]** Add empty-body detection after parsing (< 50 words when response was 200 with substantial content-length). Add `parseWarning` field to Article model. Surface warnings in ingestion feed and articles table.
14. **[AAP-O7]** For `method: "push"` with `bodyFormat: "html"`, run the HTML parser to extract `existingLinks`. For text/markdown, set `existingLinks` to `[]` (not null). Strategy must distinguish `[]` from `null`.
15. **[AAP-O10]** Sitemap parser: enforce recursion depth limit of 2, decompressed size limit of 50MB, max URL count of 10,000, deduplicate URLs before creating tasks.
16. **[AAP-F7]** Resolve file upload design: either add `method: "upload"` to discriminated union with a `multipart/form-data` API route, or document that files are parsed client-side and submitted via `method: "push"`. Add file size limits (10MB/file, 50MB total).
17. **[AAP-F9]** Add `cancelJob()` to `queue.ts`. Add `POST /api/jobs/[id]/cancel` endpoint. Modify cron worker to skip cancelled job tasks. Add `loading.tsx` for ingest page.

#### Phase 4: Embedding Provider & Cache
18. **[AAP-B6]** Provider switching must atomically clear all embeddings for the project and force full re-embed. Settings endpoint must warn user. Never allow mixed-dimension vectors in the same project.

#### Phase 5: Crosslink Strategy & Analysis
19. **[AAP-B7, B11, O2 consolidated]** Redesign analysis orchestrator for chunked async processing. `POST /api/analyze` creates AnalysisRun and returns 202. A cron job processes runs in batches of 200 articles per invocation. `AnalysisContext.articleIndex` uses `ArticleSummary` (no full body text). Bodies loaded in batches during keyword matching.
20. **[AAP-F4]** Add zombie recovery for analysis runs (running > 10 min -> failed "Analysis timed out"). Add `POST /api/runs/[id]/cancel` endpoint and CancelButton to analysis progress UI.
21. **[AAP-O6]** Strip common title prefixes before keyword matching. Require matched n-gram to cover >= 60% of distinctive words. Penalize matches with < 3 distinctive words.
22. **[AAP-O8]** Add `dryRun: true` parameter to `POST /api/analyze`. Analyze page calls with dryRun first, shows estimate, then confirms.

#### Phase 6: Recommendations UI & Export
23. **[AAP-F1]** Implement polling with exponential backoff on failure (3s -> 6s -> 12s -> 30s cap). Pause polling when tab hidden. Stop on terminal status.
24. **[AAP-F2]** Implement optimistic rollback: revert local state on PATCH failure, show error toast. Disable individual actions on items in pending bulk operation.
25. **[AAP-F3]** HTML-escape anchorText and targetUrl in CopySnippet before assembling `<a>` tag. Add `document.execCommand('copy')` fallback. Add special character test.
26. **[AAP-B12]** Add `updatedAt` optimistic locking on single-item PATCH. Bulk endpoint returns count of updated records.

#### Phase 7: Settings, Polish
27. **[AAP-F8]** Add "Sign in a different way" link on verify-request page. Map `Verification` error to expired-link message. Add troubleshooting tips.
28. **[AAP-F11]** On `OAuthAccountNotLinked`, include provider name in error message.

#### Phase 8: Testing & Hardening
29. **[AAP-B5]** Add cross-tenant access integration tests for every endpoint.
30. **[AAP-B9]** Add basic in-memory rate limiting (token bucket) on `POST /api/articles` (10/min) and `POST /api/analyze` (5/hr).
31. **[AAP-O5]** Add "stuck job/run detector" to health check endpoint.

#### Phase 9: Launch Preparation
32. **[AAP-O5]** Add external cron monitor (Cronitor or similar).
33. **[AAP-O9]** CI job that tests all migrations against fresh pgvector database.

### Deferred to Post-Launch
- **F6 (full):** Detailed mobile card layouts -- DataTable prop is in Phase 2, detailed design is Phase 7.
- **F11 (full):** "Linked accounts" settings page.
- **O1 (full):** Playwright fallback for JS-rendered pages (v1.1).
- **O5 (full):** Comprehensive operational runbooks.
- **B9 (full):** Redis-backed rate limiting with per-endpoint granularity.
- **F1 (full):** Server-Sent Events to replace polling.
