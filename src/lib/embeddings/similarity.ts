import { prisma } from "@/lib/db";
import type { SimilarArticle } from "./types";

export async function findSimilarArticles(
  projectId: string,
  articleId: string,
  limit: number = 10,
  threshold: number = 0.5
): Promise<SimilarArticle[]> {
  // Fetch source embedding
  const sourceRows = await prisma.$queryRaw<{ embedding: string }[]>`
    SELECT embedding::text FROM "Article"
    WHERE id = ${articleId} AND "projectId" = ${projectId} AND embedding IS NOT NULL
  `;

  if (sourceRows.length === 0) return [];

  const sourceEmbedding = sourceRows[0].embedding;

  // Use transaction so SET LOCAL is scoped correctly.
  // SET LOCAL must be a separate $executeRaw call — PostgreSQL rejects multiple
  // statements in a single prepared statement.
  const results = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`;

    return tx.$queryRaw<SimilarArticle[]>`
      SELECT id, url, title,
        1 - (embedding <=> ${sourceEmbedding}::vector) AS similarity
      FROM "Article"
      WHERE "projectId" = ${projectId}
        AND id != ${articleId}
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> ${sourceEmbedding}::vector) >= ${threshold}
      ORDER BY embedding <=> ${sourceEmbedding}::vector
      LIMIT ${limit}
    `;
  });

  return results;
}
