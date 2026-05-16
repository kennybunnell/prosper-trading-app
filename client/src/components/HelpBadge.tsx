import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HelpBadgeProps {
  content: string | React.ReactNode;
  className?: string;
}

/**
 * HelpBadge component - displays a small info icon with tooltip
 * Used for inline help text on table headers, labels, etc.
 *
 * NOTE: TooltipContent default uses bg-foreground/text-background which inverts
 * the theme. For rich JSX content (colored borders, muted text, bg-muted blocks)
 * we override to bg-popover/text-popover-foreground so all child classes resolve
 * correctly against the card/dialog theme in both light and dark mode.
 */
export function HelpBadge({ content, className = "" }: HelpBadgeProps) {
  const isRichContent = typeof content !== 'string';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle 
            className={`inline-block w-3.5 h-3.5 ml-1 text-muted-foreground hover:text-primary cursor-help transition-colors ${className}`}
          />
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          sideOffset={5}
          className={
            isRichContent
              ? "max-w-sm p-4 text-sm leading-relaxed bg-popover text-popover-foreground border border-border shadow-xl"
              : "max-w-sm p-3 text-sm leading-relaxed"
          }
        >
          {typeof content === 'string' ? (
            <div className="whitespace-pre-line">{content}</div>
          ) : (
            content
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
