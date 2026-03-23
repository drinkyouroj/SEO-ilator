// src/components/feedback/SkeletonLoader.tsx
interface SkeletonLoaderProps {
  /** Shape of the skeleton */
  shape?: "rectangle" | "circle" | "text";
  /** Width (CSS value, e.g., "100%", "200px") */
  width?: string;
  /** Height (CSS value, e.g., "16px", "2rem") */
  height?: string;
  /** Number of text lines to render (only for shape="text") */
  lines?: number;
  className?: string;
}

export function SkeletonLoader({
  shape = "rectangle",
  width = "100%",
  height,
  lines = 3,
  className = "",
}: SkeletonLoaderProps) {
  if (shape === "circle") {
    const size = height ?? "40px";
    return (
      <div
        className={`animate-pulse rounded-full bg-gray-200 dark:bg-gray-700 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  if (shape === "text") {
    return (
      <div className={`space-y-2 ${className}`} aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded bg-gray-200 dark:bg-gray-700"
            style={{
              width: i === lines - 1 ? "60%" : width,
              height: height ?? "12px",
            }}
          />
        ))}
      </div>
    );
  }

  // Rectangle (default)
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`}
      style={{ width, height: height ?? "16px" }}
      aria-hidden="true"
    />
  );
}
