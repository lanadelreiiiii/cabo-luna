// Cabo Luna — police helicopter (Phase 6).
// Air support at high wanted levels: one helicopter, not a fifth
// ground unit. It hovers above the player, its spotlight cone marks
// the pursuit in the hero/chase shot, and its sightings feed the
// City Remembers last-known-location so the ground search stays on
// the trail. Renderer-free plain data + a seeded-free deterministic
// step, so Node tests import it directly.
//
// Design limits (deliberate, keep it that way):
// - No flight AI beyond "ease toward a hover point above the player"
//   — no A*, no collision, no altitude terrain following.
// - No extra light or shadow pass: the spotlight is a translucent
//   cone mesh, never a THREE.SpotLight.
// - It does NOT count toward POLICE.maxUnits (4 ground units): it is
//   air support, and ensureUnits() is untouched.
// - It does NOT touch heat decay: ground units still govern that.
//   Its only memory write is refreshing the last-known-location.
// - It never fires, never busts, never collides with the player.
export const HELI = {
  name: 'Air-1',
  minWanted: 3, // wanted >= 3 brings the helicopter out
  altitude: 26, // hover height above the ground
  followSpeed: 16, // m/s ease toward the hover point
  rotorRate: 22, // rad/s rotor spin
  spawnOffset: { x: -18, z: -12 }, // where it appears relative to the player
  hoverOffset: { x: -6, z: -4 }, // hover point relative to the player
  coneRadius: 3.2, // spotlight pool radius at ground level
};

export function createHelicopter() {
  return {
    active: false,
    x: 0, y: HELI.altitude, z: 0,
    heading: 0,
    rotor: 0,
    sightings: 0,
  };
}

export function resetHelicopter(heli) {
  heli.active = false;
  heli.x = 0; heli.y = HELI.altitude; heli.z = 0;
  heli.heading = 0; heli.rotor = 0; heli.sightings = 0;
  return heli;
}

// One fixed step. player: { x, z }. memory (optional): the city
// memory — an active helicopter refreshes its last-known-location
// every tick, so a ground search anchored on the LKL keeps working
// even while no patrol car has line of sight. Returns the heli.
export function stepHelicopter(heli, dt, player, wanted, memory = null) {
  if (wanted < HELI.minWanted) {
    if (heli.active) heli.active = false;
    return heli;
  }
  if (!heli.active) {
    heli.active = true;
    heli.x = player.x + HELI.spawnOffset.x;
    heli.z = player.z + HELI.spawnOffset.z;
    heli.y = HELI.altitude;
  }
  const tx = player.x + HELI.hoverOffset.x;
  const tz = player.z + HELI.hoverOffset.z;
  const dx = tx - heli.x, dz = tz - heli.z;
  const dist = Math.hypot(dx, dz);
  const move = Math.min(dist, HELI.followSpeed * dt);
  if (dist > 1e-9) {
    heli.x += (dx / dist) * move;
    heli.z += (dz / dist) * move;
  }
  heli.y = HELI.altitude;
  heli.heading = Math.atan2(player.x - heli.x, player.z - heli.z);
  heli.rotor = (heli.rotor + HELI.rotorRate * dt) % (Math.PI * 2);
  if (memory) {
    memory.lastKnown = { x: player.x, z: player.z };
    memory.lastKnownAt = memory.elapsed;
    heli.sightings += 1;
  }
  return heli;
}

// Shot staging (shots.js hero/chase): force the helicopter into the
// frame at a fixed, visible spot — ahead of the player car, screen-
// RIGHT (+z clears the top-left mission panel) and LOW (8 m, not the
// live 26 m). The chase camera looks ~20° down at the car with a
// ~70° vertical FOV, so the frame top is only ~15° above horizontal:
// a heli at live altitude 26 m sits ~33° up and flies out of the
// frame (verified: first staged capture showed no heli), and at
// +26 m / 11 m / screen-left it read as a ~15 px speck against the
// hills and the mission panel. At +18 m / 8 m / screen-right the
// elevation from the camera is ~6°, the 3.4 m body reads ~50 px at
// 768 wide, and the white body pops against the sunset sky.
// Live-play rules (wanted >= 3) do not apply to a staged shot.
export function stageHelicopter(heli, car) {
  heli.active = true;
  heli.x = car.x + 18;
  heli.z = car.z + 8;
  heli.y = 8;
  heli.heading = Math.PI / 2; // face east, along the road
  heli.rotor = 0.6;
  return heli;
}

// HUD snapshot: name + distance from the player, or inactive.
export function heliHud(heli, px = 0, pz = 0) {
  return {
    active: heli.active,
    name: HELI.name,
    x: heli.x,
    z: heli.z,
    dist: heli.active ? Math.round(Math.hypot(heli.x - px, heli.z - pz)) : 0,
  };
}
