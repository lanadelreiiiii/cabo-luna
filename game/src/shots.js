// Cabo Luna — deterministic shot staging for ?shot=start|play|chase|end.
// Each shot plays the real sim forward from a fresh world for a fixed
// number of fixed steps, so the same seed always gives the same frame.
// Traffic and pedestrians run in every shot; the play shot steals a
// parked car and drives it, the chase shot drives through traffic with
// a low camera behind the player car. (Police re-stage is Day 2 Part B.)
import { STEP } from './config.js';
import { ensureUnits, policeStatus } from './police.js';

const START_STEPS = 300; // 5 s standing in the plaza, city behind the title
const PLAY_WALK_MAX = 600; // walk to the nearest parked car, then steal it
const PLAY_DRIVE_STEPS = 360; // 6 s driving east down the south road
const CHASE_STEPS = 360; // 6 s driving through traffic
const END_STEPS = 600; // 10 s wandering before the game-over screen

const WALK = { x: 0, z: -1 };

// Camera-relative move that walks the player toward a world-space
// target: the player controller rotates the move vector by the camera
// yaw, so invert that rotation here.
function moveToward(world, tx, tz) {
  const p = world.player.state;
  const dx = tx - p.x, dz = tz - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len, nz = dz / len;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  return { x: cos * nx + sin * nz, z: -sin * nx + cos * nz };
}

function highShotCam(world) {
  const p = world.city.plazas[0];
  return {
    x: p.x + 55, y: 60, z: p.z + 70,
    tx: p.x - 60, ty: 6, tz: p.z - 20, // look west across the plaza to the bay
  };
}

function carChaseCam(world) {
  const car = world.playerCar;
  if (!car) return null;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  // Pulled back and raised vs the Part A cam so the lead patrol car
  // (~18 m ahead) and the flanking unit stay inside the 62-degree FOV.
  return {
    x: car.x - fx * 11, y: 4.2, z: car.z - fz * 11,
    tx: car.x + fx * 16, ty: 1.6, tz: car.z + fz * 16,
  };
}

// After staging moves cars by hand, the HUD snapshot (written by
// refreshDerived during the last sim step) is stale — rewrite it from
// the staged positions so the patrol line and minimap match the frame.
function syncStagedHud(world) {
  const p = world.player.state;
  world.state.police = policeStatus(world.police, p.x, p.z);
  world.state.flashTime = world.police.elapsed;
  world.state.cars = world.traffic.cars.map((c) => ({ x: c.x, z: c.z }));
}

// Chase staging: put the patrol where the camera can see it. The
// player drives east, so forward is +x and the right side is +z.
// Lead unit ahead-left, flank unit alongside-right, third unit
// further ahead-right — all in CHASE, all inside the frame, none
// behind the camera (the Mission 02 failure was cops spawned 30 m
// behind the camera). Speeds match the player's so the formation
// holds for the still.
function stagePoliceChase(world) {
  const car = world.playerCar;
  if (!car || !world.police) return;
  ensureUnits(world.police, world.state.wanted, car.x, car.z);
  const spots = [
    { dx: 18, dz: -3 }, // lead, ahead-left
    { dx: 6, dz: 3.5 }, // flank, alongside-right
    { dx: 30, dz: 3 }, // second lead, ahead-right
  ];
  world.police.units.forEach((unit, i) => {
    const spot = spots[i % spots.length];
    unit.car.x = car.x + spot.dx;
    unit.car.z = car.z + spot.dz;
    unit.car.heading = Math.PI / 2;
    unit.car.speed = Math.max(12, car.speed);
    unit.car.steer = 0;
    unit.state = 'CHASE';
    unit.stateTimer = 0;
    unit.unseenTimer = 0;
    unit.lastKnown = { x: car.x, z: car.z };
    unit.waypoints = [];
    unit.wpIndex = 0;
    unit.replanTimer = 0;
  });
}

// Lane-keeping steer: hold a target heading with proportional control
// plus a tiny weave so the drive does not look on-rails. A raw sine
// steer swings the heading ±20° at speed and drives the car off the
// road into a building — verified visually in the first staging pass.
function laneSteer(world, targetHeading, i) {
  const car = world.playerCar;
  if (!car) return 0;
  let d = targetHeading - car.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const keep = Math.max(-0.3, Math.min(0.3, d * 1.5));
  return keep + Math.sin(i * 0.02) * 0.02;
}
// Stage a little street life ahead of the player car so the driving
// shots actually show traffic and pedestrians: three traffic cars up
// the same road, two pedestrians on the south sidewalk. All positions
// are fixed offsets from the player car, so the staging is deterministic.
function stageStreetLife(world) {
  const car = world.playerCar;
  if (!car) return;
  const spots = [20, 38, 60];
  for (let i = 0; i < Math.min(3, world.traffic.cars.length); i++) {
    const tc = world.traffic.cars[i];
    tc.x = car.x + spots[i]; tc.z = 113;
    tc.heading = Math.PI / 2;
    tc.speed = tc.cruise;
    tc.waypoints = [
      { x: car.x + spots[i] + 40, z: 113, nodeId: null },
      { x: car.x + spots[i] + 90, z: 113, nodeId: null },
    ];
    tc.wpIndex = 0;
    tc.state = 'DRIVE';
  }
  const pedSpots = [28, 48];
  for (let i = 0; i < Math.min(2, world.peds.peds.length); i++) {
    const p = world.peds.peds[i];
    p.x = car.x + pedSpots[i]; p.z = 117.5;
    p.target = { x: car.x + pedSpots[i] + 25, z: 117.5, line: 110, horizontal: true, side: 1 };
    p.state = 'WALK';
  }
}

const DRIVE = { throttle: 1, steer: 0, brake: 0, handbrake: false };

// Stage `world` to the named scene and return the screen to draw and an
// optional fixed camera. Any unknown name stages the title.
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    // Walk to the nearest parked car, steal it, then drive east.
    let entered = false;
    for (let i = 0; i < PLAY_WALK_MAX && !entered; i++) {
      const car = world.nearestParked();
      if (!car) break;
      const d = Math.hypot(car.x - world.player.state.x, car.z - world.player.state.z);
      if (d < 2.6) { entered = world.tryEnter(); break; }
      world.step(STEP, moveToward(world, car.x, car.z), false, false);
    }
    for (let i = 0; i < PLAY_DRIVE_STEPS; i++) {
      // Drive east down the south road, holding the lane.
      world.step(STEP, WALK, false, false, { ...DRIVE, steer: laneSteer(world, Math.PI / 2, i) });
    }
    if (entered) stageStreetLife(world);
    syncStagedHud(world);
    return { screen: 'play', shotCam: null };
  }
  if (name === 'chase') {
    // Stage the player into the sport car on the south road, rolling.
    const car = world.parked.find((c) => c.kind === 'sport') ?? world.parked[0];
    world.placePlayer(car.x - 2, car.z);
    world.tryEnter();
    for (let i = 0; i < CHASE_STEPS; i++) {
      world.step(STEP, WALK, false, false, { ...DRIVE, steer: laneSteer(world, Math.PI / 2, i) });
    }
    // Street life is staged after the drive, at fixed offsets ahead of
    // the final player position, so the frame always shows traffic and
    // pedestrians ahead of the car (the player outruns anything staged
    // before a 6 s full-throttle drive).
    stageStreetLife(world);
    stagePoliceChase(world);
    syncStagedHud(world);
    return { screen: 'play', shotCam: carChaseCam(world) };
  }
  if (name === 'end') {
    for (let i = 0; i < END_STEPS; i++) {
      // Wander: turn a little each second so the walk is not a straight line.
      const w = i % 120 < 60 ? WALK : { x: 0.6, z: -0.8 };
      world.step(STEP, w, false, false);
    }
    world.state.health = 0;
    return { screen: 'over', shotCam: null };
  }
  for (let i = 0; i < START_STEPS; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
  return { screen: 'title', shotCam: highShotCam(world) };
}
