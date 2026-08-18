import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Resolve `backend/.env` regardless of process cwd (e.g. monorepo root). */
const envFilePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.env",
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4100),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:5273")
      .transform((s) =>
        s
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
    JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    AUTH_BOOTSTRAP_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
    // WhatsApp (WATI) invoice delivery. Disabled by default; when enabled the fields
    // below become required (checked in superRefine) so a misconfig fails at boot.
    WHATSAPP_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    WATI_BASE_URL: z.string().optional().default(""),
    WATI_ACCESS_TOKEN: z.string().optional().default(""),
    WATI_INVOICE_TEMPLATE_NAME: z.string().optional().default("invoice_notification"),
    WATI_BROADCAST_NAME: z.string().optional().default("invoice_notification"),
    PUBLIC_API_BASE_URL: z.string().optional().default(""),
  })
  .superRefine((data, ctx) => {
    const minSecretLen = data.NODE_ENV === "production" ? 32 : 16;
    if (data.JWT_ACCESS_SECRET.length < minSecretLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `JWT_ACCESS_SECRET must be at least ${minSecretLen} characters in ${data.NODE_ENV}`,
        path: ["JWT_ACCESS_SECRET"],
      });
    }
    if (data.JWT_REFRESH_SECRET.length < minSecretLen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `JWT_REFRESH_SECRET must be at least ${minSecretLen} characters in ${data.NODE_ENV}`,
        path: ["JWT_REFRESH_SECRET"],
      });
    }
    if (data.NODE_ENV === "production" && data.AUTH_BOOTSTRAP_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AUTH_BOOTSTRAP_ENABLED must not be true in production",
        path: ["AUTH_BOOTSTRAP_ENABLED"],
      });
    }
    if (data.WHATSAPP_ENABLED) {
      const required: [keyof typeof data, string][] = [
        ["WATI_BASE_URL", "WATI_BASE_URL"],
        ["WATI_ACCESS_TOKEN", "WATI_ACCESS_TOKEN"],
        ["WATI_INVOICE_TEMPLATE_NAME", "WATI_INVOICE_TEMPLATE_NAME"],
        ["PUBLIC_API_BASE_URL", "PUBLIC_API_BASE_URL"],
      ];
      for (const [key, label] of required) {
        if (!String(data[key] ?? "").trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${label} is required when WHATSAPP_ENABLED=true`,
            path: [key as string],
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Prisma interactive transactions (checkout, stock) need a direct Postgres session.
 * PgBouncer transaction-mode poolers break `$transaction` unless DIRECT_URL is set.
 */
function ensureDirectDatabaseUrl(): void {
  const db = process.env.DATABASE_URL?.trim();
  if (!db) return;

  const direct = process.env.DIRECT_URL?.trim();
  const usesPooler =
    /pgbouncer=true/i.test(db) ||
    /:6543\//.test(db) ||
    /pooler\./i.test(db);

  if (!direct) {
    if (usesPooler) {
      throw new Error(
        "DATABASE_URL uses a connection pooler (PgBouncer). Set DIRECT_URL to a direct/session " +
          "Postgres URL (port 5432). Checkout and inventory updates require interactive transactions.",
      );
    }
    process.env.DIRECT_URL = db;
    return;
  }

  if (usesPooler && direct === db) {
    throw new Error(
      "DIRECT_URL must be a direct Postgres connection, not the same PgBouncer URL as DATABASE_URL.",
    );
  }
}

function loadEnv(): Env {
  loadDotenv({ path: envFilePath });
  ensureDirectDatabaseUrl();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.flatten().fieldErrors;
    const hint =
      "Copy .env.example to .env in the backend folder (or run `npm run env:init` here), then set DATABASE_URL and JWT secrets (16+ characters each in development). " +
      `Loaded env from: ${envFilePath}`;
    throw new Error(`Invalid environment: ${JSON.stringify(message)}\n${hint}`);
  }
  return parsed.data;
}

export const env = loadEnv();
