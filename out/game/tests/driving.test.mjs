// Cabo Luna Part A — Node tests (stdlib only). Run: node --test game/tests/
// Every sim module is renderer-free, so these import the real game code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateCity, serializeCity, buildingColliders, nearestRoad } from '../src/city.js';
import { makeRng } from '../src/rng.js';
import { STEP, TRAFFIC, VEHICLE } from '../src/config.js';
import { buildRoadGraph, nearestNode, astar, pathToLaneWaypoints, nodeId } from '../src/roadgraph.js';
import { createVehicle, stepVehicle, nearestEnterableCar, applySteal, resetVehicleIds } from '../src/vehicles.js';
import { createTrafficManager, stepTraffic, createPedestrianManager, stepPedestrians, triggerFlee } from '../src/traffic.js';
import { wantedFromHeat } from '../src/config.js';

const IDLE = { throttle: 0, steer: 0, brake: 0, handbrake: false };
const FULL = { throttle: 1, steer: 0, brake: 0, handbrake: false };

test('city: deterministic, 7 road lines', () => {
  const a = generateCity(1), b = generateCity(1);
  assert.equal(serializeCity(a), serializeCity(b));
  assert.equal(a.roadLines.length, 7);
  assert.notEqual(serializeCity(generateCity(1)), serializeCity(generateCity(2)));
});

test('roadgraph: 49 nodes, A* corner-to-corner is adjacent + deterministic', () => {
  const city = generateCity(1);
  const graph = buildRoadGraph(city);
  assert.equal(graph.nodes.size, 49);
  const start = nodeId(0, 0), goal = nodeId(6, 6);
  const p1 = astar(graph, start, goal);
  const p2 = astar(graph, start, goal);
  assert.deepEqual(p1, p2);
  assert.ok(p1.length > 2);
  for (let i = 1; i < p1.length; i++) {
    const a = graph.nodes.get(p1[i - 1]), b = graph.nodes.get(p1[i]);
    assert.ok(Math.abs(a.ix - b.ix) + Math.abs(a.iz - b.iz) === 1, 'consecutive nodes must be adjacent');
  }
  assert.equal(astar(graph, 'nope', goal), null);
  assert.deepEqual(astar(graph, start, start), [start]);
});

test('roadgraph: lane waypoints sit on the right-hand side', () => {
  const city = generateCity(1);
  const graph = buildRoadGraph(city);
  // Eastbound leg (0,0) -> (1,0): forward is +x, right side is +z.
  const wps = pathToLaneWaypoints(graph, [nodeId(0, 0), nodeId(1, 0)]);
  assert.equal(wps.length, 1);
  const target = graph.nodes.get(nodeId(1, 0));
  assert.ok(Math.abs(wps[0].x - target.x) < 0.01);
  assert.ok(wps[0].z - target.z > 2.5 && wps[0].z - target.z < 3.5, `eastbound lane offset should be +z, got ${wps[0].z - target.z}`);
  // Northbound leg (1,0) -> (1,1): forward is +z, right side is -x.
  const wps2 = pathToLaneWaypoints(graph, [nodeId(1, 0), nodeId(1, 1)]);
  const t2 = graph.nodes.get(nodeId(1, 1));
  assert.ok(t2.x - wps2[0].x > 2.5 && t2.x - wps2[0].x < 3.5, 'northbound lane offset should be -x');
});

test('vehicle: full throttle reaches speed', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  for (let i = 0; i < 300; i++) stepVehicle(v, FULL, STEP, []);
  assert.ok(v.speed > 15, `expected >15 m/s after 5 s, got ${v.speed}`);
  assert.ok(v.speed <= v.config.maxSpeed);
});

test('vehicle: brake stops the car without reversing', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  for (let i = 0; i < 180; i++) stepVehicle(v, FULL, STEP, []);
  assert.ok(v.speed > 10);
  // Brake just past the stop: the 0.4 s standstill rule means a longer
  // hold would engage reverse (covered by the reverse test below).
  for (let i = 0; i < 45; i++) stepVehicle(v, { ...IDLE, brake: 1 }, STEP, []);
  assert.ok(Math.abs(v.speed) < 0.5, `expected standstill, got ${v.speed}`);
});

test('vehicle: holding brake past 0.4 s standstill reverses', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  for (let i = 0; i < 180; i++) stepVehicle(v, FULL, STEP, []);
  for (let i = 0; i < 300; i++) stepVehicle(v, { ...IDLE, brake: 1 }, STEP, []);
  assert.ok(v.speed < -1, `expected reverse, got ${v.speed}`);
});

test('vehicle: steering changes heading while moving', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  const h0 = v.heading;
  for (let i = 0; i < 180; i++) stepVehicle(v, { ...FULL, steer: 1 }, STEP, []);
  assert.ok(Math.abs(v.heading - h0) > 0.2, `heading barely changed: ${v.heading - h0}`);
});

test('vehicle: driving into a building never penetrates it', () => {
  const city = generateCity(1);
  const colliders = buildingColliders(city);
  const b = city.buildings[0];
  const v = createVehicle('sedan', b.x - b.w / 2 - 6, b.z, Math.PI / 2);
  let everInside = false;
  for (let i = 0; i < 600; i++) {
    stepVehicle(v, FULL, STEP, colliders);
    for (const c of colliders) {
      if (v.x > c.minX && v.x < c.maxX && v.z > c.minZ && v.z < c.maxZ) everInside = true;
    }
  }
  assert.equal(everInside, false, 'car centre entered a building AABB');
  assert.ok(v.collisions > 0, 'expected at least one registered collision');
  assert.ok(v.x < b.x - b.w / 2 + v.radius, 'car must end outside the wall');
});

test('vehicle: suspension pitch is observable under throttle and brake', () => {
  const v = createVehicle('sedan', 0, 0, 0);
  for (let i = 0; i < 120; i++) stepVehicle(v, FULL, STEP, []);
  const pitchThrottle = v.pitch;
  assert.ok(pitchThrottle > 0.05, `expected rear squat pitch >0.05, got ${pitchThrottle}`);
  for (let i = 0; i < 120; i++) stepVehicle(v, { ...IDLE, brake: 1 }, STEP, []);
  assert.ok(v.pitch < -0.05, `expected front dive pitch <-0.05, got ${v.pitch}`);
});

test('traffic: cars follow lanes, keep moving, keep a gap', () => {
  const city = generateCity(1);
  const graph = buildRoadGraph(city);
  const mgr = createTrafficManager(graph, city, makeRng(38));
  const starts = mgr.cars.map((c) => ({ x: c.x, z: c.z }));
  for (let i = 0; i < 600; i++) stepTraffic(mgr, STEP);
  for (let i = 0; i < mgr.cars.length; i++) {
    const c = mgr.cars[i];
    const moved = Math.hypot(c.x - starts[i].x, c.z - starts[i].z);
    assert.ok(moved > 5, `traffic car ${i} barely moved: ${moved}`);
    const road = nearestRoad(city, c.x, c.z);
    assert.ok(road.dist < 6.5, `traffic car ${i} left the road: ${road.dist} m from centre`);
  }
  let minGap = Infinity;
  for (let i = 0; i < mgr.cars.length; i++) {
    for (let j = i + 1; j < mgr.cars.length; j++) {
      minGap = Math.min(minGap, Math.hypot(mgr.cars[i].x - mgr.cars[j].x, mgr.cars[i].z - mgr.cars[j].z));
    }
  }
  assert.ok(minGap > 1.2, `traffic cars overlapped: min gap ${minGap}`);
});

test('pedestrian: crossings at crosswalks are observed', () => {
  const city = generateCity(1);
  const mgr = createPedestrianManager(city, makeRng(38));
  let crossSteps = 0;
  for (let i = 0; i < 3600; i++) {
    stepPedestrians(mgr, STEP);
    if (mgr.peds.some((p) => p.state === 'CROSS')) crossSteps += 1;
  }
  const crossed = mgr.peds.reduce((n, p) => n + p.crossed, 0);
  assert.ok(crossSteps > 0, 'no pedestrian ever entered CROSS in 60 s');
  assert.ok(crossed > 0, 'no completed crossing recorded');
  // Flee: a crime nearby makes pedestrians run.
  triggerFlee(mgr, mgr.peds[0].x, mgr.peds[0].z);
  assert.equal(mgr.peds[0].state, 'FLEE');
});

test('enter/exit + steal: crime heat 25, wanted from heat formula', () => {
  resetVehicleIds();
  const car = createVehicle('sedan', 5, 0, 0, { parked: true });
  const found = nearestEnterableCar([car], 4, 0);
  assert.equal(found, car);
  assert.equal(nearestEnterableCar([car], 50, 0), null);
  const heat = { crimeHeat: 0, wanted: 0 };
  applySteal(heat, car);
  assert.equal(heat.crimeHeat, 25);
  // Formula: wanted = min(5, ceil(heat/20)) -> ceil(25/20) = 2.
  assert.equal(heat.wanted, 2);
  assert.equal(wantedFromHeat(0), 0);
  assert.equal(wantedFromHeat(100), 5);
  // Re-entering your own car is not a second crime.
  const heat2 = { crimeHeat: 25, wanted: 2 };
  car.owned = true;
  applySteal(heat2, car);
  assert.equal(heat2.crimeHeat, 25);
});

test('full sim: 600 steps twice give an identical state hash', () => {
  function run() {
    resetVehicleIds();
    const city = generateCity(1);
    const graph = buildRoadGraph(city);
    const colliders = buildingColliders(city);
    const rng = makeRng(38);
    const traffic = createTrafficManager(graph, city, rng);
    const peds = createPedestrianManager(city, rng);
    const car = createVehicle('sport', -14, 113, Math.PI / 2);
    const snaps = [];
    for (let i = 0; i < 600; i++) {
      stepVehicle(car, { throttle: 1, steer: Math.sin(i * 0.01) * 0.2, brake: 0, handbrake: false }, STEP, colliders);
      stepTraffic(traffic, STEP, [{ x: car.x, z: car.z }]);
      stepPedestrians(peds, STEP);
      if (i % 60 === 0) {
        snaps.push(JSON.stringify([
          +car.x.toFixed(4), +car.z.toFixed(4), +car.speed.toFixed(4),
          ...traffic.cars.flatMap((c) => [+c.x.toFixed(3), +c.z.toFixed(3)]),
          ...peds.peds.flatMap((p) => [+p.x.toFixed(3), +p.z.toFixed(3), p.state]),
        ]));
      }
    }
    return createHash('sha256').update(snaps.join('|')).digest('hex');
  }
  const h1 = run(), h2 = run();
  assert.equal(h1, h2, `determinism hash mismatch: ${h1} vs ${h2}`);
});
