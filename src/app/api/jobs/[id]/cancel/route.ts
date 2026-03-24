import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cancelJob } from "@/lib/ingestion/queue";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;

  try {
    await cancelJob(id, projectId);
    return NextResponse.json({ status: "cancelled", jobId: id });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }
    console.error(`[jobs/${id}/cancel] Failed:`, err);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 }
    );
  }
}
