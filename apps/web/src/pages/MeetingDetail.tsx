import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { webRoutes, type DevStatus, type HostEvent, type MeetingDetail, type Participant, type Verification } from '@proveback/contract';
import { api } from '../api/client';
import { subscribeHost, type StreamState } from '../api/events';
import { useAction, useLoad } from '../lib/hooks';
import { boardTone, boardWord, botLabel, botTone, failureLabel, formatTime, kindLabel, meetingLabel } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Flap } from '../components/Flap';
import { BoardRow } from '../components/BoardRow';
import { CopyField, Empty, ErrorBox, FormError, Loading } from '../components/ui';

function applyEvent(prev: MeetingDetail, e: HostEvent): MeetingDetail {
  switch (e.type) {
    case 'snapshot':
      return e.data;
    case 'meeting.updated':
      return { ...prev, meeting: e.data };
    case 'participant.joined':
      return prev.participants.some((p) => p.id === e.data.id)
        ? { ...prev, participants: prev.participants.map((p) => (p.id === e.data.id ? e.data : p)) }
        : { ...prev, participants: [...prev.participants, e.data] };
    case 'participant.left':
      return { ...prev, participants: prev.participants.map((p) => (p.id === e.data.participantId ? { ...p, leftAt: p.leftAt ?? e.at } : p)) };
    case 'verification.updated':
      return { ...prev, participants: prev.participants.map((p) => (p.id === e.data.participantId ? { ...p, verification: e.data.verification } : p)) };
  }
}

function Checks({ v }: { v: Verification }) {
  const c = v.checks;
  if (!c) return null;
  const word = (r: 'pass' | 'fail' | 'skipped') => (r === 'pass' ? 'Pass' : r === 'fail' ? 'Fail' : 'Not checked');
  const cls = (r: 'pass' | 'fail' | 'skipped') => (r === 'fail' ? 'is-bad' : r === 'skipped' ? 'is-skipped' : '');
  return (
    <dl className="checks">
      <div className={cls(c.ofac)}><dt>Sanctions</dt><dd>{word(c.ofac)}</dd></div>
      {c.nationality && (
        <div className={c.nationality.allowed ? '' : 'is-bad'}>
          <dt>Nationality</dt>
          <dd>{c.nationality.value ?? 'Not disclosed'}{c.nationality.allowed ? '' : ' (excluded)'}</dd>
        </div>
      )}
      <div className={c.nameMatch.result === 'mismatch' ? 'is-bad' : c.nameMatch.result === 'skipped' ? 'is-skipped' : ''}>
        <dt>Name</dt>
        <dd>
          {c.nameMatch.result === 'match' ? 'Match' : c.nameMatch.result === 'mismatch' ? 'Mismatch' : 'Not compared'}
          {c.nameMatch.score !== null && ` ${Math.round(c.nameMatch.score * 100)}%`}
        </dd>
      </div>
      <div className={cls(c.age)}><dt>Age</dt><dd>{word(c.age)}</dd></div>
    </dl>
  );
}

function ParticipantRow({ p, mtgId, fakeRecall }: { p: Participant; mtgId: string; fakeRecall: boolean }) {
  const action = useAction();
  const v = p.verification;
  const canReset = p.kind === 'guest' && v.status !== 'unverified';
  const canLeave = fakeRecall && !p.leftAt && p.kind !== 'bot';
  // The pill already says Member or Bot, so the line beneath only names the kind for guests.
  const meta = [
    p.kind === 'guest' ? kindLabel[p.kind] : null,
    v.returning ? 'Returning' : null,
    p.leftAt ? 'Left' : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className={`participant ${p.leftAt ? 'is-left' : ''}`}>
      <BoardRow
        size="md"
        name={p.displayName}
        status={p.kind === 'guest' ? boardWord[v.status] : p.kind === 'member' ? 'MEMBER' : 'BOT'}
        tone={p.kind === 'guest' ? boardTone[v.status] : p.kind === 'member' ? 'paint' : 'dim'}
        lamp={p.kind === 'guest' ? boardTone[v.status] : p.kind === 'member' ? 'ok' : 'off'}
      />
      <div className="participant-detail">
        {meta && <span className="kind">{meta}</span>}
        {p.kind === 'member' && <span className="muted">Workspace member, recognised by Google account. No passport check needed.</span>}
        {p.kind === 'bot' && <span className="muted">Shows the QR code and the board as its camera.</span>}
        {p.kind === 'guest' && v.status === 'unverified' && <span className="muted">Has not started verifying.</span>}
        {p.kind === 'guest' && v.status === 'pending' && <span className="muted">Scanning their passport in Self now.</span>}
        {v.failureReason && <span className="fail-reason">{failureLabel[v.failureReason]}</span>}
        {v.verifiedAt && p.kind === 'guest' && <span className="muted">Verified {formatTime(v.verifiedAt)}</span>}
        <Checks v={v} />
      </div>
      {(canReset || canLeave) && (
        <div className="participant-actions">
          {canReset && (
            <button className="btn btn-small" disabled={action.busy} onClick={() => action.run(() => api.resetParticipant(mtgId, p.id))}>Reset verification</button>
          )}
          {canLeave && (
            <button className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => action.run(() => api.devLeave(mtgId, p.id))}>Simulate leaving</button>
          )}
        </div>
      )}
      <FormError message={action.error} />
    </li>
  );
}

function DevJoinPanel({ mtgId }: { mtgId: string }) {
  const [displayName, setName] = useState('');
  const [email, setEmail] = useState('');
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await action.run(() => api.devJoin(mtgId, { displayName: displayName.trim(), ...(email.trim() ? { email: email.trim() } : {}) }));
    if (ok) {
      setName('');
      setEmail('');
    }
  };
  return (
    <section className="card dev-card">
      <h2>Simulate someone joining</h2>
      <p className="hint"><strong>Simulation.</strong> The API is not connected to Recall.ai. Pretend someone enters the Google Meet call. With a workspace member's email they join as a member, otherwise as a guest.</p>
      <form className="inline-form" onSubmit={submit}>
        <input required placeholder="Display name" aria-label="Display name" value={displayName} onChange={(e) => setName(e.target.value)} />
        <input type="email" placeholder="Email (optional)" aria-label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" disabled={action.busy}>Join</button>
      </form>
      <FormError message={action.error} />
    </section>
  );
}

export function MeetingDetailPage() {
  const { mtgId = '' } = useParams();
  const { workspace } = useWorkspace();
  const detail = useLoad(() => api.meeting(mtgId), [mtgId]);
  const [stream, setStream] = useState<StreamState>('connecting');
  const [dev, setDev] = useState<DevStatus | null>(null);
  const bot = useAction();
  const { setData } = detail;
  const loaded = detail.data !== null;

  useEffect(() => {
    void api.devStatus().then(setDev);
  }, []);

  // Confirm the meeting exists over REST first (to tell a 404 apart), then follow SSE; its snapshot replaces the state
  useEffect(() => {
    if (!loaded) return;
    return subscribeHost(mtgId, { onEvent: (e) => setData((prev) => applyEvent(prev, e)), onState: setStream });
  }, [mtgId, loaded, setData]);

  if (detail.error) return <ErrorBox message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;

  const { meeting, participants } = detail.data;
  const botActive = ['joining', 'waiting_room', 'in_meeting'].includes(meeting.botStatus);
  const present = participants.filter((p) => !p.leftAt);
  const left = participants.filter((p) => p.leftAt);
  const guests = present.filter((p) => p.kind === 'guest');
  const verified = guests.filter((p) => p.verification.status === 'verified').length;
  const onBot = (fn: () => Promise<unknown>) => bot.run(async () => {
    const m = await fn();
    setData((prev) => ({ ...prev, meeting: m as MeetingDetail['meeting'] }));
  });

  return (
    <div className="page">
      <p className="crumb"><Link to={webRoutes.meetings(workspace.id)}>All meetings</Link></p>
      <div className="page-head">
        <div>
          <h1>{meeting.title}</h1>
          <p className="muted"><a href={meeting.meetUrl} target="_blank" rel="noreferrer">{meeting.meetUrl}</a></p>
        </div>
        <p className="head-state" role="status">
          <span className={`lamp lamp-${stream === 'open' ? 'ok' : 'now'}`} aria-hidden />
          {meetingLabel[meeting.status]}{stream === 'open' ? '' : ' · Reconnecting…'}
        </p>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>Bot</h2>
            <p className="bot-state"><Flap text={botLabel[meeting.botStatus]} cells={12} tone={botTone[meeting.botStatus]} size="sm" /></p>
            {meeting.botStatus === 'waiting_room' && <p className="hint">Admit the bot from inside Google Meet to let it in.</p>}
            {botActive ? (
              <button className="btn" disabled={bot.busy} onClick={() => onBot(() => api.recallBot(meeting.id))}>Recall bot</button>
            ) : (
              <button className="btn btn-primary" disabled={bot.busy} onClick={() => onBot(() => api.sendBot(meeting.id))}>Send bot</button>
            )}
            <FormError message={bot.error} />
          </section>

          <section className="card">
            <h2>Links</h2>
            <CopyField label="Guest page" hint="The QR code on the board points here." value={location.origin + webRoutes.join(meeting.joinToken)} />
            <CopyField label="Board" hint="The bot shows this page as its camera." value={location.origin + webRoutes.botScreen(meeting.joinToken)} />
          </section>

          {dev?.fake.recall && <DevJoinPanel mtgId={meeting.id} />}
        </div>

        <section className="card">
          <div className="card-head">
            <h2>In the call</h2>
            <span className="tally">{verified} / {guests.length} guests verified</span>
          </div>
          {present.length === 0 && <Empty>Nobody is in the call yet. Send the bot and participants appear here as they join.</Empty>}
          <ul className="participants">
            {present.map((p) => <ParticipantRow key={p.id} p={p} mtgId={meeting.id} fakeRecall={!!dev?.fake.recall} />)}
          </ul>
          {left.length > 0 && (
            <>
              <h3>Left the call</h3>
              <ul className="participants">
                {left.map((p) => <ParticipantRow key={p.id} p={p} mtgId={meeting.id} fakeRecall={false} />)}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
