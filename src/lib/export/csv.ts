import { stringify } from "csv-stringify/sync";
import { sanitizeCell } from "./sanitize";

const COLUMNS = [
  "source_title",
  "source_url",
  "anchor_text",
  "target_title",
  "target_url",
  "severity",
  "confidence",
  "matching_approach",
  "status",
  "recommendation_id",
];

export interface CsvRecommendationRow {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  anchorText: string | null;
  targetTitle: string;
  targetUrl: string;
  severity: string;
  confidence: number;
  matchingApproach: string | null;
  status: string;
}

export function serializeCsv(rows: CsvRecommendationRow[]): string {
  const data = rows.map((r) => [
    sanitizeCell(r.sourceTitle),
    sanitizeCell(r.sourceUrl),
    sanitizeCell(r.anchorText ?? ""),
    sanitizeCell(r.targetTitle),
    sanitizeCell(r.targetUrl),
    r.severity,
    r.confidence.toString(),
    r.matchingApproach ?? "",
    r.status,
    r.id,
  ]);

  const csv = stringify([COLUMNS, ...data]);
  return "\uFEFF" + csv; // UTF-8 BOM for Excel compatibility
}
