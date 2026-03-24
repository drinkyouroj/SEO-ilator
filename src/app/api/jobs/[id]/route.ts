import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma, scopedPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  const job = await db.ingestionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = 100;

  // Use base prisma for IngestionTask (no projectId column)
  const tasks = await prisma.ingestionTask.findMany({
    where: {
      jobId: id,
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit + 1,
    select: {
      id: true, url: true, status: true, errorMessage: true,
      httpStatus: true, responseTimeMs: true, retryCount: true, processedAt: true,
    },
  });

  const hasMore = tasks.length > limit;
  const pageTasks = hasMore ? tasks.slice(0, limit) : tasks;
  const nextCursor = hasMore ? pageTasks[pageTasks.length - 1].id : null;

  return NextResponse.json({
    job: {
      id: job.id, status: job.status, totalUrls: job.totalUrls,
      completedUrls: job.completedUrls, failedUrls: job.failedUrls,
      preset: job.preset, createdAt: job.createdAt, completedAt: job.completedAt,
    },
    tasks: pageTasks,
    nextCursor,
  });
}
