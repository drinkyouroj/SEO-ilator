import { describe, it, expect, vi } from "vitest";

// Track $extends calls manually
const extendsCalls: unknown[] = [];

// Mock PrismaClient with a class that tracks $extends calls
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class MockPrismaClient {
      $extends(arg: unknown) {
        extendsCalls.push(arg);
        return this; // Return self to allow chaining
      }
      $queryRaw() {
        return Promise.resolve([{ 1: 1 }]);
      }
    },
  };
});

import { scopedPrisma, withProject } from "@/lib/db";

describe("scopedPrisma", () => {
  it("returns_an_extended_prisma_client", () => {
    extendsCalls.length = 0;
    const scoped = scopedPrisma("project-abc");

    expect(scoped).toBeDefined();
    expect(extendsCalls.length).toBe(1);
  });

  it("passes_query_extension_config_to_extends", () => {
    extendsCalls.length = 0;
    const scoped = scopedPrisma("project-xyz");

    const callArgs = extendsCalls[0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty("query");
    expect(typeof callArgs.query).toBe("object");
  });

  it("includes_all_tenant_scoped_models_in_extension", () => {
    extendsCalls.length = 0;
    const scoped = scopedPrisma("project-tenant-1");

    const callArgs = extendsCalls[0] as Record<string, unknown>;
    const queryConfig = callArgs.query as Record<string, unknown>;

    // All tenant-scoped models should be present in the query extension
    const expectedModels = [
      "article",
      "analysisRun",
      "recommendation",
      "strategyConfig",
      "ingestionJob",
      "ingestionTask",
    ];

    for (const model of expectedModels) {
      expect(queryConfig).toHaveProperty(model);
    }
  });
});

describe("withProject", () => {
  it("returns_object_with_projectId", () => {
    const result = withProject("project-123");
    expect(result).toEqual({ projectId: "project-123" });
  });
});
