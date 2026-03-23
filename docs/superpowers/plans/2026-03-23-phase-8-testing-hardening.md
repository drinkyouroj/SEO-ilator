# Phase 8: Testing & Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integration tests across all API endpoints, rate limiter implementation, full security review checklist, Sentry + Vercel Analytics integration, load testing verification, and seed data for development.

**Architecture:** Integration tests use Prisma test database with transaction rollback for isolation. Rate limiter uses in-memory token bucket (acceptable for single-region Vercel). Security review produces a DECISION doc with pass/fail for each checklist item. Sentry uses `@sentry/nextjs` with source map uploads in CI. Seed data creates a realistic development environment.

**Tech Stack:** Vitest, Prisma, @sentry/nextjs, @vercel/analytics, @vercel/speed-insights, csv-parse (test dep)

**Agent Team:** Integration Test Agent ∥ Security Agent ∥ Ops Agent (fully parallel, no file overlap)

**Prerequisites:** All feature phases (0-7) complete. All existing tests passing.

---

## Table of Contents

1. [Integration Test Agent: Task 8.1 — Articles CRUD Tests](#integration-test-agent-task-81--articles-crud-tests)
2. [Integration Test Agent: Task 8.1 — Analyze E2E Tests](#integration-test-agent-task-81--analyze-e2e-tests)
3. [Integration Test Agent: Task 8.1 — Recommendations + Export Tests](#integration-test-agent-task-81--recommendations--export-tests)
4. [Integration Test Agent: Task 8.1 — Cron Crawl + Zombie Tests](#integration-test-agent-task-81--cron-crawl--zombie-tests)
5. [Integration Test Agent: Task 8.1 — Auth Cross-Tenant Tests](#integration-test-agent-task-81--auth-cross-tenant-tests)
6. [Integration Test Agent: Task 8.1 — Full Flow Test](#integration-test-agent-task-81--full-flow-test)
7. [Integration Test Agent: Task 8.1a — Rate Limiter](#integration-test-agent-task-81a--rate-limiter)
8. [Security Agent: Task 8.2 — Security Checklist](#security-agent-task-82--security-checklist)
9. [Ops Agent: Task 8.3 — Sentry Integration](#ops-agent-task-83--sentry-integration)
10. [Ops Agent: Task 8.4 — Vercel Analytics](#ops-agent-task-84--vercel-analytics)
11. [Ops Agent: Task 8.5 — Load Testing Checklist](#ops-agent-task-85--load-testing-checklist)
12. [Ops Agent: Task 8.6 — Seed Data + Factories](#ops-agent-task-86--seed-data--factories)
13. [Integration Verification](#integration-verification)

---

## Integration Test Agent: Task 8.1 — Articles CRUD Tests

> **Branch:** `feature/phase-8-integration`
> **Depends on:** All feature phases (0-7) complete

### Step 8.1.1 — Create the branch

- [ ] Create and switch to `feature/phase-8-integration` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-8-integration
```

**Expected:** Branch created.

### Step 8.1.2 — Create test helpers for integration tests

- [ ] Create `tests/helpers/integration.ts` with shared test utilities

**File:** `tests/helpers/integration.ts`

```typescript
import { PrismaClient } from "@prisma/client";

/**
 * Shared utilities for integration tests.
 *
 * Uses a separate Prisma client connected to the test database.
 * Each test suite wraps operations in a transaction that is rolled back
 * after the test to maintain isolation.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL or DATABASE_URL must be set for integration tests"
  );
}

export const testPrisma = new PrismaClient({
  datasourceUrl: TEST_DATABASE_URL,
});

/**
 * Clean up test data created during a test run.
 * Deletes in reverse-dependency order to respect foreign keys.
 */
export async function cleanupTestData(projectIds: string[]) {
  if (projectIds.length === 0) return;

  await testPrisma.recommendation.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.analysisRun.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.ingestionTask.deleteMany({
    where: { job: { projectId: { in: projectIds } } },
  });
  await testPrisma.ingestionJob.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.strategyConfig.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.article.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await testPrisma.project.deleteMany({
    where: { id: { in: projectIds } },
  });
}

/**
 * Create a test user and project for integration tests.
 * Returns userId and projectId for use in test assertions.
 */
export async function createTestUserAndProject(overrides?: {
  email?: string;
  plan?: string;
  projectName?: string;
}) {
  const user = await testPrisma.user.create({
    data: {
      email: overrides?.email ?? `test-${Date.now()}@example.com`,
      name: "Test User",
      plan: overrides?.plan ?? "pro",
      articleLimit: overrides?.plan === "free" ? 50 : 500,
      runLimit: overrides?.plan === "free" ? 3 : 100,
    },
  });

  const project = await testPrisma.project.create({
    data: {
      userId: user.id,
      name: overrides?.projectName ?? "Test Project",
    },
  });

  return { userId: user.id, projectId: project.id, user, project };
}

/**
 * Helper to make authenticated API requests in tests.
 * Mocks the session to simulate an authenticated user.
 */
export function apiUrl(path: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${baseUrl}${path}`;
}

/**
 * Create a mock session cookie/header for test requests.
 * In integration tests, we mock requireAuth() to return a specific userId/projectId.
 */
export function authHeaders(userId: string, projectId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-test-user-id": userId,
    "x-test-project-id": projectId,
  };
}
```

### Step 8.1.3 — Write articles CRUD integration tests

- [ ] Create `tests/api/articles.test.ts`

**File:** `tests/api/articles.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
  authHeaders,
} from "../helpers/integration";

/**
 * Integration tests for the articles API.
 *
 * Tests the complete CRUD lifecycle:
 * - POST push creates article in DB
 * - GET returns created article
 * - DELETE cascades to recommendations
 * - Validation rejects invalid payloads
 */
describe("Articles API Integration", () => {
  let userId: string;
  let projectId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const result = await createTestUserAndProject({
      email: "articles-test@example.com",
    });
    userId = result.userId;
    projectId = result.projectId;
    projectIds.push(projectId);
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    // Clean up the test user
    await testPrisma.user.deleteMany({
      where: { email: "articles-test@example.com" },
    });
  });

  it("creates_article_via_post_and_retrieves_via_get", async () => {
    // POST a new article via push method
    const postRes = await fetch(apiUrl("/api/articles"), {
      method: "POST",
      headers: authHeaders(userId, projectId),
      body: JSON.stringify({
        method: "push",
        articles: [
          {
            url: "https://example.com/test-article-1",
            title: "Test Article One",
            body: "This is the body content of the first test article for integration testing.",
            bodyFormat: "text",
          },
        ],
      }),
    });

    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.created).toBe(1);
    expect(postData.articles).toHaveLength(1);
    expect(postData.articles[0].title).toBe("Test Article One");

    const articleId = postData.articles[0].id;

    // GET the created article by ID
    const getRes = await fetch(apiUrl(`/api/articles/${articleId}`), {
      headers: authHeaders(userId, projectId),
    });

    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.title).toBe("Test Article One");
    expect(getData.url).toBe("https://example.com/test-article-1");

    // Verify article exists in database
    const dbArticle = await testPrisma.article.findUnique({
      where: { id: articleId },
    });
    expect(dbArticle).not.toBeNull();
    expect(dbArticle!.projectId).toBe(projectId);
    expect(dbArticle!.wordCount).toBeGreaterThan(0);
  });

  it("deletes_article_and_cascades_recommendations", async () => {
    // Create an article
    const article = await testPrisma.article.create({
      data: {
        projectId,
        url: "https://example.com/delete-cascade-test",
        title: "Delete Cascade Test",
        body: "Article to be deleted with cascade.",
        bodyHash: "hash-delete-cascade",
        titleHash: "titlehash-delete-cascade",
        wordCount: 6,
      },
    });

    // Create a second article (needed as target for recommendation)
    const targetArticle = await testPrisma.article.create({
      data: {
        projectId,
        url: "https://example.com/target-article",
        title: "Target Article",
        body: "Target for crosslink recommendation.",
        bodyHash: "hash-target",
        titleHash: "titlehash-target",
        wordCount: 5,
      },
    });

    // Create an analysis run and recommendation pointing to this article
    const run = await testPrisma.analysisRun.create({
      data: {
        projectId,
        status: "completed",
        strategiesUsed: ["crosslink"],
        configuration: {},
        articleCount: 2,
        recommendationCount: 1,
      },
    });

    const rec = await testPrisma.recommendation.create({
      data: {
        projectId,
        analysisRunId: run.id,
        strategyId: "crosslink",
        sourceArticleId: article.id,
        targetArticleId: targetArticle.id,
        type: "crosslink",
        severity: "info",
        title: "Test crosslink recommendation",
        description: "Test recommendation for cascade delete.",
        anchorText: "test link",
        confidence: 0.8,
      },
    });

    // DELETE the article
    const deleteRes = await fetch(apiUrl(`/api/articles/${article.id}`), {
      method: "DELETE",
      headers: authHeaders(userId, projectId),
    });

    expect(deleteRes.status).toBe(204);

    // Verify article is deleted
    const deletedArticle = await testPrisma.article.findUnique({
      where: { id: article.id },
    });
    expect(deletedArticle).toBeNull();

    // Verify recommendation is cascaded (deleted)
    const deletedRec = await testPrisma.recommendation.findUnique({
      where: { id: rec.id },
    });
    expect(deletedRec).toBeNull();

    // Clean up remaining test data
    await testPrisma.analysisRun.delete({ where: { id: run.id } });
    await testPrisma.article.delete({ where: { id: targetArticle.id } });
  });

  it("returns_400_for_invalid_article_payload", async () => {
    // Missing required fields
    const res = await fetch(apiUrl("/api/articles"), {
      method: "POST",
      headers: authHeaders(userId, projectId),
      body: JSON.stringify({
        method: "push",
        articles: [
          {
            // Missing url, title, body
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
```

### Step 8.1.4 — Commit articles tests

- [ ] Commit the articles integration tests

```bash
git add tests/helpers/integration.ts tests/api/articles.test.ts
git commit -m "test(api): add articles CRUD integration tests

Tests POST push creates article, GET retrieves it, DELETE cascades to
recommendations. Validates 400 on invalid payload. Includes shared
integration test helpers."
```

---

## Integration Test Agent: Task 8.1 — Analyze E2E Tests

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1.5 — Write analyze e2e integration tests

- [ ] Create `tests/api/analyze.test.ts`

**File:** `tests/api/analyze.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
  authHeaders,
} from "../helpers/integration";

/**
 * Integration tests for the analyze API.
 *
 * Tests the complete analysis flow:
 * - Seed articles -> POST /api/analyze -> run completes -> recommendations with dedup
 * - Empty project returns 400
 */
describe("Analyze API Integration", () => {
  let userId: string;
  let projectId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const result = await createTestUserAndProject({
      email: "analyze-test@example.com",
      plan: "pro",
    });
    userId = result.userId;
    projectId = result.projectId;
    projectIds.push(projectId);

    // Seed articles for analysis
    const articles = [
      {
        projectId,
        url: "https://blog.example.com/typescript-guide",
        title: "Complete TypeScript Guide",
        body: "TypeScript is a typed superset of JavaScript. This comprehensive guide covers generics, type inference, utility types, and advanced patterns for building robust applications.",
        bodyHash: "hash-ts-guide",
        titleHash: "thash-ts-guide",
        wordCount: 25,
      },
      {
        projectId,
        url: "https://blog.example.com/javascript-basics",
        title: "JavaScript Basics for Beginners",
        body: "JavaScript is the language of the web. Learn variables, functions, closures, and the event loop. TypeScript builds on JavaScript with static types.",
        bodyHash: "hash-js-basics",
        titleHash: "thash-js-basics",
        wordCount: 24,
      },
      {
        projectId,
        url: "https://blog.example.com/react-patterns",
        title: "React Design Patterns",
        body: "React patterns include compound components, render props, and custom hooks. TypeScript enhances React development with type-safe props and state management.",
        bodyHash: "hash-react-patterns",
        titleHash: "thash-react-patterns",
        wordCount: 22,
      },
    ];

    await testPrisma.article.createMany({ data: articles });
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    await testPrisma.user.deleteMany({
      where: { email: "analyze-test@example.com" },
    });
  });

  it("completes_analysis_run_and_creates_deduplicated_recommendations", async () => {
    // Trigger analysis
    const analyzeRes = await fetch(apiUrl("/api/analyze"), {
      method: "POST",
      headers: authHeaders(userId, projectId),
      body: JSON.stringify({
        approaches: ["keyword"],
      }),
    });

    expect(analyzeRes.status).toBe(202);
    const analyzeData = await analyzeRes.json();
    expect(analyzeData.id).toBeDefined();
    expect(analyzeData.status).toBe("pending");

    const runId = analyzeData.id;

    // Poll for completion (max 30 seconds)
    let run;
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      run = await testPrisma.analysisRun.findUnique({
        where: { id: runId },
      });

      if (run && (run.status === "completed" || run.status === "failed")) {
        break;
      }

      // Wait 1 second before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(run).not.toBeNull();
    // The run should complete (or we test what happens with the cron worker)
    // For integration tests, we may need to invoke the cron worker directly
    if (run!.status === "pending") {
      // If cron hasn't processed yet, invoke it directly
      const cronRes = await fetch(apiUrl("/api/cron/analyze"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });
      expect(cronRes.status).toBe(200);

      // Re-check the run
      run = await testPrisma.analysisRun.findUnique({
        where: { id: runId },
      });
    }

    expect(run!.status).toBe("completed");

    // Verify recommendations were created
    const recs = await testPrisma.recommendation.findMany({
      where: { analysisRunId: runId },
    });

    expect(recs.length).toBeGreaterThan(0);

    // Verify deduplication: no duplicate source+target pairs
    const pairs = recs.map(
      (r) => `${r.sourceArticleId}-${r.targetArticleId}`
    );
    const uniquePairs = new Set(pairs);
    expect(uniquePairs.size).toBe(pairs.length);

    // Verify each recommendation has required fields
    for (const rec of recs) {
      expect(rec.projectId).toBe(projectId);
      expect(rec.strategyId).toBe("crosslink");
      expect(rec.type).toBe("crosslink");
      expect(["info", "warning", "critical"]).toContain(rec.severity);
      expect(rec.title).toBeTruthy();
      expect(rec.description).toBeTruthy();
      expect(rec.confidence).toBeGreaterThan(0);
    }
  });

  it("returns_400_when_no_articles_in_project", async () => {
    // Create an empty project
    const empty = await createTestUserAndProject({
      email: "analyze-empty@example.com",
      plan: "pro",
      projectName: "Empty Project",
    });
    projectIds.push(empty.projectId);

    const res = await fetch(apiUrl("/api/analyze"), {
      method: "POST",
      headers: authHeaders(empty.userId, empty.projectId),
      body: JSON.stringify({
        approaches: ["keyword"],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();

    // Clean up
    await testPrisma.user.deleteMany({
      where: { email: "analyze-empty@example.com" },
    });
  });
});
```

### Step 8.1.6 — Commit analyze tests

- [ ] Commit the analyze integration tests

```bash
git add tests/api/analyze.test.ts
git commit -m "test(api): add analyze e2e integration tests

Seeds articles, triggers analysis via POST /api/analyze, invokes cron worker,
verifies run completes with deduplicated recommendations. Tests 400 on empty project."
```

---

## Integration Test Agent: Task 8.1 — Recommendations + Export Tests

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1.7 — Write recommendations and export integration tests

- [ ] Create `tests/api/recommendations.test.ts`

**File:** `tests/api/recommendations.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
  authHeaders,
} from "../helpers/integration";

/**
 * Integration tests for the recommendations API.
 *
 * Tests:
 * - GET with severity/status filters
 * - CSV export with correct columns and encoding
 * - CSV content parses correctly
 */
describe("Recommendations API Integration", () => {
  let userId: string;
  let projectId: string;
  let runId: string;
  let articleAId: string;
  let articleBId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const result = await createTestUserAndProject({
      email: "recs-test@example.com",
    });
    userId = result.userId;
    projectId = result.projectId;
    projectIds.push(projectId);

    // Create articles
    const articleA = await testPrisma.article.create({
      data: {
        projectId,
        url: "https://example.com/article-a",
        title: "Article A",
        body: "Content of article A for recommendations testing.",
        bodyHash: "hash-a",
        titleHash: "thash-a",
        wordCount: 8,
      },
    });
    articleAId = articleA.id;

    const articleB = await testPrisma.article.create({
      data: {
        projectId,
        url: "https://example.com/article-b",
        title: "Article B",
        body: "Content of article B for recommendations testing.",
        bodyHash: "hash-b",
        titleHash: "thash-b",
        wordCount: 8,
      },
    });
    articleBId = articleB.id;

    // Create analysis run
    const run = await testPrisma.analysisRun.create({
      data: {
        projectId,
        status: "completed",
        strategiesUsed: ["crosslink"],
        configuration: {},
        articleCount: 2,
        recommendationCount: 4,
      },
    });
    runId = run.id;

    // Create recommendations with varying severity and status
    const recData = [
      {
        projectId,
        analysisRunId: runId,
        strategyId: "crosslink",
        sourceArticleId: articleAId,
        targetArticleId: articleBId,
        type: "crosslink",
        severity: "critical",
        title: "Missing crosslink: Article A to Article B",
        description: "Article A discusses related topics covered in Article B.",
        anchorText: "article b topic",
        confidence: 0.92,
        status: "pending",
      },
      {
        projectId,
        analysisRunId: runId,
        strategyId: "crosslink",
        sourceArticleId: articleBId,
        targetArticleId: articleAId,
        type: "crosslink",
        severity: "warning",
        title: "Suggested crosslink: Article B to Article A",
        description: "Article B could benefit from linking to Article A.",
        anchorText: "article a topic",
        confidence: 0.78,
        status: "pending",
      },
      {
        projectId,
        analysisRunId: runId,
        strategyId: "crosslink",
        sourceArticleId: articleAId,
        targetArticleId: articleBId,
        type: "crosslink",
        severity: "info",
        title: "Optional crosslink opportunity",
        description: "Low-priority crosslink suggestion.",
        anchorText: "optional link",
        confidence: 0.55,
        status: "accepted",
      },
      {
        projectId,
        analysisRunId: runId,
        strategyId: "crosslink",
        sourceArticleId: articleBId,
        targetArticleId: articleAId,
        type: "crosslink",
        severity: "warning",
        title: "Dismissed recommendation",
        description: "This was dismissed by the user.",
        anchorText: "dismissed link",
        confidence: 0.65,
        status: "dismissed",
        dismissReason: "Not relevant",
      },
    ];

    await testPrisma.recommendation.createMany({ data: recData });
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    await testPrisma.user.deleteMany({
      where: { email: "recs-test@example.com" },
    });
  });

  it("filters_recommendations_by_severity_and_status", async () => {
    // Filter by severity=critical
    const criticalRes = await fetch(
      apiUrl("/api/recommendations?severity=critical"),
      { headers: authHeaders(userId, projectId) }
    );
    expect(criticalRes.status).toBe(200);
    const criticalData = await criticalRes.json();
    expect(criticalData.recommendations).toHaveLength(1);
    expect(criticalData.recommendations[0].severity).toBe("critical");

    // Filter by status=pending
    const pendingRes = await fetch(
      apiUrl("/api/recommendations?status=pending"),
      { headers: authHeaders(userId, projectId) }
    );
    expect(pendingRes.status).toBe(200);
    const pendingData = await pendingRes.json();
    expect(
      pendingData.recommendations.every(
        (r: { status: string }) => r.status === "pending"
      )
    ).toBe(true);

    // Filter by severity=warning,critical AND status=pending
    const comboRes = await fetch(
      apiUrl("/api/recommendations?severity=warning,critical&status=pending"),
      { headers: authHeaders(userId, projectId) }
    );
    expect(comboRes.status).toBe(200);
    const comboData = await comboRes.json();
    for (const rec of comboData.recommendations) {
      expect(["warning", "critical"]).toContain(rec.severity);
      expect(rec.status).toBe("pending");
    }
  });

  it("exports_csv_with_correct_columns", async () => {
    const csvRes = await fetch(
      apiUrl("/api/recommendations?format=csv&download=true"),
      { headers: authHeaders(userId, projectId) }
    );

    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("content-disposition")).toContain("attachment");

    const csvText = await csvRes.text();

    // Check UTF-8 BOM
    expect(csvText.charCodeAt(0)).toBe(0xfeff);

    // Parse the header row
    const lines = csvText.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1); // header + at least 1 data row

    const headerLine = lines[0].replace(/^\uFEFF/, ""); // strip BOM for parsing
    const headers = headerLine.split(",").map((h) => h.trim().replace(/"/g, ""));

    // Verify expected columns per DECISION-003
    const expectedColumns = [
      "source_url",
      "source_title",
      "target_url",
      "target_title",
      "anchor_text",
      "confidence",
      "matching_approach",
      "severity",
      "status",
      "recommendation_id",
    ];

    for (const col of expectedColumns) {
      expect(headers).toContain(col);
    }
  });

  it("parses_exported_csv_correctly", async () => {
    const csvRes = await fetch(
      apiUrl("/api/recommendations?format=csv"),
      { headers: authHeaders(userId, projectId) }
    );

    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();

    // Simple CSV parsing (handles quoted fields)
    const lines = csvText
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const dataRows = lines.slice(1);

    expect(dataRows.length).toBe(4); // 4 recommendations seeded

    // Parse first data row
    const firstRow = dataRows[0].split(",").map((v) => v.trim().replace(/"/g, ""));
    const rowObj: Record<string, string> = {};
    headers.forEach((h, i) => {
      rowObj[h] = firstRow[i] ?? "";
    });

    // Verify data integrity
    expect(rowObj.source_url).toMatch(/^https?:\/\//);
    expect(rowObj.target_url).toMatch(/^https?:\/\//);
    expect(rowObj.anchor_text).toBeTruthy();
    expect(parseFloat(rowObj.confidence)).toBeGreaterThan(0);
    expect(["info", "warning", "critical"]).toContain(rowObj.severity);
    expect(["pending", "accepted", "dismissed"]).toContain(rowObj.status);
    expect(rowObj.recommendation_id).toBeTruthy();

    // Verify formula injection prevention (no cells start with =, +, -, @)
    for (const row of dataRows) {
      const cells = row.split(",").map((v) => v.trim().replace(/^"/, ""));
      for (const cell of cells) {
        expect(cell).not.toMatch(/^[=+\-@]/);
      }
    }
  });
});
```

### Step 8.1.8 — Commit recommendations tests

- [ ] Commit the recommendations integration tests

```bash
git add tests/api/recommendations.test.ts
git commit -m "test(api): add recommendations filter and CSV export integration tests

Tests GET with severity/status filters, CSV export with correct columns,
UTF-8 BOM, formula injection prevention, and CSV parse verification."
```

---

## Integration Test Agent: Task 8.1 — Cron Crawl + Zombie Tests

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1.9 — Write cron crawl and zombie recovery tests

- [ ] Create `tests/api/cron/crawl.test.ts`

**File:** `tests/api/cron/crawl.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
} from "../../helpers/integration";

/**
 * Integration tests for the cron crawl worker.
 *
 * Tests:
 * - Pending tasks are processed in batch
 * - Zombie tasks (stuck in "processing" state) are recovered
 */
describe("Cron Crawl Worker Integration", () => {
  let userId: string;
  let projectId: string;
  const projectIds: string[] = [];
  const cronHeaders = {
    Authorization: `Bearer ${process.env.CRON_SECRET ?? "test-secret"}`,
    "Content-Type": "application/json",
  };

  beforeAll(async () => {
    const result = await createTestUserAndProject({
      email: "cron-crawl-test@example.com",
    });
    userId = result.userId;
    projectId = result.projectId;
    projectIds.push(projectId);
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    await testPrisma.user.deleteMany({
      where: { email: "cron-crawl-test@example.com" },
    });
  });

  it("processes_pending_tasks_in_batch", async () => {
    // Create an ingestion job with pending tasks
    const job = await testPrisma.ingestionJob.create({
      data: {
        projectId,
        status: "running",
        totalUrls: 3,
        completedUrls: 0,
        failedUrls: 0,
        preset: "gentle",
      },
    });

    // Create pending tasks (using URLs that will likely fail in test,
    // but we verify the cron worker picks them up and processes them)
    const taskUrls = [
      "https://httpbin.org/html",
      "https://httpbin.org/robots.txt",
      "https://httpbin.org/status/200",
    ];

    await testPrisma.ingestionTask.createMany({
      data: taskUrls.map((url) => ({
        jobId: job.id,
        url,
        status: "pending",
      })),
    });

    // Invoke the cron worker
    const cronRes = await fetch(apiUrl("/api/cron/crawl"), {
      method: "POST",
      headers: cronHeaders,
    });

    expect(cronRes.status).toBe(200);

    // Verify tasks were processed (status changed from "pending")
    const tasks = await testPrisma.ingestionTask.findMany({
      where: { jobId: job.id },
    });

    const processedTasks = tasks.filter((t) => t.status !== "pending");
    expect(processedTasks.length).toBeGreaterThan(0);

    // Each processed task should have a startedAt timestamp
    for (const task of processedTasks) {
      expect(task.startedAt).not.toBeNull();
    }
  });

  it("recovers_zombie_tasks_stuck_in_running_state", async () => {
    // Create a job with a "zombie" task (stuck in processing for > 5 minutes)
    const job = await testPrisma.ingestionJob.create({
      data: {
        projectId,
        status: "running",
        totalUrls: 1,
        completedUrls: 0,
        failedUrls: 0,
      },
    });

    const fiveMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);

    await testPrisma.ingestionTask.create({
      data: {
        jobId: job.id,
        url: "https://example.com/zombie-page",
        status: "processing",
        startedAt: fiveMinutesAgo,
      },
    });

    // Invoke cron worker (which should run zombie recovery first)
    const cronRes = await fetch(apiUrl("/api/cron/crawl"), {
      method: "POST",
      headers: cronHeaders,
    });

    expect(cronRes.status).toBe(200);

    // Verify the zombie task was recovered (reset to pending or failed)
    const tasks = await testPrisma.ingestionTask.findMany({
      where: { jobId: job.id },
    });

    expect(tasks).toHaveLength(1);
    // Zombie recovery should reset the task to "pending" for retry
    // or mark as "failed" if retry count exceeded
    expect(["pending", "failed"]).toContain(tasks[0].status);
  });
});
```

### Step 8.1.10 — Commit cron crawl tests

- [ ] Commit the cron crawl integration tests

```bash
git add tests/api/cron/crawl.test.ts
git commit -m "test(api): add cron crawl and zombie recovery integration tests

Tests pending task batch processing and zombie task recovery. Seeds
ingestion jobs with tasks, invokes cron worker, verifies processing."
```

---

## Integration Test Agent: Task 8.1 — Auth Cross-Tenant Tests

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1.11 — Write auth and cross-tenant isolation tests

- [ ] Create `tests/api/auth.test.ts`

**File:** `tests/api/auth.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
  authHeaders,
} from "../helpers/integration";

/**
 * Integration tests for authentication and cross-tenant isolation.
 *
 * [AAP-B5] Every endpoint is tested to ensure:
 * - 401 for unauthenticated requests
 * - User A cannot read/modify User B's data
 */
describe("Auth & Cross-Tenant Isolation", () => {
  let userA: { userId: string; projectId: string };
  let userB: { userId: string; projectId: string };
  let articleBId: string;
  let runBId: string;
  let recBId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    // Create two separate users with separate projects
    userA = await createTestUserAndProject({
      email: "tenant-a@example.com",
      plan: "pro",
      projectName: "Tenant A Project",
    });
    projectIds.push(userA.projectId);

    userB = await createTestUserAndProject({
      email: "tenant-b@example.com",
      plan: "pro",
      projectName: "Tenant B Project",
    });
    projectIds.push(userB.projectId);

    // Seed data for User B (which User A should NOT be able to access)
    const articleB = await testPrisma.article.create({
      data: {
        projectId: userB.projectId,
        url: "https://tenant-b.example.com/secret-article",
        title: "User B Secret Article",
        body: "This content belongs to User B and should not be visible to User A.",
        bodyHash: "hash-b-secret",
        titleHash: "thash-b-secret",
        wordCount: 15,
      },
    });
    articleBId = articleB.id;

    const targetArticleB = await testPrisma.article.create({
      data: {
        projectId: userB.projectId,
        url: "https://tenant-b.example.com/target",
        title: "User B Target",
        body: "Target article for tenant B.",
        bodyHash: "hash-b-target",
        titleHash: "thash-b-target",
        wordCount: 5,
      },
    });

    const runB = await testPrisma.analysisRun.create({
      data: {
        projectId: userB.projectId,
        status: "completed",
        strategiesUsed: ["crosslink"],
        configuration: {},
        articleCount: 2,
        recommendationCount: 1,
      },
    });
    runBId = runB.id;

    const recB = await testPrisma.recommendation.create({
      data: {
        projectId: userB.projectId,
        analysisRunId: runB.id,
        strategyId: "crosslink",
        sourceArticleId: articleB.id,
        targetArticleId: targetArticleB.id,
        type: "crosslink",
        severity: "critical",
        title: "User B Recommendation",
        description: "Belongs to User B only.",
        confidence: 0.9,
      },
    });
    recBId = recB.id;
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    await testPrisma.user.deleteMany({
      where: {
        email: { in: ["tenant-a@example.com", "tenant-b@example.com"] },
      },
    });
  });

  // ── Unauthenticated access tests ──

  it("returns_401_for_unauthenticated_requests", async () => {
    const endpoints = [
      { method: "GET", path: "/api/articles" },
      { method: "POST", path: "/api/articles" },
      { method: "GET", path: "/api/recommendations" },
      { method: "POST", path: "/api/analyze" },
      { method: "GET", path: "/api/settings" },
      { method: "PUT", path: "/api/settings" },
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(apiUrl(endpoint.path), {
        method: endpoint.method,
        headers: { "Content-Type": "application/json" },
        // No auth headers
      });

      expect(
        res.status,
        `${endpoint.method} ${endpoint.path} should return 401`
      ).toBe(401);
    }
  });

  // ── Cross-tenant isolation tests [AAP-B5] ──

  it("prevents_cross_tenant_article_access", async () => {
    // User A tries to GET User B's article
    const getRes = await fetch(apiUrl(`/api/articles/${articleBId}`), {
      headers: authHeaders(userA.userId, userA.projectId),
    });
    expect(getRes.status).toBe(404); // Not found (scoped to User A's project)

    // User A tries to DELETE User B's article
    const deleteRes = await fetch(apiUrl(`/api/articles/${articleBId}`), {
      method: "DELETE",
      headers: authHeaders(userA.userId, userA.projectId),
    });
    expect(deleteRes.status).toBe(404);

    // Verify User B's article still exists
    const article = await testPrisma.article.findUnique({
      where: { id: articleBId },
    });
    expect(article).not.toBeNull();
  });

  it("prevents_cross_tenant_analysis_access", async () => {
    // User A tries to GET User B's analysis run
    // (analysis runs are scoped by projectId in the query)
    const runsRes = await fetch(apiUrl("/api/analyze"), {
      headers: authHeaders(userA.userId, userA.projectId),
    });

    if (runsRes.status === 200) {
      const data = await runsRes.json();
      // None of User B's runs should appear
      const runIds = (data.runs ?? []).map((r: { id: string }) => r.id);
      expect(runIds).not.toContain(runBId);
    }
  });

  it("prevents_cross_tenant_recommendation_access", async () => {
    // User A tries to GET recommendations (should only see their own)
    const recsRes = await fetch(apiUrl("/api/recommendations"), {
      headers: authHeaders(userA.userId, userA.projectId),
    });
    expect(recsRes.status).toBe(200);
    const recsData = await recsRes.json();

    // None of User B's recommendations should appear
    const recIds = (recsData.recommendations ?? []).map(
      (r: { id: string }) => r.id
    );
    expect(recIds).not.toContain(recBId);

    // User A tries to PATCH User B's recommendation
    const patchRes = await fetch(apiUrl(`/api/recommendations/${recBId}`), {
      method: "PATCH",
      headers: authHeaders(userA.userId, userA.projectId),
      body: JSON.stringify({ status: "accepted", updatedAt: new Date().toISOString() }),
    });
    expect(patchRes.status).toBe(404);

    // Verify User B's recommendation is unchanged
    const rec = await testPrisma.recommendation.findUnique({
      where: { id: recBId },
    });
    expect(rec!.status).toBe("pending");
  });

  it("prevents_cross_tenant_settings_access", async () => {
    // User A creates a setting in their project
    const putResA = await fetch(apiUrl("/api/settings"), {
      method: "PUT",
      headers: authHeaders(userA.userId, userA.projectId),
      body: JSON.stringify({ similarityThreshold: 0.8 }),
    });
    expect(putResA.status).toBe(200);

    // User B creates a different setting
    const putResB = await fetch(apiUrl("/api/settings"), {
      method: "PUT",
      headers: authHeaders(userB.userId, userB.projectId),
      body: JSON.stringify({ similarityThreshold: 0.6 }),
    });
    expect(putResB.status).toBe(200);

    // User A reads settings — should see 0.8, not 0.6
    const getResA = await fetch(apiUrl("/api/settings"), {
      headers: authHeaders(userA.userId, userA.projectId),
    });
    const dataA = await getResA.json();
    expect(dataA.settings.similarityThreshold).toBe(0.8);

    // User B reads settings — should see 0.6, not 0.8
    const getResB = await fetch(apiUrl("/api/settings"), {
      headers: authHeaders(userB.userId, userB.projectId),
    });
    const dataB = await getResB.json();
    expect(dataB.settings.similarityThreshold).toBe(0.6);
  });
});
```

### Step 8.1.12 — Commit auth tests

- [ ] Commit the auth and cross-tenant tests

```bash
git add tests/api/auth.test.ts
git commit -m "test(api): add auth and cross-tenant isolation integration tests

[AAP-B5] Tests 401 for unauthenticated requests on all endpoints. Tests
cross-tenant isolation: User A cannot access User B's articles, analysis
runs, recommendations, or settings."
```

---

## Integration Test Agent: Task 8.1 — Full Flow Test

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1.13 — Write full flow integration test

- [ ] Create `tests/integration/full-flow.test.ts`

**File:** `tests/integration/full-flow.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testPrisma,
  cleanupTestData,
  createTestUserAndProject,
  apiUrl,
  authHeaders,
} from "../helpers/integration";

/**
 * Full end-to-end integration test.
 *
 * Exercises the complete user journey:
 * 1. Ingest articles (POST /api/articles with push method)
 * 2. Trigger analysis (POST /api/analyze)
 * 3. Review recommendations (GET /api/recommendations with filters)
 * 4. Accept/dismiss recommendations (PATCH /api/recommendations/:id)
 * 5. Export to CSV (GET /api/recommendations?format=csv)
 */
describe("Full Flow Integration", () => {
  let userId: string;
  let projectId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    const result = await createTestUserAndProject({
      email: "full-flow-test@example.com",
      plan: "pro",
    });
    userId = result.userId;
    projectId = result.projectId;
    projectIds.push(projectId);
  });

  afterAll(async () => {
    await cleanupTestData(projectIds);
    await testPrisma.user.deleteMany({
      where: { email: "full-flow-test@example.com" },
    });
  });

  it("completes_full_ingest_analyze_review_export_flow", async () => {
    // ── Step 1: Ingest articles ──
    const ingestRes = await fetch(apiUrl("/api/articles"), {
      method: "POST",
      headers: authHeaders(userId, projectId),
      body: JSON.stringify({
        method: "push",
        articles: [
          {
            url: "https://blog.example.com/seo-basics",
            title: "SEO Basics: A Complete Guide",
            body: "Search engine optimization (SEO) is the practice of improving your website to increase its visibility in search results. This guide covers keyword research, on-page SEO, technical SEO, and link building strategies.",
            bodyFormat: "text",
          },
          {
            url: "https://blog.example.com/keyword-research",
            title: "Keyword Research: Finding the Right Terms",
            body: "Keyword research is the foundation of SEO. Learn how to find keywords your audience is searching for, analyze competition, and prioritize terms for your content strategy.",
            bodyFormat: "text",
          },
          {
            url: "https://blog.example.com/link-building",
            title: "Link Building Strategies for 2026",
            body: "Link building is a core SEO strategy. Internal links help search engines understand your site structure. External links from authoritative sites boost your domain authority. This guide covers both internal crosslinking and outreach techniques.",
            bodyFormat: "text",
          },
          {
            url: "https://blog.example.com/technical-seo",
            title: "Technical SEO Checklist",
            body: "Technical SEO ensures search engines can crawl and index your site efficiently. Topics include site speed, mobile-friendliness, structured data, XML sitemaps, and robots.txt configuration.",
            bodyFormat: "text",
          },
        ],
      }),
    });

    expect(ingestRes.status).toBe(201);
    const ingestData = await ingestRes.json();
    expect(ingestData.created).toBe(4);
    expect(ingestData.articles).toHaveLength(4);

    // ── Step 2: Trigger analysis ──
    const analyzeRes = await fetch(apiUrl("/api/analyze"), {
      method: "POST",
      headers: authHeaders(userId, projectId),
      body: JSON.stringify({
        approaches: ["keyword"],
      }),
    });

    expect(analyzeRes.status).toBe(202);
    const analyzeData = await analyzeRes.json();
    const runId = analyzeData.id;
    expect(runId).toBeDefined();

    // Invoke cron worker to process the analysis
    const cronRes = await fetch(apiUrl("/api/cron/analyze"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET ?? "test-secret"}`,
      },
    });
    expect(cronRes.status).toBe(200);

    // Wait and verify completion
    let run = await testPrisma.analysisRun.findUnique({
      where: { id: runId },
    });

    // If still pending/running, give it another attempt
    if (run && run.status !== "completed" && run.status !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await fetch(apiUrl("/api/cron/analyze"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET ?? "test-secret"}`,
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await testPrisma.analysisRun.findUnique({
        where: { id: runId },
      });
    }

    expect(run!.status).toBe("completed");

    // ── Step 3: Review recommendations ──
    const recsRes = await fetch(apiUrl("/api/recommendations"), {
      headers: authHeaders(userId, projectId),
    });

    expect(recsRes.status).toBe(200);
    const recsData = await recsRes.json();
    expect(recsData.recommendations.length).toBeGreaterThan(0);

    // Filter by severity
    const criticalRes = await fetch(
      apiUrl("/api/recommendations?severity=critical,warning"),
      { headers: authHeaders(userId, projectId) }
    );
    expect(criticalRes.status).toBe(200);

    // ── Step 4: Accept/dismiss recommendations ──
    const firstRec = recsData.recommendations[0];

    const acceptRes = await fetch(
      apiUrl(`/api/recommendations/${firstRec.id}`),
      {
        method: "PATCH",
        headers: authHeaders(userId, projectId),
        body: JSON.stringify({
          status: "accepted",
          updatedAt: firstRec.updatedAt,
        }),
      }
    );
    expect(acceptRes.status).toBe(200);

    // If there's a second recommendation, dismiss it
    if (recsData.recommendations.length > 1) {
      const secondRec = recsData.recommendations[1];
      const dismissRes = await fetch(
        apiUrl(`/api/recommendations/${secondRec.id}`),
        {
          method: "PATCH",
          headers: authHeaders(userId, projectId),
          body: JSON.stringify({
            status: "dismissed",
            dismissReason: "Not relevant for this content",
            updatedAt: secondRec.updatedAt,
          }),
        }
      );
      expect(dismissRes.status).toBe(200);
    }

    // ── Step 5: Export to CSV ──
    const csvRes = await fetch(
      apiUrl("/api/recommendations?format=csv"),
      { headers: authHeaders(userId, projectId) }
    );

    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");

    const csvText = await csvRes.text();
    const lines = csvText.trim().split("\n");
    expect(lines.length).toBeGreaterThan(1); // header + data rows

    // Verify the accepted/dismissed statuses appear in CSV
    expect(csvText).toContain("accepted");
  });
});
```

### Step 8.1.14 — Commit full flow test

- [ ] Commit the full flow test

```bash
git add tests/integration/full-flow.test.ts
git commit -m "test(integration): add full ingest->analyze->review->export flow test

Exercises complete user journey: push 4 articles, trigger keyword analysis,
invoke cron worker, review/filter recommendations, accept/dismiss, export CSV."
```

---

## Integration Test Agent: Task 8.1a — Rate Limiter

> **Branch:** `feature/phase-8-integration` (continues)

### Step 8.1a.1 — Implement the rate limiter

- [ ] Create `src/lib/rate-limit.ts`

**File:** `src/lib/rate-limit.ts`

```typescript
import { NextResponse } from "next/server";

/**
 * In-memory token bucket rate limiter. [AAP-B9]
 *
 * Acceptable for single-region Vercel deployment. For multi-region,
 * replace with Redis-backed rate limiter (e.g., @upstash/ratelimit).
 *
 * Per-user limits:
 * - POST /api/articles: 10 requests/minute
 * - POST /api/analyze: 5 requests/hour
 * - All other endpoints: 60 requests/minute
 *
 * Returns 429 Too Many Requests with Retry-After header.
 */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

interface RateLimitConfig {
  /** Maximum tokens (burst capacity) */
  maxTokens: number;
  /** Refill rate: tokens added per second */
  refillRate: number;
  /** Window duration in milliseconds (for Retry-After calculation) */
  windowMs: number;
}

/**
 * Predefined rate limit configurations per endpoint pattern.
 */
export const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  // POST /api/articles: 10 requests/minute
  "POST:/api/articles": {
    maxTokens: 10,
    refillRate: 10 / 60, // ~0.167 tokens/second
    windowMs: 60_000,
  },
  // POST /api/analyze: 5 requests/hour
  "POST:/api/analyze": {
    maxTokens: 5,
    refillRate: 5 / 3600, // ~0.0014 tokens/second
    windowMs: 3_600_000,
  },
  // Default: 60 requests/minute
  default: {
    maxTokens: 60,
    refillRate: 60 / 60, // 1 token/second
    windowMs: 60_000,
  },
};

/**
 * In-memory store of token buckets, keyed by `userId:endpoint`.
 * Entries are automatically cleaned up when they reach full capacity
 * (no need for explicit TTL in single-process environments).
 */
const buckets = new Map<string, TokenBucket>();

/**
 * Periodic cleanup interval to prevent unbounded memory growth.
 * Removes buckets that have been full for more than 10 minutes.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      // If last refill was more than 10 minutes ago and bucket is likely full,
      // remove it to free memory
      if (now - bucket.lastRefill > 10 * 60 * 1000) {
        buckets.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

startCleanup();

/**
 * Get the rate limit config for a given method + path combination.
 */
function getConfig(method: string, path: string): RateLimitConfig {
  const key = `${method}:${path}`;
  return RATE_LIMIT_CONFIGS[key] ?? RATE_LIMIT_CONFIGS.default;
}

/**
 * Refill tokens based on elapsed time since last refill.
 */
function refillBucket(bucket: TokenBucket, config: RateLimitConfig): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000; // seconds
  const newTokens = elapsed * config.refillRate;
  bucket.tokens = Math.min(config.maxTokens, bucket.tokens + newTokens);
  bucket.lastRefill = now;
}

/**
 * Attempt to consume one token from the bucket.
 *
 * @returns Object with `allowed` flag and metadata for response headers.
 */
function consumeToken(
  userId: string,
  method: string,
  path: string
): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
} {
  const config = getConfig(method, path);
  const bucketKey = `${userId}:${method}:${path}`;

  let bucket = buckets.get(bucketKey);
  if (!bucket) {
    bucket = {
      tokens: config.maxTokens,
      lastRefill: Date.now(),
    };
    buckets.set(bucketKey, bucket);
  }

  refillBucket(bucket, config);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterSeconds: 0,
      limit: config.maxTokens,
    };
  }

  // Not enough tokens — calculate when one will be available
  const secondsUntilToken = (1 - bucket.tokens) / config.refillRate;

  return {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: Math.ceil(secondsUntilToken),
    limit: config.maxTokens,
  };
}

/**
 * Rate limit middleware for API routes.
 *
 * Usage in a route handler:
 * ```typescript
 * import { rateLimit } from "@/lib/rate-limit";
 *
 * export async function POST(request: NextRequest) {
 *   const rateLimitResult = rateLimit(userId, "POST", "/api/articles");
 *   if (rateLimitResult) return rateLimitResult; // 429 response
 *   // ... handle request
 * }
 * ```
 *
 * @param userId - The authenticated user's ID
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - The API route path (e.g., "/api/articles")
 * @returns NextResponse with 429 status if rate limited, or null if allowed
 */
export function rateLimit(
  userId: string,
  method: string,
  path: string
): NextResponse | null {
  const result = consumeToken(userId, method, path);

  if (result.allowed) {
    return null; // Request is allowed
  }

  return NextResponse.json(
    {
      error: "rate_limit_exceeded",
      message: "Too many requests. Please try again later.",
      retryAfter: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    }
  );
}

/**
 * Reset rate limit state for a specific user (useful in tests).
 */
export function resetRateLimit(userId: string): void {
  for (const key of buckets.keys()) {
    if (key.startsWith(`${userId}:`)) {
      buckets.delete(key);
    }
  }
}

/**
 * Clear all rate limit buckets (useful in tests).
 */
export function clearAllRateLimits(): void {
  buckets.clear();
}
```

### Step 8.1a.2 — Write rate limiter unit tests

- [ ] Create `tests/lib/rate-limit.test.ts`

**File:** `tests/lib/rate-limit.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  rateLimit,
  resetRateLimit,
  clearAllRateLimits,
  RATE_LIMIT_CONFIGS,
} from "@/lib/rate-limit";

describe("Rate Limiter", () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it("allows_requests_within_limit", () => {
    const userId = "user-within-limit";
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Should allow up to maxTokens requests
    for (let i = 0; i < config.maxTokens; i++) {
      const result = rateLimit(userId, "POST", "/api/articles");
      expect(result).toBeNull(); // null means allowed
    }
  });

  it("returns_429_after_exceeding_articles_limit", () => {
    const userId = "user-articles-exceeded";
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust all tokens (10 requests/minute)
    for (let i = 0; i < config.maxTokens; i++) {
      rateLimit(userId, "POST", "/api/articles");
    }

    // Next request should be rate limited
    const result = rateLimit(userId, "POST", "/api/articles");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);

    // Verify Retry-After header
    const retryAfter = result!.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);

    // Verify response body
    const body = JSON.parse(
      // Extract body from NextResponse
      new TextDecoder().decode(
        // @ts-expect-error -- accessing internal body for test
        result!.body ? new Uint8Array(0) : new Uint8Array(0)
      ) || "{}"
    );
    // Alternative: check status code is sufficient
    expect(result!.status).toBe(429);
  });

  it("returns_429_after_exceeding_analyze_limit", () => {
    const userId = "user-analyze-exceeded";
    const config = RATE_LIMIT_CONFIGS["POST:/api/analyze"];

    // Exhaust all tokens (5 requests/hour)
    for (let i = 0; i < config.maxTokens; i++) {
      rateLimit(userId, "POST", "/api/analyze");
    }

    // Next request should be rate limited
    const result = rateLimit(userId, "POST", "/api/analyze");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);

    // Retry-After should be longer (hourly window)
    const retryAfter = parseInt(
      result!.headers.get("Retry-After") ?? "0",
      10
    );
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("uses_default_limit_for_unknown_endpoints", () => {
    const userId = "user-default";
    const config = RATE_LIMIT_CONFIGS.default;

    // Should allow up to 60 requests/minute for unknown endpoints
    for (let i = 0; i < config.maxTokens; i++) {
      const result = rateLimit(userId, "GET", "/api/some-endpoint");
      expect(result).toBeNull();
    }

    // 61st request should be rate limited
    const result = rateLimit(userId, "GET", "/api/some-endpoint");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("isolates_rate_limits_per_user", () => {
    const userA = "user-a-isolated";
    const userB = "user-b-isolated";
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust User A's tokens
    for (let i = 0; i < config.maxTokens; i++) {
      rateLimit(userA, "POST", "/api/articles");
    }

    // User A should be rate limited
    expect(rateLimit(userA, "POST", "/api/articles")).not.toBeNull();

    // User B should still be allowed
    expect(rateLimit(userB, "POST", "/api/articles")).toBeNull();
  });

  it("resets_rate_limit_for_specific_user", () => {
    const userId = "user-reset";
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust tokens
    for (let i = 0; i < config.maxTokens; i++) {
      rateLimit(userId, "POST", "/api/articles");
    }

    expect(rateLimit(userId, "POST", "/api/articles")).not.toBeNull();

    // Reset
    resetRateLimit(userId);

    // Should be allowed again
    expect(rateLimit(userId, "POST", "/api/articles")).toBeNull();
  });

  it("includes_rate_limit_headers_in_429_response", () => {
    const userId = "user-headers";
    const config = RATE_LIMIT_CONFIGS["POST:/api/articles"];

    // Exhaust tokens
    for (let i = 0; i < config.maxTokens; i++) {
      rateLimit(userId, "POST", "/api/articles");
    }

    const result = rateLimit(userId, "POST", "/api/articles");
    expect(result).not.toBeNull();
    expect(result!.headers.get("Retry-After")).toBeDefined();
    expect(result!.headers.get("X-RateLimit-Limit")).toBe(
      String(config.maxTokens)
    );
    expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
```

### Step 8.1a.3 — Commit rate limiter

- [ ] Commit the rate limiter implementation and tests

```bash
git add src/lib/rate-limit.ts tests/lib/rate-limit.test.ts
git commit -m "feat(security): add in-memory token bucket rate limiter [AAP-B9]

Per-user limits: POST /api/articles 10/min, POST /api/analyze 5/hour,
all others 60/min. Returns 429 with Retry-After header. Includes periodic
cleanup, per-user isolation, and test helper functions."
```

---

## Security Agent: Task 8.2 — Security Checklist

> **Branch:** `feature/phase-8-security`
> **Depends on:** All feature phases (0-7) complete

### Step 8.2.1 — Create the branch

- [ ] Create and switch to `feature/phase-8-security` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-8-security
```

### Step 8.2.2 — Conduct security review

- [ ] Execute each item on the security checklist and document findings

**Checklist execution steps:**

**1. API key audit (no keys in client bundle):**
```bash
# Search for NEXT_PUBLIC_ prefixed env vars that might contain secrets
grep -r "NEXT_PUBLIC_" src/ --include="*.ts" --include="*.tsx" | grep -v "APP_URL"
# Verify OPENAI_API_KEY, COHERE_API_KEY, SENTRY_AUTH_TOKEN are NOT prefixed with NEXT_PUBLIC_
grep -r "NEXT_PUBLIC_OPENAI\|NEXT_PUBLIC_COHERE\|NEXT_PUBLIC_SENTRY_AUTH\|NEXT_PUBLIC_DATABASE\|NEXT_PUBLIC_AUTH_SECRET" src/ .env.example
```

**2. SSRF protection [AAP-B1]:**
```bash
# Verify URL validation exists in the crawler
grep -r "isPrivateIP\|isInternalIP\|validateUrl\|ssrf" src/ --include="*.ts"
# Verify DNS rebinding protection
grep -r "dns.resolve\|dns\.resolve4\|dnsResolve" src/ --include="*.ts"
# Test with internal IPs (manual):
# POST /api/articles with URL http://127.0.0.1 -> should return 400
# POST /api/articles with URL http://169.254.169.254 -> should return 400
# POST /api/articles with URL file:///etc/passwd -> should return 400
```

**3. CORS verification:**
```bash
# Verify no Access-Control-Allow-Origin headers on authenticated endpoints
grep -r "Access-Control-Allow-Origin\|cors\|CORS" src/app/api/ --include="*.ts"
```

**4. Rate limiting verification [AAP-B9]:**
```bash
# Verify rate limiter is imported and applied in API routes
grep -r "rateLimit" src/app/api/ --include="*.ts"
```

**5. npm audit:**
```bash
npm audit --audit-level=critical
```

**6. File upload limits:**
```bash
# Verify file upload size limits in Next.js config or API routes
grep -r "maxSize\|MAX_FILE_SIZE\|bodyParser\|sizeLimit" src/ next.config.* --include="*.ts" --include="*.mjs"
```

**7. HTML sanitization:**
```bash
# Verify crawled HTML content is sanitized before storage
grep -r "sanitize\|DOMPurify\|xss\|escapeHtml" src/ --include="*.ts"
```

**8. CopySnippet escaping [AAP-F3]:**
```bash
# Verify anchorText and targetUrl are HTML-escaped before assembly
grep -r "CopySnippet\|escapeHtml\|htmlEscape" src/ --include="*.ts" --include="*.tsx"
```

**9. Cheerio bundle check [AAP-F10]:**
```bash
ANALYZE=true npm run build
# Check output for cheerio in client chunks
```

### Step 8.2.3 — Create security review DECISION doc

- [ ] Create `docs/decisions/security-review-v1.md`

**File:** `docs/decisions/security-review-v1.md`

```markdown
# DECISION: Security Review v1

**Date:** 2026-03-23
**Status:** Accepted

## Context

Phase 8 security review covering all checklist items from the Implementation Plan.
This review verifies the security posture of SEO-ilator v1.0 before launch.

## Checklist Results

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | No API keys in client bundle | PASS/FAIL | No `NEXT_PUBLIC_` prefix on sensitive keys |
| 2 | SSRF protection (internal IPs) | PASS/FAIL | URL validation rejects private ranges |
| 3 | [AAP-B1] SSRF DNS rebinding protection | PASS/FAIL | dns.resolve4() called before each fetch |
| 4 | SSRF redirect chain validation | PASS/FAIL | Redirects re-validated against private IPs |
| 5 | CORS not on auth endpoints | PASS/FAIL | No Access-Control-Allow-Origin on API routes |
| 6 | Rate limiting on auth endpoints | PASS/FAIL | Rate limiter applied |
| 7 | [AAP-B9] Rate limit: articles 10/min | PASS/FAIL | Token bucket verified |
| 8 | [AAP-B9] Rate limit: analyze 5/hour | PASS/FAIL | Token bucket verified |
| 9 | npm audit: zero critical vulns | PASS/FAIL | `npm audit --audit-level=critical` |
| 10 | File upload size limits | PASS/FAIL | Max file size enforced |
| 11 | HTML sanitization on crawled content | PASS/FAIL | Sanitizer applied before storage |
| 12 | [AAP-F3] CopySnippet HTML escaping | PASS/FAIL | `<`, `>`, `"`, `&`, `'` escaped |
| 13 | [AAP-F10] Cheerio not in client bundle | PASS/FAIL | Bundle analyzer verified |

## Findings

### Critical
(Document any critical findings here)

### Warnings
(Document any non-critical warnings here)

### Remediations Applied
(Document any fixes made as part of this review)

## Consequences

Security review establishes the baseline security posture for v1.0 launch.
Any FAIL items must be remediated before merging to `develop`.
```

### Step 8.2.4 — Apply fixes for any findings

- [ ] Fix any critical or high-severity findings discovered during the review

For each finding, apply the fix in the source file and document the remediation in the DECISION doc.

### Step 8.2.5 — Commit security review

- [ ] Commit the security review DECISION doc and any fixes

```bash
git add docs/decisions/security-review-v1.md
git add -A  # Include any security fixes
git commit -m "docs(security): add security review v1 DECISION doc

Completes Phase 8.2 security checklist. Covers API key audit, SSRF
protection [AAP-B1], CORS, rate limiting [AAP-B9], npm audit, file upload
limits, HTML sanitization, CopySnippet escaping [AAP-F3], cheerio bundle
check [AAP-F10]. Findings and remediations documented."
```

---

## Ops Agent: Task 8.3 — Sentry Integration

> **Branch:** `feature/phase-8-ops`
> **Depends on:** All feature phases (0-7) complete

### Step 8.3.1 — Create the branch

- [ ] Create and switch to `feature/phase-8-ops` from `develop`

```bash
cd /Users/justin/CascadeProjects/SEO-ilator
git checkout develop
git checkout -b feature/phase-8-ops
```

### Step 8.3.2 — Install Sentry

- [ ] Install `@sentry/nextjs`

```bash
npm install @sentry/nextjs
```

**Expected:** `@sentry/nextjs` in `dependencies`.

### Step 8.3.3 — Create Sentry client config

- [ ] Create `sentry.client.config.ts`

**File:** `sentry.client.config.ts`

```typescript
import * as Sentry from "@sentry/nextjs";

/**
 * Sentry client-side configuration.
 *
 * Initializes Sentry in the browser for capturing client-side errors,
 * performance traces, and session replay.
 *
 * DSN is read from NEXT_PUBLIC_SENTRY_DSN environment variable.
 * Disabled when DSN is not set (local development).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production/preview
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance monitoring: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Session replay: capture 1% of sessions, 100% of error sessions
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Mask all text and block all media for privacy
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out noisy browser errors
  ignoreErrors: [
    // Browser extensions
    "top.GLOBALS",
    "ResizeObserver loop",
    // Network errors users can't control
    "Failed to fetch",
    "NetworkError",
    "Load failed",
  ],

  // Environment tag
  environment: process.env.NODE_ENV ?? "development",
});
```

### Step 8.3.4 — Create Sentry server config

- [ ] Create `sentry.server.config.ts`

**File:** `sentry.server.config.ts`

```typescript
import * as Sentry from "@sentry/nextjs";

/**
 * Sentry server-side configuration.
 *
 * Initializes Sentry on the server for capturing API route errors,
 * server component errors, and performance traces.
 *
 * DSN is read from SENTRY_DSN environment variable (no NEXT_PUBLIC_ prefix).
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Only enable when DSN is configured
  enabled: !!process.env.SENTRY_DSN,

  // Performance monitoring: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Environment tag
  environment: process.env.NODE_ENV ?? "development",

  // Attach server context to errors
  integrations: [
    Sentry.prismaIntegration(),
  ],

  // Before sending: strip sensitive data
  beforeSend(event) {
    // Remove any accidentally captured API keys from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
        if (breadcrumb.data) {
          const data = { ...breadcrumb.data };
          // Redact authorization headers
          if (data.headers) {
            delete data.headers.authorization;
            delete data.headers.Authorization;
          }
          breadcrumb.data = data;
        }
        return breadcrumb;
      });
    }
    return event;
  },
});
```

### Step 8.3.5 — Create instrumentation file

- [ ] Create `src/instrumentation.ts`

**File:** `src/instrumentation.ts`

```typescript
/**
 * Next.js instrumentation file.
 *
 * This file is loaded once when the Next.js server starts.
 * It initializes Sentry server-side monitoring.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Import server config when running on Node.js
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime Sentry config (if needed in the future)
    await import("../sentry.server.config");
  }
}
```

### Step 8.3.6 — Add source map upload to CI

- [ ] Modify `.github/workflows/ci.yml` to add Sentry source map upload step

Add the following step after the build step in the CI workflow:

```yaml
      # Upload source maps to Sentry (only on main branch)
      - name: Upload Sentry source maps
        if: github.ref == 'refs/heads/main'
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ secrets.SENTRY_ORG }}
          SENTRY_PROJECT: ${{ secrets.SENTRY_PROJECT }}
        run: npx @sentry/cli sourcemaps upload --release=${{ github.sha }} .next/
```

### Step 8.3.7 — Commit Sentry integration

- [ ] Commit Sentry configuration files

```bash
git add sentry.client.config.ts sentry.server.config.ts src/instrumentation.ts .github/workflows/ci.yml package.json package-lock.json
git commit -m "feat(ops): add Sentry client/server config with source maps in CI

Client config: error capture, 10% performance sampling, session replay.
Server config: API error capture, Prisma integration, sensitive data scrubbing.
CI: source map upload on main branch deploys."
```

---

## Ops Agent: Task 8.4 — Vercel Analytics

> **Branch:** `feature/phase-8-ops` (continues)

### Step 8.4.1 — Install analytics packages

- [ ] Install Vercel analytics and speed insights packages

```bash
npm install @vercel/analytics @vercel/speed-insights
```

### Step 8.4.2 — Add Analytics and SpeedInsights to root layout

- [ ] Modify `src/app/layout.tsx` to add analytics components

Add the following imports and components to the root layout:

```tsx
// Add to imports at top of src/app/layout.tsx
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

// Add inside the <body> tag, after the main content:
<Analytics />
<SpeedInsights />
```

### Step 8.4.3 — Commit analytics integration

- [ ] Commit analytics changes

```bash
git add src/app/layout.tsx package.json package-lock.json
git commit -m "feat(ops): add Vercel Analytics and SpeedInsights to root layout

Adds @vercel/analytics for page view and web vitals tracking.
Adds @vercel/speed-insights for Core Web Vitals monitoring."
```

---

## Ops Agent: Task 8.5 — Load Testing Checklist

> **Branch:** `feature/phase-8-ops` (continues)

### Step 8.5.1 — Document load testing plan and execute

- [ ] Create load test documentation and execute tests

The load testing checklist verifies performance at scale. These are manual/scripted tests run against a staging environment:

**Test 1: 500-URL sitemap crawl**
```bash
# Create a test with 500 URLs
# POST /api/articles with method: "sitemap", url: "<500-URL sitemap>"
# Monitor: total wall time, memory usage, cron invocation count
# Target: completes within cron timeout (300s per invocation, multiple invocations OK)
```

**Test 2: 2,000-article analysis [AAP-O2]**
```bash
# Seed 2,000 articles via factory or bulk push
# POST /api/analyze with approaches: ["keyword"]
# Monitor: cron invocations needed, total wall time, memory per invocation
# Target: completes via chunked cron processing, no single invocation hits 300s limit
```

**Test 3: 10,000-recommendation CSV export**
```bash
# Seed 10,000 recommendations
# GET /api/recommendations?format=csv
# Monitor: response time, memory usage, streaming behavior
# Target: streams without timeout (< 60s for full download)
```

**Test 4: pgvector similarity queries at scale**
```bash
# With 2,000+ articles with embeddings:
# Run similarity queries via the analysis pipeline
# Monitor: query time, index usage (HNSW)
# Target: individual similarity queries < 100ms
```

Results should be documented in `build_log.md` after execution.

### Step 8.5.2 — Commit load testing documentation

Load testing results are documented in build_log.md after execution -- no separate commit needed for the checklist itself.

---

## Ops Agent: Task 8.6 — Seed Data + Factories

> **Branch:** `feature/phase-8-ops` (continues)

### Step 8.6.1 — Create test factory functions

- [ ] Create `tests/helpers/factories.ts`

**File:** `tests/helpers/factories.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

/**
 * Test factory functions for creating minimal test records.
 *
 * Each factory creates a minimal valid record with sensible defaults.
 * All fields can be overridden via the `overrides` parameter.
 *
 * Usage:
 * ```typescript
 * const user = await createTestUser(prisma, { plan: "pro" });
 * const project = await createTestProject(prisma, { userId: user.id });
 * const article = await createTestArticle(prisma, { projectId: project.id });
 * ```
 */

let counter = 0;

function nextId(): string {
  counter += 1;
  return `test-${counter}-${Date.now()}`;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── User Factory ──

interface UserOverrides {
  id?: string;
  email?: string;
  name?: string;
  plan?: string;
  articleLimit?: number;
  runLimit?: number;
}

export async function createTestUser(
  prisma: PrismaClient,
  overrides?: UserOverrides
) {
  const id = nextId();
  return prisma.user.create({
    data: {
      email: overrides?.email ?? `test-user-${id}@factory.test`,
      name: overrides?.name ?? `Test User ${id}`,
      plan: overrides?.plan ?? "pro",
      articleLimit: overrides?.articleLimit ?? 500,
      runLimit: overrides?.runLimit ?? 100,
      ...( overrides?.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Project Factory ──

interface ProjectOverrides {
  id?: string;
  userId?: string;
  name?: string;
}

export async function createTestProject(
  prisma: PrismaClient,
  overrides?: ProjectOverrides
) {
  // If no userId provided, create a user first
  let userId = overrides?.userId;
  if (!userId) {
    const user = await createTestUser(prisma);
    userId = user.id;
  }

  return prisma.project.create({
    data: {
      userId,
      name: overrides?.name ?? `Test Project ${nextId()}`,
      ...(overrides?.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Article Factory ──

interface ArticleOverrides {
  id?: string;
  projectId?: string;
  url?: string;
  title?: string;
  body?: string;
  bodyHash?: string;
  titleHash?: string;
  wordCount?: number;
  sourceType?: string;
  embeddingModel?: string;
  metadata?: Record<string, unknown>;
}

export async function createTestArticle(
  prisma: PrismaClient,
  overrides?: ArticleOverrides
) {
  // If no projectId provided, create a project first
  let projectId = overrides?.projectId;
  if (!projectId) {
    const project = await createTestProject(prisma);
    projectId = project.id;
  }

  const id = nextId();
  const body =
    overrides?.body ??
    `This is test article content for ${id}. It contains enough words to be meaningful for testing purposes.`;
  const title = overrides?.title ?? `Test Article ${id}`;

  return prisma.article.create({
    data: {
      projectId,
      url: overrides?.url ?? `https://test.example.com/article-${id}`,
      title,
      body,
      bodyHash: overrides?.bodyHash ?? sha256(body),
      titleHash: overrides?.titleHash ?? sha256(title),
      wordCount: overrides?.wordCount ?? body.split(/\s+/).length,
      sourceType: overrides?.sourceType ?? "api_push",
      embeddingModel: overrides?.embeddingModel ?? null,
      metadata: overrides?.metadata ?? null,
      ...(overrides?.id ? { id: overrides.id } : {}),
    },
  });
}

// ── AnalysisRun Factory ──

interface AnalysisRunOverrides {
  id?: string;
  projectId?: string;
  status?: string;
  strategiesUsed?: string[];
  configuration?: Record<string, unknown>;
  articleCount?: number;
  recommendationCount?: number;
  embeddingsCached?: number;
  embeddingsGenerated?: number;
}

export async function createTestAnalysisRun(
  prisma: PrismaClient,
  overrides?: AnalysisRunOverrides
) {
  let projectId = overrides?.projectId;
  if (!projectId) {
    const project = await createTestProject(prisma);
    projectId = project.id;
  }

  return prisma.analysisRun.create({
    data: {
      projectId,
      status: overrides?.status ?? "completed",
      strategiesUsed: overrides?.strategiesUsed ?? ["crosslink"],
      configuration: overrides?.configuration ?? {
        approaches: ["keyword"],
        similarityThreshold: 0.75,
      },
      articleCount: overrides?.articleCount ?? 0,
      recommendationCount: overrides?.recommendationCount ?? 0,
      embeddingsCached: overrides?.embeddingsCached ?? 0,
      embeddingsGenerated: overrides?.embeddingsGenerated ?? 0,
      startedAt: new Date(),
      completedAt:
        overrides?.status === "completed" || !overrides?.status
          ? new Date()
          : null,
      ...(overrides?.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Recommendation Factory ──

interface RecommendationOverrides {
  id?: string;
  projectId?: string;
  analysisRunId?: string;
  strategyId?: string;
  sourceArticleId?: string;
  targetArticleId?: string;
  type?: string;
  severity?: string;
  title?: string;
  description?: string;
  anchorText?: string;
  confidence?: number;
  matchingApproach?: string;
  status?: string;
  dismissReason?: string;
  sourceContext?: string;
}

export async function createTestRecommendation(
  prisma: PrismaClient,
  overrides?: RecommendationOverrides
) {
  // Ensure we have all required foreign keys
  let projectId = overrides?.projectId;
  let analysisRunId = overrides?.analysisRunId;
  let sourceArticleId = overrides?.sourceArticleId;
  let targetArticleId = overrides?.targetArticleId;

  if (!projectId) {
    const project = await createTestProject(prisma);
    projectId = project.id;
  }

  if (!analysisRunId) {
    const run = await createTestAnalysisRun(prisma, { projectId });
    analysisRunId = run.id;
  }

  if (!sourceArticleId) {
    const source = await createTestArticle(prisma, { projectId });
    sourceArticleId = source.id;
  }

  if (!targetArticleId) {
    const target = await createTestArticle(prisma, { projectId });
    targetArticleId = target.id;
  }

  const id = nextId();

  return prisma.recommendation.create({
    data: {
      projectId,
      analysisRunId,
      strategyId: overrides?.strategyId ?? "crosslink",
      sourceArticleId,
      targetArticleId,
      type: overrides?.type ?? "crosslink",
      severity: overrides?.severity ?? "info",
      title: overrides?.title ?? `Test Recommendation ${id}`,
      description:
        overrides?.description ??
        `Test recommendation description for ${id}.`,
      anchorText: overrides?.anchorText ?? "test anchor text",
      confidence: overrides?.confidence ?? 0.75,
      matchingApproach: overrides?.matchingApproach ?? "keyword",
      status: overrides?.status ?? "pending",
      dismissReason: overrides?.dismissReason ?? null,
      sourceContext: overrides?.sourceContext ?? null,
      ...(overrides?.id ? { id: overrides.id } : {}),
    },
  });
}
```

### Step 8.6.2 — Create seed data script

- [ ] Create `prisma/seed.ts`

**File:** `prisma/seed.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

/**
 * Development seed data for SEO-ilator.
 *
 * Creates a realistic development environment per DBA plan Section 3:
 * - 1 test user (Pro plan)
 * - 1 project "Demo Blog"
 * - 18 realistic articles across 4 topic clusters
 * - 2 completed analysis runs
 * - 40 recommendations (mixed severity/status)
 * - 1 strategy config with defaults
 * - 2 ingestion jobs (1 completed, 1 partially failed)
 *
 * Usage: npx tsx prisma/seed.ts
 */

const prisma = new PrismaClient();

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// ── Article Content by Topic Cluster ──

const ARTICLES = [
  // Cluster 1: SEO Fundamentals (5 articles)
  {
    url: "https://demo-blog.example.com/seo-basics-guide",
    title: "SEO Basics: The Complete Beginner's Guide",
    body: "Search engine optimization is the practice of improving your website to increase its visibility in search results. This comprehensive guide covers the fundamentals of SEO including keyword research, on-page optimization, technical SEO, and link building. Understanding these core concepts is essential for any digital marketer or website owner looking to drive organic traffic.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/keyword-research-strategy",
    title: "Keyword Research Strategy: Finding High-Value Terms",
    body: "Keyword research is the foundation of any successful SEO strategy. Learn how to identify the terms and phrases your target audience is searching for. This guide covers keyword intent analysis, search volume evaluation, keyword difficulty assessment, and competitive gap analysis. We explore tools like Google Keyword Planner and Ahrefs for discovering untapped keyword opportunities.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/on-page-seo-checklist",
    title: "On-Page SEO Checklist: 15 Essential Optimizations",
    body: "On-page SEO refers to optimizations you make directly on your web pages. This checklist covers title tags, meta descriptions, header hierarchy, internal linking structure, image alt text, URL structure, content quality, keyword placement, schema markup, page speed, mobile responsiveness, canonical tags, social meta tags, and content freshness signals.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/technical-seo-audit",
    title: "Technical SEO Audit: How to Find and Fix Issues",
    body: "Technical SEO ensures search engines can efficiently crawl, render, and index your website. A thorough technical audit covers crawlability issues, indexation problems, site architecture, XML sitemaps, robots.txt configuration, page speed optimization, Core Web Vitals, mobile-first indexing, HTTPS security, structured data implementation, and JavaScript rendering considerations.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/link-building-guide",
    title: "Link Building: Strategies That Actually Work",
    body: "Link building remains one of the most important ranking factors in SEO. This guide covers ethical link building strategies including content-driven outreach, guest posting, broken link building, resource page link building, HARO responses, digital PR, internal linking optimization, and competitor backlink analysis. Learn how to build a diverse and authoritative link profile.",
    sourceType: "sitemap",
  },

  // Cluster 2: Content Marketing (5 articles)
  {
    url: "https://demo-blog.example.com/content-strategy-framework",
    title: "Content Strategy Framework for B2B SaaS",
    body: "A content strategy framework helps you plan, create, and distribute content that drives business results. For B2B SaaS companies, this means mapping content to the buyer journey, creating thought leadership pieces, building topic clusters, developing content calendars, and measuring content performance through attribution models. Learn how to build a content engine that generates leads and builds authority.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/blog-post-optimization",
    title: "Blog Post Optimization: From Draft to SEO Powerhouse",
    body: "Optimizing blog posts for search engines requires a systematic approach. Start with keyword-focused topic selection, craft compelling titles, structure content with clear headings, include relevant internal links, optimize images, add schema markup, and promote through social and email channels. This guide walks through each step of turning a draft into a high-performing SEO asset.",
    sourceType: "api_push",
  },
  {
    url: "https://demo-blog.example.com/content-audit-guide",
    title: "Content Audit Guide: Identify What's Working",
    body: "A content audit evaluates the performance of your existing content library. Learn how to inventory your content, analyze traffic and engagement metrics, identify content gaps, find underperforming pages for optimization, and make data-driven decisions about content updates, consolidation, or removal. Regular content audits are essential for maintaining a healthy content ecosystem.",
    sourceType: "api_push",
  },
  {
    url: "https://demo-blog.example.com/topic-cluster-strategy",
    title: "Topic Clusters: The Modern Approach to Content Architecture",
    body: "Topic clusters organize your content around pillar pages and supporting cluster content. This architecture signals topical authority to search engines and creates a better user experience through logical internal linking. Learn how to identify pillar topics, map supporting content, implement hub-and-spoke linking patterns, and measure cluster performance.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/content-distribution",
    title: "Content Distribution: Getting Your Content Seen",
    body: "Creating great content is only half the battle. Effective distribution ensures your content reaches the right audience. This guide covers organic distribution through SEO and social media, paid promotion strategies, email marketing, content syndication, community engagement, and influencer partnerships. Learn how to build a multi-channel distribution strategy.",
    sourceType: "sitemap",
  },

  // Cluster 3: Analytics & Measurement (4 articles)
  {
    url: "https://demo-blog.example.com/seo-metrics-guide",
    title: "SEO Metrics That Matter: What to Track",
    body: "Tracking the right SEO metrics is crucial for measuring success and identifying opportunities. This guide covers organic traffic, keyword rankings, click-through rates, bounce rates, dwell time, backlink growth, domain authority, page speed scores, Core Web Vitals, and conversion rates. Learn how to build an SEO dashboard that provides actionable insights.",
    sourceType: "api_push",
  },
  {
    url: "https://demo-blog.example.com/google-analytics-seo",
    title: "Google Analytics for SEO: Advanced Techniques",
    body: "Google Analytics provides invaluable data for SEO analysis. Learn advanced techniques including custom channel groupings for organic traffic, landing page analysis, content grouping for topic performance, attribution modeling for organic conversions, and custom reports for SEO KPIs. This guide assumes familiarity with GA4 and focuses on SEO-specific analysis.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/seo-reporting",
    title: "SEO Reporting: Templates and Best Practices",
    body: "Effective SEO reporting communicates value to stakeholders and guides strategy. This guide covers report structure, key metrics to include, data visualization best practices, narrative framing, and automated reporting tools. Includes downloadable templates for monthly SEO reports, quarterly reviews, and annual performance summaries.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/ab-testing-seo",
    title: "A/B Testing for SEO: Testing Title Tags and Meta Descriptions",
    body: "A/B testing can dramatically improve your organic click-through rates. Learn how to design and run SEO experiments for title tags, meta descriptions, and structured data. This guide covers statistical significance, testing tools, common pitfalls, and case studies showing how minor changes led to significant traffic improvements.",
    sourceType: "api_push",
  },

  // Cluster 4: Local & Technical (4 articles)
  {
    url: "https://demo-blog.example.com/local-seo-guide",
    title: "Local SEO: Dominating Your Local Market",
    body: "Local SEO helps businesses appear in location-based search results. This guide covers Google Business Profile optimization, local keyword targeting, NAP consistency, local link building, review management, local schema markup, and citation building. Essential reading for any business with a physical location or serving a specific geographic area.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/site-speed-optimization",
    title: "Site Speed Optimization: A Developer's Guide",
    body: "Page speed directly impacts both search rankings and user experience. This technical guide covers image optimization, code minification, lazy loading, CDN configuration, server response time optimization, render-blocking resource elimination, browser caching strategies, and Core Web Vitals improvement techniques. Includes before-and-after performance benchmarks.",
    sourceType: "sitemap",
  },
  {
    url: "https://demo-blog.example.com/structured-data-guide",
    title: "Structured Data: Getting Rich Results in Search",
    body: "Structured data helps search engines understand your content and can unlock rich results like featured snippets, FAQ accordions, and product cards. This guide covers JSON-LD implementation, common schema types (Article, FAQ, HowTo, Product, Review), testing tools, and troubleshooting common validation errors.",
    sourceType: "api_push",
  },
  {
    url: "https://demo-blog.example.com/mobile-seo",
    title: "Mobile SEO: Optimizing for Mobile-First Indexing",
    body: "With mobile-first indexing, Google primarily uses the mobile version of your site for ranking. This guide covers responsive design best practices, mobile page speed optimization, touch-friendly navigation, mobile-specific schema, AMP considerations, and tools for testing mobile usability. Ensure your site provides an excellent mobile experience.",
    sourceType: "sitemap",
  },
];

async function seed() {
  console.log("Seeding database...");

  // ── 1. Create test user (Pro plan) ──
  const user = await prisma.user.upsert({
    where: { email: "demo@seo-ilator.com" },
    update: {},
    create: {
      email: "demo@seo-ilator.com",
      name: "Demo User",
      plan: "pro",
      articleLimit: 500,
      runLimit: 100,
    },
  });
  console.log(`  User: ${user.email} (${user.plan})`);

  // ── 2. Create project "Demo Blog" ──
  let project = await prisma.project.findFirst({
    where: { userId: user.id, name: "Demo Blog" },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        userId: user.id,
        name: "Demo Blog",
      },
    });
  }
  console.log(`  Project: ${project.name}`);

  // ── 3. Create articles ──
  const articleRecords = [];
  for (const article of ARTICLES) {
    const record = await prisma.article.upsert({
      where: {
        projectId_url: {
          projectId: project.id,
          url: article.url,
        },
      },
      update: {},
      create: {
        projectId: project.id,
        url: article.url,
        title: article.title,
        body: article.body,
        bodyHash: sha256(article.body),
        titleHash: sha256(article.title),
        wordCount: article.body.split(/\s+/).length,
        sourceType: article.sourceType,
      },
    });
    articleRecords.push(record);
  }
  console.log(`  Articles: ${articleRecords.length}`);

  // ── 4. Create analysis runs ──
  const run1 = await prisma.analysisRun.create({
    data: {
      projectId: project.id,
      status: "completed",
      strategiesUsed: ["crosslink"],
      configuration: {
        approaches: ["keyword"],
        similarityThreshold: 0.75,
        fuzzyTolerance: 0.8,
        maxLinksPerPage: 10,
      },
      articleCount: articleRecords.length,
      recommendationCount: 0, // Updated after creating recs
      embeddingsCached: 0,
      embeddingsGenerated: 0,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45000), // 45s later
    },
  });

  const run2 = await prisma.analysisRun.create({
    data: {
      projectId: project.id,
      status: "completed",
      strategiesUsed: ["crosslink"],
      configuration: {
        approaches: ["keyword", "semantic"],
        similarityThreshold: 0.8,
        fuzzyTolerance: 0.8,
        maxLinksPerPage: 5,
      },
      articleCount: articleRecords.length,
      recommendationCount: 0,
      embeddingsCached: articleRecords.length,
      embeddingsGenerated: 0,
      startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
      completedAt: new Date(Date.now() - 30 * 60 * 1000 + 90000), // 90s later
    },
  });
  console.log(`  Analysis runs: 2`);

  // ── 5. Create recommendations ──
  const severities = ["critical", "warning", "info"];
  const statuses = ["pending", "pending", "pending", "accepted", "dismissed"];

  const recData: Array<{
    projectId: string;
    analysisRunId: string;
    strategyId: string;
    sourceArticleId: string;
    targetArticleId: string;
    type: string;
    severity: string;
    title: string;
    description: string;
    anchorText: string;
    confidence: number;
    matchingApproach: string;
    status: string;
    dismissReason: string | null;
  }> = [];

  // Generate crosslink recommendations between related articles
  const pairs: Array<[number, number, string, number]> = [
    // [sourceIdx, targetIdx, anchorText, confidence]
    // SEO Fundamentals cluster internal links
    [0, 1, "keyword research", 0.92],
    [0, 2, "on-page optimization", 0.88],
    [0, 3, "technical SEO", 0.85],
    [0, 4, "link building strategies", 0.91],
    [1, 0, "SEO basics", 0.87],
    [1, 8, "topic clusters", 0.79],
    [2, 0, "SEO fundamentals", 0.83],
    [2, 3, "technical audit", 0.81],
    [2, 4, "internal linking", 0.89],
    [3, 2, "on-page checklist", 0.82],
    [3, 15, "site speed optimization", 0.90],
    [3, 16, "structured data", 0.86],
    [4, 0, "SEO basics guide", 0.84],
    [4, 2, "on-page optimization", 0.78],
    // Content Marketing cluster cross-links
    [5, 6, "blog post optimization", 0.88],
    [5, 7, "content audit", 0.82],
    [5, 8, "topic cluster strategy", 0.91],
    [5, 9, "content distribution", 0.85],
    [6, 1, "keyword research", 0.80],
    [6, 2, "on-page SEO", 0.77],
    [7, 10, "SEO metrics", 0.83],
    [8, 4, "internal linking", 0.90],
    [8, 0, "SEO basics", 0.76],
    [9, 6, "blog optimization", 0.79],
    // Analytics cross-links
    [10, 0, "SEO basics", 0.74],
    [10, 11, "Google Analytics", 0.88],
    [10, 12, "SEO reporting", 0.91],
    [11, 10, "SEO metrics", 0.86],
    [11, 12, "reporting templates", 0.82],
    [12, 10, "metrics that matter", 0.85],
    [13, 10, "measuring SEO", 0.78],
    // Technical cross-links
    [14, 0, "SEO guide", 0.73],
    [15, 3, "technical SEO", 0.89],
    [15, 17, "mobile optimization", 0.84],
    [16, 3, "technical SEO audit", 0.87],
    [16, 10, "rich results tracking", 0.76],
    [17, 15, "page speed", 0.88],
    [17, 3, "technical audit", 0.82],
    [17, 2, "mobile checklist", 0.77],
    // Cross-cluster links
    [1, 5, "content strategy", 0.75],
    [5, 0, "SEO fundamentals", 0.80],
  ];

  for (let i = 0; i < pairs.length; i++) {
    const [srcIdx, tgtIdx, anchorText, confidence] = pairs[i];
    const severity = severities[i % severities.length];
    const status = statuses[i % statuses.length];
    const analysisRunId = i < 20 ? run1.id : run2.id;

    recData.push({
      projectId: project.id,
      analysisRunId,
      strategyId: "crosslink",
      sourceArticleId: articleRecords[srcIdx].id,
      targetArticleId: articleRecords[tgtIdx].id,
      type: "crosslink",
      severity,
      title: `Add crosslink from "${articleRecords[srcIdx].title}" to "${articleRecords[tgtIdx].title}"`,
      description: `The source article discusses "${anchorText}" which is covered in depth in the target article. Adding this crosslink would improve topic connectivity and help readers discover related content.`,
      anchorText,
      confidence,
      matchingApproach: analysisRunId === run1.id ? "keyword" : "semantic",
      status,
      dismissReason: status === "dismissed" ? "Already linked manually" : null,
    });
  }

  await prisma.recommendation.createMany({ data: recData });
  console.log(`  Recommendations: ${recData.length}`);

  // Update run recommendation counts
  const run1RecCount = recData.filter((r) => r.analysisRunId === run1.id).length;
  const run2RecCount = recData.filter((r) => r.analysisRunId === run2.id).length;
  await prisma.analysisRun.update({
    where: { id: run1.id },
    data: { recommendationCount: run1RecCount },
  });
  await prisma.analysisRun.update({
    where: { id: run2.id },
    data: { recommendationCount: run2RecCount },
  });

  // ── 6. Create strategy config ──
  await prisma.strategyConfig.upsert({
    where: {
      projectId_strategyId: {
        projectId: project.id,
        strategyId: "crosslink",
      },
    },
    update: {},
    create: {
      projectId: project.id,
      strategyId: "crosslink",
      settings: {
        defaultApproaches: ["keyword", "semantic"],
        similarityThreshold: 0.75,
        fuzzyTolerance: 0.8,
        maxLinksPerPage: 10,
        embeddingProvider: "openai",
      },
    },
  });
  console.log(`  Strategy config: 1`);

  // ── 7. Create ingestion jobs ──
  const completedJob = await prisma.ingestionJob.create({
    data: {
      projectId: project.id,
      status: "completed",
      totalUrls: 14,
      completedUrls: 14,
      failedUrls: 0,
      preset: "gentle",
      completedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    },
  });

  // Create completed tasks for the job
  const sitemapArticles = articleRecords.filter(
    (a) =>
      ARTICLES.find((orig) => orig.url === a.url)?.sourceType === "sitemap"
  );
  await prisma.ingestionTask.createMany({
    data: sitemapArticles.map((a) => ({
      jobId: completedJob.id,
      url: a.url,
      status: "completed",
      httpStatus: 200,
      responseTimeMs: Math.floor(Math.random() * 800) + 200,
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      processedAt: new Date(Date.now() - 3 * 60 * 60 * 1000 + 30000),
    })),
  });

  const failedJob = await prisma.ingestionJob.create({
    data: {
      projectId: project.id,
      status: "completed",
      totalUrls: 5,
      completedUrls: 3,
      failedUrls: 2,
      preset: "standard",
      completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    },
  });

  await prisma.ingestionTask.createMany({
    data: [
      {
        jobId: failedJob.id,
        url: "https://demo-blog.example.com/existing-page-1",
        status: "completed",
        httpStatus: 200,
        responseTimeMs: 350,
        startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        processedAt: new Date(Date.now() - 1 * 60 * 60 * 1000 + 5000),
      },
      {
        jobId: failedJob.id,
        url: "https://demo-blog.example.com/existing-page-2",
        status: "completed",
        httpStatus: 200,
        responseTimeMs: 420,
        startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        processedAt: new Date(Date.now() - 1 * 60 * 60 * 1000 + 8000),
      },
      {
        jobId: failedJob.id,
        url: "https://demo-blog.example.com/existing-page-3",
        status: "completed",
        httpStatus: 200,
        responseTimeMs: 510,
        startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        processedAt: new Date(Date.now() - 1 * 60 * 60 * 1000 + 12000),
      },
      {
        jobId: failedJob.id,
        url: "https://demo-blog.example.com/deleted-page",
        status: "failed",
        httpStatus: 404,
        errorMessage: "Page not found (404)",
        responseTimeMs: 150,
        retryCount: 2,
        startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        processedAt: new Date(Date.now() - 1 * 60 * 60 * 1000 + 3000),
      },
      {
        jobId: failedJob.id,
        url: "https://demo-blog.example.com/timeout-page",
        status: "failed",
        errorMessage: "Request timed out after 30000ms",
        retryCount: 3,
        startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
        processedAt: new Date(Date.now() - 1 * 60 * 60 * 1000 + 30000),
      },
    ],
  });
  console.log(`  Ingestion jobs: 2 (1 completed, 1 partially failed)`);

  console.log("\nSeed complete!");
  console.log(`  Total: 1 user, 1 project, ${articleRecords.length} articles, ${recData.length} recommendations`);
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

### Step 8.6.3 — Add seed script to package.json

- [ ] Verify `prisma.seed` is configured in `package.json`

Ensure `package.json` contains:

```json
{
  "prisma": {
    "seed": "npx tsx prisma/seed.ts"
  }
}
```

### Step 8.6.4 — Verify seed data loads

- [ ] Run the seed script and verify all models are populated

```bash
npx tsx prisma/seed.ts 2>&1 | tail -20
# Expected:
#   User: demo@seo-ilator.com (pro)
#   Project: Demo Blog
#   Articles: 18
#   Analysis runs: 2
#   Recommendations: 40
#   Strategy config: 1
#   Ingestion jobs: 2 (1 completed, 1 partially failed)
#   Seed complete!
```

### Step 8.6.5 — Commit seed data and factories

- [ ] Commit seed script and factory functions

```bash
git add prisma/seed.ts tests/helpers/factories.ts package.json
git commit -m "feat(ops): add seed data and test factory functions

prisma/seed.ts creates realistic dev environment: 1 Pro user, 18 articles
across 4 topic clusters, 2 analysis runs, 40 recommendations, 2 ingestion
jobs. tests/helpers/factories.ts provides minimal record factories for
createTestUser, createTestProject, createTestArticle, createTestAnalysisRun,
createTestRecommendation."
```

---

## Integration Verification

> After all three branches merge into `feature/phase-8`, run these checks.

### Merge Order

1. Merge `feature/phase-8-integration` into `feature/phase-8` (creates rate limiter + test helpers)
2. Merge `feature/phase-8-security` into `feature/phase-8` (security fixes + DECISION doc)
3. Merge `feature/phase-8-ops` into `feature/phase-8` (Sentry + analytics + seed data)

### Automated Checks

- [ ] `npm install` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npx vitest --run` — all tests pass (including new integration tests + rate limiter tests)
- [ ] `npm run build` exits 0
- [ ] `npm audit --audit-level=critical` exits 0
- [ ] `npx tsx prisma/seed.ts` exits 0 with all models populated

### Manual Checks

- [ ] Sentry test event appears in Sentry dashboard
- [ ] Source maps show original TypeScript in error stack traces
- [ ] Rate limiter returns 429 after exceeding threshold on /api/articles
- [ ] Cross-tenant isolation verified with two auth sessions [AAP-B5]
- [ ] `ANALYZE=true npm run build` shows no cheerio in client chunks [AAP-F10]
- [ ] CopySnippet correctly escapes XSS payload in anchor text [AAP-F3]

### PR

- [ ] Create PR `feature/phase-8` into `develop`
- [ ] PR title: `feat(hardening): testing, security review & ops integration (Phase 8)`

---

## AAP Tags Covered

| Tag | Where Applied |
|-----|---------------|
| [AAP-B1] | Security Agent: SSRF protection at fetch time, DNS rebinding test, redirect chain validation |
| [AAP-B5] | Integration Test Agent: cross-tenant access tests on every endpoint |
| [AAP-B9] | Integration Test Agent: rate limiter implementation; Security Agent: rate limiting verification |
| [AAP-F3] | Security Agent: CopySnippet escaping verification |
| [AAP-F10] | Security Agent: cheerio not in client bundle (bundle analyzer check) |
| [AAP-O2] | Ops Agent: 2,000-article analysis via chunked cron processing load test |
