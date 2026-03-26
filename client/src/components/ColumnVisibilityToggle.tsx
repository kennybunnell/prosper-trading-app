import { useState } from "react";
import { Columns3, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ColumnDef {
  key: string;
  label: string;
  group: "Core" | "Position" | "Returns" | "Greeks" | "Technical" | "Liquidity" | "Quote";
  /** If true, column cannot be hidden */
  pinned?: boolean;
  /** If true, column is visible by default */
  defaultVisible: boolean;
}

interface ColumnVisibilityToggleProps {
  columns: ColumnDef[];
  visibleColumns: Set<string>;
  onVisibilityChange: (key: string, visible: boolean) => void;
  /** Called when user clicks "Reset to defaults" */
  onReset?: () => void;
}

const GROUP_ORDER: ColumnDef["group"][] = [
  "Core",
  "Position",
  "Returns",
  "Greeks",
  "Technical",
  "Liquidity",
  "Quote",
];

const GROUP_COLORS: Record<ColumnDef["group"], string> = {
  Core:      "text-amber-400",
  Position:  "text-blue-400",
  Returns:   "text-green-400",
  Greeks:    "text-purple-400",
  Technical: "text-cyan-400",
  Liquidity: "text-orange-400",
  Quote:     "text-slate-400",
};

export function ColumnVisibilityToggle({
  columns,
  visibleColumns,
  onVisibilityChange,
  onReset,
}: ColumnVisibilityToggleProps) {
  const [open, setOpen] = useState(false);

  const hiddenCount = columns.filter(
    (c) => !c.pinned && !visibleColumns.has(c.key)
  ).length;

  const toggleableColumns = columns.filter((c) => !c.pinned);

  // Check if current state matches defaults (for Reset button disabled state)
  const defaultKeys = new Set(columns.filter((c) => c.pinned || c.defaultVisible).map((c) => c.key));
  const isAtDefault =
    defaultKeys.size === visibleColumns.size &&
    Array.from(defaultKeys).every((k) => visibleColumns.has(k));

  // Group columns
  const grouped = GROUP_ORDER.reduce<Record<string, ColumnDef[]>>((acc, g) => {
    const cols = toggleableColumns.filter((c) => c.group === g);
    if (cols.length > 0) acc[g] = cols;
    return acc;
  }, {});

  const allVisible = toggleableColumns.every((c) => visibleColumns.has(c.key));
  const noneVisible = toggleableColumns.every((c) => !visibleColumns.has(c.key));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "relative gap-2 text-xs h-8 px-3 border-border/50 hover:border-primary/50 transition-colors",
            hiddenCount > 0 && "border-amber-500/40 text-amber-400 hover:border-amber-500/70"
          )}
        >
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          {hiddenCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-black text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {hiddenCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 bg-card border-border/60 shadow-xl"
        align="end"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/40">
          <span className="text-sm font-semibold text-foreground">Column Visibility</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => toggleableColumns.forEach((c) => onVisibilityChange(c.key, true))}
              disabled={allVisible}
              className="text-[11px] text-muted-foreground hover:text-primary disabled:opacity-40 transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
            >
              Show all
            </button>
            <span className="text-muted-foreground/40">|</span>
            <button
              onClick={() => toggleableColumns.forEach((c) => onVisibilityChange(c.key, false))}
              disabled={noneVisible}
              className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors px-1.5 py-0.5 rounded hover:bg-destructive/10"
            >
              Hide all
            </button>
          </div>
        </div>

        {/* Groups */}
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {Object.entries(grouped).map(([group, cols]) => (
            <div key={group}>
              <div className={cn("text-[10px] font-semibold uppercase tracking-wider mb-1.5", GROUP_COLORS[group as ColumnDef["group"]])}>
                {group}
              </div>
              <div className="space-y-0.5">
                {cols.map((col) => {
                  const isVisible = visibleColumns.has(col.key);
                  return (
                    <button
                      key={col.key}
                      onClick={() => onVisibilityChange(col.key, !isVisible)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors text-left",
                        isVisible
                          ? "text-foreground hover:bg-accent/50"
                          : "text-muted-foreground hover:bg-accent/30"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors",
                        isVisible
                          ? "bg-primary border-primary"
                          : "border-border/60"
                      )}>
                        {isVisible && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      <span>{col.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer: Reset to defaults */}
        <div className="mt-3 pt-2 border-t border-border/40 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/60">
            Pinned columns always visible. Saved automatically.
          </span>
          {onReset && (
            <button
              onClick={() => { onReset(); }}
              disabled={isAtDefault}
              className={cn(
                "flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors",
                isAtDefault
                  ? "text-muted-foreground/30 cursor-not-allowed"
                  : "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
              )}
              title="Reset to default column visibility"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Hook to manage column visibility state with localStorage persistence.
 */
export function useColumnVisibility(
  columns: ColumnDef[],
  storageKey: string
): [Set<string>, (key: string, visible: boolean) => void, (keys: Set<string>) => void, () => void] {
  const defaultKeys = new Set(columns.filter((c) => c.pinned || c.defaultVisible).map((c) => c.key));

  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed: string[] = JSON.parse(stored);
        return new Set(parsed);
      }
    } catch {
      // ignore
    }
    return new Set(defaultKeys);
  });

  const setVisibility = (key: string, visible: boolean) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (visible) {
        next.add(key);
      } else {
        next.delete(key);
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const setAll = (keys: Set<string>) => {
    setVisibleColumns(keys);
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(keys)));
    } catch {
      // ignore
    }
  };

  const resetToDefaults = () => {
    setVisibleColumns(new Set(defaultKeys));
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  };

  return [visibleColumns, setVisibility, setAll, resetToDefaults];
}
