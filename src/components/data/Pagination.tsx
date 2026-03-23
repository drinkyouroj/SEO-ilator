// src/components/data/Pagination.tsx
"use client";

interface PaginationProps {
  /** Current cursor / page identifier */
  currentPage: number;
  /** Total number of pages (if known) */
  totalPages?: number;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Whether there is a previous page */
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  hasNextPage,
  hasPrevPage,
  onNextPage,
  onPrevPage,
  className = "",
}: PaginationProps) {
  const pageIndicator = totalPages
    ? `Page ${currentPage} of ${totalPages}`
    : `Page ${currentPage}`;

  return (
    <div
      className={`flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700 ${className}`}
    >
      <button
        onClick={onPrevPage}
        disabled={!hasPrevPage}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Previous
      </button>

      <span className="text-sm text-gray-500 dark:text-gray-400">
        {pageIndicator}
      </span>

      <button
        onClick={onNextPage}
        disabled={!hasNextPage}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
      >
        Next
      </button>
    </div>
  );
}
