import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { VerificationStatus } from '@proveback/contract';
import { verificationLabel } from '../lib/labels';

export const CheckIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>
);
export const CrossIcon = () => (
  <svg className="icon" viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>
);

export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="state" role="status">{label}</div>
);

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="state state-error" role="alert">
    <span>{message}</span>
    {onRetry && <button className="btn btn-small" onClick={onRetry}>Try again</button>}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="state state-empty">{children}</div>;

export const FormError = ({ message }: { message: string | null }) =>
  message ? <p className="form-error" role="alert">{message}</p> : null;

export const StatusBadge = ({ status }: { status: VerificationStatus }) => (
  <span className={`badge badge-${status}`}>
    {status === 'verified' && <CheckIcon />}
    {status === 'failed' && <CrossIcon />}
    {verificationLabel[status]}
  </span>
);

export const Chip = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) => (
  <span className={`chip chip-${tone}`}>{children}</span>
);


export function Qr({ text, size, className }: { text: string; size: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    QRCode.toDataURL(text, { width: size * 2, margin: 3, errorCorrectionLevel: text.length > 300 ? 'L' : 'M', color: { dark: '#131417', light: '#ffffff' } }).then(
      (u) => !stale && setSrc(u),
      () => !stale && setSrc(null),
    );
    return () => {
      stale = true;
    };
  }, [text, size]);
  return src ? (
    <img className={className} src={src} width={size} height={size} alt="QR code" />
  ) : (
    <div className={className} style={{ width: size, height: size }} aria-hidden />
  );
}

export function CopyField({ label, hint, value }: { label: string; hint?: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard unavailable: the field can still be selected by hand. */
    }
  };
  return (
    <label className="copy-field">
      <span className="field-label">{label}</span>
      <span className="copy-row">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <a className="btn btn-small" href={value} target="_blank" rel="noreferrer">Open</a>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
