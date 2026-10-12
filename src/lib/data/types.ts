/**
 * The domain model as the client sees it. Mirrors the database (see DESIGN.md §5) and the
 * JSON shape returned by the `get_event` function, with instants as UTC milliseconds.
 */
import type { Instant, IsoDate, Zone } from '../time/zone';
import type { DayRange } from '../time/ranges';
import type { Block, Kind } from '../availability/blocks';

export type ColorName = 'sun' | 'blue' | 'coral' | 'dusk' | 'mint';
export const COLOR_NAMES: ColorName[] = ['sun', 'blue', 'coral', 'dusk', 'mint'];

export type ReactionEmoji = '👍' | '🎉' | '😴' | '☕';
export const REACTIONS: ReactionEmoji[] = ['👍', '🎉', '😴', '☕'];

export interface EventRecord {
  id: string;
  title: string;
  emoji: string;
  color: ColorName;
  timezone: Zone;
  dates: IsoDate[];
  windowStartMin: number;
  windowEndMin: number;
  slotMinutes: number;
  durationMinutes: number;
  expectedCount: number | null;
  templateSlug: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  expiresAt: Instant;
}

export interface ParticipantRecord {
  id: string;
  eventId: string;
  name: string;
  emoji: string;
  color: ColorName;
  timezone: Zone;
  sleep: DayRange;
  work: DayRange;
  isOrganizer: boolean;
  respondedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface BlockRecord extends Block {
  participantId: string;
}

export interface LockRecord {
  start: Instant;
  end: Instant;
  version: number;
  lockedAt: Instant;
}

export interface ReactionRecord {
  participantId: string;
  emoji: ReactionEmoji;
  createdAt: Instant;
}

export interface EventSnapshot {
  event: EventRecord;
  participants: ParticipantRecord[];
  blocks: BlockRecord[];
  lock: LockRecord | null;
  reactions: ReactionRecord[];
}

export interface NewEvent {
  title: string;
  emoji: string;
  color: ColorName;
  timezone: Zone;
  dates: IsoDate[];
  windowStartMin: number;
  windowEndMin: number;
  slotMinutes: number;
  durationMinutes: number;
  expectedCount: number | null;
  templateSlug: string | null;
  referredByEventId: string | null;
}

export interface NewParticipant {
  name: string;
  emoji: string;
  color: ColorName;
  timezone: Zone;
  sleep?: DayRange;
  work?: DayRange;
}

export type ParticipantPatch = Partial<NewParticipant>;

export interface EventPatch {
  title?: string;
  emoji?: string;
  color?: ColorName;
  expectedCount?: number | null;
}

export interface CreatedEvent {
  eventId: string;
  organizerToken: string;
  participantId: string;
  participantToken: string;
}

export interface Joined {
  participant: ParticipantRecord;
  token: string;
}

/** What other people in the room are doing right now. Ephemeral; never stored. */
export interface PresencePeer {
  /** A per-tab id, so one person on two devices shows once per device. */
  clientId: string;
  participantId: string | null;
  name: string | null;
  emoji: string | null;
  activity: 'viewing' | 'painting';
}

export type { Kind };
