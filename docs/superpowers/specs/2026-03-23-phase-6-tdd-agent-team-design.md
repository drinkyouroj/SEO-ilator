# Phase 6: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Recommendations UI & Export (Implementation Plan Phase 6, tasks 6.1-6.8)
**Prerequisites:** Phase 5 (analysis produces recommendations)

---

## Overview

Phase 6 builds the recommendations display, filters, bulk actions, accept/dismiss workflow, copy-snippet component, CSV/JSON export, analysis page with pre-run summary, runs history, and export UI integration. This spec defines how three domain-specialized agents execute Phase 6 in parallel using git worktree isolation, with TDD discipline applied to all testable code.

---

## Agent Team

### API Agent

**Domain:** Recommendations API routes, validation schemas.

**Tasks:** 6.1, 6.3

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/api/recommendations/route.ts` | 6.1 (GET /api/recommendations: paginated, JSON/CSV/streaming, severity/status/analysisRunId/articleId filters, format=csv with UTF-8 BOM and formula injection prevention, >10K rows returns 202 with export job ID per DECISION-003) |
| `src/app/api/recommendations/[id]/route.ts` | 6.1 (PATCH /api/recommendations/[id]: accept/dismiss with optional reason, [AAP-B12] optimistic locking via updatedAt in request body, WHERE id = ? AND updatedAt = ?, 409 on stale) |
| `src/app/api/recommendations/bulk/route.ts` | 6.1 (PATCH /api/recommendations/bulk: bulk status update max 500 IDs, [AAP-B12] updateMany with projectId filter for tenant isolation, returns { updated: number }) |
| `src/lib/validation/recommendationSchemas.ts` | 6.3 (updateRecommendationSchema, bulkUpdateSchema, recommendationFilterSchema with zod) |

**Notes:**
- [AAP-B12] Single PATCH uses optimistic locking: `WHERE id = ? AND updatedAt = ?`. If 0 rows affected, return 409: "This recommendation was modified since you loaded it. Please refresh."
- [AAP-B12] Bulk PATCH uses `updateMany` with `projectId` filter for tenant isolation. Returns `{ updated: number }` so the client can compare expected vs actual count.
- CSV columns per DECISION-003: source_title, source_url, anchor_text, target_title, target_url, severity, confidence, matching_approach, status, recommendation_id.
- All routes use `scopedPrisma(projectId)` for tenant isolation.

**Verification commands:**
- `npx tsc --noEmit` passes
- `npm run build` succeeds
- Validation schemas parse valid input and reject invalid input

### Export TDD Agent

**Domain:** Test-first development of CSV serializer, JSON serializer, and cell sanitization.

**Task:** 6.2

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/lib/export/csv.test.ts` | 6.2 | RED: 4 failing tests |
| 2 | `src/lib/export/csv.ts` | 6.2 | GREEN: implementation passes all 4 |
| 3 | `tests/lib/export/sanitize.test.ts` | 6.2 | RED: 4 failing tests |
| 4 | `src/lib/export/sanitize.ts` | 6.2 | GREEN: implementation passes all 4 |
| 5 | `src/lib/export/json.ts` | 6.2 | GREEN: JSON serializer (simple, no separate test file) |

**Test cases (from Implementation Plan):**

**`tests/lib/export/csv.test.ts` (4 tests):**
- `it("outputs_correct_column_order")`
- `it("escapes_commas_and_quotes_in_titles")`
- `it("includes_utf8_bom_prefix")`
- `it("handles_empty_result_set")`

**`tests/lib/export/sanitize.test.ts` (4 tests):**
- `it("prefixes_equals_sign_with_quote")`
- `it("prefixes_plus_sign_with_quote")`
- `it("passes_through_normal_text")`
- `it("handles_empty_string")`

**Test environment setup:** CSV tests use mock RecommendationExportRow arrays and verify the output stream content. Sanitize tests are pure function tests with string inputs and expected outputs. No database required.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum per test/implementation pair (red, green).

**Implementation notes:**
- `CsvSerializer.serialize()` returns a `ReadableStream` using `csv-stringify`.
- UTF-8 BOM (`\uFEFF`) is prepended to the stream.
- All cell values pass through `sanitizeCell()` before serialization per DECISION-003.
- `sanitizeCell()` prefixes cells starting with `=`, `+`, `-`, `@` with a single quote for formula injection prevention.
- JSON serializer adds `Content-Disposition` header for download mode.

### UI Agent

**Domain:** React components for article detail, recommendations, copy-snippet, analysis page, runs history, and export integration.

**Tasks:** 6.4, 6.5, 6.6, 6.7, 6.8

**Files created (in strict order):**

| Order | File | Source Task | Commit |
|-------|------|------------|--------|
| 1 | `tests/components/recommendations/CopySnippet.test.tsx` | 6.5 | RED: 6 failing tests |
| 2 | `src/components/recommendations/CopySnippet.tsx` | 6.5 | GREEN: passes all 6 |
| 3 | `tests/components/data/RecommendationCard.test.tsx` | 6.4 | RED: 3 failing tests |
| 4 | `src/components/data/RecommendationCard.tsx` | 6.4 | GREEN: passes all 3 |
| 5 | `src/app/dashboard/articles/[id]/page.tsx` | 6.4 | Article detail page with RecommendationsSection |
| 6 | `src/app/dashboard/analyze/page.tsx` | 6.6 | Analysis page with PreRunSummary, CancelButton, AnalysisProgress |
| 7 | `src/app/dashboard/runs/page.tsx` | 6.7 | Runs history page |
| 8 | (export buttons added to existing pages) | 6.8 | Export UI integration |

**Test cases (from Implementation Plan):**

**`tests/components/recommendations/CopySnippet.test.tsx` (6 tests):**
- `it("generates_correct_html_from_anchor_and_url")`
- `it("updates_html_when_anchor_text_edited")`
- `it("escapes_special_characters_in_anchor_text")` [AAP-F3]
- `it("escapes_special_characters_in_target_url")` [AAP-F3]
- `it("falls_back_to_execCommand_when_clipboard_api_unavailable")` [AAP-F3]
- `it("calls_clipboard_api_on_copy")`

**`tests/components/data/RecommendationCard.test.tsx` (3 tests):**
- `it("renders_severity_badge_correctly")`
- `it("calls_accept_api_on_accept_click")`
- `it("calls_dismiss_api_on_dismiss_click")`

**Test environment setup:** Component tests use `@testing-library/react` with jsdom environment. Mock `navigator.clipboard` for CopySnippet clipboard tests. Mock `document.execCommand` for fallback test [AAP-F3]. Mock fetch for RecommendationCard API calls.

**TDD discipline:** The agent commits CopySnippet and RecommendationCard test files before their implementations. Two commits minimum per test/implementation pair (red, green). Page components (article detail, analyze, runs) are not TDD since they are primarily composition and layout.

**Implementation notes:**
- **Article detail page (6.4):** ArticleDetailPage with ArticleMeta, BodyPreview (collapsible), RecommendationsSection containing RecommendationFilters (severity checkboxes, status tabs), BulkActionBar (appears on selection: "Accept Selected", "Dismiss Selected"), RecommendationCard (repeated) with CopySnippet, Pagination. [AAP-F2] Optimistic UI: accept/dismiss updates state immediately, PATCH in background; on failure revert and show error toast. Disable individual action buttons on items in pending bulk operation. Use `apiFetch` wrapper for 401 detection [AAP-F5]. Empty state: "No recommendations yet. Run an analysis to generate crosslink suggestions." Zero-results state: "No crosslink opportunities found for this run..."
- **CopySnippet (6.5):** Editable anchor text field. Generated HTML: `<a href="[targetUrl]">[anchorText]</a>`. [AAP-F3] HTML-escape both anchorText and targetUrl (`<`, `>`, `"`, `&`, `'`). "Copy HTML" button using `navigator.clipboard.writeText()`. [AAP-F3] `document.execCommand('copy')` fallback for non-HTTPS. [AAP-F10] Source context highlighting uses simple string operations (indexOf + slice), NOT cheerio. Toast on copy.
- **Analysis page (6.6):** AnalysisConfigForm (MatchingApproachSelector, ThresholdSlider, FuzzinessSlider, MaxLinksPerPageInput, ArticleScopeSelector). [AAP-O8] PreRunSummary: calls `POST /api/analyze` with `dryRun: true` for estimate, user must click "Confirm" to start. RunAnalysisButton triggers POST without dryRun. [AAP-F4] CancelButton triggers `POST /api/runs/[id]/cancel`. [AAP-F1] AnalysisProgress polls GET /api/runs/[id] with exponential backoff on failures (5s -> 10s -> 20s -> 30s cap), pauses when tab hidden, stops on completed/failed/cancelled.
- **Runs history page (6.7):** RunsTable (timestamp, article count, strategy badges, rec count, status badge, duration). Running rows auto-update (poll every 5s). Empty state: "You haven't run any analyses yet."
- **Export UI integration (6.8):** "Export CSV" button triggers `window.location = "/api/recommendations?format=csv&articleId=..."`. "Export JSON" button triggers download with `download=true`. Toast: "Exported [X] recommendations as [format]."

**Verification commands:**
- `npx vitest tests/components/recommendations/CopySnippet.test.tsx --run` passes 6/6
- `npx vitest tests/components/data/RecommendationCard.test.tsx --run` passes 3/3
- `npx tsc --noEmit` passes
- `npm run build` succeeds

---

## Execution Flow

```
Phase A ── parallel (all three agents run simultaneously, no blocking deps)
  API Agent         ─► feature/phase-6-api     (own worktree)
  Export TDD Agent  ─► feature/phase-6-export   (own worktree)
  UI Agent          ─► feature/phase-6-ui       (own worktree)

Phase B ── sequential merge into feature/phase-6
  1. Merge feature/phase-6-api    → feature/phase-6
  2. Merge feature/phase-6-export → feature/phase-6
  3. Merge feature/phase-6-ui     → feature/phase-6
  4. Integration verification pass
  5. PR feature/phase-6 → develop
```

### Merge Order Rationale

API Agent first because it creates the recommendation routes and validation schemas that UI Agent's pages call (though UI Agent can mock these during development, the real routes must exist for integration). Export TDD Agent second because its serializers are used by the API routes for CSV/JSON response formatting -- the API Agent creates the route handlers that call `CsvSerializer`, so export must merge before integration testing. UI Agent last because its components are the consumers: they import from API routes (via fetch) and display data formatted by the export modules.

### Expected Conflicts

- **No file overlap between agents:** API Agent owns `app/api/recommendations/` and `lib/validation/recommendationSchemas.ts`. Export TDD Agent owns `lib/export/` and `tests/lib/export/`. UI Agent owns `components/recommendations/`, `components/data/`, `app/dashboard/articles/[id]/`, `app/dashboard/analyze/`, `app/dashboard/runs/`, and `tests/components/`.
- **Import dependencies:** API Agent's `GET /api/recommendations` route with `format=csv` imports `CsvSerializer` from `lib/export/csv.ts` (Export TDD Agent). This is a cross-agent import that must be verified during integration. API Agent can stub the import during development.
- **No package.json conflicts:** All dependencies (`csv-stringify`, `@testing-library/react`, etc.) were installed in Phase 0.

---

## Integration Verification

After all three branches merge into `feature/phase-6`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| CSV tests pass | `npx vitest tests/lib/export/csv.test.ts --run` | 4/4 passing |
| Sanitize tests pass | `npx vitest tests/lib/export/sanitize.test.ts --run` | 4/4 passing |
| CopySnippet tests pass | `npx vitest tests/components/recommendations/CopySnippet.test.tsx --run` | 6/6 passing |
| RecommendationCard tests pass | `npx vitest tests/components/data/RecommendationCard.test.tsx --run` | 3/3 passing |
| All tests pass | `npx vitest --run` | All passing (including prior phases) |
| Build succeeds | `npm run build` | Exit 0 |

### Manual

| Check | Location |
|-------|----------|
| GET /api/recommendations supports JSON and CSV format params | `src/app/api/recommendations/route.ts` |
| PATCH /api/recommendations/[id] uses optimistic locking [AAP-B12] | `src/app/api/recommendations/[id]/route.ts` |
| Bulk PATCH with tenant isolation [AAP-B12] | `src/app/api/recommendations/bulk/route.ts` |
| Zod validation schemas for update, bulk update, filter | `src/lib/validation/recommendationSchemas.ts` |
| CsvSerializer streams with UTF-8 BOM | `src/lib/export/csv.ts` |
| sanitizeCell prefixes formula-injection characters | `src/lib/export/sanitize.ts` |
| JSON serializer adds Content-Disposition for download | `src/lib/export/json.ts` |
| CopySnippet escapes HTML in anchor and URL [AAP-F3] | `src/components/recommendations/CopySnippet.tsx` |
| CopySnippet clipboard fallback [AAP-F3] | `src/components/recommendations/CopySnippet.tsx` |
| Article detail page with optimistic UI [AAP-F2] | `src/app/dashboard/articles/[id]/page.tsx` |
| Analysis page with PreRunSummary [AAP-O8] and CancelButton [AAP-F4] | `src/app/dashboard/analyze/page.tsx` |
| Analysis progress with exponential backoff [AAP-F1] | `src/app/dashboard/analyze/page.tsx` |
| Runs history page with auto-updating running rows | `src/app/dashboard/runs/page.tsx` |
| Export buttons on article detail and recommendations pages | 6.8 integration |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] Recommendations display with severity badges, anchor text, source context
- [ ] Accept/dismiss updates recommendation status
- [ ] Bulk accept/dismiss works for up to 500 items
- [ ] Severity and status filters work
- [ ] CopySnippet generates correct HTML and copies to clipboard
- [ ] CSV export downloads with correct columns, BOM, and formula sanitization
- [ ] JSON export downloads with Content-Disposition header
- [ ] Analysis page shows pre-run summary with embedding estimate
- [ ] Analysis progress polls and shows completion
- [ ] Runs history shows all past runs with status
- [ ] [AAP-F2] Optimistic UI rollback works on PATCH failure
- [ ] [AAP-F3] CopySnippet escapes special characters in anchor text and URL
- [ ] [AAP-F3] CopySnippet fallback works in non-HTTPS contexts
- [ ] [AAP-B12] Concurrent update on same recommendation returns 409
- [ ] [AAP-F4] Cancel button stops in-progress analysis
- [ ] [AAP-O8] Dry run shows estimate before starting analysis
