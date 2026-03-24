import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GroqEmbeddingProvider } from "@/lib/embeddings/providers/groq";

describe("GroqEmbeddingProvider", () => {
  beforeEach(() => {
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("throws_when_api_key_missing", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const provider = new GroqEmbeddingProvider();
    await expect(provider.embed(["test"])).rejects.toThrow("GROQ_API_KEY");
  });

  it("returns_embeddings_in_openai_compatible_format", async () => {
    const mockEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    const mockResponse = {
      data: [
        { index: 0, embedding: mockEmbeddings[0] },
        { index: 1, embedding: mockEmbeddings[1] },
      ],
    };

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const provider = new GroqEmbeddingProvider();
    const result = await provider.embed(["text 1", "text 2"]);

    expect(result).toEqual(mockEmbeddings);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-groq-key",
        }),
      }),
    );
  });

  it("throws_on_api_error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Rate limit exceeded", { status: 429 }),
    );

    const provider = new GroqEmbeddingProvider();
    await expect(provider.embed(["test"])).rejects.toThrow("Groq API error (429)");
  });

  it("has_correct_model_metadata", () => {
    const provider = new GroqEmbeddingProvider();
    expect(provider.modelId).toBe("groq/llama3-embedding-large");
    expect(provider.dimensions).toBe(1024);
    expect(provider.batchSize).toBe(512);
  });
});
