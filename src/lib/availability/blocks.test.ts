import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fromBlocks, nextKind, paint, sameAvailability, toBlocks, type Kind } from './blocks';
import { eventSlots } from '../time/slots';
import { MINUTE } from '../time/zone';

const slots = eventSlots({ timezone: 'Asia/Kathmandu', dates: ['2026-10-13'], windowStartMin: 9 * 60, windowEndMin: 13 * 60, slotMinutes: 30 });
const set = new Set(slots);

describe('availability blocks', () => {
  test('merge contiguous same-kind slots', () => {
    const a = new Map<number, Kind>([
      [slots[0], 'free'],
      [slots[1], 'free'],
      [slots[2], 'if_needed'],
      [slots[4], 'free'],
    ]);
    const blocks = toBlocks(a, 30);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].end - blocks[0].start, 60 * MINUTE);
    assert.equal(blocks[1].kind, 'if_needed');
  });

  test('round-trip', () => {
    const a = new Map<number, Kind>(slots.filter((_, i) => i % 3 !== 0).map((t, i) => [t, i % 2 ? 'free' : 'if_needed']));
    assert.ok(sameAvailability(fromBlocks(toBlocks(a, 30), set, 30), a));
  });

  test('ignores time outside the event and empty blocks', () => {
    const before = slots[0] - 60 * MINUTE;
    const out = fromBlocks(
      [
        { start: before, end: slots[0] + 30 * MINUTE, kind: 'free' },
        { start: slots[3], end: slots[3], kind: 'free' },
      ],
      set,
      30,
    );
    assert.deepEqual([...out.keys()], [slots[0]]);
  });

  test('overlapping blocks resolve to free', () => {
    const out = fromBlocks(
      [
        { start: slots[0], end: slots[2], kind: 'if_needed' },
        { start: slots[1], end: slots[2], kind: 'free' },
      ],
      set,
      30,
    );
    assert.equal(out.get(slots[0]), 'if_needed');
    assert.equal(out.get(slots[1]), 'free');
  });

  test('painting and the tap cycle', () => {
    const a = paint(new Map(), [slots[0], slots[1]], 'free');
    assert.equal(a.size, 2);
    assert.equal(paint(a, [slots[0]], null).size, 1);
    assert.equal(nextKind(undefined), 'free');
    assert.equal(nextKind('free'), 'if_needed');
    assert.equal(nextKind('if_needed'), null);
  });
});
