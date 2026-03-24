import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findSimilarArticles } from "@/lib/embeddings/similarity";

export const dynamic = "force-dynamic";

/**
 * DEBUG endpoint — test pgvector similarity from the app layer.
 * DELETE THIS FILE before merging to main.
 */
export async function GET() {
  const steps: Record<string, unknown> = {};

  try {
    // Step 1: Pick one article with an embedding
    const article = await prisma.article.findFirst({
      where: { embeddingModel: { not: null } },
      select: { id: true, projectId: true, title: true },
    });

    if (!article) {
      return NextResponse.json({ error: "No articles with embeddings found" }, { status: 404 });
    }
    steps.article = { id: article.id, title: article.title, projectId: article.projectId };

    // Step 2: Test raw embedding fetch (same as findSimilarArticles step 1)
    const sourceRows = await prisma.$queryRaw<{ embedding: string }[]>`
      SELECT embedding::text FROM "Article"
      WHERE id = ${article.id} AND "projectId" = ${article.projectId} AND embedding IS NOT NULL
    `;
    steps.sourceRowCount = sourceRows.length;
    steps.embeddingPreview = sourceRows[0]?.embedding?.slice(0, 80) + "...";

    // Step 3: Test raw similarity query WITHOUT the function (simpler)
    try {
      const rawSimilar = await prisma.$queryRaw<{ id: string; similarity: number }[]>`
        SELECT id,
          1 - (embedding <=> ${sourceRows[0].embedding}::vector) AS similarity
        FROM "Article"
        WHERE "projectId" = ${article.projectId}
          AND id != ${article.id}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${sourceRows[0].embedding}::vector
        LIMIT 5
      `;
      steps.rawSimilarCount = rawSimilar.length;
      steps.rawSimilar = rawSimilar;
    } catch (rawErr) {
      steps.rawSimilarError = rawErr instanceof Error ? rawErr.message : String(rawErr);
    }

    // Step 4: Test with threshold filter (the actual problematic query)
    try {
      const threshold = 0.65;
      const withThreshold = await prisma.$queryRaw<{ id: string; similarity: number }[]>`
        SELECT id,
          1 - (embedding <=> ${sourceRows[0].embedding}::vector) AS similarity
        FROM "Article"
        WHERE "projectId" = ${article.projectId}
          AND id != ${article.id}
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${sourceRows[0].embedding}::vector) >= ${threshold}
        ORDER BY embedding <=> ${sourceRows[0].embedding}::vector
        LIMIT ${20}
      `;
      steps.withThresholdCount = withThreshold.length;
      steps.withThreshold = withThreshold.slice(0, 3);
    } catch (thresholdErr) {
      steps.withThresholdError = thresholdErr instanceof Error ? thresholdErr.message : String(thresholdErr);
    }

    // Step 5: Test findSimilarArticles function directly
    try {
      const funcResult = await findSimilarArticles(article.projectId, article.id, 20, 0.65);
      steps.findSimilarCount = funcResult.length;
      steps.findSimilar = funcResult.slice(0, 3);
    } catch (funcErr) {
      steps.findSimilarError = funcErr instanceof Error
        ? { message: funcErr.message, stack: funcErr.stack?.split("\n").slice(0, 5) }
        : String(funcErr);
    }

    return NextResponse.json(steps);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5) : undefined,
      steps,
    }, { status: 500 });
  }
}
