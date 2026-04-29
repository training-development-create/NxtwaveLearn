// CSV Upload + smart validation for assigning a compliance course to a list
// of learners. The "AI" component here is deterministic — we do not call any
// external LLM. We:
//   1. Parse the CSV (handles quoted fields, escaped quotes, BOM)
//   2. Validate each email address with a strict regex
//   3. De-duplicate within the CSV (case-insensitive on email)
//   4. Match each remaining row against the `employees` table by email
//   5. Bucket the rows into Matched / Not Found / Invalid / Duplicate
//   6. On confirm: write `course_assignments` rows (audit trail = created_at)
//      and send a notification to each newly-assigned learner
//
// Re-used from BOTH the Upload Course wizard (step 4 / Publish) and the
// Edit Assignment modal in Modules. Self-contained so a future tweak only
// has to be made in one place.

import { useState, useRef, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Btn, Card } from "./ui";

type EmpRow = { id: string; name: string | null; email: string; auth_user_id: string | null; department_id: string | null };
type CsvRow = { rowNumber: number; name: string; email: string; department: string };

type Bucket = {
  matched: { row: CsvRow; employee: EmpRow }[];
  notFound: CsvRow[];
  invalid: { row: CsvRow; reason: string }[];
  duplicate: { row: CsvRow; firstSeenAt: number }[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAMPLE_CSV = 'Name,Email,Department\nAsha Rao,asha.rao@example.com,Engineering\nVikram Kumar,vikram.kumar@example.com,Sales\n';

// Custom CSV parser — handles quoted fields, escaped quotes ("""), BOM,
// CRLF and bare LF line endings. We deliberately avoid pulling in papaparse
// for ~3kb saved on the bundle and zero new dependency surface.
function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cell += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        row.push(cell); cell = '';
        // Don't push empty trailing rows.
        if (row.some(c => c.length > 0)) rows.push(row);
        row = [];
        // Skip the LF in CRLF.
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else { cell += ch; }
    }
  }
  // Final cell / row.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(c => c.length > 0)) rows.push(row);
  }
  return rows;
}

export function CsvAssignModal({ courseId, courseTitle, onClose, onAssigned }: {
  courseId: string;
  courseTitle?: string;
  onClose: () => void;
  onAssigned?: (count: number) => void;
}) {
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ assigned: number; alreadyAssigned: number } | null>(null);
  const [tab, setTab] = useState<'matched' | 'notFound' | 'invalid' | 'duplicate'>('matched');
  const [allEmployees, setAllEmployees] = useState<EmpRow[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Fetch all employees up-front (paged 1000) so the email lookup is purely
  // client-side and gives instant validation feedback.
  useEffect(() => {
    (async () => {
      setEmpLoading(true);
      const all: EmpRow[] = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, email, auth_user_id, department_id')
          .range(from, from + page - 1);
        if (error || !data || data.length === 0) break;
        all.push(...(data as EmpRow[]));
        if (data.length < page) break;
      }
      setAllEmployees(all);
      setEmpLoading(false);
    })();
  }, []);

  const employeesByEmail = useMemo(() => {
    const map = new Map<string, EmpRow>();
    allEmployees.forEach(e => { if (e.email) map.set(e.email.trim().toLowerCase(), e); });
    return map;
  }, [allEmployees]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    setBucket(null);
    setDone(null);
    setSubmitError(null);
    setParsing(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error('CSV is empty.');

      // Detect header row by checking whether the first row contains "email"
      // (case-insensitive) — if it does, treat it as headers and resolve
      // column positions; otherwise assume Name,Email,Department order.
      const header = rows[0].map(h => h.trim().toLowerCase());
      const headerHasEmail = header.includes('email');
      let nameIdx = 0, emailIdx = 1, deptIdx = 2;
      let dataStart = 0;
      if (headerHasEmail) {
        nameIdx = header.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname');
        emailIdx = header.findIndex(h => h === 'email');
        deptIdx = header.findIndex(h => h === 'department' || h === 'dept' || h === 'team');
        if (nameIdx < 0) nameIdx = 0;
        if (emailIdx < 0) throw new Error('Could not find an "Email" column in the CSV header.');
        dataStart = 1;
      }

      const seenEmails = new Map<string, number>(); // email → first row number it appeared
      const out: Bucket = { matched: [], notFound: [], invalid: [], duplicate: [] };

      for (let i = dataStart; i < rows.length; i++) {
        const r = rows[i];
        const rowNumber = i + 1;
        const name = (r[nameIdx] ?? '').trim();
        const rawEmail = (r[emailIdx] ?? '').trim();
        const department = deptIdx >= 0 ? (r[deptIdx] ?? '').trim() : '';
        const csvRow: CsvRow = { rowNumber, name, email: rawEmail, department };

        if (!rawEmail) {
          out.invalid.push({ row: csvRow, reason: 'Email is required.' });
          continue;
        }
        if (!EMAIL_RE.test(rawEmail)) {
          out.invalid.push({ row: csvRow, reason: 'Email format is invalid.' });
          continue;
        }
        const lowerEmail = rawEmail.toLowerCase();
        if (seenEmails.has(lowerEmail)) {
          out.duplicate.push({ row: csvRow, firstSeenAt: seenEmails.get(lowerEmail)! });
          continue;
        }
        seenEmails.set(lowerEmail, rowNumber);

        const emp = employeesByEmail.get(lowerEmail);
        if (emp) out.matched.push({ row: csvRow, employee: emp });
        else out.notFound.push(csvRow);
      }

      setBucket(out);
      // Default to whichever bucket has data, prioritising matched.
      if (out.matched.length > 0) setTab('matched');
      else if (out.notFound.length > 0) setTab('notFound');
      else if (out.invalid.length > 0) setTab('invalid');
      else if (out.duplicate.length > 0) setTab('duplicate');
    } catch (e) {
      setParseError((e as Error).message || 'Failed to parse CSV.');
    } finally {
      setParsing(false);
    }
  };

  const confirmAssign = async () => {
    if (!bucket || bucket.matched.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Find which matched employees are already assigned so we don't duplicate.
      const employeeIds = bucket.matched.map(m => m.employee.id);
      const { data: existing } = await supabase
        .from('course_assignments')
        .select('employee_id')
        .eq('course_id', courseId)
        .in('employee_id', employeeIds);
      const existingSet = new Set((existing ?? []).map((r: { employee_id: string }) => r.employee_id));

      const toInsert = bucket.matched
        .filter(m => !existingSet.has(m.employee.id))
        .map(m => ({ course_id: courseId, employee_id: m.employee.id }));

      if (toInsert.length > 0) {
        const { error } = await supabase.from('course_assignments').insert(toInsert);
        if (error) throw error;

        // Refresh enrollments (best-effort — function may not exist on older schemas).
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any).rpc?.('refresh_enrollments_for_course', { _course_id: courseId });
        } catch { /* ignore */ }

        // Send a notification to each newly-assigned learner that has an auth user.
        const notifRows = bucket.matched
          .filter(m => !existingSet.has(m.employee.id) && m.employee.auth_user_id)
          .map(m => ({
            user_id: m.employee.auth_user_id!,
            title: 'New compliance course assigned',
            body: courseTitle ? `${courseTitle} — open the Compliance Portal to begin.` : 'A new compliance course has been assigned to you.',
            link_course_id: courseId,
          }));
        if (notifRows.length > 0) {
          await supabase.from('notifications').insert(notifRows);
        }
      }

      setDone({ assigned: toInsert.length, alreadyAssigned: bucket.matched.length - toInsert.length });
      onAssigned?.(toInsert.length);
    } catch (e) {
      setSubmitError((e as Error).message || 'Failed to write assignments.');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compliance_assignment_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = bucket
    ? { matched: bucket.matched.length, notFound: bucket.notFound.length, invalid: bucket.invalid.length, duplicate: bucket.duplicate.length }
    : null;

  return (
    <div style={{position:'fixed', inset:0, background:'rgba(10,31,61,.6)', zIndex:2100, display:'grid', placeItems:'center', padding:24}}>
      <div style={{background:'#fff', borderRadius:14, maxWidth:780, width:'100%', maxHeight:'88vh', overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,.3)', display:'flex', flexDirection:'column'}}>
        {/* Header */}
        <div style={{padding:'20px 26px 16px', borderBottom:'1px solid #EEF2F7', display:'flex', alignItems:'flex-start', gap:12}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11, fontWeight:700, letterSpacing:'.12em', color:'#0072FF', textTransform:'uppercase'}}>Bulk assignment</div>
            <div style={{fontSize:18, fontWeight:800, color:'#0A1F3D', marginTop:4, letterSpacing:'-.01em'}}>Upload CSV to assign learners</div>
            <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>
              Columns: <strong>Name, Email</strong> (required), <strong>Department</strong> (optional). We'll validate emails, remove duplicates, and only assign learners that exist in the employee directory.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{background:'transparent', border:0, fontSize:22, color:'#8A97A8', cursor:'pointer', padding:0, lineHeight:1}}>×</button>
        </div>

        {/* Body */}
        <div style={{padding:'18px 26px', overflowY:'auto', flex:1}}>
          {!done && (
            <>
              {/* Upload zone */}
              <Card pad={0} style={{borderColor: bucket ? '#CCEAFF' : '#EEF2F7'}}>
                <label style={{display:'block', padding:22, cursor: parsing||empLoading ? 'wait' : 'pointer', textAlign:'center'}}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{display:'none'}}
                    disabled={parsing || empLoading}
                    onChange={e => handleFile(e.target.files?.[0] || null)}
                  />
                  <div style={{fontSize:24, marginBottom:6}}>{bucket ? '📊' : '📤'}</div>
                  <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D'}}>
                    {empLoading ? 'Loading employee directory…' : parsing ? 'Validating CSV…' : bucket ? `Loaded: ${fileName}` : 'Click to choose CSV file'}
                  </div>
                  <div style={{fontSize:11, color:'#5B6A7D', marginTop:4}}>
                    {bucket ? 'Click to upload a different file' : 'Up to a few thousand rows. UTF-8 encoded, CRLF or LF line endings.'}
                  </div>
                </label>
              </Card>
              <div style={{marginTop:8, display:'flex', gap:10, alignItems:'center'}}>
                <button onClick={downloadSample} style={{background:'transparent', border:0, padding:0, cursor:'pointer', color:'#0072FF', fontSize:12, fontWeight:700, textDecoration:'underline'}}>
                  Download sample CSV
                </button>
                <span style={{fontSize:11, color:'#8A97A8'}}>· Records are de-duplicated by email (case-insensitive).</span>
              </div>

              {parseError && (
                <div style={{marginTop:14, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:600}}>
                  {parseError}
                </div>
              )}

              {bucket && totals && (
                <>
                  {/* Tally cards */}
                  <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginTop:18}}>
                    <TallyTile label="Matched" value={totals.matched} tone="success"/>
                    <TallyTile label="Not in directory" value={totals.notFound} tone="warn"/>
                    <TallyTile label="Invalid email" value={totals.invalid} tone="error"/>
                    <TallyTile label="Duplicate in CSV" value={totals.duplicate} tone="muted"/>
                  </div>

                  {/* Tab strip */}
                  <div style={{marginTop:18, display:'flex', gap:6, borderBottom:'1px solid #EEF2F7'}}>
                    {([
                      ['matched', `Matched (${totals.matched})`, totals.matched > 0],
                      ['notFound', `Not found (${totals.notFound})`, totals.notFound > 0],
                      ['invalid', `Invalid (${totals.invalid})`, totals.invalid > 0],
                      ['duplicate', `Duplicates (${totals.duplicate})`, totals.duplicate > 0],
                    ] as const).map(([id, label, hasData]) => (
                      <button
                        key={id}
                        onClick={() => setTab(id)}
                        disabled={!hasData}
                        style={{
                          padding:'10px 14px',
                          background: 'transparent',
                          border: 0,
                          borderBottom: tab === id ? '2px solid #0072FF' : '2px solid transparent',
                          color: tab === id ? '#0072FF' : hasData ? '#3B4A5E' : '#C8D1DD',
                          fontSize:12,
                          fontWeight:700,
                          cursor: hasData ? 'pointer' : 'not-allowed',
                          marginBottom:-1,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Preview list */}
                  <div style={{marginTop:12, border:'1px solid #EEF2F7', borderRadius:10, maxHeight:240, overflowY:'auto'}}>
                    {tab === 'matched' && (
                      bucket.matched.length === 0
                        ? <EmptyTab text="No rows matched the employee directory."/>
                        : bucket.matched.map(m => (
                          <RowItem
                            key={m.row.rowNumber}
                            primary={m.row.name || m.employee.name || '(no name)'}
                            secondary={m.row.email}
                            tag={m.row.department || undefined}
                          />
                        ))
                    )}
                    {tab === 'notFound' && (
                      bucket.notFound.length === 0
                        ? <EmptyTab text="All rows had a matching employee."/>
                        : bucket.notFound.map(r => (
                          <RowItem
                            key={r.rowNumber}
                            primary={r.name || '(no name)'}
                            secondary={`${r.email} · row ${r.rowNumber}`}
                            tag="Not in directory"
                            tagColor="#9A6708"
                            tagBg="#FFF6E6"
                          />
                        ))
                    )}
                    {tab === 'invalid' && (
                      bucket.invalid.length === 0
                        ? <EmptyTab text="All emails were valid."/>
                        : bucket.invalid.map(({ row, reason }) => (
                          <RowItem
                            key={row.rowNumber}
                            primary={row.name || '(no name)'}
                            secondary={`${row.email || '(empty)'} · row ${row.rowNumber} · ${reason}`}
                            tag="Invalid"
                            tagColor="#C2261D"
                            tagBg="#FCE1DE"
                          />
                        ))
                    )}
                    {tab === 'duplicate' && (
                      bucket.duplicate.length === 0
                        ? <EmptyTab text="No duplicate emails found."/>
                        : bucket.duplicate.map(({ row, firstSeenAt }) => (
                          <RowItem
                            key={row.rowNumber}
                            primary={row.name || '(no name)'}
                            secondary={`${row.email} · row ${row.rowNumber} (first seen at row ${firstSeenAt})`}
                            tag="Duplicate"
                            tagColor="#5B6A7D"
                            tagBg="#EEF2F7"
                          />
                        ))
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {done && (
            <div style={{padding:'18px 0'}}>
              <div style={{fontSize:36, marginBottom:8}}>✅</div>
              <div style={{fontSize:18, fontWeight:800, color:'#0A1F3D'}}>Assignments saved</div>
              <div style={{fontSize:13, color:'#5B6A7D', marginTop:6, lineHeight:1.55}}>
                <strong>{done.assigned}</strong> learner{done.assigned === 1 ? '' : 's'} newly assigned.
                {done.alreadyAssigned > 0 && <> {done.alreadyAssigned} already had this course.</>}
                {' '}A notification has been sent to each new assignee.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'14px 26px', borderTop:'1px solid #EEF2F7', display:'flex', alignItems:'center', gap:10}}>
          {submitError && <div style={{flex:1, fontSize:12, color:'#C2261D', fontWeight:600}}>{submitError}</div>}
          {!submitError && bucket && !done && (
            <div style={{flex:1, fontSize:12, color:'#5B6A7D'}}>
              {bucket.matched.length === 0
                ? 'Nothing to assign — at least one row needs to match the employee directory.'
                : `Will assign ${bucket.matched.length} matched learner${bucket.matched.length === 1 ? '' : 's'}.`}
            </div>
          )}
          {!bucket && !done && <div style={{flex:1}}/>}
          {done && <div style={{flex:1}}/>}
          {!done ? (
            <>
              <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={!bucket || bucket.matched.length === 0 || submitting}
                onClick={confirmAssign}
              >
                {submitting ? 'Assigning…' : 'Confirm & assign'}
              </Btn>
            </>
          ) : (
            <Btn variant="primary" onClick={onClose}>Done</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function TallyTile({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warn' | 'error' | 'muted' }) {
  const colors = {
    success: { bg: '#E8F7EF', border: '#C5EBD7', fg: '#0F7C57' },
    warn:    { bg: '#FFF6E6', border: '#FCD79B', fg: '#9A6708' },
    error:   { bg: '#FCE1DE', border: '#F7B9B2', fg: '#C2261D' },
    muted:   { bg: '#F7F9FC', border: '#EEF2F7', fg: '#5B6A7D' },
  }[tone];
  return (
    <div style={{padding:'10px 12px', background:colors.bg, border:`1px solid ${colors.border}`, borderRadius:10}}>
      <div style={{fontSize:10, fontWeight:700, color:colors.fg, letterSpacing:'.08em', textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:20, fontWeight:800, color:colors.fg, marginTop:4}}>{value}</div>
    </div>
  );
}

function RowItem({ primary, secondary, tag, tagColor, tagBg }: { primary: string; secondary: string; tag?: string; tagColor?: string; tagBg?: string }) {
  return (
    <div style={{padding:'10px 12px', borderBottom:'1px solid #F7F9FC', display:'flex', alignItems:'center', gap:10}}>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{primary}</div>
        <div style={{fontSize:11, color:'#5B6A7D', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{secondary}</div>
      </div>
      {tag && (
        <span style={{padding:'3px 8px', background: tagBg || '#E6F4FF', color: tagColor || '#0072FF', fontSize:10, fontWeight:700, borderRadius:99, whiteSpace:'nowrap'}}>{tag}</span>
      )}
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return <div style={{padding:'14px 16px', fontSize:12, color:'#8A97A8'}}>{text}</div>;
}
