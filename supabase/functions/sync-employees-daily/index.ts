import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DarwinRecord = Record<string, unknown>;
type EmployeeUpsert = {
  email: string;
  name: string;
  employee_id: string | null;
  contact: string | null;
  status: "active";
  last_synced_at: string;
  employee_status: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  department: string | null;
  department_name: string | null;
  designation: string | null;
  designation_name: string | null;
  direct_manager: string | null;
  direct_manager_email: string | null;
  hod: string | null;
  hod_email_id: string | null;
  l2_manager: string | null;
  l2_manager_email: string | null;
  top_department: string | null;
  company_email_id: string | null;
  date_of_resignation: string | null;
  full_name: string | null;
  personal_mobile_no: string | null;
  office_mobile_no: string | null;
  manager_name: string | null;
  manager_email: string | null;
  darwin_raw: DarwinRecord;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toEmail(v: unknown): string | null {
  const s = toText(v);
  return s ? s.toLowerCase() : null;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Darwinbox field names vary per tenant. Return the first alias that has a value.
function pick(r: DarwinRecord, keys: string[]): unknown {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return null;
}

// Manager email can be a flat field (many possible names) OR nested inside a
// reporting_manager / manager object. We try all of them so manager_id links.
function pickManagerEmail(r: DarwinRecord): string | null {
  const flat = pick(r, [
    "direct_manager_email", "reporting_manager_email", "reporting_manager_email_id",
    "manager_email", "manager_email_id", "l1_manager_email", "reporting_to_email",
    "rm_email", "reporting_manager_official_email",
  ]);
  if (flat) return toEmail(flat);
  const mgr = (r.reporting_manager ?? r.manager ?? r.direct_manager_details) as Record<string, unknown> | undefined;
  if (mgr && typeof mgr === "object") {
    return toEmail(mgr.email ?? mgr.official_email_id ?? mgr.company_email_id ?? mgr.manager_email);
  }
  return null;
}

function pickManagerName(r: DarwinRecord): string | null {
  const flat = pick(r, ["direct_manager", "reporting_manager_name", "manager_name", "l1_manager", "reporting_to", "rm_name"]);
  if (flat) return toText(flat);
  const mgr = (r.reporting_manager ?? r.manager) as Record<string, unknown> | undefined;
  if (mgr && typeof mgr === "object") return toText(mgr.name ?? mgr.full_name);
  return null;
}

// Reads whatever status field this tenant uses (for upsert + observability).
function pickStatusRaw(r: DarwinRecord): string | null {
  return toText(pick(r, ["employee_status", "employment_status", "status", "emp_status", "current_status"]));
}

// Hard "has left the org" tokens. Deliberately EXCLUDES "resigned" — a resigned
// employee may still be serving notice (active). We only treat someone as gone
// on an unambiguous token OR a past exit / last-working date.
const EXIT_TOKENS = [
  "exited", "inactive", "relieved", "terminated", "separated",
  "ex-employee", "ex employee", "no longer", "settled", "f&f", "fnf",
  "left organization", "left organisation", "deactivated",
];

// True when the record clearly represents someone who has LEFT.
// Such records are skipped (not upserted) so their last_synced_at stays stale
// and mark_exited_employees() flips them to 'exited' (revoking access, keeping
// their learning history). This works whether your dataset is active-only
// (exited employees are simply absent) OR mixed (exited rows are present).
function isExitedRecord(r: DarwinRecord): boolean {
  const status = (pickStatusRaw(r) ?? "").toLowerCase();
  if (status && EXIT_TOKENS.some((t) => status.includes(t))) return true;
  // A past actual-exit date is the most reliable signal (resignation date is NOT
  // used — that can be in the future / notice period).
  const exitDate = toText(pick(r, ["date_of_exit", "last_working_day", "exit_date", "relieving_date"]));
  if (exitDate) {
    const t = Date.parse(exitDate);
    if (!isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

async function fetchDarwinRecords(apiKey: string, datasetKey: string): Promise<DarwinRecord[]> {
  const baseUrl = Deno.env.get("DARWINBOX_BASE_URL");
  const username = Deno.env.get("DARWINBOX_USERNAME");
  const password = Deno.env.get("DARWINBOX_PASSWORD");
  const path = Deno.env.get("DARWINBOX_EMPLOYEE_PATH") ?? "/masterapi/employee";
  if (!baseUrl || !username || !password) {
    throw new Error("Darwinbox base/username/password missing");
  }

  const url = `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
  const basic = btoa(`${username}:${password}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ api_key: apiKey, datasetKey }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Darwinbox returned ${res.status}: ${txt.slice(0, 500)}`);
  }

  const txt = await res.text();
  const raw = JSON.parse(txt);
  const records: DarwinRecord[] =
    (raw.employee_data as DarwinRecord[] | undefined) ??
    (raw.employees as DarwinRecord[] | undefined) ??
    (raw.data?.employee_data as DarwinRecord[] | undefined) ??
    (raw.data?.employees as DarwinRecord[] | undefined) ??
    (raw.response?.employee_data as DarwinRecord[] | undefined) ??
    (raw.response?.employees as DarwinRecord[] | undefined) ??
    [];
  return Array.isArray(records) ? records : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

  const cronSecret = Deno.env.get("DARWIN_SYNC_CRON_SECRET");
  if (cronSecret) {
    const got = req.headers.get("x-cron-secret");
    if (got !== cronSecret) return jsonResponse(401, { error: "Unauthorized cron secret" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Supabase env missing" });
  }

  const activeKey = Deno.env.get("DARWINBOX_API_KEY");
  const activeDataset = Deno.env.get("DARWINBOX_DATASET_KEY");
  if (!activeKey || !activeDataset) return jsonResponse(500, { error: "Active Darwinbox keys missing" });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // -----------------------------------------------------------------------
  // SAFETY GUARD against mass false-exit.
  // mark_exited_employees() flips EVERY active employee not seen this run to
  // 'exited' (which revokes their enrollments). A truncated/empty Darwinbox
  // response would therefore wipe the whole roster. safeMarkExited refuses to
  // run the exit step when this run looks suspiciously small:
  //   • fewer than ABS_FLOOR active rows  → almost certainly a bad response
  //   • or under DROP_RATIO of the currently-active roster → big unexplained drop
  // When skipped, employees keep their access; the next healthy sync corrects
  // any real exits. Learning progress is never touched either way.
  // -----------------------------------------------------------------------
  const ABS_FLOOR = 25;
  const DROP_RATIO = 0.5;
  const safeMarkExited = async (activeThisRun: number): Promise<{
    exited: number; emails: string[]; skipped: boolean; reason: string | null;
  }> => {
    const { count } = await sb.from("employees")
      .select("id", { count: "exact", head: true }).eq("status", "active");
    const activeBefore = count ?? 0;
    if (activeThisRun < ABS_FLOOR) {
      const reason = `run returned only ${activeThisRun} active employees (< floor ${ABS_FLOOR}) — skipping exit-marking to avoid mass false-exit`;
      console.warn(`[sync] EXIT GUARD: ${reason}`);
      return { exited: 0, emails: [], skipped: true, reason };
    }
    if (activeBefore > 0 && activeThisRun < activeBefore * DROP_RATIO) {
      const reason = `run returned ${activeThisRun} active employees vs ${activeBefore} currently active (drop > ${Math.round((1 - DROP_RATIO) * 100)}%) — skipping exit-marking`;
      console.warn(`[sync] EXIT GUARD: ${reason}`);
      return { exited: 0, emails: [], skipped: true, reason };
    }
    const { data, error } = await sb.rpc("mark_exited_employees", { _synced_before: syncStart });
    if (error) {
      console.warn("[sync] mark_exited_employees failed:", error.message);
      return { exited: 0, emails: [], skipped: false, reason: error.message };
    }
    const exited = (data as { exited_count: number }[] | null)?.[0]?.exited_count ?? 0;
    const emails = (data as { exited_emails: string[] }[] | null)?.[0]?.exited_emails ?? [];
    return { exited, emails, skipped: false, reason: null };
  };

  // -----------------------------------------------------------------------
  // STEP 0: Record sync start time BEFORE fetching from Darwinbox.
  // Any employee whose last_synced_at is older than syncStart at the END
  // of this run was not returned by Darwinbox → they have left the org.
  // -----------------------------------------------------------------------
  const syncStart = new Date().toISOString();

  let records: DarwinRecord[];
  try {
    records = await fetchDarwinRecords(activeKey, activeDataset);
  } catch (e) {
    return jsonResponse(500, { error: e instanceof Error ? e.message : "Darwinbox fetch failed" });
  }

  if (!records.length) {
    // Empty response = bad/transient Darwinbox fetch. NEVER mark exits here —
    // doing so would flip the entire roster to 'exited'. Just no-op safely.
    console.warn("[sync] Darwinbox returned 0 records — skipping exit-marking entirely.");
    return jsonResponse(200, {
      ok: true, imported: 0, exited: 0, exit_guard_skipped: true,
      message: "No records returned from Darwinbox — exit-marking skipped to protect data",
    });
  }

  // -----------------------------------------------------------------------
  // STEP 1: Build upsert rows (active employees only).
  // We set status="active" and last_synced_at=now for every row Darwinbox
  // returns. Any row NOT touched here will have an old last_synced_at and
  // will be marked exited in Step 3.
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();
  const upserts: EmployeeUpsert[] = [];

  // Observability — surfaced in the response + logs so the real tenant field
  // names/values can be confirmed without a separate probe run.
  const statusValuesSeen = new Set<string>();
  let exitedInPayloadSkipped = 0;
  let managerEmailsFound = 0;
  const sampleKeys = records[0] ? Object.keys(records[0]) : [];

  for (const r of records) {
    const email = toEmail(r.company_email_id ?? r.official_email_id ?? r.email);
    if (!email) continue;

    // Record whatever status this tenant reports (or note its absence).
    const rawStatus = pickStatusRaw(r);
    statusValuesSeen.add(rawStatus ?? "(no status field)");

    // Skip employees who have LEFT. Skipping (rather than upserting) leaves
    // their last_synced_at stale so mark_exited_employees() flips them to
    // 'exited' afterwards — which revokes access but keeps learning history.
    // Robust to tenants whose dataset includes exited rows AND those where
    // exited rows are simply absent.
    if (isExitedRecord(r)) { exitedInPayloadSkipped++; continue; }

    const fullName =
      toText(r.full_name) ??
      ([toText(r.first_name), toText(r.last_name)].filter(Boolean).join(" ") || email);

    // Manager identity — tolerant to flat aliases AND nested manager objects.
    const mgrEmail = pickManagerEmail(r);
    const mgrName = pickManagerName(r);
    if (mgrEmail) managerEmailsFound++;

    upserts.push({
      email,
      name: fullName,
      employee_id: toText(r.employee_id),
      contact: toText(r.personal_mobile_no ?? r.office_mobile_no),
      status: "active",
      last_synced_at: now,           // fresh stamp — proves they were seen this run
      employee_status: rawStatus,
      first_name: toText(r.first_name),
      last_name: toText(r.last_name),
      date_of_joining: toText(r.date_of_joining),
      date_of_exit: toText(r.date_of_exit),
      department: toText(r.department),
      department_name: toText(r.department_name),
      designation: toText(r.designation),
      designation_name: toText(r.designation_name),
      direct_manager: mgrName,
      direct_manager_email: mgrEmail,
      hod: toText(r.hod),
      hod_email_id: toEmail(r.hod_email_id),
      l2_manager: toText(r.l2_manager),
      l2_manager_email: toEmail(r.l2_manager_email),
      top_department: toText(r.top_department),
      company_email_id: toEmail(r.company_email_id),
      date_of_resignation: toText(r.date_of_resignation),
      full_name: toText(r.full_name),
      personal_mobile_no: toText(r.personal_mobile_no),
      office_mobile_no: toText(r.office_mobile_no),
      manager_name: mgrName,
      manager_email: mgrEmail,
      darwin_raw: r,
    });
  }

  // Log so the tenant's real field names/values are visible in the function logs.
  console.log(`[sync] records=${records.length} active=${upserts.length} exited_in_payload=${exitedInPayloadSkipped} manager_emails_found=${managerEmailsFound}`);
  console.log(`[sync] status values seen: ${JSON.stringify(Array.from(statusValuesSeen).slice(0, 20))}`);
  console.log(`[sync] sample record keys: ${JSON.stringify(sampleKeys.slice(0, 60))}`);

  if (!upserts.length) {
    // No active employees mapped this run — same risk as an empty response.
    // Never mark exits from a zero-active run.
    console.warn("[sync] 0 mappable active employees — skipping exit-marking entirely.");
    return jsonResponse(200, {
      ok: true, imported: 0, exited: 0, exit_guard_skipped: true,
      message: "No mappable active-email rows — exit-marking skipped to protect data",
      diagnostics: {
        status_values_seen: Array.from(statusValuesSeen).slice(0, 20),
        exited_in_payload_skipped: exitedInPayloadSkipped,
        sample_record_keys: sampleKeys.slice(0, 60),
      },
    });
  }

  // -----------------------------------------------------------------------
  // STEP 2: Upsert employees (UPSERT = insert new + update existing).
  // Uses email as the conflict key so darwin_id changes don't create dupes.
  // -----------------------------------------------------------------------
  let usedMinimalFallback = false;
  for (const batch of chunks(upserts, 500)) {
    const { error: upsertErr } = await sb
      .from("employees")
      .upsert(batch, { onConflict: "email" });
    if (!upsertErr) continue;

    // Backward compat: project may not have the extended Darwin columns yet.
    if (!upsertErr.message.includes("Could not find the")) {
      return jsonResponse(500, { error: `employees upsert failed: ${upsertErr.message}` });
    }
    usedMinimalFallback = true;
    const minimalBatch = batch.map((r) => ({
      email: r.email,
      name: r.name,
      employee_id: r.employee_id,
      contact: r.contact,
      status: r.status,
      last_synced_at: r.last_synced_at,
    }));
    const { error: fallbackErr } = await sb
      .from("employees")
      .upsert(minimalBatch, { onConflict: "email" });
    if (fallbackErr) return jsonResponse(500, { error: `employees fallback upsert failed: ${fallbackErr.message}` });
  }

  // -----------------------------------------------------------------------
  // STEP 3: Mark exited employees — through the safety guard.
  // The DB function finds employees whose last_synced_at < syncStart
  // (i.e., Darwinbox did not return them this run) and sets status='exited'.
  // A DB trigger then revokes their active enrollments automatically.
  // Learning progress (lesson_progress, quiz_attempts) is NEVER deleted.
  // safeMarkExited refuses to run when this run looks suspiciously small.
  // -----------------------------------------------------------------------
  const exitResult = await safeMarkExited(upserts.length);
  const exitedCount = exitResult.exited;
  const exitedEmails = exitResult.emails;

  // -----------------------------------------------------------------------
  // STEP 4: Sync org hierarchy (departments → sub-departments).
  // Ensures new departments/sub-depts from Darwinbox exist in DB.
  // Never deletes old ones (course assignments still reference them).
  // -----------------------------------------------------------------------
  const departmentNames = Array.from(
    new Set(upserts.map((u) => u.top_department).filter((v): v is string => !!v))
  );
  const { data: deptRowsBefore, error: deptReadBeforeErr } = await sb
    .from("departments").select("id, name");
  if (deptReadBeforeErr) return jsonResponse(500, { error: `departments read failed: ${deptReadBeforeErr.message}` });
  const existingDeptNames = new Set((deptRowsBefore ?? []).map((d) => String(d.name)));
  const missingDepts = departmentNames.filter((n) => !existingDeptNames.has(n));
  for (const batch of chunks(missingDepts.map((name) => ({ name })), 500)) {
    const { error } = await sb.from("departments").insert(batch);
    if (error) return jsonResponse(500, { error: `departments insert failed: ${error.message}` });
  }

  const { data: deptRows, error: deptReadErr } = await sb.from("departments").select("id, name");
  if (deptReadErr) return jsonResponse(500, { error: `departments read failed: ${deptReadErr.message}` });
  const deptIdByName = new Map((deptRows ?? []).map((d) => [String(d.name), String(d.id)]));

  // Sub-departments (keyed by deptId::name to avoid cross-dept name clashes).
  const subUpserts = Array.from(new Map(
    upserts
      .map((u) => {
        const topDept = u.top_department;
        const subDept = u.department_name;
        if (!topDept || !subDept) return null;
        const departmentId = deptIdByName.get(topDept);
        if (!departmentId) return null;
        return [
          `${departmentId}::${subDept.toLowerCase()}`,
          { name: subDept, department_id: departmentId },
        ];
      })
      .filter((x): x is [string, { name: string; department_id: string }] => x !== null),
  ).values());
  const { data: subBefore, error: subBeforeErr } = await sb
    .from("sub_departments").select("name, department_id");
  if (subBeforeErr) return jsonResponse(500, { error: `sub_departments read failed: ${subBeforeErr.message}` });
  const existingSubKeys = new Set(
    (subBefore ?? []).map((s) => `${String(s.department_id)}::${String(s.name).toLowerCase()}`)
  );
  const missingSubs = subUpserts.filter(
    (s) => !existingSubKeys.has(`${s.department_id}::${s.name.toLowerCase()}`)
  );
  for (const batch of chunks(missingSubs, 500)) {
    const { error } = await sb.from("sub_departments").insert(batch);
    if (error) return jsonResponse(500, { error: `sub_departments insert failed: ${error.message}` });
  }
  const { data: subRows, error: subReadErr } = await sb
    .from("sub_departments").select("id, name, department_id");
  if (subReadErr) return jsonResponse(500, { error: `sub_departments read failed: ${subReadErr.message}` });
  const subIdByKey = new Map(
    (subRows ?? []).map((s) => [
      `${String(s.department_id)}::${String(s.name).toLowerCase()}`,
      String(s.id),
    ])
  );

  // -----------------------------------------------------------------------
  // STEP 5: Attach hierarchy FK IDs to each employee row.
  // This keeps department_id, sub_department_id, and designation current
  // even if an employee changes department or role between syncs.
  // -----------------------------------------------------------------------
  const employeeHierarchyPatches = upserts.map((u) => {
    const deptId = u.top_department ? deptIdByName.get(u.top_department) ?? null : null;
    const subKey = deptId && u.department_name
      ? `${deptId}::${u.department_name.toLowerCase()}`
      : null;
    const subDeptId = subKey ? subIdByKey.get(subKey) ?? null : null;
    return {
      email: u.email,
      department_id: deptId,
      sub_department_id: subDeptId,
      department_name: u.top_department ?? u.department_name ?? null,
      sub_department_name: u.department_name ?? null,
      designation: u.designation ?? null,
      designation_name: u.designation_name ?? null,
      manager_name: u.direct_manager ?? null,
      manager_email: u.direct_manager_email ?? null,
    };
  });
  for (const batch of chunks(employeeHierarchyPatches, 500)) {
    const { error } = await sb.from("employees").upsert(batch, { onConflict: "email" });
    if (error) return jsonResponse(500, { error: `employee hierarchy update failed: ${error.message}` });
  }

  // -----------------------------------------------------------------------
  // STEP 6: Link manager_id FKs (by matching manager email → employees.id).
  // Runs after all employees are upserted so cross-references always resolve.
  // Also updates hierarchy if reporting manager changed since last sync.
  //
  // Robustness rules — without these the manager_id stays NULL for newly
  // synced employees in several real-world cases:
  //   1. Use the DB's `manager_email` as a fallback when this run's payload
  //      doesn't carry direct_manager_email for an employee (e.g. partial
  //      sync, or manager_email already correct from an older run).
  //   2. ALSO consider the manager's `company_email_id` and the legacy
  //      `manager_email` column when building the email→id index. Darwinbox
  //      may report the manager via a different email field than the one
  //      used for the manager's own employees.email.
  //   3. Look up by lowercase to avoid case mismatches between the two
  //      Darwinbox fields.
  //   4. ALWAYS write the patch even when manager_id was already correct
  //      so we don't drop legitimate updates because of stale state.
  // -----------------------------------------------------------------------
  const { data: allEmployees, error: allEmployeesErr } = await sb
    .from("employees")
    .select("id, email, manager_id, manager_email, company_email_id")
    .eq("status", "active");
  if (allEmployeesErr) return jsonResponse(500, { error: `employees read for manager linking failed: ${allEmployeesErr.message}` });

  // Build a tolerant email → employees.id lookup. We index every known
  // email alias for each employee (employees.email, company_email_id) so
  // the manager-email lookup can resolve regardless of which alias the
  // manager-side payload uses.
  const employeeIdByEmail = new Map<string, string>();
  for (const e of (allEmployees ?? [])) {
    const id = String(e.id);
    const primary = e.email ? String(e.email).toLowerCase().trim() : null;
    if (primary) employeeIdByEmail.set(primary, id);
    const company = (e as { company_email_id?: string | null }).company_email_id;
    if (company) {
      const v = String(company).toLowerCase().trim();
      if (v && !employeeIdByEmail.has(v)) employeeIdByEmail.set(v, id);
    }
  }

  // Manager email per employee — prefer this run's payload, then fall back
  // to the value already stored on the employees row. This way a partial
  // sync (or a sync where Darwinbox omits the manager email for someone
  // because nothing changed) doesn't wipe the relationship.
  const managerEmailByEmployeeEmail = new Map<string, string>();
  for (const u of upserts) {
    if (u.direct_manager_email) {
      managerEmailByEmployeeEmail.set(u.email.toLowerCase(), u.direct_manager_email.toLowerCase());
    }
  }
  for (const e of (allEmployees ?? [])) {
    const employeeEmail = String(e.email ?? "").toLowerCase();
    if (!employeeEmail || managerEmailByEmployeeEmail.has(employeeEmail)) continue;
    const stored = (e as { manager_email?: string | null }).manager_email;
    if (stored) managerEmailByEmployeeEmail.set(employeeEmail, String(stored).toLowerCase());
  }

  let unresolvedManagerCount = 0;
  const managerPatches = (allEmployees ?? [])
    .map((e) => {
      const employeeEmail = String(e.email).toLowerCase();
      const mgrEmail = managerEmailByEmployeeEmail.get(employeeEmail) ?? null;
      if (!mgrEmail) return null;
      const mgrId = employeeIdByEmail.get(mgrEmail);
      if (!mgrId) {
        // Manager's row hasn't been synced yet (or uses an email alias we
        // don't index). Surface this in logs so it can be investigated
        // rather than silently leaving manager_id NULL.
        unresolvedManagerCount++;
        return null;
      }
      // Don't allow self-managing rows.
      if (mgrId === String(e.id)) return null;
      // Skip rows where the link is already correct AND the cached
      // manager_email already matches — we don't want to spam writes for
      // unchanged data. But if either differs, write the patch.
      const currentManagerId = (e as { manager_id?: string | null }).manager_id ?? null;
      const currentManagerEmail = (e as { manager_email?: string | null }).manager_email ?? null;
      if (currentManagerId === mgrId && (currentManagerEmail ?? "").toLowerCase() === mgrEmail) return null;
      return { email: employeeEmail, manager_id: mgrId, manager_email: mgrEmail };
    })
    .filter((x): x is { email: string; manager_id: string; manager_email: string } => x !== null);
  for (const batch of chunks(managerPatches, 500)) {
    const { error } = await sb.from("employees").upsert(batch, { onConflict: "email" });
    if (error) return jsonResponse(500, { error: `manager linking failed: ${error.message}` });
  }
  if (unresolvedManagerCount > 0) {
    console.warn(`[sync] ${unresolvedManagerCount} employees have a manager email that does not match any active employee.email or company_email_id`);
  }

  // -----------------------------------------------------------------------
  // STEP 7: Sync auth-linked employee profiles.
  // -----------------------------------------------------------------------
  const profileRows: Record<string, unknown>[] = [];
  const upsertByEmail = new Map<string, EmployeeUpsert>();
  for (const row of upserts) upsertByEmail.set(row.email, row);

  const { data: matched, error: matchedErr } = await sb
    .from("employees")
    .select("auth_user_id, email, name, employee_id, contact, department_name, sub_department_name, manager_name, manager_email")
    .not("auth_user_id", "is", null)
    .eq("status", "active");
  if (matchedErr) return jsonResponse(500, { error: `matched employees read failed: ${matchedErr.message}` });

  for (const emp of matched ?? []) {
    if (!emp.auth_user_id) continue;
    const source = upsertByEmail.get((emp.email ?? "").toLowerCase());
    if (!source) continue;
    profileRows.push({
      id: emp.auth_user_id,
      email: emp.email,
      full_name: emp.name ?? "",
      employee_id: emp.employee_id ?? null,
      department: emp.department_name ?? source.top_department ?? null,
      sub_department: emp.sub_department_name ?? source.department_name ?? null,
      manager_name: emp.manager_name ?? source.direct_manager ?? null,
      manager_email: emp.manager_email ?? source.direct_manager_email ?? null,
      manager_contact: emp.contact ?? null,
      darwin_synced_at: now,
    });
  }

  if (profileRows.length) {
    for (const batch of chunks(profileRows, 500)) {
      const { error: profileErr } = await sb.from("profiles").upsert(batch, { onConflict: "id" });
      if (profileErr && profileErr.message.includes("sub_department")) {
        const fallbackBatch = batch.map((r) => {
          const { sub_department, ...rest } = r as Record<string, unknown>;
          void sub_department;
          return rest;
        });
        const { error: fallbackErr } = await sb.from("profiles").upsert(fallbackBatch, { onConflict: "id" });
        if (fallbackErr) {
          return jsonResponse(500, {
            error: `employees imported (${upserts.length}) but profiles upsert failed: ${fallbackErr.message}`,
            imported: upserts.length,
          });
        }
      } else if (profileErr) {
        return jsonResponse(500, {
          error: `employees imported (${upserts.length}) but profiles upsert failed: ${profileErr.message}`,
          imported: upserts.length,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // STEP 8: Ensure auth-linked employees have the learner role.
  // -----------------------------------------------------------------------
  const roleRows = (matched ?? [])
    .filter((e) => !!e.auth_user_id)
    .map((e) => ({ user_id: e.auth_user_id, role: "learner" }));
  if (roleRows.length) {
    for (const batch of chunks(roleRows, 500)) {
      const { error } = await sb.from("user_roles").upsert(batch, { onConflict: "user_id,role" });
      if (error) return jsonResponse(500, { error: `user_roles sync failed: ${error.message}` });
    }
  }

  // -----------------------------------------------------------------------
  // STEP 9: Re-enroll new hires (employees first seen in this sync run).
  // The DB trigger handles most cases, but explicit refresh guarantees
  // scope-based rules (dept/manager assignments) are applied immediately.
  // -----------------------------------------------------------------------
  const { data: newHires } = await sb
    .from("employees")
    .select("id")
    .eq("status", "active")
    .not("auth_user_id", "is", null)
    .gte("last_synced_at", syncStart);

  for (const e of newHires ?? []) {
    await sb.rpc("refresh_enrollments_for_employee", { _employee_id: e.id });
  }

  return jsonResponse(200, {
    ok: true,
    sync_started_at: syncStart,
    imported: upserts.length,
    exited: exitedCount,
    exited_sample: exitedEmails.slice(0, 10),
    profiles_updated: profileRows.length,
    roles_synced: roleRows.length,
    manager_links: managerPatches.length,
    manager_links_unresolved: unresolvedManagerCount,
    new_hires_enrolled: (newHires ?? []).length,
    extended_columns_written: !usedMinimalFallback,
    exit_guard_skipped: exitResult.skipped,
    exit_guard_reason: exitResult.reason,
    // ---- Diagnostics: use these to confirm your tenant's real field shape ----
    diagnostics: {
      status_values_seen: Array.from(statusValuesSeen).slice(0, 20),
      exited_in_payload_skipped: exitedInPayloadSkipped,
      manager_emails_in_payload: managerEmailsFound,
      sample_record_keys: sampleKeys.slice(0, 60),
    },
  });
});
