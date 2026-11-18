// Cabo Luna Day 4D — THE CITY REMEMBERS. Node tests (stdlib only).
// Run: node --test game/tests/city-remembers.test.mjs
// Every link of the event chain is tested, not just the endpoints:
// witness sees -> reports (and does NOT report if shot/fled) ->
// police investigate the report location -> last-known-location updates
// on sighting and stales -> vehicle ID matches the crime vehicle and
// changes on switch -> district heat rises and decays -> escalation
// raises wanted/units -> search uses the last-known-location -> garage
// escape breaks pursuit -> safehouse reduces heat/clears wanted ->
// heat reduction after escape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, buildingColliders, districtAtPoint } from '../src/city.js';
import { makeRng } from '../src/rng.js';
import { STEP, POLICE, wantedFromHeat } from '../src/config.js';
import { buildRoadGraph } from '../src/roadgraph.js';
import { createVehicle, resetVehicleIds } from '../src/vehicles.js';
import {
  createPoliceManager, stepPolice, ensureUnits,
} from '../src/police.js';
import {
  createMemory, resetMemory, recordCrime, detectWitnesses,
  processReports, dispatchInvestigation, updateSighting,
  lastKnownAge, isLastKnownStale, searchRadiusFor,
  districtHeatOf, districtHeatLevel, districtResponseBonus,
  effectiveWanted, isInGarage, isInSafehouse, onVehicleSwitch,
  isDirectlyObserved, tryGarageEscape, stepSafehouse, stepMemory,
  memoryHud, GARAGE, SAFEHOUSE, WITNESS_RANGE, REPORT_DELAY,
  LKL_STALE_AFTER, DISTRICT_HOT,
} from '../src/city-remembers.js';

function setup(seed = 1) {
  resetVehicleIds();
  const city = generateCity(seed);
  const graph = buildRoadGraph(city);
  const colliders = buildingColliders(city);
  const memory = createMemory(city);
  const police = createPoliceManager(graph, city, colliders, makeRng(seed * 97 + 13));
  return { city, graph, colliders, memory, police };
}

function banish(police, x = 400, z = 400) {
  police.units.forEach((u, i) => {
    u.car.x = x + i * 30; u.car.z = z + i * 30;
    u.state = 'PATROL'; u.waypoints = []; u.wpIndex = 0;
  });
}

function ped(x, z, state = 'WALK') {
  return { id: 0, x, z, state, hit: false };
}

// --- Link 1: witness detection --------------------------------------

test('witness: a ped with LOS + range to the crime sees it', () => {
  const { memory } = setup();
  const crime = { type: 'steal', x: 0, z: 110, heat: 25 };
  const peds = [ped(5, 110), ped(100, 110), ped(-20, 110)];
  const seen = detectWitnesses(memory, peds, crime, []);
  assert.equal(seen.length, 2, 'only the two in-range peds see it');
  assert.equal(memory.witnesses.length, 2);
  assert.equal(memory.witnesses[0].crime.type, 'steal');
});

test('witness: a ped behind a building sees nothing, reports nothing', () => {
  const { memory } = setup();
  const wall = [{ minX: 0, maxX: 10, minZ: 100, maxZ: 120 }];
  const crime = { type: 'steal', x: 20, z: 110, heat: 25 };
  const peds = [ped(-5, 110)]; // wall between ped and crime
  const seen = detectWitnesses(memory, peds, crime, wall);
  assert.equal(seen.length, 0);
  assert.equal(memory.witnesses.length, 0);
});

test('witness: a hit ped never becomes a witness', () => {
  const { memory } = setup();
  const crime = { type: 'shooting', x: 0, z: 110, heat: 10 };
  const shot = ped(5, 110); shot.hit = true;
  assert.equal(detectWitnesses(memory, [shot], crime, []).length, 0);
});

// --- Link 2: crime reporting -----------------------------------------

test('report: a calm witness reports after the delay, with the crime details', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const car = createVehicle('sedan', 0, 110, 0);
  ensureUnits(police, 2, 0, 110);
  banish(police);
  const peds = [ped(5, 110)];
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25, vehicle: car }, heat, { peds, colliders: [] });
  assert.equal(memory.reports.length, 0, 'no report before the delay');
  for (let i = 0; i < Math.ceil((REPORT_DELAY + 0.5) / STEP); i++) stepMemory(memory, STEP, { police, heatState: heat });
  assert.equal(memory.reports.length, 1, 'one report filed after the delay');
  assert.equal(memory.reports[0].crime.type, 'steal');
  assert.deepEqual(
    { x: memory.reports[0].crime.x, z: memory.reports[0].crime.z },
    { x: 0, z: 110 },
  );
  assert.equal(memory.reports[0].crime.vehicle.id, car.id, 'report carries the vehicle');
  assert.equal(memory.witnessAlert, 'SEEN');
});

test('report: a witness still fleeing at report time reports nothing', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const peds = [ped(5, 110, 'FLEE')];
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25 }, heat, { peds, colliders: [] });
  assert.equal(memory.witnesses.length, 1, 'fleeing ped still SAW the crime');
  for (let i = 0; i < Math.ceil((REPORT_DELAY + 1) / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
  }
  assert.equal(memory.reports.length, 0, 'still-fleeing witness files nothing');
  assert.equal(memory.witnesses[0].dropped, true);
});

test('report: a witness who was shot after seeing the crime reports nothing', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const peds = [ped(5, 110)];
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25 }, heat, { peds, colliders: [] });
  assert.equal(memory.witnesses.length, 1);
  // The witness is shot before the report goes out.
  memory.witnesses[0].ped.hit = true;
  for (let i = 0; i < Math.ceil((REPORT_DELAY + 1) / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
  }
  assert.equal(memory.reports.length, 0);
  assert.equal(memory.witnesses[0].dropped, true);
});

// --- Link 3: police investigation -------------------------------------

test('investigate: a report dispatches the nearest patrol unit to the crime spot', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  ensureUnits(police, 2, 0, 110);
  banish(police);
  const near = police.units[0];
  near.car.x = -20; near.car.z = 110; // closest to the crime at (0,110)
  const report = { crime: { type: 'steal', x: 0, z: 110, heat: 25 }, at: 0 };
  const unit = dispatchInvestigation(memory, police, report, heat);
  assert.equal(unit, near, 'nearest PATROL unit takes the call');
  assert.equal(near.state, 'INVESTIGATE');
  assert.deepEqual(near.investigateTarget, { x: 0, z: 110 });
});

test('investigate: the unit drives to the report location, then searches', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: 140, z: -140, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(police, 2, 0, 110);
  banish(police);
  const unit = police.units[0];
  unit.car.x = -20; unit.car.z = 110;
  unit.state = 'INVESTIGATE';
  unit.investigateTarget = { x: 0, z: 110 };
  unit.investigateTimer = 6;
  unit.lastKnown = { x: 0, z: 110 };
  unit.waypoints = []; unit.wpIndex = 0;
  const d0 = Math.hypot(unit.car.x - 0, unit.car.z - 110);
  let closest = d0;
  for (let i = 0; i < 600; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
    closest = Math.min(closest, Math.hypot(unit.car.x - 0, unit.car.z - 110));
  }
  assert.ok(closest < 5, `unit must reach the report spot, closest was ${closest.toFixed(1)} m`);
  assert.ok(['SEARCH', 'PATROL'].includes(unit.state), `after investigating, unit searches or patrols, got ${unit.state}`);
});

// --- Link 4: last-known-location --------------------------------------

test('last-known-location: updates on every sighting, stales with age', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(police, 2, player.x, player.z);
  banish(police);
  const cop = police.units[0];
  cop.car.x = -75; cop.car.z = 113;
  assert.equal(memory.lastKnown, null);
  for (let i = 0; i < 60; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.equal(cop.state, 'CHASE');
  assert.deepEqual(memory.lastKnown, { x: -60, z: 113 }, 'sighting sets the LKL');
  assert.equal(isLastKnownStale(memory), false);
  // Player moves unseen; the LKL stays where they were last SEEN.
  player.x = 140; player.z = -140;
  for (let i = 0; i < Math.ceil((LKL_STALE_AFTER + 1) / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.deepEqual(memory.lastKnown, { x: -60, z: 113 }, 'LKL is the last SEEN spot, not the live position');
  assert.ok(lastKnownAge(memory) > LKL_STALE_AFTER);
  assert.equal(isLastKnownStale(memory), true);
  assert.ok(searchRadiusFor(memory) > 14, 'stale LKL widens the search radius');
});

test('last-known-location: updateSighting + staleness helpers agree', () => {
  const { memory } = setup();
  updateSighting(memory, 10, 20);
  assert.deepEqual(memory.lastKnown, { x: 10, z: 20 });
  assert.equal(lastKnownAge(memory), 0);
  memory.elapsed += LKL_STALE_AFTER + 5;
  assert.equal(isLastKnownStale(memory), true);
});

// --- Link 5: vehicle identification ------------------------------------

test('vehicle ID: the crime vehicle (model + colour) is remembered', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 0, wanted: 0 };
  const car = createVehicle('sport', 0, 110, 0);
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25, vehicle: car }, heat, {});
  assert.ok(memory.identifiedVehicle, 'vehicle identified');
  assert.equal(memory.identifiedVehicle.id, car.id);
  assert.equal(memory.identifiedVehicle.kind, 'sport');
  assert.equal(memory.identifiedVehicle.color, car.color);
  assert.equal(memory.identifiedVehicle.name, 'Brisa GT');
});

test('vehicle ID: police do not chase a DIFFERENT car — sighting does not count', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const stolen = createVehicle('sedan', -60, 113, Math.PI / 2);
  const other = createVehicle('sport', -60, 113, Math.PI / 2);
  memory.identifiedVehicle = { id: stolen.id, kind: 'sedan', name: 'Solano', color: stolen.color };
  ensureUnits(police, 2, -60, 113);
  banish(police);
  const cop = police.units[0];
  cop.car.x = -75; cop.car.z = 113;
  // Player drives the OTHER car right past the cop, in the open.
  for (let i = 0; i < 120; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, {
      x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: other,
    }, heat, memory);
  }
  assert.notEqual(cop.state, 'CHASE', `wrong car must not trigger a chase, got ${cop.state}`);
  assert.equal(memory.lastKnown, null, 'no sighting recorded for the wrong car');
  // Same cop, same spot — now in the IDENTIFIED car: chase.
  for (let i = 0; i < 60; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, {
      x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: stolen,
    }, heat, memory);
  }
  assert.equal(cop.state, 'CHASE');
});

// --- Link 6: district heat ---------------------------------------------

test('district heat: rises on crime in that district only, and decays when quiet', () => {
  const { city, memory } = setup();
  const heat = { crimeHeat: 0, wanted: 0 };
  // (0, 140) is Puerto Luna (south row); (-20, 84) is the Luna Vieja plaza.
  const dSouth = districtAtPoint(city, 0, 140);
  const dPlaza = districtAtPoint(city, -20, 84);
  assert.notEqual(dSouth, dPlaza);
  recordCrime(memory, { type: 'steal', x: 0, z: 140, heat: 25 }, heat, {});
  assert.equal(districtHeatOf(memory, dSouth), 25);
  assert.equal(districtHeatOf(memory, dPlaza), 0, 'other districts are untouched');
  assert.equal(districtHeatLevel(memory, dSouth), 1);
  // Quiet for 25 s: 5 s quiet window, then 1.5/s drains the 25 heat.
  for (let i = 0; i < Math.ceil(25 / STEP); i++) stepMemory(memory, STEP, {});
  assert.equal(districtHeatOf(memory, dSouth), 0);
  // A fresh crime restarts the quiet clock: no decay inside the window.
  recordCrime(memory, { type: 'steal', x: 0, z: 140, heat: 25 }, heat, {});
  for (let i = 0; i < Math.ceil(4 / STEP); i++) stepMemory(memory, STEP, {});
  assert.equal(districtHeatOf(memory, dSouth), 25, 'no decay while the district is still hot from a fresh crime');
});

test('district heat: all six districts tracked independently', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 0, wanted: 0 };
  const spots = {
    'Bahia Azul': [-140, 0], 'Torre Alta': [6, -20], 'Luna Vieja': [-20, 84],
    'Mercado Norte': [0, -120], 'Colina Verde': [140, 0], 'Puerto Luna': [0, 140],
  };
  for (const [name, [x, z]] of Object.entries(spots)) {
    const got = districtAtPoint(memory.city, x, z);
    assert.equal(got, name, `spot (${x},${z}) should be ${name}, got ${got}`);
    recordCrime(memory, { type: 'collision', x, z, heat: 10 }, heat, {});
    assert.equal(districtHeatOf(memory, name), 10);
  }
});

// --- Link 7: pursuit escalation ----------------------------------------

test('escalation: district heat raises wanted and adds a pursuing unit', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  // Three crimes in the same district push it to 75 heat (wanted 4).
  for (let i = 0; i < 3; i++) {
    recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25 }, heat, {});
  }
  const district = districtAtPoint(memory.city, 0, 110);
  assert.equal(districtHeatOf(memory, district), 75);
  assert.equal(effectiveWanted(memory, heat, 0, 110), 4, 'district heat escalates wanted to 4');
  assert.equal(districtResponseBonus(memory, district), 1, 'hot district adds a unit');
  assert.ok(75 >= DISTRICT_HOT);
  ensureUnits(police, effectiveWanted(memory, heat, 0, 110), 0, 110, memory);
  assert.equal(police.units.length, 4, 'wanted 4 + hot-district bonus caps at 4 units');
  // A cool district at the same global heat adds nothing.
  const cool = districtAtPoint(memory.city, -140, 0);
  assert.equal(districtResponseBonus(memory, cool), 0);
});

test('escalation: wantedFromHeat still gates the base levels', () => {
  assert.equal(wantedFromHeat(0), 0);
  assert.equal(wantedFromHeat(25), 2);
  assert.equal(wantedFromHeat(100), 5);
});

// --- Link 8: search uses the last-known-location ------------------------

test('search: losing sight sends units to sweep the last-known-location, then patrol', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const player = { x: -60, z: 113, speed: 0, vx: 0, vz: 0, car: null };
  ensureUnits(police, 2, player.x, player.z);
  banish(police);
  const cop = police.units[0];
  cop.car.x = -75; cop.car.z = 113;
  for (let i = 0; i < 60; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.equal(cop.state, 'CHASE');
  assert.deepEqual(memory.lastKnown, { x: -60, z: 113 });
  // Player vanishes.
  player.x = 140; player.z = -140;
  for (let i = 0; i < Math.ceil((POLICE.unseenGrace + 0.5) / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.equal(cop.state, 'SEARCH');
  assert.deepEqual(cop.searchTarget ?? cop.lastKnown, { x: -60, z: 113 },
    'search anchors on the last-known-location, not the live position');
  // The unit must actually travel toward the LKL, not stand still.
  const dBefore = Math.hypot(cop.car.x + 60, cop.car.z - 113);
  for (let i = 0; i < 120; i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  const dAfter = Math.hypot(cop.car.x + 60, cop.car.z - 113);
  assert.ok(dAfter < dBefore, `search must close on the LKL: ${dBefore.toFixed(1)} -> ${dAfter.toFixed(1)}`);
  for (let i = 0; i < Math.ceil((POLICE.searchTime + 2) / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.equal(cop.state, 'PATROL', `search must expire back to PATROL, got ${cop.state}`);
});

// --- Link 9: vehicle switching ------------------------------------------

test('vehicle switch: unseen switch breaks the ID and drops the chase to a search', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const stolen = createVehicle('sedan', -60, 113, Math.PI / 2);
  const other = createVehicle('sport', -60, 113, Math.PI / 2);
  memory.identifiedVehicle = { id: stolen.id, kind: 'sedan', name: 'Solano', color: stolen.color };
  updateSighting(memory, -60, 113);
  ensureUnits(police, 2, -60, 113);
  banish(police);
  const cop = police.units[0];
  cop.car.x = -75; cop.car.z = 113;
  cop.state = 'CHASE'; cop.unseenTimer = 0;
  cop.lastKnown = { x: -60, z: 113 };
  const res = onVehicleSwitch(memory, other, false, police, heat);
  assert.equal(res.switched, true);
  assert.equal(res.broke, true, 'unseen switch must break the pursuit');
  assert.equal(memory.identifiedVehicle.id, other.id, 'the new car is now the identified vehicle');
  assert.equal(cop.state, 'SEARCH', 'chasing unit drops to SEARCH');
  assert.equal(heat.crimeHeat, 10, 'pressure drops 25 -> 10');
  assert.equal(heat.wanted, 1);
});

test('vehicle switch: observed switch only re-identifies the new car, chase continues', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const stolen = createVehicle('sedan', -60, 113, Math.PI / 2);
  const other = createVehicle('sport', -60, 113, Math.PI / 2);
  memory.identifiedVehicle = { id: stolen.id, kind: 'sedan', name: 'Solano', color: stolen.color };
  ensureUnits(police, 2, -60, 113);
  banish(police);
  const cop = police.units[0];
  cop.state = 'CHASE';
  const res = onVehicleSwitch(memory, other, true, police, heat);
  assert.equal(res.broke, false, 'observed switch does not break the pursuit');
  assert.equal(cop.state, 'CHASE');
  assert.equal(memory.identifiedVehicle.id, other.id, 'police learn the new car');
  assert.equal(heat.crimeHeat, 25, 'no heat drop when observed');
});

// --- Link 10: garage escape ---------------------------------------------

test('garage: driving in unseen breaks the pursuit and wipes the trail', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 45, wanted: 3 };
  assert.ok(isInGarage(GARAGE.x, GARAGE.z));
  assert.ok(!isInGarage(0, 0));
  memory.identifiedVehicle = { id: 99, kind: 'sedan', name: 'Solano', color: 0x111111 };
  updateSighting(memory, GARAGE.x, GARAGE.z);
  ensureUnits(police, 3, GARAGE.x, GARAGE.z);
  banish(police);
  police.units[0].state = 'CHASE';
  police.units[0].lastKnown = { x: GARAGE.x, z: GARAGE.z };
  const res = tryGarageEscape(memory, police, { x: GARAGE.x, z: GARAGE.z }, heat, []);
  assert.equal(res.escaped, true);
  assert.equal(police.units[0].state, 'PATROL', 'pursuit breaks to PATROL');
  assert.equal(memory.lastKnown, null, 'the trail is wiped');
  assert.equal(memory.identifiedVehicle, null, 'the vehicle ID is wiped');
  assert.equal(heat.crimeHeat, 25, 'heat drops 45 -> 25');
  assert.equal(heat.wanted, 2);
  assert.equal(memory.garageEscapes, 1);
  assert.equal(memory.flash, 'TRAIL LOST — GARAGE');
});

test('garage: observed entry does NOT break the pursuit', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 45, wanted: 3 };
  ensureUnits(police, 3, GARAGE.x, GARAGE.z);
  banish(police);
  const cop = police.units[0];
  cop.car.x = GARAGE.x - 10; cop.car.z = GARAGE.z; // 10 m away, open sight
  cop.state = 'CHASE';
  assert.equal(isDirectlyObserved(memory, police, { x: GARAGE.x, z: GARAGE.z }, heat, []), true);
  const res = tryGarageEscape(memory, police, { x: GARAGE.x, z: GARAGE.z }, heat, []);
  assert.equal(res.escaped, false);
  assert.equal(res.reason, 'observed');
  assert.equal(cop.state, 'CHASE');
  assert.equal(heat.crimeHeat, 45, 'no heat drop when observed');
});

// --- Links 11 + 12: safehouse + heat reduction --------------------------

test('safehouse: staying unseen clears wanted and drops district heat', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 45, wanted: 3 };
  assert.ok(isInSafehouse(SAFEHOUSE.x, SAFEHOUSE.z));
  assert.ok(!isInSafehouse(0, 0));
  // The safehouse sits in Colina Verde — heat it first.
  recordCrime(memory, { type: 'steal', x: SAFEHOUSE.x, z: SAFEHOUSE.z, heat: 25 }, heat, {});
  const district = districtAtPoint(memory.city, SAFEHOUSE.x, SAFEHOUSE.z);
  assert.equal(district, 'Colina Verde');
  assert.equal(districtHeatOf(memory, district), 25);
  let cleared = false;
  for (let i = 0; i < Math.ceil(6 / STEP); i++) {
    const r = stepSafehouse(memory, STEP, { x: SAFEHOUSE.x, z: SAFEHOUSE.z }, heat, false);
    if (r.cleared) cleared = true;
  }
  assert.equal(cleared, true, '5 s unseen in the safehouse clears wanted');
  assert.equal(heat.crimeHeat, 0);
  assert.equal(heat.wanted, 0);
  assert.equal(districtHeatOf(memory, district), 0, 'safehouse clear also drops district heat');
  assert.equal(memory.safehouseClears, 1);
  assert.equal(memory.flash, 'HEAT CLEARED — SAFEHOUSE');
});

test('safehouse: leaving, or being observed, resets the stay timer', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 45, wanted: 3 };
  for (let i = 0; i < Math.ceil(3 / STEP); i++) {
    stepSafehouse(memory, STEP, { x: SAFEHOUSE.x, z: SAFEHOUSE.z }, heat, false);
  }
  assert.ok(memory.safehouseTimer > 2, 'stay accumulates while inside unseen');
  const r = stepSafehouse(memory, STEP, { x: 0, z: 0 }, heat, false);
  assert.equal(r.staying, false);
  assert.equal(memory.safehouseTimer, 0, 'leaving resets the stay');
  for (let i = 0; i < Math.ceil(3 / STEP); i++) {
    stepSafehouse(memory, STEP, { x: SAFEHOUSE.x, z: SAFEHOUSE.z }, heat, false);
  }
  stepSafehouse(memory, STEP, { x: SAFEHOUSE.x, z: SAFEHOUSE.z }, heat, true);
  assert.equal(memory.safehouseTimer, 0, 'being observed resets the stay');
  assert.ok(heat.wanted > 0, 'no clear without a full unseen stay');
});

test('safehouse: partial stay still drains heat (reduction, not only clear)', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 40, wanted: 2 };
  for (let i = 0; i < Math.ceil(2 / STEP); i++) {
    stepSafehouse(memory, STEP, { x: SAFEHOUSE.x, z: SAFEHOUSE.z }, heat, false);
  }
  assert.ok(heat.crimeHeat < 40 && heat.crimeHeat > 30, `2 s stay should drain ~6 heat, got ${heat.crimeHeat}`);
  assert.equal(heat.wanted, 2, 'not cleared yet — only drained');
});

// --- Link 12 (general): heat goes DOWN through play ----------------------

test('heat reduction: time unseen + garage + district decay bring heat to zero', () => {
  const { memory, police } = setup();
  const heat = { crimeHeat: 45, wanted: 3 };
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25 }, heat, {});
  const district = districtAtPoint(memory.city, 0, 110);
  assert.ok(districtHeatOf(memory, district) > 0);
  // Garage escape first: -20 global + -20 district.
  ensureUnits(police, 3, GARAGE.x, GARAGE.z);
  banish(police);
  const g = tryGarageEscape(memory, police, { x: GARAGE.x, z: GARAGE.z }, heat, []);
  assert.equal(g.escaped, true);
  assert.ok(heat.crimeHeat < 45);
  // Then quiet time decays the rest (police decay needs nobody seeing
  // the player; district decay needs the district quiet).
  const player = { x: 140, z: -140, speed: 0, vx: 0, vz: 0, car: null };
  for (let i = 0; i < Math.ceil(30 / STEP); i++) {
    stepMemory(memory, STEP, { police, heatState: heat, player, colliders: [] });
    stepPolice(police, STEP, player, heat, memory);
  }
  assert.equal(heat.crimeHeat, 0);
  assert.equal(heat.wanted, 0);
  assert.equal(districtHeatOf(memory, district), 0);
});

// --- HUD snapshot + reset -------------------------------------------------

test('memoryHud: snapshot carries district heat, LKL, vehicle and escapes', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  const car = createVehicle('sport', 0, 140, 0);
  recordCrime(memory, { type: 'steal', x: 0, z: 140, heat: 25, vehicle: car }, heat, {});
  updateSighting(memory, 5, 115);
  const snap = memoryHud(memory, heat, 0, 140);
  assert.equal(snap.district, 'Puerto Luna');
  assert.equal(snap.districtHeat, 25);
  assert.equal(snap.districtHeatLevel, 1);
  assert.deepEqual(snap.lastKnown, { x: 5, z: 115 });
  assert.equal(snap.identifiedVehicle.kind, 'sport');
  assert.equal(snap.inGarage, false);
  const atGarage = memoryHud(memory, heat, GARAGE.x, GARAGE.z);
  assert.equal(atGarage.inGarage, true);
  const atHouse = memoryHud(memory, heat, SAFEHOUSE.x, SAFEHOUSE.z);
  assert.equal(atHouse.inSafehouse, true);
});

test('resetMemory: a fresh run wipes witnesses, reports, heat and trail', () => {
  const { memory } = setup();
  const heat = { crimeHeat: 25, wanted: 2 };
  recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25 }, heat, { peds: [ped(5, 110)], colliders: [] });
  updateSighting(memory, 0, 110);
  assert.ok(memory.witnesses.length > 0);
  resetMemory(memory);
  assert.equal(memory.witnesses.length, 0);
  assert.equal(memory.reports.length, 0);
  assert.equal(memory.lastKnown, null);
  assert.equal(memory.identifiedVehicle, null);
  assert.equal(districtHeatOf(memory, 'Puerto Luna'), 0);
  assert.equal(memory.elapsed, 0);
});

test('determinism: the same crime sequence gives the same memory state', () => {
  function run() {
    const { memory } = setup();
    const heat = { crimeHeat: 0, wanted: 0 };
    const car = createVehicle('sedan', 0, 110, 0);
    recordCrime(memory, { type: 'steal', x: 0, z: 110, heat: 25, vehicle: car }, heat, { peds: [ped(5, 110)], colliders: [] });
    for (let i = 0; i < 600; i++) stepMemory(memory, STEP, {});
    return JSON.stringify([memory.districtHeat, memory.reports.length, memory.lastKnown, heat]);
  }
  assert.equal(run(), run());
});
