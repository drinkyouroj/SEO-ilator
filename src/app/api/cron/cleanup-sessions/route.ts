import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth/cron-guard";

/**
 * DELETE /api/cron/cleanup-sessions
 *
 * Deletes all expired sessions from the database.
 * Called daily by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET header verification.
 */
export async function GET(request: Request) {
  // Verify the cron secret to prevent unauthorized access
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const now = new Date();

    const result = await prisma.session.deleteMany({
      where: {
        expires: { lt: now },
      },
    });

    return NextResponse.json({
      success: true,
      deletedCount: result.count,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[cron/cleanup-sessions] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
