import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Returns a where clause fragment scoped to the given project.
 * Every tenant-data query MUST use this.
 */
export function withProject(projectId: string) {
  return { projectId };
}

// [AAP-B5] Tenant-scoped Prisma extension. Use scopedPrisma(projectId) for all
// tenant-data queries. This automatically injects projectId into where clauses
// on tenant-scoped models, preventing accidental cross-tenant data leaks.
//
// Scoped models: article, analysisRun, recommendation, strategyConfig,
// ingestionJob, ingestionTask. Auth models (User, Account, Session,
// VerificationToken) and Project itself are NOT scoped — they are
// accessed via userId or are global.
const TENANT_SCOPED_MODELS = [
  "article",
  "analysisRun",
  "recommendation",
  "strategyConfig",
  "ingestionJob",
  "ingestionTask",
] as const;

export function scopedPrisma(projectId: string) {
  return prisma.$extends({
    query: {
      ...Object.fromEntries(
        TENANT_SCOPED_MODELS.map((model) => [
          model,
          {
            async $allOperations({
              args,
              query,
            }: {
              args: Record<string, unknown>;
              query: (args: Record<string, unknown>) => Promise<unknown>;
            }) {
              // For operations that have a `where` clause, inject projectId
              if (args.where && typeof args.where === "object") {
                (args.where as Record<string, unknown>).projectId = projectId;
              }

              // For create operations, inject projectId into data
              if (args.data && typeof args.data === "object") {
                (args.data as Record<string, unknown>).projectId = projectId;
              }

              // For createMany, inject projectId into each record
              if (args.data && Array.isArray(args.data)) {
                for (const record of args.data) {
                  if (typeof record === "object" && record !== null) {
                    (record as Record<string, unknown>).projectId = projectId;
                  }
                }
              }

              return query(args);
            },
          },
        ])
      ),
    },
  });
}
