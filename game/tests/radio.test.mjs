// Phase 6: original procedural radio — stations, patterns, cycling,
// HUD text, and the WebAudio player against a mock context.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIONS, midiToFreq, stepDuration, noteAt, chordAt,
  createRadio, currentStation, cycleRadio, radioHud, advanceStep,
  createRadioPlayer,
} from '../src/radio.js';

test('three original stations, all with names, tempos and 32-step patterns', () => {
  assert.equal(STATIONS.length, 3);
  const ids = new Set();
  for (const s of STATIONS) {
    assert.ok(!ids.has(s.id));
    ids.add(s.id);
    assert.ok(s.name && s.freq && s.tagline);
    assert.ok(s.bpm >= 60 && s.bpm <= 140);
    assert.equal(s.melody.length, 32);
    assert.equal(s.bass.length, 32);
    assert.equal(s.chords.length, 4);
    assert.ok(s.melody.some((n) => n !== null));
    assert.ok(s.bass.some((n) => n !== null));
  }
});

test('midiToFreq: A4 is 440 Hz, octave doubles', () => {
  assert.equal(midiToFreq(69), 440);
  assert.ok(Math.abs(midiToFreq(81) - 880) < 1e-9);
});

test('stepDuration: faster tempo means shorter steps', () => {
  const fast = stepDuration(STATIONS[1]); // 112 bpm
  const slow = stepDuration(STATIONS[2]); // 76 bpm
  assert.ok(fast < slow);
  assert.ok(Math.abs(stepDuration(STATIONS[0]) - 60 / 92 / 4) < 1e-12);
});

test('noteAt is deterministic and wraps over the 32-step loop', () => {
  const s = STATIONS[0];
  assert.deepEqual(noteAt(s, 0), noteAt(s, 32));
  assert.deepEqual(noteAt(s, 5), noteAt(s, 37));
  assert.deepEqual(noteAt(s, -1), noteAt(s, 31));
  const n = noteAt(s, 0);
  assert.equal(n.melody, s.root + 0);
  assert.equal(n.bass, s.root - 24 + 0);
});

test('noteAt rests are null, never a phantom note', () => {
  const s = STATIONS[0];
  assert.equal(noteAt(s, 1).melody, null);
  assert.equal(noteAt(s, 1).bass, null);
});

test('chordAt cycles one chord per 8 steps', () => {
  const s = STATIONS[0];
  assert.deepEqual(chordAt(s, 0), chordAt(s, 7));
  assert.notDeepEqual(chordAt(s, 0), chordAt(s, 8));
  assert.deepEqual(chordAt(s, 32), chordAt(s, 0));
  for (const c of [0, 8, 16, 24].map((st) => chordAt(s, st))) {
    assert.equal(c.length, 3);
    assert.ok(c.every((m) => m >= s.root - 4 && m <= s.root + 12));
  }
});

test('radio defaults OFF; cycling walks OFF -> 3 stations -> OFF', () => {
  const r = createRadio();
  assert.equal(radioHud(r), 'RADIO OFF');
  assert.equal(currentStation(r), null);
  assert.equal(cycleRadio(r).id, 'luna-fm');
  assert.equal(radioHud(r), 'LUNA FM 88.1');
  assert.equal(cycleRadio(r).id, 'brisa-beat');
  assert.equal(cycleRadio(r).id, 'faro');
  assert.equal(cycleRadio(r), null);
  assert.equal(radioHud(r), 'RADIO OFF');
});

test('cycling resets the step so a station starts on its first note', () => {
  const r = createRadio();
  cycleRadio(r);
  advanceStep(r); advanceStep(r); advanceStep(r);
  assert.equal(r.step, 3);
  cycleRadio(r);
  assert.equal(r.step, 0);
});

test('advanceStep walks the pattern and returns real notes', () => {
  const r = createRadio();
  cycleRadio(r);
  const first = advanceStep(r);
  assert.equal(first.melody, STATIONS[0].root);
  assert.equal(r.step, 1);
  // A full 32-step loop returns to the same note.
  for (let i = 0; i < 31; i++) advanceStep(r);
  assert.equal(r.step, 32);
  assert.deepEqual(advanceStep(r), first);
});

test('advanceStep with radio off returns rests and never throws', () => {
  const r = createRadio();
  assert.deepEqual(advanceStep(r), { melody: null, bass: null });
});

// --- Player with a mock AudioContext ----------------------------------
function mockContextFactory() {
  const nodes = [];
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resumeCalls: 0,
    closeCalls: 0,
    createGain() {
      const g = { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      nodes.push(g);
      return g;
    },
    createOscillator() {
      const o = {
        type: '', frequency: { value: 0 }, connect() {}, disconnect() {},
        start() {}, stop() {}, onended: null,
      };
      nodes.push(o);
      return o;
    },
    resume() { ctx.resumeCalls += 1; return Promise.resolve(); },
    close() { ctx.closeCalls += 1; return Promise.resolve(); },
    _nodes: nodes,
  };
  return ctx;
}

test('player is a safe no-op before init and tolerates a failing factory', () => {
  const r = createRadio();
  const p = createRadioPlayer(r, () => { throw new Error('no audio'); });
  assert.equal(p.init(), false);
  assert.equal(p.start(), false);
  assert.deepEqual(p.getStats(), {
    initialized: false, contextState: 'none', playing: false, station: null, notesScheduled: 0,
  });
  const p2 = createRadioPlayer(r, mockContextFactory);
  assert.equal(p2.start(), false); // not initialised yet
  assert.equal(p2.getStats().initialized, false);
});

test('player starts only with a station on, schedules notes, stops cleanly', async () => {
  const r = createRadio();
  const ctx = mockContextFactory();
  const p = createRadioPlayer(r, () => ctx);
  assert.equal(p.init(), true);
  assert.equal(p.start(), false); // radio off
  cycleRadio(r);
  assert.equal(p.start(), true);
  assert.equal(p.getStats().playing, true);
  assert.equal(p.getStats().station, 'luna-fm');
  // Let the 90 ms scheduler run a few ticks (fake timers not needed:
  // real time, short wait).
  await new Promise((res) => setTimeout(res, 350));
  assert.ok(p.getStats().notesScheduled > 0, 'scheduler ran');
  p.retune();
  assert.equal(p.getStats().playing, true);
  p.stop();
  assert.equal(p.getStats().playing, false);
  p.dispose();
  assert.equal(ctx.closeCalls, 1);
});

test('player stop is idempotent and dispose never throws', () => {
  const r = createRadio();
  const p = createRadioPlayer(r, mockContextFactory);
  p.init();
  assert.doesNotThrow(() => { p.stop(); p.stop(); p.dispose(); p.dispose(); });
});
