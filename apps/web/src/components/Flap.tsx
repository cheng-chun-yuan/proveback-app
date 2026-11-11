// A plain status pill. Status words arrive in capitals ("TRY AGAIN"); they are shown in sentence case.
export type FlapTone = 'paint' | 'ok' | 'now' | 'bad' | 'dim';

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

export function Flap({ text, tone = 'paint', size = 'md' }: { text: string; cells?: number; tone?: FlapTone; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  if (!text) return null;
  return <span className={`pill pill-${tone} pill-${size}`}>{sentence(text)}</span>;
}
