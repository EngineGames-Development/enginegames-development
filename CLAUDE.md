# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is the GitHub **profile README** repo of EngineGames-Development (`README.md` is shown on their GitHub profile). It also hosts **The Engine Room** (`room/`): an interactive cartoon 3D room built with three.js out of the owner's interests (OS dev, low-level, security/RE, embedded, AI, game dev). `Prompt.MD` is the design spec for the room; keep it in sync when adding or changing room features.

The README links to the room's GitHub Pages build (`https://enginegames-development.github.io/enginegames-development/room/`) and shows `room/preview.jpg`. `.nojekyll` makes Pages serve `room/` as-is. A README cannot run JavaScript or embed iframes, so the README only ever gets an image/GIF plus a link.

## Running and checking

There is no build step, package.json, linter or test suite. Plain ES modules load three.js `0.170.0` from jsdelivr through the import map in `room/index.html`.

- Serve: `cd room && python3 -m http.server 8000`, then open `http://localhost:8000/` (modules do not load from `file://`).
- Pure-logic modules (`cpu.js`, `db.js`, `net.js`) have no DOM or three.js imports and can be exercised directly with Node, for example:
  `node -e "import('./room/js/cpu.js').then(({assemble, PROGRAMS}) => console.log(assemble(PROGRAMS['knight.asm'])))"`
- Browser checks use the preinstalled Playwright/Chromium. In sandboxed sessions the CDN may be blocked: install `three@0.170.0` into a scratch dir and `page.route()` the jsdelivr URLs to the local copy. Launch Chromium with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. Software rendering runs at ~10 FPS, and shaders compile the first time an object comes into view, so wait a few seconds after moving the camera before asserting hover state.
- `window.engineRoom` is a debug hook: `setPose(x, z, yaw, pitch)`, `hovered`, `mode`, `terminal` (call `terminal.submit('<command>')`), `cpu`, `extras`, `enterFocus`, `toggleLights`.

## Architecture

`room/js/main.js` is the entry point and owns the scene. It creates the renderer (rendered through three's `OutlineEffect` for ink outlines, no post-processing composer), the shared helpers, the original room objects, the controls, the HUD wiring and the main loop. Other object sets live in `props.js` (`buildExtras`) and `props2.js` (`buildMore`). main.js calls each once and passes them a bag of helpers (`mat`, `box`, `cyl`, `ball`, `sign`, `canvasTexture`, `interact`, `collide`, `animated`, `showInfo`, `sfx`, `emit`, `terminal`, `cpu`, …). New objects should use these helpers instead of raw three.js materials so they stay in the toon style.

Cross-cutting conventions that span files:

- **Interaction**: `interact(object, label, action)` tags every mesh under `object` with `userData.interact`. A center-screen raycast (or a tap on touch screens) finds the first hit and calls `action`. Meshes that should not block the ray (glass, particles, bubbles) set `userData.noHit = true`.
- **Collision**: `collide(minX, maxX, minZ, maxZ)` adds an XZ box the player is pushed out of. The room spans x −5..5, z −4..4, height 3. Anything placed on the floor needs a collider and a free spot, because the layout is dense.
- **Animation**: push `(t, dt) => {}` into `animated`; it runs every frame.
- **Materials and outlines**: `mat()` is a `MeshToonMaterial` with a shared 3-step gradient map. Set `userData.outlineParameters = { visible: false }` (or use `mat(color, { outline: false })`) for planes, screens, instanced meshes and anything clipped. `OutlineEffect` does not support `InstancedMesh` or clipping planes. Faces that sit at exactly the same position flicker (z-fighting), so offset them.
- **The `sys` object** (built in main.js) is how `terminal.js` reaches the world. Terminal commands call hooks such as `sys.setLeds`, `sys.emit`, `sys.sound`, `sys.setArm` and `sys.onFlag`. Props become reachable from the terminal through late-bound `extras?.` / `more?.` calls on `sys`.
- **EG-8 I/O ports** are routed in `cpu.ports.out` in main.js: `0x00` LEDs, `0x01` putc, `0x02` putnum, `0x10` entropy in, `0x20` lamp hue, `0x30–0x32` robot arm, `0x50/0x51` LED matrix column select/write. Demo programs live in `PROGRAMS` in `cpu.js`. They appear in the virtual filesystem under `~/asm/`, and `run <name>.asm` finds them by bare name.
- **Quests**: `emit(id)` in main.js unlocks a quest defined in `quests.js` (`QUESTS`). Progress, CTF flags and the arcade high score persist in `localStorage`.
- **Focus mode**: the CRT terminal, the arcade and the RE laptop are "sit-down" targets `{ screen, w, h, hint, keydown, keyup, onEnter, onExit }` passed to `enterFocus()`. The camera tweens to face the screen mesh and keys are routed to the target.
- **Canvas textures** drive every screen: the terminal (`Terminal.canvas`), the arcade (`PacketCatcher.canvas`), the oscilloscope, the laptop, the neural-net easel and the signs. Set `texture.needsUpdate = true` after redrawing, and skip redrawing when the camera is far away.

Module roles: `terminal.js` holds the shell, the virtual FS (built in `makeFS`), the commands and the CTF flags. `cpu.js` is the EG-8 CPU, its two-pass assembler and disassembler, and the crackme source. `net.js` builds and decodes Ethernet/IPv4 packets with RFC 1071 checksums. `entropy.js` is the optical RNG pool, fed from an off-screen render of the lava shader. `db.js` is the mini SQL and MongoDB-style query engine. `shaders.js` holds the GLSL shaders (CRT, lava, GPU TV, sky). `arcade.js` is the Packet Catcher game. `audio.js` is the synthesized WebAudio SFX. `quests.js` is the quest tracker.

`room/index.html` contains all HUD markup and CSS. The room renders inside `#stage` (a framed 16:9 box with page text below it, plus a fullscreen toggle). HUD elements are absolutely positioned inside `#stage`, and sizing comes from `#stage`, not the window.

## Publishing

- Work on the session's designated `claude/...` branch; the README only updates on GitHub once that branch is merged into `main`.
- A private claude.ai artifact preview of the room may exist for this project. Republish `room/` files to it with the artifact tools after changes.
