/**
 * React hooks that connect screens to the DataStore. All the honesty about network state
 * (loading, saving, saved, failed, offline) lives here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStore, type DataStore } from './data';
import { StoreError } from './data/store';
import type { EventSnapshot, PresencePeer } from './data/types';
import { buildModel, type EventModel } from './model';
import { toBlocks, type Availability } from './availability/blocks';
import type { Credentials } from './identity';

export function useStore(): DataStore | null {
  const [store, setStore] = useState<DataStore | null>(null);
  useEffect(() => {
    let alive = true;
    void getStore().then((s) => alive && setStore(s));
    return () => {
      alive = false;
    };
  }, []);
  return store;
}

export type LoadState = 'loading' | 'ready' | 'missing' | 'error';

/** Load an event and keep it live: refetch on every change, on reconnect and on refocus. */
export function useEvent(store: DataStore | null, eventId: string) {
  const [snapshot, setSnapshot] = useState<EventSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [changedAt, setChangedAt] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (!store) return;
    if (inflight.current) {
      // Coalesce bursts of changes into one extra fetch.
      again.current = true;
      return inflight.current;
    }
    const run = (async () => {
      do {
        again.current = false;
        try {
          const s = await store.getSnapshot(eventId);
          setSnapshot(s);
          setState(s ? 'ready' : 'missing');
          setChangedAt(Date.now());
        } catch {
          setState((prev) => (prev === 'ready' ? 'ready' : 'error'));
        }
      } while (again.current);
    })();
    inflight.current = run;
    try {
      await run;
    } finally {
      inflight.current = null;
    }
  }, [store, eventId]);

  useEffect(() => {
    if (!store) return;
    setState('loading');
    void refresh();
    const off = store.subscribe(eventId, () => void refresh());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [store, eventId, refresh]);

  const model: EventModel | null = useMemo(() => (snapshot ? buildModel(snapshot) : null), [snapshot]);
  return { snapshot, model, state, refresh, changedAt };
}

/** Everyone else currently looking at this event. */
export function usePresence(store: DataStore | null, eventId: string, me: Omit<PresencePeer, 'clientId'>): PresencePeer[] {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const handle = useRef<ReturnType<DataStore['presence']> | null>(null);
  useEffect(() => {
    if (!store) return;
    const h = store.presence(eventId, setPeers);
    handle.current = h;
    return () => {
      h.leave();
      handle.current = null;
    };
  }, [store, eventId]);
  const key = `${me.participantId}|${me.name}|${me.emoji}|${me.activity}`;
  useEffect(() => {
    handle.current?.update(me);
    // `key` captures every field of `me`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store]);
  return peers;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

/**
 * Autosave availability. Saves 500ms after the last change; retries failures with backoff;
 * waits for the connection to come back when offline. Only says "saved" after the server did.
 */
export function useAutosave(store: DataStore | null, creds: Credentials | null, slotMinutes: number) {
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<{ availability: Availability; responded: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<boolean> | null>(null);
  const attempt = useRef(0);

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (saving.current) await saving.current;
    const job = pending.current;
    if (!job || !store || !creds) return true;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline');
      return false;
    }
    pending.current = null;
    setState('saving');
    const run = (async () => {
      try {
        await store.setAvailability(creds.participantId, creds.token, toBlocks(job.availability, slotMinutes), job.responded);
        attempt.current = 0;
        if (!pending.current) setState('saved');
        return true;
      } catch (err) {
        // Keep the newest change if one arrived meanwhile; otherwise retry this one.
        if (!pending.current) pending.current = job;
        if (err instanceof StoreError && (err.code === 'forbidden' || err.code === 'not_found' || err.code === 'invalid')) {
          setState('error');
          return false;
        }
        setState('error');
        attempt.current += 1;
        const delay = Math.min(30_000, 1500 * 2 ** (attempt.current - 1));
        timer.current = window.setTimeout(() => void flush(), delay);
        return false;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    const ok = await run;
    if (ok && pending.current) return flush();
    return ok;
  }, [store, creds, slotMinutes]);

  const save = useCallback(
    (availability: Availability, responded = true) => {
      pending.current = { availability, responded };
      setState((s) => (s === 'offline' ? 'offline' : 'saving'));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 500);
    },
    [flush],
  );

  useEffect(() => {
    const online = () => {
      if (pending.current) void flush();
    };
    const offline = () => {
      if (pending.current) setState('offline');
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // Last-chance save when the tab is hidden (switching back to the group chat).
    const hidden = () => {
      if (document.visibilityState === 'hidden' && pending.current) void flush();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', hidden);
      window.clearTimeout(timer.current);
    };
  }, [flush]);

  const hasPending = useCallback(() => pending.current !== null || saving.current !== null, []);
  return { state, save, flush, hasPending };
}

/** A clock that ticks once a minute, for "it's 9:41 pm in London" displays. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
