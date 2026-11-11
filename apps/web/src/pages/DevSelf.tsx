import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { VerifySession } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { failureLabel } from '../lib/labels';
import { DevTag, ErrorBox, FormError, Loading } from '../components/ui';

export function DevSelfPage() {
  const { sessionId = '' } = useParams();
  const session = useLoad(() => api.publicSession(sessionId), [sessionId]);
  const [result, setResult] = useState<VerifySession | null>(null);
  const [form, setForm] = useState({ passportId: 'P-0001', name: '', nationality: 'TWN', ofacClear: true, age: '30' });
  const action = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await action.run(async () => {
      setResult(
        await api.devCompleteSession(sessionId, {
          passportId: form.passportId.trim(),
          name: form.name.trim(),
          nationality: form.nationality.trim().toUpperCase(),
          ofacClear: form.ofacClear,
          age: Number(form.age),
        }),
      );
    });
  };

  const done = result ?? (session.data && session.data.status !== 'pending' ? session.data : null);

  return (
    <div className="center-page">
      <div className="card card-narrow">
        <DevTag>Simulation: this is not the real Self app</DevTag>
        <h1>Simulated Self app</h1>
        {session.loading && <Loading />}
        {session.error && <ErrorBox message={session.error} onRetry={session.reload} />}
        {done && (
          <div className={`result ${done.status === 'verified' ? 'result-good' : 'result-bad'}`}>
            <strong>{done.status === 'verified' ? 'Proof submitted. Verified' : done.status === 'expired' ? 'This verification link has expired' : 'Proof submitted. Not verified'}</strong>
            {done.failureReason && <span>{failureLabel[done.failureReason]}</span>}
            <span className="hint">You can close this tab and return to the verification page to see the result.</span>
          </div>
        )}
        {session.data && !done && (
          <form onSubmit={submit}>
            <p className="hint">Self is not configured on the backend, so this form simulates submitting a passport proof. The same passport number means the same passport.</p>
            <label className="field">
              <span className="field-label">Passport number (only used to tell whether it is the same passport)</span>
              <input required value={form.passportId} onChange={(e) => set('passportId', e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Name on passport</span>
              <input required value={form.name} placeholder="e.g. WANG ZOE" onChange={(e) => set('name', e.target.value)} />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Nationality (3 letters)</span>
                <input required pattern="[A-Za-z]{3}" maxLength={3} value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Age</span>
                <input required type="number" min={0} max={120} value={form.age} onChange={(e) => set('age', e.target.value)} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={form.ofacClear} onChange={(e) => set('ofacClear', e.target.checked)} />
              Not on a sanctions list (OFAC check passed)
            </label>
            <FormError message={action.error} />
            <button className="btn btn-primary btn-block" disabled={action.busy}>{action.busy ? 'Submitting…' : 'Submit proof'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
