// Cabo Luna — road graph: intersections are nodes, road segments are
// edges, lanes are a right-hand offset applied when a route is expanded
// to waypoints. Renderer-free: plain data + math, so Node tests can
// import it directly. Deterministic: A* breaks every tie by node id.
import { TRAFFIC } from './config.js';

export function nodeId(ix, iz) { return `${ix},${iz}`; }

// One node per road-line crossing: (blocks+1)^2 nodes for a grid city.
export function buildRoadGraph(city) {
  const lines = city.roadLines;
  const nodes = new Map();
  for (let ix = 0; ix < lines.length; ix++) {
    for (let iz = 0; iz < lines.length; iz++) {
      const id = nodeId(ix, iz);
      nodes.set(id, { id, ix, iz, x: lines[ix], z: lines[iz], neighbors: [] });
    }
  }
  const cell = city.cell;
  for (const node of nodes.values()) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = node.ix + dx, nz = node.iz + dz;
      if (nx < 0 || nz < 0 || nx >= lines.length || nz >= lines.length) continue;
      node.neighbors.push({ id: nodeId(nx, nz), weight: cell });
    }
    // Neighbours in a fixed order keeps every traversal deterministic.
    node.neighbors.sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return { city, nodes, lines };
}

export function nearestNode(graph, x, z) {
  let best = null, bestD = Infinity;
  for (const node of graph.nodes.values()) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD || (d === bestD && best && node.id < best.id)) { best = node; bestD = d; }
  }
  return best;
}

function heuristic(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// A* over the grid. Returns an array of node ids from start to goal
// (inclusive), or null when unreachable. Ties break on node id, so the
// same query always returns the same path.
export function astar(graph, startId, goalId) {
  const start = graph.nodes.get(startId);
  const goal = graph.nodes.get(goalId);
  if (!start || !goal) return null;
  if (startId === goalId) return [startId];
  const open = [{ id: startId, f: heuristic(start, goal) }];
  const came = new Map();
  const gScore = new Map([[startId, 0]]);
  const closed = new Set();
  while (open.length > 0) {
    // Lowest f first; id order breaks ties deterministically.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f || (open[i].f === open[bestIdx].f && open[i].id < open[bestIdx].id)) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    if (current.id === goalId) {
      const path = [goalId];
      let cur = goalId;
      while (came.has(cur)) { cur = came.get(cur); path.unshift(cur); }
      return path;
    }
    if (closed.has(current.id)) continue;
    closed.add(current.id);
    const node = graph.nodes.get(current.id);
    for (const edge of node.neighbors) {
      const tentative = gScore.get(current.id) + edge.weight;
      if (tentative < (gScore.get(edge.id) ?? Infinity)) {
        came.set(edge.id, current.id);
        gScore.set(edge.id, tentative);
        const target = graph.nodes.get(edge.id);
        open.push({ id: edge.id, f: tentative + heuristic(target, goal) });
      }
    }
  }
  return null;
}

// Expand a node path into driveable lane waypoints. Each leg is offset
// to the right-hand side of travel by `lane` metres, so two-way traffic
// never shares a centre line. The final node is kept on its lane offset
// too — a car that stops exactly on a centre line reads as broken.
export function pathToLaneWaypoints(graph, path, lane = TRAFFIC.laneOffset) {
  const pts = [];
  for (let i = 1; i < path.length; i++) {
    const a = graph.nodes.get(path[i - 1]);
    const b = graph.nodes.get(path[i]);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len, fz = dz / len;
    // Right of forward (fx, fz) in the XZ plane is (-fz, fx).
    const rx = -fz, rz = fx;
    pts.push({ x: b.x + rx * lane, z: b.z + rz * lane, nodeId: b.id });
  }
  return pts;
}

// Pick a random node id from the graph with a seeded RNG.
export function randomNodeId(graph, rng) {
  const ids = [...graph.nodes.keys()];
  return ids[Math.floor(rng.next() * ids.length)];
}
