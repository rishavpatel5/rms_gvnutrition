import type { Request, Response } from "express";
import { getAuthUserId, getQueryRecord, parseBody } from "../../lib/http-parse.js";
import * as billingService from "./billing.service.js";
import * as invoiceService from "./invoice/invoice.service.js";
import {
  confirmOrderBodySchema,
  correctItemVariantBodySchema,
  createCreditNoteBodySchema,
  createDraftOrderBodySchema,
  exchangeBodySchema,
  posCheckoutBodySchema,
  posQuoteBodySchema,
} from "./billing.validators.js";
import { mapPayments } from "./billing.validators.js";

function invoiceFormat(req: Request): "json" | "pdf" {
  const q = getQueryRecord(req).format;
  if (q === "json") return "json";
  const accept = req.headers.accept ?? "";
  if (accept.includes("application/json") && !accept.includes("application/pdf")) {
    return "json";
  }
  return "pdf";
}

export const billingController = {
  async posSearch(req: Request, res: Response): Promise<void> {
    const out = await billingService.searchPosCatalog(getQueryRecord(req));
    res.json({ data: out.items });
  },

  async quote(req: Request, res: Response): Promise<void> {
    const body = parseBody(posQuoteBodySchema, req.body);
    const out = await billingService.quotePosCheckout(body);
    res.json({ data: out });
  },

  async checkout(req: Request, res: Response): Promise<void> {
    const body = parseBody(posCheckoutBodySchema, req.body);
    const out = await billingService.checkoutPos({
      body,
      createdById: getAuthUserId(req),
    });
    res.status(201).json({ data: out });
  },

  async createDraft(req: Request, res: Response): Promise<void> {
    const body = parseBody(createDraftOrderBodySchema, req.body);
    const out = await billingService.createDraftOrder({
      body,
      createdById: getAuthUserId(req),
    });
    res.status(201).json({ data: out });
  },

  async confirmOrder(req: Request, res: Response): Promise<void> {
    const body = parseBody(confirmOrderBodySchema, req.body);
    await billingService.confirmDraftOrder({
      orderId: req.params.orderId!,
      payments: mapPayments(body.payments),
      createdById: getAuthUserId(req),
      idempotencyKey: body.idempotencyKey,
    });
    const inv = await billingService.getOrderInvoice(req.params.orderId!);
    res.json({ data: inv });
  },

  /**
   * Dynamic invoice from stored order data.
   * Default: PDF stream (inline preview). `?format=json` for structured document.
   * `?disposition=attachment` to force download filename.
   */
  async getInvoice(req: Request, res: Response): Promise<void> {
    const orderId = req.params.orderId!;
    const format = invoiceFormat(req);
    const disposition =
      getQueryRecord(req).disposition === "attachment" ? "attachment" : "inline";

    if (format === "json") {
      const invoice = await invoiceService.getInvoiceDocument(orderId);
      res.json({ data: { invoice } });
      return;
    }

    const { buffer, filename } = await invoiceService.generateOrderInvoicePdf(orderId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
    res.send(buffer);
  },

  async listOrders(req: Request, res: Response): Promise<void> {
    const out = await billingService.listOrders(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async createCreditNote(req: Request, res: Response): Promise<void> {
    const body = parseBody(createCreditNoteBodySchema, req.body);
    const out = await billingService.createCreditNote({
      body,
      createdById: getAuthUserId(req),
    });
    res.status(201).json({ data: out });
  },

  async createExchange(req: Request, res: Response): Promise<void> {
    const body = parseBody(exchangeBodySchema, req.body);
    const out = await billingService.createExchange({
      body,
      createdById: getAuthUserId(req),
    });
    res.status(201).json({ data: out });
  },

  async correctItemVariant(req: Request, res: Response): Promise<void> {
    const body = parseBody(correctItemVariantBodySchema, req.body);
    const out = await billingService.correctOrderItemVariant({
      orderId: req.params.orderId!,
      itemId: req.params.itemId!,
      newVariantId: body.variantId,
      correctedById: getAuthUserId(req),
    });
    res.json({ data: out });
  },

  async voidSale(req: Request, res: Response): Promise<void> {
    await billingService.voidSaleOrder({
      orderId: req.params.orderId!,
      voidedById: getAuthUserId(req),
    });
    res.status(204).send();
  },
};
