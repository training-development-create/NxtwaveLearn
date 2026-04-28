// Quick local Darwinbox connectivity test.
//
// Usage:
//   1. Copy .darwinbox-test.env.example -> .darwinbox-test.env
//      (in the project root) and fill in the 5 values from your
//      Supabase secrets.
//   2. Run:   node scripts/test-darwinbox.mjs evarapu.akhil@nxtwave.co.in
//
// The .darwinbox-test.env file is gitignored automatically by the existing
// `.env*` rules in .gitignore. Never paste real values into source control.
//
// What this prints:
//   - The exact request being sent (with credentials redacted)
//   - The HTTP status code
//   - The raw JSON body from Darwinbox
//
// Paste the JSON body to the engineer so the parser in
// supabase/functions/sync-employee/index.ts can be aligned to your tenant's
// real response shape.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".darwinbox-test.env");

let envText;
try {
  envText = readFileSync(envPath, "utf8");
} catch {
  console.error(`Missing ${envPath}\n`);
  console.error("Create it with these 5 lines (no quotes, no spaces around =):");
  console.error("  DARWINBOX_BASE_URL=https://nwhrms.darwinbox.in");
  console.error("  DARWINBOX_USERNAME=...");
  console.error("  DARWINBOX_PASSWORD=...");
  console.error("  DARWINBOX_API_KEY=...");
  console.error("  DARWINBOX_DATASET_KEY=...");
  process.exit(1);
}

const env = {};
for (const raw of envText.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const required = ["DARWINBOX_BASE_URL", "DARWINBOX_USERNAME", "DARWINBOX_PASSWORD", "DARWINBOX_API_KEY", "DARWINBOX_DATASET_KEY"];
const missing = required.filter(k => !env[k]);
if (missing.length) {
  console.error("Missing required keys in .darwinbox-test.env:", missing.join(", "));
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/test-darwinbox.mjs <email>");
  console.error("Example: node scripts/test-darwinbox.mjs evarapu.akhil@nxtwave.co.in");
  process.exit(1);
}

const path = env.DARWINBOX_EMPLOYEE_PATH ?? "/api/employee/search";
const searchField = env.DARWINBOX_SEARCH_FIELD ?? "official_email_id";
const url = env.DARWINBOX_BASE_URL.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);
const basic = Buffer.from(`${env.DARWINBOX_USERNAME}:${env.DARWINBOX_PASSWORD}`).toString("base64");
const body = {
  api_key: env.DARWINBOX_API_KEY,
  datasetKey: env.DARWINBOX_DATASET_KEY,
  search_value: email,
  search_field: searchField,
  [searchField]: email,
};

console.log("---- REQUEST ----");
console.log("POST", url);
console.log("Headers:");
console.log("  Authorization: Basic <REDACTED>");
console.log("  Content-Type:  application/json");
console.log("Body:", JSON.stringify({ ...body, api_key: "<REDACTED>", datasetKey: "<REDACTED>" }, null, 2));
console.log();

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
} catch (e) {
  console.error("---- FETCH ERROR ----");
  console.error(e?.message || e);
  process.exit(1);
}

console.log("---- RESPONSE ----");
console.log("Status:", res.status, res.statusText);
console.log("Content-Type:", res.headers.get("content-type"));
console.log();

const text = await res.text();
try {
  const json = JSON.parse(text);
  console.log("Body (parsed JSON):");
  console.log(JSON.stringify(json, null, 2));
} catch {
  console.log("Body (raw, not JSON):");
  console.log(text);
}
