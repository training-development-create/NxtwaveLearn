
-- 1. Drop department from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS department;

-- 2. Add published_at to courses, video_path to lessons
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS video_path text;

-- Mark existing courses as published (so they auto-enroll going forward consistently)
UPDATE public.courses SET published_at = created_at WHERE published_at IS NULL;

-- 3. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link_course_id uuid,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notif: users see own" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Notif: users update own" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Notif: admins insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Notif: system insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- 4. Auto-enroll trigger: when a course is published, enroll all learners; notify them
CREATE OR REPLACE FUNCTION public.on_course_published()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.published_at IS NOT NULL AND (OLD.published_at IS NULL OR TG_OP='INSERT') THEN
    INSERT INTO public.enrollments (user_id, course_id)
    SELECT p.id, NEW.id FROM public.profiles p
    ON CONFLICT DO NOTHING;

    INSERT INTO public.notifications (user_id, title, body, link_course_id)
    SELECT p.id, 'New course available', NEW.title, NEW.id FROM public.profiles p;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_course_published_ins ON public.courses;
CREATE TRIGGER trg_course_published_ins AFTER INSERT ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.on_course_published();

DROP TRIGGER IF EXISTS trg_course_published_upd ON public.courses;
CREATE TRIGGER trg_course_published_upd AFTER UPDATE OF published_at ON public.courses
FOR EACH ROW EXECUTE FUNCTION public.on_course_published();

-- Unique enrollment to allow ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS enrollments_user_course_uniq ON public.enrollments(user_id, course_id);

-- 5. Update handle_new_user: drop department; auto-enroll into all published courses
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, employee_id)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    NEW.raw_user_meta_data->>'employee_id'
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'learner');

  INSERT INTO public.enrollments (user_id, course_id)
  SELECT NEW.id, c.id FROM public.courses c WHERE c.published_at IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END $$;

-- Make sure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Allow admins to promote others
CREATE OR REPLACE FUNCTION public.promote_to_admin(_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can promote users';
  END IF;
  SELECT id INTO _uid FROM public.profiles WHERE email = _email;
  IF _uid IS NULL THEN RAISE EXCEPTION 'No user with email %', _email; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin')
  ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.demote_admin(_email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can demote users';
  END IF;
  SELECT id INTO _uid FROM public.profiles WHERE email = _email;
  IF _uid IS NULL THEN RAISE EXCEPTION 'No user with email %', _email; END IF;
  DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'admin';
END $$;

-- 7. Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('course-videos','course-videos', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('quiz-uploads','quiz-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Policies: admins upload, all authed read
CREATE POLICY "videos: authed read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='course-videos');
CREATE POLICY "videos: admin write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='course-videos' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "videos: admin update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='course-videos' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "videos: admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='course-videos' AND public.has_role(auth.uid(),'admin'));

CREATE POLICY "quizup: admin read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='quiz-uploads' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "quizup: admin write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='quiz-uploads' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "quizup: admin delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='quiz-uploads' AND public.has_role(auth.uid(),'admin'));

-- 8. Realtime for notifications (optional but useful)
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
