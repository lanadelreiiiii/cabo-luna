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

      const count = rng.int(1, 4);
      for (let k = 0; k < count; k++) {
        const w = +rng.range(8, 18).toFixed(3);
        const d = +rng.range(8, 18).toFixed(3);
        const ox = +rng.range(-blockSize / 2 + w / 2 + 1, blockSize / 2 - w / 2 - 1).toFixed(3);
        const oz = +rng.range(-blockSize / 2 + d / 2 + 1, blockSize / 2 - d / 2 - 1).toFixed(3);
        const tall = district.kind === 'downtown';
        const h = +(rng.range(tall ? 18 : 6, tall ? 46 : 19)).toFixed(3);
        buildings.push({
          x: +(cx + ox).toFixed(3), z: +(cz + oz).toFixed(3),
          w, d, h,
          district: district.name, kind: district.kind,
          color: palette[rng.int(0, palette.length - 1)],
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
    }
  }

  // Street lamps at road intersections (skip the ocean corner).
  for (const lx of roadLines) {
    for (const lz of roadLines) {
      if (lx < -half + 4) continue;
      lamps.push({ x: +(lx + roadWidth / 2 + 0.6).toFixed(3), z: +(lz + roadWidth / 2 + 0.6).toFixed(3) });
    }
  }

  const city = {
    seed, blocks, blockSize, roadWidth, cell, half, size,
    roadLines, buildings, palms, lamps, plazas,
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
