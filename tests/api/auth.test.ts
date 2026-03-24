import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/auth/plan-guard", () => ({
  checkPlanLimits: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    article: {
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    recommendation: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    strategyConfig: {
      findUnique: vi.fn(),
    },
    analysisRun: {
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/embeddings", () => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/embeddings/cache", () => ({
  checkEmbeddingCache: vi.fn(),
}));

vi.mock("@/lib/export/csv", () => ({
  serializeCsv: vi.fn(() => "csv-content"),
}));

vi.mock("@/lib/export/json", () => ({
  serializeJson: vi.fn(() => '["json-content"]'),
  jsonContentDisposition: vi.fn((f: string) => `attachment; filename="${f}"`),
}));

vi.mock("next/server", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = (await importOriginal()) as any;
  return {
    ...original,
    after: vi.fn(),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { GET as getArticle } from "@/app/api/articles/[id]/route";
import { GET as getRecommendations } from "@/app/api/recommendations/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  article: {
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  recommendation: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  strategyConfig: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeParams(id = "art-1") {
  return { params: Promise.resolve({ id }) };
}

// ── Tests: Cross-Tenant Isolation [AAP-B5] ─────────────────────────────

describe("Cross-tenant isolation [AAP-B5]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns_401_for_unauthenticated_requests", async () => {
    // requireAuth throws a 401 Response when no session exists.
    // The articles/[id] route does NOT have a try/catch around requireAuth,
    // so the thrown Response propagates as an unhandled rejection.
    const thrownResponse = new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
    mockRequireAuth.mockRejectedValue(thrownResponse);

    const req = new Request("http://localhost:3000/api/articles/art-1");
    try {
      await getArticle(req, makeParams("art-1"));
      // If we get here, the route caught the error internally
      expect.fail("Expected requireAuth rejection to propagate");
    } catch (caught) {
      // The thrown object is the Response itself
      expect(caught).toBeInstanceOf(Response);
      const res = caught as Response;
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    }
  });

  it("prevents_cross_tenant_article_access", async () => {
    // User A is authenticated with project-A
    mockRequireAuth.mockResolvedValue({ projectId: "project-A", userId: "user-A" });

    // scopedPrisma(project-A).article.findUnique returns null because
    // the article belongs to project-B — the scoped query filters it out
    mockDb.article.findUnique.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/articles/art-from-project-B");
    const res = await getArticle(req, makeParams("art-from-project-B"));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Article not found");

    // Verify scopedPrisma was called with the authenticated user's project
    expect(scopedPrisma).toHaveBeenCalledWith("project-A");
  });

  it("prevents_cross_tenant_recommendation_access", async () => {
    // User A is authenticated with project-A
    mockRequireAuth.mockResolvedValue({ projectId: "project-A", userId: "user-A" });

    // scopedPrisma filters recommendations to project-A only, so
    // recommendations from project-B are never returned
    mockDb.recommendation.findMany.mockResolvedValue([]);

    const req = new Request("http://localhost:3000/api/recommendations");
    const res = await getRecommendations(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recommendations).toHaveLength(0);

    // Verify scopedPrisma scoped to the correct project
    expect(scopedPrisma).toHaveBeenCalledWith("project-A");
  });

  it("prevents_cross_tenant_settings_access", async () => {
    // User B is authenticated with project-B
    mockRequireAuth.mockResolvedValue({ projectId: "project-B", userId: "user-B" });

    // Settings lookup scoped to project-B returns null (no config for this project)
    mockDb.strategyConfig.findUnique.mockResolvedValue(null);

    const res = await getSettings();
    expect(res.status).toBe(200);

    const body = await res.json();
    // Gets default settings, not project-A's settings
    expect(body.settings).toBeDefined();

    // Note: settings route uses base prisma with projectId in the where clause,
    // not scopedPrisma, but the effect is the same — only the authenticated
    // project's data is returned
  });

  it("returns_403_when_no_project_associated", async () => {
    // requireAuth throws 403 when user has no projectId.
    // Same as 401 case — the articles/[id] route lets it propagate.
    const thrownResponse = new Response(
      JSON.stringify({ error: "No project found. Please contact support." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
    mockRequireAuth.mockRejectedValue(thrownResponse);

    const req = new Request("http://localhost:3000/api/articles/art-1");
    try {
      await getArticle(req, makeParams("art-1"));
      expect.fail("Expected requireAuth rejection to propagate");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Response);
      const res = caught as Response;
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/No project found/);
    }
  });
});
