/**
 * A live, realistic demo event: you play Nadia (the organizer) and Luke, Maddie and Brian
 * have already answered. It is created through the same DataStore as any real event, so the
 * demo is the real product, not a mock-up.
 *
 * Story: Nadia offers evenings on most days, but on one day only a late-morning window.
 * Everyone's times are written as Vancouver wall-clock ranges for readability; people live
 * in different zones and the app shows each of them their own local time.
 */
import { addDays, MINUTE, toInstant, wallTime, type Instant, type IsoDate } from './time/zone';
import { toBlocks, type Kind } from './availability/blocks';
import type { DataStore } from './data/store';
import type { DayWindow } from './time/slots';

const ZONE = 'America/Vancouver';
const h = (hours: number) => Math.round(hours * 60);

interface Pick {
  day: number;
  from: number;
  to: number;
  kind?: Kind;
}

/** Day 2 is the "niche" day: Nadia only has a late morning free. */
const WINDOWS: { start: number; end: number }[] = [
  { start: h(17), end: h(22) },
  { start: h(17), end: h(22) },
  { start: h(10), end: h(13) },
  { start: h(17), end: h(22) },
  { start: h(17), end: h(22) },
];

const PEOPLE: { name: string; emoji: string; zone: string; picks: Pick[] }[] = [
  {
    name: 'Luke',
    emoji: '🦉',
    zone: 'America/Toronto',
    picks: [
      { day: 0, from: 19, to: 21.5 },
      { day: 2, from: 10, to: 12 },
      { day: 3, from: 18, to: 20 },
      { day: 3, from: 20, to: 21, kind: 'if_needed' },
      { day: 4, from: 17.5, to: 19 },
    ],
  },
  {
    name: 'Maddie',
    emoji: '🌸',
    zone: 'America/Denver',
    picks: [
      { day: 0, from: 17, to: 19 },
      { day: 1, from: 17, to: 22 },
      { day: 2, from: 11, to: 13 },
      { day: 3, from: 19.5, to: 21 },
      { day: 4, from: 18, to: 20 },
    ],
  },
  {
    name: 'Brian',
    emoji: '🐢',
    zone: 'America/Vancouver',
    picks: [
      { day: 0, from: 18.5, to: 20 },
      { day: 2, from: 10.5, to: 12, kind: 'if_needed' },
      { day: 3, from: 19, to: 21.5 },
      { day: 4, from: 17, to: 19.5 },
    ],
  },
];

const NADIA: Pick[] = [
  { day: 0, from: 18, to: 21 },
  { day: 1, from: 17, to: 19 },
  { day: 2, from: 10.5, to: 12.5 },
  { day: 3, from: 19, to: 22 },
  { day: 4, from: 17, to: 20 },
];

function availability(days: IsoDate[], picks: Pick[]): Map<Instant, Kind> {
  const out = new Map<Instant, Kind>();
  for (const p of picks) {
    const start = toInstant(days[p.day], h(p.from), ZONE);
    const end = toInstant(days[p.day], h(p.to), ZONE);
    for (let t = start; t < end; t += 30 * MINUTE) out.set(t, p.kind ?? 'free');
  }
  return out;
}

export interface DemoEvent {
  eventId: string;
  organizerToken: string;
  participantId: string;
  participantToken: string;
}

/** Create a fresh demo event. You are Nadia; the others have already answered. */
export async function createDemo(store: DataStore): Promise<DemoEvent> {
  const tomorrow = addDays(wallTime(Date.now(), ZONE).date, 1);
  const days = WINDOWS.map((_, i) => addDays(tomorrow, i));
  const dayWindows: DayWindow[] = days.map((date, i) => ({ date, startMin: WINDOWS[i].start, endMin: WINDOWS[i].end }));

  const created = await store.createEvent(
    {
      title: 'Game night',
      emoji: '🎲',
      color: 'sun',
      timezone: ZONE,
      days: dayWindows,
      slotMinutes: 30,
      durationMinutes: 60,
      expectedCount: 4,
      templateSlug: 'game-night',
      referredByEventId: null,
    },
    { name: 'Nadia', emoji: '🌻', color: 'coral', timezone: ZONE },
  );

  for (const person of PEOPLE) {
    const joined = await store.join(created.eventId, { name: person.name, emoji: person.emoji, color: 'blue', timezone: person.zone });
    await store.setAvailability(joined.participant.id, joined.token, toBlocks(availability(days, person.picks), 30), true);
  }
  await store.setAvailability(created.participantId, created.participantToken, toBlocks(availability(days, NADIA), 30), true);
  return created;
}
