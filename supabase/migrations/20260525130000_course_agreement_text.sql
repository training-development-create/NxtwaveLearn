-- =========================================================================
-- Text-based course agreement (consent statement).
--
-- The existing agreement feature is PDF-based (courses.agreement_pdf_path).
-- Some assessment documents end with an inline consent/acknowledgment block
-- (e.g. "By checking the box below, I acknowledge … ☐ I have read and agree")
-- rather than a separate PDF. This column stores that statement as text so the
-- same sign-to-complete flow + agreement_signatures audit trail + analytics
-- "Signed" status all work without a PDF.
--
-- A course "requires an agreement" when agreement_required = true AND
-- (agreement_pdf_path IS NOT NULL OR agreement_text IS NOT NULL).
-- =========================================================================

alter table public.courses add column if not exists agreement_text text;
