import {
  apiGetJsonAuthed,
  apiGetJsonAuthedWithMeta,
  apiPostJsonAuthed,
} from "./api-client";

export type SupplierRow = { id: string; name: string };

export type VariantSearchRow = {
  id: string;
  sku: string;
  productName: string;
  variantLabel: string;
  onHand: number;
};

export type ReturnPreviewLine = {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  unitWac: string;
  lineBookValue: string;
};

export type ReturnPreview = { lines: ReturnPreviewLine[]; bookValue: string };

export type PurchaseReturnDoc = {
  id: string;
  status: string;
  supplier: { id: string; name: string };
  bookValue: string;
  refundAmount: string;
  difference: string;
  outcome: "GAIN" | "LOSS" | "NEUTRAL";
  settlementMethod: string;
  note: string | null;
  createdAt: string;
  lines: ReturnPreviewLine[];
};

export type PurchaseReturnListRow = {
  id: string;
  status: string;
  supplier: { id: string; name: string };
  bookValue: string;
  refundAmount: string;
  difference: string;
  outcome: "GAIN" | "LOSS" | "NEUTRAL";
  settlementMethod: string;
  lineCount: number;
  createdAt: string;
};

export async function listSuppliers(): Promise<SupplierRow[]> {
  const { data } = await apiGetJsonAuthedWithMeta<SupplierRow[]>("/api/v1/suppliers?limit=200&isActive=true");
  return data;
}

/** In-stock variants received from the selected supplier, matching the search term. */
export async function searchSupplierStock(
  supplierId: string,
  term: string,
): Promise<VariantSearchRow[]> {
  const qs = new URLSearchParams({ supplierId, search: term });
  return apiGetJsonAuthed<VariantSearchRow[]>(`/api/v1/purchases/returns/stock?${qs.toString()}`);
}

export async function previewPurchaseReturn(
  lines: { variantId: string; quantity: number }[],
): Promise<ReturnPreview> {
  return apiPostJsonAuthed<ReturnPreview>("/api/v1/purchases/returns/preview", { lines });
}

export async function createPurchaseReturn(body: {
  supplierId: string;
  lines: { variantId: string; quantity: number }[];
  refundAmount: number;
  settlementMethod: "CASH" | "BANK" | "UPI";
  note: string | null;
  idempotencyKey: string;
  expectedBookValue: number;
}): Promise<PurchaseReturnDoc> {
  return apiPostJsonAuthed<PurchaseReturnDoc>("/api/v1/purchases/returns", body);
}

export async function listPurchaseReturns(): Promise<PurchaseReturnListRow[]> {
  const { data } = await apiGetJsonAuthedWithMeta<PurchaseReturnListRow[]>(
    "/api/v1/purchases/returns?limit=50",
  );
  return data;
}
