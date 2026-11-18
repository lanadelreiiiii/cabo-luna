// Cabo Luna — on-foot third-person controller.
// WASD moves relative to the camera yaw, Shift sprints, Space jumps.
// Buildings are AABBs; the player slides along them instead of sticking.
import { PLAYER } from './config.js';
import { buildingColliders } from './city.js';

export function createPlayer(city, spawn) {
  const colliders = buildingColliders(city);
  const state = {
    x: spawn.x, z: spawn.z, y: 0,
    vx: 0, vz: 0, vy: 0,
    yaw: spawn.yaw ?? Math.PI * 0.75, // facing down the plaza street
    pitch: 0.2,
    onGround: true,
    health: 100,
    money: 250,
  };

  function collide(nx, nz) {
    const r = PLAYER.radius;
    for (const c of colliders) {
      if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) {
        return c;
      }
    }
    return null;
  }

  return {
    state,
    step(dt, move, sprinting, jump) {
      const speed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      // Camera-relative wish direction: forward is -Z rotated by yaw.
      const wx = (move.x * cos - move.z * sin) * speed;
      const wz = (move.x * sin + move.z * cos) * speed;
      state.vx += (wx - state.vx) * Math.min(1, PLAYER.accel * dt / 6);
      state.vz += (wz - state.vz) * Math.min(1, PLAYER.accel * dt / 6);

      // Integrate with axis-separated collision so the player slides.
      let nx = state.x + state.vx * dt;
      if (collide(nx, state.z)) { nx = state.x; state.vx = 0; }
      let nz = state.z + state.vz * dt;
      if (collide(nx, nz)) { nz = state.z; state.vz = 0; }
      state.x = nx; state.z = nz;

      // Keep the player inside the playable ground (city + beach).
      state.x = Math.max(-city.half - 24, Math.min(city.half + 6, state.x));
      state.z = Math.max(-city.half - 6, Math.min(city.half + 6, state.z));

      if (jump && state.onGround) { state.vy = PLAYER.jumpSpeed; state.onGround = false; }
      if (!state.onGround) {
        state.vy -= PLAYER.gravity * dt;
        state.y += state.vy * dt;
        if (state.y <= 0) { state.y = 0; state.vy = 0; state.onGround = true; }
      }
    },
    // Orbit drag rotates the camera around the player.
    orbit(dYawPixels, dPitchPixels) {
      state.yaw -= dYawPixels * 0.005;
      state.pitch = Math.max(-0.15, Math.min(0.9, state.pitch + dPitchPixels * 0.003));
    },
    speed() { return Math.hypot(state.vx, state.vz); },
  };
}

// Spawn: the plaza of Luna Vieja — open ground, streets in every direction.
export function plazaSpawn(city) {
  const plaza = city.plazas[0];
  return { x: plaza.x, z: plaza.z + 6, yaw: Math.PI * 0.75 };
}
