export default function SettingsLoading() {
  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div className="space-y-2">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      {/* Strategy section skeleton */}
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="h-2 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      {/* Account section skeleton */}
      <div className="space-y-4">
        <div className="h-6 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="h-4 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  );
}
