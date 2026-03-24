import type { StrategyRecommendation } from "@/lib/strategies/types";

const DUAL_MATCH_BOOST = 0.15;
const SEVERITY_ORDER: Record<string, number> = { critical: 3, warning: 2, info: 1 };

interface DedupOptions {
  maxNewLinksPerPage?: number;
}

export function dedupAndRank(
  recs: StrategyRecommendation[],
  options: DedupOptions = {}
): StrategyRecommendation[] {
  const { maxNewLinksPerPage = 10 } = options;

  // Group by source+target pair
  const grouped = new Map<string, StrategyRecommendation[]>();
  for (const rec of recs) {
    const key = `${rec.sourceArticleId}:${rec.targetArticleId}`;
    const group = grouped.get(key) ?? [];
    group.push(rec);
    grouped.set(key, group);
  }

  // Merge groups
  const merged: StrategyRecommendation[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    const hasKeyword = group.some((r) => r.matchingApproach === "keyword");
    const hasSemantic = group.some((r) => r.matchingApproach === "semantic");
    const maxConfidence = Math.max(...group.map((r) => r.confidence));
    const bestSeverity = group.reduce((best, r) =>
      (SEVERITY_ORDER[r.severity] ?? 0) > (SEVERITY_ORDER[best.severity] ?? 0) ? r : best
    );
    const boostedConfidence =
      hasKeyword && hasSemantic
        ? Math.min(maxConfidence + DUAL_MATCH_BOOST, 1.0)
        : maxConfidence;
    merged.push({
      ...bestSeverity,
      confidence: boostedConfidence,
      matchingApproach: hasKeyword && hasSemantic ? "both" : bestSeverity.matchingApproach,
    });
  }

  // Sort: severity desc, then confidence desc
  merged.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  // Group by source and apply per-page cap
  const bySource = new Map<string, StrategyRecommendation[]>();
  for (const rec of merged) {
    const group = bySource.get(rec.sourceArticleId) ?? [];
    group.push(rec);
    bySource.set(rec.sourceArticleId, group);
  }

  const capped: StrategyRecommendation[] = [];
  for (const group of bySource.values()) {
    capped.push(...group.slice(0, maxNewLinksPerPage));
  }

  capped.sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.confidence - a.confidence;
  });

  return capped;
}
