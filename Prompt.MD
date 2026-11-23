# Prompt: "The Engine Room": an interactive 3D room in three.js

## Goal

Build an interactive, first-person 3D room in **three.js** that shows the interests of
**EngineGames-Development**: someone who started out in game development (Lua) and moved on to
**operating systems, low-level programming (Rust, C, x86 Assembly), cybersecurity and reverse
engineering, embedded systems (Arduino / Raspberry Pi), AI, fullstack and GPU graphics (Vulkan / OpenGL)**.

The room should not be a static diorama. Most objects should **do something real**, preferably
something low-level, so the visitor can poke at actual mechanisms (CPU, memory, packets, entropy,
signatures, crypto) instead of just reading labels.

## Technical constraints

- Plain HTML + ES modules, with no build step. three.js loads from a CDN through an import map.
- Runs from any static web server (for example `python3 -m http.server`) or GitHub Pages.
- Keep the code modular: one module per subsystem (CPU, terminal, network, entropy, shaders, scene).
- Aim for 60 FPS on a mid-range laptop: instanced meshes, few dynamic lights, small render targets.
- Visual style: **cartoony and cheerful**, like a cozy animated-movie bedroom workshop:
  - toon shading (`MeshToonMaterial` with a 3-step gradient) and black ink outlines (`OutlineEffect`)
  - rounded, chunky furniture (`RoundedBoxGeometry`), warm saturated colors, polka-dot wallpaper, wooden floor
  - daylight through a window with a cartoon sky (clouds, hills, little houses); the light switch turns it into night with fairy lights
  - recognizable props instead of abstract shapes: illustrated posters, potted plants, a wall clock that shows the real time,
    a sleeping cat on a bean bag, a trash can full of crumpled core dumps, a TV cabinet with a game console
  - rounded cartoon HUD (Fredoka font, cream cards, thick outlines)

## Controls

| Input              | Action                                                   |
| :----------------- | :------------------------------------------------------- |
| Click              | Lock the mouse and enter the room                        |
| `W A S D` / arrows | Walk                                                     |
| Mouse              | Look around (drag to look if pointer lock is unavailable) |
| `E` or left click  | Use the object under the crosshair                       |
| `Esc`              | Leave the terminal / pause                               |

## Room layout and interactive objects

### 1. Desk + CRT monitor: the "SecureRustOS" terminal (centerpiece)
- A CRT monitor whose screen is a **canvas texture rendered through a custom CRT shader**
  (scanlines, barrel distortion, vignette, flicker).
- Using it moves the camera in front of the screen, and the keyboard then types into the terminal.
- It shows a fake **boot sequence** (BIOS POST → bootloader at `0x7C00` → A20 gate → GDT →
  protected mode → paging → kernel `main`).
- A shell with a virtual filesystem and commands: `help ls cd cat pwd echo write clear uname
  neofetch whoami history reboot`, plus the low-level commands listed below.

### 2. EG-8: a real 8-bit CPU emulator (low-level feature)
- 4 general-purpose registers `A B C D`, `PC`, `SP`, flags `Z C N`, 256 bytes RAM, stack at `0xFF`.
- Instruction set: `NOP HLT MOV LD ST ADD SUB AND OR XOR CMP INC DEC SHL SHR NOT JMP JZ JNZ JC
  JNC CALL RET PUSH POP OUT IN SLP`.
- A **two-pass assembler** (labels, `db` strings/bytes, `0x` / `0b` / decimal literals, comments)
  and a **disassembler**.
- I/O ports:
  - `0x00` → 8 LEDs on the desk breadboard
  - `0x01` → print a character to the terminal
  - `0x02` → print a number to the terminal
  - `0x10` ← read a byte from the hardware entropy pool
  - `0x20` → set the desk lamp color (hue)
- Terminal commands: `asm`, `run`, `stop`, `step`, `regs`, `mem`, `dis`, `clock`, `leds`.
- Example programs in `~/asm/`: `blink`, `knight` (Knight-Rider LEDs), `hello`, `fib`, `random`, `lamp`.

### 3. RAM visualizer wall panel
- A 16×16 grid (one cell per byte of EG-8 RAM) above the desk, updated live while the CPU runs.
- Cell brightness = byte value. The **PC** cell is highlighted green and the **SP** cell red.

### 4. Breadboard + Arduino + Raspberry Pi
- 8 LEDs wired to port `0x00`. Clicking the Arduino flashes and runs `knight.asm`.

### 5. Lava lamp: optical entropy source (nod to Hybrid-Entropy-Computing-Platform)
- A lava lamp drawn with a **custom GLSL metaball shader**.
- Entropy is harvested *optically*: the lamp is rendered into a tiny off-screen render target,
  pixels are read back with `readRenderTargetPixels`, the least significant bits are collected,
  **von Neumann debiased**, mixed with `crypto.getRandomValues` and whitened with **SHA-256**.
- Terminal: `entropy [n]` prints bytes from the pool and its estimated Shannon entropy.

### 6. Server rack: packet capture (Wireshark / Nmap nod)
- Blinking rack LEDs. Clicking opens a live packet-capture panel.
- Packets are built **byte by byte**: Ethernet II + IPv4 (with a real **RFC 1071 header checksum**)
  + TCP/UDP/ICMP, then decoded back into a Wireshark-like line plus a hex dump.
- Terminal: `sniff [n]`, `nmap` (scans the "devices" in the room).

### 7. Virus jar: Engine's Antivirus
- A cartoon virus with googly eyes and angry brows bouncing inside a glass jar. After a scan it calms down, turns blue and falls asleep.
- Terminal `scan`: byte **signature matching** across the virtual filesystem plus a per-file
  **Shannon entropy** heuristic (packed/encrypted files get flagged), with quarantine.

### 8. Safe: EngineManager password vault
- Clicking opens the safe door and generates a password from the entropy pool with its strength in bits.
- Terminal: `vault gen [len]`, `vault hash <text>` (SHA-256 via WebCrypto).

### 9. EngineBuddy: AI desk companion
- A small floating robot that turns its head toward the player.
- Click it, or use `buddy <question>`, for keyword-matched answers and low-level trivia.

### 10. GPU shader TV (Vulkan / OpenGL nod)
- A wall-mounted TV running full fragment shaders: a raymarched SDF scene, a plasma and a Mandelbrot set.
  Clicking switches the shader.

### 11. Game-dev corner (where it all started)
- A table with colorful studded bricks. Clicking drops a new brick that falls with simple gravity
  and bounce physics.

### 12. Extra low-level terminal commands
- `gdt`: builds real 8-byte x86 GDT descriptors from base/limit/access/flags and prints them in hex.
- `irq`: shows interrupt counters (IRQ0 timer, IRQ1 keyboard) that the room really increments.
- `cpuinfo`, `ps`, `lsdev`, `hexdump <file>`.

### 13. Atmosphere
- Bookshelf with readable spines (Intel SDM, OSTEP, The Rust Book, K&R C, Practical Malware
  Analysis, …). Clicking a book shows a short note about it.
- Light switch (room lights on/off), desk lamp, rug, window with a starry night sky, posters, and bloom.

## Deliverables

```
Prompt.MD          ← this file
room/index.html    ← entry point (HUD, import map, styles)
room/js/main.js    ← scene, controls, interaction, objects
room/js/cpu.js     ← EG-8 CPU, assembler, disassembler
room/js/terminal.js← canvas terminal, shell, virtual filesystem
room/js/net.js     ← packet builder / checksum / decoder
room/js/entropy.js ← optical entropy pool
room/js/shaders.js ← CRT, lava lamp, GPU screen shaders
```
