import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { InventoryAlertRow } from "@/hooks/use-dashboard-overview";

export function InventoryAlerts({
  items,
  loading,
}: {
  items: InventoryAlertRow[];
  loading?: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
          <CardTitle className="text-base font-semibold">Inventory alerts</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">SKUs at or below reorder threshold</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No low-stock variants right now.</p>
        ) : (
          items.map((row) => (
            <div
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  <FlavourLabel flavour={row.flavourName}>{row.name}</FlavourLabel>
                </p>
                <p className="text-xs text-muted-foreground">{row.sku}</p>
              </div>
              <Badge variant={row.status === "critical" ? "destructive" : "warning"}>
                {row.level} left
              </Badge>
            </div>
          ))
        )}
        <Button asChild variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
          <Link to="/dashboard/inventory">View inventory</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
