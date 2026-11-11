import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { PublicMeeting, VerificationStatus, VerifySession } from '@proveback/contract';
import { api, errorMessage } from '../api/client';
import { useAction } from '../lib/hooks';
import { boardTone, boardWord, failureLabel } from '../lib/labels';
import { usePublicMeeting } from '../lib/usePublicMeeting';
import { Flap } from '../components/Flap';
import { CheckIcon, ErrorBox, FormError, Loading, Qr, StatusBadge } from '../components/ui';

type Step = 'pick' | 'consent' | 'verify' | 'result';

const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && innerWidth < 820;

function Disclosures({ d }: { d: PublicMeeting['disclosures'] }) {
  return (
    <>
      <ul className="disclosures">
        {d.ofac && <li><CheckIcon />That you are not on a sanctions list. The host sees only pass or fail.</li>}
        {d.excludedCountries.length > 0 && <li><CheckIcon />That your nationality is not one of: {d.excludedCountries.join(', ')}.</li>}
        <li><CheckIcon />{d.nationality ? 'Your nationality, shown to the host.' : 'Nothing about your nationality is shown to the host.'}</li>
        {d.nameMatch && <li><CheckIcon />That your passport name matches your name in the call. The name is compared, then discarded.</li>}
        {d.minimumAge !== null && <li><CheckIcon />That you are at least {d.minimumAge}. Your date of birth stays private.</li>}
        <li><CheckIcon />An anonymous code for this passport, so this host recognises you next time.</li>
      </ul>
      <p className="never">Never shared or stored: passport number, date of birth, photo, full name. Others in the call see only that you are verified.</p>
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

  // Coming back from Self (?session=) or after a reload: pick up the session in progress
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
    // Runs once, when the page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinToken]);

  // Waiting for the result: poll the session every 2 seconds
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

  if (meeting.error) return <div className="join"><div className="join-body"><ErrorBox message={meeting.error} onRetry={meeting.reload} /></div></div>;
  if (!meeting.data || resuming) return <div className="center-page"><Loading /></div>;

  const m = meeting.data;
  const guests = m.participants.filter((p) => p.kind === 'guest');
  const who = m.participants.find((p) => p.id === pid);
  // The guest's own row on the board, shown while scanning and at the result.
  const rowStatus: VerificationStatus | null =
    step === 'verify' ? 'pending' : step === 'result' && session ? (session.status === 'verified' ? 'verified' : 'failed') : null;

  return (
    <div className="join">
      <header className="join-head">
        <h1>{m.title}</h1>
        <p>Hosted by {m.workspaceName}</p>
      </header>
      <main className="join-body">
        {rowStatus && (
          <div className="my-row">
            <Flap text={who?.displayName ?? 'YOU'} cells={12} size="md" />
            <Flap text={boardWord[rowStatus]} cells={9} tone={boardTone[rowStatus]} size="md" />
          </div>
        )}

        {step === 'pick' && (
          <>
            <h2>Which participant are you?</h2>
            {guests.length === 0 ? (
              <p className="hint">No guests need to verify yet. Join the Google Meet call first; your name appears here once you are in.</p>
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
            <button className="btn btn-primary btn-block" disabled={!pid || who?.status === 'verified'} onClick={() => setStep('consent')}>Continue</button>
            <p className="hint">Pick the name you are using in the call. Choosing someone else marks the wrong person.</p>
          </>
        )}

        {step === 'consent' && (
          <>
            <h2>What you will prove</h2>
            <p>You are verifying as <strong>{who?.displayName ?? 'this participant'}</strong> by scanning your passport in the Self app. This meeting asks for:</p>
            <Disclosures d={m.disclosures} />
            <FormError message={create.error} />
            <button className="btn btn-primary btn-block" disabled={create.busy} onClick={start}>{create.busy ? 'Preparing…' : 'Agree and verify'}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setStep('pick')}>That is not me</button>
          </>
        )}

        {step === 'verify' && session && (
          <>
            <h2>Scan your passport with Self</h2>
            {/* The contract's selfApp is null for now (the API uses Self's hosted SDK), so only universalLink is used.
                If the API starts returning selfApp, hand it unchanged to Self's QR component here. */}
            {isPhone() ? (
              <>
                <a className="btn btn-primary btn-block" href={session.universalLink} target="_blank" rel="noreferrer">Open Self</a>
                <p className="hint">Come back to this page when you are done. The result appears on its own.</p>
              </>
            ) : (
              <>
                <p>Scan this code with your phone to open Self, then follow its steps to scan your passport.</p>
                <div className="qr-box"><Qr text={session.universalLink} size={240} /></div>
                <p className="hint">Or <a href={session.universalLink} target="_blank" rel="noreferrer">open it on this device</a>.</p>
              </>
            )}
            <p className="waiting" role="status">Waiting for your proof. The link works for 5 minutes.</p>
            <FormError message={pollError} />
            <button className="btn btn-ghost btn-block" onClick={retry}>Cancel and start over</button>
          </>
        )}

        {step === 'result' && session && (
          session.status === 'verified' ? (
            <div className="result result-good">
              <strong>You are verified</strong>
              <span>{who ? who.displayName : 'Your name'} now shows as verified in the call. You can close this page.</span>
            </div>
          ) : (
            <>
              <div className="result result-bad">
                <strong>{session.status === 'expired' ? 'The verification timed out' : 'The verification did not pass'}</strong>
                <span>{session.failureReason ? failureLabel[session.failureReason] : 'It was not finished in time.'}</span>
              </div>
              <button className="btn btn-primary btn-block" onClick={retry}>Verify again</button>
            </>
          )
        )}
        <p className="join-foot">ProveBack</p>
      </main>
    </div>
  );
}
