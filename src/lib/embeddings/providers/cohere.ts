import type { EmbeddingProvider } from "../types";

const COHERE_API_URL = "https://api.cohere.ai/v2/embed";

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "cohere/embed-english-v3.0";
  readonly dimensions = 1024;
  readonly batchSize = 96;

  async embed(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      throw new Error("COHERE_API_KEY environment variable is required");
    }

    const response = await fetch(COHERE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "embed-english-v3.0",
        texts,
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.embeddings.float;
  }
}
