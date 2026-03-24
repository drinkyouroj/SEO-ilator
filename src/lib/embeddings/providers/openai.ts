import OpenAI from "openai";
import type { EmbeddingProvider } from "../types";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "openai/text-embedding-3-small";
  readonly dimensions = 1536;
  readonly batchSize = 2048;

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      input: texts,
      model: "text-embedding-3-small",
    });

    const sorted = response.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}
