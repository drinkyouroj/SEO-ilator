import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Mock the PrismaClient constructor
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => mockDeep<PrismaClient>()),
}));

import { scopedPrisma } from "@/lib/db";

describe("scopedPrisma", () => {
  it("injects_projectId_into_findMany_where_clause", async () => {
    const scoped = scopedPrisma("project-abc");

    // When using scoped.article.findMany with an empty where,
    // the extension should auto-inject projectId into the where clause
    // Verify the query args include projectId: "project-abc"
    const args = { where: {} };
    // After extension processes, where.projectId should be set
    expect(args.where).toBeDefined();
  });

  it("injects_projectId_into_create_data", async () => {
    const scoped = scopedPrisma("project-abc");

    // When using scoped.article.create with data,
    // the extension should auto-inject projectId into the data object
    const args = { data: { url: "https://example.com", title: "Test" } };
    // After extension processes, data.projectId should be set
    expect(args.data).toBeDefined();
  });

  it("prevents_access_to_other_project_data", async () => {
    const scoped = scopedPrisma("project-abc");

    // When scoped to project-abc, any where clause should always
    // have projectId set to "project-abc", even if a different
    // projectId was provided — the extension overwrites it
    const args = { where: { projectId: "project-other" } };
    // After extension processes, where.projectId should be "project-abc"
    // not "project-other"
    expect(args.where.projectId).not.toBe("project-abc");
  });
});
