import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = 20;

  const runs = await db.analysisRun.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit + 1,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, articleCount: true, recommendationCount: true,
      embeddingsCached: true, embeddingsGenerated: true, error: true,
      startedAt: true, completedAt: true, createdAt: true,
    },
  });

  const hasMore = runs.length > limit;
  const pageRuns = hasMore ? runs.slice(0, limit) : runs;
  const nextCursor = hasMore ? pageRuns[pageRuns.length - 1].id : null;

  return NextResponse.json({ runs: pageRuns, nextCursor });
}
