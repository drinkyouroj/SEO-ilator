export default function RunsLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3">
          <div className="flex gap-8">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            ))}
          </div>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-8 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
    </div>
  );
}
