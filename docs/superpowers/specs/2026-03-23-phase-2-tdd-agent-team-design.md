# Phase 2: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Dashboard Shell & Layout (Implementation Plan Phase 2, tasks 2.1-2.7)

---

## Overview

Phase 2 builds the dashboard layout shell, auth UI pages, all placeholder dashboard pages, and the shared component library foundations. This spec defines how three domain-specialized agents execute Phase 2, with the Layout Agent running first (its output provides the root layout, AppShell, and layout components that pages and components depend on), followed by the Pages Agent and TDD Agent in parallel using git worktree isolation.

---

## Agent Team

### Layout Agent

**Domain:** Root layout, application shell, navigation, theme provider.

**Tasks:** 2.1, 2.3, 2.4, 2.7

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/layout.tsx` | 2.1 (root layout: global styles, Inter font, metadata, SessionProvider, ThemeProvider) |
| `src/components/layout/AppShell.tsx` | 2.3 (top-level wrapper: sidebar + header + main content slot, sidebar collapse state) |
| `src/components/layout/Sidebar.tsx` | 2.3 (nav links: Articles, Analyze, Runs, Ingest, Settings; active state; collapsible to icon-only below md; hamburger on mobile) |
| `src/components/layout/Header.tsx` | 2.3 (dynamic page title + UserMenu on right) |
| `src/components/layout/UserMenu.tsx` | 2.3 (avatar with OAuth image or initials fallback, dropdown: name + email, plan badge, Settings link, Sign out button) |
| `src/components/layout/AuthLayout.tsx` | 2.3 (centered card layout for sign-in, no sidebar) |
| `src/components/layout/PageContainer.tsx` | 2.3 (max-width constraint, p-6 desktop, p-4 mobile) |
| `src/app/dashboard/layout.tsx` | 2.4 (wraps /dashboard/* with AppShell) |
| `src/components/ThemeProvider.tsx` | 2.7 (dark mode toggle, class strategy, localStorage persistence, default to system preference) |

**Notes:**
- `src/app/layout.tsx` already exists from Phase 0 (create-next-app). Layout Agent must modify it to add `SessionProvider`, `ThemeProvider`, Inter font loading, and global metadata — not recreate from scratch.
- `SessionProvider` wraps client components; `ThemeProvider` enables dark mode via `class` strategy.
- `AppShell` manages sidebar collapse state and passes it to `Sidebar` and `Header`.
- Sidebar must highlight the active route using `usePathname()`.
- All layout components use Tailwind CSS with the semantic color tokens from Phase 0.

**Verification commands:**
- `npx tsc --noEmit` passes with all layout files
- `npm run build` succeeds
- Manual test: `/dashboard` renders AppShell with sidebar, header, and main content area
- Manual test: sidebar collapses on mobile viewport
- Manual test: dark mode toggles via ThemeProvider

### Pages Agent

**Domain:** Auth pages, placeholder dashboard pages.

**Tasks:** 2.2, 2.5

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/auth/sign-in/page.tsx` | 2.2 (AuthLayout > SignInCard > OAuthButton (Google), OAuthButton (GitHub), Divider, MagicLinkForm, ErrorAlert) |
| `src/app/auth/verify-request/page.tsx` | 2.2 (magic link confirmation: "Check your email" + resend button throttled 60s + troubleshooting tips [AAP-F8]) |
| `src/app/dashboard/page.tsx` | 2.5 (redirects to /dashboard/articles) |
| `src/app/dashboard/articles/page.tsx` | 2.5 (heading + EmptyState placeholder) |
| `src/app/dashboard/articles/[id]/page.tsx` | 2.5 (heading + EmptyState placeholder) |
| `src/app/dashboard/runs/page.tsx` | 2.5 (heading + EmptyState placeholder) |
| `src/app/dashboard/analyze/page.tsx` | 2.5 (heading + EmptyState placeholder) |
| `src/app/dashboard/ingest/page.tsx` | 2.5 (heading + EmptyState placeholder) |
| `src/app/dashboard/settings/page.tsx` | 2.5 (heading + EmptyState placeholder) |

**Notes:**
- Depends on Layout Agent output: `AuthLayout`, `AppShell`, `PageContainer`, and `EmptyState` (from TDD Agent) must exist.
- Sign-in page error code mapping per Client Success plan:
  - `OAuthAccountNotLinked` -> [AAP-F11] "This email is associated with your [provider] account. Please sign in with [provider]." (Query Account table for provider name.)
  - `EmailSignin` -> "Could not send the magic link. Please try again."
  - `Callback` -> "Something went wrong. Please try again. If the problem persists, try a different sign-in method."
  - `Verification` -> [AAP-F8] "This sign-in link has expired. Please request a new one." (Link back to sign-in page.)
- Verify-request page must include [AAP-F8]: "Sign in a different way" link back to sign-in page, troubleshooting tips ("Check your spam folder. Make sure you entered the correct email. If you use a corporate email, ask your IT team to whitelist noreply@seo-ilator.com.").
- Placeholder pages use `EmptyState` component with appropriate messaging per Client Success plan.
- `src/app/dashboard/page.tsx` redirects to `/dashboard/articles` (not a placeholder — immediate redirect).

**Verification commands:**
- `npx tsc --noEmit` passes
- `npm run build` succeeds
- Manual test: `/auth/sign-in` renders with Google, GitHub, and magic link options
- Manual test: error codes render correct messages
- Manual test: all 7 dashboard routes render placeholder pages
- Manual test: `/dashboard` redirects to `/dashboard/articles`

### TDD Agent

**Domain:** Test-first development of all shared UI components.

**Task:** 2.6

**Files created (in strict order):**

| Order | File | Commit |
|-------|------|--------|
| 1 | `tests/components/data/SeverityBadge.test.tsx` | RED: 3 failing tests |
| 2 | `src/components/data/SeverityBadge.tsx` | GREEN: implementation passes all 3 |
| 3 | `tests/components/data/DataTable.test.tsx` | RED: 3 failing tests |
| 4 | `src/components/data/DataTable.tsx` | GREEN: implementation passes all 3 |
| 5 | `tests/components/feedback/Toast.test.tsx` | RED: 1 failing test |
| 6 | `src/components/feedback/Toast.tsx` + `src/components/feedback/ToastProvider.tsx` | GREEN: implementation passes |
| 7 | `src/components/data/StatusBadge.tsx` | Pending (gray), accepted (green), dismissed (muted), running (blue spinner), completed (green), failed (red) |
| 8 | `src/components/data/EmptyState.tsx` | Title, description, optional CTA button |
| 9 | `src/components/data/Pagination.tsx` | Prev/Next with page indicator, cursor-based |
| 10 | `src/components/feedback/ProgressBar.tsx` | Determinate (X/Y) and indeterminate modes |
| 11 | `src/components/feedback/Spinner.tsx` | Inline loading indicator |
| 12 | `src/components/feedback/SkeletonLoader.tsx` | Configurable shapes for loading states |
| 13 | `src/components/feedback/ErrorBanner.tsx` | Full-width banner with retry button slot |
| 14 | `src/components/forms/ConfirmDialog.tsx` | Modal with title, description, confirm/cancel buttons |

**Test cases (from Implementation Plan):**

**File:** `tests/components/data/SeverityBadge.test.tsx`
- `it("renders_critical_badge_in_red")`
- `it("renders_warning_badge_in_amber")`
- `it("renders_info_badge_in_blue")`

**File:** `tests/components/data/DataTable.test.tsx`
- `it("renders_column_headers_and_rows")`
- `it("shows_skeleton_during_loading")`
- `it("shows_empty_state_when_no_rows")`

**File:** `tests/components/feedback/Toast.test.tsx`
- `it("renders_message_and_auto_dismisses")`

**Test environment setup:**
- Tests use `@testing-library/react` with `jsdom` environment (configured in Phase 0 vitest.config.ts).
- SeverityBadge tests render the component with each severity level and assert correct CSS classes/colors.
- DataTable tests pass column definitions and row data, assert header rendering; pass `loading: true` and assert skeleton rendering; pass empty rows and assert EmptyState rendering.
- DataTable must include `renderMobileCard` prop [AAP-F6] that accepts a row data object and returns a card layout for screens below `md` breakpoint.
- Toast test renders a toast message and asserts auto-dismiss after 5s using `vi.advanceTimersByTime()`.

**TDD discipline:** The agent commits the failing test file before writing any implementation code. The test file is the spec. Two commits minimum per testable component (red, green). Non-tested components (StatusBadge, EmptyState, Pagination, ProgressBar, Spinner, SkeletonLoader, ErrorBanner, ConfirmDialog) are implemented after the tested components pass.

**Notes on component details:**
- `SeverityBadge`: Use `cva` (class-variance-authority) for variants. critical = red, warning = amber, info = blue.
- `DataTable`: Generic sortable, paginated table. Column definitions, row data, loading skeletons, empty state slot. [AAP-F6] Include `renderMobileCard` prop to avoid Phase 7 rewrite.
- `Toast` + `ToastProvider`: Non-blocking notifications. Variants: success, error, info. Auto-dismiss 5s. Stack bottom-right.
- `StatusBadge`: Pending (gray), accepted (green), dismissed (muted), running (blue + spinner), completed (green), failed (red).
- `EmptyState`: Title, description, optional CTA button. Reused on all placeholder pages.
- `Pagination`: Prev/Next with page indicator. Cursor-based.
- `ProgressBar`: Determinate (X/Y) and indeterminate modes.
- `Spinner`: Inline loading indicator.
- `SkeletonLoader`: Configurable shapes for loading states.
- `ErrorBanner`: Full-width banner with retry button slot.
- `ConfirmDialog`: Modal with title, description, confirm/cancel buttons.

**Verification commands:**
- `npx vitest tests/components/data/SeverityBadge.test.tsx` -- 3/3 passing
- `npx vitest tests/components/data/DataTable.test.tsx` -- 3/3 passing
- `npx vitest tests/components/feedback/Toast.test.tsx` -- 1/1 passing
- `npx tsc --noEmit` passes with all component files

---

## Execution Flow

```
Phase A ── sequential (layout foundation)
  Layout Agent creates root layout + AppShell + layout components on feature/phase-2-layout
  Commits, verifies: build succeeds, dashboard renders shell

Phase B ── parallel (worktree isolation, branched from Layout output)
  Pages Agent ─► feature/phase-2-pages (own worktree)
  TDD Agent   ─► feature/phase-2-tdd   (own worktree)

Phase C ── sequential merge into feature/phase-2
  1. Merge feature/phase-2-layout → feature/phase-2
  2. Merge feature/phase-2-pages  → feature/phase-2
  3. Merge feature/phase-2-tdd    → feature/phase-2
  4. Integration verification pass
  5. PR feature/phase-2 → develop
```

### Merge Order Rationale

Layout first because it creates `AppShell`, `AuthLayout`, `PageContainer`, and root layout modifications that both Pages Agent and TDD Agent reference. Pages second because its files depend on layout components and may also import shared UI components (EmptyState) from TDD Agent — but Pages Agent creates its own placeholder `EmptyState` inline if the component isn't available yet, replaced on merge. TDD last because its shared UI components are self-contained and additive — they don't import from layout or page files.

### Expected Conflicts

- **`src/app/layout.tsx`:** Medium risk. Layout Agent modifies the Phase 0 version. No other agent touches this file. Conflict only if Phase 0 merge left unexpected state.
- **`src/app/dashboard/ingest/page.tsx`:** Low risk. Pages Agent creates placeholder. TDD Agent does not touch page files. Phase 3 replaces this.
- **`src/app/dashboard/articles/page.tsx`:** Low risk. Pages Agent creates placeholder. Phase 3 replaces this.
- **Component imports in pages:** Low risk. Pages Agent may import `EmptyState` from TDD Agent's path. If TDD Agent hasn't created it yet, Pages Agent uses inline placeholder. Resolved on merge by updating imports.

---

## Integration Verification

After all three branches merge into `feature/phase-2`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Tests pass | `npx vitest --run` | 7/7 new (SeverityBadge 3, DataTable 3, Toast 1) + prior phases |
| Build succeeds | `npm run build` | Exit 0 |
| Lint passes | `npm run lint` | Exit 0 |

### Documentation

| Check | Location |
|-------|----------|
| Error code mapping [AAP-F11, AAP-F8] | `src/app/auth/sign-in/page.tsx` |
| Verify-request troubleshooting [AAP-F8] | `src/app/auth/verify-request/page.tsx` |
| renderMobileCard prop [AAP-F6] | `src/components/data/DataTable.tsx` |
| Dark mode class strategy | `src/components/ThemeProvider.tsx` |
| SessionProvider in root layout | `src/app/layout.tsx` |
| ThemeProvider in root layout | `src/app/layout.tsx` |
| All 7 placeholder pages exist | `src/app/dashboard/*/page.tsx` |
| EmptyState with CTA on all placeholders | `src/app/dashboard/*/page.tsx` |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] Sign-in page renders with Google, GitHub, and magic link options
- [ ] After sign-in, user lands on dashboard with sidebar navigation
- [ ] All 6 dashboard routes render placeholder pages
- [ ] Sidebar highlights the active route
- [ ] User menu shows name, avatar, plan badge, and sign-out
- [ ] Dark mode toggles correctly
- [ ] Layout is responsive: sidebar collapses on mobile
- [ ] Empty states show appropriate messaging per Client Success plan
