// Cabo Luna — tuning constants. One place for every number the sim uses.
export const STEP = 1 / 60;
export const SEED_DEFAULT = 1;
export const SAVE_KEY = 'cabo-luna-save-v1';

export const CITY = {
  blocks: 6,
  blockSize: 40,
  roadWidth: 12,
  seed: 1,
};

export const PLAYER = {
  radius: 0.55,
  height: 1.8,
  walkSpeed: 5.2,
  sprintSpeed: 9.0,
  accel: 42,
  friction: 10,
  jumpSpeed: 7.5,
  gravity: 20,
};

export const WORLD = {
  moneyStart: 250,
  healthMax: 100,
  dayStart: 1,
  clockStartMinutes: 9 * 60 + 24, // 09:24, morning sun over the bay
  clockMinutesPerSecond: 0.5, // game clock drifts slowly while playing
};

export const CAMERA = {
  distance: 7.5,
  height: 3.2,
  minPitch: -0.15,
  maxPitch: 0.9,
  // Driving chase cam (Day 4A): pulled well back and raised with a
  // shallow pitch and a low look target, so the whole 4.4 m car sits
  // inside the frame and clears the dialogue band at the bottom of
  // the 768x480 shot, with road ahead still visible. Numbers were
  // picked by projecting the car box to screen pixels at standstill,
  // cruise and top speed (see game/src/camera.js) and then checked
  // by eye in the play shot. The flatter pitch (0.12) and low look
  // target (0.3) keep the car's bottom at ~265-269 px even at
  // standstill, against the REAL dialogue-panel top of 259 px
  // (measured in the screenshots).
  driveDistance: 16,
  driveHeight: 5.0,
  drivePitch: 0.12,
  driveLookHeight: 0.3,
  // Chase-shot camera (shots.js carChaseCam): 13 m back, 5 m up,
  // looking at the player car itself (0 m ahead, 0.3 m up). Looking
  // ahead pushed the car down the frame; looking at the car lifts it
  // to the same band as the drive pose (bottom ~270 px) while the
  // staged police stay big in the upper half of the frame. Tuned by
  // projection against the REAL dialogue-panel top (259 px, measured
  // in the 768x480 chase shot — the panel is taller than the 283 px
  // the first draft assumed), verified by eye.
  chaseDistance: 13,
  chaseHeight: 5.0,
  chaseLookAhead: 0,
  chaseLookHeight: 0.3,
  // Follow feel: per-frame exponential ease toward the desired pose
  // (0.25 = most of the way there in ~4 frames), max camera-yaw
  // swing per frame so sharp turns swing the camera instead of
  // snapping it, and the closest the collision pull-in may bring
  // the camera to the car.
  smoothFactor: 0.25,
  yawStep: 0.12,
  minDistance: 5.5,
  clearanceMargin: 1.2,
  fovBase: 62,
  fovSpeedGain: 0.28,
  fovMaxExtra: 10,
};

// Arcade vehicle tuning. Speeds in m/s, angles in radians.
export const VEHICLE_CONFIGS = {
  sedan: {
    name: 'Solano', kind: 'sedan', accel: 14, brake: 30, maxSpeed: 32,
    maxReverse: 10, steerMax: 0.55, steerRate: 3.5, grip: 6.0,
    wheelbase: 2.8, radius: 1.3, length: 4.2, width: 1.9,
    colors: [0x3d6fb4, 0xb03d3d, 0x3d8a5a, 0xc9a13d, 0x5a5a62],
  },
  sport: {
    name: 'Brisa GT', kind: 'sport', accel: 20, brake: 34, maxSpeed: 42,
    maxReverse: 12, steerMax: 0.5, steerRate: 3.8, grip: 7.5,
    wheelbase: 2.6, radius: 1.25, length: 4.4, width: 1.95,
    colors: [0xd94f3d, 0xffd23d, 0x2c4a6e, 0xe8e8e8],
  },
  police: {
    name: 'Patrol', kind: 'police', accel: 18, brake: 34, maxSpeed: 38,
    maxReverse: 10, steerMax: 0.55, steerRate: 4.0, grip: 7.0,
    wheelbase: 2.8, radius: 1.3, length: 4.3, width: 1.95,
    colors: [0x14161c],
  },
};

export const VEHICLE = {
  dragBase: 0.35,
  dragQuad: 0.012,
  reverseDelay: 0.4, // hold brake this long at a standstill to reverse
  standstillSpeed: 0.25,
  springK: 60,
  springDamping: 12,
  springTravel: 0.25,
  springRest: 0.35,
  loadShift: 0.12, // longitudinal load transfer per unit accel
  pitchGain: 0.9,
  rollGain: 0.9,
  collisionSlow: 0.55,
  enterRadius: 3.0,
  exitOffset: 2.6,
  stealHeat: 25,
  heatPerStar: 20,
  wantedMax: 5,
};

export function wantedFromHeat(heat) {
  if (heat <= 0) return 0;
  return Math.min(VEHICLE.wantedMax, Math.ceil(heat / VEHICLE.heatPerStar));
}

export const TRAFFIC = {
  count: 16, // Day 4C: 12 -> 16, denser streets for the driving shots
  cruiseMin: 7,
  cruiseMax: 11,
  waypointRadius: 1.5,
  junctionRadius: 6,
  junctionFactor: 0.55,
  probeAhead: 6,
  stopDistance: 3.2,
  turnRate: 2.2,
  accelUp: 5,
  accelDown: 8,
  laneOffset: 3, // roadWidth / 4, right-hand lane
};

export const PEDESTRIAN = {
  count: 22, // Day 4C: 15 -> 22, fuller sidewalks for the driving shots
  walkMin: 1.0,
  walkMax: 1.6,
  crossSpeedMul: 1.6,
  fleeSpeed: 4.5,
  fleeRadius: 25,
  fleeTime: 3,
  waitMin: 1,
  waitMax: 3,
  sidewalkOffset: 7.5, // roadWidth/2 + 1.5
};

// Cabo Luna Patrol tuning. Detection radius grows with the wanted
// level; the numbers below are the per-level table plus the shared
// timers. Speeds in m/s, distances in metres, times in seconds.
export const POLICE = {
  detectRadius: [0, 25, 32, 40, 48, 60], // index = wanted level 0..5
  patrolSpeed: 6,
  chaseSpeed: 30, // pursuit cruise: below a sport car's top speed, above a sedan's cruise
  searchSpeed: 9,
  searchTime: 10,
  unseenGrace: 2.5, // CHASE tolerates this long without sight before SEARCH
  decayDelay: 8, // heat starts falling after this long unseen
  decayRate: 2.5, // heat points per second while unseen past decayDelay
  bustedRange: 2.5,
  bustedSpeed: 2,
  bustedTime: 2,
  replanInterval: 1, // seconds between A* re-plans during pursuit
  spawnMinDist: 20,
  spawnMaxDist: 45,
  maxUnits: 4,
  collisionHeat: 10, // heat per hard hit on a ped/car while driving
  collisionSpeed: 8, // only hits above this speed count as a crime
  interceptLead: 0.6, // seconds of player velocity to aim ahead by
  flashHz: 4, // light-bar alternation rate
  // Chase-shot staging (shots.js stagePoliceChase): offsets from the
  // player car, in metres — ahead is +dx (the player drives east),
  // sideways is dz. Day 4A pulled all three units in (lead 18 -> 12,
  // flank 6 -> 3, third 30 -> 19) so they read as police at 768x480
  // instead of looking small and distant. Staging only sets the
  // starting spots; the A* pursuit in police.js still drives them.
  chaseStage: [
    { dx: 12, dz: -3.5 }, // lead, ahead-left
    { dx: 3, dz: 3.5 }, // flank, alongside-right
    { dx: 19, dz: 3 }, // second lead, ahead-right
  ],
};

// ---- Shadows (Day 4F) --------------------------------------------------
// Three shadow configurations, switchable with ?shadow=A|B|C.
// A = the 3498cf3 baseline, unchanged. B = selective casters only:
// car cabins / roof panels / heads / fountains stop casting — their
// shadows sit inside (or a sliver beyond) the shadow of the body they
// sit on, so at 768x480 the car is still grounded by its body shadow.
// C = B's casters + a tighter shadow camera + a throttled shadow-map
// update. The sun and the static casters never move, so the static
// part of the map stays correct between updates; only dynamic shadows
// (cars, peds, player) lag by at most updateEvery-1 frames (2 frames
// = 33 ms at 60 fps, ~1 m at top speed).
// Measured at 3498cf3 (SpectorJS, 768x480, SwiftShader — structural
// counts only, no GPU timing): chase 142 draws / 84 shadow-pass,
// play 127 draws / 84 shadow-pass. The shadow pass is ~59% of all
// draws and ~82% of it is cars (each car = body + cabin + roof panel).
// The map size moves no draw calls at all (it is fill/texture cost,
// which Spector cannot time on this VM), so all three configs keep
// 1024 — lowering it would risk visible softness for zero measured
// saving. ?shadowmap=512|1024|2048 is a test-only override for that
// investigation; it is not a fourth config.
export const SHADOW_CONFIGS = {
  A: {
    id: 'A', label: 'baseline (3498cf3)',
    mapSize: 1024, bounds: 200, far: 700, updateEvery: 1,
    casters: {
      buildings: true, roofCaps: true, lighthouse: true,
      palmTrunks: true, treeTrunks: true, parkedBodies: true,
      carBody: true, carCabin: true, carRoofPanel: true,
      crates: true, containers: true, fountain: true,
      playerBody: true, playerHead: true, enemyBody: true, enemyHead: true,
    },
  },
  B: {
    id: 'B', label: 'selective casters',
    mapSize: 1024, bounds: 200, far: 700, updateEvery: 1,
    casters: {
      buildings: true, roofCaps: true, lighthouse: true,
      palmTrunks: true, treeTrunks: true, parkedBodies: true,
      carBody: true, carCabin: false, carRoofPanel: false,
      crates: true, containers: true, fountain: false,
      playerBody: true, playerHead: false, enemyBody: true, enemyHead: false,
    },
  },
  C: {
    id: 'C', label: 'selective casters + throttled static shadows',
    mapSize: 1024, bounds: 170, far: 600, updateEvery: 3,
    casters: {
      buildings: true, roofCaps: true, lighthouse: true,
      palmTrunks: true, treeTrunks: true, parkedBodies: true,
      carBody: true, carCabin: false, carRoofPanel: false,
      crates: true, containers: true, fountain: false,
      playerBody: true, playerHead: false, enemyBody: true, enemyHead: false,
    },
  },
};
export const SHADOW_DEFAULT = 'B'; // Day 4F winner: selective casters,
// -46 draws vs A every frame (-32% chase, -36% play), shadow pass
// -55%, screenshots pixel-identical to A (0-5 px diff at threshold
// 0.1). C saves more on average but only lowers the average — its
// update frame still costs B's draws — and its dynamic shadows lag
// up to 2 frames in live play; it stays available as ?shadow=C.
// Unknown / missing names fall back to the default. mapSizeOverride
// is the ?shadowmap= test hook: only 512/1024/2048 are accepted.
export function resolveShadow(name, mapSizeOverride) {
  const base = SHADOW_CONFIGS[name] ?? SHADOW_CONFIGS[SHADOW_DEFAULT];
  const cfg = { ...base, casters: { ...base.casters } };
  if ([512, 1024, 2048].includes(mapSizeOverride)) cfg.mapSize = mapSizeOverride;
  return cfg;
}

// Two hitscan weapons. Shooting is a crime: +10 heat per trigger pull
// (a 2-guard fight reliably reaches wanted 2) + 40 if a shot hits a
// person. M3's wanted_clear needs heat from combat; police.js decay
// clears it once the player escapes unseen.
export const COMBAT = {
  range: 60,
  heatPerShot: 10,
  heatPerHit: 40,
  weapons: {
    pistol: {
      id: 'pistol', name: 'Luna-9', kind: 'pistol',
      damage: 34, pellets: 1, spread: 0.02,
      fireInterval: 0.25, magSize: 12, reserveStart: 48, reloadTime: 1.2,
    },
    shotgun: {
      id: 'shotgun', name: 'Boca-12', kind: 'shotgun',
      damage: 12, pellets: 5, spread: 0.09,
      fireInterval: 0.9, magSize: 6, reserveStart: 24, reloadTime: 2.2,
    },
  },
  weaponOrder: ['pistol', 'shotgun'],
  enemy: {
    health: 100,
    sightRange: 38,
    engageRange: 38,
    hearRadius: 45,
    patrolSpeed: 1.6,
    investigateSpeed: 3.2,
    combatSpeed: 2.6,
    retreatSpeed: 4.5,
    coverHp: 40,
    retreatHp: 20,
    shootInterval: 0.9,
    damagePerHit: 8,
    hitChanceBase: 0.35,
    hitChanceFalloff: 0.006,
    hitChanceMin: 0.05,
    flinchTime: 0.25,
  },
};

