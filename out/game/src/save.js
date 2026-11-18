// Cabo Luna — minimal localStorage save/load: money, position, district
// (and the seed, so a loaded game rebuilds the identical city).
import { SAVE_KEY } from './config.js';

export function saveGame(state) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money,
      x: +state.player.x.toFixed(2),
      z: +state.player.z.toFixed(2),
      district: state.district,
      seed: state.seed,
      day: state.day,
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.money !== 'number' || typeof data.x !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}
