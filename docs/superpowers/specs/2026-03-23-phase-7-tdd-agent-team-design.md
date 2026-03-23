# Phase 7: TDD Agent Team Design

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Settings, Billing Placeholders & Polish (Implementation Plan Phase 7, tasks 7.1-7.7)
**Prerequisites:** Phase 6 complete

---

## Overview

Phase 7 completes the user-facing experience with settings management, tier limit enforcement UI, responsive design, accessibility, error boundaries, and loading skeletons. This spec defines how three domain-specialized agents execute Phase 7 in parallel using git worktree isolation, with TDD discipline applied to the ThresholdSlider component and extended to validate responsive rendering and accessibility via component tests.

---

## Agent Team

### Settings Agent

**Domain:** Settings API, settings page, tier limit UI integration.

**Tasks:** 7.1, 7.2, 7.3

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/api/settings/route.ts` | 7.1 (GET/PUT settings API) |
| `src/lib/validation/settingsSchemas.ts` | 7.1 (zod validation schema) |
| `src/app/dashboard/settings/page.tsx` | 7.2 (StrategySettingsSection, AdvancedSection, AccountSection) |

**Files modified:**

| File | Source Task | Change |
|------|------------|--------|
| `src/app/dashboard/analyze/page.tsx` | 7.3 (lock icon on semantic matching, runs exhausted message) |
| `src/app/api/analyze/route.ts` | 7.3 (403 responses include `upgrade_url`) |

**Notes:**
- Settings API `GET` returns current strategy config for the authenticated user's project. `PUT` validates against `settingsUpdateSchema` before persisting.
- [AAP-B6] When switching embedding providers, the AdvancedSection must show warning: "Switching providers invalidates all cached embeddings. A full re-embed will be required on the next analysis run." Require explicit confirmation before saving.
- AccountSection shows plan badge (Free/Pro/Enterprise), usage stats (runs this month / limit, articles indexed / limit), and placeholder "Upgrade to Pro" button.
- Tier limit UI follows Client Success guidance: informative not punitive, show value not restrictions. Plan-gated features show lock icon and tooltip, not hidden.

**Verification commands:**
- `GET /api/settings` returns 200 with current config
- `PUT /api/settings` with valid body returns 200 and persists
- `PUT /api/settings` with invalid body returns 400 with zod errors
- Settings page renders all three sections
- Provider switch shows confirmation dialog before saving

### Polish Agent

**Domain:** Responsive design, accessibility, error boundaries, loading skeletons.

**Tasks:** 7.4, 7.5, 7.6, 7.7

**Files created:**

| File | Source Task |
|------|------------|
| `src/app/error.tsx` | 7.6 (global error boundary) |
| `src/app/dashboard/error.tsx` | 7.6 (dashboard error boundary) |
| `src/app/dashboard/articles/loading.tsx` | 7.7 (skeleton loader) |
| `src/app/dashboard/runs/loading.tsx` | 7.7 (skeleton loader) |
| `src/app/dashboard/analyze/loading.tsx` | 7.7 (skeleton loader) |
| `src/app/dashboard/settings/loading.tsx` | 7.7 [AAP-F9] (skeleton loader) |

**Files modified:**

| File | Source Task | Change |
|------|------------|--------|
| All DataTable usages | 7.4 (configure `renderMobileCard` prop) [AAP-F6] |
| Sidebar component | 7.4 (hamburger menu slide-over below `md`) |
| Bulk action bar component | 7.4 (fixed bottom on mobile, bottom padding) [AAP-F6] |
| All form components | 7.4 (vertical stacking on mobile) |
| All interactive elements | 7.5 (`focus-visible:ring-2`) |
| Sidebar, tables, modals | 7.5 (keyboard navigation) |
| Icon-only buttons | 7.5 (screen reader labels) |
| Severity badges, status badges | 7.5 (`aria-label`) |

**Notes:**
- [AAP-F6] Tables become card lists on mobile (below `md` breakpoint) via `renderMobileCard` prop. For recommendations: show severity, title, anchor text, and accept/dismiss buttons; collapse description and source context into expandable section.
- [AAP-F6] Bulk action bar fixed at bottom on mobile with bottom padding to compensate for fixed bar covering content.
- Minimum touch target: 44x44px on all interactive elements.
- Error boundaries use Client Success messaging: "Something went wrong. Our team has been notified. Try refreshing the page."
- WCAG AA color contrast verification across all color tokens.

**Verification commands:**
- Responsive layout renders correctly at 375px, 768px, 1280px widths
- All interactive elements have visible focus indicators
- Tab navigation reaches all sidebar items, table rows, modal controls
- Screen reader announces icon-only button purposes
- Error boundaries catch thrown errors and display fallback UI
- Loading skeletons render during data fetching

### TDD Agent

**Domain:** Test-first development of ThresholdSlider component, plus responsive rendering and accessibility validation tests.

**Tasks:** Test coverage for 7.2 (ThresholdSlider), 7.4 (responsive), 7.5 (accessibility)

**Files created (in strict order):**

| Order | File | Commit |
|-------|------|--------|
| 1 | `tests/components/forms/ThresholdSlider.test.tsx` | RED: 3 failing tests |
| 2 | `src/components/forms/ThresholdSlider.tsx` | GREEN: implementation passes all 3 |
| 3 | `tests/components/responsive/MobileCardLayout.test.tsx` | Responsive rendering tests |
| 4 | `tests/components/accessibility/FocusNavigation.test.tsx` | Accessibility validation tests |

**Test cases (ThresholdSlider, from Implementation Plan):**
- `it("renders_with_default_value")`
- `it("updates_value_on_change")`
- `it("clamps_to_min_max_range")`

**Test cases (responsive rendering):**
- `it("renders_card_layout_below_md_breakpoint")`
- `it("renders_table_layout_at_md_breakpoint_and_above")`
- `it("shows_hamburger_menu_on_mobile")`

**Test cases (accessibility):**
- `it("applies_focus_visible_ring_to_interactive_elements")`
- `it("supports_keyboard_navigation_through_sidebar")`
- `it("provides_aria_labels_on_icon_only_buttons")`

**Test environment setup:** Tests use `@testing-library/react` with `jsdom` environment. Responsive tests use `matchMedia` mocks to simulate breakpoints. Accessibility tests use `@testing-library/jest-dom` matchers for ARIA attribute assertions.

**TDD discipline:** The agent commits the failing ThresholdSlider test file before writing any implementation code. The test file is the spec. Two commits minimum (red, green). Responsive and accessibility tests validate existing components modified by the Polish Agent.

---

## Execution Flow

```
Phase A -- parallel (all three agents work on independent file sets)
  Settings Agent  ─► feature/phase-7-settings (own worktree)
  Polish Agent    ─► feature/phase-7-polish   (own worktree)
  TDD Agent       ─► feature/phase-7-tdd      (own worktree)

Phase B -- sequential merge into feature/phase-7
  1. Merge feature/phase-7-settings → feature/phase-7
  2. Merge feature/phase-7-polish   → feature/phase-7
  3. Merge feature/phase-7-tdd      → feature/phase-7
  4. Integration verification pass
  5. PR feature/phase-7 → develop
```

### Merge Order Rationale

Settings first because it creates the settings API, validation schema, and settings page that other agents reference. Polish second because it modifies existing components (DataTable, sidebar, forms) that the TDD Agent's responsive and accessibility tests validate. TDD last because its tests depend on both the ThresholdSlider (created by Settings Agent's page) and the responsive/accessibility modifications (made by Polish Agent).

### Expected Conflicts

- **`src/app/dashboard/analyze/page.tsx`:** Medium risk. Settings Agent adds tier limit UI (task 7.3). Polish Agent adds responsive card layout and accessibility attributes (tasks 7.4, 7.5). Resolve by applying Settings Agent's structural changes first, then Polish Agent's styling/accessibility overlays.
- **`src/app/dashboard/settings/page.tsx`:** Low risk. Settings Agent creates the file. Polish Agent may add responsive adjustments. TDD Agent does not modify this file.
- **Loading files:** No conflict. Polish Agent creates all loading.tsx files. No other agent touches them.

---

## Integration Verification

After all three branches merge into `feature/phase-7`, run these checks:

### Automated

| Check | Command | Expected |
|-------|---------|----------|
| Dependencies install | `npm install` | Exit 0 |
| Types pass | `npx tsc --noEmit` | Exit 0 |
| Lint passes | `npm run lint` | Exit 0 |
| Tests pass | `npx vitest --run` | All passing (including ThresholdSlider 3/3) |
| Build succeeds | `npm run build` | Exit 0 |

### Manual

| Check | Verification |
|-------|-------------|
| Settings API round-trip | PUT settings, GET returns updated values |
| Provider switch warning | Change provider, confirm dialog appears [AAP-B6] |
| Tier limit lock icons | Free tier sees lock on semantic matching |
| Responsive at 375px | Tables become cards, hamburger menu visible |
| Responsive at 768px | Tablet layout correct |
| Keyboard navigation | Tab through sidebar, tables, modals |
| Error boundary | Force error, see fallback UI |
| Loading skeletons | Throttle network, see skeleton on all dashboard pages |

### Documentation

| Check | Location |
|-------|----------|
| Settings validation schema documented | `src/lib/validation/settingsSchemas.ts` |
| Provider switch warning text | `src/app/dashboard/settings/page.tsx` [AAP-B6] |
| Settings loading skeleton | `src/app/dashboard/settings/loading.tsx` [AAP-F9] |

---

## Acceptance Criteria (from Implementation Plan)

- [ ] Settings save and persist across sessions
- [ ] [AAP-B6] Provider switch warning shown and confirmation required
- [ ] Plan limits visible in settings with usage stats
- [ ] Upgrade prompts appear at appropriate limit boundaries
- [ ] Layout is responsive at mobile/tablet/desktop
- [ ] Keyboard navigation works for all interactive elements
- [ ] Error boundaries catch and display errors gracefully
- [ ] Loading skeletons appear during data fetching

---

## Tests Required (from Implementation Plan)

**File:** `tests/components/forms/ThresholdSlider.test.tsx`
- `it("renders_with_default_value")`
- `it("updates_value_on_change")`
- `it("clamps_to_min_max_range")`

**Additional tests (TDD Agent, responsive/accessibility validation):**

**File:** `tests/components/responsive/MobileCardLayout.test.tsx`
- `it("renders_card_layout_below_md_breakpoint")`
- `it("renders_table_layout_at_md_breakpoint_and_above")`
- `it("shows_hamburger_menu_on_mobile")`

**File:** `tests/components/accessibility/FocusNavigation.test.tsx`
- `it("applies_focus_visible_ring_to_interactive_elements")`
- `it("supports_keyboard_navigation_through_sidebar")`
- `it("provides_aria_labels_on_icon_only_buttons")`

---

## Task-to-Agent Assignment

| Task | Agent | Description |
|------|-------|-------------|
| 7.1 | Settings Agent | Settings API (GET/PUT) + validation schema |
| 7.2 | Settings Agent | Settings page (strategy, advanced [AAP-B6], account sections) |
| 7.3 | Settings Agent | Tier limit UI integration (lock icons, upgrade CTAs) |
| 7.4 | Polish Agent | Responsive design pass (cards on mobile [AAP-F6], hamburger, bulk bar, 44x44 touch targets) |
| 7.5 | Polish Agent | Accessibility pass (focus-visible, keyboard nav, screen reader labels, WCAG AA) |
| 7.6 | Polish Agent | Error boundaries (global + dashboard) |
| 7.7 | Polish Agent | Loading state skeletons for all dashboard pages [AAP-F9] |

---

## AAP Tags Covered

| Tag | Where Applied |
|-----|---------------|
| [AAP-B6] | Settings Agent: provider switch warning + confirmation in AdvancedSection |
| [AAP-F6] | Polish Agent: `renderMobileCard` prop configuration, bulk bar bottom padding |
| [AAP-F9] | Polish Agent: settings loading skeleton (`src/app/dashboard/settings/loading.tsx`) |
