# Build Log — SEO-ilator

> Append-only. Add a new entry per session that makes meaningful changes.

---

## 2026-03-23 — Project scaffolding and CLAUDE.md

### Done
- Generated CLAUDE.md with full project conventions
- Scaffolded companion docs (build_log.md, CHANGELOG.md, README.md, docs/)
- Created Claude Code hooks to block direct pushes to main/develop

### Decisions
- Stack: TypeScript + Next.js + Prisma + PostgreSQL (Vercel/Railway)
- Architecture: Strategy registry pattern for extensible SEO plugins
- Crosslink matching: keyword/phrase + semantic similarity, configurable per-run

### Next
- Initialize Next.js project with TypeScript
- Set up Prisma schema and initial migration
- Implement SEOStrategy interface and StrategyRegistry
- Build crosslink strategy (first plugin)
