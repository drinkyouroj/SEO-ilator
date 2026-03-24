// tests/components/responsive/MobileCardLayout.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard/articles"),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

// Mock next-auth/react (used by UserMenu inside Header)
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
  signOut: vi.fn(),
}));

// Mock next/link to render a plain anchor
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { ThemeProvider } from "@/components/ThemeProvider";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("MobileCardLayout — responsive rendering", () => {
  beforeEach(() => {
    // Default to mobile (no match for min-width: 768px)
    mockMatchMedia(false);
  });

  it("renders_card_layout_below_md_breakpoint", () => {
    mockMatchMedia(false);
    const onToggle = vi.fn();

    const { container } = render(<Sidebar collapsed={true} onToggle={onToggle} />);

    const aside = container.querySelector("aside");
    expect(aside).toBeDefined();
    // When collapsed on mobile, sidebar should have -translate-x-full class
    expect(aside!.className).toContain("-translate-x-full");
  });

  it("renders_sidebar_visible_at_md_breakpoint", () => {
    mockMatchMedia(true);
    const onToggle = vi.fn();

    const { container } = render(<Sidebar collapsed={false} onToggle={onToggle} />);

    const aside = container.querySelector("aside");
    expect(aside).toBeDefined();
    // When not collapsed, sidebar should have translate-x-0 and w-64
    expect(aside!.className).toContain("translate-x-0");
    expect(aside!.className).toContain("w-64");
  });

  it("shows_hamburger_button_in_header", () => {
    mockMatchMedia(false);
    const onToggleSidebar = vi.fn();

    render(
      <ThemeProvider defaultTheme="light">
        <Header
          title="Dashboard"
          onToggleSidebar={onToggleSidebar}
          sidebarCollapsed={true}
        />
      </ThemeProvider>
    );

    const hamburger = screen.getByLabelText("Open sidebar");
    expect(hamburger).toBeDefined();
    expect(hamburger.tagName).toBe("BUTTON");
  });
});
