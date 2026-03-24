import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  const run = await db.analysisRun.findUnique({ where: { id } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Get recommendation summary
  const recommendations = await db.recommendation.findMany({
    where: { analysisRunId: id },
    select: { severity: true, status: true },
  });

  const summary = {
    total: recommendations.length,
    bySeverity: {
      critical: recommendations.filter(r => r.severity === "critical").length,
      warning: recommendations.filter(r => r.severity === "warning").length,
      info: recommendations.filter(r => r.severity === "info").length,
    },
    byStatus: {
      pending: recommendations.filter(r => r.status === "pending").length,
      accepted: recommendations.filter(r => r.status === "accepted").length,
      dismissed: recommendations.filter(r => r.status === "dismissed").length,
      superseded: recommendations.filter(r => r.status === "superseded").length,
    },
  };

  return NextResponse.json({ run, recommendations: summary });
}
