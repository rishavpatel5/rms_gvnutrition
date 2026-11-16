import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import type { ApiErrorBody } from "../types/api.js";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Safety net for Prisma errors no service caught explicitly. Without this a
  // duplicate name (P2002) or a stale id (P2025) surfaces as a bare 500
  // "Internal server error" in production, which tells the user nothing.
  const prismaCode =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (prismaCode === "P2002") {
    const target = (err as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.join(", ") : typeof target === "string" ? target : "";
    res.status(409).json({
      error: {
        code: "DUPLICATE",
        message: fields
          ? `A record with this ${fields} already exists`
          : "A record with these details already exists",
      },
    });
    return;
  }
  if (prismaCode === "P2025") {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Record not found" },
    });
    return;
  }
  if (prismaCode === "P2003") {
    res.status(409).json({
      error: {
        code: "IN_USE",
        message: "This record is linked to other data and cannot be changed or removed",
      },
    });
    return;
  }

  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message:
        env.NODE_ENV === "production" ? "Internal server error" : message,
    },
  });
}
