import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAction } from '../lib/hooks';
import { DevTag, FormError } from '../components/ui';

/** Accept only same-site relative paths, to avoid acting as an open redirect */
const safeRedirect = (r: string | null) => (r && r.startsWith('/') && !r.startsWith('//') && !r.includes('\\') ? r : '/');

export function DevLoginPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('alice@acme.com');
  const [name, setName] = useState('Alice Chen');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api.devLogin({ email: email.trim(), name: name.trim() }))) {
      location.assign(safeRedirect(params.get('redirect')));
    }
  };

  return (
    <div className="center-page">
      <form className="card card-narrow" onSubmit={submit}>
        <DevTag>Simulation: this is not a real Google sign-in</DevTag>
        <h1>Simulated Google sign-in</h1>
        <p className="hint">Google OAuth is not configured on the backend, so this form stands in for it. Any email address will work.</p>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Display name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <FormError message={action.error} />
        <button className="btn btn-primary btn-block" disabled={action.busy}>{action.busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
