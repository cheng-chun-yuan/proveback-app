import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { PublicMeeting, VerifySession } from '@proveback/contract';
import { api, errorMessage } from '../api/client';
import { useAction } from '../lib/hooks';
import { failureLabel } from '../lib/labels';
import { usePublicMeeting } from '../lib/usePublicMeeting';
import { ErrorBox, FormError, Loading, Qr, StatusBadge } from '../components/ui';

type Step = 'pick' | 'consent' | 'verify' | 'result';

const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && innerWidth < 820;

function Disclosures({ d }: { d: PublicMeeting['disclosures'] }) {
  return (
    <>
      <ul className="disclosures">
        {d.ofac && <li>確認你不在制裁名單上。主辦方只會看到「通過」或「未通過」。</li>}
        {d.excludedCountries.length > 0 && <li>確認你的國籍不在排除名單內({d.excludedCountries.join('、')})。</li>}
        <li>{d.nationality ? '你的國籍會顯示給主辦方。' : '主辦方不會看到你的國籍。'}</li>
        {d.nameMatch && <li>護照上的姓名會與你在會議中的顯示名稱比對。比對完就丟棄,不會保存姓名。</li>}
        {d.minimumAge !== null && <li>確認你年滿 {d.minimumAge} 歲。不會揭露生日。</li>}
        <li>會記住這本護照的匿名代碼,下次參加同一個主辦方的會議時能認出是同一人。</li>
      </ul>
      <p className="hint">不會揭露也不會保存:護照號碼、生日、照片、完整姓名。會議中其他人只會看到你「已驗證」。</p>
    </>
  );
}

export function JoinPage() {
  const { joinToken = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const meeting = usePublicMeeting(joinToken);
  const storageKey = `pb-join:${joinToken}`;
  const [step, setStep] = useState<Step>('pick');
  const [pid, setPid] = useState<string | null>(null);
  const [session, setSession] = useState<VerifySession | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(true);
  const create = useAction();

  const adopt = useCallback((s: VerifySession) => {
    setSession(s);
    setPid(s.participantId);
    setStep(s.status === 'pending' ? 'verify' : 'result');
  }, []);

  // 從 Self 回來(?session=)或重新整理時,接回進行中的 session
  useEffect(() => {
    const id = params.get('session') ?? sessionStorage.getItem(storageKey);
    if (!id) {
      setResuming(false);
      return;
    }
    let stale = false;
    api.publicSession(id).then(
      (s) => !stale && adopt(s),
      () => sessionStorage.removeItem(storageKey),
    ).finally(() => !stale && setResuming(false));
    return () => {
      stale = true;
    };
    // 只在進入頁面時執行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinToken]);

  // 等待結果:每 2 秒查一次 session
  const pending = session?.status === 'pending' ? session.id : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      api.publicSession(pending).then(
        (s) => {
          setPollError(null);
          if (s.status !== 'pending') adopt(s);
        },
        (e) => setPollError(errorMessage(e)),
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [pending, adopt]);

  const start = () =>
    create.run(async () => {
      if (!pid) return;
      const s = await api.createSession(joinToken, { participantId: pid });
      sessionStorage.setItem(storageKey, s.id);
      adopt(s);
    });

  const retry = () => {
    sessionStorage.removeItem(storageKey);
    if (params.has('session')) setParams({}, { replace: true });
    setSession(null);
    create.clearError();
    setStep(pid ? 'consent' : 'pick');
  };

  if (meeting.error) return <div className="center-page"><div className="card card-narrow"><ErrorBox message={meeting.error} onRetry={meeting.reload} /></div></div>;
  if (!meeting.data || resuming) return <div className="center-page"><Loading /></div>;

  const m = meeting.data;
  const guests = m.participants.filter((p) => p.kind === 'guest');
  const who = m.participants.find((p) => p.id === pid);

  return (
    <div className="center-page join">
      <div className="card card-narrow">
        <p className="eyebrow">{m.workspaceName} · 會議身分驗證</p>
        <h1>{m.title}</h1>

        {step === 'pick' && (
          <>
            <h2>你是哪一位參與者?</h2>
            {guests.length === 0 ? (
              <p className="hint">目前沒有需要驗證的來賓。請先加入 Google Meet 會議,你的名字出現後這裡會自動更新。</p>
            ) : (
              <ul className="pick-list">
                {guests.map((p) => (
                  <li key={p.id}>
                    <button
                      className={`pick ${pid === p.id ? 'is-selected' : ''}`}
                      disabled={p.status === 'verified'}
                      onClick={() => setPid(p.id)}
                      aria-pressed={pid === p.id}
                    >
                      <span>{p.displayName}</span>
                      <StatusBadge status={p.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary btn-block" disabled={!pid || who?.status === 'verified'} onClick={() => setStep('consent')}>下一步</button>
            <p className="hint">請選你在會議中顯示的名字。選錯人會讓別人的驗證狀態出錯。</p>
          </>
        )}

        {step === 'consent' && (
          <>
            <h2>驗證前請確認</h2>
            <p>你將以「<strong>{who?.displayName ?? '這位參與者'}</strong>」的身分,用 Self app 掃描護照。這場會議要求:</p>
            <Disclosures d={m.disclosures} />
            <FormError message={create.error} />
            <button className="btn btn-primary btn-block" disabled={create.busy} onClick={start}>{create.busy ? '準備中…' : '同意並開始驗證'}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setStep('pick')}>我不是這位參與者</button>
          </>
        )}

        {step === 'verify' && session && (
          <>
            <h2>用 Self 掃描護照</h2>
            {/* 契約的 selfApp 目前固定為 null(後端用 Self 託管 SDK),所以只用 universalLink。
                之後若後端開始回傳 selfApp,在這裡把它原封交給 Self 的 QR 元件即可。 */}
            {isPhone() ? (
              <>
                <a className="btn btn-primary btn-block" href={session.universalLink} target="_blank" rel="noreferrer">開啟 Self app</a>
                <p className="hint">完成後回到這個頁面,結果會自動顯示。</p>
              </>
            ) : (
              <>
                <p>用手機掃這個 QR code 開啟 Self app,依指示掃描護照。</p>
                <div className="qr-box"><Qr text={session.universalLink} size={240} /></div>
                <p className="hint">或是<a href={session.universalLink} target="_blank" rel="noreferrer">在這台裝置上開啟</a>。</p>
              </>
            )}
            <div className="waiting" role="status">等待驗證結果…(連結 5 分鐘內有效)</div>
            <FormError message={pollError} />
            <button className="btn btn-ghost btn-block" onClick={retry}>取消,重新開始</button>
          </>
        )}

        {step === 'result' && session && (
          session.status === 'verified' ? (
            <div className="result result-good">
              <strong>驗證完成</strong>
              <span>{who ? `「${who.displayName}」` : '你'}在會議中已顯示為已驗證,可以關閉這個頁面。</span>
            </div>
          ) : (
            <>
              <div className="result result-bad">
                <strong>{session.status === 'expired' ? '驗證已逾時' : '驗證未通過'}</strong>
                <span>{session.failureReason ? failureLabel[session.failureReason] : '沒有在時限內完成驗證。'}</span>
              </div>
              <button className="btn btn-primary btn-block" onClick={retry}>重新驗證</button>
            </>
          )
        )}
      </div>
    </div>
  );
}
