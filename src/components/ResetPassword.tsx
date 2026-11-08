import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

type Status = 'checking' | 'ready' | 'invalid' | 'done';

export default function ResetPassword() {
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = 'Reset Password — Door Finder Uganda';

    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const linkError = query.get('error_description') || hash.get('error_description');
    if (linkError) {
      setError(linkError);
      setStatus('invalid');
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setStatus(data.session ? 'ready' : 'invalid');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setStatus('ready');
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setStatus('done');
      setPassword('');
      setConfirm('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '420px', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <h1 style={{ color: 'white', fontSize: '24px', fontWeight: 800, marginBottom: '4px' }}>Reset Your Password</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>Choose a new password for your DoorFinder account.</p>
        </div>

        <div style={{ background: 'white', borderRadius: '16px', padding: '32px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          {status === 'checking' && (
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', textAlign: 'center' }}>Verifying reset link...</p>
          )}

          {status === 'invalid' && (
            <>
              <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontWeight: 600, marginBottom: '16px' }}>
                {error || 'This reset link is invalid or has expired.'}
              </div>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Request a fresh link from the sign-in window: open{' '}
                <Link to="/" style={{ color: 'var(--green-dark)', fontWeight: 700 }}>DoorFinder</Link>{' '}
                and choose “Forgot password?”.
              </p>
            </>
          )}

          {status === 'ready' && (
            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', fontWeight: 600, marginBottom: '16px' }}>
                  {error}
                </div>
              )}
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  style={{ width: '100%', padding: '12px 14px', border: '1.5px solid var(--border)', borderRadius: '8px', fontSize: '14px', marginTop: '4px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>Confirm New Password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  minLength={6}
                  required
                  autoComplete="new-password"
                  style={{ width: '100%', padding: '12px 14px', border: '1.5px solid var(--border)', borderRadius: '8px', fontSize: '14px', marginTop: '4px' }}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{ width: '100%', background: '#2DBD4E', color: 'white', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Saving...' : 'Set New Password'}
              </button>
            </form>
          )}

          {status === 'done' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ background: '#DCFCE7', color: '#166534', borderRadius: '8px', padding: '12px 14px', fontSize: '14px', fontWeight: 700, marginBottom: '20px' }}>
                Password updated successfully.
              </div>
              <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '20px' }}>
                You are signed in. Continue to your account.
              </p>
              <Link
                to="/admin"
                style={{ display: 'block', background: '#1B2B4B', color: 'white', borderRadius: '10px', padding: '14px', fontSize: '15px', fontWeight: 700, textDecoration: 'none', marginBottom: '10px' }}
              >
                Go to Admin Dashboard
              </Link>
              <Link
                to="/"
                style={{ display: 'block', color: 'var(--green-dark)', fontSize: '14px', fontWeight: 600, textDecoration: 'underline' }}
              >
                Back to DoorFinder
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
