"use client";

import { SeverityBadge } from "@/components/data/SeverityBadge";

interface RecommendationCardProps {
  recommendation: {
    id: string;
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
    anchorText?: string | null;
    confidence: number;
    matchingApproach?: string | null;
    status: string;
    targetUrl?: string;
    updatedAt: string;
  };
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function RecommendationCard({
  recommendation,
  onAccept,
  onDismiss,
}: RecommendationCardProps) {
  const { id, severity, title, description, anchorText, confidence, matchingApproach, status } =
    recommendation;

  const isPending = status === "pending";
  const confidencePct = Math.round(confidence * 100);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={severity} />
          {matchingApproach ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300 capitalize">
              {matchingApproach}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {confidencePct}% confidence
        </span>
      </div>

      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{description}</p>

      {anchorText ? (
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Anchor text:{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">&ldquo;{anchorText}&rdquo;</span>
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!isPending}
          onClick={() => onAccept(id)}
          className="inline-flex items-center rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white min-h-[44px] hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-green-700 dark:hover:bg-green-600"
          aria-label="Accept recommendation"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={!isPending}
          onClick={() => onDismiss(id)}
          className="inline-flex items-center rounded-md bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 min-h-[44px] hover:bg-gray-300 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          aria-label="Dismiss recommendation"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
