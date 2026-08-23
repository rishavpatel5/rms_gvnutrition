import type { Request, Response } from "express";
import { getQueryRecord, parseBody } from "../../lib/http-parse.js";
import * as productService from "./product.service.js";
import * as variantService from "./variant.service.js";
import {
  createBrandBodySchema,
  createFlavourBodySchema,
  createPackSizeBodySchema,
  createProductBodySchema,
  createVariantBodySchema,
  updateProductBodySchema,
  updateVariantBodySchema,
} from "./catalog.validators.js";

// Product categories were removed from this system — brand is the grouping.
export const catalogController = {
  async listProducts(req: Request, res: Response): Promise<void> {
    const out = await productService.listProducts(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async getProduct(req: Request, res: Response): Promise<void> {
    const row = await productService.getProductById(req.params.productId!);
    res.json({ data: row });
  },

  async createProduct(req: Request, res: Response): Promise<void> {
    const body = parseBody(createProductBodySchema, req.body);
    const row = await productService.createProduct(body);
    res.status(201).json({ data: row });
  },

  async updateProduct(req: Request, res: Response): Promise<void> {
    const body = parseBody(updateProductBodySchema, req.body);
    const row = await productService.updateProduct(req.params.productId!, body);
    res.json({ data: row });
  },

  async deleteProduct(req: Request, res: Response): Promise<void> {
    await productService.deleteProduct(req.params.productId!);
    res.status(204).send();
  },

  async listVariants(req: Request, res: Response): Promise<void> {
    const out = await variantService.listVariantsForProduct(
      req.params.productId!,
      getQueryRecord(req),
    );
    res.json({ data: out.items, meta: out.meta });
  },

  async createVariant(req: Request, res: Response): Promise<void> {
    const body = parseBody(createVariantBodySchema, req.body);
    const row = await variantService.createVariant({
      productId: req.params.productId!,
      ...body,
    });
    res.status(201).json({ data: row });
  },

  async getVariant(req: Request, res: Response): Promise<void> {
    const row = await variantService.getVariantById(req.params.variantId!);
    res.json({ data: row });
  },

  async updateVariant(req: Request, res: Response): Promise<void> {
    const body = parseBody(updateVariantBodySchema, req.body);
    const row = await variantService.updateVariant(req.params.variantId!, body);
    res.json({ data: row });
  },

  async deleteVariant(req: Request, res: Response): Promise<void> {
    // 200 with the outcome rather than a bare 204: the client has to be able to
    // say "deleted" or "kept for your records" honestly.
    const out = await variantService.deleteVariant(req.params.variantId!);
    res.json({ data: out });
  },

  async lookupVariantBySku(req: Request, res: Response): Promise<void> {
    const out = await variantService.lookupVariantsBySku(getQueryRecord(req));
    res.json({ data: out });
  },

  async listFlavours(req: Request, res: Response): Promise<void> {
    const out = await productService.listFlavours(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async createFlavour(req: Request, res: Response): Promise<void> {
    const body = parseBody(createFlavourBodySchema, req.body);
    const row = await productService.createFlavour(body);
    res.status(201).json({ data: row });
  },

  async listPackSizes(req: Request, res: Response): Promise<void> {
    const out = await productService.listPackSizes(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async createPackSize(req: Request, res: Response): Promise<void> {
    const body = parseBody(createPackSizeBodySchema, req.body);
    const row = await productService.createPackSize(body);
    res.status(201).json({ data: row });
  },

  async listBrands(req: Request, res: Response): Promise<void> {
    const out = await productService.listBrands(getQueryRecord(req));
    res.json({ data: out.items, meta: out.meta });
  },

  async createBrand(req: Request, res: Response): Promise<void> {
    const body = parseBody(createBrandBodySchema, req.body);
    const row = await productService.createBrand(body);
    res.status(201).json({ data: row });
  },
};
