/**
 * Local adapter: a complete, credential-free backend that lives in the browser.
 *
 * It behaves like the Supabase functions (same validation, same token checks, same errors)
 * so the app can be developed and tried with `npm run dev` and nothing else. Data is shared
 * by every tab of the same browser, with changes and presence broadcast across tabs.
 * It is a development backend: nothing leaves the device, and other devices can't see it.
 */
import { addDays, MINUTE, type Instant } from '../time/zone';
import type { Block } from '../availability/blocks';
import { hashSecret, newEventId, newToken, newUuid } from './ids';
import { eventProblem, LIMITS, participantProblem } from './validate';
import { StoreError, type DataStore, type PresenceHandle } from './store';
import type {
  BlockRecord,
  CreatedEvent,
  EventPatch,
  EventRecord,
  EventSnapshot,
  Joined,
  LockRecord,
  NewEvent,
  NewParticipant,
  ParticipantPatch,
  ParticipantRecord,
  PresencePeer,
  ReactionEmoji,
  ReactionRecord,
} from './types';
import { REACTIONS } from './types';

interface StoredEvent extends EventRecord {
  organizerTokenHash: string;
  referredByEventId: string | null;
  viewCount: number;
}
interface StoredParticipant extends ParticipantRecord {
  tokenHash: string;
}
interface StoredBlock extends BlockRecord {
  eventId: string;
}
interface StoredReaction extends ReactionRecord {
  eventId: string;
}
interface Db {
  v: 1;
  events: Record<string, StoredEvent>;
  participants: Record<string, StoredParticipant>;
  blocks: StoredBlock[];
  locks: Record<string, LockRecord>;
  reactions: StoredReaction[];
  rate: Record<string, number[]>;
}

/** Where the database lives. Browser: localStorage. Tests: a Map. */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface LocalOptions {
  storage?: KeyValue;
  /** Name prefix for BroadcastChannels; tests use a unique one. */
  channelPrefix?: string;
  now?: () => Instant;
}

const DB_KEY = 'sunroll:local-db:v1';
const RETENTION_DAYS = 90;

function emptyDb(): Db {
  return { v: 1, events: {}, participants: {}, blocks: [], locks: {}, reactions: [], rate: {} };
}

function browserStorage(): KeyValue {
  const memory = new Map<string, string>();
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
  };
}

function strip<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

export function createLocalStore(options: LocalOptions = {}): DataStore {
  const storage = options.storage ?? browserStorage();
  const prefix = options.channelPrefix ?? 'sunroll-local';
  const now = options.now ?? (() => Date.now());
  const listeners = new Map<string, Set<() => void>>();
  const changes = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`${prefix}:changes`) : null;

  function emit(eventId: string): void {
    listeners.get(eventId)?.forEach((fn) => fn());
  }
  // Don't keep Node (tests) alive just for the channel.
  if (changes && 'unref' in changes) (changes as unknown as { unref(): void }).unref();
  changes?.addEventListener('message', (e: MessageEvent<{ eventId: string }>) => emit(e.data.eventId));

  function read(): Db {
    const raw = storage.get(DB_KEY);
    if (!raw) return emptyDb();
    try {
      const db = JSON.parse(raw) as Db;
      return db.v === 1 ? db : emptyDb();
    } catch {
      return emptyDb();
    }
  }

  function purge(db: Db): void {
    const t = now();
    for (const [id, e] of Object.entries(db.events)) if (e.expiresAt < t) removeEvent(db, id);
  }

  function removeEvent(db: Db, id: string): void {
    delete db.events[id];
    delete db.locks[id];
    for (const [pid, p] of Object.entries(db.participants)) if (p.eventId === id) delete db.participants[pid];
    db.blocks = db.blocks.filter((b) => b.eventId !== id);
    db.reactions = db.reactions.filter((r) => r.eventId !== id);
  }

  /** Serialise read-modify-write across tabs where the Web Locks API exists. */
  async function transact<T>(fn: (db: Db) => T | Promise<T>, changedEvent?: (result: T) => string | null): Promise<T> {
    const run = async () => {
      const db = read();
      purge(db);
      const result = await fn(db);
      storage.set(DB_KEY, JSON.stringify(db));
      return result;
    };
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const result = locks ? await locks.request('sunroll-local-db', run) : await run();
    const id = changedEvent?.(result);
    if (id) {
      emit(id);
      changes?.postMessage({ eventId: id });
    }
    return result;
  }

  function rateLimit(db: Db, bucket: string, limit: number, windowMs: number): void {
    const t = now();
    const hits = (db.rate[bucket] ?? []).filter((x) => x > t - windowMs);
    if (hits.length >= limit) throw new StoreError('rate_limited', 'slow down a little and try again soon');
    hits.push(t);
    db.rate[bucket] = hits;
  }

  async function requireOrganizer(db: Db, eventId: string, token: string): Promise<StoredEvent> {
    const e = db.events[eventId];
    if (!e) throw new StoreError('not_found', 'this event has rolled off');
    if (e.organizerTokenHash !== (await hashSecret(token ?? ''))) throw new StoreError('forbidden', 'only the organizer can do that');
    return e;
  }

  async function requireParticipant(db: Db, participantId: string, token: string): Promise<StoredParticipant> {
    const p = db.participants[participantId];
    if (!p) throw new StoreError('not_found', 'we couldn’t find you in this event');
    if (p.tokenHash !== (await hashSecret(token ?? ''))) throw new StoreError('forbidden', 'that isn’t you');
    return p;
  }

  function cleanParticipant(input: NewParticipant | ParticipantRecord): Omit<ParticipantRecord, 'id' | 'eventId' | 'isOrganizer' | 'respondedAt' | 'createdAt' | 'updatedAt'> {
    const problem = participantProblem(input);
    if (problem) throw new StoreError('invalid', problem);
    return {
      name: input.name.trim(),
      emoji: input.emoji?.trim() || '🙂',
      color: input.color,
      timezone: input.timezone,
      sleep: input.sleep ?? { start: 23 * 60, end: 7 * 60 },
      work: input.work ?? { start: 9 * 60, end: 17 * 60 },
    };
  }

  function todayUtc(): string {
    return new Date(now()).toISOString().slice(0, 10);
  }

  function snapshot(db: Db, eventId: string): EventSnapshot | null {
    const e = db.events[eventId];
    if (!e) return null;
    const participants = Object.values(db.participants)
      .filter((p) => p.eventId === eventId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((p) => strip(p, 'tokenHash'));
    return {
      event: strip(e, 'organizerTokenHash', 'referredByEventId', 'viewCount'),
      participants,
      blocks: db.blocks.filter((b) => b.eventId === eventId).map((b) => strip(b, 'eventId')),
      lock: db.locks[eventId] ?? null,
      reactions: db.reactions.filter((r) => r.eventId === eventId).map((r) => strip(r, 'eventId')),
    };
  }

  const store: DataStore = {
    kind: 'local',

    async createEvent(input: NewEvent, host: NewParticipant): Promise<CreatedEvent> {
      const problem = eventProblem(input, todayUtc());
      if (problem) throw new StoreError('invalid', problem);
      const cleanHost = cleanParticipant(host);
      const organizerToken = newToken();
      const participantToken = newToken();
      const [orgHash, partHash] = await Promise.all([hashSecret(organizerToken), hashSecret(participantToken)]);
      return transact(
        (db) => {
          rateLimit(db, 'create_event', 20, 3_600_000);
          const id = newEventId();
          const t = now();
          const dates = [...new Set(input.dates)].sort();
          db.events[id] = {
            id,
            title: input.title.trim(),
            emoji: input.emoji.trim() || '☀️',
            color: input.color,
            timezone: input.timezone,
            dates,
            windowStartMin: input.windowStartMin,
            windowEndMin: input.windowEndMin,
            slotMinutes: input.slotMinutes,
            durationMinutes: input.durationMinutes,
            expectedCount: input.expectedCount,
            templateSlug: input.templateSlug,
            createdAt: t,
            updatedAt: t,
            expiresAt: Date.parse(`${addDays(dates[dates.length - 1], RETENTION_DAYS)}T00:00:00Z`),
            organizerTokenHash: orgHash,
            referredByEventId: input.referredByEventId,
            viewCount: 0,
          };
          const pid = newUuid();
          db.participants[pid] = { ...cleanHost, id: pid, eventId: id, isOrganizer: true, respondedAt: null, createdAt: t, updatedAt: t, tokenHash: partHash };
          return { eventId: id, organizerToken, participantId: pid, participantToken };
        },
        (r) => r.eventId,
      );
    },

    async getSnapshot(eventId) {
      return snapshot(read(), eventId);
    },

    async verifyOrganizer(eventId, token) {
      const e = read().events[eventId];
      return !!e && e.organizerTokenHash === (await hashSecret(token ?? ''));
    },

    async updateEvent(eventId, token, patch: EventPatch) {
      await transact(
        async (db) => {
          const e = await requireOrganizer(db, eventId, token);
          if (patch.title !== undefined) {
            const t = patch.title.trim();
            if (t.length < 1 || [...t].length > LIMITS.titleMax) throw new StoreError('invalid', 'give it a name (up to 80 characters)');
            e.title = t;
          }
          if (patch.emoji !== undefined && patch.emoji.trim()) e.emoji = patch.emoji.trim();
          if (patch.color !== undefined) e.color = patch.color;
          if (patch.expectedCount !== undefined) e.expectedCount = patch.expectedCount;
          e.updatedAt = now();
        },
        () => eventId,
      );
    },

    async deleteEvent(eventId, token) {
      await transact(
        async (db) => {
          await requireOrganizer(db, eventId, token);
          removeEvent(db, eventId);
        },
        () => eventId,
      );
    },

    async join(eventId, participant): Promise<Joined> {
      const clean = cleanParticipant(participant);
      const token = newToken();
      const hash = await hashSecret(token);
      return transact(
        (db) => {
          rateLimit(db, 'join_event', 60, 3_600_000);
          if (!db.events[eventId]) throw new StoreError('not_found', 'this event has rolled off');
          const count = Object.values(db.participants).filter((p) => p.eventId === eventId).length;
          if (count >= LIMITS.maxParticipants) throw new StoreError('invalid', 'this event is full (50 people)');
          const t = now();
          const id = newUuid();
          const record: StoredParticipant = { ...clean, id, eventId, isOrganizer: false, respondedAt: null, createdAt: t, updatedAt: t, tokenHash: hash };
          db.participants[id] = record;
          return { participant: strip(record, 'tokenHash'), token };
        },
        () => eventId,
      );
    },

    async updateParticipant(participantId, token, patch: ParticipantPatch) {
      let eventId = '';
      return transact(
        async (db) => {
          const p = await requireParticipant(db, participantId, token);
          eventId = p.eventId;
          const merged = { ...strip(p, 'tokenHash'), ...patch } as ParticipantRecord;
          Object.assign(p, cleanParticipant(merged), { updatedAt: now() });
          return strip(p, 'tokenHash');
        },
        () => eventId,
      );
    },

    async leave(participantId, token) {
      let eventId = '';
      await transact(
        async (db) => {
          const p = await requireParticipant(db, participantId, token);
          if (p.isOrganizer) throw new StoreError('invalid', 'organizers delete the event instead');
          eventId = p.eventId;
          delete db.participants[participantId];
          db.blocks = db.blocks.filter((b) => b.participantId !== participantId);
          db.reactions = db.reactions.filter((r) => r.participantId !== participantId);
        },
        () => eventId,
      );
    },

    async removeParticipant(eventId, token, participantId) {
      await transact(
        async (db) => {
          await requireOrganizer(db, eventId, token);
          const p = db.participants[participantId];
          if (!p || p.eventId !== eventId || p.isOrganizer) return;
          delete db.participants[participantId];
          db.blocks = db.blocks.filter((b) => b.participantId !== participantId);
          db.reactions = db.reactions.filter((r) => r.participantId !== participantId);
        },
        () => eventId,
      );
    },

    async setAvailability(participantId, token, blocks: Block[], responded) {
      let eventId = '';
      await transact(
        async (db) => {
          rateLimit(db, `set_availability:${participantId}`, 600, 3_600_000);
          const p = await requireParticipant(db, participantId, token);
          eventId = p.eventId;
          const e = db.events[eventId];
          if (blocks.length > 700) throw new StoreError('invalid', 'too many blocks');
          const lo = Date.parse(`${addDays(e.dates[0], -2)}T00:00:00Z`);
          const hi = Date.parse(`${addDays(e.dates[e.dates.length - 1], 3)}T00:00:00Z`);
          for (const b of blocks) {
            if (!(b.end > b.start) || b.end - b.start > 2 * 1440 * MINUTE || (b.kind !== 'free' && b.kind !== 'if_needed')) throw new StoreError('invalid', 'availability');
            if (b.start < lo || b.end > hi) throw new StoreError('invalid', 'availability outside the event');
          }
          db.blocks = db.blocks.filter((b) => b.participantId !== participantId);
          for (const b of blocks) db.blocks.push({ eventId, participantId, start: b.start, end: b.end, kind: b.kind });
          if (responded && p.respondedAt === null) p.respondedAt = now();
          p.updatedAt = now();
        },
        () => eventId,
      );
    },

    async lock(eventId, token, start, end) {
      return transact(
        async (db) => {
          const e = await requireOrganizer(db, eventId, token);
          if (!(end > start) || end - start > 8 * 60 * MINUTE) throw new StoreError('invalid', 'lock time');
          const prev = db.locks[eventId];
          const lock: LockRecord = { start, end, version: (prev?.version ?? 0) + 1, lockedAt: now() };
          db.locks[eventId] = lock;
          e.updatedAt = now();
          return lock;
        },
        () => eventId,
      );
    },

    async unlock(eventId, token) {
      await transact(
        async (db) => {
          const e = await requireOrganizer(db, eventId, token);
          delete db.locks[eventId];
          e.updatedAt = now();
        },
        () => eventId,
      );
    },

    async toggleReaction(participantId, token, emoji: ReactionEmoji) {
      let eventId = '';
      return transact(
        async (db) => {
          if (!REACTIONS.includes(emoji)) throw new StoreError('invalid', 'reaction');
          const p = await requireParticipant(db, participantId, token);
          eventId = p.eventId;
          const before = db.reactions.length;
          db.reactions = db.reactions.filter((r) => !(r.participantId === participantId && r.emoji === emoji));
          if (db.reactions.length < before) return false;
          db.reactions.push({ eventId, participantId, emoji, createdAt: now() });
          return true;
        },
        () => eventId,
      );
    },

    async recordView(eventId) {
      await transact((db) => {
        const e = db.events[eventId];
        if (e) e.viewCount += 1;
      });
    },

    subscribe(eventId, onChange) {
      let set = listeners.get(eventId);
      if (!set) listeners.set(eventId, (set = new Set()));
      set.add(onChange);
      // Another tab may write while BroadcastChannel is unavailable; storage events cover that.
      const onStorage = (e: StorageEvent) => {
        if (e.key === DB_KEY) onChange();
      };
      if (!changes && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        set!.delete(onChange);
        if (!changes && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },

    presence(eventId, onPeers): PresenceHandle {
      return localPresence(`${prefix}:presence`, eventId, onPeers);
    },
  };

  return store;
}

type PresenceMessage =
  | { type: 'here'; eventId: string; peer: PresencePeer }
  | { type: 'hello'; eventId: string }
  | { type: 'bye'; eventId: string; clientId: string };

/** Presence across tabs: heartbeats over a BroadcastChannel, pruned when they go quiet. */
function localPresence(channelName: string, eventId: string, onPeers: (peers: PresencePeer[]) => void): PresenceHandle {
  if (typeof BroadcastChannel === 'undefined') return { update() {}, leave() {} };
  const channel = new BroadcastChannel(channelName);
  const clientId = newUuid();
  const peers = new Map<string, { peer: PresencePeer; seen: number }>();
  let me: PresencePeer | null = null;

  const publish = () => onPeers([...peers.values()].map((x) => x.peer));
  const announce = () => {
    if (me) channel.postMessage({ type: 'here', eventId, peer: me } satisfies PresenceMessage);
  };

  channel.onmessage = (e: MessageEvent<PresenceMessage>) => {
    const m = e.data;
    if (m.eventId !== eventId) return;
    if (m.type === 'hello') announce();
    else if (m.type === 'here' && m.peer.clientId !== clientId) {
      peers.set(m.peer.clientId, { peer: m.peer, seen: Date.now() });
      publish();
    } else if (m.type === 'bye' && peers.delete(m.clientId)) publish();
  };

  const heartbeat = setInterval(() => {
    announce();
    const cutoff = Date.now() - 10_000;
    let changed = false;
    for (const [id, x] of peers) {
      if (x.seen < cutoff) {
        peers.delete(id);
        changed = true;
      }
    }
    if (changed) publish();
  }, 4_000);

  const bye = () => channel.postMessage({ type: 'bye', eventId, clientId } satisfies PresenceMessage);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', bye);
  channel.postMessage({ type: 'hello', eventId } satisfies PresenceMessage);

  return {
    update(state) {
      me = { ...state, clientId };
      announce();
    },
    leave() {
      clearInterval(heartbeat);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', bye);
      bye();
      channel.close();
    },
  };
}
