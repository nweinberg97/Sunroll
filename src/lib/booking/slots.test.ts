import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bookableSlots, hoursApart, isBookable, mergeIntervals, WORKDAYS, type SlotRules } from './slots';
import { toInstant, wallTime, MINUTE } from '../time/zone';

const iso = (t: number) => new Date(t).toISOString();
const london: SlotRules = { zone: 'Europe/London', hours: WORKDAYS(9 * 60, 17 * 60), durationMin: 30, bufferMin: 0, minNoticeMin: 0, dailyLimit: null, stepMin: 30 };
const far = Date.parse('2026-01-01T00:00:00Z');

describe('booking slots', () => {
  test('a plain working day', () => {
    const s = bookableSlots(london, { from: '2026-10-19', days: 1, now: far, busy: [], bookings: [] });
    assert.equal(s.length, 16);
    assert.equal(iso(s[0]), '2026-10-19T08:00:00.000Z'); // 9:00 BST
  });

  test('weekends are closed', () => {
    assert.equal(bookableSlots(london, { from: '2026-10-17', days: 2, now: far, busy: [], bookings: [] }).length, 0);
  });

  test('busy blocks from several calendars merge, and buffers keep breathing room', () => {
    const at = (h: number, m = 0) => toInstant('2026-10-19', h * 60 + m, 'Europe/London');
    // Personal calendar 10:00–10:30, work calendar 10:15–11:00: one busy stretch 10:00–11:00.
    const busy = [
      { start: at(10), end: at(10, 30) },
      { start: at(10, 15), end: at(11) },
    ];
    assert.deepEqual(mergeIntervals(busy), [{ start: at(10), end: at(11) }]);
    const s = bookableSlots({ ...london, bufferMin: 15 }, { from: '2026-10-19', days: 1, now: far, busy, bookings: [] });
    const local = s.map((t) => wallTime(t, 'Europe/London').minute / 60);
    assert.ok(!local.includes(9.5), '9:30 would end inside the buffer before 10:00');
    assert.ok(!local.includes(11), '11:00 starts inside the buffer after 11:00');
    assert.ok(local.includes(9) && local.includes(11.5));
  });

  test('minimum notice', () => {
    const now = toInstant('2026-10-19', 9 * 60 + 40, 'Europe/London');
    const s = bookableSlots({ ...london, minNoticeMin: 60 }, { from: '2026-10-19', days: 1, now, busy: [], bookings: [] });
    assert.equal(wallTime(s[0], 'Europe/London').minute, 11 * 60);
  });

  test('daily limit counts bookings on the host’s own calendar day', () => {
    const b = (h: number) => ({ start: toInstant('2026-10-19', h * 60, 'Europe/London'), end: toInstant('2026-10-19', h * 60 + 30, 'Europe/London') });
    const s = bookableSlots({ ...london, dailyLimit: 2 }, { from: '2026-10-19', days: 2, now: far, busy: [], bookings: [b(9), b(14)] });
    assert.ok(s.every((t) => wallTime(t, 'Europe/London').date === '2026-10-20'), 'Monday is full');
    assert.equal(s.length, 16);
  });

  test('the week the clocks change: 9 am stays 9 am for the host', () => {
    const before = bookableSlots(london, { from: '2026-10-23', days: 1, now: far, busy: [], bookings: [] });
    const after = bookableSlots(london, { from: '2026-10-26', days: 1, now: far, busy: [], bookings: [] });
    assert.equal(iso(before[0]), '2026-10-23T08:00:00.000Z'); // BST
    assert.equal(iso(after[0]), '2026-10-26T09:00:00.000Z'); // GMT
    assert.equal(after.length, 16);
  });

  test('a spring-forward gap never produces duplicate or phantom slots', () => {
    const rules: SlotRules = { ...london, zone: 'America/Los_Angeles', hours: { 7: [{ start: 60, end: 240 }] } };
    const s = bookableSlots(rules, { from: '2027-03-14', days: 1, now: far, busy: [], bookings: [] });
    assert.deepEqual(s.map((t) => wallTime(t, 'America/Los_Angeles').minute), [60, 90, 180, 210]);
  });

  test('host and visitor 16 hours apart: the visitor sees the next day', () => {
    const rules: SlotRules = { ...london, zone: 'America/Los_Angeles' };
    const s = bookableSlots(rules, { from: '2026-10-20', days: 1, now: far, busy: [], bookings: [] });
    const first = wallTime(s[0], 'Asia/Tokyo');
    assert.equal(first.date, '2026-10-21');
    assert.equal(first.minute, 1 * 60); // 9:00 am Tuesday in LA = 1:00 am Wednesday in Tokyo
    assert.equal(hoursApart('America/Los_Angeles', 'Asia/Tokyo', s[0]), -16);
    assert.equal(hoursApart('Asia/Kathmandu', 'Europe/London', s[0]), 4.75);
  });

  test('a slot that was just booked is no longer bookable (double-booking guard)', () => {
    const start = toInstant('2026-10-19', 10 * 60, 'Europe/London');
    assert.equal(isBookable(london, start, { now: far, busy: [], bookings: [] }), true);
    assert.equal(isBookable(london, start, { now: far, busy: [], bookings: [{ start, end: start + 30 * MINUTE }] }), false);
    // Overlapping starts are also gone: a 30-min slot at 10:15 can't be offered with step 30 anyway,
    // but a 60-minute meeting at 9:30 would overlap the 10:00 booking.
    assert.equal(isBookable({ ...london, durationMin: 60 }, start - 30 * MINUTE, { now: far, busy: [], bookings: [{ start, end: start + 30 * MINUTE }] }), false);
  });
});
