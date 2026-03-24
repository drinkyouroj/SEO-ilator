import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findSimilarArticles } from "@/lib/embeddings/similarity";
import { CrosslinkStrategy } from "@/lib/strategies/crosslink";
import type { ArticleSummary, AnalysisContext } from "@/lib/strategies/types";

export const dynamic = "force-dynamic";

/**
 * DEBUG endpoint — trace through the full analysis code path for ONE article.
 * DELETE THIS FILE before merging to main.
 */
export async function GET() {
  const trace: Record<string, unknown> = {};

  try {
    // ── 1. Load articles exactly like the orchestrator does ──
    const projectRow = await prisma.article.findFirst({
      where: { embeddingModel: { not: null } },
      select: { projectId: true },
    });
    if (!projectRow) {
      return NextResponse.json({ error: "No articles found" }, { status: 404 });
    }
    const projectId = projectRow.projectId;
    trace.projectId = projectId;

    // Same query as orchestrator step 3
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
    trace.totalArticles = rawArticles.length;

    // Build ArticleSummary[] exactly like orchestrator
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

    // ── 2. Check article properties ──
    const withEmbedding = articles.filter((a) => a.hasEmbedding);
    const noindex = articles.filter((a) => a.noindex);
    const errorStatus = articles.filter((a) => a.httpStatus != null && a.httpStatus >= 400);
    const lowWordCount = articles.filter((a) => a.wordCount < 50);
    trace.articleStats = {
      total: articles.length,
      withEmbedding: withEmbedding.length,
      noindex: noindex.length,
      errorStatus: errorStatus.length,
      lowWordCount: lowWordCount.length,
    };

    // ── 3. Load strategy settings (same as orchestrator) ──
    let strategySettings: Record<string, unknown> = {};
    try {
      const config = await prisma.strategyConfig.findUnique({
        where: { projectId_strategyId: { projectId, strategyId: "crosslink" } },
      });
      if (config?.settings && typeof config.settings === "object") {
        strategySettings = config.settings as Record<string, unknown>;
      }
      trace.strategySettings = strategySettings;
    } catch {
      trace.strategySettings = "lookup failed";
    }

    // ── 4. Pick first eligible article and run crosslink strategy ──
    const testArticle = articles.find(
      (a) => a.hasEmbedding && a.wordCount >= 50 && !(a.httpStatus != null && a.httpStatus >= 400)
    );
    if (!testArticle) {
      trace.error = "No eligible test article found";
      return NextResponse.json(trace);
    }
    trace.testArticle = {
      id: testArticle.id,
      title: testArticle.title,
      wordCount: testArticle.wordCount,
      hasEmbedding: testArticle.hasEmbedding,
      httpStatus: testArticle.httpStatus,
      existingLinksCount: testArticle.existingLinks?.length ?? "null",
      noindex: testArticle.noindex,
    };

    // ── 5. Test loadArticleBodies (same as orchestrator) ──
    const loadArticleBodies = async (ids: string[]): Promise<Map<string, string>> => {
      const rows = await prisma.article.findMany({
        where: { id: { in: ids }, projectId },
        select: { id: true, body: true },
      });
      return new Map(rows.map((r: { id: string; body: string }) => [r.id, r.body]));
    };

    const bodyMap = await loadArticleBodies([testArticle.id]);
    const body = bodyMap.get(testArticle.id);
    trace.bodyLoaded = body != null;
    trace.bodyLength = body?.length ?? 0;
    trace.bodyPreview = body?.slice(0, 200) ?? "NO BODY";
    trace.bodyIsFalsy = !body;

    // ── 6. Run crosslink strategy directly ──
    const context: AnalysisContext = {
      article: testArticle,
      articleIndex: articles,
      loadArticleBodies,
      projectId,
      settings: strategySettings,
    };

    const strategy = new CrosslinkStrategy();
    try {
      const recs = await strategy.analyze(context);
      trace.recommendationCount = recs.length;
      trace.recommendations = recs.slice(0, 5).map((r) => ({
        target: r.targetArticleId,
        title: r.title,
        approach: r.matchingApproach,
        confidence: r.confidence,
      }));
    } catch (err) {
      trace.strategyError = err instanceof Error
        ? { message: err.message, stack: err.stack?.split("\n").slice(0, 8) }
        : String(err);
    }

    // ── 7. Also test findSimilarArticles directly for this article ──
    try {
      const similar = await findSimilarArticles(projectId, testArticle.id, 5, 0.65);
      trace.directSimilarCount = similar.length;
      trace.directSimilar = similar;
    } catch (err) {
      trace.directSimilarError = err instanceof Error ? err.message : String(err);
    }

    return NextResponse.json(trace);
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
      trace,
    }, { status: 500 });
  }
}
