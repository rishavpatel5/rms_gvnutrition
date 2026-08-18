import { useCallback, useEffect, useState } from "react";
import { apiGetJsonAuthedWithMeta, getStoredAccessToken } from "@/lib/api-client";

export type StockNotification = {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  critical: boolean;
};

type BalanceRow = {
  quantity: number;
  variant: {
    id: string;
    sku: string;
    product: { name: string };
    flavour: { name: string } | null;
    packSize: { label: string } | null;
  };
};

function label(row: BalanceRow): string {
  const parts = [row.variant.product.name];
  const attrs = [row.variant.flavour?.name, row.variant.packSize?.label].filter(Boolean);
  if (attrs.length) parts.push(attrs.join(" / "));
  return parts.join(" — ");
}

export function useNotifications() {
  const [items, setItems] = useState<StockNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const load = useCallback(async () => {
    if (!getStoredAccessToken()) {
      setNeedsAuth(true);
      setItems([]);
      setError(null);
      return;
    }
    setNeedsAuth(false);
    setLoading(true);
    setError(null);
    const threshold = 10;
    try {
      const { data } = await apiGetJsonAuthedWithMeta<BalanceRow[]>(
        `/api/v1/inventory/balances?lowStock=true&threshold=${threshold}&limit=12`,
      );
      setItems(
        data.map((row) => ({
          id: row.variant.id,
          sku: row.variant.sku,
          name: label(row),
          quantity: row.quantity,
          critical: row.quantity <= Math.max(1, Math.floor(threshold / 2)),
        })),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load alerts");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, needsAuth, reload: load, count: items.length };
}
