import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  // Check current status
  const run = await db.analysisRun.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status === "completed" || run.status === "failed") {
    return NextResponse.json(
      { error: "Cannot cancel a run that is already completed or failed" },
      { status: 409 }
    );
  }

  try {
    const updated = await db.analysisRun.update({
      where: { id },
      data: { status: "cancelled", completedAt: new Date() },
    });
    return NextResponse.json({ run: updated });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    console.error(`[runs/${id}/cancel] Failed:`, err);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
