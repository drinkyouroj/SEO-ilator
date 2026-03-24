import { describe, it, expect } from "vitest";
import { serializeCsv } from "@/lib/export/csv";

interface MockRec {
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

describe("serializeCsv", () => {
  const makeRec = (overrides?: Partial<MockRec>): MockRec => ({
    id: "rec-1",
    sourceTitle: "Source Article",
    sourceUrl: "https://example.com/source",
    anchorText: "link text",
    targetTitle: "Target Article",
    targetUrl: "https://example.com/target",
    severity: "warning",
    confidence: 0.85,
    matchingApproach: "keyword",
    status: "pending",
    ...overrides,
  });

  it("outputs_correct_column_order", () => {
    const csv = serializeCsv([makeRec()]);
    const lines = csv.split("\n");
    const header = lines[0].replace("\uFEFF", "");
    expect(header).toBe(
      "source_title,source_url,anchor_text,target_title,target_url,severity,confidence,matching_approach,status,recommendation_id"
    );
  });

  it("escapes_commas_and_quotes_in_titles", () => {
    const csv = serializeCsv([makeRec({ sourceTitle: 'Title with "quotes" and, commas' })]);
    const lines = csv.split("\n");
    expect(lines[1]).toContain('"Title with ""quotes"" and, commas"');
  });

  it("includes_utf8_bom_prefix", () => {
    const csv = serializeCsv([makeRec()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("handles_empty_result_set", () => {
    const csv = serializeCsv([]);
    const lines = csv.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1); // Header only
  });
});
