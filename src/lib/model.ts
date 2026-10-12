/**
 * Turn a raw event snapshot into what screens need: slots, each person's availability,
 * who has responded, which zones are involved. Pure and tested.
 */
import { eventSlots } from './time/slots';
import { cityOf, type Instant, type Zone } from './time/zone';
import { fromBlocks, type Availability } from './availability/blocks';
import type { Person } from './availability/overlap';
import type { EventSnapshot, ParticipantRecord } from './data/types';

export interface EventModel {
  snapshot: EventSnapshot;
  slots: Instant[];
  slotSet: Set<Instant>;
  availability: Map<string, Availability>;
  /** Everyone who has answered (painted something, or said none of these work). */
  responders: ParticipantRecord[];
  /** Joined but haven't answered yet. */
  waiting: ParticipantRecord[];
  /** Responders as inputs to the overlap and fairness engines. */
  people: Person[];
  host: ParticipantRecord | undefined;
  /** Distinct zones among participants, organizer's first. */
  zones: Zone[];
  /** Distinct place names, for copy like "Vancouver, London and Sydney". */
  cities: string[];
}

export function buildModel(snapshot: EventSnapshot): EventModel {
  const { event, participants, blocks } = snapshot;
  const slots = eventSlots(event);
  const slotSet = new Set(slots);

  const byParticipant = new Map<string, typeof blocks>();
  for (const b of blocks) {
    const list = byParticipant.get(b.participantId) ?? [];
    list.push(b);
    byParticipant.set(b.participantId, list);
  }
  const availability = new Map<string, Availability>();
  for (const p of participants) availability.set(p.id, fromBlocks(byParticipant.get(p.id) ?? [], slotSet, event.slotMinutes));

  const responders = participants.filter((p) => p.respondedAt !== null || (availability.get(p.id)?.size ?? 0) > 0);
  const waiting = participants.filter((p) => !responders.includes(p));
  const people: Person[] = responders.map((p) => ({ id: p.id, name: p.name, zone: p.timezone, availability: availability.get(p.id)! }));

  const host = participants.find((p) => p.isOrganizer);
  const zones: Zone[] = [];
  for (const z of [host?.timezone ?? event.timezone, ...participants.map((p) => p.timezone)]) if (!zones.includes(z)) zones.push(z);
  const cities = [...new Set(zones.map(cityOf))];

  return { snapshot, slots, slotSet, availability, responders, waiting, people, host, zones, cities };
}

/** "Vancouver", "Vancouver and London", "Vancouver, London and Sydney" */
export function joinList(items: string[], max = 3): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length > max) return `${items.slice(0, max).join(', ')} and ${items.length - max} more`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
