import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    recommendation: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { PATCH } from "@/app/api/recommendations/[id]/route";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  recommendation: {
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/recommendations/rec-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id = "rec-1") {
  return { params: Promise.resolve({ id }) };
}

const VALID_BODY = {
  status: "accepted",
  updatedAt: "2026-03-24T00:00:00.000Z",
};

// ── Tests ──────────────────────────────────────────────────────────────

describe("PATCH /api/recommendations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1" });
  });

  it("returns_400_for_invalid_json", async () => {
    const request = new Request("http://localhost:3000/api/recommendations/rec-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });

    const res = await PATCH(request, makeParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns_400_for_validation_failure", async () => {
    const res = await PATCH(
      makeRequest({ status: "bogus", updatedAt: "not-a-date" }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("returns_404_when_recommendation_not_found", async () => {
    mockDb.recommendation.updateMany.mockResolvedValue({ count: 0 });
    mockDb.recommendation.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest(VALID_BODY), makeParams());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Recommendation not found");
  });

  it("returns_409_when_updatedAt_does_not_match", async () => {
    mockDb.recommendation.updateMany.mockResolvedValue({ count: 0 });
    mockDb.recommendation.findUnique.mockResolvedValue({ id: "rec-1" });

    const res = await PATCH(makeRequest(VALID_BODY), makeParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/modified since you loaded it/);
  });

  it("returns_updated_recommendation_on_success", async () => {
    const updatedRec = { id: "rec-1", status: "accepted", updatedAt: "2026-03-24T01:00:00.000Z" };
    mockDb.recommendation.updateMany.mockResolvedValue({ count: 1 });
    mockDb.recommendation.findUnique.mockResolvedValue(updatedRec);

    const res = await PATCH(makeRequest(VALID_BODY), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendation).toEqual(updatedRec);
  });
});
