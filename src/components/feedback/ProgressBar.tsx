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
