// Cabo Luna — mission chain states (Day 3A, ELITE redirect).
// Deterministic, testable, no game imports. States:
//   LOCKED — previous mission not completed yet
//   AVAILABLE — can be started
//   ACTIVE — currently running
//   COMPLETED — finished, pays out, unlocks the next mission
//   FAILED — ended by timeout/bust; retry returns it to AVAILABLE
// The first mission starts AVAILABLE, the rest LOCKED. Restoring saved
// states maps a saved ACTIVE back to AVAILABLE (the mission resumes,
// it does not resume mid-objective).
export const MISSION_STATES = ['LOCKED', 'AVAILABLE', 'ACTIVE', 'COMPLETED', 'FAILED'];

export function createMissionChain(ids, savedStates = null) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('createMissionChain: non-empty mission id list required');
  }
  const states = {};
  ids.forEach((id, i) => { states[id] = i === 0 ? 'AVAILABLE' : 'LOCKED'; });
  if (savedStates) restoreStates(states, ids, savedStates);
  return {
    ids: [...ids],
    state(id) {
      if (!(id in states)) throw new Error(`mission chain: unknown mission '${id}'`);
      return states[id];
    },
    // First ACTIVE mission, else first AVAILABLE, else null (all done).
    current() {
      return ids.find((id) => states[id] === 'ACTIVE')
        ?? ids.find((id) => states[id] === 'AVAILABLE')
        ?? null;
    },
    start(id) {
      if (states[id] !== 'AVAILABLE') {
        throw new Error(`mission chain: cannot start '${id}' from ${states[id]} (need AVAILABLE)`);
      }
      states[id] = 'ACTIVE';
      return id;
    },
    complete(id) {
      if (states[id] !== 'ACTIVE') {
        throw new Error(`mission chain: cannot complete '${id}' from ${states[id]} (need ACTIVE)`);
      }
      states[id] = 'COMPLETED';
      const next = ids[ids.indexOf(id) + 1];
      if (next && states[next] === 'LOCKED') states[next] = 'AVAILABLE';
      return next ?? null;
    },
    fail(id) {
      if (states[id] !== 'ACTIVE') {
        throw new Error(`mission chain: cannot fail '${id}' from ${states[id]} (need ACTIVE)`);
      }
      states[id] = 'FAILED';
      return id;
    },
    retry(id) {
      if (states[id] !== 'FAILED') {
        throw new Error(`mission chain: cannot retry '${id}' from ${states[id]} (need FAILED)`);
      }
      states[id] = 'AVAILABLE';
      return id;
    },
    // Fresh run of a mission that is ACTIVE or FAILED (e.g. the world
    // resets while a mission is running): back to AVAILABLE.
    restart(id) {
      if (states[id] !== 'ACTIVE' && states[id] !== 'FAILED') {
        throw new Error(`mission chain: cannot restart '${id}' from ${states[id]} (need ACTIVE or FAILED)`);
      }
      states[id] = 'AVAILABLE';
      return id;
    },
    completedIds() { return ids.filter((id) => states[id] === 'COMPLETED'); },
    toJSON() { return { ...states }; },
  };
}

function restoreStates(states, ids, saved) {
  for (const [id, st] of Object.entries(saved)) {
    if (!ids.includes(id)) continue; // ignore stale ids from older saves
    if (!MISSION_STATES.includes(st)) throw new Error(`mission chain: bad saved state '${st}' for '${id}'`);
    // A saved ACTIVE mission resumes as AVAILABLE; everything else
    // restores as saved (COMPLETED stays COMPLETED, FAILED stays FAILED).
    states[id] = st === 'ACTIVE' ? 'AVAILABLE' : st;
  }
}
