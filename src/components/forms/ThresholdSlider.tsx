"use client";

import { useCallback } from "react";

interface ThresholdSliderProps {
  /** Unique name for the input (used for form submission and test targeting) */
  name: string;
  /** Human-readable label displayed above the slider */
  label: string;
  /** Current value */
  value: number;
  /** Minimum allowed value */
  min: number;
  /** Maximum allowed value */
  max: number;
  /** Step increment (default 0.01) */
  step?: number;
  /** Callback when value changes. Value is clamped to [min, max]. */
  onChange: (value: number) => void;
  /** Optional description text below the slider */
  description?: string;
  /** Whether the slider is disabled (e.g., plan-gated feature) */
  disabled?: boolean;
}

/**
 * A labeled range slider for numeric thresholds.
 *
 * Clamps values to [min, max] range. Displays current value as a formatted number.
 * Used in settings page for similarity threshold, fuzzy tolerance, etc.
 */
export function ThresholdSlider({
  name,
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  description,
  disabled = false,
}: ThresholdSliderProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      // Clamp to [min, max] range
      const clamped = Math.min(max, Math.max(min, raw));
      onChange(clamped);
    },
    [min, max, onChange]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor={name}
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {label}
        </label>
        <span
          className="text-sm font-mono text-gray-500 dark:text-gray-400"
          aria-live="polite"
        >
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        id={name}
        name={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        aria-label={`${label}: ${value.toFixed(2)}`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      />
      <div className="flex justify-between text-xs text-gray-400">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {description}
        </p>
      )}
    </div>
  );
}
