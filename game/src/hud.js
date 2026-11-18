// Cabo Luna — HUD shell. DOM corners with fixed slots so Days 2-4 can
// grow the density (mission card, police list, dialogue) without moving
// anything: top-left mission + wanted, top-right money + clock,
// bottom-left circular minimap, bottom-right speed + district, bottom
// centre health. Compact on purpose — it must not wrap at 768px wide.
// Day 4B: patrol line wraps in a widened panel (state stated once),
// dialogue moved to the left rail (off the road/car), crosshair only
// on foot while aiming matters (an enemy is present or a shot/marker is
// live), interaction prompt + car name added. Crosshair rule: on foot
// AND aiming = shown; driving, or on foot with nothing to aim at =
// hidden.
import { districtAtPoint, streetAtPoint } from './city.js';
import { lightPhase } from './police.js';

export function createHud(city) {
  const $ = (id) => document.getElementById(id);
  const el = {
    mission: $('hud-mission'), objective: $('hud-objective'),
    wanted: $('hud-wanted'), money: $('hud-money'),
    clock: $('hud-clock'), district: $('hud-district'), street: $('hud-street'),
    healthFill: $('hud-health-fill'), healthText: $('hud-health-text'),
    speed: $('hud-speed'), car: $('hud-car'), mode: $('hud-mode'), banner: $('hud-banner'),
    minimap: $('hud-minimap'), hint: $('hud-hint'), patrol: $('hud-patrol'),
    witness: $('hud-witness'), memoryLine: $('hud-memory'),
    dialogue: $('hud-dialogue'), speaker: $('hud-dialogue-speaker'),
    dialogueText: $('hud-dialogue-text'),
    choice0: $('hud-choice-0'), choice1: $('hud-choice-1'),
    crosshair: $('hud-crosshair'), interact: $('hud-interact'),
    ammoWeapon: $('hud-ammo-weapon'), ammoCount: $('hud-ammo-count'),
    ammoReload: $('hud-ammo-reload'),
  };
  const mapCtx = el.minimap.getContext('2d');
  const mapSize = el.minimap.width;
  let choiceHandler = null;
  el.choice0.addEventListener('click', () => { if (choiceHandler) choiceHandler(0); });
  el.choice1.addEventListener('click', () => { if (choiceHandler) choiceHandler(1); });

  function stars(n) {
    let out = '';
    for (let i = 0; i < 5; i++) out += i < n ? '★' : '☆';
    return out;
  }

  function drawMinimap(px, pz, yaw, trafficCars, playerCar, police, flashTime, extra) {
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
    // THE CITY REMEMBERS (Day 4D): garage (green square) + safehouse
    // (green ring) so the player can find the two escapes, and the
    // last-known-location (amber diamond) so the player can see where
    // the police think they are.
    if (extra?.garage) {
      const [gx, gy] = toMap(extra.garage.x, extra.garage.z);
      g.fillStyle = '#57d977';
      g.fillRect(gx - 3, gy - 3, 6, 6);
    }
    if (extra?.safehouse) {
      const [sx, sy] = toMap(extra.safehouse.x, extra.safehouse.z);
      g.strokeStyle = '#57d977'; g.lineWidth = 2;
      g.beginPath(); g.arc(sx, sy, 4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#57d977';
      g.beginPath(); g.arc(sx, sy, 1.5, 0, Math.PI * 2); g.fill();
    }
    if (extra?.lastKnown) {
      const [kx, ky] = toMap(extra.lastKnown.x, extra.lastKnown.z);
      g.fillStyle = '#ffb02d';
      g.beginPath();
      g.moveTo(kx, ky - 5); g.lineTo(kx + 5, ky); g.lineTo(kx, ky + 5); g.lineTo(kx - 5, ky);
      g.closePath(); g.fill();
    }
    // Traffic cars: pale dots, bumped a notch (2 -> 2.5 px) — at
    // 104 px across, the old dots were hard to pick out.
    if (trafficCars) {
      g.fillStyle = '#cfd8dc';
      for (const c of trafficCars) {
        const [cx, cy] = toMap(c.x, c.z);
        g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
      }
    }
    // Patrol units: blue dots with a red ring, flashing in phase with
    // the roof light bars. Dots 3 -> 3.5 px, rings 5 -> 5.5 px.
    if (police) {
      const phase = lightPhase(flashTime ?? 0);
      for (const u of police) {
        const [cx, cy] = toMap(u.x, u.z);
        g.fillStyle = '#3d8bff';
        g.beginPath(); g.arc(cx, cy, 3.5, 0, Math.PI * 2); g.fill();
        g.strokeStyle = phase === 0 ? '#ff2020' : '#2040ff';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(cx, cy, 5.5, 0, Math.PI * 2); g.stroke();
      }
    }
    // Player dot + facing wedge (on foot), or the player car (driving).
    // Player dot 4 -> 4.5 px.
    const [pxm, pzm] = toMap(playerCar ? playerCar.x : px, playerCar ? playerCar.z : pz);
    g.fillStyle = '#ff5a3d';
    g.beginPath(); g.arc(pxm, pzm, 4.5, 0, Math.PI * 2); g.fill();
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
    // Called by main.js once the mission manager exists; choice button
    // clicks (and number keys) flow back through this handler.
    setChoiceHandler(fn) { choiceHandler = fn; },
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
      el.healthText.textContent = `${Math.round(state.health)} HP`;
      el.speed.textContent = `${Math.round(state.speedKmh)}`;
      el.car.textContent = state.carName || '';
      // Combat HUD: crosshair + ammo counter. The crosshair is
      // CONTEXTUAL (Day 4B, tightened now): shown only on foot while
      // aiming matters — an enemy is present, or a shot / hit marker
      // is live (state.aiming, set by main.js). On foot with nothing
      // to aim at it sat on the player's chest in every still; while
      // driving it stays hidden (no aim input in the car).
      // The hit marker only ever shows while the crosshair is visible.
      const aiming = !!state.onFoot && !!state.aiming;
      el.crosshair.hidden = !aiming;
      el.crosshair.classList.toggle('interact', aiming && !!state.interact);
      // Interaction prompt: only while an interaction is available
      // (near a car to steal, etc. — main.js sets state.interact).
      if (state.interact) {
        el.interact.textContent = state.interact;
        el.interact.hidden = false;
      } else {
        el.interact.textContent = '';
        el.interact.hidden = true;
      }
      const c = state.combat;
      if (c) {
        el.crosshair.classList.toggle('hit', aiming && !!c.hitMarker);
        el.ammoWeapon.textContent = c.name.toUpperCase();
        el.ammoCount.innerHTML = `${c.mag} <span class="reserve">/ ${c.reserve}</span>`;
        el.ammoReload.hidden = !c.reloading;
        if (c.mag === 0 && !c.reloading) el.ammoReload.textContent = 'EMPTY — press R';
        else el.ammoReload.textContent = 'RELOADING…';
      }
      el.mode.textContent = state.onFoot ? 'ON FOOT' : 'DRIVING';
      el.hint.textContent = state.hint || (state.onFoot
        ? 'WASD move · E enter car · F fire · Q weapon'
        : 'W/S drive · A/D steer · Space brake · E exit');
      el.banner.textContent = state.banner || district;
      // Mission card (Day 4B): title line on top, objective on its own
      // line below — the old single line crammed job + title + state +
      // progress + objective into one wrapping blob.
      const m = state.mission;
      if (m && typeof m === 'object') {
        el.mission.textContent = `${m.job} — ${m.title} · ${m.state} · ${m.done}/${m.total}`;
        el.objective.textContent = m.objective || '';
      } else {
        el.mission.textContent = m || '';
        el.objective.textContent = '';
      }
      // Dialogue box: speaker + current ink line + choice buttons.
      const d = state.dialogue;
      if (d && d.text) {
        el.dialogue.hidden = false;
        el.speaker.textContent = d.speaker ? d.speaker.toUpperCase() : '';
        el.dialogueText.textContent = d.text;
        const btns = [el.choice0, el.choice1];
        const choices = d.choices || [];
        btns.forEach((btn, i) => {
          if (choices[i]) {
            btn.hidden = false;
            btn.textContent = `${i + 1}. ${choices[i].text}`;
          } else {
            btn.hidden = true;
          }
        });
      } else {
        el.dialogue.hidden = true;
      }
      // Patrol response line, only while wanted: per-unit distance +
      // status. The state is stated ONCE when every unit shares it
      // ("CHASE — Luna-1 13m · Luna-2 5m · Luna-3 19m") instead of
      // repeating CHASE three times, with no "Patrol N" prefix (it
      // pushed the line past the panel edge at 768 px); mixed states
      // get one letter per unit (P/C/S).
      if (state.wanted >= 1 && state.police && state.police.length > 0) {
        const units = state.police.map((u) => ({
          name: u.name.replace('Unit ', ''), dist: u.dist, state: u.state,
        }));
        const states = [...new Set(units.map((u) => u.state))];
        // Non-breaking spaces inside each unit bit, so a wrap can only
        // happen at the '·' separators — never mid-unit ("Luna-3" on
        // one line, "19m" on the next). The "Patrol N · " prefix is
        // dropped — at 11 px it measured ~290 px unwrapped inside a
        // 280 px inner panel and forced a wrap; the shared state word
        // plus the unit bits fit on one line at ~225 px, and the unit
        // count is already on the minimap. Mixed states use one
        // letter each (P/C/S) instead of the full word. And when more
        // than three units are out, only the first three are listed
        // with a "+N" tail — a fourth unit pushed the line to two
        // rows in the combat shot, and the minimap still shows all
        // of them.
        const shown = units.slice(0, 3);
        const extra = units.length - shown.length;
        const bits = shown.map((u) => `${u.name}\u00A0${u.dist}m${states.length === 1 ? '' : `\u00A0${u.state[0]}`}`).join(' · ')
          + (extra > 0 ? ` +${extra}` : '');
        el.patrol.textContent = states.length === 1
          ? `${states[0]} — ${bits}`
          : bits;
        el.patrol.hidden = false;
      } else {
        el.patrol.textContent = '';
        el.patrol.hidden = true;
      }
      // THE CITY REMEMBERS (Day 4D): a fresh escape flash wins, then
      // the witness alert, then the district-heat / wanted-car line.
      // All three share the two new rows so the 4B layout never moves.
      if (state.memoryFlash) {
        el.witness.textContent = state.memoryFlash;
        el.witness.hidden = false;
        el.witness.classList.add('good');
      } else if (state.witnessAlert) {
        el.witness.textContent = 'SEEN! A WITNESS SPOTTED YOU';
        el.witness.hidden = false;
        el.witness.classList.remove('good');
      } else {
        el.witness.textContent = '';
        el.witness.hidden = true;
      }
      if (state.wanted >= 1 || (state.districtHeatLevel ?? 0) > 0) {
        const pips = '●'.repeat(state.districtHeatLevel ?? 0) + '○'.repeat(5 - (state.districtHeatLevel ?? 0));
        const car = state.identifiedVehicle
          ? ` · ${state.identifiedVehicle.name.toUpperCase()}`
          : '';
        el.memoryLine.textContent = `${district} heat ${pips}${car}`;
        el.memoryLine.hidden = false;
      } else {
        el.memoryLine.textContent = '';
        el.memoryLine.hidden = true;
      }
      drawMinimap(p.x, p.z, p.yaw, state.cars, state.onFoot ? null : state.playerCar, state.police, state.flashTime, {
        lastKnown: state.wanted > 0 ? state.lastKnown : null,
        garage: state.garage, safehouse: state.safehouse,
      });
    },
    showScreen(screen) {
      document.getElementById('screen-title').hidden = screen !== 'title';
      document.getElementById('screen-paused').hidden = screen !== 'paused';
      document.getElementById('screen-over').hidden = screen !== 'over';
      document.getElementById('hud').hidden = screen === 'title' || screen === 'over';
    },
  };
}
