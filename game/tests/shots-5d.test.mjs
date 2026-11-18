// Day 5D screenshot fixes — regression tests for the staging
// constants and the HUD contrast tokens. The browser capture is the
// pixel truth; these tests pin the invariants the frames depend on
// so a later staging tweak cannot silently reintroduce them.
// Run: node --test game/tests/shots-5d.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FOOT_CAR_OFFSET, COMBAT_BACKGROUND_TRAFFIC, COMBAT_PURSUIT_SPOTS,
  stageCombatPursuit, stageCombatBackground,
} from '../src/shots.js';
import { projectToScreen } from '../src/camera.js';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, '..');

// Foot: the interact car sits north-west of the player — lateral
// separation clears the player in frame, and the distance keeps the
// E prompt live (interact range is 3 m).
test('foot car offset: clear of the player, inside interact range', () => {
  const { dx, dz } = FOOT_CAR_OFFSET;
  assert.ok(Math.abs(dx) >= 2, `lateral ${dx} m must clear the player`);
  const dist = Math.hypot(dx, dz);
  assert.ok(dist < 3, `car ${dist.toFixed(2)} m away must keep the E prompt (range 3 m)`);
  assert.ok(dist > 2, `car ${dist.toFixed(2)} m away must not sit on the player`);
  assert.ok(dz < 0, 'car is north of the player (between player and shop), not between camera and player');
});

// Combat pursuit: four genuinely different ranges, each at least
// 8 m apart, all on/near the coastal road east of the player.
test('combat pursuit spots: distinct ranges, honestly spaced', () => {
  const dists = COMBAT_PURSUIT_SPOTS.map((s) => Math.round(Math.hypot(s.dx, s.dz)));
  assert.equal(new Set(dists).size, dists.length, `ranges must differ: ${dists}`);
  const sorted = [...dists].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i] - sorted[i - 1] >= 8, `ranges ${sorted} too close together`);
  }
  assert.ok(sorted[0] >= 15, 'nearest unit must not sit on the player');
  assert.ok(sorted[sorted.length - 1] <= 70, 'farthest unit must stay in the response area');
});

test('stageCombatPursuit repositions units at the staged ranges', () => {
  const world = {
    player: { state: { x: -141, z: 109 } },
    police: {
      units: [0, 1, 2, 3].map(() => ({ car: { x: -98, z: 110, heading: 0, speed: 0 }, state: 'PATROL' })),
    },
  };
  stageCombatPursuit(world);
  const dists = world.police.units.map((u) =>
    Math.round(Math.hypot(u.car.x - -141, u.car.z - 109)));
  assert.equal(new Set(dists).size, 4, `staged ranges must differ: ${dists}`);
  // States are left exactly as the sim gave them — only positions
  // are staged, never the state word.
  assert.ok(world.police.units.every((u) => u.state === 'PATROL'));
});

// Combat background: three cars on real road lines, projecting into
// the frame background without touching the framed guard's box.
test('combat background traffic: on road lines, in frame, clear of the guard', () => {
  // Combat camera, mirrored from shots.js combatShotCam: player
  // (-141, 109), framed guard (-146, 106), 5.5 m back / 2.2 m side.
  const p = { x: -141, z: 109 };
  const g = { x: -146, z: 106 };
  const dx = g.x - p.x, dz = g.z - p.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const sx = -uz, sz = ux;
  const pose = {
    position: { x: p.x - ux * 5.5 + sx * 2.2, y: 3.1, z: p.z - uz * 5.5 + sz * 2.2 },
    target: { x: g.x, y: 1.2, z: g.z },
  };
  const guardScreen = projectToScreen(pose, 62, 768 / 480, { x: g.x, y: 1, z: g.z });
  for (const s of COMBAT_BACKGROUND_TRAFFIC) {
    // On a real road line: x = -150 vertical or z = 110 coastal.
    assert.ok(s.x === -150 || s.z === 110, `background car (${s.x}, ${s.z}) must sit on a road line`);
    const scr = projectToScreen(pose, 62, 768 / 480, { x: s.x, y: 1, z: s.z });
    assert.equal(scr.behind, false);
    assert.ok(scr.x >= 0 && scr.x <= 768, `car (${s.x}, ${s.z}) projects off-frame at x=${scr.x.toFixed(0)}`);
    assert.ok(scr.y >= 120 && scr.y <= 320, `car (${s.x}, ${s.z}) projects out of the background band at y=${scr.y.toFixed(0)}`);
    const dGuard = Math.hypot(scr.x - guardScreen.x, scr.y - guardScreen.y);
    assert.ok(dGuard > 90, `car (${s.x}, ${s.z}) only ${dGuard.toFixed(0)} px from the framed guard`);
  }
});

test('stageCombatBackground places cars on the staged spots', () => {
  const world = {
    traffic: {
      cars: [0, 1, 2].map(() => ({ x: 0, z: 0, heading: 0, speed: 0, cruise: 9, waypoints: [], wpIndex: 0, state: 'IDLE' })),
    },
  };
  stageCombatBackground(world);
  world.traffic.cars.forEach((c, i) => {
    assert.equal(c.x, COMBAT_BACKGROUND_TRAFFIC[i].x);
    assert.equal(c.z, COMBAT_BACKGROUND_TRAFFIC[i].z);
    assert.equal(c.state, 'DRIVE');
    assert.equal(c.speed, c.cruise);
  });
});

// Vista HP contrast: the health text carries its own dark pill in
// the page CSS, so it reads on bright pavement.
test('health text has a dark pill background and white text', () => {
  const html = readFileSync(join(gameDir, 'index.html'), 'utf8');
  const m = html.match(/#hud-health-text \{([^}]*)\}/);
  assert.ok(m, '#hud-health-text rule must exist');
  const rule = m[1];
  assert.match(rule, /background:\s*rgba\(8,\s*20,\s*32,\s*0\.78\)/);
  assert.match(rule, /color:\s*#ffffff/);
  assert.match(rule, /text-shadow/);
});

// Patrol font: the one-line budget depends on the 9.5 px patrol font
// (the combat line measures 268.2 px at 9.5 px, 282.4 px at 10 px —
/// 2.4 px over the 280 px panel).
test('patrol line font is 9.5 px (the one-line budget assumes it)', () => {
  const html = readFileSync(join(gameDir, 'index.html'), 'utf8');
  const m = html.match(/#hud-patrol \{([^}]*)\}/);
  assert.ok(m, '#hud-patrol rule must exist');
  assert.match(m[1], /font-size:\s*9\.5px/);
});
