import {
  apiDeleteAuthed,
  apiGetJsonAuthed,
  apiPatchJsonAuthed,
  apiPostJsonAuthed,
  getStoredAccessToken,
} from "./api-client";

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export type InvoiceFetchOptions = {
  /** inline = browser preview; attachment = download */
  disposition?: "inline" | "attachment";
};

/**
 * Fetches a dynamically generated invoice PDF from stored order data.
 * No client-side totals — backend is the single source of truth.
 */
export async function fetchOrderInvoicePdf(
  orderId: string,
  options?: InvoiceFetchOptions,
): Promise<Blob> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const disposition = options?.disposition ?? "inline";
  const url = joinUrl(
    base,
    `/api/v1/billing/orders/${encodeURIComponent(orderId)}/invoice?disposition=${disposition}`,
  );
  const token = getStoredAccessToken();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/pdf",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let message = `Invoice request failed (${res.status})`;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      if (text.length > 0 && text.length < 200) message = text;
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  if (blob.type && blob.type !== "application/pdf" && !blob.type.includes("pdf")) {
    throw new Error("Server did not return a PDF");
  }
  return blob;
}

/** Void a confirmed sale — restores stock and removes it from revenue reports. */
export async function voidSaleOrder(orderId: string): Promise<void> {
  await apiDeleteAuthed(`/api/v1/billing/orders/${encodeURIComponent(orderId)}`);
}

export type CorrectableVariant = {
  id: string;
  sku: string;
  isActive: boolean;
  flavourName: string | null;
  packSizeLabel: string | null;
  quantity: number;
};

type RawCatalogVariant = {
  id: string;
  sku: string;
  isActive: boolean;
  flavour: { name: string } | null;
  packSize: { label: string } | null;
  inventory: { quantity: number } | null;
};

/** Active variants of a product — used to pick a corrected variant for a sold line. */
export async function fetchProductVariantsForCorrection(
  productId: string,
): Promise<CorrectableVariant[]> {
  const rows = await apiGetJsonAuthed<RawCatalogVariant[]>(
    `/api/v1/catalog/products/${encodeURIComponent(productId)}/variants?limit=200`,
  );
  return rows
    .filter((v) => v.isActive)
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      isActive: v.isActive,
      flavourName: v.flavour?.name ?? null,
      packSizeLabel: v.packSize?.label ?? null,
      quantity: v.inventory?.quantity ?? 0,
    }));
}

/**
 * Correct a confirmed sale line's variant (wrong colour/size). Money is untouched;
 * stock is reconciled. Blocked server-side unless the caller is an ADMIN.
 */
export async function correctOrderItemVariant(
  orderId: string,
  itemId: string,
  variantId: string,
): Promise<void> {
  await apiPatchJsonAuthed(
    `/api/v1/billing/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/variant`,
    { variantId },
  );
}

export type SendInvoiceResult = { status: string; dryRun?: boolean };

/**
 * Send the invoice PDF link to the customer's WhatsApp via the backend (WATI).
 * Fully automated — no wa.me redirect. `force` re-sends past the double-send guard.
 */
export async function sendInvoiceWhatsApp(
  orderId: string,
  force = false,
): Promise<SendInvoiceResult> {
  return apiPostJsonAuthed<SendInvoiceResult>(
    `/api/v1/billing/orders/${encodeURIComponent(orderId)}/send-invoice`,
    { force },
  );
}

export function triggerPdfDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
