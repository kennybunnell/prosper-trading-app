import { useState } from "react";
import { HelpCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface HelpDialogProps {
  title: string;
  content: React.ReactNode;
  className?: string;
}

/**
 * HelpDialog component - displays a small info icon that opens a dialog with detailed help content
 * Used for complex topics that need more space than a tooltip (formulas, examples, tables, etc.)
 */
export function HelpDialog({ title, content, className = "" }: HelpDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <HelpCircle 
          className={`inline-block w-3.5 h-3.5 ml-1 text-muted-foreground hover:text-primary cursor-help transition-colors ${className}`}
        />
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription asChild>
          <div className="text-sm leading-relaxed space-y-4">
            {content}
          </div>
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
