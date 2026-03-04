const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const shellAdapters = require('../../apps/runtime/tooling/adapters/shell');

const rewrite = shellAdapters.__rewriteAppleMusicOsaCommandForTests;

test('rewrites Apple Music playlist osascript to music_control.sh invocation', () => {
  const oldHome = process.env.YACHIYO_HOME;
  process.env.YACHIYO_HOME = path.join(os.tmpdir(), 'yachiyo-test-home');

  try {
    const rewritten = rewrite(
      'osascript -e \'tell application "Music" to play playlist "Jazz Classics"\''
    );
    assert.match(rewritten, /music_control\.sh/);
    assert.match(rewritten, / play /);
    assert.match(rewritten, /--shuffle/);
    assert.match(rewritten, /爵士/);
  } finally {
    if (oldHome === undefined) delete process.env.YACHIYO_HOME;
    else process.env.YACHIYO_HOME = oldHome;
  }
});

test('rewrites Apple Music next-track osascript to music_control.sh', () => {
  const rewritten = rewrite('osascript -e \'tell application "Music" to next track\'');
  assert.match(rewritten, /music_control\.sh/);
  assert.match(rewritten, / next$/);
});

test('keeps non-Music osascript command unchanged', () => {
  const original = 'osascript -e \'display dialog "hello"\'';
  const rewritten = rewrite(original);
  assert.equal(rewritten, original);
});
