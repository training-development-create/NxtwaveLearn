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
    // Even with no active records, still mark exited (rare edge case).
    const { data: exitData } = await sb.rpc("mark_exited_employees", { _synced_before: syncStart });
    const exited = (exitData as { exited_count: number }[] | null)?.[0]?.exited_count ?? 0;
    return jsonResponse(200, { ok: true, imported: 0, exited, message: "No records returned from Darwinbox" });
  }

  // -----------------------------------------------------------------------
  // STEP 1: Build upsert rows (active employees only).
  // We set status="active" and last_synced_at=now for every row Darwinbox
  // returns. Any row NOT touched here will have an old last_synced_at and
  // will be marked exited in Step 3.
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();
  const upserts: EmployeeUpsert[] = [];

  for (const r of records) {
    const email = toEmail(r.company_email_id ?? r.official_email_id ?? r.email);
    if (!email) continue;

    const fullName =
      toText(r.full_name) ??
      ([toText(r.first_name), toText(r.last_name)].filter(Boolean).join(" ") || email);

    // Only include employees Darwinbox marks as active.
    // Employees absent from this response are caught by mark_exited_employees.
    const employeeStatusRaw = (toText(r.employee_status) ?? "active").toLowerCase();
    if (employeeStatusRaw !== "active") continue;

    upserts.push({
      email,
      name: fullName,
      employee_id: toText(r.employee_id),
      contact: toText(r.personal_mobile_no ?? r.office_mobile_no),
      status: "active",
      last_synced_at: now,           // fresh stamp — proves they were seen this run
      employee_status: toText(r.employee_status),
      first_name: toText(r.first_name),
      last_name: toText(r.last_name),
      date_of_joining: toText(r.date_of_joining),
      date_of_exit: toText(r.date_of_exit),
      department: toText(r.department),
      department_name: toText(r.department_name),
      designation: toText(r.designation),
      designation_name: toText(r.designation_name),
      direct_manager: toText(r.direct_manager),
      direct_manager_email: toEmail(r.direct_manager_email),
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
      manager_name: toText(r.direct_manager),
      manager_email: toEmail(r.direct_manager_email),
      darwin_raw: r,
    });
  }

  if (!upserts.length) {
    const { data: exitData } = await sb.rpc("mark_exited_employees", { _synced_before: syncStart });
    const exited = (exitData as { exited_count: number }[] | null)?.[0]?.exited_count ?? 0;
    return jsonResponse(200, { ok: true, imported: 0, exited, message: "No mappable active-email rows" });
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
  // STEP 3: Mark exited employees.
  // The DB function finds employees whose last_synced_at < syncStart
  // (i.e., Darwinbox did not return them this run) and sets status='exited'.
  // A DB trigger then revokes their active enrollments automatically.
  // Learning progress (lesson_progress, quiz_attempts) is NEVER deleted.
  // -----------------------------------------------------------------------
  const { data: exitData, error: exitErr } = await sb
    .rpc("mark_exited_employees", { _synced_before: syncStart });
  const exitedCount = (exitData as { exited_count: number }[] | null)?.[0]?.exited_count ?? 0;
  const exitedEmails = (exitData as { exited_emails: string[] }[] | null)?.[0]?.exited_emails ?? [];
  if (exitErr) {
    // Non-fatal — log and continue.
    console.warn("[sync] mark_exited_employees failed:", exitErr.message);
  }

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
  // -----------------------------------------------------------------------
  const { data: allEmployees, error: allEmployeesErr } = await sb
    .from("employees")
    .select("id, email")
    .eq("status", "active");
  if (allEmployeesErr) return jsonResponse(500, { error: `employees read for manager linking failed: ${allEmployeesErr.message}` });

  const employeeIdByEmail = new Map(
    (allEmployees ?? []).map((e) => [String(e.email).toLowerCase(), String(e.id)])
  );
  const managerEmailByEmployeeEmail = new Map(
    upserts
      .filter((u) => !!u.direct_manager_email)
      .map((u) => [u.email.toLowerCase(), (u.direct_manager_email as string).toLowerCase()])
  );
  const managerPatches = (allEmployees ?? [])
    .map((e) => {
      const employeeEmail = String(e.email).toLowerCase();
      const mgrEmail = managerEmailByEmployeeEmail.get(employeeEmail) ?? null;
      if (!mgrEmail) return null;
      const mgrId = employeeIdByEmail.get(mgrEmail);
      if (!mgrId || mgrId === String(e.id)) return null;
      return { email: employeeEmail, manager_id: mgrId };
    })
    .filter((x): x is { email: string; manager_id: string } => x !== null);
  for (const batch of chunks(managerPatches, 500)) {
    const { error } = await sb.from("employees").upsert(batch, { onConflict: "email" });
    if (error) return jsonResponse(500, { error: `manager linking failed: ${error.message}` });
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
    new_hires_enrolled: (newHires ?? []).length,
    extended_columns_written: !usedMinimalFallback,
  });
});
