import type { ArticleWithEmbedding, CacheCheckResult } from "./types";

/**
 * Pure function: classifies articles into cached vs needs-generation.
 *
 * Cached when ALL: embeddingModel matches, embedding exists, bodyHash matches, titleHash matches.
 * Per DECISION-001 cache key triple with defensive hash comparison.
 */
export function checkEmbeddingCache(
  articles: ArticleWithEmbedding[],
  currentModelId: string,
  currentHashes: Map<string, { bodyHash: string; titleHash: string }>
): CacheCheckResult {
  const cached: ArticleWithEmbedding[] = [];
  const needsGeneration: ArticleWithEmbedding[] = [];

  for (const article of articles) {
    const hashes = currentHashes.get(article.id);
    const isCached =
      article.hasEmbedding &&
      article.embeddingModel === currentModelId &&
      hashes !== undefined &&
      article.bodyHash === hashes.bodyHash &&
      article.titleHash === hashes.titleHash;

    if (isCached) {
      cached.push(article);
    } else {
      needsGeneration.push(article);
    }
  }

  return { cached, needsGeneration };
}
