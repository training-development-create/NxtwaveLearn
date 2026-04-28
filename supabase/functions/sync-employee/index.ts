// Edge function: sync-employee
// -----------------------------
// Calls the **Darwinbox HR API** to fetch the caller's employee record by
// email, then maps it into the local employees + departments + sub_departments
// + manager rows. Triggered by the frontend on every login (cheap when the
// row is already cached within DARWINBOX_RESYNC_DAYS).
//
// Darwinbox auth pattern (standard for nwhrms.darwinbox.in):
//   POST  {BASE_URL}/{ENDPOINT_PATH}
//   Headers:
//     Authorization: Basic base64(username:password)
//     Content-Type:  application/json
//   Body:
//     { "api_key": "...", "datasetKey": "...",  ...search params }
//
// Two key sets are configured because Darwinbox stores active and inactive
// employees in separate datasets (most tenants). We try the active dataset
// first; if no employee is found we fall back to the inactive dataset.
//
// Why server-side: the username, password, API key, and dataset key MUST
// NOT ship to the browser. They live in Supabase function secrets only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DARWINBOX_RESYNC_DAYS = 30;

// Default endpoint: Darwinbox employee master API. Override per-tenant via
// DARWINBOX_EMPLOYEE_PATH if your account uses a different path.
const DEFAULT_EMPLOYEE_PATH = "/masterapi/employee";
// Default request body uses Darwinbox's standard "search by official email"
// shape. Override the field names at runtime via env vars if your account
// uses different field names.
const DEFAULT_SEARCH_FIELD = "official_email_id";

type DarwinboxEmployee = {
  full_name: string;
  email: string;
  employee_code: string;
  contact: string | null;
  department_name: string | null;
  sub_department_name: string | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_contact: string | null;
  manager_employee_code: string | null;
  is_inactive: boolean;
};

type DarwinboxCallResult =
  | { employee: DarwinboxEmployee; debug?: string }
  | { employee: null; debug: string };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Convert "first middle last" / first/last fields into one display name.
function pickName(r: Record<string, unknown>): string {
  const direct = r.full_name ?? r.display_name ?? r.employee_name ?? r.name;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const first = String(r.first_name ?? r.firstname ?? r.fname ?? "").trim();
  const middle = String(r.middle_name ?? r.middlename ?? r.mname ?? "").trim();
  const last = String(r.last_name ?? r.lastname ?? r.lname ?? "").trim();
  return [first, middle, last].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Darwinbox API client.
// Calls one dataset (active or inactive). Returns null if no record found
// or if config is missing.
// ---------------------------------------------------------------------------
async function callDarwinbox(
  email: string,
  apiKey: string,
  datasetKey: string,
  isInactive: boolean,
  path: string,
): Promise<DarwinboxCallResult> {
  const baseUrl = Deno.env.get("DARWINBOX_BASE_URL");
  const username = Deno.env.get("DARWINBOX_USERNAME");
  const password = Deno.env.get("DARWINBOX_PASSWORD");
  const searchField = Deno.env.get("DARWINBOX_SEARCH_FIELD") ?? DEFAULT_SEARCH_FIELD;

  if (!baseUrl || !username || !password) {
    console.warn("[sync-employee] Darwinbox base url / username / password not set");
    return { employee: null, debug: "Darwinbox base url / username / password missing" };
  }

  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
  const basic = btoa(`${username}:${password}`);

  // Body shape — keep both common Darwinbox search key variants:
  // - search_field/search_value
  // - field/value
  // and keep api_key + datasetKey as per tenant docs.
  const body = {
    api_key: apiKey,
    datasetKey: datasetKey,
    search_value: email,
    search_field: searchField,
    value: email,
    field: searchField,
    // some tenants want both; harmless if unused:
    [searchField]: email,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("[sync-employee] Darwinbox fetch threw:", e);
    return { employee: null, debug: "Darwinbox fetch threw (network/CORS/TLS)" };
  }

  if (!res.ok) {
    console.error(`[sync-employee] Darwinbox ${isInactive ? "inactive" : "active"} returned ${res.status}: ${await res.text().catch(() => "")}`);
    return { employee: null, debug: `Darwinbox returned HTTP ${res.status}` };
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text().catch(() => "");
  const looksHtml = contentType.includes("text/html") || /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
  if (looksHtml) {
    const hint = "Darwinbox returned HTML (likely login page). Check DARWINBOX_EMPLOYEE_PATH / auth for API endpoint.";
    console.error(`[sync-employee] ${hint} path=${path}`);
    return { employee: null, debug: `${hint} path=${path}` };
  }
  const raw = (() => {
    try { return JSON.parse(text); } catch { return null; }
  })();
  if (!raw) return { employee: null, debug: `Darwinbox returned non-JSON response on path=${path}` };

  // Darwinbox typically wraps the result. Common shapes:
  //   { status: 200, employees: [ {...} ] }
  //   { status: 1, employee_data: [ {...} ] }
  //   { status: 200, data: { employees: [...] } }
  //   { status: 200, data: { employee_data: [...] } }
  //   { status: 200, response: { employees: [...] } }
  //   { status: 200, response: { employee_data: [...] } }
  //   { status: 200, response: { result: [...] } }
  //   { status: 200, employee: {...} }
  //   { ...rawEmployee }   (rare, single-record)
  const records: Record<string, unknown>[] =
    (raw.employees as Record<string, unknown>[] | undefined)
    ?? (raw.employee_data as Record<string, unknown>[] | undefined)
    ?? (raw.data?.employees as Record<string, unknown>[] | undefined)
    ?? (raw.data?.employee_data as Record<string, unknown>[] | undefined)
    ?? (raw.response?.employees as Record<string, unknown>[] | undefined)
    ?? (raw.response?.employee_data as Record<string, unknown>[] | undefined)
    ?? (raw.response?.result as Record<string, unknown>[] | undefined)
    ?? (raw.data ? [raw.data as Record<string, unknown>] : null)
    ?? (raw.response ? [raw.response as Record<string, unknown>] : null)
    ?? (raw.employee ? [raw.employee as Record<string, unknown>] : null)
    ?? (Array.isArray(raw) ? raw : [raw]);

  if (!records || records.length === 0) {
    console.log(`[sync-employee] Darwinbox ${isInactive ? "inactive" : "active"} returned no employees for ${email}`);
    return { employee: null, debug: `${isInactive ? "inactive" : "active"} dataset returned no records` };
  }
  // Match by exact email when multiple records returned.
  const match = records.find((r) => {
    const candidates = [
      r.official_email_id,
      r.company_email_id,
      r.email,
      r.work_email,
      r.employee_email_id,
      r.mail,
    ];
    return candidates.some((candidate) => (
      typeof candidate === "string" && candidate.trim().toLowerCase() === email.toLowerCase()
    ));
  }) ?? records[0];

  // Cast manager nested object (some tenants nest it, others flatten).
  const mgr = (match.reporting_manager ?? match.manager ?? {}) as Record<string, unknown>;

  return { employee: {
    full_name: pickName(match),
    email: String(
      match.official_email_id
      ?? match.company_email_id
      ?? match.email
      ?? match.work_email
      ?? match.employee_email_id
      ?? email,
    ),
    employee_code: String(match.employee_code ?? match.employee_id ?? match.employee_no ?? match.empCode ?? ""),
    contact: (match.mobile_number ?? match.phone ?? match.contact ?? null) as string | null,
    department_name: (match.department ?? match.department_name ?? null) as string | null,
    sub_department_name: (match.sub_department ?? match.sub_department_name ?? match.subdepartment ?? null) as string | null,
    manager_name: (mgr.name ?? mgr.full_name ?? match.reporting_manager_name ?? match.direct_manager ?? null) as string | null,
    manager_email: (
      mgr.email
      ?? mgr.official_email_id
      ?? match.reporting_manager_email
      ?? match.direct_manager_email
      ?? null
    ) as string | null,
    manager_contact: (mgr.mobile_number ?? mgr.phone ?? mgr.contact ?? null) as string | null,
    manager_employee_code: (mgr.employee_code ?? match.reporting_manager_code ?? null) as string | null,
    is_inactive: isInactive,
  } };
}

// Try active dataset first, then inactive.
async function fetchEmployeeFromDarwinbox(email: string): Promise<{ employee: DarwinboxEmployee | null; debug: string }> {
  const activeKey = Deno.env.get("DARWINBOX_API_KEY");
  const activeDataset = Deno.env.get("DARWINBOX_DATASET_KEY");
  const inactiveKey = Deno.env.get("DARWINBOX_API_KEY_INACTIVE");
  const inactiveDataset = Deno.env.get("DARWINBOX_DATASET_KEY_INACTIVE");
  const pathEnv = Deno.env.get("DARWINBOX_EMPLOYEE_PATHS") ?? Deno.env.get("DARWINBOX_EMPLOYEE_PATH") ?? DEFAULT_EMPLOYEE_PATH;
  const paths = pathEnv.split(",").map(p => p.trim()).filter(Boolean);
  const debugParts: string[] = [];

  for (const p of paths) {
    if (activeKey && activeDataset) {
      const found = await callDarwinbox(email, activeKey, activeDataset, false, p);
      if (found.employee) return { employee: found.employee, debug: `matched active dataset via path=${p}` };
      debugParts.push(`active:${p}: ${found.debug}`);
    }
    if (inactiveKey && inactiveDataset) {
      const found = await callDarwinbox(email, inactiveKey, inactiveDataset, true, p);
      if (found.employee) return { employee: found.employee, debug: `matched inactive dataset via path=${p}` };
      debugParts.push(`inactive:${p}: ${found.debug}`);
    }
  }
  if (!debugParts.length) debugParts.push("No Darwinbox dataset keys configured");
  return { employee: null, debug: debugParts.join(" | ") };
}

// ---------------------------------------------------------------------------
// Helpers — find-or-create org rows.
// ---------------------------------------------------------------------------
type SbClient = ReturnType<typeof createClient>;

async function ensureDepartment(sb: SbClient, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { data: byName } = await sb.from("departments").select("id").ilike("name", name).maybeSingle();
  if (byName?.id) return byName.id as string;
  const { data: created, error } = await sb
    .from("departments").insert({ name }).select("id").single();
  if (error) { console.warn("[sync-employee] department insert failed:", error.message); return null; }
  return created.id as string;
}

async function ensureSubDepartment(
  sb: SbClient, name: string | null, departmentId: string | null,
): Promise<string | null> {
  if (!name || !departmentId) return null;
  const { data: byName } = await sb
    .from("sub_departments").select("id")
    .eq("department_id", departmentId).ilike("name", name).maybeSingle();
  if (byName?.id) return byName.id as string;
  const { data: created, error } = await sb
    .from("sub_departments").insert({ name, department_id: departmentId })
    .select("id").single();
  if (error) { console.warn("[sync-employee] sub_department insert failed:", error.message); return null; }
  return created.id as string;
}

async function ensureManager(
  sb: SbClient, d: DarwinboxEmployee,
  departmentId: string | null, subDepartmentId: string | null,
): Promise<string | null> {
  if (!d.manager_email && !d.manager_employee_code) return null;
  if (d.manager_email) {
    const { data: hit } = await sb.from("employees").select("id").eq("email", d.manager_email).maybeSingle();
    if (hit?.id) return hit.id as string;
  }
  const { data: created, error } = await sb
    .from("employees")
    .insert({
      email: d.manager_email ?? `unknown-mgr-${crypto.randomUUID()}@unknown`,
      name: d.manager_name ?? "Unknown manager",
      employee_id: d.manager_employee_code,
      contact: d.manager_contact,
      department_id: departmentId,
      sub_department_id: subDepartmentId,
      status: "active",
    })
    .select("id").single();
  if (error) { console.warn("[sync-employee] manager insert failed:", error.message); return null; }
  return created.id as string;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Supabase env not configured on the function" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonResponse(401, { error: "Missing Authorization header" });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return jsonResponse(401, { error: "Invalid session" });
  const user = userData.user;
  const email = user.email;
  if (!email) return jsonResponse(400, { error: "User has no email on record" });

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Look up the caller's employees row (handle_new_user trigger created it).
  const { data: existing, error: empErr } = await adminClient
    .from("employees")
    .select("id, department_id, sub_department_id, manager_id, status, last_synced_at, employee_id, name, contact")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (empErr) return jsonResponse(500, { error: `employee lookup failed: ${empErr.message}` });
  if (!existing) return jsonResponse(404, { error: "Employee row missing — handle_new_user trigger did not run" });

  // 2. Cache check.
  const force = Deno.env.get("DARWINBOX_FORCE_REFRESH") === "1";
  const isComplete = !!existing.department_id && !!existing.manager_id && existing.status === "active";
  const recentlySynced = !!existing.last_synced_at &&
    Date.now() - new Date(existing.last_synced_at as string).getTime() < DARWINBOX_RESYNC_DAYS * 86400_000;
  if (!force && isComplete && recentlySynced) {
    return jsonResponse(200, { source: "cache", employee_id: existing.id });
  }

  // 3. Hit Darwinbox (active dataset first, then inactive).
  const darwin = await fetchEmployeeFromDarwinbox(email);
  const fromDarwin = darwin.employee;
  if (!fromDarwin) {
    await adminClient.from("employees").update({ last_synced_at: new Date().toISOString() }).eq("id", existing.id);
    return jsonResponse(200, {
      source: "no-darwinbox",
      employee_id: existing.id,
      reason: "Darwinbox returned no record (or endpoint/auth mismatch)",
      debug: darwin.debug,
    });
  }

  // 4. Resolve dept → sub-dept → manager.
  const departmentId = await ensureDepartment(adminClient, fromDarwin.department_name);
  const subDepartmentId = await ensureSubDepartment(adminClient, fromDarwin.sub_department_name, departmentId);
  const managerId = await ensureManager(adminClient, fromDarwin, departmentId, subDepartmentId);

  // 5. Patch caller's employees row. Inactive Darwinbox records → status='inactive'.
  const patch: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
    status: fromDarwin.is_inactive ? "inactive" : "active",
  };
  const setIfMissing = (col: string, value: unknown) => {
    if (value == null) return;
    if (force || (existing as Record<string, unknown>)[col] == null) patch[col] = value;
  };
  setIfMissing("name", fromDarwin.full_name || null);
  setIfMissing("employee_id", fromDarwin.employee_code || null);
  setIfMissing("contact", fromDarwin.contact);
  setIfMissing("department_id", departmentId);
  setIfMissing("sub_department_id", subDepartmentId);
  setIfMissing("manager_id", managerId);

  const { error: updErr } = await adminClient.from("employees").update(patch).eq("id", existing.id);
  if (updErr) return jsonResponse(500, { error: `employee update failed: ${updErr.message}` });

  // Optional text fields (for setups that prefer names over relational IDs).
  // If these columns don't exist in a project, we only log and continue.
  const { error: namesErr } = await adminClient
    .from("employees")
    .update({
      department_name: fromDarwin.department_name ?? null,
      sub_department_name: fromDarwin.sub_department_name ?? null,
      manager_name: fromDarwin.manager_name ?? null,
      manager_email: fromDarwin.manager_email ?? null,
    })
    .eq("id", existing.id);
  if (namesErr) {
    console.warn("[sync-employee] optional name column update skipped:", namesErr.message);
  }

  // 6. The DB trigger trg_employee_change auto-enrolls the user into every
  //    course assigned to their department / sub-dept / manager scope.
  return jsonResponse(200, {
    source: fromDarwin.is_inactive ? "darwinbox-inactive" : "darwinbox-active",
    employee_id: existing.id,
    department_id: departmentId,
    sub_department_id: subDepartmentId,
    manager_id: managerId,
    department_name: fromDarwin.department_name ?? null,
    sub_department_name: fromDarwin.sub_department_name ?? null,
    manager_name: fromDarwin.manager_name ?? null,
    manager_email: fromDarwin.manager_email ?? null,
    debug: darwin.debug,
  });
});
