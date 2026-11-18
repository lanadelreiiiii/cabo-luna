// Phase 6: police helicopter — activation, following, LKL feed,
// staging, and the ground-unit cap boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHelicopter, resetHelicopter, stepHelicopter, stageHelicopter, heliHud, HELI,
} from '../src/helicopter.js';

const player = { x: 100, z: 50 };
const mem = () => ({ elapsed: 12.5, lastKnown: null, lastKnownAt: -Infinity });

test('heli stays inactive below wanted 3', () => {
  const h = createHelicopter();
  for (const w of [0, 1, 2]) {
    stepHelicopter(h, 1 / 60, player, w);
    assert.equal(h.active, false);
  }
});

test('heli activates at wanted 3 and spawns at the offset', () => {
  const h = createHelicopter();
  stepHelicopter(h, 0, player, 3); // dt 0: spawn pose, no follow ease yet
  assert.equal(h.active, true);
  assert.equal(h.x, player.x + HELI.spawnOffset.x);
  assert.equal(h.z, player.z + HELI.spawnOffset.z);
  assert.equal(h.y, HELI.altitude);
});

test('heli activates at wanted 4 and 5 too, deactivates at 0', () => {
  const h = createHelicopter();
  stepHelicopter(h, 1 / 60, player, 5);
  assert.equal(h.active, true);
  stepHelicopter(h, 1 / 60, player, 0);
  assert.equal(h.active, false);
});

test('heli eases toward the hover point and never overshoots', () => {
  const h = createHelicopter();
  stepHelicopter(h, 1 / 60, player, 3);
  const tx = player.x + HELI.hoverOffset.x;
  const tz = player.z + HELI.hoverOffset.z;
  for (let i = 0; i < 600; i++) stepHelicopter(h, 1 / 60, player, 3);
  assert.ok(Math.hypot(h.x - tx, h.z - tz) < 0.5, `hover error ${Math.hypot(h.x - tx, h.z - tz)}`);
  assert.equal(h.y, HELI.altitude);
});

test('heli follows a moving player', () => {
  const h = createHelicopter();
  const p = { x: 0, z: 0 };
  stepHelicopter(h, 1 / 60, p, 3);
  p.x = 200; p.z = -80;
  for (let i = 0; i < 1200; i++) stepHelicopter(h, 1 / 60, p, 4);
  assert.ok(Math.hypot(h.x - (p.x + HELI.hoverOffset.x), h.z - (p.z + HELI.hoverOffset.z)) < 1);
});

test('heli rotor spins while active and freezes while inactive', () => {
  const h = createHelicopter();
  stepHelicopter(h, 0.5, player, 3);
  assert.ok(h.rotor > 0);
  const r = h.rotor;
  stepHelicopter(h, 0.5, player, 0);
  assert.equal(h.rotor, r);
});

test('heli sightings refresh the memory last-known-location', () => {
  const h = createHelicopter();
  const m = mem();
  stepHelicopter(h, 1 / 60, player, 3, m);
  assert.deepEqual(m.lastKnown, { x: player.x, z: player.z });
  assert.equal(m.lastKnownAt, 12.5);
  assert.equal(h.sightings, 1);
});

test('heli works with no memory wired in (null memory)', () => {
  const h = createHelicopter();
  assert.doesNotThrow(() => stepHelicopter(h, 1 / 60, player, 3, null));
  assert.equal(h.active, true);
  assert.equal(h.sightings, 0);
});

test('heli step is deterministic: same inputs, same position', () => {
  const run = () => {
    const h = createHelicopter();
    for (let i = 0; i < 120; i++) stepHelicopter(h, 1 / 60, player, 4);
    return [h.x, h.z, h.rotor];
  };
  assert.deepEqual(run(), run());
});

test('stageHelicopter puts the heli in a fixed visible pose', () => {
  const h = createHelicopter();
  const car = { x: 40, z: 113 };
  stageHelicopter(h, car);
  assert.equal(h.active, true);
  assert.equal(h.x, car.x + 18);
  assert.equal(h.z, car.z + 8);
  assert.equal(h.y, 8); // staged LOW + screen-right so it sits inside the chase-camera frame (see helicopter.js)
  // Staging is a pose, not a spawn: re-staging gives the same pose.
  const first = [h.x, h.y, h.z, h.rotor];
  stageHelicopter(h, car);
  assert.deepEqual([h.x, h.y, h.z, h.rotor], first);
});

test('resetHelicopter clears an active heli', () => {
  const h = createHelicopter();
  stepHelicopter(h, 1 / 60, player, 3);
  resetHelicopter(h);
  assert.equal(h.active, false);
  assert.equal(h.sightings, 0);
});

test('heliHud reports inactive and active states', () => {
  const h = createHelicopter();
  assert.deepEqual(heliHud(h, 100, 50), { active: false, name: 'Air-1', x: 0, z: 0, dist: 0 });
  stepHelicopter(h, 1 / 60, player, 3);
  const hud = heliHud(h, player.x, player.z);
  assert.equal(hud.active, true);
  assert.equal(hud.name, 'Air-1');
  assert.ok(hud.dist > 0);
});
