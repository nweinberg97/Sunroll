/**
 * The one interface every screen uses to read and write shared data.
 *
 * Two adapters implement it:
 *  - `local`    — browser storage + BroadcastChannel; zero setup, real-time across tabs.
 *  - `supabase` — Postgres functions + Realtime broadcast and presence.
 *
 * Screens never know which one they have. Swapping the backend touches nothing but this folder.
 */
import type { Block } from '../availability/blocks';
import type { Instant } from '../time/zone';
import type {
  CreatedEvent,
  EventPatch,
  EventSnapshot,
  Joined,
  LockRecord,
  NewEvent,
  NewParticipant,
  ParticipantPatch,
  ParticipantRecord,
  PresencePeer,
  ReactionEmoji,
} from './types';

export type StoreErrorCode = 'invalid' | 'forbidden' | 'not_found' | 'rate_limited' | 'network' | 'unknown';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StoreError';
  }

  /** Map a server message ("forbidden: only the organizer…") to a typed error. */
  static fromMessage(message: string): StoreError {
    const m = /^(invalid|forbidden|not_found|rate_limited):\s*(.*)$/s.exec(message);
    if (m) return new StoreError(m[1] as StoreErrorCode, m[2]);
    return new StoreError('unknown', message);
  }
}

export interface PresenceHandle {
  /** Update what this client is doing. */
  update(peer: Omit<PresencePeer, 'clientId'>): void;
  /** Stop announcing presence and listening for peers. */
  leave(): void;
}

export interface DataStore {
  readonly kind: 'local' | 'supabase';

  createEvent(event: NewEvent, host: NewParticipant): Promise<CreatedEvent>;
  getSnapshot(eventId: string): Promise<EventSnapshot | null>;
  verifyOrganizer(eventId: string, organizerToken: string): Promise<boolean>;
  updateEvent(eventId: string, organizerToken: string, patch: EventPatch): Promise<void>;
  deleteEvent(eventId: string, organizerToken: string): Promise<void>;

  join(eventId: string, participant: NewParticipant): Promise<Joined>;
  updateParticipant(participantId: string, token: string, patch: ParticipantPatch): Promise<ParticipantRecord>;
  leave(participantId: string, token: string): Promise<void>;
  removeParticipant(eventId: string, organizerToken: string, participantId: string): Promise<void>;

  /** Replace all of a participant's availability. `responded` marks them as having answered. */
  setAvailability(participantId: string, token: string, blocks: Block[], responded: boolean): Promise<void>;

  lock(eventId: string, organizerToken: string, start: Instant, end: Instant): Promise<LockRecord>;
  unlock(eventId: string, organizerToken: string): Promise<void>;
  toggleReaction(participantId: string, token: string, emoji: ReactionEmoji): Promise<boolean>;

  /** Count a view of the event link (aggregate only). Fire-and-forget. */
  recordView(eventId: string): Promise<void>;

  /** Called whenever anything about the event changes, from any client. */
  subscribe(eventId: string, onChange: () => void): () => void;

  /** Join the event's presence room. `onPeers` receives everyone else currently here. */
  presence(eventId: string, onPeers: (peers: PresencePeer[]) => void): PresenceHandle;
}
