/**
 * Client mirror of the backend pack-size parser (backend/src/lib/pack-size.ts).
 * Keep the two in sync — the server re-validates, this exists so the UI can show
 * the measure and the canonical label before a round trip.
 *
 * The returned `label` is CANONICAL, not what was typed: "500G", "500 g" and
 * "500grams" all become "500g". That is what stops mixed casing from creating
 * several near-duplicate pack sizes.
 */
export const PACK_MEASURES = ["WEIGHT", "VOLUME", "COUNT", "SACHET"] as const;
export type PackMeasure = (typeof PACK_MEASURES)[number];

export type ParsedPackSize = {
  label: string;
  code: string;
  measure: PackMeasure;
  normalizedValue: number;
};

const WEIGHT_UNITS: Record<string, [number, string]> = {
  g: [1, "g"], gm: [1, "g"], gms: [1, "g"], gram: [1, "g"], grams: [1, "g"],
  kg: [1000, "kg"], kgs: [1000, "kg"], kilo: [1000, "kg"], kilos: [1000, "kg"],
  kilogram: [1000, "kg"], kilograms: [1000, "kg"],
  lb: [453.592, "lb"], lbs: [453.592, "lb"], pound: [453.592, "lb"], pounds: [453.592, "lb"],
};

const VOLUME_UNITS: Record<string, [number, string]> = {
  ml: [1, "ml"], mls: [1, "ml"],
  millilitre: [1, "ml"], millilitres: [1, "ml"], milliliter: [1, "ml"], milliliters: [1, "ml"],
  l: [1000, "L"], lt: [1000, "L"], ltr: [1000, "L"],
  litre: [1000, "L"], litres: [1000, "L"], liter: [1000, "L"], liters: [1000, "L"],
};

/** "pcs" is NOT here — it belongs to SACHET. Two measures must not share a label. */
const COUNT_UNITS: Record<string, string> = {
  "": "",
  tab: "tabs", tabs: "tabs", tablet: "tabs", tablets: "tabs",
  cap: "caps", caps: "caps", capsule: "caps", capsules: "caps",
  softgel: "caps", softgels: "caps",
  // "SER" is how the owner writes servings on the import sheet; the long forms
  // resolve to the same row so a mixed sheet does not create near-duplicates.
  ser: "servings", sers: "servings", serv: "servings", servs: "servings",
  serving: "servings", servings: "servings", scoop: "scoops", scoops: "scoops",
  count: "", n: "",
};

const SACHET_UNITS: Record<string, string> = {
  sachet: "pcs", sachets: "pcs",
  satchet: "pcs", satchets: "pcs", sachette: "pcs", sachettes: "pcs",
  sasche: "pcs", saschet: "pcs", saschets: "pcs",
  pack: "pcs", packs: "pcs", packet: "pcs", packets: "pcs",
  stick: "pcs", sticks: "pcs",
  pouch: "pcs", pouches: "pcs",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
};

export function packSizeCode(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export function parsePackSizeLabel(raw: string): ParsedPackSize | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const m = trimmed.match(/^([\d]+(?:[.,][\d]+)?)\s*([a-zA-Z]*)\.?$/);
  if (!m) return null;

  const amount = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = (m[2] ?? "").toLowerCase();
  const num = formatAmount(amount);

  const weight = WEIGHT_UNITS[unit];
  if (weight) {
    const label = `${num}${weight[1]}`;
    return { label, code: packSizeCode(label), measure: "WEIGHT", normalizedValue: amount * weight[0] };
  }
  const volume = VOLUME_UNITS[unit];
  if (volume) {
    const label = `${num}${volume[1]}`;
    return { label, code: packSizeCode(label), measure: "VOLUME", normalizedValue: amount * volume[0] };
  }
  const sachet = SACHET_UNITS[unit];
  if (sachet) {
    const label = `${num} ${sachet}`;
    return { label, code: packSizeCode(label), measure: "SACHET", normalizedValue: amount };
  }
  const count = COUNT_UNITS[unit];
  if (count !== undefined) {
    const label = count ? `${num} ${count}` : num;
    return { label, code: packSizeCode(label), measure: "COUNT", normalizedValue: amount };
  }
  return null;
}

export function measureLabel(measure: PackMeasure): string {
  if (measure === "WEIGHT") return "Weight";
  if (measure === "VOLUME") return "Volume";
  if (measure === "SACHET") return "Sachet / Pack";
  return "Count";
}

export function measureHint(measure: PackMeasure): string {
  if (measure === "WEIGHT") return "Powders — whey, gainer, creatine, oats";
  if (measure === "VOLUME") return "Liquid supplements";
  if (measure === "SACHET") return "Single-serve packets in a box";
  return "Tablets, capsules and servings";
}

/** Starting suggestions per measure. Staff can always type something else. */
export const PACK_PRESETS: Record<PackMeasure, string[]> = {
  WEIGHT: ["250g", "400g", "500g", "1kg", "2kg", "3kg", "5kg"],
  VOLUME: ["250ml", "500ml", "1L"],
  COUNT: ["30 tabs", "60 tabs", "90 tabs", "120 tabs", "30 servings", "60 servings"],
  SACHET: ["10 pcs", "15 pcs", "20 pcs", "30 pcs"],
};
