export const STORE_NAME = import.meta.env.VITE_STORE_NAME?.trim() || "GV Nutrition";

/**
 * Full horizontal lockup (figure + "GV NUTRITION"), ~2.5:1.
 * Trimmed of transparent padding — the original 500x500 square had the artwork
 * filling only 31% of its height, so it rendered tiny at any fixed height.
 */
export const STORE_LOGO_PATH =
  import.meta.env.VITE_STORE_LOGO_PATH?.trim() || "/brand/gvlogo.png";

/**
 * Square-ish mark (the athlete figure alone, ~1:1). Use wherever the space is
 * narrow or square — the collapsed sidebar rail and the favicon — because the
 * wide lockup becomes an illegible sliver below about 24px tall.
 */
export const STORE_LOGO_MARK_PATH =
  import.meta.env.VITE_STORE_LOGO_MARK_PATH?.trim() || "/brand/gvlogo-mark.png";

export const STORE_LOGO_ALT = `${STORE_NAME} logo`;
