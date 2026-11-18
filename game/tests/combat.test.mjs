// Cabo Luna — combat tests (Day 3B, fresh).
// Renderer-free combat module + real mission manager for the M3
// end-to-end. Run: node --test game/tests/combat.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Story, Compiler } from '../vendor/ink-full.mjs';
import { COMBAT, STEP } from '../src/config.js';
import { makeRng } from '../src/rng.js';
import { generateCity } from '../src/city.js';
import {
  createCombatManager, createEnemy, spawnHarborGuards, damageEnemy,
  fire, stepCombat, stepEnemy, switchWeapon, cycleWeapon, startReload,
  getAmmo, rayHit, nearestCoverPoint, currentWeapon, HARBOR_GUARDS,
} from '../src/combat.js';
import { createMissionManager } from '../src/missions.js';
import { resolveManifest } from '../src/mission-data.js';
import { MISSION_03_JSON } from '../src/stories/mission-03-harbor-silence.js';

const CITY = generateCity(1);
const NO_LOS = () => false;
const LOS = () => true;

function mgr(opts = {}) {
  return createCombatManager({ rng: makeRng(42), colliders: [], ...opts });
}

function ctx(player = { x: 0, z: 0 }, extra = {}) {
  return { player, colliders: [], hasLineOfSight: LOS, rng: makeRng(7), damagePlayer: () => {}, ...extra };
}

function aimAt(from, target) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}

// ---- rayHit ------------------------------------------------------------
test('rayHit: target in the line is hit, off-line misses, range limits', () => {
  const t = { x: 10, z: 0, radius: 0.6, hp: 100 };
  assert.ok(rayHit(0, 0, 1, 0, t) < 10);
  assert.equal(rayHit(0, 0, 1, 0, { ...t, z: 5 }), Infinity);
  assert.equal(rayHit(0, 0, 1, 0, { ...t, x: 70 }), Infinity); // beyond 60 m
  assert.equal(rayHit(0, 0, -1, 0, t), Infinity); // behind the shooter
  assert.equal(rayHit(0, 0, 1, 0, { ...t, hp: 0 }), Infinity); // defeated: no hit
});

// ---- weapons / ammo ------------------------------------------------------
test('pistol starts 12/48, shotgun 6/24', () => {
  const m = mgr();
  assert.deepEqual([m.weapons.pistol.mag, m.weapons.pistol.reserve], [12, 48]);
  assert.deepEqual([m.weapons.shotgun.mag, m.weapons.shotgun.reserve], [6, 24]);
  assert.equal(m.current, 'pistol');
});

test('fire decrements the mag, empty mag blocks firing', () => {
  const m = mgr();
  const res = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []);
  assert.equal(res.fired, true);
  assert.equal(m.weapons.pistol.mag, 11);
  assert.equal(m.shotsFired, 1);
  // Cooldown blocks the next immediate shot.
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).reason, 'cooldown');
  m.weapons.pistol.mag = 0;
  m.cooldown = 0;
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).reason, 'empty');
});

test('reload is timed, refills the mag from reserve, reserve depletes', () => {
  const m = mgr();
  m.weapons.pistol.mag = 4;
  assert.equal(startReload(m), true);
  assert.equal(m.reloading, true);
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).reason, 'reloading');
  stepCombat(m, 0.6, ctx());
  assert.equal(m.reloading, true); // 1.2 s reload, only 0.6 s in
  stepCombat(m, 0.7, ctx());
  assert.equal(m.reloading, false);
  assert.equal(m.weapons.pistol.mag, 12);
  assert.equal(m.weapons.pistol.reserve, 40); // 8 rounds moved
});

test('reload does nothing with a full mag or an empty reserve', () => {
  const m = mgr();
  assert.equal(startReload(m), false); // full mag
  m.weapons.pistol.mag = 2; m.weapons.pistol.reserve = 0;
  assert.equal(startReload(m), false);
  m.weapons.pistol.reserve = 3;
  assert.equal(startReload(m), true);
  stepCombat(m, 1.3, ctx());
  assert.deepEqual([m.weapons.pistol.mag, m.weapons.pistol.reserve], [5, 0]); // partial refill
});

test('weapon switching: Q cycles all 3, Digit select works, unknown id rejected', () => {
  const m = mgr();
  assert.equal(cycleWeapon(m), true);
  assert.equal(m.current, 'shotgun');
  assert.equal(cycleWeapon(m), true);
  assert.equal(m.current, 'rifle');
  assert.equal(cycleWeapon(m), true);
  assert.equal(m.current, 'pistol');
  assert.equal(switchWeapon(m, 'rifle'), true);
  assert.equal(switchWeapon(m, 'rifle'), false); // already there
  assert.equal(switchWeapon(m, 'blaster'), false);
  assert.equal(m.current, 'rifle');
});

test('rifle Faro-7: 5/20, 85 dmg, 1.4 s interval, 2.8 s reload, 120 m range', () => {
  const m = mgr();
  const r = COMBAT.weapons.rifle;
  assert.equal(r.name, 'Faro-7');
  assert.deepEqual([m.weapons.rifle.mag, m.weapons.rifle.reserve], [5, 20]);
  assert.deepEqual(COMBAT.weaponOrder, ['pistol', 'shotgun', 'rifle']);
  // Distinct from pistol (34 dmg, 12/48, 0.25 s, 60 m) and shotgun
  // (5x12, 6/24, 0.9 s, 60 m): hardest single hit, tightest spread,
  // slowest fire, smallest mag, longest reload, longest range.
  assert.ok(r.damage > COMBAT.weapons.pistol.damage);
  assert.ok(r.spread < COMBAT.weapons.pistol.spread);
  assert.ok(r.fireInterval > COMBAT.weapons.shotgun.fireInterval);
  assert.ok(r.magSize < COMBAT.weapons.shotgun.magSize);
  assert.ok(r.reloadTime > COMBAT.weapons.shotgun.reloadTime);
  assert.equal(r.range, 120);
});

test('rifle hits at 100 m where the pistol cannot reach', () => {
  const m = mgr();
  m.rng = { next: () => 0.5 }; // zero spread
  const far = { x: 100, z: 0, radius: 0.6, hp: 100, kind: 'enemy' };
  const res = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [far]);
  assert.equal(res.fired, true);
  assert.equal(res.hits.length, 0); // pistol range is 60 m
  assert.equal(far.hp, 100);
  switchWeapon(m, 'rifle');
  m.cooldown = 0;
  const res2 = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [far]);
  assert.equal(res2.fired, true);
  assert.equal(res2.hits.length, 1);
  assert.equal(far.hp, 100 - 85);
  assert.equal(res2.hits[0].dist < 100, true);
  // And beyond the rifle's own 120 m it misses again.
  const tooFar = { x: 130, z: 0, radius: 0.6, hp: 100, kind: 'enemy' };
  m.cooldown = 0;
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [tooFar]).hits.length, 0);
});

test('rifle fire interval is 1.4 s and its reload takes 2.8 s', () => {
  const m = mgr();
  switchWeapon(m, 'rifle');
  fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []);
  assert.equal(m.weapons.rifle.mag, 4);
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).reason, 'cooldown');
  stepCombat(m, 1.4, ctx());
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).fired, true);
  assert.equal(startReload(m), true);
  stepCombat(m, 2.0, ctx());
  assert.equal(m.reloading, true); // 2.8 s reload, only 2.0 s in
  stepCombat(m, 0.9, ctx());
  assert.equal(m.reloading, false);
  assert.deepEqual([m.weapons.rifle.mag, m.weapons.rifle.reserve], [5, 18]); // 2 shots fired, 2 refilled
});

test('rifle ammo: empty mag blocks fire, reload refills, switch cancels reload', () => {
  const m = mgr();
  switchWeapon(m, 'rifle');
  m.weapons.rifle.mag = 0;
  assert.equal(fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []).reason, 'empty');
  assert.equal(startReload(m), true);
  assert.equal(switchWeapon(m, 'pistol'), true); // switching cancels the reload
  assert.equal(m.reloading, false);
  assert.equal(m.weapons.rifle.mag, 0); // nothing refilled
  switchWeapon(m, 'rifle');
  assert.equal(startReload(m), true);
  stepCombat(m, 2.9, ctx());
  assert.deepEqual([m.weapons.rifle.mag, m.weapons.rifle.reserve], [5, 15]);
  assert.deepEqual(getAmmo(m), {
    weapon: 'rifle', name: 'Faro-7', mag: 5, reserve: 15,
    magSize: 5, reloading: false, reloadProgress: 0,
  });
});

test('two rifle hits defeat a 100 HP guard; heat callbacks fire', () => {
  let shots = 0, personHits = 0;
  const m = mgr({ onShot: () => { shots += 1; }, onHitPerson: () => { personHits += 1; } });
  m.rng = { next: () => 0.5 };
  switchWeapon(m, 'rifle');
  const e = createEnemy('g1', 10, 0, []);
  m.enemies.push(e);
  const origin = { x: 0, y: 1.5, z: 0 };
  m.cooldown = 0;
  fire(m, origin, aimAt(origin, e), [e]);
  assert.equal(e.hp, 15);
  assert.notEqual(e.state, 'DEFEATED'); // one hit wounds, does not kill
  assert.equal(e.flinchTimer > 0, true);
  m.cooldown = 0;
  fire(m, origin, aimAt(origin, e), [e]);
  assert.equal(e.hp, 0);
  assert.equal(e.state, 'DEFEATED');
  assert.equal(m.kills, 1);
  assert.equal(shots, 2); // +10 heat per trigger pull
  assert.equal(personHits, 2); // +40 per hit on a person
  assert.equal(m.hitMarkerTimer > 0, true);
  assert.equal(m.muzzleTimer > 0, true);
  assert.ok(m.tracers.length >= 2);
});

test('shotgun fires 5 pellets; a close target takes up to 5x damage', () => {
  const m = mgr();
  switchWeapon(m, 'shotgun');
  const target = { x: 5, z: 0, radius: 0.6, hp: 100, kind: 'enemy' };
  // Force zero spread for a deterministic pellet count: stub rng.
  m.rng = { next: () => 0.5 };
  const res = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [target]);
  assert.equal(res.fired, true);
  assert.equal(res.hits.length, 5);
  assert.equal(target.hp, 100 - 5 * 12);
  assert.equal(m.weapons.shotgun.mag, 5);
});

// ---- hit detection through fire() ----------------------------------------
test('fire hits the target in the line, misses one off-line, nearest wins', () => {
  const m = mgr();
  const near = { x: 8, z: 0, radius: 0.6, hp: 100, kind: 'enemy' };
  const far = { x: 20, z: 0, radius: 0.6, hp: 100, kind: 'enemy' };
  const off = { x: 8, z: 6, radius: 0.6, hp: 100, kind: 'enemy' };
  const res = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [near, far, off]);
  assert.equal(res.hits.length, 1);
  assert.equal(res.hits[0].target, near);
  assert.equal(near.hp, 100 - 34);
  assert.equal(far.hp, 100);
  assert.equal(off.hp, 100);
  assert.equal(m.tracers.length, 1);
  assert.equal(m.hitMarkerTimer > 0, true);
});

test('fire at empty space still makes a tracer and adds shot heat', () => {
  let shots = 0, personHits = 0;
  const m = mgr({ onShot: () => { shots += 1; }, onHitPerson: () => { personHits += 1; } });
  const res = fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, []);
  assert.equal(res.fired, true);
  assert.equal(res.hits.length, 0);
  assert.equal(m.tracers.length, 1);
  assert.equal(shots, 1);
  assert.equal(personHits, 0);
  const ped = { x: 10, z: 0, radius: 0.5, kind: 'ped' };
  m.cooldown = 0;
  fire(m, { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, [ped]);
  assert.equal(personHits, 1); // hitting a person adds extra heat
});

// ---- enemy health / damage -------------------------------------------------
test('damage reduces HP, flinch set, 0 HP defeats and counts a kill', () => {
  const m = mgr();
  const e = createEnemy('g1', 0, 0, []);
  m.enemies.push(e);
  assert.equal(damageEnemy(m, e, 34), false);
  assert.equal(e.hp, 66);
  assert.equal(e.flinchTimer > 0, true);
  assert.equal(m.kills, 0);
  assert.equal(damageEnemy(m, e, 66), true);
  assert.equal(e.hp, 0);
  assert.equal(e.state, 'DEFEATED');
  assert.equal(m.kills, 1);
  assert.equal(damageEnemy(m, e, 10), false); // already dead: no double count
  assert.equal(m.kills, 1);
});

test('three pistol hits defeat a 100 HP guard', () => {
  const m = mgr();
  m.rng = { next: () => 0.5 };
  const e = createEnemy('g1', 10, 0, []);
  m.enemies.push(e);
  const origin = { x: 0, y: 1.5, z: 0 };
  for (let i = 0; i < 3; i++) {
    m.cooldown = 0;
    fire(m, origin, aimAt(origin, e), [e]);
  }
  assert.equal(e.hp, 0);
  assert.equal(m.kills, 1);
});

// ---- NPC behaviour tree ------------------------------------------------------
test('IDLE enemy with no waypoints stays IDLE and does not move', () => {
  const e = createEnemy('g1', 0, 0, []);
  assert.equal(e.state, 'IDLE');
  stepEnemy(e, 1, ctx({ x: 100, z: 100 }));
  assert.equal(e.state, 'IDLE');
  assert.deepEqual([e.x, e.z], [0, 0]);
});

test('PATROL loops waypoints and never stands still', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0], [10, 10]]);
  const c = ctx({ x: 100, z: 100 });
  const x0 = e.x;
  stepEnemy(e, 1, c);
  assert.equal(e.state, 'PATROL');
  assert.ok(e.x > x0, 'patrol moves toward the first waypoint');
  // Walk it all the way around the loop twice.
  for (let i = 0; i < 60 * 20; i++) stepEnemy(e, STEP, c);
  assert.equal(e.state, 'PATROL');
  assert.ok(e.wpIndex >= 0 && e.wpIndex < 2);
});

test('heard shot -> ALERT, then INVESTIGATE the shot position', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  e.heardPos = { x: 20, z: 0 };
  e.heardTimer = 3;
  stepEnemy(e, STEP, ctx({ x: 100, z: 100 }));
  assert.equal(e.state, 'ALERT');
  e.heardTimer = 0; // the sound fades
  stepEnemy(e, STEP, ctx({ x: 100, z: 100 }));
  stepEnemy(e, STEP, ctx({ x: 100, z: 100 }));
  assert.equal(e.state, 'INVESTIGATE');
  assert.deepEqual(e.lastKnown, { x: 20, z: 0 });
});

test('INVESTIGATE reaches the spot, looks around, then resumes patrol', () => {
  const e = createEnemy('g1', 0, 0, [[30, 0]]);
  e.lastKnown = { x: 3, z: 0 };
  const c = ctx({ x: 100, z: 100 });
  for (let i = 0; i < 60 * 5 && e.state !== 'ALERT'; i++) stepEnemy(e, STEP, c);
  assert.equal(e.state, 'ALERT'); // arrived, looking around
  assert.equal(e.lastKnown, null);
  e.alertTimer = 0;
  stepEnemy(e, STEP, c);
  assert.equal(e.state, 'PATROL');
});

test('seen player in range -> ENGAGE, enemy shoots and strafes', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  const c = ctx({ x: 20, z: 0 });
  stepEnemy(e, STEP, c);
  assert.equal(e.state, 'ENGAGE');
  const z0 = e.z;
  for (let i = 0; i < 60; i++) stepEnemy(e, STEP, c);
  assert.equal(e.state, 'ENGAGE');
  assert.notEqual(e.z, z0, 'engaged enemy strafes sideways');
});

test('no line of sight -> no ENGAGE even in range', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  const c = ctx({ x: 20, z: 0 }, { hasLineOfSight: NO_LOS });
  stepEnemy(e, STEP, c);
  assert.notEqual(e.state, 'ENGAGE');
});

test('HP below 40 -> COVER: picks a cover point and moves to it', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  e.hp = 30;
  const wall = [{ minX: 5, maxX: 7, minZ: -5, maxZ: 5 }];
  const c = ctx({ x: -20, z: 0 }, { colliders: wall });
  stepEnemy(e, STEP, c);
  assert.equal(e.state, 'COVER');
  assert.ok(e.coverPoint, 'cover point chosen');
  // The cover point sits on the wall edge between enemy and player.
  assert.ok(Math.abs(e.coverPoint.x - 4) < 2 || Math.abs(e.coverPoint.x - 8) < 2);
});

test('under fire at full HP -> COVER too', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  e.underFireTimer = 1;
  stepEnemy(e, STEP, ctx({ x: 20, z: 0 }));
  assert.equal(e.state, 'COVER');
});

test('HP below 20 -> RETREAT: distance from the player grows', () => {
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  e.hp = 15;
  const c = ctx({ x: 5, z: 0 });
  const d0 = Math.hypot(e.x - 5, e.z);
  for (let i = 0; i < 30; i++) stepEnemy(e, STEP, c);
  assert.equal(e.state, 'RETREAT');
  assert.ok(Math.hypot(e.x - 5, e.z) > d0, 'retreating enemy moves away');
});

test('DEFEATED enemy never moves or shoots again', () => {
  const m = mgr();
  const e = createEnemy('g1', 0, 0, [[10, 0]]);
  m.enemies.push(e);
  damageEnemy(m, e, 200);
  const c = ctx({ x: 2, z: 0 }, { damagePlayer: () => { throw new Error('dead enemy shot'); } });
  stepEnemy(e, 1, c);
  assert.equal(e.state, 'DEFEATED');
  assert.deepEqual([e.x, e.z], [0, 0]);
});

test('nearestCoverPoint with no buildings falls back behind the enemy', () => {
  const e = createEnemy('g1', 0, 0, []);
  const p = nearestCoverPoint(e, { x: -10, z: 0 }, []);
  assert.ok(p.x > 0, 'cover is away from the player');
});

// ---- player damage -----------------------------------------------------------
test('engaged enemy hits the player and reduces health', () => {
  let hp = 100;
  const e = createEnemy('g1', 0, 0, []);
  // rng always 0 -> every enemy shot lands.
  const c = ctx({ x: 15, z: 0 }, {
    rng: { next: () => 0 },
    damagePlayer: (d) => { hp -= d; },
  });
  for (let i = 0; i < 60 * 3; i++) stepEnemy(e, STEP, c);
  assert.ok(hp < 100, `expected damage, hp still ${hp}`);
  assert.equal(hp, 100 - COMBAT.enemy.damagePerHit * 3, 'one hit per 0.9 s burst');
});

test('enemy fire respects inaccuracy: a max-roll rng never hits', () => {
  let hp = 100;
  const e = createEnemy('g1', 0, 0, []);
  const c = ctx({ x: 15, z: 0 }, {
    rng: { next: () => 0.999 },
    damagePlayer: (d) => { hp -= d; },
  });
  for (let i = 0; i < 60 * 3; i++) stepEnemy(e, STEP, c);
  assert.equal(hp, 100);
});

// ---- harbor guards -------------------------------------------------------------
test('harbor guards spawn at the Puerto Luna warehouse and patrol', () => {
  const m = mgr();
  const guards = spawnHarborGuards(m);
  assert.equal(guards.length, 2);
  for (const [i, g] of guards.entries()) {
    assert.deepEqual([g.x, g.z], [HARBOR_GUARDS[i].x, HARBOR_GUARDS[i].z]);
    assert.equal(g.hp, 100);
    assert.equal(g.state, 'PATROL');
    assert.ok(g.waypoints.length >= 3);
  }
  // A fired shot within earshot alerts both guards.
  fire(m, { x: -150, y: 1.5, z: 110 }, { x: 1, y: 0, z: 0 }, []);
  for (const g of guards) assert.ok(g.heardTimer > 0, 'guard heard the shot');
});

// ---- M3 end-to-end with real combat ---------------------------------------------
function m3Adapter(combatMgr) {
  const a = {
    player: { x: -150, z: 110, heading: 0, speed: 0, onFoot: true },
    wanted: { level: 0, heat: 0 },
    money: 250, busted: false, chased: false, objectiveText: '',
    getPlayer() { return { ...this.player }; },
    getWanted() { return { ...this.wanted }; },
    getMoney() { return this.money; },
    addMoney(n) { this.money += n; },
    addCrime() {},
    isBusted() { return this.busted; },
    isBeingChased() { return this.chased; },
    getCombatKills() { return combatMgr.kills; },
    setObjectiveText(t) { this.objectiveText = t; },
  };
  return a;
}

test('M3 end-to-end with real combat: defeat 2 guards -> $400', () => {
  const combatMgr = mgr();
  combatMgr.rng = { next: () => 0.5 }; // no pellet spread
  const a = m3Adapter(combatMgr);
  const man = createMissionManager({ Story, Compiler }, a);
  man.loadCompiled('mission-03-harbor-silence', resolveManifest('mission-03-harbor-silence', CITY), MISSION_03_JSON);
  man.start();
  a.player.x = -150; a.player.z = 110;
  man.update(STEP);
  assert.equal(man.stage, 'defeat_guards');
  // The guards are on post at the warehouse; walk the player in and
  // shoot them with the pistol (3 hits each, 34 dmg).
  const guards = spawnHarborGuards(combatMgr);
  a.player.x = -150; a.player.z = 104;
  for (const g of guards) {
    for (let shot = 0; shot < 3; shot++) {
      combatMgr.cooldown = 0;
      const origin = { x: a.player.x, y: 1.5, z: a.player.z };
      const res = fire(combatMgr, origin, aimAt(origin, g), [g]);
      assert.equal(res.fired, true);
      assert.equal(res.hits.length, 1);
    }
    assert.equal(g.state, 'DEFEATED');
  }
  assert.equal(combatMgr.kills, 2);
  const snap = man.update(STEP);
  assert.deepEqual(snap.objectivesDone, ['infiltrate_harbor', 'defeat_guards']);
  assert.equal(snap.stage, 'reach_stash');
  a.player.x = -150; a.player.z = 162;
  man.update(STEP);
  assert.equal(man.stage, 'retrieve_package');
  for (let i = 0; i < 60 * 4; i++) man.update(STEP);
  assert.equal(man.stage, 'escape_safehouse');
  a.player.x = 162; a.player.z = -46;
  man.update(STEP);
  assert.equal(man.stage, 'wanted_clear');
  a.wanted.level = 2; a.wanted.heat = 40; // heat from the warehouse fight
  man.update(STEP);
  assert.equal(man.stage, 'wanted_clear');
  a.wanted.level = 0; a.wanted.heat = 0; // heat dies down after the escape
  const done = man.update(STEP);
  assert.equal(done.status, 'completed');
  assert.equal(done.rewardPaid, 400);
  assert.equal(a.money, 650);
});

test('getAmmo reports weapon, mag, reserve, reload state', () => {
  const m = mgr();
  assert.deepEqual(getAmmo(m), {
    weapon: 'pistol', name: 'Luna-9', mag: 12, reserve: 48,
    magSize: 12, reloading: false, reloadProgress: 0,
  });
  assert.equal(currentWeapon(m).name, 'Luna-9');
});
