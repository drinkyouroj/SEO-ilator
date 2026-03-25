import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  job: z.enum(["crawl", "analyze"]),
});

/**
 * POST /api/trigger — manually trigger a cron job from the dashboard.
 * Auth-protected (session-based), NOT cron-secret protected.
 * Fires the cron endpoint via internal fetch in after() so the
 * response returns immediately.
 */
export async function POST(request: Request) {
  // Auth check
  try {
    await requireAuth();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }

  // Parse body
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await request.json().catch(() => ({}));
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "Expected { job: 'crawl' | 'analyze' }" },
      { status: 400 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const cronPath = body.job === "crawl" ? "/api/cron/crawl" : "/api/cron/analyze";

  // Fire the cron endpoint asynchronously so the UI gets an instant response
  after(async () => {
    try {
      await fetch(`${baseUrl}${cronPath}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
    } catch (err) {
      console.error(`[trigger] Failed to trigger ${body.job}:`, err);
    }
  });

  return NextResponse.json({ triggered: body.job, message: `${body.job} job triggered.` });
}
