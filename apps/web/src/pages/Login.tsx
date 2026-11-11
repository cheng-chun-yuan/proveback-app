import { useNavigate } from 'react-router-dom';
import { webRoutes } from '@proveback/contract';
import { api } from '../api/client';
import { MOCK } from '../api/events';

export function LoginPage() {
  const navigate = useNavigate();
  const start = () => {
    // Mock mode has no backend to redirect, so go straight to the simulated sign-in page; otherwise let the backend decide (real Google or simulated sign-in)
    if (MOCK) navigate(`${webRoutes.devLogin}?redirect=${encodeURIComponent('/')}`);
    else location.assign(api.googleStartUrl('/'));
  };
  return (
    <div className="center-page">
      <div className="card card-narrow login-card">
        <h1 className="brand brand-large">ProveBack</h1>
        <p className="lead">Guest verification for Google Meet. Outside guests prove who they are with a passport and reveal only what you ask for.</p>
        <button className="btn btn-primary btn-block" onClick={start}>Sign in with Google</button>
        <p className="hint">We create a personal workspace for you when you first sign in.</p>
      </div>
    </div>
  );
}
