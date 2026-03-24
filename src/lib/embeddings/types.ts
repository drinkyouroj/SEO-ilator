/**
 * Core types for the embedding provider abstraction layer.
 */

/** Contract that all embedding providers implement. */
export interface EmbeddingProvider {
  /** Unique model identifier, e.g. "openai/text-embedding-3-small" */
  modelId: string;
  /** Native output dimensions (1536 for OpenAI, 1024 for Cohere) */
  dimensions: number;
  /** Max texts per API call (2048 for OpenAI, 96 for Cohere) */
  batchSize: number;
  /** Generate embeddings for one or more texts. Returns vectors in input order. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Article fields needed for embedding operations (subset of Prisma Article). */
export interface ArticleWithEmbedding {
  id: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  embeddingModel: string | null;
  /** True if the embedding column is not null. We can't type the vector directly. */
  hasEmbedding: boolean;
}

/** Result of classifying articles into cached vs needs-generation. */
export interface CacheCheckResult {
  cached: ArticleWithEmbedding[];
  needsGeneration: ArticleWithEmbedding[];
}

/** A similar article returned from a pgvector cosine distance query. */
export interface SimilarArticle {
  id: string;
  url: string;
  title: string;
  similarity: number;
}
