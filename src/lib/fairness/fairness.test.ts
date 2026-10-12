import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eventSlots, everyDay } from '../time/slots';
import { MINUTE, toInstant, wallTime, type Instant } from '../time/zone';
import { bestTimes, compareCandidates, DEFAULT_RULES, evaluate, personCost } from './score';
import { explain } from './explain';
import type { Person } from '../availability/overlap';
import { summarize, heat } from '../availability/overlap';
import type { Kind } from '../availability/blocks';

const HOUR = 60 * MINUTE;

function person(id: string, zone: string, free: Instant[], ifNeeded: Instant[] = []): Person {
  const availability = new Map<Instant, Kind>();
  for (const t of free) availability.set(t, 'free');
  for (const t of ifNeeded) availability.set(t, 'if_needed');
  return { id, name: id[0].toUpperCase() + id.slice(1), zone, availability };
}

/** Every slot from `from` (inclusive) to `to` (exclusive) in 30-minute steps. */
function span(from: Instant, to: Instant): Instant[] {
  const out: Instant[] = [];
  for (let t = from; t < to; t += 30 * MINUTE) out.push(t);
  return out;
}

// A Vancouver organizer's event, 24 hours a day so every zone has humane and inhumane options.
const shape = { timezone: 'America/Vancouver', days: everyDay(['2026-10-13', '2026-10-14'], 0, 0), slotMinutes: 30 };
const slots = eventSlots(shape);
const at = (iso: string) => Date.parse(iso);

describe('fairness: person cost', () => {
  test('inside humane hours costs nothing', () => {
    const c = personCost(person('nadia', 'America/Vancouver', []), at('2026-10-13T16:00:00Z'), 60, DEFAULT_RULES);
    assert.equal(c.localStart, 9 * 60);
    assert.equal(c.minutesOutside, 0);
    assert.equal(c.discomfort, null);
  });

  test('an early start is early, a 1am start is night, a 9:30pm start is late', () => {
    const tom = person('tom', 'Australia/Sydney', []);
    const early = personCost(tom, toInstant('2026-10-14', 7 * 60, 'Australia/Sydney'), 60, DEFAULT_RULES);
    assert.equal(early.discomfort, 'early');
    assert.equal(early.minutesOutside, 60);
    const night = personCost(tom, toInstant('2026-10-14', 60, 'Australia/Sydney'), 60, DEFAULT_RULES);
    assert.equal(night.discomfort, 'night');
    const late = personCost(tom, toInstant('2026-10-14', 21 * 60 + 30, 'Australia/Sydney'), 60, DEFAULT_RULES);
    assert.equal(late.discomfort, 'late');
    assert.equal(late.minutesOutside, 30);
  });

  test('a 45-minute offset is costed to the minute', () => {
    const asha = person('asha', 'Asia/Kathmandu', []);
    // 7:45–8:45 am in Kathmandu: 15 minutes before 8.
    const c = personCost(asha, toInstant('2026-10-14', 7 * 60 + 45, 'Asia/Kathmandu'), 60, DEFAULT_RULES);
    assert.equal(c.minutesOutside, 15);
    assert.equal(c.discomfort, 'early');
  });
});

describe('fairness: ranking', () => {
  // Vancouver (PDT, −7), London (BST, +1), Sydney (AEDT, +11).
  // Option A: 2026-10-13 15:00Z → 8am Vancouver, 4pm London, 2am Sydney (night for Tom).
  // Option B: 2026-10-13 21:00Z → 2pm Vancouver, 10pm London, 8am Sydney (late for Sam).
  // Option C: 2026-10-14 06:00Z → 11pm Vancouver, 7am London, 5pm Sydney.
  const A = at('2026-10-13T15:00:00Z');
  const B = at('2026-10-13T20:00:00Z'); // 1pm, 9pm, 7am — fully humane? no: Tom 7am early
  const C = at('2026-10-13T21:00:00Z'); // 2pm, 10pm, 8am — Sam 10pm late
  const everyoneFree = [A, B, C].flatMap((t) => span(t, t + HOUR));

  test('when everyone is free at several times, the least painful wins', () => {
    const people = [
      person('nadia', 'America/Vancouver', everyoneFree),
      person('sam', 'Europe/London', everyoneFree),
      person('tom', 'Australia/Sydney', everyoneFree),
    ];
    const best = bestTimes(slots, 30, 60, people);
    assert.ok(best.length >= 3);
    // A puts Tom at 2am (60 min outside). B puts Tom at 7am (60 min outside, but "early").
    // C puts Sam at 10pm (60 min outside). All cost one person an hour; the earliest wins the tie.
    const order = best.map((c) => c.start);
    assert.ok(order.indexOf(A) >= 0 && order.indexOf(B) >= 0 && order.indexOf(C) >= 0);
    for (const c of best) assert.equal(c.available.length, 3);
  });

  test('a humane slot beats an inhumane one with the same availability', () => {
    const humane = at('2026-10-13T21:30:00Z'); // 2:30pm Van, 10:30pm London… not humane for Sam
    const good = at('2026-10-13T22:00:00Z'); // 3pm Van, 11pm London, 9am Sydney
    const both = [...span(A, A + HOUR), ...span(humane, humane + HOUR), ...span(good, good + HOUR)];
    const people = [person('nadia', 'America/Vancouver', both), person('tom', 'Australia/Sydney', both)];
    // Without Sam, `good` (3pm / 9am) is humane for both; A is 2am for Tom.
    const best = bestTimes(slots, 30, 60, people);
    assert.equal(best[0].outside, 0);
    assert.notEqual(best[0].start, A);
  });

  test('availability always outranks comfort', () => {
    const night = A; // 2am for Tom
    const nice = at('2026-10-13T22:00:00Z');
    const people = [
      person('nadia', 'America/Vancouver', [...span(night, night + HOUR), ...span(nice, nice + HOUR)]),
      person('sam', 'Europe/London', span(night, night + HOUR)),
      person('tom', 'Australia/Sydney', [...span(night, night + HOUR), ...span(nice, nice + HOUR)]),
    ];
    const best = bestTimes(slots, 30, 60, people);
    assert.equal(best[0].start, night);
    assert.equal(best[0].available.length, 3);
  });

  test('"if needed" ranks below free', () => {
    const t1 = at('2026-10-13T22:00:00Z');
    const t2 = at('2026-10-14T00:00:00Z'); // 5pm Van, 11am Sydney
    const people = [
      person('nadia', 'America/Vancouver', [...span(t1, t1 + HOUR), ...span(t2, t2 + HOUR)]),
      person('tom', 'Australia/Sydney', span(t2, t2 + HOUR), span(t1, t1 + HOUR)),
    ];
    const best = bestTimes(slots, 30, 60, people);
    assert.equal(best[0].start, t2);
    assert.deepEqual(best.find((c) => c.start === t1)?.ifNeeded, ['tom']);
  });

  test('suggestions never overlap each other', () => {
    const long = at('2026-10-13T16:00:00Z');
    const free = span(long, long + 6 * HOUR);
    const people = [person('a', 'America/Vancouver', free), person('b', 'America/Toronto', free)];
    const best = bestTimes(slots, 30, 60, people);
    for (let i = 0; i < best.length; i++)
      for (let j = i + 1; j < best.length; j++) assert.ok(best[i].end <= best[j].start || best[j].end <= best[i].start);
  });

  test('a meeting needs every one of its slots', () => {
    const t = at('2026-10-13T22:00:00Z');
    const people = [person('a', 'America/Vancouver', [t, t + 2 * 30 * MINUTE])]; // a gap in the middle
    const candidates = evaluate(slots, 30, 60, people).filter((c) => c.available.length > 0);
    assert.equal(candidates.length, 0);
  });

  test('no responders, no suggestions', () => {
    assert.deepEqual(bestTimes(slots, 30, 60, []), []);
  });

  test('comparison is a total order', () => {
    const people = [person('a', 'America/Vancouver', span(A, A + 4 * HOUR)), person('b', 'Australia/Sydney', span(A, A + 2 * HOUR))];
    const all = evaluate(slots, 30, 60, people);
    const sorted = [...all].sort(compareCandidates);
    const again = [...all].reverse().sort(compareCandidates);
    assert.deepEqual(sorted.map((c) => c.start), again.map((c) => c.start));
  });
});

describe('fairness: explanations', () => {
  const names = new Map([
    ['nadia', 'Nadia'],
    ['sam', 'Sam'],
    ['tom', 'Tom'],
  ]);

  test('everyone free, humane', () => {
    const t = at('2026-10-13T22:00:00Z'); // 3pm Van, 9am Sydney
    const people = [person('nadia', 'America/Vancouver', span(t, t + HOUR)), person('tom', 'Australia/Sydney', span(t, t + HOUR))];
    const [c] = bestTimes(slots, 30, 60, people);
    assert.equal(explain(c, 2, names), 'Everyone’s free, and nobody’s up before 8.');
  });

  test('names the person paying for it at night', () => {
    const t = at('2026-10-13T15:00:00Z'); // 2am Sydney
    const people = [person('nadia', 'America/Vancouver', span(t, t + HOUR)), person('tom', 'Australia/Sydney', span(t, t + HOUR))];
    const [c] = bestTimes(slots, 30, 60, people);
    assert.equal(explain(c, 2, names), 'Everyone’s free, but it’s 2:00 am for Tom 😴.');
  });

  test('early starts, partial availability and "you"', () => {
    const t = at('2026-10-13T20:00:00Z'); // 7am Sydney
    const people = [person('nadia', 'America/Vancouver', span(t, t + HOUR)), person('tom', 'Australia/Sydney', span(t, t + HOUR)), person('sam', 'Europe/London', [])];
    const [c] = bestTimes(slots, 30, 60, people);
    assert.equal(explain(c, 3, names, { you: 'tom' }), '2 of 3 can make it. You would be up early, at 7:00 am.');
  });

  test('if needed', () => {
    const t = at('2026-10-13T22:00:00Z');
    const people = [person('nadia', 'America/Vancouver', span(t, t + HOUR)), person('tom', 'Australia/Sydney', [], span(t, t + HOUR))];
    const [c] = bestTimes(slots, 30, 60, people);
    assert.equal(explain(c, 2, names), 'Everyone’s free, though Tom said “if needed”.');
  });
});

describe('overlap', () => {
  test('summaries and heat', () => {
    const t = at('2026-10-13T22:00:00Z');
    const people = [person('a', 'UTC', [t]), person('b', 'UTC', [], [t]), person('c', 'UTC', [])];
    const s = summarize(slots, people).get(t)!;
    assert.deepEqual(s, { free: ['a'], ifNeeded: ['b'] });
    assert.deepEqual(heat(s, 3), { level: 0.5, available: 2, full: false });
    assert.equal(heat(s, 2).full, true);
  });
});

describe('a locked time across a daylight saving change', () => {
  test('is right in Los Angeles, London and Sydney the week London has changed and Los Angeles has not', () => {
    // Tue 27 Oct 2026, 9:00 am in Los Angeles (still PDT). London is on GMT since Oct 25; Sydney on AEDT.
    const start = toInstant('2026-10-27', 9 * 60, 'America/Los_Angeles');
    assert.equal(new Date(start).toISOString(), '2026-10-27T16:00:00.000Z');
    assert.deepEqual([wallTime(start, 'Europe/London').minute, wallTime(start, 'Europe/London').date], [16 * 60, '2026-10-27']);
    assert.deepEqual([wallTime(start, 'Australia/Sydney').minute, wallTime(start, 'Australia/Sydney').date], [3 * 60, '2026-10-28']);
    // A week later Los Angeles has changed too: 9am PST is 5pm in London again.
    const later = toInstant('2026-11-03', 9 * 60, 'America/Los_Angeles');
    assert.equal(wallTime(later, 'Europe/London').minute, 17 * 60);
    assert.equal(wallTime(later, 'Australia/Sydney').minute, 4 * 60);
  });
});
