import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }
  return globalForPrisma.prisma;
}

// Lazy proxy: PrismaClient is only constructed on first property access,
// not at module import time. This prevents build-time initialization errors.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return Reflect.get(getPrismaClient(), prop);
  },
});

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryExtension: any = Object.fromEntries(
    TENANT_SCOPED_MODELS.map((model) => [
      model,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ args, query }: { args: any; query: (args: any) => Promise<any> }) {
          if (args.where && typeof args.where === "object") {
            args.where.projectId = projectId;
          }
          if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
            args.data.projectId = projectId;
          }
          if (Array.isArray(args.data)) {
            for (const record of args.data) {
              if (typeof record === "object" && record !== null) {
                record.projectId = projectId;
              }
            }
          }
          return query(args);
        },
      },
    ])
  );

  return prisma.$extends({ query: queryExtension });
}
