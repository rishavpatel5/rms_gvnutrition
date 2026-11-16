import { Check, GitMerge, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiDeleteJsonAuthed, apiPatchJsonAuthed } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export type ManagedFlavour = { id: string; name: string; _count?: { variants: number } };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flavours: ManagedFlavour[];
  /** Called after any successful change so the parent can reload the list. */
  onChanged: (change: { deletedId?: string; mergedInto?: string }) => Promise<void> | void;
};

type RowMode = { id: string; kind: "edit" | "delete" } | null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function ManageFlavoursSheet({ open, onOpenChange, flavours, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<RowMode>(null);
  const [draftName, setDraftName] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () =>
      [...flavours].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
      ),
    [flavours],
  );

  // Flag names that collide once case/spaces/punctuation are ignored — the likely duplicates.
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flavours) counts.set(norm(f.name), (counts.get(norm(f.name)) ?? 0) + 1);
    return new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
  }, [flavours]);

  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const q = query.trim().toLowerCase();
  const visible = sorted.filter(
    (f) =>
      (!q || f.name.toLowerCase().includes(q)) &&
      (!onlyDuplicates || duplicateKeys.has(norm(f.name))),
  );

  function startEdit(f: ManagedFlavour) {
    setMode({ id: f.id, kind: "edit" });
    setDraftName(f.name);
  }

  function startDelete(f: ManagedFlavour) {
    setMode({ id: f.id, kind: "delete" });
    // Pre-pick the most likely merge target: a duplicate spelling with the most items.
    const twin = flavours
      .filter((o) => o.id !== f.id && norm(o.name) === norm(f.name))
      .sort((a, b) => (b._count?.variants ?? 0) - (a._count?.variants ?? 0))[0];
    setMergeTarget(twin?.id ?? "");
  }

  async function saveRename(f: ManagedFlavour) {
    const name = draftName.trim();
    if (!name || name === f.name) {
      setMode(null);
      return;
    }
    setBusy(true);
    try {
      await apiPatchJsonAuthed(`/api/v1/catalog/reference/flavours/${encodeURIComponent(f.id)}`, {
        name,
      });
      toast.success(`Renamed to “${name}”`);
      setMode(null);
      await onChanged({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename flavour");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(f: ManagedFlavour) {
    const used = f._count?.variants ?? 0;
    if (used > 0 && !mergeTarget) {
      toast.error("Pick a flavour to move its items to.");
      return;
    }
    setBusy(true);
    try {
      const qs = used > 0 ? `?mergeInto=${encodeURIComponent(mergeTarget)}` : "";
      const out = await apiDeleteJsonAuthed<{ moved: number }>(
        `/api/v1/catalog/reference/flavours/${encodeURIComponent(f.id)}${qs}`,
      );
      const targetName = flavours.find((o) => o.id === mergeTarget)?.name;
      toast.success(
        out.moved > 0
          ? `Merged “${f.name}” into “${targetName}” (${out.moved} item${out.moved === 1 ? "" : "s"} moved)`
          : `Deleted “${f.name}”`,
      );
      setMode(null);
      await onChanged({ deletedId: f.id, mergedInto: used > 0 ? mergeTarget : undefined });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete flavour");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setMode(null);
        onOpenChange(o);
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/60 p-5">
          <SheetTitle>Manage flavours</SheetTitle>
          <SheetDescription>
            Fix spellings, remove unused flavours, or merge duplicates. Existing SKUs and stock
            are not changed.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 border-b border-border/60 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search flavours…"
              className="h-9 w-full rounded-lg border border-border/70 bg-muted/30 pl-8 pr-3 text-sm outline-none focus:border-foreground/40 focus:bg-background"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {visible.length} of {flavours.length}
            </span>
            {duplicateKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => setOnlyDuplicates((v) => !v)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                  onlyDuplicates
                    ? "border-amber-500 bg-amber-500 text-white"
                    : "border-amber-400/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10",
                )}
              >
                Possible duplicates ({duplicateKeys.size})
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {visible.map((f) => {
            const used = f._count?.variants ?? 0;
            const isDup = duplicateKeys.has(norm(f.name));
            const rowMode = mode?.id === f.id ? mode.kind : null;
            return (
              <div
                key={f.id}
                className={cn(
                  "rounded-lg px-2 py-2",
                  rowMode ? "bg-muted/60" : "hover:bg-muted/40",
                )}
              >
                {rowMode === "edit" ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(f);
                        if (e.key === "Escape") setMode(null);
                      }}
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-foreground/50"
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="size-8"
                      aria-label="Save"
                      disabled={busy}
                      onClick={() => void saveRename(f)}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label="Cancel"
                      onClick={() => setMode(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{f.name}</span>
                        {isDup ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            duplicate?
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {used === 0 ? "Not used" : `Used by ${used} item${used === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground"
                      aria-label={`Rename ${f.name}`}
                      onClick={() => startEdit(f)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label={used > 0 ? `Merge ${f.name}` : `Delete ${f.name}`}
                      onClick={() => startDelete(f)}
                    >
                      {used > 0 ? <GitMerge className="size-3.5" /> : <Trash2 className="size-3.5" />}
                    </Button>
                  </div>
                )}

                {rowMode === "delete" ? (
                  <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-background p-2.5">
                    {used > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {used} item{used === 1 ? " uses" : "s use"} “{f.name}”. Move{" "}
                          {used === 1 ? "it" : "them"} to:
                        </p>
                        <select
                          value={mergeTarget}
                          onChange={(e) => setMergeTarget(e.target.value)}
                          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
                        >
                          <option value="">Choose a flavour…</option>
                          {sorted
                            .filter((o) => o.id !== f.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                                {norm(o.name) === norm(f.name) ? "  (same name)" : ""}
                              </option>
                            ))}
                        </select>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Delete “{f.name}”? No items use it.
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setMode(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-8"
                        disabled={busy || (used > 0 && !mergeTarget)}
                        onClick={() => void confirmDelete(f)}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : used > 0 ? (
                          "Merge & delete"
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No flavours match.</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
