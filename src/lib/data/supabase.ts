/**
 * Supabase adapter. Every call is a Postgres function (see supabase/migrations); tables are
 * never touched directly. Real-time uses one Realtime channel per event: a broadcast
 * "changed" ping sent by the database (no data on the wire), plus presence.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { Block } from '../availability/blocks';
import { newUuid } from './ids';
import { StoreError, type DataStore, type PresenceHandle } from './store';
import type {
  BlockRecord,
  CreatedEvent,
  EventRecord,
  EventSnapshot,
  Joined,
  LockRecord,
  ParticipantRecord,
  PresencePeer,
  ReactionRecord,
} from './types';

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseParticipant(p: any): ParticipantRecord {
  return {
    id: p.id,
    eventId: p.eventId,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    timezone: p.timezone,
    sleep: p.sleep,
    work: p.work,
    isOrganizer: p.isOrganizer,
    respondedAt: p.respondedAt ? ms(p.respondedAt) : null,
    createdAt: ms(p.createdAt),
    updatedAt: ms(p.updatedAt),
  };
}

function parseLock(l: any): LockRecord | null {
  if (!l) return null;
  return { start: ms(l.start), end: ms(l.end), version: l.version, lockedAt: ms(l.lockedAt) };
}

export function parseSnapshot(raw: any): EventSnapshot | null {
  if (!raw) return null;
  const e = raw.event;
  const event: EventRecord = {
    id: e.id,
    title: e.title,
    emoji: e.emoji,
    color: e.color,
    timezone: e.timezone,
    days: e.days,
    slotMinutes: e.slotMinutes,
    durationMinutes: e.durationMinutes,
    expectedCount: e.expectedCount ?? null,
    templateSlug: e.templateSlug ?? null,
    createdAt: ms(e.createdAt),
    updatedAt: ms(e.updatedAt),
    expiresAt: ms(e.expiresAt),
  };
  return {
    event,
    participants: (raw.participants ?? []).map(parseParticipant),
    blocks: (raw.blocks ?? []).map((b: any): BlockRecord => ({ participantId: b.participantId, start: ms(b.start), end: ms(b.end), kind: b.kind })),
    lock: parseLock(raw.lock),
    reactions: (raw.reactions ?? []).map((r: any): ReactionRecord => ({ participantId: r.participantId, emoji: r.emoji, createdAt: ms(r.createdAt) })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const iso = (t: number) => new Date(t).toISOString();

const MUTATIONS = new Set(['update_event', 'delete_event', 'join_event', 'update_participant', 'leave_event', 'remove_participant', 'set_availability', 'lock_time', 'unlock_time', 'toggle_reaction']);

interface Room {
  channel: RealtimeChannel;
  changeListeners: Set<() => void>;
  peerListeners: Set<(peers: PresencePeer[]) => void>;
  refs: number;
  subscribed: boolean;
  pendingTrack: PresencePeer | null;
  clientId: string;
}

export function createSupabaseStore(url: string, anonKey: string): DataStore {
  const client: SupabaseClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  const rooms = new Map<string, Room>();

  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result;
    try {
      result = await client.rpc(fn, args);
    } catch (err) {
      throw new StoreError('network', err instanceof Error ? err.message : 'network error');
    }
    if (result.error) {
      const message = result.error.message ?? '';
      if (/fetch|network|Failed to/i.test(message) && !/^(invalid|forbidden|not_found|rate_limited):/.test(message)) {
        throw new StoreError('network', message);
      }
      throw StoreError.fromMessage(message);
    }
    // Our own writes refresh our own screens straight away, without waiting for the realtime ping.
    if (MUTATIONS.has(fn)) queueMicrotask(() => rooms.forEach((r) => r.changeListeners.forEach((l) => l())));
    return result.data as T;
  }

  function room(eventId: string): Room {
    let r = rooms.get(eventId);
    if (r) return r;
    const clientId = newUuid();
    const channel = client.channel(`event:${eventId}`, { config: { broadcast: { self: false }, presence: { key: clientId } } });
    const created: Room = { channel, changeListeners: new Set(), peerListeners: new Set(), refs: 0, subscribed: false, pendingTrack: null, clientId };
    channel
      .on('broadcast', { event: 'changed' }, () => created.changeListeners.forEach((fn) => fn()))
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresencePeer>();
        const peers: PresencePeer[] = [];
        for (const [key, metas] of Object.entries(state)) {
          if (key === clientId) continue;
          const latest = metas[metas.length - 1];
          if (latest) peers.push({ clientId: key, participantId: latest.participantId, name: latest.name, emoji: latest.emoji, activity: latest.activity });
        }
        created.peerListeners.forEach((fn) => fn(peers));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Catch up on anything missed while (re)connecting.
          const first = !created.subscribed;
          created.subscribed = true;
          if (created.pendingTrack) void channel.track(created.pendingTrack);
          if (!first) created.changeListeners.forEach((fn) => fn());
        }
      });
    rooms.set(eventId, created);
    return created;
  }

  function release(eventId: string, r: Room): void {
    r.refs -= 1;
    if (r.refs <= 0) {
      void client.removeChannel(r.channel);
      rooms.delete(eventId);
    }
  }

  return {
    kind: 'supabase',

    createEvent: (event, host) =>
      call<CreatedEvent>('create_event', {
        p_event: event,
        p_host: host,
      }),

    async getSnapshot(eventId) {
      return parseSnapshot(await call('get_event', { p_event_id: eventId }));
    },

    verifyOrganizer: (eventId, token) => call<boolean>('verify_organizer', { p_event_id: eventId, p_token: token }),

    updateEvent: (eventId, token, patch) => call<void>('update_event', { p_event_id: eventId, p_token: token, p_patch: patch }),

    deleteEvent: (eventId, token) => call<void>('delete_event', { p_event_id: eventId, p_token: token }),

    async join(eventId, participant): Promise<Joined> {
      const r = await call<{ participant: unknown; token: string }>('join_event', { p_event_id: eventId, p_participant: participant });
      return { participant: parseParticipant(r.participant), token: r.token };
    },

    async updateParticipant(participantId, token, patch) {
      return parseParticipant(await call('update_participant', { p_participant_id: participantId, p_token: token, p_patch: patch }));
    },

    leave: (participantId, token) => call<void>('leave_event', { p_participant_id: participantId, p_token: token }),

    removeParticipant: (eventId, token, participantId) =>
      call<void>('remove_participant', { p_event_id: eventId, p_token: token, p_participant_id: participantId }),

    setAvailability: (participantId, token, blocks: Block[], responded) =>
      call<void>('set_availability', {
        p_participant_id: participantId,
        p_token: token,
        p_blocks: blocks.map((b) => ({ start: iso(b.start), end: iso(b.end), kind: b.kind })),
        p_responded: responded,
      }),

    async lock(eventId, token, start, end) {
      const l = await call('lock_time', { p_event_id: eventId, p_token: token, p_starts_at: iso(start), p_ends_at: iso(end) });
      return parseLock(l)!;
    },

    unlock: (eventId, token) => call<void>('unlock_time', { p_event_id: eventId, p_token: token }),

    toggleReaction: (participantId, token, emoji) => call<boolean>('toggle_reaction', { p_participant_id: participantId, p_token: token, p_emoji: emoji }),

    async recordView(eventId) {
      try {
        await call<void>('record_view', { p_event_id: eventId });
      } catch {
        // A missed view count is not worth bothering anyone about.
      }
    },

    subscribe(eventId, onChange) {
      const r = room(eventId);
      r.refs += 1;
      r.changeListeners.add(onChange);
      return () => {
        r.changeListeners.delete(onChange);
        release(eventId, r);
      };
    },

    presence(eventId, onPeers): PresenceHandle {
      const r = room(eventId);
      r.refs += 1;
      r.peerListeners.add(onPeers);
      let left = false;
      return {
        update(state) {
          const peer: PresencePeer = { ...state, clientId: r.clientId };
          r.pendingTrack = peer;
          if (r.subscribed) void r.channel.track(peer);
        },
        leave() {
          if (left) return;
          left = true;
          r.peerListeners.delete(onPeers);
          r.pendingTrack = null;
          if (r.subscribed) void r.channel.untrack();
          release(eventId, r);
        },
      };
    },
  };
}
