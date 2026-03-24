export default function AnalyzeLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-md bg-gray-50 dark:bg-gray-800 p-3 space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-8 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
