export interface ReAnalysisScope {
  newArticleIds: string[];
  changedArticleIds: string[];
  preservedRecIds: string[];
  articlesToAnalyze: string[];
}

interface ArticleHashable {
  id: string;
  bodyHash: string;
  titleHash: string;
}

interface ExistingRec {
  id?: string;
  sourceArticleId: string;
  targetArticleId: string;
  strategyId: string;
  status: string;
}

/**
 * Compute which articles need re-analysis and which recommendations to preserve.
 * [AAP-B4] Previous-run pending recs will be superseded when new recs are saved.
 * Accepted recs are always preserved. Dismissed recs are preserved only if content unchanged.
 */
export function computeReAnalysisScope(
  articles: ArticleHashable[],
  lastRunArticleIds: Set<string>,
  lastRunHashes: Map<string, { bodyHash: string; titleHash: string }>,
  existingRecs: ExistingRec[]
): ReAnalysisScope {
  const newArticleIds: string[] = [];
  const changedArticleIds: string[] = [];
  const unchangedIds = new Set<string>();

  for (const article of articles) {
    if (!lastRunArticleIds.has(article.id)) {
      newArticleIds.push(article.id);
    } else {
      const prev = lastRunHashes.get(article.id);
      if (prev && (prev.bodyHash !== article.bodyHash || prev.titleHash !== article.titleHash)) {
        changedArticleIds.push(article.id);
      } else {
        unchangedIds.add(article.id);
      }
    }
  }

  const preservedRecIds: string[] = [];
  for (const rec of existingRecs) {
    if (rec.status === "accepted") {
      if (rec.id) preservedRecIds.push(rec.id);
    } else if (rec.status === "dismissed") {
      if (unchangedIds.has(rec.sourceArticleId)) {
        if (rec.id) preservedRecIds.push(rec.id);
      }
    }
  }

  return {
    newArticleIds,
    changedArticleIds,
    preservedRecIds,
    articlesToAnalyze: [...newArticleIds, ...changedArticleIds],
  };
}
