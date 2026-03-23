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
    theme === "system" ? "\uD83D\uDCBB" : resolvedTheme === "dark" ? "\uD83C\uDF19" : "\u2600\uFE0F";
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
