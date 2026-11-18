// Cabo Luna — boot and the one loop.
// Input is read every frame, the world advances in fixed 1/60 s steps, and
// the renderer paints what is there. Screens: title -> play -> paused ->
// game over. ?seed=N fixes the city. ?shot=start|play|chase|end (with
// &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import * as THREE from 'three';
import { STEP, SEED_DEFAULT, WORLD } from './config.js';
import { generateCity, districtAtPoint } from './city.js';
import { createPlayer, plazaSpawn } from './player.js';
import { createRenderer, buildScene, createPlayerMesh, updateCamera } from './render.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_JUMP } from './input.js';
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
const renderer = createRenderer(canvas);
const { scene } = buildScene(city);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
const playerMesh = createPlayerMesh(scene);
const hud = createHud(city);

const saved = loadGame();
const spawn = saved && saved.seed === seed ? { x: saved.x, z: saved.z, yaw: Math.PI * 0.75 } : plazaSpawn(city);
const player = createPlayer(city, spawn);

const state = {
  seed,
  money: saved && saved.seed === seed ? saved.money : WORLD.moneyStart,
  health: WORLD.healthMax,
  wanted: 0,
  day: saved && saved.seed === seed ? saved.day : WORLD.dayStart,
  clockMinutes: WORLD.clockStartMinutes,
  mission: 'Day 0 — Explore Cabo Luna. Learn the streets of Luna Vieja.',
  banner: 'Plaza del Reloj',
  district: 'Luna Vieja',
  speedKmh: 0,
  onFoot: true,
  clockText: 'Day 1 — 09:24',
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
  state.speedKmh = player.speed() * 3.6;
  state.clockText = clockText();
}

// The world object the shot stager drives: reset + fixed-step advance.
const world = {
  city,
  player,
  state,
  reset() {
    const s = plazaSpawn(city);
    player.state.x = s.x; player.state.z = s.z; player.state.y = 0;
    player.state.vx = 0; player.state.vz = 0; player.state.vy = 0;
    player.state.yaw = s.yaw; player.state.pitch = 0.2;
    state.money = WORLD.moneyStart;
    state.health = WORLD.healthMax;
    state.wanted = 0;
    state.clockMinutes = WORLD.clockStartMinutes;
    refreshDerived();
  },
  step(dt, move, sprint, jump) {
    player.step(dt, move, sprint, jump);
    state.clockMinutes += dt * WORLD.clockMinutesPerSecond;
    refreshDerived();
  },
};

function draw(screen, shotCam) {
  playerMesh.position.set(state.player.x, state.player.y, state.player.z);
  playerMesh.rotation.y = state.player.yaw + Math.PI;
  updateCamera(camera, state.player, shotCam ?? null);
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
    announce('Playing. Explore Cabo Luna — WASD to move, Shift to sprint, drag to look.');
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
        world.step(STEP, input.move(), input.sprinting(), input.consume(ACTION_JUMP));
        if (state.health <= 0) { endGame(); break; }
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
