/**
 * Risk Badge Component
 * Displays risk badges with tooltips for trading opportunities
 */

import { RiskBadge as RiskBadgeType } from '../../../shared/riskBadges';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

interface RiskBadgeProps {
  badge: RiskBadgeType;
  size?: 'sm' | 'md' | 'lg';
}

export function RiskBadge({ badge, size = 'sm' }: RiskBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const severityClasses = {
    positive: 'bg-green-500/20 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    danger: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <span
            className={`
              inline-flex items-center gap-1 rounded-md border font-medium
              transition-colors cursor-help whitespace-nowrap
              ${sizeClasses[size]}
              ${severityClasses[badge.severity]}
            `}
            style={{ display: 'inline-flex', visibility: 'visible', opacity: 1 }}
          >
            <span>{badge.emoji}</span>
            <span>{badge.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-xs bg-popover/95 backdrop-blur-sm border-border"
        >
          <p className="text-sm">{badge.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface RiskBadgeListProps {
  badges: RiskBadgeType[];
  size?: 'sm' | 'md' | 'lg';
  maxDisplay?: number;
}

export function RiskBadgeList({ badges, size = 'sm', maxDisplay }: RiskBadgeListProps) {
  console.log('[RiskBadgeList] Rendering with badges:', badges);
  if (!badges || badges.length === 0) {
    console.log('[RiskBadgeList] No badges to display');
    return null;
  }

  const displayBadges = maxDisplay ? badges.slice(0, maxDisplay) : badges;
  const remainingCount = maxDisplay && badges.length > maxDisplay ? badges.length - maxDisplay : 0;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {displayBadges.map((badge, index) => (
        <RiskBadge key={`${badge.type}-${index}`} badge={badge} size={size} />
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-muted-foreground">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}
