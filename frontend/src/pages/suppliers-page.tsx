import { Loader2, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  apiDeleteJsonAuthed,
  apiGetJsonAuthedWithMeta,
  apiPatchJsonAuthed,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  _count?: { purchaseOrders: number };
};

/** The three editable fields, held while a row is being edited. */
type Draft = { name: string; phone: string; email: string };

export function SuppliersPage() {
  const authed = Boolean(getStoredAccessToken());
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", phone: "", email: "" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      // Inactive suppliers stay listed here — this is the screen where you would
      // notice one was retired and put it back. They are filtered out of purchase
      // entry instead, which is where offering them would cause harm.
      const { data } = await apiGetJsonAuthedWithMeta<Supplier[]>("/api/v1/suppliers?limit=200");
      setRows(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load suppliers");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) {
      toast.error("A supplier name is required.");
      return;
    }
    setBusy(true);
    try {
      await apiPostJsonAuthed("/api/v1/suppliers", {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      });
      setName("");
      setPhone("");
      setEmail("");
      await load();
      toast.success("Supplier added");
    } catch (e) {
      // Previously swallowed, so a rejected email or a duplicate looked like
      // nothing had happened at all.
      toast.error(e instanceof Error ? e.message : "Could not add supplier");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: Supplier) {
    setEditingId(s.id);
    setConfirmDeleteId(null);
    setDraft({ name: s.name, phone: s.phone ?? "", email: s.email ?? "" });
  }

  async function saveEdit(id: string) {
    if (!draft.name.trim()) {
      toast.error("A supplier name is required.");
      return;
    }
    setSavingId(id);
    try {
      const updated = await apiPatchJsonAuthed<Supplier>(`/api/v1/suppliers/${id}`, {
        name: draft.name.trim(),
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
      });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
      setEditingId(null);
      toast.success("Supplier updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update supplier");
    } finally {
      setSavingId(null);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const res = await apiDeleteJsonAuthed<{ outcome: "deleted" | "deactivated" }>(
        `/api/v1/suppliers/${id}`,
      );
      setConfirmDeleteId(null);
      // A supplier you have actually bought from is deactivated, not destroyed —
      // the purchase orders behind it are the record of money that left the
      // business. Say which happened rather than claiming a deletion.
      if (res?.outcome === "deactivated") {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: false } : r)));
        toast.success("Supplier retired", {
          description:
            "It has purchase history, so the record is kept for your reports. It will no longer appear when receiving stock.",
        });
      } else {
        setRows((prev) => prev.filter((r) => r.id !== id));
        toast.success("Supplier deleted");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove supplier");
    } finally {
      setDeletingId(null);
    }
  }

  async function restore(id: string) {
    setSavingId(id);
    try {
      await apiPatchJsonAuthed(`/api/v1/suppliers/${id}`, { isActive: true });
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: true } : r)));
      toast.success("Supplier restored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore supplier");
    } finally {
      setSavingId(null);
    }
  }

  if (!authed) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link to="/login?redirect=/dashboard/suppliers" className="underline">
          Sign in
        </Link>{" "}
        to manage suppliers.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Suppliers</h2>
        <p className="text-sm text-muted-foreground">Vendors for purchase invoices.</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Add supplier</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="sm:col-span-3 w-fit rounded-xl"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Directory</CardTitle>
          <CardDescription>
            Suppliers available on purchase entry. Retired ones stay listed here for your
            records but are no longer offered when receiving stock.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No suppliers yet — add one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead className="w-[132px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const isEditing = editingId === s.id;
                  const isSaving = savingId === s.id;
                  const isDeleting = deletingId === s.id;
                  const confirming = confirmDeleteId === s.id;

                  if (isEditing) {
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Input
                            autoFocus
                            className="h-8"
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveEdit(s.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8"
                            value={draft.phone}
                            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8"
                            value={draft.email}
                            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {s._count?.purchaseOrders ?? 0}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 rounded-lg"
                              disabled={isSaving}
                              onClick={() => void saveEdit(s.id)}
                            >
                              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              onClick={() => setEditingId(null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  return (
                    <TableRow key={s.id} className={cn(!s.isActive && "opacity-60")}>
                      <TableCell className="font-medium">
                        {s.name}
                        {!s.isActive ? (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Retired
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.email ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s._count?.purchaseOrders ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        {confirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-8 rounded-lg"
                              disabled={isDeleting}
                              onClick={() => void remove(s.id)}
                            >
                              {isDeleting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                "Confirm"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              <X className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-1">
                            {!s.isActive ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-8 text-muted-foreground hover:text-foreground"
                                aria-label={`Restore ${s.name}`}
                                disabled={isSaving}
                                onClick={() => void restore(s.id)}
                              >
                                {isSaving ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="size-3.5" />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              aria-label={`Edit ${s.name}`}
                              onClick={() => startEdit(s)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            {s.isActive ? (
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-8 text-muted-foreground hover:text-destructive"
                                aria-label={`Remove ${s.name}`}
                                onClick={() => {
                                  setConfirmDeleteId(s.id);
                                  setEditingId(null);
                                }}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
