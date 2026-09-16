import assert from "node:assert/strict";
import { test, describe } from "node:test";
import {
  collectWatiErrorMessages,
  extractProviderMessageId,
  parseWatiResponse,
} from "./whatsapp.service.js";

describe("WhatsApp / WATI Diagnostic Parser Tests", () => {
  describe("extractProviderMessageId", () => {
    test("extracts top-level message ID fields", () => {
      assert.equal(extractProviderMessageId({ id: "msg_123" }), "msg_123");
      assert.equal(extractProviderMessageId({ messageId: "wamid_456" }), "wamid_456");
      assert.equal(extractProviderMessageId({ whatsappMessageId: "wam_789" }), "wam_789");
      assert.equal(extractProviderMessageId({ ticketId: "ticket_101" }), "ticket_101");
    });

    test("extracts localMessageId from receivers array", () => {
      const body = {
        result: true,
        receivers: [{ localMessageId: "rec_999", waId: "919876543210" }],
      };
      assert.equal(extractProviderMessageId(body), "rec_999");
    });

    test("returns null if no ID present", () => {
      assert.equal(extractProviderMessageId({ result: false }), null);
      assert.equal(extractProviderMessageId(null), null);
    });
  });

  describe("collectWatiErrorMessages", () => {
    test("extracts messages from standard object fields", () => {
      const body = {
        message: "Insufficient balance to send template message",
        detail: "Payment required for tenant",
        info: "NO_AVAILABLE_PAYMENT",
      };
      const messages = collectWatiErrorMessages(body);
      assert.ok(messages.includes("Insufficient balance to send template message"));
      assert.ok(messages.includes("NO_AVAILABLE_PAYMENT"));
      assert.ok(messages.includes("Payment required for tenant"));
    });

    test("extracts errors from array of objects", () => {
      const body = {
        errors: [
          { code: "insufficient_credits", error: "Credit balance is zero" },
          { message: "Account plan expired" },
        ],
      };
      const messages = collectWatiErrorMessages(body);
      assert.ok(messages.includes("Credit balance is zero"));
      assert.ok(messages.includes("Account plan expired"));
    });

    test("extracts errors from receivers array", () => {
      const body = {
        result: false,
        receivers: [
          {
            waId: "919876543210",
            isValidWhatsAppNumber: false,
            errors: [{ code: "131026", error: "Message undeliverable to number" }],
          },
        ],
      };
      const messages = collectWatiErrorMessages(body);
      assert.ok(messages.includes("Message undeliverable to number"));
      assert.ok(messages.includes("Receiver number is not a valid WhatsApp number"));
    });

    test("extracts errors from ASP.NET ModelState dictionary", () => {
      const body = {
        modelState: {
          template: ["The template field is invalid."],
        },
      };
      const messages = collectWatiErrorMessages(body);
      assert.ok(messages.includes("The template field is invalid."));
    });
  });

  describe("parseWatiResponse Error Categorization", () => {
    const ctx = { phone: "919876543210", templateName: "gvnutrition_invoice" };

    test("identifies true successful send (result: true / success)", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: "success",
          info: "Message accepted",
          validWhatsAppNumber: true,
          modelState: null,
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, true);
      assert.equal(analysis.errorCode, "OK");
    });

    test("identifies wallet empty / unbilled / insufficient balance (HTTP 200 with result: error)", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: "error",
          message: "Insufficient balance to send template message",
          errors: ["Insufficient balance"],
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_WALLET_EMPTY");
      assert.ok(
        analysis.userMessage.includes("WATI wallet balance is exhausted or API subscription is unpaid/expired"),
      );
      assert.ok(analysis.userMessage.includes("Insufficient balance"));
    });

    test("identifies NO_AVAILABLE_PAYMENT in WATI info / result", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: false,
          info: "NO_AVAILABLE_PAYMENT",
          message: "No payment method configured or wallet balance empty",
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_WALLET_EMPTY");
      assert.ok(analysis.userMessage.includes("WATI wallet balance is exhausted"));
    });

    test("identifies subscription expired / plan repurchase issue", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: "error",
          message: "Your subscription is expired. Please repurchase plan.",
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_WALLET_EMPTY");
      assert.ok(analysis.userMessage.includes("WATI wallet balance is exhausted or API subscription is unpaid/expired"));
    });

    test("identifies template not found or not approved error", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: "error",
          message: "Template gvnutrition_invoice was not found or is not approved by Meta",
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_TEMPLATE_ERROR");
      assert.ok(analysis.userMessage.includes("Template 'gvnutrition_invoice' was not found or is not approved"));
    });

    test("identifies invalid customer phone number error", () => {
      const res = {
        ok: true,
        status: 200,
        body: {
          result: false,
          message: "Invalid WhatsApp Number: 919876543210",
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_INVALID_PHONE");
      assert.ok(analysis.userMessage.includes("Customer phone number (919876543210) is invalid"));
    });

    test("identifies HTTP 401 / 403 authentication failure", () => {
      const res = {
        ok: false,
        status: 401,
        body: {
          error: "Unauthorized",
          message: "Invalid access token",
        },
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "WATI_AUTH_FAILED");
      assert.ok(analysis.userMessage.includes("WATI authentication failed"));
    });

    test("identifies HTTP 500 server error as unconfirmed", () => {
      const res = {
        ok: false,
        status: 502,
        body: "Bad Gateway",
      };
      const analysis = parseWatiResponse(res, ctx);
      assert.equal(analysis.isSuccess, false);
      assert.equal(analysis.errorCode, "UNCONFIRMED");
      assert.equal(analysis.isUnconfirmed, true);
    });
  });
});
