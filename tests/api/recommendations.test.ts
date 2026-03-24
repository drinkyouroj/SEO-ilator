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

// ── Tests (severity & status filtering — not covered by existing suite) ──

describe("GET /api/recommendations — filter coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
  });

  it("filters_recommendations_by_severity", async () => {
    const criticalRec = makeRec({ id: "rec-c", severity: "critical", confidence: 0.95 });
    mockDb.recommendation.findMany.mockResolvedValue([criticalRec]);

    const res = await GET(makeRequest({ severity: "critical" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].severity).toBe("critical");

    // Verify scopedPrisma was called with the correct projectId
    expect(scopedPrisma).toHaveBeenCalledWith("proj-1");

    // Verify findMany was called with severity in the where clause
    const findManyCall = mockDb.recommendation.findMany.mock.calls[0][0];
    expect(findManyCall.where).toHaveProperty("severity", "critical");
  });

  it("filters_recommendations_by_status", async () => {
    const acceptedRec = makeRec({ id: "rec-a", status: "accepted" });
    mockDb.recommendation.findMany.mockResolvedValue([acceptedRec]);

    const res = await GET(makeRequest({ status: "accepted" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].status).toBe("accepted");

    // Verify findMany was called with status in the where clause
    const findManyCall = mockDb.recommendation.findMany.mock.calls[0][0];
    expect(findManyCall.where).toHaveProperty("status", "accepted");
  });

  it("filters_recommendations_by_severity_and_status_combined", async () => {
    const rec = makeRec({ id: "rec-crit-acc", severity: "critical", status: "accepted" });
    mockDb.recommendation.findMany.mockResolvedValue([rec]);

    const res = await GET(makeRequest({ severity: "critical", status: "accepted" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recommendations).toHaveLength(1);

    const findManyCall = mockDb.recommendation.findMany.mock.calls[0][0];
    expect(findManyCall.where).toHaveProperty("severity", "critical");
    expect(findManyCall.where).toHaveProperty("status", "accepted");
  });

  it("returns_empty_list_when_no_recommendations_match_filter", async () => {
    mockDb.recommendation.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ severity: "critical" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.recommendations).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });
});
