import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { recommendationFilterSchema } from "@/lib/validation/recommendationSchemas";
import { serializeCsv, type CsvRecommendationRow } from "@/lib/export/csv";
import { serializeJson, jsonContentDisposition } from "@/lib/export/json";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 1. Auth
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (response) {
    return response as Response;
  }

  // 2. Parse and validate query params
  const url = new URL(request.url);
  const rawParams = Object.fromEntries(url.searchParams.entries());
  const parsed = recommendationFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { severity, status, analysisRunId, articleId, format, cursor, limit } = parsed.data;

  // 3. Build Prisma where clause
  const db = scopedPrisma(projectId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: Record<string, any> = {};
  if (severity) filters.severity = severity;
  if (status) filters.status = status;
  if (analysisRunId) filters.analysisRunId = analysisRunId;
  if (articleId) filters.sourceArticleId = articleId;

  // 4. [DECISION-003] Count check for exports
  if (format === "csv" || format === "json") {
    const count = await db.recommendation.count({ where: filters });
    if (count > 10_000) {
      return NextResponse.json(
        {
          error: "TOO_MANY_RESULTS",
          message: "Export exceeds 10,000 rows. Please narrow your filters.",
          count,
        },
        { status: 413 },
      );
    }

    // Fetch all matching recs with article joins for export
    const recs = await db.recommendation.findMany({
      where: filters,
      include: {
        sourceArticle: { select: { title: true, url: true } },
        targetArticle: { select: { title: true, url: true } },
      },
      orderBy: [{ severity: "desc" }, { confidence: "desc" }],
    });

    // 5. CSV export
    if (format === "csv") {
      const rows: CsvRecommendationRow[] = recs.map((r) => ({
        id: r.id,
        sourceTitle: r.sourceArticle?.title ?? "",
        sourceUrl: r.sourceArticle?.url ?? "",
        anchorText: r.anchorText,
        targetTitle: r.targetArticle?.title ?? "",
        targetUrl: r.targetArticle?.url ?? "",
        severity: r.severity,
        confidence: r.confidence,
        matchingApproach: r.matchingApproach,
        status: r.status,
      }));

      const date = new Date().toISOString().slice(0, 10);
      const csv = serializeCsv(rows);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="seo-ilator-recommendations-${date}.csv"`,
        },
      });
    }

    // 6. JSON export
    const date = new Date().toISOString().slice(0, 10);
    const filename = `seo-ilator-recommendations-${date}.json`;
    const rows = recs.map((r) => ({
      id: r.id,
      sourceTitle: r.sourceArticle?.title ?? "",
      sourceUrl: r.sourceArticle?.url ?? "",
      anchorText: r.anchorText,
      targetTitle: r.targetArticle?.title ?? "",
      targetUrl: r.targetArticle?.url ?? "",
      severity: r.severity,
      confidence: r.confidence,
      matchingApproach: r.matchingApproach,
      status: r.status,
      type: r.type,
      title: r.title,
      description: r.description,
      suggestion: r.suggestion,
      createdAt: r.createdAt,
    }));
    const body = serializeJson(rows);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": jsonContentDisposition(filename),
      },
    });
  }

  // 7. Default: paginated JSON response with cursor
  const recs = await db.recommendation.findMany({
    where: filters,
    include: {
      sourceArticle: { select: { title: true, url: true } },
      targetArticle: { select: { title: true, url: true } },
    },
    orderBy: [{ severity: "desc" }, { confidence: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = recs.length > limit;
  const page = hasMore ? recs.slice(0, limit) : recs;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  return NextResponse.json({ recommendations: page, nextCursor });
}
