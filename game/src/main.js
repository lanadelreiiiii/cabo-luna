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
import { createPoliceManager, stepPolice, addCollisionCrime, policeStatus } from './police.js';
import { POLICE } from './config.js';
import { createPlayer, plazaSpawn } from './player.js';
import { createRenderer, buildScene, createPlayerMesh, createVehicleRig, updateCamera } from './render.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_JUMP, ACTION_ENTER } from './input.js';
import { stageShot } from './shots.js';
import { saveGame, loadGame } from './save.js';
import * as inkjs from 'inkjs';
import { createMissionManager } from './missions.js';
import { CHAIN, MISSIONS, resolveManifest } from './mission-data.js';
import { createMissionChain } from './mission-chain.js';
import { createCaboAdapter } from './mission-adapter.js';
import { MISSION_01_JSON } from './stories/mission-01-delivery-gone-wrong.js';
import { MISSION_02_JSON } from './stories/mission-02-wrong-place.js';
import { MISSION_03_JSON } from './stories/mission-03-harbor-silence.js';

const STORY_JSON = {
  'mission-01-delivery-gone-wrong': MISSION_01_JSON,
  'mission-02-wrong-place': MISSION_02_JSON,
  'mission-03-harbor-silence': MISSION_03_JSON,
};

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
let police = null;

function buildSim() {
  resetVehicleIds();
  parked = buildParkedCars();
  const rng = makeRng(seed * 31 + 7);
  traffic = createTrafficManager(graph, city, rng);
  peds = createPedestrianManager(city, rng);
  // The patrol gets its own RNG stream so traffic/pedestrian builds
  // stay byte-identical to Part A.
  police = createPoliceManager(graph, city, colliders, makeRng(seed * 97 + 13));
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
  mission: { job: 'JOB 1/3', title: 'A Delivery Gone Wrong', state: 'AVAILABLE', objective: 'Meet Yara at the Plaza del Reloj', done: 0, total: 5 },
  // Mission chain progress persisted via save.js (Day 3A).
  missionSave: {
    completedMissions: saved?.completedMissions ?? [],
    currentMissionId: saved?.currentMissionId ?? null,
    missionStates: saved?.missionStates ?? null,
  },
  dialogue: null,
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
  state.police = police ? policeStatus(police, state.player.x, state.player.z) : [];
  state.flashTime = police ? police.elapsed : 0;
}

// Mission controller, created after the world below; world.reset() and
// world.step() call into it when present (shots run before any UI).
let missionCtl = null;

// The world object the shot stager drives: reset + fixed-step advance.
const world = {
  city,
  player,
  state,
  graph,
  get parked() { return parked; },
  get traffic() { return traffic; },
  get peds() { return peds; },
  get police() { return police; },
  elapsed: 0,
  playerCar: null,
  allCars() {
    const list = [...parked, ...traffic.cars];
    if (police) for (const u of police.units) list.push(u.car);
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
    state.police = [];
    state.flashTime = 0;
    this.elapsed = 0;
    state.clockMinutes = WORLD.clockStartMinutes;
    if (missionCtl) missionCtl.restartChain();
    refreshDerived();
  },
  step(dt, move, sprint, jump, drive) {
    this.elapsed += dt;
    let hardHitsBefore = 0;
    if (this.playerCar) hardHitsBefore = this.playerCar.collisions;
    if (state.onFoot) {
      player.step(dt, move, sprint, jump);
    } else if (this.playerCar) {
      stepVehicle(this.playerCar, drive ?? { throttle: 0, steer: 0, brake: 0, handbrake: false }, dt, colliders);
      player.state.x = this.playerCar.x;
      player.state.z = this.playerCar.z;
      player.state.yaw = this.playerCar.heading + Math.PI;
      // A hard hit while driving is a crime: building smash, or a
      // pedestrian struck at speed (each ped counts once).
      if (this.playerCar.collisions > hardHitsBefore && Math.abs(this.playerCar.speed) > POLICE.collisionSpeed) {
        addCollisionCrime(state);
      }
      if (Math.abs(this.playerCar.speed) > POLICE.collisionSpeed) {
        for (const ped of peds.peds) {
          if (!ped.hit && Math.hypot(ped.x - this.playerCar.x, ped.z - this.playerCar.z) < 1.8) {
            ped.hit = true;
            addCollisionCrime(state);
            triggerFlee(peds, ped.x, ped.z);
          }
        }
      }
    }
    const obstacles = this.playerCar ? [{ x: this.playerCar.x, z: this.playerCar.z }] : [];
    stepTraffic(traffic, dt, obstacles);
    stepPedestrians(peds, dt);
    // Patrol runs after traffic: pursuit, search, busted, heat decay.
    const pc = this.playerCar;
    stepPolice(police, dt, {
      x: player.state.x, z: player.state.z,
      speed: pc ? pc.speed : Math.hypot(player.state.vx, player.state.vz),
      vx: pc ? Math.sin(pc.heading) * pc.speed : player.state.vx,
      vz: pc ? Math.cos(pc.heading) * pc.speed : player.state.vz,
      car: pc ?? null,
    }, state);
    state.clockMinutes += dt * WORLD.clockMinutesPerSecond;
    // Mission manager ticks last: police state (busted / chase) is fresh.
    if (missionCtl) missionCtl.tick(dt);
    refreshDerived();
  },
};

// ---- Mission chain: JOB 1/3 -> 2/3 -> 3/3, driven by the InkJS
// manager + the mission-chain state machine. Chain progress is kept in
// state.missionSave and written by saveGame on every transition and on
// the 10s autosave timer. A saved chain restores completed missions as
// COMPLETED and the current mission as AVAILABLE (it resumes, not
// mid-objective). ----
function createMissionCtl() {
  const adapter = createCaboAdapter(world, (text) => {
    if (state.mission && typeof state.mission === 'object') state.mission.objective = text;
  });
  const manager = createMissionManager(inkjs, adapter);
  const chain = createMissionChain(CHAIN, state.missionSave.missionStates);
  let lastDialogue = null;

  const ctl = {
    manager,
    chain,

    syncMissionSave() {
      state.missionSave = {
        completedMissions: chain.completedIds(),
        currentMissionId: chain.current(),
        missionStates: chain.toJSON(),
      };
    },

    sync(snap) {
      const id = snap.missionId;
      const manifest = MISSIONS[id];
      const n = CHAIN.indexOf(id) + 1;
      if (manifest) {
        state.mission = {
          job: `JOB ${n}/3`,
          title: manifest.title,
          state: chain.state(id),
          objective: (state.mission && typeof state.mission === 'object' && state.mission.objective)
            ? state.mission.objective : '',
          done: snap.objectivesDone.length,
          total: manifest.objectives.length,
        };
      }
      if (snap.status === 'failed') {
        state.mission.objective = `Mission failed (${snap.failReason}) — press R to retry`;
      }
      if (chain.current() === null && !manifest) {
        state.mission = { job: 'JOB 3/3', title: 'Harbor Silence', state: 'COMPLETED', objective: 'All jobs done — the city is yours.', done: 3, total: 3 };
      }
      // Dialogue: last ink line (speaker from its tags) + live choices.
      const lastLine = (snap.lines || []).filter((l) => l.text).pop();
      if (lastLine) {
        const speakerTag = (lastLine.tags || []).find((t) => t.startsWith('speaker:'));
        lastDialogue = {
          speaker: speakerTag ? speakerTag.slice('speaker:'.length) : '',
          text: lastLine.text,
          choices: snap.choices || [],
        };
      } else if (lastDialogue) {
        lastDialogue = { ...lastDialogue, choices: snap.choices || [] };
      }
      state.dialogue = lastDialogue;
    },

    loadCurrent() {
      const id = chain.current();
      if (!id) return null;
      chain.start(id);
      const manifest = resolveManifest(id, city);
      manager.loadCompiled(id, manifest, STORY_JSON[id]);
      this.syncMissionSave();
      this.sync(manager.start());
      return id;
    },

    restartChain() {
      const id = chain.current();
      if (id && chain.state(id) === 'ACTIVE') chain.restart(id);
      lastDialogue = null;
      state.dialogue = null;
      this.loadCurrent();
    },

    retry() {
      if (manager.status !== 'failed') return;
      const id = manager.missionId;
      chain.retry(id);
      lastDialogue = null;
      this.loadCurrent();
    },

    tick(dt) {
      const snap = manager.update(dt);
      this.sync(snap);
      if (snap.status === 'completed') {
        const id = snap.missionId;
        if (chain.state(id) === 'ACTIVE') {
          chain.complete(id);
          this.syncMissionSave();
          saveGame(state);
          this.sync(snap);
          this.loadCurrent();
        }
      } else if (snap.status === 'failed') {
        const id = snap.missionId;
        if (chain.state(id) === 'ACTIVE') {
          chain.fail(id);
          this.syncMissionSave();
          saveGame(state);
          this.sync(snap);
        }
      }
      return snap;
    },

    choose(i) {
      try {
        const snap = manager.choose(i);
        this.sync(snap);
        return snap;
      } catch {
        return manager.snapshot();
      }
    },

    hasChoices() {
      return manager.status === 'active' && manager.choices.length > 0;
    },
  };
  return ctl;
}

missionCtl = createMissionCtl();
// The shot stager (and HUD buttons / number keys) choose through these.
world.chooseMission = (i) => missionCtl.choose(i);
world.hasMissionChoices = () => missionCtl.hasChoices();
hud.setChoiceHandler((i) => missionCtl.choose(i));
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Digit1') missionCtl.choose(0);
  if (e.code === 'Digit2') missionCtl.choose(1);
  if (e.code === 'KeyR' && missionCtl.manager.status === 'failed') missionCtl.retry();
});

function draw(screen, shotCam) {
  rig.sync(world.allCars(), peds.peds, world.elapsed);
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
        if (world.police.busted) { endGame(); break; }
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
