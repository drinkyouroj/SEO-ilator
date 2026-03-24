import { describe, it, expect, vi, beforeEach } from "vitest";
import { findSimilarArticles } from "@/lib/embeddings/similarity";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock helper for Prisma
function mockSimilarityQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  sourceEmbedding: string | null,
  similarResults: Array<{ id: string; url: string; title: string; similarity: number }>
) {
  if (sourceEmbedding === null) {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
  } else {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ embedding: sourceEmbedding }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (fn: any) => {
      const tx = {
        $executeRaw: vi.fn().mockResolvedValue(0),
        $queryRaw: vi.fn().mockResolvedValue(similarResults),
      };
      return fn(tx);
    });
  }
}

describe("findSimilarArticles", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns_similar_articles_sorted_by_similarity", async () => {
    const { prisma } = await import("@/lib/db");
    mockSimilarityQuery(prisma, "[0.1,0.2,0.3]", [
      { id: "a2", url: "https://example.com/a2", title: "Similar A", similarity: 0.95 },
      { id: "a3", url: "https://example.com/a3", title: "Similar B", similarity: 0.82 },
    ]);
    const results = await findSimilarArticles("proj-1", "a1", 10, 0.5);
    expect(results).toHaveLength(2);
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
  });

  it("excludes_source_article_from_results", async () => {
    const { prisma } = await import("@/lib/db");
    mockSimilarityQuery(prisma, "[0.1,0.2]", [
      { id: "a2", url: "https://example.com/a2", title: "Other", similarity: 0.9 },
    ]);
    const results = await findSimilarArticles("proj-1", "a1");
    expect(results.every((r) => r.id !== "a1")).toBe(true);
  });

  it("returns_empty_when_source_has_no_embedding", async () => {
    const { prisma } = await import("@/lib/db");
    mockSimilarityQuery(prisma, null, []);
    const results = await findSimilarArticles("proj-1", "no-embed");
    expect(results).toHaveLength(0);
  });

  it("respects_threshold_parameter", async () => {
    const { prisma } = await import("@/lib/db");
    mockSimilarityQuery(prisma, "[0.1,0.2]", []);
    const results = await findSimilarArticles("proj-1", "a1", 10, 0.95);
    expect(results).toHaveLength(0);
  });
});
