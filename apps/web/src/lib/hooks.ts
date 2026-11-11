import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (prev: T) => T) => void;
}

/** 載入一筆資料。deps 改變時重新載入,過期的回應會被丟掉 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setDataRaw] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    fnRef.current().then(
      (d) => {
        if (stale) return;
        setDataRaw(d);
        setLoading(false);
      },
      (e) => {
        if (stale) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((updater: (prev: T) => T) => setDataRaw((prev) => (prev === null ? prev : updater(prev))), []);
  return { data, error, loading, reload, setData };
}

/** 包住一個會改資料的動作:處理進行中狀態與錯誤訊息 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}
