import { z } from "zod";

export const createSupplierBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  gstin: z.string().trim().max(30).optional().nullable(),
  address: z.any().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateSupplierBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(200).optional().nullable(),
  gstin: z.string().trim().max(30).optional().nullable(),
  address: z.any().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
});
