// The headline of every live screen: how many guests have verified, as a number and a ring.
export function Tally({ done, total, size = 'md' }: { done: number; total: number; size?: 'md' | 'xl' }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const part = total > 0 ? done / total : 0;
  return (
    <div className={`tally tally-${size}`} role="status" aria-label={`${done} of ${total} guests verified`}>
      <svg className="tally-ring" viewBox="0 0 100 100" aria-hidden>
        <circle className="tally-track" cx="50" cy="50" r={r} />
        <circle className="tally-arc" cx="50" cy="50" r={r} strokeDasharray={`${c * part} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="tally-text" aria-hidden>
        <span className="tally-num">{done}<i> / {total}</i></span>
        <span className="tally-label">{total === 0 ? 'no guests yet' : 'guests verified'}</span>
      </div>
    </div>
  );
}
