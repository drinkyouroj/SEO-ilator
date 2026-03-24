import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth/cron-guard";
import { processAnalysisRun } from "@/lib/analysis/orchestrator";

export const dynamic = "force-dynamic";

const TIME_BUDGET_MS = 270_000; // 270s of 300s max function duration
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * GET /api/cron/analyze
 *
 * Claims and processes a pending AnalysisRun, with zombie recovery for
 * runs that got stuck in 'running' state.
 * Called on a schedule by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET header verification.
 *
 * Processing steps:
 *  1. Verify CRON_SECRET
 *  2. [AAP-F4] Recover zombie runs (stuck 'running' > 10 min with no heartbeat)
 *  3. Claim one pending run with FOR UPDATE SKIP LOCKED (inside $transaction)
 *  4. Process the claimed run via processAnalysisRun()
 *  5. Return JSON summary
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  const summary = {
    zombiesRecovered: 0,
    runProcessed: null as string | null,
    skipped: false,
  };

  try {
    // ── Step 1: [AAP-F4] Zombie recovery ────────────────────────────────────
    // Recover AnalysisRuns stuck in 'running' where:
    //   - lastHeartbeatAt is older than 10 min, OR
    //   - lastHeartbeatAt IS NULL AND startedAt is older than 10 min
    const zombieThreshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);

    const zombieRuns = await prisma.analysisRun.findMany({
      where: {
        status: "running",
        OR: [
          { lastHeartbeatAt: { lt: zombieThreshold } },
          {
            lastHeartbeatAt: null,
            startedAt: { lt: zombieThreshold },
          },
        ],
      },
      select: { id: true },
    });

    for (const zombie of zombieRuns) {
      try {
        await prisma.analysisRun.update({
          where: { id: zombie.id },
          data: {
            status: "failed",
            error: "Analysis timed out. Please try again.",
            completedAt: new Date(),
          },
        });
        summary.zombiesRecovered++;
        console.warn(`[cron/analyze] Recovered zombie run: ${zombie.id}`);
      } catch (err) {
        // Don't let a single zombie recovery failure crash the whole cron
        console.error(`[cron/analyze] Failed to recover zombie run ${zombie.id}:`, err);
      }
    }

    // ── Step 2: Claim a pending run (FOR UPDATE SKIP LOCKED) ────────────────
    // Must be inside a $transaction because FOR UPDATE requires a transaction context.
    const claimedRun = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; projectId: string }>>`
        SELECT id, "projectId" FROM "AnalysisRun"
        WHERE status = 'pending'
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return null;

      const { id, projectId } = rows[0];
      const now = new Date();

      await tx.analysisRun.update({
        where: { id },
        data: {
          status: "running",
          startedAt: now,
          lastHeartbeatAt: now,
        },
      });

      return { id, projectId };
    });

    if (!claimedRun) {
      summary.skipped = true;
      return NextResponse.json({
        success: true,
        ...summary,
        elapsedMs: Date.now() - startTime,
      });
    }

    summary.runProcessed = claimedRun.id;

    // ── Step 3: Process the claimed run ─────────────────────────────────────
    await processAnalysisRun(claimedRun.id, claimedRun.projectId);

    return NextResponse.json({
      success: true,
      ...summary,
      elapsedMs: Date.now() - startTime,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cron/analyze] Fatal error:", {
      message,
      summary,
      elapsedMs: Date.now() - startTime,
    }, error);
    return NextResponse.json(
      {
        error: "Cron worker failed",
        message,
        summary,
        elapsedMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
