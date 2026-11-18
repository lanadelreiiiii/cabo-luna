// Cabo Luna Part B — Node tests (stdlib only).
// Run: node --test game/tests/police.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateCity, buildingColliders } from '../src/city.js';
import { makeRng } from '../src/rng.js';
import { STEP, POLICE, wantedFromHeat } from '../src/config.js';
import { buildRoadGraph } from '../src/roadgraph.js';
import { createVehicle, stepVehicle, applySteal, resetVehicleIds } from '../src/vehicles.js';
import {
  createPoliceManager, stepPolice, ensureUnits, hasLineOfSight,
  addCollisionCrime, lightPhase, policeStatus,
} from '../src/police.js';

function setup(seed = 1) {
  resetVehicleIds();
  const city = generateCity(seed);
  const graph = buildRoadGraph(city);
  const colliders = buildingColliders(city);
  const mgr = createPoliceManager(graph, city, colliders, makeRng(seed * 97 + 13));
  return { city, graph, colliders, mgr };
}

// Park every unit far away so it cannot see the player.
function banish(mgr, x = 400, z = 400) {
  mgr.units.forEach((u, i) => {
    u.car.x = x + i * 30; u.car.z = z + i * 30;
    u.state = 'PATROL'; u.waypoints = []; u.wpIndex = 0;
  });
}

test('LOS: open road is clear, a building blocks the segment', () => {
  const wall = [{ minX: 0, maxX: 10, minZ: -5, maxZ: 5 }];
  assert.equal(hasLineOfSight(-20, 0, -12, 0, wall), true);
  assert.equal(hasLineOfSight(-20, 0, 20, 0, wall), false);
  assert.equal(hasLineOfSight(-20, 20, 20, 20, wall), true); // passes north of the wall
  assert.equal(hasLineOfSight(-20, 0, 20, 0, []), true);
});

test('PATROL -> CHASE when the player is seen inside the radius', () => {
  const { mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(mgr, 2, player.x, player.z);
  assert.equal(mgr.units.length, 3, 'wanted 2 spawns wanted+1 = 3 units');
  banish(mgr);
  const cop = mgr.units[0];
  cop.car.x = -75; cop.car.z = 113; // 15 m west, same open road
  cop.car.heading = Math.PI / 2;
  stepPolice(mgr, STEP, player, heat);
  assert.equal(cop.state, 'CHASE', `expected CHASE, got ${cop.state}`);
  assert.deepEqual(cop.lastKnown, { x: player.x, z: player.z });
});

test('NO chase when a building blocks line of sight', () => {
  const { city, colliders, mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  // Find a building where a cop 5 m off one wall and a player 5 m off
  // the opposite wall are both outside every collider and < 32 m apart.
  let placed = null;
  for (const b of city.buildings) {
    const cx = b.x - b.w / 2 - 5, px = b.x + b.w / 2 + 5;
    const inside = (x, z) => colliders.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ);
    if (inside(cx, b.z) || inside(px, b.z)) continue;
    if (px - cx > 32) continue;
    placed = { cx, px, z: b.z };
    break;
  }
  assert.ok(placed, 'no suitable building found for the LOS test');
  ensureUnits(mgr, 2, placed.px, placed.z);
  banish(mgr);
  const cop = mgr.units[0];
  cop.car.x = placed.cx; cop.car.z = placed.z;
  const player = { x: placed.px, z: placed.z, speed: 0, vx: 0, vz: 0, car: null };
  assert.equal(hasLineOfSight(cop.car.x, cop.car.z, player.x, player.z, colliders), false);
  for (let i = 0; i < 120; i++) stepPolice(mgr, STEP, player, heat);
  assert.equal(cop.state, 'PATROL', `blocked cop must stay on patrol, got ${cop.state}`);
});

test('CHASE -> SEARCH after losing sight, then SEARCH -> PATROL', () => {
  const { mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(mgr, 2, player.x, player.z);
  banish(mgr);
  const cop = mgr.units[0];
  cop.car.x = -75; cop.car.z = 113;
  for (let i = 0; i < 60; i++) stepPolice(mgr, STEP, player, heat);
  assert.equal(cop.state, 'CHASE');
  // Player vanishes: far away, out of every detection radius.
  player.x = 140; player.z = -140;
  for (let i = 0; i < Math.ceil((POLICE.unseenGrace + 0.5) / STEP); i++) {
    stepPolice(mgr, STEP, player, heat);
  }
  assert.equal(cop.state, 'SEARCH', `expected SEARCH after grace, got ${cop.state}`);
  assert.ok(cop.lastKnown, 'search must remember the last known position');
  for (let i = 0; i < Math.ceil((POLICE.searchTime + 1) / STEP); i++) {
    stepPolice(mgr, STEP, player, heat);
  }
  assert.equal(cop.state, 'PATROL', `expected PATROL after search expires, got ${cop.state}`);
});

test('BUSTED triggers when a cop sits on a slow player for 2 s', () => {
  const { mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(mgr, 2, player.x, player.z);
  banish(mgr);
  const cop = mgr.units[0];
  cop.car.x = -62; cop.car.z = 113; // 2 m away, player standing still
  for (let i = 0; i < 240; i++) stepPolice(mgr, STEP, player, heat);
  assert.equal(cop.state, 'BUSTED');
  assert.equal(mgr.busted, true);
  // A fast player is never busted, even at point-blank range.
  const mgr2 = setup().mgr;
  const heat2 = { crimeHeat: 25, wanted: 2 };
  const fast = { x: -60, z: 113, speed: 20, vx: 20, vz: 0, car: null };
  ensureUnits(mgr2, 2, fast.x, fast.z);
  banish(mgr2);
  mgr2.units[0].car.x = -62; mgr2.units[0].car.z = 113;
  for (let i = 0; i < 240; i++) stepPolice(mgr2, STEP, fast, heat2);
  assert.notEqual(mgr2.units[0].state, 'BUSTED');
  assert.equal(mgr2.busted, false);
});

test('wanted escalation: steal 25 heat -> level 2; collisions add heat', () => {
  resetVehicleIds();
  const heat = { crimeHeat: 0, wanted: 0 };
  const car = createVehicle('sedan', 5, 0, 0, { parked: true });
  applySteal(heat, car);
  assert.equal(heat.crimeHeat, 25);
  assert.equal(heat.wanted, 2);
  assert.equal(wantedFromHeat(25), 2);
  addCollisionCrime(heat);
  assert.equal(heat.crimeHeat, 35);
  assert.equal(heat.wanted, 2);
  addCollisionCrime(heat);
  assert.equal(heat.crimeHeat, 45);
  assert.equal(heat.wanted, 3);
});

test('heat decays after 8 s unseen; wanted falls with it', () => {
  const { mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(mgr, 2, player.x, player.z);
  banish(mgr); // cops far away: nobody can see the player
  for (let i = 0; i < Math.ceil(10 / STEP); i++) stepPolice(mgr, STEP, player, heat);
  assert.ok(heat.crimeHeat < 25, `heat should have decayed, got ${heat.crimeHeat}`);
  assert.ok(heat.crimeHeat > 15 && heat.crimeHeat < 22, `after 10 s expect ~20 heat, got ${heat.crimeHeat}`);
  for (let i = 0; i < Math.ceil(14 / STEP); i++) stepPolice(mgr, STEP, player, heat);
  assert.equal(heat.crimeHeat, 0);
  assert.equal(heat.wanted, 0);
});

test('pursuit closes distance over 10 s', () => {
  const { colliders, mgr } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const playerCar = createVehicle('sedan', -60, 113, Math.PI / 2);
  ensureUnits(mgr, 2, playerCar.x, playerCar.z);
  banish(mgr);
  const cop = mgr.units[0];
  cop.car.x = -90; cop.car.z = 113; // 30 m behind, same road, inside the 32 m radius
  cop.car.heading = Math.PI / 2;
  const dist0 = Math.hypot(playerCar.x - cop.car.x, playerCar.z - cop.car.z);
  for (let i = 0; i < 600; i++) {
    stepVehicle(playerCar, { throttle: 0.6, steer: 0, brake: 0, handbrake: false }, STEP, colliders);
    stepPolice(mgr, STEP, {
      x: playerCar.x, z: playerCar.z, speed: playerCar.speed,
      vx: Math.sin(playerCar.heading) * playerCar.speed,
      vz: Math.cos(playerCar.heading) * playerCar.speed,
      car: playerCar,
    }, heat);
  }
  const dist1 = Math.hypot(playerCar.x - cop.car.x, playerCar.z - cop.car.z);
  assert.equal(cop.state, 'CHASE');
  assert.ok(dist1 < dist0 - 10, `pursuit must close >10 m in 10 s: ${dist0.toFixed(1)} -> ${dist1.toFixed(1)}`);
});

test('unit cap: wanted 2 -> 3 units, wanted 5 -> at most 4', () => {
  const { mgr } = setup();
  ensureUnits(mgr, 2, 0, 0);
  assert.equal(mgr.units.length, 3);
  ensureUnits(mgr, 5, 0, 0);
  assert.equal(mgr.units.length, 4);
  assert.deepEqual(mgr.units.map((u) => u.name), ['Unit Luna-1', 'Unit Luna-2', 'Unit Luna-3', 'Unit Luna-4']);
  const status = policeStatus(mgr, 0, 0);
  assert.equal(status[0].name, 'Unit Luna-1');
  assert.ok(typeof status[0].dist === 'number' && typeof status[0].state === 'string');
});

test('light bar phase alternates and both sides are defined', () => {
  assert.equal(lightPhase(0), 0);
  assert.equal(lightPhase(0.3), 1);
  assert.equal(lightPhase(0.5), 0);
  assert.equal(lightPhase(6), 0); // chase shot ends at 6 s of sim time
});

test('chase sim: 600 steps twice give an identical hash', () => {
  function run() {
    resetVehicleIds();
    const { city, graph, colliders } = setup();
    const mgr = createPoliceManager(graph, city, colliders, makeRng(110));
    const heat = { crimeHeat: 25, wanted: 2 };
    const playerCar = createVehicle('sport', -14, 113, Math.PI / 2);
    ensureUnits(mgr, 2, playerCar.x, playerCar.z);
    const snaps = [];
    for (let i = 0; i < 600; i++) {
      stepVehicle(playerCar, { throttle: 1, steer: Math.sin(i * 0.02) * 0.05, brake: 0, handbrake: false }, STEP, colliders);
      stepPolice(mgr, STEP, {
        x: playerCar.x, z: playerCar.z, speed: playerCar.speed,
        vx: Math.sin(playerCar.heading) * playerCar.speed,
        vz: Math.cos(playerCar.heading) * playerCar.speed,
        car: playerCar,
      }, heat);
      if (i % 60 === 0) {
        snaps.push(JSON.stringify([
          +playerCar.x.toFixed(4), +playerCar.z.toFixed(4), +playerCar.speed.toFixed(4),
          +heat.crimeHeat.toFixed(4), heat.wanted,
          ...mgr.units.flatMap((u) => [+u.car.x.toFixed(3), +u.car.z.toFixed(3), u.state]),
        ]));
      }
    }
    return createHash('sha256').update(snaps.join('|')).digest('hex');
  }
  assert.equal(run(), run());
});
