// src/components/data/SeverityBadge.tsx
import { cva, type VariantProps } from "class-variance-authority";

const severityBadgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
  {
    variants: {
      severity: {
        critical:
          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
        warning:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
        info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
      },
    },
    defaultVariants: {
      severity: "info",
    },
  }
);

export interface SeverityBadgeProps
  extends VariantProps<typeof severityBadgeVariants> {
  severity: "critical" | "warning" | "info";
  className?: string;
}

export function SeverityBadge({ severity, className = "" }: SeverityBadgeProps) {
  return (
    <span
      className={`${severityBadgeVariants({ severity })} ${className}`.trim()}
      aria-label={`Severity: ${severity}`}
    >
      {severity}
    </span>
  );
}
