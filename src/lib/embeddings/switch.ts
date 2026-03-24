import { prisma } from "@/lib/db";
import { isValidProvider, PROVIDER_DIMENSIONS } from "./providers";

/**
 * Atomically switch the embedding provider for a project [AAP-B6].
 *
 * 1. Validates the new model ID
 * 2. Transaction: clears all embeddings + updates StrategyConfig
 * 3. After transaction: rebuilds HNSW index (per DECISION-001 JUDGE)
 */
export async function switchProvider(
  projectId: string,
  newModelId: string
): Promise<void> {
  if (!isValidProvider(newModelId)) {
    throw new Error(
      `Unknown embedding provider: "${newModelId}". Valid: ${Object.keys(PROVIDER_DIMENSIONS).join(", ")}`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "Article"
      SET "embedding" = NULL, "embeddingModel" = NULL
      WHERE "projectId" = ${projectId}
    `;

    await tx.strategyConfig.upsert({
      where: {
        projectId_strategyId: { projectId, strategyId: "embedding" },
      },
      create: {
        projectId,
        strategyId: "embedding",
        settings: { provider: newModelId },
      },
      update: {
        settings: { provider: newModelId },
      },
    });
  });

  // Rebuild HNSW index outside transaction (REINDEX CONCURRENTLY can't run in one)
  try {
    await prisma.$executeRaw`
      REINDEX INDEX CONCURRENTLY "Article_embedding_hnsw_idx"
    `;
  } catch (err) {
    console.warn(
      `[embeddings] HNSW index rebuild failed (non-fatal):`,
      err instanceof Error ? err.message : err
    );
  }
}
