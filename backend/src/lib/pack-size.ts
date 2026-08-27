import { PackSizeMeasure } from "@prisma/client";

/**
 * Parse a human pack-size label ("1kg", "500ml", "60 tablets", "30 sachets") into
 * the measure plus a normalized magnitude in that measure's base unit:
 *
 *   WEIGHT → grams   VOLUME → millilitres   COUNT → pieces   SACHET → sachets
 *
 * The normalized value exists only so listings sort correctly. Without it "500g"
 * sorts before "1kg" alphabetically and every product screen looks broken.
 * Never compare normalized values ACROSS measures — 60 tablets is not 60 ml.
 *
 * The returned `label` is CANONICAL, not what the user typed: "500G", "500 g" and
 * "500grams" all come back as "500g". That is what makes a sheet with mixed casing
 * resolve to one pack size instead of several near-duplicates.
 */
export type ParsedPackSize = {
  label: string;
  code: string;
  measure: PackSizeMeasure;
  normalizedValue: number;
};

/** unit alias → [multiplier to base unit, canonical spelling] */
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

/**
 * Countable pieces: tablets, capsules, servings. Canonical suffix is the SHORT form
 * ("tabs", "caps") — owner's preference, and it keeps POS chips narrow.
 *
 * NOTE: "pcs" deliberately does NOT live here — it is the sachet unit (below). Two
 * measures must never canonicalise to the same label, because `code` is globally
 * unique: COUNT "30 pcs" and SACHET "30 pcs" would both be code "30PCS" and the
 * second one would fail to save.
 */
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

/**
 * Sachets / sticks / pouches — a box holding N single-serve packets, e.g. a box of
 * 30 sachets. Its own measure rather than folded into COUNT so sachets never sort or
 * group alongside tablets; they are different things to count.
 *
 * Canonical suffix is "pcs" (owner's preference). Common misspellings of "sachet"
 * are accepted deliberately — staff type these in a hurry.
 */
const SACHET_UNITS: Record<string, string> = {
  sachet: "pcs", sachets: "pcs",
  satchet: "pcs", satchets: "pcs", sachette: "pcs", sachettes: "pcs",
  sasche: "pcs", saschet: "pcs", saschets: "pcs",
  pack: "pcs", packs: "pcs", packet: "pcs", packets: "pcs",
  stick: "pcs", sticks: "pcs",
  pouch: "pcs", pouches: "pcs",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
};

/** Uppercase, alphanumeric-only code derived from a label ("1 kg" → "1KG"). */
export function packSizeCode(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Drop a trailing ".0" so "1.0kg" and "1kg" cannot become two rows. */
function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}

export function parsePackSizeLabel(raw: string): ParsedPackSize | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Allow "500g", "500 G", "500grams", "30 sachets", "1.5 kg", "1,5kg".
  const m = trimmed.match(/^([\d]+(?:[.,][\d]+)?)\s*([a-zA-Z]*)\.?$/);
  if (!m) return null;

  const amount = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = (m[2] ?? "").toLowerCase();
  const num = formatAmount(amount);

  const weight = WEIGHT_UNITS[unit];
  if (weight) {
    const label = `${num}${weight[1]}`;
    return { label, code: packSizeCode(label), measure: PackSizeMeasure.WEIGHT, normalizedValue: amount * weight[0] };
  }

  const volume = VOLUME_UNITS[unit];
  if (volume) {
    const label = `${num}${volume[1]}`;
    return { label, code: packSizeCode(label), measure: PackSizeMeasure.VOLUME, normalizedValue: amount * volume[0] };
  }

  const sachet = SACHET_UNITS[unit];
  if (sachet) {
    const label = `${num} ${sachet}`;
    return { label, code: packSizeCode(label), measure: PackSizeMeasure.SACHET, normalizedValue: amount };
  }

  const count = COUNT_UNITS[unit];
  if (count !== undefined) {
    const label = count ? `${num} ${count}` : num;
    return { label, code: packSizeCode(label), measure: PackSizeMeasure.COUNT, normalizedValue: amount };
  }

  return null;
}

/** Human label for a measure, used in UI copy and import errors. */
export function measureLabel(measure: PackSizeMeasure): string {
  if (measure === PackSizeMeasure.WEIGHT) return "Weight";
  if (measure === PackSizeMeasure.VOLUME) return "Volume";
  if (measure === PackSizeMeasure.SACHET) return "Sachet / Pack";
  return "Count";
}
