// Cabo Luna — Day 4G sidewalk graph tests.
// Building-intersection sweep across seeds, determinism, district
// connectivity, crosswalk correctness, and full ped-walk simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, buildingColliders, districtAtPoint } from '../src/city.js';
import { makeRng } from '../src/rng.js';
import { STEP, PEDESTRIAN } from '../src/config.js';
import {
  buildSidewalkGraph, SIDEWALK_OFF, nearestSidewalkNode,
  pointInCollider, segmentHitsCollider, reachableFrom, sidewalkRoute,
} from '../src/sidewalk.js';
import { createPedestrianManager, stepPedestrians, triggerFlee } from '../src/traffic.js';

const CITY_SEEDS = [1, 2, 3, 5, 7, 11, 13, 38, 99, 123, 2026, 777];

test('sidewalk graph: 197 nodes, every node outside every building', () => {
  for (const seed of CITY_SEEDS) {
    const city = generateCity(seed);
    const graph = buildSidewalkGraph(city);
    assert.equal(graph.nodes.size, 49 * 4 + 1, `seed ${seed}: node count`);
    for (const node of graph.nodes.values()) {
      assert.ok(!pointInCollider(graph.colliders, node.x, node.z),
        `seed ${seed}: node ${node.id} (${node.x},${node.z}) inside a building`);
    }
  }
});

test('sidewalk graph: every edge clear of building interiors, all seeds', () => {
  for (const seed of CITY_SEEDS) {
    const city = generateCity(seed);
    const graph = buildSidewalkGraph(city);
    let checked = 0;
    for (const node of graph.nodes.values()) {
      for (const edge of node.neighbors) {
        if (node.id >= edge.id) continue; // each undirected edge once
        const other = graph.nodes.get(edge.id);
        assert.ok(!segmentHitsCollider(node.x, node.z, other.x, other.z, graph.colliders, 0),
          `seed ${seed}: edge ${node.id}->${edge.id} crosses a building`);
        checked += 1;
      }
    }
    assert.equal(checked, 367, `seed ${seed}: expected 367 edges, checked ${checked}`);
  }
});

test('sidewalk graph: exactly one dropped edge — the lighthouse crosswalk', () => {
  const city = generateCity(1);
  const graph = buildSidewalkGraph(city);
  assert.equal(graph.droppedEdges.length, 1,
    `expected 1 dropped edge, got ${JSON.stringify(graph.droppedEdges)}`);
  const dropped = graph.droppedEdges[0];
  assert.equal(dropped.kind, 'cross');
  const a = graph.nodes.get(dropped.a), b = graph.nodes.get(dropped.b);
  const midX = (a.x + b.x) / 2, midZ = (a.z + b.z) / 2;
  assert.ok(Math.abs(midX - city.landmark.x) < 7 && Math.abs(midZ - city.landmark.z) < 7,
    `dropped edge should sit on the lighthouse, midpoint (${midX},${midZ})`);
});

test('sidewalk graph: fully connected, all 6 districts reachable, all seeds', () => {
  for (const seed of CITY_SEEDS) {
    const city = generateCity(seed);
    const graph = buildSidewalkGraph(city);
    const reached = reachableFrom(graph, 'plaza');
    assert.equal(reached.size, graph.nodes.size,
      `seed ${seed}: ${graph.nodes.size - reached.size} nodes unreachable from plaza`);
    const districtsSeen = new Set();
    for (const id of reached) {
      const node = graph.nodes.get(id);
      districtsSeen.add(districtAtPoint(city, node.x, node.z));
    }
    for (const name of city.districts) {
      assert.ok(districtsSeen.has(name), `seed ${seed}: district ${name} has no reachable node`);
    }
  }
});

test('sidewalk graph: crosswalk edges cross a road, walk edges stay on one side', () => {
  const city = generateCity(1);
  const graph = buildSidewalkGraph(city);
  let cross = 0, walk = 0, plaza = 0;
  const seen = new Set();
  for (const node of graph.nodes.values()) {
    for (const edge of node.neighbors) {
      const key = [node.id, edge.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const other = graph.nodes.get(edge.id);
      if (edge.kind === 'cross') {
        cross += 1;
        // Endpoints on opposite sides of some road line, both near it.
        const ok = city.roadLines.some((line) =>
          (node.x - line) * (other.x - line) < 0
          && Math.abs(node.x - line) <= SIDEWALK_OFF + 0.01
          && Math.abs(other.x - line) <= SIDEWALK_OFF + 0.01
          || (node.z - line) * (other.z - line) < 0
          && Math.abs(node.z - line) <= SIDEWALK_OFF + 0.01
          && Math.abs(other.z - line) <= SIDEWALK_OFF + 0.01);
        assert.ok(ok, `cross edge ${node.id}->${edge.id} does not cross a road line`);
      } else if (edge.kind === 'walk') {
        walk += 1;
        // Both endpoints the same offset from the same road line, same side.
        const ok = city.roadLines.some((line) =>
          Math.abs(Math.abs(node.x - line) - SIDEWALK_OFF) < 0.01
          && Math.abs(Math.abs(other.x - line) - SIDEWALK_OFF) < 0.01
          && Math.sign(node.x - line) === Math.sign(other.x - line)
          && Math.abs(node.z - other.z) > 1
          || Math.abs(Math.abs(node.z - line) - SIDEWALK_OFF) < 0.01
          && Math.abs(Math.abs(other.z - line) - SIDEWALK_OFF) < 0.01
          && Math.sign(node.z - line) === Math.sign(other.z - line)
          && Math.abs(node.x - other.x) > 1);
        assert.ok(ok, `walk edge ${node.id}->${edge.id} is not on one sidewalk`);
      } else if (edge.kind === 'plaza') {
        plaza += 1;
        assert.ok(node.id === 'plaza' || edge.id === 'plaza', 'plaza edge must touch plaza');
      }
    }
  }
  assert.ok(cross > 100, `too few crosswalk edges (${cross})`);
  assert.ok(walk === 168, `expected 168 sidewalk edges, got ${walk}`);
  assert.equal(plaza, 4, `plaza should have 4 spokes, got ${plaza}`);
});

test('sidewalk graph: destinations resolve, every destination routable', () => {
  const city = generateCity(1);
  const graph = buildSidewalkGraph(city);
  const names = Object.keys(graph.destinations);
  assert.ok(names.includes('plaza'), 'plaza destination missing');
  assert.ok(names.includes('lighthouse'), 'lighthouse destination missing');
  assert.ok(names.includes('harbor'), 'harbor destination missing');
  assert.ok(names.some((n) => n.startsWith('shop:')), 'no shop destinations');
  for (const name of city.districts) {
    assert.ok(names.includes(`district:${name}`), `district destination ${name} missing`);
  }
  const start = nearestSidewalkNode(graph, 0, 0).id;
  for (const [name, destId] of Object.entries(graph.destinations)) {
    assert.ok(graph.nodes.has(destId), `destination ${name} -> unknown node ${destId}`);
    const route = sidewalkRoute(graph, start, destId);
    assert.ok(route && route.length >= 1, `no route to destination ${name}`);
  }
});

test('sidewalk graph: deterministic — same seed, identical graph and routes', () => {
  const a = buildSidewalkGraph(generateCity(1));
  const b = buildSidewalkGraph(generateCity(1));
  const ser = (g) => JSON.stringify([...g.nodes.values()].map((n) => [
    n.id, n.x, n.z, n.neighbors.map((e) => [e.id, e.kind]),
  ]));
  assert.equal(ser(a), ser(b));
  assert.deepEqual(sidewalkRoute(a, 'c0,0,0', 'c6,6,3'), sidewalkRoute(b, 'c0,0,0', 'c6,6,3'));
});

// Full ped-walk sweep: every step of every ped, across seeds, checked
// against building footprints — plus flee storms mid-walk.
test('pedestrians: zero steps inside buildings, no stuck/NaN/teleport, all seeds', () => {
  const results = [];
  for (const seed of CITY_SEEDS) {
    const city = generateCity(seed);
    const colliders = buildingColliders(city);
    const mgr = createPedestrianManager(city, makeRng(seed * 31 + 7));
    let inside = 0, nan = 0, teleports = 0, checked = 0;
    let prev = mgr.peds.map((p) => [p.x, p.z]);
    const maxStep = (PEDESTRIAN.fleeSpeed * STEP) + 1e-6;
    for (let i = 0; i < 1800; i++) {
      if (i === 600 || i === 1200) {
        // Flee storm: crimes at fixed spots, peds run and must stay out
        // of buildings while fleeing, then resume walking.
        triggerFlee(mgr, 0, 110);
        triggerFlee(mgr, -20, 84);
      }
      stepPedestrians(mgr, STEP);
      for (let k = 0; k < mgr.peds.length; k++) {
        const p = mgr.peds[k];
        checked += 1;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { nan += 1; continue; }
        if (pointInCollider(colliders, p.x, p.z)) inside += 1;
        const d = Math.hypot(p.x - prev[k][0], p.z - prev[k][1]);
        if (d > maxStep) teleports += 1;
        prev[k] = [p.x, p.z];
        assert.ok(p.route === null || p.wpIndex <= p.route.length, 'wpIndex past route end');
        assert.ok(p.route === null || p.route.length >= 2 || p.state === 'WALK', 'empty route');
      }
    }
    const crossed = mgr.peds.reduce((n, p) => n + p.crossed, 0);
    results.push({ seed, inside, nan, teleports, checked, crossed });
    assert.equal(inside, 0, `seed ${seed}: ${inside} ped steps inside buildings`);
    assert.equal(nan, 0, `seed ${seed}: ${nan} NaN positions`);
    assert.equal(teleports, 0, `seed ${seed}: ${teleports} teleports`);
    assert.ok(crossed > 0, `seed ${seed}: no completed crossings in 30 s`);
  }
  // Exact per-seed numbers for the report.
  // eslint-disable-next-line no-console
  console.log('ped sweep:', JSON.stringify(results));
});

test('pedestrians: deterministic — identical seed, identical walks', () => {
  function run() {
    const city = generateCity(1);
    const mgr = createPedestrianManager(city, makeRng(38));
    const snaps = [];
    for (let i = 0; i < 600; i++) {
      stepPedestrians(mgr, STEP);
      if (i % 60 === 0) {
        snaps.push(JSON.stringify(mgr.peds.map((p) => [+p.x.toFixed(3), +p.z.toFixed(3), p.state])));
      }
    }
    return snaps.join('|');
  }
  assert.equal(run(), run());
});

test('pedestrians: flee keeps peds findable near the crime, then they resume', () => {
  const city = generateCity(1);
  const mgr = createPedestrianManager(city, makeRng(38));
  const near = mgr.peds.filter((p) => Math.hypot(p.x - mgr.peds[0].x, p.z - mgr.peds[0].z) < 5);
  assert.ok(near.length >= 1, 'need a ped near the crime spot');
  const crime = { x: mgr.peds[0].x, z: mgr.peds[0].z };
  triggerFlee(mgr, crime.x, crime.z);
  assert.ok(mgr.peds.some((p) => p.state === 'FLEE'), 'no ped fled');
  // After the flee timer, peds walk again on a valid route.
  for (let i = 0; i < 300; i++) stepPedestrians(mgr, STEP);
  assert.ok(mgr.peds.every((p) => p.state !== 'FLEE'), 'peds stuck in FLEE');
  for (const p of mgr.peds) {
    assert.ok(!pointInCollider(mgr.colliders, p.x, p.z), 'ped ended inside a building');
  }
});
