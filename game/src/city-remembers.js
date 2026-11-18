// Cabo Luna — THE CITY REMEMBERS (Day 4D).
// The signature system: the city keeps a memory of what the player did,
// and the police act on that memory instead of on a timer alone.
//
// The complete event chain, link by link (every link is a real mechanic,
// not a label):
//   1. WITNESS — a pedestrian with line-of-sight + range to a crime sees it.
//   2. REPORT — after a delay, a witness who is alive and no longer
//      fleeing reports what was seen (crime type, location, vehicle).
//      A witness who was hit, or is still fleeing when the report is due,
//      reports nothing.
//   3. INVESTIGATE — a report dispatches a patrol unit to the reported
//      location (police.js INVESTIGATE state), distinct from a chase.
//   4. LAST-KNOWN-LOCATION — updated on every police sighting; it stales
//      with age, and the search works off it.
//   5. VEHICLE ID — the police remember the crime vehicle (model +
//      colour). They look for THAT vehicle; a different car is not the
//      target.
//   6. DISTRICT HEAT — each of the 6 districts tracks its own heat from
//      crimes committed there; hotter districts answer faster/harder.
//   7. ESCALATION — district heat + repeat crimes raise the wanted level
//      and the number of pursuing units (within the existing cap of 4).
//   8. SEARCH — losing sight sends units to sweep around the
//      last-known-location (radius + timeout), then back to PATROL.
//   9. VEHICLE SWITCH — stealing a different car while not directly
//      observed breaks the vehicle ID and drops the pursuit to a search.
//  10. GARAGE — driving into the marked garage (Taller Brisa, Luna Vieja)
//      while not directly observed hides the vehicle and breaks pursuit.
//  11. SAFEHOUSE — the Colina Verde safehouse (the M3 endpoint) reduces
//      heat while the player stays unseen inside, and clears wanted after
//      a short stay. Usable outside M3 too.
//  12. HEAT REDUCTION — escape (garage / safehouse / time unseen) brings
//      district heat and wanted DOWN, not only up.
//
// Renderer-free plain data + the seeded clock (memory.elapsed, advanced
// by stepMemory in fixed steps), so Node tests import it directly. No
// per-frame allocation in the hot path: witnesses/reports are small
// arrays, lookups are distance checks.
import { POLICE, wantedFromHeat } from './config.js';
import { districtAtPoint } from './city.js';
import { hasLineOfSight } from './police.js';

export const DISTRICT_NAMES = [
  'Bahia Azul', 'Torre Alta', 'Luna Vieja',
  'Mercado Norte', 'Colina Verde', 'Puerto Luna',
];

// A pedestrian sees a crime this far away, with a clear line of sight.
export const WITNESS_RANGE = 30;
// A witness needs this long before the report goes out — long enough
// that a witness who fled the crime (flee lasts 3 s) has calmed down
// and can still report, but a witness who is STILL fleeing, or was hit,
// at report time reports nothing.
export const REPORT_DELAY = 4;
// Last-known-location goes stale after this long without a sighting;
// the search radius grows with its age.
export const LKL_STALE_AFTER = 20;
export const SEARCH_RADIUS = 14;
// District heat: +crime heat on a crime, -this per second once the
// district has been quiet for DISTRICT_QUIET_AFTER seconds.
export const DISTRICT_DECAY_RATE = 1.5;
export const DISTRICT_QUIET_AFTER = 5;
// Hot districts answer harder: at this heat a district adds one extra
// pursuing unit (still capped at POLICE.maxUnits).
export const DISTRICT_HOT = 60;
// Breaking the vehicle ID costs the pursuit this much global heat.
export const SWITCH_HEAT_DROP = 15;
// Garage escape costs the pursuit this much global + district heat.
export const GARAGE_HEAT_DROP = 20;
// Safehouse: heat drains this fast per second while staying unseen
// inside, and wanted clears after this many continuous seconds.
export const SAFEHOUSE_DRAIN_RATE = 3;
export const SAFEHOUSE_CLEAR_AFTER = 5;
export const SAFEHOUSE_DISTRICT_DROP = 30;

// Taller Brisa — the garage. Centred on the road crossing at (58, 58)
// in Luna Vieja so a car can actually drive into it; radius 9 m.
export const GARAGE = { name: 'Taller Brisa', x: 58, z: 58, radius: 9 };
// The Colina Verde safehouse — the M3 escape_safehouse objective
// (roadX 6, roadZ 2 -> roadLines 162, -46). Same spot, now with a real
// function outside M3 too.
export const SAFEHOUSE = { name: 'Safehouse Colina Verde', x: 162, z: -46, radius: 12 };

export function createMemory(city) {
  const districtHeat = {};
  const districtLastCrime = {};
  for (const name of DISTRICT_NAMES) {
    districtHeat[name] = 0;
    districtLastCrime[name] = -Infinity;
  }
  return {
    city,
    elapsed: 0,
    districtHeat,
    districtLastCrime,
    witnesses: [], // { ped, crime, reportAt, reported, dropped }
    reports: [], // { crime, at }
    lastKnown: null, // { x, z }
    lastKnownAt: -Infinity,
    identifiedVehicle: null, // { id, kind, name, color }
    witnessAlert: '', // 'SEEN' while a fresh report is news
    witnessAlertUntil: 0,
    flash: '', // one-shot banner text ('TRAIL LOST — GARAGE', ...)
    flashUntil: 0,
    safehouseTimer: 0,
    safehouseClears: 0,
    garageEscapes: 0,
    garageCooldownUntil: 0,
    vehicleSwitches: 0,
  };
}

export function resetMemory(memory) {
  const fresh = createMemory(memory.city);
  for (const k of Object.keys(fresh)) memory[k] = fresh[k];
  return memory;
}

export function districtOf(memory, x, z) {
  return districtAtPoint(memory.city, x, z);
}

export function districtHeatOf(memory, name) {
  return memory.districtHeat[name] ?? 0;
}

// Heat pips for the HUD: 0..5.
export function districtHeatLevel(memory, name) {
  return Math.max(0, Math.min(5, Math.round(districtHeatOf(memory, name) / 20)));
}

// Extra pursuing units for a district: 1 once it is hot, else 0.
export function districtResponseBonus(memory, name) {
  return districtHeatOf(memory, name) >= DISTRICT_HOT ? 1 : 0;
}

// Effective wanted level: the higher of the global heat level and the
// heat level of the district the player is standing in. District heat
// is memory — it can hold wanted up after the global heat has decayed,
// and it is what makes repeated crimes in one district escalate.
export function effectiveWanted(memory, heatState, x, z) {
  const district = districtOf(memory, x, z);
  return Math.max(
    heatState.wanted,
    wantedFromHeat(districtHeatOf(memory, district)),
  );
}

export function isInGarage(x, z) {
  return Math.hypot(x - GARAGE.x, z - GARAGE.z) <= GARAGE.radius;
}

export function isInSafehouse(x, z) {
  return Math.hypot(x - SAFEHOUSE.x, z - SAFEHOUSE.z) <= SAFEHOUSE.radius;
}

// --- Link 1: witness detection --------------------------------------
// A pedestrian counts as a witness when they are close enough to the
// crime, have a clear line of sight to it, and were not hit. Peds who
// saw nothing (too far / behind a building / hit) are never recorded.
export function detectWitnesses(memory, peds, crime, colliders = []) {
  const seen = [];
  for (const ped of peds) {
    if (ped.hit) continue;
    const d = Math.hypot(ped.x - crime.x, ped.z - crime.z);
    if (d > WITNESS_RANGE) continue;
    if (!hasLineOfSight(ped.x, ped.z, crime.x, crime.z, colliders)) continue;
    const witness = {
      ped,
      crime: { ...crime },
      reportAt: memory.elapsed + REPORT_DELAY,
      reported: false,
      dropped: false,
    };
    memory.witnesses.push(witness);
    seen.push(witness);
  }
  return seen;
}

// --- Links 2 + 6 + 7: record a crime --------------------------------
// District heat rises in the district where the crime happened, the
// vehicle involved becomes the identified vehicle, witnesses are
// detected, and the wanted level escalates from district heat. This
// does NOT add global heat — the caller (steal / shot / collision)
// already did that; this is the memory side of the same crime.
export function recordCrime(memory, crime, heatState, opts = {}) {
  const district = districtOf(memory, crime.x, crime.z);
  memory.districtHeat[district] = Math.min(
    100, memory.districtHeat[district] + (crime.heat ?? 0),
  );
  memory.districtLastCrime[district] = memory.elapsed;
  if (crime.vehicle) {
    memory.identifiedVehicle = {
      id: crime.vehicle.id,
      kind: crime.vehicle.kind,
      name: crime.vehicle.name ?? crime.vehicle.kind,
      color: crime.vehicle.color,
    };
  }
  // Escalation driven by memory: a hot district holds wanted up.
  heatState.wanted = Math.max(
    heatState.wanted,
    wantedFromHeat(memory.districtHeat[district]),
  );
  let witnesses = [];
  if (opts.peds) {
    witnesses = detectWitnesses(memory, opts.peds, crime, opts.colliders ?? []);
  }
  return { district, witnesses };
}

// --- Link 4: last-known-location -------------------------------------
export function updateSighting(memory, x, z) {
  memory.lastKnown = { x, z };
  memory.lastKnownAt = memory.elapsed;
  return memory.lastKnown;
}

export function lastKnownAge(memory) {
  return memory.lastKnown ? memory.elapsed - memory.lastKnownAt : Infinity;
}

export function isLastKnownStale(memory) {
  return lastKnownAge(memory) > LKL_STALE_AFTER;
}

// Search radius grows as the trail goes cold: the base radius, +1 m
// per 2 s of staleness, capped at twice the base.
export function searchRadiusFor(memory) {
  const age = lastKnownAge(memory);
  if (!Number.isFinite(age)) return SEARCH_RADIUS;
  return Math.min(SEARCH_RADIUS * 2, SEARCH_RADIUS + Math.floor(age / 2));
}

// --- Link 2 (continued): reports + Link 3: investigation ------------
// A due witness reports only if they are alive and no longer fleeing.
// A hit witness, or one still fleeing when the report is due, drops
// the report silently. A successful report dispatches a patrol unit to
// INVESTIGATE the reported location.
export function processReports(memory, police, heatState) {
  const filed = [];
  for (const w of memory.witnesses) {
    if (w.reported || w.dropped) continue;
    if (memory.elapsed < w.reportAt) continue;
    if (w.ped.hit || w.ped.state === 'FLEE') {
      w.dropped = true;
      continue;
    }
    w.reported = true;
    const report = { crime: { ...w.crime }, at: memory.elapsed };
    memory.reports.push(report);
    filed.push(report);
    memory.witnessAlert = 'SEEN';
    memory.witnessAlertUntil = memory.elapsed + 3;
    dispatchInvestigation(memory, police, report, heatState);
  }
  return filed;
}

export function dispatchInvestigation(memory, police, report, heatState) {
  if (!police) return null;
  // Nearest PATROL unit takes the call; a unit already chasing,
  // searching or investigating keeps its job.
  let best = null, bestD = Infinity;
  for (const unit of police.units) {
    if (unit.state !== 'PATROL') continue;
    const d = Math.hypot(unit.car.x - report.crime.x, unit.car.z - report.crime.z);
    if (d < bestD) { best = unit; bestD = d; }
  }
  if (!best) return null;
  best.state = 'INVESTIGATE';
  best.stateTimer = 0;
  best.investigateTarget = { x: report.crime.x, z: report.crime.z };
  best.investigateTimer = 6;
  best.lastKnown = { x: report.crime.x, z: report.crime.z };
  best.waypoints = [];
  best.wpIndex = 0;
  best.replanTimer = 0;
  return best;
}

// --- Link 5 + 9: vehicle identification / switching ------------------
// The police look for the identified vehicle. Stealing a DIFFERENT car
// while not directly observed breaks the ID: the pursuit drops to a
// search around the last-known-location and pressure falls. If the
// switch WAS observed, the police simply learn the new car and the
// pursuit continues. `memory.identifiedVehicle` must still be the OLD
// vehicle when this is called; the caller records the new crime after.
export function onVehicleSwitch(memory, newCar, observed, police, heatState) {
  const old = memory.identifiedVehicle;
  if (!old || old.id === newCar.id) return { switched: false, broke: false };
  memory.vehicleSwitches += 1;
  if (observed) {
    memory.identifiedVehicle = {
      id: newCar.id, kind: newCar.kind,
      name: newCar.name ?? newCar.kind, color: newCar.color,
    };
    return { switched: true, broke: false, observed: true };
  }
  memory.identifiedVehicle = {
    id: newCar.id, kind: newCar.kind,
    name: newCar.name ?? newCar.kind, color: newCar.color,
  };
  // The old car is no longer the target: chasing units lose the trail
  // and fall back to searching where the player was last seen.
  if (police) {
    for (const unit of police.units) {
      if (unit.state === 'CHASE') {
        unit.state = 'SEARCH';
        unit.stateTimer = 0;
        unit.searchTimer = POLICE.searchTime;
        unit.searchTarget = memory.lastKnown ? { ...memory.lastKnown } : null;
        unit.sweepsLeft = 1;
        unit.waypoints = [];
        unit.wpIndex = 0;
      }
    }
  }
  if (heatState) {
    heatState.crimeHeat = Math.max(0, heatState.crimeHeat - SWITCH_HEAT_DROP);
    heatState.wanted = wantedFromHeat(heatState.crimeHeat);
  }
  return { switched: true, broke: true, observed: false };
}

// Is any patrol unit directly observing the player right now — close
// enough and with a clear line of sight? Used to gate garage escapes,
// safehouse stays and vehicle switches: all three only work unseen.
export function isDirectlyObserved(memory, police, player, heatState, colliders = []) {
  if (!police || heatState.wanted <= 0) return false;
  const radius = POLICE.detectRadius[heatState.wanted] ?? 0;
  for (const unit of police.units) {
    const d = Math.hypot(unit.car.x - player.x, unit.car.z - player.z);
    if (d > radius) continue;
    if (hasLineOfSight(unit.car.x, unit.car.z, player.x, player.z, colliders)) return true;
  }
  return false;
}

// --- Link 10: garage escape ------------------------------------------
// Driving into the garage unseen hides the vehicle and breaks the
// pursuit: units return to PATROL, the trail (last-known-location and
// vehicle ID) is wiped, heat falls. Observed, or outside the garage,
// or on cooldown: nothing happens.
export function tryGarageEscape(memory, police, player, heatState, colliders = []) {
  if (!isInGarage(player.x, player.z)) return { escaped: false, reason: 'not-in-garage' };
  if (isDirectlyObserved(memory, police, player, heatState, colliders)) {
    return { escaped: false, reason: 'observed' };
  }
  if (memory.elapsed < memory.garageCooldownUntil) {
    return { escaped: false, reason: 'cooldown' };
  }
  if (heatState.wanted <= 0) return { escaped: false, reason: 'no-heat' };
  if (police) {
    for (const unit of police.units) {
      unit.state = 'PATROL';
      unit.stateTimer = 0;
      unit.lastKnown = null;
      unit.searchTarget = null;
      unit.investigateTarget = null;
      unit.waypoints = [];
      unit.wpIndex = 0;
    }
  }
  memory.lastKnown = null;
  memory.lastKnownAt = -Infinity;
  memory.identifiedVehicle = null;
  memory.garageEscapes += 1;
  memory.garageCooldownUntil = memory.elapsed + 10;
  const district = districtOf(memory, player.x, player.z);
  memory.districtHeat[district] = Math.max(0, memory.districtHeat[district] - GARAGE_HEAT_DROP);
  heatState.crimeHeat = Math.max(0, heatState.crimeHeat - GARAGE_HEAT_DROP);
  heatState.wanted = wantedFromHeat(heatState.crimeHeat);
  memory.flash = 'TRAIL LOST — GARAGE';
  memory.flashUntil = memory.elapsed + 3;
  return { escaped: true };
}

// --- Link 11 + 12: safehouse ------------------------------------------
// Staying unseen inside the safehouse drains heat; after
// SAFEHOUSE_CLEAR_AFTER continuous seconds, wanted clears entirely.
// Leaving, or being observed, resets the stay timer.
export function stepSafehouse(memory, dt, player, heatState, observed) {
  if (heatState.wanted <= 0) { memory.safehouseTimer = 0; return { cleared: false, staying: false }; }
  if (!isInSafehouse(player.x, player.z) || observed) {
    memory.safehouseTimer = 0;
    return { cleared: false, staying: false };
  }
  memory.safehouseTimer += dt;
  heatState.crimeHeat = Math.max(0, heatState.crimeHeat - SAFEHOUSE_DRAIN_RATE * dt);
  heatState.wanted = wantedFromHeat(heatState.crimeHeat);
  const district = districtOf(memory, player.x, player.z);
  memory.districtHeat[district] = Math.max(0, memory.districtHeat[district] - SAFEHOUSE_DRAIN_RATE * dt);
  if (memory.safehouseTimer >= SAFEHOUSE_CLEAR_AFTER) {
    heatState.crimeHeat = 0;
    heatState.wanted = 0;
    memory.districtHeat[district] = Math.max(0, memory.districtHeat[district] - SAFEHOUSE_DISTRICT_DROP);
    memory.safehouseTimer = 0;
    memory.safehouseClears += 1;
    memory.flash = 'HEAT CLEARED — SAFEHOUSE';
    memory.flashUntil = memory.elapsed + 3;
    return { cleared: true, staying: true };
  }
  return { cleared: false, staying: true };
}

// --- Per-tick orchestration -------------------------------------------
// Advances the clock, decays quiet districts, files due reports
// (dispatching investigations), and ticks the safehouse stay. The
// garage is NOT auto-triggered here — main.js calls tryGarageEscape
// explicitly so the escape is a deliberate player action, not a timer.
export function stepMemory(memory, dt, ctx = {}) {
  memory.elapsed += dt;
  if (memory.witnessAlert && memory.elapsed > memory.witnessAlertUntil) {
    memory.witnessAlert = '';
  }
  if (memory.flash && memory.elapsed > memory.flashUntil) memory.flash = '';
  // District heat decay: only districts quiet for DISTRICT_QUIET_AFTER.
  for (const name of DISTRICT_NAMES) {
    if (memory.elapsed - memory.districtLastCrime[name] > DISTRICT_QUIET_AFTER
      && memory.districtHeat[name] > 0) {
      memory.districtHeat[name] = Math.max(0, memory.districtHeat[name] - DISTRICT_DECAY_RATE * dt);
    }
  }
  if (ctx.police && ctx.heatState) processReports(memory, ctx.police, ctx.heatState);
  if (ctx.player && ctx.heatState) {
    const observed = ctx.observed ?? (ctx.police
      ? isDirectlyObserved(memory, ctx.police, ctx.player, ctx.heatState, ctx.colliders ?? [])
      : false);
    stepSafehouse(memory, dt, ctx.player, ctx.heatState, observed);
  }
  return memory;
}

// HUD snapshot: everything the HUD needs, pre-computed, no allocation
// beyond one small object per frame (the HUD already builds one).
export function memoryHud(memory, heatState, x, z) {
  const district = districtOf(memory, x, z);
  return {
    district,
    districtHeat: districtHeatOf(memory, district),
    districtHeatLevel: districtHeatLevel(memory, district),
    witnessAlert: memory.witnessAlert,
    flash: memory.flash,
    lastKnown: memory.lastKnown ? { ...memory.lastKnown } : null,
    lastKnownStale: isLastKnownStale(memory),
    identifiedVehicle: memory.identifiedVehicle ? { ...memory.identifiedVehicle } : null,
    inGarage: isInGarage(x, z),
    inSafehouse: isInSafehouse(x, z),
    safehouseTimer: memory.safehouseTimer,
  };
}
