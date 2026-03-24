import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Prisma mock ──────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file, so we must use vi.hoisted() for
// variables referenced inside the factory.

const { mockIngestionJob, mockIngestionTask, mockTransaction } = vi.hoisted(() => {
  const mockIngestionJob = {
    create: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  };

  const mockIngestionTask = {
    createMany: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    findUnique: vi.fn(),
  };

  const mockTransaction = vi.fn();

  return { mockIngestionJob, mockIngestionTask, mockTransaction };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    ingestionJob: mockIngestionJob,
    ingestionTask: mockIngestionTask,
    $transaction: mockTransaction,
  },
  scopedPrisma: vi.fn(),
  withProject: vi.fn(),
}));

import {
  createJob,
  cancelJob,
  claimTasks,
  completeTask,
  failTask,
  recoverZombies,
  finalizeJob,
} from "@/lib/ingestion/queue";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    projectId: "proj-1",
    status: "pending",
    totalUrls: 3,
    completedUrls: 0,
    failedUrls: 0,
    preset: "gentle",
    completedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    jobId: "job-1",
    url: "https://example.com/page",
    status: "pending",
    retryCount: 0,
    retryAfter: null,
    errorMessage: null,
    httpStatus: null,
    responseTimeMs: null,
    startedAt: null,
    processedAt: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates_urls_before_creating_tasks", async () => {
    const job = makeJob({ id: "job-new", totalUrls: 2 });

    // $transaction receives a callback — execute it with a mock tx client
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionJob: { create: vi.fn().mockResolvedValue(job) },
        ingestionTask: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };
      return fn(tx);
    });

    const urls = [
      "https://example.com/page",
      "https://EXAMPLE.COM/page",   // duplicate after normalisation
      "https://example.com/other/", // trailing slash variant
      "https://example.com/other",  // deduped with above
    ];

    const result = await createJob("proj-1", urls, "gentle");

    // The transaction callback should have been called once
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Retrieve the tx mock to inspect calls
    const txCall = mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>;
    const tx = {
      ingestionJob: { create: vi.fn().mockResolvedValue(job) },
      ingestionTask: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    };
    await txCall(tx);

    // createMany should be called with exactly 2 deduplicated URLs
    expect(tx.ingestionTask.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ url: "https://example.com/page" }),
          expect.objectContaining({ url: "https://example.com/other" }),
        ]),
      })
    );
    expect(tx.ingestionTask.createMany.mock.calls[0][0].data).toHaveLength(2);

    expect(result).toMatchObject({ id: "job-new" });
  });

  it("sets_totalUrls_to_deduplicated_count", async () => {
    const urls = ["https://example.com/a", "https://example.com/a"];

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionJob: {
          create: vi.fn().mockImplementation(({ data }: { data: unknown }) =>
            Promise.resolve({ id: "job-2", ...data as object })
          ),
        },
        ingestionTask: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return fn(tx);
    });

    await createJob("proj-1", urls, "standard");

    // Run callback again to capture the job create call
    const txCapture = {
      ingestionJob: {
        create: vi.fn().mockResolvedValue({ id: "job-2" }),
      },
      ingestionTask: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await (mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>)(txCapture);

    expect(txCapture.ingestionJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalUrls: 1 }),
      })
    );
  });
});

describe("cancelJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets_job_status_to_cancelled_and_transitions_pending_tasks", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionJob: { update: vi.fn().mockResolvedValue(makeJob({ status: "cancelled" })) },
        ingestionTask: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      };
      return fn(tx);
    });

    await cancelJob("job-1", "proj-1");

    const txCapture = {
      ingestionJob: { update: vi.fn().mockResolvedValue(makeJob({ status: "cancelled" })) },
      ingestionTask: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    };
    await (mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>)(txCapture);

    // Job should be set to cancelled
    expect(txCapture.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1" }),
        data: expect.objectContaining({ status: "cancelled" }),
      })
    );

    // Pending and processing tasks for the job should be cancelled atomically
    expect(txCapture.ingestionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobId: "job-1",
          status: { in: ["pending", "processing"] },
        }),
        data: expect.objectContaining({ status: "cancelled" }),
      })
    );
  });
});

describe("claimTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns_task_ids_for_pending_tasks_with_retryAfter_in_past", async () => {
    const now = new Date();
    const tasks = [
      makeTask({ id: "t1", retryAfter: null }),
      makeTask({ id: "t2", retryAfter: new Date(now.getTime() - 5000) }),
    ];

    mockIngestionTask.findMany.mockResolvedValue(tasks);
    mockIngestionTask.updateMany.mockResolvedValue({ count: 2 });

    const claimed = await claimTasks("job-1", 10);

    expect(mockIngestionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          jobId: "job-1",
          status: "pending",
        }),
      })
    );
    expect(claimed).toEqual(["t1", "t2"]);
  });

  it("returns_empty_array_when_no_pending_tasks_exist", async () => {
    mockIngestionTask.findMany.mockResolvedValue([]);

    const claimed = await claimTasks("job-1", 10);

    expect(claimed).toEqual([]);
    // updateMany should not be called when there is nothing to claim
    expect(mockIngestionTask.updateMany).not.toHaveBeenCalled();
  });
});

describe("completeTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks_task_completed_and_increments_job_completedUrls", async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionTask: { update: vi.fn().mockResolvedValue(makeTask({ status: "completed" })) },
        ingestionJob: { update: vi.fn().mockResolvedValue(makeJob({ completedUrls: 1 })) },
      };
      return fn(tx);
    });

    await completeTask("task-1", "job-1", 200, 450);

    const txCapture = {
      ingestionTask: { update: vi.fn().mockResolvedValue(makeTask({ status: "completed" })) },
      ingestionJob: { update: vi.fn().mockResolvedValue(makeJob({ completedUrls: 1 })) },
    };
    await (mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>)(txCapture);

    // Task: CAS update — only if status='processing'
    expect(txCapture.ingestionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-1", status: "processing" }),
        data: expect.objectContaining({
          status: "completed",
          httpStatus: 200,
          responseTimeMs: 450,
        }),
      })
    );

    // Job counter increment
    expect(txCapture.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1" }),
        data: expect.objectContaining({
          completedUrls: { increment: 1 },
        }),
      })
    );
  });
});

describe("failTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets_transient_failure_to_pending_with_backoff_when_under_retry_limit", async () => {
    const task = makeTask({ id: "task-2", retryCount: 0, status: "processing" });

    mockIngestionTask.update
      // First call: fetch the task to check retryCount
      .mockResolvedValueOnce(task);
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionTask: {
          findUnique: vi.fn().mockResolvedValue(task),
          update: vi.fn().mockResolvedValue({ ...task, status: "pending", retryCount: 1 }),
        },
        ingestionJob: { update: vi.fn() },
      };
      return fn(tx);
    });

    await failTask("task-2", "job-1", "connection timeout", true);

    const txCapture = {
      ingestionTask: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue({ ...task, status: "pending", retryCount: 1 }),
      },
      ingestionJob: { update: vi.fn() },
    };
    await (mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>)(txCapture);

    // Should reset to pending with incremented retryCount and a future retryAfter
    expect(txCapture.ingestionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-2" }),
        data: expect.objectContaining({
          status: "pending",
          retryCount: 1,
          retryAfter: expect.any(Date),
          errorMessage: "connection timeout",
        }),
      })
    );

    // Job failedUrls should NOT be incremented
    expect(txCapture.ingestionJob.update).not.toHaveBeenCalled();
  });

  it("marks_permanent_failure_immediately_without_retry", async () => {
    const task = makeTask({ id: "task-3", retryCount: 0, status: "processing" });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        ingestionTask: {
          findUnique: vi.fn().mockResolvedValue(task),
          update: vi.fn().mockResolvedValue({ ...task, status: "failed" }),
        },
        ingestionJob: {
          update: vi.fn().mockResolvedValue(makeJob({ failedUrls: 1 })),
        },
      };
      return fn(tx);
    });

    await failTask("task-3", "job-1", "404 Not Found", false);

    const txCapture = {
      ingestionTask: {
        findUnique: vi.fn().mockResolvedValue(task),
        update: vi.fn().mockResolvedValue({ ...task, status: "failed" }),
      },
      ingestionJob: {
        update: vi.fn().mockResolvedValue(makeJob({ failedUrls: 1 })),
      },
    };
    await (mockTransaction.mock.calls[0][0] as (tx: unknown) => Promise<unknown>)(txCapture);

    // Task should be marked failed immediately
    expect(txCapture.ingestionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "task-3" }),
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "404 Not Found",
        }),
      })
    );

    // Job failedUrls should be incremented
    expect(txCapture.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1" }),
        data: expect.objectContaining({ failedUrls: { increment: 1 } }),
      })
    );
  });
});

describe("recoverZombies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets_stale_processing_tasks_to_pending_when_under_retry_limit", async () => {
    const staleTime = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago

    const zombieTasks = [
      makeTask({ id: "z1", status: "processing", retryCount: 0, startedAt: staleTime }),
      makeTask({ id: "z2", status: "processing", retryCount: 1, startedAt: staleTime }),
    ];

    const exhaustedTasks = [
      makeTask({ id: "z3", status: "processing", retryCount: 2, startedAt: staleTime }),
    ];

    mockIngestionTask.findMany.mockResolvedValue([...zombieTasks, ...exhaustedTasks]);
    mockIngestionTask.updateMany
      .mockResolvedValueOnce({ count: 2 }) // reset to pending
      .mockResolvedValueOnce({ count: 1 }); // mark failed (exhausted retries)
    mockIngestionJob.update.mockResolvedValue({});

    await recoverZombies();

    // Should have fetched tasks stuck in processing beyond threshold
    expect(mockIngestionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "processing",
          startedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      })
    );

    // Under-limit zombies reset to pending
    expect(mockIngestionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["z1", "z2"] } }),
        data: expect.objectContaining({ status: "pending" }),
      })
    );

    // Exhausted zombies marked failed
    expect(mockIngestionTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["z3"] } }),
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });
});

describe("finalizeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets_job_to_completed_when_all_tasks_are_done", async () => {
    mockIngestionTask.findMany.mockResolvedValue([]); // no pending/processing tasks
    mockIngestionJob.findUnique.mockResolvedValue(
      makeJob({ id: "job-1", totalUrls: 2, completedUrls: 2, failedUrls: 0 })
    );
    mockIngestionJob.update.mockResolvedValue(makeJob({ status: "completed" }));

    await finalizeJob("job-1");

    expect(mockIngestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1" }),
        data: expect.objectContaining({
          status: "completed",
          completedAt: expect.any(Date),
        }),
      })
    );
  });

  it("sets_job_to_failed_when_all_tasks_failed", async () => {
    mockIngestionTask.findMany.mockResolvedValue([]); // no pending/processing tasks
    mockIngestionJob.findUnique.mockResolvedValue(
      makeJob({ id: "job-1", totalUrls: 2, completedUrls: 0, failedUrls: 2 })
    );
    mockIngestionJob.update.mockResolvedValue(makeJob({ status: "failed" }));

    await finalizeJob("job-1");

    expect(mockIngestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "job-1" }),
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("does_not_finalize_when_tasks_still_in_progress", async () => {
    // There are still pending tasks
    mockIngestionTask.findMany.mockResolvedValue([
      makeTask({ status: "pending" }),
    ]);

    await finalizeJob("job-1");

    expect(mockIngestionJob.update).not.toHaveBeenCalled();
  });
});
