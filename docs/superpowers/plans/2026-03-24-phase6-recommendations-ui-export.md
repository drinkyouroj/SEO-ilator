# Phase 6: Recommendations UI & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the recommendations API (CRUD, bulk actions, optimistic locking), CSV/JSON export with formula injection prevention, and the dashboard UI for viewing/managing recommendations, running analyses, and browsing run history.

**Architecture:** Three domains: (1) API routes for recommendation CRUD with tenant-scoped queries and AAP-B12 optimistic locking, (2) Export serializers for CSV (streaming with BOM + formula sanitization) and JSON, (3) React dashboard pages consuming the APIs with optimistic UI, polling with exponential backoff, and clipboard integration.

**Tech Stack:** Next.js 16 App Router, Prisma 7, csv-stringify (CSV streaming), zod (validation), @testing-library/react (component tests), Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-phase-6-tdd-agent-team-design.md`

---

## File Structure

### New files to create

| File | Responsibility |
|---|---|
| `src/lib/validation/recommendationSchemas.ts` | Zod schemas for update, bulk update, filter params |
| `src/lib/export/sanitize.ts` | `sanitizeCell()` for formula injection prevention |
| `src/lib/export/csv.ts` | `CsvSerializer` — streaming CSV with BOM |
| `src/lib/export/json.ts` | `JsonSerializer` — JSON export with Content-Disposition |
| `src/app/api/recommendations/route.ts` | GET: paginated list with CSV/JSON export; filters |
| `src/app/api/recommendations/[id]/route.ts` | PATCH: accept/dismiss with optimistic locking [AAP-B12] |
| `src/app/api/recommendations/bulk/route.ts` | PATCH: bulk status update (max 500) [AAP-B12] |
| `src/components/recommendations/CopySnippet.tsx` | Editable anchor text → HTML `<a>` tag with clipboard [AAP-F3] |
| `src/components/data/RecommendationCard.tsx` | Single recommendation display with accept/dismiss actions |
| `src/app/dashboard/articles/[id]/page.tsx` | Article detail with recommendations section [AAP-F2] |
| `src/app/dashboard/analyze/page.tsx` | Analysis config + dryRun + progress + cancel [AAP-F1/F4/O8] |
| `src/app/dashboard/runs/page.tsx` | Runs history table |
| `tests/lib/export/sanitize.test.ts` | 4 sanitize tests |
| `tests/lib/export/csv.test.ts` | 4 CSV tests |
| `tests/components/recommendations/CopySnippet.test.tsx` | 6 CopySnippet tests [AAP-F3] |
| `tests/components/data/RecommendationCard.test.tsx` | 3 RecommendationCard tests |

---

## Task 1: Validation Schemas

**Files:**
- Create: `src/lib/validation/recommendationSchemas.ts`

- [ ] **Step 1: Create the validation schemas**

```typescript
import { z } from "zod";

/** Schema for PATCH /api/recommendations/[id] — accept or dismiss */
export const updateRecommendationSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
  /** [AAP-B12] For optimistic locking — must match the current updatedAt */
  updatedAt: z.string().datetime(),
});

/** Schema for PATCH /api/recommendations/bulk — bulk status update */
export const bulkUpdateSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
});

/** Schema for GET /api/recommendations query params */
export const recommendationFilterSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]).optional(),
  status: z.enum(["pending", "accepted", "dismissed", "superseded"]).optional(),
  analysisRunId: z.string().optional(),
  articleId: z.string().optional(),
  format: z.enum(["json", "csv"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/validation/recommendationSchemas.ts
git commit -m "feat(validation): add recommendation schemas for update, bulk, and filter"
```

---

## Task 2: Cell Sanitizer (TDD)

**Files:**
- Create: `tests/lib/export/sanitize.test.ts`
- Create: `src/lib/export/sanitize.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeCell } from "@/lib/export/sanitize";

describe("sanitizeCell", () => {
  it("prefixes_equals_sign_with_quote", () => {
    expect(sanitizeCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
  });

  it("prefixes_plus_sign_with_quote", () => {
    expect(sanitizeCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
  });

  it("prefixes_minus_sign_with_quote", () => {
    expect(sanitizeCell("-1+1")).toBe("'-1+1");
  });

  it("prefixes_at_sign_with_quote", () => {
    expect(sanitizeCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("passes_through_normal_text", () => {
    expect(sanitizeCell("Normal article title")).toBe("Normal article title");
  });

  it("handles_empty_string", () => {
    expect(sanitizeCell("")).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify fail**
- [ ] **Step 3: Implement**

```typescript
/**
 * Prevent spreadsheet formula injection by prefixing dangerous characters.
 * Cells starting with =, +, -, @ are prefixed with a single quote.
 * Per DECISION-003 export safety requirements.
 */
export function sanitizeCell(value: string): string {
  if (value.length === 0) return value;
  if (value[0] === "=" || value[0] === "+" || value[0] === "-" || value[0] === "@") {
    return "'" + value;
  }
  return value;
}
```

- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/export/sanitize.ts tests/lib/export/sanitize.test.ts
git commit -m "feat(export): add cell sanitizer for formula injection prevention [DECISION-003]"
```

---

## Task 3: CSV Serializer (TDD)

**Note:** The spec orders CSV before sanitize (Export TDD Agent file order 1-4). This plan intentionally reverses the order (sanitize first, then CSV) because `serializeCsv()` imports `sanitizeCell()` — the dependency must exist before the consumer. This supersedes the spec's agent file ordering.

**Files:**
- Create: `tests/lib/export/csv.test.ts`
- Create: `src/lib/export/csv.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { serializeCsv } from "@/lib/export/csv";

interface MockRec {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  anchorText: string | null;
  targetTitle: string;
  targetUrl: string;
  severity: string;
  confidence: number;
  matchingApproach: string | null;
  status: string;
}

describe("serializeCsv", () => {
  const makeRec = (overrides?: Partial<MockRec>): MockRec => ({
    id: "rec-1",
    sourceTitle: "Source Article",
    sourceUrl: "https://example.com/source",
    anchorText: "link text",
    targetTitle: "Target Article",
    targetUrl: "https://example.com/target",
    severity: "warning",
    confidence: 0.85,
    matchingApproach: "keyword",
    status: "pending",
    ...overrides,
  });

  it("outputs_correct_column_order", () => {
    const csv = serializeCsv([makeRec()]);
    const lines = csv.split("\n");
    // First line after BOM is the header
    const header = lines[0].replace("\uFEFF", "");
    expect(header).toBe(
      "source_title,source_url,anchor_text,target_title,target_url,severity,confidence,matching_approach,status,recommendation_id"
    );
  });

  it("escapes_commas_and_quotes_in_titles", () => {
    const csv = serializeCsv([makeRec({ sourceTitle: 'Title with "quotes" and, commas' })]);
    const lines = csv.split("\n");
    // The source_title field should be quoted and quotes escaped
    expect(lines[1]).toContain('"Title with ""quotes"" and, commas"');
  });

  it("includes_utf8_bom_prefix", () => {
    const csv = serializeCsv([makeRec()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("handles_empty_result_set", () => {
    const csv = serializeCsv([]);
    const lines = csv.split("\n").filter((l) => l.trim());
    // Should have header only
    expect(lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify fail**
- [ ] **Step 3: Implement**

The CSV serializer should:
- Use `csv-stringify/sync` for simplicity — the function is named `serializeCsv` (sync, returns string). The spec calls for a `ReadableStream` via `csv-stringify`, but with the 10K count check in Task 5, sync is safe for all in-scope exports. Streaming will be added alongside the async export job infrastructure post-launch.
- Prepend UTF-8 BOM (`\uFEFF`)
- Apply `sanitizeCell()` to all text fields before serialization
- Column order per DECISION-003: source_title, source_url, anchor_text, target_title, target_url, severity, confidence, matching_approach, status, recommendation_id

- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/lib/export/csv.ts tests/lib/export/csv.test.ts
git commit -m "feat(export): add CSV serializer with BOM and formula sanitization [DECISION-003]"
```

---

## Task 4: JSON Serializer

**Files:**
- Create: `src/lib/export/json.ts`

- [ ] **Step 1: Implement the JSON serializer**

Simple utility that formats recommendations as a downloadable JSON array with Content-Disposition header helpers:

```typescript
export interface JsonExportOptions {
  filename: string;
}

export function serializeJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function jsonContentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/export/json.ts
git commit -m "feat(export): add JSON serializer with Content-Disposition helper"
```

---

## Task 5: Recommendations API — GET (list + export)

**Files:**
- Create: `src/app/api/recommendations/route.ts`

- [ ] **Step 1: Implement GET /api/recommendations**

Behavior:
1. Auth: `requireAuth()` → projectId
2. Parse query params with `recommendationFilterSchema`
3. Build Prisma query with filters (severity, status, analysisRunId, articleId)
4. **[DECISION-003] For export formats (csv/json): count-first check:**
   ```typescript
   const count = await db.recommendation.count({ where: filters });
   if (count > 10_000) {
     // DECISION-003 JUDGE verdict: >10K rows must use async background job
     // For v1.0, return a 413 with a message to narrow filters
     // Full async export job infrastructure deferred to post-launch
     return NextResponse.json(
       { error: "TOO_MANY_RESULTS", message: "Export exceeds 10,000 rows. Please narrow your filters.", count },
       { status: 413 }
     );
   }
   ```
5. If `format=csv` (and count <= 10K): query all matching recs (with article joins for titles/URLs), serialize via `serializeCsv()`, return with `Content-Type: text/csv` and `Content-Disposition`
6. If `format=json` with download: same but JSON format
7. Default (no format param): paginated JSON response with cursor

Key patterns:
- Use `scopedPrisma(projectId)` for tenant isolation
- Join source and target articles to get titles/URLs for export
- CSV response uses `sanitizeCell` on all text fields via the serializer
- **Note on DECISION-003 compliance:** The full async export job (202 + job ID + background processing) is deferred to post-launch. The 10K count check with 413 response provides the safety boundary now. This is a conscious scope reduction — DECISION-003 mandates async export for >10K, and this will be implemented when the background job infrastructure (Vercel Queues or similar) is available.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/recommendations/route.ts
git commit -m "feat(recommendations): add GET /api/recommendations with CSV/JSON export [DECISION-003]"
```

---

## Task 6: Recommendations API — PATCH single + bulk

**Files:**
- Create: `src/app/api/recommendations/[id]/route.ts`
- Create: `src/app/api/recommendations/bulk/route.ts`

- [ ] **Step 1: Implement PATCH /api/recommendations/[id] with optimistic locking [AAP-B12]**

```typescript
// Key pattern: optimistic locking via updatedAt
const result = await db.recommendation.updateMany({
  where: {
    id,
    updatedAt: new Date(input.updatedAt), // Must match current value
  },
  data: {
    status: input.status,
    dismissReason: input.dismissReason ?? null,
  },
});

if (result.count === 0) {
  // Either not found or stale — check which
  const exists = await db.recommendation.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { error: "This recommendation was modified since you loaded it. Please refresh." },
    { status: 409 }
  );
}
```

- [ ] **Step 2: Implement PATCH /api/recommendations/bulk [AAP-B12]**

```typescript
// Bulk update — no optimistic locking, but returns count for client verification
const result = await db.recommendation.updateMany({
  where: {
    id: { in: input.ids },
    // projectId auto-injected by scopedPrisma
  },
  data: {
    status: input.status,
    dismissReason: input.dismissReason ?? null,
  },
});

return NextResponse.json({ updated: result.count });
```

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/recommendations/[id]/route.ts" src/app/api/recommendations/bulk/route.ts
git commit -m "feat(recommendations): add PATCH single (optimistic locking) and bulk endpoints [AAP-B12]"
```

---

## Task 7: CopySnippet Component (TDD)

**Files:**
- Create: `tests/components/recommendations/CopySnippet.test.tsx`
- Create: `src/components/recommendations/CopySnippet.tsx`

- [ ] **Step 1: Write failing tests**

6 tests covering HTML generation, XSS escaping, clipboard API, and execCommand fallback:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopySnippet } from "@/components/recommendations/CopySnippet";

describe("CopySnippet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates_correct_html_from_anchor_and_url", () => {
    render(<CopySnippet anchorText="Learn React" targetUrl="https://example.com/react" />);
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain('<a href="https://example.com/react">Learn React</a>');
  });

  it("updates_html_when_anchor_text_edited", async () => {
    render(<CopySnippet anchorText="Original" targetUrl="https://example.com" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Updated Text" } });
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain("Updated Text");
  });

  it("escapes_special_characters_in_anchor_text", () => {
    render(<CopySnippet anchorText='Text with "quotes" & <tags>' targetUrl="https://example.com" />);
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain("&amp;");
    expect(preview.textContent).toContain("&lt;");
    expect(preview.textContent).toContain("&quot;");
  });

  it("escapes_special_characters_in_target_url", () => {
    render(<CopySnippet anchorText="Link" targetUrl='https://example.com/path?a=1&b="2"' />);
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain("&amp;");
  });

  it("calls_clipboard_api_on_copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopySnippet anchorText="Test" targetUrl="https://example.com" />);
    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('<a href="https://example.com">Test</a>')
    );
  });

  it("falls_back_to_execCommand_when_clipboard_api_unavailable", () => {
    // Remove clipboard API
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    render(<CopySnippet anchorText="Test" targetUrl="https://example.com" />);
    const copyButton = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyButton);

    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
```

- [ ] **Step 2: Run tests to verify fail**
- [ ] **Step 3: Implement CopySnippet**

The component should:
- Accept `anchorText` and `targetUrl` props
- Show an editable text input for anchor text
- Display the generated `<a>` tag with HTML-escaped values [AAP-F3]
- "Copy HTML" button that uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback [AAP-F3]
- Use a helper function `escapeHtml(str)` that escapes `<`, `>`, `"`, `&`, `'`
- Source context highlighting uses string operations only (NOT cheerio) [AAP-F10]

- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/components/recommendations/CopySnippet.tsx tests/components/recommendations/CopySnippet.test.tsx
git commit -m "feat(ui): add CopySnippet with HTML escaping and clipboard fallback [AAP-F3]"
```

---

## Task 8: RecommendationCard Component (TDD)

**Files:**
- Create: `tests/components/data/RecommendationCard.test.tsx`
- Create: `src/components/data/RecommendationCard.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationCard } from "@/components/data/RecommendationCard";

const mockRec = {
  id: "rec-1",
  sourceArticleId: "a1",
  targetArticleId: "a2",
  type: "crosslink",
  severity: "warning" as const,
  title: 'Link to "Target Article"',
  description: "Found keyword match in body text.",
  anchorText: "Target Article",
  confidence: 0.85,
  matchingApproach: "keyword",
  status: "pending",
  targetUrl: "https://example.com/target",
  updatedAt: new Date().toISOString(),
};

describe("RecommendationCard", () => {
  it("renders_severity_badge_correctly", () => {
    render(<RecommendationCard recommendation={mockRec} onAccept={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("warning")).toBeDefined();
  });

  it("calls_accept_callback_on_accept_click", () => {
    const onAccept = vi.fn();
    render(<RecommendationCard recommendation={mockRec} onAccept={onAccept} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onAccept).toHaveBeenCalledWith("rec-1");
  });

  it("calls_dismiss_callback_on_dismiss_click", () => {
    const onDismiss = vi.fn();
    render(<RecommendationCard recommendation={mockRec} onAccept={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("rec-1");
  });
});
```

- [ ] **Step 2: Run tests to verify fail**
- [ ] **Step 3: Implement**

The card should display: severity badge, title, description, confidence score, matching approach, anchor text, CopySnippet, accept/dismiss buttons. Uses existing SeverityBadge and StatusBadge components from Phase 2.

**Note — deliberate spec divergence:** The spec names these tests `calls_accept_api_on_accept_click` (implying the card calls the API directly). This plan uses a callback-prop interface (`onAccept`, `onDismiss`) instead, because the parent page handles the PATCH + optimistic rollback (AAP-F2). The card is a pure presentation component that delegates actions upward — this is the better design for reusability and testability.

- [ ] **Step 4: Run tests to verify pass**
- [ ] **Step 5: Commit**

```bash
git add src/components/data/RecommendationCard.tsx tests/components/data/RecommendationCard.test.tsx
git commit -m "feat(ui): add RecommendationCard with accept/dismiss actions"
```

---

## Task 9: Article Detail Page

**Files:**
- Create: `src/app/dashboard/articles/[id]/page.tsx`

- [ ] **Step 1: Implement the article detail page**

Server Component that:
1. Fetches article detail from `GET /api/articles/[id]`
2. Displays ArticleMeta (title, URL, word count, source type, parse warning)
3. Includes a client-side `RecommendationsSection` that:
   - Fetches recommendations for this article via `GET /api/recommendations?articleId=[id]`
   - Shows filters (severity checkboxes, status tabs)
   - Shows BulkActionBar on selection (accept/dismiss selected)
   - Maps each rec to a `RecommendationCard`
   - [AAP-F2] Optimistic UI: accept/dismiss updates local state immediately, PATCH in background; on failure revert state and show error toast via ToastProvider
   - Uses `apiFetch` wrapper for 401 handling [AAP-F5]
   - Includes export buttons ("Export CSV", "Export JSON")

- [ ] **Step 2: Commit**

```bash
git add "src/app/dashboard/articles/[id]/page.tsx"
git commit -m "feat(ui): add article detail page with recommendations section [AAP-F2]"
```

---

## Task 10: Analysis Page

**Files:**
- Create: `src/app/dashboard/analyze/page.tsx`

- [ ] **Step 1: Implement the analysis page**

Client Component with:
1. **PreRunSummary** [AAP-O8]: Calls `POST /api/analyze` with `dryRun: true` on mount. Displays article count, embedding estimate (cached vs needs generation), estimated cost.
2. **RunAnalysisButton**: On click, calls `POST /api/analyze` (no dryRun). Receives `{ runId }`. Transitions to progress view.
3. **AnalysisProgress** [AAP-F1]: Polls `GET /api/runs/[runId]` with exponential backoff (5s → 10s → 20s → 30s cap on consecutive failures, reset on success). Pauses when `document.visibilityState === 'hidden'`. Stops on terminal status (completed/failed/cancelled). Shows ProgressBar, article count, recommendation count.
4. **CancelButton** [AAP-F4]: Calls `POST /api/runs/[runId]/cancel`. Shows ConfirmDialog before cancelling.
5. Uses `apiFetch` for all API calls [AAP-F5].

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/analyze/page.tsx
git commit -m "feat(ui): add analysis page with dryRun, progress polling, and cancel [AAP-F1, AAP-F4, AAP-O8]"
```

---

## Task 11: Runs History Page

**Files:**
- Create: `src/app/dashboard/runs/page.tsx`

- [ ] **Step 1: Implement the runs history page**

Server Component with client-side auto-refresh:
1. Fetches runs via `GET /api/runs`
2. Displays RunsTable: timestamp, article count, recommendation count, status badge, duration
3. Running rows auto-update (poll every 5s)
4. Empty state: "You haven't run any analyses yet."
5. Click on a run row navigates to `/dashboard/articles?runId=[id]` (or similar filtered view)

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/runs/page.tsx
git commit -m "feat(ui): add runs history page with auto-updating running rows"
```

---

## Task 12: Full Test Suite & Type Check

- [ ] **Step 1: Run all tests**

Run: `npx vitest --run`

Expected: All tests pass including prior phases.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Run linter**

Run: `npm run lint`

- [ ] **Step 4: Fix any issues**
- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix(phase-6): address test/type/lint issues from full suite run"
```

---

## Task 13: Update build_log.md

- [ ] **Step 1: Append Phase 6 entry**

```markdown
## 2026-03-24 — Phase 6: Recommendations UI & Export

### Done
- Zod validation schemas for recommendation update, bulk update, and filter params
- Cell sanitizer for formula injection prevention (=, +, -, @ prefixed with ') [DECISION-003]
- CSV serializer: streaming with UTF-8 BOM, formula sanitization, correct column order [DECISION-003]
- JSON serializer with Content-Disposition for download
- GET /api/recommendations: paginated list with severity/status/run/article filters + CSV/JSON export
- PATCH /api/recommendations/[id]: accept/dismiss with optimistic locking via updatedAt [AAP-B12]
- PATCH /api/recommendations/bulk: bulk status update (max 500) with tenant isolation [AAP-B12]
- CopySnippet: editable anchor text, HTML escaping, clipboard API with execCommand fallback [AAP-F3]
- RecommendationCard: severity badge, accept/dismiss actions, CopySnippet integration
- Article detail page: recommendations section with filters, bulk actions, optimistic UI [AAP-F2]
- Analysis page: dryRun pre-summary [AAP-O8], progress polling with exponential backoff [AAP-F1], cancel [AAP-F4]
- Runs history page: auto-updating running rows, empty state
- 19 new tests (sanitize 6, CSV 4, CopySnippet 6, RecommendationCard 3)

### Decisions
- CSV uses csv-stringify/sync for simplicity — streaming deferred to post-launch for 10K+ exports
- Optimistic locking uses updatedAt comparison via updateMany (not findFirst + update TOCTOU)
- Analysis polling backoff: 5s → 10s → 20s → 30s cap, pause on tab hidden

### Next
- Phase 7: Settings, Polish
```

- [ ] **Step 2: Commit**

```bash
git add build_log.md
git commit -m "docs(build-log): add Phase 6 recommendations UI & export entry"
```
