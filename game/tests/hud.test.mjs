// Cabo Luna — HUD tests (Day 4B, fresh).
// hud.js runs against the real DOM in the browser; here a minimal stub
// stands in for document so the HUD logic (patrol line, crosshair,
// dialogue, mission split, interact prompt) is testable in node.
// Run: node --test game/tests/hud.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/city.js';

const CITY = generateCity(1);

// --- Minimal DOM stub -------------------------------------------------
function makeClassList() {
  const set = new Set();
  return {
    toggle(name, force) {
      if (force === undefined) { if (set.has(name)) set.delete(name); else set.add(name); }
      else if (force) set.add(name); else set.delete(name);
      return set.has(name);
    },
    contains: (name) => set.has(name),
    add: (name) => set.add(name),
    remove: (name) => set.delete(name),
  };
}

function makeCtx() {
  // Every canvas method is a no-op; property writes are allowed.
  return new Proxy({}, { get: (t, p) => (p in t ? t[p] : (() => {})), set: (t, p, v) => { t[p] = v; return true; } });
}

function makeEl() {
  return {
    textContent: '', innerHTML: '', hidden: false,
    style: {}, classList: makeClassList(),
    addEventListener: () => {},
    getContext: () => makeCtx(),
  };
}

const IDS = ['hud-mission', 'hud-objective', 'hud-wanted', 'hud-money', 'hud-clock',
  'hud-district', 'hud-street', 'hud-health-fill', 'hud-health-text', 'hud-speed',
  'hud-car', 'hud-mode', 'hud-banner', 'hud-minimap', 'hud-hint', 'hud-patrol',
  'hud-dialogue', 'hud-dialogue-speaker', 'hud-dialogue-text', 'hud-choice-0',
  'hud-choice-1', 'hud-crosshair', 'hud-interact', 'hud-ammo-weapon',
  'hud-ammo-count', 'hud-ammo-reload'];

let els;
let createHud;

before(async () => {
  ({ createHud } = await import('../src/hud.js'));
});

function mount() {
  els = Object.fromEntries(IDS.map((id) => [id, makeEl()]));
  globalThis.document = { getElementById: (id) => els[id] ?? makeEl() };
  return createHud(CITY);
}

function baseState(over = {}) {
  return {
    player: { x: 0, z: 0, yaw: 0 },
    money: 250, wanted: 0, clockText: 'Day 1 — 09:24', health: 100,
    speedKmh: 0, onFoot: true, carName: '', interact: '',
    combat: { name: 'Luna-9', mag: 12, reserve: 48, reloading: false, hitMarker: false },
    hint: '', banner: 'Puerto Luna',
    mission: { job: 'JOB 1/3', title: 'A Delivery Gone Wrong', state: 'ACTIVE', done: 2, total: 5, objective: 'Deliver the parcel to Mercado Norte' },
    dialogue: null, police: [], cars: [], playerCar: null, flashTime: 0,
    ...over,
  };
}

test('patrol line: shared state stated once, all units + distances present', () => {
  const hud = mount();
  hud.update(baseState({
    wanted: 3,
    police: [
      { name: 'Unit Luna-1', dist: 13, state: 'CHASE' },
      { name: 'Unit Luna-2', dist: 5, state: 'CHASE' },
      { name: 'Unit Luna-3', dist: 19, state: 'CHASE' },
    ],
  }));
  const t = els['hud-patrol'].textContent;
  assert.equal(els['hud-patrol'].hidden, false);
  assert.match(t, /Patrol 3 · CHASE/);
  assert.match(t, /Luna-1\s13m/);
  assert.match(t, /Luna-2\s5m/);
  assert.match(t, /Luna-3\s19m/);
  // State appears once, not once per unit (the old format repeated it
  // three times and the line clipped at the panel edge).
  assert.equal(t.split('CHASE').length - 1, 1);
});

test('patrol line: mixed states keep each unit state; hidden when not wanted', () => {
  const hud = mount();
  hud.update(baseState({
    wanted: 2,
    police: [
      { name: 'Unit Luna-1', dist: 174, state: 'PATROL' },
      { name: 'Unit Luna-2', dist: 78, state: 'SEARCH' },
    ],
  }));
  const t = els['hud-patrol'].textContent;
  assert.match(t, /Luna-1\s174m\sPATROL/);
  assert.match(t, /Luna-2\s78m\sSEARCH/);
  hud.update(baseState({ wanted: 0, police: [] }));
  assert.equal(els['hud-patrol'].hidden, true);
});

test('crosshair: hidden while driving, shown on foot with weapon ready', () => {
  const hud = mount();
  hud.update(baseState({ onFoot: false, speedKmh: 103, carName: 'BRISA GT' }));
  assert.equal(els['hud-crosshair'].hidden, true);
  hud.update(baseState({ onFoot: true }));
  assert.equal(els['hud-crosshair'].hidden, false);
});

test('crosshair: hit marker only shows while the crosshair is visible', () => {
  const hud = mount();
  hud.update(baseState({
    onFoot: false,
    combat: { name: 'Luna-9', mag: 11, reserve: 48, reloading: false, hitMarker: true },
  }));
  assert.equal(els['hud-crosshair'].classList.contains('hit'), false);
  hud.update(baseState({
    onFoot: true,
    combat: { name: 'Luna-9', mag: 11, reserve: 48, reloading: false, hitMarker: true },
  }));
  assert.equal(els['hud-crosshair'].classList.contains('hit'), true);
});

test('mission card: title line separate from objective line', () => {
  const hud = mount();
  hud.update(baseState());
  assert.match(els['hud-mission'].textContent, /JOB 1\/3 — A Delivery Gone Wrong · ACTIVE · 2\/5/);
  assert.equal(els['hud-objective'].textContent, 'Deliver the parcel to Mercado Norte');
  assert.doesNotMatch(els['hud-mission'].textContent, /Mercado Norte/);
});

test('dialogue: hidden without dialogue, shown with speaker + text', () => {
  const hud = mount();
  hud.update(baseState({ dialogue: null }));
  assert.equal(els['hud-dialogue'].hidden, true);
  hud.update(baseState({
    dialogue: { speaker: 'Yara', text: 'Drive it to the Mercado Norte drop.', choices: [] },
  }));
  assert.equal(els['hud-dialogue'].hidden, false);
  assert.equal(els['hud-dialogue-speaker'].textContent, 'YARA');
  assert.match(els['hud-dialogue-text'].textContent, /Mercado Norte/);
});

test('interact prompt: only while an interaction is available', () => {
  const hud = mount();
  hud.update(baseState({ interact: '' }));
  assert.equal(els['hud-interact'].hidden, true);
  hud.update(baseState({ onFoot: true, interact: 'E — STEAL BRISA GT' }));
  assert.equal(els['hud-interact'].hidden, false);
  assert.equal(els['hud-interact'].textContent, 'E — STEAL BRISA GT');
  assert.equal(els['hud-crosshair'].classList.contains('interact'), true);
});

test('car name + health: driving shows car name, health carries HP', () => {
  const hud = mount();
  hud.update(baseState({ onFoot: false, speedKmh: 103, carName: 'BRISA GT', health: 87 }));
  assert.equal(els['hud-car'].textContent, 'BRISA GT');
  assert.equal(els['hud-speed'].textContent, '103');
  assert.equal(els['hud-health-text'].textContent, '87 HP');
  hud.update(baseState({ onFoot: true, carName: '' }));
  assert.equal(els['hud-car'].textContent, '');
});
