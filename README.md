# Cabo Luna — Make GTA 6 (gta6-01)

An original sunset coastal open-world crime game. One bay, six districts
(Bahia Azul, Torre Alta, Luna Vieja, Mercado Norte, Colina Verde,
Puerto Luna), a lighthouse, palm-lined streets, and a city built
deterministically from a single seed.

Day 0: procedural city + on-foot third-person play. Driving, traffic,
police, and missions arrive on later days.

## Run

```sh
node serve.ts
```

Open http://localhost:8080 — fully offline, no network requests.

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
