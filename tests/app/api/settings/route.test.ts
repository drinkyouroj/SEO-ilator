import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth/session", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    strategyConfig: { findUnique: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

// ── Imports (after mocks) ──────────────────────────────────────────────

import { GET, PUT } from "@/app/api/settings/route";
import { requireAuth } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/validation/settingsSchemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

// ── Helpers ────────────────────────────────────────────────────────────

function makePutRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
  });

  it("returns_default_settings_when_no_config_exists", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("returns_merged_settings_when_config_exists", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { maxLinksPerPage: 25, similarityThreshold: 0.85 },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.maxLinksPerPage).toBe(25);
    expect(body.settings.similarityThreshold).toBe(0.85);
    // Defaults for unset fields
    expect(body.settings.defaultApproaches).toEqual(["keyword"]);
    expect(body.settings.embeddingProvider).toBe("openai");
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
  });

  it("returns_400_for_invalid_body", async () => {
    const res = await PUT(makePutRequest({ similarityThreshold: 0.2 }) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details.similarityThreshold).toBeDefined();
  });

  it("returns_400_when_provider_change_lacks_forceReEmbed", async () => {
    // Existing config uses openai
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "openai" },
    });

    const res = await PUT(makePutRequest({ embeddingProvider: "cohere" }) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("provider_change_requires_confirmation");
  });

  it("upserts_config_on_valid_update", async () => {
    // No provider change — no findUnique needed for AAP-B6
    const upsertedConfig = {
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { maxLinksPerPage: 30 },
    };
    mockPrisma.strategyConfig.upsert.mockResolvedValue(upsertedConfig);

    const res = await PUT(makePutRequest({ maxLinksPerPage: 30 }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({ maxLinksPerPage: 30 });
    expect(body.embeddingsCleared).toBe(false);
    expect(mockPrisma.strategyConfig.upsert).toHaveBeenCalledOnce();
  });

  it("clears_embeddings_when_forceReEmbed_is_true", async () => {
    // Provider change with forceReEmbed
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "openai" },
    });

    const upsertedConfig = {
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "cohere" },
    };
    mockPrisma.strategyConfig.upsert.mockResolvedValue(upsertedConfig);
    mockPrisma.$executeRaw.mockResolvedValue(5);

    const res = await PUT(
      makePutRequest({ embeddingProvider: "cohere", forceReEmbed: true }) as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embeddingsCleared).toBe(true);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });
});
