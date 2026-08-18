import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandTag } from "@/components/catalog/brand-tag";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiGetJsonAuthed } from "@/lib/api-client";
import { kindLabel } from "@/lib/product-kind";
import { cn } from "@/lib/utils";

type SkuLookupVariant = {
  id: string;
  sku: string;
  isActive: boolean;
  listPrice: string | number;
  product: {
    id: string;
    name: string;
    kind: "SUPPLEMENT" | "ACCESSORY";
    brand: { id: string; name: string } | null;
  };
  brand: { id: string; name: string } | null;
  flavour: { name: string } | null;
  packSize: { label: string } | null;
  inventory: { quantity: number } | null;
};

type SkuLookupResponse = {
  query: string;
  exists: boolean;
  exactMatch: SkuLookupVariant | null;
  matches: SkuLookupVariant[];
};

function variantLabel(v: SkuLookupVariant): string {
  return [v.flavour?.name, v.packSize?.label].filter(Boolean).join(" / ") || "—";
}

function LookupResultRow({ row, onPick }: { row: SkuLookupVariant; onPick?: (row: SkuLookupVariant) => void }) {
  const stock = row.inventory?.quantity ?? 0;
  return (
    <div
      role={onPick ? "button" : undefined}
      tabIndex={onPick ? 0 : undefined}
      onClick={onPick ? () => onPick(row) : undefined}
      onKeyDown={onPick ? (e) => { if (e.key === "Enter" || e.key === " ") onPick(row); } : undefined}
      className={cn(
        "rounded-xl border border-border/60 bg-muted/20 px-4 py-3",
        onPick && "cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium leading-snug">{row.product.name}</p>
          <p className="flex items-center gap-1.5 font-mono text-sm">
            <BrandTag brand={row.brand?.name} />
            <FlavourLabel flavour={row.flavour?.name}>{row.sku}</FlavourLabel>
          </p>
          <p className="text-xs text-muted-foreground">
            {kindLabel(row.product.kind)}
            {row.brand?.name ? ` · ${row.brand.name}` : ""} · {variantLabel(row)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px] uppercase">
            In catalog
          </Badge>
          {!row.isActive ? (
            <Badge variant="outline" className="text-[10px]">
              Inactive
            </Badge>
          ) : null}
          <Badge variant={stock > 0 ? "default" : "outline"} className="tabular-nums text-[10px]">
            {stock > 0 ? `${stock} in stock` : "No stock yet"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

export function SkuLookupCard({ onPick }: { onPick?: (match: SkuLookupVariant) => void } = {}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SkuLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reqId = useRef(0);

  // Debounced live search by product name OR SKU.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResult(null);
      setErr(null);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    setErr(null);
    const timer = setTimeout(async () => {
      try {
        const data = await apiGetJsonAuthed<SkuLookupResponse>(
          `/api/v1/catalog/variants/lookup?q=${encodeURIComponent(q)}`,
        );
        if (id === reqId.current) setResult(data);
      } catch (e: unknown) {
        if (id === reqId.current) setErr(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const q = query.trim();
  const tooShort = q.length > 0 && q.length < 2;
  const showResults = q.length >= 2 && !loading && !err && result;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Search catalog</CardTitle>
        <CardDescription>
          Search by product name or SKU — see what's already in the master catalog and how much is in stock.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {loading ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {tooShort ? (
          <p className="text-xs text-muted-foreground">Type at least 2 characters to search…</p>
        ) : null}

        {err ? <p className="text-sm text-destructive">{err}</p> : null}

        {showResults && result.matches.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-emerald-800 dark:text-emerald-300">
                {result.matches.length} match{result.matches.length === 1 ? "" : "es"} in the master catalog
              </span>
            </div>
            {result.matches.map((row) => (
              <LookupResultRow key={row.id} row={row} onPick={onPick} />
            ))}
          </div>
        ) : null}

        {showResults && result.matches.length === 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                No catalog match for "<span className="font-mono">{result.query}</span>".
              </p>
              <p className="text-muted-foreground">
                Nothing by that name or SKU yet — use <strong className="text-foreground">New blueprint</strong>{" "}
                to create it.
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
