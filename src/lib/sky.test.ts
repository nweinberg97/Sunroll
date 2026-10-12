import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, INK, PAPER, skyAt } from './sky';

test('the headline stays readable on the sky at every time of day (WCAG AA large text, 3:1; aim 4.5:1)', () => {
  let worst = Infinity;
  let worstAt = 0;
  for (let m = 0; m < 1440; m += 5) {
    const s = skyAt(m);
    const c = contrast(s.text === 'ink' ? INK : PAPER, s.behindText);
    if (c < worst) {
      worst = c;
      worstAt = m;
    }
  }
  assert.ok(worst >= 4.5, `lowest contrast ${worst.toFixed(2)} at minute ${worstAt}`);
});

test('the sun is up by day and the moon by night, highest at midday and midnight', () => {
  assert.equal(skyAt(12 * 60).body, 'sun');
  assert.equal(skyAt(2 * 60).body, 'moon');
  assert.ok(skyAt(12 * 60 + 30).height > 0.95);
  assert.ok(skyAt(6 * 60 + 35).height < 0.1);
  assert.equal(skyAt(23 * 60).stars > 0.5, true);
  assert.equal(skyAt(13 * 60).stars, 0);
});

test('night skies use light text, midday skies use dark text', () => {
  assert.equal(skyAt(1 * 60).text, 'paper');
  assert.equal(skyAt(12 * 60).text, 'ink');
});
