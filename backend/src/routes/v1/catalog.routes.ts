import { Router } from "express";
import { authenticate } from "../../modules/auth/middleware/authenticate.middleware.js";
import { requireRoles } from "../../modules/auth/middleware/authorize-roles.middleware.js";
import {
  ROLES_CATALOG_WRITE,
  ROLES_READ_ALL,
} from "../../modules/auth/role-groups.js";
import { catalogController } from "../../modules/catalog/catalog.controller.js";
import { asyncHandler } from "../../utils/async-handler.js";

export const catalogRouter = Router();

const read = [authenticate, requireRoles(...ROLES_READ_ALL)];
const write = [authenticate, requireRoles(...ROLES_CATALOG_WRITE)];

// Product categories were removed from this system — brand is the grouping.

catalogRouter.get(
  "/products",
  ...read,
  asyncHandler((req, res) => catalogController.listProducts(req, res)),
);
catalogRouter.post(
  "/products",
  ...write,
  asyncHandler((req, res) => catalogController.createProduct(req, res)),
);
catalogRouter.get(
  "/products/:productId",
  ...read,
  asyncHandler((req, res) => catalogController.getProduct(req, res)),
);
catalogRouter.patch(
  "/products/:productId",
  ...write,
  asyncHandler((req, res) => catalogController.updateProduct(req, res)),
);
catalogRouter.delete(
  "/products/:productId",
  ...write,
  asyncHandler((req, res) => catalogController.deleteProduct(req, res)),
);

catalogRouter.get(
  "/products/:productId/variants",
  ...read,
  asyncHandler((req, res) => catalogController.listVariants(req, res)),
);
catalogRouter.post(
  "/products/:productId/variants",
  ...write,
  asyncHandler((req, res) => catalogController.createVariant(req, res)),
);

catalogRouter.get(
  "/variants/lookup",
  ...read,
  asyncHandler((req, res) => catalogController.lookupVariantBySku(req, res)),
);
catalogRouter.get(
  "/variants/:variantId",
  ...read,
  asyncHandler((req, res) => catalogController.getVariant(req, res)),
);
catalogRouter.patch(
  "/variants/:variantId",
  ...write,
  asyncHandler((req, res) => catalogController.updateVariant(req, res)),
);
catalogRouter.delete(
  "/variants/:variantId",
  ...write,
  asyncHandler((req, res) => catalogController.deleteVariant(req, res)),
);

catalogRouter.get(
  "/reference/flavours",
  ...read,
  asyncHandler((req, res) => catalogController.listFlavours(req, res)),
);
catalogRouter.post(
  "/reference/flavours",
  ...write,
  asyncHandler((req, res) => catalogController.createFlavour(req, res)),
);
catalogRouter.get(
  "/reference/pack-sizes",
  ...read,
  asyncHandler((req, res) => catalogController.listPackSizes(req, res)),
);
catalogRouter.post(
  "/reference/pack-sizes",
  ...write,
  asyncHandler((req, res) => catalogController.createPackSize(req, res)),
);
catalogRouter.get(
  "/reference/brands",
  ...read,
  asyncHandler((req, res) => catalogController.listBrands(req, res)),
);
catalogRouter.post(
  "/reference/brands",
  ...write,
  asyncHandler((req, res) => catalogController.createBrand(req, res)),
);
