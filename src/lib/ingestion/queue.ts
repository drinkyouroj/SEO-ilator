/**
 * Database-backed ingestion queue.
 *
 * Manages IngestionJob / IngestionTask lifecycle with:
 *  - URL deduplication in createJob
 *  - CAS (compare-and-swap) claims in claimTasks / completeTask
 *  - Classified retry with exponential backoff in failTask
 *  - Zombie recovery in recoverZombies
 */

import { prisma } from "@/lib/db";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 2;
const ZOMBIE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const RETRY_BACKOFF_BASE_MS = 30_000;        // 30 seconds

// ── URL normalisation ─────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.protocol = parsed.protocol.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates an IngestionJob plus deduplicated IngestionTask rows in a single
 * transaction.  Returns the created job.
 */
export async function createJob(
  projectId: string,
  urls: string[],
  preset: string,
) {
  // Deduplicate after normalisation
  const unique = [...new Set(urls.map(normalizeUrl))];

  return prisma.$transaction(async (tx) => {
    const job = await tx.ingestionJob.create({
      data: {
        projectId,
        status: "pending",
        preset,
        totalUrls: unique.length,
      },
    });

    await tx.ingestionTask.createMany({
      data: unique.map((url) => ({
        jobId: job.id,
        url,
        status: "pending",
      })),
    });

    return job;
  });
}

/**
 * Cancels a job, atomically transitioning all pending tasks to "cancelled".
 * [AAP-F9]
 */
export async function cancelJob(jobId: string, projectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ingestionJob.update({
      where: { id: jobId, projectId },
      data: { status: "cancelled" },
    });

    await tx.ingestionTask.updateMany({
      where: { jobId, status: "pending" },
      data: { status: "cancelled" },
    });
  });
}

/**
 * CAS claim: finds pending tasks whose retryAfter is in the past (or null),
 * marks them as "processing", and returns their IDs.
 *
 * The find + update is done as a two-step operation.  The update uses the same
 * filter so a concurrent worker that already claimed a task will not see it
 * re-claimed (because its status will already be "processing").
 */
export async function claimTasks(jobId: string, batchSize: number): Promise<string[]> {
  const now = new Date();

  const tasks = await prisma.ingestionTask.findMany({
    where: {
      jobId,
      status: "pending",
      OR: [
        { retryAfter: null },
        { retryAfter: { lte: now } },
      ],
    },
    take: batchSize,
    select: { id: true },
  });

  if (tasks.length === 0) return [];

  const ids = tasks.map((t) => t.id);

  // CAS update: only rows still in "pending" with retryAfter <= now will match
  const result = await prisma.ingestionTask.updateMany({
    where: {
      id: { in: ids },
      status: "pending",
      OR: [
        { retryAfter: null },
        { retryAfter: { lte: now } },
      ],
    },
    data: {
      status: "processing",
      startedAt: now,
    },
  });

  // If all IDs were claimed, return them directly
  if (result.count === ids.length) return ids;

  // Some tasks were claimed by another worker — re-query for the ones we got
  if (result.count === 0) return [];
  const claimed = await prisma.ingestionTask.findMany({
    where: { id: { in: ids }, status: "processing", startedAt: now },
    select: { id: true },
  });
  return claimed.map((t) => t.id);
}

/**
 * Marks a task completed (CAS: only if status='processing') and increments the
 * job's completedUrls counter.
 */
export async function completeTask(
  taskId: string,
  jobId: string,
  httpStatus?: number,
  responseTimeMs?: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.ingestionTask.update({
      where: { id: taskId, status: "processing" },
      data: {
        status: "completed",
        httpStatus: httpStatus ?? null,
        responseTimeMs: responseTimeMs ?? null,
        processedAt: new Date(),
      },
    });

    await tx.ingestionJob.update({
      where: { id: jobId },
      data: { completedUrls: { increment: 1 } },
    });
  });
}

/**
 * Records a task failure.
 *
 * - Transient failure + retryCount < MAX_RETRIES  → reset to pending with
 *   exponential backoff (RETRY_BACKOFF_BASE_MS * (retryCount + 1)).
 * - Everything else → mark failed, increment job.failedUrls.
 */
export async function failTask(
  taskId: string,
  jobId: string,
  errorMessage: string,
  isTransient: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const task = await tx.ingestionTask.findUnique({
      where: { id: taskId },
      select: { retryCount: true },
    });

    if (!task) {
      console.error(`[queue] failTask called for non-existent task: ${taskId}`);
      return;
    }

    const retryCount = task.retryCount;
    const canRetry = isTransient && retryCount < MAX_RETRIES;

    if (canRetry) {
      const newRetryCount = retryCount + 1;
      const backoffMs = RETRY_BACKOFF_BASE_MS * newRetryCount;
      const retryAfter = new Date(Date.now() + backoffMs);

      await tx.ingestionTask.update({
        where: { id: taskId },
        data: {
          status: "pending",
          retryCount: newRetryCount,
          retryAfter,
          errorMessage,
          startedAt: null,
        },
      });
    } else {
      await tx.ingestionTask.update({
        where: { id: taskId },
        data: {
          status: "failed",
          errorMessage,
          processedAt: new Date(),
        },
      });

      await tx.ingestionJob.update({
        where: { id: jobId },
        data: { failedUrls: { increment: 1 } },
      });
    }
  });
}

/**
 * Finds tasks stuck in "processing" for longer than ZOMBIE_THRESHOLD_MS.
 *
 * - Tasks with retryCount < MAX_RETRIES are reset to "pending".
 * - Tasks that have exhausted retries are marked "failed" and the job counter
 *   is incremented.
 */
export async function recoverZombies(): Promise<void> {
  const threshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);

  const stale = await prisma.ingestionTask.findMany({
    where: {
      status: "processing",
      startedAt: { lt: threshold },
    },
    select: { id: true, jobId: true, retryCount: true },
  });

  if (stale.length === 0) return;

  const recoverable = stale.filter((t) => t.retryCount < MAX_RETRIES);
  const exhausted   = stale.filter((t) => t.retryCount >= MAX_RETRIES);

  if (recoverable.length > 0) {
    await prisma.ingestionTask.updateMany({
      where: { id: { in: recoverable.map((t) => t.id) } },
      data: {
        status: "pending",
        startedAt: null,
        retryAfter: null,
      },
    });
  }

  if (exhausted.length > 0) {
    await prisma.ingestionTask.updateMany({
      where: { id: { in: exhausted.map((t) => t.id) } },
      data: {
        status: "failed",
        processedAt: new Date(),
        errorMessage: "Zombie recovery: processing timeout exceeded",
      },
    });

    // Increment failedUrls per job for exhausted zombies
    const jobGroups = new Map<string, number>();
    for (const t of exhausted) {
      jobGroups.set(t.jobId, (jobGroups.get(t.jobId) ?? 0) + 1);
    }

    for (const [jobId, count] of jobGroups) {
      try {
        await prisma.ingestionJob.update({
          where: { id: jobId },
          data: { failedUrls: { increment: count } },
        });
      } catch (err) {
        console.error(`[queue] Failed to update failedUrls for job ${jobId}:`, err);
      }
    }
  }
}

/**
 * Finalizes a job once no pending or processing tasks remain.
 *
 * - All tasks completed → status = "completed"
 * - All tasks failed (completedUrls === 0) → status = "failed"
 * - Mixed result (some completed, some failed) → status = "completed"
 *   (partial success is still a completion)
 */
export async function finalizeJob(jobId: string): Promise<void> {
  // Check for any tasks still in flight
  const active = await prisma.ingestionTask.findMany({
    where: { jobId, status: { in: ["pending", "processing"] } },
    select: { id: true },
  });

  if (active.length > 0) return; // Not done yet

  const job = await prisma.ingestionJob.findUnique({
    where: { id: jobId },
    select: { totalUrls: true, completedUrls: true, failedUrls: true },
  });

  if (!job) return;

  const allFailed = job.completedUrls === 0 && job.failedUrls > 0;

  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: {
      status: allFailed ? "failed" : "completed",
      completedAt: new Date(),
    },
  });
}
