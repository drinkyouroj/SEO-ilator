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

  const article = await db.article.findUnique({ where: { id } });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }
  return NextResponse.json({ article });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  // AAP-B10: Check for active analysis runs
  const activeRuns = await db.analysisRun.count({
    where: { status: { in: ["pending", "running"] } },
  });

  if (activeRuns > 0) {
    return NextResponse.json(
      { error: "Cannot delete articles while an analysis is running." },
      { status: 409 }
    );
  }

  try {
    await db.article.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }
}
