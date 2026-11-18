// Cabo Luna — mission system tests (Day 3A ELITE redirect, fresh).
// Mock adapter drives the real MissionManager + real compiled stories;
// the chain module and save.js are tested directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Story, Compiler } from '../vendor/ink-full.mjs';
import { createMissionManager } from '../src/missions.js';
import { MISSIONS, resolveManifest, CHAIN } from '../src/mission-data.js';
import { createMissionChain } from '../src/mission-chain.js';
import { createCaboAdapter, CRIME_HEAT } from '../src/mission-adapter.js';
import { saveGame, loadGame } from '../src/save.js';
import { MISSION_01_JSON } from '../src/stories/mission-01-delivery-gone-wrong.js';
import { MISSION_02_JSON } from '../src/stories/mission-02-wrong-place.js';
import { MISSION_03_JSON } from '../src/stories/mission-03-harbor-silence.js';
import { generateCity } from '../src/city.js';

const CITY = generateCity(1);
const JSONS = {
  'mission-01-delivery-gone-wrong': MISSION_01_JSON,
  'mission-02-wrong-place': MISSION_02_JSON,
  'mission-03-harbor-silence': MISSION_03_JSON,
};

// Mock adapter: scriptable player / wanted / chase / busted / kills.
function mockAdapter() {
  const a = {
    player: { x: -20, z: 90, heading: 0, speed: 0, onFoot: true },
    wanted: { level: 0, heat: 0 },
    money: 250,
    busted: false,
    chased: false,
    combatKills: 0,
    objectiveText: '',
    crimes: [],
    getPlayer() { return { ...this.player }; },
    getWanted() { return { ...this.wanted }; },
    getMoney() { return this.money; },
    addMoney(n) { this.money += n; },
    addCrime(type) {
      this.crimes.push(type);
      this.wanted.heat += CRIME_HEAT[type] ?? 10;
      this.wanted.level = this.wanted.heat <= 0 ? 0 : Math.min(5, Math.ceil(this.wanted.heat / 20));
    },
    isBusted() { return this.busted; },
    isBeingChased() { return this.chased; },
    getCombatKills() { return this.combatKills; },
    setObjectiveText(t) { this.objectiveText = t; },
  };
  return a;
}

function managerFor(id, adapter) {
  const m = createMissionManager({ Story, Compiler }, adapter);
  m.loadCompiled(id, resolveManifest(id, CITY), JSONS[id]);
  return m;
}

function stepUntil(m, adapter, cond, maxSteps = 25000) {
  for (let i = 0; i < maxSteps; i++) {
    const snap = m.update(1 / 60);
    if (cond(snap)) return snap;
  }
  throw new Error('stepUntil: condition never met');
}

// Simulate the game's steal: stealing a car is +25 heat (2 stars).
function simulateSteal(a) { a.addCrime('theft'); }

// ---- M1: A Delivery Gone Wrong ------------------------------------------
test('M1 start meets Yara at the Plaza (player spawns there)', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  const snap = m.start();
  assert.equal(snap.status, 'active');
  assert.equal(snap.stage, 'meet_yara');
  assert.equal(a.objectiveText, 'Meet Yara at the Plaza del Reloj');
  assert.ok(snap.lines.some((l) => l.text.includes('Yara')));
  const after = m.update(1 / 60); // standing in the plaza completes it
  assert.deepEqual(after.objectivesDone, ['meet_yara']);
  assert.equal(after.stage, 'get_car');
});

test('M1 open-parcel branch pays $200 and draws theft heat', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  m.start();
  m.update(1 / 60); // meet_yara
  a.player.onFoot = false;
  m.update(1 / 60); // get_car
  simulateSteal(a); // the stolen car: +25 heat, wanted 2
  a.player.x = 6; a.player.z = -150; // Mercado Norte drop
  m.update(1 / 60); // deliver_parcel
  assert.equal(m.choices.length, 2);
  m.choose(0); // open the parcel
  assert.equal(m.getVariable('parcel_open'), 'open');
  assert.ok(a.crimes.includes('theft'));
  assert.equal(a.wanted.level, 3); // 25 steal + 25 open = 50 heat
  assert.equal(m.stage, 'lose_tail');
});

test('M1 scripted end-to-end (open parcel) pays $200', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  m.start();
  m.update(1 / 60); // meet_yara
  a.player.onFoot = false;
  m.update(1 / 60); // get_car
  simulateSteal(a);
  a.player.x = 6; a.player.z = -150;
  m.update(1 / 60); // deliver_parcel
  m.choose(0); // open
  a.chased = true;
  for (let i = 0; i < 60 * 4; i++) m.update(1 / 60); // chased: timer held
  assert.equal(m.stage, 'lose_tail');
  a.chased = false;
  stepUntil(m, a, (s) => s.objectivesDone.includes('lose_tail'), 60 * 10);
  assert.equal(m.stage, 'wanted_clear');
  a.wanted.level = 0; a.wanted.heat = 0; // heat dies down
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 200);
  assert.equal(a.money, 450);
  assert.ok(m.checkpoints.length >= 4);
});

test('M1 sealed branch pays clean $150', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  m.start();
  m.update(1 / 60);
  a.player.onFoot = false;
  m.update(1 / 60);
  simulateSteal(a);
  a.player.x = 6; a.player.z = -150;
  m.update(1 / 60);
  m.choose(1); // deliver sealed
  assert.equal(m.getVariable('parcel_open'), 'sealed');
  assert.equal(a.wanted.level, 2); // only the steal heat
  a.chased = false;
  stepUntil(m, a, (s) => s.objectivesDone.includes('lose_tail'), 60 * 10);
  a.wanted.level = 0; a.wanted.heat = 0;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 150);
  assert.equal(a.money, 400);
});

test('M1 timeout fails after 240s', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  m.start();
  const snap = stepUntil(m, a, (s) => s.status === 'failed', 25000);
  assert.equal(snap.failReason, 'timeout');
  assert.ok(m.elapsed > 240);
});

test('M1 busted fails the mission', () => {
  const a = mockAdapter();
  const m = managerFor('mission-01-delivery-gone-wrong', a);
  m.start();
  a.busted = true;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'failed');
  assert.equal(snap.failReason, 'busted');
});

// ---- M2: The Wrong Place --------------------------------------------------
test('M2 avenue branch pays $300, drop is Torre Alta', () => {
  const a = mockAdapter();
  const m = managerFor('mission-02-wrong-place', a);
  m.start();
  assert.equal(m.stage, 'steal_evidence_car');
  a.player.onFoot = false;
  m.update(1 / 60); // steal the grey Solano
  simulateSteal(a);
  a.player.x = -46; a.player.z = -46; // quiet spot, Luna Vieja
  m.update(1 / 60);
  assert.equal(m.stage, 'inspect_evidence');
  stepUntil(m, a, (s) => s.objectivesDone.includes('inspect_evidence'), 60 * 5);
  assert.equal(m.stage, 'evade_patrol');
  a.chased = true;
  for (let i = 0; i < 60 * 3; i++) m.update(1 / 60);
  a.chased = false;
  stepUntil(m, a, (s) => s.objectivesDone.includes('evade_patrol'), 60 * 12);
  assert.equal(m.choices.length, 2);
  m.choose(0); // main avenue
  assert.equal(m.getVariable('route'), 'avenue');
  const drop = m.manifest.objectives.find((o) => o.id === 'deliver_evidence');
  assert.deepEqual([drop.x, drop.z], [58, 6]); // Torre Alta
  a.player.x = 58; a.player.z = 6;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 300);
  assert.equal(a.money, 550);
});

test('M2 back-streets branch drops in Luna Vieja', () => {
  const a = mockAdapter();
  const m = managerFor('mission-02-wrong-place', a);
  m.start();
  a.player.onFoot = false;
  m.update(1 / 60);
  simulateSteal(a);
  a.player.x = -46; a.player.z = -46;
  m.update(1 / 60);
  stepUntil(m, a, (s) => s.objectivesDone.includes('inspect_evidence'), 60 * 5);
  a.chased = false;
  stepUntil(m, a, (s) => s.objectivesDone.includes('evade_patrol'), 60 * 12);
  m.choose(1); // back streets
  const drop = m.manifest.objectives.find((o) => o.id === 'deliver_evidence');
  assert.deepEqual([drop.x, drop.z], [-46, -46]);
  a.player.x = -46; a.player.z = -46;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 300);
});

// ---- M3: Harbor Silence + defeat seam --------------------------------------
test('M3 defeat seam: 0 kills never completes, simulated 2 kills completes', () => {
  const a = mockAdapter();
  const m = managerFor('mission-03-harbor-silence', a);
  m.start();
  a.player.x = -150; a.player.z = 110; // Puerto Luna warehouse
  m.update(1 / 60);
  assert.equal(m.stage, 'defeat_guards');
  for (let i = 0; i < 60 * 5; i++) m.update(1 / 60);
  assert.equal(m.stage, 'defeat_guards'); // no combat system yet: stuck
  a.combatKills = 1;
  m.update(1 / 60);
  assert.equal(m.stage, 'defeat_guards'); // 1 of 2
  a.combatKills = 2;
  const snap = m.update(1 / 60);
  assert.deepEqual(snap.objectivesDone, ['infiltrate_harbor', 'defeat_guards']);
  assert.equal(snap.stage, 'reach_stash');
});

test('M3 non-combat flow (with mocked kills) pays $400', () => {
  const a = mockAdapter();
  const m = managerFor('mission-03-harbor-silence', a);
  m.start();
  a.player.x = -150; a.player.z = 110;
  m.update(1 / 60);
  a.combatKills = 2;
  m.update(1 / 60);
  a.player.x = -150; a.player.z = 162; // stash cage
  m.update(1 / 60);
  assert.equal(m.stage, 'retrieve_package');
  stepUntil(m, a, (s) => s.objectivesDone.includes('retrieve_package'), 60 * 5);
  assert.equal(m.stage, 'escape_safehouse');
  a.player.x = 162; a.player.z = -46; // Colina Verde safehouse
  m.update(1 / 60);
  assert.equal(m.stage, 'wanted_clear');
  a.wanted.level = 2; a.wanted.heat = 40; // heat from the warehouse fight
  m.update(1 / 60);
  assert.equal(m.stage, 'wanted_clear'); // still hot
  a.wanted.level = 0; a.wanted.heat = 0;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 400);
  assert.equal(a.money, 650);
});

// ---- Mission chain states ---------------------------------------------------
test('chain starts M1 AVAILABLE, M2/M3 LOCKED; start requires AVAILABLE', () => {
  const c = createMissionChain(CHAIN);
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'AVAILABLE');
  assert.equal(c.state('mission-02-wrong-place'), 'LOCKED');
  assert.equal(c.state('mission-03-harbor-silence'), 'LOCKED');
  assert.equal(c.current(), 'mission-01-delivery-gone-wrong');
  assert.throws(() => c.start('mission-02-wrong-place'), /need AVAILABLE/);
  assert.throws(() => c.complete('mission-01-delivery-gone-wrong'), /need ACTIVE/);
  c.start('mission-01-delivery-gone-wrong');
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'ACTIVE');
  assert.equal(c.current(), 'mission-01-delivery-gone-wrong');
});

test('chain complete unlocks the next mission; full run to all COMPLETED', () => {
  const c = createMissionChain(CHAIN);
  c.start('mission-01-delivery-gone-wrong');
  const next1 = c.complete('mission-01-delivery-gone-wrong');
  assert.equal(next1, 'mission-02-wrong-place');
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'COMPLETED');
  assert.equal(c.state('mission-02-wrong-place'), 'AVAILABLE');
  assert.deepEqual(c.completedIds(), ['mission-01-delivery-gone-wrong']);
  c.start('mission-02-wrong-place');
  c.complete('mission-02-wrong-place');
  assert.equal(c.state('mission-03-harbor-silence'), 'AVAILABLE');
  c.start('mission-03-harbor-silence');
  const next3 = c.complete('mission-03-harbor-silence');
  assert.equal(next3, null);
  assert.equal(c.current(), null);
  assert.deepEqual(c.completedIds(), [...CHAIN]);
});

test('chain fail then retry returns to AVAILABLE', () => {
  const c = createMissionChain(CHAIN);
  c.start('mission-01-delivery-gone-wrong');
  c.fail('mission-01-delivery-gone-wrong');
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'FAILED');
  assert.equal(c.current(), null); // nothing available while failed
  assert.throws(() => c.retry('mission-02-wrong-place'), /need FAILED/);
  c.retry('mission-01-delivery-gone-wrong');
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'AVAILABLE');
  assert.equal(c.current(), 'mission-01-delivery-gone-wrong');
});

test('chain restart works from ACTIVE and FAILED', () => {
  const c = createMissionChain(CHAIN);
  assert.throws(() => c.restart('mission-01-delivery-gone-wrong'), /need ACTIVE or FAILED/);
  c.start('mission-01-delivery-gone-wrong');
  c.restart('mission-01-delivery-gone-wrong');
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'AVAILABLE');
});

test('chain restore: saved ACTIVE resumes as AVAILABLE, COMPLETED stays', () => {
  const c = createMissionChain(CHAIN, {
    'mission-01-delivery-gone-wrong': 'COMPLETED',
    'mission-02-wrong-place': 'ACTIVE',
    'mission-03-harbor-silence': 'LOCKED',
  });
  assert.equal(c.state('mission-01-delivery-gone-wrong'), 'COMPLETED');
  assert.equal(c.state('mission-02-wrong-place'), 'AVAILABLE');
  assert.equal(c.current(), 'mission-02-wrong-place');
  const round = createMissionChain(CHAIN, c.toJSON());
  assert.deepEqual(round.toJSON(), c.toJSON());
  assert.throws(() => createMissionChain(CHAIN, { 'mission-01-delivery-gone-wrong': 'NOPE' }), /bad saved state/);
});

// ---- Save/load round-trip ----------------------------------------------------
test('save/load round-trip persists mission progress', () => {
  const store = new Map();
  globalThis.window = { localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
  } };
  try {
    const chain = createMissionChain(CHAIN);
    chain.start('mission-01-delivery-gone-wrong');
    chain.complete('mission-01-delivery-gone-wrong');
    chain.start('mission-02-wrong-place');
    const state = {
      money: 450, player: { x: -46, z: -46 }, district: 'Luna Vieja',
      seed: 1, day: 1,
      missionSave: {
        completedMissions: chain.completedIds(),
        currentMissionId: chain.current(),
        missionStates: chain.toJSON(),
      },
    };
    assert.equal(saveGame(state), true);
    const loaded = loadGame();
    assert.equal(loaded.money, 450);
    assert.deepEqual(loaded.completedMissions, ['mission-01-delivery-gone-wrong']);
    assert.equal(loaded.currentMissionId, 'mission-02-wrong-place');
    // Restoring the chain from the save: M1 COMPLETED, M2 AVAILABLE.
    const restored = createMissionChain(CHAIN, loaded.missionStates);
    assert.equal(restored.state('mission-01-delivery-gone-wrong'), 'COMPLETED');
    assert.equal(restored.state('mission-02-wrong-place'), 'AVAILABLE');
    assert.equal(restored.current(), 'mission-02-wrong-place');
  } finally {
    delete globalThis.window;
  }
});

// ---- Manifest / adapter -------------------------------------------------------
test('resolveManifest turns road indices into city coordinates', () => {
  const m1 = resolveManifest('mission-01-delivery-gone-wrong', CITY);
  assert.deepEqual([m1.objectives[0].x, m1.objectives[0].z], [-20, 84]); // Plaza
  const drop = m1.objectives.find((o) => o.id === 'deliver_parcel');
  assert.deepEqual([drop.x, drop.z], [6, -150]); // Mercado Norte
  // Every drivable reach target sits on a road line (on-foot plaza /
  // harbor targets use explicit coordinates and are skipped).
  for (const [id, manifest] of Object.entries(MISSIONS)) {
    const r = resolveManifest(id, CITY);
    for (const o of r.objectives) {
      if (o.kind !== 'reach' || o.onFoot) continue;
      assert.ok(CITY.roadLines.includes(o.x) || CITY.roadLines.includes(o.z), `${id}/${o.id} off-road`);
    }
    for (const byValue of Object.values(r.branches ?? {})) {
      for (const overrides of Object.values(byValue)) {
        for (const o of Object.values(overrides)) {
          assert.ok(CITY.roadLines.includes(o.x) || CITY.roadLines.includes(o.z), `${id} branch off-road`);
        }
      }
    }
  }
});

test('chain has three missions in order', () => {
  assert.deepEqual(CHAIN, ['mission-01-delivery-gone-wrong', 'mission-02-wrong-place', 'mission-03-harbor-silence']);
  for (const id of CHAIN) assert.ok(MISSIONS[id], id);
});

test('Cabo adapter reads the world, applies crimes, combat kills are 0 (3B seam)', () => {
  const world = {
    state: { money: 250, wanted: 0, crimeHeat: 0, onFoot: true },
    player: { state: { x: 10, z: 20, yaw: 1, vx: 0, vz: 0 } },
    playerCar: null,
    police: { busted: false, units: [{ state: 'PATROL' }] },
  };
  const adapter = createCaboAdapter(world, () => {});
  assert.deepEqual(adapter.getPlayer(), { x: 10, z: 20, heading: 1, speed: 0, onFoot: true });
  assert.deepEqual(adapter.getWanted(), { level: 0, heat: 0 });
  adapter.addCrime('speeding');
  assert.deepEqual(adapter.getWanted(), { level: 1, heat: 10 });
  adapter.addCrime('theft');
  assert.deepEqual(adapter.getWanted(), { level: 2, heat: 35 });
  assert.equal(adapter.isBeingChased(), false);
  world.police.units[0].state = 'CHASE';
  assert.equal(adapter.isBeingChased(), true);
  world.police.busted = true;
  assert.equal(adapter.isBusted(), true);
  adapter.addMoney(150);
  assert.equal(adapter.getMoney(), 400);
  assert.equal(adapter.getCombatKills(), 0); // Day 3B seam: no combat yet
  world.playerCar = { heading: 2, speed: 12 };
  world.state.onFoot = false;
  assert.deepEqual(adapter.getPlayer(), { x: 10, z: 20, heading: 2, speed: 12, onFoot: false });
});

test('unknown objective kind throws loudly', () => {
  const a = mockAdapter();
  const m = createMissionManager({ Story, Compiler }, a);
  m.loadCompiled('mission-01-delivery-gone-wrong', {
    title: 'Bad', reward: 0, fail: {},
    objectives: [{ id: 'meet_yara', kind: 'teleport', hud: 'Nope' }],
  }, JSONS['mission-01-delivery-gone-wrong']);
  m.start();
  assert.throws(() => m.update(1 / 60), /unknown kind 'teleport'/);
});

test('loadMission compiles .ink source in Node', () => {
  const src = readFileSync(new URL('../src/stories/mission-01-delivery-gone-wrong.ink', import.meta.url), 'utf8');
  const a = mockAdapter();
  const m = createMissionManager({ Story, Compiler }, a);
  m.loadMission('mission-01-delivery-gone-wrong', resolveManifest('mission-01-delivery-gone-wrong', CITY), src);
  const snap = m.start();
  assert.equal(snap.stage, 'meet_yara');
});
