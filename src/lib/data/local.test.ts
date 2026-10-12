import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore, type KeyValue } from './local';
import { StoreError } from './store';
import type { NewEvent, NewParticipant } from './types';

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

const now = Date.parse('2026-10-12T03:00:00Z');
const event: NewEvent = {
  title: ' Game night ',
  emoji: '🎲',
  color: 'sun',
  timezone: 'America/Vancouver',
  days: [
    { date: '2026-10-16', startMin: 18 * 60, endMin: 23 * 60 },
    { date: '2026-10-15', startMin: 17 * 60, endMin: 21 * 60 },
  ],
  slotMinutes: 30,
  durationMinutes: 120,
  expectedCount: 4,
  templateSlug: 'game-night',
  referredByEventId: null,
};
const host: NewParticipant = { name: 'Nadia', emoji: '🌻', color: 'coral', timezone: 'America/Vancouver' };

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof StoreError && e.code === code);
}

describe('local adapter behaves like the server', () => {
  test('the whole journey', async () => {
    const store = createLocalStore({ storage: memory(), channelPrefix: `t-${Math.random()}`, now: () => now });
    const created = await store.createEvent(event, host);
    const snap = await store.getSnapshot(created.eventId);
    assert.ok(snap);
    assert.equal(snap.event.title, 'Game night');
    assert.deepEqual(snap.event.days, [
      { date: '2026-10-15', startMin: 17 * 60, endMin: 21 * 60 },
      { date: '2026-10-16', startMin: 18 * 60, endMin: 23 * 60 },
    ]);
    assert.equal(snap.participants.length, 1);
    assert.ok(snap.participants[0].isOrganizer);
    assert.ok(!JSON.stringify(snap).includes(created.organizerToken), 'no secrets in snapshots');
    assert.ok(!JSON.stringify(snap).includes('Hash'), 'no hashes in snapshots');

    const sam = await store.join(created.eventId, { name: 'Sam', emoji: '🦊', color: 'blue', timezone: 'Europe/London' });
    const start = Date.parse('2026-10-16T01:00:00Z');
    await store.setAvailability(sam.participant.id, sam.token, [{ start, end: start + 3_600_000, kind: 'free' }], true);
    const after = (await store.getSnapshot(created.eventId))!;
    assert.equal(after.blocks.length, 1);
    assert.ok(after.participants.find((p) => p.name === 'Sam')?.respondedAt);

    await rejects(store.setAvailability(sam.participant.id, created.participantToken, [], true), 'forbidden');
    await rejects(store.lock(created.eventId, sam.token, start, start + 3_600_000), 'forbidden');
    assert.equal(await store.verifyOrganizer(created.eventId, created.organizerToken), true);
    assert.equal(await store.verifyOrganizer(created.eventId, sam.token), false);

    const lock1 = await store.lock(created.eventId, created.organizerToken, start, start + 7_200_000);
    const lock2 = await store.lock(created.eventId, created.organizerToken, start + 1_800_000, start + 9_000_000);
    assert.deepEqual([lock1.version, lock2.version], [1, 2]);

    assert.equal(await store.toggleReaction(sam.participant.id, sam.token, '☕'), true);
    assert.equal(await store.toggleReaction(sam.participant.id, sam.token, '☕'), false);

    await rejects(store.leave(created.participantId, created.participantToken), 'invalid');
    await store.leave(sam.participant.id, sam.token);
    assert.equal((await store.getSnapshot(created.eventId))!.blocks.length, 0);

    await rejects(store.deleteEvent(created.eventId, 'nope'), 'forbidden');
    await store.deleteEvent(created.eventId, created.organizerToken);
    assert.equal(await store.getSnapshot(created.eventId), null);
  });

  test('validation and limits', async () => {
    const store = createLocalStore({ storage: memory(), channelPrefix: `t-${Math.random()}`, now: () => now });
    await rejects(store.createEvent({ ...event, title: '  ' }, host), 'invalid');
    await rejects(store.createEvent({ ...event, timezone: 'Mars/Base' }, host), 'invalid');
    await rejects(store.createEvent({ ...event, durationMinutes: 600 }, host), 'invalid');
    await rejects(store.createEvent({ ...event, days: [{ date: '2026-10-15', startMin: 18 * 60, endMin: 19 * 60 }] }, { ...host }), 'invalid'); // 2-hour meeting, 1-hour day
    await rejects(store.createEvent({ ...event, days: [event.days[0], event.days[0]] }, host), 'invalid'); // the same day twice
    await rejects(store.createEvent(event, { ...host, name: '' }), 'invalid');
    await rejects(store.join('11111111111111', host), 'not_found');
    const created = await store.createEvent(event, host);
    const p = await store.join(created.eventId, host);
    await rejects(store.setAvailability(p.participant.id, p.token, [{ start: Date.parse('2030-01-01T00:00:00Z'), end: Date.parse('2030-01-01T01:00:00Z'), kind: 'free' }], true), 'invalid');
    for (let i = 0; i < 19; i++) await store.createEvent(event, host);
    await rejects(store.createEvent(event, host), 'rate_limited');
  });

  test('changes reach subscribers', async () => {
    const store = createLocalStore({ storage: memory(), channelPrefix: `t-${Math.random()}`, now: () => now });
    const created = await store.createEvent(event, host);
    let calls = 0;
    const off = store.subscribe(created.eventId, () => calls++);
    await store.join(created.eventId, { ...host, name: 'Priya' });
    off();
    await store.join(created.eventId, { ...host, name: 'Tom' });
    assert.equal(calls, 1);
  });

  test('expired events are purged', async () => {
    let t = now;
    const store = createLocalStore({ storage: memory(), channelPrefix: `t-${Math.random()}`, now: () => t });
    const created = await store.createEvent(event, host);
    t = Date.parse('2027-02-01T00:00:00Z');
    await store.recordView('anything');
    assert.equal(await store.getSnapshot(created.eventId), null);
  });
});
