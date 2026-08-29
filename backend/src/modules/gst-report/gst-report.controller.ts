import type { Request, Response } from "express";
import type { z } from "zod";
import { getQueryRecord } from "../../lib/http-parse.js";
import { AppError } from "../../middleware/error-handler.js";
import * as gstReportService from "./gst-report.service.js";
import {
  gstReportListQuerySchema,
  gstReportQuerySchema,
} from "./gst-report.validators.js";

function parseQuery<S extends z.ZodTypeAny>(schema: S, req: Request): z.infer<S> {
  const parsed = schema.safeParse(getQueryRecord(req));
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid query", parsed.error.flatten());
  }
  return parsed.data;
}

export const gstReportController = {
  async salesRegister(req: Request, res: Response): Promise<void> {
    const q = parseQuery(gstReportListQuerySchema, req);
    const out = await gstReportService.getSalesRegister(q);
    res.json({ data: out.items, meta: out.meta });
  },

  async purchaseRegister(req: Request, res: Response): Promise<void> {
    const q = parseQuery(gstReportListQuerySchema, req);
    const out = await gstReportService.getPurchaseRegister(q);
    res.json({ data: out.items, meta: out.meta });
  },

  async purchaseReturns(req: Request, res: Response): Promise<void> {
    const q = parseQuery(gstReportListQuerySchema, req);
    const out = await gstReportService.getPurchaseReturns(q);
    res.json({ data: out.items, meta: out.meta });
  },

  async hsnSummary(req: Request, res: Response): Promise<void> {
    const q = parseQuery(gstReportQuerySchema, req);
    const data = await gstReportService.getHsnSummary(q);
    res.json({ data });
  },

  async summary(req: Request, res: Response): Promise<void> {
    const q = parseQuery(gstReportQuerySchema, req);
    const data = await gstReportService.getGstSummary(q);
    res.json({ data });
  },
};
