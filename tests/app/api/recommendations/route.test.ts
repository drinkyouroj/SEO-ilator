import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    recommendation: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/export/csv", () => ({
  serializeCsv: vi.fn(() => "csv-content"),
}));

vi.mock("@/lib/export/json", () => ({
  serializeJson: vi.fn(() => '["json-content"]'),
  jsonContentDisposition: vi.fn((f: string) => `attachment; filename="${f}"`),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { GET } from "@/app/api/recommendations/route";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  recommendation: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(query: Record<string, string> = {}): Request {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost:3000/api/recommendations?${params}`);
}

function makeRec(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    severity: "warning",
    confidence: 0.8,
    anchorText: "test anchor",
    matchingApproach: "keyword",
    status: "pending",
    type: "crosslink",
    title: "Add link",
    description: "You should add a link",
    suggestion: null,
    createdAt: new Date().toISOString(),
    sourceArticle: { title: "Source Article", url: "https://example.com/source" },
    targetArticle: { title: "Target Article", url: "https://example.com/target" },
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("GET /api/recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1" });
  });

  it("returns_400_for_invalid_query_params", async () => {
    const res = await GET(makeRequest({ limit: "-5" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid query parameters");
    expect(body.details).toBeDefined();
  });

  it("returns_paginated_recommendations_on_success", async () => {
    const rec = makeRec();
    mockDb.recommendation.findMany.mockResolvedValue([rec]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].id).toBe("rec-1");
    expect(body.nextCursor).toBeNull();
  });

  it("returns_csv_export_with_correct_headers", async () => {
    const rec = makeRec();
    mockDb.recommendation.count.mockResolvedValue(1);
    mockDb.recommendation.findMany.mockResolvedValue([rec]);

    const res = await GET(makeRequest({ format: "csv" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /attachment; filename="seo-ilator-recommendations-\d{4}-\d{2}-\d{2}\.csv"/,
    );
  });

  it("returns_413_when_export_exceeds_10k_rows", async () => {
    mockDb.recommendation.count.mockResolvedValue(15_000);

    const res = await GET(makeRequest({ format: "csv" }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("TOO_MANY_RESULTS");
    expect(body.count).toBe(15_000);
  });

  it("returns_500_on_unexpected_error", async () => {
    mockDb.recommendation.findMany.mockRejectedValue(new Error("db down"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/unexpected error/i);
  });
});
