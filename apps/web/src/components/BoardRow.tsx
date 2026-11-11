import { Flap, type FlapTone } from './Flap';

// One participant line: the name and a status pill.
// The same row is used on the bot tile, the host's participant list and the guest's phone.
export type LampTone = 'ok' | 'now' | 'bad' | 'dim' | 'off';

export function BoardRow({
  name,
  note,
  status,
  tone = 'paint',
  size = 'md',
}: {
  name: string;
  note?: string | null;
  status: string;
  tone?: FlapTone;
  lamp?: LampTone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  stack?: boolean;
}) {
  return (
    <span className={`prow prow-${size}`}>
      <span className="prow-name">{name}{note && <span className="prow-note">{note}</span>}</span>
      <Flap text={status} tone={tone} size={size} />
    </span>
  );
}
