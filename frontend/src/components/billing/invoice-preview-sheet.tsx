import { useBillingQuote } from "@/hooks/use-billing-quote";
import { useBillingStore } from "@/stores/billing-store";
import { FlavourLabel } from "@/components/catalog/flavour-label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUiStore } from "@/stores/ui-store";
import { STORE_LOGO_ALT, STORE_LOGO_PATH } from "@/lib/brand";

const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

const num = (s: string | undefined) => Number(s ?? 0) || 0;

export function InvoicePreviewSheet() {
  const open = useUiStore((s) => s.invoicePreviewOpen);
  const setOpen = useUiStore((s) => s.setInvoicePreviewOpen);
  const lines = useBillingStore((s) => s.lines);
  const gstEnabled = useBillingStore((s) => s.gstEnabled);
  const payment = useBillingStore((s) => s.payment);
  const posLinkedCustomerId = useBillingStore((s) => s.posLinkedCustomerId);
  const posCustomerName = useBillingStore((s) => s.posCustomerName);
  const posCustomerPhone = useBillingStore((s) => s.posCustomerPhone);
  const posCustomerSummary = useBillingStore((s) => s.posCustomerSummary);
  const { quote, loading } = useBillingQuote();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col sm:max-w-md"
      >
        <SheetHeader>
          <div className="flex items-center gap-3">
            <img
              src={STORE_LOGO_PATH}
              alt={STORE_LOGO_ALT}
              className="h-12 max-w-40 object-contain object-left dark:invert"
            />
            <SheetTitle>Invoice preview</SheetTitle>
          </div>
          <p className="text-left text-sm text-muted-foreground">
            Draft — server-calculated totals
          </p>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1 pr-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, index) => {
                const ql = quote?.lines[index];
                return (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">
                        {l.name}
                        {l.isGiveaway ? (
                          <span className="ml-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                            (FREE)
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <FlavourLabel flavour={l.flavourName}>{l.variantLabel}</FlavourLabel>
                      </div>
                      {ql && num(ql.itemDiscountAmount) > 0 ? (
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                          −{money(num(ql.itemDiscountAmount))} item disc.
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ql ? money(num(ql.lineTotal)) : money(l.unitPrice * l.qty)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
        <div className="mt-auto space-y-3 border-t border-border pt-4">
          {posLinkedCustomerId || posCustomerName.trim() || posCustomerPhone.trim() ? (
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Customer
              </p>
              <p className="font-medium leading-tight">
                {posCustomerName.trim() || "New customer"}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {posCustomerPhone.trim() || "—"}
              </p>
              {posLinkedCustomerId && posCustomerSummary ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {posCustomerSummary.orderCount} prior orders
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Walk-in — no customer on this bill.</p>
          )}
          {loading ? (
            <p className="text-xs text-muted-foreground">Calculating…</p>
          ) : quote ? (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">List subtotal</span>
                <span className="tabular-nums">{money(num(quote.totals.grossSubtotal))}</span>
              </div>
              {num(quote.totals.discountTotal) > 0 ? (
                <div className="flex justify-between text-sm text-emerald-700 dark:text-emerald-400">
                  <span>Discounts</span>
                  <span className="tabular-nums">−{money(num(quote.totals.discountTotal))}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">GST {gstEnabled ? "" : "(off)"}</span>
                <span className="tabular-nums">
                  {money(
                    num(quote.totals.cgstTotal) +
                      num(quote.totals.sgstTotal) +
                      num(quote.totals.igstTotal),
                  )}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(num(quote.totals.grandTotal))}</span>
              </div>
            </>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Payment: <span className="capitalize">{payment}</span>
          </p>
          <Button type="button" className="w-full" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
