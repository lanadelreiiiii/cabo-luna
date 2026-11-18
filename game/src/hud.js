// Cabo Luna — HUD shell. DOM corners with fixed slots so Days 2-4 can
// grow the density (mission card, police list, dialogue) without moving
// anything: top-left mission + wanted, top-right money + clock,
// bottom-left circular minimap, bottom-right speed + district, bottom
// centre health. Compact on purpose — it must not wrap at 768px wide.
import { districtAtPoint, streetAtPoint } from './city.js';

export function createHud(city) {
  const $ = (id) => document.getElementById(id);
  const el = {
    mission: $('hud-mission'), wanted: $('hud-wanted'), money: $('hud-money'),
    clock: $('hud-clock'), district: $('hud-district'), street: $('hud-street'),
    healthFill: $('hud-health-fill'), healthText: $('hud-health-text'),
    speed: $('hud-speed'), mode: $('hud-mode'), banner: $('hud-banner'),
    minimap: $('hud-minimap'), hint: $('hud-hint'),
  };
  const mapCtx = el.minimap.getContext('2d');
  const mapSize = el.minimap.width;

  function stars(n) {
    let out = '';
    for (let i = 0; i < 5; i++) out += i < n ? '★' : '☆';
    return out;
  }

  function drawMinimap(px, pz, yaw, trafficCars, playerCar) {
    const g = mapCtx;
    const scale = mapSize / (city.size + 80);
    const toMap = (x, z) => [mapSize / 2 + (x - 0) * scale, mapSize / 2 + (z - 0) * scale];
    g.clearRect(0, 0, mapSize, mapSize);
    g.save();
    g.beginPath(); g.arc(mapSize / 2, mapSize / 2, mapSize / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#12283a'; g.fillRect(0, 0, mapSize, mapSize);
    // Ocean west.
    g.fillStyle = '#2e7fb8';
    g.fillRect(0, 0, Math.max(0, mapSize / 2 + city.ocean.x1 * scale), mapSize);
    g.fillStyle = '#e8d5a4';
    g.fillRect(Math.max(0, mapSize / 2 + city.beach.x0 * scale), 0, (city.beach.x1 - city.beach.x0) * scale, mapSize);
    // Roads.
    g.strokeStyle = '#5a5a62'; g.lineWidth = Math.max(1, city.roadWidth * scale * 0.7);
    for (const line of city.roadLines) {
      const [ax, ay] = toMap(line, -city.half);
      const [bx, by] = toMap(line, city.half);
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      const [cx, cy] = toMap(-city.half, line);
      const [dx, dy] = toMap(city.half, line);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(dx, dy); g.stroke();
    }
    // Buildings.
    g.fillStyle = '#c9b48a';
    for (const b of city.buildings) {
      const [x, y] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      g.fillRect(x, y, Math.max(1, b.w * scale), Math.max(1, b.d * scale));
    }
    // Lighthouse.
    const [lx, ly] = toMap(city.landmark.x, city.landmark.z);
    g.fillStyle = '#ffd98a';
    g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
    // Traffic cars: pale dots. The player's car (when driving) is red.
    if (trafficCars) {
      g.fillStyle = '#cfd8dc';
      for (const c of trafficCars) {
        const [cx, cy] = toMap(c.x, c.z);
        g.beginPath(); g.arc(cx, cy, 2, 0, Math.PI * 2); g.fill();
      }
    }
    // Player dot + facing wedge (on foot), or the player car (driving).
    const [pxm, pzm] = toMap(playerCar ? playerCar.x : px, playerCar ? playerCar.z : pz);
    g.fillStyle = '#ff5a3d';
    g.beginPath(); g.arc(pxm, pzm, 4, 0, Math.PI * 2); g.fill();
    if (!playerCar) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(pxm, pzm);
      g.lineTo(pxm - Math.sin(yaw) * 9, pzm - Math.cos(yaw) * 9); g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    g.beginPath(); g.arc(mapSize / 2, mapSize / 2, mapSize / 2 - 1, 0, Math.PI * 2); g.stroke();
  }

  return {
    update(state) {
      const p = state.player;
      const district = districtAtPoint(city, p.x, p.z);
      const street = streetAtPoint(city, p.x, p.z);
      el.money.textContent = `$${state.money.toLocaleString('en-US')}`;
      el.wanted.textContent = stars(state.wanted);
      el.clock.textContent = state.clockText;
      el.district.textContent = district;
      el.street.textContent = street;
      el.healthFill.style.width = `${Math.max(0, state.health)}%`;
      el.healthText.textContent = `${Math.round(state.health)}`;
      el.speed.textContent = `${Math.round(state.speedKmh)}`;
      el.mode.textContent = state.onFoot ? 'ON FOOT' : 'DRIVING';
      el.hint.textContent = state.hint || (state.onFoot
        ? 'WASD move · Shift sprint · E enter car · P pause'
        : 'W/S drive · A/D steer · Space brake · E exit');
      el.banner.textContent = state.banner || district;
      el.mission.textContent = state.mission;
      drawMinimap(p.x, p.z, p.yaw, state.cars, state.onFoot ? null : state.playerCar);
    },
    showScreen(screen) {
      document.getElementById('screen-title').hidden = screen !== 'title';
      document.getElementById('screen-paused').hidden = screen !== 'paused';
      document.getElementById('screen-over').hidden = screen !== 'over';
      document.getElementById('hud').hidden = screen === 'title' || screen === 'over';
    },
  };
}
