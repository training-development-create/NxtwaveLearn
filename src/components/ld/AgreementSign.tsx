// Agreement viewer + sign component (Phase E of compliance LMS).
// -----------------------------------------------------------------
// Shown after the learner passes the quiz IF the course has
// agreement_required=true. The learner must:
//   1. Scroll to the bottom of the agreement PDF
//   2. Type their full name (captured for the audit trail)
//   3. Tick "I have read and agree"
//   4. Click Sign — writes a row to public.agreement_signatures
//
// The signature checkbox is disabled until step 1 is observed. We listen
// for scroll events on the iframe wrapper rather than the PDF itself
// (cross-origin iframe can't be inspected). To keep the check honest,
// we also enforce a small minimum dwell time.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { Btn, Card } from "./ui";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Zoho-style signature stamp.
// Downloads the template PDF, draws a signature block (typed name in a script
// font + signing date + audit-trail strip) on the LAST page, uploads the
// stamped copy back to the `agreements` bucket under a per-user path, and
// returns the new path. If anything fails we return null and the caller falls
// back to recording the signature without a stamped copy (so the user is
// never blocked from completing the course).
async function buildAndUploadStampedPdf(opts: {
  templatePath: string;
  courseId: string;
  userId: string;
  fullName: string;
  signedAt: Date;
}): Promise<string | null> {
  try {
    // 1. Download the original template bytes via a short-lived signed URL.
    const { data: signed, error: urlErr } = await supabase.storage
      .from('agreements').createSignedUrl(opts.templatePath, 60 * 5);
    if (urlErr || !signed?.signedUrl) {
      console.warn('[AgreementSign] could not sign template URL for stamping:', urlErr?.message);
      return null;
    }
    const resp = await fetch(signed.signedUrl);
    if (!resp.ok) {
      console.warn('[AgreementSign] template fetch failed:', resp.status);
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // 2. Stamp last page.
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = pdf.getPages();
    if (pages.length === 0) return null;
    const last = pages[pages.length - 1];
    const { width, height } = last.getSize();

    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const dateStr = opts.signedAt.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
    });
    const timeStr = opts.signedAt.toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });

    // Box dimensions (drawn near the bottom of the page).
    const boxW = Math.min(width - 60, 380);
    const boxH = 110;
    const boxX = 30;
    const boxY = 30;

    // Background card (light) + accent border on top.
    last.drawRectangle({
      x: boxX, y: boxY, width: boxW, height: boxH,
      color: rgb(0.973, 0.984, 1), // #F8FBFF
      borderColor: rgb(0.0, 0.447, 1.0), // #0072FF accent
      borderWidth: 1,
    });
    last.drawRectangle({
      x: boxX, y: boxY + boxH - 4, width: boxW, height: 4,
      color: rgb(0.0, 0.447, 1.0),
    });

    last.drawText('SIGNED ELECTRONICALLY', {
      x: boxX + 12, y: boxY + boxH - 22, size: 8,
      font: helvBold, color: rgb(0.36, 0.42, 0.49),
    });

    // Signed name in a script-ish style (HelveticaOblique is the closest in
    // the standard 14 — large + italic reads as "signature").
    last.drawText(opts.fullName, {
      x: boxX + 12, y: boxY + boxH - 50, size: 22,
      font: oblique, color: rgb(0.04, 0.12, 0.24),
    });

    last.drawLine({
      start: { x: boxX + 12, y: boxY + boxH - 56 },
      end: { x: boxX + boxW - 12, y: boxY + boxH - 56 },
      thickness: 0.6,
      color: rgb(0.78, 0.84, 0.92),
    });

    last.drawText(`Signed by: ${opts.fullName}`, {
      x: boxX + 12, y: boxY + 32, size: 9,
      font: helvBold, color: rgb(0.04, 0.12, 0.24),
    });
    last.drawText(`Date:       ${dateStr} · ${timeStr}`, {
      x: boxX + 12, y: boxY + 18, size: 9,
      font: helv, color: rgb(0.36, 0.42, 0.49),
    });
    last.drawText(`Signature ID: ${opts.userId.slice(0, 8)}…${opts.userId.slice(-4)}`, {
      x: boxX + 12, y: boxY + 6, size: 8,
      font: helv, color: rgb(0.55, 0.61, 0.7),
    });

    const stampedBytes = await pdf.save();

    // 3. Upload the stamped copy.
    const stampedPath = `${opts.courseId}/signed/${opts.userId}-${opts.signedAt.getTime()}.pdf`;
    const blob = new Blob([stampedBytes], { type: 'application/pdf' });
    const { error: upErr } = await supabase.storage
      .from('agreements')
      .upload(stampedPath, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.warn('[AgreementSign] stamped upload failed:', upErr.message);
      return null;
    }
    return stampedPath;
  } catch (e) {
    console.warn('[AgreementSign] stamping failed (non-fatal):', e);
    return null;
  }
}

type Props = {
  courseId: string;
  courseTitle: string;
  agreementPdfPath: string;
  fullName: string;
  onSigned: () => void;       // called after successful insert
  onCancel: () => void;
};

export function AgreementSign({ courseId, courseTitle, agreementPdfPath, fullName, onSigned, onCancel }: Props) {
  const { user } = useAuth();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState(fullName ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const openedAtRef = useRef<number>(Date.now());

  // Persist typedName / agreed / scrolledToBottom across tab switches & refreshes.
  // Cleared by the parent (Assessment) on successful signing via onSigned.
  const persistKey = user ? `agreement-state-${user.id}-${courseId}` : null;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!persistKey || restoredRef.current) return;
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw) {
        const saved = JSON.parse(raw) as { typedName?: string; agreed?: boolean; scrolledToBottom?: boolean };
        if (typeof saved.typedName === 'string' && saved.typedName) setTypedName(saved.typedName);
        if (saved.agreed) setAgreed(true);
        if (saved.scrolledToBottom) setScrolledToBottom(true);
      }
    } catch { /* ignore */ }
    restoredRef.current = true;
  }, [persistKey]);
  useEffect(() => {
    if (!persistKey || !restoredRef.current) return;
    try {
      localStorage.setItem(persistKey, JSON.stringify({ typedName, agreed, scrolledToBottom }));
    } catch { /* ignore quota errors */ }
  }, [persistKey, typedName, agreed, scrolledToBottom]);

  // Resolve a signed URL for the private agreements bucket.
  useEffect(() => {
    let cancelled = false;
    supabase.storage.from('agreements').createSignedUrl(agreementPdfPath, 60 * 60).then(({ data }) => {
      if (!cancelled) setPdfUrl(data?.signedUrl ?? null);
    });
    return () => { cancelled = true; };
  }, [agreementPdfPath]);

  // Detect scroll-to-bottom on the wrapper. We can't read inside the PDF
  // iframe, so we wrap it in a tall container the user must scroll down to
  // reveal "I have read" — minimum 8 sec dwell to discourage instant skips.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const reachedEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (reachedEnd && !scrolledToBottom) {
      const elapsed = Date.now() - openedAtRef.current;
      if (elapsed >= 8000) setScrolledToBottom(true);
      else setTimeout(() => setScrolledToBottom(true), 8000 - elapsed);
    }
  };

  const sign = async () => {
    if (!user) return;
    setBusy(true); setErr(null);
    try {
      const signedAt = new Date();
      // Try to stamp the signature onto a per-user copy of the PDF and store
      // that copy. If stamping fails (network blip, missing bucket perms,
      // PDF too unusual to parse), we fall back to recording the signature
      // pointing at the original template — the audit trail is still intact.
      const stampedPath = await buildAndUploadStampedPdf({
        templatePath: agreementPdfPath,
        courseId,
        userId: user.id,
        fullName: typedName.trim(),
        signedAt,
      });
      const pathForRow = stampedPath || agreementPdfPath;
      const { error } = await supabase.from('agreement_signatures').insert({
        user_id: user.id,
        course_id: courseId,
        agreement_pdf_path: pathForRow,
        signed_full_name: typedName.trim(),
        signed_text: 'I have read and agree',
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
      if (error) throw error;
      if (persistKey) { try { localStorage.removeItem(persistKey); } catch { /* ignore */ } }
      onSigned();
    } catch (e) {
      setErr((e as Error).message || 'Could not record signature.');
      setBusy(false);
    }
  };

  const canSign = scrolledToBottom && agreed && typedName.trim().length >= 2 && !busy;

  return (
    <div style={{padding:'24px 36px 48px', maxWidth:1080, animation:'fadeUp .3s'}}>
      <Card pad={0} style={{overflow:'hidden'}}>
        <div style={{padding:'22px 28px', background:'linear-gradient(135deg,#0A1F3D,#0072FF)', color:'#fff'}}>
          <div style={{fontSize:11, fontWeight:700, letterSpacing:'.12em', color:'#9EC9F0', textTransform:'uppercase'}}>Step 3 · Agreement</div>
          <div style={{fontSize:20, fontWeight:800, marginTop:4, letterSpacing:'-.01em'}}>{courseTitle}</div>
          <div style={{fontSize:12, color:'#C8DDF4', marginTop:6}}>
            Read the agreement below, then sign to complete the course. The "I have read and agree" checkbox unlocks once you've scrolled to the end.
          </div>
        </div>

        <div
          ref={scrollerRef}
          onScroll={onScroll}
          style={{maxHeight:520, overflowY:'auto', background:'#F7F9FC', borderTop:'1px solid #EEF2F7', borderBottom:'1px solid #EEF2F7'}}
        >
          {pdfUrl ? (
            <>
              <iframe
                src={pdfUrl}
                title="Agreement"
                style={{display:'block', width:'100%', height:600, border:0, background:'#fff'}}
              />
              {/* Spacer so the wrapper actually has scroll distance even if
                  the embedded PDF viewer disables its own scrolling. */}
              <div style={{height:80, padding:'18px 28px', textAlign:'center', fontSize:12, color: scrolledToBottom ? '#17A674' : '#5B6A7D', background:'#F7F9FC'}}>
                {scrolledToBottom
                  ? '✓ End of document reached — you may sign below.'
                  : 'Scroll down through the document to enable signing.'}
              </div>
            </>
          ) : (
            <div style={{padding:60, textAlign:'center', color:'#5B6A7D', fontSize:13}}>Loading agreement…</div>
          )}
        </div>

        <div style={{padding:'20px 28px'}}>
          <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginBottom:10}}>Confirm your identity</div>
          <input
            value={typedName}
            onChange={e => setTypedName(e.target.value)}
            placeholder="Type your full legal name"
            style={{width:'100%', padding:'10px 12px', border:'1px solid #DDE4ED', borderRadius:8, fontSize:14, marginBottom:14}}
          />
          <label style={{display:'flex', gap:10, alignItems:'flex-start', padding:'12px 14px', background: agreed ? '#F0FCF5' : '#F7F9FC', border:`1.5px solid ${agreed ? '#17A674' : '#EEF2F7'}`, borderRadius:8, cursor: scrolledToBottom ? 'pointer' : 'not-allowed', opacity: scrolledToBottom ? 1 : .5}}>
            <input
              type="checkbox"
              checked={agreed}
              disabled={!scrolledToBottom}
              onChange={e => setAgreed(e.target.checked)}
              style={{marginTop:3}}
            />
            <span style={{fontSize:13, color:'#3B4A5E', lineHeight:1.5}}>
              <strong style={{color:'#0A1F3D'}}>I have read and agree.</strong> By ticking this box and clicking Sign,
              I confirm I have read the agreement above and accept its terms. My name, timestamp, and
              browser details will be recorded as part of an audit trail.
            </span>
          </label>

          {err && <div style={{marginTop:12, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>{err}</div>}

          <div style={{marginTop:18, display:'flex', gap:10, justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={onCancel} disabled={busy}>Back</Btn>
            <Btn variant="success" size="lg" onClick={sign} disabled={!canSign}>
              {busy ? 'Recording…' : '✍️ Sign and complete'}
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
