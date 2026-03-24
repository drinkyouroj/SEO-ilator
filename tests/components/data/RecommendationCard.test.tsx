import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationCard } from "@/components/data/RecommendationCard";

const mockRec = {
  id: "rec-1",
  sourceArticleId: "a1",
  targetArticleId: "a2",
  type: "crosslink",
  severity: "warning" as const,
  title: 'Link to "Target Article"',
  description: "Found keyword match in body text.",
  anchorText: "Target Article",
  confidence: 0.85,
  matchingApproach: "keyword",
  status: "pending",
  targetUrl: "https://example.com/target",
  updatedAt: new Date().toISOString(),
};

describe("RecommendationCard", () => {
  it("renders_severity_badge_correctly", () => {
    render(<RecommendationCard recommendation={mockRec} onAccept={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("warning")).toBeDefined();
  });

  it("calls_accept_callback_on_accept_click", () => {
    const onAccept = vi.fn();
    render(<RecommendationCard recommendation={mockRec} onAccept={onAccept} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onAccept).toHaveBeenCalledWith("rec-1");
  });

  it("calls_dismiss_callback_on_dismiss_click", () => {
    const onDismiss = vi.fn();
    render(<RecommendationCard recommendation={mockRec} onAccept={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith("rec-1");
  });
});
