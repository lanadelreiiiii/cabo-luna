// Cabo Luna — Day 5A mission tests (fresh).
// M4 "The Clock Is Ticking" (timed_reach), M5 "Plant the Proof"
// (plant + escape), manifest-driven guards, and the dynamic HUD job
// count (JOB n/N, N = CHAIN.length). Real MissionManager + real
// compiled stories + the same mock adapter as missions.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Story, Compiler } from '../vendor/ink-full.mjs';
import { createMissionManager } from '../src/missions.js';
import { MISSIONS, resolveManifest, CHAIN } from '../src/mission-data.js';
import { createMissionChain } from '../src/mission-chain.js';
import { createCaboAdapter, CRIME_HEAT } from '../src/mission-adapter.js';
import { createCombatManager, spawnGuards, spawnHarborGuards, HARBOR_GUARDS } from '../src/combat.js';
import { makeRng } from '../src/rng.js';
import { MISSION_04_JSON } from '../src/stories/mission-04-three-stops.js';
import { MISSION_05_JSON } from '../src/stories/mission-05-plant-the-proof.js';
import { generateCity } from '../src/city.js';

const CITY = generateCity(1);
const JSONS = {
  'mission-04-three-stops': MISSION_04_JSON,
  'mission-05-plant-the-proof': MISSION_05_JSON,
};

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

function stepUntil(m, cond, maxSteps = 25000) {
  for (let i = 0; i < maxSteps; i++) {
    const snap = m.update(1 / 60);
    if (cond(snap)) return snap;
  }
  throw new Error('stepUntil: condition never met');
}

// ---- Manifests + chain ----------------------------------------------------
test('CHAIN is five missions in order; M4 unlocks after M3, M5 after M4', () => {
  assert.deepEqual(CHAIN, [
    'mission-01-delivery-gone-wrong',
    'mission-02-wrong-place',
    'mission-03-harbor-silence',
    'mission-04-three-stops',
    'mission-05-plant-the-proof',
  ]);
  for (const id of CHAIN) assert.ok(MISSIONS[id], id);
  const c = createMissionChain(CHAIN);
  assert.equal(c.state('mission-04-three-stops'), 'LOCKED');
  assert.equal(c.state('mission-05-plant-the-proof'), 'LOCKED');
  // Fast-forward: complete M1-M3, M4 becomes AVAILABLE, M5 stays LOCKED.
  for (const id of CHAIN.slice(0, 3)) { c.start(id); c.complete(id); }
  assert.equal(c.state('mission-04-three-stops'), 'AVAILABLE');
  assert.equal(c.state('mission-05-plant-the-proof'), 'LOCKED');
  c.start('mission-04-three-stops');
  c.complete('mission-04-three-stops');
  assert.equal(c.state('mission-05-plant-the-proof'), 'AVAILABLE');
  c.start('mission-05-plant-the-proof');
  assert.equal(c.complete('mission-05-plant-the-proof'), null);
  assert.equal(c.current(), null);
  assert.deepEqual(c.completedIds(), [...CHAIN]);
});

test('M4/M5 manifests resolve: drops on road lines, timed_reach has a clock', () => {
  const m4 = resolveManifest('mission-04-three-stops', CITY);
  assert.equal(m4.objectives.filter((o) => o.kind === 'timed_reach').length, 3);
  for (const o of m4.objectives) {
    if (o.kind !== 'timed_reach') continue;
    assert.equal(o.seconds, 60);
    assert.ok(CITY.roadLines.includes(o.x) || CITY.roadLines.includes(o.z), `M4/${o.id} off-road`);
  }
  assert.deepEqual([m4.objectives.find((o) => o.id === 'drop_one').x, m4.objectives.find((o) => o.id === 'drop_one').z], [58, 6]);
  const m5 = resolveManifest('mission-05-plant-the-proof', CITY);
  assert.equal(m5.objectives.find((o) => o.id === 'plant_evidence').seconds, 4);
  assert.deepEqual([m5.objectives.find((o) => o.id === 'escape_garage').x, m5.objectives.find((o) => o.id === 'escape_garage').z], [58, 58]);
  assert.equal(m5.guards.length, 2);
});

test('guards are manifest-driven: M3 keeps its harbor guards, M5 has office guards', () => {
  const m3 = resolveManifest('mission-03-harbor-silence', CITY);
  assert.equal(m3.guards.length, 2);
  assert.deepEqual([m3.guards[0].x, m3.guards[0].z], [HARBOR_GUARDS[0].x, HARBOR_GUARDS[0].z]);
  const m5 = resolveManifest('mission-05-plant-the-proof', CITY);
  assert.deepEqual([m5.guards[0].x, m5.guards[0].z], [106, 2]);
});

test('spawnGuards spawns from any manifest list; spawnHarborGuards is the M3 shorthand', () => {
  const combat = createCombatManager({ rng: makeRng(42), colliders: [] });
  const m5 = resolveManifest('mission-05-plant-the-proof', CITY);
  const spawned = spawnGuards(combat, m5.guards);
  assert.equal(spawned.length, 2);
  assert.deepEqual([spawned[0].x, spawned[0].z], [106, 2]);
  assert.equal(combat.enemies.length, 2);
  const combat2 = createCombatManager({ rng: makeRng(42), colliders: [] });
  spawnHarborGuards(combat2);
  assert.equal(combat2.enemies.length, 2);
  assert.deepEqual([combat2.enemies[0].x, combat2.enemies[0].z], [HARBOR_GUARDS[0].x, HARBOR_GUARDS[0].z]);
});

// ---- M4: The Clock Is Ticking ----------------------------------------------
test('M4 avenue branch: three timed drops pay $500', () => {
  const a = mockAdapter();
  const m = managerFor('mission-04-three-stops', a);
  m.start();
  m.update(1 / 60); // meet_yara (spawns at the plaza)
  a.player.onFoot = false;
  m.update(1 / 60); // get_car
  assert.equal(m.stage, 'drop_one');
  a.player.x = 58; a.player.z = 6; // Torre Alta, inside 60s
  m.update(1 / 60);
  assert.equal(m.stage, 'drop_two');
  a.player.x = 6; a.player.z = -150; // Mercado Norte
  m.update(1 / 60);
  assert.equal(m.choices.length, 2);
  m.choose(0); // fast avenue
  assert.equal(m.getVariable('route'), 'avenue');
  const drop = m.manifest.objectives.find((o) => o.id === 'drop_three');
  assert.deepEqual([drop.x, drop.z], [162, -46]); // Colina Verde
  a.player.x = 162; a.player.z = -46;
  m.update(1 / 60);
  assert.equal(m.stage, 'lose_tail');
  a.chased = false;
  stepUntil(m, (s) => s.objectivesDone.includes('lose_tail'), 60 * 10);
  a.wanted.level = 2; a.wanted.heat = 40;
  m.update(1 / 60);
  assert.equal(m.stage, 'wanted_clear');
  a.wanted.level = 0; a.wanted.heat = 0;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 500);
  assert.equal(a.money, 750);
});

test('M4 harbor-road branch drops in Puerto Luna', () => {
  const a = mockAdapter();
  const m = managerFor('mission-04-three-stops', a);
  m.start();
  m.update(1 / 60);
  a.player.onFoot = false;
  m.update(1 / 60);
  a.player.x = 58; a.player.z = 6;
  m.update(1 / 60);
  a.player.x = 6; a.player.z = -150;
  m.update(1 / 60);
  m.choose(1); // quiet harbor road
  const drop = m.manifest.objectives.find((o) => o.id === 'drop_three');
  assert.deepEqual([drop.x, drop.z], [-150, 110]); // Puerto Luna
  a.player.x = -150; a.player.z = 110;
  const snap = m.update(1 / 60);
  assert.equal(snap.stage, 'lose_tail');
  assert.equal(snap.status, 'active');
});

test('M4 timed_reach: missing the 60s clock fails the mission (too_slow)', () => {
  const a = mockAdapter();
  const m = managerFor('mission-04-three-stops', a);
  m.start();
  m.update(1 / 60);
  a.player.onFoot = false;
  m.update(1 / 60);
  assert.equal(m.stage, 'drop_one');
  // Sit still for 61 s — the clock runs out before the drop is reached.
  let snap = null;
  for (let i = 0; i < 61 * 60; i++) snap = m.update(1 / 60);
  assert.equal(snap.status, 'failed');
  assert.equal(snap.failReason, 'too_slow');
  assert.ok(m.lines.some((l) => l.text.includes('clock')));
});

test('M4 reaching a drop just inside the clock completes the stage', () => {
  const a = mockAdapter();
  const m = managerFor('mission-04-three-stops', a);
  m.start();
  m.update(1 / 60);
  a.player.onFoot = false;
  m.update(1 / 60);
  for (let i = 0; i < 59 * 60; i++) m.update(1 / 60); // 59 s, still alive
  assert.equal(m.stage, 'drop_one');
  a.player.x = 58; a.player.z = 6;
  const snap = m.update(1 / 60);
  assert.equal(snap.stage, 'drop_two');
});

// ---- M5: Plant the Proof ----------------------------------------------------
test('M5 quiet branch pays $550 with one theft crime from the plant', () => {
  const a = mockAdapter();
  const m = managerFor('mission-05-plant-the-proof', a);
  m.start();
  assert.equal(m.stage, 'infiltrate_office');
  a.player.x = 110; a.player.z = 6; // Torre Alta office, on foot
  m.update(1 / 60);
  assert.equal(m.stage, 'plant_evidence');
  stepUntil(m, (s) => s.objectivesDone.includes('plant_evidence'), 60 * 6);
  assert.equal(m.choices.length, 2);
  m.choose(1); // slip out quiet
  assert.equal(m.getVariable('alarm'), 'quiet');
  assert.deepEqual(a.crimes, ['theft']); // the plant itself is the crime
  assert.equal(a.wanted.level, 2); // 25 heat
  assert.equal(m.stage, 'escape_garage');
  a.player.x = 58; a.player.z = 58; // Taller Brisa garage
  m.update(1 / 60);
  assert.equal(m.stage, 'wanted_clear');
  a.wanted.level = 0; a.wanted.heat = 0;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 550);
  assert.equal(a.money, 800);
});

test('M5 smash branch pays $650 with extra sabotage heat', () => {
  const a = mockAdapter();
  const m = managerFor('mission-05-plant-the-proof', a);
  m.start();
  a.player.x = 110; a.player.z = 6;
  m.update(1 / 60);
  stepUntil(m, (s) => s.objectivesDone.includes('plant_evidence'), 60 * 6);
  m.choose(0); // smash the alarm
  assert.equal(m.getVariable('alarm'), 'smashed');
  assert.deepEqual(a.crimes, ['sabotage', 'theft']); // alarm + plant
  assert.equal(a.wanted.heat, 50);
  assert.equal(a.wanted.level, 3);
  a.player.x = 58; a.player.z = 58;
  m.update(1 / 60);
  a.wanted.level = 0; a.wanted.heat = 0;
  const snap = m.update(1 / 60);
  assert.equal(snap.status, 'completed');
  assert.equal(snap.rewardPaid, 650);
  assert.equal(a.money, 900);
});

test('M5 timeout fails after 360s', () => {
  const a = mockAdapter();
  const m = managerFor('mission-05-plant-the-proof', a);
  m.start();
  const snap = stepUntil(m, (s) => s.status === 'failed', 25000);
  assert.equal(snap.failReason, 'timeout');
  assert.ok(m.elapsed > 360);
});

// ---- Ink source compiles in Node --------------------------------------------
test('loadMission compiles the M4/M5 .ink sources in Node', () => {
  for (const id of ['mission-04-three-stops', 'mission-05-plant-the-proof']) {
    const src = readFileSync(new URL(`../src/stories/${id}.ink`, import.meta.url), 'utf8');
    const a = mockAdapter();
    const m = createMissionManager({ Story, Compiler }, a);
    m.loadMission(id, resolveManifest(id, CITY), src);
    const snap = m.start();
    assert.equal(snap.status, 'active');
    assert.ok(snap.stage);
  }
});

// ---- HUD job count is dynamic (Phase 5E regression) --------------------------
test('HUD job count is dynamic: no hardcoded /3 in main.js', () => {
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /JOB 1\/3/);
  assert.doesNotMatch(src, /JOB 3\/3/);
  assert.doesNotMatch(src, /JOB \$\{n\}\/3/);
  assert.doesNotMatch(src, /done: 3, total: 3/);
  // The count comes from CHAIN.length everywhere it appears.
  assert.match(src, /JOB 1\/\$\{CHAIN\.length\}/);
  assert.match(src, /JOB \$\{n\}\/\$\{CHAIN\.length\}/);
  assert.match(src, /JOB \$\{CHAIN\.length\}\/\$\{CHAIN\.length\}/);
  assert.match(src, /done: CHAIN\.length, total: CHAIN\.length/);
  // And the all-done title is the last mission in the chain, not hardcoded.
  assert.match(src, /const lastId = CHAIN\[CHAIN\.length - 1\]/);
  assert.match(src, /title: MISSIONS\[lastId\]\.title/);
  // With the 5-mission chain the HUD reads JOB n/5.
  assert.equal(CHAIN.length, 5);
  assert.equal(`JOB ${4}/${CHAIN.length}`, 'JOB 4/5');
});
