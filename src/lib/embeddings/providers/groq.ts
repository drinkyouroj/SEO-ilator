import type { EmbeddingProvider } from "../types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/embeddings";

/**
 * Groq embedding provider using their OpenAI-compatible API.
 * Uses direct fetch (same pattern as Cohere) to avoid requiring
 * the OpenAI SDK to be configured with a non-default base URL.
 *
 * Model: llama3-embedding-large (1024 dimensions)
 * Batch size: 512 (conservative limit)
 */
export class GroqEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "groq/llama3-embedding-large";
  readonly dimensions = 1024;
  readonly batchSize = 512;

  async embed(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY environment variable is required");
    }

    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3-embedding-large",
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error (${response.status}): ${error}`);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data) || data.data.length !== texts.length) {
      throw new Error(
        `Groq API returned unexpected response shape. ` +
        `Expected data array of length ${texts.length}, ` +
        `got: ${JSON.stringify(data.data ? data.data.length : data).toString().slice(0, 200)}`
      );
    }

    // OpenAI-compatible format: data[].embedding, sorted by index
    const sorted = [...data.data].sort(
      (a: { index: number }, b: { index: number }) => a.index - b.index
    );
    return sorted.map((d: { embedding: number[] }) => d.embedding);
  }
}
