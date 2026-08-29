import { z } from "zod";

const dayRe = /^\d{4}-\d{2}-\d{2}$/;

export const gstReportQuerySchema = z.object({
  from: z.string().regex(dayRe, "from must be YYYY-MM-DD (IST day boundary)"),
  to: z.string().regex(dayRe, "to must be YYYY-MM-DD (inclusive IST day)"),
});

export type GstReportQuery = z.infer<typeof gstReportQuerySchema>;

export const gstReportListQuerySchema = gstReportQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type GstReportListQuery = z.infer<typeof gstReportListQuerySchema>;
