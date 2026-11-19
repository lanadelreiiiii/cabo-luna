// Cabo Luna — combat (Day 3B, written fresh in-session).
// Renderer-free core: three hitscan weapons (pistol Luna-9, shotgun
// Boca-12, rifle Faro-7), magazine + reserve ammo with timed reloads, and armed NPC
// enemies (harbor guards) driven by a behaviour tree re-evaluated from
// the root every tick — the same pattern police.js uses:
//
//   defeated [hp <= 0] -> DEFEATED
//   retreat  [hp < 20] -> RETREAT (fall back away from the player)
//   cover    [hp < 40 or under fire] -> COVER (nearest building edge, shoot from there)
//   engage   [line of sight + in range] -> ENGAGE (shoot with inaccuracy, strafe)
//   investigate [a last heard/seen position exists] -> INVESTIGATE
//   alert    [heard a shot within radius, briefly] -> ALERT
//   patrol   [waypoints] -> PATROL
//   idle     [fallback, at post]
//
// Enemies always move (patrol waypoints at minimum). Vision uses the
// shared hasLineOfSight (buildings block sight). Shooting adds heat
// through the onShot/onHit callbacks the game wires to the adapter.
// The browser renders enemies/tracers/muzzle flashes from the plain
// state this module keeps (tracers[], muzzleTimer, hitMarkerTimer).
import { COMBAT } from './config.js';
import { hasLineOfSight } from './police.js';

export const ENEMY_STATES = ['IDLE', 'PATROL', 'ALERT', 'INVESTIGATE', 'ENGAGE', 'COVER', 'RETREAT', 'DEFEATED'];

// Harbor warehouse (M3 infiltrate target): roadX 0 = -150, roadZ 5 = 110.
// Guards post around it and patrol a loop of the warehouse block.
export const HARBOR_GUARDS = [
  { x: -144, z: 109, waypoints: [[-146, 106], [-138, 112], [-146, 118], [-154, 112]] },
  { x: -136, z: 100, waypoints: [[-154, 114], [-146, 120], [-138, 114], [-146, 108]] },
];

function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function pointBlocked(x, z, colliders, radius = 0.55) {
  for (const c of colliders) {
    if (x + radius > c.minX && x - radius < c.maxX && z + radius > c.minZ && z - radius < c.maxZ) return true;
  }
  return false;
}

// Move (x,z) toward (tx,tz) at speed, sliding along building AABBs
// (axis-separated, same trick as the player controller).
export function moveToward(enemy, tx, tz, speed, dt, colliders) {
  const dx = tx - enemy.x, dz = tz - enemy.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.3) return true;
  const nx = enemy.x + (dx / dist) * speed * dt;
  if (!pointBlocked(nx, enemy.z, colliders)) enemy.x = nx;
  const nz = enemy.z + (dz / dist) * speed * dt;
  if (!pointBlocked(enemy.x, nz, colliders)) enemy.z = nz;
  enemy.heading = Math.atan2(dx, dz);
  return Math.hypot(tx - enemy.x, tz - enemy.z) < 0.6;
}

// Ray (2D, XZ) vs a target circle. Returns the hit distance t along
// the ray, or Infinity when the ray misses / is out of range.
export function rayHit(ox, oz, dx, dz, target, range = COMBAT.range) {
  if (target.hp != null && target.hp <= 0) return Infinity;
  const rx = target.x - ox, rz = target.z - oz;
  const t = rx * dx + rz * dz; // projection (dir is unit length)
  if (t < 0 || t > range) return Infinity;
  const px = ox + dx * t, pz = oz + dz * t;
  const perp = Math.hypot(target.x - px, target.z - pz);
  const r = target.radius ?? 0.6;
  if (perp > r) return Infinity;
  // Entry point of the ray into the circle (closer than the centre).
  return Math.max(0, t - Math.sqrt(Math.max(0, r * r - perp * perp)));
}

export function createEnemy(id, x, z, waypoints = [], opts = {}) {
  return {
    id, kind: 'enemy', x, z,
    radius: 0.6, hp: COMBAT.enemy.health, maxHp: COMBAT.enemy.health,
    heading: opts.heading ?? 0,
    state: waypoints.length > 0 ? 'PATROL' : 'IDLE',
    stateTimer: 0,
    waypoints: waypoints.map(([wx, wz]) => ({ x: wx, z: wz })),
    wpIndex: 0,
    lastKnown: null,
    heardPos: null,
    heardTimer: 0,
    alertTimer: 0,
    underFireTimer: 0,
    flinchTimer: 0,
    shootTimer: 0.5,
    coverPoint: null,
    strafeDir: 1,
    strafeTimer: 0,
    flashTimer: 0, // hit flash for the renderer
    died: false,
  };
}

// Day 5A: generic guard spawn from a manifest `guards` list
// [{x, z, waypoints}]. Any mission that declares guards gets them;
// spawnHarborGuards is the M3 shorthand over HARBOR_GUARDS.
export function spawnGuards(manager, points) {
  manager.enemies = points.map((g, i) => createEnemy(`guard-${i + 1}`, g.x, g.z, g.waypoints));
  return manager.enemies;
}

export function spawnHarborGuards(manager) {
  return spawnGuards(manager, HARBOR_GUARDS);
}

// Damage an enemy. Returns true if this hit defeated it. Flinch
// interrupts movement briefly; the kill count lives on the manager.
export function damageEnemy(manager, enemy, dmg) {
  if (enemy.hp <= 0) return false;
  enemy.hp = Math.max(0, enemy.hp - dmg);
  enemy.flashTimer = 0.12;
  enemy.flinchTimer = COMBAT.enemy.flinchTime;
  enemy.underFireTimer = 1.5;
  if (enemy.hp <= 0) {
    enemy.died = true;
    enemy.state = 'DEFEATED';
    manager.kills += 1;
    return true;
  }
  return false;
}

// Nearest cover: the edge of the closest building AABB, on the side
// away from the player. No buildings nearby -> a point 8 m behind the
// enemy relative to the player.
export function nearestCoverPoint(enemy, player, colliders) {
  let best = null, bestD = Infinity;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(enemy.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(enemy.z, c.maxZ));
    const d = Math.hypot(cx - enemy.x, cz - enemy.z);
    if (d < bestD) { bestD = d; best = { c, cx, cz }; }
  }
  if (!best) {
    const dx = enemy.x - player.x, dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: enemy.x + (dx / len) * 8, z: enemy.z + (dz / len) * 8 };
  }
  const { c } = best;
  // Step off the closest edge, away from the player.
  const dx = enemy.x - player.x, dz = enemy.z - player.z;
  const ex = Math.abs(best.cx - c.minX) < Math.abs(best.cx - c.maxX) ? c.minX - 1 : c.maxX + 1;
  const ez = Math.abs(best.cz - c.minZ) < Math.abs(best.cz - c.maxZ) ? c.minZ - 1 : c.maxZ + 1;
  // Pick the edge axis the player is further along, so the building
  // actually sits between enemy and player.
  if (Math.abs(dx) >= Math.abs(dz)) return { x: ex, z: best.cz };
  return { x: best.cx, z: ez };
}

function enemyShoot(enemy, dt, ctx) {
  enemy.shootTimer -= dt;
  if (enemy.shootTimer > 0) return;
  enemy.shootTimer = COMBAT.enemy.shootInterval;
  const dist = Math.hypot(ctx.player.x - enemy.x, ctx.player.z - enemy.z);
  const chance = Math.max(
    COMBAT.enemy.hitChanceMin,
    COMBAT.enemy.hitChanceBase - dist * COMBAT.enemy.hitChanceFalloff,
  );
  if (ctx.rng.next() < chance && typeof ctx.damagePlayer === 'function') {
    ctx.damagePlayer(COMBAT.enemy.damagePerHit, enemy);
  }
}

// One enemy, one tick. The tree is re-read from the root every tick:
// defeated -> retreat -> cover -> engage -> investigate -> alert ->
// patrol -> idle. ctx: { player:{x,z}, colliders, hasLineOfSight?,
// rng, damagePlayer? }.
export function stepEnemy(enemy, dt, ctx) {
  const colliders = ctx.colliders ?? [];
  const los = ctx.hasLineOfSight ?? hasLineOfSight;
  const player = ctx.player;
  const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);
  enemy.stateTimer += dt;
  if (enemy.flashTimer > 0) enemy.flashTimer -= dt;
  if (enemy.underFireTimer > 0) enemy.underFireTimer -= dt;
  if (enemy.heardTimer > 0) enemy.heardTimer -= dt;
  if (enemy.flinchTimer > 0) { enemy.flinchTimer -= dt; return enemy; }

  const setState = (s) => {
    if (enemy.state !== s) { enemy.state = s; enemy.stateTimer = 0; }
  };

  // --- defeated: stays down ----------------------------------------
  if (enemy.hp <= 0) { setState('DEFEATED'); return enemy; }

  const seen = dist <= COMBAT.enemy.sightRange
    && los(enemy.x, enemy.z, player.x, player.z, colliders);
  if (seen) {
    enemy.lastKnown = { x: player.x, z: player.z };
    enemy.heardPos = null;
    enemy.heardTimer = 0;
  }

  // --- retreat: hp < 20, fall back away from the player -------------
  if (enemy.hp < COMBAT.enemy.retreatHp) {
    setState('RETREAT');
    const dx = enemy.x - player.x, dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    moveToward(enemy, enemy.x + (dx / len) * 10, enemy.z + (dz / len) * 10,
      COMBAT.enemy.retreatSpeed, dt, colliders);
    return enemy;
  }

  // --- cover: hp < 40 or under fire ---------------------------------
  if (enemy.hp < COMBAT.enemy.coverHp || enemy.underFireTimer > 0) {
    setState('COVER');
    if (!enemy.coverPoint) enemy.coverPoint = nearestCoverPoint(enemy, player, colliders);
    const arrived = moveToward(enemy, enemy.coverPoint.x, enemy.coverPoint.z,
      COMBAT.enemy.combatSpeed, dt, colliders);
    if (arrived || seen) enemyShoot(enemy, dt, ctx);
    return enemy;
  }

  // --- engage: line of sight + in range ------------------------------
  if (seen && dist <= COMBAT.enemy.engageRange) {
    setState('ENGAGE');
    enemy.strafeTimer -= dt;
    if (enemy.strafeTimer <= 0) { enemy.strafeDir *= -1; enemy.strafeTimer = 1.5 + ctx.rng.next(); }
    // Hold a 12-25 m band, strafing sideways so the target never
    // stands still while shooting.
    const fx = (player.x - enemy.x) / (dist || 1), fz = (player.z - enemy.z) / (dist || 1);
    const px = -fz * enemy.strafeDir, pz = fx * enemy.strafeDir;
    let tx = enemy.x + px * 4, tz = enemy.z + pz * 4;
    if (dist > 25) { tx = enemy.x + fx * 6; tz = enemy.z + fz * 6; }
    else if (dist < 10) { tx = enemy.x - fx * 6; tz = enemy.z - fz * 6; }
    moveToward(enemy, tx, tz, COMBAT.enemy.combatSpeed, dt, colliders);
    enemy.heading = Math.atan2(player.x - enemy.x, player.z - enemy.z);
    enemyShoot(enemy, dt, ctx);
    return enemy;
  }

  // --- alert: a fresh sound — face it briefly before investigating --
  if (enemy.heardPos && enemy.heardTimer > 0 && !enemy.lastKnown) {
    setState('ALERT');
    enemy.heading = Math.atan2(enemy.heardPos.x - enemy.x, enemy.heardPos.z - enemy.z);
    return enemy;
  }

  // --- investigate: move to the last heard/seen position ------------
  if (enemy.lastKnown || enemy.heardPos) {
    setState('INVESTIGATE');
    if (enemy.heardPos && !enemy.lastKnown) {
      enemy.lastKnown = { ...enemy.heardPos };
      enemy.heardPos = null;
    }
    const target = enemy.lastKnown ?? enemy.heardPos;
    const arrived = moveToward(enemy, target.x, target.z,
      COMBAT.enemy.investigateSpeed, dt, colliders);
    if (arrived) {
      // Look around for a moment, then give up and resume patrol.
      enemy.lastKnown = null;
      enemy.heardPos = null;
      enemy.alertTimer = 0.8;
      setState('ALERT');
    }
    return enemy;
  }

  // --- alert (post-investigation): arrived, look around briefly -----
  if (enemy.alertTimer > 0) {
    setState('ALERT');
    enemy.alertTimer -= dt;
    return enemy;
  }

  // --- patrol: loop the waypoints, never stand still -----------------
  if (enemy.waypoints.length > 0) {
    setState('PATROL');
    const wp = enemy.waypoints[enemy.wpIndex];
    if (moveToward(enemy, wp.x, wp.z, COMBAT.enemy.patrolSpeed, dt, colliders)) {
      enemy.wpIndex = (enemy.wpIndex + 1) % enemy.waypoints.length;
    }
    return enemy;
  }

  setState('IDLE');
  return enemy;
}

// ---- Weapon state -----------------------------------------------------
export function createCombatManager(opts = {}) {
  const weapons = {};
  for (const [id, def] of Object.entries(COMBAT.weapons)) {
    weapons[id] = { ...def, mag: def.magSize, reserve: def.reserveStart };
  }
  return {
    rng: opts.rng ?? null, // seeded in the game; tests pass their own
    colliders: opts.colliders ?? [],
    onShot: opts.onShot ?? null, // () => heat per trigger pull
    onHitPerson: opts.onHitPerson ?? null, // (target) => extra heat
    enemies: [],
    kills: 0,
    weapons,
    current: 'pistol',
    cooldown: 0,
    reloading: false,
    reloadTimer: 0,
    reloadWeapon: null,
    muzzleTimer: 0,
    hitMarkerTimer: 0,
    tracers: [], // {from:{x,y,z}, to:{x,y,z}, life, max}
    shotsFired: 0,
  };
}

export function currentWeapon(manager) { return manager.weapons[manager.current]; }

export function getAmmo(manager) {
  const w = currentWeapon(manager);
  return {
    weapon: w.id, name: w.name, mag: w.mag, reserve: w.reserve,
    magSize: w.magSize, reloading: manager.reloading,
    reloadProgress: manager.reloading && manager.reloadWeapon
      ? 1 - manager.reloadTimer / manager.weapons[manager.reloadWeapon].reloadTime : 0,
  };
}

export function switchWeapon(manager, id) {
  if (!manager.weapons[id] || manager.current === id) return false;
  manager.current = id;
  manager.reloading = false;
  manager.reloadTimer = 0;
  manager.reloadWeapon = null;
  return true;
}

export function cycleWeapon(manager) {
  const order = COMBAT.weaponOrder;
  const next = order[(order.indexOf(manager.current) + 1) % order.length];
  return switchWeapon(manager, next);
}

export function startReload(manager) {
  const w = currentWeapon(manager);
  if (manager.reloading || w.mag >= w.magSize || w.reserve <= 0) return false;
  manager.reloading = true;
  manager.reloadTimer = w.reloadTime;
  manager.reloadWeapon = w.id;
  return true;
}

function finishReload(manager) {
  const w = manager.weapons[manager.reloadWeapon];
  manager.reloading = false;
  manager.reloadTimer = 0;
  manager.reloadWeapon = null;
  if (!w) return;
  const need = w.magSize - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

// Hitscan fire. origin {x, y, z}, dir {x, y, z} (camera forward,
// normalised). targets: [{x, z, radius, hp, kind}] — enemies, peds,
// cars. Returns { fired, reason?, hits: [{target, damage, dist}] }.
// One trigger pull = one shot (shotgun: 5 pellets). Firing alerts
// nearby enemies (they hear the shot) and adds heat via callbacks.
export function fire(manager, origin, dir, targets = []) {
  const w = currentWeapon(manager);
  if (manager.reloading) return { fired: false, reason: 'reloading' };
  if (manager.cooldown > 0) return { fired: false, reason: 'cooldown' };
  if (w.mag <= 0) return { fired: false, reason: 'empty' };
  manager.cooldown = w.fireInterval;
  w.mag -= 1;
  manager.shotsFired += 1;
  manager.muzzleTimer = 0.06;
  const rng = manager.rng;
  const nextRand = () => (rng ? rng.next() : Math.random());
  const hits = [];
  const range = w.range ?? COMBAT.range;
  const dxz = Math.hypot(dir.x, dir.z) || 1;
  const baseDx = dir.x / dxz, baseDz = dir.z / dxz;
  for (let p = 0; p < w.pellets; p++) {
    const spread = (nextRand() - 0.5) * 2 * w.spread;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const dx = baseDx * cos - baseDz * sin;
    const dz = baseDx * sin + baseDz * cos;
    let best = null, bestT = Infinity;
    for (const t of targets) {
      const hitT = rayHit(origin.x, origin.z, dx, dz, t, range);
      if (hitT < bestT) { bestT = hitT; best = t; }
    }
    const endX = origin.x + dx * (best ? bestT : range);
    const endZ = origin.z + dz * (best ? bestT : range);
    manager.tracers.push({
      from: { x: origin.x, y: origin.y ?? 1.5, z: origin.z },
      to: { x: endX, y: origin.y ?? 1.5, z: endZ },
      life: 0.12, max: 0.12,
    });
    if (best) {
      hits.push({ target: best, damage: w.damage, dist: bestT });
      manager.hitMarkerTimer = 0.25;
      if (best.kind === 'enemy') {
        damageEnemy(manager, best, w.damage);
        if (typeof manager.onHitPerson === 'function') manager.onHitPerson(best);
      } else if (typeof manager.onHitPerson === 'function') manager.onHitPerson(best);
    }
  }
  // Every enemy in earshot hears the shot and investigates.
  for (const e of manager.enemies) {
    if (e.hp <= 0) continue;
    if (Math.hypot(e.x - origin.x, e.z - origin.z) <= COMBAT.enemy.hearRadius) {
      e.heardPos = { x: origin.x, z: origin.z };
      e.heardTimer = 3;
    }
  }
  if (typeof manager.onShot === 'function') manager.onShot();
  return { fired: true, hits };
}

// Advance timers, reload, tracers, and every enemy one tick.
// ctx: { player:{x,z}, colliders, hasLineOfSight?, rng?, damagePlayer? }
export function stepCombat(manager, dt, ctx) {
  if (manager.cooldown > 0) manager.cooldown -= dt;
  if (manager.muzzleTimer > 0) manager.muzzleTimer -= dt;
  if (manager.hitMarkerTimer > 0) manager.hitMarkerTimer -= dt;
  if (manager.reloading) {
    manager.reloadTimer -= dt;
    if (manager.reloadTimer <= 0) finishReload(manager);
  }
  for (const t of manager.tracers) t.life -= dt;
  manager.tracers = manager.tracers.filter((t) => t.life > 0);
  const stepCtx = {
    player: ctx.player,
    colliders: ctx.colliders ?? manager.colliders,
    hasLineOfSight: ctx.hasLineOfSight,
    rng: ctx.rng ?? manager.rng ?? { next: () => Math.random() },
    damagePlayer: ctx.damagePlayer,
  };
  for (const e of manager.enemies) stepEnemy(e, dt, stepCtx);
  return manager;
}
