/**
 * Every person gets their own colour, matched to their avatar, so their blocks of time are
 * easy to follow. Colours are assigned by join order, so every viewer sees the same colours.
 * Gold is never a person's colour: it is reserved for "works for everyone".
 */
import type { ParticipantRecord } from './data/types';

export interface PersonColor {
  /** Blocks of time. */
  solid: string;
  /** Avatar background and soft fills. */
  soft: string;
  /** Text on the solid colour. */
  on: string;
  name: string;
}

// Distinct hues, ordered so the first few are the most different from each other.
export const PERSON_COLORS: PersonColor[] = [
  { name: 'blue', solid: '#2f4bff', soft: '#e1e6ff', on: '#ffffff' },
  { name: 'coral', solid: '#e8366d', soft: '#ffe0ea', on: '#ffffff' },
  { name: 'green', solid: '#0f9d6e', soft: '#d6f5ea', on: '#ffffff' },
  { name: 'purple', solid: '#7c4dff', soft: '#ebe3ff', on: '#ffffff' },
  { name: 'orange', solid: '#e8680c', soft: '#ffe8d6', on: '#ffffff' },
  { name: 'teal', solid: '#0b8fb3', soft: '#d5f1fa', on: '#ffffff' },
  { name: 'pink', solid: '#c026d3', soft: '#f8e0fb', on: '#ffffff' },
  { name: 'olive', solid: '#5f8a00', soft: '#e8f3d1', on: '#ffffff' },
];

/** Colour for each participant id, by join order. */
export function colorsFor(participants: ParticipantRecord[]): Map<string, PersonColor> {
  const ordered = [...participants].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return new Map(ordered.map((p, i) => [p.id, PERSON_COLORS[i % PERSON_COLORS.length]]));
}
