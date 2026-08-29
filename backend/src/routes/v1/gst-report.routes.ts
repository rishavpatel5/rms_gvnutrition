import { Router } from "express";
import { authenticate } from "../../modules/auth/middleware/authenticate.middleware.js";
import { requireRoles } from "../../modules/auth/middleware/authorize-roles.middleware.js";
import { ROLES_READ_ALL } from "../../modules/auth/role-groups.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { gstReportController } from "../../modules/gst-report/gst-report.controller.js";

export const gstReportRouter = Router();

const read = [authenticate, requireRoles(...ROLES_READ_ALL)];

gstReportRouter.get(
  "/sales-register",
  ...read,
  asyncHandler((req, res) => gstReportController.salesRegister(req, res)),
);

gstReportRouter.get(
  "/purchase-register",
  ...read,
  asyncHandler((req, res) => gstReportController.purchaseRegister(req, res)),
);

gstReportRouter.get(
  "/purchase-returns",
  ...read,
  asyncHandler((req, res) => gstReportController.purchaseReturns(req, res)),
);

gstReportRouter.get(
  "/hsn-summary",
  ...read,
  asyncHandler((req, res) => gstReportController.hsnSummary(req, res)),
);

gstReportRouter.get(
  "/summary",
  ...read,
  asyncHandler((req, res) => gstReportController.summary(req, res)),
);
