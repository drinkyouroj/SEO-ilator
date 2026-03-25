import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL environment variable is required. " +
        "Copy .env.example to .env.local and configure it."
      );
    }
    const pool = new Pool({ connectionString: url });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = new PrismaPg(pool as any);
    globalForPrisma.prisma = new PrismaClient({ adapter });
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
        async $allOperations({ operation, args, query }: { operation: string; args: any; query: (args: any) => Promise<any> }) {
          // Ensure args exists
          if (!args) args = {};

          // Operations that MUST NOT get a where clause injected
          const isCreate = operation === "create" || operation === "createMany" || operation === "createManyAndReturn";

          if (isCreate) {
            // For single-record create: inject projectId into data only
            if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
              args.data.projectId = projectId;
            }
            // For createMany: inject projectId into each record
            if (Array.isArray(args.data)) {
              for (const record of args.data) {
                if (typeof record === "object" && record !== null) {
                  record.projectId = projectId;
                }
              }
            }
            // Explicitly remove where if somehow present (defensive)
            delete args.where;
            return query(args);
          }

          // All other operations: inject where clause
          if (!args.where) args.where = {};
          if (typeof args.where === "object") {
            args.where.projectId = projectId;
          }

          return query(args);
        },
      },
    ])
  );

  return prisma.$extends({ query: queryExtension });
}
