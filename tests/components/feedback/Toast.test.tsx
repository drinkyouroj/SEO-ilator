// tests/components/feedback/Toast.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/feedback/ToastProvider";

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
