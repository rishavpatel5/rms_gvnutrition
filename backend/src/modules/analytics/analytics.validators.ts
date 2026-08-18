import { z } from "zod";

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

const optionalCuid = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().cuid().optional(),
);

export const dateRangeQuerySchema = z.object({
  from: z.string().regex(dayRe, "from must be YYYY-MM-DD (IST day boundary)"),
  to: z.string().regex(dayRe, "to must be YYYY-MM-DD (inclusive IST day)"),
  customerId: optionalCuid,
});

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export const salesGranularitySchema = z.enum(["daily", "weekly", "monthly"]);

export const salesSeriesQuerySchema = dateRangeQuerySchema.extend({
  granularity: salesGranularitySchema.default("daily"),
});

export type SalesSeriesQuery = z.infer<typeof salesSeriesQuerySchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const profitLinesQuerySchema = dateRangeQuerySchema.merge(paginationQuerySchema);
export type ProfitLinesQuery = z.infer<typeof profitLinesQuerySchema>;

export const inventoryValuationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(120).optional(),
  ),
});
export type InventoryValuationQuery = z.infer<typeof inventoryValuationQuerySchema>;

export const fastMovingQuerySchema = dateRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type FastMovingQuery = z.infer<typeof fastMovingQuerySchema>;

export const deadStockQuerySchema = z.object({
  deadAfterDays: z.coerce.number().int().min(7).max(730).default(90),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type DeadStockQuery = z.infer<typeof deadStockQuerySchema>;

export const offerPerformanceQuerySchema = dateRangeQuerySchema.merge(paginationQuerySchema);
export type OfferPerformanceQuery = z.infer<typeof offerPerformanceQuerySchema>;

const orderStatusSchema = z.enum(["DRAFT", "CONFIRMED", "VOIDED"]);
const orderDocumentTypeSchema = z.enum(["SALE", "CREDIT_NOTE"]);

export const purchaseAnalysisQuerySchema = z.object({
  trendDays: z.coerce
    .number()
    .int()
    .refine((v) => [7, 14, 30].includes(v), "trendDays must be 7, 14, or 30")
    .default(30),
  coverDays: z.coerce.number().int().min(7).max(60).default(14),
});
export type PurchaseAnalysisQuery = z.infer<typeof purchaseAnalysisQuerySchema>;

export const ordersReportQuerySchema = dateRangeQuerySchema.merge(paginationQuerySchema).extend({
  status: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    orderStatusSchema.optional(),
  ),
  documentType: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    orderDocumentTypeSchema.optional(),
  ),
  search: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(80).optional(),
  ),
});
export type OrdersReportQuery = z.infer<typeof ordersReportQuerySchema>;
