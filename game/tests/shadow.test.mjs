// Cabo Luna Day 4F — shadow configuration tests (stdlib only).
// Run: node --test game/tests/shadow.test.mjs
//
// The three ?shadow=A|B|C configurations in src/config.js: A is the
// 3498cf3 baseline (every caster on, shadow map every frame), B drops
// the redundant casters (car cabin / roof panel / heads / fountain —
// their shadows sit inside the body shadow at 768x480), C keeps B's
// casters and throttles the shadow-map update (the sun and the static
// casters never move, so only dynamic shadows lag by at most
// updateEvery-1 frames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CONFIGS, SHADOW_DEFAULT, resolveShadow } from '../src/config.js';

test('A is the 3498cf3 baseline: 1024 map, ±200 bounds, far 700, every frame, all casters on', () => {
  const a = resolveShadow('A');
  assert.equal(a.id, 'A');
  assert.equal(a.mapSize, 1024);
  assert.equal(a.bounds, 200);
  assert.equal(a.far, 700);
  assert.equal(a.updateEvery, 1);
  for (const [k, v] of Object.entries(a.casters)) assert.equal(v, true, `A caster ${k} must be on`);
});

test('B keeps the look-defining casters, drops only the redundant ones', () => {
  const b = resolveShadow('B');
  assert.equal(b.mapSize, 1024);
  assert.equal(b.bounds, 200);
  assert.equal(b.updateEvery, 1);
  // Kept: the shadows that define the sunset look.
  for (const k of ['buildings', 'roofCaps', 'lighthouse', 'palmTrunks', 'treeTrunks',
    'parkedBodies', 'carBody', 'crates', 'containers', 'playerBody', 'enemyBody']) {
    assert.equal(b.casters[k], true, `B must keep ${k}`);
  }
  // Dropped: cabin + roof panel (inside the body shadow), heads
  // (inside the body shadow), fountain (a 1.1 m blob).
  for (const k of ['carCabin', 'carRoofPanel', 'playerHead', 'enemyHead', 'fountain']) {
    assert.equal(b.casters[k], false, `B must drop ${k}`);
  }
});

test('C uses exactly B casters, tighter bounds, throttled updates', () => {
  const b = resolveShadow('B');
  const c = resolveShadow('C');
  assert.deepEqual(c.casters, b.casters);
  assert.equal(c.mapSize, 1024);
  assert.ok(c.bounds < 200, 'C tightens the shadow camera');
  assert.equal(c.bounds, 170); // city half is 156; 170 covers every building
  assert.ok(c.far < 700);
  assert.equal(c.updateEvery, 3);
});

test('unknown / missing names fall back to the default (B)', () => {
  assert.equal(resolveShadow('Z').id, 'B');
  assert.equal(resolveShadow(undefined).id, 'B');
  assert.equal(resolveShadow('').id, 'B');
  assert.equal(resolveShadow(null).id, 'B');
  assert.equal(SHADOW_DEFAULT, 'B');
});

test('resolveShadow never mutates the shared configs', () => {
  const c = resolveShadow('C', 512);
  assert.equal(c.mapSize, 512);
  assert.equal(SHADOW_CONFIGS.C.mapSize, 1024);
  assert.notEqual(c.casters, SHADOW_CONFIGS.C.casters);
});

test('?shadowmap= test override accepts only 512/1024/2048', () => {
  assert.equal(resolveShadow('B', 512).mapSize, 512);
  assert.equal(resolveShadow('B', 2048).mapSize, 2048);
  assert.equal(resolveShadow('B', 999).mapSize, 1024);
  assert.equal(resolveShadow('B', 4096).mapSize, 1024);
  assert.equal(resolveShadow('B', undefined).mapSize, 1024);
});
