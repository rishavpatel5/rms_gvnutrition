import fs from "fs";
import path from "path";

/** Store profile for invoice PDFs — env-backed until Settings UI exists. */
export type StoreConfig = {
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  logoPath: string | null;
  thankYouNote: string;
  returnPolicy: string;
};

function env(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

export function getStoreConfig(): StoreConfig {
  const logoRaw = env("STORE_LOGO_PATH");
  let logoPath: string | null = null;
  if (logoRaw) {
    const resolved = path.isAbsolute(logoRaw) ? logoRaw : path.resolve(process.cwd(), logoRaw);
    if (fs.existsSync(resolved)) logoPath = resolved;
  }

  return {
    name: env("STORE_NAME", "GV Nutrition"),
    address: env("STORE_ADDRESS", ""),
    phone: env("STORE_PHONE", ""),
    email: env("STORE_EMAIL", ""),
    gstin: env("STORE_GSTIN", ""),
    logoPath,
    thankYouNote: env(
      "STORE_INVOICE_THANK_YOU",
      "Thank you for shopping with us. We look forward to seeing you again.",
    ),
    returnPolicy: env(
      "STORE_RETURN_POLICY",
      "Returns & exchanges within 7 days with original bill and tags intact.",
    ),
  };
}
