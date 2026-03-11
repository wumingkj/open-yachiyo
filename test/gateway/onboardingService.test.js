const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const onboardingService = require('../../apps/gateway/onboardingService');

test('markOnboardingCompleted persists skipped=false by default', async () => {
  const prevHome = process.env.YACHIYO_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-onboarding-state-'));
  process.env.YACHIYO_HOME = tempHome;

  try {
    const state = await onboardingService.markOnboardingCompleted();
    assert.equal(state.done, true);
    assert.equal(state.skipped, false);

    const reloaded = await onboardingService.readOnboardingState();
    assert.equal(reloaded.done, true);
    assert.equal(reloaded.skipped, false);
    assert.equal(reloaded.last_step, 'complete');
  } finally {
    if (prevHome === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = prevHome;
  }
});

test('markOnboardingCompleted persists skipped=true when requested', async () => {
  const prevHome = process.env.YACHIYO_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yachiyo-onboarding-skip-'));
  process.env.YACHIYO_HOME = tempHome;

  try {
    const state = await onboardingService.markOnboardingCompleted({ skipped: true });
    assert.equal(state.done, true);
    assert.equal(state.skipped, true);

    const reloaded = await onboardingService.readOnboardingState();
    assert.equal(reloaded.done, true);
    assert.equal(reloaded.skipped, true);
    assert.equal(reloaded.last_step, 'complete');
  } finally {
    if (prevHome === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = prevHome;
  }
});
