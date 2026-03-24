// tests/components/accessibility/FocusNavigation.test.tsx
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

import { ThresholdSlider } from "@/components/forms/ThresholdSlider";
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

describe("FocusNavigation — accessibility attributes", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  it("applies_focus_visible_ring_to_interactive_elements", () => {
    const onChange = vi.fn();
    render(
      <ThresholdSlider
        name="threshold"
        label="Threshold"
        value={0.5}
        min={0}
        max={1}
        onChange={onChange}
      />
    );

    const slider = screen.getByRole("slider");
    expect(slider.className).toContain("focus-visible:ring-2");
  });

  it("sidebar_nav_links_have_accessible_labels", () => {
    const onToggle = vi.fn();

    // Pathname is mocked to "/dashboard/articles", so Articles link should be active
    render(<Sidebar collapsed={false} onToggle={onToggle} />);

    // The active link (Articles) should have aria-current="page"
    const articlesLink = screen.getByText("Articles").closest("a");
    expect(articlesLink).toBeDefined();
    expect(articlesLink!.getAttribute("aria-current")).toBe("page");

    // Non-active links should not have aria-current
    const analyzeLink = screen.getByText("Analyze").closest("a");
    expect(analyzeLink).toBeDefined();
    expect(analyzeLink!.getAttribute("aria-current")).toBeNull();
  });

  it("provides_aria_labels_on_icon_only_buttons", () => {
    mockMatchMedia(false);
    const onToggleSidebar = vi.fn();

    render(
      <ThemeProvider defaultTheme="light">
        <Header
          title="Test Page"
          onToggleSidebar={onToggleSidebar}
          sidebarCollapsed={true}
        />
      </ThemeProvider>
    );

    // Hamburger button should have aria-label
    const hamburger = screen.getByLabelText("Open sidebar");
    expect(hamburger).toBeDefined();
    expect(hamburger.getAttribute("aria-label")).toBe("Open sidebar");

    // Theme toggle should also have an aria-label
    const themeButton = screen.getByLabelText(/Current theme/);
    expect(themeButton).toBeDefined();
    expect(themeButton.getAttribute("aria-label")).toBeTruthy();
  });
});
