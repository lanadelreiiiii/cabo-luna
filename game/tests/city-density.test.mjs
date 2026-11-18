// Day 4C — world density + visual grades. City data is deterministic
// and renderer-free, so these run in Node against generateCity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/city.js';
import { VISUAL_GRADES, GRADE_NAMES, DEFAULT_GRADE, gradeFor } from '../src/visual-grades.js';

test('density: all prop arrays are populated', () => {
  const city = generateCity(1);
  assert.ok(city.shops.length >= 15, `shops ${city.shops.length}`);
  assert.ok(city.trees.length >= 15, `trees ${city.trees.length}`);
  assert.ok(city.benches.length >= 5, `benches ${city.benches.length}`);
  assert.ok(city.planters.length >= 10, `planters ${city.planters.length}`);
  assert.ok(city.parkedCars.length >= 20, `parked cars ${city.parkedCars.length}`);
  assert.ok(city.laneDashes.length >= 150, `lane dashes ${city.laneDashes.length}`);
  assert.ok(city.crosswalks.length >= 200, `crosswalk stripes ${city.crosswalks.length}`);
  assert.ok(city.stopLines.length >= 50, `stop lines ${city.stopLines.length}`);
  assert.ok(city.signs.length >= 10, `street signs ${city.signs.length}`);
  assert.ok(city.crates.length >= 15, `crates ${city.crates.length}`);
  assert.ok(city.containers.length >= 6, `containers ${city.containers.length}`);
  assert.ok(city.bollards.length >= 5, `bollards ${city.bollards.length}`);
  assert.ok(city.buoys.length >= 4, `buoys ${city.buoys.length}`);
  assert.ok(city.hills.length >= 6, `hills ${city.hills.length}`);
  assert.equal(city.lamps.length, 49, `lamps ${city.lamps.length}`);
});

test('density: generation is deterministic for one seed', () => {
  const a = JSON.stringify(generateCity(1));
  const b = JSON.stringify(generateCity(1));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(generateCity(2)));
});

test('density: props stay inside the city and off the drive road', () => {
  const city = generateCity(1);
  const inBounds = (x, z) => x >= -city.half - 30 && x <= city.half + 5
    && z >= -city.half - 5 && z <= city.half + 5;
  for (const p of [...city.shops, ...city.trees, ...city.benches, ...city.planters]) {
    assert.ok(inBounds(p.x, p.z), `prop out of bounds ${p.x},${p.z}`);
  }
  // Decor parked cars never sit in the south drive road's band
  // (z = 104..116), where the stealable parked cars live, and never
  // inside a building.
  for (const c of city.parkedCars) {
    assert.ok(c.z < 104 || c.z > 116,
      `decor parked car in the drive-road band at ${c.x},${c.z}`);
    assert.ok(inBounds(c.x, c.z), `parked car out of bounds ${c.x},${c.z}`);
  }
  for (const c of city.parkedCars) {
    for (const b of city.buildings) {
      const inside = c.x > b.x - b.w / 2 && c.x < b.x + b.w / 2
        && c.z > b.z - b.d / 2 && c.z < b.z + b.d / 2;
      assert.ok(!inside, `parked car inside building at ${c.x},${c.z}`);
    }
  }
});

test('density: shops have original names and face the road', () => {
  const city = generateCity(1);
  for (const s of city.shops) {
    assert.ok(typeof s.name === 'string' && s.name.length >= 4, `bad shop name ${s.name}`);
    assert.ok(s.name === s.name.toUpperCase(), `shop name not uppercase ${s.name}`);
    assert.ok(Number.isInteger(s.awning), 'shop awning colour missing');
  }
  const names = new Set(city.shops.map((s) => s.name));
  assert.ok(names.size >= 6, `only ${names.size} distinct shop names`);
});

test('density: districts read differently in the skyline', () => {
  const city = generateCity(1);
  const meanH = (kind) => {
    const list = city.buildings.filter((b) => b.kind === kind);
    return list.reduce((n, b) => n + b.h, 0) / list.length;
  };
  assert.ok(meanH('downtown') > meanH('harbour') * 2,
    `downtown ${meanH('downtown')} vs harbour ${meanH('harbour')}`);
  assert.ok(meanH('downtown') > meanH('market') * 2,
    `downtown ${meanH('downtown')} vs market ${meanH('market')}`);
  // Every building carries a roof treatment from its district.
  for (const b of city.buildings) {
    assert.ok(['cap', 'gable', 'flat'].includes(b.roof), `bad roof ${b.roof}`);
    assert.ok(Number.isInteger(b.roofColor), 'roof colour missing');
  }
  const roofs = new Set(city.buildings.map((b) => b.roof));
  assert.ok(roofs.size === 3, `roof types ${[...roofs]}`);
});

test('density: lamps are staggered, not all on one corner', () => {
  const city = generateCity(1);
  // Corner of each lamp relative to its intersection: with the old
  // layout every lamp sat at (+6.6, +6.6); the staggered layout must
  // use all four corner signs.
  const signs = new Set(city.lamps.map((l) => {
    const lx = city.roadLines.reduce((best, line) => (Math.abs(line - l.x) < Math.abs(best - l.x) ? line : best), city.roadLines[0]);
    const lz = city.roadLines.reduce((best, line) => (Math.abs(line - l.z) < Math.abs(best - l.z) ? line : best), city.roadLines[0]);
    return `${Math.sign(l.x - lx)},${Math.sign(l.z - lz)}`;
  }));
  assert.ok(signs.size === 4, `lamp corners used: ${[...signs]}`);
});

test('grades: three distinct configurations, sunset is the default', () => {
  assert.deepEqual([...GRADE_NAMES].sort(), ['golden', 'haze', 'sunset']);
  assert.equal(DEFAULT_GRADE, 'sunset');
  for (const name of GRADE_NAMES) {
    const g = VISUAL_GRADES[name];
    assert.ok(Number.isInteger(g.sun.color) && g.sun.intensity > 0, `${name} sun`);
    assert.ok(g.fog.near < g.fog.far, `${name} fog range`);
    assert.ok(g.exposure >= 0.9 && g.exposure <= 1.2, `${name} exposure`);
  }
  // The three grades must actually differ (sun colour + fog + exposure).
  const suns = new Set(GRADE_NAMES.map((n) => VISUAL_GRADES[n].sun.color));
  assert.equal(suns.size, 3, 'grades share a sun colour');
  const exposures = new Set(GRADE_NAMES.map((n) => VISUAL_GRADES[n].exposure));
  assert.equal(exposures.size, 3, 'grades share an exposure');
  assert.equal(gradeFor('nope').label, VISUAL_GRADES.sunset.label, 'unknown grade falls back to sunset');
  assert.equal(gradeFor('golden').label, 'Golden-Hour');
});
