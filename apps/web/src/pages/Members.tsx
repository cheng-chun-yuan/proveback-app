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
      <h1>成員</h1>
      <p className="lead">
        {workspace.name}
        {workspace.domain ? `(${workspace.domain})` : ''}的成員以 Google 帳號辨識,進會議時不需要護照驗證。
      </p>
      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>邀請成員</h2>
            <form onSubmit={submitInvite}>
              <label className="field">
                <span className="field-label">Email</span>
                <input required type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">角色</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                </select>
              </label>
              <FormError message={invite.error} />
              <button className="btn btn-primary" disabled={invite.busy}>{invite.busy ? '邀請中…' : '邀請'}</button>
            </form>
          </section>

          <section className="card">
            <h2>建立公司 workspace</h2>
            <p className="hint">公司 workspace 可以設定網域,方便之後管理同公司的成員。</p>
            <form onSubmit={submitWorkspace}>
              <label className="field">
                <span className="field-label">名稱</span>
                <input required value={wsName} placeholder="例:ACME" onChange={(e) => setWsName(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">網域(選填)</span>
                <input value={domain} placeholder="acme.com" pattern="[A-Za-z0-9.\-]+\.[A-Za-z]{2,}" onChange={(e) => setDomain(e.target.value)} />
              </label>
              <FormError message={create.error} />
              <button className="btn" disabled={create.busy}>{create.busy ? '建立中…' : '建立'}</button>
            </form>
          </section>
        </div>

        <section className="card">
          <h2>成員列表</h2>
          {members.loading && !members.data && <Loading />}
          {members.error && <ErrorBox message={members.error} onRetry={members.reload} />}
          {members.data?.items.length === 0 && <Empty>還沒有成員。</Empty>}
          <FormError message={change.error} />
          <ul className="rows">
            {members.data?.items.map((m) => (
              <li key={m.userId} className="row-block">
                <div className="row-main">
                  <strong>
                    {m.name} {m.userId === me.user.id && <Chip>你</Chip>} {m.status === 'invited' && <Chip tone="warn">已邀請,尚未登入</Chip>}
                  </strong>
                  <span className="muted">{m.email}</span>
                </div>
                <div className="actions">
                  <select
                    aria-label={`${m.email} 的角色`}
                    value={m.role}
                    disabled={change.busy}
                    onChange={(e) => change.run(async () => { await api.updateMember(workspace.id, m.userId, { role: e.target.value as Role }); members.reload(); })}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                  </select>
                  <button
                    className="btn btn-small btn-danger"
                    disabled={change.busy}
                    onClick={() => confirm(`確定把 ${m.email} 移出 workspace?`) && change.run(async () => { await api.removeMember(workspace.id, m.userId); members.reload(); })}
                  >
                    移除
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
