import { Router } from "express";
import { authenticate } from "../../modules/auth/middleware/authenticate.middleware.js";
import { requireRoles } from "../../modules/auth/middleware/authorize-roles.middleware.js";
import {
  ROLES_PURCHASE_WRITE,
  ROLES_READ_ALL,
} from "../../modules/auth/role-groups.js";
import { supplierController } from "../../modules/suppliers/supplier.controller.js";
import { asyncHandler } from "../../utils/async-handler.js";

export const suppliersRouter = Router();

const read = [authenticate, requireRoles(...ROLES_READ_ALL)];
const write = [authenticate, requireRoles(...ROLES_PURCHASE_WRITE)];

suppliersRouter.get(
  "/",
  ...read,
  asyncHandler((req, res) => supplierController.list(req, res)),
);
suppliersRouter.post(
  "/",
  ...write,
  asyncHandler((req, res) => supplierController.create(req, res)),
);
suppliersRouter.get(
  "/:id",
  ...read,
  asyncHandler((req, res) => supplierController.get(req, res)),
);
suppliersRouter.patch(
  "/:id",
  ...write,
  asyncHandler((req, res) => supplierController.update(req, res)),
);
suppliersRouter.delete(
  "/:id",
  ...write,
  asyncHandler((req, res) => supplierController.remove(req, res)),
);
