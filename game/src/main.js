// Cabo Luna — boot and the one loop.
// Input is read every frame, the world advances in fixed 1/60 s steps, and
// the renderer paints what is there. Screens: title -> play -> paused ->
// game over. ?seed=N fixes the city. ?shot=start|play|chase|end
// (legacy) or hero|foot|combat|vista (Day 4E A/B/C/D dossier shots)
// with &seed=N stages that scene instead of running the loop, paints
// it twice and sets window.__shotReady for a screenshot.
import * as THREE from 'three';
import { STEP, SEED_DEFAULT, WORLD, CAMERA, VEHICLE, VEHICLE_CONFIGS, wantedFromHeat, resolveShadow } from './config.js';
import { generateCity, districtAtPoint, buildingColliders } from './city.js';
import { makeRng } from './rng.js';
import { buildRoadGraph } from './roadgraph.js';
import { createVehicle, stepVehicle, nearestEnterableCar, applySteal, resetVehicleIds } from './vehicles.js';
import { createTrafficManager, stepTraffic, createPedestrianManager, stepPedestrians, triggerFlee } from './traffic.js';
import { createPoliceManager, stepPolice, addCollisionCrime, policeStatus } from './police.js';
import { POLICE, COMBAT } from './config.js';
import {
  createMemory, resetMemory, recordCrime, stepMemory, tryGarageEscape,
  isDirectlyObserved, onVehicleSwitch, memoryHud, GARAGE, SAFEHOUSE,
} from './city-remembers.js';
import { createCombatManager, spawnHarborGuards, spawnGuards, fire as combatFire, stepCombat, cycleWeapon, switchWeapon, startReload, getAmmo } from './combat.js';
import { createPlayer, plazaSpawn } from './player.js';
import { createRenderer, buildScene, createPlayerMesh, createVehicleRig, updateCamera } from './render.js';
import { driveCameraPose, clearanceFraction, approachAngle } from './camera.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_JUMP, ACTION_ENTER, ACTION_RADIO } from './input.js';
import { stageShot } from './shots.js';
import { saveGame, loadGame } from './save.js';
import * as inkjs from 'inkjs';
import { createMissionManager } from './missions.js';
import { CHAIN, MISSIONS, resolveManifest } from './mission-data.js';
import { createMissionChain } from './mission-chain.js';
import { createCaboAdapter } from './mission-adapter.js';
import { createContextRecovery, RECOVERY_MESSAGE } from './context-recovery.js';
import { createHelicopter, resetHelicopter, stepHelicopter, heliHud } from './helicopter.js';
import { createRadio, cycleRadio, radioHud, createRadioPlayer } from './radio.js';
import { MISSION_01_JSON } from './stories/mission-01-delivery-gone-wrong.js';
import { MISSION_02_JSON } from './stories/mission-02-wrong-place.js';
import { MISSION_03_JSON } from './stories/mission-03-harbor-silence.js';
import { MISSION_04_JSON } from './stories/mission-04-three-stops.js';
import { MISSION_05_JSON } from './stories/mission-05-plant-the-proof.js';

const STORY_JSON = {
  'mission-01-delivery-gone-wrong': MISSION_01_JSON,
  'mission-02-wrong-place': MISSION_02_JSON,
  'mission-03-harbor-silence': MISSION_03_JSON,
  'mission-04-three-stops': MISSION_04_JSON,
  'mission-05-plant-the-proof': MISSION_05_JSON,
};

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : SEED_DEFAULT;
// Visual grade (Day 4C): ?grade=sunset|golden|haze selects one of the
// three art-direction configurations; the default is the comparison
// winner wired in visual-grades.js.
const gradeParam = params.get('grade');
// Shadow configuration (Day 4F): ?shadow=A|B|C; A is the baseline.
// ?shadowmap=512|1024|2048 is a test-only map-size override.
const shadowParam = params.get('shadow');
const shadowMapParam = Number.parseInt(params.get('shadowmap') ?? '', 10);
const shadow = resolveShadow(shadowParam, Number.isInteger(shadowMapParam) ? shadowMapParam : undefined);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const city = generateCity(seed);
const colliders = buildingColliders(city);
const graph = buildRoadGraph(city);
const renderer = createRenderer(canvas);
const { scene, grade } = buildScene(city, gradeParam, shadow.id);
// Day 4F (config C): the shadow map re-renders at most every
// updateEvery-th frame — the sun and static casters never move, so
// only dynamic shadows lag (see config.js). The throttle flag lives
// on renderer.shadowMap, NOT on the light: WebGLShadowMap.render
// returns early when shadowMap.autoUpdate is false and
// shadowMap.needsUpdate is false (vendored three.module.min.js —
// setting sun.shadow.needsUpdate alone renders nothing). The flag is
// set per draw in draw().
if (shadow.updateEvery > 1) renderer.shadowMap.autoUpdate = false;
renderer.toneMappingExposure = grade.exposure;
const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, window.innerWidth / window.innerHeight, 0.1, 2000);

// ---- WebGL context recovery (Day 4H): one renderer for the whole
// session — loss/restore NEVER creates a second one. On loss the loop
// freezes (no sim, no render, no time advance) and the banner shows;
// on restore we probe-render first and resume only if the probe
// painted. three.js re-initialises its GPU programs/textures on that
// first render after restore, so the probe is the verification. The
// shadow-map throttle (Day 4F) restarts at frame 1 on restore so the
// first post-restore pass samples a real shadow map, never a dropped
// one (see the draw() note about the null-map poison).
const recoveryEl = document.getElementById('hud-recovery');
const recovery = createContextRecovery({
  showMessage() {
    recoveryEl.hidden = false;
    announce(RECOVERY_MESSAGE);
  },
  hideMessage() { recoveryEl.hidden = true; },
  verify() {
    const gl = renderer.getContext();
    if (!gl || gl.isContextLost()) return false;
    if (!scene || scene.children.length === 0) return false;
    try {
      renderer.render(scene, camera);
      return true;
    } catch {
      return false;
    }
  },
  onRestored() { shadowState.frame = 0; },
});
canvas.addEventListener('webglcontextlost', (e) => recovery.handleLost(e));
canvas.addEventListener('webglcontextrestored', () => recovery.handleRestored());
const playerMesh = createPlayerMesh(scene, shadow.id);
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

// THE CITY REMEMBERS (Day 4D): the memory of every crime — witnesses,
// reports, district heat, the identified vehicle, the last-known
// location, the garage and the safehouse. One memory for the whole
// session; world.reset() wipes it via resetMemory.
const memory = createMemory(city);

// Phase 6 — police helicopter (air support at wanted >= 3, feeds the
// memory last-known-location) and original procedural radio (defaults
// OFF; the player is created only outside shot mode, so dossier
// captures stay silent-safe — see the radioPlayer guard below).
const heli = createHelicopter();
const radio = createRadio();
const radioPlayer = shot
  ? null
  : createRadioPlayer(radio, () => new AudioContext());

let parked = [];
let traffic = null;
let peds = null;
let police = null;
let combat = null;

function buildSim() {
  resetVehicleIds();
  parked = buildParkedCars();
  const rng = makeRng(seed * 31 + 7);
  traffic = createTrafficManager(graph, city, rng);
  peds = createPedestrianManager(city, rng);
  // The patrol gets its own RNG stream so traffic/pedestrian builds
  // stay byte-identical to Part A.
  police = createPoliceManager(graph, city, colliders, makeRng(seed * 97 + 13));
  // Combat gets its own stream too. Shooting heat flows through the
  // mission adapter's crime table: +10 per trigger pull, +40 per hit
  // on a person — so a harbor fight raises wanted and the existing
  // police pursuit + heat decay handle the rest (incl. M3 wanted_clear).
  combat = createCombatManager({
    rng: makeRng(seed * 131 + 3),
    colliders,
    onShot: () => {
      state.crimeHeat = Math.min(100, state.crimeHeat + COMBAT.heatPerShot);
      state.wanted = wantedFromHeat(state.crimeHeat);
      // The shot is a crime the city remembers: district heat rises
      // and any pedestrian with line of sight becomes a witness.
      recordCrime(memory, {
        type: 'shooting', x: player.state.x, z: player.state.z, heat: COMBAT.heatPerShot,
      }, state, { peds: peds.peds, colliders });
    },
    onHitPerson: () => {
      state.crimeHeat = Math.min(100, state.crimeHeat + COMBAT.heatPerHit);
      state.wanted = wantedFromHeat(state.crimeHeat);
      recordCrime(memory, {
        type: 'shooting', x: player.state.x, z: player.state.z, heat: COMBAT.heatPerHit,
      }, state, { peds: peds.peds, colliders });
    },
  });
}

buildSim();
const rig = createVehicleRig(scene, [...parked, ...traffic.cars], peds.peds, shadow.id);

const state = {
  seed,
  money: saved && saved.seed === seed ? saved.money : WORLD.moneyStart,
  health: WORLD.healthMax,
  wanted: 0,
  crimeHeat: 0,
  day: saved && saved.seed === seed ? saved.day : WORLD.dayStart,
  clockMinutes: WORLD.clockStartMinutes,
  mission: { job: `JOB 1/${CHAIN.length}`, title: 'A Delivery Gone Wrong', state: 'AVAILABLE', objective: 'Meet Yara at the Plaza del Reloj', done: 0, total: 5 },
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
    ? 'WASD move · E enter car · F fire · Q weapon · V radio'
    : 'W/S drive · A/D steer · Space brake · E exit · V radio';
  state.combat = combat ? { ...getAmmo(combat), kills: combat.kills, hitMarker: combat.hitMarkerTimer > 0 } : null;
  // Crosshair aim state: the crosshair shows only when the player is
  // on foot AND aiming matters — an enemy is present, or a shot /
  // hit marker is still live. On foot with no enemy it used to sit on
  // the player's chest in every still; while driving it was already
  // hidden (hud.js reads this flag).
  state.aiming = !!combat && (combat.enemies.length > 0 || combat.muzzleTimer > 0 || combat.hitMarkerTimer > 0);
  // HUD (Day 4B): car name for the speed panel + the interaction prompt.
  // On foot near an enterable car, the prompt names the car to steal.
  state.carName = world.playerCar
    ? (VEHICLE_CONFIGS[world.playerCar.kind]?.name ?? '').toUpperCase() : '';
  state.interact = '';
  if (state.onFoot) {
    let best = null, bestD = 3;
    for (const c of [...parked, ...traffic.cars]) {
      const d = Math.hypot(c.x - state.player.x, c.z - state.player.z);
      if (d < bestD) { best = c; bestD = d; }
    }
    if (best) {
      const name = (VEHICLE_CONFIGS[best.kind]?.name ?? best.kind ?? 'CAR').toUpperCase();
      state.interact = `E — STEAL ${name}`;
    }
  }
  state.cars = traffic.cars.map((c) => ({ x: c.x, z: c.z }));
  state.playerCar = world.playerCar ? { x: world.playerCar.x, z: world.playerCar.z } : null;
  state.police = police ? policeStatus(police, state.player.x, state.player.z) : [];
  state.flashTime = police ? police.elapsed : 0;
  // Phase 6: helicopter HUD (Air-1 in the patrol line + minimap) and
  // the radio station display (RADIO OFF until the player presses V).
  state.heli = heli ? heliHud(heli, state.player.x, state.player.z) : { active: false, name: 'Air-1', x: 0, z: 0, dist: 0 };
  state.radio = radioHud(radio);
  // THE CITY REMEMBERS (Day 4D): witness alerts, district heat, the
  // last-known-location, the identified vehicle, garage/safehouse.
  const mh = memoryHud(memory, state, state.player.x, state.player.z);
  state.witnessAlert = mh.witnessAlert;
  state.memoryFlash = mh.flash;
  state.districtHeat = mh.districtHeat;
  state.districtHeatLevel = mh.districtHeatLevel;
  state.lastKnown = mh.lastKnown;
  state.lastKnownStale = mh.lastKnownStale;
  state.identifiedVehicle = mh.identifiedVehicle;
  state.garage = { x: GARAGE.x, z: GARAGE.z };
  state.safehouse = { x: SAFEHOUSE.x, z: SAFEHOUSE.z };
  state.inGarage = mh.inGarage;
  state.inSafehouse = mh.inSafehouse;
  state.safehouseTimer = mh.safehouseTimer;
  // Escape hints: the player only learns the garage/safehouse trick
  // when standing in one while wanted — the hint names the payoff.
  if (state.wanted > 0 && mh.inGarage) {
    state.hint = 'GARAGE — stay hidden here to lose the trail';
  } else if (state.wanted > 0 && mh.inSafehouse) {
    state.hint = `SAFEHOUSE — stay put ${Math.max(0, 5 - Math.floor(mh.safehouseTimer))}s to clear the heat`;
  }
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
  get combat() { return combat; },
  get heli() { return heli; },
  get radio() { return radio; },
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
    // THE CITY REMEMBERS: a switch to a DIFFERENT car while not
    // directly observed breaks the vehicle ID and drops the pursuit to
    // a search — checked BEFORE the new steal is recorded, while the
    // memory still holds the old vehicle.
    const prevIdentified = memory.identifiedVehicle;
    const switchObserved = state.wanted > 0 && prevIdentified && prevIdentified.id !== car.id
      ? isDirectlyObserved(memory, police, player.state, state, colliders)
      : false;
    applySteal(state, car);
    if (prevIdentified && prevIdentified.id !== car.id) {
      onVehicleSwitch(memory, car, switchObserved, police, state);
    }
    // The steal is a crime the city remembers: district heat rises,
    // the car becomes the identified vehicle, nearby pedestrians with
    // line of sight become witnesses. Witnesses are detected BEFORE
    // triggerFlee below, so the flee itself does not hide the crime —
    // a witness who is still fleeing when the report is due reports
    // nothing, but one who calmed down does.
    recordCrime(memory, {
      type: 'steal', x: car.x, z: car.z, heat: VEHICLE.stealHeat, vehicle: car,
    }, state, { peds: peds.peds, colliders });
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
  // ---- Combat: hitscan fire from the player (on foot) or the car
  // (drive-by). Aim is the camera forward / crosshair centre: the
  // player yaw + pitch. Targets are enemies, peds and cars; hitting a
  // ped/car is a crime (heat via the combat callbacks) and makes peds
  // flee. Returns the fire() result.
  fireWeapon() {
    const p = player.state;
    const car = this.playerCar;
    const origin = car
      ? { x: car.x, y: 1.4, z: car.z }
      : { x: p.x, y: p.y + 1.5, z: p.z };
    const yaw = car ? car.heading + Math.PI : p.yaw;
    const pitch = car ? 0 : p.pitch;
    const dir = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: -Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const targets = [];
    for (const e of combat.enemies) targets.push(e);
    for (const ped of peds.peds) {
      targets.push({ x: ped.x, z: ped.z, radius: 0.5, kind: 'ped', ref: ped });
    }
    for (const c of this.allCars()) {
      targets.push({ x: c.x, z: c.z, radius: 1.3, kind: 'car', ref: c, hp: c.hp ?? 100 });
    }
    const res = combatFire(combat, origin, dir, targets);
    if (res.fired) {
      for (const h of res.hits) {
        if (h.target.kind === 'ped') triggerFlee(peds, h.target.x, h.target.z);
        if (h.target.kind === 'car') {
          h.target.ref.hp = (h.target.ref.hp ?? 100) - h.damage;
        }
      }
      refreshDerived();
    } else if (res.reason === 'empty') {
      // Empty mag: start the reload instead of doing nothing.
      startReload(combat);
      refreshDerived();
    }
    return res;
  },
  reset() {
    const s = plazaSpawn(city);
    player.state.x = s.x; player.state.z = s.z; player.state.y = 0;
    player.state.vx = 0; player.state.vz = 0; player.state.vy = 0;
    player.state.yaw = s.yaw; player.state.pitch = 0.2;
    this.playerCar = null;
    buildSim();
    resetMemory(memory);
    resetHelicopter(heli);
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
      // pedestrian struck at speed (each ped counts once). The city
      // remembers it: district heat + witnesses, like any other crime.
      if (this.playerCar.collisions > hardHitsBefore && Math.abs(this.playerCar.speed) > POLICE.collisionSpeed) {
        addCollisionCrime(state);
        recordCrime(memory, {
          type: 'collision', x: this.playerCar.x, z: this.playerCar.z, heat: POLICE.collisionHeat,
        }, state, { peds: peds.peds, colliders });
      }
      if (Math.abs(this.playerCar.speed) > POLICE.collisionSpeed) {
        for (const ped of peds.peds) {
          if (!ped.hit && Math.hypot(ped.x - this.playerCar.x, ped.z - this.playerCar.z) < 1.8) {
            ped.hit = true;
            addCollisionCrime(state);
            recordCrime(memory, {
              type: 'collision', x: ped.x, z: ped.z, heat: POLICE.collisionHeat,
            }, state, { peds: peds.peds, colliders });
            triggerFlee(peds, ped.x, ped.z);
          }
        }
      }
    }
    const obstacles = this.playerCar ? [{ x: this.playerCar.x, z: this.playerCar.z }] : [];
    stepTraffic(traffic, dt, obstacles);
    stepPedestrians(peds, dt);
    // Patrol runs after traffic: pursuit, search, busted, heat decay.
    // THE CITY REMEMBERS: the patrol reads the memory — sightings
    // refresh the last-known-location, district heat can hold wanted
    // up, and the identified vehicle decides whether a sighting counts.
    const pc = this.playerCar;
    stepPolice(police, dt, {
      x: player.state.x, z: player.state.z,
      speed: pc ? pc.speed : Math.hypot(player.state.vx, player.state.vz),
      vx: pc ? Math.sin(pc.heading) * pc.speed : player.state.vx,
      vz: pc ? Math.cos(pc.heading) * pc.speed : player.state.vz,
      car: pc ?? null,
    }, state, memory);
    // Memory tick: district decay, due witness reports (which dispatch
    // investigations), and the safehouse stay. Garage escape is a
    // deliberate check, not a timer: driving into the garage unseen
    // breaks the pursuit on the spot.
    stepMemory(memory, dt, {
      police, heatState: state,
      player: { x: player.state.x, z: player.state.z },
      colliders,
    });
    if (state.wanted > 0) {
      tryGarageEscape(memory, police, { x: player.state.x, z: player.state.z }, state, colliders);
    }
    // Phase 6: the helicopter follows the player at wanted >= 3 and
    // its sightings refresh the memory last-known-location, so the
    // ground search stays on the trail. Air support — it never counts
    // toward the 4-unit ground cap (ensureUnits untouched).
    stepHelicopter(heli, dt, { x: player.state.x, z: player.state.z }, state.wanted, memory);
    state.clockMinutes += dt * WORLD.clockMinutesPerSecond;
    // Combat: spawn a mission's manifest guards once it is active
    // (Day 5A: manifest-driven, replaces the hardcoded M3 check).
    // Defeated guards stay in combat.enemies (DEFEATED), so the
    // length check never respawns a cleared floor.
    const guards = missionCtl?.manager.manifest?.guards;
    if (missionCtl && missionCtl.manager.status === 'active'
      && guards && combat.enemies.length === 0) {
      spawnGuards(combat, guards);
    }
    stepCombat(combat, dt, {
      player: { x: player.state.x, z: player.state.z },
      colliders,
      damagePlayer: (dmg) => { state.health = Math.max(0, state.health - dmg); },
    });
    // Mission manager ticks last: police state (busted / chase) is fresh.
    if (missionCtl) missionCtl.tick(dt);
    refreshDerived();
  },
};

// ---- Mission chain: JOB 1/N -> ... -> N/N, driven by the InkJS
// manager + the mission-chain state machine. N = CHAIN.length (Day 5A:
// the HUD count is dynamic — no hardcoded "/3" anywhere).
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
          job: `JOB ${n}/${CHAIN.length}`,
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
        const lastId = CHAIN[CHAIN.length - 1];
        state.mission = { job: `JOB ${CHAIN.length}/${CHAIN.length}`, title: MISSIONS[lastId].title, state: 'COMPLETED', objective: 'All jobs done — the city is yours.', done: CHAIN.length, total: CHAIN.length };
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
// Debug handle for headless verification (not a gameplay feature):
// world/mission/combat state, plus helpers to stage M3 and fire.
window.__cabo = {
  world, state,
  get memory() { return memory; },
  get combat() { return world.combat; },
  get heli() { return heli; },
  get radio() { return radio; },
  get radioPlayer() { return radioPlayer; },
  renderer,
  recovery,
  shadow: () => ({
    id: shadow.id, frame: shadowState.frame,
    updated: shadowState.updated, updateEvery: shadow.updateEvery,
  }),
  mission: () => missionCtl,
  fire: () => world.fireWeapon(),
  spawnGuards: () => spawnHarborGuards(world.combat),
  startMission: (id) => {
    const chain = missionCtl.chain;
    if (id && chain.state(id) === 'AVAILABLE') chain.start(id);
    return missionCtl.loadCurrent();
  },
};
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

// ---- Combat rendering (Day 3B): enemy meshes, tracer lines, muzzle
// flash. All state comes from the renderer-free combat module; this
// only paints it. Defeated enemies lie flat on the ground.
const enemyMeshes = new Map();
const tracerLines = [];
let muzzleSprite = null;

function syncEnemies() {
  if (!combat) return;
  const seen = new Set();
  for (const e of combat.enemies) {
    seen.add(e.id);
    let entry = enemyMeshes.get(e.id);
    if (!entry) {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.85, 4, 10), bodyMat);
      body.position.y = 1.0; body.castShadow = shadow.casters.enemyBody;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0xc98a5a }),
      );
      head.position.y = 1.95; head.castShadow = shadow.casters.enemyHead;
      const vest = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.5, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x8a2f22 }),
      );
      vest.position.y = 1.15;
      group.add(body, head, vest);
      scene.add(group);
      entry = { group, bodyMat };
      enemyMeshes.set(e.id, entry);
    }
    entry.group.position.set(e.x, 0, e.z);
    if (e.state === 'DEFEATED') {
      entry.group.rotation.set(Math.PI / 2, 0, e.heading);
      entry.group.position.y = 0.3;
    } else {
      entry.group.rotation.set(0, e.heading + Math.PI, 0);
      entry.group.position.y = 0;
    }
    // Hit flash: white-hot for a moment after taking damage.
    entry.bodyMat.color.setHex(e.flashTimer > 0 ? 0xffffff : 0x3a3f46);
    entry.group.visible = true;
  }
  for (const [id, entry] of enemyMeshes) {
    if (!seen.has(id)) entry.group.visible = false;
  }
  // Tracers: one stretched box per live tracer (a Line stays 1 px).
  const live = combat.tracers;
  while (tracerLines.length < live.length) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    scene.add(line);
    tracerLines.push(line);
  }
  live.forEach((t, i) => {
    const line = tracerLines[i];
    line.visible = true;
    line.material.opacity = Math.max(0, (t.life / t.max)) * 0.9;
    line.position.set((t.from.x + t.to.x) / 2, (t.from.y + t.to.y) / 2, (t.from.z + t.to.z) / 2);
    line.lookAt(t.to.x, t.to.y, t.to.z);
    line.scale.set(1, 1, Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y, t.to.z - t.from.z));
  });
  for (let i = live.length; i < tracerLines.length; i++) tracerLines[i].visible = false;
  // Muzzle flash: a 0.30 m ball at the gun for 60 ms, pushed 1.8 m
  // out so it clears the player's head and the framed guard.
  if (!muzzleSprite) {
    muzzleSprite = new THREE.Mesh(
      new THREE.SphereGeometry(0.30, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0 }),
    );
    scene.add(muzzleSprite);
  }
  if (combat.muzzleTimer > 0) {
    const p = player.state;
    const car = world.playerCar;
    const yaw = car ? car.heading + Math.PI : p.yaw;
    const ox = car ? car.x : p.x, oz = car ? car.z : p.z;
    muzzleSprite.position.set(
      ox - Math.sin(yaw) * 1.8, (car ? 1.4 : p.y + 1.5), oz - Math.cos(yaw) * 1.8,
    );
    muzzleSprite.visible = true;
  } else {
    muzzleSprite.visible = false;
  }
}

// Chase-camera follow state (Day 4A): the smoothed pose updateCamera
// eases toward, and the eased yaw that swings behind the car on
// turns. Both reset on a staged shot so the first painted frame is
// exactly the tuned pose, not a blend from wherever the camera was.
let camSmooth = { ready: false, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
let camYaw = null;

// Day 4F (config C): per-draw frame counter for the throttled
// shadow-map update — `updated` is true on the draws that re-render
// the shadow map, false on the draws that reuse it.
const shadowState = { frame: 0, updated: true };

// ---- Helicopter rendering (Phase 6): one group, built once —
// dark-navy body + white stripe, tail boom, spinning main rotor,
// and a translucent spotlight cone straight down to the ground
// below the heli. NO light, NO shadow casting: the cone is the
// spotlight, so the heli costs ~8 draws and zero shadow passes.
let heliGroup = null;
let heliRotor = null;
let heliCone = null;

function syncHelicopter() {
  if (!heliGroup) {
    heliGroup = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 3.4), bodyMat);
    body.position.y = 0;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.54, 0.35, 3.0),
      new THREE.MeshLambertMaterial({ color: 0x1c2f4a }),
    );
    stripe.position.y = 0.1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 2.8), bodyMat);
    tail.position.set(0, 0.2, -2.9);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.6), bodyMat);
    fin.position.set(0, 0.6, -4.1);
    heliRotor = new THREE.Group();
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    // Day 5D: rotor disc 5.2 -> 6.4 m, blades widened 0.32 -> 0.45 —
    // the staged heli read as a ~20 px speck partly behind a palm;
    // the disc is the part that reads at 768x480.
    const blade1 = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.06, 0.45), bladeMat);
    const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 6.4), bladeMat);
    heliRotor.add(blade1, blade2);
    heliRotor.position.y = 0.85;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0 }),
    );
    lamp.position.y = -0.7;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff2c0, transparent: true, opacity: 0.15,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    // ConeGeometry apex is at +h/2: flip it so the apex sits at the
    // heli and the base pools on the ground 26 m below. The cone is
    // re-scaled per frame (see syncHelicopter) so a staged low hover
    // still grounds its spotlight exactly on the street.
    cone.rotation.x = Math.PI;
    cone.position.y = -13;
    cone.name = 'spotlight-cone';
    heliCone = cone;
    heliGroup.add(body, stripe, tail, fin, heliRotor, lamp, cone);
    scene.add(heliGroup);
  }
  heliGroup.visible = heli.active;
  if (!heli.active) return;
  heliGroup.position.set(heli.x, heli.y, heli.z);
  heliGroup.rotation.y = heli.heading;
  heliRotor.rotation.y = heli.rotor;
  // Spotlight cone length = hover altitude: apex at the heli, base
  // exactly on the ground (26 m geometry scaled to heli.y).
  if (heliCone) {
    heliCone.scale.y = heli.y / 26;
    heliCone.position.y = -heli.y / 2;
  }
}

function draw(screen, shotCam) {
  // Context lost: never render into a dead GL context.
  if (recovery.paused) return;
  shadowState.frame += 1;
  if (shadow.updateEvery > 1) {
    // Update on frames 1, 4, 7, … (NOT 2, 5, 8): the shadow map must
    // exist before the FIRST main pass ever runs. With autoUpdate off,
    // a first frame whose main pass runs against a null shadow map
    // poisons the renderer on this three.js build — the Lambert
    // objects stop presenting entirely (sky only, persistent GL
    // error 1282) and flipping autoUpdate back on does NOT recover
    // the page (verified by probe, 18 Nov). Updating on frame 1 means
    // every main pass samples a real map; later frames only ever
    // reuse a valid one. In shot mode the screenshot frame (paint 2)
    // reuses paint 1's map — nothing moves between the two paints,
    // so the image is exact.
    shadowState.updated = shadowState.frame % shadow.updateEvery === 1;
    renderer.shadowMap.needsUpdate = shadowState.updated;
  }
  rig.sync(world.allCars(), peds.peds, world.elapsed);
  syncEnemies();
  syncHelicopter();
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
    // Collision-aware pull-in: if a building sits between the car and
    // the desired camera spot, bring the camera in just short of it
    // instead of clipping through the wall. On open road the fraction
    // is 1 and the shot is exactly the tuned drive pose.
    const desired = driveCameraPose(car);
    const clear = clearanceFraction(
      { x: car.x, z: car.z },
      { x: desired.position.x, z: desired.position.z },
      colliders, CAMERA.minDistance,
    );
    // Yaw easing: the camera swings behind the car on turns instead
    // of snapping to the new heading in one frame.
    const targetYaw = car.heading + Math.PI;
    camYaw = camYaw === null ? targetYaw : approachAngle(camYaw, targetYaw, CAMERA.yawStep);
    updateCamera(camera, {
      x: car.x, y: 0, z: car.z,
      yaw: camYaw, pitch: CAMERA.drivePitch,
    }, shotCam, { distance: CAMERA.driveDistance * clear, height: CAMERA.driveHeight, lookHeight: CAMERA.driveLookHeight, smooth: camSmooth });
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
  // Snap the chase camera: the first painted frame must be the exact
  // tuned pose, not an ease-in from a previous screen.
  camSmooth.ready = false;
  camYaw = null;
  let painted = 0;
  function paint() {
    // Context lost mid-shot: wait for recovery, don't count a dead paint.
    if (recovery.paused) { requestAnimationFrame(paint); return; }
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
  // Edge detection for fire / weapon / reload keys (input.has is level).
  let prevFire = false, prevQ = false, prevR = false, prevD1 = false, prevD2 = false, prevD3 = false;
  // Radio: gesture-only AudioContext init (once), V cycles stations.
  if (radioPlayer) {
    const initAudio = () => radioPlayer.init();
    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
  }

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
    // Context lost: freeze everything — no sim steps, no renders, no
    // time advance — but keep the rAF chain alive so resume needs no
    // re-arm. Resetting `last` here means the post-restore frame sees
    // ~0 elapsed instead of the whole outage (MAX_FRAME would cap it
    // anyway, but a frozen clock must not leak into the accumulator).
    if (recovery.paused) {
      last = now;
      requestAnimationFrame(frame);
      return;
    }
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
      // Combat keys (KeyF fire, KeyQ cycle weapon, KeyR reload, Digit1/2/3
      // select weapon when no mission choice is showing). KeyR also
      // retries a failed mission — the retry wins while failed.
      const hasFire = input.has('KeyF');
      if (hasFire && !prevFire) world.fireWeapon();
      prevFire = hasFire;
      const hasQ = input.has('KeyQ');
      if (hasQ && !prevQ) cycleWeapon(combat);
      prevQ = hasQ;
      const hasR = input.has('KeyR');
      if (hasR && !prevR && missionCtl.manager.status !== 'failed') startReload(combat);
      prevR = hasR;
      if (!missionCtl.hasChoices()) {
        const hasD1 = input.has('Digit1');
        if (hasD1 && !prevD1) switchWeapon(combat, 'pistol');
        prevD1 = hasD1;
        const hasD2 = input.has('Digit2');
        if (hasD2 && !prevD2) switchWeapon(combat, 'shotgun');
        prevD2 = hasD2;
        const hasD3 = input.has('Digit3');
        if (hasD3 && !prevD3) switchWeapon(combat, 'rifle');
        prevD3 = hasD3;
      }
      // Radio (Phase 6): V cycles OFF -> LUNA -> BRISA -> FARO -> OFF.
      // consume() latches the press (see input.js), so a tap is never
      // lost between slow frames — input.has() level-reads can miss a
      // tap entirely under SwiftShader (verified: one press in four
      // missed before this change). The player starts/stops with the
      // station; retune re-anchors the scheduler on a mid-play change.
      if (input.consume(ACTION_RADIO)) {
        cycleRadio(radio);
        if (radioPlayer) {
          const station = radio.stationIndex >= 0;
          if (station && !radioPlayer.getStats().playing) radioPlayer.start();
          else if (station) radioPlayer.retune();
          else radioPlayer.stop();
        }
        refreshDerived();
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
    if (recovery.paused) return;
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
