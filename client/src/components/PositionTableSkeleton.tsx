/**
 * PositionTableSkeleton — Prosper Trading
 *
 * Reusable skeleton loader for pages that fetch live positions from Tastytrade.
 * Use when isLoading=true to prevent blank-screen flash during the 1-3s API call.
 */
import { Skeleton } from '@/components/ui/skeleton';

interface PositionTableSkeletonProps {
  /** Number of skeleton rows to render (default 5) */
  rows?: number;
  /** Number of columns to render (default 7) */
  cols?: number;
  /** Optional title shown above the skeleton */
  title?: string;
  /** Show a header bar skeleton (default true) */
  showHeader?: boolean;
}

export function PositionTableSkeleton({
  rows = 5,
  cols = 7,
  title,
  showHeader = true,
}: PositionTableSkeletonProps) {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Optional title + refresh button area */}
      {showHeader && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            {title ? (
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
            ) : (
              <Skeleton className="h-5 w-40" />
            )}
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      )}

      {/* Filter / tab bar */}
      <div className="flex gap-2">
        {[80, 96, 72].map((w, i) => (
          <Skeleton key={i} className={`h-8 w-${w === 80 ? '20' : w === 96 ? '24' : '18'} rounded-md`} />
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Table header */}
        <div className="bg-muted/40 px-4 py-3 grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full max-w-[80px]" />
          ))}
        </div>

        {/* Table rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="px-4 py-3 grid gap-3 border-t border-border/50"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {Array.from({ length: cols }).map((_, colIdx) => (
              <Skeleton
                key={colIdx}
                className="h-4"
                style={{ width: `${60 + ((rowIdx * 7 + colIdx * 13) % 35)}%` }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Summary bar */}
      <div className="flex gap-6 pt-1">
        {[120, 100, 140].map((w, i) => (
          <Skeleton key={i} className="h-4" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

/**
 * CardsSkeleton — for card-grid layouts (e.g. LEAP position cards)
 */
export function PositionCardsSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4">
            {/* Card header */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-16 rounded-full" />
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-8 flex-1 rounded-md" />
              <Skeleton className="h-8 flex-1 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * InlineSpinner — tiny inline loading indicator for buttons/labels
 */
export function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-4 w-4 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
