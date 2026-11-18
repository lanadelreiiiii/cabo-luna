// Cabo Luna — traffic cars and pedestrians. Both managers are plain
// data + seeded RNG, renderer-free. Traffic follows A* routes expanded
// to right-hand lane waypoints; pedestrians walk sidewalks, wait at
// crosswalks, cross, and flee from nearby crime.
import { TRAFFIC, PEDESTRIAN } from './config.js';
import { astar, nearestNode, pathToLaneWaypoints, randomNodeId } from './roadgraph.js';
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

function sidewalkPoint(city, rng) {
  const line = city.roadLines[Math.floor(rng.next() * city.roadLines.length)];
  const horizontal = rng.next() < 0.5;
  const along = (rng.next() * 2 - 1) * (city.half - 10);
  const side = rng.next() < 0.5 ? -1 : 1;
  const off = side * PEDESTRIAN.sidewalkOffset;
  if (horizontal) return { x: along, z: line + off, line, horizontal, side };
  return { x: line + off, z: along, line, horizontal, side };
}

// Half the time a pedestrian's next target is the sidewalk directly
// across their current road, so crossings happen often enough to see.
function newTarget(city, rng, ped) {
  if (ped && rng.next() < 0.5) {
    let bestLine = city.roadLines[0], bestAxis = 'z', bestD = Infinity;
    for (const line of city.roadLines) {
      const dz = Math.abs(ped.z - line), dx = Math.abs(ped.x - line);
      if (dz < bestD) { bestD = dz; bestLine = line; bestAxis = 'z'; }
      if (dx < bestD) { bestD = dx; bestLine = line; bestAxis = 'x'; }
    }
    const along = bestAxis === 'z'
      ? Math.max(-city.half + 10, Math.min(city.half - 10, ped.x + rng.range(-30, 30)))
      : Math.max(-city.half + 10, Math.min(city.half - 10, ped.z + rng.range(-30, 30)));
    const side = bestAxis === 'z'
      ? -Math.sign(ped.z - bestLine) || 1
      : -Math.sign(ped.x - bestLine) || 1;
    const off = side * PEDESTRIAN.sidewalkOffset;
    if (bestAxis === 'z') return { x: along, z: bestLine + off, line: bestLine, horizontal: true, side };
    return { x: bestLine + off, z: along, line: bestLine, horizontal: false, side };
  }
  return sidewalkPoint(city, rng);
}

export function createPedestrianManager(city, rng) {
  const peds = [];
  const shirts = [0xd94f3d, 0x3d6fb4, 0x3d8a5a, 0xc9a13d, 0x8a5fbf, 0xe8e8e8, 0x2c4a6e];
  for (let i = 0; i < PEDESTRIAN.count; i++) {
    const at = sidewalkPoint(city, rng);
    const ped = {
      id: i,
      x: at.x, z: at.z,
      heading: rng.next() * Math.PI * 2,
      speed: PEDESTRIAN.walkMin + rng.next() * (PEDESTRIAN.walkMax - PEDESTRIAN.walkMin),
      state: 'WALK',
      target: sidewalkPoint(city, rng),
      waitTimer: 0,
      fleeTimer: 0,
      fleeX: 0, fleeZ: 0,
      shirt: shirts[i % shirts.length],
      crossed: 0,
    };
    peds.push(ped);
  }
  return { peds, city, rng };
}

// A target across the same road (opposite sidewalk) needs a crossing:
// WAIT_CROSS (look both ways) first, then CROSS at higher speed.
function needsCrossing(ped) {
  const t = ped.target;
  if (t.horizontal) {
    return Math.abs(ped.z - t.line) < PEDESTRIAN.sidewalkOffset + 0.5
      && Math.sign(ped.z - t.line) !== Math.sign(t.z - t.line);
  }
  return Math.abs(ped.x - t.line) < PEDESTRIAN.sidewalkOffset + 0.5
    && Math.sign(ped.x - t.line) !== Math.sign(t.x - t.line);
}

export function stepPedestrians(manager, dt) {
  const { peds, city, rng } = manager;
  for (const ped of peds) {
    if (ped.state === 'FLEE') {
      ped.fleeTimer -= dt;
      const dx = ped.x - ped.fleeX, dz = ped.z - ped.fleeZ;
      const len = Math.hypot(dx, dz) || 1;
      ped.heading = Math.atan2(dx / len, dz / len);
      ped.x += (dx / len) * PEDESTRIAN.fleeSpeed * dt;
      ped.z += (dz / len) * PEDESTRIAN.fleeSpeed * dt;
      if (ped.fleeTimer <= 0) ped.state = 'WALK';
      continue;
    }
    const dx = ped.target.x - ped.x, dz = ped.target.z - ped.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.2) {
      ped.target = newTarget(city, rng, ped);
      ped.state = 'WALK';
      continue;
    }
    if (ped.state === 'WALK' && needsCrossing(ped)) {
      ped.state = 'WAIT_CROSS';
      ped.waitTimer = PEDESTRIAN.waitMin + rng.next() * (PEDESTRIAN.waitMax - PEDESTRIAN.waitMin);
      continue;
    }
    if (ped.state === 'WAIT_CROSS') {
      ped.waitTimer -= dt;
      if (ped.waitTimer <= 0) { ped.state = 'CROSS'; ped.crossed += 1; }
      continue;
    }
    const speed = ped.state === 'CROSS' ? ped.speed * PEDESTRIAN.crossSpeedMul : ped.speed;
    ped.heading = Math.atan2(dx, dz);
    ped.x += (dx / dist) * speed * dt;
    ped.z += (dz / dist) * speed * dt;
    if (ped.state === 'CROSS' && !needsCrossing(ped)) ped.state = 'WALK';
  }
  return manager;
}

// Crime nearby makes pedestrians within fleeRadius run away.
export function triggerFlee(manager, x, z) {
  for (const ped of manager.peds) {
    if (Math.hypot(ped.x - x, ped.z - z) < PEDESTRIAN.fleeRadius) {
      ped.state = 'FLEE';
      ped.fleeTimer = PEDESTRIAN.fleeTime;
      ped.fleeX = x; ped.fleeZ = z;
    }
  }
}
