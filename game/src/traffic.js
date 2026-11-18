// Cabo Luna — traffic cars and pedestrians. Both managers are plain
// data + seeded RNG, renderer-free. Traffic follows A* routes expanded
// to right-hand lane waypoints; pedestrians walk the sidewalk graph
// (sidewalk.js): corner nodes offset from the road lines, sidewalk
// edges along each segment, crosswalk edges across intersections, and
// named destinations. Every ped step follows a graph edge, so no ped
// ever walks through a building; fleeing peds slide around colliders.
import { TRAFFIC, PEDESTRIAN } from './config.js';
import { astar, nearestNode, pathToLaneWaypoints, randomNodeId } from './roadgraph.js';
import {
  buildSidewalkGraph, nearestSidewalkNode, randomSidewalkNodeId,
} from './sidewalk.js';
import { createVehicle } from './vehicles.js';

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(heading, targetHeading, maxRate, dt) {
  const d = angleDiff(targetHeading, heading);
  const step = Math.max(-maxRate * dt, Math.min(maxRate * dt, d));
  return heading + step;
}

// ---- Traffic -------------------------------------------------------

export function createTrafficManager(graph, city, rng) {
  const cars = [];
  for (let i = 0; i < TRAFFIC.count; i++) {
    const fromId = randomNodeId(graph, rng);
    const from = graph.nodes.get(fromId);
    const edge = from.neighbors[Math.floor(rng.next() * from.neighbors.length)];
    const to = graph.nodes.get(edge.id);
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    const car = createVehicle(rng.next() < 0.3 ? 'sport' : 'sedan', from.x, from.z, heading, { parked: false });
    car.cruise = TRAFFIC.cruiseMin + rng.next() * (TRAFFIC.cruiseMax - TRAFFIC.cruiseMin);
    car.speed = car.cruise * 0.6;
    car.route = null;
    car.waypoints = [];
    car.wpIndex = 0;
    car.state = 'DRIVE';
    cars.push(car);
    assignRoute(graph, rng, car);
    // Start on the lane of the first waypoint, facing it.
    if (car.waypoints.length > 0) {
      const wp = car.waypoints[0];
      car.x = wp.x; car.z = wp.z;
      car.heading = Math.atan2(wp.x - from.x, wp.z - from.z);
    }
  }
  return { cars, graph, rng };
}

function assignRoute(graph, rng, car) {
  const start = nearestNode(graph, car.x, car.z);
  const destId = randomNodeId(graph, rng);
  const path = astar(graph, start.id, destId);
  if (!path || path.length < 2) {
    car.route = null;
    car.waypoints = [];
    car.wpIndex = 0;
    return;
  }
  car.route = path;
  car.waypoints = pathToLaneWaypoints(graph, path);
  car.wpIndex = 0;
}

function carAhead(cars, self, probeX, probeZ, radius) {
  for (const other of cars) {
    if (other === self) continue;
    if (Math.hypot(other.x - probeX, other.z - probeZ) < radius) return other;
  }
  return null;
}

// Step all traffic cars. `obstacles` are extra circles to stop for
// (e.g. the player's car): [{ x, z }].
export function stepTraffic(manager, dt, obstacles = []) {
  const { cars, graph, rng } = manager;
  for (const car of cars) {
    if (car.waypoints.length === 0 || car.wpIndex >= car.waypoints.length) {
      assignRoute(graph, rng, car);
      if (car.waypoints.length === 0) continue;
    }
    const wp = car.waypoints[car.wpIndex];
    const distWp = Math.hypot(wp.x - car.x, wp.z - car.z);
    if (distWp < TRAFFIC.waypointRadius) {
      car.wpIndex += 1;
      continue;
    }
    // Car-following: probe ahead; anything close means WAIT.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const probeX = car.x + fx * TRAFFIC.probeAhead;
    const probeZ = car.z + fz * TRAFFIC.probeAhead;
    let blocked = carAhead(cars, car, probeX, probeZ, TRAFFIC.stopDistance);
    if (!blocked) {
      for (const ob of obstacles) {
        if (Math.hypot(ob.x - probeX, ob.z - probeZ) < TRAFFIC.stopDistance) { blocked = ob; break; }
      }
    }
    // Junctions: slow down near the next intersection node.
    const node = graph.nodes.get(wp.nodeId);
    const nearJunction = node && Math.hypot(node.x - car.x, node.z - car.z) < TRAFFIC.junctionRadius;
    let targetSpeed = car.cruise;
    car.state = 'DRIVE';
    if (blocked) { targetSpeed = 0; car.state = 'WAIT'; }
    else if (nearJunction) { targetSpeed = car.cruise * TRAFFIC.junctionFactor; car.state = 'JUNCTION'; }

    // Ease speed toward the target, then steer toward the waypoint.
    const rate = targetSpeed < car.speed ? TRAFFIC.accelDown : TRAFFIC.accelUp;
    car.speed += Math.max(-rate * dt, Math.min(rate * dt, targetSpeed - car.speed));
    const wantHeading = Math.atan2(wp.x - car.x, wp.z - car.z);
    car.heading = turnToward(car.heading, wantHeading, TRAFFIC.turnRate, dt);
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += Math.cos(car.heading) * car.speed * dt;
    // Traffic cars are simple movers: reuse the vehicle collision
    // push-out only (no throttle model) via a zero-input vehicle step
    // would fight the speed above, so clamp them to the road instead:
    // they stay on lanes by construction; buildings sit inside blocks.
  }
  return manager;
}

// ---- Pedestrians ---------------------------------------------------
// Pedestrians walk the sidewalk graph: spawn on a node, pick a
// destination (a random node, or a named place — plaza, lighthouse,
// harbour, a shop, a district landmark), A* a route, and walk it
// node to node. The edge into the next node decides the state: a
// 'cross' edge means WAIT_CROSS (look both ways) then CROSS.

// 30% of trips go to a named destination, the rest to a random node.
function newTarget(manager, ped) {
  const { graph, rng } = manager;
  const destIds = Object.values(graph.destinations);
  let destId;
  if (rng.next() < 0.3) destId = destIds[Math.floor(rng.next() * destIds.length)];
  else destId = randomSidewalkNodeId(graph, rng);
  const node = graph.nodes.get(destId);
  return { x: node.x, z: node.z, destId };
}

// Plan ped.route from the ped's current position to ped.target.
// Returns true when the ped has a walkable route.
function planRoute(manager, ped) {
  const { graph } = manager;
  const from = nearestSidewalkNode(graph, ped.x, ped.z);
  const to = (ped.target.destId && graph.nodes.get(ped.target.destId))
    ? graph.nodes.get(ped.target.destId)
    : nearestSidewalkNode(graph, ped.target.x, ped.target.z);
  const route = astar(graph, from.id, to.id);
  if (!route || route.length < 2) return false;
  ped.route = route;
  ped.wpIndex = 0; // first walk to the nearest node, along the current edge
  return true;
}

export function createPedestrianManager(city, rng) {
  const graph = buildSidewalkGraph(city);
  const peds = [];
  const shirts = [0xd94f3d, 0x3d6fb4, 0x3d8a5a, 0xc9a13d, 0x8a5fbf, 0xe8e8e8, 0x2c4a6e];
  const manager = { peds, city, rng, graph, colliders: graph.colliders };
  for (let i = 0; i < PEDESTRIAN.count; i++) {
    const at = graph.nodes.get(randomSidewalkNodeId(graph, rng));
    const ped = {
      id: i,
      x: at.x, z: at.z,
      heading: rng.next() * Math.PI * 2,
      speed: PEDESTRIAN.walkMin + rng.next() * (PEDESTRIAN.walkMax - PEDESTRIAN.walkMin),
      state: 'WALK',
      target: null,
      route: null,
      wpIndex: 0,
      waitTimer: 0,
      fleeTimer: 0,
      fleeX: 0, fleeZ: 0,
      shirt: shirts[i % shirts.length],
      crossed: 0,
    };
    ped.target = newTarget(manager, ped);
    if (!planRoute(manager, ped)) { // graph is connected; never happens
      ped.target = newTarget(manager, ped);
      planRoute(manager, ped);
    }
    peds.push(ped);
  }
  return manager;
}

// Kind of the graph edge from node `fromId` to node `toId`.
function edgeKind(graph, fromId, toId) {
  const node = graph.nodes.get(fromId);
  if (!node) return 'walk';
  const edge = node.neighbors.find((e) => e.id === toId);
  return edge ? edge.kind : 'walk';
}

// Fleeing runs along the sidewalk graph, not in a straight line:
// a straight run off the sidewalk can end deep inside a block, and
// the walk back would cut through buildings. The ped routes to a
// node far from the crime and runs that route at flee speed.
function planFleeRoute(manager, ped) {
  const { graph, rng } = manager;
  const from = nearestSidewalkNode(graph, ped.x, ped.z);
  let bestId = from.id, bestD = -1;
  for (let k = 0; k < 6; k++) {
    const cand = graph.nodes.get(randomSidewalkNodeId(graph, rng));
    const d = Math.hypot(cand.x - ped.fleeX, cand.z - ped.fleeZ);
    if (d > bestD || (d === bestD && cand.id < bestId)) { bestD = d; bestId = cand.id; }
  }
  const route = astar(graph, from.id, bestId);
  ped.route = route && route.length >= 1 ? route : [from.id];
  ped.wpIndex = 0; // first walk to the nearest node, along the current edge
}

export function stepPedestrians(manager, dt) {
  const { peds, graph, rng } = manager;
  for (const ped of peds) {
    if (ped.state === 'FLEE') {
      ped.fleeTimer -= dt;
      // Run the flee route at flee speed; the first leg walks back to
      // the nearest node along the current edge, so no step cuts
      // across a block. Never wait at crosswalks while fleeing.
      if (!ped.route || ped.wpIndex >= ped.route.length) planFleeRoute(manager, ped);
      const nextId = ped.route[ped.wpIndex];
      const node = graph.nodes.get(nextId);
      if (node && Number.isFinite(node.x) && Number.isFinite(node.z)) {
        const dx = node.x - ped.x, dz = node.z - ped.z;
        const dist = Math.hypot(dx, dz);
        // Land exactly on the node (see the WALK branch): turning
        // early would cut corners into buildings.
        if (dist <= Math.max(PEDESTRIAN.fleeSpeed * dt, 0.02)) {
          ped.x = node.x; ped.z = node.z;
          ped.wpIndex += 1;
        } else {
          ped.heading = Math.atan2(dx, dz);
          ped.x += (dx / dist) * PEDESTRIAN.fleeSpeed * dt;
          ped.z += (dz / dist) * PEDESTRIAN.fleeSpeed * dt;
        }
      }
      if (ped.fleeTimer <= 0) { ped.state = 'WALK'; ped.route = null; }
      continue;
    }
    // (Re)plan when the route is spent or was cleared — e.g. a staged
    // target set from outside (shots.js) or the end of a flee.
    if (!ped.route || ped.wpIndex >= ped.route.length) {
      if (!planRoute(manager, ped)) {
        ped.target = newTarget(manager, ped);
        planRoute(manager, ped);
      }
      if (!ped.route) continue; // no route at all: wait this step
    }
    const nextId = ped.route[ped.wpIndex];
    const node = graph.nodes.get(nextId);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.z)) {
      ped.route = null;
      continue;
    }
    const dx = node.x - ped.x, dz = node.z - ped.z;
    const dist = Math.hypot(dx, dz);
    const speed = ped.state === 'CROSS' ? ped.speed * PEDESTRIAN.crossSpeedMul : ped.speed;
    // Land exactly on the node: turning early (the old 1.2 m arrival
    // radius) cut corners by up to 1.2 m, more than the 0.3 m the
    // sidewalk edges clear buildings by. The landing move is at most
    // one step's distance, so it is not a teleport.
    if (dist <= Math.max(speed * dt, 0.02)) {
      ped.x = node.x; ped.z = node.z;
      if (ped.state === 'CROSS') ped.state = 'WALK';
      ped.wpIndex += 1;
      if (ped.wpIndex >= ped.route.length) {
        ped.target = newTarget(manager, ped);
        ped.route = null;
      }
      continue;
    }
    // About to step onto a crosswalk edge: wait, look both ways.
    // Only when standing at the edge's start node (within 1.2 m of
    // route[wpIndex-1]) — a ped re-planning mid-edge after a flee
    // must not freeze in the middle of the road.
    if (ped.state === 'WALK' && ped.wpIndex > 0
      && edgeKind(graph, ped.route[ped.wpIndex - 1], nextId) === 'cross') {
      const from = graph.nodes.get(ped.route[ped.wpIndex - 1]);
      if (from && Math.hypot(from.x - ped.x, from.z - ped.z) < 1.2) {
        ped.state = 'WAIT_CROSS';
        ped.waitTimer = PEDESTRIAN.waitMin + rng.next() * (PEDESTRIAN.waitMax - PEDESTRIAN.waitMin);
        continue;
      }
    }
    if (ped.state === 'WAIT_CROSS') {
      ped.waitTimer -= dt;
      if (ped.waitTimer <= 0) { ped.state = 'CROSS'; ped.crossed += 1; }
      continue;
    }
    ped.heading = Math.atan2(dx, dz);
    ped.x += (dx / dist) * speed * dt;
    ped.z += (dz / dist) * speed * dt;
  }
  return manager;
}

// Crime nearby makes pedestrians within fleeRadius run away —
// along the sidewalk graph, away from the crime (see planFleeRoute).
export function triggerFlee(manager, x, z) {
  for (const ped of manager.peds) {
    if (Math.hypot(ped.x - x, ped.z - z) < PEDESTRIAN.fleeRadius) {
      ped.state = 'FLEE';
      ped.fleeTimer = PEDESTRIAN.fleeTime;
      ped.fleeX = x; ped.fleeZ = z;
      planFleeRoute(manager, ped);
    }
  }
}
