import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist a single shared mock function so every new OpenAI() call shares it
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn(function () {
    return { embeddings: { create: mockCreate } };
  }),
}));

import { OpenAIEmbeddingProvider } from "@/lib/embeddings/providers/openai";

describe("OpenAIEmbeddingProvider", () => {
  let provider: OpenAIEmbeddingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIEmbeddingProvider();
  });

  it("returns_embeddings_with_correct_dimensions", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockCreate.mockResolvedValue({
      data: [{ embedding: fakeEmbedding, index: 0 }],
    });

    const result = await provider.embed(["test text"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1536);
    expect(provider.modelId).toBe("openai/text-embedding-3-small");
    expect(provider.dimensions).toBe(1536);
    expect(provider.batchSize).toBe(2048);
  });

  it("handles_batch_input", async () => {
    const fakeEmbedding = Array.from({ length: 1536 }, () => 0.1);
    mockCreate.mockResolvedValue({
      data: [
        { embedding: fakeEmbedding, index: 0 },
        { embedding: fakeEmbedding, index: 1 },
        { embedding: fakeEmbedding, index: 2 },
      ],
    });

    const result = await provider.embed(["text1", "text2", "text3"]);
    expect(result).toHaveLength(3);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        input: ["text1", "text2", "text3"],
        model: "text-embedding-3-small",
      })
    );
  });

  it("throws_on_api_error", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limit exceeded"));
    await expect(provider.embed(["test"])).rejects.toThrow("API rate limit exceeded");
  });
});
