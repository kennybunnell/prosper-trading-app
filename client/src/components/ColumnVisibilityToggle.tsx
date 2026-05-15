import { useState } from "react";
import { Columns3, Check, RotateCcw, Eye, EyeOff } from "lucide-react";
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
  Quote:     "text-slate-300",
};

const GROUP_BG: Record<ColumnDef["group"], string> = {
  Core:      "bg-amber-500/10 border-amber-500/30",
  Position:  "bg-blue-500/10 border-blue-500/30",
  Returns:   "bg-green-500/10 border-green-500/30",
  Greeks:    "bg-purple-500/10 border-purple-500/30",
  Technical: "bg-cyan-500/10 border-cyan-500/30",
  Liquidity: "bg-orange-500/10 border-orange-500/30",
  Quote:     "bg-slate-500/10 border-slate-400/30",
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
            "relative gap-2 text-xs h-8 px-3 border-border/50 hover:border-primary/50 transition-colors bg-background",
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
        className="w-80 p-0 bg-zinc-900 border-2 border-zinc-400 shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_8px_40px_rgba(0,0,0,0.8)] rounded-xl overflow-hidden"
        align="end"
        sideOffset={6}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-800 border-b-2 border-zinc-400">
          <span className="text-sm font-bold text-white tracking-wide">Column Visibility</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleableColumns.forEach((c) => onVisibilityChange(c.key, true))}
              disabled={allVisible}
              className={cn(
                "flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all",
                allVisible
                  ? "opacity-40 cursor-not-allowed border-zinc-600 text-zinc-500"
                  : "border-green-500/60 text-green-400 hover:bg-green-500/15 hover:border-green-400"
              )}
            >
              <Eye className="h-3 w-3" />
              Show all
            </button>
            <button
              onClick={() => toggleableColumns.forEach((c) => onVisibilityChange(c.key, false))}
              disabled={noneVisible}
              className={cn(
                "flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all",
                noneVisible
                  ? "opacity-40 cursor-not-allowed border-zinc-600 text-zinc-500"
                  : "border-red-500/60 text-red-400 hover:bg-red-500/15 hover:border-red-400"
              )}
            >
              <EyeOff className="h-3 w-3" />
              Hide all
            </button>
          </div>
        </div>

        {/* Groups */}
        <div className="space-y-3 max-h-80 overflow-y-auto p-3">
          {Object.entries(grouped).map(([group, cols]) => (
            <div key={group}>
              <div className={cn(
                "text-[10px] font-bold uppercase tracking-widest mb-1.5 px-1",
                GROUP_COLORS[group as ColumnDef["group"]]
              )}>
                {group}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {cols.map((col) => {
                  const isVisible = visibleColumns.has(col.key);
                  return (
                    <button
                      key={col.key}
                      onClick={() => onVisibilityChange(col.key, !isVisible)}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left border-2",
                        isVisible
                          ? cn("text-white border-zinc-300 bg-zinc-700 hover:bg-zinc-600 hover:border-white", GROUP_BG[group as ColumnDef["group"]])
                          : "text-zinc-300 border-zinc-500 bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-300 hover:text-white"
                      )}
                    >
                      {/* Highly visible checkbox */}
                      <div className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all",
                        isVisible
                          ? "bg-white border-white"
                          : "border-zinc-300 bg-zinc-700"
                      )}>
                        {isVisible && <Check className="h-2.5 w-2.5 text-zinc-900 stroke-[3]" />}
                      </div>
                      <span className="truncate">{col.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer: Reset to defaults */}
        <div className="px-4 py-2.5 bg-zinc-800 border-t-2 border-zinc-400 flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">
            Pinned columns always visible. Saved automatically.
          </span>
          {onReset && (
            <button
              onClick={() => { onReset(); }}
              disabled={isAtDefault}
              className={cn(
                "flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-all",
                isAtDefault
                  ? "opacity-30 cursor-not-allowed border-zinc-700 text-zinc-500"
                  : "border-amber-500/60 text-amber-400 hover:bg-amber-500/15 hover:border-amber-400"
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
