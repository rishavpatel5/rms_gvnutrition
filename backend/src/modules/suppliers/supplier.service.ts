import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error-handler.js";
import { buildMeta, parsePagination } from "../../lib/pagination.js";

export function extractSupplierGstin(address: unknown): string | null {
  if (address && typeof address === "object" && !Array.isArray(address)) {
    const obj = address as Record<string, unknown>;
    if (typeof obj.gstin === "string" && obj.gstin.trim()) return obj.gstin.trim();
    if (typeof obj.gstNumber === "string" && obj.gstNumber.trim()) return obj.gstNumber.trim();
    if (typeof obj.gst === "string" && obj.gst.trim()) return obj.gst.trim();
  }
  return null;
}

export function formatSupplier<T extends { address?: unknown }>(supplier: T): T & { gstin: string | null } {
  return {
    ...supplier,
    gstin: extractSupplierGstin(supplier.address),
  };
}

export async function listSuppliers(query: Record<string, unknown>) {
  const { page, limit, skip } = parsePagination(query);
  const search =
    typeof query.search === "string" && query.search.trim().length > 0
      ? query.search.trim()
      : undefined;
  const isActive =
    query.isActive === "true"
      ? true
      : query.isActive === "false"
        ? false
        : undefined;

  const where: Prisma.SupplierWhereInput = {
    ...(isActive === undefined ? {} : { isActive }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
      include: {
        _count: { select: { purchaseOrders: true } },
      },
    }),
    prisma.supplier.count({ where }),
  ]);

  return { items: items.map(formatSupplier), meta: buildMeta(page, limit, total) };
}

export async function getSupplierById(id: string) {
  const row = await prisma.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          grandTotal: true,
          amountPaid: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  return formatSupplier(row);
}

export async function createSupplier(input: {
  name: string;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  address?: Prisma.InputJsonValue | null;
  notes?: string | null;
}) {
  const gstin = input.gstin?.trim() || null;
  let addrObj: Record<string, unknown> = {};
  if (input.address && typeof input.address === "object" && !Array.isArray(input.address)) {
    addrObj = { ...(input.address as Record<string, unknown>) };
  }
  if (gstin) {
    addrObj.gstin = gstin;
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      address: (Object.keys(addrObj).length > 0 ? addrObj : undefined) as Prisma.InputJsonValue | undefined,
      notes: input.notes?.trim() || null,
    },
  });

  return formatSupplier(supplier);
}

export async function updateSupplier(
  id: string,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    address?: Prisma.InputJsonValue | null;
    notes?: string | null;
    isActive?: boolean;
  },
) {
  try {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");

    let addrObj: Record<string, unknown> | undefined = undefined;
    if (input.address !== undefined || input.gstin !== undefined) {
      const base = (existing.address && typeof existing.address === "object" && !Array.isArray(existing.address))
        ? { ...(existing.address as Record<string, unknown>) }
        : {};
      if (input.address && typeof input.address === "object" && !Array.isArray(input.address)) {
        Object.assign(base, input.address as Record<string, unknown>);
      }
      if (input.gstin !== undefined) {
        if (input.gstin?.trim()) {
          base.gstin = input.gstin.trim();
        } else {
          delete base.gstin;
        }
      }
      addrObj = base;
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined
          ? { phone: input.phone?.trim() || null }
          : {}),
        ...(input.email !== undefined
          ? { email: input.email?.trim().toLowerCase() || null }
          : {}),
        ...(addrObj !== undefined ? { address: addrObj as Prisma.InputJsonValue } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return formatSupplier(updated);
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code?: string }).code)
        : "";
    if (code === "P2025") {
      throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    }
    throw e;
  }
}

/**
 * `deleted` — the row is gone. `deactivated` — it had purchase history, so it was
 * hidden instead and no longer offered on purchase entry.
 */
export type SupplierDeleteOutcome = { outcome: "deleted" | "deactivated" };

/**
 * Remove a supplier.
 *
 * Purchase orders and purchase returns both hold `onDelete: Restrict` on their
 * supplier, and rightly so: those documents are the record of money that left the
 * business, and every purchase figure, WAC input and cash movement traces back
 * through them. A supplier that has ever been bought from is therefore DEACTIVATED,
 * never destroyed — it disappears from the purchase-entry dropdown while its
 * history keeps adding up. Only a supplier nothing points at is really deleted.
 */
export async function deleteSupplier(id: string): Promise<SupplierDeleteOutcome> {
  const row = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true, _count: { select: { purchaseOrders: true, purchaseReturns: true } } },
  });
  if (!row) throw new AppError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");

  if (row._count.purchaseOrders > 0 || row._count.purchaseReturns > 0) {
    await prisma.supplier.update({ where: { id }, data: { isActive: false } });
    return { outcome: "deactivated" };
  }

  await prisma.supplier.delete({ where: { id } });
  return { outcome: "deleted" };
}
