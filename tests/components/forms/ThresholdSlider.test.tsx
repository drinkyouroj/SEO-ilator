// tests/components/forms/ThresholdSlider.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThresholdSlider } from "@/components/forms/ThresholdSlider";

describe("ThresholdSlider", () => {
  it("renders_with_default_value", () => {
    const onChange = vi.fn();
    render(
      <ThresholdSlider
        name="similarity"
        label="Similarity Threshold"
        value={0.75}
        min={0}
        max={1}
        onChange={onChange}
      />
    );

    // The formatted value "0.75" should be displayed
    expect(screen.getByText("0.75")).toBeDefined();

    // The range input should have the correct value
    const slider = screen.getByRole("slider");
    expect(slider).toBeDefined();
    expect((slider as HTMLInputElement).value).toBe("0.75");
  });

  it("updates_value_on_change", () => {
    const onChange = vi.fn();
    render(
      <ThresholdSlider
        name="similarity"
        label="Similarity Threshold"
        value={0.5}
        min={0}
        max={1}
        onChange={onChange}
      />
    );

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.85" } });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith(0.85);
  });

  it("clamps_to_min_max_range", () => {
    const onChange = vi.fn();
    render(
      <ThresholdSlider
        name="similarity"
        label="Similarity Threshold"
        value={0.5}
        min={0.1}
        max={0.9}
        onChange={onChange}
      />
    );

    const slider = screen.getByRole("slider");

    // Fire change with value above max
    fireEvent.change(slider, { target: { value: "1.5" } });
    expect(onChange).toHaveBeenCalledWith(0.9);

    // Fire change with value below min
    fireEvent.change(slider, { target: { value: "-0.5" } });
    expect(onChange).toHaveBeenCalledWith(0.1);
  });
});
