import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";
import { bulkUpdateSchema } from "@/lib/validation/recommendationSchemas";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const { projectId } = await requireAuth();
  const db = scopedPrisma(projectId);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bulkUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;

  // [AAP-B12] Bulk update with tenant isolation via scopedPrisma
  const result = await db.recommendation.updateMany({
    where: {
      id: { in: input.ids },
    },
    data: {
      status: input.status,
      dismissReason: input.dismissReason ?? null,
    },
  });

  return NextResponse.json({ updated: result.count });
}
