# cabo-luna

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/lanadelreiiiii/cabo-luna/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/lanadelreiiiii/cabo-luna/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Cabo Luna is an original sunset coastal open-world crime game — 5 missions, 3 weapons, police chases, helicopter pursuit, radio, and a city that remembers, built in three.js.

## Run it

```sh
node serve.ts
```

Open http://localhost:8080 — fully offline, no network requests.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8tzhpmv9&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

## Controls

- **WASD / arrows** — move (camera-relative)
- **Shift** — sprint
- **Space** — jump
- **Drag mouse** — orbit camera
- **Enter** — start / retry
- **P / Esc** — pause

## Shots (deterministic, `?shot=…&seed=1`)

- `?shot=start` — title over the city and the bay
- `?shot=play` — on foot in Plaza del Reloj
- `?shot=chase` — staged low camera behind the player (no police yet)
- `?shot=end` — game-over screen

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/dossier.json` plus copies of `game/` and `screenshots/`.
