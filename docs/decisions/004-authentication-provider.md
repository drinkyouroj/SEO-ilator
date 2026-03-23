# DECISION: Authentication Provider

**Date:** 2026-03-23
**Status:** Accepted

## Context

SEO-ilator is a multi-tenant SaaS. Every API endpoint and dashboard page requires authentication, and user identity determines data isolation (articles, recommendations, and analysis runs are scoped per user). The PRD (Section 13, Question 4) identifies this as an open decision between NextAuth, Clerk, and Auth0. This is the most consequential infrastructure decision for v1.0 because it determines the multi-tenancy data model, session management strategy, and the migration path to team workspaces in v2.0.

The team is split on this question: the Backend Engineer, DBA, and DevOps engineer recommend **NextAuth (Auth.js v5)**, while the Frontend Engineer, Client Success advocate, and SEO Expert recommend **Clerk**. Both sides present compelling arguments.

## Options Considered

1. **NextAuth (Auth.js v5) with Prisma adapter** -- Self-hosted, open-source auth running inside the Next.js app. User/session/account data stored in our PostgreSQL via Prisma. Pros: zero external service cost; zero additional service dependency; full schema control; user records co-located with all other tenant data for simple foreign keys and transactional queries; no vendor lock-in. Cons: requires building all auth UI from scratch; team/org features for v2.0 must be built manually; SSO requires more configuration work; self-hosted means owning session security, CSRF, and token rotation.

2. **Clerk** -- Managed auth service with pre-built React components and first-class Next.js App Router support. Pros: polished sign-in/sign-up/user-profile UI out of the box; built-in organization/team support for v2.0; SAML SSO on enterprise plan; lowest frontend implementation effort. Cons: vendor dependency (outage blocks all logins); per-MAU pricing ($0.02/MAU after 10K on Pro); user data lives in Clerk's system requiring sync or API calls for authorization checks; proprietary session management makes migration painful.

3. **Auth0** -- Enterprise-grade managed auth. Pros: robust SSO (SAML, OIDC); battle-tested at scale. Cons: highest cost; most complex configuration; React SDK less polished than Clerk's; overkill for a startup in its first 90 days; heavier operational overhead per the DevOps engineer.

## Decision

**Option 1: NextAuth (Auth.js v5) with Prisma adapter.**

This was a close call. The arguments for Clerk -- particularly from the Frontend Engineer (superior component library, lower frontend effort) and the Client Success advocate (reduced auth support burden, built-in SSO) -- are legitimate and would be the right choice for a team optimizing for speed-to-launch above all else. However, the arguments for NextAuth from the infrastructure and data perspectives are more compelling for a SaaS product that needs to get multi-tenancy right from day one.

### Why NextAuth wins

**The DBA's argument is decisive:** "This is the most consequential database decision of the five because it determines the multi-tenancy data isolation model." With NextAuth + Prisma adapter, user records live in our PostgreSQL alongside all tenant data. Every table gets a `userId` foreign key. Authorization checks are a `WHERE userId = ?` clause in the same transaction as the data query. There is no sync layer, no external API call, no eventual consistency. The DBA's warning about Clerk is specific: "with Clerk, user data lives in an external system and you would need to sync it to your database or make API calls for every authorization check."

**The DevOps engineer's argument about operational simplicity:** "Your auth availability is your app's availability -- one thing to monitor instead of two." No Clerk status page to watch, no webhook secrets to manage, no external billing to track.

**The Backend Engineer's cost analysis is forward-looking:** "Clerk charges per MAU. For a usage-based pricing model where the billing unit is analysis runs, not users, a per-MAU auth cost compresses margins on low-usage accounts." Free-tier users who never run an analysis still cost $0.02/month each in auth fees on Clerk.

### Addressing Clerk's advantages

The Frontend Engineer's concern about building auth UI from scratch is valid but bounded. For v1.0, the auth surface is small: a sign-in page, a sign-up page, and a user menu in the dashboard header. Auth.js v5 with App Router middleware handles route protection. The sign-in/sign-up pages use Tailwind CSS components. Total frontend effort: 2-3 days, not the weeks implied by building a full auth system.

The Client Success advocate's concern about support burden from auth issues is mitigated by the v1.0 auth strategy: **OAuth only (Google + GitHub) for v1.0, no email/password.** This eliminates password reset flows, email verification, and magic link expiry -- the three most common auth support issues. Email/password can be added later if user research demands it.

The SEO Expert's concern about multi-site support is addressed at the data model level, not the auth level: introduce a `Project` model from day one (even if v1.0 auto-creates a single project per user) so that articles are scoped to `projectId`, not directly to `userId`. This prepares for multi-site and team workspaces regardless of auth provider.

### When to revisit

If Enterprise tier customers arrive and demand SAML SSO, evaluate migrating to Clerk or WorkOS at that point. The auth abstraction layer (described below) keeps the migration surface manageable. The Backend Engineer's assessment: "adding Clerk later is a migration, not a rewrite."

### Implementation specifics

**Providers:** Google OAuth + GitHub OAuth for v1.0. Both are first-class Auth.js providers requiring only client ID/secret in Vercel environment variables.

**Session strategy:** The DBA recommends JWT sessions to reduce database round trips. The Backend Engineer recommends database sessions for server-side revocation in a multi-tenant SaaS. **Decision: database sessions.** In a multi-tenant SaaS, the ability to revoke sessions server-side (e.g., when a user's plan is downgraded or account is suspended) outweighs the cost of one additional DB query per request. The `Session` table is small and the lookup is indexed.

**Prisma schema additions:**
- `User` -- standard Auth.js fields + `plan` (free/pro/enterprise), `articleLimit`, `runLimit`.
- `Account` -- OAuth provider details (standard Auth.js).
- `Session` -- server-side session records (standard Auth.js).
- `VerificationToken` -- for future email verification flows.
- `Project` -- `id`, `userId` (FK), `name`, `createdAt`. Auto-created on user signup.
- All existing data tables (`Article`, `AnalysisRun`, `Recommendation`, `StrategyConfig`) get a `projectId` FK (scoped to project, not directly to user).

**Auth abstraction layer:** Per the Frontend Engineer's mitigation advice (originally about Clerk), wrap auth access behind a thin abstraction:
- `src/lib/auth/session.ts` -- exports `getSession()`, `requireAuth()`, `getCurrentUser()`.
- `src/lib/auth/middleware.ts` -- exports the Auth.js middleware config for route protection.
- No other file in the codebase imports directly from `next-auth`. This keeps the migration surface to two files.

**Composite indexes:** Per the DBA, plan these upfront:
- `Article(projectId, url)` -- unique constraint for idempotent ingestion.
- `Recommendation(projectId, analysisRunId, status, severity)` -- filtered listing and export.
- `AnalysisRun(projectId, status)` -- run history listing.

## Consequences

- Auth UI must be built from scratch using Tailwind components. This is 2-3 days of frontend effort for the v1.0 scope (sign-in, sign-up, user menu).
- Team/org features for v2.0 must be built manually. The `Project` model provides the foundation, but invitation flows, role-based access, and shared workspaces are custom work. Budget 4-6 weeks when v2.0 is on the roadmap.
- Zero ongoing auth service cost. No per-MAU fees.
- Full control over user data, session management, and the auth schema. No vendor lock-in.
- SSO for Enterprise tier requires additional configuration work when that tier launches. Auth.js supports SAML/OIDC but it is more manual than Clerk's managed SSO.
- Database sessions add one query per request. At expected v1.0 scale (< 1,000 users), this is negligible.

## AAP: Authentication Provider

### ARCHITECT

Auth.js v5 is configured in `src/lib/auth/config.ts` with the Prisma adapter pointing at the existing PostgreSQL instance. Google and GitHub OAuth providers are configured via `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` environment variables in Vercel. The `AUTH_SECRET` environment variable handles session encryption. Middleware in `src/middleware.ts` protects all `/dashboard/*` and `/api/*` routes (except `/api/auth/*`). Database sessions are used for server-side revocation capability.

On first login, a `User` record is created (via Auth.js adapter), and a default `Project` is auto-created via a `signIn` callback in `src/lib/auth/config.ts`. All subsequent data queries include `projectId` in the `where` clause, enforced by a `withProject(projectId)` helper in `src/lib/db.ts`.

The auth abstraction in `src/lib/auth/session.ts` exports `getSession()` (returns session or null), `requireAuth()` (returns session or throws 401), and `getCurrentUser()` (returns user with active project). The rest of the codebase never imports from `next-auth` directly.

### ADVERSARY

**Objection 1:** Database sessions add a query on every single request to protected routes. At v1.0 scale this is fine, but the architect has not specified a session cleanup strategy. Auth.js database sessions accumulate in the `Session` table. Without periodic cleanup of expired sessions, this table grows unboundedly. At 1,000 daily active users with 30-day session expiry, that is 30,000+ session rows. Not catastrophic, but sloppy -- and it indicates the kind of operational burden self-hosted auth creates that managed providers handle invisibly.

**Objection 2:** The decision dismisses Clerk's built-in organization support as "custom work that can wait for v2.0." But the PRD identifies "content teams" as a v1.0 user segment, and the SEO Expert warns that "the data model tying articles to a user rather than to a project/workspace makes the multi-site migration painful." The `Project` model mitigates this at the data layer, but without an invitation/sharing mechanism, content teams cannot use the product collaboratively at all in v1.0. Clerk's organization feature would provide this from day one. The decision trades v1.0 team functionality for infrastructure purity.

**Objection 3:** The decision recommends OAuth-only (no email/password) for v1.0 to reduce support burden. But the PRD's Free tier targets "solo content creators -- bloggers, newsletter writers, indie publishers." Many indie creators do not use Google Workspace or GitHub. Requiring OAuth from a specific provider creates a real sign-up barrier for the primary target segment.

### JUDGE

**Verdict:** Accept NextAuth with modifications for Objections 1 and 3. Overrule Objection 2.

On Objection 1: Valid operational concern. **Modification:** Add a Vercel Cron Job (`/api/cron/cleanup-sessions`) that runs daily and deletes sessions older than 30 days. This is a 10-line implementation and should be part of the v1.0 auth setup.

On Objection 2: Overruled. The PRD explicitly lists "multi-user team workspaces with role-based access" as out of scope for v1.0 (Section 4.2). Content teams can use the product in v1.0 with a shared account (common for early-stage SaaS) while the team workspace feature is built for v2.0. The `Project` model provides the data foundation. Choosing Clerk now to get organization support earlier is paying the vendor lock-in tax for a feature the PRD itself defers.

On Objection 3: Valid concern about the target segment. **Modification:** Add email magic link authentication (passwordless) as a third provider alongside Google and GitHub OAuth. Auth.js supports this natively via the `Email` provider with minimal configuration (requires an SMTP service like Resend or SendGrid). This eliminates the sign-up barrier for users without Google/GitHub accounts while avoiding the support burden of password management. No traditional email/password with stored credentials in v1.0.
