import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronSecret } from "@/lib/auth/cron-guard";
import { crawlUrl, fetchRobotsTxt } from "@/lib/ingestion/crawler";
import { parseHTML } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";
import {
  claimTasks,
  completeTask,
  failTask,
  recoverZombies,
  finalizeJob,
} from "@/lib/ingestion/queue";
import { RobotsCache } from "@/lib/ingestion/robots";
import { PRESET_DELAYS, type CrawlPreset } from "@/lib/ingestion/types";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 270_000; // 270s of 300s max function duration

/**
 * GET /api/cron/crawl
 *
 * Batch-processes pending IngestionJobs and their tasks.
 * Called on a schedule by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET header verification.
 *
 * Processing loop:
 *  1. Recover zombie tasks (stuck in "processing" > 10 min)
 *  2. Find all pending/running jobs, ordered by createdAt
 *  3. For each job: mark running, claim task batches, crawl → parse →
 *     normalize → upsert Article, respecting preset rate-limit delays
 *  4. Finalize each job when no tasks remain
 *  5. Honour the 270 s time budget; stop early if exceeded
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  const summary = {
    jobsProcessed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    zombiesRecovered: 0,
  };

  try {
    // ── Step 1: Recover zombie tasks ────────────────────────────────────────
    await recoverZombies();
    // recoverZombies doesn't return a count, so we note it was called
    summary.zombiesRecovered = -1; // sentinel: called but count not returned

    // ── Step 2: Find all active jobs ────────────────────────────────────────
    const activeJobs = await prisma.ingestionJob.findMany({
      where: {
        status: { in: ["pending", "running"] },
      },
      orderBy: { createdAt: "asc" },
    });

    // ── Step 3: Process each job ─────────────────────────────────────────────
    for (const job of activeJobs) {
      if (Date.now() - startTime >= TIME_BUDGET_MS) break;

      // Mark job as running if it is still pending
      if (job.status === "pending") {
        await prisma.ingestionJob.update({
          where: { id: job.id },
          data: { status: "running" },
        });
      }

      const preset = (job.preset as CrawlPreset) ?? "standard";
      const delayMs = PRESET_DELAYS[preset] ?? PRESET_DELAYS.standard;
      const robotsCache = new RobotsCache();

      let taskBatch: string[];

      // Claim and process tasks in batches until none remain or budget exhausted
      do {
        if (Date.now() - startTime >= TIME_BUDGET_MS) break;

        taskBatch = await claimTasks(job.id, BATCH_SIZE);
        if (taskBatch.length === 0) break;

        for (const taskId of taskBatch) {
          if (Date.now() - startTime >= TIME_BUDGET_MS) break;

          // Fetch full task to get the URL
          const task = await prisma.ingestionTask.findUnique({
            where: { id: taskId },
            select: { id: true, url: true },
          });

          if (!task) continue;

          // Check if job was cancelled before processing this task
          const currentJob = await prisma.ingestionJob.findUnique({
            where: { id: job.id },
            select: { status: true, projectId: true },
          });

          if (!currentJob || currentJob.status === "cancelled") {
            // Skip — do not complete or fail; task will be cleaned up by cancelJob
            continue;
          }

          const { projectId } = currentJob;

          try {
            // Fetch robots.txt for this domain if not cached
            const domain = new URL(task.url).hostname;
            await fetchRobotsTxt(domain, robotsCache);

            // Crawl
            const crawlResult = await crawlUrl(task.url, preset, robotsCache);

            if (crawlResult.error && !crawlResult.html) {
              // Determine if transient
              const isTransient =
                crawlResult.failureType === "transient" ||
                crawlResult.httpStatus === 429 ||
                crawlResult.httpStatus === 502 ||
                crawlResult.httpStatus === 503 ||
                crawlResult.httpStatus === 504;

              await failTask(
                taskId,
                job.id,
                crawlResult.error,
                isTransient
              );
              summary.tasksFailed++;
            } else {
              // Parse
              const parsed = parseHTML(
                crawlResult.html,
                task.url,
                crawlResult.httpStatus,
                crawlResult.responseTimeMs
              );

              // Normalize
              const normalized = normalizeArticle(parsed, projectId, "crawl");

              // Upsert Article
              await prisma.article.upsert({
                where: {
                  projectId_url: {
                    projectId,
                    url: normalized.url,
                  },
                },
                create: {
                  projectId,
                  url: normalized.url,
                  title: normalized.title,
                  body: normalized.body,
                  bodyHash: normalized.bodyHash,
                  titleHash: normalized.titleHash,
                  wordCount: normalized.wordCount,
                  existingLinks: normalized.existingLinks as any,
                  metadata: normalized.metadata as any,
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
                  existingLinks: normalized.existingLinks as any,
                  metadata: normalized.metadata as any,
                  sourceType: normalized.sourceType,
                  parseWarning: normalized.parseWarning,
                  httpStatus: crawlResult.httpStatus,
                },
              });

              await completeTask(
                taskId,
                job.id,
                crawlResult.httpStatus,
                crawlResult.responseTimeMs
              );
              summary.tasksCompleted++;
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            console.error(
              `[cron/crawl] Task ${taskId} failed with unexpected error:`,
              err
            );
            await failTask(taskId, job.id, message, true);
            summary.tasksFailed++;
          }

          // Rate-limit delay between requests
          if (Date.now() - startTime < TIME_BUDGET_MS) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      } while (taskBatch.length === BATCH_SIZE && Date.now() - startTime < TIME_BUDGET_MS);

      // Finalize job if all tasks are done
      await finalizeJob(job.id);
      summary.jobsProcessed++;
    }

    return NextResponse.json({
      success: true,
      ...summary,
      elapsedMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("[cron/crawl] Fatal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
