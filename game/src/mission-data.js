// Cabo Luna — mission manifests (Day 3A, ELITE redirect).
// Plain data, no game imports. Target coordinates are road-line indices
// into the city (city.roadLines from generateCity(seed 1) =
// [-150,-98,-46,6,58,110,162]); resolveManifest turns them into {x, z}.
// Objectives flagged onFoot use explicit {x, z} (e.g. the Plaza del
// Reloj centre at (-20, 84), city.plazas[0]) instead of road indices.
export const CHAIN = ['mission-01-delivery-gone-wrong', 'mission-02-wrong-place', 'mission-03-harbor-silence'];

export const MISSIONS = {
  'mission-01-delivery-gone-wrong': {
    title: 'A Delivery Gone Wrong',
    reward: 150, // fallback; the ink `payout` var pays 150 sealed / 200 opened
    fail: { timeout: 240 },
    objectives: [
      { id: 'meet_yara', kind: 'reach', x: -20, z: 84, radius: 14, onFoot: true, hud: 'Meet Yara at the Plaza del Reloj' },
      { id: 'get_car', kind: 'in_vehicle', hud: 'Get in the car' },
      { id: 'deliver_parcel', kind: 'reach', roadX: 3, roadZ: 0, radius: 12, hud: 'Deliver the parcel to Mercado Norte' },
      { id: 'lose_tail', kind: 'lose_tail', seconds: 8, hud: 'Lose the patrol — stay out of sight' },
      { id: 'wanted_clear', kind: 'wanted_clear', hud: 'Wait until the heat clears' },
    ],
  },
  'mission-02-wrong-place': {
    title: 'The Wrong Place',
    reward: 300,
    fail: { timeout: 300 },
    objectives: [
      { id: 'steal_evidence_car', kind: 'in_vehicle', hud: 'Steal the grey Solano' },
      { id: 'reach_quiet_spot', kind: 'reach', roadX: 2, roadZ: 2, radius: 12, hud: 'Reach a quiet spot in Luna Vieja' },
      { id: 'inspect_evidence', kind: 'wait', seconds: 3, hud: 'Inspect the ledger — sit still' },
      { id: 'evade_patrol', kind: 'lose_tail', seconds: 10, hud: 'Lose the patrol — stay out of sight' },
      { id: 'deliver_evidence', kind: 'reach', roadX: 2, roadZ: 2, radius: 12, hud: 'Deliver the ledger to Yara' },
    ],
    branches: {
      route: {
        avenue: { deliver_evidence: { roadX: 4, roadZ: 3, radius: 12, hud: 'Deliver the ledger to Yara — Torre Alta, fast' } },
        streets: { deliver_evidence: { roadX: 2, roadZ: 2, radius: 12, hud: 'Deliver the ledger to Yara — Luna Vieja, safe' } },
      },
    },
  },
  'mission-03-harbor-silence': {
    title: 'Harbor Silence',
    reward: 400,
    fail: { timeout: 360 },
    objectives: [
      { id: 'infiltrate_harbor', kind: 'reach', roadX: 0, roadZ: 5, radius: 12, onFoot: true, hud: 'Infiltrate the Puerto Luna warehouse on foot' },
      { id: 'defeat_guards', kind: 'defeat', count: 2, hud: 'Defeat the warehouse guards (0/2)' },
      { id: 'reach_stash', kind: 'reach', roadX: 0, roadZ: 6, radius: 12, hud: 'Reach the stash cage' },
      { id: 'retrieve_package', kind: 'wait', seconds: 3, hud: 'Retrieve the package — hold still' },
      { id: 'escape_safehouse', kind: 'reach', roadX: 6, roadZ: 2, radius: 12, hud: 'Reach the Colina Verde safehouse' },
      { id: 'wanted_clear', kind: 'wanted_clear', hud: 'Wait until the heat clears' },
    ],
  },
};

// Deep-clone a manifest (objectives are mutated by branch resolution,
// so every run gets a fresh copy) and resolve roadX/roadZ indices to
// concrete {x, z} using the game's city roadLines. Objectives with
// explicit x/z keep them.
export function resolveManifest(missionId, city) {
  const base = MISSIONS[missionId];
  if (!base) throw new Error(`unknown mission: ${missionId}`);
  const m = JSON.parse(JSON.stringify(base));
  const resolveOne = (o) => {
    if (typeof o.roadX === 'number') o.x = city.roadLines[o.roadX];
    if (typeof o.roadZ === 'number') o.z = city.roadLines[o.roadZ];
    delete o.roadX;
    delete o.roadZ;
  };
  m.objectives.forEach(resolveOne);
  for (const byValue of Object.values(m.branches ?? {})) {
    for (const overrides of Object.values(byValue)) {
      for (const o of Object.values(overrides)) resolveOne(o);
    }
  }
  return m;
}
