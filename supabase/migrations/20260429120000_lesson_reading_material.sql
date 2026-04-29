-- Add optional reading material to lessons.
-- Reading material is supplementary — not gated by completion %.
-- The file is stored in a public 'reading-materials' storage bucket.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS reading_material_path TEXT,
  ADD COLUMN IF NOT EXISTS reading_material_name TEXT;

-- Storage bucket for reading materials. Public so signed URLs aren't required;
-- the file is supplementary and is the same content the user is allowed to read.
INSERT INTO storage.buckets (id, name, public)
VALUES ('reading-materials', 'reading-materials', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone authenticated can read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'reading_materials_read'
  ) THEN
    CREATE POLICY "reading_materials_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'reading-materials');
  END IF;
END $$;

-- Only admins can upload / replace / delete (matches the course-videos bucket rules).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'reading_materials_admin_write'
  ) THEN
    CREATE POLICY "reading_materials_admin_write"
      ON storage.objects FOR ALL
      USING (bucket_id = 'reading-materials' AND public.has_role(auth.uid(), 'admin'))
      WITH CHECK (bucket_id = 'reading-materials' AND public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;
