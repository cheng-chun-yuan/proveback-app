import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { webRoutes } from '@proveback/contract';
import { api } from '../api/client';
import { useAction, useLoad } from '../lib/hooks';
import { botLabel, formatTime, meetingLabel } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, Empty, ErrorBox, FormError, Loading } from '../components/ui';

export function MeetingsPage() {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const meetings = useLoad(() => api.meetings(workspace.id), [workspace.id]);
  const policies = useLoad(() => api.policies(workspace.id), [workspace.id]);
  const [title, setTitle] = useState('');
  const [meetUrl, setMeetUrl] = useState('');
  const [policyId, setPolicyId] = useState('');
  const action = useAction();

  useEffect(() => {
    const items = policies.data?.items;
    if (items && !items.some((p) => p.id === policyId)) setPolicyId((items.find((p) => p.isDefault) ?? items[0])?.id ?? '');
  }, [policies.data, policyId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    await action.run(async () => {
      const m = await api.createMeeting(workspace.id, { title: title.trim(), meetUrl: meetUrl.trim(), policyId });
      navigate(webRoutes.meeting(workspace.id, m.id));
    });
  };

  const policyName = (id: string) => policies.data?.items.find((p) => p.id === id)?.name ?? '—';
  const sorted = [...(meetings.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="page">
      <h1>Meetings</h1>
      <div className="split">
        <section className="card">
          <h2>Create meeting</h2>
          {policies.error && <ErrorBox message={policies.error} onRetry={policies.reload} />}
          {policies.data && policies.data.items.length === 0 ? (
            <Empty>
              There are no policies yet. Create one on the <Link to={webRoutes.policies(workspace.id)}>Policies</Link> page first.
            </Empty>
          ) : (
            <form onSubmit={create}>
              <label className="field">
                <span className="field-label">Meeting title</span>
                <input required value={title} placeholder="e.g. Partner quarterly review" onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Google Meet link</span>
                <input required type="url" value={meetUrl} placeholder="https://meet.google.com/abc-defg-hij" onChange={(e) => setMeetUrl(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">Policy</span>
                <select required value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
                  {policies.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>
                  ))}
                </select>
              </label>
              <FormError message={action.error} />
              <button className="btn btn-primary" disabled={action.busy || !policyId}>{action.busy ? 'Creating…' : 'Create meeting'}</button>
            </form>
          )}
        </section>

        <section className="card">
          <h2>Meeting list</h2>
          {meetings.loading && !meetings.data && <Loading />}
          {meetings.error && <ErrorBox message={meetings.error} onRetry={meetings.reload} />}
          {meetings.data && sorted.length === 0 && <Empty>No meetings yet. Create your first one using the form on the left.</Empty>}
          <ul className="rows">
            {sorted.map((m) => (
              <li key={m.id}>
                <Link className="row-link" to={webRoutes.meeting(workspace.id, m.id)}>
                  <span className="row-main">
                    <strong>{m.title}</strong>
                    <span className="muted">{policyName(m.policyId)} · Created {formatTime(m.createdAt)}</span>
                  </span>
                  <span className="row-side">
                    <Chip tone={m.status === 'live' ? 'good' : 'neutral'}>{meetingLabel[m.status]}</Chip>
                    <Chip tone={m.botStatus === 'in_meeting' ? 'info' : m.botStatus === 'error' ? 'bad' : 'neutral'}>Bot:{botLabel[m.botStatus]}</Chip>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
