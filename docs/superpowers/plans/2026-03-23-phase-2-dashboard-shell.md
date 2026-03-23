# Phase 2: Dashboard Shell & Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build dashboard layout shell, auth UI, placeholder pages, and shared component library foundations.

**Architecture:** The dashboard uses a nested layout pattern: root layout wraps the entire app with SessionProvider and ThemeProvider, while a dashboard-specific layout wraps authenticated pages with AppShell (sidebar + header + content area). Auth pages use a separate centered AuthLayout with no sidebar. All shared UI components follow a categorized structure (data/, feedback/, forms/) and the TDD-first components use class-variance-authority for variant management.

**Tech Stack:** Next.js App Router, React, Tailwind CSS, class-variance-authority (cva)

**Agent Team:** Layout Agent (sequential first), then Pages Agent + TDD Agent (parallel in worktrees)

**Prerequisites:** Phase 1 complete. Auth working.

---

## Dependency Installation

- [ ] **Step 0.1:** Install `class-variance-authority` for component variants

```bash
npm install class-variance-authority
```

**Expected output:** `added 1 package` (cva has zero dependencies)

**Commit:** `chore(deps): add class-variance-authority for UI component variants`

---

## Layout Agent (Sequential — Phase A)

> **Branch:** `feature/phase-2-layout`
> **Depends on:** Phase 1 complete
> **Must complete before:** Pages Agent and TDD Agent

---

### L1. ThemeProvider

- [ ] **Step L1.1:** Create `src/components/ThemeProvider.tsx`

```tsx
// src/components/ThemeProvider.tsx
"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeProviderContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderContextValue | undefined>(
  undefined
);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") return getSystemTheme();
  return theme;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "seo-ilator-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return defaultTheme;
    const stored = localStorage.getItem(storageKey) as Theme | null;
    return stored ?? defaultTheme;
  });

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(theme)
  );

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      localStorage.setItem(storageKey, newTheme);
    },
    [storageKey]
  );

  // Apply class to <html> element
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
  }, [theme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = resolveTheme("system");
      setResolvedTheme(resolved);
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeProviderContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
```

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
```

**Commit:** `feat(theme): add ThemeProvider with dark mode class strategy and system preference`

---

### L2. Root Layout

- [ ] **Step L2.1:** Modify `src/app/layout.tsx` to add SessionProvider, ThemeProvider, Inter font, and metadata

> **Note:** This file already exists from Phase 0 (create-next-app). Modify it -- do not recreate from scratch.

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "SEO-ilator",
    template: "%s | SEO-ilator",
  },
  description:
    "Extensible SEO engine for article crosslinking and content optimization",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <SessionProvider>
          <ThemeProvider defaultTheme="system" storageKey="seo-ilator-theme">
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
```

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
```

**Commit:** `feat(layout): configure root layout with SessionProvider, ThemeProvider, and Inter font`

---

### L3. PageContainer

- [ ] **Step L3.1:** Create `src/components/layout/PageContainer.tsx`

```tsx
// src/components/layout/PageContainer.tsx
interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div
      className={`mx-auto w-full max-w-7xl p-4 md:p-6 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
```

**Commit:** (bundled with next step)

---

### L4. UserMenu

- [ ] **Step L4.1:** Create `src/components/layout/UserMenu.tsx`

```tsx
// src/components/layout/UserMenu.tsx
"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export function UserMenu() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  if (!session?.user) return null;

  const { name, email, image } = session.user;
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : email?.charAt(0).toUpperCase() ?? "?";

  // Plan badge -- defaults to "free" until billing is implemented
  const plan = "Free";

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {image ? (
          <img
            src={image}
            alt={name ?? "User avatar"}
            className="h-8 w-8 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
            {initials}
          </div>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-gray-700 dark:bg-gray-900 z-50"
          role="menu"
        >
          {/* User info */}
          <div className="border-b border-gray-200 px-4 pb-2 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {name ?? "User"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{email}</p>
            <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {plan}
            </span>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/dashboard/settings"
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Settings
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/sign-in" })}
              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              role="menuitem"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Commit:** (bundled with next step)

---

### L5. Header

- [ ] **Step L5.1:** Create `src/components/layout/Header.tsx`

```tsx
// src/components/layout/Header.tsx
"use client";

import { useTheme } from "@/components/ThemeProvider";
import { UserMenu } from "./UserMenu";

interface HeaderProps {
  title: string;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}

export function Header({ title, onToggleSidebar, sidebarCollapsed }: HeaderProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const cycleTheme = () => {
    const order: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];
    const currentIndex = order.indexOf(theme as "light" | "dark" | "system");
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  };

  const themeIcon =
    theme === "system" ? "💻" : resolvedTheme === "dark" ? "🌙" : "☀️";
  const themeLabel =
    theme === "system"
      ? "System"
      : resolvedTheme === "dark"
        ? "Dark"
        : "Light";

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        {/* Hamburger / collapse toggle */}
        <button
          onClick={onToggleSidebar}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
          aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>

        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={cycleTheme}
          className="rounded-md px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          aria-label={`Current theme: ${themeLabel}. Click to change.`}
          title={`Theme: ${themeLabel}`}
        >
          <span aria-hidden="true">{themeIcon}</span>
        </button>

        <UserMenu />
      </div>
    </header>
  );
}
```

**Commit:** (bundled with next step)

---

### L6. Sidebar

- [ ] **Step L6.1:** Create `src/components/layout/Sidebar.tsx`

```tsx
// src/components/layout/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Articles",
    href: "/dashboard/articles",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    label: "Analyze",
    href: "/dashboard/analyze",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    label: "Runs",
    href: "/dashboard/runs",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Ingest",
    href: "/dashboard/ingest",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 bg-white
          transition-transform duration-200 ease-in-out
          dark:border-gray-700 dark:bg-gray-900
          md:relative md:translate-x-0
          ${collapsed ? "-translate-x-full md:w-16" : "w-64 translate-x-0"}
        `}
      >
        {/* Logo / Brand */}
        <div className="flex h-14 items-center border-b border-gray-200 px-4 dark:border-gray-700">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
              S
            </span>
            {!collapsed && (
              <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                SEO-ilator
              </span>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={onToggle}
            className="ml-auto hidden rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:block"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4" aria-label="Main navigation">
          <ul className="space-y-1 px-2">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`
                      flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
                      transition-colors
                      ${
                        isActive
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      }
                      ${collapsed ? "justify-center md:px-2" : ""}
                    `}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="flex-shrink-0">{item.icon}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
```

**Commit:** (bundled with next step)

---

### L7. AppShell

- [ ] **Step L7.1:** Create `src/components/layout/AppShell.tsx`

```tsx
// src/components/layout/AppShell.tsx
"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title = "Dashboard" }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          onToggleSidebar={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Commit:** (bundled with next step)

---

### L8. AuthLayout

- [ ] **Step L8.1:** Create `src/components/layout/AuthLayout.tsx`

```tsx
// src/components/layout/AuthLayout.tsx
interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            <span className="text-blue-600 dark:text-blue-400">SEO</span>-ilator
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Extensible SEO engine for content optimization
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          {children}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step L8.2:** Commit all layout components

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
```

**Commit:** `feat(layout): add AppShell, Sidebar, Header, UserMenu, AuthLayout, and PageContainer`

---

### L9. Dashboard Layout

- [ ] **Step L9.1:** Create `src/app/dashboard/layout.tsx`

```tsx
// src/app/dashboard/layout.tsx
import { AppShell } from "@/components/layout/AppShell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
```

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
npm run build
# Expected: Exit 0
```

**Commit:** `feat(layout): add dashboard layout wrapping routes with AppShell`

---

## Pages Agent (Parallel — Phase B)

> **Branch:** `feature/phase-2-pages` (branched from `feature/phase-2-layout` output)
> **Worktree:** `worktrees/phase-2-pages`
> **Depends on:** Layout Agent complete

---

### P1. Sign-In Page

- [ ] **Step P1.1:** Create `src/app/auth/sign-in/page.tsx`

```tsx
// src/app/auth/sign-in/page.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/layout/AuthLayout";

// --- Error code mapping per Client Success plan ---
const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email is associated with another sign-in method. Please use the original provider you signed up with.", // [AAP-F11]
  EmailSignin: "Could not send the magic link. Please try again.",
  Callback:
    "Something went wrong. Please try again. If the problem persists, try a different sign-in method.",
  Verification:
    "This sign-in link has expired. Please request a new one.", // [AAP-F8]
  Default: "An unexpected error occurred. Please try again.",
};

function getErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;
  return ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default;
}

// --- OAuthButton ---
interface OAuthButtonProps {
  provider: "google" | "github";
  label: string;
  icon: React.ReactNode;
}

function OAuthButton({ provider, label, icon }: OAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    await signIn(provider, { callbackUrl: "/dashboard/articles" });
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      {icon}
      {loading ? "Redirecting..." : label}
    </button>
  );
}

// --- MagicLinkForm ---
function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      const result = await signIn("email", {
        email,
        callbackUrl: "/dashboard/articles",
        redirect: false,
      });

      if (result?.error) {
        setError(ERROR_MESSAGES.EmailSignin);
        setLoading(false);
      }
      // If successful, next-auth redirects to verify-request
    } catch {
      setError(ERROR_MESSAGES.EmailSignin);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
      >
        {loading ? "Sending..." : "Send magic link"}
      </button>
    </form>
  );
}

// --- Divider ---
function Divider() {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-gray-300 dark:border-gray-600" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="bg-white px-2 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          or
        </span>
      </div>
    </div>
  );
}

// --- Page ---
export default function SignInPage() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage = getErrorMessage(errorCode);

  return (
    <AuthLayout>
      <h2 className="mb-6 text-center text-xl font-semibold text-gray-900 dark:text-gray-100">
        Sign in to your account
      </h2>

      {/* Error alert */}
      {errorMessage && (
        <div
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
          role="alert"
        >
          {errorMessage}
          {errorCode === "Verification" && (
            <a
              href="/auth/sign-in"
              className="ml-1 font-medium underline hover:text-red-800 dark:hover:text-red-200"
            >
              Request a new link.
            </a>
          )}
        </div>
      )}

      {/* OAuth buttons */}
      <div className="space-y-3">
        <OAuthButton
          provider="google"
          label="Continue with Google"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
          }
        />

        <OAuthButton
          provider="github"
          label="Continue with GitHub"
          icon={
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
          }
        />
      </div>

      <Divider />

      {/* Magic link form */}
      <MagicLinkForm />
    </AuthLayout>
  );
}
```

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
```

**Commit:** `feat(auth): add sign-in page with OAuth buttons, magic link, and error code mapping`

---

### P2. Verify Request Page

- [ ] **Step P2.1:** Create `src/app/auth/verify-request/page.tsx`

```tsx
// src/app/auth/verify-request/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/layout/AuthLayout";
import Link from "next/link";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyRequestPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "your inbox";

  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  // Countdown timer for resend throttle
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || resendStatus === "sending") return;

    setResendStatus("sending");
    try {
      await signIn("email", {
        email,
        redirect: false,
        callbackUrl: "/dashboard/articles",
      });
      setResendStatus("sent");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setResendStatus("error");
    }
  }, [email, resendCooldown, resendStatus]);

  return (
    <AuthLayout>
      <div className="text-center">
        {/* Email icon */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-blue-600 dark:text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
          Check your email
        </h2>

        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          We sent a sign-in link to{" "}
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {email}
          </span>
          . The link expires in 10 minutes.
        </p>

        {/* Resend button */}
        <button
          onClick={handleResend}
          disabled={resendCooldown > 0 || resendStatus === "sending"}
          className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {resendStatus === "sending"
            ? "Sending..."
            : resendCooldown > 0
              ? `Resend in ${resendCooldown}s`
              : resendStatus === "sent"
                ? "Sent! Resend again"
                : "Resend magic link"}
        </button>

        {resendStatus === "error" && (
          <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
            Could not resend the magic link. Please try again.
          </p>
        )}

        {/* [AAP-F8] Sign in a different way */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <Link
            href="/auth/sign-in"
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Sign in a different way
          </Link>
        </div>

        {/* Troubleshooting tips [AAP-F8] */}
        <div className="mt-6 rounded-lg bg-gray-50 p-4 text-left dark:bg-gray-800/50">
          <h3 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
            Troubleshooting
          </h3>
          <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
            <li>Check your spam or junk folder.</li>
            <li>Make sure you entered the correct email address.</li>
            <li>
              If you use a corporate email, ask your IT team to whitelist{" "}
              <span className="font-mono text-gray-900 dark:text-gray-100">
                noreply@seo-ilator.com
              </span>
              .
            </li>
          </ul>
        </div>
      </div>
    </AuthLayout>
  );
}
```

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
```

**Commit:** `feat(auth): add verify-request page with resend throttle and troubleshooting tips`

---

### P3. Dashboard Redirect

- [ ] **Step P3.1:** Create `src/app/dashboard/page.tsx`

```tsx
// src/app/dashboard/page.tsx
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/dashboard/articles");
}
```

**Commit:** (bundled with P4)

---

### P4. Placeholder Pages

- [ ] **Step P4.1:** Create `src/app/dashboard/articles/page.tsx`

```tsx
// src/app/dashboard/articles/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Articles" };

export default function ArticlesPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Articles
      </h1>
      <EmptyState
        title="No articles yet"
        description="Ingest your first batch of articles to start analyzing SEO opportunities."
        ctaLabel="Ingest Articles"
        ctaHref="/dashboard/ingest"
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.2:** Create `src/app/dashboard/articles/[id]/page.tsx`

```tsx
// src/app/dashboard/articles/[id]/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Article Detail" };

export default function ArticleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Article Detail
      </h1>
      <EmptyState
        title="Article not found"
        description={`No article with ID "${params.id}" exists yet. Ingest articles to populate this view.`}
        ctaLabel="Back to Articles"
        ctaHref="/dashboard/articles"
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.3:** Create `src/app/dashboard/runs/page.tsx`

```tsx
// src/app/dashboard/runs/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Analysis Runs" };

export default function RunsPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analysis Runs
      </h1>
      <EmptyState
        title="No analysis runs yet"
        description="Run your first SEO analysis to see results here."
        ctaLabel="Start Analysis"
        ctaHref="/dashboard/analyze"
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.4:** Create `src/app/dashboard/analyze/page.tsx`

```tsx
// src/app/dashboard/analyze/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Analyze" };

export default function AnalyzePage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Analyze
      </h1>
      <EmptyState
        title="Ready to analyze"
        description="Select articles and strategies to run an SEO analysis. Ingest articles first if you haven't already."
        ctaLabel="Ingest Articles"
        ctaHref="/dashboard/ingest"
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.5:** Create `src/app/dashboard/ingest/page.tsx`

```tsx
// src/app/dashboard/ingest/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Ingest" };

export default function IngestPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Ingest Articles
      </h1>
      <EmptyState
        title="Import your content"
        description="Provide a sitemap URL, upload files, or push articles via the API to get started."
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.6:** Create `src/app/dashboard/settings/page.tsx`

```tsx
// src/app/dashboard/settings/page.tsx
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/data/EmptyState";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
        Settings
      </h1>
      <EmptyState
        title="Settings coming soon"
        description="Strategy configuration, API keys, and account settings will be available here."
      />
    </PageContainer>
  );
}
```

- [ ] **Step P4.7:** Commit all placeholder pages

**Verify:**
```bash
npx tsc --noEmit
# Expected: Exit 0
npm run build
# Expected: Exit 0
```

**Commit:** `feat(dashboard): add redirect and 6 placeholder pages with EmptyState`

---

## TDD Agent (Parallel — Phase B)

> **Branch:** `feature/phase-2-tdd` (branched from `feature/phase-2-layout` output)
> **Worktree:** `worktrees/phase-2-tdd`
> **Depends on:** Layout Agent complete

---

### T1. SeverityBadge — RED

- [ ] **Step T1.1:** Create `tests/components/data/SeverityBadge.test.tsx` (3 failing tests)

```tsx
// tests/components/data/SeverityBadge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeverityBadge } from "@/components/data/SeverityBadge";

describe("SeverityBadge", () => {
  it("renders_critical_badge_in_red", () => {
    render(<SeverityBadge severity="critical" />);
    const badge = screen.getByText("critical");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-red");
  });

  it("renders_warning_badge_in_amber", () => {
    render(<SeverityBadge severity="warning" />);
    const badge = screen.getByText("warning");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-amber");
  });

  it("renders_info_badge_in_blue", () => {
    render(<SeverityBadge severity="info" />);
    const badge = screen.getByText("info");
    expect(badge).toBeDefined();
    expect(badge.className).toContain("bg-blue");
  });
});
```

**Verify:**
```bash
npx vitest tests/components/data/SeverityBadge.test.tsx --run
# Expected: 3 FAILED tests (module not found)
```

**Commit:** `test(components): add failing SeverityBadge tests (RED)`

---

### T2. SeverityBadge — GREEN

- [ ] **Step T2.1:** Create `src/components/data/SeverityBadge.tsx`

```tsx
// src/components/data/SeverityBadge.tsx
import { cva, type VariantProps } from "class-variance-authority";

const severityBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
  {
    variants: {
      severity: {
        critical:
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
        warning:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
        info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      },
    },
    defaultVariants: {
      severity: "info",
    },
  }
);

export interface SeverityBadgeProps
  extends VariantProps<typeof severityBadgeVariants> {
  severity: "critical" | "warning" | "info";
  className?: string;
}

export function SeverityBadge({ severity, className = "" }: SeverityBadgeProps) {
  return (
    <span className={`${severityBadgeVariants({ severity })} ${className}`.trim()}>
      {severity}
    </span>
  );
}
```

**Verify:**
```bash
npx vitest tests/components/data/SeverityBadge.test.tsx --run
# Expected: 3 PASSED
```

**Commit:** `feat(components): implement SeverityBadge with cva variants (GREEN)`

---

### T3. DataTable — RED

- [ ] **Step T3.1:** Create `tests/components/data/DataTable.test.tsx` (3 failing tests)

```tsx
// tests/components/data/DataTable.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type ColumnDef } from "@/components/data/DataTable";

interface TestRow {
  id: string;
  name: string;
  score: number;
}

const columns: ColumnDef<TestRow>[] = [
  { key: "id", header: "ID" },
  { key: "name", header: "Name" },
  { key: "score", header: "Score" },
];

const rows: TestRow[] = [
  { id: "1", name: "Article A", score: 85 },
  { id: "2", name: "Article B", score: 72 },
];

describe("DataTable", () => {
  it("renders_column_headers_and_rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => (
          <div data-testid={`mobile-card-${row.id}`}>{row.name}</div>
        )}
      />
    );

    // Headers
    expect(screen.getByText("ID")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Score")).toBeDefined();

    // Row data
    expect(screen.getByText("Article A")).toBeDefined();
    expect(screen.getByText("Article B")).toBeDefined();
    expect(screen.getByText("85")).toBeDefined();
    expect(screen.getByText("72")).toBeDefined();
  });

  it("shows_skeleton_during_loading", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={[]}
        loading={true}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => <div>{row.name}</div>}
      />
    );

    const skeletons = container.querySelectorAll('[data-testid="skeleton-row"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows_empty_state_when_no_rows", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        loading={false}
        getRowId={(row) => row.id}
        renderMobileCard={(row) => <div>{row.name}</div>}
        emptyMessage="No data available"
      />
    );

    expect(screen.getByText("No data available")).toBeDefined();
  });
});
```

**Verify:**
```bash
npx vitest tests/components/data/DataTable.test.tsx --run
# Expected: 3 FAILED tests (module not found)
```

**Commit:** `test(components): add failing DataTable tests (RED)`

---

### T4. DataTable — GREEN

- [ ] **Step T4.1:** Create `src/components/data/DataTable.tsx`

```tsx
// src/components/data/DataTable.tsx
"use client";

import { useState, useMemo } from "react";

export interface ColumnDef<T> {
  key: keyof T & string;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  key: string | null;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  renderMobileCard: (row: T) => React.ReactNode; // [AAP-F6]
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: string;
  emptyContent?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  renderMobileCard,
  loading = false,
  skeletonRows = 5,
  emptyMessage = "No data",
  emptyContent,
  className = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>({ key: null, direction: null });

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    setSort((prev) => {
      if (prev.key === key) {
        const next: SortDirection =
          prev.direction === "asc"
            ? "desc"
            : prev.direction === "desc"
              ? null
              : "asc";
        return { key: next ? key : null, direction: next };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.direction) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sort.key as keyof T];
      const bVal = b[sort.key as keyof T];
      if (aVal < bVal) return sort.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sort]);

  // Loading skeleton
  if (loading) {
    return (
      <div className={`w-full ${className}`}>
        {/* Desktop skeleton */}
        <div className="hidden md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <tr
                  key={i}
                  data-testid="skeleton-row"
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile skeleton */}
        <div className="space-y-3 md:hidden">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div
              key={i}
              data-testid="skeleton-row"
              className="animate-pulse rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            >
              <div className="mb-2 h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (rows.length === 0) {
    return (
      <div className={`w-full ${className}`}>
        {emptyContent ?? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {emptyMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${
                    col.sortable ? "cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" : ""
                  } ${col.className ?? ""}`}
                  onClick={() => handleSort(col.key, col.sortable)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && sort.key === col.key && (
                      <span aria-hidden="true">
                        {sort.direction === "asc" ? "\u2191" : "\u2193"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={getRowId(row)}
                className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-gray-900 dark:text-gray-100 ${col.className ?? ""}`}
                  >
                    {col.render
                      ? col.render(row[col.key], row)
                      : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards [AAP-F6] */}
      <div className="space-y-3 md:hidden">
        {sortedRows.map((row) => (
          <div
            key={getRowId(row)}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            {renderMobileCard(row)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Verify:**
```bash
npx vitest tests/components/data/DataTable.test.tsx --run
# Expected: 3 PASSED
```

**Commit:** `feat(components): implement DataTable with sort, skeletons, mobile cards (GREEN)`

---

### T5. Toast — RED

- [ ] **Step T5.1:** Create `tests/components/feedback/Toast.test.tsx` (1 failing test)

```tsx
// tests/components/feedback/Toast.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/feedback/ToastProvider";
import { Toast } from "@/components/feedback/Toast";

// Helper component to trigger a toast
function ToastTrigger({ message }: { message: string }) {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast({ message, variant: "success" })}>
      Show Toast
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders_message_and_auto_dismisses", async () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Operation successful" />
      </ToastProvider>
    );

    // Trigger the toast
    await act(async () => {
      screen.getByText("Show Toast").click();
    });

    // Toast should be visible
    expect(screen.getByText("Operation successful")).toBeDefined();

    // Advance time by 5 seconds (auto-dismiss duration)
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Toast should be removed
    expect(screen.queryByText("Operation successful")).toBeNull();
  });
});
```

**Verify:**
```bash
npx vitest tests/components/feedback/Toast.test.tsx --run
# Expected: 1 FAILED test (module not found)
```

**Commit:** `test(components): add failing Toast auto-dismiss test (RED)`

---

### T6. Toast + ToastProvider — GREEN

- [ ] **Step T6.1:** Create `src/components/feedback/ToastProvider.tsx`

```tsx
// src/components/feedback/ToastProvider.tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { Toast, type ToastVariant } from "./Toast";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      counterRef.current += 1;
      const id = `toast-${counterRef.current}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
    },
    []
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}

      {/* Toast stack — bottom right */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            id={toast.id}
            message={toast.message}
            variant={toast.variant}
            duration={toast.duration ?? 5000}
            onDismiss={removeToast}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step T6.2:** Create `src/components/feedback/Toast.tsx`

```tsx
// src/components/feedback/Toast.tsx
"use client";

import { useEffect } from "react";

export type ToastVariant = "success" | "error" | "info";

interface ToastProps {
  id: string;
  message: string;
  variant: ToastVariant;
  duration: number;
  onDismiss: (id: string) => void;
}

const variantStyles: Record<ToastVariant, string> = {
  success:
    "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300",
  info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};

const variantIcons: Record<ToastVariant, string> = {
  success: "\u2713",
  error: "\u2717",
  info: "\u2139",
};

export function Toast({ id, message, variant, duration, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${variantStyles[variant]}`}
      role="status"
    >
      <span className="flex-shrink-0 text-base" aria-hidden="true">
        {variantIcons[variant]}
      </span>
      <p className="flex-1">{message}</p>
      <button
        onClick={() => onDismiss(id)}
        className="flex-shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
```

**Verify:**
```bash
npx vitest tests/components/feedback/Toast.test.tsx --run
# Expected: 1 PASSED
```

**Commit:** `feat(components): implement Toast and ToastProvider with auto-dismiss (GREEN)`

---

### T7. StatusBadge

- [ ] **Step T7.1:** Create `src/components/data/StatusBadge.tsx`

```tsx
// src/components/data/StatusBadge.tsx
import { cva, type VariantProps } from "class-variance-authority";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
  {
    variants: {
      status: {
        pending:
          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
        accepted:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        dismissed:
          "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
        running:
          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
        completed:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
        failed:
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
      },
    },
    defaultVariants: {
      status: "pending",
    },
  }
);

export type Status =
  | "pending"
  | "accepted"
  | "dismissed"
  | "running"
  | "completed"
  | "failed";

export interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  return (
    <span className={`${statusBadgeVariants({ status })} ${className}`.trim()}>
      {status === "running" && (
        <svg
          className="h-3 w-3 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {status}
    </span>
  );
}
```

**Commit:** `feat(components): add StatusBadge with cva variants and running spinner`

---

### T8. EmptyState

- [ ] **Step T8.1:** Create `src/components/data/EmptyState.tsx`

```tsx
// src/components/data/EmptyState.tsx
import Link from "next/link";

interface EmptyStateProps {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
  icon,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center dark:border-gray-700 ${className}`}
    >
      {icon ?? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
      )}

      <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      <p className="mb-4 max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>

      {ctaLabel && ctaHref && (
        <Link
          href={ctaHref}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {ctaLabel}
        </Link>
      )}

      {ctaLabel && onCtaClick && !ctaHref && (
        <button
          onClick={onCtaClick}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
```

**Commit:** `feat(components): add EmptyState with title, description, and optional CTA`

---

### T9. Pagination

- [ ] **Step T9.1:** Create `src/components/data/Pagination.tsx`

```tsx
// src/components/data/Pagination.tsx
"use client";

interface PaginationProps {
  /** Current cursor / page identifier */
  currentPage: number;
  /** Total number of pages (if known) */
  totalPages?: number;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Whether there is a previous page */
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
  className = "",
}: PaginationProps) {
  const pageIndicator = totalPages
    ? `Page ${currentPage} of ${totalPages}`
    : `Page ${currentPage}`;

  return (
    <div
      className={`flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700 ${className}`}
    >
      <button
        onClick={onPrevPage}
        disabled={!hasPrevPage}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Previous
      </button>

      <span className="text-sm text-gray-500 dark:text-gray-400">
        {pageIndicator}
      </span>

      <button
        onClick={onNextPage}
        disabled={!hasNextPage}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Next
      </button>
    </div>
  );
}
```

**Commit:** `feat(components): add Pagination with prev/next and page indicator`

---

### T10. ProgressBar

- [ ] **Step T10.1:** Create `src/components/feedback/ProgressBar.tsx`

```tsx
// src/components/feedback/ProgressBar.tsx
interface ProgressBarProps {
  /** Current progress value (0-max). Omit for indeterminate mode. */
  value?: number;
  /** Maximum value (default 100) */
  max?: number;
  /** Optional label shown above the bar */
  label?: string;
  /** Show the numeric count (e.g., "15/100") */
  showCount?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showCount = false,
  className = "",
}: ProgressBarProps) {
  const isIndeterminate = value === undefined;
  const percentage = isIndeterminate ? 0 : Math.min(100, (value / max) * 100);

  return (
    <div className={`w-full ${className}`}>
      {(label || showCount) && (
        <div className="mb-1 flex items-center justify-between text-sm">
          {label && (
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {label}
            </span>
          )}
          {showCount && !isIndeterminate && (
            <span className="text-gray-500 dark:text-gray-400">
              {value}/{max}
            </span>
          )}
        </div>
      )}

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "Progress"}
      >
        {isIndeterminate ? (
          <div className="h-full w-1/3 animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-blue-600 dark:bg-blue-400" />
        ) : (
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300 ease-in-out dark:bg-blue-400"
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>
    </div>
  );
}
```

**Commit:** (bundled with T11)

---

### T11. Spinner

- [ ] **Step T11.1:** Create `src/components/feedback/Spinner.tsx`

```tsx
// src/components/feedback/Spinner.tsx
interface SpinnerProps {
  /** Size in pixels (default 20) */
  size?: number;
  className?: string;
}

export function Spinner({ size = 20, className = "" }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin text-blue-600 dark:text-blue-400 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="status"
      aria-label="Loading"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
```

**Commit:** `feat(components): add ProgressBar and Spinner feedback components`

---

### T12. SkeletonLoader

- [ ] **Step T12.1:** Create `src/components/feedback/SkeletonLoader.tsx`

```tsx
// src/components/feedback/SkeletonLoader.tsx
interface SkeletonLoaderProps {
  /** Shape of the skeleton */
  shape?: "rectangle" | "circle" | "text";
  /** Width (CSS value, e.g., "100%", "200px") */
  width?: string;
  /** Height (CSS value, e.g., "16px", "2rem") */
  height?: string;
  /** Number of text lines to render (only for shape="text") */
  lines?: number;
  className?: string;
}

export function SkeletonLoader({
  shape = "rectangle",
  width = "100%",
  height,
  lines = 3,
  className = "",
}: SkeletonLoaderProps) {
  if (shape === "circle") {
    const size = height ?? "40px";
    return (
      <div
        className={`animate-pulse rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  if (shape === "text") {
    return (
      <div className={`space-y-2 ${className}`} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded bg-gray-200 dark:bg-gray-700"
            style={{
              width: i === lines - 1 ? "60%" : width,
              height: height ?? "12px",
            }}
          />
        ))}
      </div>
    );
  }

  // Rectangle (default)
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      style={{ width, height: height ?? "16px" }}
      aria-hidden="true"
    />
  );
}
```

**Commit:** `feat(components): add SkeletonLoader with rectangle, circle, and text shapes`

---

### T13. ErrorBanner

- [ ] **Step T13.1:** Create `src/components/feedback/ErrorBanner.tsx`

```tsx
// src/components/feedback/ErrorBanner.tsx
interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = "Try again",
  className = "",
}: ErrorBannerProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30 ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {message}
        </p>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-4 flex-shrink-0 rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/50"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
```

**Commit:** `feat(components): add ErrorBanner with retry button slot`

---

### T14. ConfirmDialog

- [ ] **Step T14.1:** Create `src/components/forms/ConfirmDialog.tsx`

```tsx
// src/components/forms/ConfirmDialog.tsx
"use client";

import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel button when dialog opens
  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  const confirmButtonClass =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
      : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
      >
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-description"
          className="mt-2 text-sm text-gray-600 dark:text-gray-400"
        >
          {description}
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${confirmButtonClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Commit:** `feat(components): add ConfirmDialog modal with danger variant`

---

## Phase C: Integration Merge

> **Branch:** `feature/phase-2`
> **Sequential — after both Phase B agents complete**

- [ ] **Step C1:** Merge `feature/phase-2-layout` into `feature/phase-2`

```bash
git checkout feature/phase-2
git merge feature/phase-2-layout --no-ff -m "chore(merge): integrate layout agent output into phase-2"
```

- [ ] **Step C2:** Merge `feature/phase-2-pages` into `feature/phase-2`

```bash
git merge feature/phase-2-pages --no-ff -m "chore(merge): integrate pages agent output into phase-2"
```

- [ ] **Step C3:** Merge `feature/phase-2-tdd` into `feature/phase-2`

```bash
git merge feature/phase-2-tdd --no-ff -m "chore(merge): integrate TDD agent output into phase-2"
```

- [ ] **Step C4:** Resolve any import conflicts (Pages Agent may reference `EmptyState` differently)

If placeholder pages imported an inline EmptyState, update imports to use:
```tsx
import { EmptyState } from "@/components/data/EmptyState";
```

- [ ] **Step C5:** Run integration verification

```bash
npx tsc --noEmit
# Expected: Exit 0

npx vitest --run
# Expected: 7/7 new tests pass (SeverityBadge 3, DataTable 3, Toast 1) + prior phase tests

npm run build
# Expected: Exit 0

npm run lint
# Expected: Exit 0
```

**Commit (if conflict resolution needed):** `fix(phase-2): resolve merge conflicts and update EmptyState imports`

---

## Verification Checklist

After all merges, verify each acceptance criterion:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest --run` -- 7 new tests pass (3 SeverityBadge + 3 DataTable + 1 Toast)
- [ ] `npm run build` exits 0
- [ ] `npm run lint` exits 0
- [ ] `/auth/sign-in` renders Google, GitHub, and magic link options
- [ ] Error codes render correct messages (OAuthAccountNotLinked [AAP-F11], Verification [AAP-F8])
- [ ] `/auth/verify-request` shows resend throttle and troubleshooting tips
- [ ] `/dashboard` redirects to `/dashboard/articles`
- [ ] All 6 dashboard routes render placeholder pages with EmptyState
- [ ] Sidebar highlights active route via `usePathname()`
- [ ] UserMenu shows avatar/initials, name, email, plan badge, sign-out
- [ ] Dark mode toggles correctly (class strategy, localStorage, system preference)
- [ ] Sidebar collapses on mobile viewport
- [ ] DataTable includes `renderMobileCard` prop [AAP-F6]

---

## File Summary

### Layout Agent (9 files)

| File | Task |
|------|------|
| `src/components/ThemeProvider.tsx` | 2.7 |
| `src/app/layout.tsx` (modify) | 2.1 |
| `src/components/layout/PageContainer.tsx` | 2.3 |
| `src/components/layout/UserMenu.tsx` | 2.3 |
| `src/components/layout/Header.tsx` | 2.3 |
| `src/components/layout/Sidebar.tsx` | 2.3 |
| `src/components/layout/AppShell.tsx` | 2.3 |
| `src/components/layout/AuthLayout.tsx` | 2.3 |
| `src/app/dashboard/layout.tsx` | 2.4 |

### Pages Agent (9 files)

| File | Task |
|------|------|
| `src/app/auth/sign-in/page.tsx` | 2.2 |
| `src/app/auth/verify-request/page.tsx` | 2.2 |
| `src/app/dashboard/page.tsx` | 2.5 |
| `src/app/dashboard/articles/page.tsx` | 2.5 |
| `src/app/dashboard/articles/[id]/page.tsx` | 2.5 |
| `src/app/dashboard/runs/page.tsx` | 2.5 |
| `src/app/dashboard/analyze/page.tsx` | 2.5 |
| `src/app/dashboard/ingest/page.tsx` | 2.5 |
| `src/app/dashboard/settings/page.tsx` | 2.5 |

### TDD Agent (17 files)

| File | Task |
|------|------|
| `tests/components/data/SeverityBadge.test.tsx` | 2.6 (RED) |
| `src/components/data/SeverityBadge.tsx` | 2.6 (GREEN) |
| `tests/components/data/DataTable.test.tsx` | 2.6 (RED) |
| `src/components/data/DataTable.tsx` | 2.6 (GREEN) |
| `tests/components/feedback/Toast.test.tsx` | 2.6 (RED) |
| `src/components/feedback/ToastProvider.tsx` | 2.6 (GREEN) |
| `src/components/feedback/Toast.tsx` | 2.6 (GREEN) |
| `src/components/data/StatusBadge.tsx` | 2.6 |
| `src/components/data/EmptyState.tsx` | 2.6 |
| `src/components/data/Pagination.tsx` | 2.6 |
| `src/components/feedback/ProgressBar.tsx` | 2.6 |
| `src/components/feedback/Spinner.tsx` | 2.6 |
| `src/components/feedback/SkeletonLoader.tsx` | 2.6 |
| `src/components/feedback/ErrorBanner.tsx` | 2.6 |
| `src/components/forms/ConfirmDialog.tsx` | 2.6 |

**Total: 35 files (9 layout + 9 pages + 17 TDD)**

---

## Commit Log (expected order)

| # | Agent | Commit Message |
|---|-------|----------------|
| 1 | Setup | `chore(deps): add class-variance-authority for UI component variants` |
| 2 | Layout | `feat(theme): add ThemeProvider with dark mode class strategy and system preference` |
| 3 | Layout | `feat(layout): configure root layout with SessionProvider, ThemeProvider, and Inter font` |
| 4 | Layout | `feat(layout): add AppShell, Sidebar, Header, UserMenu, AuthLayout, and PageContainer` |
| 5 | Layout | `feat(layout): add dashboard layout wrapping routes with AppShell` |
| 6 | Pages | `feat(auth): add sign-in page with OAuth buttons, magic link, and error code mapping` |
| 7 | Pages | `feat(auth): add verify-request page with resend throttle and troubleshooting tips` |
| 8 | Pages | `feat(dashboard): add redirect and 6 placeholder pages with EmptyState` |
| 9 | TDD | `test(components): add failing SeverityBadge tests (RED)` |
| 10 | TDD | `feat(components): implement SeverityBadge with cva variants (GREEN)` |
| 11 | TDD | `test(components): add failing DataTable tests (RED)` |
| 12 | TDD | `feat(components): implement DataTable with sort, skeletons, mobile cards (GREEN)` |
| 13 | TDD | `test(components): add failing Toast auto-dismiss test (RED)` |
| 14 | TDD | `feat(components): implement Toast and ToastProvider with auto-dismiss (GREEN)` |
| 15 | TDD | `feat(components): add StatusBadge with cva variants and running spinner` |
| 16 | TDD | `feat(components): add EmptyState with title, description, and optional CTA` |
| 17 | TDD | `feat(components): add Pagination with prev/next and page indicator` |
| 18 | TDD | `feat(components): add ProgressBar and Spinner feedback components` |
| 19 | TDD | `feat(components): add SkeletonLoader with rectangle, circle, and text shapes` |
| 20 | TDD | `feat(components): add ErrorBanner with retry button slot` |
| 21 | TDD | `feat(components): add ConfirmDialog modal with danger variant` |
| 22 | Merge | `chore(merge): integrate layout agent output into phase-2` |
| 23 | Merge | `chore(merge): integrate pages agent output into phase-2` |
| 24 | Merge | `chore(merge): integrate TDD agent output into phase-2` |
