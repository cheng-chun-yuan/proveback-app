import { useEffect, useMemo, useRef, useState } from 'react';

// The signature move: text set in fixed split-flap cells. When the text changes,
// each changed cell runs through a few intermediate glyphs, left to right, before landing.
const GLYPHS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const STEP_MS = 66; // one frame at the 15 fps the bot tile is streamed at
const STAGGER_MS = 45;

function fit(text: string, cells: number): string[] {
  const chars = Array.from(text.toUpperCase());
  const cut = chars.length > cells ? [...chars.slice(0, cells - 1), '.'] : chars;
  return [...cut, ...Array<string>(cells - cut.length).fill(' ')];
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export type FlapTone = 'paint' | 'ok' | 'now' | 'bad' | 'dim';

export function Flap({ text, cells, tone = 'paint', size = 'md' }: { text: string; cells: number; tone?: FlapTone; size?: 'sm' | 'md' | 'lg' }) {
  const target = useMemo(() => fit(text, cells), [text, cells]);
  const [shown, setShown] = useState<string[]>(() => Array<string>(cells).fill(' '));
  const prev = useRef<string[]>(Array<string>(cells).fill(' '));
  const key = target.join('');

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (reducedMotion()) {
      setShown(target);
      return;
    }
    // Cells that are not changing must show their final glyph even if a previous cascade was cut short.
    setShown((cur) => target.map((ch, i) => (from[i] === ch ? ch : (cur[i] ?? ' '))));
    const timers: number[] = [];
    target.forEach((ch, i) => {
      if (from[i] === ch) return;
      const steps = 3 + (i % 3);
      const base = Math.max(0, GLYPHS.indexOf(from[i] ?? ' '));
      for (let s = 1; s <= steps; s++) {
        timers.push(
          window.setTimeout(() => {
            setShown((cur) => {
              const next = cur.slice();
              next[i] = s === steps ? ch : (GLYPHS[(base + s * 5 + i * 3) % GLYPHS.length] ?? ' ');
              return next;
            });
          }, i * STAGGER_MS + s * STEP_MS),
        );
      }
    });
    return () => timers.forEach(clearTimeout);
    // `key` is the content of `target`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <span className={`flap flap-${tone} flap-${size}`}>
      <span className="sr-only">{text}</span>
      {shown.map((ch, i) => (
        <i key={`${i}:${ch}`} aria-hidden>{ch === ' ' ? ' ' : ch}</i>
      ))}
    </span>
  );
}
