// Cabo Luna — deterministic procedural city.
// A 6x6 road grid on a sunset bay: the ocean and its beach run along the
// west edge, six named districts fill the grid by zone, and every value
// flows from the seeded RNG, so one seed always builds one city.
import { makeRng } from './rng.js';
import { CITY } from './config.js';

// District per zone: west = beachfront, centre = towers, south = harbour,
// north = market, east = hillside homes, middle-south = the old town.
export const DISTRICTS = [
  { name: 'Bahia Azul', kind: 'beach' },
  { name: 'Torre Alta', kind: 'downtown' },
  { name: 'Luna Vieja', kind: 'oldtown' },
  { name: 'Mercado Norte', kind: 'market' },
  { name: 'Colina Verde', kind: 'hills' },
  { name: 'Puerto Luna', kind: 'harbour' },
];

export const STREETS_X = [
  'Avenida del Sol', 'Calle Farol', 'Calle Brisa', 'Calle Arena',
  'Avenida Mirador', 'Calle Nube', 'Paseo del Faro',
];
export const STREETS_Z = [
  'Paseo de las Palmas', 'Calle Luna', 'Calle Coral', 'Calle Marea',
  'Avenida Bahia', 'Calle Vela', 'Calle Ancla',
];

const PALETTES = {
  beach: [0xe8d9b0, 0xf2e3c2, 0xdcc49a, 0xeadfc8],
  downtown: [0x9aa7b5, 0x7d8ea0, 0xb5a48c, 0x8b93a5, 0xc2b49a],
  oldtown: [0xd9a05b, 0xc98a4b, 0xe0b070, 0xb57a45, 0xd4c08a],
  market: [0xc97f6a, 0xb56a5e, 0xd99a6b, 0xa85f52],
  hills: [0xe5d9c3, 0xd2c4a8, 0xf0e6d2, 0xc9b795],
  harbour: [0x8fa3a8, 0x7a8f96, 0xa8b5b0, 0x6f858c],
};

// Roof treatment per district kind: downtown towers get a stepped cap,
// old town / hills / beach get a pitched (gable) roof, market and
// harbour warehouses stay flat. Roof colours are darker than the walls.
const ROOFS = {
  beach: { type: 'gable', colors: [0xc96f4a, 0xb55f3d, 0xd98a5a] },
  downtown: { type: 'cap', colors: [0x5a6a7a, 0x6a5a4a, 0x4a5568] },
  oldtown: { type: 'gable', colors: [0xa8542f, 0x96482a, 0xb5653a] },
  market: { type: 'flat', colors: [0x8a5a4a, 0x7a4a3e, 0x9a6a55] },
  hills: { type: 'gable', colors: [0x9a7a55, 0x8a6a48, 0xa8885f] },
  harbour: { type: 'flat', colors: [0x5a6a6e, 0x4a5a5e, 0x6a7a7e] },
};

// Building footprint / height ranges per district, so each district's
// skyline reads differently: towers centre, low wide warehouses south,
// small shops north, stepped houses east, pastel beachfront west.
const FORMS = {
  beach: { w: [9, 15], d: [8, 14], h: [5, 11] },
  downtown: { w: [8, 14], d: [8, 14], h: [18, 46] },
  oldtown: { w: [8, 16], d: [8, 15], h: [6, 13] },
  market: { w: [10, 18], d: [8, 14], h: [5, 9] },
  hills: { w: [8, 15], d: [8, 14], h: [6, 12] },
  harbour: { w: [14, 22], d: [10, 16], h: [6, 12] },
};

// Original shop names per district — storefronts face the nearest road.
const SHOP_NAMES = {
  beach: ['CAFÉ LUNA', 'HELADERÍA BRISA', 'SURF SOL', 'BAR EL FARO'],
  downtown: ['TIENDA LUNA', 'FARMACIA SOL', 'CAFÉ ARENA', 'LIBRERÍA VELA'],
  oldtown: ['BAR EL FARO', 'LIBRERÍA ARENA', 'FARMACIA SOL', 'PANADERÍA SOL'],
  market: ['MERCADO SOL', 'PANADERÍA SOL', 'FLORERÍA ROSA', 'CARNICERÍA MAR'],
  hills: ['PANADERÍA SOL', 'FLORERÍA ROSA', 'TIENDA LUNA', 'CAFÉ LUNA'],
  harbour: ['PESCADERÍA MAR', 'BODEGA LUNA', 'TALLER BRISA', 'TACOS DEL MAR'],
};
const AWNING_COLORS = [0xd94f3d, 0x3d6fb4, 0x3d8a5a, 0xc9a13d, 0x8a5fbf, 0xe87a2c];

function districtAt(bx, bz, blocks) {
  // West column hugs the beach, centre column rises into towers.
  if (bx === 0) return DISTRICTS[0]; // Bahia Azul
  if (bx === 2 && bz === 4) return DISTRICTS[2]; // Luna Vieja plaza block
  if (bx === 2 && bz >= 2 && bz <= 3) return DISTRICTS[1]; // Torre Alta
  if (bz >= blocks - 2) return DISTRICTS[5]; // Puerto Luna, south harbour
  if (bz === 0) return DISTRICTS[3]; // Mercado Norte
  if (bx >= blocks - 2) return DISTRICTS[4]; // Colina Verde
  return DISTRICTS[2]; // Luna Vieja fills the rest
}

export function generateCity(seed = CITY.seed) {
  const blocks = CITY.blocks;
  const blockSize = CITY.blockSize;
  const roadWidth = CITY.roadWidth;
  const cell = blockSize + roadWidth;
  const half = (blocks * cell) / 2;
  const size = blocks * cell + roadWidth;
  const rng = makeRng(seed);

  // Road centre lines, outer ring included: 7 lines for 6 blocks.
  const roadLines = [];
  for (let i = 0; i <= blocks; i++) roadLines.push(+(-half + roadWidth / 2 + i * cell).toFixed(3));

  const buildings = [];
  const palms = [];
  const lamps = [];
  const plazas = [];
  // Density props (Day 4C): all placed deterministically from the same
  // seeded RNG, all intentional — shops on block edges facing a road,
  // trees/benches/planters on sidewalks, parked cars in bays on roads
  // other than the south drive road, harbour clutter in Puerto Luna.
  const shops = [];
  const trees = [];
  const benches = [];
  const planters = [];
  const parkedCars = [];
  const crates = [];
  const containers = [];
  const bollards = [];
  const buoys = [];
  const signs = [];
  const hills = [];
  const laneDashes = [];
  const crosswalks = [];
  const stopLines = [];

  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const cx = -half + roadWidth + blockSize / 2 + bx * cell;
      const cz = -half + roadWidth + blockSize / 2 + bz * cell;
      const district = districtAt(bx, bz, blocks);
      const palette = PALETTES[district.kind];

      // The plaza of Luna Vieja: one open block with a fountain court
      // instead of buildings — the on-foot play shot lives here.
      if (district.kind === 'oldtown' && bx === 2 && bz === 4) {
        plazas.push({ x: +cx.toFixed(3), z: +cz.toFixed(3), size: blockSize, name: 'Plaza del Reloj' });
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          palms.push({ x: +(cx + Math.cos(a) * 13).toFixed(3), z: +(cz + Math.sin(a) * 13).toFixed(3), h: +(rng.range(5, 7)).toFixed(3) });
        }
        continue;
      }

      // Harbour blocks get more buildings: wide warehouses leave a
      // 40 m slab mostly bare with only 1-2 buildings on it.
      const count = district.kind === 'harbour' ? rng.int(2, 4) : rng.int(1, 4);
      for (let k = 0; k < count; k++) {
        const form = FORMS[district.kind];
        const w = +rng.range(form.w[0], form.w[1]).toFixed(3);
        const d = +rng.range(form.d[0], form.d[1]).toFixed(3);
        const ox = +rng.range(-blockSize / 2 + w / 2 + 1, blockSize / 2 - w / 2 - 1).toFixed(3);
        const oz = +rng.range(-blockSize / 2 + d / 2 + 1, blockSize / 2 - d / 2 - 1).toFixed(3);
        const h = +(rng.range(form.h[0], form.h[1])).toFixed(3);
        const roof = ROOFS[district.kind];
        buildings.push({
          x: +(cx + ox).toFixed(3), z: +(cz + oz).toFixed(3),
          w, d, h,
          district: district.name, kind: district.kind,
          color: palette[rng.int(0, palette.length - 1)],
          roof: roof.type,
          roofColor: roof.colors[rng.int(0, roof.colors.length - 1)],
          blockX: bx, blockZ: bz,
        });
      }

      // Palms line the beachfront blocks; a couple shade the other blocks.
      const palmCount = district.kind === 'beach' ? rng.int(4, 6) : rng.int(0, 2);
      for (let k = 0; k < palmCount; k++) {
        palms.push({
          x: +(cx + rng.range(-blockSize / 2 + 2, blockSize / 2 - 2)).toFixed(3),
          z: +(cz + rng.range(-blockSize / 2 + 2, blockSize / 2 - 2)).toFixed(3),
          h: +(rng.range(5, 8)).toFixed(3),
        });
      }

      // Shopfront on the block edge facing the nearest road (south edge
      // for most blocks): awning + sign board + painted name. One shop
      // per block at most, so the street reads as shops, not a mall.
      if (rng.next() < 0.75) {
        const names = SHOP_NAMES[district.kind];
        const sx = +(cx + rng.range(-12, 12)).toFixed(3);
        const sz = +(cz + blockSize / 2 - 1.5).toFixed(3);
        shops.push({
          x: sx, z: sz, heading: 0, // faces south (+z), toward the road below
          name: names[rng.int(0, names.length - 1)],
          awning: AWNING_COLORS[rng.int(0, AWNING_COLORS.length - 1)],
          district: district.name, kind: district.kind,
        });
      }

      // Broadleaf trees shade the hills / old town / market blocks.
      if (district.kind === 'hills' || district.kind === 'oldtown' || district.kind === 'market') {
        const treeCount = rng.int(1, 2);
        for (let k = 0; k < treeCount; k++) {
          trees.push({
            x: +(cx + rng.range(-blockSize / 2 + 3, blockSize / 2 - 3)).toFixed(3),
            z: +(cz + rng.range(-blockSize / 2 + 3, blockSize / 2 - 3)).toFixed(3),
            h: +(rng.range(3.5, 5.5)).toFixed(3),
            canopy: [0x4a7a3a, 0x5a8a42, 0x3f7046][rng.int(0, 2)],
          });
        }
      }

      // Street furniture on the south sidewalk: benches near the plaza,
      // market and beachfront; planters everywhere else, one per block.
      const furnZ = +(cz + blockSize / 2 - 1.2).toFixed(3); // sidewalk centre, south edge
      if (district.kind === 'beach' || district.kind === 'market' || (bx === 2 && bz === 4)) {
        benches.push({ x: +(cx + rng.range(-10, 10)).toFixed(3), z: furnZ, heading: Math.PI });
      } else {
        planters.push({ x: +(cx + rng.range(-12, 12)).toFixed(3), z: furnZ });
      }

      // Harbour clutter: crates and containers stacked inside Puerto
      // Luna blocks, bollards along the water edge of the south row.
      if (district.kind === 'harbour') {
        const crateCount = rng.int(3, 5);
        for (let k = 0; k < crateCount; k++) {
          crates.push({
            x: +(cx + rng.range(-14, 14)).toFixed(3),
            z: +(cz + rng.range(-14, 14)).toFixed(3),
            s: +(rng.range(1.2, 2.2)).toFixed(3),
          });
        }
        // At least one container per harbour block, sometimes two.
        const contCount = rng.next() < 0.5 ? 1 : 2;
        for (let k = 0; k < contCount; k++) {
          containers.push({
            x: +(cx + rng.range(-10, 10)).toFixed(3),
            z: +(cz + rng.range(-10, 10)).toFixed(3),
            heading: rng.next() < 0.5 ? 0 : Math.PI / 2,
            color: [0xb03d3d, 0x3d6fb4, 0x3d8a5a, 0xc9a13d][rng.int(0, 3)],
          });
        }
      }
    }
  }

  // Road markings: centre dashes along every road (skipped near
  // intersections), zebra crosswalks + stop lines at every other
  // intersection, so the asphalt reads as a street at 768x480.
  for (const line of roadLines) {
    for (const horizontal of [true, false]) {
      for (let t = -half + 14; t <= half - 14; t += 9) {
        let nearJunction = false;
        for (const other of roadLines) {
          if (Math.abs(t - other) < 10) { nearJunction = true; break; }
        }
        if (nearJunction) continue;
        laneDashes.push(horizontal
          ? { x: +t.toFixed(3), z: line, axis: 'x' }
          : { x: line, z: +t.toFixed(3), axis: 'z' });
      }
    }
  }
  roadLines.forEach((lx, ix) => {
    roadLines.forEach((lz, iz) => {
      if ((ix + iz) % 2 !== 0) return;
      if (lx < -half + 4) return; // ocean corner
      for (const [ax, az, axis] of [
        [lx, lz - roadWidth / 2 - 1.6, 'x'], [lx, lz + roadWidth / 2 + 1.6, 'x'],
        [lx - roadWidth / 2 - 1.6, lz, 'z'], [lx + roadWidth / 2 + 1.6, lz, 'z'],
      ]) {
        for (let s = -2; s <= 2; s++) {
          crosswalks.push(axis === 'x'
            ? { x: +(ax + s * 1.1).toFixed(3), z: +az.toFixed(3), axis }
            : { x: +ax.toFixed(3), z: +(az + s * 1.1).toFixed(3), axis });
        }
        stopLines.push(axis === 'x'
          ? { x: +ax.toFixed(3), z: +(az + (az > lz ? 2.6 : -2.6)).toFixed(3), axis }
          : { x: +(ax + (ax > lx ? 2.6 : -2.6)).toFixed(3), z: +az.toFixed(3), axis });
      }
      // Street-name sign post at the intersection's north-east corner.
      signs.push({ x: +(lx + roadWidth / 2 + 1.8).toFixed(3), z: +(lz - roadWidth / 2 - 1.8).toFixed(3) });
    });
  });

  // Parked cars in bays along the roads — every road except the south
  // drive road (z = 110), where the stealable parked cars already sit.
  // Two bays per road line, 2 cars per bay, in the right-hand lane.
  const parkedColors = [0x3d6fb4, 0xb03d3d, 0x3d8a5a, 0xc9a13d, 0x5a5a62, 0x8a5fbf];
  for (const line of roadLines) {
    if (Math.abs(line - 110) < 0.1) continue;
    if (line >= half - 10) continue; // outer edge road: its +5 bay would sit outside the city
    for (const horizontal of [true, false]) {
      for (const base of [-60, 40]) {
        for (let k = 0; k < 2; k++) {
          const along = base + k * 6;
          // Kerb bay (lane +5): clear of the ±3 traffic lane, so moving
          // traffic passes without clipping through a parked car.
          const lane = line + 5;
          parkedCars.push(horizontal
            ? { x: +along.toFixed(3), z: lane, heading: Math.PI / 2, color: parkedColors[rng.int(0, parkedColors.length - 1)], kind: rng.next() < 0.7 ? 'sedan' : 'sport' }
            : { x: lane, z: +along.toFixed(3), heading: 0, color: parkedColors[rng.int(0, parkedColors.length - 1)], kind: rng.next() < 0.7 ? 'sedan' : 'sport' });
        }
      }
    }
  }

  // Eastern hills beyond the city edge: the driving shots look east
  // into a flat green void past the last road (the ground plane runs
  // 380 m past the city with nothing on it). Colina Verde's hills
  // continue east as landforms, so the horizon reads as terrain.
  const HILL_COLORS = [0x6a8a4a, 0x7a9a55, 0x5a7a42, 0x8a9a5a];
  for (let k = 0; k < 8; k++) {
    hills.push({
      x: +(195 + k * 24 + rng.range(-8, 8)).toFixed(3),
      z: +(-150 + k * 42 + rng.range(-14, 14)).toFixed(3),
      r: +(rng.range(22, 38)).toFixed(3),
      h: +(rng.range(16, 40)).toFixed(3),
      color: HILL_COLORS[rng.int(0, HILL_COLORS.length - 1)],
    });
  }

  // Bollards along the beach / harbour water edge, buoys out in the bay.
  for (let z = -half + 10; z <= half - 10; z += 26) {
    bollards.push({ x: +(-half - 1.5).toFixed(3), z: +z.toFixed(3) });
  }
  for (let k = 0; k < 6; k++) {
    buoys.push({
      x: +(-half - 40 - k * 22).toFixed(3),
      z: +(-90 + k * 36).toFixed(3),
    });
  }

  // Street lamps at road intersections (skip the ocean corner).
  // STAGGERED corners (Day 4C): one lamp per intersection, the corner
  // rotating with (ix + iz) % 4, pushed 2 m out from the road edge so
  // no lamp stands in the driving camera's foreground. Pole is shorter
  // (4.6 m) for the same reason — the 4B chase shot had a lamp post
  // dominating the foreground right of the player car.
  roadLines.forEach((lx, ix) => {
    roadLines.forEach((lz, iz) => {
      if (lx < -half + 4) return;
      const corner = (ix + iz) % 4;
      const ox = corner % 2 === 0 ? roadWidth / 2 + 2.0 : -(roadWidth / 2 + 2.0);
      const oz = corner < 2 ? roadWidth / 2 + 2.0 : -(roadWidth / 2 + 2.0);
      lamps.push({ x: +(lx + ox).toFixed(3), z: +(lz + oz).toFixed(3) });
    });
  });

  const city = {
    seed, blocks, blockSize, roadWidth, cell, half, size,
    roadLines, buildings, palms, lamps, plazas,
    shops, trees, benches, planters, parkedCars,
    crates, containers, bollards, buoys, signs, hills,
    laneDashes, crosswalks, stopLines,
    districts: DISTRICTS.map((d) => d.name),
    streetsX: STREETS_X.slice(),
    streetsZ: STREETS_Z.slice(),
    // Ocean edge: west of the city, beach strip then open water.
    beach: { x0: -half - 26, x1: -half, sandColor: 0xe8d5a4 },
    ocean: { x0: -half - 320, x1: -half - 26 },
    // Landmark tower anchoring the skyline and the minimap.
    landmark: { name: 'Faro de Cabo Luna', x: -half + 6, z: 0, h: 52 },
  };
  return city;
}

export function serializeCity(city) { return JSON.stringify(city); }

// Nearest road centre to (x, z): { axis: 'x' | 'z', line, dist }.
export function nearestRoad(city, x, z) {
  let best = null;
  for (const line of city.roadLines) {
    const dx = Math.abs(x - line);
    const dz = Math.abs(z - line);
    if (!best || dx < best.dist) best = { axis: 'z', line, dist: dx };
    if (dz < best.dist) best = { axis: 'x', line, dist: dz };
  }
  return best;
}

// District name at a point (plaza counts as its district).
export function districtAtPoint(city, x, z) {
  const bx = Math.floor((x + city.half - city.roadWidth) / city.cell);
  const bz = Math.floor((z + city.half - city.roadWidth) / city.cell);
  if (bx < 0 || bz < 0 || bx >= city.blocks || bz >= city.blocks) {
    if (x < -city.half) return 'Bahia Azul';
    return 'Cabo Luna';
  }
  return districtAt(bx, bz, city.blocks).name;
}

// Street name nearest to a point, for the HUD.
export function streetAtPoint(city, x, z) {
  const road = nearestRoad(city, x, z);
  const idx = city.roadLines.indexOf(road.line);
  return road.axis === 'x' ? city.streetsZ[idx] : city.streetsX[idx];
}

// AABB colliders for every building (plus the lighthouse).
export function buildingColliders(city) {
  const out = city.buildings.map((b) => ({
    minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
  }));
  out.push({ minX: city.landmark.x - 3, maxX: city.landmark.x + 3, minZ: -3, maxZ: 3 });
  return out;
}
