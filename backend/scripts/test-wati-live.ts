const BASE_URL = "https://live-mt-server.wati.io/10210501";
// From screenshot:
const TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI1ODNmODIxZGFjZGE5Y2hlbW1pY3J2c29mdC5jb20iLCJhdWQiOiJhdHRpcmVieWd2LmNvbSIsImlzcyI6Imh0dHA6Ly92MmhibWFzLm1pY3Jvc29mdC5jb20iLCJleHAiOjE4MDcwODg1MjksIm5ibSI6MTcwNzg4ODUyOX0.UkFUT1IiLCJleHAiOjE1MzQwMjMwMDgwMCwiaXNzIioiQ2VfQUkiLCJhdWQiOiQ2VfQUkiLCJhdWQiOiJDbGFyY2V9BSSJ9.bMTflYaPG0El-4uRaC71OLr29ocaF0GkfcXt1AU";

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
