# Product Requirements Document — SEO-ilator

**Version:** 1.0
**Date:** 2026-03-23
**Status:** Draft
**Author:** Justin Hearn

---

## 1. Overview

SEO-ilator is a SaaS product that analyzes a user's article index and recommends internal crosslinks to improve SEO. Users provide a set of URLs (via sitemap, URL list, file upload, or API), and the engine identifies where articles should link to each other — both for new content and for existing pages that could benefit from updated links as the index grows.

The product is built on an extensible strategy registry, so crosslinking is the first capability shipped, with meta tag optimization, keyword density analysis, and content quality scoring planned for future releases.

---

## 2. Problem Statement

Internal crosslinking is one of the highest-leverage SEO tactics available, but it's tedious to maintain by hand. As content libraries grow, older articles miss opportunities to link to newer, relevant pages. Content creators and SEO professionals face three specific pain points:

**Discovery is manual.** Finding which articles should link to each other requires reading every page and maintaining a mental model of the entire content library. This doesn't scale past a few dozen articles.

**Links go stale.** When new articles are published, existing pages don't automatically benefit. The most valuable crosslinks — from high-authority older pages to newer content — are the ones most commonly missed.

**Recommendations are generic.** Existing SEO tools flag "add more internal links" without telling you which specific phrases should link to which specific pages.

SEO-ilator solves all three by ingesting the full article index, analyzing content with keyword matching and semantic similarity, and producing specific, actionable crosslink recommendations: this phrase in this article should link to that page.

---

## 3. Target Users

SEO-ilator serves three user segments with a single product surface. The MVP prioritizes solo creators, with features that naturally scale up to teams.

**Solo content creators** — Bloggers, newsletter writers, and indie publishers managing their own sites. Typically 10–200 articles. They want quick, specific recommendations without needing to understand SEO theory. They will use sitemap ingestion and the web dashboard.

**SEO professionals** — Agency or in-house specialists managing client or company sites. Typically 100–2,000 articles across multiple domains. They want batch analysis, exportable reports, and the ability to re-run analysis as content changes. They will use the API and dashboard.

**Content teams** — Marketing departments at companies with large content libraries (500+ articles). They want a shared dashboard where multiple team members can review, accept, or dismiss recommendations. They care about integration with their CMS and publishing workflow.

---

## 4. MVP Scope (v1.0)

### 4.1 In Scope

**Crosslink recommendation engine** — The core product. Analyzes an article index and returns specific crosslink recommendations: source article, anchor text, target URL, and severity (info, warning, critical).

**Two matching approaches (configurable per run):**

- *Keyword/phrase matching* — Identifies anchor text candidates in article body text that match keywords or titles of other articles. Supports exact and fuzzy string matching.
- *Semantic similarity* — Generates embeddings for article content and identifies semantically related articles that would benefit from crosslinks, even without keyword overlap.

Both approaches can be enabled simultaneously. Results are merged and deduplicated.

**Re-analysis for updated indexes** — When new articles are added to the index, users can trigger a re-analysis that checks all existing articles against the updated index. This surfaces new crosslink opportunities from older pages to newer content, and identifies outdated recommendations that are no longer relevant.

**Three ingestion methods:**

- *Sitemap / URL list* — Provide a sitemap.xml URL or a flat list of URLs. The crawler fetches and parses each page.
- *Local file upload* — Upload HTML/markdown files or a JSON manifest of article metadata.
- *API push* — External services push article data via POST endpoint.

**Web dashboard** — Browse articles, view crosslink recommendations grouped by article, accept or dismiss individual recommendations. Filter by severity. See analysis run history.

**REST API** — Programmatic access to all functionality: article ingestion, analysis triggers, recommendation retrieval and management.

### 4.2 Out of Scope (Future Releases)

These are planned for v1.1+ and the strategy registry is designed to accommodate them, but they will not ship in v1.0:

- Meta tag optimization strategy
- Keyword density analysis strategy
- Content quality scoring strategy
- Auto-analysis on ingestion (v1.0 is manual trigger only)
- CMS integrations (WordPress, Ghost, etc.)
- Multi-user team workspaces with role-based access
- One-click link insertion (applying recommendations directly to source HTML)
- Scheduled recurring analysis runs
- White-label / agency reporting

---

## 5. User Stories

### 5.1 Ingestion

**US-1: Ingest via sitemap.** As a user, I can provide a sitemap.xml URL so that SEO-ilator crawls and indexes all my articles automatically.

**US-2: Ingest via URL list.** As a user, I can paste a list of URLs so that SEO-ilator fetches and indexes specific pages I choose.

**US-3: Ingest via file upload.** As a user, I can upload HTML, markdown, or a JSON manifest so that SEO-ilator indexes content that isn't publicly accessible.

**US-4: Ingest via API.** As a developer, I can push article data via a POST endpoint so that my CMS or build pipeline can keep the index current.

**US-5: View indexed articles.** As a user, I can see all articles in my index with their title, URL, word count, and last-analyzed date.

### 5.2 Analysis

**US-6: Run crosslink analysis.** As a user, I can trigger an analysis run on my article index and choose which matching approach(es) to use (keyword, semantic, or both).

**US-7: Re-analyze after adding content.** As a user, I can add new articles to my index and then trigger a re-analysis so that existing articles are checked for new crosslink opportunities to the newly added content.

**US-8: View analysis history.** As a user, I can see a history of past analysis runs with their date, article count, strategy configuration, and number of recommendations generated.

### 5.3 Recommendations

**US-9: View recommendations by article.** As a user, I can view all crosslink recommendations for a specific article, showing the suggested anchor text, target URL, and severity.

**US-10: Accept a recommendation.** As a user, I can mark a recommendation as accepted so that I can track which suggestions I've acted on.

**US-11: Dismiss a recommendation.** As a user, I can dismiss a recommendation I don't want to implement, with an optional reason, so that it doesn't clutter my review.

**US-12: Filter recommendations.** As a user, I can filter recommendations by severity (info, warning, critical) and status (pending, accepted, dismissed) to focus on what matters most.

**US-13: Bulk actions.** As a user, I can select multiple recommendations and accept or dismiss them in bulk to speed up review of large analysis results.

### 5.4 Configuration

**US-14: Configure matching thresholds.** As a user, I can adjust the similarity threshold for semantic matching and the fuzziness level for keyword matching to control recommendation sensitivity.

**US-15: Set max links per page.** As a user, I can set a maximum number of crosslinks recommended per article so that the engine doesn't over-optimize.

---

## 6. Information Architecture

### 6.1 Dashboard Pages

**Articles index** (`/dashboard/articles`) — Table of all indexed articles. Columns: title, URL, word count, last analyzed, recommendation count. Actions: view details, remove from index.

**Article detail** (`/dashboard/articles/[id]`) — Full article metadata, body preview, and all recommendations for this article. Each recommendation shows anchor text, target article, severity, and accept/dismiss buttons.

**Analysis runs** (`/dashboard/runs`) — History of analysis runs. Each row shows: timestamp, article count, strategies used, recommendation count, status (running, completed, failed).

**New analysis** (`/dashboard/analyze`) — Form to configure and trigger an analysis run. Select matching approaches, set thresholds, choose which articles to include (all or a subset).

**Ingestion** (`/dashboard/ingest`) — Form to add articles via sitemap URL, URL list, or file upload. Shows ingestion progress and any parsing errors.

**Settings** (`/dashboard/settings`) — Strategy configuration: similarity thresholds, max links per page, default matching approach. Account and billing settings (v1.0: placeholder).

### 6.2 API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/articles` | Ingest articles (URL list, file upload, or direct push) |
| GET | `/api/articles` | List all indexed articles |
| GET | `/api/articles/[id]` | Get article detail |
| DELETE | `/api/articles/[id]` | Remove article from index |
| POST | `/api/analyze` | Trigger a new analysis run |
| GET | `/api/runs` | List analysis runs |
| GET | `/api/runs/[id]` | Get run detail with recommendations |
| GET | `/api/recommendations` | List recommendations (filterable) |
| PATCH | `/api/recommendations/[id]` | Update recommendation status (accept/dismiss) |
| PATCH | `/api/recommendations/bulk` | Bulk update recommendation statuses |
| GET | `/api/settings` | Get strategy configuration |
| PUT | `/api/settings` | Update strategy configuration |

---

## 7. Crosslink Recommendation Logic

### 7.1 Keyword/Phrase Matching

For each article in the index, the engine scans the body text for phrases that match the title, slug, or configured keywords of other articles. Matching uses normalized text (lowercased, stripped of special characters) with configurable fuzzy tolerance.

A recommendation is generated when: a phrase in article A matches a keyword or title of article B, article A does not already link to article B, and article A ≠ article B.

Severity assignment: "critical" if the match is exact and the articles share a topic cluster; "warning" if the match is fuzzy or partial; "info" if the match is weak but potentially useful.

### 7.2 Semantic Similarity

Article body text is chunked and embedded via a configurable provider (OpenAI, Cohere, or other). For each article, the engine computes cosine similarity against all other articles in the index.

A recommendation is generated when: similarity exceeds the configured threshold (default: 0.75), the articles are not already linked, and no keyword-match recommendation already covers the same pair.

The suggested anchor text is derived from the most similar text chunk in the source article relative to the target article.

### 7.3 Deduplication and Ranking

When both approaches are enabled, results are merged. If both approaches recommend linking article A to article B, the recommendation is kept once with the higher severity and a note that both approaches agree (boosting confidence). Final results are ranked by severity descending, then by similarity score descending.

### 7.4 Re-Analysis Behavior

When a user triggers re-analysis after adding new articles: previously accepted recommendations are preserved and not re-generated. Previously dismissed recommendations are not re-generated unless the underlying content has changed. New recommendations are generated for all article pairs involving at least one newly added article, plus any existing pairs where article content has been updated since the last run.

---

## 8. Data Model

### 8.1 Core Entities

**Article** — Represents a single indexed page. Fields: id, url, title, body (full text), bodyHash (for change detection), wordCount, metadata (JSON), embedding (vector), createdAt, updatedAt.

**AnalysisRun** — Represents a single analysis execution. Fields: id, status (pending, running, completed, failed), strategiesUsed (JSON array), articleCount, recommendationCount, configuration (JSON — thresholds, matching approaches), startedAt, completedAt, error (nullable).

**Recommendation** — A single crosslink suggestion. Fields: id, analysisRunId, strategyId, sourceArticleId, targetArticleId, type, severity, title, description, anchorText, confidence, status (pending, accepted, dismissed), dismissReason (nullable), createdAt, updatedAt.

**StrategyConfig** — Persisted configuration for each strategy. Fields: id, strategyId, settings (JSON), updatedAt.

### 8.2 Key Relationships

- An AnalysisRun has many Recommendations.
- A Recommendation belongs to one source Article and one target Article.
- Recommendation status is independent of the AnalysisRun — users update it after the run completes.

---

## 9. Pricing Model

SEO-ilator uses usage-based pricing charged per analysis run.

**Free tier** — Up to 3 analysis runs per month, max 50 articles per run. Single matching approach per run (keyword or semantic, not both). Dashboard access included.

**Pro tier** — Unlimited analysis runs, up to 2,000 articles per run. Both matching approaches. Full API access. Priority crawling. Exportable reports.

**Enterprise** — Custom article limits, dedicated support, SLA, SSO, team workspaces (when available).

Analysis runs are the billing unit because they represent the core value delivered and scale naturally with usage. Ingesting articles is free — users only pay when they analyze.

---

## 10. Non-Functional Requirements

For v1.0, the emphasis is on correctness and usability over extreme scale. Optimization will follow once real usage patterns emerge.

**Reliability** — Analysis runs must complete or fail cleanly; no silent partial results. If a run fails mid-analysis, the status is set to "failed" with an error message, and no partial recommendations are saved.

**Data integrity** — Article ingestion is idempotent by URL. Re-ingesting the same URL updates the existing record rather than creating a duplicate. Recommendations reference articles by foreign key; deleting an article cascades to its recommendations.

**Security** — API endpoints require authentication. Users can only access their own articles and recommendations. Embedding API keys are stored server-side and never exposed to the client.

**Observability** — Analysis runs log start time, completion time, article count, and recommendation count. Errors during crawling or embedding are captured per-article and surfaced in the run detail.

---

## 11. Technical Architecture

Refer to [docs/architecture.md](./architecture.md) and [CLAUDE.md](../CLAUDE.md) for the full technical specification. Summary:

**Stack:** TypeScript, Next.js (App Router), Prisma ORM, PostgreSQL.
**Hosting:** Vercel (application), Railway (database).
**Extensibility:** Strategy registry pattern — all SEO strategies implement a standard `SEOStrategy` interface and register with a central `StrategyRegistry`.
**Embedding providers:** Abstracted behind a provider interface. OpenAI and Cohere supported at launch; swappable via environment config.

---

## 12. Success Metrics

**Adoption (first 90 days post-launch):**

- 100+ registered users with at least one completed analysis run
- 20+ users completing 3 or more runs (retained past free tier exploration)

**Product quality:**

- Recommendation acceptance rate > 40% (users find the suggestions useful)
- Recommendation dismissal-without-reason rate < 30% (suggestions aren't obviously wrong)
- Analysis run failure rate < 2%

**Engagement:**

- Average time from signup to first completed analysis run < 10 minutes
- 30%+ of users who add new articles trigger a re-analysis within 7 days

---

## 13. Open Questions

1. **Embedding cost management** — Semantic similarity requires embedding every article. For large indexes, this has meaningful API cost. Should we cache embeddings aggressively and only re-embed on content change? (Likely yes — bodyHash field supports this.)

2. **Rate limiting for crawling** — When ingesting via sitemap, how aggressively should we crawl? Need to respect robots.txt and avoid overwhelming user's servers. Needs a DECISION doc before implementation.

3. **Export format** — Users will want to export recommendations. What format? CSV? PDF report? Markdown? Defer to user research post-launch.

4. **Authentication provider** — Auth is required for multi-tenant SaaS but the specific provider (NextAuth, Clerk, Auth0) hasn't been decided. Needs a DECISION doc.

5. **One-click link insertion** — The highest-value future feature. Requires understanding the user's CMS and having write access. Complex enough to warrant its own PRD when the time comes.

---

## 14. Release Plan

### v1.0 — Crosslink Engine (MVP)

- Article ingestion (sitemap, URL list, file upload, API)
- Crosslink strategy with keyword + semantic matching
- Re-analysis for updated indexes
- Web dashboard (articles, recommendations, runs, settings)
- REST API
- Usage-based billing (free tier + Pro)

### v1.1 — Meta Tag Optimization

- Meta tag strategy plugin
- Dashboard support for meta tag recommendations
- Combined analysis runs (crosslinks + meta tags)

### v1.2 — Keyword Density + Content Quality

- Keyword density strategy plugin
- Content quality scoring strategy plugin
- Unified recommendation feed across all strategies

### v2.0 — Team & Integration

- Multi-user team workspaces
- Role-based access control
- CMS integrations (WordPress, Ghost)
- Scheduled recurring analysis runs
- One-click link insertion (if feasibility confirmed)
