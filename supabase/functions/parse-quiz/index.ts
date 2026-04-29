// Edge function: extracts MCQ questions from an uploaded document using Lovable AI.
// Strategy: convert input to plain text first, then ask Gemini to extract questions.
// - text/* and application/json  → decode bytes
// - PDFs                         → send as inline file to Gemini (it OCRs natively)
// - DOCX                         → unzip & extract <w:t> text from word/document.xml
// - other                        → best-effort decode as utf-8

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const requestHits = new Map<string, number[]>();

function err(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ----- Minimal DOCX text extractor (no deps) ---------------------------------
// DOCX is a ZIP. We unzip in-memory using DecompressionStream (Deno supports it),
// find word/document.xml, then strip XML to keep <w:t> text content with paragraph breaks.

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const entries = parseZip(bytes);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error("DOCX missing word/document.xml");
  const raw = await inflateRaw(docEntry.data, docEntry.compressed);
  const xml = new TextDecoder().decode(raw);
  // Insert newlines for paragraphs and tabs, then keep only <w:t> content
  let txt = xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, m => '\n' + m)
    .replace(/<w:tab\/?>/g, '\t');
  // Capture all <w:t ...>...</w:t> contents
  const out: string[] = [];
  let last = '';
  txt.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, c) => { out.push(c); return ''; });
  // Also fallback: include line breaks from paragraphs by re-parsing structure
  // Simpler approach: take the <w:t> contents joined; but to keep paragraph breaks, walk paragraphs:
  const paragraphs: string[] = [];
  xml.replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (_, inner) => {
    const parts: string[] = [];
    inner.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_: string, t: string) => { parts.push(decodeXml(t)); return ''; });
    paragraphs.push(parts.join(''));
    return '';
  });
  const result = paragraphs.join('\n').trim() || out.join(' ');
  if (last) {/* unused */}
  return result;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

// ----- Tiny ZIP reader (central directory) -----------------------------------
type ZipEntry = { name: string; data: Uint8Array; compressed: boolean };
function parseZip(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find End of Central Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("DOCX: not a valid ZIP file");
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const end = cdOffset + cdSize;
  while (p < end) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHdr = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    // Read local header to find file data offset
    const lhNameLen = dv.getUint16(localHdr + 26, true);
    const lhExtraLen = dv.getUint16(localHdr + 28, true);
    const dataStart = localHdr + 30 + lhNameLen + lhExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, data, compressed: method === 8 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, compressed: boolean): Promise<Uint8Array> {
  if (!compressed) return data;
  // deflate-raw is supported by Deno DecompressionStream
  const raw = new Uint8Array(data.byteLength);
  raw.set(data);
  const stream = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
  const buf = new Uint8Array(await stream.arrayBuffer());
  return buf;
}

// ----- AI calls ---------------------------------------------------------------

type ParsedQuestion = { q: string; options: string[]; correct: number; hint: string };

// Accept questions with 2 to 6 options (covers Yes/No, True/False, 3-way,
// standard MCQ-4, and longer answer sets). Truncate to 6 to keep UI sane.
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function normalizeQuestions(input: unknown): ParsedQuestion[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const obj = item as Record<string, unknown>;
      const q = typeof obj.q === "string" ? obj.q.trim() : "";
      const options = Array.isArray(obj.options)
        ? obj.options.map((o) => String(o ?? "").trim()).filter(Boolean).slice(0, MAX_OPTIONS)
        : [];
      const correctRaw = Number(obj.correct);
      const maxIdx = Math.max(0, options.length - 1);
      const correct = Number.isFinite(correctRaw) ? Math.max(0, Math.min(maxIdx, Math.floor(correctRaw))) : 0;
      const hint = typeof obj.hint === "string" ? obj.hint : "";
      if (!q || options.length < MIN_OPTIONS) return null;
      return { q, options, correct, hint };
    })
    .filter((v): v is ParsedQuestion => Boolean(v));
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function callLovable(userContent: unknown): Promise<ParsedQuestion[]> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return [];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30_000);
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    signal: ac.signal,
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "return_questions" } },
    }),
  });
  clearTimeout(t);

  if (!r.ok) {
    const t = await r.text();
    console.error("AI gateway error:", r.status, t);
    throw new Error(`AI gateway error (${r.status})`);
  }

  const data = await r.json();
  const tc = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!tc) {
    console.error("AI returned no tool_call:", JSON.stringify(data).slice(0, 500));
    return [];
  }
  const args = JSON.parse(tc.function.arguments || "{}");
  return normalizeQuestions(args.questions);
}

async function callGemini(parts: unknown[]): Promise<ParsedQuestion[]> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!GEMINI_API_KEY) return [];

  const geminiPrompt = `${SYSTEM}

Return ONLY valid JSON matching this shape (the options array can have 2 to 6 entries — preserve the natural number of options for each question):
{"questions":[{"q":"string","options":["option text", "..."],"correct":0,"hint":""}]}

Examples of valid option shapes:
- Yes/No:        ["Yes","No"]
- True/False:    ["True","False"]
- 3-way:         ["Always","Sometimes","Never"]
- Standard MCQ:  ["A","B","C","D"]
- Long-form:     ["Option 1","Option 2","Option 3","Option 4","Option 5"]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const payload = {
    contents: [{ role: "user", parts }],
    systemInstruction: { parts: [{ text: geminiPrompt }] },
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Retry transient overload/rate-limit errors (Gemini 503/429).
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 30_000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify(payload),
    }).finally(() => clearTimeout(timeoutId));

    if (r.ok) {
      const data = await r.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("\n") || "";
      const jsonText = extractFirstJsonObject(rawText) || rawText;
      const parsed = JSON.parse(jsonText);
      return normalizeQuestions(parsed?.questions);
    }

    lastStatus = r.status;
    lastBody = await r.text();
    console.error("Gemini API error:", r.status, lastBody);

    const retryable = r.status === 429 || r.status === 503;
    if (!retryable || attempt === 3) break;

    // Exponential backoff with jitter
    const backoff = Math.min(8000, 800 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 400);
    await sleep(backoff + jitter);
  }

  if (lastStatus === 429) throw new Error("GEMINI_RATE_LIMITED");
  if (lastStatus === 503) throw new Error("GEMINI_OVERLOADED");
  throw new Error(`Gemini API error (${lastStatus || "unknown"})`);

  // (unreachable)
}

const SYSTEM = `You are an exam parser. Extract every question from the provided document and return it in a structured form.

For each question, identify:
- the question text (no numbering prefix, no "Q1." / "1)" etc.),
- the answer options EXACTLY as written in the source — DO NOT invent extra options and DO NOT drop any. Preserve the natural option count, which may be 2, 3, 4, 5 or 6:
    * Yes/No questions → ["Yes","No"]
    * True/False questions → ["True","False"]
    * Three-way questions → 3 options
    * Standard MCQs → 4 options
    * Longer answer sets → up to 6 options
  Never pad with made-up distractors. Never collapse multiple options into one.
- the 0-based index of the correct option. Infer the correct answer from any of the following signals in the source:
    * an explicit "Answer:", "Correct:", "Ans:" line,
    * a bolded / underlined / highlighted / asterisked option,
    * a "(correct)" / "✓" marker next to an option,
    * an answer key at the end of the document,
    * if no marker is present, use your understanding of the topic to pick the best answer.
- an optional one-line hint (empty string if none).

Treat Yes/No, True/False and any single-best-answer questions as valid — do NOT skip them.
Return ONLY structured data via the provided tool. Never include markdown, prose, or commentary.`;

const TOOL = {
  type: "function",
  function: {
    name: "return_questions",
    description: "Return parsed MCQs",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              q: { type: "string" },
              // 2..6 options — covers Yes/No, True/False, 3-way, MCQ-4 and long-form.
              options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
              // 0-based index into options. Upper bound is enforced server-side
              // against the actual options.length in normalizeQuestions.
              correct: { type: "integer", minimum: 0, maximum: 5 },
              hint: { type: "string" },
            },
            required: ["q", "options", "correct", "hint"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization") || "anonymous";
    const key = authHeader.slice(0, 64);
    const now = Date.now();
    const recent = (requestHits.get(key) || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return err(429, "Too many parse requests. Please wait and retry.");
    recent.push(now);
    requestHits.set(key, recent);

    const { fileBase64, mimeType, fileName } = await req.json();
    if (!fileBase64 || !mimeType) return err(400, "fileBase64 and mimeType are required");

    const bytes = b64ToBytes(fileBase64);
    if (bytes.byteLength > MAX_FILE_BYTES) return err(413, "File too large. Max upload size is 12MB.");
    const lowerName = (fileName || '').toLowerCase();
    const isPdf = mimeType === 'application/pdf' || lowerName.endsWith('.pdf');
    const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.docx');
    const isText = mimeType.startsWith('text/') || mimeType === 'application/json' || lowerName.endsWith('.txt');

    let userContent: unknown;
    let geminiParts: unknown[] = [];
    if (isText) {
      const text = new TextDecoder().decode(bytes).slice(0, 200_000);
      if (!text.trim()) return err(400, "The text file is empty.");
      userContent = [{ type: 'text', text: `Filename: ${fileName || 'upload.txt'}\n\n--- FILE CONTENT ---\n${text}` }];
      geminiParts = [{ text: `Filename: ${fileName || "upload.txt"}\n\n--- FILE CONTENT ---\n${text}` }];
    } else if (isDocx) {
      let text = '';
      try { text = await extractDocxText(bytes); } catch (e) {
        console.error("DOCX extract failed:", e);
        return err(400, "Could not read this DOCX file. Try saving it as PDF or TXT and upload again.");
      }
      text = text.slice(0, 200_000);
      if (!text.trim()) return err(400, "The DOCX file appears to be empty or unreadable.");
      userContent = [{ type: 'text', text: `Filename: ${fileName || 'upload.docx'}\n\n--- FILE CONTENT (extracted from DOCX) ---\n${text}` }];
      geminiParts = [{ text: `Filename: ${fileName || "upload.docx"}\n\n--- FILE CONTENT (extracted from DOCX) ---\n${text}` }];
    } else if (isPdf) {
      userContent = [
        { type: 'text', text: `Filename: ${fileName || 'upload.pdf'}. Read every page and extract all multiple-choice questions.` },
        { type: 'file', file: { filename: fileName || 'upload.pdf', file_data: `data:application/pdf;base64,${fileBase64}` } },
      ];
      geminiParts = [
        { text: `Filename: ${fileName || "upload.pdf"}. Read every page and extract all multiple-choice questions.` },
        { inline_data: { mime_type: "application/pdf", data: fileBase64 } },
      ];
    } else {
      // Best effort: try as utf-8 text
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 200_000);
      if (!text.trim()) return err(400, `Unsupported file type: ${mimeType}. Please upload a PDF, DOCX or TXT.`);
      userContent = [{ type: 'text', text: `Filename: ${fileName || 'upload'}\n\n--- FILE CONTENT ---\n${text}` }];
      geminiParts = [{ text: `Filename: ${fileName || "upload"}\n\n--- FILE CONTENT ---\n${text}` }];
    }

    let questions: ParsedQuestion[] = [];
    try {
      questions = await callGemini(geminiParts);
      if (!questions.length) questions = await callLovable(userContent);
    } catch (e) {
      console.error("Primary AI call failed:", e);
      try {
        questions = await callLovable(userContent);
      } catch (fallbackErr) {
        console.error("Fallback AI call failed:", fallbackErr);
        // Map common transient Gemini failures to clear HTTP codes for the client
        if (e instanceof Error && e.message === "GEMINI_OVERLOADED") {
          return err(503, "AI is experiencing high demand right now. Please try again in 30–60 seconds.");
        }
        if (e instanceof Error && e.message === "GEMINI_RATE_LIMITED") {
          return err(429, "AI rate-limited. Please retry in a moment.");
        }
        throw e;
      }
    }

    if (!questions.length) {
      const hasGemini = Boolean(Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY"));
      const hasLovable = Boolean(Deno.env.get("LOVABLE_API_KEY"));
      if (!hasGemini && !hasLovable) {
        return err(500, "No AI key configured. Set GEMINI_API_KEY (preferred) or LOVABLE_API_KEY in Edge Function secrets.");
      }
    }
    if (!questions.length) return err(400, "AI couldn't find any multiple-choice questions in this file.");
    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-quiz fatal:", e);
    return err(500, e instanceof Error ? e.message : "Unknown error");
  }
});
