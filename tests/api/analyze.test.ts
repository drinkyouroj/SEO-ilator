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
      count: vi.fn(),
      findMany: vi.fn(),
    },
    analysisRun: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/embeddings", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/embeddings/cache", () => ({
  checkEmbeddingCache: vi.fn(),
}));

// Mock next/server's `after` as a no-op — it fires async side-effects we
// don't need in tests and is not available in the vitest jsdom env.
vi.mock("next/server", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (await importOriginal()) as any;
  return {
    ...original,
    after: vi.fn(),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { POST } from "@/app/api/analyze/route";
import { requireAuth } from "@/lib/auth/session";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { scopedPrisma } from "@/lib/db";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import { getProvider } from "@/lib/embeddings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckPlanLimits = vi.mocked(checkPlanLimits) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  article: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  analysisRun: {
    create: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetProvider = vi.mocked(getProvider) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckEmbeddingCache = vi.mocked(checkEmbeddingCache) as any;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown = {}): Request {
  return new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("POST /api/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
    mockCheckPlanLimits.mockResolvedValue({ allowed: true });
  });

  it("returns_202_and_creates_pending_analysis_run", async () => {
    mockDb.article.count.mockResolvedValue(5);
    mockDb.analysisRun.create.mockResolvedValue({
      id: "run-1",
      status: "pending",
      articleCount: 5,
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.runId).toBe("run-1");
    expect(body.status).toBe("pending");
    expect(body.articleCount).toBe(5);
    expect(mockDb.analysisRun.create).toHaveBeenCalledOnce();
  });

  it("returns_dry_run_summary_without_creating_run", async () => {
    mockDb.article.count.mockResolvedValue(10);
    mockDb.article.findMany.mockResolvedValue([
      { id: "a1", title: "T1", body: "B1", bodyHash: "bh1", titleHash: "th1", embeddingModel: null },
    ]);
    mockDb.$queryRaw.mockResolvedValue([
      { id: "a1", has_embedding: false },
    ]);
    mockGetProvider.mockResolvedValue({ modelId: "text-embedding-3-small" });
    mockCheckEmbeddingCache.mockReturnValue({
      cached: [],
      needsGeneration: [{ id: "a1" }],
    });

    const res = await POST(makeRequest({ dryRun: true }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.articleCount).toBe(10);
    expect(body.embeddingEstimate).toBeDefined();
    expect(body.embeddingEstimate.needsGeneration).toBe(1);
    // Should NOT create an analysis run
    expect(mockDb.analysisRun.create).not.toHaveBeenCalled();
  });

  it("returns_403_when_plan_limit_exceeded", async () => {
    mockCheckPlanLimits.mockResolvedValue({
      allowed: false,
      message: "You've reached your monthly limit of 3 analysis runs on the Free plan.",
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toBe("PLAN_LIMIT_EXCEEDED");
    expect(body.message).toMatch(/monthly limit/);
    expect(body.upgrade_url).toBeDefined();
  });

  it("returns_400_when_no_articles_exist", async () => {
    mockDb.article.count.mockResolvedValue(0);

    const res = await POST(makeRequest());
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe("NO_ARTICLES");
  });
});
