import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CohereEmbeddingProvider } from "@/lib/embeddings/providers/cohere";

describe("CohereEmbeddingProvider", () => {
  let provider: CohereEmbeddingProvider;

  beforeEach(() => {
    vi.stubEnv("COHERE_API_KEY", "test-cohere-key");
    provider = new CohereEmbeddingProvider();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns_embeddings_with_correct_dimensions", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ embeddings: { float: [fakeEmbedding] } }),
        { status: 200 }
      )
    );

    const result = await provider.embed(["test text"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1024);
    expect(provider.modelId).toBe("cohere/embed-english-v3.0");
    expect(provider.dimensions).toBe(1024);
    expect(provider.batchSize).toBe(96);
  });

  it("sends_correct_auth_header_and_model", async () => {
    const fakeEmbedding = Array.from({ length: 1024 }, () => 0.1);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ embeddings: { float: [fakeEmbedding] } }),
        { status: 200 }
      )
    );
    global.fetch = fetchMock;

    await provider.embed(["test text"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cohere.ai/v2/embed",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-cohere-key",
          "Content-Type": "application/json",
        }),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("embed-english-v3.0");
    expect(body.texts).toEqual(["test text"]);
    expect(body.input_type).toBe("search_document");
  });

  it("throws_on_api_error", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 })
    );

    await expect(provider.embed(["test"])).rejects.toThrow();
  });
});
