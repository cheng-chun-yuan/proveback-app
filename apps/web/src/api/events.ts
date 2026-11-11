// Live events. Production uses EventSource; mock mode uses an in-memory event bus instead (same interface).
import { HostEvent, PublicEvent, eventTypes, url } from '@proveback/contract';
import type { z } from 'zod';

export const MOCK = import.meta.env.VITE_MOCK === '1';

export type StreamState = 'connecting' | 'open' | 'reconnecting';
export interface StreamHandlers<E> {
  onEvent: (event: E) => void;
  onState?: (state: StreamState) => void;
}
type Close = () => void;

function openEventSource<S extends z.ZodTypeAny>(path: string, schema: S, h: StreamHandlers<z.infer<S>>): Close {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const connect = () => {
    if (closed) return;
    h.onState?.(es ? 'reconnecting' : 'connecting');
    const source = new EventSource(path, { withCredentials: true });
    es = source;
    const handle = (e: MessageEvent<string>) => {
      let json: unknown;
      try {
        json = JSON.parse(e.data);
      } catch {
        return;
      }
      const parsed = schema.safeParse(json);
      if (parsed.success) h.onEvent(parsed.data);
      else console.warn('Received an event that does not match the contract', json, parsed.error.issues);
    };
    // The backend may send default message events or named events; listen for both
    source.onmessage = handle;
    for (const type of eventTypes) source.addEventListener(type, handle as EventListener);
    source.onopen = () => h.onState?.('open');
    source.onerror = () => {
      h.onState?.('reconnecting');
      // The browser reconnects by itself; reopen manually only if the connection is considered closed. The first event after reconnecting is a snapshot, so no backfill is needed
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        timer = setTimeout(connect, 2000);
      }
    };
  };
  connect();

  return () => {
    closed = true;
    clearTimeout(timer);
    es?.close();
  };
}

function openMock<E>(subscribe: (store: typeof import('../mock/store')) => Close, h: StreamHandlers<E>): Close {
  let close: Close | null = null;
  let closed = false;
  h.onState?.('connecting');
  void import('../mock/store').then((store) => {
    if (closed) return;
    close = subscribe(store);
    h.onState?.('open');
  });
  return () => {
    closed = true;
    close?.();
  };
}

/** Host channel */
export function subscribeHost(mtgId: string, h: StreamHandlers<HostEvent>): Close {
  if (import.meta.env.VITE_MOCK === '1') return openMock((s) => s.subscribeHost(mtgId, h.onEvent), h);
  return openEventSource(url('meetingEvents', { mtgId }), HostEvent, h);
}

/** Public channel (guest page, bot screen page) */
export function subscribePublic(joinToken: string, h: StreamHandlers<PublicEvent>): Close {
  if (import.meta.env.VITE_MOCK === '1') return openMock((s) => s.subscribePublic(joinToken, h.onEvent), h);
  return openEventSource(url('publicEvents', { joinToken }), PublicEvent, h);
}
