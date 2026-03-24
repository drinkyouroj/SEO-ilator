import { prisma } from "@/lib/db";
import { registry } from "@/lib/strategies";
import { processEmbeddings } from "@/lib/embeddings/batch";
import { getProvider } from "@/lib/embeddings";
import { dedupAndRank } from "@/lib/analysis/dedup-ranker";
import type { ArticleSummary, AnalysisContext, StrategyRecommendation } from "@/lib/strategies/types";

/** Batch size for per-article strategy analysis before heartbeat update. */
const HEARTBEAT_BATCH_SIZE = 25;

/**
 * Orchestrate a full analysis run: load articles, process embeddings,
 * run all strategies, dedup/rank, persist recommendations.
 *
 * NEVER throws — all errors are caught and transition the run to "failed".
 */
export async function processAnalysisRun(
  runId: string,
  projectId: string
): Promise<void> {
  let embeddingsCached = 0;
  let embeddingsGenerated = 0;

  try {
    // 1. Fetch the run and verify it is in a startable state
    const run = await prisma.analysisRun.findUnique({
      where: { id: runId },
    });

    if (!run || (run.status !== "pending" && run.status !== "running")) {
      // Nothing to do — run doesn't exist or is already terminal
      return;
    }

    // 2. Transition to "running"
    const now = new Date();
    await prisma.analysisRun.update({
      where: { id: runId },
      data: {
        status: "running",
        startedAt: now,
        lastHeartbeatAt: now,
      },
    });

    // 3. Load articles as ArticleSummary[] (no body text) [AAP-B7]
    const rawArticles = await prisma.article.findMany({
      where: { projectId },
      select: {
        id: true,
        url: true,
        title: true,
        bodyHash: true,
        titleHash: true,
        wordCount: true,
        existingLinks: true,
        httpStatus: true,
        parseWarning: true,
        embeddingModel: true,
        metadata: true,
      },
    });

    const articles: ArticleSummary[] = rawArticles.map((a) => ({
      id: a.id,
      url: a.url,
      title: a.title,
      wordCount: a.wordCount,
      existingLinks: a.existingLinks as ArticleSummary["existingLinks"],
      hasEmbedding: a.embeddingModel != null,
      canonicalUrl: (a.metadata as Record<string, unknown>)?.canonicalUrl as string | null ?? null,
      noindex: (a.metadata as Record<string, unknown>)?.noindex === true,
      nofollow: (a.metadata as Record<string, unknown>)?.nofollow === true,
      httpStatus: a.httpStatus,
      parseWarning: a.parseWarning,
    }));

    // 4. Build currentHashes map for embedding cache
    const currentHashes = new Map(
      rawArticles.map((a) => [a.id, { bodyHash: a.bodyHash, titleHash: a.titleHash }])
    );

    // 5. Get embedding provider and process embeddings
    const provider = await getProvider(projectId);

    // We need full articles (with body) for embeddings — load them
    const articlesForEmbedding = await prisma.article.findMany({
      where: { projectId },
      select: {
        id: true,
        url: true,
        title: true,
        body: true,
        bodyHash: true,
        titleHash: true,
        wordCount: true,
        embeddingModel: true,
      },
    });

    const embeddingResult = await processEmbeddings(
      projectId,
      articlesForEmbedding as Parameters<typeof processEmbeddings>[2] extends infer T ? T extends unknown[] ? T : never : never,
      provider,
      currentHashes
    );
    embeddingsCached = embeddingResult.cached;
    embeddingsGenerated = embeddingResult.generated;

    // 6. loadArticleBodies callback for on-demand body loading [AAP-B7]
    const loadArticleBodies = async (ids: string[]): Promise<Map<string, string>> => {
      const rows = await prisma.article.findMany({
        where: { id: { in: ids }, projectId },
        select: { id: true, body: true },
      });
      return new Map(rows.map((r: { id: string; body: string }) => [r.id, r.body]));
    };

    // 7. Run strategies for each article, with heartbeat updates
    const allRecs: StrategyRecommendation[] = [];
    let skippedArticleCount = 0;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];

      // Pre-check: skip articles with bad HTTP status or noindex
      if (article.httpStatus != null && article.httpStatus >= 400) {
        skippedArticleCount++;
        continue;
      }

      const context: AnalysisContext = {
        article,
        articleIndex: articles,
        loadArticleBodies,
        projectId,
        settings: {},
      };

      try {
        const recs = await registry.analyzeWithAll(context);
        allRecs.push(...recs);
      } catch (err) {
        // [AAP-B10] Log and continue — don't fail the entire run for one article
        console.error(
          `[orchestrator] Strategy error for article ${article.id}:`,
          err instanceof Error ? err.message : err
        );
        skippedArticleCount++;
      }

      // Heartbeat after each batch
      if ((i + 1) % HEARTBEAT_BATCH_SIZE === 0 || i === articles.length - 1) {
        await prisma.analysisRun.update({
          where: { id: runId },
          data: { lastHeartbeatAt: new Date() },
        });
      }
    }

    // 8. Dedup and rank
    const rankedRecs = dedupAndRank(allRecs);

    // 9. [AAP-B4] In a transaction: supersede previous pending recs, insert new recs
    await prisma.$transaction(async (tx: typeof prisma) => {
      // Mark previous pending recommendations as superseded
      await tx.recommendation.updateMany({
        where: {
          projectId,
          status: "pending",
          analysisRunId: { not: runId },
        },
        data: { status: "superseded" },
      });

      // Insert new recommendations (skip empty)
      if (rankedRecs.length > 0) {
        const recData = rankedRecs.map((rec) => ({
          projectId,
          analysisRunId: runId,
          strategyId: rec.strategyId,
          sourceArticleId: rec.sourceArticleId,
          targetArticleId: rec.targetArticleId,
          type: rec.type,
          severity: rec.severity,
          title: rec.title,
          description: rec.description,
          anchorText: rec.anchorText ?? null,
          confidence: rec.confidence,
          matchingApproach: rec.matchingApproach ?? null,
          sourceContext: rec.sourceContext ?? null,
          charOffsetStart: rec.charOffsetStart ?? null,
          charOffsetEnd: rec.charOffsetEnd ?? null,
          suggestion: rec.suggestion ?? undefined,
          status: "pending",
        }));

        try {
          await tx.recommendation.createMany({ data: recData });
        } catch (err) {
          // [AAP-B10] Handle FK violations gracefully — log and skip
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("Foreign key constraint")) {
            console.warn(
              `[orchestrator] FK violation inserting recommendations — some articles may have been deleted. Skipping batch.`
            );
          } else {
            throw err;
          }
        }
      }
    });

    // 10. Transition to "completed" with counters
    await prisma.analysisRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        completedAt: new Date(),
        articleCount: articles.length,
        recommendationCount: rankedRecs.length,
        embeddingsCached,
        embeddingsGenerated,
      },
    });
  } catch (err) {
    // 11. On ANY error: transition to "failed"
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] Run ${runId} failed:`, errorMessage);

    try {
      await prisma.analysisRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          error: errorMessage,
          completedAt: new Date(),
          embeddingsCached,
          embeddingsGenerated,
        },
      });
    } catch (updateErr) {
      // If we can't even update the run status, log and give up
      console.error(
        `[orchestrator] Failed to mark run ${runId} as failed:`,
        updateErr instanceof Error ? updateErr.message : updateErr
      );
    }
  }
}
