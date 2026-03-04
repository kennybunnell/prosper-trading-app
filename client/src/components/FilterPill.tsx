import React from 'react';
import { cn } from '@/lib/utils';

interface FilterPillProps {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
  variant?: 'default' | 'green' | 'red' | 'yellow' | 'orange' | 'sky' | 'amber' | 'purple';
  disabled?: boolean;
  title?: string;
}

const variantStyles: Record<string, { base: string; active: string; badge: string }> = {
  default: {
    base: 'border-white/10 text-muted-foreground hover:border-white/30 hover:text-white',
    active: 'border-orange-500 bg-orange-500/15 text-orange-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-orange-500/30 group-[.active]:text-orange-200',
  },
  green: {
    base: 'border-white/10 text-muted-foreground hover:border-green-500/50 hover:text-green-400',
    active: 'border-green-500 bg-green-500/15 text-green-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-green-500/30 group-[.active]:text-green-200',
  },
  red: {
    base: 'border-white/10 text-muted-foreground hover:border-red-500/50 hover:text-red-400',
    active: 'border-red-500 bg-red-500/15 text-red-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-red-500/30 group-[.active]:text-red-200',
  },
  yellow: {
    base: 'border-white/10 text-muted-foreground hover:border-yellow-500/50 hover:text-yellow-400',
    active: 'border-yellow-500 bg-yellow-500/15 text-yellow-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-yellow-500/30 group-[.active]:text-yellow-200',
  },
  orange: {
    base: 'border-white/10 text-muted-foreground hover:border-orange-500/50 hover:text-orange-400',
    active: 'border-orange-500 bg-orange-500/15 text-orange-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-orange-500/30 group-[.active]:text-orange-200',
  },
  sky: {
    base: 'border-white/10 text-muted-foreground hover:border-sky-500/50 hover:text-sky-400',
    active: 'border-sky-500 bg-sky-500/15 text-sky-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-sky-500/30 group-[.active]:text-sky-200',
  },
  amber: {
    base: 'border-white/10 text-muted-foreground hover:border-amber-500/50 hover:text-amber-400',
    active: 'border-amber-500 bg-amber-500/15 text-amber-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-amber-500/30 group-[.active]:text-amber-200',
  },
  purple: {
    base: 'border-white/10 text-muted-foreground hover:border-purple-500/50 hover:text-purple-400',
    active: 'border-purple-500 bg-purple-500/15 text-purple-300',
    badge: 'bg-white/10 text-white/60 group-[.active]:bg-purple-500/30 group-[.active]:text-purple-200',
  },
};

/**
 * FilterPill — a clickable pill filter with an optional count badge.
 * Click to select, click again to deselect.
 * Used consistently across all automation tabs.
 */
export function FilterPill({
  label,
  count,
  selected,
  onClick,
  variant = 'default',
  disabled = false,
  title,
}: FilterPillProps) {
  const styles = variantStyles[variant] ?? variantStyles.default;

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium',
        'transition-all duration-150 cursor-pointer select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        selected ? ['active', styles.active] : styles.base,
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold transition-colors',
            selected ? (variant === 'default' ? 'bg-orange-500/30 text-orange-200' : `bg-${variant}-500/30 text-${variant}-200`) : 'bg-white/10 text-white/60',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default FilterPill;
