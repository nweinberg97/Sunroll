import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockChanges, describeChange } from './changes';

test('finds the clock changes inside an event, to the minute', () => {
  const c = clockChanges(['Europe/London', 'America/Los_Angeles', 'Asia/Kathmandu', 'Australia/Lord_Howe'], '2026-10-20', '2026-11-05');
  const london = c.find((x) => x.zone === 'Europe/London')!;
  assert.equal(new Date(london.at).toISOString(), '2026-10-25T01:00:00.000Z');
  assert.equal(london.localDate, '2026-10-25');
  assert.equal(london.shift, -60);
  assert.equal(describeChange(london), 'Clocks go back 1 hour in London');
  const la = c.find((x) => x.zone === 'America/Los_Angeles')!;
  assert.equal(new Date(la.at).toISOString(), '2026-11-01T09:00:00.000Z');
  assert.ok(!c.some((x) => x.zone === 'Asia/Kathmandu'), 'no DST in Nepal');
  assert.ok(!c.some((x) => x.zone === 'Australia/Lord_Howe'), 'Lord Howe changes in April and October, outside this range');
});

test('half-hour changes (Lord Howe) and spring forward', () => {
  const c = clockChanges(['Australia/Lord_Howe', 'Australia/Sydney'], '2026-10-01', '2026-10-06');
  const lh = c.find((x) => x.zone === 'Australia/Lord_Howe')!;
  assert.equal(lh.shift, 30);
  assert.equal(describeChange(lh), 'Clocks go forward 30 minutes in Lord Howe');
  assert.equal(c.find((x) => x.zone === 'Australia/Sydney')!.shift, 60);
});

test('no changes, no notes', () => {
  assert.deepEqual(clockChanges(['Asia/Tokyo', 'UTC'], '2026-01-01', '2026-12-31'), []);
});
