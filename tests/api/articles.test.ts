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
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    analysisRun: {
      count: vi.fn(),
    },
  };
  return {
    prisma: mockPrisma,
    scopedPrisma: vi.fn(() => mockPrisma),
  };
});

vi.mock("@/lib/ingestion/parser", () => ({
  parseHTML: vi.fn(),
  parseMarkdown: vi.fn(),
}));

vi.mock("@/lib/ingestion/normalizer", () => ({
  normalizeArticle: vi.fn(),
}));

vi.mock("@/lib/embeddings/batch", () => ({
  invalidateEmbedding: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────

import { POST as pushPost } from "@/app/api/articles/push/route";
import { GET, DELETE } from "@/app/api/articles/[id]/route";
import { requireAuth } from "@/lib/auth/session";
import { checkPlanLimits } from "@/lib/auth/plan-guard";
import { scopedPrisma } from "@/lib/db";
import { normalizeArticle } from "@/lib/ingestion/normalizer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAuth = vi.mocked(requireAuth) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCheckPlanLimits = vi.mocked(checkPlanLimits) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = (vi.mocked(scopedPrisma) as any)() as {
  article: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  analysisRun: {
    count: ReturnType<typeof vi.fn>;
  };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockNormalize = vi.mocked(normalizeArticle) as any;

// ── Helpers ────────────────────────────────────────────────────────────

function makePushRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/articles/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams(id = "art-1") {
  return { params: Promise.resolve({ id }) };
}

const VALID_PUSH_BODY = {
  url: "https://example.com/article-1",
  title: "Test Article",
  body: "This is a test article body with enough words.",
  bodyFormat: "text" as const,
};

const NORMALIZED_ARTICLE = {
  url: "https://example.com/article-1",
  title: "Test Article",
  body: "This is a test article body with enough words.",
  bodyHash: "hash-body",
  titleHash: "hash-title",
  wordCount: 9,
  existingLinks: [],
  metadata: {},
  sourceType: "push",
  parseWarning: null,
};

// ── Tests: POST /api/articles/push ────────────────────────────────────

describe("POST /api/articles/push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
    mockCheckPlanLimits.mockResolvedValue({ allowed: true });
    mockNormalize.mockReturnValue(NORMALIZED_ARTICLE);
  });

  it("creates_article_via_push_and_returns_created_count", async () => {
    mockDb.article.findUnique.mockResolvedValue(null);
    const createdArticle = { id: "art-1", ...NORMALIZED_ARTICLE, projectId: "proj-1" };
    mockDb.article.create.mockResolvedValue(createdArticle);

    const res = await pushPost(makePushRequest(VALID_PUSH_BODY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.article.id).toBe("art-1");
    expect(body.changed).toBe(true);
    expect(mockDb.article.create).toHaveBeenCalledOnce();
  });

  it("returns_400_for_invalid_push_payload", async () => {
    const res = await pushPost(
      makePushRequest({ url: "not-a-url", title: "", body: "" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.details).toBeDefined();
  });

  it("returns_400_for_invalid_json", async () => {
    const request = new Request("http://localhost:3000/api/articles/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });

    const res = await pushPost(request);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns_403_when_plan_limit_exceeded", async () => {
    mockCheckPlanLimits.mockResolvedValue({
      allowed: false,
      message: "API access is available on the Pro plan.",
    });

    const res = await pushPost(makePushRequest(VALID_PUSH_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Pro plan/);
  });
});

// ── Tests: GET /api/articles/[id] ─────────────────────────────────────

describe("GET /api/articles/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
  });

  it("returns_article_by_id", async () => {
    const article = {
      id: "art-1",
      projectId: "proj-1",
      url: "https://example.com/article-1",
      title: "Test Article",
    };
    mockDb.article.findUnique.mockResolvedValue(article);

    const req = new Request("http://localhost:3000/api/articles/art-1");
    const res = await GET(req, makeParams("art-1"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.article.id).toBe("art-1");
    expect(body.article.title).toBe("Test Article");
  });

  it("returns_404_when_article_not_found", async () => {
    mockDb.article.findUnique.mockResolvedValue(null);

    const req = new Request("http://localhost:3000/api/articles/nonexistent");
    const res = await GET(req, makeParams("nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Article not found");
  });
});

// ── Tests: DELETE /api/articles/[id] ──────────────────────────────────

describe("DELETE /api/articles/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ projectId: "proj-1", userId: "user-1" });
  });

  it("deletes_article_successfully", async () => {
    mockDb.analysisRun.count.mockResolvedValue(0);
    mockDb.article.delete.mockResolvedValue({ id: "art-1" });

    const req = new Request("http://localhost:3000/api/articles/art-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("art-1"));
    expect(res.status).toBe(204);
    expect(mockDb.article.delete).toHaveBeenCalledWith({ where: { id: "art-1" } });
  });

  it("returns_409_when_analysis_is_running", async () => {
    mockDb.analysisRun.count.mockResolvedValue(1);

    const req = new Request("http://localhost:3000/api/articles/art-1", {
      method: "DELETE",
    });
    const res = await DELETE(req, makeParams("art-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/analysis is running/i);
  });
});
