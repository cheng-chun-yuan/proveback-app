import { useState, type FormEvent } from 'react';
import type { CreatePolicyBody, Policy } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { parseCountries } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, Empty, ErrorBox, FormError, Loading } from '../components/ui';

const blank: CreatePolicyBody = {
  name: '', isDefault: false, requireOfacClear: true, excludedCountries: [], discloseNationality: true, nameMatch: 'warn', minimumAge: null,
};

function PolicyForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial: CreatePolicyBody;
  submitLabel: string;
  onSubmit: (body: CreatePolicyBody) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [countries, setCountries] = useState(initial.excludedCountries.join(', '));
  const [age, setAge] = useState(initial.minimumAge === null ? '' : String(initial.minimumAge));
  const action = useAction();
  const parsed = parseCountries(countries);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsed.invalid.length) return;
    const ok = await action.run(() => onSubmit({ ...f, name: f.name.trim(), excludedCountries: parsed.codes, minimumAge: age === '' ? null : Number(age) }));
    if (ok && !onCancel) {
      setF(blank);
      setCountries('');
      setAge('');
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span className="field-label">Policy name</span>
        <input required value={f.name} placeholder="e.g. Standard external meeting" onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.requireOfacClear} onChange={(e) => setF({ ...f, requireOfacClear: e.target.checked })} />
        Require guests not to be on a sanctions list (OFAC)
      </label>
      <label className="field">
        <span className="field-label">Excluded countries</span>
        <input value={countries} placeholder="PRK, IRN" onChange={(e) => setCountries(e.target.value)} />
        <span className="field-hint">Three-letter ISO codes, separated by commas.</span>
        {parsed.invalid.length > 0 && <span className="form-error">Not a 3-letter country code: {parsed.invalid.join(', ')}</span>}
      </label>
      <label className="check">
        <input type="checkbox" checked={f.discloseNationality} onChange={(e) => setF({ ...f, discloseNationality: e.target.checked })} />
        Show the guest's nationality to the host (when off, the host only learns whether the guest is in an excluded country)
      </label>
      <label className="field">
        <span className="field-label">Passport name vs. name in the call</span>
        <select value={f.nameMatch} onChange={(e) => setF({ ...f, nameMatch: e.target.value as Policy['nameMatch'] })}>
          <option value="off">Do not compare</option>
          <option value="warn">Compare; warn on mismatch</option>
          <option value="require">Compare; fail verification on mismatch</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Minimum age (optional)</span>
        <input type="number" min={0} max={120} value={age} placeholder="e.g. 18" onChange={(e) => setAge(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} />
        Make this the default policy
      </label>
      <FormError message={action.error} />
      <div className="actions">
        <button className="btn btn-primary" disabled={action.busy || parsed.invalid.length > 0}>{action.busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

const nameMatchWord = { off: 'not compared', warn: 'warn on mismatch', require: 'must match' } as const;

export function PoliciesPage() {
  const { workspace } = useWorkspace();
  const policies = useLoad(() => api.policies(workspace.id), [workspace.id]);
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useAction();

  const toBody = ({ id: _id, workspaceId: _ws, ...rest }: Policy): CreatePolicyBody => rest;

  return (
    <div className="page">
      <h1>Policies</h1>
      <p className="lead">A policy decides what guests must prove and what the host can see. Guests see everything that will be disclosed before they verify.</p>
      <div className="split">
        <section className="card">
          <h2>Create policy</h2>
          <PolicyForm initial={blank} submitLabel="Create policy" onSubmit={async (b) => { await api.createPolicy(workspace.id, b); policies.reload(); }} />
        </section>

        <section className="card">
          <h2>Existing policies</h2>
          {policies.loading && !policies.data && <Loading />}
          {policies.error && <ErrorBox message={policies.error} onRetry={policies.reload} />}
          {policies.data?.items.length === 0 && <Empty>No policies yet.</Empty>}
          <FormError message={remove.error} />
          <ul className="rows">
            {policies.data?.items.map((p) => (
              <li key={p.id} className="row-block">
                {editing === p.id ? (
                  <PolicyForm
                    initial={toBody(p)}
                    submitLabel="Save"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (b) => { await api.updatePolicy(p.id, b); setEditing(null); policies.reload(); }}
                  />
                ) : (
                  <>
                    <div className="row-main">
                      <strong>{p.name} {p.isDefault && <Chip tone="info">Default</Chip>}</strong>
                      <span className="checks">
                        <Chip>{p.requireOfacClear ? 'Sanctions list checked' : 'Sanctions list not checked'}</Chip>
                        <Chip>{p.excludedCountries.length ? `Excluded countries: ${p.excludedCountries.join(', ')}` : 'No excluded countries'}</Chip>
                        <Chip>{p.discloseNationality ? 'Nationality shown' : 'Nationality hidden'}</Chip>
                        <Chip>Name: {nameMatchWord[p.nameMatch]}</Chip>
                        <Chip>{p.minimumAge === null ? 'No age check' : `Minimum age ${p.minimumAge}`}</Chip>
                      </span>
                    </div>
                    <div className="actions">
                      <button className="btn btn-small" onClick={() => setEditing(p.id)}>Edit</button>
                      <button
                        className="btn btn-small btn-danger"
                        disabled={remove.busy}
                        onClick={() => confirm(`Delete the policy "${p.name}"? This cannot be undone.`) && remove.run(async () => { await api.deletePolicy(p.id); policies.reload(); })}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
