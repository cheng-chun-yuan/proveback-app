import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { webRoutes, type PublicParticipant } from '@proveback/contract';
import { usePublicMeeting } from '../lib/usePublicMeeting';
import { boardTone, boardWord } from '../lib/labels';
import { BoardRow } from '../components/BoardRow';
import { Qr } from '../components/ui';

// Recall streams this page as the bot's camera: 1280x720 at 15 fps, usually seen as a small tile.
// So: fixed 16:9, very large type, high contrast, no scrolling, nothing that depends on hover.
const W = 1280;
const H = 720;
const MAX_ROWS = 8;

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

function Notice({ text }: { text: string }) {
  return (
    <div className="bot-notice">{text.charAt(0) + text.slice(1).toLowerCase()}</div>
  );
}

export function BotScreenPage() {
  const { joinToken = '' } = useParams();
  const meeting = usePublicMeeting(joinToken);
  const scale = useScale();

  const people = (meeting.data?.participants ?? []).filter((p) => p.kind !== 'bot');
  const guests = people.filter((p) => p.kind === 'guest');
  const verified = guests.filter((p) => p.status === 'verified').length;
  // The board holds eight rows. Past that, people who still need to act come first and the last row states the rest.
  const sorted: PublicParticipant[] = people.length > MAX_ROWS ? [...people].sort((a, b) => order[a.status] - order[b.status]) : people;
  const shown = sorted.slice(0, people.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS);
  const hidden = sorted.slice(shown.length);

  return (
    <div className="bot-viewport">
      <div className="bot-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div className="bot-board">
          {meeting.error ? (
            <Notice text="BOARD UNAVAILABLE" />
          ) : !meeting.data ? (
            <Notice text="CONNECTING" />
          ) : meeting.ended ? (
            <Notice text="MEETING ENDED" />
          ) : (
            <>
              <section className="bot-plate">
                <div className="bot-qr"><Qr text={location.origin + webRoutes.join(joinToken)} size={316} /></div>
                <p className="bot-instruction">Scan to verify</p>
                <p className="bot-sub">Only the result is shared.</p>
                <p className="bot-brand">ProveBack</p>
              </section>
              <section className="bot-main">
                <h1>{meeting.data.title}</h1>
                <div className="bot-rule">
                  <span>{meeting.data.workspaceName}</span>
                  <strong>{verified} / {guests.length} verified</strong>
                </div>
                {people.length === 0 ? (
                  <p className="bot-empty">Waiting for guests to join the call</p>
                ) : (
                  <ul className="bot-list">
                    {shown.map((p) => (
                      <li key={p.id}>
                        <BoardRow
                          size="xl"
                          name={p.displayName}
                          status={p.kind === 'member' ? 'MEMBER' : boardWord[p.status]}
                          tone={p.kind === 'member' ? 'paint' : boardTone[p.status]}
                        />
                      </li>
                    ))}
                    {hidden.length > 0 && <li className="bot-more">+ {hidden.length} more</li>}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
