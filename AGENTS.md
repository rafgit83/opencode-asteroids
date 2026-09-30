# AGENTS.md

Single-file HTML5 Canvas Asteroids clone. No dependencies, no bundler, no `package.json`, no tests, no lint/CI tooling. All game code lives in `game.js`; `index.html` only hosts the canvas and loads it.

## Running / verifying

- No build step. Open `index.html` in a browser, or `npx serve .` (default port 3000).
- No automated tests — verify changes by playing the game and watching the browser console for errors.

## Gotchas

- Canvas size is hardcoded in **two places**: `W`/`H` in `game.js` and `width`/`height` on `<canvas>` in `index.html`. Keep them in sync.
- Comments, HUD text, and README are in Spanish. Keep new comments/UI strings in Spanish.
- README mentions power-ups and a "estrella fugaz" asteroid, but `game.js` does not implement them. Trust the code, not the README, for the feature inventory.

## Code conventions in game.js

- Keep the single-file structure: ES6 classes plus module-level mutable globals (`ship`, `bullets`, `asteroids`, `particles`, `score`, `state`…). Don't introduce modules or a bundler.
- State machine: `state` is `'playing' | 'dead' | 'gameover'`; death uses a 2 s `deadTimer` before respawn.
- Asteroid `size`: 1 = small, 2 = medium, 3 = large. Parallel arrays `RADII`/`SPEEDS`/`POINTS` are indexed by `size` (index 0 unused). Splitting spawns two asteroids of `size - 1`.
- Input: `keys` tracks held keys; `pressed()` is edge-triggered and consumes the press. Any new game key must be added to the `preventDefault()` list in the keydown listener or the page will scroll.
- Physics is px/s scaled by `dt` (clamped to 0.05 s), but `DRAG` (0.987) is applied per frame, not dt-scaled — drag is frame-rate dependent.
- All entities wrap around screen edges via `wrap()` (toroidal space) except `Particle`s, which fly straight.
