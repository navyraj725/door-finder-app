import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
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

  // Google (and other OAuth) failures come back in the URL hash, e.g.
  // /#error=server_error&error_description=... — capture and strip them.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const err = params.get('error');
    const description = params.get('error_description');
    if (!err && !description) return;
    setOauthError(
      description
        ? decodeURIComponent(description.replace(/\+/g, ' '))
        : `Sign-in failed (${err}). Please try again.`
    );
    params.delete('error');
    params.delete('error_description');
    const remaining = params.toString();
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (remaining ? `#${remaining}` : ''));
  }, []);

  function clearOauthError() {
    setOauthError(null);
  }

  async function loadProfile(uid: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      console.error('Profile load error:', error.message);
      return;
    }
    setProfile(data as Profile | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        // Defer the query: awaiting Supabase calls inside this callback can deadlock
        // with the auth lock while the session is being committed.
        setTimeout(() => { void loadProfile(newSession.user.id); }, 0);
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: AUTH_REDIRECT_URL },
    });

    if (!error) return { error: null };

    if (error.message.toLowerCase().includes('unsupported provider')) {
      return { error: 'Google sign-in is not enabled yet. Please use email and password for now.' };
    }

    return { error: error.message };
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${AUTH_REDIRECT_URL}/reset-password`,
    });
    return { error: error?.message ?? null };
  }

  async function refreshProfile() {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) await loadProfile(data.session.user.id);
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
