// Cabo Luna Day 4A — chase camera + police visibility tests (stdlib only).
// Run: node --test game/tests/camera.test.mjs
//
// The projector in src/camera.js mirrors the live renderer
// (render.js updateCamera, shots.js carChaseCam) and was cross-checked
// against the vendored three.js PerspectiveCamera, so these assertions
// test the framing the browser actually paints — not a private fiction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA, POLICE } from '../src/config.js';
import {
  driveCameraPose, chaseCameraPose, frameCar, fovForSpeed, projectToScreen,
  approachAngle, smoothPose, clearanceFraction,
} from '../src/camera.js';
import { stagePoliceChase, carChaseCam } from '../src/shots.js';
import { createPoliceManager } from '../src/police.js';
import { generateCity, buildingColliders } from '../src/city.js';
import { buildRoadGraph } from '../src/roadgraph.js';
import { makeRng } from '../src/rng.js';
import { resetVehicleIds } from '../src/vehicles.js';

const ASPECT = 768 / 480;
// The dialogue panel's top edge sits at ~259 px in the 768x480 shots
// (bottom: 148px in index.html, ~65 px tall for two lines of text) —
// measured in the real screenshots, not assumed. Both driving poses
// put the car's bottom at ~270 px, so only the rear-bumper corners
// (~11 px) sit behind the panel's translucent top edge; fully
// clearing it would shrink the car below readability (see the
// Pareto search in the Day 4A notes: maxY 259 needs a 51 px car).
const DIALOGUE_TOP_PX = 259;
// Small overlap budget: the rear-bumper corners may dip this far
// below the panel top; the car body itself stays clear of it.
const DIALOGUE_OVERLAP_PX = 12;

function sportCar(x = 0, z = 0, heading = Math.PI / 2, speed = 28.7) {
  return { x, y: 0, z, heading, speed, length: 4.4, width: 1.95 };
}

function stagedChaseWorld() {
  resetVehicleIds();
  const city = generateCity(1);
  const graph = buildRoadGraph(city);
  const colliders = buildingColliders(city);
  const police = createPoliceManager(graph, city, colliders, makeRng(110));
  const world = {
    playerCar: sportCar(0, 0, Math.PI / 2, 28.7),
    police,
    state: { wanted: 2 },
  };
  stagePoliceChase(world);
  return world;
}

test('drive camera: whole player car in frame at standstill, cruise and top speed', () => {
  for (const speed of [0, 14, 28.7, 42]) {
    const car = sportCar(0, 0, Math.PI / 2, speed);
    const pose = driveCameraPose(car);
    const frame = frameCar(pose, fovForSpeed(speed), ASPECT, car);
    assert.equal(frame.inFrame, true, `speed ${speed}: car must be fully in frame`);
    assert.ok(frame.maxY <= DIALOGUE_TOP_PX + DIALOGUE_OVERLAP_PX, `speed ${speed}: car bottom ${frame.maxY.toFixed(0)}px must stay within ${DIALOGUE_OVERLAP_PX}px of the dialogue band (${DIALOGUE_TOP_PX}px)`);
    assert.ok(frame.minY >= 120, `speed ${speed}: car top ${frame.minY.toFixed(0)}px too high — road ahead would be lost`);
    assert.ok(frame.heightPx >= 45, `speed ${speed}: car only ${frame.heightPx.toFixed(0)}px tall — too small to read`);
    assert.ok(frame.heightPx <= 130, `speed ${speed}: car ${frame.heightPx.toFixed(0)}px tall — too close, rear would crop`);
  }
});

test('drive camera: whole car in frame for every heading (turning)', () => {
  for (let h = 0; h < Math.PI * 2; h += 0.3) {
    const car = sportCar(40, -20, h, 20);
    const frame = frameCar(driveCameraPose(car), fovForSpeed(20), ASPECT, car);
    assert.equal(frame.inFrame, true, `heading ${h.toFixed(2)}: car must stay in frame while turning`);
    assert.ok(frame.maxY <= DIALOGUE_TOP_PX + DIALOGUE_OVERLAP_PX, `heading ${h.toFixed(2)}: car bottom must stay within ${DIALOGUE_OVERLAP_PX}px of the dialogue band`);
  }
});

test('drive camera: reversing and high-speed turns keep the car in frame', () => {
  const reverse = sportCar(0, 0, Math.PI / 2, -10);
  const revFrame = frameCar(driveCameraPose(reverse), fovForSpeed(-10), ASPECT, reverse);
  assert.equal(revFrame.inFrame, true, 'reversing must keep the car in frame');
  assert.ok(revFrame.maxY <= DIALOGUE_TOP_PX + DIALOGUE_OVERLAP_PX, 'reversing: car bottom must stay within the dialogue overlap budget');
  for (const h of [0.6, 1.9, 3.4, 5.1]) {
    const fast = sportCar(10, 30, h, 42);
    const frame = frameCar(driveCameraPose(fast), fovForSpeed(42), ASPECT, fast);
    assert.equal(frame.inFrame, true, `top speed heading ${h}: car must stay in frame`);
  }
});

test('chase staging: player car + all 3 police in frame, police big enough to read', () => {
  const world = stagedChaseWorld();
  assert.equal(world.police.units.length, 3, 'wanted 2 stages 3 units');
  // Staging only sets starting positions; every unit must genuinely pursue.
  for (const u of world.police.units) assert.equal(u.state, 'CHASE');
  const pose = chaseCameraPose(world.playerCar);
  for (const fov of [CAMERA.fovBase, fovForSpeed(28.7), fovForSpeed(42)]) {
    const player = frameCar(pose, fov, ASPECT, world.playerCar);
    assert.equal(player.inFrame, true, `fov ${fov}: player car must be in frame`);
    assert.ok(player.heightPx >= 50, `fov ${fov}: player car ${player.heightPx.toFixed(0)}px tall — too small`);
    // Dialogue clearance only at the shot's real speed FOV (~70 at
    // 103 km/h): at fov 62 the car is magnified and its bumper dips
    // further, which never happens in the chase shot. The budget is
    // the same small rear-bumper overlap as the drive pose.
    if (Math.abs(fov - fovForSpeed(28.7)) < 0.5) {
      assert.ok(player.maxY <= DIALOGUE_TOP_PX + DIALOGUE_OVERLAP_PX, `fov ${fov}: player car bottom ${player.maxY.toFixed(0)}px must stay within ${DIALOGUE_OVERLAP_PX}px of the dialogue band`);
    }
    const frames = world.police.units.map((u) => frameCar(pose, fov, ASPECT, u.car));
    for (let i = 0; i < frames.length; i++) {
      assert.equal(frames[i].inFrame, true, `fov ${fov}: police ${i} must be in frame`);
      assert.ok(!frames[i].points.some((p) => p.behind), `fov ${fov}: police ${i} must not be behind the camera`);
    }
    // Lead reads clearly, flank (closest) reads biggest, third still visible.
    assert.ok(frames[0].heightPx >= 25, `fov ${fov}: lead police ${frames[0].heightPx.toFixed(0)}px tall — too small`);
    assert.ok(frames[1].heightPx >= 40, `fov ${fov}: flank police ${frames[1].heightPx.toFixed(0)}px tall — too small`);
    assert.ok(frames[2].heightPx >= 18, `fov ${fov}: third police ${frames[2].heightPx.toFixed(0)}px tall — too small`);
    // Light bars (roof, 1.62 m) must project inside the frame for every unit.
    for (let i = 0; i < 3; i++) {
      const u = world.police.units[i];
      const bar = projectToScreen(pose, fov, ASPECT, { x: u.car.x, y: 1.62, z: u.car.z });
      assert.equal(bar.behind, false, `fov ${fov}: police ${i} light bar behind camera`);
      assert.ok(bar.x >= 0 && bar.x <= 768 && bar.y >= 0 && bar.y <= 480, `fov ${fov}: police ${i} light bar outside frame`);
    }
  }
});

test('chase staging: closer than Day 1-2B (lead ~12, flank ~5, third ~19)', () => {
  const world = stagedChaseWorld();
  const car = world.playerCar;
  const d = world.police.units.map((u) => Math.hypot(u.car.x - car.x, u.car.z - car.z));
  assert.ok(d[0] >= 11 && d[0] <= 14, `lead at ${d[0].toFixed(1)} m, want ~12`);
  assert.ok(d[1] >= 3 && d[1] <= 6, `flank at ${d[1].toFixed(1)} m, want ~5 alongside`);
  assert.ok(d[2] >= 18 && d[2] <= 21, `third at ${d[2].toFixed(1)} m, want ~20`);
  // Staging distances come from config, not a hardcoded copy in shots.js.
  assert.deepEqual(POLICE.chaseStage, [
    { dx: 12, dz: -3.5 },
    { dx: 3, dz: 3.5 },
    { dx: 19, dz: 3 },
  ]);
});

test('carChaseCam is chaseCameraPose (single source of truth)', () => {
  const world = stagedChaseWorld();
  const shot = carChaseCam(world);
  const pose = chaseCameraPose(world.playerCar);
  for (const [a, b, name] of [
    [shot.x, pose.position.x, 'x'], [shot.y, pose.position.y, 'y'], [shot.z, pose.position.z, 'z'],
    [shot.tx, pose.target.x, 'tx'], [shot.ty, pose.target.y, 'ty'], [shot.tz, pose.target.z, 'tz'],
  ]) {
    assert.ok(Math.abs(a - b) < 1e-9, `chase cam ${name} must match camera.js`);
  }
});

test('camera smoothing: poses are continuous and finite, no jumps or NaN', () => {
  let prev = null;
  for (let h = 0; h < Math.PI * 2; h += 0.05) {
    const pose = driveCameraPose(sportCar(0, 0, h, 20));
    for (const v of [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z]) {
      assert.ok(Number.isFinite(v), `heading ${h.toFixed(2)}: pose must be finite`);
    }
    if (prev) {
      const step = Math.hypot(pose.position.x - prev.x, pose.position.y - prev.y, pose.position.z - prev.z);
      // Orbit radius is driveDistance (16 m): a 0.05 rad heading step
      // may move the camera up to 16 * 0.05 = 0.8 m. Anything above
      // that is a jump; anything at/below it is continuous motion.
      assert.ok(step < 0.9, `heading step moved camera ${step.toFixed(2)} m — jump, not smooth`);
    }
    prev = pose.position;
  }
  // Speed sweep incl. reverse: FOV stays in its band, projections finite.
  for (let s = -12; s <= 42; s += 3) {
    const fov = fovForSpeed(s);
    assert.ok(fov >= CAMERA.fovBase && fov <= CAMERA.fovBase + CAMERA.fovMaxExtra, `speed ${s}: fov ${fov} out of band`);
    const frame = frameCar(driveCameraPose(sportCar(0, 0, 1.0, s)), fov, ASPECT, sportCar(0, 0, 1.0, s));
    assert.ok(frame.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `speed ${s}: projection must be finite`);
  }
});

test('smoothing helpers: ease converges, yaw takes the short way round', () => {
  const from = driveCameraPose(sportCar(0, 0, 0, 20));
  const to = driveCameraPose(sportCar(30, 40, 1.2, 20));
  let cur = from;
  for (let i = 0; i < 20; i++) cur = smoothPose(cur, to, CAMERA.smoothFactor);
  const gap = Math.hypot(cur.position.x - to.position.x, cur.position.y - to.position.y, cur.position.z - to.position.z);
  assert.ok(gap < 0.5, `20 eased steps should nearly reach the target, gap ${gap.toFixed(2)} m`);
  assert.equal(smoothPose(from, to, 1).position.x, to.position.x, 'factor 1 snaps to target');
  assert.equal(smoothPose(from, to, 0).position.x, from.position.x, 'factor 0 holds still');
  // Yaw: 350° -> 10° goes +20° through 0, not -340° the long way.
  const stepped = approachAngle((350 * Math.PI) / 180, (10 * Math.PI) / 180, 0.1);
  assert.ok(Math.abs(stepped - (350 * Math.PI) / 180 - 0.1) < 1e-9, 'yaw must step the short way round');
  assert.equal(approachAngle(0, 0.05, 0.12), 0.05, 'small gap reaches the target in one step');
  assert.equal(approachAngle(0, -3, 0.12), -0.12, 'yaw step is capped at maxStep');
});

test('collision pull-in: clear road stays full distance, a wall pulls the camera in', () => {
  // Open road: the south-road drive path never crosses a footprint.
  const city = generateCity(1);
  const colliders = buildingColliders(city);
  for (let x = -100; x <= 200; x += 5) {
    const car = sportCar(x, 113, Math.PI / 2, 28.7);
    const pose = driveCameraPose(car);
    const frac = clearanceFraction(
      { x: car.x, z: car.z },
      { x: pose.position.x, z: pose.position.z },
      colliders, CAMERA.minDistance,
    );
    assert.equal(frac, 1, `south road x=${x}: camera ray must stay clear`);
  }
  // A wall 8..12 m behind the car on a 16 m ray: stop 1.2 m short of it.
  const wall = [{ minX: -5, maxX: 5, minZ: -12, maxZ: -8 }];
  const blocked = clearanceFraction({ x: 0, z: 0 }, { x: 0, z: -16 }, wall, CAMERA.minDistance);
  assert.ok(blocked > 0.4 && blocked < 0.5, `wall at 8 m must pull the camera to ~0.43, got ${blocked.toFixed(3)}`);
  // A box off to the side never touches the ray.
  assert.equal(
    clearanceFraction({ x: 0, z: 0 }, { x: 0, z: -16 }, [{ minX: 20, maxX: 30, minZ: -12, maxZ: -8 }], CAMERA.minDistance),
    1, 'off-axis building must not pull the camera in',
  );
  // Never closer than minDistance, even with a wall right behind the car.
  const tight = clearanceFraction({ x: 0, z: 0 }, { x: 0, z: -16 }, [{ minX: -5, maxX: 5, minZ: -6, maxZ: -1 }], CAMERA.minDistance);
  assert.ok(tight * CAMERA.driveDistance >= CAMERA.minDistance - 1e-9, 'pull-in must respect minDistance');
  // And the car is still fully in frame at that closest distance.
  const car = sportCar(0, 0, Math.PI / 2, 20);
  const pose = driveCameraPose(car);
  const f = CAMERA.minDistance / CAMERA.driveDistance;
  const pulled = {
    position: {
      x: car.x + (pose.position.x - car.x) * f,
      y: (car.y ?? 0) + CAMERA.driveHeight + CAMERA.minDistance * Math.sin(CAMERA.drivePitch),
      z: car.z + (pose.position.z - car.z) * f,
    },
    target: pose.target,
  };
  assert.equal(frameCar(pulled, fovForSpeed(20), ASPECT, car).inFrame, true, 'car must stay in frame at minDistance');
});

test('config: drive + chase camera numbers are the Day 4A values', () => {
  assert.equal(CAMERA.driveDistance, 16);
  assert.equal(CAMERA.driveHeight, 5.0);
  assert.equal(CAMERA.drivePitch, 0.12);
  assert.equal(CAMERA.driveLookHeight, 0.3);
  assert.equal(CAMERA.chaseDistance, 13);
  assert.equal(CAMERA.chaseHeight, 5.0);
  assert.equal(CAMERA.chaseLookAhead, 0);
  assert.equal(CAMERA.chaseLookHeight, 0.3);
});
