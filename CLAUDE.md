# CLAUDE.md — SEO-ilator

> This file is the authoritative guide for Claude Code and any AI agent working in this
> repository. Read it fully before taking any action. It is committed to the repo root
> and applies to every session.

**Project:** SEO-ilator
**Purpose:** Extensible SEO engine that analyzes article indexes and recommends internal crosslinks, with a plugin architecture for additional SEO strategies (meta tag optimization, keyword density analysis, content quality scoring).
**Last updated:** 2026-03-23

---

## Environment & Stack

**Language(s):** TypeScript
**Framework(s):** Next.js (App Router)
**Database(s):** PostgreSQL (hosted on Railway)
**ORM:** Prisma
**Key dependencies:** cheerio (HTML parsing), openai / cohere SDK (embeddings), zod (validation), tailwindcss (UI)
**Runtime:** Node 20+
**Hosting:** Vercel (app) + Railway (PostgreSQL)

### Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL, OPENAI_API_KEY, etc.

# Run Prisma migrations
npx prisma migrate dev

# Run locally
npm run dev

# Run tests
npx vitest

# Build for production
npm run build
```

> Always verify the environment is set up before suggesting code changes.
> Never assume a dependency is installed.

---

## Docker

### Safety Block

**Never run `docker system prune`, `docker volume prune`, or any destructive Docker
command without explicit user confirmation in the chat.** These are irreversible.

### Port Assignments

| Service         | Port |
|-----------------|------|
| Next.js app     | 3000 |
| PostgreSQL      | 5432 |

> Before adding a new service, check this table. Never assign a port already in use.
> Add new assignments to this table as part of the PR that introduces the service.

### Compose

```bash
# Start all services (app + postgres for local dev)
docker compose up -d

# Rebuild after dependency changes
docker compose up -d --build

# Tear down (data volumes preserved)
docker compose down
```

---

## Testing Conventions

**Framework:** Vitest

### Rules

- Every new function or endpoint gets a test in the same PR that introduces it.
- Tests live in `tests/` mirroring the source structure (e.g., `src/lib/strategies/crosslink.ts` → `tests/lib/strategies/crosslink.test.ts`).
- Test names follow `test_<what>_<condition>_<expected>` — e.g., `it("returns_empty_array_when_no_articles_match")`.
- No PR merges to `develop` with failing tests.
- Prefer narrow unit tests over broad integration tests unless the integration is the thing under test.
- Strategy plugins must include their own test file with at least: one happy path, one edge case, and one empty-input test.

### Running Tests

```bash
# All tests
npx vitest

# Specific file
npx vitest tests/lib/strategies/crosslink.test.ts

# With coverage
npx vitest --coverage

# Watch mode (local dev)
npx vitest --watch
```

### Eval Harness (if applicable)

If this project includes a Claude prompt eval harness, it lives in `evals/`.
Run it with `npx vitest evals/` before any prompt change is merged.

---

## Architecture Overview

### Core Concept

SEO-ilator is an **extensible SEO engine** built around a **strategy registry pattern**. The core system handles article ingestion, indexing, and a web dashboard for reviewing recommendations. Individual SEO analysis capabilities (crosslinking, meta tags, keyword density, content quality) are implemented as **strategy plugins** that conform to a standard interface and register themselves with a central registry.

### High-Level Components

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App (Vercel)                  │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Dashboard    │  │  API Routes  │  │  Ingestion    │ │
│  │  (React UI)  │  │  /api/*      │  │  Pipeline     │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         │                 │                   │         │
│  ┌──────┴─────────────────┴───────────────────┴───────┐ │
│  │              Strategy Registry                      │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────┐  │ │
│  │  │ Crosslink  │ │ Meta Tags  │ │ Keyword        │  │ │
│  │  │ Strategy   │ │ Strategy   │ │ Density Strat. │  │ │
│  │  └────────────┘ └────────────┘ └────────────────┘  │ │
│  │  ┌────────────────┐                                │ │
│  │  │ Content Quality│  ... (more strategies)         │ │
│  │  │ Strategy       │                                │ │
│  │  └────────────────┘                                │ │
│  └────────────────────────────────────────────────────┘ │
│         │                                               │
│  ┌──────┴───────┐                                       │
│  │  Prisma ORM  │                                       │
│  └──────┬───────┘                                       │
└─────────┼───────────────────────────────────────────────┘
          │
   ┌──────┴───────┐
   │  PostgreSQL   │
   │  (Railway)    │
   └──────────────┘
```

### Strategy Registry Pattern

All SEO strategies implement the `SEOStrategy` interface and register with the central `StrategyRegistry`:

```typescript
// src/lib/strategies/types.ts
interface SEOStrategy {
  /** Unique identifier for the strategy */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description shown in the dashboard */
  description: string;

  /** Analyze a set of articles and return recommendations */
  analyze(context: AnalysisContext): Promise<Recommendation[]>;

  /** Optional: configure strategy-specific settings */
  configure?(settings: Record<string, unknown>): void;
}

interface AnalysisContext {
  /** The article being analyzed */
  article: Article;

  /** The full index of articles available for reference */
  articleIndex: Article[];

  /** Strategy-specific configuration */
  settings: Record<string, unknown>;
}

interface Recommendation {
  strategyId: string;
  articleId: string;
  type: "crosslink" | "meta" | "keyword" | "content_quality" | string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  /** For crosslinks: suggested anchor text and target URL */
  suggestion?: {
    anchorText?: string;
    targetUrl?: string;
    currentValue?: string;
    suggestedValue?: string;
  };
}
```

**Registering a strategy:**

```typescript
// src/lib/strategies/registry.ts
class StrategyRegistry {
  register(strategy: SEOStrategy): void;
  unregister(id: string): void;
  getStrategy(id: string): SEOStrategy | undefined;
  getAllStrategies(): SEOStrategy[];
  async analyzeWithAll(context: Omit<AnalysisContext, "settings">): Promise<Recommendation[]>;
}
```

New strategies are registered at app startup in `src/lib/strategies/index.ts`. To add a new strategy: create a file implementing `SEOStrategy`, then register it in the index.

### Input Methods

The ingestion pipeline supports three input methods:

1. **Sitemap / URL list** — Provide a sitemap.xml URL or a flat list of URLs. The crawler fetches and parses each page using cheerio.
2. **Local file index** — Upload HTML/markdown files or a JSON manifest of article metadata.
3. **API push** — External services push article data via `POST /api/articles`.

All three methods normalize into the shared `Article` schema stored in PostgreSQL.

### Crosslink Matching Approaches

The crosslink strategy supports two configurable matching approaches:

1. **Keyword/phrase matching** — Identifies anchor text candidates in article body text that match keywords/titles of other articles in the index. Uses exact and fuzzy string matching.
2. **Semantic similarity** — Generates embeddings for article content (via OpenAI, Cohere, or a configurable provider) and identifies semantically related articles that would benefit from crosslinks, even when no exact keyword match exists.

Both approaches can be enabled simultaneously and their results are merged and deduplicated. The matching approach is configurable per-analysis run.

### Database Schema (Prisma)

Key models:

- `Article` — URL, title, body content, metadata, embedding vector
- `Recommendation` — strategy ID, article ID, type, severity, suggestion payload, status (pending/accepted/dismissed)
- `AnalysisRun` — timestamp, strategies used, article count, status
- `StrategyConfig` — per-strategy settings (e.g., similarity threshold, max links per page)

### Directory Structure

```
SEO-ilator/
├── src/
│   ├── app/                    # Next.js App Router pages & API routes
│   │   ├── api/                # REST API endpoints
│   │   │   ├── articles/       # Article CRUD + ingestion
│   │   │   ├── analyze/        # Trigger analysis runs
│   │   │   └── recommendations/# Recommendation management
│   │   ├── dashboard/          # Web dashboard pages
│   │   └── layout.tsx
│   ├── components/             # React UI components
│   ├── lib/
│   │   ├── strategies/         # Strategy registry + implementations
│   │   │   ├── types.ts        # SEOStrategy interface & shared types
│   │   │   ├── registry.ts     # StrategyRegistry class
│   │   │   ├── crosslink.ts    # Crosslink strategy
│   │   │   ├── meta-tags.ts    # Meta tag optimization strategy
│   │   │   ├── keyword-density.ts  # Keyword density analysis
│   │   │   ├── content-quality.ts  # Content quality scoring
│   │   │   └── index.ts        # Strategy registration entrypoint
│   │   ├── ingestion/          # Article ingestion pipeline
│   │   │   ├── crawler.ts      # Sitemap/URL crawler
│   │   │   ├── parser.ts       # HTML/markdown parsing
│   │   │   └── normalizer.ts   # Normalize to Article schema
│   │   ├── embeddings/         # Embedding provider abstraction
│   │   └── db.ts               # Prisma client singleton
│   └── utils/                  # Shared utilities
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/                      # Mirrors src/ structure
├── docs/
│   ├── decisions/              # DECISION docs
│   └── architecture.md         # Architecture overview
├── public/
├── docker-compose.yml
├── .env.example
├── CLAUDE.md                   # This file
├── build_log.md
├── CHANGELOG.md
└── README.md
```

---

## Git Flow & Commit Conventions

### Branch Model

```
main          ← production-ready releases only. Tag every merge.
develop       ← integration branch. All features land here first.
feature/*     ← one branch per feature or fix. Branched from develop.
release/*     ← cut from develop when ready to ship. Merged to main + develop.
hotfix/*      ← branched from main. Merged to both main + develop.
```

### Rules

- `main` and `develop` are **protected**. No direct commits. PRs only.
- Branch names: `feature/short-description`, `fix/short-description`, `chore/short-description`.
- Delete feature branches after merge.
- Every merge to `main` gets a version tag: `v{{MAJOR}}.{{MINOR}}.{{PATCH}}`.

### Semantic Versioning

Follow [semver](https://semver.org/):

| Change type | Version bump |
|---|---|
| Breaking change / incompatible API | MAJOR |
| New feature, backward-compatible | MINOR |
| Bug fix, backward-compatible | PATCH |

Pre-release: `v1.2.0-alpha.1`, `v1.2.0-beta.1`, `v1.2.0-rc.1`

### Commit Message Format

Follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — wrap at 72 chars]

[optional footer — BREAKING CHANGE, closes #issue]
```

**Types:**

| Type | Use for |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, tooling, deps |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `refactor` | Code change with no behavior change |
| `perf` | Performance improvement |
| `ci` | CI/CD config changes |

**Examples:**

```
feat(strategies): add keyword density analysis strategy

fix(crosslink): handle articles with no body text without crashing

chore(deps): upgrade prisma to 6.x

docs(decisions): add DECISION doc for embedding provider abstraction

test(ingestion): add coverage for malformed sitemap.xml
```

### Commit Granularity

**Commit per logical change — not per file, not per hour, not per task.**

A logical change is the smallest unit of work that leaves the codebase in a valid state.

#### Correct granularity examples

- One commit to add a Prisma migration, a separate commit to add the model layer, a separate commit to add the API route.
- One commit for the DECISION doc, a separate commit for the strategy implementation, a separate commit for the tests.

#### Anti-patterns

- ❌ Batching unrelated changes into one commit ("misc fixes")
- ❌ Splitting a single logical change across multiple commits to pad history
- ❌ "WIP" commits on shared branches
- ❌ Committing commented-out code

### Pull Requests

- PR title = Conventional Commit format: `feat(scope): description`
- PR description must include: what changed, why, and how to test it.
- Link any related DECISION doc.
- Squash-merge feature branches into develop.
- Merge-commit (no squash) release and hotfix branches into main.

---

## The Adversarial Agent Protocol (AAP)

**This is not a standard build. Every significant decision goes through a three-agent
review before implementation.** This is not bureaucracy — it is how the product gets
hardened before it ships to users who are trusting you with their work.

### The Three Agents

**ARCHITECT** — Designs the solution. Writes code. Makes tradeoffs explicit.
Always asks: *"Is this the simplest thing that works and can be extended?"*

**ADVERSARY** — Attacks the design before and after implementation. Finds edge cases,
security holes, prompt injection risks, data loss scenarios, and UX failure modes.
Persona: a senior engineer who has been burned by exactly this kind of thing before.
Never lets a decision pass without at least two specific objections.

**JUDGE** — Listens to both. Decides. Writes the final implementation decision as a
one-line verdict followed by any required design changes. Does not compromise for the
sake of harmony. If ADVERSARY's attack is valid, ARCHITECT rebuilds. If the attack is
weak, JUDGE says so.

### When AAP Is Required

Run the Adversarial Agent Protocol for:

- New API endpoints
- Database schema decisions (Prisma migrations)
- Embedding provider integrations or changes
- Strategy interface changes (the `SEOStrategy` contract)
- Auth or payment flows
- Async job designs (e.g., background crawling, batch analysis)
- User-facing error messages that touch data or privacy
- Any change flagged in a DECISION doc as "requires AAP"

For everything else (typo fixes, styling, doc updates, trivial refactors) — skip it.

### Protocol Format

When AAP is triggered, structure the output like this:

```
## AAP: {{decision title}}

### ARCHITECT
{{Design proposal. Be specific. Name the files, functions, data shapes, failure modes
you've considered. State tradeoffs explicitly.}}

### ADVERSARY
**Objection 1:** {{specific attack}}
**Objection 2:** {{specific attack}}
[additional objections if warranted]

### JUDGE
**Verdict:** {{one sentence}}
{{Any required design changes before implementation proceeds.}}
```

### Rules

- ADVERSARY must raise **at least two** specific objections. "Looks fine" is not allowed.
- JUDGE must reference ADVERSARY's objections by number in the verdict if overruling them.
- If JUDGE sides with ADVERSARY, ARCHITECT must revise before any code is written.
- AAP output should be committed to `docs/decisions/` as part of the DECISION doc for
  the change it covers.
- Do not shortcut the protocol under time pressure. If something is worth building,
  it's worth 10 minutes of adversarial review.

---

## Documentation Conventions

### build_log.md

`build_log.md` lives at the repo root. It is append-only. Every session that makes
meaningful changes should add an entry:

```
## {{YYYY-MM-DD}} — {{short description}}

### Done
- <bullet per logical change>

### Decisions
- <any DECISION docs created or referenced>

### Next
- <what's left or blocked>
```

### DECISION Docs

Before implementing any of the following, a DECISION doc is required:

- New API endpoints
- Database schema changes (Prisma migrations)
- Strategy interface changes
- Embedding provider changes
- Auth or payment flows
- Async job designs

DECISION docs live in `docs/decisions/` and follow this template:

```markdown
# DECISION: {{title}}

**Date:** {{YYYY-MM-DD}}
**Status:** Proposed | Accepted | Rejected | Superseded

## Context
What problem are we solving? Why now?

## Options Considered
1. **Option A** — pros / cons
2. **Option B** — pros / cons

## Decision
What we're doing and why.

## Consequences
What changes, what gets harder, what gets easier.
```

### README.md

`README.md` must contain at minimum:

- Project name and one-paragraph purpose
- Prerequisites and local setup steps
- How to run tests
- Links to key DECISION docs

Keep it current. If setup steps change, update README in the same PR.

### CHANGELOG.md

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format.
Update it as part of every release PR (never retroactively).

```markdown
## [Unreleased]

## [{{version}}] — {{YYYY-MM-DD}}
### Added
### Changed
### Fixed
### Removed
```

### Architecture Overview

`docs/architecture.md` is a living document describing the high-level system.
Update it when a PR meaningfully changes system topology, data flow, or key
component responsibilities. A rough diagram (ASCII or Mermaid) is encouraged.
