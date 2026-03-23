import { prisma } from "@/lib/db";

type PlanAction = "analyze" | "analyze_semantic" | "api_access";

interface PlanCheckResult {
  allowed: boolean;
  message?: string;
}

/**
 * Check whether the given project's owner can perform the requested action
 * under their current plan. Returns { allowed: true } if permitted, or
 * { allowed: false, message: "..." } with a user-friendly explanation.
 *
 * Plan tiers:
 * - free:       max 3 runs/month, max 50 articles, keyword matching only, no API access
 * - pro:        unlimited runs, 2000 articles, both matching approaches, full API
 * - enterprise: same as pro (future expansion)
 */
export async function checkPlanLimits(
  projectId: string,
  action: PlanAction
): Promise<PlanCheckResult> {
  // Look up the project to find the owning user
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    return { allowed: false, message: "Project not found." };
  }

  const user = await prisma.user.findUnique({
    where: { id: project.userId },
  });

  if (!user) {
    return { allowed: false, message: "User not found." };
  }

  const { plan, runLimit } = user;

  // Pro and enterprise tiers have no restrictions on these actions
  if (plan === "pro" || plan === "enterprise") {
    return { allowed: true };
  }

  // ── Free tier restrictions ──

  // Free tier cannot use semantic matching
  if (action === "analyze_semantic") {
    return {
      allowed: false,
      message:
        "Semantic matching is available on the Pro plan. Upgrade to Pro to unlock semantic similarity analysis and find crosslink opportunities that keyword matching alone would miss.",
    };
  }

  // Free tier cannot use API access
  if (action === "api_access") {
    return {
      allowed: false,
      message:
        "API access is available on the Pro plan. Upgrade to Pro to push articles via the API and integrate SEO-ilator into your publishing workflow.",
    };
  }

  // Free tier: check monthly run limit
  if (action === "analyze") {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const runsThisMonth = await prisma.analysisRun.count({
      where: {
        projectId,
        createdAt: { gte: startOfMonth },
      },
    });

    if (runsThisMonth >= runLimit) {
      return {
        allowed: false,
        message: `You've reached your monthly limit of ${runLimit} analysis runs on the Free plan. Upgrade to Pro for unlimited analysis runs and access to semantic matching.`,
      };
    }

    return { allowed: true };
  }

  return { allowed: true };
}
