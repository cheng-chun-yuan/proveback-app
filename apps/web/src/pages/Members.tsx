import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { webRoutes, type Role } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { roleLabel } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, Empty, ErrorBox, FormError, Loading } from '../components/ui';

const ROLES: Role[] = ['owner', 'admin', 'member'];

export function MembersPage() {
  const { workspace, me, reloadMe } = useWorkspace();
  const navigate = useNavigate();
  const members = useLoad(() => api.members(workspace.id), [workspace.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [wsName, setWsName] = useState('');
  const [domain, setDomain] = useState('');
  const invite = useAction();
  const change = useAction();
  const create = useAction();

  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (await invite.run(() => api.addMember(workspace.id, { email: email.trim(), role }))) {
      setEmail('');
      members.reload();
    }
  };
  const submitWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    await create.run(async () => {
      const ws = await api.createWorkspace({ name: wsName.trim(), type: 'company', ...(domain.trim() ? { domain: domain.trim().toLowerCase() } : {}) });
      reloadMe();
      navigate(webRoutes.members(ws.id));
    });
  };

  return (
    <div className="page">
      <h1>Members</h1>
      <p className="lead">
        {workspace.name}
        Members{workspace.domain ? ` (${workspace.domain})` : ''} are identified by their Google account and do not need passport verification to join a meeting.
      </p>
      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>Invite member</h2>
            <form onSubmit={submitInvite}>
              <label className="field">
                <span className="field-label">Email</span>
                <input required type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </label>
              <FormError message={invite.error} />
              <button className="btn btn-primary" disabled={invite.busy}>{invite.busy ? 'Inviting…' : 'Invite member'}</button>
            </form>
          </section>

          <section className="card">
            <h2>Create company workspace</h2>
            <p className="hint">A company workspace can have a domain, which makes it easier to manage members from the same company.</p>
            <form onSubmit={submitWorkspace}>
              <label className="field">
                <span className="field-label">Name</span>
                <input required value={wsName} placeholder="e.g. ACME" onChange={(e) => setWsName(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Domain (optional)</span>
                <input value={domain} placeholder="acme.com" pattern="[A-Za-z0-9.\-]+\.[A-Za-z]{2,}" onChange={(e) => setDomain(e.target.value)} />
              </label>
              <FormError message={create.error} />
              <button className="btn" disabled={create.busy}>{create.busy ? 'Creating…' : 'Create workspace'}</button>
            </form>
          </section>
        </div>

        <section className="card">
          <h2>Member list</h2>
          {members.loading && !members.data && <Loading />}
          {members.error && <ErrorBox message={members.error} onRetry={members.reload} />}
          {members.data?.items.length === 0 && <Empty>No members yet.</Empty>}
          <FormError message={change.error} />
          <ul className="rows">
            {members.data?.items.map((m) => (
              <li key={m.userId} className="row-block">
                <div className="row-main">
                  <strong>
                    {m.name} {m.userId === me.user.id && <Chip>You</Chip>} {m.status === 'invited' && <Chip>Invited, not signed in yet</Chip>}
                  </strong>
                  <span className="muted">{m.email}</span>
                </div>
                <div className="actions">
                  <select
                    aria-label={`Role for ${m.email}`}
                    value={m.role}
                    disabled={change.busy}
                    onChange={(e) => change.run(async () => { await api.updateMember(workspace.id, m.userId, { role: e.target.value as Role }); members.reload(); })}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                  <button
                    className="btn btn-small btn-danger"
                    disabled={change.busy}
                    onClick={() => confirm(`Remove ${m.email} from this workspace?`) && change.run(async () => { await api.removeMember(workspace.id, m.userId); members.reload(); })}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
