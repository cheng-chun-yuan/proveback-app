import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { webRoutes, type PublicParticipant } from '@proveback/contract';
import { usePublicMeeting } from '../lib/usePublicMeeting';
import { Qr } from '../components/ui';

// Recall 會把這一頁轉成 1280×720、15fps 的視訊當作 bot 的鏡頭畫面。
// 所以:固定 16:9、字很大、高對比、不捲動、不靠動畫或 hover 傳達資訊。
const W = 1280;
const H = 720;
const MAX_ROWS = 8;

const mark = { verified: '✓', pending: '…', failed: '✕', unverified: '○' } as const;
const word = { verified: '已驗證', pending: '驗證中', failed: '未通過', unverified: '未驗證' } as const;
const order = { pending: 0, unverified: 1, failed: 2, verified: 3 } as const;

function useScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(innerWidth / W, innerHeight / H));
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return scale;
}

export function BotScreenPage() {
  const { joinToken = '' } = useParams();
  const meeting = usePublicMeeting(joinToken);
  const scale = useScale();

  const people = (meeting.data?.participants ?? []).filter((p) => p.kind !== 'bot');
  const guests = people.filter((p) => p.kind === 'guest');
  const verified = guests.filter((p) => p.status === 'verified').length;
  // 人多時,還沒驗證的排前面,確保需要行動的人看得到自己
  const sorted: PublicParticipant[] = people.length > MAX_ROWS ? [...people].sort((a, b) => order[a.status] - order[b.status]) : people;
  const shown = sorted.slice(0, people.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS);
  const hidden = sorted.slice(shown.length);

  return (
    <div className="bot-viewport">
      <div className="bot-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {meeting.error ? (
          <div className="bot-message">無法載入會議:{meeting.error}</div>
        ) : !meeting.data ? (
          <div className="bot-message">載入中…</div>
        ) : meeting.ended ? (
          <div className="bot-message">會議已結束</div>
        ) : (
          <>
            <section className="bot-left">
              <div className="bot-qr"><Qr text={location.origin + webRoutes.join(joinToken)} size={400} /></div>
              <p className="bot-instruction">來賓請用手機掃描,以護照驗證身分</p>
            </section>
            <section className="bot-right">
              <header>
                <p className="bot-brand">ProveBack · {meeting.data.workspaceName}</p>
                <h1>{meeting.data.title}</h1>
                <p className="bot-count">來賓已驗證 <strong>{verified}</strong> / {guests.length}</p>
              </header>
              {people.length === 0 ? (
                <p className="bot-empty">等待參與者加入…</p>
              ) : (
                <ul className="bot-list">
                  {shown.map((p) => (
                    <li key={p.id} className={`bot-row bot-${p.status}`}>
                      <span className="bot-mark" aria-hidden>{mark[p.status]}</span>
                      <span className="bot-name">{p.displayName}</span>
                      <span className="bot-status">{p.kind === 'member' ? '成員' : word[p.status]}</span>
                    </li>
                  ))}
                  {hidden.length > 0 && (
                    <li className="bot-row bot-more">
                      另有 {hidden.length} 位,其中 {hidden.filter((p) => p.status === 'verified').length} 位已驗證
                    </li>
                  )}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
