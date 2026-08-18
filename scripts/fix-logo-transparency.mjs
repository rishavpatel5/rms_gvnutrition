/**
 * One-off helper: convert a logo to PNG with a transparent background.
 * NOT needed for the current GV Nutrition logo — it is already RGBA with an
 * 86% transparent background. Kept only in case a future logo arrives flattened.
 * Run from repo root: node scripts/fix-logo-transparency.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  path.join(root, "frontend/public/brand/gvlogo.png"),
  path.join(root, "backend/assets/logo.png"),
];

/** Pixels darker than this become fully transparent. */
const BLACK_THRESHOLD = 40;

async function fixLogo(filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD) {
      data[i + 3] = 0;
    }
  }

  const png = await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, filePath);
  console.log(`Fixed ${path.relative(root, filePath)} (${info.width}x${info.height})`);
}

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.warn(`Skip missing ${target}`);
    continue;
  }
  await fixLogo(target);
}
