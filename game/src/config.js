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
  driveDistance: 10.5,
  driveHeight: 4.4,
  drivePitch: 0.32,
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
  count: 12,
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
  count: 15,
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

