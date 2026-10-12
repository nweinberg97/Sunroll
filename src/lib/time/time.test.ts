import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, cityOf, daysBetween, formatOffset, isIsoDate, isValidZone, toInstant, wallTime, weekdayOf } from './zone';
import { eventSlots, slotsCovering, windowLength, everyDay } from './slots';
import { buildGrid, naturalDayStart } from './grid';
import { inRange, minutesInside } from './ranges';
import { phaseOf } from './phase';
import { dayShift, formatDate, formatMinute, formatRowLabel, formatSpan } from './format';

const iso = (t: number) => new Date(t).toISOString();
const Z = (s: string) => Date.parse(s);

describe('zone: wall time → instant', () => {
  test('ordinary times', () => {
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'America/Vancouver')), '2026-10-13T16:00:00.000Z');
    assert.equal(iso(toInstant('2026-10-13', 17 * 60, 'Europe/London')), '2026-10-13T16:00:00.000Z');
    assert.equal(iso(toInstant('2026-10-14', 3 * 60, 'Australia/Sydney')), '2026-10-13T16:00:00.000Z');
  });

  test('half-hour and 45-minute offsets', () => {
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'Asia/Kolkata')), '2026-10-13T03:30:00.000Z'); // +5:30
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'Asia/Kathmandu')), '2026-10-13T03:15:00.000Z'); // +5:45
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'America/St_Johns')), '2026-10-13T11:30:00.000Z'); // −2:30 (NDT)
    assert.equal(iso(toInstant('2026-12-13', 9 * 60, 'America/St_Johns')), '2026-12-13T12:30:00.000Z'); // −3:30 (NST)
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'Pacific/Chatham')), '2026-10-12T19:15:00.000Z'); // +13:45
    assert.equal(iso(toInstant('2026-10-13', 9 * 60, 'Australia/Adelaide')), '2026-10-12T22:30:00.000Z'); // +10:30
  });

  test('spring-forward gap resolves forward (compatible)', () => {
    // Vancouver, 8 Mar 2026: 2:00 am jumps to 3:00 am.
    assert.equal(iso(toInstant('2026-03-08', 2 * 60 + 30, 'America/Vancouver')), '2026-03-08T10:30:00.000Z');
    assert.equal(iso(toInstant('2026-03-08', 3 * 60, 'America/Vancouver')), '2026-03-08T10:00:00.000Z');
    // London, 29 Mar 2026: 1:00 am jumps to 2:00 am.
    assert.equal(iso(toInstant('2026-03-29', 1 * 60 + 30, 'Europe/London')), '2026-03-29T01:30:00.000Z');
    // Sydney, 4 Oct 2026: 2:00 am jumps to 3:00 am.
    assert.equal(iso(toInstant('2026-10-04', 2 * 60 + 30, 'Australia/Sydney')), '2026-10-03T16:30:00.000Z');
  });

  test('fall-back repeat resolves to the earlier occurrence', () => {
    assert.equal(iso(toInstant('2026-11-01', 1 * 60 + 30, 'America/Los_Angeles')), '2026-11-01T08:30:00.000Z');
    assert.equal(iso(toInstant('2026-10-25', 1 * 60 + 30, 'Europe/London')), '2026-10-25T00:30:00.000Z');
    assert.equal(iso(toInstant('2026-04-05', 2 * 60 + 30, 'Australia/Sydney')), '2026-04-04T15:30:00.000Z');
  });

  test('minutes roll onto adjacent dates', () => {
    assert.equal(toInstant('2026-10-13', 1440 + 60, 'Europe/London'), toInstant('2026-10-14', 60, 'Europe/London'));
    assert.equal(toInstant('2026-10-13', -60, 'Europe/London'), toInstant('2026-10-12', 23 * 60, 'Europe/London'));
  });

  test('across the date line', () => {
    // Kiritimati is UTC+14, Pago Pago is UTC−11: 25 hours apart.
    const t = toInstant('2026-10-13', 9 * 60, 'Pacific/Kiritimati');
    assert.equal(iso(t), '2026-10-12T19:00:00.000Z');
    const w = wallTime(t, 'Pacific/Pago_Pago');
    assert.equal(w.date, '2026-10-12');
    assert.equal(w.minute, 8 * 60);
    assert.equal(w.offset, -660);
  });
});

describe('zone: instant → wall time', () => {
  test('reads offsets and weekdays', () => {
    const t = Z('2026-10-13T16:00:00Z');
    assert.deepEqual(wallTime(t, 'America/Vancouver'), { date: '2026-10-13', minute: 540, weekday: 2, offset: -420 });
    assert.deepEqual(wallTime(t, 'Australia/Sydney'), { date: '2026-10-14', minute: 180, weekday: 3, offset: 660 });
    assert.equal(wallTime(t, 'Asia/Kathmandu').minute, 21 * 60 + 45);
  });

  test('both sides of a fall-back repeat', () => {
    const first = wallTime(Z('2026-11-01T08:30:00Z'), 'America/Los_Angeles');
    const second = wallTime(Z('2026-11-01T09:30:00Z'), 'America/Los_Angeles');
    assert.equal(first.minute, 90);
    assert.equal(second.minute, 90);
    assert.equal(first.offset, -420);
    assert.equal(second.offset, -480);
  });

  test('round-trips across many zones and dates', () => {
    const zones = ['America/Los_Angeles', 'America/Vancouver', 'Europe/London', 'Australia/Sydney', 'Asia/Kathmandu', 'America/St_Johns', 'Pacific/Chatham', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'UTC'];
    for (const zone of zones) {
      for (const date of ['2026-01-15', '2026-03-08', '2026-03-29', '2026-04-05', '2026-10-04', '2026-10-25', '2026-11-01', '2026-12-31']) {
        for (const minute of [0, 59, 540, 750, 1439]) {
          const t = toInstant(date, minute, zone);
          const w = wallTime(t, zone);
          // Times that don't exist (DST gaps) legitimately move; everything else must round-trip.
          if (w.date === date && w.minute === minute) continue;
          const gapShift = (w.minute - minute + 1440) % 1440;
          assert.ok(gapShift === 60 || gapShift === 30, `${zone} ${date} ${minute} → ${w.date} ${w.minute}`);
        }
      }
    }
  });
});

describe('zone: independent of the device time zone', () => {
  test('same answers whatever process.env.TZ says', () => {
    const original = process.env.TZ;
    const results: string[] = [];
    for (const deviceZone of ['Pacific/Chatham', 'America/Los_Angeles', 'Asia/Kathmandu', 'UTC']) {
      process.env.TZ = deviceZone;
      const t = toInstant('2026-11-01', 90, 'America/Los_Angeles');
      const w = wallTime(Z('2026-10-25T00:30:00Z'), 'Europe/London');
      const slots = eventSlots({ timezone: 'Australia/Sydney', days: everyDay(['2026-10-04'], 0, 360), slotMinutes: 30 });
      results.push(JSON.stringify({ t, w, n: slots.length, first: slots[0] }));
    }
    process.env.TZ = original;
    assert.equal(new Set(results).size, 1, results.join('\n'));
  });
});

describe('zone: helpers', () => {
  test('validates zones', () => {
    assert.ok(isValidZone('America/Vancouver'));
    assert.ok(isValidZone('Asia/Kathmandu'));
    assert.ok(!isValidZone('Mars/Olympus_Mons'));
    assert.ok(!isValidZone('+05:30'));
    assert.ok(!isValidZone(''));
  });
  test('date arithmetic', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(daysBetween('2026-10-01', '2026-11-01'), 31);
    assert.equal(weekdayOf('2026-10-11'), 7);
    assert.ok(isIsoDate('2026-02-28'));
    assert.ok(!isIsoDate('2026-02-30'));
  });
  test('names and offsets', () => {
    assert.equal(cityOf('America/Vancouver'), 'Vancouver');
    assert.equal(cityOf('America/Argentina/Buenos_Aires'), 'Buenos Aires');
    assert.equal(cityOf('Asia/Calcutta'), 'Kolkata');
    assert.equal(formatOffset(-420), 'UTC−7');
    assert.equal(formatOffset(345), 'UTC+5:45');
    assert.equal(formatOffset(-150), 'UTC−2:30');
  });
});

describe('slots', () => {
  test('a plain window', () => {
    const s = eventSlots({ timezone: 'America/Vancouver', days: everyDay(['2026-10-13'], 540, 1020), slotMinutes: 30 });
    assert.equal(s.length, 16);
    assert.equal(iso(s[0]), '2026-10-13T16:00:00.000Z');
    assert.equal(iso(s[15]), '2026-10-13T23:30:00.000Z');
  });

  test('fall-back night has an extra hour of slots', () => {
    const s = eventSlots({ timezone: 'America/Los_Angeles', days: everyDay(['2026-11-01'], 0, 240), slotMinutes: 30 });
    assert.equal(s.length, 10); // 0:00–4:00 wall time is 5 real hours
  });

  test('spring-forward night has one hour fewer', () => {
    const s = eventSlots({ timezone: 'America/Vancouver', days: everyDay(['2026-03-08'], 0, 240), slotMinutes: 30 });
    assert.equal(s.length, 6);
  });

  test('windows crossing midnight', () => {
    const s = eventSlots({ timezone: 'Europe/London', days: everyDay(['2026-10-13', '2026-10-14'], 20 * 60, 2 * 60), slotMinutes: 30 });
    assert.equal(s.length, 24);
    assert.equal(iso(s[0]), '2026-10-13T19:00:00.000Z');
    assert.equal(iso(s[11]), '2026-10-14T00:30:00.000Z');
  });

  test('a full day, and windows ending at 24:00', () => {
    assert.equal(eventSlots({ timezone: 'UTC', days: everyDay(['2026-10-13'], 0, 0), slotMinutes: 30 }).length, 48);
    assert.equal(eventSlots({ timezone: 'UTC', days: everyDay(['2026-10-13'], 22 * 60, 1440), slotMinutes: 30 }).length, 4);
  });

  test('an organizer in Nepal produces quarter-past slots in UTC', () => {
    const s = eventSlots({ timezone: 'Asia/Kathmandu', days: everyDay(['2026-10-13'], 540, 600), slotMinutes: 30 });
    assert.deepEqual(s.map(iso), ['2026-10-13T03:15:00.000Z', '2026-10-13T03:45:00.000Z']);
  });

  test('different windows on different days', () => {
    // Mon 6–8 pm, Wed noon–2 pm, in Vancouver.
    const s = eventSlots({
      timezone: 'America/Vancouver',
      days: [
        { date: '2026-10-12', startMin: 18 * 60, endMin: 20 * 60 },
        { date: '2026-10-14', startMin: 12 * 60, endMin: 14 * 60 },
      ],
      slotMinutes: 30,
    });
    assert.deepEqual(s.map(iso), [
      '2026-10-13T01:00:00.000Z',
      '2026-10-13T01:30:00.000Z',
      '2026-10-13T02:00:00.000Z',
      '2026-10-13T02:30:00.000Z',
      '2026-10-14T19:00:00.000Z',
      '2026-10-14T19:30:00.000Z',
      '2026-10-14T20:00:00.000Z',
      '2026-10-14T20:30:00.000Z',
    ]);
  });

  test('covering slots for a meeting', () => {
    const s = eventSlots({ timezone: 'UTC', days: everyDay(['2026-10-13'], 540, 660), slotMinutes: 30 });
    const set = new Set(s);
    assert.equal(slotsCovering(s[0], 60, 30, set)?.length, 2);
    assert.equal(slotsCovering(s[3], 60, 30, set), null); // would run past the window
    assert.equal(windowLength(1200, 120), 360);
  });
});

describe('grid', () => {
  const vancouverEvening = { timezone: 'America/Vancouver', days: everyDay(['2026-10-13', '2026-10-14'], 9 * 60, 22 * 60), slotMinutes: 30 };

  test('organizer view is the organizer’s window', () => {
    const g = buildGrid(eventSlots(vancouverEvening), 'America/Vancouver');
    assert.deepEqual(g.columns.map((c) => c.date), ['2026-10-13', '2026-10-14']);
    assert.equal(g.rows.length, 26);
    assert.equal(g.rows[0].minute, 540);
    assert.equal(g.dayStartMinute, 540);
  });

  test('Sydney sees the same slots on their own days and hours', () => {
    const g = buildGrid(eventSlots(vancouverEvening), 'Australia/Sydney');
    assert.deepEqual(g.columns.map((c) => c.date), ['2026-10-14', '2026-10-15']);
    assert.equal(g.rows[0].minute, 3 * 60); // 9am Vancouver = 3am Sydney (AEDT)
    assert.equal(g.rows[g.rows.length - 1].minute, 15 * 60 + 30);
  });

  test('evenings stay together when the window crosses the viewer’s midnight', () => {
    const shape = { timezone: 'Europe/London', days: everyDay(['2026-10-13', '2026-10-14'], 18 * 60, 23 * 60), slotMinutes: 30 };
    const g = buildGrid(eventSlots(shape), 'Asia/Kolkata'); // 22:30–03:30 IST
    assert.equal(g.dayStartMinute, 22 * 60 + 30);
    assert.deepEqual(g.columns.map((c) => c.date), ['2026-10-13', '2026-10-14']);
    assert.equal(g.rows[0].minute, 22 * 60 + 30);
    assert.equal(g.rows[0].nextDay, false);
    const midnight = g.rows.findIndex((r) => r.minute === 0);
    assert.ok(midnight > 0);
    assert.equal(g.rows[midnight].nextDay, true);
    assert.ok(g.cells.every((row) => row.every((c) => c !== null)));
  });

  test('the repeated hour on a fall-back night gets its own row', () => {
    const shape = { timezone: 'America/Los_Angeles', days: everyDay(['2026-10-31', '2026-11-01'], 0, 180), slotMinutes: 30 };
    const slots = eventSlots(shape);
    const g = buildGrid(slots, 'America/Los_Angeles');
    const folded = g.rows.filter((r) => r.fold === 1);
    assert.deepEqual(folded.map((r) => r.minute), [60, 90]);
    assert.equal(g.position.size, slots.length);
    const cellsUsed = new Set([...g.position.values()].map((p) => `${p.row}:${p.col}`));
    assert.equal(cellsUsed.size, slots.length, 'no two slots share a cell');
    // On the 31st there is no second 1:00 am, so that cell is empty.
    const col31 = g.columns.findIndex((c) => c.date === '2026-10-31');
    assert.equal(g.cells[g.rows.indexOf(folded[0])][col31], null);
  });

  test('a viewer whose clocks change mid-event still sees every slot once', () => {
    // London falls back on Oct 25, Los Angeles on Nov 1: the gap is 8h, then 7h, then 8h again.
    const dates = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-30', '2026-11-01', '2026-11-02'];
    const slots = eventSlots({ timezone: 'America/Los_Angeles', days: everyDay(dates, 9 * 60, 17 * 60), slotMinutes: 30 });
    const g = buildGrid(slots, 'Europe/London');
    assert.equal(g.position.size, slots.length);
    assert.equal(g.rows[0].minute, 16 * 60); // 9am PDT = 4pm GMT during the 7-hour week
    const lastRowMinute = g.rows[g.rows.length - 1].minute;
    assert.equal(lastRowMinute, 30); // 4:30pm PST = 0:30 GMT on Nov 2 → shown under Nov 1, next day
    assert.ok(g.cells.some((row) => row.some((c) => c === null)), 'days with a different offset leave gaps');
  });

  test('across the date line', () => {
    const slots = eventSlots({ timezone: 'Pacific/Kiritimati', days: everyDay(['2026-10-13'], 9 * 60, 10 * 60), slotMinutes: 30 });
    const g = buildGrid(slots, 'Pacific/Pago_Pago');
    assert.deepEqual(g.columns.map((c) => c.date), ['2026-10-12']);
    assert.equal(g.rows[0].minute, 8 * 60);
  });

  test('natural day start', () => {
    assert.equal(naturalDayStart([540, 570, 600]), 540);
    assert.equal(naturalDayStart([0, 30, 1380, 1410]), 1380);
    assert.equal(naturalDayStart([]), 0);
  });
});

describe('ranges and phases', () => {
  test('wrapping ranges', () => {
    const sleep = { start: 23 * 60, end: 7 * 60 };
    assert.ok(inRange(23 * 60 + 30, sleep));
    assert.ok(inRange(3 * 60, sleep));
    assert.ok(!inRange(7 * 60, sleep));
    assert.ok(!inRange(12 * 60, sleep));
  });
  test('minutes inside a range', () => {
    const humane = { start: 8 * 60, end: 22 * 60 };
    assert.equal(minutesInside(7 * 60 + 45, 60, humane), 45);
    assert.equal(minutesInside(21 * 60 + 30, 60, humane), 30);
    assert.equal(minutesInside(23 * 60, 120, humane), 0);
    assert.equal(minutesInside(23 * 60 + 30, 600, humane), 90); // runs to 9:30 am next day: 8:00–9:30 inside
    assert.equal(minutesInside(23 * 60, 120, { start: 22 * 60, end: 2 * 60 }), 120);
  });
  test('phases', () => {
    assert.equal(phaseOf(60), 'night');
    assert.equal(phaseOf(6 * 60), 'dawn');
    assert.equal(phaseOf(12 * 60), 'day');
    assert.equal(phaseOf(19 * 60), 'dusk');
    assert.equal(phaseOf(22 * 60), 'night');
  });
});

describe('format', () => {
  test('times', () => {
    assert.equal(formatMinute(0), '12:00 am');
    assert.equal(formatMinute(13 * 60 + 5), '1:05 pm');
    assert.equal(formatMinute(13 * 60 + 5, '24h'), '13:05');
    assert.equal(formatRowLabel(9 * 60), '9 am');
    assert.equal(formatRowLabel(9 * 60 + 30), '9:30');
    assert.equal(formatRowLabel(21 * 60 + 45, '24h'), '21:45');
  });
  test('dates', () => {
    assert.equal(formatDate('2026-10-13'), 'Tue, Oct 13');
    assert.equal(formatDate('2026-10-13', 'en-GB'), 'Tue 13 Oct');
  });
  test('spans and day shifts', () => {
    const t = Z('2026-10-13T16:00:00Z');
    assert.equal(formatSpan(t, t + 3_600_000, 'America/Vancouver'), '9:00–10:00 am');
    assert.equal(formatSpan(t, t + 3_600_000, 'Europe/London'), '5:00–6:00 pm');
    assert.equal(formatSpan(t + 2.5 * 3_600_000, t + 3.5 * 3_600_000, 'America/Vancouver'), '11:30 am–12:30 pm');
    assert.equal(dayShift(t, 'Australia/Sydney', 'America/Vancouver'), 1);
    assert.equal(dayShift(t, 'Europe/London', 'America/Vancouver'), 0);
  });
});

describe('zone: exhaustive round trip over a whole year', () => {
  test('every 15 minutes of 2026 round-trips in zones with DST, odd offsets and the date line', () => {
    // America/Vancouver is left out on purpose: B.C. adopted permanent daylight time in 2026, so
    // its answer depends on how current the machine's tz data is. The engine follows the data.
    const zones = ['America/Los_Angeles', 'America/St_Johns', 'Europe/London', 'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Asia/Kathmandu', 'Pacific/Kiritimati'];
    const step = 15 * 60_000;
    const start = Date.parse('2026-01-01T00:00:00Z');
    const end = Date.parse('2027-01-01T00:00:00Z');
    for (const zone of zones) {
      let repeats = 0;
      for (let t = start; t < end; t += step) {
        const w = wallTime(t, zone);
        const back = toInstant(w.date, w.minute, zone);
        if (back === t) continue;
        // The only allowed mismatch: the second occurrence of a repeated (fall-back) wall time,
        // which resolves to its first occurrence, earlier by exactly the size of the change.
        assert.ok(back < t && t - back <= 60 * 60_000, `${zone} ${new Date(t).toISOString()} → ${new Date(back).toISOString()}`);
        assert.equal(wallTime(back, zone).minute, w.minute);
        repeats++;
      }
      // Zones with DST repeat one hour (or 30 minutes on Lord Howe) a year; others never.
      const expected = { 'Asia/Kathmandu': 0, 'Pacific/Kiritimati': 0, 'Australia/Lord_Howe': 2 }[zone] ?? 4;
      assert.equal(repeats, expected, `${zone} repeats`);
    }
  });
});
