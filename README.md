# Agent Village — Phase 1

Smallville-style village simulation, single HTML file. 6 villagers with
hunger/energy/money needs pick actions with **utility AI** (no LLM) in a
ticking world with a food economy.

## Run

Open `index.html` (needs internet for the Three.js CDN), or:

```bash
python3 -m http.server 8000   # then http://localhost:8000
```

- drag = rotate, pinch/scroll = zoom, tap a villager = stats
- ▶/⏸, 1×/2×/4× speed

## Test

```bash
node test_sim.js
```

Extracts the sim core from `index.html` and runs 1500 ticks headless:
range checks, economy liveness, determinism.

## Phase 1 scope

Done: world tick, needs, jobs (farmer/builder/trader), food granary +
market, utility-AI action selection with hysteresis, 3D isometric village,
touch controls.

Skipped (Phase 2): GLB character models (primitives now), LLM agents,
reflection/memory, multiplayer world server.
