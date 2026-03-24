import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;

  // Atomic conditional update — eliminates TOCTOU race with orchestrator
  // Only cancels runs that are currently in a cancellable state
  const result = await prisma.$executeRaw`
    UPDATE "AnalysisRun"
    SET status = 'cancelled', "completedAt" = NOW()
    WHERE id = ${id} AND "projectId" = ${projectId}
      AND status IN ('pending', 'running')
  `;

  if (result === 0) {
    // Either not found or already in terminal state
    const run = await prisma.analysisRun.findFirst({
      where: { id, projectId },
      select: { status: true },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: `Cannot cancel a run with status "${run.status}"` },
      { status: 409 }
    );
  }

  return NextResponse.json({ status: "cancelled", runId: id });
}
