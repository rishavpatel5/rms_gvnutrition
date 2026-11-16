// Credentials come from the environment — never hardcode them here.
//   WATI_BASE_URL=... WATI_ACCESS_TOKEN=... npx tsx scripts/test-wati-live.ts
const BASE_URL = process.env.WATI_BASE_URL ?? "";
const RAW_TOKEN = process.env.WATI_ACCESS_TOKEN ?? "";
if (!BASE_URL || !RAW_TOKEN) {
  console.error("Set WATI_BASE_URL and WATI_ACCESS_TOKEN before running this script.");
  process.exit(1);
}
const TOKEN = RAW_TOKEN.startsWith("Bearer ") ? RAW_TOKEN : `Bearer ${RAW_TOKEN}`;

async function fetchWati(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  console.log(`\n>>> Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: TOKEN,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.log("Raw Response:", text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

async function run() {
  console.log("=== Testing WATI API Connection ===");

  // 1. Get template list / details
  console.log("\n1. Checking templates...");
  await fetchWati("/api/v1/getMessageTemplates");
  await fetchWati("/api/v1/getTemplates");

  // 2. Check channel / account / balance details
  console.log("\n2. Checking wallet / account info...");
  await fetchWati("/api/v1/getChannelStatus");
  await fetchWati("/api/v1/getContacts");
}

run();
