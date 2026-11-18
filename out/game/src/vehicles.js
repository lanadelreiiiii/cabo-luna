// Cabo Luna — arcade vehicle: bicycle model, 4-wheel suspension, and
// circle-vs-AABB collision. Renderer-free plain data; the renderer only
// reads state. Forward is (sin(heading), cos(heading)).
import { VEHICLE, VEHICLE_CONFIGS, wantedFromHeat } from './config.js';

let nextVehicleId = 1;

export function createVehicle(kind, x, z, heading, opts = {}) {
  const cfg = VEHICLE_CONFIGS[kind] ?? VEHICLE_CONFIGS.sedan;
  const colorList = cfg.colors;
  const color = opts.color ?? colorList[(nextVehicleId - 1) % colorList.length];
  const v = {
    id: nextVehicleId++,
    kind: cfg.kind,
    name: cfg.name,
    x, z, heading,
    speed: opts.speed ?? 0,
    steer: 0,
    lateral: 0,
    pitch: 0,
    roll: 0,
    suspension: [VEHICLE.springRest, VEHICLE.springRest, VEHICLE.springRest, VEHICLE.springRest],
    brakeHold: 0,
    collided: false,
    collisions: 0,
    parked: opts.parked ?? false,
    owned: opts.owned ?? false,
    stolen: false,
    color,
    length: cfg.length,
    width: cfg.width,
    radius: cfg.radius,
    config: cfg,
  };
  return v;
}

// Reset the id counter so a fresh world build is byte-identical.
export function resetVehicleIds() { nextVehicleId = 1; }

// One fixed step. input: { throttle 0..1, steer -1..1, brake 0..1,
// handbrake bool }. colliders: [{ minX, maxX, minZ, maxZ }].
export function stepVehicle(v, input, dt, colliders = []) {
  const cfg = v.config;
  const throttle = input.throttle ?? 0;
  const brake = input.brake ?? 0;
  const steerTarget = (input.steer ?? 0) * cfg.steerMax * (v.speed < -0.1 ? -1 : 1);

  // Steering approaches its target at a capped rate.
  const steerDelta = Math.max(-cfg.steerRate * dt, Math.min(cfg.steerRate * dt, steerTarget - v.steer));
  v.steer += steerDelta;

  // Longitudinal: throttle, brake, drag. Brake only reverses after the
  // car has sat still for VEHICLE.reverseDelay seconds.
  let accel = throttle * cfg.accel - (VEHICLE.dragBase + VEHICLE.dragQuad * Math.abs(v.speed)) * v.speed;
  if (brake > 0) {
    if (v.speed > VEHICLE.standstillSpeed) {
      accel -= brake * cfg.brake;
      v.brakeHold = 0;
    } else if (v.speed < -VEHICLE.standstillSpeed) {
      accel -= brake * cfg.brake; // already reversing: brake slows the reverse
      v.brakeHold = 0;
    } else {
      v.brakeHold += dt;
      if (v.brakeHold >= VEHICLE.reverseDelay) accel -= brake * cfg.accel * 0.7;
      else accel -= v.speed * 8; // hold the standstill, don't creep
    }
  } else {
    v.brakeHold = 0;
  }
  if (input.handbrake) accel -= v.speed * 2.5;
  v.speed += accel * dt;
  v.speed = Math.max(-cfg.maxReverse, Math.min(cfg.maxSpeed, v.speed));

  // Bicycle yaw + drift: lateral velocity decays with grip, handbrake
  // cuts the grip so the car slides.
  const yawRate = v.speed === 0 ? 0 : (v.speed / cfg.wheelbase) * Math.tan(v.steer);
  v.heading += yawRate * dt;
  const grip = input.handbrake ? cfg.grip * 0.25 : cfg.grip;
  v.lateral += -yawRate * v.speed * 0.05 * dt;
  v.lateral *= Math.exp(-grip * dt);

  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const rx = -fz, rz = fx; // right vector
  v.x += (fx * v.speed + rx * v.lateral) * dt;
  v.z += (fz * v.speed + rz * v.lateral) * dt;

  // Suspension: each wheel chases a load target; throttle squats the
  // rear, braking dives the front, cornering loads the outside wheels.
  // Body pitch/roll are derived from the wheels, never set directly.
  const longG = Math.max(-1, Math.min(1, accel / cfg.accel));
  const latG = Math.max(-1, Math.min(1, yawRate * v.speed * 0.06));
  const rest = VEHICLE.springRest, shift = VEHICLE.loadShift;
  const targets = [
    rest - shift * longG - shift * latG, // front-left
    rest - shift * longG + shift * latG, // front-right
    rest + shift * longG - shift * latG, // rear-left
    rest + shift * longG + shift * latG, // rear-right
  ];
  const k = Math.min(1, 8 * dt);
  for (let i = 0; i < 4; i++) v.suspension[i] += (targets[i] - v.suspension[i]) * k;
  const front = (v.suspension[0] + v.suspension[1]) / 2;
  const rear = (v.suspension[2] + v.suspension[3]) / 2;
  const left = (v.suspension[0] + v.suspension[2]) / 2;
  const right = (v.suspension[1] + v.suspension[3]) / 2;
  v.pitch = (rear - front) * VEHICLE.pitchGain;
  v.roll = (left - right) * VEHICLE.rollGain;

  // Collision: circle vs building AABBs — push out, scrub speed, slide.
  v.collided = false;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(v.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(v.z, c.maxZ));
    let dx = v.x - cx, dz = v.z - cz;
    let dist = Math.hypot(dx, dz);
    if (dist < v.radius) {
      if (dist < 1e-6) {
        // Centre inside the box: push out along the smallest penetration.
        const pushes = [
          [c.minX - v.radius - v.x, 0], [c.maxX + v.radius - v.x, 0],
          [0, c.minZ - v.radius - v.z], [0, c.maxZ + v.radius - v.z],
        ];
        pushes.sort((a, b) => (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])));
        dx = pushes[0][0]; dz = pushes[0][1];
        dist = Math.hypot(dx, dz) || 1;
      }
      const push = v.radius - dist;
      const nx = dx / dist, nz = dz / dist;
      v.x += nx * push;
      v.z += nz * push;
      // Scrub the into-wall speed: the car slows and slides, never
      // passes through.
      v.speed *= VEHICLE.collisionSlow;
      v.lateral *= 0.6;
      v.collided = true;
      v.collisions += 1;
    }
  }
  return v;
}

// Pure enter/exit helpers, shared by the game and the tests.
// Returns the nearest car within enter radius of (x, z), or null.
export function nearestEnterableCar(cars, x, z, radius = VEHICLE.enterRadius) {
  let best = null, bestD = Infinity;
  for (const car of cars) {
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < radius && d < bestD) { best = car; bestD = d; }
  }
  return best;
}

// Stealing a car that is not already yours is a crime: +25 heat.
// Returns the new wanted level. `heatState` is { crimeHeat, wanted }.
export function applySteal(heatState, car) {
  if (car.owned) return heatState.wanted;
  car.stolen = true;
  car.parked = false;
  heatState.crimeHeat += VEHICLE.stealHeat;
  heatState.wanted = wantedFromHeat(heatState.crimeHeat);
  return heatState.wanted;
}
