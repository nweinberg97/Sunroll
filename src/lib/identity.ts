/**
 * Who this device is, per event: the participant credentials and organizer token handed out
 * by the server, plus a small profile to pre-fill the next join. Everything stays on the device.
 *
 * With the local backend, credentials are kept per tab (sessionStorage), so each tab acts as
 * a separate person on a separate phone: that is how you try a group on one machine.
 * With a real backend they persist (localStorage), so returning to a link "just works".
 */
import type { DayRange } from './time/ranges';
import { isValidZone, type Zone } from './time/zone';
import type { ColorName } from './data/types';
import { backendKind } from './data';

export interface Credentials {
  participantId: string;
  token: string;
}

export interface Profile {
  name: string;
  emoji: string;
  color: ColorName;
  sleep: DayRange;
  work: DayRange;
}

function safe(storage: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return storage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        storage().setItem(key, value);
      } catch {
        /* storage unavailable (private mode); the session still works in memory */
      }
    },
    remove(key: string): void {
      try {
        storage().removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

const local = safe(() => window.localStorage);
const session = safe(() => window.sessionStorage);
const credentialStore = () => (backendKind() === 'local' ? session : local);

export function getCredentials(eventId: string): Credentials | null {
  const raw = credentialStore().get(`sunroll:me:${eventId}`);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Credentials;
    return c.participantId && c.token ? c : null;
  } catch {
    return null;
  }
}

export function setCredentials(eventId: string, c: Credentials): void {
  credentialStore().set(`sunroll:me:${eventId}`, JSON.stringify(c));
}

export function clearCredentials(eventId: string): void {
  credentialStore().remove(`sunroll:me:${eventId}`);
}

export function getOrganizerToken(eventId: string): string | null {
  return credentialStore().get(`sunroll:org:${eventId}`);
}

export function setOrganizerToken(eventId: string, token: string): void {
  credentialStore().set(`sunroll:org:${eventId}`, token);
}

export function clearOrganizerToken(eventId: string): void {
  credentialStore().remove(`sunroll:org:${eventId}`);
}

export function getProfile(): Profile | null {
  const raw = local.get('sunroll:profile');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  local.set('sunroll:profile', JSON.stringify(p));
}

/** Last version of a locked time this device has celebrated, so "It's on." plays once per change. */
export function seenLockVersion(eventId: string): number {
  return Number(local.get(`sunroll:lockseen:${eventId}`) ?? 0);
}
export function markLockSeen(eventId: string, version: number): void {
  local.set(`sunroll:lockseen:${eventId}`, String(version));
}

/**
 * The device's time zone. `?tz=Europe/London` on any URL simulates another zone for this tab,
 * which is how one machine can play three people on three continents.
 */
export function detectZone(): Zone {
  try {
    const param = new URLSearchParams(window.location.search).get('tz');
    if (param && isValidZone(param)) {
      session.set('sunroll:sim-tz', param);
      return param;
    }
    const simulated = session.get('sunroll:sim-tz');
    if (simulated && isValidZone(simulated)) return simulated;
  } catch {
    /* no window */
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidZone(zone)) return zone;
  } catch {
    /* fall through */
  }
  return 'UTC';
}

export function isZoneSimulated(): boolean {
  return !!session.get('sunroll:sim-tz');
}

/** The user's locale, if the platform accepts it ("en-US@posix" and friends are not valid tags). */
export function preferredLocale(): string {
  const candidates: string[] = [];
  try {
    candidates.push(...(navigator.languages ?? []), navigator.language);
  } catch {
    /* no navigator */
  }
  for (const raw of candidates) {
    if (!raw) continue;
    const tag = raw.split('@')[0].replace(/_/g, '-');
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0) return tag;
    } catch {
      /* invalid tag: try the next */
    }
  }
  return 'en-US';
}
