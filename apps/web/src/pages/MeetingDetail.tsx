import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { webRoutes, type DevStatus, type HostEvent, type MeetingDetail, type Participant, type Verification } from '@proveback/contract';
import { api } from '../api/client';
import { subscribeHost, type StreamState } from '../api/events';
import { useAction, useLoad } from '../lib/hooks';
import { botLabel, failureLabel, formatTime, kindLabel, meetingLabel } from '../lib/labels';
import { useWorkspace } from '../components/Layout';
import { Chip, CopyField, DevTag, Empty, ErrorBox, FormError, Loading, StatusBadge } from '../components/ui';

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
  const tone = (r: 'pass' | 'fail' | 'skipped') => (r === 'pass' ? 'good' : r === 'fail' ? 'bad' : 'neutral');
  const word = (r: 'pass' | 'fail' | 'skipped') => (r === 'pass' ? '通過' : r === 'fail' ? '未通過' : '未檢查');
  return (
    <span className="checks">
      <Chip tone={tone(c.ofac)}>制裁名單:{word(c.ofac)}</Chip>
      {c.nationality && (
        <Chip tone={c.nationality.allowed ? 'good' : 'bad'}>
          國籍:{c.nationality.value ?? '不揭露'}{c.nationality.allowed ? '' : '(在排除名單)'}
        </Chip>
      )}
      <Chip tone={c.nameMatch.result === 'match' ? 'good' : c.nameMatch.result === 'mismatch' ? 'warn' : 'neutral'}>
        姓名:{c.nameMatch.result === 'match' ? '相符' : c.nameMatch.result === 'mismatch' ? '不符' : '未比對'}
        {c.nameMatch.score !== null && `(${Math.round(c.nameMatch.score * 100)}%)`}
      </Chip>
      <Chip tone={tone(c.age)}>年齡:{word(c.age)}</Chip>
    </span>
  );
}

function ParticipantRow({ p, mtgId, fakeRecall }: { p: Participant; mtgId: string; fakeRecall: boolean }) {
  const action = useAction();
  const v = p.verification;
  return (
    <li className={`participant ${p.leftAt ? 'is-left' : ''}`}>
      <div className="participant-head">
        <strong>{p.displayName}</strong>
        <Chip>{kindLabel[p.kind]}</Chip>
        {p.kind !== 'bot' && <StatusBadge status={v.status} />}
        {v.returning && <Chip tone="info">曾經驗證過的來賓</Chip>}
        {p.leftAt && <Chip>已離開</Chip>}
        <span className="participant-actions">
          {p.kind === 'guest' && v.status !== 'unverified' && (
            <button className="btn btn-small" disabled={action.busy} onClick={() => action.run(() => api.resetParticipant(mtgId, p.id))}>重設驗證</button>
          )}
          {fakeRecall && !p.leftAt && p.kind !== 'bot' && (
            <button className="btn btn-small btn-ghost" disabled={action.busy} onClick={() => action.run(() => api.devLeave(mtgId, p.id))}>模擬離開</button>
          )}
        </span>
      </div>
      <div className="participant-detail">
        {p.kind === 'member' && <span className="muted">workspace 成員,以 Google 帳號辨識,不需要護照驗證。</span>}
        {p.kind === 'guest' && v.status === 'unverified' && <span className="muted">還沒有開始驗證。</span>}
        {p.kind === 'guest' && v.status === 'pending' && <span className="muted">來賓正在用 Self 掃描護照。</span>}
        {v.failureReason && <span className="fail-reason">原因:{failureLabel[v.failureReason]}</span>}
        {v.verifiedAt && p.kind === 'guest' && <span className="muted">驗證於 {formatTime(v.verifiedAt)}</span>}
        <Checks v={v} />
      </div>
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
      <DevTag>模擬:後端沒有接 Recall.ai</DevTag>
      <h2>模擬參與者加入</h2>
      <p className="hint">假裝有人進入 Google Meet。填了 workspace 成員的 Email 就會被當成成員,否則是來賓。</p>
      <form className="inline-form" onSubmit={submit}>
        <input required placeholder="顯示名稱" aria-label="顯示名稱" value={displayName} onChange={(e) => setName(e.target.value)} />
        <input type="email" placeholder="Email(選填)" aria-label="Email(選填)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn" disabled={action.busy}>加入</button>
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

  // 先用 REST 確認會議存在(才能分辨 404),再接 SSE;SSE 的 snapshot 會覆蓋成最新狀態
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
      <p className="crumb"><Link to={webRoutes.meetings(workspace.id)}>← 會議列表</Link></p>
      <div className="page-head">
        <div>
          <h1>{meeting.title}</h1>
          <p className="muted"><a href={meeting.meetUrl} target="_blank" rel="noreferrer">{meeting.meetUrl}</a></p>
        </div>
        <div className="head-chips">
          <Chip tone={meeting.status === 'live' ? 'good' : 'neutral'}>{meetingLabel[meeting.status]}</Chip>
          <Chip tone={stream === 'open' ? 'good' : 'warn'}>{stream === 'open' ? '即時更新中' : '重新連線中…'}</Chip>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>Bot</h2>
            <p className="bot-state">
              <Chip tone={meeting.botStatus === 'in_meeting' ? 'good' : meeting.botStatus === 'error' ? 'bad' : meeting.botStatus === 'idle' || meeting.botStatus === 'left' ? 'neutral' : 'warn'}>
                {botLabel[meeting.botStatus]}
              </Chip>
            </p>
            {meeting.botStatus === 'waiting_room' && <p className="hint">請在 Google Meet 裡按「允許」讓 bot 進入。</p>}
            {botActive ? (
              <button className="btn" disabled={bot.busy} onClick={() => onBot(() => api.recallBot(meeting.id))}>收回 bot</button>
            ) : (
              <button className="btn btn-primary" disabled={bot.busy} onClick={() => onBot(() => api.sendBot(meeting.id))}>派出 bot</button>
            )}
            <FormError message={bot.error} />
          </section>

          <section className="card">
            <h2>連結</h2>
            <CopyField label="來賓驗證頁(bot 畫面上的 QR 也指向這裡)" value={location.origin + webRoutes.join(meeting.joinToken)} />
            <CopyField label="Bot 畫面頁" value={location.origin + webRoutes.botScreen(meeting.joinToken)} />
          </section>

          {dev?.fake.recall && <DevJoinPanel mtgId={meeting.id} />}
        </div>

        <section className="card">
          <div className="card-head">
            <h2>參與者</h2>
            <span className="muted">來賓已驗證 {verified} / {guests.length}</span>
          </div>
          {present.length === 0 && <Empty>目前沒有人在會議中。派出 bot 後,參與者會即時出現在這裡。</Empty>}
          <ul className="participants">
            {present.map((p) => <ParticipantRow key={p.id} p={p} mtgId={meeting.id} fakeRecall={!!dev?.fake.recall} />)}
          </ul>
          {left.length > 0 && (
            <>
              <h3>已離開</h3>
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
