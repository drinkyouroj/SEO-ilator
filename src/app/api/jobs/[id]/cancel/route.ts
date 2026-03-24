import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { cancelJob } from "@/lib/ingestion/queue";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;

  try {
    const job = await cancelJob(id, projectId);
    return NextResponse.json({ job });
  } catch {
    return NextResponse.json(
      { error: "Job not found or cannot be cancelled" },
      { status: 404 }
    );
  }
}
