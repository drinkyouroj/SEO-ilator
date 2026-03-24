import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { parseSitemap } from "@/lib/ingestion/sitemap";
import { createJob, claimTasks, completeTask, failTask, finalizeJob } from "@/lib/ingestion/queue";
import { crawlUrl, fetchRobotsTxt } from "@/lib/ingestion/crawler";
import { parseHTML } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import { RobotsCache } from "@/lib/ingestion/robots";
import { PRESET_DELAYS, type CrawlPreset } from "@/lib/ingestion/types";

export const dynamic = "force-dynamic";

// ── Zod validation ──────────────────────────────────────────────────────────

const presetSchema = z.enum(["gentle", "standard", "fast"]).optional();

const bodySchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("sitemap"),
    url: z.string().url(),
    preset: presetSchema,
  }),
  z.object({
    method: z.literal("url_list"),
    urls: z.array(z.string().url()).min(1),
    preset: presetSchema,
  }),
]);

// ── Sync processor (<50 URLs) ────────────────────────────────────────────────

async function processSyncJob(
  jobId: string,
  projectId: string,
  preset: CrawlPreset,
): Promise<void> {
  const robotsCache = new RobotsCache();
  const delayMs = PRESET_DELAYS[preset];

  // Mark the job as running (ingestionJob has projectId, use base prisma)
  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: "running" },
  });

  let taskBatch: string[];

  do {
    taskBatch = await claimTasks(jobId, 50);
    if (taskBatch.length === 0) break;

    for (const taskId of taskBatch) {
      // Use base prisma for IngestionTask (no projectId column)
      const task = await prisma.ingestionTask.findUnique({
        where: { id: taskId },
        select: { id: true, url: true },
      });

      if (!task) continue;

      try {
        const domain = new URL(task.url).hostname;
        await fetchRobotsTxt(domain, robotsCache);

        const crawlResult = await crawlUrl(task.url, preset, robotsCache);

        if (crawlResult.error && !crawlResult.html) {
          const isTransient =
            crawlResult.failureType === "transient" ||
            crawlResult.httpStatus === 429 ||
            crawlResult.httpStatus === 502 ||
            crawlResult.httpStatus === 503 ||
            crawlResult.httpStatus === 504;

          await failTask(taskId, jobId, crawlResult.error, isTransient);
        } else {
          const parsed = parseHTML(
            crawlResult.html,
            task.url,
            crawlResult.httpStatus,
            crawlResult.responseTimeMs,
          );

          const normalized = normalizeArticle(parsed, projectId, "crawl");

          // Upsert Article — use base prisma with explicit projectId (matches cron worker pattern)
          await prisma.article.upsert({
            where: {
              projectId_url: { projectId, url: normalized.url },
            },
            create: {
              projectId,
              url: normalized.url,
              title: normalized.title,
              body: normalized.body,
              bodyHash: normalized.bodyHash,
              titleHash: normalized.titleHash,
              wordCount: normalized.wordCount,
              existingLinks: normalized.existingLinks as never,
              metadata: normalized.metadata as never,
              sourceType: normalized.sourceType,
              parseWarning: normalized.parseWarning,
              httpStatus: crawlResult.httpStatus,
            },
            update: {
              title: normalized.title,
              body: normalized.body,
              bodyHash: normalized.bodyHash,
              titleHash: normalized.titleHash,
              wordCount: normalized.wordCount,
              existingLinks: normalized.existingLinks as never,
              metadata: normalized.metadata as never,
              sourceType: normalized.sourceType,
              parseWarning: normalized.parseWarning,
              httpStatus: crawlResult.httpStatus,
            },
          });

          await completeTask(
            taskId,
            jobId,
            crawlResult.httpStatus,
            crawlResult.responseTimeMs,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[articles] Sync task ${taskId} failed:`, err);
        await failTask(taskId, jobId, message, true);
      }

      // Rate-limit delay between requests
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } while (taskBatch.length > 0);

  await finalizeJob(jobId);
}

// ── POST /api/articles ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Auth
  let projectId: string;
  try {
    ({ projectId } = await requireAuth());
  } catch (response) {
    return response as Response;
  }

  // 2. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const preset: CrawlPreset = input.preset ?? "standard";

  // 3. Resolve URLs
  let urls: string[];
  let sitemapWarnings: string[] = [];

  if (input.method === "sitemap") {
    try {
      const result = await parseSitemap(input.url);
      urls = result.urls;
      sitemapWarnings = result.warnings;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sitemap fetch failed";
      return NextResponse.json({ error: message }, { status: 422 });
    }

    if (urls.length === 0) {
      return NextResponse.json(
        { error: "No URLs found in sitemap", warnings: sitemapWarnings },
        { status: 422 },
      );
    }
  } else {
    urls = input.urls;
  }

  // 4. Create the job
  let job: Awaited<ReturnType<typeof createJob>>;
  try {
    job = await createJob(projectId, urls, preset);
  } catch (err) {
    console.error("[articles] Failed to create job:", err);
    return NextResponse.json({ error: "Failed to create ingestion job" }, { status: 500 });
  }

  // 5. Sync path: <50 URLs — process inline and return completed job
  if (urls.length < 50) {
    try {
      await processSyncJob(job.id, projectId, preset);
    } catch (err) {
      console.error("[articles] Sync processing error:", err);
      // Job was created — return the jobId even if processing errored
      return NextResponse.json(
        { jobId: job.id, status: "failed", warnings: sitemapWarnings },
        { status: 500 },
      );
    }

    // Fetch the finalized job to return up-to-date counts
    const finalJob = await prisma.ingestionJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        status: true,
        totalUrls: true,
        completedUrls: true,
        failedUrls: true,
        preset: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return NextResponse.json(
      { job: finalJob, warnings: sitemapWarnings },
      { status: 200 },
    );
  }

  // 6. Async path: ≥50 URLs — trigger cron and return 202
  after(async () => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${baseUrl}/api/cron/crawl`, {
        method: "GET",
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
    } catch (err) {
      console.error("[articles] Failed to trigger cron:", err);
    }
  });

  return NextResponse.json(
    { jobId: job.id, status: "queued", totalUrls: job.totalUrls, warnings: sitemapWarnings },
    { status: 202 },
  );
}
