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

function makeBadJsonRequest(): Request {
  return new Request("http://localhost:3000/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: "not json",
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

  it("returns_401_when_auth_fails", async () => {
    mockRequireAuth.mockRejectedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns_500_on_database_error", async () => {
    mockPrisma.strategyConfig.findUnique.mockRejectedValue(new Error("DB connection lost"));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to load settings");
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
    // Default: no existing config
    mockPrisma.strategyConfig.findUnique.mockResolvedValue(null);
  });

  it("returns_401_when_auth_fails", async () => {
    mockRequireAuth.mockRejectedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    const res = await PUT(makePutRequest({ maxLinksPerPage: 5 }) as never);
    expect(res.status).toBe(401);
  });

  it("returns_400_for_malformed_json", async () => {
    const res = await PUT(makeBadJsonRequest() as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON in request body");
  });

  it("returns_400_for_invalid_body", async () => {
    const res = await PUT(makePutRequest({ similarityThreshold: 0.2 }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details.similarityThreshold).toBeDefined();
  });

  it("returns_400_when_provider_change_lacks_forceReEmbed", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "openai" },
    });

    const res = await PUT(makePutRequest({ embeddingProvider: "cohere" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("provider_change_requires_confirmation");
  });

  it("allows_same_provider_without_forceReEmbed", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "openai" },
    });
    mockPrisma.strategyConfig.upsert.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, embeddingProvider: "openai" },
    });

    const res = await PUT(makePutRequest({ embeddingProvider: "openai" }) as never);
    expect(res.status).toBe(200);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("requires_forceReEmbed_when_no_config_exists_and_provider_differs_from_default", async () => {
    // No existing config — falls back to DEFAULT_SETTINGS.embeddingProvider ("openai")
    mockPrisma.strategyConfig.findUnique.mockResolvedValue(null);

    const res = await PUT(makePutRequest({ embeddingProvider: "cohere" }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("provider_change_requires_confirmation");
  });

  it("merges_partial_update_with_existing_settings", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { similarityThreshold: 0.85, maxLinksPerPage: 20, embeddingProvider: "openai" },
    });
    mockPrisma.strategyConfig.upsert.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS, similarityThreshold: 0.85, maxLinksPerPage: 30, embeddingProvider: "openai" },
    });

    const res = await PUT(makePutRequest({ maxLinksPerPage: 30 }) as never);
    expect(res.status).toBe(200);

    // Verify upsert was called with merged settings (not just the partial update)
    const upsertCall = mockPrisma.strategyConfig.upsert.mock.calls[0][0];
    const updateSettings = upsertCall.update.settings;
    expect(updateSettings.maxLinksPerPage).toBe(30);
    expect(updateSettings.similarityThreshold).toBe(0.85); // preserved from existing
    expect(updateSettings.embeddingProvider).toBe("openai"); // preserved from existing
  });

  it("strips_forceReEmbed_from_persisted_settings", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      settings: { embeddingProvider: "openai" },
    });
    mockPrisma.strategyConfig.upsert.mockResolvedValue({
      settings: { embeddingProvider: "cohere" },
    });
    mockPrisma.$executeRaw.mockResolvedValue(5);

    await PUT(makePutRequest({ embeddingProvider: "cohere", forceReEmbed: true }) as never);

    const upsertCall = mockPrisma.strategyConfig.upsert.mock.calls[0][0];
    expect(upsertCall.update.settings).not.toHaveProperty("forceReEmbed");
    expect(upsertCall.create.settings).not.toHaveProperty("forceReEmbed");
  });

  it("clears_embeddings_when_forceReEmbed_is_true", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      projectId: "proj-1",
      strategyId: "crosslink",
      settings: { embeddingProvider: "openai" },
    });
    mockPrisma.strategyConfig.upsert.mockResolvedValue({
      settings: { embeddingProvider: "cohere" },
    });
    mockPrisma.$executeRaw.mockResolvedValue(5);

    const res = await PUT(
      makePutRequest({ embeddingProvider: "cohere", forceReEmbed: true }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embeddingsCleared).toBe(true);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it("returns_warning_when_embedding_clear_fails", async () => {
    mockPrisma.strategyConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      settings: { embeddingProvider: "openai" },
    });
    mockPrisma.strategyConfig.upsert.mockResolvedValue({
      settings: { embeddingProvider: "cohere" },
    });
    mockPrisma.$executeRaw.mockRejectedValue(new Error("Permission denied"));

    const res = await PUT(
      makePutRequest({ embeddingProvider: "cohere", forceReEmbed: true }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.embeddingsCleared).toBe(false);
    expect(body.warning).toContain("could not be cleared");
  });

  it("returns_500_on_unexpected_error", async () => {
    mockPrisma.strategyConfig.findUnique.mockRejectedValue(new Error("DB timeout"));

    const res = await PUT(makePutRequest({ maxLinksPerPage: 10 }) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to save settings");
  });
});
