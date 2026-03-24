import { describe, it, expect, vi, beforeEach } from "vitest";

// Track $extends calls manually
const extendsCalls: unknown[] = [];

// Mock PrismaClient and adapter dependencies
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class MockPrismaClient {
      constructor() {
        // Accept any options (adapter, etc.)
      }
      $extends(arg: unknown) {
        extendsCalls.push(arg);
        return this;
      }
      $queryRaw() {
        return Promise.resolve([{ 1: 1 }]);
      }
    },
  };
});

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class MockPrismaPg {
    constructor() {}
  },
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor() {}
  },
}));

// Stub DATABASE_URL for tests
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

import { scopedPrisma, withProject } from "@/lib/db";

describe("scopedPrisma", () => {
  beforeEach(() => {
    extendsCalls.length = 0;
  });

  it("returns_an_extended_prisma_client", () => {
    const scoped = scopedPrisma("project-abc");

    expect(scoped).toBeDefined();
    expect(extendsCalls.length).toBe(1);
  });

  it("passes_query_extension_config_to_extends", () => {
    const scoped = scopedPrisma("project-xyz");

    const callArgs = extendsCalls[0] as Record<string, unknown>;
    expect(callArgs).toHaveProperty("query");
    expect(typeof callArgs.query).toBe("object");
  });

  it("includes_all_tenant_scoped_models_in_extension", () => {
    const scoped = scopedPrisma("project-tenant-1");

    const callArgs = extendsCalls[0] as Record<string, unknown>;
    const queryConfig = callArgs.query as Record<string, unknown>;

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
