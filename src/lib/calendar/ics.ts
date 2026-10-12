/**
 * Calendar export. The .ics is written in UTC ("Z" times), which every calendar app
 * imports correctly and then shows in its own zone, so there is no VTIMEZONE to get
 * wrong. A stable UID plus an increasing SEQUENCE lets a re-import after the organizer
 * changes the time update the same entry rather than adding a second one.
 */
import type { Instant } from '../time/zone';

export interface CalendarEvent {
  uid: string;
  sequence: number;
  start: Instant;
  end: Instant;
  title: string;
  description?: string;
  url?: string;
  /** When the file is generated. Injected so the output is deterministic in tests. */
  stamp: Instant;
}

/** 20261013T160000Z */
export function icsDate(instant: Instant): string {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape TEXT values per RFC 5545 §3.3.11. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets per RFC 5545 §3.1, without splitting UTF-8 characters. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = ch;
      currentBytes = bytes;
      limit = 74; // continuation lines start with a space
    } else {
      current += ch;
      currentBytes += bytes;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(e: CalendarEvent, productName = 'Sunroll'): string {
  const description = [e.description, e.url].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${productName}//${productName}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsDate(e.stamp)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Google Calendar "add event" link. */
export function googleCalendarUrl(e: Omit<CalendarEvent, 'uid' | 'sequence' | 'stamp'>): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.start)}/${icsDate(e.end)}`,
    details: [e.description, e.url].filter(Boolean).join('\n\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook "add event" link: 'personal' for Outlook.com, 'work' for Microsoft 365. */
export function outlookCalendarUrl(e: Omit<CalendarEvent, 'uid' | 'sequence' | 'stamp'>, kind: 'personal' | 'work' = 'personal'): string {
  const host = kind === 'work' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: e.title,
    startdt: new Date(e.start).toISOString(),
    enddt: new Date(e.end).toISOString(),
    body: [e.description, e.url].filter(Boolean).join('\n\n'),
  });
  return `${host}/calendar/0/deeplink/compose?${params.toString()}`;
}
