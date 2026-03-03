const test = require('node:test');
const assert = require('node:assert/strict');

const { RuntimeEventBus } = require('../../apps/runtime/bus/eventBus');
const { ToolCallDispatcher } = require('../../apps/runtime/orchestrator/toolCallDispatcher');

function createRequestedPayload(overrides = {}) {
  return {
    trace_id: 'trace-1',
    session_id: 'session-1',
    step_index: 1,
    call_id: 'call-1',
    workspace_root: '/tmp/ws',
    permission_level: 'medium',
    tool: {
      name: 'echo',
      args: { text: 'hello' }
    },
    ...overrides
  };
}

test('ToolCallDispatcher deduplicates completed call by trace_id+call_id', async () => {
  const bus = new RuntimeEventBus();
  let executeCount = 0;
  const executor = {
    async execute() {
      executeCount += 1;
      return { ok: true, result: 'ok-echo' };
    }
  };

  const dispatcher = new ToolCallDispatcher({ bus, executor, dedupTtlMs: 60_000 });
  dispatcher.start();

  const firstResultPromise = bus.waitFor(
    'tool.call.result',
    (payload) => payload.call_id === 'call-1' && payload.ok === true,
    2000
  );
  bus.publish('tool.call.requested', createRequestedPayload());
  const first = await firstResultPromise;
  assert.equal(first.result, 'ok-echo');
  assert.equal(executeCount, 1);

  const secondResultPromise = bus.waitFor(
    'tool.call.result',
    (payload) => payload.call_id === 'call-1' && payload.ok === true && payload.dedup_hit === true,
    2000
  );
  bus.publish('tool.call.requested', createRequestedPayload());
  const second = await secondResultPromise;

  assert.equal(second.result, 'ok-echo');
  assert.equal(second.dedup_hit, true);
  assert.equal(executeCount, 1);

  dispatcher.stop();
});

test('ToolCallDispatcher deduplicates in-flight call by trace_id+call_id', async () => {
  const bus = new RuntimeEventBus();
  let executeCount = 0;
  const executor = {
    async execute() {
      executeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { ok: true, result: 'ok-inflight' };
    }
  };

  const dispatcher = new ToolCallDispatcher({ bus, executor, dedupTtlMs: 60_000 });
  dispatcher.start();

  const results = [];
  const unsubscribe = bus.subscribe('tool.call.result', (payload) => {
    if (payload.call_id === 'call-1') {
      results.push(payload);
    }
  });

  bus.publish('tool.call.requested', createRequestedPayload());
  bus.publish('tool.call.requested', createRequestedPayload());
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(executeCount, 1);
  assert.equal(results.length >= 2, true);
  assert.equal(results.some((item) => item.dedup_hit === true), true);
  assert.equal(results.every((item) => item.result === 'ok-inflight'), true);

  unsubscribe();
  dispatcher.stop();
});

test('ToolCallDispatcher keeps single execution under burst duplicate requests', async () => {
  const bus = new RuntimeEventBus();
  let executeCount = 0;
  const executor = {
    async execute() {
      executeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { ok: true, result: 'ok-burst' };
    }
  };

  const dispatcher = new ToolCallDispatcher({ bus, executor, dedupTtlMs: 60_000 });
  dispatcher.start();

  const results = [];
  const unsubscribe = bus.subscribe('tool.call.result', (payload) => {
    if (payload.call_id === 'call-1') {
      results.push(payload);
    }
  });

  const burstSize = 20;
  for (let i = 0; i < burstSize; i += 1) {
    bus.publish('tool.call.requested', createRequestedPayload());
  }

  await new Promise((resolve) => setTimeout(resolve, 260));

  assert.equal(executeCount, 1);
  assert.equal(results.length, burstSize);
  assert.equal(results.every((item) => item.result === 'ok-burst'), true);
  assert.equal(results.filter((item) => item.dedup_hit === true).length >= burstSize - 1, true);

  unsubscribe();
  dispatcher.stop();
});
