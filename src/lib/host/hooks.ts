import { useCallback, useEffect, useState } from 'react';
import { createLocalHostStore } from './local';
import type { HostStore } from './store';
import type { Account } from './types';

let instance: HostStore | null = null;
/** The app's host store. Demo-only for now; a real backend slots in here later. */
export function hostStore(): HostStore {
  if (!instance) instance = createLocalHostStore();
  return instance;
}

/** Load something from the host store and keep it fresh as anything changes. */
export function useHostQuery<T>(load: (s: HostStore) => Promise<T>, deps: unknown[] = []): { data: T | null; error: unknown; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let alive = true;
    const s = hostStore();
    const go = () =>
      run(s).then(
        (d) => alive && (setData(d), setError(null)),
        (e) => alive && setError(e),
      );
    void go();
    const off = s.subscribe(() => void go());
    return () => {
      alive = false;
      off();
    };
  }, [run, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export function useMe(): { me: Account | null; loading: boolean } {
  const { data, error } = useHostQuery((s) => s.me());
  return { me: data ?? null, loading: data === null && !error };
}

/* ── The guided booking demo ─────────────────────────────────────────────────────────── */

export interface GuideStep {
  path: string;
  title: string;
  body: string;
  /** The step finishes by doing something (booking), not by tapping Next. */
  waitFor?: 'booking';
  next?: string;
}

export const BOOKING_GUIDE: GuideStep[] = [
  {
    path: '/app',
    title: 'One person, several identities',
    body: 'This is Nadia’s dashboard. Her Personal links sit next to her company, Acme, which has its own set of links for each product: Acme Analytics and Acme Mobile, each with its own colour and URL.',
  },
  {
    path: '/app/calendars',
    title: 'All your calendars count',
    body: 'Nadia connected two Google accounts: personal and work. She picks which calendars count as busy. Holidays don’t; Family does. Sunroll never reads event details, only busy times.',
  },
  {
    path: '/app/week',
    title: 'One combined week',
    body: 'Every busy calendar merges into one band. That band, plus her working hours, is everything a visitor can’t book. Tap another day to check it.',
  },
  {
    path: '/acme/analytics/demo?vz=Asia/Tokyo',
    title: 'Now be a customer in Tokyo',
    body: 'This is Acme Analytics’ demo link, as a customer in Tokyo sees it. Nadia is 16 hours behind, so her working day is Tokyo’s night and early morning, and every time shows both sides. Pick a time and book it.',
    waitFor: 'booking',
  },
  {
    path: '/booked',
    title: 'Booked',
    body: 'The customer sees their own time; Nadia sees hers. The event goes onto Nadia’s Work calendar with a Google Meet link, and both get an email (in this demo, previewed instead of sent). The manage link lets them reschedule or cancel.',
    next: '/app/bookings',
  },
  {
    path: '/app/bookings',
    title: 'Back as Nadia',
    body: 'The booking is in her upcoming list, in her time, with the customer’s local time beside it. That’s the whole loop. Explore anything, or start from the dashboard.',
  },
];

const GUIDE_KEY = 'sunroll:guide:booking';
export function guideStep(): number | null {
  try {
    const v = sessionStorage.getItem(GUIDE_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
export function setGuideStep(n: number | null): void {
  try {
    if (n === null) sessionStorage.removeItem(GUIDE_KEY);
    else sessionStorage.setItem(GUIDE_KEY, String(n));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('sunroll:guide'));
}
export function useGuideStep(): number | null {
  const [s, setS] = useState(guideStep);
  useEffect(() => {
    const on = () => setS(guideStep());
    window.addEventListener('sunroll:guide', on);
    return () => window.removeEventListener('sunroll:guide', on);
  }, []);
  return s;
}
