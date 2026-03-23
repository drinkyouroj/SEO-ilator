// src/components/feedback/ErrorBanner.tsx
interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = "Try again",
  className = "",
}: ErrorBannerProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30 ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {message}
        </p>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-4 flex-shrink-0 rounded-md border border-red-300 px-3 py-1 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/50"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
