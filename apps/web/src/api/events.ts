// 即時事件。正式走 EventSource;mock 模式改接記憶體內的事件匯流排(介面相同)。
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
      else console.warn('收到不符合契約的事件', json, parsed.error.issues);
    };
    // 後端可能用預設的 message 事件,也可能用具名事件,兩種都聽
    source.onmessage = handle;
    for (const type of eventTypes) source.addEventListener(type, handle as EventListener);
    source.onopen = () => h.onState?.('open');
    source.onerror = () => {
      h.onState?.('reconnecting');
      // 瀏覽器會自己重連;只有連線被判定為關閉時才需要手動重開。重連後第一筆是 snapshot,不需補資料
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

/** 主辦方頻道 */
export function subscribeHost(mtgId: string, h: StreamHandlers<HostEvent>): Close {
  if (import.meta.env.VITE_MOCK === '1') return openMock((s) => s.subscribeHost(mtgId, h.onEvent), h);
  return openEventSource(url('meetingEvents', { mtgId }), HostEvent, h);
}

/** 公開頻道(來賓頁、bot 畫面頁) */
export function subscribePublic(joinToken: string, h: StreamHandlers<PublicEvent>): Close {
  if (import.meta.env.VITE_MOCK === '1') return openMock((s) => s.subscribePublic(joinToken, h.onEvent), h);
  return openEventSource(url('publicEvents', { joinToken }), PublicEvent, h);
}
