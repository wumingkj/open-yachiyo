const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stepMouthTransition,
  isMouthTransitionSettled
} = require('../../apps/desktop-live2d/renderer/lipsyncMouthTransition');

test('stepMouthTransition ramps toward active speech target instead of snapping', () => {
  const first = stepMouthTransition({
    current: { mouthOpen: 0, mouthForm: 0 },
    target: { mouthOpen: 1, mouthForm: 0.8 },
    speaking: true
  });

  assert.ok(first.mouthOpen > 0 && first.mouthOpen < 1);
  assert.ok(first.mouthForm > 0 && first.mouthForm < 0.8);

  const second = stepMouthTransition({
    current: first,
    target: { mouthOpen: 1, mouthForm: 0.8 },
    speaking: true
  });

  assert.ok(second.mouthOpen > first.mouthOpen);
  assert.ok(second.mouthForm > first.mouthForm);
});

test('stepMouthTransition eases back to neutral after speech stops', () => {
  const released = stepMouthTransition({
    current: { mouthOpen: 0.82, mouthForm: -0.64 },
    target: { mouthOpen: 0, mouthForm: 0 },
    speaking: false
  });

  assert.ok(released.mouthOpen > 0);
  assert.ok(released.mouthOpen < 0.82);
  assert.ok(released.mouthForm > -0.64);
  assert.ok(released.mouthForm < 0);
});

test('isMouthTransitionSettled detects near-neutral rest state', () => {
  assert.equal(isMouthTransitionSettled({
    current: { mouthOpen: 0.003, mouthForm: -0.004 },
    target: { mouthOpen: 0, mouthForm: 0 }
  }), true);

  assert.equal(isMouthTransitionSettled({
    current: { mouthOpen: 0.08, mouthForm: 0 },
    target: { mouthOpen: 0, mouthForm: 0 }
  }), false);
});
