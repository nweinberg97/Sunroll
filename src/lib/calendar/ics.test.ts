import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, foldLine, googleCalendarUrl, icsDate, icsEscape, outlookCalendarUrl } from './ics';

const start = Date.parse('2026-10-27T16:00:00Z');
const end = Date.parse('2026-10-27T17:00:00Z');
const stamp = Date.parse('2026-10-12T03:00:00Z');

describe('ics', () => {
  test('dates are UTC basic format', () => {
    assert.equal(icsDate(start), '20261027T160000Z');
  });

  test('escapes text', () => {
    assert.equal(icsEscape('Game night; snacks, drinks\nBring dice\\cards'), 'Game night\\; snacks\\, drinks\\nBring dice\\\\cards');
  });

  test('folds long lines at 75 octets without breaking characters', () => {
    const line = 'DESCRIPTION:' + '🎲'.repeat(40);
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.equal(folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join(''), line);
  });

  test('a complete VEVENT', () => {
    const ics = buildIcs({ uid: 'abc123-lock@sunroll', sequence: 2, start, end, stamp, title: 'Family call 📞', description: 'Found with Sunroll', url: 'https://sunroll.app/e/abc123' });
    assert.ok(ics.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(ics), 'every line ends in CRLF');
    for (const needle of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'UID:abc123-lock@sunroll', 'SEQUENCE:2', 'DTSTART:20261027T160000Z', 'DTEND:20261027T170000Z', 'DTSTAMP:20261012T030000Z', 'SUMMARY:Family call 📞', 'URL:https://sunroll.app/e/abc123', 'END:VCALENDAR']) {
      assert.ok(ics.includes(needle), needle);
    }
  });
});

describe('calendar links', () => {
  test('Google', () => {
    const url = new URL(googleCalendarUrl({ start, end, title: 'Game night', url: 'https://sunroll.app/e/x' }));
    assert.equal(url.hostname, 'calendar.google.com');
    assert.equal(url.searchParams.get('dates'), '20261027T160000Z/20261027T170000Z');
    assert.equal(url.searchParams.get('text'), 'Game night');
  });
  test('Outlook personal and work', () => {
    const personal = new URL(outlookCalendarUrl({ start, end, title: 'Game night' }));
    assert.equal(personal.hostname, 'outlook.live.com');
    assert.equal(personal.searchParams.get('startdt'), '2026-10-27T16:00:00.000Z');
    assert.equal(new URL(outlookCalendarUrl({ start, end, title: 'x' }, 'work')).hostname, 'outlook.office.com');
  });
});
