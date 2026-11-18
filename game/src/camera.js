// Cabo Luna — chase-camera math, no three.js and no DOM here.
// Everything in this file is pure arithmetic over plain objects, so
// Node tests can prove the framing (whole car in frame, police in
// frame, no jumps) without a renderer. The live renderer mirrors
// these formulas: render.js updateCamera places the real camera with
// the same distance / height / pitch / look-height rule as
// driveCameraPose, and shots.js carChaseCam is chaseCameraPose.
//
// The projector was cross-checked against the vendored three.js
// PerspectiveCamera: identical screen bounds for the Day 3B play
// pose, so the numbers these tests assert are the numbers the
// browser actually paints.
import { CAMERA } from './config.js';

// Where the driving camera sits for a car: behind it by
// driveDistance, raised by driveHeight plus the pitch lift, looking
// at the car's lower body (driveLookHeight) so the whole car sits
// above the dialogue band at the bottom of the 768x480 frame.
export function driveCameraPose(car) {
  const behind = car.heading + Math.PI;
  const flat = CAMERA.driveDistance * Math.cos(CAMERA.drivePitch);
  return {
    position: {
      x: car.x + Math.sin(behind) * flat,
      y: (car.y ?? 0) + CAMERA.driveHeight + CAMERA.driveDistance * Math.sin(CAMERA.drivePitch),
      z: car.z + Math.cos(behind) * flat,
    },
    target: { x: car.x, y: (car.y ?? 0) + CAMERA.driveLookHeight, z: car.z },
  };
}

// Fixed chase-shot pose: pulled back and raised, looking a short way
// ahead of the player car so the car and the staged police share the
// frame. shots.js carChaseCam delegates to this function.
export function chaseCameraPose(car) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return {
    position: {
      x: car.x - fx * CAMERA.chaseDistance,
      y: CAMERA.chaseHeight,
      z: car.z - fz * CAMERA.chaseDistance,
    },
    target: {
      x: car.x + fx * CAMERA.chaseLookAhead,
      y: CAMERA.chaseLookHeight,
      z: car.z + fz * CAMERA.chaseLookAhead,
    },
  };
}

// Speed-driven field of view: base FOV plus a gain per m/s, capped.
// Same rule as main.js draw().
export function fovForSpeed(speed) {
  return CAMERA.fovBase + Math.min(CAMERA.fovMaxExtra, Math.abs(speed) * CAMERA.fovSpeedGain);
}

// One shortest-arc step of an angle toward a target, at most
// maxStep radians. Used to swing the camera yaw behind the car on
// turns instead of snapping it: a sharp turn eases the camera
// around over a few frames.
export function approachAngle(current, target, maxStep) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (d > maxStep) return current + maxStep;
  if (d < -maxStep) return current - maxStep;
  return target;
}

// Ease a camera pose toward a desired pose: position and look target
// each move `factor` of the remaining distance per call (factor 1 =
// snap, 0 = frozen). The renderer calls this every frame with
// CAMERA.smoothFactor, so the camera glides instead of jumping when
// the player enters a car, reverses, or takes a sharp corner.
export function smoothPose(prev, next, factor) {
  const f = Math.max(0, Math.min(1, factor));
  const lerp = (a, b) => a + (b - a) * f;
  return {
    position: {
      x: lerp(prev.position.x, next.position.x),
      y: lerp(prev.position.y, next.position.y),
      z: lerp(prev.position.z, next.position.z),
    },
    target: {
      x: lerp(prev.target.x, next.target.x),
      y: lerp(prev.target.y, next.target.y),
      z: lerp(prev.target.z, next.target.z),
    },
  };
}

// Collision-aware pull-in: how much of the desired camera offset
// stays clear of building footprints. Returns a fraction in
// (0, 1] — 1 means the full distance is clear. `from` is the car
// (ground level), `to` is the desired camera position; both are
// {x, z}. The test is the same slab test police.js uses for line of
// sight, but instead of a boolean it returns where the ray first
// enters a footprint, pulled back by `margin` metres, and never
// below `minDistance` (so a tight alley still leaves a usable shot
// instead of shoving the camera inside the car).
export function clearanceFraction(from, to, colliders, minDistance, margin = CAMERA.clearanceMargin) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const full = Math.hypot(dx, dz);
  if (full < 1e-9) return 1;
  let best = 1;
  for (const c of colliders) {
    let tmin = 0, tmax = 1;
    for (const [p, d, lo, hi] of [[from.x, dx, c.minX, c.maxX], [from.z, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) { tmin = 1; tmax = 0; break; }
      } else {
        let t1 = (lo - p) / d, t2 = (hi - p) / d;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) break;
      }
    }
    if (tmin <= tmax && tmin < best) best = tmin;
  }
  if (best >= 1) return 1;
  // Stop `margin` metres short of the wall, measured along the ray.
  const safe = Math.max(0, best * full - margin) / full;
  const minFrac = Math.min(1, minDistance / full);
  return Math.max(minFrac, Math.min(1, safe));
}

// Project a world point to screen pixels (origin top-left).
// Returns behind=true when the point is at or behind the camera
// plane. The basis is built from the look direction with world-up
// (0,1,0), exactly as three.js lookAt does for a level camera.
export function projectToScreen(pose, fovDeg, aspect, point, width = 768, height = 480) {
  const ex = pose.position.x, ey = pose.position.y, ez = pose.position.z;
  let fx = pose.target.x - ex, fy = pose.target.y - ey, fz = pose.target.z - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  // right = normalize(cross(forward, up)); cross((fx,fy,fz),(0,1,0))
  // is (-fz, 0, fx), so right has no y component.
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  // up2 = cross(right, forward) = (-rz*fy, rz*fx - rx*fz, rx*fy)
  let ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const dx = point.x - ex, dy = point.y - ey, dz = point.z - ez;
  const xv = dx * rx + dz * rz;
  const yv = dx * ux + dy * uy + dz * uz;
  const zv = dx * fx + dy * fy + dz * fz; // forward depth; <= 0 is behind
  if (zv <= 0) return { x: NaN, y: NaN, ndcX: NaN, ndcY: NaN, behind: true };
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  // Camera-space z is -zv (three.js looks down -Z), so NDC divides
  // by +zv. (Dividing by -zv mirrors the image — caught by the
  // three.js cross-check while this module was first written.)
  const ndcX = xv / (zv * tanH);
  const ndcY = yv / (zv * tanV);
  return {
    x: ((ndcX + 1) / 2) * width,
    y: ((1 - ndcY) / 2) * height,
    ndcX, ndcY,
    behind: false,
  };
}

// The 8 corners of a car's box: length along its heading, width
// across, height up to the cabin roof (1.55 m: 0.93 m body + roof).
export function carCornerPoints(car, height = 1.55) {
  const pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, height]) {
    const lx = (sx * car.width) / 2, lz = (sz * car.length) / 2;
    pts.push({
      x: car.x + Math.sin(car.heading) * lz + Math.cos(car.heading) * lx,
      y: sy,
      z: car.z + Math.cos(car.heading) * lz - Math.sin(car.heading) * lx,
    });
  }
  return pts;
}

// Screen bounds of a car under a camera pose: pixel bounds, size,
// and whether every corner lands inside the frame.
export function frameCar(pose, fovDeg, aspect, car, width = 768, height = 480) {
  const pts = carCornerPoints(car).map((p) => projectToScreen(pose, fovDeg, aspect, p, width, height));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    heightPx: Math.max(...ys) - Math.min(...ys),
    widthPx: Math.max(...xs) - Math.min(...xs),
    inFrame: pts.every((p) => !p.behind && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height),
    points: pts,
  };
}
