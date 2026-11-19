// Cabo Luna — mission manifests (Day 3A, ELITE redirect).
// Plain data, no game imports. Target coordinates are road-line indices
// into the city (city.roadLines from generateCity(seed 1) =
// [-150,-98,-46,6,58,110,162]); resolveManifest turns them into {x, z}.
// Objectives flagged onFoot use explicit {x, z} (e.g. the Plaza del
// Reloj centre at (-20, 84), city.plazas[0]) instead of road indices.
export const CHAIN = ['mission-01-delivery-gone-wrong', 'mission-02-wrong-place', 'mission-03-harbor-silence', 'mission-04-three-stops', 'mission-05-plant-the-proof'];

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
    // Day 5A: guards are manifest-driven (main.js spawns them for any
    // mission that declares them) — no more hardcoded mission id.
    guards: [
      { x: -144, z: 109, waypoints: [[-146, 106], [-138, 112], [-146, 118], [-154, 112]] },
      { x: -136, z: 100, waypoints: [[-154, 114], [-146, 120], [-138, 114], [-146, 108]] },
    ],
    objectives: [
      { id: 'infiltrate_harbor', kind: 'reach', roadX: 0, roadZ: 5, radius: 12, onFoot: true, hud: 'Infiltrate the Puerto Luna warehouse on foot' },
      { id: 'defeat_guards', kind: 'defeat', count: 2, hud: 'Defeat the warehouse guards (0/2)' },
      { id: 'reach_stash', kind: 'reach', roadX: 0, roadZ: 6, radius: 12, hud: 'Reach the stash cage' },
      { id: 'retrieve_package', kind: 'wait', seconds: 3, hud: 'Retrieve the package — hold still' },
      { id: 'escape_safehouse', kind: 'reach', roadX: 6, roadZ: 2, radius: 12, hud: 'Reach the Colina Verde safehouse' },
      { id: 'wanted_clear', kind: 'wanted_clear', hud: 'Wait until the heat clears' },
    ],
  },
  // M4 "The Clock Is Ticking" — timed multi-stop courier. NEW kind
  // `timed_reach`: each drop must be reached within `seconds` of the
  // stage starting, or the mission fails (too_slow). Three drops across
  // the city against the clock, then lose the tail + clear the heat.
  // Branch after stop 2: the fast avenue (Colina Verde drop) vs the
  // quiet harbor road (Puerto Luna drop).
  'mission-04-three-stops': {
    title: 'The Clock Is Ticking',
    reward: 500,
    fail: { timeout: 300 },
    objectives: [
      { id: 'meet_yara', kind: 'reach', x: -20, z: 84, radius: 14, onFoot: true, hud: 'Meet Yara at the Plaza del Reloj' },
      { id: 'get_car', kind: 'in_vehicle', hud: 'Get in the car — the clock is running' },
      { id: 'drop_one', kind: 'timed_reach', roadX: 4, roadZ: 3, radius: 12, seconds: 60, hud: 'Drop 1/3 — Torre Alta, 60s on the clock' },
      { id: 'drop_two', kind: 'timed_reach', roadX: 3, roadZ: 0, radius: 12, seconds: 60, hud: 'Drop 2/3 — Mercado Norte, 60s on the clock' },
      { id: 'drop_three', kind: 'timed_reach', roadX: 6, roadZ: 2, radius: 12, seconds: 60, hud: 'Drop 3/3 — Colina Verde, 60s on the clock' },
      { id: 'lose_tail', kind: 'lose_tail', seconds: 6, hud: 'Lose the patrol — stay out of sight' },
      { id: 'wanted_clear', kind: 'wanted_clear', hud: 'Wait until the heat clears' },
    ],
    branches: {
      route: {
        avenue: { drop_three: { roadX: 6, roadZ: 2, radius: 12, hud: 'Drop 3/3 — Colina Verde, fast avenue, 60s' } },
        streets: { drop_three: { roadX: 0, roadZ: 5, radius: 12, hud: 'Drop 3/3 — Puerto Luna, quiet road, 60s' } },
      },
    },
  },
  // M5 "Plant the Proof" — plant evidence in the operation's own Torre
  // Alta office, then vanish. The plant itself is the crime (# crime
  // tag on plant_done): heat + witnesses arrive AFTER the quiet part,
  // so the escape is a real chase through City Remembers (witness
  // reports, district heat, garage as the getaway). Two guards patrol
  // the office — they are a threat, not a target: shooting them is
  // allowed but raises the alarm (the smash branch trades +$100 for
  // +25 heat). No defeat objective.
  'mission-05-plant-the-proof': {
    title: 'Plant the Proof',
    reward: 550,
    fail: { timeout: 360 },
    guards: [
      { x: 106, z: 2, waypoints: [[106, 2], [114, 8], [106, 14], [98, 8]] },
      { x: 114, z: 10, waypoints: [[114, 10], [106, 16], [98, 10], [106, 4]] },
    ],
    objectives: [
      { id: 'infiltrate_office', kind: 'reach', roadX: 5, roadZ: 3, radius: 12, onFoot: true, hud: 'Reach the Torre Alta office on foot' },
      { id: 'plant_evidence', kind: 'wait', seconds: 4, hud: 'Plant the ledger pages — hold still' },
      { id: 'escape_garage', kind: 'reach', roadX: 4, roadZ: 4, radius: 12, hud: 'Reach the Taller Brisa garage — lose the trail' },
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
