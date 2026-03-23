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
