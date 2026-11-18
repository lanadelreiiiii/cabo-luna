// Cabo Luna — boot and the one loop.
// Input is read every frame, the world advances in fixed 1/60 s steps, and
// the renderer paints what is there. Screens: title -> play -> paused ->
// game over. ?seed=N fixes the city. ?shot=start|play|chase|end (with
// &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import * as THREE from 'three';
import { STEP, SEED_DEFAULT, WORLD, CAMERA, VEHICLE, wantedFromHeat } from './config.js';
import { generateCity, districtAtPoint, buildingColliders } from './city.js';
import { makeRng } from './rng.js';
import { buildRoadGraph } from './roadgraph.js';
import { createVehicle, stepVehicle, nearestEnterableCar, applySteal, resetVehicleIds } from './vehicles.js';
import { createTrafficManager, stepTraffic, createPedestrianManager, stepPedestrians, triggerFlee } from './traffic.js';
import { createPlayer, plazaSpawn } from './player.js';
import { createRenderer, buildScene, createPlayerMesh, createVehicleRig, updateCamera } from './render.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_JUMP, ACTION_ENTER } from './input.js';
import { stageShot } from './shots.js';
import { saveGame, loadGame } from './save.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : SEED_DEFAULT;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const city = generateCity(seed);
const colliders = buildingColliders(city);
const graph = buildRoadGraph(city);
const renderer = createRenderer(canvas);
const { scene } = buildScene(city);
const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, window.innerWidth / window.innerHeight, 0.1, 2000);
const playerMesh = createPlayerMesh(scene);
const hud = createHud(city);

const saved = loadGame();
const spawn = saved && saved.seed === seed ? { x: saved.x, z: saved.z, yaw: Math.PI * 0.75 } : plazaSpawn(city);
const player = createPlayer(city, spawn);

// Parked cars line the eastbound lane of the south road (road line 110,
// lane +3): five cars the player can walk up to and steal.
function buildParkedCars() {
  const kinds = ['sedan', 'sport', 'sedan', 'sedan', 'sport'];
  const xs = [-30, -14, 2, 18, 34];
  return kinds.map((kind, i) => createVehicle(kind, xs[i], 113, Math.PI / 2, { parked: true }));
}

let parked = [];
let traffic = null;
let peds = null;

function buildSim() {
  resetVehicleIds();
  parked = buildParkedCars();
  const rng = makeRng(seed * 31 + 7);
  traffic = createTrafficManager(graph, city, rng);
  peds = createPedestrianManager(city, rng);
}

buildSim();
const rig = createVehicleRig(scene, [...parked, ...traffic.cars], peds.peds);

const state = {
  seed,
  money: saved && saved.seed === seed ? saved.money : WORLD.moneyStart,
  health: WORLD.healthMax,
  wanted: 0,
  crimeHeat: 0,
  day: saved && saved.seed === seed ? saved.day : WORLD.dayStart,
  clockMinutes: WORLD.clockStartMinutes,
  mission: 'Day 0 — Explore Cabo Luna. Learn the streets of Luna Vieja.',
  banner: 'Plaza del Reloj',
  district: 'Luna Vieja',
  speedKmh: 0,
  onFoot: true,
  clockText: 'Day 1 — 09:24',
  hint: '',
  cars: [],
  playerCar: null,
  player: player.state,
};

function clockText() {
  const h = Math.floor(state.clockMinutes / 60) % 24;
  const m = Math.floor(state.clockMinutes % 60);
  return `Day ${state.day} — ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function refreshDerived() {
  state.district = districtAtPoint(city, state.player.x, state.player.z);
  state.banner = state.district;
  state.speedKmh = world.playerCar
    ? Math.abs(world.playerCar.speed) * 3.6
    : player.speed() * 3.6;
  state.clockText = clockText();
  state.hint = state.onFoot
    ? 'WASD move · Shift sprint · E enter car · P pause'
    : 'W/S drive · A/D steer · Space brake · E exit';
  state.cars = traffic.cars.map((c) => ({ x: c.x, z: c.z }));
  state.playerCar = world.playerCar ? { x: world.playerCar.x, z: world.playerCar.z } : null;
}

// The world object the shot stager drives: reset + fixed-step advance.
const world = {
  city,
  player,
  state,
  graph,
  get parked() { return parked; },
  get traffic() { return traffic; },
  get peds() { return peds; },
  playerCar: null,
  allCars() {
    const list = [...parked, ...traffic.cars];
    if (this.playerCar) list.push(this.playerCar);
    return list;
  },
  nearestParked() {
    return nearestEnterableCar(parked, player.state.x, player.state.z, 60);
  },
  placePlayer(x, z) {
    player.state.x = x; player.state.z = z;
    player.state.vx = 0; player.state.vz = 0;
  },
  tryEnter() {
    if (!state.onFoot) return false;
    const candidates = [...parked, ...traffic.cars];
    const car = nearestEnterableCar(candidates, player.state.x, player.state.z);
    if (!car) return false;
    // Stealing a traffic car pulls it out of the traffic flow.
    const ti = traffic.cars.indexOf(car);
    if (ti >= 0) traffic.cars.splice(ti, 1);
    const pi = parked.indexOf(car);
    if (pi >= 0) parked.splice(pi, 1);
    applySteal(state, car);
    triggerFlee(peds, car.x, car.z);
    car.owned = true;
    this.playerCar = car;
    state.onFoot = false;
    state.mission = 'Stolen wheels — drive it, lose the heat, stay free.';
    player.state.x = car.x; player.state.z = car.z;
    player.state.yaw = car.heading + Math.PI;
    refreshDerived();
    return true;
  },
  exitCar() {
    const car = this.playerCar;
    if (!car) return false;
    const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
    player.state.x = car.x + rx * VEHICLE.exitOffset;
    player.state.z = car.z + rz * VEHICLE.exitOffset;
    player.state.vx = 0; player.state.vz = 0;
    player.state.yaw = car.heading + Math.PI;
    car.parked = true;
    this.playerCar = null;
    state.onFoot = true;
    refreshDerived();
    return true;
  },
  reset() {
    const s = plazaSpawn(city);
    player.state.x = s.x; player.state.z = s.z; player.state.y = 0;
    player.state.vx = 0; player.state.vz = 0; player.state.vy = 0;
    player.state.yaw = s.yaw; player.state.pitch = 0.2;
    this.playerCar = null;
    buildSim();
    state.money = WORLD.moneyStart;
    state.health = WORLD.healthMax;
    state.wanted = 0;
    state.crimeHeat = 0;
    state.onFoot = true;
    state.mission = 'Day 0 — Explore Cabo Luna. Learn the streets of Luna Vieja.';
    state.clockMinutes = WORLD.clockStartMinutes;
    refreshDerived();
  },
  step(dt, move, sprint, jump, drive) {
    if (state.onFoot) {
      player.step(dt, move, sprint, jump);
    } else if (this.playerCar) {
      stepVehicle(this.playerCar, drive ?? { throttle: 0, steer: 0, brake: 0, handbrake: false }, dt, colliders);
      player.state.x = this.playerCar.x;
      player.state.z = this.playerCar.z;
      player.state.yaw = this.playerCar.heading + Math.PI;
    }
    const obstacles = this.playerCar ? [{ x: this.playerCar.x, z: this.playerCar.z }] : [];
    stepTraffic(traffic, dt, obstacles);
    stepPedestrians(peds, dt);
    state.clockMinutes += dt * WORLD.clockMinutesPerSecond;
    refreshDerived();
  },
};

function draw(screen, shotCam) {
  rig.sync(world.allCars(), peds.peds);
  playerMesh.visible = state.onFoot;
  playerMesh.position.set(state.player.x, state.player.y, state.player.z);
  playerMesh.rotation.y = state.player.yaw + Math.PI;
  if (!state.onFoot && world.playerCar) {
    const car = world.playerCar;
    const targetFov = CAMERA.fovBase + Math.min(CAMERA.fovMaxExtra, Math.abs(car.speed) * CAMERA.fovSpeedGain);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    updateCamera(camera, {
      x: car.x, y: 0, z: car.z,
      yaw: car.heading + Math.PI, pitch: CAMERA.drivePitch,
    }, shotCam, { distance: CAMERA.driveDistance, height: CAMERA.driveHeight });
  } else {
    if (Math.abs(camera.fov - CAMERA.fovBase) > 0.05) {
      camera.fov = CAMERA.fovBase;
      camera.updateProjectionMatrix();
    }
    updateCamera(camera, state.player, shotCam ?? null);
  }
  renderer.render(scene, camera);
  hud.update(state);
  hud.showScreen(screen);
}

function announce(message) { status.textContent = message; }

function runShot(name) {
  const staged = stageShot(name, world);
  let painted = 0;
  function paint() {
    draw(staged.screen, staged.shotCam);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = 'title';
  let accumulator = 0;
  let last = performance.now();
  let saveTimer = 0;

  function startGame() {
    world.reset();
    accumulator = 0;
    screen = 'play';
    announce('Playing. Explore Cabo Luna — WASD to move, Shift to sprint, E to enter a car, drag to look.');
  }

  function endGame() {
    screen = 'over';
    saveGame(state);
    announce(`Game over. Money $${state.money}.`);
  }

  function frame(now) {
    const elapsed = Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    if (screen === 'play') {
      accumulator += elapsed;
      while (accumulator >= STEP) {
        accumulator -= STEP;
        const orbit = input.orbit();
        player.orbit(orbit.yaw, orbit.pitch);
        world.step(STEP, input.move(), input.sprinting(), input.consume(ACTION_JUMP),
          state.onFoot ? null : input.drive());
        if (state.health <= 0) { endGame(); break; }
      }
      if (input.consume(ACTION_ENTER)) {
        if (state.onFoot) {
          if (world.tryEnter()) announce('Driving. W/S drive, A/D steer, Space brake, E to exit.');
        } else {
          world.exitCar();
          announce('On foot.');
        }
      }
      saveTimer += elapsed;
      if (saveTimer > 10) { saveTimer = 0; saveGame(state); }
    }
    if (input.consume(ACTION_PAUSE) && (screen === 'play' || screen === 'paused')) {
      screen = screen === 'play' ? 'paused' : 'play';
      announce(screen === 'paused' ? 'Paused.' : 'Playing.');
    }
    if (screen === 'title' && input.consume(ACTION_CONFIRM)) startGame();
    if (screen === 'over' && input.consume(ACTION_CONFIRM)) startGame();
    draw(screen, null);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  announce('Cabo Luna. Press Enter to start.');
  refreshDerived();
  requestAnimationFrame(frame);
}

refreshDerived();
if (shot) runShot(shot);
else runGame();
