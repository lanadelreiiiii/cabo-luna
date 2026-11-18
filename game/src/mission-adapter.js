// Cabo Luna — GameAdapter for the mission manager (Day 3A).
// The only bridge between narrative and gameplay: it reads the world
// object it is given and applies rewards/crimes through state. It never
// imports a game module beyond the heat table's wantedFromHeat helper
// (pure function, no game state).
import { wantedFromHeat } from './config.js';

// Crime heat table (same values as the police module's crime model).
export const CRIME_HEAT = { theft: 25, speeding: 10, shooting: 40 };

export function createCaboAdapter(world, onObjectiveText) {
  const state = world.state;
  return {
    getPlayer() {
      const p = world.player.state;
      const car = world.playerCar;
      return {
        x: p.x,
        z: p.z,
        heading: car ? car.heading : p.yaw,
        speed: car ? Math.abs(car.speed) : Math.hypot(p.vx, p.vz),
        onFoot: state.onFoot,
      };
    },
    getWanted() {
      return { level: state.wanted, heat: state.crimeHeat };
    },
    getMoney() { return state.money; },
    addMoney(n) { state.money += n; },
    addCrime(type) {
      const heat = CRIME_HEAT[type] ?? 10;
      state.crimeHeat += heat;
      state.wanted = wantedFromHeat(state.crimeHeat);
    },
    isBusted() { return !!world.police?.busted; },
    isBeingChased() {
      return !!world.police?.units?.some((u) => u.state === 'CHASE');
    },
    // DAY 3B SEAM: combat kill counter. The combat system will
    // increment it when an enemy is defeated; until then it is always 0,
    // so `defeat` objectives cannot complete in Day 3A (by design).
    getCombatKills() { return 0; },
    setObjectiveText(text) {
      if (typeof onObjectiveText === 'function') onObjectiveText(text);
    },
  };
}
