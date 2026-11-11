import { Flap, type FlapTone } from './Flap';

// One line of the board: a lamp, the name in cells, the status in cells.
// The same row is used on the bot tile, the host's participant list and the guest's phone.
export const NAME_CELLS = 12;
export const STATUS_CELLS = 9;

export type LampTone = 'ok' | 'now' | 'bad' | 'dim' | 'off';

export function BoardRow({
  name,
  status,
  tone = 'paint',
  lamp = 'off',
  size = 'md',
  stack = false,
}: {
  name: string;
  status: string;
  tone?: FlapTone;
  lamp?: LampTone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  stack?: boolean;
}) {
  return (
    <span className={`board-row board-row-${size}${stack ? ' board-row-stack' : ''}`}>
      <span className={`lamp lamp-${lamp}`} aria-hidden />
      <Flap text={name} cells={NAME_CELLS} size={size} />
      <Flap text={status} cells={STATUS_CELLS} tone={tone} size={size} />
    </span>
  );
}
