import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemo } from './demo';
import { createLocalStore, type KeyValue } from './data/local';
import { buildModel } from './model';
import { bestTimes } from './fairness/score';
import { wallTime } from './time/zone';

test('the demo tells its story: four people, one niche day, a clear best time', async () => {
  const m = new Map<string, string>();
  const storage: KeyValue = { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
  const store = createLocalStore({ storage, channelPrefix: `demo-${Math.random()}` });
  const demo = await createDemo(store);
  const snap = (await store.getSnapshot(demo.eventId))!;
  assert.deepEqual(snap.participants.map((p) => p.name).sort(), ['Brian', 'Luke', 'Maddie', 'Nadia']);
  assert.equal(snap.event.days.length, 5);
  assert.deepEqual(snap.event.days.map((d) => d.startMin), [1020, 1020, 600, 1020, 1020], 'one day is a late-morning window');

  const model = buildModel(snap);
  assert.equal(model.responders.length, 4);
  const best = bestTimes(model.slots, 30, 60, model.people);
  assert.equal(best[0].available.length, 4, 'everyone can make the top time');
  assert.equal(best[0].ifNeeded.length, 0, 'and nobody has to stretch for it');
  // Day 5, 6:00–7:00 pm in Vancouver.
  assert.equal(wallTime(best[0].start, 'America/Vancouver').minute, 18 * 60);
  assert.equal(await store.verifyOrganizer(demo.eventId, demo.organizerToken), true);
});
