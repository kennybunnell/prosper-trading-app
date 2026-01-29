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
 */
export function HelpBadge({ content, className = "" }: HelpBadgeProps) {
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
          className="max-w-sm p-4 text-sm leading-relaxed"
          sideOffset={5}
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
