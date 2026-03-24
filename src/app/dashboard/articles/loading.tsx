export default function ArticlesLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
          >
            <div className="h-4 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-1/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
