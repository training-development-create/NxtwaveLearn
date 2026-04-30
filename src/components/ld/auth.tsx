import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Only emails from these domains may log in. Anyone else is signed out
// immediately and shown an error toast.
export const ALLOWED_EMAIL_DOMAINS = ['nxtwave.co.in', 'nxtwave.in'];

export const isAllowedEmail = (email: string | null | undefined) => {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1];
  return !!domain && ALLOWED_EMAIL_DOMAINS.includes(domain);
};

// Profile is sourced from public.employees (the new org-aware schema).
// `id` is the auth.users.id; `employee_row_id` is employees.id (used for
// course_assignments lookups). `status='unassigned'` means the user logged
// in but has no department/manager — admin must resolve via Darwin sync or
// manual edit.
export type Profile = {
  id: string;                       // auth_user_id (kept as `id` for compat)
  employee_row_id: string;          // employees.id
  full_name: string;
  email: string;
  employee_id: string | null;
  avatar_url: string | null;
  department_id: string | null;
  department_name: string | null;
  sub_department_id: string | null;
  sub_department_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  manager_email: string | null;
  manager_contact: string | null;
  status: 'active' | 'inactive' | 'unassigned';
  is_admin: boolean;
};

export type AuthCtx = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: 'admin' | 'learner' | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithMicrosoft: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

type EmployeeRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string;
  employee_id: string | null;
  contact: string | null;
  department_id: string | null;
  sub_department_id: string | null;
  manager_id: string | null;
  status: 'active' | 'inactive' | 'unassigned';
  is_admin: boolean;
  departments: { id: string; name: string } | null;
  sub_departments: { id: string; name: string } | null;
  manager: { id: string; name: string; email: string; contact: string | null } | null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin'|'learner'|null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const touchLastLogin = async (uid: string) => {
    try {
      await supabase.from('employees').update({ last_login_at: new Date().toISOString() }).eq('auth_user_id', uid);
    } catch {
      // ignore
    }
  };

  const loadProfileAndRole = async (uid: string): Promise<Profile | null> => {
    // Single query: employee row + joined dept / sub-dept / manager.
    // The trigger on auth.users (handle_new_user) already created the row.
    const { data, error } = await supabase
      .from('employees')
      .select(`
        id, auth_user_id, email, name, employee_id, contact,
        department_id, sub_department_id, manager_id, status, is_admin,
        departments:department_id ( id, name ),
        sub_departments:sub_department_id ( id, name ),
        manager:manager_id ( id, name, email, contact )
      `)
      .eq('auth_user_id', uid)
      .maybeSingle<EmployeeRow>();

    if (error) {
      console.warn('[auth] employee load failed:', error.message);
      setProfile(null);
      setRole(null);
      return null;
    }
    if (!data) {
      setProfile(null);
      setRole(null);
      return null;
    }

    const prof: Profile = {
      id: data.auth_user_id ?? uid,
      employee_row_id: data.id,
      full_name: data.name || data.email,
      email: data.email,
      employee_id: data.employee_id,
      avatar_url: null,
      department_id: data.department_id,
      department_name: data.departments?.name ?? null,
      sub_department_id: data.sub_department_id,
      sub_department_name: data.sub_departments?.name ?? null,
      manager_id: data.manager_id,
      manager_name: data.manager?.name ?? null,
      manager_email: data.manager?.email ?? null,
      manager_contact: data.manager?.contact ?? null,
      status: data.status,
      is_admin: data.is_admin,
    };
    setProfile(prof);
    setRole(data.is_admin ? 'admin' : 'learner');
    return prof;
  };


  // Race guard: both onAuthStateChange AND getSession() fire on mount, plus
  // any later auth events. Without a sequence counter, a slow profile fetch
  // from an early event can clobber state set by a later event (e.g. user
  // signs out → in quickly). seqRef is incremented for every dispatch; only
  // the latest wins.
  const seqRef = useRef(0);
  // Tracks unmount so async work that resolves after teardown doesn't call
  // setState (React 18 logs warnings + leaks subscribers).
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const safeSet = <T,>(setter: (v: T) => void, v: T) => {
      if (mountedRef.current) setter(v);
    };

    const acceptOrReject = async (sess: Session | null) => {
      const mySeq = ++seqRef.current;
      const isStale = () => mySeq !== seqRef.current || !mountedRef.current;

      try {
        if (!sess?.user) {
          if (isStale()) return;
          safeSet(setSession, null); safeSet(setUser, null);
          safeSet(setProfile, null); safeSet(setRole, null);
          safeSet(setLoading, false);
          return;
        }
        // Domain gate.
        if (!isAllowedEmail(sess.user.email)) {
          // Sign out is best-effort — if it throws (network), we still want
          // to surface the error and clear local state so the user isn't
          // stuck on a loading spinner.
          try { await supabase.auth.signOut(); } catch (e) {
            console.warn('[auth] signOut after domain gate failed:', e);
          }
          if (isStale()) return;
          safeSet(setAuthError, `Access restricted to ${ALLOWED_EMAIL_DOMAINS.map(d => '@' + d).join(', ')} accounts only.`);
          safeSet(setSession, null); safeSet(setUser, null);
          safeSet(setProfile, null); safeSet(setRole, null);
          safeSet(setLoading, false);
          return;
        }
        if (isStale()) return;
        safeSet(setAuthError, null);
        safeSet(setSession, sess);
        safeSet(setUser, sess.user);
        safeSet(setLoading, true);
        void touchLastLogin(sess.user.id);
        try {
          await loadProfileAndRole(sess.user.id);
        } catch (e) {
          // Without this, a thrown DB/RLS error would leave loading=true
          // forever — user is stuck on the loading spinner. Surface to UI.
          console.error('[auth] loadProfileAndRole threw:', e);
          if (!isStale()) {
            safeSet(setProfile, null);
            safeSet(setRole, null);
            safeSet(setAuthError, 'Could not load your profile. Please refresh or contact admin.');
          }
        }
        if (!isStale()) safeSet(setLoading, false);
      } catch (e) {
        // Safety net: any unexpected throw above must still clear loading,
        // otherwise the whole app hangs on the spinner forever.
        console.error('[auth] acceptOrReject crashed:', e);
        if (!isStale()) {
          safeSet(setLoading, false);
          safeSet(setAuthError, 'Sign-in failed. Please refresh and try again.');
        }
      }
      // Darwin sync is now done by daily bulk import, so login does not call HR API.
    };

    let sub: { subscription?: { unsubscribe: () => void } } | undefined;
    try {
      const result = supabase.auth.onAuthStateChange((_evt, sess) => {
        void acceptOrReject(sess);
      });
      sub = result?.data;
    } catch (e) {
      console.error('[auth] onAuthStateChange registration failed:', e);
    }
    // .catch() is critical — without it a getSession() rejection (network
    // failure on first paint, expired refresh token, Supabase outage) would
    // leave loading=true forever and the user stares at a blank spinner.
    supabase.auth.getSession()
      .then(({ data: { session: s } }) => { void acceptOrReject(s); })
      .catch((e) => {
        console.error('[auth] getSession failed:', e);
        // Treat as logged-out so the Login screen shows instead of hanging.
        void acceptOrReject(null);
      });
    return () => {
      mountedRef.current = false;
      try { sub?.subscription?.unsubscribe?.(); } catch (e) {
        console.warn('[auth] unsubscribe failed:', e);
      }
    };
  }, []);

  const signInWithProvider = async (provider: 'google' | 'azure') => {
    setAuthError(null);
    const queryParams: Record<string, string> = { prompt: 'select_account' };
    if (provider === 'google' && ALLOWED_EMAIL_DOMAINS.length === 1) {
      queryParams.hd = ALLOWED_EMAIL_DOMAINS[0];
    }
    // signInWithOAuth normally returns { error } — but a network failure or
    // bad client init can still throw before the response. Catch so the
    // Login button gets a clean { error } back instead of an unhandled
    // rejection that leaves the button stuck on "Opening Google…".
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams,
          scopes: provider === 'azure' ? 'email openid profile' : undefined,
        },
      });
      return { error: error?.message ?? null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed';
      console.error('[auth] signInWithOAuth threw:', e);
      return { error: msg };
    }
  };

  const signInWithGoogle: AuthCtx['signInWithGoogle'] = () => signInWithProvider('google');
  const signInWithMicrosoft: AuthCtx['signInWithMicrosoft'] = () => signInWithProvider('azure');

  const signOut = async () => {
    setAuthError(null);
    // signOut can reject (network failure / token already invalid). If we
    // don't catch, the caller's UI is stuck mid-action ("Signing out…"
    // button disabled forever). Best-effort: clear local state regardless.
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[auth] signOut failed:', e);
    }
  };

  const refresh = async () => {
    if (user) await loadProfileAndRole(user.id);
  };

  return (
    <Ctx.Provider value={{ session, user, profile, role, loading, authError, signInWithGoogle, signInWithMicrosoft, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
