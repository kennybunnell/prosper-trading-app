/**
 * AIRowIcon — Shared component for per-row AI explanation/analysis icon buttons.
 *
 * Usage:
 *   <AIRowIcon
 *     isLoading={analyzingRowKey === rowKey}
 *     onClick={() => { setAnalyzingRowKey(rowKey); explainScore.mutate({ ... }); }}
 *     title="Click to see AI explanation of this score"
 *   />
 */

import { Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AIRowIconProps {
  isLoading?: boolean;
  onClick: (e?: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  className?: string;
  /** Size variant: 'sm' (default) or 'xs' for very compact rows */
  size?: 'sm' | 'xs';
}

export function AIRowIcon({
  isLoading = false,
  onClick,
  title = 'Click for AI analysis',
  disabled = false,
  className,
  size = 'sm',
}: AIRowIconProps) {
  const iconSize = size === 'xs' ? 'w-3 h-3' : 'w-4 h-4';
  const btnSize = size === 'xs' ? 'h-5 w-5' : 'h-6 w-6';

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        btnSize,
        'p-0 rounded-full',
        'text-violet-400/70 hover:text-violet-300 hover:bg-violet-500/15',
        'transition-all duration-150',
        className
      )}
      onClick={onClick}
      disabled={disabled || isLoading}
      title={title}
    >
      {isLoading ? (
        <Loader2 className={cn(iconSize, 'animate-spin text-violet-400')} />
      ) : (
        <Sparkles className={cn(iconSize)} />
      )}
    </Button>
  );
}
