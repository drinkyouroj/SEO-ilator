import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/auth/plan-guard", () => ({
  checkPlanLimits: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    article: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    analysisRun: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    recommendation: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/ingestion/parser", () => ({
  parseHTML: vi.fn(),
  parseMarkdown: vi.fn(),
}));

vi.mock("@/lib/ingestion/normalizer", () => ({
  normalizeArticle: vi.fn(),
}));

vi.mock("@/lib/embeddings", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/embeddings/cache", () => ({
  checkEmbeddingCache: vi.fn(),
}));

vi.mock("@/lib/embeddings/batch", () => ({
  invalidateEmbedding: vi.fn(),
}));

vi.mock("@/lib/export/csv", () => ({
  serializeCsv: vi.fn(() => "csv-content"),
}));

vi.mock("@/lib/export/json", () => ({
  serializeJson: vi.fn(() => '["json-content"]'),
  jsonContentDisposition: vi.fn((f: string) => `attachment; filename="${f}"`),
}));

vi.mock("next/server", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (await importOriginal()) as any;
  return {
    ...original,
    after: vi.fn(),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { POST as pushArticle } from "@/app/api/articles/push/route";
import { POST as triggerAnalysis } from "@/app/api/analyze/route";
import { GET as getRunStatus } from "@/app/api/runs/[id]/route";
import { GET as getRecommendations } from "@/app/api/recommendations/route";
import { requireAuth } from "@/lib/auth/session";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { scopedPrisma } from "@/lib/db";
import { normalizeArticle } from "@/lib/ingestion/normalizer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckPlanLimits = vi.mocked(checkPlanLimits) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  article: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  analysisRun: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  recommendation: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockNormalize = vi.mocked(normalizeArticle) as any;

// ── Helpers ────────────────────────────────────────────────────────────

function makePushRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/articles/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeAnalyzeRequest(body: unknown = {}): Request {
  return new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRunParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Full flow: ingest -> analyze -> review -> export", () => {
  const PROJECT_ID = "proj-flow-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: PROJECT_ID, userId: "user-1" });
    mockCheckPlanLimits.mockResolvedValue({ allowed: true });
  });

  it("completes_full_ingest_analyze_review_export_flow", async () => {
    // ── Step 1: Push an article ──────────────────────────────────────
    const normalizedArticle = {
      url: "https://example.com/article-1",
      title: "How to Test APIs",
      body: "Testing APIs is essential for reliability.",
      bodyHash: "bh-1",
      titleHash: "th-1",
      wordCount: 7,
      existingLinks: [],
      metadata: {},
      sourceType: "push",
      parseWarning: null,
    };
    mockNormalize.mockReturnValue(normalizedArticle);
    mockDb.article.findUnique.mockResolvedValue(null); // not existing
    const createdArticle = { id: "art-1", projectId: PROJECT_ID, ...normalizedArticle };
    mockDb.article.create.mockResolvedValue(createdArticle);

    const pushRes = await pushArticle(
      makePushRequest({
        url: "https://example.com/article-1",
        title: "How to Test APIs",
        body: "Testing APIs is essential for reliability.",
        bodyFormat: "text",
      })
    );

    expect(pushRes.status).toBe(201);
    const pushBody = await pushRes.json();
    expect(pushBody.article.id).toBe("art-1");
    expect(pushBody.changed).toBe(true);

    // ── Step 2: Trigger analysis ─────────────────────────────────────
    mockDb.article.count.mockResolvedValue(1);
    mockDb.analysisRun.create.mockResolvedValue({
      id: "run-1",
      status: "pending",
      articleCount: 1,
    });

    const analyzeRes = await triggerAnalysis(makeAnalyzeRequest());
    expect(analyzeRes.status).toBe(202);

    const analyzeBody = await analyzeRes.json();
    expect(analyzeBody.runId).toBe("run-1");
    expect(analyzeBody.status).toBe("pending");

    // ── Step 3: Check run status ─────────────────────────────────────
    mockDb.analysisRun.findUnique.mockResolvedValue({
      id: "run-1",
      projectId: PROJECT_ID,
      status: "completed",
      articleCount: 1,
      strategiesUsed: ["crosslink"],
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    // Recommendations for this run
    mockDb.recommendation.findMany.mockResolvedValueOnce([
      { severity: "warning", status: "pending" },
      { severity: "critical", status: "pending" },
    ]);

    const runReq = new Request("http://localhost:3000/api/runs/run-1");
    const runRes = await getRunStatus(runReq, makeRunParams("run-1"));
    expect(runRes.status).toBe(200);

    const runBody = await runRes.json();
    expect(runBody.run.status).toBe("completed");
    expect(runBody.recommendations.total).toBe(2);
    expect(runBody.recommendations.bySeverity.critical).toBe(1);
    expect(runBody.recommendations.bySeverity.warning).toBe(1);

    // ── Step 4: Get recommendations ──────────────────────────────────
    const fullRecs = [
      {
        id: "rec-1",
        severity: "critical",
        confidence: 0.95,
        anchorText: "test APIs",
        matchingApproach: "keyword",
        status: "pending",
        type: "crosslink",
        title: "Add crosslink",
        description: "Link to related testing article",
        suggestion: null,
        createdAt: new Date().toISOString(),
        sourceArticle: { title: "How to Test APIs", url: "https://example.com/article-1" },
        targetArticle: { title: "API Best Practices", url: "https://example.com/article-2" },
      },
    ];
    mockDb.recommendation.findMany.mockResolvedValue(fullRecs);

    const recsReq = new Request("http://localhost:3000/api/recommendations");
    const recsRes = await getRecommendations(recsReq);
    expect(recsRes.status).toBe(200);

    const recsBody = await recsRes.json();
    expect(recsBody.recommendations).toHaveLength(1);
    expect(recsBody.recommendations[0].id).toBe("rec-1");
    expect(recsBody.recommendations[0].severity).toBe("critical");

    // ── Step 5: Export as CSV ────────────────────────────────────────
    mockDb.recommendation.count.mockResolvedValue(1);
    mockDb.recommendation.findMany.mockResolvedValue(fullRecs);

    const exportReq = new Request(
      "http://localhost:3000/api/recommendations?format=csv"
    );
    const exportRes = await getRecommendations(exportReq);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(exportRes.headers.get("Content-Disposition")).toMatch(/\.csv"/);
  });
});
