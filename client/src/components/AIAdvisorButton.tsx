/**
 * AIAdvisorButton — Shared component for all full-width AI Advisor trigger buttons.
 *
 * Usage:
 *   <AIAdvisorButton
 *     isOpen={showAIAdvisor}
 *     onToggle={() => setShowAIAdvisor(!showAIAdvisor)}
 *     count={opportunities.length}
 *     label="Opportunities"   // optional, defaults to "items"
 *     disabled={opportunities.length === 0}
 *     disabledHint="Run a scan first to enable AI Advisor"
 *   />
 */

import { Sparkles, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AIAdvisorButtonProps {
  isOpen: boolean;
  onToggle: () => void;
  count?: number;
  label?: string;
  disabled?: boolean;
  disabledHint?: string;
  className?: string;
}

export function AIAdvisorButton({
  isOpen,
  onToggle,
  count,
  label = 'items',
  disabled = false,
  disabledHint = 'Run a scan first to enable AI Advisor',
  className,
}: AIAdvisorButtonProps) {
  const countLabel = count !== undefined ? `${count} ${label}` : label;

  return (
    <div className={cn('pt-2', className)}>
      <Button
        className={cn(
          'w-full font-semibold shadow-lg transition-all duration-200',
          isOpen
            ? 'bg-gradient-to-r from-violet-700 to-purple-700 hover:from-violet-600 hover:to-purple-600 text-white shadow-violet-900/40'
            : 'bg-gradient-to-r from-violet-600 to-purple-700 hover:from-violet-500 hover:to-purple-600 text-white hover:shadow-violet-900/40'
        )}
        size="default"
        onClick={onToggle}
        disabled={disabled}
      >
        {isOpen ? (
          <>
            <ChevronUp className="w-4 h-4 mr-2 shrink-0" />
            Hide AI Advisor
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2 shrink-0" />
            {`✨ AI Advisor — Analyze ${countLabel}`}
          </>
        )}
      </Button>
      {disabled && disabledHint && (
        <p className="text-xs text-muted-foreground text-center mt-1">{disabledHint}</p>
      )}
    </div>
  );
}
