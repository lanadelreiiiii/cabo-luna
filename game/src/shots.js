// Cabo Luna — deterministic shot staging for ?shot=start|play|chase|end.
// Each shot plays the real sim forward from a fresh world for a fixed
// number of fixed steps, so the same seed always gives the same frame.
// Day 0 has no police yet: the chase shot is an on-foot staged camera
// angle down a street (police arrive on Day 2).
import { STEP } from './config.js';

const START_STEPS = 300; // 5 s standing in the plaza, city behind the title
const PLAY_STEPS = 480; // 8 s walking out of the plaza
const CHASE_STEPS = 300; // 5 s walking, then a low camera behind the player
const END_STEPS = 600; // 10 s wandering before the game-over screen

const WALK = { x: 0, z: -1 };

function highShotCam(world) {
  const p = world.city.plazas[0];
  return {
    x: p.x + 55, y: 60, z: p.z + 70,
    tx: p.x - 60, ty: 6, tz: p.z - 20, // look west across the plaza to the bay
  };
}

function chaseShotCam(world) {
  const p = world.player.state;
  const behind = 6.5;
  return {
    x: p.x + Math.sin(p.yaw) * behind,
    y: p.y + 2.4,
    z: p.z + Math.cos(p.yaw) * behind,
    tx: p.x - Math.sin(p.yaw) * 12,
    ty: p.y + 1.6,
    tz: p.z - Math.cos(p.yaw) * 12,
  };
}

// Stage `world` to the named scene and return the screen to draw and an
// optional fixed camera. Any unknown name stages the title.
export function stageShot(name, world) {
  world.reset();
  if (name === 'play') {
    for (let i = 0; i < PLAY_STEPS; i++) world.step(STEP, WALK, false, false);
    return { screen: 'play', shotCam: null };
  }
  if (name === 'chase') {
    for (let i = 0; i < CHASE_STEPS; i++) world.step(STEP, WALK, true, false);
    return { screen: 'play', shotCam: chaseShotCam(world) };
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
