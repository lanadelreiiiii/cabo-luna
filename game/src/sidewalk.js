// Cabo Luna — pedestrian sidewalk graph (Day 4G).
// A real walkable graph on top of the road grid: corner nodes offset
// from every road centreline, sidewalk edges along each road segment,
// crosswalk edges across each intersection, and named destinations
// (Plaza del Reloj, the lighthouse, the harbour, shops, one node per
// district). Renderer-free plain data + math, seeded-deterministic,
// no dependencies — the cheap alternative to Recast Navigation.
//
// Building clearance, by construction: buildings sit at least 1 m
// inside their block edge (city.js: |offset| + w/2 <= blockSize/2 - 1)
// and a block edge is roadWidth/2 = 6 m from its road centreline, so
// every building face is >= 7.0 m from every road line. Sidewalk and
// crosswalk edges run at SIDEWALK_OFF = 6.7 m from the centreline, so
// they clear every building by >= 0.3 m. The one exception is the
// lighthouse, which stands ON the x = -150 road line: any edge whose
// segment hits a building collider (lighthouse included) is dropped
// at build time, and connectivity is verified by test, not assumed.
import { astar } from './roadgraph.js';
import { buildingColliders } from './city.js';

// 0.7 m past the road edge (roadWidth/2 = 6), 0.3 m clear of the
// closest possible building face (7.0 m from the centreline).
export const SIDEWALK_OFF = 6.7;
// Margin used when dropping edges that hit a building collider:
// 0.2 m keeps the 0.3 m clearance above from false-positive drops.
const DROP_MARGIN = 0.2;

// Plaza block (bx=2, bz=4) is open ground — no buildings — so peds
// may walk from its four facing corners straight to its centre.
const PLAZA_BX = 2, PLAZA_BZ = 4;
// Representative block per district for the district landmarks.
const DISTRICT_BLOCKS = {
  'Bahia Azul': [0, 2],
  'Torre Alta': [2, 2],
  'Luna Vieja': [2, 4],
  'Mercado Norte': [2, 0],
  'Colina Verde': [4, 2],
  'Puerto Luna': [2, 5],
};

function cornerId(ix, iz, q) { return `c${ix},${iz},${q}`; }

// Quadrant offsets: 0 NW, 1 NE, 2 SW, 3 SE (x = road line +/- off).
const QUAD = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export function pointInCollider(colliders, x, z, margin = 0) {
  for (const b of colliders) {
    if (x > b.minX - margin && x < b.maxX + margin
      && z > b.minZ - margin && z < b.maxZ + margin) return true;
  }
  return false;
}

// Segment vs AABB (slab test), box expanded by `margin`. Touching
// counts as a hit — a dropped edge is cheap, a clipped one is not.
export function segmentHitsCollider(x1, z1, x2, z2, colliders, margin = 0) {
  const dx = x2 - x1, dz = z2 - z1;
  for (const b of colliders) {
    const minX = b.minX - margin, maxX = b.maxX + margin;
    const minZ = b.minZ - margin, maxZ = b.maxZ + margin;
    let tmin = 0, tmax = 1;
    if (dx === 0) { if (x1 < minX || x1 > maxX) continue; }
    else {
      let t1 = (minX - x1) / dx, t2 = (maxX - x1) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (dz === 0) { if (z1 < minZ || z1 > maxZ) continue; }
    else {
      let t1 = (minZ - z1) / dz, t2 = (maxZ - z1) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

export function buildSidewalkGraph(city) {
  const colliders = buildingColliders(city);
  const lines = city.roadLines;
  const n = lines.length;
  const nodes = new Map();
  const droppedEdges = [];

  // Corner nodes: 4 per intersection, offset from both road lines.
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      for (let q = 0; q < 4; q++) {
        const id = cornerId(ix, iz, q);
        nodes.set(id, {
          id, ix, iz, q,
          x: +(lines[ix] + QUAD[q][0] * SIDEWALK_OFF).toFixed(3),
          z: +(lines[iz] + QUAD[q][1] * SIDEWALK_OFF).toFixed(3),
          kind: 'corner', neighbors: [],
        });
      }
    }
  }

  // Plaza node at the centre of the open plaza block.
  const plaza = city.plazas[0];
  const plazaNode = plaza
    ? { id: 'plaza', x: plaza.x, z: plaza.z, kind: 'plaza', neighbors: [] }
    : null;
  if (plazaNode) nodes.set('plaza', plazaNode);

  function addEdge(a, b, kind) {
    const na = nodes.get(a), nb = nodes.get(b);
    if (!na || !nb) return;
    if (segmentHitsCollider(na.x, na.z, nb.x, nb.z, colliders, DROP_MARGIN)) {
      droppedEdges.push({ a, b, kind });
      return;
    }
    const w = Math.hypot(na.x - nb.x, na.z - nb.z);
    na.neighbors.push({ id: b, weight: w, kind });
    nb.neighbors.push({ id: a, weight: w, kind });
  }

  // Sidewalk edges along every road segment, both sides.
  for (let ix = 0; ix < n - 1; ix++) {
    for (let iz = 0; iz < n; iz++) {
      addEdge(cornerId(ix, iz, 1), cornerId(ix + 1, iz, 0), 'walk'); // north side
      addEdge(cornerId(ix, iz, 3), cornerId(ix + 1, iz, 2), 'walk'); // south side
    }
  }
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n - 1; iz++) {
      addEdge(cornerId(ix, iz, 2), cornerId(ix, iz + 1, 0), 'walk'); // west side
      addEdge(cornerId(ix, iz, 3), cornerId(ix, iz + 1, 1), 'walk'); // east side
    }
  }

  // Crosswalk edges: the four sides of every intersection square.
  // N/S edges cross the north-south road, W/E edges cross the
  // east-west road — together they connect all four corners.
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      addEdge(cornerId(ix, iz, 0), cornerId(ix, iz, 1), 'cross'); // north
      addEdge(cornerId(ix, iz, 2), cornerId(ix, iz, 3), 'cross'); // south
      addEdge(cornerId(ix, iz, 0), cornerId(ix, iz, 2), 'cross'); // west
      addEdge(cornerId(ix, iz, 1), cornerId(ix, iz, 3), 'cross'); // east
    }
  }

  // Plaza spokes: the four corners facing the open plaza block.
  if (plazaNode) {
    addEdge('plaza', cornerId(PLAZA_BX, PLAZA_BZ, 3), 'plaza');
    addEdge('plaza', cornerId(PLAZA_BX + 1, PLAZA_BZ, 2), 'plaza');
    addEdge('plaza', cornerId(PLAZA_BX, PLAZA_BZ + 1, 1), 'plaza');
    addEdge('plaza', cornerId(PLAZA_BX + 1, PLAZA_BZ + 1, 0), 'plaza');
  }

  // Fixed neighbour order keeps every traversal deterministic.
  for (const node of nodes.values()) {
    node.neighbors.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  const graph = { city, nodes, colliders, droppedEdges };

  // Named destinations: each resolves to a sidewalk node id.
  const nearest = (x, z) => nearestSidewalkNode(graph, x, z).id;
  const destinations = { plaza: 'plaza' };
  destinations.lighthouse = nearest(city.landmark.x, city.landmark.z);
  destinations.harbor = nearest(0, city.half - 10);
  for (const shop of city.shops) {
    destinations[`shop:${shop.name}@${shop.x},${shop.z}`] = nearest(shop.x, shop.z);
  }
  for (const [name, [bx, bz]] of Object.entries(DISTRICT_BLOCKS)) {
    if (name === 'Luna Vieja') { destinations['district:Luna Vieja'] = 'plaza'; continue; }
    const cx = -city.half + city.roadWidth + city.blockSize / 2 + bx * city.cell;
    const cz = -city.half + city.roadWidth + city.blockSize / 2 + bz * city.cell;
    destinations[`district:${name}`] = nearest(cx, cz);
  }
  graph.destinations = destinations;
  return graph;
}

export function nearestSidewalkNode(graph, x, z) {
  let best = null, bestD = Infinity;
  for (const node of graph.nodes.values()) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD || (d === bestD && best && node.id < best.id)) { best = node; bestD = d; }
  }
  return best;
}

export function randomSidewalkNodeId(graph, rng) {
  const ids = [...graph.nodes.keys()];
  return ids[Math.floor(rng.next() * ids.length)];
}

// A* over the sidewalk graph (same deterministic tie-break as roads).
export function sidewalkRoute(graph, fromId, toId) {
  return astar(graph, fromId, toId);
}

// Breadth-first reachability from one node — the connectivity check.
export function reachableFrom(graph, startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const edge of graph.nodes.get(cur).neighbors) {
      if (!seen.has(edge.id)) { seen.add(edge.id); queue.push(edge.id); }
    }
  }
  return seen;
}
