import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AUTH_REDIRECT_URL, supabase } from '@/lib/supabase';
import type { Profile, ProfileRole } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  oauthError: string | null;
  clearOauthError: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string, whatsapp: string, role: Extract<ProfileRole, 'tenant' | 'landlord'>) => Promise<{ error: string | null; info?: string }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // OAuth failures come back either in the query string (PKCE flow, e.g.
  // /?error=access_denied&error_description=...) or in the URL hash
  // (/#error=server_error&error_description=...) — capture and strip both.
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const err = query.get('error') || hash.get('error');
    const description = query.get('error_description') || hash.get('error_description');
    const errorCode = query.get('error_code') || hash.get('error_code');
    if (!err && !description && !errorCode) return;
    const friendly =
      errorCode === 'otp_expired' ? 'That sign-in link has expired. Please try again.' :
      err === 'access_denied' ? 'Google sign-in was cancelled. You can try again or use email and password.' :
      description
        ? decodeURIComponent(description.replace(/\+/g, ' '))
        : `Sign-in failed (${err || errorCode}). Please try again.`;
    setOauthError(friendly);
    for (const key of ['error', 'error_description', 'error_code']) {
      query.delete(key);
      hash.delete(key);
    }
    const qs = query.toString();
    const hs = hash.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + (hs ? `#${hs}` : '')
    );
  }, []);

  function clearOauthError() {
    setOauthError(null);
  }

  async function loadProfile(user: User) {
    const meta = user.user_metadata ?? {};
    const fallback: Profile = {
      id: user.id,
      email: user.email ?? '',
      full_name: (meta.full_name as string) || (meta.name as string) || (user.email ? user.email.split('@')[0] : 'Member'),
      role: ['tenant', 'landlord', 'admin', 'client'].includes(meta.role as string) ? (meta.role as ProfileRole) : 'tenant',
      whatsapp: (meta.whatsapp as string) || '',
      avatar_url: (meta.avatar_url as string) || (meta.picture as string) || '',
      created_at: user.created_at,
    };
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (!error && data) {
      setProfile({ ...fallback, ...(data as Profile) });
      return;
    }
    // A valid session must keep the user signed in even when no profile row
    // exists yet — otherwise every reload asks them to register again.
    setProfile(fallback);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        // Defer the query: awaiting Supabase calls inside this callback can deadlock
        // with the auth lock while the session is being committed.
        setTimeout(() => { void loadProfile(newSession.user); }, 0);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signUp(email: string, password: string, fullName: string, whatsapp: string, role: Extract<ProfileRole, 'tenant' | 'landlord'>) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, whatsapp, role } },
    });
    if (error) return { error: error.message };
    if (!data.session) {
      return { error: null, info: 'Account created. Check your email inbox to confirm your address, then sign in.' };
    }
    return { error: null };
  }

  async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });

    const friendly = (msg: string) => {
      const m = msg.toLowerCase();
      if (m.includes('unsupported provider') || m.includes('not enabled') || m.includes('validation_failed')) {
        return 'Google sign-in is not switched on for this site yet. Please use email and password for now.';
      }
      return msg;
    };

    if (error) return { error: friendly(error.message) };
    if (!data?.url) return { error: 'Could not start Google sign-in. Please try again.' };

    // Validate before leaving the page: a disabled or misconfigured provider
    // answers with a JSON error, and navigating there would strand the user
    // on a raw error page instead of showing the message in the modal.
    try {
      const probe = await fetch(data.url, { method: 'GET', redirect: 'manual' });
      if (probe.type !== 'opaqueredirect' && probe.status >= 400) {
        let msg = `Google sign-in failed (${probe.status}). Please try again.`;
        try {
          const body = await probe.json();
          if (body?.msg || body?.error_description) msg = body.msg || body.error_description;
        } catch { /* keep the default message */ }
        return { error: friendly(msg) };
      }
    } catch {
      // Probe blocked (offline/CORS) — let the browser attempt the redirect.
    }

    window.location.href = data.url;
    return { error: null };
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${AUTH_REDIRECT_URL}/reset-password`,
    });
    return { error: error?.message ?? null };
  }

  async function refreshProfile() {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await loadProfile(data.session.user);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, oauthError, clearOauthError, signIn, signUp, signInWithGoogle, resetPassword, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
