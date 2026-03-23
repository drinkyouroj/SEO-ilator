# DECISION: One-Click Link Insertion

**Date:** 2026-03-23
**Status:** Accepted

## Context

One-click link insertion is the feature that transforms SEO-ilator from a reporting tool into a workflow tool. The SEO Expert quantifies the value: "the manual workflow takes 30-60 seconds per link; for 100 recommendations, that is 1-2 hours of tedious work." The PRD (Section 4.2) correctly identifies this as out of scope for v1.0, and the Client Success advocate calls it "the headline feature of v2.0." However, architectural decisions made now in v1.0 can either enable or preclude this feature. This DECISION doc covers: (1) what to build in v1.0 to prepare, (2) the interim "copy snippet" approach, and (3) the architecture for direct CMS integration in v2.0.

## Options Considered

1. **Do nothing in v1.0, build from scratch in v2.0** -- Pros: no v1.0 effort. Cons: missing data (source context, article source type) that is cheap to capture now but requires re-analysis to backfill later; no interim solution for users.

2. **Copy-to-clipboard in v1.0, CMS connector abstraction in v2.0** -- Capture source context metadata now; ship a "copy HTML snippet" feature in v1.0 (or v1.1); build a CMS adapter interface with preview/confirm/rollback in v2.0. Pros: immediate value (reduces workflow from 6 steps to 3); architectural groundwork at near-zero cost; CMS integration builds on proven data model. Cons: copy-to-clipboard is not "one-click" and may feel incomplete.

3. **Build direct CMS write access in v1.0** -- Integrate with WordPress REST API immediately. Pros: differentiated v1.0. Cons: massive scope increase; security surface (storing OAuth tokens, write access to production sites); the DevOps engineer calls this "the highest-risk feature in the entire product"; diverts engineering from core recommendation quality.

## Decision

**Option 2: Copy-to-clipboard in v1.0 with data groundwork, CMS connector abstraction in v2.0.**

Every specialist agreed that direct CMS write access is not v1.0 work. The Backend Engineer frames it precisely: "one-click insertion means SEO-ilator writes to the user's content source -- this is fundamentally different from everything else in the product, which is read-only analysis." The Client Success advocate adds the trust dimension: "the gap between 'this is amazing' and 'this broke my article' is razor-thin."

### Phase 1: Data groundwork (v1.0)

Capture metadata during analysis that the insertion feature will need later. This adds minimal effort now and avoids a costly re-analysis backfill.

**Schema additions to `Recommendation` model:**
- `sourceContext Text?` -- The surrounding paragraph or sentence where the anchor text was found. Stored during analysis.
- `charOffsetStart Int?` -- Character offset of the anchor text start within the source article body.
- `charOffsetEnd Int?` -- Character offset of the anchor text end.

**Schema addition to `Article` model:**
- `sourceType String?` -- How this article was ingested: `"sitemap"`, `"upload"`, `"api_push"`. Tells future connector code what write path to use.

Per the Backend Engineer: "this costs nothing now but is essential for insertion later."

### Phase 2: Copy-to-clipboard (v1.0 or v1.1)

For each accepted recommendation on the article detail page (`/dashboard/articles/[id]`), show:

1. **The HTML snippet** -- `<a href="https://example.com/target">suggested anchor text</a>` with a "Copy" button.
2. **The surrounding context** -- The sentence or paragraph where the anchor text appears, with the anchor text highlighted, so the user can locate it in their CMS editor.
3. **Editable anchor text** -- Per the Frontend Engineer, let users tweak the suggested anchor text before copying. "Blocking that creates friction."

The Client Success advocate calls this "80% of the value for 20% of the complexity." The SEO Expert agrees: "this is low-effort, zero-risk, and immediately useful."

### Phase 3: CMS connector abstraction (v2.0)

**Interface definition** (in `src/lib/connectors/types.ts`):

```typescript
interface ContentConnector {
  id: string;
  name: string; // "WordPress", "Ghost", etc.
  canConnect(source: ArticleSource): boolean;
  authenticate(credentials: ConnectorCredentials): Promise<AuthResult>;
  fetchCurrentContent(articleId: string): Promise<string>;
  preview(articleId: string, recommendations: Recommendation[]): Promise<DiffResult>;
  apply(articleId: string, recommendations: Recommendation[]): Promise<ApplyResult>;
  rollback(articleId: string, insertionId: string): Promise<RollbackResult>;
}
```

Per the Backend Engineer's connector pattern: each CMS gets an implementation. The core system talks only to the interface.

**CMS priority order** (per the SEO Expert's market analysis):
1. WordPress (60%+ of target users) -- REST API with `edit_posts` scope
2. Ghost (indie publisher segment) -- Admin API with scoped integration token
3. Webflow (agency segment) -- CMS API
4. Shopify (e-commerce blogs) -- Blog API

**Interaction model** (per the Frontend Engineer's three-step design):

**Step 1 -- Preview:** Diff view showing exactly what will change. Split-pane or inline diff (like GitHub). The system fetches current content via `fetchCurrentContent()` (because the article may have changed since analysis), fuzzy-matches the anchor text in the current content, and shows the proposed link insertion in context. If the anchor text is no longer found (content changed), display a warning: "The recommended anchor text was not found in the current version of this article. Re-ingest and re-analyze to get updated recommendations."

**Step 2 -- Confirm:** Explicit confirmation dialog stating what will change. Users can edit anchor text. Per the SEO Expert, the batch flow is: select multiple recommendations, click "Apply selected," see a combined diff for all selected recommendations on the same article.

**Step 3 -- Undo:** Post-apply toast with 10-second undo (per Frontend Engineer). Persistent undo via version history.

**Batch application:** Per the Frontend Engineer, applying multiple recommendations to the same article is order-dependent (applying recommendation A may shift text positions for recommendation B). The system must batch recommendations per article and compute all insertions against the same base content, applying all at once. This avoids cascading offset errors.

### Database model for v2.0 (per DBA)

**New tables:**

- `ArticleVersion` -- `id`, `articleId` (FK), `version` (auto-incrementing per article), `bodyHtml` (full HTML snapshot), `bodyHash`, `source` (enum: `ingested` / `modified` / `rolled_back`), `createdAt`.
- `LinkInsertion` -- `id`, `recommendationId` (FK), `articleVersionId` (FK, the version created by this insertion), `previousVersionId` (FK), `insertionPoint` (character offset or DOM path), `anchorText`, `targetUrl`, `status` (enum: `applied` / `rolled_back`), `method` (enum: `local_html` / `cms_api`), `appliedAt`, `rolledBackAt`, `appliedByUserId` (FK, for audit).

Per the DBA: "records in `LinkInsertion` should never be hard-deleted" -- this is an immutable audit trail.

**Rollback strategy:** Cascade rollback (rolling back insertion N also rolls back all insertions N+1, N+2, etc. applied after it). Per the DBA, this is simpler and more reliable than selective rollback, which requires replaying all other insertions against the original content.

### Security requirements (v2.0)

Per the DevOps engineer: "if your Railway PostgreSQL is compromised, attackers get write access to every connected user's CMS." Requirements:

- OAuth tokens encrypted at rest using a key stored in Vercel environment variables (not in the database).
- Minimal API scopes per CMS (e.g., WordPress `edit_posts` only, not `edit_pages` or admin).
- Audit logging is non-negotiable: every write operation produces an immutable `LinkInsertion` record.
- Preview step is mandatory -- hard UX constraint, not a "nice to have."

### SEO safety guardrails (v2.0)

Per the SEO Expert, automated link insertion has specific SEO risks:

- **Over-optimization penalty:** Enforce `maxLinksPerPage` during insertion, not just during recommendation. If a page already has many internal links, cap insertions.
- **Anchor text over-optimization:** Warn when the same exact-match anchor text links to the same target from multiple pages.
- **HTML-aware insertion:** The insertion logic must be HTML-aware (not text-search-and-replace). Never insert links inside headings, inside existing links, inside image alt attributes, or inside code blocks.

## Consequences

- v1.0 ships with source context metadata on recommendations and a copy-to-clipboard feature. This adds minimal scope (1-2 days) while providing immediate user value.
- The `sourceType` field on Article and `sourceContext`/`charOffset` fields on Recommendation are low-cost schema additions that avoid a painful backfill when v2.0 ships.
- v2.0 CMS integration is a 3-6 month engineering effort (per Client Success estimate), requiring its own PRD, dedicated security review, and testing against real CMS APIs. The connector abstraction and data model defined here provide the architectural blueprint.
- Each CMS connector is an ongoing maintenance burden. CMS APIs change, authentication models evolve, and content storage formats differ across platforms. Budget for this.

## AAP: One-Click Link Insertion

### ARCHITECT

v1.0 adds three nullable columns to `Recommendation` (`sourceContext`, `charOffsetStart`, `charOffsetEnd`) and one to `Article` (`sourceType`). The crosslink strategy in `src/lib/strategies/crosslink.ts` populates these during analysis. A `CopySnippet` React component in `src/components/recommendations/CopySnippet.tsx` renders the HTML snippet with an editable anchor text field and a clipboard copy button using the `navigator.clipboard` API.

For v2.0, the `ContentConnector` interface lives in `src/lib/connectors/types.ts`. Each CMS adapter (e.g., `src/lib/connectors/wordpress.ts`) implements the interface. OAuth tokens are stored in a `ConnectorCredential` table (`id`, `userId`, `projectId`, `connectorId`, `encryptedToken`, `scopes`, `expiresAt`, `createdAt`) with the encryption key from the `CONNECTOR_ENCRYPTION_KEY` environment variable. The preview/apply/rollback flow is orchestrated by `src/lib/connectors/orchestrator.ts`, which handles fetching current content, fuzzy-matching anchor text, computing the diff, applying the insertion, and creating the `ArticleVersion` and `LinkInsertion` records in a single transaction.

Failure modes: (1) anchor text not found in current content (content changed since analysis) -- surface error to user, suggest re-ingestion; (2) CMS API timeout or auth failure -- retry once, then surface error; (3) insertion creates invalid HTML -- validate the modified HTML with a lightweight checker before applying.

### ADVERSARY

**Objection 1:** The cascade rollback strategy means rolling back a single early insertion also rolls back all subsequent insertions on the same article, even if those later insertions were correct and desired. A user who applied 10 recommendations and wants to undo only the 3rd one loses insertions 4-10 as well. This is a terrible UX for power users making many insertions. The DBA frames cascade rollback as "simpler" but ignores that selective rollback (replay all insertions except the reverted one against the original content) is what users actually expect. The simplicity benefit accrues to developers, not users.

**Objection 2:** The design stores full HTML snapshots per version (`ArticleVersion.bodyHtml`). For a Pro user with 2,000 articles averaging 15-20 KB of HTML each, applying recommendations to 500 articles (with an original + modified version each) generates 15-20 MB of version data. If users apply, rollback, and re-apply iteratively (a realistic workflow during review), version count grows quickly. The DBA suggests a retention policy ("keep last 20 versions") but does not address what happens when a user tries to rollback past the retention window -- the original content is lost.

**Objection 3:** Fuzzy-matching anchor text in content that has changed since analysis is described as a feature, but it is actually a significant source of incorrect insertions. If the user edited the paragraph and the anchor phrase now appears in a different context (e.g., "machine learning" now appears in a disclaimer rather than the main argument), the fuzzy matcher will insert the link in the wrong place. The preview step catches this only if the user reads carefully -- and users reviewing 200 recommendations will not read every preview carefully.

### JUDGE

**Verdict:** Accept the overall architecture with modifications for Objections 1 and 2. Acknowledge Objection 3 as an inherent limitation that the preview step must address.

On Objection 1: The ADVERSARY is correct that cascade rollback is user-hostile for power users. **Modification:** Implement selective rollback as the primary mechanism. When rolling back insertion N, replay insertions 1 through N-1 and N+1 through latest against the original ingested version to produce a new version with insertion N removed. This is more complex but is the expected behavior. Cascade rollback may be offered as a secondary option ("Undo this and all subsequent changes") for users who want a clean slate.

On Objection 2: Valid storage concern. **Modification:** Always retain the original ingested version (never subject to the retention policy). Apply a retention policy of 50 versions per article. When the limit is reached, compress intermediate versions (store diffs rather than full HTML) but keep the original and the current version as full snapshots. This guarantees rollback to the original is always possible.

On Objection 3: Acknowledged as inherent. The preview step is the primary defense. **Additional mitigation:** When the fuzzy matcher's confidence is below a threshold (e.g., the matched text differs by more than 10% from the original anchor text), flag the preview with a prominent warning: "The anchor text location may have shifted. Please verify the insertion point carefully." Do not auto-apply low-confidence matches in batch operations -- require individual confirmation.
