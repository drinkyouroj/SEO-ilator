import { prisma } from "@/lib/db";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import { STORAGE_DIMENSIONS } from "@/lib/embeddings/providers";
import type { ArticleWithEmbedding, EmbeddingProvider } from "@/lib/embeddings/types";

export interface BatchProcessResult {
  cached: number;
  generated: number;
  skipped: number;
}

/**
 * Zero-pad a vector to the target length.
 * If the vector is already at or longer than target, it is returned as-is.
 */
function zeroPad(vector: number[], target: number): number[] {
  if (vector.length >= target) return vector;
  const padded = new Array(target).fill(0);
  for (let i = 0; i < vector.length; i++) {
    padded[i] = vector[i];
  }
  return padded;
}

/**
 * Process embeddings for a set of articles, using the cache to avoid redundant
 * API calls, zero-padding shorter vectors to STORAGE_DIMENSIONS (1536), and
 * persisting results via raw SQL for pgvector compatibility.
 *
 * @param projectId    - Tenant project ID (used for cache keying)
 * @param articles     - Articles to process
 * @param provider     - Embedding provider to use for generation
 * @param currentHashes - Per-article hash map for cache validation
 * @returns Counts of cached, generated, and skipped articles
 */
export async function processEmbeddings(
  projectId: string,
  articles: ArticleWithEmbedding[],
  provider: EmbeddingProvider,
  currentHashes: Map<string, { bodyHash: string; titleHash: string }>
): Promise<BatchProcessResult> {
  if (articles.length === 0) {
    return { cached: 0, generated: 0, skipped: 0 };
  }

  // Split into cached vs needs-generation using cache check
  const { cached, needsGeneration } = checkEmbeddingCache(
    articles,
    provider.modelId,
    currentHashes
  );

  // Pre-filter: skip articles with no meaningful content
  const toEmbed: ArticleWithEmbedding[] = [];
  let skipped = 0;
  for (const article of needsGeneration) {
    if ((article.title + article.body).trim().length === 0) {
      skipped++;
    } else {
      toEmbed.push(article);
    }
  }

  // Chunk into provider.batchSize batches and call embed()
  let generated = 0;
  for (let i = 0; i < toEmbed.length; i += provider.batchSize) {
    const batch = toEmbed.slice(i, i + provider.batchSize);
    const texts = batch.map((a) => `${a.title}\n\n${a.body}`);

    const vectors = await provider.embed(texts);

    // Persist each embedding via raw SQL for pgvector compatibility
    for (let j = 0; j < batch.length; j++) {
      const article = batch[j];
      const paddedVector = zeroPad(vectors[j], STORAGE_DIMENSIONS);
      const vectorStr = `[${paddedVector.join(",")}]`;

      await prisma.$executeRawUnsafe(
        'UPDATE "Article" SET "embedding" = $1::vector, "embeddingModel" = $2 WHERE "id" = $3',
        vectorStr,
        provider.modelId,
        article.id
      );
      generated++;
    }
  }

  return { cached: cached.length, generated, skipped };
}

/**
 * Invalidate the embedding for an article.
 * Called by ingestion routes after content changes.
 */
export async function invalidateEmbedding(articleId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Article"
    SET "embedding" = NULL, "embeddingModel" = NULL
    WHERE "id" = ${articleId}
  `;
}
