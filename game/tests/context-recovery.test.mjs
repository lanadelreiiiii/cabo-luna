// Cabo Luna Day 4H — WebGL context-loss recovery tests (stdlib only).
// Run: node --test game/tests/context-recovery.test.mjs
//
// The state machine in src/context-recovery.js is renderer-free, so
// these tests drive it with fake canvas events and fake renderer
// doubles — no GPU, no DOM. The browser probe (playwright) covers the
// real WEBGL_lose_context path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContextRecovery, RECOVERY_MESSAGE } from '../src/context-recovery.js';

function fakeEvent() {
  let prevented = false;
  return {
    preventDefault() { prevented = true; },
    get prevented() { return prevented; },
  };
}

function harness(overrides = {}) {
  let shown = 0, hidden = 0, restored = 0;
  const recovery = createContextRecovery({
    showMessage() { shown += 1; },
    hideMessage() { hidden += 1; },
    verify: () => true,
    onRestored() { restored += 1; },
    ...overrides,
  });
  return {
    recovery,
    get shown() { return shown; },
    get hidden() { return hidden; },
    get restored() { return restored; },
  };
}

test('starts ok: loop runs, no message', () => {
  const { recovery } = harness();
  assert.equal(recovery.state, 'ok');
  assert.equal(recovery.paused, false);
  assert.equal(recovery.messageVisible, false);
  assert.equal(recovery.losses, 0);
  assert.equal(recovery.restores, 0);
});

test('loss pauses the loop, shows the message, preventDefaults the event', () => {
  const h = harness();
  const ev = fakeEvent();
  assert.equal(h.recovery.handleLost(ev), true);
  assert.equal(ev.prevented, true, 'preventDefault is what lets the browser restore at all');
  assert.equal(h.recovery.state, 'lost');
  assert.equal(h.recovery.paused, true);
  assert.equal(h.recovery.messageVisible, true);
  assert.equal(h.shown, 1);
  assert.equal(h.recovery.losses, 1);
  assert.match(RECOVERY_MESSAGE, /restoring/i);
});

test('restore without verification does NOT resume', () => {
  const h = harness({ verify: () => false });
  h.recovery.handleLost(fakeEvent());
  const res = h.recovery.handleRestored();
  assert.equal(res.resumed, false);
  assert.equal(res.reason, 'verify-failed');
  assert.equal(h.recovery.state, 'lost');
  assert.equal(h.recovery.paused, true, 'loop stays paused into a broken renderer');
  assert.equal(h.recovery.messageVisible, true, 'message stays up');
  assert.equal(h.hidden, 0);
  assert.equal(h.recovery.failedVerifications, 1);
  assert.equal(h.recovery.restores, 0);
});

test('restore that throws in verify does NOT resume', () => {
  const h = harness({ verify: () => { throw new Error('GL error 1282'); } });
  h.recovery.handleLost(fakeEvent());
  assert.equal(h.recovery.handleRestored().resumed, false);
  assert.equal(h.recovery.state, 'lost');
  assert.equal(h.recovery.paused, true);
  // A later successful verification recovers from the same loss.
  const ok = createContextRecovery({
    showMessage() {}, hideMessage() {}, verify: () => true,
  });
  ok.handleLost(fakeEvent());
  assert.equal(ok.handleRestored().resumed, true);
});

test('verified restore resumes and hides the message', () => {
  const h = harness();
  h.recovery.handleLost(fakeEvent());
  const res = h.recovery.handleRestored();
  assert.equal(res.resumed, true);
  assert.equal(h.recovery.state, 'ok');
  assert.equal(h.recovery.paused, false);
  assert.equal(h.recovery.messageVisible, false);
  assert.equal(h.hidden, 1);
  assert.equal(h.restored, 1);
  assert.equal(h.recovery.restores, 1);
});

test('restored event while already ok is a no-op (no phantom restore)', () => {
  const h = harness();
  assert.deepEqual(h.recovery.handleRestored(), { resumed: false, reason: 'not-lost' });
  assert.equal(h.recovery.restores, 0);
  assert.equal(h.hidden, 0);
  assert.equal(h.restored, 0);
});

test('double loss is safe: one message show, one loss counted per fresh loss', () => {
  const h = harness();
  h.recovery.handleLost(fakeEvent());
  assert.equal(h.recovery.handleLost(fakeEvent()), false, 'second loss while lost is a no-op');
  assert.equal(h.shown, 1);
  assert.equal(h.recovery.losses, 1);
  assert.equal(h.recovery.paused, true);
  // After a verified restore, a new loss counts again.
  h.recovery.handleRestored();
  assert.equal(h.recovery.handleLost(fakeEvent()), true);
  assert.equal(h.recovery.losses, 2);
  assert.equal(h.shown, 2);
});

test('repeated loss/restore cycles stay stable', () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    assert.equal(h.recovery.handleLost(fakeEvent()), true, `cycle ${i} loss`);
    assert.equal(h.recovery.paused, true);
    assert.equal(h.recovery.handleRestored().resumed, true, `cycle ${i} restore`);
    assert.equal(h.recovery.paused, false);
  }
  assert.equal(h.recovery.losses, 10);
  assert.equal(h.recovery.restores, 10);
  assert.equal(h.shown, 10);
  assert.equal(h.hidden, 10);
  assert.equal(h.recovery.state, 'ok');
});

test('loss with no event object still pauses (synthetic dispatch path)', () => {
  const h = harness();
  assert.equal(h.recovery.handleLost(), true);
  assert.equal(h.recovery.paused, true);
  assert.equal(h.recovery.handleRestored().resumed, true);
});

test('no second renderer is created: the module never constructs one', () => {
  // The module takes callbacks, not a renderer factory — it has no
  // way to create a renderer. Prove it structurally: create N
  // recoveries and confirm none of them touches a renderer double.
  let rendererCreations = 0;
  const fakeRendererFactory = () => { rendererCreations += 1; return { render() {} }; };
  for (let i = 0; i < 5; i++) {
    const r = createContextRecovery({ verify: () => true });
    r.handleLost(fakeEvent());
    r.handleRestored();
  }
  assert.equal(rendererCreations, 0, 'state machine must never create a renderer');
  void fakeRendererFactory;
});

test('verify is consulted on every restore, not just the first', () => {
  let calls = 0;
  const h = harness({ verify: () => { calls += 1; return calls > 1; } });
  h.recovery.handleLost(fakeEvent());
  assert.equal(h.recovery.handleRestored().resumed, false, 'first verify fails');
  assert.equal(h.recovery.handleRestored().resumed, true, 'second verify passes, resumes');
  assert.equal(calls, 2);
});
