import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { AppError } from "../../../middleware/error-handler.js";

/** Single include graph for invoice JSON + PDF (matches order ledger serializer). */
export const ORDER_INVOICE_INCLUDE = {
  customer: { select: { id: true, fullName: true, phone: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  offer: { select: { id: true, code: true, name: true } },
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      variant: {
        include: {
          product: {
            select: { id: true, name: true, slug: true, kind: true, hsnCode: true },
          },
          flavour: true,
          packSize: true,
        },
      },
    },
  },
  payments: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.OrderInclude;

export type OrderInvoiceRow = Prisma.OrderGetPayload<{
  include: typeof ORDER_INVOICE_INCLUDE;
}>;

export async function fetchOrderForInvoice(orderId: string): Promise<OrderInvoiceRow> {
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    include: ORDER_INVOICE_INCLUDE,
  });
  if (!row) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  }
  return row;
}
