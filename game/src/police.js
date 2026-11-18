// Cabo Luna — wanted heat + the Cabo Luna Patrol.
// Renderer-free: plain data + the shared vehicle model, so Node tests
// import it directly. One behaviour tree is re-evaluated from the root
// every tick for every unit:
//
//   arrest  [close + player slow + wanted] -> BUSTED
//   chase   [wanted > 0, in radius, line of sight] OR [CHASE + unseen <= grace]
//   search  [a last known position exists]
//   patrol  [fallback: cruise a seeded route]
//
// Cops only ever know the player's live position while chasing; while
// searching they drive to the last seen spot. Wanted heat decays only
// while nobody sees the player. Everything flows from the seeded RNG.
import { POLICE, wantedFromHeat } from './config.js';
import { astar, nearestNode, pathToLaneWaypoints } from './roadgraph.js';
import { createVehicle, stepVehicle } from './vehicles.js';

export const UNIT_NAMES = ['Unit Luna-1', 'Unit Luna-2', 'Unit Luna-3', 'Unit Luna-4'];

// Light-bar phase from sim time: 0 = red side hot, 1 = blue side hot.
// Both sides keep a dim glow so a still frame always reads both colours.
export function lightPhase(t) {
  return Math.floor(t * POLICE.flashHz) % 2;
}

// Segment (ax,az)->(bx,bz) vs building AABBs. Slab test; touching an
// edge counts as blocked so cops never see through a wall corner.
export function hasLineOfSight(ax, az, bx, bz, colliders) {
  const dx = bx - ax, dz = bz - az;
  for (const c of colliders) {
    let tmin = 0, tmax = 1;
    for (const [p, d, lo, hi] of [[ax, dx, c.minX, c.maxX], [az, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) { tmin = 1; tmax = 0; break; }
      } else {
        let t1 = (lo - p) / d, t2 = (hi - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) break;
      }
    }
    if (tmin <= tmax) return false;
  }
  return true;
}

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Drive the unit's car toward a point at a target speed using the
// shared arcade vehicle model. Returns true when within `arrive` m.
function driveToward(unit, tx, tz, targetSpeed, dt, colliders) {
  const car = unit.car;
  const dx = tx - car.x, dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 2) return true;
  const wantHeading = Math.atan2(dx, dz);
  const err = angleDiff(wantHeading, car.heading);
  const steer = Math.max(-1, Math.min(1, err * 1.6));
  let throttle = 0, brake = 0;
  if (Math.abs(err) > 1.9) brake = 0.8; // too far off-heading: stop and turn
  else if (car.speed < targetSpeed) throttle = Math.max(0.25, Math.min(1, (targetSpeed - car.speed) / 6));
  else if (car.speed > targetSpeed + 1.5) brake = 0.6;
  stepVehicle(car, { throttle, steer, brake, handbrake: false }, dt, colliders);
  return false;
}

// Plan an A* route from the unit's car to a point, expanded to lane
// waypoints. Returns the waypoint list (possibly empty).
function planRoute(manager, unit, tx, tz) {
  const from = nearestNode(manager.graph, unit.car.x, unit.car.z);
  const to = nearestNode(manager.graph, tx, tz);
  const path = astar(manager.graph, from.id, to.id);
  if (!path || path.length < 2) return [];
  return pathToLaneWaypoints(manager.graph, path);
}

export function createPoliceManager(graph, city, colliders, rng) {
  return {
    graph, city, colliders, rng,
    units: [],
    busted: false,
    unseenTimer: 0,
    elapsed: 0,
    spawnedForWanted: 0,
  };
}

function spawnUnit(manager, px, pz) {
  const idx = manager.units.length;
  const name = UNIT_NAMES[idx % UNIT_NAMES.length];
  // Seeded pick from road nodes in a ring around the player: close
  // enough to respond, never on top of the player.
  const ring = [];
  for (const node of manager.graph.nodes.values()) {
    const d = Math.hypot(node.x - px, node.z - pz);
    if (d >= POLICE.spawnMinDist && d <= POLICE.spawnMaxDist) ring.push(node);
  }
  ring.sort((a, b) => (a.id < b.id ? -1 : 1));
  const node = ring.length > 0
    ? ring[Math.floor(manager.rng.next() * ring.length)]
    : manager.graph.nodes.get('3,3');
  const car = createVehicle('police', node.x, node.z, manager.rng.next() * Math.PI * 2);
  const unit = {
    name, car,
    state: 'PATROL',
    stateTimer: 0,
    unseenTimer: 0,
    lastKnown: null,
    searchTimer: 0,
    replanTimer: 0,
    waypoints: [],
    wpIndex: 0,
    bustedTimer: 0,
    patrolTarget: { x: node.x, z: node.z },
  };
  manager.units.push(unit);
  return unit;
}

// Grow the force to the cap for the current wanted level:
// wanted + 1 units, at most POLICE.maxUnits. Never teleports a unit
// that already exists; new units spawn in the ring around the player.
export function ensureUnits(manager, wanted, px, pz) {
  if (wanted <= 0) return;
  const want = Math.min(POLICE.maxUnits, wanted + 1);
  while (manager.units.length < want) spawnUnit(manager, px, pz);
}

// One unit, one tick. The tree is re-read from the root every tick:
// arrest first, then chase, then search, then patrol as the fallback.
function stepUnit(manager, unit, dt, player, wanted) {
  const car = unit.car;
  const dist = Math.hypot(player.x - car.x, player.z - car.z);
  const radius = POLICE.detectRadius[wanted] ?? 0;
  const inRange = wanted > 0 && dist <= radius;
  const seen = inRange && hasLineOfSight(car.x, car.z, player.x, player.z, manager.colliders);
  if (seen) {
    unit.lastKnown = { x: player.x, z: player.z };
    unit.unseenTimer = 0;
  } else {
    unit.unseenTimer += dt;
  }
  unit.stateTimer += dt;

  // --- arrest branch: close to a slow player while wanted ----------
  if (unit.state === 'CHASE' || unit.state === 'SEARCH') {
    if (wanted > 0 && dist < POLICE.bustedRange && Math.abs(player.speed) < POLICE.bustedSpeed) {
      unit.bustedTimer += dt;
      if (unit.bustedTimer >= POLICE.bustedTime) {
        unit.state = 'BUSTED';
        manager.busted = true;
        return seen;
      }
    } else {
      unit.bustedTimer = 0;
    }
  }
  if (unit.state === 'BUSTED') return seen;

  // --- chase branch: seen now, or still inside the unseen grace ----
  const chaseValid = seen || (unit.state === 'CHASE' && unit.unseenTimer <= POLICE.unseenGrace);
  if (chaseValid) {
    if (unit.state !== 'CHASE') { unit.state = 'CHASE'; unit.stateTimer = 0; unit.replanTimer = 0; }
    unit.replanTimer -= dt;
    if (unit.replanTimer <= 0 || unit.wpIndex >= unit.waypoints.length) {
      unit.waypoints = planRoute(manager, unit, player.x, player.z);
      unit.wpIndex = 0;
      unit.replanTimer = POLICE.replanInterval;
    }
    // Aim at a point ahead of the player along its velocity so the
    // pursuit intercepts instead of tail-chasing forever.
    const ix = player.x + (player.vx ?? 0) * POLICE.interceptLead;
    const iz = player.z + (player.vz ?? 0) * POLICE.interceptLead;
    let target = unit.wpIndex < unit.waypoints.length ? unit.waypoints[unit.wpIndex] : null;
    if (target && Math.hypot(target.x - car.x, target.z - car.z) < 2.5) {
      unit.wpIndex += 1;
      target = unit.wpIndex < unit.waypoints.length ? unit.waypoints[unit.wpIndex] : null;
    }
    const closeToPlayer = Math.hypot(ix - car.x, iz - car.z) < 12;
    if (!target || closeToPlayer) {
      // Close in: steer straight at the intercept point.
      driveToward(unit, ix, iz, POLICE.chaseSpeed, dt, manager.colliders);
    } else {
      driveToward(unit, target.x, target.z, POLICE.chaseSpeed, dt, manager.colliders);
    }
    // PIT-lite: alongside and slightly behind the player's rear
    // quarter, lean in and scrub the player's speed on contact.
    if (player.car && dist < 3.2) {
      const fx = Math.sin(player.car.heading), fz = Math.cos(player.car.heading);
      const behind = (car.x - player.car.x) * fx + (car.z - player.car.z) * fz;
      if (behind < 0.5) {
        player.car.speed *= Math.max(0, 1 - 0.6 * dt);
        car.speed *= Math.max(0, 1 - 0.3 * dt);
      }
    }
    return seen;
  }

  // --- search branch: drive to the last known spot, then give up ----
  if (unit.state === 'CHASE' && unit.unseenTimer > POLICE.unseenGrace) {
    unit.state = 'SEARCH';
    unit.stateTimer = 0;
    unit.searchTimer = POLICE.searchTime;
    unit.waypoints = unit.lastKnown ? planRoute(manager, unit, unit.lastKnown.x, unit.lastKnown.z) : [];
    unit.wpIndex = 0;
  }
  if (unit.state === 'SEARCH') {
    unit.searchTimer -= dt;
    let arrived = false;
    if (unit.lastKnown) {
      if (unit.wpIndex < unit.waypoints.length) {
        const wp = unit.waypoints[unit.wpIndex];
        if (driveToward(unit, wp.x, wp.z, POLICE.searchSpeed, dt, manager.colliders)) unit.wpIndex += 1;
      } else {
        arrived = driveToward(unit, unit.lastKnown.x, unit.lastKnown.z, POLICE.searchSpeed, dt, manager.colliders);
      }
    } else {
      arrived = true;
    }
    if (arrived || unit.searchTimer <= 0) {
      unit.state = 'PATROL';
      unit.stateTimer = 0;
      unit.lastKnown = null;
      unit.patrolTarget = { x: car.x, z: car.z };
    }
    return seen;
  }

  // --- patrol fallback: cruise a seeded route -----------------------
  if (unit.state !== 'PATROL') { unit.state = 'PATROL'; unit.stateTimer = 0; }
  if (unit.waypoints.length === 0 || unit.wpIndex >= unit.waypoints.length) {
    const dest = manager.graph.nodes.get(
      [...manager.graph.nodes.keys()][Math.floor(manager.rng.next() * manager.graph.nodes.size)],
    );
    unit.waypoints = planRoute(manager, unit, dest.x, dest.z);
    unit.wpIndex = 0;
    if (unit.waypoints.length === 0) {
      // Same node: nudge the target so the unit keeps moving.
      unit.waypoints = [{ x: car.x + 10, z: car.z, nodeId: null }];
    }
  }
  const wp = unit.waypoints[unit.wpIndex];
  if (wp && driveToward(unit, wp.x, wp.z, POLICE.patrolSpeed, dt, manager.colliders)) unit.wpIndex += 1;
  return seen;
}

// Advance the whole force one fixed step.
// player: { x, z, speed, vx, vz, car? } — the live player position and
// velocity. heatState: { crimeHeat, wanted } — mutated in place by
// decay (and read for the wanted level). Returns the manager.
export function stepPolice(manager, dt, player, heatState) {
  manager.elapsed += dt;
  const wanted = heatState.wanted;
  ensureUnits(manager, wanted, player.x, player.z);
  let anySeen = false;
  for (const unit of manager.units) {
    if (stepUnit(manager, unit, dt, player, wanted)) anySeen = true;
  }
  // Heat decay: only while nobody sees the player, and only after
  // the delay has passed without a sighting.
  if (anySeen) {
    manager.unseenTimer = 0;
  } else {
    manager.unseenTimer += dt;
    if (manager.unseenTimer > POLICE.decayDelay && heatState.crimeHeat > 0) {
      heatState.crimeHeat = Math.max(0, heatState.crimeHeat - POLICE.decayRate * dt);
      heatState.wanted = wantedFromHeat(heatState.crimeHeat);
    }
  }
  return manager;
}

// A hard hit while driving is a crime: +10 heat, capped at 100.
export function addCollisionCrime(heatState) {
  heatState.crimeHeat = Math.min(100, heatState.crimeHeat + POLICE.collisionHeat);
  heatState.wanted = wantedFromHeat(heatState.crimeHeat);
  return heatState.wanted;
}

// Snapshot for the HUD/minimap: per-unit distance + status line.
export function policeStatus(manager, px, pz) {
  return manager.units.map((u) => ({
    name: u.name,
    state: u.state,
    dist: Math.round(Math.hypot(u.car.x - px, u.car.z - pz)),
    x: u.car.x,
    z: u.car.z,
  }));
}
