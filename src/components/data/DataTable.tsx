// src/components/data/DataTable.tsx
"use client";

import { useState, useMemo } from "react";

export interface ColumnDef<T> {
  key: keyof T & string;
  header: string;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  key: string | null;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  renderMobileCard: (row: T) => React.ReactNode; // [AAP-F6]
  loading?: boolean;
  skeletonRows?: number;
  emptyMessage?: string;
  emptyContent?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  renderMobileCard,
  loading = false,
  skeletonRows = 5,
  emptyMessage = "No data",
  emptyContent,
  className = "",
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>({ key: null, direction: null });

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    setSort((prev) => {
      if (prev.key === key) {
        const next: SortDirection =
          prev.direction === "asc"
            ? "desc"
            : prev.direction === "desc"
              ? null
              : "asc";
        return { key: next ? key : null, direction: next };
      }
      return { key, direction: "asc" };
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort.key || !sort.direction) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sort.key as keyof T];
      const bVal = b[sort.key as keyof T];
      if (aVal < bVal) return sort.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, sort]);

  // Loading skeleton
  if (loading) {
    return (
      <div className={`w-full ${className}`}>
        {/* Desktop skeleton */}
        <div className="hidden md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <tr
                  key={i}
                  data-testid="skeleton-row"
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile skeleton */}
        <div className="space-y-3 md:hidden">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <div
              key={i}
              data-testid="skeleton-row"
              className="animate-pulse rounded-lg border border-gray-200 p-4 dark:border-gray-700"
            >
              <div className="mb-2 h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (rows.length === 0) {
    return (
      <div className={`w-full ${className}`}>
        {emptyContent ?? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            {emptyMessage}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${
                    col.sortable ? "cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200" : ""
                  } ${col.className ?? ""}`}
                  onClick={() => handleSort(col.key, col.sortable)}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable && sort.key === col.key && (
                      <span aria-hidden="true">
                        {sort.direction === "asc" ? "\u2191" : "\u2193"}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={getRowId(row)}
                className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-gray-900 dark:text-gray-100 ${col.className ?? ""}`}
                  >
                    {col.render
                      ? col.render(row[col.key], row)
                      : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards [AAP-F6] */}
      <div className="space-y-3 md:hidden">
        {sortedRows.map((row) => (
          <div
            key={getRowId(row)}
            className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            {renderMobileCard(row)}
          </div>
        ))}
      </div>
    </div>
  );
}
