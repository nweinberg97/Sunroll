import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalHostStore } from './local';
import { HostError } from './store';
import type { KeyValue } from '../data/local';
import { wallTime } from '../time/zone';

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}
const NOW = Date.parse('2026-10-14T18:00:00Z'); // Wed 11:00 am in Vancouver
const make = () => createLocalHostStore({ storage: memory(), now: () => NOW, channel: `t-${Math.random()}` });
const rejects = (p: Promise<unknown>, code: string) => assert.rejects(p, (e: unknown) => e instanceof HostError && e.code === code);

describe('host store (demo)', () => {
  test('signed out, host features are closed; public links still resolve', async () => {
    const s = make();
    await rejects(s.workspaces(), 'signed_out');
    await s.signIn();
    await s.signOut();
    await rejects(s.calendars(), 'signed_out');
    assert.equal((await s.resolve(['nadia']))?.kind, 'host');
  });

  test('one person, several identities: personal and company workspaces with products', async () => {
    const s = make();
    const me = await s.signIn();
    assert.equal(me.handle, 'nadia');
    const ws = await s.workspaces();
    assert.deepEqual(ws.map((w) => [w.workspace.kind, w.workspace.name, w.role]), [
      ['personal', 'Personal', 'owner'],
      ['company', 'Acme', 'owner'],
    ]);
    const acme = ws[1];
    assert.deepEqual(acme.products.map((p) => p.slug).sort(), ['analytics', 'mobile']);
    assert.equal(acme.members.length, 2);
    await rejects(s.createProduct(ws[0].workspace.id, { name: 'X', slug: 'x', emoji: '✨', color: '#000' }), 'invalid');
    await rejects(s.createCompany('Another', 'nadia', '🏢'), 'taken'); // shares the namespace with handles
    await rejects(s.createCompany('Another', 'demo', '🏢'), 'taken'); // reserved word
    const c = await s.createCompany('Globex', 'globex', '🌐');
    assert.equal(c.kind, 'company');
  });

  test('links resolve at /<handle>/<link> and /<company>/<product>/<link>', async () => {
    const s = make();
    await s.signIn();
    const personal = await s.resolve(['nadia', 'intro']);
    assert.equal(personal?.kind, 'type');
    assert.equal(personal?.kind === 'type' && personal.type.path, '/nadia/intro');
    const product = await s.resolve(['acme', 'analytics', 'demo']);
    assert.equal(product?.kind === 'type' && product.type.brand.name, 'Acme Analytics');
    const company = await s.resolve(['acme']);
    assert.equal(company?.kind === 'company' && company.products.length, 2);
    assert.equal(await s.resolve(['acme', 'nope']), null);
    assert.equal(await s.resolve(['new']), null);
  });

  test('all connected calendars count toward busy, and you choose which', async () => {
    const s = make();
    await s.signIn();
    const { connections, calendars } = await s.calendars();
    assert.deepEqual(connections.map((c) => c.email).sort(), ['nadia@acme.example', 'nadia@gmail.com']);
    assert.ok(calendars.some((c) => !c.busy), 'holidays are not busy by default');
    const t = await s.resolve(['acme', 'analytics', 'demo']);
    const id = t?.kind === 'type' ? t.type.id : '';
    const before = (await s.publicSlots(id, NOW, 14)).slots.length;
    const work = calendars.find((c) => c.name === 'Work')!;
    await s.setCalendarBusy(work.id, false);
    const after = (await s.publicSlots(id, NOW, 14)).slots.length;
    assert.ok(after > before, `turning off the work calendar frees time (${before} → ${after})`);
  });

  test('booking writes to the chosen calendar, emails both sides (mocked), and the slot disappears', async () => {
    const s = make();
    await s.signIn();
    const t = await s.resolve(['acme', 'analytics', 'demo']);
    const id = t?.kind === 'type' ? t.type.id : '';
    const { slots } = await s.publicSlots(id, NOW, 14);
    const start = slots[0];
    const { booking, manageToken } = await s.book(id, start, { name: 'Kenji', email: 'Kenji@Example.com', zone: 'Asia/Tokyo' });
    assert.equal(booking.guestEmail, 'kenji@example.com');
    assert.equal(booking.status, 'confirmed');
    const work = (await s.calendars()).calendars.find((c) => c.name === 'Work')!;
    assert.equal(booking.calendarId, work.id);
    assert.ok(!(await s.publicSlots(id, NOW, 14)).slots.includes(start));
    const mail = await s.outbox();
    assert.deepEqual(mail.slice(0, 2).map((m) => m.to).sort(), ['kenji@example.com', 'nadia@example.com']);
    assert.ok(mail.some((m) => m.body.includes('your time')));
    // The guest's manage link works only with the token.
    await rejects(s.getBooking(booking.id, 'wrong'), 'not_found');
    assert.equal((await s.getBooking(booking.id, manageToken)).booking.id, booking.id);
  });

  test('two people can’t book the same slot, even at the same moment', async () => {
    const s = make();
    await s.signIn();
    const t = await s.resolve(['nadia', 'intro']);
    const id = t?.kind === 'type' ? t.type.id : '';
    const start = (await s.publicSlots(id, NOW, 14)).slots[0];
    const results = await Promise.allSettled([
      s.book(id, start, { name: 'A', email: 'a@example.com', zone: 'Europe/London' }),
      s.book(id, start, { name: 'B', email: 'b@example.com', zone: 'Asia/Kolkata' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal((lost.reason as HostError).code, 'taken');
    // Another link from the same host can't take that time either: the host is busy.
    const coffee = await s.resolve(['nadia', 'coffee']);
    const cid = coffee?.kind === 'type' ? coffee.type.id : '';
    await rejects(s.book(cid, start, { name: 'C', email: 'c@example.com', zone: 'UTC' }), 'taken');
  });

  test('reschedule and cancel with the manage link', async () => {
    const s = make();
    await s.signIn();
    const t = await s.resolve(['nadia', 'intro']);
    const id = t?.kind === 'type' ? t.type.id : '';
    const slots = (await s.publicSlots(id, NOW, 14)).slots;
    const { booking, manageToken } = await s.book(id, slots[0], { name: 'Sam', email: 'sam@example.com', zone: 'Europe/London' });
    const moved = await s.reschedule(booking.id, manageToken, slots[5]);
    assert.equal(moved.start, slots[5]);
    assert.equal(moved.sequence, 1);
    assert.ok((await s.publicSlots(id, NOW, 14)).slots.includes(slots[0]), 'the old time is free again');
    await s.cancel(booking.id, manageToken);
    assert.equal((await s.getBooking(booking.id, manageToken)).booking.status, 'cancelled');
  });

  test('working hours are the host’s: a Tokyo visitor sees Nadia’s 9 am as 1 am', async () => {
    const s = make();
    await s.signIn();
    const t = await s.resolve(['acme', 'mobile', 'onboarding']);
    const { slots, type } = await s.publicSlots(t?.kind === 'type' ? t.type.id : '', NOW, 14);
    assert.equal(type.host.zone, 'America/Vancouver');
    for (const x of slots) {
      const m = wallTime(x, 'America/Vancouver').minute;
      assert.ok(m >= 8 * 60 && m < 15 * 60, 'inside Nadia’s 8–3 hours');
    }
  });
});
