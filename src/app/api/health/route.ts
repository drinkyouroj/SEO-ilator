import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Public health check endpoint for monitoring.
 * Returns database connectivity status and checks for stuck jobs.
 *
 * [AAP-O5] Stuck job detection: any IngestionJob or AnalysisRun in
 * "running" status for over 15 minutes is flagged and triggers a
 * Sentry alert.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  // Check database connectivity
  let databaseStatus: "connected" | "disconnected" = "disconnected";
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseStatus = "connected";
  } catch (error) {
    console.error("[health] Database check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        timestamp,
      },
      { status: 503 }
    );
  }

  // [AAP-O5] Check for stuck jobs/runs (running > 15 minutes)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  let stuckJobs: Array<{ id: string; type: string; startedAt: string }> = [];
  let stuckJobCheckFailed = false;

  try {
    const stuckIngestionJobs = await prisma.ingestionJob.findMany({
      where: {
        status: "running",
        createdAt: { lt: fifteenMinutesAgo },
      },
      select: { id: true, createdAt: true },
    });

    const stuckAnalysisRuns = await prisma.analysisRun.findMany({
      where: {
        status: "running",
        startedAt: { lt: fifteenMinutesAgo },
      },
      select: { id: true, startedAt: true },
    });

    stuckJobs = [
      ...stuckIngestionJobs.map((job) => ({
        id: job.id,
        type: "ingestion_job" as const,
        startedAt: job.createdAt.toISOString(),
      })),
      ...stuckAnalysisRuns.map((run) => ({
        id: run.id,
        type: "analysis_run" as const,
        startedAt: run.startedAt?.toISOString() ?? "unknown",
      })),
    ];

    // [AAP-O5] Trigger Sentry alert for stuck jobs
    if (stuckJobs.length > 0) {
      console.error(
        `[health] [AAP-O5] Stuck jobs detected: ${JSON.stringify(stuckJobs)}`
      );
      // TODO: When Sentry is configured, call Sentry.captureMessage() here
      // Sentry.captureMessage(`Stuck jobs detected: ${stuckJobs.length}`, {
      //   level: "warning",
      //   extra: { stuckJobs },
      // });
    }
  } catch (error) {
    // Non-fatal: stuck job check failure should not break health endpoint
    console.error("[health] Stuck job check failed:", error);
    stuckJobCheckFailed = true;
  }

  const status = stuckJobCheckFailed ? "degraded" : stuckJobs.length > 0 ? "warning" : "ok";

  const response: Record<string, unknown> = {
    status,
    database: databaseStatus,
    timestamp,
  };

  if (stuckJobs.length > 0) {
    response.stuckJobCount = stuckJobs.length;
  }

  if (stuckJobCheckFailed) {
    response.stuckJobCheck = "error";
  }

  return NextResponse.json(response);
}
