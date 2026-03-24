import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// ── User ──

type UserOverrides = Partial<{
  id: string;
  name: string;
  email: string;
  plan: string;
  articleLimit: number;
  runLimit: number;
}>;

export async function createTestUser(
  prisma: PrismaClient,
  overrides: UserOverrides = {},
) {
  const uid = nextId();
  return prisma.user.create({
    data: {
      name: overrides.name ?? `Test User ${uid}`,
      email: overrides.email ?? `test-${uid}@example.com`,
      plan: overrides.plan ?? "free",
      articleLimit: overrides.articleLimit ?? 50,
      runLimit: overrides.runLimit ?? 3,
      ...(overrides.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Project ──

type ProjectOverrides = Partial<{
  id: string;
  userId: string;
  name: string;
}>;

export async function createTestProject(
  prisma: PrismaClient,
  overrides: ProjectOverrides = {},
) {
  const userId =
    overrides.userId ?? (await createTestUser(prisma)).id;

  return prisma.project.create({
    data: {
      name: overrides.name ?? `Test Project ${nextId()}`,
      userId,
      ...(overrides.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Article ──

type ArticleOverrides = Partial<{
  id: string;
  projectId: string;
  url: string;
  title: string;
  body: string;
  bodyHash: string;
  titleHash: string;
  wordCount: number;
  metadata: unknown;
  sourceType: string;
  httpStatus: number;
  existingLinks: unknown;
  parseWarning: string;
  embeddingModel: string;
}>;

export async function createTestArticle(
  prisma: PrismaClient,
  overrides: ArticleOverrides = {},
) {
  const projectId =
    overrides.projectId ?? (await createTestProject(prisma)).id;

  const uid = nextId();
  const title = overrides.title ?? `Test Article ${uid}`;
  const body =
    overrides.body ?? `This is the body of test article ${uid}.`;

  return prisma.article.create({
    data: {
      projectId,
      url: overrides.url ?? `https://example.com/article-${uid}`,
      title,
      body,
      bodyHash: overrides.bodyHash ?? hash(body),
      titleHash: overrides.titleHash ?? hash(title),
      wordCount: overrides.wordCount ?? body.split(/\s+/).length,
      metadata: overrides.metadata ?? undefined,
      sourceType: overrides.sourceType ?? "test",
      httpStatus: overrides.httpStatus ?? 200,
      existingLinks: overrides.existingLinks ?? undefined,
      parseWarning: overrides.parseWarning ?? undefined,
      embeddingModel: overrides.embeddingModel ?? undefined,
      ...(overrides.id ? { id: overrides.id } : {}),
    },
  });
}

// ── AnalysisRun ──

type AnalysisRunOverrides = Partial<{
  id: string;
  projectId: string;
  status: string;
  strategiesUsed: unknown;
  configuration: unknown;
  articleCount: number;
  recommendationCount: number;
  embeddingsCached: number;
  embeddingsGenerated: number;
  error: string;
  startedAt: Date;
  completedAt: Date;
}>;

export async function createTestAnalysisRun(
  prisma: PrismaClient,
  overrides: AnalysisRunOverrides = {},
) {
  const projectId =
    overrides.projectId ?? (await createTestProject(prisma)).id;

  return prisma.analysisRun.create({
    data: {
      projectId,
      status: overrides.status ?? "completed",
      strategiesUsed: overrides.strategiesUsed ?? ["crosslink"],
      configuration: overrides.configuration ?? {},
      articleCount: overrides.articleCount ?? 0,
      recommendationCount: overrides.recommendationCount ?? 0,
      embeddingsCached: overrides.embeddingsCached ?? 0,
      embeddingsGenerated: overrides.embeddingsGenerated ?? 0,
      error: overrides.error ?? undefined,
      startedAt: overrides.startedAt ?? new Date(),
      completedAt: overrides.completedAt ?? new Date(),
      ...(overrides.id ? { id: overrides.id } : {}),
    },
  });
}

// ── Recommendation ──

type RecommendationOverrides = Partial<{
  id: string;
  projectId: string;
  analysisRunId: string;
  strategyId: string;
  sourceArticleId: string;
  targetArticleId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  anchorText: string;
  confidence: number;
  matchingApproach: string;
  status: string;
  dismissReason: string;
  sourceContext: string;
  charOffsetStart: number;
  charOffsetEnd: number;
  suggestion: unknown;
}>;

export async function createTestRecommendation(
  prisma: PrismaClient,
  overrides: RecommendationOverrides = {},
) {
  // Ensure we have a project
  const projectId =
    overrides.projectId ?? (await createTestProject(prisma)).id;

  // Ensure we have an analysis run
  const analysisRunId =
    overrides.analysisRunId ??
    (await createTestAnalysisRun(prisma, { projectId })).id;

  // Ensure we have source and target articles
  const sourceArticleId =
    overrides.sourceArticleId ??
    (await createTestArticle(prisma, { projectId })).id;

  const targetArticleId =
    overrides.targetArticleId ??
    (await createTestArticle(prisma, { projectId })).id;

  const uid = nextId();

  return prisma.recommendation.create({
    data: {
      projectId,
      analysisRunId,
      strategyId: overrides.strategyId ?? "crosslink",
      sourceArticleId,
      targetArticleId,
      type: overrides.type ?? "crosslink",
      severity: overrides.severity ?? "info",
      title: overrides.title ?? `Recommendation ${uid}`,
      description:
        overrides.description ?? `Test recommendation description ${uid}`,
      anchorText: overrides.anchorText ?? undefined,
      confidence: overrides.confidence ?? 0.85,
      matchingApproach: overrides.matchingApproach ?? "keyword",
      status: overrides.status ?? "pending",
      dismissReason: overrides.dismissReason ?? undefined,
      sourceContext: overrides.sourceContext ?? undefined,
      charOffsetStart: overrides.charOffsetStart ?? undefined,
      charOffsetEnd: overrides.charOffsetEnd ?? undefined,
      suggestion: overrides.suggestion ?? undefined,
      ...(overrides.id ? { id: overrides.id } : {}),
    },
  });
}
