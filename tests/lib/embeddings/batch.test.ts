import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

// Mock checkEmbeddingCache so we can control cached/needsGeneration splits
vi.mock("@/lib/embeddings/cache", () => ({
  checkEmbeddingCache: vi.fn(),
}));

import { processEmbeddings } from "@/lib/embeddings/batch";
import { prisma } from "@/lib/db";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import type { ArticleWithEmbedding, EmbeddingProvider } from "@/lib/embeddings/types";
import type { CacheCheckResult } from "@/lib/embeddings/types";

const makeArticle = (overrides?: Partial<ArticleWithEmbedding>): ArticleWithEmbedding => ({
  id: "art-1",
  title: "Test Title",
  body: "Test body content",
  bodyHash: "abc123",
  titleHash: "def456",
  embeddingModel: null,
  hasEmbedding: false,
  ...overrides,
});

const makeProvider = (overrides?: Partial<EmbeddingProvider>): EmbeddingProvider => ({
  modelId: "openai/text-embedding-3-small",
  dimensions: 1536,
  batchSize: 2,
  embed: vi.fn(),
  ...overrides,
});

const mockCheckCache = vi.mocked(checkEmbeddingCache);
const mockExecuteRawUnsafe = vi.mocked(prisma.$executeRawUnsafe);

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteRawUnsafe.mockResolvedValue(1);
});

describe("processEmbeddings", () => {
  it("skips_api_call_for_fully_cached_batch", async () => {
    const article = makeArticle({ id: "art-1", hasEmbedding: true, embeddingModel: "openai/text-embedding-3-small" });
    const provider = makeProvider();
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);

    mockCheckCache.mockReturnValue({ cached: [article], needsGeneration: [] } as CacheCheckResult);

    const result = await processEmbeddings("project-1", [article], provider, hashes);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
    expect(result.cached).toBe(1);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("zero_pads_shorter_vectors_to_storage_dimensions", async () => {
    const article = makeArticle({ id: "art-1" });
    const provider = makeProvider({
      dimensions: 1024,
      batchSize: 10,
      embed: vi.fn().mockResolvedValue([Array.from({ length: 1024 }, () => 0.1)]),
    });
    const hashes = new Map<string, { bodyHash: string; titleHash: string }>();

    mockCheckCache.mockReturnValue({ cached: [], needsGeneration: [article] } as CacheCheckResult);

    await processEmbeddings("project-1", [article], provider, hashes);

    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    const vectorArg: string = mockExecuteRawUnsafe.mock.calls[0][1] as string;
    // Parse the stored vector string
    const storedVector: number[] = JSON.parse(vectorArg);
    expect(storedVector).toHaveLength(1536);
    // First 1024 values should be the provider output
    expect(storedVector[0]).toBeCloseTo(0.1);
    expect(storedVector[1023]).toBeCloseTo(0.1);
    // Padded values should be 0
    expect(storedVector[1024]).toBe(0);
    expect(storedVector[1535]).toBe(0);
  });

  it("chunks_large_batches", async () => {
    const articles = Array.from({ length: 5 }, (_, i) =>
      makeArticle({ id: `art-${i + 1}`, title: `Title ${i + 1}`, body: `Body ${i + 1}` })
    );
    const provider = makeProvider({
      batchSize: 2,
      embed: vi.fn().mockResolvedValue([
        Array.from({ length: 1536 }, () => 0.1),
        Array.from({ length: 1536 }, () => 0.2),
      ]),
    });
    const hashes = new Map<string, { bodyHash: string; titleHash: string }>();

    mockCheckCache.mockReturnValue({ cached: [], needsGeneration: articles } as CacheCheckResult);

    const result = await processEmbeddings("project-1", articles, provider, hashes);

    // 5 articles at batchSize 2 → ceil(5/2) = 3 API calls
    expect(provider.embed).toHaveBeenCalledTimes(3);
    expect(result.generated).toBe(5);
    expect(result.cached).toBe(0);
  });

  it("returns_zero_for_empty_article_list", async () => {
    const provider = makeProvider();
    const hashes = new Map<string, { bodyHash: string; titleHash: string }>();

    mockCheckCache.mockReturnValue({ cached: [], needsGeneration: [] } as CacheCheckResult);

    const result = await processEmbeddings("project-1", [], provider, hashes);

    expect(provider.embed).not.toHaveBeenCalled();
    expect(result.cached).toBe(0);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("skips_articles_with_empty_body", async () => {
    const emptyArticle = makeArticle({ id: "art-empty", title: "", body: "" });
    const whitespaceArticle = makeArticle({ id: "art-ws", title: "   ", body: "  " });
    const validArticle = makeArticle({ id: "art-valid", title: "Real Title", body: "Real body" });
    const provider = makeProvider({
      batchSize: 10,
      embed: vi.fn().mockResolvedValue([Array.from({ length: 1536 }, () => 0.5)]),
    });
    const hashes = new Map<string, { bodyHash: string; titleHash: string }>();

    // checkEmbeddingCache returns all three as needsGeneration
    mockCheckCache.mockReturnValue({
      cached: [],
      needsGeneration: [emptyArticle, whitespaceArticle, validArticle],
    } as CacheCheckResult);

    const result = await processEmbeddings(
      "project-1",
      [emptyArticle, whitespaceArticle, validArticle],
      provider,
      hashes
    );

    // Empty articles are skipped, only valid one gets embedded
    expect(provider.embed).toHaveBeenCalledOnce();
    expect(provider.embed).toHaveBeenCalledWith(
      expect.arrayContaining(["Real Title\n\nReal body"])
    );
    expect(result.skipped).toBe(2);
    expect(result.generated).toBe(1);
  });

  it("handles_provider_error_mid_batch", async () => {
    const articles = Array.from({ length: 4 }, (_, i) =>
      makeArticle({ id: `art-${i + 1}`, title: `Title ${i + 1}`, body: `Body ${i + 1}` })
    );
    // batchSize 2 → 2 batches; second call rejects
    const provider = makeProvider({
      batchSize: 2,
      embed: vi
        .fn()
        .mockResolvedValueOnce([
          Array.from({ length: 1536 }, () => 0.1),
          Array.from({ length: 1536 }, () => 0.1),
        ])
        .mockRejectedValueOnce(new Error("Provider timeout")),
    });
    const hashes = new Map<string, { bodyHash: string; titleHash: string }>();

    mockCheckCache.mockReturnValue({ cached: [], needsGeneration: articles } as CacheCheckResult);

    await expect(
      processEmbeddings("project-1", articles, provider, hashes)
    ).rejects.toThrow("Provider timeout");
  });
});
