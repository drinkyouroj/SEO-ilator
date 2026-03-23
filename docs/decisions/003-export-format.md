# DECISION: Export Format

**Date:** 2026-03-23
**Status:** Accepted

## Context

Users need to export crosslink recommendations for implementation, client reporting, and integration with other tools. The PRD (Section 13, Question 3) defers the format decision to user research. The team's input, particularly from the Client Success advocate and the SEO Expert, provides sufficient domain knowledge to make this decision now. The export format affects adoption among the SEO professional segment (the highest-paying tier) and determines whether recommendations actually get implemented.

## Options Considered

1. **CSV only** -- Pros: universally importable (Excel, Sheets, Airtable, any data pipeline); trivial server-side generation; no external dependencies; works within Vercel serverless constraints. Cons: not presentation-ready for client-facing reports.

2. **CSV + JSON** -- Same as Option 1 plus a structured JSON download for API/developer consumers. Pros: serves both spreadsheet users and programmatic consumers. Cons: JSON is already available via the API, so the standalone export is convenience only.

3. **CSV + JSON + PDF** -- Adds a styled PDF report. Pros: serves the agency "client report" use case; differentiates SEO-ilator from competitors. Cons: PDF generation requires a rendering library (Puppeteer: 50+ MB bundle, exceeds Vercel's limit; `@react-pdf/renderer` or `pdfmake`: lighter but still meaningful complexity); must be async for large reports; adds maintenance burden for report layout/branding.

4. **CSV + JSON + Markdown** -- Adds Markdown table export. Pros: useful for pasting into Slack, Notion, and developer-oriented tools. Cons: niche audience; anyone can convert CSV to Markdown trivially.

## Decision

**Option 2 for v1.0 (CSV + JSON). Add PDF as a Pro-tier feature in v1.1. Consider Markdown copy-to-clipboard as a low-effort addition if time permits.**

All six specialists agreed on CSV as the primary format. The SEO Expert's analysis of competing tools is instructive: "Screaming Frog exports to CSV and Excel -- this is considered sufficient by 90% of users." The Client Success advocate distinguished the use cases precisely: "CSV is what [SEO professionals] use internally. A PDF report is what they send to the client -- the billable artifact that justifies the retainer."

The Backend Engineer's pragmatic framing seals the v1.0 scope: "a bad PDF is worse than no PDF." PDF generation adds meaningful complexity with serverless constraints, and a rushed implementation would hurt the product's professional image. Deferring PDF to v1.1 lets us design a proper report template alongside the agency/team features.

### CSV export specification

**Endpoint:** `GET /api/recommendations?format=csv`

Add a `format` query parameter to the existing recommendations endpoint. When `format=csv`, return `Content-Type: text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="seo-ilator-recommendations-{runId}-{date}.csv"`.

**Columns (ordered by actionability, per the Frontend Engineer's recommendation):**

| Column | Description |
|--------|-------------|
| source_title | Title of the article containing the recommendation |
| source_url | URL of the source article |
| anchor_text | Suggested anchor text for the link |
| target_title | Title of the target article to link to |
| target_url | URL of the target article |
| severity | critical / warning / info |
| confidence | 0.0 - 1.0 score |
| matching_approach | keyword / semantic / both |
| status | pending / accepted / dismissed |
| recommendation_id | Unique ID for API reference |

Per the SEO Expert: this column set matches what users need to "filter by article, sort by severity, and work through the list."

**Encoding:** UTF-8 with BOM (byte order mark) for Excel compatibility, per the Backend Engineer's warning about encoding pitfalls.

**Escaping:** Use a well-tested CSV library (e.g., `csv-stringify` or `papaparse`). Do not hand-roll string concatenation. Properly escape commas, quotes, and newlines in article titles and anchor text.

**Formula injection prevention:** Per the DBA's note, prefix cell values starting with `=`, `+`, `-`, or `@` with a single quote to prevent spreadsheet formula injection.

**Filter support:** The export respects current query filters (severity, status, analysisRunId). Users can export "critical pending recommendations" rather than the full dump.

**Streaming for large exports:** For Pro tier analyses that may produce 10,000+ recommendations, stream the CSV response rather than buffering in memory. Next.js App Router supports streaming responses natively.

### JSON export specification

**Endpoint:** `GET /api/recommendations?format=json` (this is already the default API response format).

Add a `Content-Disposition: attachment; filename="seo-ilator-recommendations-{runId}-{date}.json"` header when the `download=true` query parameter is present, to trigger a file download from the dashboard.

### PDF (deferred to v1.1)

Per the Client Success advocate's specification, the PDF should include: a summary page (total articles analyzed, recommendations by severity, top opportunities), per-article recommendation details, and optionally a visual internal link graph. Per the DevOps engineer's recommendation, generate PDFs as background jobs and store in Vercel Blob Storage or S3, serving a download link when ready.

### Query optimization

Per the DBA's recommendation, create a composite index on `Recommendation(analysisRunId, status, severity)` to cover the export query's filter and sort pattern. The three-table join (Recommendation + source Article + target Article) should perform well with existing foreign key indexes.

## Consequences

- CSV export is available at launch for all tiers. This is table-stakes for the SEO professional segment.
- No PDF at launch. Agency users who need client reports will use CSV imported into their own report templates. This is acceptable for the first 90 days but becomes a Pro-tier retention risk if not addressed in v1.1.
- The `format` query parameter on the recommendations endpoint keeps the API surface clean -- no separate export endpoints needed.
- Formula injection prevention adds a small amount of defensive code but prevents a real security concern with user-generated content in spreadsheets.

## AAP: Export Format

### ARCHITECT

The export system adds a `format` query parameter to `GET /api/recommendations` in `src/app/api/recommendations/route.ts`. When `format=csv`, a `CsvSerializer` class (in `src/lib/export/csv.ts`) transforms the Prisma query results into a streamed CSV response. The serializer uses the `csv-stringify` npm package for proper escaping. The query uses Prisma's `findMany` with `include: { sourceArticle: true, targetArticle: true }` and respects filter parameters. For datasets over 5,000 rows, switch to cursor-based pagination piped to a `ReadableStream`. The CSV includes a UTF-8 BOM (`\uFEFF`) as the first bytes. Formula injection is handled by a `sanitizeCell()` utility that prefixes dangerous characters with a single quote.

Files: `src/app/api/recommendations/route.ts` (format handling), `src/lib/export/csv.ts` (new), `src/lib/export/json.ts` (new, for download mode), `src/lib/export/sanitize.ts` (formula injection prevention).

### ADVERSARY

**Objection 1:** Streaming CSV from a Vercel serverless function depends on the response not timing out before all rows are written. A Pro user's export of 50,000 recommendations at ~200 bytes per row is ~10 MB of CSV. At typical Vercel egress speeds this completes in seconds, but if the underlying Prisma query is slow (cold database connection, missing index), the function could timeout before streaming begins. The architect does not describe a fallback for this case -- the user gets a partial CSV file with no error indication.

**Objection 2:** The UTF-8 BOM for Excel compatibility is a Microsoft-specific workaround that breaks or confuses some non-Microsoft tools (e.g., some Python CSV readers, `cat` in terminal). It optimizes for one ecosystem at the expense of correctness for others. The SEO Expert's own summary notes that SEO professionals use Google Sheets as often as Excel, and Google Sheets handles UTF-8 without BOM correctly.

### JUDGE

**Verdict:** Accept the export design with one modification for Objection 1. Overrule Objection 2.

On Objection 1: Valid concern about partial downloads. **Modification:** Execute the count query first (`SELECT COUNT(*)`). If the result exceeds 10,000 rows, generate the CSV as a background job (write to Vercel Blob Storage) and return a download link, rather than streaming inline. For smaller exports, stream directly. This ensures large exports complete reliably.

On Objection 2: Overruled. The BOM is a 3-byte prefix that causes negligible issues in modern tools. Google Sheets ignores it silently. Python's `csv` module handles it with `encoding='utf-8-sig'`. The target audience overwhelmingly uses Excel and Google Sheets, where BOM prevents the most common user complaint ("my CSV has garbled characters"). The benefit to the majority outweighs the minor inconvenience to edge-case tooling.
