import { Check, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PickerOption = { id: string; label: string };

type Props = {
  title: string;
  icon: ReactNode;
  options: PickerOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** "single" = pick at most one (with a "None" choice). */
  mode?: "multi" | "single";
  onCreate?: () => void;
  createLabel?: string;
  /** Opens a manager to rename/delete the options themselves. */
  onManage?: () => void;
  searchPlaceholder?: string;
  /** Sort A→Z (case-insensitive). Off for lists with a meaningful order, like sizes. */
  sortAlpha?: boolean;
  /** Dense grid for short labels (e.g. "500g"). */
  compact?: boolean;
};

/**
 * Searchable, bounded option grid. Built for long reference lists (150+ flavours)
 * that otherwise wrap into an unreadable wall of chips.
 */
export function OptionPicker({
  title,
  icon,
  options,
  selected,
  onChange,
  mode = "multi",
  onCreate,
  createLabel = "New",
  onManage,
  searchPlaceholder = "Search…",
  sortAlpha = true,
  compact = false,
}: Props) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () =>
      sortAlpha
        ? [...options].sort((a, b) =>
            a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }),
          )
        : options,
    [options, sortAlpha],
  );

  const q = query.trim().toLowerCase();
  const visible = q ? sorted.filter((o) => o.label.toLowerCase().includes(q)) : sorted;
  const selectedSet = new Set(selected);
  const selectedOptions = options.filter((o) => selectedSet.has(o.id));

  function toggle(id: string) {
    if (mode === "single") {
      onChange(selectedSet.has(id) ? [] : [id]);
      return;
    }
    onChange(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  function selectAllVisible() {
    const next = new Set(selected);
    for (const o of visible) next.add(o.id);
    onChange([...next]);
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground" aria-hidden>
            {icon}
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
              selected.length > 0
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground",
            )}
          >
            {selected.length > 0
              ? `${selected.length} selected`
              : `${options.length} available`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {onManage ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1 rounded-full px-3 text-xs"
              onClick={onManage}
            >
              <Pencil className="size-3.5" />
              Edit
            </Button>
          ) : null}
          {onCreate ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1 rounded-full px-3 text-xs"
              onClick={onCreate}
            >
              <Plus className="size-3.5" />
              {createLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Search + bulk actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-border/70 bg-muted/30 pl-8 pr-3 text-sm outline-none transition-colors focus:border-foreground/40 focus:bg-background"
          />
        </div>
        {mode === "multi" ? (
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={visible.length === 0}
              onClick={selectAllVisible}
            >
              Select {q ? "matches" : "all"}
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              disabled={selected.length === 0}
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {/* Selected summary — keeps choices visible while the list is scrolled/filtered */}
      {selectedOptions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {selectedOptions.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded-full bg-foreground py-0.5 pl-2.5 pr-1 text-xs font-medium text-background"
            >
              {o.label}
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                className="rounded-full p-0.5 hover:bg-background/20"
                onClick={() => toggle(o.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Options */}
      <div className="p-4 pt-3">
        <div
          className={cn(
            "grid max-h-64 gap-1.5 overflow-y-auto pr-1",
            compact
              ? "grid-cols-3 sm:grid-cols-5 lg:grid-cols-7"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {mode === "single" && !q ? (
            <OptionCell label="None" active={selected.length === 0} onClick={() => onChange([])} muted />
          ) : null}
          {visible.map((o) => (
            <OptionCell
              key={o.id}
              label={o.label}
              active={selectedSet.has(o.id)}
              onClick={() => toggle(o.id)}
              centered={compact}
            />
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No match for “{query.trim()}”.
            {onCreate ? (
              <button
                type="button"
                className="ml-1 font-medium text-foreground underline-offset-2 hover:underline"
                onClick={onCreate}
              >
                {createLabel}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function OptionCell({
  label,
  active,
  onClick,
  centered,
  muted,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  centered?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 min-w-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
        centered ? "justify-center" : "justify-start text-left",
        active
          ? "border-foreground bg-foreground font-medium text-background"
          : "border-border/60 hover:border-foreground/30 hover:bg-muted/50",
        muted && !active && "text-muted-foreground",
      )}
    >
      {active && !centered ? <Check className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}
