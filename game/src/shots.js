// Cabo Luna — deterministic shot staging for the dossier and legacy shots.
// ?shot=hero|foot|combat|vista (Day 4E A/B/C/D) or start|play|chase|end
// (legacy) with &seed=N. Every shot plays the real sim forward from a
// fresh world for a fixed number of fixed steps, so the same seed always
// yields the same frame. Traffic and pedestrians run in every shot.
import { STEP, POLICE } from './config.js';
import { chaseCameraPose } from './camera.js';
import { ensureUnits, policeStatus } from './police.js';
import { spawnHarborGuards } from './combat.js';
import { stageHelicopter, heliHud } from './helicopter.js';

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

// Chase-shot camera: one source of truth with camera.js. The pose
// is pulled back and raised (13 m / 5 m) and looks at the player car
// itself (2 m ahead, 0.5 m up) — the steep look-down lifts the car
// clear of the dialogue band while the staged police stay in the
// upper half of the frame. Tuned by projection, verified by eye.
export function carChaseCam(world) {
  const car = world.playerCar;
  if (!car) return null;
  const pose = chaseCameraPose(car);
  return {
    x: pose.position.x, y: pose.position.y, z: pose.position.z,
    tx: pose.target.x, ty: pose.target.y, tz: pose.target.z,
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
  // Phase 6: a staged helicopter is part of the frame — refresh its
  // HUD snapshot from the staged pose (refreshDerived ran before
  // staging and still holds the pre-stage pose).
  if (world.heli) world.state.heli = heliHud(world.heli, p.x, p.z);
}

// Chase staging: put the patrol where the camera can see it. The
// player drives east, so forward is +x and the right side is +z.
// Spots come from POLICE.chaseStage in config.js: lead ahead-left,
// flank alongside-right, third further ahead-right — all in CHASE,
// all inside the frame, none behind the camera (the Mission 02
// failure was cops spawned 30 m behind the camera). Speeds match the
// player's so the formation holds for the still — the A* pursuit
// (police.js) still drives them.
export function stagePoliceChase(world) {
  const car = world.playerCar;
  if (!car || !world.police) return;
  ensureUnits(world.police, world.state.wanted, car.x, car.z);
  const spots = POLICE.chaseStage;
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

// Street life ahead of the player car so the driving shots show
// traffic and pedestrians instead of an empty road. Four traffic cars
// up the same road, close enough that the near one reads big, and
// four pedestrians on both sidewalks — pulled in from the old
// 26/44/58 m spots (12/20/28/36 m) so they read as people at
// 768x480 instead of dots on the horizon. All positions are fixed
// offsets from the player car, so the staging is deterministic.
function stageStreetLife(world) {
  const car = world.playerCar;
  if (!car) return;
  const spots = [12, 26, 42, 60];
  for (let i = 0; i < Math.min(4, world.traffic.cars.length); i++) {
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
  const pedSpots = [[12, 117.5], [20, 102.5], [28, 117.5], [36, 102.5]];
  for (let i = 0; i < Math.min(4, world.peds.peds.length); i++) {
    const p = world.peds.peds[i];
    const [px, pz] = pedSpots[i];
    p.x = car.x + px; p.z = pz;
    p.target = { x: car.x + px + 25, z: pz, line: 110, horizontal: true, side: pz > 110 ? 1 : -1 };
    p.route = null; // Day 4G: re-plan the sidewalk-graph route to the staged target
    p.state = 'WALK';
  }
}

const DRIVE = { throttle: 1, steer: 0, brake: 0, handbrake: false };

// Point the player's aim (yaw/pitch) at a world-space target.
function aimAt(world, tx, tz) {
  const p = world.player.state;
  p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
  p.pitch = 0.1;
}

// Combat camera: a fixed side-on pose built from the live positions,
// so the frame is composed rather than left to the follow camera.
// The camera sits ~5.5 m behind the player (relative to the framed
// guard) and ~2.2 m to the side, 3.1 m up, looking at the framed
// guard's chest. The guard lands near screen centre — where the
// crosshair lives — while the player sits off-centre in the
// foreground, so the crosshair never sits on the player's back and
// the tracer from the player's gun to the far guard cuts diagonally
// across the frame. 5.5 m is the tuned distance: at 6.5 m the BAR EL
// FARO sign — 8 m north of the player — poked its west end into the
// right edge, and at 4.5 m the sign was gone but the player ballooned
// to ~200 px and dominated the frame; at 5.5 m the sign clears the
// edge by ~20 px and the player stays a foreground figure, not the
// subject.
function combatShotCam(world, guard) {
  const p = world.player.state;
  const dx = guard.x - p.x, dz = guard.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const sx = -uz, sz = ux; // side perpendicular, left of the firing line
  return {
    x: p.x - ux * 5.5 + sx * 2.2, y: 3.1, z: p.z - uz * 5.5 + sz * 2.2,
    tx: guard.x, ty: 1.2, tz: guard.z,
  };
}

// Foot-shot interact car, relative to the player (who stands at
// shop.x, shop.z + 6.5 facing the sign). Day 5D: the car used to be
// staged 1.5 m south of the player, between the camera and the
// player, so the player's lower half hid behind its roof. The car
// now sits north-west of the player: 2.4 m lateral clears the player
// in frame, and 2.7 m away keeps the E prompt live (interact range
// is 3 m). The car is placed AFTER the 60 staging steps — staged
// before them it drifted ~2 m north in 1 s and ended up overlapping
// the player again.
export const FOOT_CAR_OFFSET = { dx: -2.4, dz: -1.3 };

// Combat background traffic: cars on the roads behind the fight, so
// the harbor shot is not an empty lot. All three sit on real road
// lines (x = -150 vertical, z = 110 coastal) and project into the
// frame's background (verified by projection against the combat
// camera) without touching the framed guard's screen box.
export const COMBAT_BACKGROUND_TRAFFIC = [
  { x: -150, z: 92, heading: Math.PI }, // north on the x=-150 road, right background
  { x: -150, z: 84, heading: Math.PI }, // further north, far-right edge
  { x: -168, z: 110, heading: -Math.PI / 2 }, // west on the coastal road, mid-left
];

// Combat pursuit staging: the responding units sit at genuinely
// different ranges from the player instead of the spawn ring's four
// identical 43 m. Offsets east along the coastal road; the distances
// are computed live by policeStatus from these positions, never
// hardcoded into the HUD. States are left exactly as the sim gave
// them (PATROL here) — only positions are staged.
export const COMBAT_PURSUIT_SPOTS = [
  { dx: 18, dz: 1 },
  { dx: 31, dz: 4 },
  { dx: 47, dz: 1 },
  { dx: 64, dz: 4 },
];

export function stageCombatPursuit(world) {
  const p = world.player.state;
  if (!world.police) return;
  world.police.units.forEach((unit, i) => {
    const spot = COMBAT_PURSUIT_SPOTS[i % COMBAT_PURSUIT_SPOTS.length];
    unit.car.x = p.x + spot.dx;
    unit.car.z = p.z + spot.dz;
    unit.car.heading = Math.PI / 2;
  });
}

export function stageCombatBackground(world) {
  for (let i = 0; i < Math.min(COMBAT_BACKGROUND_TRAFFIC.length, world.traffic.cars.length); i++) {
    const tc = world.traffic.cars[i];
    const s = COMBAT_BACKGROUND_TRAFFIC[i];
    tc.x = s.x; tc.z = s.z;
    tc.heading = s.heading;
    tc.speed = tc.cruise;
    tc.waypoints = [
      { x: s.x + Math.sin(s.heading) * 40, z: s.z + Math.cos(s.heading) * 40, nodeId: null },
      { x: s.x + Math.sin(s.heading) * 90, z: s.z + Math.cos(s.heading) * 90, nodeId: null },
    ];
    tc.wpIndex = 0;
    tc.state = 'DRIVE';
  }
}

// Stage `world` to the named scene and return the screen to draw and an
// optional fixed camera. Any unknown name stages the title.
export function stageShot(name, world) {
  world.reset();
  // Day 5D: the shot-mode game state genuinely has the radio ON —
  // LUNA FM 88.1 'Sunset Drive' is the actual station in this world
  // state, so the HUD line truthfully reads it. No audio player
  // exists in shot mode (main.js creates it only outside ?shot=),
  // so captures stay silent-safe; the state, not the sound, is what
  // the HUD reports.
  if (world.radio) { world.radio.stationIndex = 0; world.radio.step = 0; }
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
      // Stealing the car completes M1's first objective and opens the
      // tone choice — pick it on the first drive step so the Mercado
      // Norte objective is live for the rest of the shot.
      if (i === 0 && world.hasMissionChoices?.()) world.chooseMission(0);
    }
    if (entered) stageStreetLife(world);
    syncStagedHud(world);
    return { screen: 'play', shotCam: null };
  }
  if (name === 'chase' || name === 'hero') {
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
    // Phase 6: the helicopter is the hero shot's third police layer —
    // staged ahead-left of the car, high, spotlight down on it. The
    // live wanted here is 2 (steal = 25 heat), below the heli's live
    // threshold of 3, so staging forces the pose (documented in
    // helicopter.js: a pose, not a spawn).
    if (world.heli && world.playerCar) stageHelicopter(world.heli, world.playerCar);
    syncStagedHud(world);
    return { screen: 'play', shotCam: carChaseCam(world) };
  }
  if (name === 'foot') {
    // B. ON-FOOT GAMEPLAY: the player on foot at a shopfront, with the
    // "E — STEAL ..." prompt, Yara's dialogue, pedestrians and the
    // city behind. The south-road parked cars have NO shop north of
    // them at seed 1 (that block is the plaza), so the shot stages at
    // the shopfront that does face the south road — BAR EL FARO at
    // (-135.7, 102.5) — player 6.5 m south of it, facing north, so
    // the sign reads head-on. A traffic car is parked beside the
    // player to supply the interact prompt (placed after the 60
    // steps — see FOOT_CAR_OFFSET — so it cannot drift onto the
    // player); 60 zero steps re-run refreshDerived so the prompt is
    // live for the still, and give the mission manager a second to
    // present its first dialogue choice.
    const shop = world.city.shops.find((s) => s.z > 100 && s.z < 116) ?? world.city.shops[0];
    world.placePlayer(shop.x, shop.z + 6.5);
    world.player.state.yaw = 0; // face north, toward the shop sign
    world.player.state.pitch = 0.2;
    for (let i = 0; i < Math.min(2, world.peds.peds.length); i++) {
      const p = world.peds.peds[i];
      p.x = shop.x + (i === 0 ? -6 : 8); p.z = 102;
      p.target = { x: p.x + 25, z: 102, line: 110, horizontal: true, side: -1 };
      p.route = null;
      p.state = 'WALK';
    }
    // 60 steps (1 s) so the mission manager has ticked enough to
    // present the first dialogue choice before we pick it.
    for (let i = 0; i < 60; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
    if (world.hasMissionChoices?.()) world.chooseMission(0);
    // Interact car, placed AFTER the steps (see FOOT_CAR_OFFSET):
    // north-west of the player, clear of the player in frame, close
    // enough for the E prompt. Two zero steps re-run refreshDerived
    // so the prompt is live for the still.
    const tc = world.traffic.cars[0];
    tc.x = shop.x + FOOT_CAR_OFFSET.dx;
    tc.z = shop.z + 6.5 + FOOT_CAR_OFFSET.dz;
    tc.heading = Math.PI / 2; tc.speed = 0;
    tc.waypoints = [{ x: tc.x, z: tc.z, nodeId: null }]; tc.wpIndex = 0; tc.state = 'DRIVE';
    for (let i = 0; i < 2; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
    syncStagedHud(world);
    return { screen: 'play', shotCam: null };
  }
  if (name === 'combat') {
    // C. COMBAT: a real harbor firefight, not a relabelled driving
    // shot. Two shots, not one — the timings force it:
    //   * shot 1 hits the near guard: hit flash whites him out for
    //     0.12 s, hit marker lives 0.25 s, Luna-9 cooldown is 0.25 s.
    //   * 16 steps (0.267 s) later the flash is gone, the cooldown is
    //     clear, and the near guard is back to his dark uniform +
    //     red vest — readable again. 16, not 15: the Luna-9 cooldown
    //     is 0.25 s, and 15 steps leave it a floating-point hair
    //     above zero, so the second shot silently refuses to fire.
    //   * shot 2 is aimed at the FAR guard: fresh tracer + muzzle
    //     flash + hit marker at paint time, while the far guard's own
    //     flash happens off the framed centre. The near guard — the
    //     one the camera frames — is never white in the still.
    // Peds wait at the plaza for this still: a wandering ped stood
    // exactly on the camera-to-guard line in early captures and
    // occluded the guard. The fight, not street life, is the subject.
    // Day 5D: two peds wait in the background instead (see below) —
    // the road behind the fight was empty in every capture.
    spawnHarborGuards(world.combat);
    // Day 5D: two peds wait in the background behind the fight
    // (north on the x=-150 road, clear of the camera-to-guard line);
    // the rest wait at the plaza as before so nobody occludes the
    // framed guard.
    world.peds.peds.forEach((ped, i) => {
      if (i === 0) { ped.x = -147; ped.z = 92; }
      else if (i === 1) { ped.x = -152; ped.z = 96; }
      else { ped.x = -28 + (i % 5) * 4; ped.z = 78 + Math.floor(i / 5) * 4; }
      ped.target = { x: ped.x + 10, z: ped.z, line: 84, horizontal: true, side: 1 };
      ped.route = null; ped.state = 'WALK';
    });
    const p = world.player.state;
    world.placePlayer(-141, 109);
    const living = () => world.combat.enemies.filter((e) => e.hp > 0);
    const byDist = (list) => [...list].sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    aimAt(world, world.combat.enemies[0].x, world.combat.enemies[0].z);
    // Half a second for the guards to react — a full 2 s let them
    // strafe behind the warehouse, out of frame.
    for (let i = 0; i < 30; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
    const nearFirst = byDist(living())[0];
    if (nearFirst) {
      aimAt(world, nearFirst.x, nearFirst.z);
      world.fireWeapon();
    }
    for (let i = 0; i < 16; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
    const ranked = byDist(living());
    const far = ranked[ranked.length - 1];
    if (far) {
      aimAt(world, far.x, far.z);
      world.fireWeapon();
    }
    // Frame the NEAR guard (dark uniform, red vest) at screen centre;
    // the far guard's tracer cuts across from the player's gun.
    const framed = byDist(living())[0] ?? world.combat.enemies[0];
    // Day 5D: background traffic on the roads behind the fight, and
    // the responding pursuit at genuinely different ranges — staged
    // after the firing steps so nothing moves them again before the
    // still, then the HUD is re-synced from the staged positions.
    stageCombatBackground(world);
    stageCombatPursuit(world);
    syncStagedHud(world);
    return { screen: 'play', shotCam: combatShotCam(world, framed) };
  }
  if (name === 'vista') {
    // D. OPEN-WORLD EXPERIENCE: the high west-looking camera, but on
    // the PLAY screen (HUD live) instead of the title overlay — the
    // lighthouse, the bay, the city depth and the sunset all read,
    // with traffic and pedestrians moving below.
    for (let i = 0; i < START_STEPS; i++) world.step(STEP, { x: 0, z: 0 }, false, false);
    syncStagedHud(world);
    return { screen: 'play', shotCam: highShotCam(world) };
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
