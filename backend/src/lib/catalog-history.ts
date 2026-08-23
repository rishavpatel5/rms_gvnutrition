import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * What pins a variant to the ledger.
 *
 * `inventory_logs` is APPEND-ONLY and is what stock valuation, COGS and every
 * report replay from; the purchase, sale, return and adjustment lines are the
 * documents behind those movements. Every one of those foreign keys is
 * `onDelete: Restrict` on purpose — a variant that has ever moved must be
 * DEACTIVATED, never destroyed, or the history stops adding up.
 *
 * Both delete paths used to check `orderItems` alone, so a variant that had been
 * purchased but never sold looked disposable, and the hard delete died on
 * `inventory_logs_variant_id_fkey` with a raw Prisma error in the user's face.
 * Counting lives here so the variant and product paths cannot drift apart again.
 */
export const variantHistorySelect = {
  orderItems: true,
  purchaseOrderItems: true,
  logs: true,
  purchaseReturnLines: true,
  stockAdjustmentLines: true,
} as const;

export type VariantHistoryCounts = Record<keyof typeof variantHistorySelect, number>;

/** True when anything at all references this variant. */
export function hasVariantHistory(counts: VariantHistoryCounts): boolean {
  return (
    counts.orderItems > 0 ||
    counts.purchaseOrderItems > 0 ||
    counts.logs > 0 ||
    counts.purchaseReturnLines > 0 ||
    counts.stockAdjustmentLines > 0
  );
}

type CountClient = PrismaClient | Prisma.TransactionClient;

/** The same question asked across every variant of one product. */
export async function countProductVariantHistory(
  client: CountClient,
  productId: string,
): Promise<number> {
  const where = { variant: { productId } };
  const [orderItems, purchaseOrderItems, logs, purchaseReturnLines, stockAdjustmentLines] =
    await Promise.all([
      client.orderItem.count({ where }),
      client.purchaseOrderItem.count({ where }),
      client.inventoryLog.count({ where }),
      client.purchaseReturnLine.count({ where }),
      client.stockAdjustmentLine.count({ where }),
    ]);
  return (
    orderItems + purchaseOrderItems + logs + purchaseReturnLines + stockAdjustmentLines
  );
}
