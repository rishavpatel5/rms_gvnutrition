import type { Request, Response } from "express";
import { getQueryRecord, parseBody } from "../../lib/http-parse.js";
import * as supplierService from "./supplier.service.js";
import {
  createSupplierBodySchema,
  updateSupplierBodySchema,
} from "./supplier.validators.js";

export const supplierController = {
  async list(req: Request, res: Response): Promise<void> {
    const out = await supplierService.listSuppliers(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async get(req: Request, res: Response): Promise<void> {
    const row = await supplierService.getSupplierById(req.params.id!);
    res.json({ data: row });
  },

  async create(req: Request, res: Response): Promise<void> {
    const body = parseBody(createSupplierBodySchema, req.body);
    const row = await supplierService.createSupplier(body);
    res.status(201).json({ data: row });
  },

  async update(req: Request, res: Response): Promise<void> {
    const body = parseBody(updateSupplierBodySchema, req.body);
    const row = await supplierService.updateSupplier(req.params.id!, body);
    res.json({ data: row });
  },

  async remove(req: Request, res: Response): Promise<void> {
    // 200 with the outcome, not a bare 204: the client has to be able to say
    // "deleted" or "kept for your records" honestly.
    const out = await supplierService.deleteSupplier(req.params.id!);
    res.json({ data: out });
  },
};
