import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/cron-guard", () => ({
  verifyCronSecret: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    ingestionJob: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ingestionTask: {
      findUnique: vi.fn(),
    },
    article: {
      upsert: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/ingestion/queue", () => ({
  claimTasks: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  recoverZombies: vi.fn(),
  finalizeJob: vi.fn(),
}));

vi.mock("@/lib/ingestion/crawler", () => ({
  crawlUrl: vi.fn(),
  fetchRobotsTxt: vi.fn(),
}));

vi.mock("@/lib/ingestion/parser", () => ({
  parseHTML: vi.fn(),
}));

vi.mock("@/lib/ingestion/normalizer", () => ({
  normalizeArticle: vi.fn(),
}));

vi.mock("@/lib/ingestion/robots", () => {
  return {
    RobotsCache: class MockRobotsCache {},
  };
});

vi.mock("@/lib/embeddings/batch", () => ({
  invalidateEmbedding: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { GET } from "@/app/api/cron/crawl/route";
import { verifyCronSecret } from "@/lib/auth/cron-guard";
import { prisma } from "@/lib/db";
import {
  claimTasks,
  completeTask,
  recoverZombies,
  finalizeJob,
} from "@/lib/ingestion/queue";
import { crawlUrl, fetchRobotsTxt } from "@/lib/ingestion/crawler";
import { parseHTML } from "@/lib/ingestion/parser";
import { normalizeArticle } from "@/lib/ingestion/normalizer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockVerify = vi.mocked(verifyCronSecret) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClaimTasks = vi.mocked(claimTasks) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCompleteTask = vi.mocked(completeTask) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRecoverZombies = vi.mocked(recoverZombies) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFinalizeJob = vi.mocked(finalizeJob) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCrawlUrl = vi.mocked(crawlUrl) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetchRobotsTxt = vi.mocked(fetchRobotsTxt) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockParseHTML = vi.mocked(parseHTML) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockNormalize = vi.mocked(normalizeArticle) as any;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/cron/crawl", {
    method: "GET",
    headers: { Authorization: "Bearer test-cron-secret" },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("GET /api/cron/crawl", () => {
  const originalEnv = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalEnv;
  });

  it("returns_401_without_cron_secret", async () => {
    mockVerify.mockReturnValue(false);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns_401_with_wrong_cron_secret", async () => {
    mockVerify.mockReturnValue(false);

    const req = new Request("http://localhost:3000/api/cron/crawl", {
      method: "GET",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("processes_pending_crawl_tasks", async () => {
    mockVerify.mockReturnValue(true);
    mockRecoverZombies.mockResolvedValue(undefined);

    // One pending job with one task
    const job = {
      id: "job-1",
      projectId: "proj-1",
      status: "pending",
      preset: "standard",
      createdAt: new Date(),
    };
    mockPrisma.ingestionJob.findMany.mockResolvedValue([job]);
    mockPrisma.ingestionJob.update.mockResolvedValue({ ...job, status: "running" });

    // Claim one batch then empty
    mockClaimTasks.mockResolvedValueOnce(["task-1"]).mockResolvedValueOnce([]);

    mockPrisma.ingestionTask.findUnique.mockResolvedValue({
      id: "task-1",
      url: "https://example.com/page-1",
    });

    mockPrisma.ingestionJob.findUnique.mockResolvedValue({
      status: "running",
      projectId: "proj-1",
    });

    mockFetchRobotsTxt.mockResolvedValue(undefined);
    mockCrawlUrl.mockResolvedValue({
      html: "<html><body>Hello</body></html>",
      httpStatus: 200,
      responseTimeMs: 150,
      error: null,
    });

    mockParseHTML.mockReturnValue({
      url: "https://example.com/page-1",
      title: "Page 1",
      body: "Hello",
      wordCount: 1,
      existingLinks: [],
      metadata: {},
      parseWarning: null,
    });

    mockNormalize.mockReturnValue({
      url: "https://example.com/page-1",
      title: "Page 1",
      body: "Hello",
      bodyHash: "bh1",
      titleHash: "th1",
      wordCount: 1,
      existingLinks: [],
      metadata: {},
      sourceType: "crawl",
      parseWarning: null,
    });

    mockPrisma.article.upsert.mockResolvedValue({ id: "art-1" });
    mockCompleteTask.mockResolvedValue(undefined);
    mockFinalizeJob.mockResolvedValue(undefined);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.tasksCompleted).toBe(1);
    expect(body.jobsProcessed).toBe(1);
    expect(mockRecoverZombies).toHaveBeenCalledOnce();
    expect(mockFinalizeJob).toHaveBeenCalledWith("job-1");
  });

  it("recovers_zombie_tasks", async () => {
    mockVerify.mockReturnValue(true);
    mockRecoverZombies.mockResolvedValue(undefined);

    // No active jobs — just verify recoverZombies was called
    mockPrisma.ingestionJob.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRecoverZombies).toHaveBeenCalledOnce();
    // zombiesRecovered is set to -1 as a sentinel since recoverZombies doesn't return a count
    expect(body.zombiesRecovered).toBe(-1);
  });
});
