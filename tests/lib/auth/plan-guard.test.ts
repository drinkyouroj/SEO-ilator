import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient, User } from "@prisma/client";

// Mock the db module before importing the function under test
vi.mock("@/lib/db", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { prisma } from "@/lib/db";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

// ── Test Fixtures ──

const FREE_USER: Pick<User, "id" | "plan" | "articleLimit" | "runLimit"> = {
  id: "user-free-1",
  plan: "free",
  articleLimit: 50,
  runLimit: 3,
};

const PRO_USER: Pick<User, "id" | "plan" | "articleLimit" | "runLimit"> = {
  id: "user-pro-1",
  plan: "pro",
  articleLimit: 2000,
  runLimit: 999999, // effectively unlimited
};

const PROJECT_ID = "project-test-1";
const USER_ID = "user-free-1";

describe("checkPlanLimits", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("allows_free_tier_user_first_three_runs", async () => {
    // Setup: free user with 0 runs this month
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(0);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("blocks_free_tier_user_after_three_runs", async () => {
    // Setup: free user with 3 runs this month (at limit)
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(3);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain("limit");
  });

  it("blocks_free_tier_semantic_matching", async () => {
    // Setup: free user attempting semantic analysis (not allowed on free tier)
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    const result = await checkPlanLimits(PROJECT_ID, "analyze_semantic");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain("Pro");
  });

  it("allows_pro_tier_unlimited_runs", async () => {
    // Setup: pro user with 100 runs this month (still allowed)
    const proUserId = "user-pro-1";

    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: proUserId,
      name: "Pro Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...PRO_USER,
      id: proUserId,
      name: "Pro User",
      email: "pro@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(100);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("returns_descriptive_message_on_limit", async () => {
    // Setup: free user at run limit -- verify message is user-friendly
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      name: "Test Project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    prismaMock.user.findUnique.mockResolvedValue({
      ...FREE_USER,
      id: USER_ID,
      name: "Test User",
      email: "test@example.com",
      emailVerified: null,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as User);

    prismaMock.analysisRun.count.mockResolvedValue(3);

    const result = await checkPlanLimits(PROJECT_ID, "analyze");

    expect(result.allowed).toBe(false);
    expect(result.message).toBeDefined();
    // Message should be descriptive and mention upgrading
    expect(result.message!.length).toBeGreaterThan(20);
    expect(result.message).toMatch(/upgrade|pro|limit/i);
  });
});
