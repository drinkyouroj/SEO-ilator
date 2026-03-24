import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    article: { findMany: vi.fn(), count: vi.fn() },
    analysisRun: { update: vi.fn(), findUnique: vi.fn() },
    recommendation: { createMany: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/strategies", () => ({
  registry: {
    analyzeWithAll: vi.fn().mockResolvedValue([]),
    getAllStrategies: vi.fn().mockReturnValue([{ id: "crosslink", name: "Crosslink" }]),
  },
}));

vi.mock("@/lib/embeddings/batch", () => ({
  processEmbeddings: vi.fn().mockResolvedValue({ cached: 0, generated: 0, skipped: 0 }),
}));

vi.mock("@/lib/embeddings", () => ({
  getProvider: vi.fn().mockResolvedValue({
    modelId: "openai/text-embedding-3-small",
    dimensions: 1536,
    batchSize: 2048,
    embed: vi.fn(),
  }),
}));

vi.mock("@/lib/analysis/dedup-ranker", () => ({
  dedupAndRank: vi.fn((recs) => recs),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { processAnalysisRun } from "@/lib/analysis/orchestrator";
import { prisma } from "@/lib/db";
import { processEmbeddings } from "@/lib/embeddings/batch";

// ── Helpers ────────────────────────────────────────────────────────────

const RUN_ID = "run-1";
const PROJECT_ID = "proj-1";

function mockRun(overrides?: Record<string, unknown>) {
  return {
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: "pending",
    strategiesUsed: ["crosslink"],
    configuration: {},
    articleCount: 0,
    recommendationCount: 0,
    embeddingsCached: 0,
    embeddingsGenerated: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("processAnalysisRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: findUnique returns a pending run
    vi.mocked(prisma.analysisRun.findUnique).mockResolvedValue(mockRun() as never);

    // Default: $transaction executes the callback directly
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      // Array-style transaction
      return fn;
    });
  });

  it("creates_run_and_transitions_to_completed", async () => {
    // No articles in the project
    vi.mocked(prisma.article.findMany).mockResolvedValue([] as never);

    await processAnalysisRun(RUN_ID, PROJECT_ID);

    // Should have been called to transition to "running" first
    const updateCalls = vi.mocked(prisma.analysisRun.update).mock.calls;
    const runningCall = updateCalls.find(
      (call) => (call[0] as { data: { status: string } }).data.status === "running"
    );
    expect(runningCall).toBeDefined();

    // Should end with "completed"
    const completedCall = updateCalls.find(
      (call) => (call[0] as { data: { status: string } }).data.status === "completed"
    );
    expect(completedCall).toBeDefined();
    const completedData = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(completedData.articleCount).toBe(0);
    expect(completedData.recommendationCount).toBe(0);
  });

  it("transitions_to_failed_on_error", async () => {
    // article.findMany rejects with an error
    vi.mocked(prisma.article.findMany).mockRejectedValue(new Error("DB connection lost"));

    await processAnalysisRun(RUN_ID, PROJECT_ID);

    const updateCalls = vi.mocked(prisma.analysisRun.update).mock.calls;
    const failedCall = updateCalls.find(
      (call) => (call[0] as { data: { status: string } }).data.status === "failed"
    );
    expect(failedCall).toBeDefined();
    const failedData = (failedCall![0] as { data: Record<string, unknown> }).data;
    expect(failedData.error).toContain("DB connection lost");
  });

  it("tracks_embedding_cache_counters", async () => {
    // Return some articles so embedding processing is reached
    const articles = [
      {
        id: "a1",
        projectId: PROJECT_ID,
        url: "https://example.com/1",
        title: "Article 1",
        body: "body",
        bodyHash: "bh1",
        titleHash: "th1",
        wordCount: 100,
        metadata: null,
        sourceType: null,
        httpStatus: 200,
        existingLinks: null,
        parseWarning: null,
        embeddingModel: "openai/text-embedding-3-small",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    vi.mocked(prisma.article.findMany).mockResolvedValue(articles as never);

    // processEmbeddings returns cache counters
    vi.mocked(processEmbeddings).mockResolvedValue({
      cached: 10,
      generated: 5,
      skipped: 1,
    });

    await processAnalysisRun(RUN_ID, PROJECT_ID);

    const updateCalls = vi.mocked(prisma.analysisRun.update).mock.calls;
    const completedCall = updateCalls.find(
      (call) => (call[0] as { data: { status: string } }).data.status === "completed"
    );
    expect(completedCall).toBeDefined();
    const completedData = (completedCall![0] as { data: Record<string, unknown> }).data;
    expect(completedData.embeddingsCached).toBe(10);
    expect(completedData.embeddingsGenerated).toBe(5);
  });
});
