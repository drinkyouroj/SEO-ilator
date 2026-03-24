import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { scopedPrisma } from "@/lib/db";
import { getProvider } from "@/lib/embeddings";
import { checkEmbeddingCache } from "@/lib/embeddings/cache";
import { Prisma } from "@prisma/client";
import type { ArticleWithEmbedding } from "@/lib/embeddings/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  dryRun: z.boolean().optional().default(false),
  enableSemantic: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);

  // ── 2. Parse body ─────────────────────────────────────────────────────────
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "Request body is invalid." },
      { status: 400 }
    );
  }

  const { dryRun, enableSemantic } = body;

  // ── 3. Plan checks ────────────────────────────────────────────────────────
  const analyzeCheck = await checkPlanLimits(projectId, "analyze");
  if (!analyzeCheck.allowed) {
    return NextResponse.json(
      { error: "PLAN_LIMIT_EXCEEDED", message: analyzeCheck.message, upgrade_url: "/dashboard/settings#account" },
      { status: 403 }
    );
  }

  if (enableSemantic) {
    const semanticCheck = await checkPlanLimits(projectId, "analyze_semantic");
    if (!semanticCheck.allowed) {
      return NextResponse.json(
        { error: "PLAN_LIMIT_EXCEEDED", message: semanticCheck.message, upgrade_url: "/dashboard/settings#account" },
        { status: 403 }
      );
    }
  }

  // ── 4. Check articles exist ───────────────────────────────────────────────
  const articleCount = await db.article.count();
  if (articleCount === 0) {
    return NextResponse.json(
      {
        error: "NO_ARTICLES",
        message:
          "No articles found. Add articles before running an analysis.",
      },
      { status: 400 }
    );
  }

  // ── 5. Dry run path [AAP-O8] ──────────────────────────────────────────────
  if (dryRun) {
    let embeddingEstimate: { cached: number; needsGeneration: number } = {
      cached: 0,
      needsGeneration: articleCount,
    };
    let estimatedCost = 0;

    try {
      const provider = await getProvider(projectId);

      // Fetch articles with embedding metadata for cache classification
      const articles = await db.article.findMany({
        select: {
          id: true,
          title: true,
          body: true,
          bodyHash: true,
          titleHash: true,
          embeddingModel: true,
        },
      });

      // Build current hashes map
      const currentHashes = new Map(
        articles.map((a) => [
          a.id,
          { bodyHash: a.bodyHash, titleHash: a.titleHash },
        ])
      );

      // Use raw SQL result to determine hasEmbedding
      const embeddingStatuses = await db.$queryRaw<
        { id: string; has_embedding: boolean }[]
      >`
        SELECT id, (embedding IS NOT NULL) AS has_embedding
        FROM "Article"
        WHERE "projectId" = ${projectId}
      `;

      const embeddingStatusMap = new Map(
        embeddingStatuses.map((r) => [r.id, r.has_embedding])
      );

      const articlesWithEmbedding: ArticleWithEmbedding[] = articles.map(
        (a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          bodyHash: a.bodyHash,
          titleHash: a.titleHash,
          embeddingModel: a.embeddingModel,
          hasEmbedding: embeddingStatusMap.get(a.id) ?? false,
        })
      );

      const { cached, needsGeneration } = checkEmbeddingCache(
        articlesWithEmbedding,
        provider.modelId,
        currentHashes
      );

      embeddingEstimate = {
        cached: cached.length,
        needsGeneration: needsGeneration.length,
      };

      // Rough cost estimate: OpenAI text-embedding-3-small is $0.00002 / 1K tokens
      // Approximate 300 tokens per article (title + body snippet)
      const avgTokensPerArticle = 300;
      const costPerToken = 0.00002 / 1000;
      estimatedCost =
        Math.round(
          embeddingEstimate.needsGeneration *
            avgTokensPerArticle *
            costPerToken *
            10000
        ) / 10000;
    } catch (err) {
      // Embedding provider may not be configured; return conservative estimate
      console.warn("[analyze] dryRun: could not compute embedding estimate:", err);
    }

    return NextResponse.json({
      dryRun: true,
      articleCount,
      embeddingEstimate,
      estimatedCost,
    });
  }

  // ── 6. Create AnalysisRun ─────────────────────────────────────────────────
  let run: { id: string; status: string; articleCount: number };
  try {
    run = await db.analysisRun.create({
      data: {
        projectId,
        status: "pending",
        strategiesUsed: [],
        configuration: { enableSemantic },
        articleCount,
      },
      select: { id: true, status: true, articleCount: true },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "ANALYSIS_IN_PROGRESS",
          message:
            "An analysis run is already active for this project. Wait for it to complete before starting a new one.",
        },
        { status: 409 }
      );
    }
    console.error("[analyze] Failed to create AnalysisRun:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to create analysis run." },
      { status: 500 }
    );
  }

  // ── 7. Fire on-demand cron trigger ───────────────────────────────────────
  after(async () => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${baseUrl}/api/cron/analyze`, {
        method: "GET",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
    } catch (err) {
      console.error("[analyze] Failed to trigger cron:", err);
    }
  });

  // ── 8. Return 202 ─────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      runId: run.id,
      status: run.status,
      articleCount: run.articleCount,
    },
    { status: 202 }
  );
}
