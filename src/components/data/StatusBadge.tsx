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
