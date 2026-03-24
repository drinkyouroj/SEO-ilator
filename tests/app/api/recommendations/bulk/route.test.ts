import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    recommendation: {
      updateMany: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { PATCH } from "@/app/api/recommendations/bulk/route";
import { requireAuth } from "@/lib/auth/session";
import { scopedPrisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  recommendation: {
    updateMany: ReturnType<typeof vi.fn>;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/recommendations/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("PATCH /api/recommendations/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1" });
  });

  it("returns_400_for_invalid_json", async () => {
    const request = new Request("http://localhost:3000/api/recommendations/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });

    const res = await PATCH(request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns_400_for_validation_failure_with_empty_ids", async () => {
    const res = await PATCH(makeRequest({ ids: [], status: "accepted" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("returns_updated_count_and_requested_count_on_success", async () => {
    mockDb.recommendation.updateMany.mockResolvedValue({ count: 2 });

    const res = await PATCH(
      makeRequest({ ids: ["rec-1", "rec-2", "rec-3"], status: "dismissed", dismissReason: "Not relevant" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(2);
    expect(body.requested).toBe(3);
  });

  it("returns_500_on_unexpected_error", async () => {
    mockDb.recommendation.updateMany.mockRejectedValue(new Error("db down"));

    const res = await PATCH(
      makeRequest({ ids: ["rec-1"], status: "accepted" }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/unexpected error/i);
  });
});
