import { describe, it, expect } from "vitest";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import type { ArticleWithEmbedding } from "@/lib/embeddings/types";

const makeArticle = (
  overrides?: Partial<ArticleWithEmbedding>
): ArticleWithEmbedding => ({
  id: "art-1",
  title: "Test Title",
  body: "Test body content",
  bodyHash: "abc123",
  titleHash: "def456",
  embeddingModel: "openai/text-embedding-3-small",
  hasEmbedding: true,
  ...overrides,
});

const MODEL = "openai/text-embedding-3-small";

describe("checkEmbeddingCache", () => {
  it("returns_cached_when_all_conditions_match", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);
    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.cached).toHaveLength(1);
    expect(result.needsGeneration).toHaveLength(0);
  });

  it("returns_needs_generation_when_body_hash_changed", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "DIFFERENT", titleHash: "def456" }]]);
    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.cached).toHaveLength(0);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_title_hash_changed", () => {
    const article = makeArticle();
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "DIFFERENT" }]]);
    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_model_changed", () => {
    const article = makeArticle({ embeddingModel: "cohere/embed-english-v3.0" });
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);
    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("returns_needs_generation_when_no_embedding", () => {
    const article = makeArticle({ hasEmbedding: false, embeddingModel: null });
    const hashes = new Map([["art-1", { bodyHash: "abc123", titleHash: "def456" }]]);
    const result = checkEmbeddingCache([article], MODEL, hashes);
    expect(result.needsGeneration).toHaveLength(1);
  });

  it("splits_mixed_batch_correctly", () => {
    const cached = makeArticle({ id: "art-1" });
    const needsGen = makeArticle({ id: "art-2", hasEmbedding: false, embeddingModel: null });
    const hashes = new Map([
      ["art-1", { bodyHash: "abc123", titleHash: "def456" }],
      ["art-2", { bodyHash: "abc123", titleHash: "def456" }],
    ]);
    const result = checkEmbeddingCache([cached, needsGen], MODEL, hashes);
    expect(result.cached).toHaveLength(1);
    expect(result.cached[0].id).toBe("art-1");
    expect(result.needsGeneration).toHaveLength(1);
    expect(result.needsGeneration[0].id).toBe("art-2");
  });
});
