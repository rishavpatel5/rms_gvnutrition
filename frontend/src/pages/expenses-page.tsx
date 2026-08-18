import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  apiDeleteAuthed,
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  apiPatchJsonAuthed,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "@/lib/api-client";
import { BusinessPosition } from "@/components/expenses/business-position";

// ─── Types ───────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "RENT",
  "UTILITIES",
  "SALARY",
  "MARKETING",
  "LOGISTICS",
  "MAINTENANCE",
  "OFFICE_SUPPLIES",
  "MISCELLANEOUS",
] as const;

type ExpenseCategory = (typeof CATEGORIES)[number];

const PAYMENT_MODES = ["CASH", "UPI"] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];
const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = { CASH: "Cash", UPI: "UPI" };

type Expense = {
  id: string;
  title: string;
  amount: string;
  category: ExpenseCategory;
  paymentMode: PaymentMode;
  date: string;
  note: string | null;
};

type Summary = {
  totalExpenses: number;
  grossRevenue: number;
  netProfit: number;
  byCategory: { category: string; total: number }[];
  monthly: { month: string; category: string; total: number }[];
  giveawayUnits: number;
  promotionalCost: number;
  /** Manual stock write-offs, valued at WAC. Expiry is reported on its own. */
  expiredUnits: number;
  expiredCost: number;
  /** Informational: WAC + the GST paid on it, which is unrecoverable once binned. */
  expiredCostInclGst: number;
  otherWriteOffUnits: number;
  otherWriteOffCost: number;
  writeOffCost: number;
  writeOffByReason: { reason: string; units: number; cost: number; costInclGst: number }[];
};

type ApiMeta = { page: number; limit: number; total: number; totalPages: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  UTILITIES: "Utilities",
  SALARY: "Salary",
  MARKETING: "Marketing",
  LOGISTICS: "Logistics",
  MAINTENANCE: "Maintenance",
  OFFICE_SUPPLIES: "Office Supplies",
  MISCELLANEOUS: "Miscellaneous",
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  RENT: "#e11d48",
  UTILITIES: "#f59e0b",
  SALARY: "#3b82f6",
  MARKETING: "#8b5cf6",
  LOGISTICS: "#10b981",
  MAINTENANCE: "#f97316",
  OFFICE_SUPPLIES: "#06b6d4",
  MISCELLANEOUS: "#6b7280",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtInr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStart(monthsAgo: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ─── Blank form ──────────────────────────────────────────────────────────────

type FormState = {
  title: string;
  amount: string;
  category: ExpenseCategory;
  paymentMode: PaymentMode;
  date: string;
  note: string;
};

function blankForm(): FormState {
  return { title: "", amount: "", category: "MISCELLANEOUS", paymentMode: "CASH", date: todayYmd(), note: "" };
}

// ─── Expense Form Dialog ─────────────────────────────────────────────────────

function ExpenseFormDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: (FormState & { id?: string }) | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(blankForm());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? { ...initial } : blankForm());
  }, [open, initial]);

  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.title.trim() || !form.amount || !form.date) {
      toast.error("Title, amount, and date are required.");
      return;
    }
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Amount must be a positive number.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        amount: amt,
        category: form.category,
        paymentMode: form.paymentMode,
        date: form.date,
        note: form.note.trim() || null,
      };
      if (initial?.id) {
        await apiPatchJsonAuthed(`/api/v1/expenses/${initial.id}`, payload);
        toast.success("Expense updated");
      } else {
        await apiPostJsonAuthed("/api/v1/expenses", payload);
        toast.success("Expense added");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save expense");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit expense" : "Add expense"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              value={form.title}
              onChange={(e) => set("title")(e.target.value)}
              placeholder="e.g. Monthly rent"
              className="h-10 rounded-xl"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (₹)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={form.amount}
                onChange={(e) => set("amount")(e.target.value)}
                placeholder="0.00"
                className="h-10 rounded-xl tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set("date")(e.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <select
                className="flex h-10 w-full cursor-pointer rounded-xl border border-border bg-background px-3 text-sm"
                value={form.category}
                onChange={(e) => set("category")(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment mode</Label>
              <select
                className="flex h-10 w-full cursor-pointer rounded-xl border border-border bg-background px-3 text-sm"
                value={form.paymentMode}
                onChange={(e) => set("paymentMode")(e.target.value)}
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Input
              value={form.note}
              onChange={(e) => set("note")(e.target.value)}
              placeholder="Additional details…"
              className="h-10 rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" className="rounded-xl" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              {initial?.id ? "Save changes" : "Add expense"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ExpensesPage() {
  const authed = Boolean(getStoredAccessToken());

  const [dateFrom, setDateFrom] = useState(monthStart(5));
  const [dateTo, setDateTo] = useState(todayYmd());
  const [applied, setApplied] = useState({ from: monthStart(5), to: todayYmd() });

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(FormState & { id?: string }) | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchExpenses = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          dateFrom: applied.from,
          dateTo: applied.to,
          page: String(p),
          limit: "50",
        });
        const res = await apiGetJsonAuthedWithMeta<Expense[]>(`/api/v1/expenses?${params}`);
        setExpenses(res.data);
        setMeta(res.meta as ApiMeta ?? null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load expenses");
      } finally {
        setLoading(false);
      }
    },
    [applied],
  );

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom: applied.from, dateTo: applied.to });
      const data = await apiGetJsonAuthed<Summary>(`/api/v1/expenses/summary?${params}`);
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setSummaryLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    if (!authed) return;
    void fetchExpenses(page);
  }, [authed, fetchExpenses, page]);

  useEffect(() => {
    if (!authed) return;
    void fetchSummary();
  }, [authed, fetchSummary]);

  function applyFilter() {
    setApplied({ from: dateFrom, to: dateTo });
    setPage(1);
  }

  function reload() {
    void fetchExpenses(page);
    void fetchSummary();
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await apiDeleteAuthed(`/api/v1/expenses/${id}`);
      toast.success("Expense deleted");
      setConfirmDeleteId(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete expense");
    } finally {
      setDeleting(false);
    }
  }

  function openAdd() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  function openEdit(e: Expense) {
    setEditTarget({
      id: e.id,
      title: e.title,
      amount: String(Number(e.amount)),
      category: e.category,
      paymentMode: e.paymentMode ?? "CASH",
      date: e.date.slice(0, 10),
      note: e.note ?? "",
    });
    setDialogOpen(true);
  }

  // Build monthly stacked bar data
  const monthlyChartData = useMemo(() => {
    if (!summary?.monthly?.length) return [];
    const months = [...new Set(summary.monthly.map((r) => r.month))].sort();
    return months.map((month) => {
      const row: Record<string, string | number> = { month };
      for (const cat of CATEGORIES) {
        const found = summary.monthly.find((r) => r.month === month && r.category === cat);
        row[cat] = found ? Number(found.total) : 0;
      }
      return row;
    });
  }, [summary]);

  const pieData = useMemo(
    () =>
      (summary?.byCategory ?? [])
        .filter((r) => r.total > 0)
        .map((r) => ({
          name: CATEGORY_LABELS[r.category as ExpenseCategory] ?? r.category,
          value: r.total,
          color: CATEGORY_COLORS[r.category as ExpenseCategory] ?? "#6b7280",
        })),
    [summary],
  );

  if (!authed) {
    return <p className="text-sm text-muted-foreground">Sign in to view expenses.</p>;
  }

  return (
    <div className="space-y-6 pb-8">
      <ExpenseFormDialog
        open={dialogOpen}
        initial={editTarget}
        onClose={() => setDialogOpen(false)}
        onSaved={reload}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Expenses</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Track all operating costs — rent, salaries, utilities, marketing, and more. Compare against
            revenue to see net profit.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`mr-1.5 size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button type="button" size="sm" onClick={openAdd}>
            <Plus className="mr-1.5 size-4" />
            Add expense
          </Button>
        </div>
      </div>

      {/* Date filter */}
      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-36 rounded-lg text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-36 rounded-lg text-sm"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-9"
            onClick={applyFilter}
            disabled={dateFrom === applied.from && dateTo === applied.to}
          >
            Apply
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {applied.from} → {applied.to}
          </p>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Total Revenue"
          value={summaryLoading ? null : (summary?.grossRevenue ?? 0)}
          accent="border-l-emerald-500/70"
          hint="Confirmed sales in period"
        />
        <KpiCard
          label="Total Expenses"
          value={summaryLoading ? null : (summary?.totalExpenses ?? 0)}
          accent="border-l-rose-500/70"
          hint="All recorded expense entries"
        />
        <KpiCard
          label="Net Profit"
          value={summaryLoading ? null : (summary?.netProfit ?? 0)}
          accent="border-l-primary/70"
          hint="Revenue − expenses − promotional cost − stock written off"
          signed
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Expired Stock"
          value={summaryLoading ? null : (summary?.expiredUnits ?? 0)}
          accent="border-l-orange-500/70"
          hint="Units written off as expired in period"
          valueFormatter={(n) => n.toLocaleString("en-IN")}
        />
        <KpiCard
          label="Expired Stock Cost"
          value={summaryLoading ? null : (summary?.expiredCost ?? 0)}
          accent="border-l-orange-600/70"
          hint={
            summary && summary.expiredCostInclGst > 0
              ? `At WAC · ${fmtInr(summary.expiredCostInclGst)} incl. GST paid`
              : "Cost of expired units at WAC"
          }
        />
        <KpiCard
          label="Giveaway Units"
          value={summaryLoading ? null : (summary?.giveawayUnits ?? 0)}
          accent="border-l-amber-500/70"
          hint="Free / ₹0 items given out in period"
          valueFormatter={(n) => n.toLocaleString("en-IN")}
        />
        <KpiCard
          label="Promotional Cost"
          value={summaryLoading ? null : (summary?.promotionalCost ?? 0)}
          accent="border-l-violet-500/70"
          hint="Cost of giveaway units at WAC / cost price"
        />
      </div>

      {summary && summary.otherWriteOffCost > 0 ? (
        <p className="text-xs text-muted-foreground">
          Also written off this period: {summary.otherWriteOffUnits.toLocaleString("en-IN")} unit
          {summary.otherWriteOffUnits === 1 ? "" : "s"} ({fmtInr(summary.otherWriteOffCost)}) as damage,
          shrinkage or correction — included in net profit above.
        </p>
      ) : null}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Monthly stacked bar */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Monthly expenses by category</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="flex h-60 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : monthlyChartData.length === 0 ? (
              <p className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                No expense data for this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtInr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {CATEGORIES.filter((c) =>
                    monthlyChartData.some((r) => (r[c] as number) > 0),
                  ).map((cat) => (
                    <Bar key={cat} dataKey={cat} name={CATEGORY_LABELS[cat]} stackId="a" fill={CATEGORY_COLORS[cat]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By category</CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="flex h-60 items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : pieData.length === 0 ? (
              <p className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                No data.
              </p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      innerRadius={40}
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => fmtInr(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1">
                  {pieData.map((d) => (
                    <li key={d.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: d.color }} />
                        {d.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{fmtInr(d.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expense Table */}
      <Card className="border-border/60">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">All expenses</CardTitle>
          <span className="text-xs text-muted-foreground">{meta?.total ?? 0} entries</span>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-sm text-muted-foreground">No expenses in this period.</p>
              <Button type="button" size="sm" variant="secondary" className="mt-3 rounded-full" onClick={openAdd}>
                <Plus className="mr-1.5 size-3.5" />
                Add first expense
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <>
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {e.date.slice(0, 10)}
                      </TableCell>
                      <TableCell className="font-medium">{e.title}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-[10px] uppercase tracking-wide"
                          style={{
                            background: `${CATEGORY_COLORS[e.category]}22`,
                            color: CATEGORY_COLORS[e.category],
                          }}
                        >
                          {CATEGORY_LABELS[e.category]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {PAYMENT_MODE_LABELS[e.paymentMode] ?? e.paymentMode ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {e.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {fmtInr(Number(e.amount))}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(e)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmDeleteId(e.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {confirmDeleteId === e.id ? (
                      <TableRow key={`${e.id}-confirm`}>
                        <TableCell colSpan={7} className="bg-destructive/5 py-2">
                          <div className="flex items-center gap-3 px-2">
                            <span className="flex-1 text-sm text-destructive">
                              Delete "{e.title}"?
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              className="h-7 rounded-md"
                              disabled={deleting}
                              onClick={() => void handleDelete(e.id)}
                            >
                              {deleting ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 rounded-md"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {meta && meta.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Page {meta.page} of {meta.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={meta.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Business position — cash in hand (all-time, independent of the date filter above) */}
      <BusinessPosition />
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  accent,
  signed,
  valueFormatter,
}: {
  label: string;
  value: number | null;
  hint: string;
  accent?: string;
  signed?: boolean;
  valueFormatter?: (n: number) => string;
}) {
  const isNeg = signed && value !== null && value < 0;
  const display = valueFormatter ?? fmtInr;
  return (
    <Card className={`border-l-[3px] border-border/60 shadow-sm ${accent ?? "border-l-primary/50"}`}>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {value === null ? (
          <Loader2 className="mt-2 size-5 animate-spin text-muted-foreground" />
        ) : (
          <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${isNeg ? "text-destructive" : ""}`}>
            {display(value)}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
