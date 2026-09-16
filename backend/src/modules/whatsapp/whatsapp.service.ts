import { Prisma, WhatsAppMessageStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { AppError } from "../../middleware/error-handler.js";
import { normalizeWhatsAppPhone } from "../../lib/phone.js";
import { addContact, sendTemplateMessage, WatiUnreachableError } from "./wati.client.js";

/** Public API PDF link that goes into template variable {{4}} (NOT the www redirect page). */
function invoiceLink(orderId: string): string {
  return `${env.PUBLIC_API_BASE_URL.replace(/\/$/, "")}/i/${encodeURIComponent(orderId)}`;
}

export function extractProviderMessageId(body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const key of ["id", "messageId", "whatsappMessageId", "ticketId"]) {
      const v = b[key];
      if (typeof v === "string" && v.length > 0) return v;
    }
    if (Array.isArray(b.receivers) && b.receivers.length > 0) {
      const first = b.receivers[0] as Record<string, unknown>;
      if (typeof first?.localMessageId === "string" && first.localMessageId.length > 0) {
        return first.localMessageId;
      }
    }
  }
  return null;
}

/**
 * Helper to check if a value represents an explicit success in WATI result field.
 */
export function isExplicitSuccessResult(result: unknown): boolean {
  if (result === true) return true;
  if (typeof result === "string") {
    const r = result.trim().toLowerCase();
    return r === "success" || r === "true" || r === "ok";
  }
  return false;
}

/**
 * Helper to check if a value represents an explicit failure in WATI result field.
 */
export function isExplicitFailureResult(result: unknown): boolean {
  if (result === false) return true;
  if (typeof result === "string") {
    const r = result.trim().toLowerCase();
    return ["false", "error", "failed", "no_available_payment", "rejected", "failure"].includes(r);
  }
  return false;
}

/**
 * Extract all error messages and descriptions from various WATI response schemas.
 */
export function collectWatiErrorMessages(body: unknown): string[] {
  const messages: string[] = [];
  if (!body) return messages;

  if (typeof body !== "object") {
    if (typeof body === "string" && body.trim().length > 0) {
      messages.push(body.trim());
    }
    return messages;
  }

  const b = body as Record<string, unknown>;

  // Direct string message fields
  for (const field of ["message", "detail", "title", "description"]) {
    const val = b[field];
    if (typeof val === "string" && val.trim().length > 0) {
      messages.push(val.trim());
    }
  }

  // WATI info field
  if (
    typeof b.info === "string" &&
    b.info.trim().length > 0 &&
    !["success", "ok", "message accepted"].includes(b.info.trim().toLowerCase())
  ) {
    messages.push(b.info.trim());
  }

  // b.error can be a string or object
  if (typeof b.error === "string" && b.error.trim().length > 0) {
    messages.push(b.error.trim());
  } else if (b.error && typeof b.error === "object") {
    const errObj = b.error as Record<string, unknown>;
    if (typeof errObj.message === "string" && errObj.message.trim().length > 0) {
      messages.push(errObj.message.trim());
    }
    if (typeof errObj.error === "string" && errObj.error.trim().length > 0) {
      messages.push(errObj.error.trim());
    }
  }

  // b.errors can be an array or ModelState dictionary
  if (Array.isArray(b.errors)) {
    for (const item of b.errors) {
      if (typeof item === "string" && item.trim().length > 0) {
        messages.push(item.trim());
      } else if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        if (typeof itemObj.error === "string") messages.push(itemObj.error.trim());
        if (typeof itemObj.message === "string") messages.push(itemObj.message.trim());
        if (typeof itemObj.description === "string") messages.push(itemObj.description.trim());
      }
    }
  } else if (b.errors && typeof b.errors === "object") {
    for (const val of Object.values(b.errors)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string" && item.trim().length > 0) messages.push(item.trim());
        }
      } else if (typeof val === "string" && val.trim().length > 0) {
        messages.push(val.trim());
      }
    }
  }

  // b.modelState validation errors
  if (b.modelState && typeof b.modelState === "object") {
    for (const val of Object.values(b.modelState)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string" && item.trim().length > 0) messages.push(item.trim());
        }
      } else if (typeof val === "string" && val.trim().length > 0) {
        messages.push(val.trim());
      }
    }
  }

  // b.receivers array
  if (Array.isArray(b.receivers)) {
    for (const r of b.receivers) {
      if (r && typeof r === "object") {
        const rObj = r as Record<string, unknown>;
        if (Array.isArray(rObj.errors)) {
          for (const item of rObj.errors) {
            if (typeof item === "string" && item.trim().length > 0) {
              messages.push(item.trim());
            } else if (item && typeof item === "object") {
              const itemObj = item as Record<string, unknown>;
              if (typeof itemObj.error === "string") messages.push(itemObj.error.trim());
              if (typeof itemObj.message === "string") messages.push(itemObj.message.trim());
            }
          }
        }
        if (
          rObj.isValidWhatsAppNumber === false &&
          Array.isArray(rObj.errors) &&
          rObj.errors.length > 0
        ) {
          messages.push("Receiver number is not a valid WhatsApp number");
        }
      }
    }
  }

  return Array.from(new Set(messages)).filter(Boolean);
}

export type WatiAnalysis = {
  isSuccess: boolean;
  httpStatus: number;
  errorCode: string;
  userMessage: string;
  rawDetails: string;
  isUnconfirmed: boolean;
};

/**
 * Robustly inspect WATI API responses to determine success and accurately diagnose failures.
 */
export function parseWatiResponse(
  res: { ok: boolean; status: number; body: unknown },
  context: { phone: string; templateName: string },
): WatiAnalysis {
  const rawDetails =
    typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {});

  let hasExplicitFailure = false;
  let hasExplicitSuccess = false;
  let hasReceiverErrors = false;
  let hasModelStateErrors = false;
  let hasGeneralErrors = false;

  if (res.body && typeof res.body === "object") {
    const b = res.body as Record<string, unknown>;
    hasExplicitFailure = isExplicitFailureResult(b.result);
    hasExplicitSuccess = isExplicitSuccessResult(b.result);

    if (b.error !== undefined && b.error !== null && b.error !== "") {
      hasGeneralErrors = true;
    }
    if (Array.isArray(b.errors) && b.errors.length > 0) {
      hasGeneralErrors = true;
    } else if (b.errors && typeof b.errors === "object" && Object.keys(b.errors).length > 0) {
      hasGeneralErrors = true;
    }
    if (b.modelState && typeof b.modelState === "object" && Object.keys(b.modelState).length > 0) {
      hasModelStateErrors = true;
    }
    if (Array.isArray(b.receivers)) {
      for (const r of b.receivers) {
        if (r && typeof r === "object") {
          const rObj = r as Record<string, unknown>;
          if (Array.isArray(rObj.errors) && rObj.errors.length > 0) {
            hasReceiverErrors = true;
          }
        }
      }
    }
  }

  const isSuccess =
    res.ok &&
    !hasExplicitFailure &&
    !hasGeneralErrors &&
    !hasModelStateErrors &&
    !hasReceiverErrors &&
    (hasExplicitSuccess || (!res.body || typeof res.body !== "object" || (res.status >= 200 && res.status < 300)));

  if (isSuccess) {
    return {
      isSuccess: true,
      httpStatus: res.status,
      errorCode: "OK",
      userMessage: "Invoice sent on WhatsApp successfully",
      rawDetails,
      isUnconfirmed: false,
    };
  }

  const errorMessages = collectWatiErrorMessages(res.body);

  const combinedText = [
    `HTTP_${res.status}`,
    ...errorMessages,
    rawDetails,
  ].join(" ").toLowerCase();

  const primaryRawMsg =
    errorMessages[0] ||
    (res.status >= 400 ? `HTTP ${res.status}` : "Message rejected by WATI provider");

  // 1. Server Error / Network Timeout (ambiguous delivery -> UNCONFIRMED)
  if (res.status >= 500) {
    return {
      isSuccess: false,
      httpStatus: res.status,
      errorCode: "UNCONFIRMED",
      userMessage: `WATI server encountered an error (HTTP ${res.status}). Message delivery is unconfirmed. Check customer's WhatsApp before resending.`,
      rawDetails,
      isUnconfirmed: true,
    };
  }

  // 2. Authentication / Permissions
  if (
    res.status === 401 ||
    res.status === 403 ||
    /unauthorized|forbidden|invalid.*token|bearer.*invalid|access.*token.*expired|invalid.*api.*key/i.test(
      combinedText,
    )
  ) {
    return {
      isSuccess: false,
      httpStatus: res.status,
      errorCode: "WATI_AUTH_FAILED",
      userMessage: `WATI authentication failed. Your WATI Access Token or Base URL is invalid/expired. Please check your backend WATI credentials. (${primaryRawMsg})`,
      rawDetails,
      isUnconfirmed: false,
    };
  }

  // 3. Wallet / Recharge / Billing / Subscription Expired / Repurchase Required
  if (
    res.status === 402 ||
    /insufficient|balance|credit|wallet|recharge|payment|billing|subscription|expired|repurchase|no_available_payment|unpaid|payment_required|suspended|quota|limit_reached|deactivated/i.test(
      combinedText,
    )
  ) {
    return {
      isSuccess: false,
      httpStatus: res.status,
      errorCode: "WATI_WALLET_EMPTY",
      userMessage: `WATI wallet balance is exhausted or API subscription is unpaid/expired. Please recharge your WATI wallet or renew your plan in the WATI dashboard to send WhatsApp invoices. (${primaryRawMsg})`,
      rawDetails,
      isUnconfirmed: false,
    };
  }

  // 4. Template Error (Not found, not approved, param mismatch)
  if (
    /template|template_name|broadcast_name|not approved|does not exist|parameter|variable.*mismatch|header mismatch/i.test(
      combinedText,
    )
  ) {
    return {
      isSuccess: false,
      httpStatus: res.status,
      errorCode: "WATI_TEMPLATE_ERROR",
      userMessage: `WATI template error: Template '${context.templateName}' was not found or is not approved in your WATI account. Check your WATI dashboard. (${primaryRawMsg})`,
      rawDetails,
      isUnconfirmed: false,
    };
  }

  // 5. Invalid Phone Number / Not on WhatsApp
  if (
    /invalid.*(?:number|phone|whatsapp)|not on whatsapp|131026|undeliverable|validwhatsappnumber.*false|invalidwhatsappnumber/i.test(
      combinedText,
    )
  ) {
    return {
      isSuccess: false,
      httpStatus: res.status,
      errorCode: "WATI_INVALID_PHONE",
      userMessage: `Customer phone number (${context.phone}) is invalid or not registered on WhatsApp. (${primaryRawMsg})`,
      rawDetails,
      isUnconfirmed: false,
    };
  }

  // 6. Generic rejection
  return {
    isSuccess: false,
    httpStatus: res.status,
    errorCode: `WATI_REJECTED_HTTP_${res.status}`,
    userMessage: `WhatsApp message was rejected by WATI: ${primaryRawMsg}`,
    rawDetails,
    isUnconfirmed: false,
  };
}

export type SendInvoiceResult = {
  status: WhatsAppMessageStatus;
  dryRun?: boolean;
};

/**
 * Send the invoice for a confirmed sale to the customer's WhatsApp via WATI.
 * Runs strictly AFTER checkout has committed — never inside the sale transaction —
 * so a WhatsApp failure can never affect money or stock. Every attempt is recorded
 * in `whatsapp_logs`.
 */
export async function sendInvoiceForOrder(input: {
  orderId: string;
  sentById: string | null;
  force?: boolean;
}): Promise<SendInvoiceResult> {
  const { orderId, force } = input;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      documentType: true,
      status: true,
      invoiceNumber: true,
      grandTotal: true,
      customer: { select: { id: true, fullName: true, phone: true } },
    },
  });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
  if (order.documentType !== "SALE" || order.status !== "CONFIRMED" || !order.invoiceNumber) {
    throw new AppError(400, "INVOICE_NOT_SENDABLE", "Only confirmed sale invoices can be sent");
  }

  const phone = normalizeWhatsAppPhone(order.customer?.phone);
  if (!phone) {
    throw new AppError(400, "NO_PHONE", "This sale has no valid customer phone number");
  }

  // Guard against duplicate charged messages. Blocks a plain resend when we either already
  // sent, OR had a previous attempt whose outcome we couldn't confirm (timeout / server error) —
  // that one MAY have been delivered, so a silent retry risks a duplicate. A deliberate resend
  // passes force after the operator has verified.
  if (!force) {
    const blocker = await prisma.whatsAppLog.findFirst({
      where: {
        orderId,
        OR: [
          {
            status: {
              in: [WhatsAppMessageStatus.SENT, WhatsAppMessageStatus.DELIVERED, WhatsAppMessageStatus.READ],
            },
          },
          { errorCode: "UNCONFIRMED" },
        ],
      },
      select: { status: true },
    });
    if (blocker) {
      const sentStatuses: WhatsAppMessageStatus[] = [
        WhatsAppMessageStatus.SENT,
        WhatsAppMessageStatus.DELIVERED,
        WhatsAppMessageStatus.READ,
      ];
      const alreadySent = sentStatuses.includes(blocker.status);
      throw new AppError(
        409,
        alreadySent ? "ALREADY_SENT" : "SEND_UNCONFIRMED",
        alreadySent
          ? "Invoice already sent on WhatsApp for this order"
          : "A previous send couldn't be confirmed and may already have been delivered. Check the customer's WhatsApp before resending.",
      );
    }
  }

  const customerName = order.customer?.fullName?.trim() || "there";
  const parameters = [
    { name: "1", value: customerName },
    { name: "2", value: order.invoiceNumber },
    { name: "3", value: order.grandTotal.toFixed(2) },
    { name: "4", value: invoiceLink(orderId) },
  ];

  if (!env.WHATSAPP_ENABLED) {
    await prisma.whatsAppLog.create({
      data: {
        customerId: order.customer?.id ?? null,
        orderId,
        templateName: env.WATI_INVOICE_TEMPLATE_NAME,
        toPhone: phone,
        payload: { parameters } as Prisma.InputJsonValue,
        status: WhatsAppMessageStatus.FAILED,
        errorCode: "WHATSAPP_DISABLED",
        errorDetail: "WHATSAPP_ENABLED is set to false in server environment variables.",
      },
    });
    throw new AppError(
      400,
      "WHATSAPP_DISABLED",
      "WhatsApp automated invoice sending is disabled in server settings (WHATSAPP_ENABLED=false). Configure WATI in backend environment variables to send automated messages, or use the manual WhatsApp Share option.",
    );
  }

  const log = await prisma.whatsAppLog.create({
    data: {
      customerId: order.customer?.id ?? null,
      orderId,
      templateName: env.WATI_INVOICE_TEMPLATE_NAME,
      toPhone: phone,
      payload: { parameters } as Prisma.InputJsonValue,
      status: WhatsAppMessageStatus.QUEUED,
    },
  });

  await addContact({ phone, name: order.customer?.fullName ?? null });

  let res;
  try {
    res = await sendTemplateMessage({
      phone,
      templateName: env.WATI_INVOICE_TEMPLATE_NAME,
      broadcastName: env.WATI_BROADCAST_NAME || env.WATI_INVOICE_TEMPLATE_NAME,
      parameters,
    });
  } catch (err) {
    // No response from WATI (timeout / network). Delivery is UNKNOWN — it may have gone through.
    // Mark UNCONFIRMED so a plain retry is blocked (prevents duplicate charges).
    const detail = err instanceof WatiUnreachableError || err instanceof Error ? err.message : "WATI request failed";
    await prisma.whatsAppLog.update({
      where: { id: log.id },
      data: { status: WhatsAppMessageStatus.FAILED, errorCode: "UNCONFIRMED", errorDetail: detail.slice(0, 1000) },
    });
    throw new AppError(
      502,
      "WHATSAPP_SEND_UNCONFIRMED",
      `Couldn't confirm the WhatsApp send: ${detail}. Delivery is unconfirmed — check customer's WhatsApp before resending.`,
    );
  }

  const analysis = parseWatiResponse(res, {
    phone,
    templateName: env.WATI_INVOICE_TEMPLATE_NAME,
  });

  if (!analysis.isSuccess) {
    await prisma.whatsAppLog.update({
      where: { id: log.id },
      data: {
        status: WhatsAppMessageStatus.FAILED,
        errorCode: analysis.errorCode,
        errorDetail: analysis.rawDetails.slice(0, 1000),
        payload: { parameters, response: res.body } as Prisma.InputJsonValue,
      },
    });
    logger.warn(
      { orderId, phone, status: res.status, errorCode: analysis.errorCode, body: res.body },
      "WATI WhatsApp invoice send failed",
    );
    throw new AppError(
      analysis.isUnconfirmed ? 502 : 400,
      analysis.errorCode,
      analysis.userMessage,
    );
  }

  await prisma.whatsAppLog.update({
    where: { id: log.id },
    data: {
      status: WhatsAppMessageStatus.SENT,
      sentAt: new Date(),
      providerMessageId: extractProviderMessageId(res.body),
      payload: { parameters, response: res.body } as Prisma.InputJsonValue,
    },
  });

  logger.info(
    {
      orderId,
      phone,
      providerMessageId: extractProviderMessageId(res.body),
      watiResponse: res.body,
    },
    "WATI WhatsApp invoice API accepted",
  );

  return { status: WhatsAppMessageStatus.SENT };
}
