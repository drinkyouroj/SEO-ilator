import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { updateRecommendationSchema } from "@/lib/validation/recommendationSchemas";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { projectId } = await requireAuth();
  const { id } = await params;
  const db = scopedPrisma(projectId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateRecommendationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;

  // [AAP-B12] Optimistic locking: only update if updatedAt matches
  const result = await db.recommendation.updateMany({
    where: {
      id,
      updatedAt: new Date(input.updatedAt),
    },
    data: {
      status: input.status,
      dismissReason: input.dismissReason ?? null,
    },
  });

  if (result.count === 0) {
    const exists = await db.recommendation.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "This recommendation was modified since you loaded it. Please refresh." },
      { status: 409 }
    );
  }

  const updated = await db.recommendation.findUnique({ where: { id } });
  return NextResponse.json({ recommendation: updated });
}
