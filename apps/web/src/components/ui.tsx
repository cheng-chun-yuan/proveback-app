import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { VerificationStatus } from '@proveback/contract';
import { verificationLabel } from '../lib/labels';

export const Loading = ({ label = '載入中…' }: { label?: string }) => (
  <div className="state" role="status">{label}</div>
);

export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="state state-error" role="alert">
    <span>{message}</span>
    {onRetry && <button className="btn btn-small" onClick={onRetry}>重試</button>}
  </div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="state state-empty">{children}</div>;

export const FormError = ({ message }: { message: string | null }) =>
  message ? <p className="form-error" role="alert">{message}</p> : null;

export const StatusBadge = ({ status }: { status: VerificationStatus }) => (
  <span className={`badge badge-${status}`}>{verificationLabel[status]}</span>
);

export const Chip = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) => (
  <span className={`chip chip-${tone}`}>{children}</span>
);

export const DevTag = ({ children }: { children: ReactNode }) => <span className="dev-tag">{children}</span>;

export function Qr({ text, size, className }: { text: string; size: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' }).then(
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

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪貼簿不可用時,使用者仍可手動選取 */
    }
  };
  return (
    <label className="copy-field">
      <span className="field-label">{label}</span>
      <span className="copy-row">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-small" onClick={copy}>{copied ? '已複製' : '複製'}</button>
        <a className="btn btn-small" href={value} target="_blank" rel="noreferrer">開啟</a>
      </span>
    </label>
  );
}
