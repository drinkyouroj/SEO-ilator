# Architecture Overview — SEO-ilator

> Living document. Update when a PR meaningfully changes system topology, data flow,
> or key component responsibilities.

## System Diagram

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

## Data Flow

1. **Ingestion** — Articles enter via sitemap crawl, file upload, or API push
2. **Normalization** — All inputs are parsed and stored as `Article` records in PostgreSQL
3. **Analysis** — User triggers an analysis run; the registry fans out to all enabled strategies
4. **Recommendations** — Each strategy returns typed `Recommendation[]` with severity and suggestions
5. **Review** — Dashboard presents recommendations; user accepts or dismisses each one

## Key Interfaces

See `CLAUDE.md` for the full `SEOStrategy` interface definition and registry API.

## Embedding Pipeline

The crosslink strategy's semantic similarity mode uses an abstracted embedding provider
(`src/lib/embeddings/`). Currently supports OpenAI and Cohere. The provider is selected
via environment config (`EMBEDDING_PROVIDER`).

Embeddings are stored on the `Article` model and recomputed on content change.
