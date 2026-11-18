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
};
