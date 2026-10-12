import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickedRanges } from './ranges';
import { toInstant } from '../time/zone';
import type { Kind } from './blocks';

test('picked slots become plain ranges, split by kind and by day', () => {
  const z = 'Europe/London';
  const at = (d: string, m: number) => toInstant(d, m, z);
  const a = new Map<number, Kind>([
    [at('2026-10-13', 600), 'free'],
    [at('2026-10-13', 630), 'free'],
    [at('2026-10-13', 660), 'if_needed'],
    [at('2026-10-13', 1410), 'free'],
    [at('2026-10-14', 0), 'free'], // continues past midnight: a new day, a new range
    [at('2026-10-14', 900), 'free'],
  ]);
  const r = pickedRanges(a, z, 30);
  assert.deepEqual(r.map((x) => [x.date, x.kind, x.slots.length]), [
    ['2026-10-13', 'free', 2],
    ['2026-10-13', 'if_needed', 1],
    ['2026-10-13', 'free', 1],
    ['2026-10-14', 'free', 1],
    ['2026-10-14', 'free', 1],
  ]);
  assert.equal(r[0].end - r[0].start, 60 * 60_000);
});
