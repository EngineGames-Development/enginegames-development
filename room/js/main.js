// The Engine Room: scene, controls, interaction and all the room objects.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CPU, hex } from './cpu.js';
import { EntropyPool } from './entropy.js';
import { Terminal, buddyReply, generatePassword } from './terminal.js';
import { randomFrame, decode, hexdump } from './net.js';
import { crtMaterial, lavaMaterial, gpuMaterial, skyMaterial, GPU_MODES } from './shaders.js';

// ------------------------------------------------------------------ renderer / scene

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070f);
scene.fog = new THREE.Fog(0x07070f, 9, 18);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 50);
camera.position.set(0, 1.6, 2.6);
camera.rotation.order = 'YXZ';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const ROOM = { minX: -5, maxX: 5, minZ: -4, maxZ: 4, h: 3 };
const colliders = [];        // XZ boxes the player cannot walk into
const interactables = [];    // { label, action }
const animated = [];         // functions (t, dt) called every frame
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ------------------------------------------------------------------ helpers

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });
}
function glow(color, intensity = 1) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}
function box(w, h, d, material, x = 0, y = 0, z = 0, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, parent = scene, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function collide(minX, maxX, minZ, maxZ) { colliders.push({ minX, maxX, minZ, maxZ }); }

function interact(object, label, action) {
  const entry = { label, action };
  object.traverse((o) => { o.userData.interact = entry; });
  interactables.push(entry);
  return entry;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// A flat sign with text. Faces +z by default.
function sign(lines, { w = 0.6, h = 0.12, fg = '#5ad1ff', bg = '#0b0f1e', font = 'bold 56px monospace', px = 1024 } = {}) {
  const ph = Math.round(px * (h / w));
  const tex = canvasTexture(px, ph, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 12;
    const arr = Array.isArray(lines) ? lines : [lines];
    const lh = H / (arr.length + 0.6);
    arr.forEach((l, i) => g.fillText(l, W / 2, lh * (i + 0.8)));
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
}

// ------------------------------------------------------------------ systems

const cpu = new CPU();
const pool = new EntropyPool();
const irq = { timer: 0, kbd: 0, nic: 0, mouse: 0 };
let clockHz = 400;
let ledState = 0;
let avState = 'infected'; // 'infected' | 'clean'
let lightsOn = true;
let gpuMode = 0;

const sys = {
  cpu, pool, irq,
  getHz: () => clockHz,
  setHz: (hz) => { clockHz = hz; },
  setLeds: (v) => { ledState = v & 0xff; },
  setLampHue: (v) => setLampHue(v),
  avThreats: () => avState === 'infected',
  onScan: (n) => onScan(n),
  setGpuMode: (m) => setGpuMode(m),
  toggleLights: () => toggleLights(),
  onExit: () => exitFocus(),
  onProgramLoaded: () => {},
};
const terminal = new Terminal(sys);

cpu.ports.out = (port, v) => {
  if (port === 0x00) ledState = v;
  else if (port === 0x01) terminal.putc(v);
  else if (port === 0x02) terminal.print(String(v), '#ffb347');
  else if (port === 0x20) setLampHue(v);
};
cpu.ports.in = (port) => (port === 0x10 ? pool.byte() : 0);

// ------------------------------------------------------------------ lights

const hemi = new THREE.HemisphereLight(0x8a90ff, 0x1a1028, 0.55);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x404070, 0.35);
scene.add(ambient);
const ceilingLight = new THREE.PointLight(0xffe2c0, 9, 12, 1.6);
ceilingLight.position.set(0, 2.85, 0);
scene.add(ceilingLight);
const ceilingDisc = cyl(0.35, 0.35, 0.03, glow(0xffe8cc, 1.6), 0, 2.98, 0);

// ------------------------------------------------------------------ room shell

const floorTex = canvasTexture(1024, 1024, (g, W, H) => {
  const plank = H / 8;
  for (let i = 0; i < 8; i++) {
    const shade = 40 + Math.random() * 18;
    g.fillStyle = `rgb(${shade + 20},${shade + 6},${shade - 8})`;
    g.fillRect(0, i * plank, W, plank);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(20,10,5,${Math.random() * 0.25})`;
      g.beginPath();
      const y = i * plank + Math.random() * plank;
      g.moveTo(0, y); g.bezierCurveTo(W / 3, y + 6, (2 * W) / 3, y - 6, W, y);
      g.stroke();
    }
    g.fillStyle = '#140c08';
    g.fillRect(0, i * plank, W, 3);
    const off = Math.random() * W;
    g.fillRect(off, i * plank, 3, plank);
  }
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(3, 3);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat(0xffffff, { map: floorTex, roughness: 0.8 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat(0x16162a));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = ROOM.h;
scene.add(ceiling);

const wallMat = mat(0x1d2040, { roughness: 0.9 });
function wall(w, x, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), wallMat);
  m.position.set(x, ROOM.h / 2, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  scene.add(m);
}
wall(10, 0, -4, 0);            // north
wall(10, 0, 4, Math.PI);       // south
wall(8, -5, 0, Math.PI / 2);   // west
wall(8, 5, 0, -Math.PI / 2);   // east

// skirting boards and neon strips
const skirt = mat(0x0c0c18);
box(10, 0.1, 0.02, skirt, 0, 0.05, -3.99); box(10, 0.1, 0.02, skirt, 0, 0.05, 3.99);
box(0.02, 0.1, 8, skirt, -4.99, 0.05, 0); box(0.02, 0.1, 8, skirt, 4.99, 0.05, 0);
const neonA = glow(0xb04dff, 2.2), neonB = glow(0x2fd4ff, 2.2);
box(10, 0.025, 0.025, neonA, 0, 2.94, -3.97); box(10, 0.025, 0.025, neonA, 0, 2.94, 3.97);
box(0.025, 0.025, 8, neonB, -4.97, 2.94, 0); box(0.025, 0.025, 8, neonB, 4.97, 2.94, 0);

// rug with a circuit-board pattern
const rugTex = canvasTexture(1024, 768, (g, W, H) => {
  g.fillStyle = '#121a33'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b3d78'; g.lineWidth = 6;
  for (let i = 0; i < 70; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      if (Math.random() < 0.5) x += (Math.random() - 0.5) * 300; else y += (Math.random() - 0.5) * 300;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = '#3d58a8'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = '#7a5cff'; g.lineWidth = 18; g.strokeRect(20, 20, W - 40, H - 40);
});
const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.5), mat(0xffffff, { map: rugTex, roughness: 1 }));
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.004, 0.4);
rug.receiveShadow = true;
scene.add(rug);

// ------------------------------------------------------------------ desk area

const wood = mat(0x3b2a20, { roughness: 0.6 });
const metalDark = mat(0x222431, { metalness: 0.6, roughness: 0.4 });
const deskTopY = 0.76;
box(2.4, 0.05, 0.9, wood, 0, deskTopY - 0.025, -3.45);
for (const [x, z] of [[-1.15, -3.85], [1.15, -3.85], [-1.15, -3.05], [1.15, -3.05]]) box(0.05, deskTopY - 0.05, 0.05, metalDark, x, (deskTopY - 0.05) / 2, z);
collide(-1.25, 1.25, -4, -2.95);

// chair
const chair = new THREE.Group();
chair.position.set(-0.15, 0, -2.45);
scene.add(chair);
cyl(0.03, 0.03, 0.42, metalDark, 0, 0.23, 0, chair);
box(0.5, 0.07, 0.48, mat(0x2a1f4a), 0, 0.47, 0, chair);
box(0.48, 0.55, 0.06, mat(0x2a1f4a), 0, 0.8, 0.24, chair);
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  box(0.3, 0.03, 0.04, metalDark, Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15, chair).rotation.y = -a;
}
collide(-0.45, 0.15, -2.75, -2.15);

// CRT monitor with the terminal on a canvas texture + CRT shader
const termTex = new THREE.CanvasTexture(terminal.canvas);
termTex.colorSpace = THREE.SRGBColorSpace;
termTex.anisotropy = maxAniso;
const crt = crtMaterial(termTex);
const monitor = new THREE.Group();
monitor.position.set(-0.15, deskTopY, -3.62);
scene.add(monitor);
const beige = mat(0x2b2d3a, { roughness: 0.5 });
box(0.25, 0.03, 0.2, beige, 0, 0.015, 0, monitor);
box(0.08, 0.05, 0.08, beige, 0, 0.05, 0, monitor);
box(0.62, 0.5, 0.42, beige, 0, 0.32, 0.03, monitor);
box(0.46, 0.38, 0.22, beige, 0, 0.32, -0.25, monitor);
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), crt);
screen.position.set(0, 0.325, 0.242);
monitor.add(screen);
box(0.02, 0.02, 0.01, glow(0x39ff88, 3), 0.27, 0.1, 0.245, monitor); // power LED
const screenGlow = new THREE.PointLight(0x39ff88, 0.6, 2.2, 2);
screenGlow.position.set(0, 0.33, 0.5);
monitor.add(screenGlow);
interact(monitor, '[E] Use the SecureRustOS terminal', () => enterFocus());

// keyboard with instanced keys that flash when you type
const keyboard = new THREE.Group();
keyboard.position.set(-0.15, deskTopY, -3.17);
scene.add(keyboard);
box(0.47, 0.022, 0.16, mat(0x1a1b26), 0, 0.011, 0, keyboard);
const KEY_COLS = 15, KEY_ROWS = 4;
const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.024, 0.012, 0.024), new THREE.MeshStandardMaterial({ roughness: 0.6 }), KEY_COLS * KEY_ROWS);
const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
for (let r = 0; r < KEY_ROWS; r++) for (let c = 0; c < KEY_COLS; c++) {
  tmpM.makeTranslation(-0.205 + c * 0.0293, 0.026, -0.05 + r * 0.032);
  keys.setMatrixAt(r * KEY_COLS + c, tmpM);
  keys.setColorAt(r * KEY_COLS + c, tmpC.set(0x3a3d55));
}
keyboard.add(keys);
const keyHeat = new Float32Array(KEY_COLS * KEY_ROWS);
function flashKey() { keyHeat[Math.floor(Math.random() * keyHeat.length)] = 1; }
animated.push((t, dt) => {
  for (let i = 0; i < keyHeat.length; i++) {
    keyHeat[i] = Math.max(0, keyHeat[i] - dt * 3);
    keys.setColorAt(i, tmpC.set(0x3a3d55).lerp(new THREE.Color(0x39ff88), keyHeat[i]));
  }
  keys.instanceColor.needsUpdate = true;
});
interact(keyboard, '[E] Use the SecureRustOS terminal', () => enterFocus());

// coffee mug
const mug = new THREE.Group();
mug.position.set(0.25, deskTopY, -3.15);
scene.add(mug);
cyl(0.04, 0.035, 0.1, mat(0x7a5cff), 0, 0.05, 0, mug);
cyl(0.036, 0.036, 0.005, mat(0x2a160a), 0, 0.097, 0, mug);
const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 8, 16), mat(0x7a5cff));
handle.position.set(0.045, 0.05, 0);
mug.add(handle);
interact(mug, '0xC0FFEE', () => showInfo('Mug', 'Contents: <code>0xC0FFEE</code>. Required to fix triple faults at 3 AM.'));

// breadboard with 8 LEDs on port 0x00
const bread = new THREE.Group();
bread.position.set(0.62, deskTopY, -3.32);
scene.add(bread);
box(0.38, 0.02, 0.13, mat(0xeeeeee, { roughness: 0.9 }), 0, 0.01, 0, bread);
box(0.38, 0.002, 0.01, mat(0xcc3344), 0, 0.021, 0.055, bread);
box(0.38, 0.002, 0.01, mat(0x3355cc), 0, 0.021, -0.055, bread);
const ledMats = [];
const ledColors = [0xff3355, 0xff3355, 0xffaa22, 0xffaa22, 0x33ff77, 0x33ff77, 0x33aaff, 0x33aaff];
for (let i = 0; i < 8; i++) {
  const m = new THREE.MeshStandardMaterial({ color: ledColors[i], emissive: ledColors[i], emissiveIntensity: 0, transparent: true, opacity: 0.9 });
  ledMats.push(m);
  const x = 0.14 - i * 0.04; // bit 0 on the right
  cyl(0.01, 0.01, 0.018, m, x, 0.03, 0, bread, 12);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.01, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
  dome.position.set(x, 0.039, 0);
  bread.add(dome);
  box(0.004, 0.002, 0.05, mat(0x22aa44), x, 0.022, -0.03, bread); // jumper wire
}
const ledLight = new THREE.PointLight(0xff5577, 0, 1.2, 2);
ledLight.position.set(0.62, deskTopY + 0.12, -3.3);
scene.add(ledLight);
animated.push(() => {
  let on = 0;
  for (let i = 0; i < 8; i++) {
    const bit = (ledState >> i) & 1;
    ledMats[i].emissiveIntensity += ((bit ? 3.5 : 0) - ledMats[i].emissiveIntensity) * 0.5;
    on += bit;
  }
  ledLight.intensity = on * 0.12;
});
interact(bread, 'Breadboard: 8 LEDs on EG-8 port 0x00', () =>
  showInfo('Breadboard LEDs', `Wired to EG-8 port <code>0x00</code>. Current value: <code>0x${hex(ledState)}</code> = <code>${ledState.toString(2).padStart(8, '0')}b</code>.<br>In the terminal: <code>leds 0b10101010</code> or <code>run blink.asm</code>.`));

// Arduino board: flashes and runs knight.asm
const arduino = new THREE.Group();
arduino.position.set(0.66, deskTopY, -3.62);
scene.add(arduino);
box(0.2, 0.012, 0.14, mat(0x00878f, { roughness: 0.5 }), 0, 0.006, 0, arduino);
box(0.07, 0.012, 0.022, mat(0x111111), 0.02, 0.018, 0.01, arduino);
box(0.04, 0.03, 0.035, mat(0xaaaaaa, { metalness: 0.8, roughness: 0.3 }), -0.09, 0.02, -0.035, arduino);
box(0.16, 0.012, 0.01, mat(0x111111), 0.01, 0.018, 0.06, arduino);
box(0.008, 0.004, 0.008, glow(0x33ff66, 3), 0.07, 0.014, -0.04, arduino);
for (let i = 0; i < 8; i++) box(0.003, 0.003, 0.29, mat(0x22aa44), -0.07 + i * 0.012, 0.02, 0.17, arduino); // wires to the breadboard
interact(arduino, '[E] Arduino: flash knight.asm', () => {
  try {
    terminal.loadProgram('knight.asm');
    cpu.halted = false;
    terminal.print('[avrdude] flashing knight.asm ... done. EG-8 running.', '#5ad1ff');
    showInfo('Arduino', 'Flashed <code>knight.asm</code> onto the EG-8 core. Watch the LEDs! Open the terminal and type <code>dis</code> or <code>regs</code> to look inside.');
  } catch (e) { showInfo('Arduino', e.message); }
});

// Raspberry Pi: streams entropy to the LEDs
const pi = new THREE.Group();
pi.position.set(1.0, deskTopY, -3.25);
pi.rotation.y = -0.3;
pi.scale.setScalar(1.4);
scene.add(pi);
box(0.085, 0.012, 0.056, mat(0x1f7a3a, { roughness: 0.5 }), 0, 0.006, 0, pi);
box(0.014, 0.003, 0.014, mat(0x888888, { metalness: 0.8 }), -0.01, 0.014, 0, pi);
box(0.018, 0.016, 0.014, mat(0xbbbbbb, { metalness: 0.8, roughness: 0.3 }), 0.035, 0.02, 0.015, pi);
box(0.018, 0.016, 0.014, mat(0xbbbbbb, { metalness: 0.8, roughness: 0.3 }), 0.035, 0.02, -0.012, pi);
box(0.05, 0.006, 0.005, mat(0x111111), -0.01, 0.015, -0.025, pi);
box(0.004, 0.003, 0.004, glow(0xff2222, 3), -0.04, 0.014, 0.022, pi);
interact(pi, '[E] Raspberry Pi: stream entropy to the LEDs', () => {
  terminal.loadProgram('random.asm');
  cpu.halted = false;
  terminal.print('[pi] ssh engine@raspberrypi: running random.asm (IN A, 0x10 -> OUT 0x00, A)', '#5ad1ff');
  showInfo('Raspberry Pi', 'Running <code>random.asm</code>: it reads bytes from the optical entropy port <code>0x10</code> and writes them to the LEDs.');
});

// desk lamp (SpotLight with shadows, hue is controllable from EG-8 port 0x20)
const lamp = new THREE.Group();
lamp.position.set(-0.98, deskTopY, -3.65);
scene.add(lamp);
cyl(0.08, 0.09, 0.025, metalDark, 0, 0.012, 0, lamp);
const arm1 = box(0.02, 0.4, 0.02, metalDark, 0, 0.21, 0.05, lamp);
arm1.rotation.x = 0.25;
const head = new THREE.Group();
head.position.set(0, 0.42, 0.16);
lamp.add(head);
const shade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 24, 1, true), mat(0x5a2bd6, { side: THREE.DoubleSide, metalness: 0.4 }));
shade.rotation.x = Math.PI * 0.75;
head.add(shade);
const bulbMat = glow(0xfff1d0, 3);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), bulbMat);
bulb.position.set(0, -0.02, 0.02);
head.add(bulb);
const lampLight = new THREE.SpotLight(0xfff1d0, 6, 3, 0.75, 0.5, 1.4);
lampLight.position.set(-0.98, deskTopY + 0.42, -3.48);
lampLight.target.position.set(-0.35, deskTopY, -3.15);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(1024, 1024);
lampLight.shadow.bias = -0.0005;
scene.add(lampLight, lampLight.target);
let lampOn = true;
function setLampHue(v) {
  const c = new THREE.Color().setHSL((v & 0xff) / 255, 0.85, 0.6);
  lampLight.color.copy(c);
  bulbMat.emissive.copy(c);
  lampOn = true;
  lampLight.intensity = 6;
  bulbMat.emissiveIntensity = 3;
}
interact(lamp, '[E] Desk lamp on/off  (EG-8 port 0x20 sets the hue)', () => {
  lampOn = !lampOn;
  lampLight.intensity = lampOn ? 6 : 0;
  bulbMat.emissiveIntensity = lampOn ? 3 : 0;
});

// ------------------------------------------------------------------ RAM visualizer

const ram = new THREE.Group();
ram.position.set(0, 2.24, -3.96);
scene.add(ram);
box(1.24, 1.24, 0.03, mat(0x0a0b14, { metalness: 0.5 }), 0, 0, 0, ram);
const CELL = 0.07;
const ramCells = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.86, CELL * 0.86, 0.012), new THREE.MeshBasicMaterial({ toneMapped: false }), 256);
for (let i = 0; i < 256; i++) {
  const x = (i & 15) - 7.5, y = 7.5 - (i >> 4);
  tmpM.makeTranslation(x * CELL, y * CELL, 0.022);
  ramCells.setMatrixAt(i, tmpM);
  ramCells.setColorAt(i, tmpC.set(0x101020));
}
ram.add(ramCells);
const ramLabel = sign('EG-8 RAM  0x00 - 0xFF   ▪ PC   ▪ SP', { w: 1.24, h: 0.08, font: 'bold 52px monospace' });
ramLabel.position.set(0, -0.67, 0.02);
ram.add(ramLabel);
const cPC = new THREE.Color(0x39ff88), cSP = new THREE.Color(0xff3355);
animated.push(() => {
  for (let i = 0; i < 256; i++) {
    const v = cpu.mem[i];
    if (i === cpu.pc) tmpC.copy(cPC).multiplyScalar(1.6);
    else if (i === cpu.sp) tmpC.copy(cSP).multiplyScalar(1.6);
    else tmpC.setHSL(0.62 + v / 900, 0.8, 0.05 + (v / 255) * 0.55);
    ramCells.setColorAt(i, tmpC);
  }
  ramCells.instanceColor.needsUpdate = true;
});
interact(ram, 'EG-8 RAM visualizer (256 bytes, live)', () =>
  showInfo('RAM visualizer', `Each cell is one byte of EG-8 memory; brightness = value. <b style="color:#39ff88">Green</b> is the program counter (PC=0x${hex(cpu.pc)}), <b style="color:#ff3355">red</b> is the stack pointer (SP=0x${hex(cpu.sp)}). Try <code>run lamp.asm</code> to see the stack in action.`));

// posters on the north wall
function poster(lines, x, y, z, ry, color, w = 0.9, h = 1.2) {
  const tex = canvasTexture(600, 800, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#11142b'); grd.addColorStop(1, '#2a0f3d');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = color; g.lineWidth = 10; g.strokeRect(20, 20, W - 40, H - 40);
    g.fillStyle = color; g.textAlign = 'center'; g.shadowColor = color; g.shadowBlur = 20;
    lines.forEach(([t, size], i) => { g.font = `bold ${size}px monospace`; g.fillText(t, W / 2, 140 + i * 110); });
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  scene.add(m);
  return m;
}
poster([['RING 0', 90], ['', 40], ['no segfaults', 44], ['beyond this', 44], ['point', 44], ['', 40], ['CR0.PE = 1', 46]], -3.0, 1.75, -3.98, 0, '#ff5c7a');
poster([['while (alive) {', 40], ['  learn();', 40], ['  build();', 40], ['  break();', 40], ['  fix();', 40], ['}', 40]], 2.8, 1.75, -3.98, 0, '#5ad1ff');

// ------------------------------------------------------------------ lava lamp (optical entropy)

const sideTable = new THREE.Group();
sideTable.position.set(-1.9, 0, -3.55);
scene.add(sideTable);
box(0.5, 0.04, 0.5, wood, 0, 0.6, 0, sideTable);
box(0.42, 0.58, 0.42, mat(0x2a1d16), 0, 0.29, 0, sideTable);
const rngSign = sign('OPTICAL RNG', { w: 0.36, h: 0.07, fg: '#c792ea' });
rngSign.position.set(0, 0.45, 0.212);
sideTable.add(rngSign);
collide(-2.2, -1.6, -3.85, -3.25);

const lava = lavaMaterial();
const lavaLamp = new THREE.Group();
lavaLamp.position.set(-1.9, 0.62, -3.55);
scene.add(lavaLamp);
const chrome = mat(0xc0c4d8, { metalness: 0.9, roughness: 0.25 });
cyl(0.07, 0.11, 0.14, chrome, 0, 0.07, 0, lavaLamp, 32);
const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.095, 0.42, 32, 1, true), lava);
glass.position.y = 0.35;
lavaLamp.add(glass);
cyl(0.035, 0.055, 0.08, chrome, 0, 0.6, 0, lavaLamp, 32);
const lavaLight = new THREE.PointLight(0xd040ff, 1.5, 2.5, 2);
lavaLight.position.set(-1.9, 1.05, -3.4);
scene.add(lavaLight);
interact(lavaLamp, '[E] Lava lamp: optical entropy source', () => {
  const b = pool.bytes(16);
  const s = pool.stats;
  showInfo('Optical entropy', `Fresh bytes: <code>${Array.from(b).map((x) => hex(x)).join(' ')}</code><br>
    Sensor frames: ${s.samples} · raw LSBs: ${s.rawBits} · kept after von Neumann: ${s.keptBits} (${(100 * s.keptBits / Math.max(1, s.rawBits)).toFixed(1)}%) · pool: ${pool.pool.length} B<br>
    Pipeline: lamp pixels → frame XOR → LSB → von Neumann → ⊕ CSPRNG → SHA-256.`, 9000);
});

// off-screen "camera sensor" that looks at the lava shader
const SENSOR = 24;
const sensorRT = new THREE.WebGLRenderTarget(SENSOR, SENSOR, { type: THREE.UnsignedByteType });
const sensorScene = new THREE.Scene();
const sensorCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 2);
const sensorPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lava);
sensorPlane.position.z = -1;
sensorScene.add(sensorPlane);
const sensorBuf = new Uint8Array(SENSOR * SENSOR * 4);
let sensorFrame = 0;
function sampleEntropy() {
  if (++sensorFrame % 4) return;
  renderer.setRenderTarget(sensorRT);
  renderer.render(sensorScene, sensorCam);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(sensorRT, 0, 0, SENSOR, SENSOR, sensorBuf);
  pool.feedPixels(sensorBuf);
}

// ------------------------------------------------------------------ server rack + packet capture

const rack = new THREE.Group();
rack.position.set(4.55, 0, -2.4);
scene.add(rack);
box(0.8, 2.0, 0.72, mat(0x111219, { metalness: 0.6, roughness: 0.4 }), 0, 1.0, 0, rack);
const RACK_UNITS = 9, RACK_LEDS = 12;
const unitMat = mat(0x24263a, { metalness: 0.5, roughness: 0.5 });
for (let u = 0; u < RACK_UNITS; u++) box(0.02, 0.16, 0.62, unitMat, -0.41, 0.2 + u * 0.19, 0, rack);
const rackLeds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, 0.014, 0.022), new THREE.MeshBasicMaterial({ toneMapped: false }), RACK_UNITS * RACK_LEDS);
for (let u = 0; u < RACK_UNITS; u++) for (let l = 0; l < RACK_LEDS; l++) {
  tmpM.makeTranslation(-0.425, 0.2 + u * 0.19 + 0.04, -0.26 + l * 0.035);
  rackLeds.setMatrixAt(u * RACK_LEDS + l, tmpM);
  rackLeds.setColorAt(u * RACK_LEDS + l, tmpC.set(0x113311));
}
rack.add(rackLeds);
const rackSign = sign('PACKET CAPTURE', { w: 0.6, h: 0.09, fg: '#39ff88' });
rackSign.position.set(-0.415, 1.9, 0);
rackSign.rotation.y = -Math.PI / 2;
rack.add(rackSign);
const rackLight = new THREE.PointLight(0x2fd4ff, 0.8, 2.5, 2);
rackLight.position.set(3.9, 1.2, -2.4);
scene.add(rackLight);
collide(4.1, 5, -2.8, -2.0);
let captureOn = false;
let rackBlink = 0;
animated.push((t, dt) => {
  rackBlink += dt;
  if (rackBlink < (captureOn ? 0.04 : 0.12)) return;
  rackBlink = 0;
  for (let i = 0; i < RACK_UNITS * RACK_LEDS; i++) {
    if (Math.random() < (captureOn ? 0.35 : 0.12)) {
      const r = Math.random();
      rackLeds.setColorAt(i, tmpC.set(r < 0.7 ? 0x22ff66 : r < 0.92 ? 0xffaa22 : 0x2fd4ff).multiplyScalar(Math.random() < 0.5 ? 1.5 : 0.15));
    }
  }
  rackLeds.instanceColor.needsUpdate = true;
});
interact(rack, '[E] Server rack: toggle live packet capture', () => toggleCapture());

const panel = document.getElementById('panel');
const panelList = document.getElementById('panel-list');
const panelHex = document.getElementById('panel-hex');
let captureTimer = 0, captureNo = 0;
const captureRows = [];
function toggleCapture(force) {
  captureOn = force ?? !captureOn;
  panel.classList.toggle('show', captureOn);
}
document.getElementById('panel-close').addEventListener('click', () => toggleCapture(false));
animated.push((t, dt) => {
  if (!captureOn) return;
  captureTimer += dt;
  if (captureTimer < 0.35) return;
  captureTimer = 0;
  const f = randomFrame();
  const d = decode(f);
  irq.nic++;
  captureNo++;
  captureRows.push(`<div class="row p-${d.proto}"><span>${captureNo}</span><span>${t.toFixed(3)}</span><span>${d.src}</span><span>${d.dst}</span><span>${d.proto}</span><span>${d.info}${d.ok ? ' <i>✓cksum</i>' : ' <b>bad cksum</b>'}</span></div>`);
  if (captureRows.length > 14) captureRows.shift();
  panelList.innerHTML = captureRows.join('');
  panelHex.textContent = hexdump(f, 80).join('\n');
});

// ------------------------------------------------------------------ GPU shader screen

const gpu = gpuMaterial();
const gpuScreen = new THREE.Group();
gpuScreen.position.set(4.96, 1.65, 0.7);
gpuScreen.rotation.y = -Math.PI / 2;
scene.add(gpuScreen);
box(1.9, 1.2, 0.04, mat(0x0a0a10, { metalness: 0.7 }), 0, 0, 0, gpuScreen);
const gpuPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), gpu);
gpuPlane.position.z = 0.022;
gpuScreen.add(gpuPlane);
const gpuSign = sign('GPU / SHADERS  -  raymarch', { w: 0.9, h: 0.08, fg: '#c792ea' });
gpuSign.position.set(0, -0.66, 0.03);
gpuScreen.add(gpuSign);
function updateGpuSign() {
  const tex = gpuSign.material.map;
  const g = tex.image.getContext('2d');
  const W = tex.image.width, H = tex.image.height;
  g.fillStyle = '#0b0f1e'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c792ea'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = '#c792ea'; g.font = 'bold 52px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`GPU / SHADERS  -  ${GPU_MODES[gpuMode]}`, W / 2, H / 2);
  tex.needsUpdate = true;
}
function setGpuMode(m) {
  if (m && GPU_MODES.includes(m)) gpuMode = GPU_MODES.indexOf(m);
  else gpuMode = (gpuMode + 1) % GPU_MODES.length;
  gpu.uniforms.mode.value = gpuMode;
  updateGpuSign();
  return GPU_MODES[gpuMode];
}
const gpuLight = new THREE.PointLight(0x7a5cff, 1.2, 3, 2);
gpuLight.position.set(4.4, 1.65, 0.7);
scene.add(gpuLight);
interact(gpuScreen, '[E] GPU screen: switch fragment shader', () => {
  const m = setGpuMode();
  showInfo('GPU shader', `Now running <code>${m}</code>, a pure fragment shader evaluated per pixel on the GPU. (OpenGL/Vulkan nod: no geometry, just math.)`);
});

// ------------------------------------------------------------------ bookshelf

const shelf = new THREE.Group();
shelf.position.set(-4.8, 0, -0.8);
scene.add(shelf);
const shelfWood = mat(0x2e2018);
box(0.36, 2.1, 0.03, shelfWood, 0, 1.05, -0.75, shelf);
box(0.36, 2.1, 0.03, shelfWood, 0, 1.05, 0.75, shelf);
box(0.02, 2.1, 1.5, shelfWood, -0.17, 1.05, 0, shelf);
for (const y of [0.04, 0.55, 1.05, 1.55, 2.08]) box(0.36, 0.03, 1.5, shelfWood, 0, y, 0, shelf);
collide(-5, -4.6, -1.6, 0);
box(0.02, 0.015, 1.44, glow(0xffd9a0, 2), 0.16, 2.05, 0, shelf); // LED strip under the top board
const shelfLight = new THREE.PointLight(0xffd0a0, 2.2, 3, 1.6);
shelfLight.position.set(-4.3, 1.9, -0.8);
scene.add(shelfLight);

const BOOKS = [
  ['Intel SDM Vol.3', '#2d5fa8', 'Intel® 64 and IA-32 Architectures Software Developer\'s Manual, Vol. 3: System Programming. The bible for GDT, IDT, paging and protected mode.'],
  ['OSTEP', '#a83b2d', 'Operating Systems: Three Easy Pieces. Virtualization, concurrency, persistence. Free online and excellent.'],
  ['The Rust Book', '#b7410e', 'The Rust Programming Language. Ownership and borrowing: how SecureRustOS avoids use-after-free.'],
  ['K&R C', '#e8e2d0', 'The C Programming Language by Kernighan & Ritchie. 272 pages, zero fluff.'],
  ['Practical Malware Analysis', '#222222', 'Sikorski & Honig. Static and dynamic analysis, unpacking. Pairs well with Ghidra.'],
  ['Ghidra Book', '#c0392b', 'The Ghidra Book. Reverse engineering with the NSA\'s open-source disassembler/decompiler.'],
  ['Hacking: Art of Exploitation', '#3a3a5a', 'Jon Erickson. Buffer overflows, shellcode and networking from the ground up.'],
  ['Computer Networking', '#2e8b57', 'Kurose & Ross. The top-down approach; read it next to Wireshark.'],
  ['Programming Pi', '#c51a4a', 'Getting started with the Raspberry Pi: GPIO, Linux and Python.'],
  ['Arduino Cookbook', '#00878f', 'Recipes for sensors, motors and LEDs. Exactly what the breadboard here is doing.'],
  ['Vulkan Guide', '#a41e22', 'Vulkan Programming Guide. ~1000 lines for a triangle, then infinite power.'],
  ['OpenGL SuperBible', '#5a7d2a', 'Shaders, buffers and the pipeline. The GPU screen across the room says hi.'],
  ['Deep Learning', '#4b3f72', 'Goodfellow, Bengio & Courville. The math behind EngineBuddy\'s future brain.'],
  ['Lua Programming', '#000080', 'Programming in Lua by Roberto Ierusalimschy. Where the game-dev journey started.'],
  ['Write Great Code', '#7b5e00', 'Randall Hyde. Understanding the machine so the compiler output makes sense.'],
  ['Crafting Interpreters', '#334455', 'Robert Nystrom. Build a language twice: a tree-walker, then a bytecode VM (like EG-8!).'],
];
function spineTexture(title, color) {
  return canvasTexture(96, 640, (g, W, H) => {
    g.fillStyle = color; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 40, W, 8); g.fillRect(0, H - 48, W, 8);
    const light = parseInt(color.slice(1), 16);
    const lum = ((light >> 16) & 255) * 0.3 + ((light >> 8) & 255) * 0.59 + (light & 255) * 0.11;
    g.fillStyle = lum > 150 ? '#111' : '#f5f0e0';
    g.save(); g.translate(W / 2, H / 2); g.rotate(Math.PI / 2);
    let size = 44;
    g.font = `bold ${size}px serif`;
    while (g.measureText(title).width > H - 120 && size > 18) { size -= 2; g.font = `bold ${size}px serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  });
}
const SHELF_YS = [0.57, 1.07, 1.57];
BOOKS.forEach(([title, color, note], i) => {
  const shelfIdx = Math.floor((i * SHELF_YS.length) / BOOKS.length);
  const shelfY = SHELF_YS[shelfIdx];
  if (i === 0 || Math.floor(((i - 1) * SHELF_YS.length) / BOOKS.length) !== shelfIdx) shelf.userData.z = -0.68;
  const z = shelf.userData.z;
  const th = 0.05 + Math.random() * 0.03;
  const h = 0.3 + Math.random() * 0.12;
  const d = 0.22 + Math.random() * 0.05;
  const spine = new THREE.MeshStandardMaterial({ map: spineTexture(title, color), roughness: 0.8 });
  const cover = mat(color);
  const b = new THREE.Mesh(new THREE.BoxGeometry(d, h, th), [spine, cover, cover, cover, cover, cover]); // +x face = spine
  b.position.set(0.17 - d / 2, shelfY + h / 2 + 0.015, z + th / 2);
  b.castShadow = true;
  shelf.add(b);
  interact(b, `Book: ${title}`, () => showInfo(title, note));
  shelf.userData.z = z + th + 0.005;
});
// top shelf decorations: a trophy and a floppy disk
const trophy = new THREE.Group();
trophy.position.set(-4.75, 2.1, -0.3);
scene.add(trophy);
cyl(0.05, 0.06, 0.04, mat(0x222222), 0, 0.02, 0, trophy);
cyl(0.07, 0.025, 0.12, mat(0xffc94a, { metalness: 0.9, roughness: 0.25 }), 0, 0.12, 0, trophy);
interact(trophy, 'Trophy: "First triple fault survived"', () => showInfo('Trophy', 'Awarded for surviving the first triple fault. The CPU reset, the developer did not give up.'));
const floppy = box(0.09, 0.003, 0.09, mat(0x1a1a8a), -4.72, 2.11, -1.1);
interact(floppy, 'SECURERUST.IMG (1.44 MB)', () => showInfo('Floppy disk', 'Contains <code>SECURERUST.IMG</code>. Sector 0 ends with <code>55 AA</code>. See <code>cat ~/projects/SecureRustOS/boot.asm</code>.'));

// ------------------------------------------------------------------ window, door, light switch

const win = new THREE.Group();
win.position.set(-1.8, 1.65, 3.98);
win.rotation.y = Math.PI;
scene.add(win);
const sky = skyMaterial();
const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.15), sky);
win.add(skyPlane);
const frameMat = mat(0x0d0d16, { metalness: 0.4 });
box(1.9, 0.05, 0.06, frameMat, 0, 0.6, 0.01, win); box(1.9, 0.05, 0.06, frameMat, 0, -0.6, 0.01, win);
box(0.05, 1.25, 0.06, frameMat, -0.93, 0, 0.01, win); box(0.05, 1.25, 0.06, frameMat, 0.93, 0, 0.01, win);
box(0.03, 1.15, 0.04, frameMat, 0, 0, 0.01, win); box(1.8, 0.03, 0.04, frameMat, 0, 0, 0.01, win);
box(2.0, 0.04, 0.16, frameMat, 0, -0.63, 0.06, win);
const moonLight = new THREE.DirectionalLight(0x6070c0, 0.35);
moonLight.position.set(-1.8, 2.4, 6);
moonLight.target.position.set(-1, 0, 0);
scene.add(moonLight, moonLight.target);
interact(win, 'Window: night shift', () => showInfo('Window', 'It is always night in the Engine Room. Best time for kernel debugging.'));

const door = new THREE.Group();
door.position.set(2.3, 0, 3.97);
door.rotation.y = Math.PI;
scene.add(door);
box(1.0, 2.15, 0.05, frameMat, 0, 1.075, 0, door);
box(0.9, 2.05, 0.05, mat(0x3a2a20), 0, 1.03, 0.02, door);
cyl(0.025, 0.025, 0.06, chrome, 0.35, 1.0, 0.07, door).rotation.x = Math.PI / 2;
const doorSign = sign(['AUTHORIZED', 'PERSONNEL', 'ONLY (ring 0)'], { w: 0.5, h: 0.3, fg: '#ff5c7a', font: 'bold 80px monospace' });
doorSign.position.set(0, 1.55, 0.05);
door.add(doorSign);
interact(door, 'Door: /dev/null', () => showInfo('Door', 'Leads to <code>/dev/null</code>. Nothing that goes in comes back out.'));

const lightSwitch = new THREE.Group();
lightSwitch.position.set(1.45, 1.25, 3.98);
lightSwitch.rotation.y = Math.PI;
scene.add(lightSwitch);
box(0.08, 0.12, 0.015, mat(0xdddddd), 0, 0, 0, lightSwitch);
const toggle = box(0.025, 0.045, 0.02, mat(0xffffff), 0, 0.015, 0.012, lightSwitch);
function toggleLights() {
  lightsOn = !lightsOn;
  ceilingLight.intensity = lightsOn ? 9 : 0;
  ceilingDisc.material.emissiveIntensity = lightsOn ? 1.6 : 0.05;
  hemi.intensity = lightsOn ? 0.55 : 0.12;
  ambient.intensity = lightsOn ? 0.35 : 0.08;
  toggle.position.y = lightsOn ? 0.015 : -0.015;
  return lightsOn;
}
interact(lightSwitch, '[E] Light switch', () => toggleLights());

// ------------------------------------------------------------------ quarantine chamber (antivirus)

const quarantine = new THREE.Group();
quarantine.position.set(4.1, 0, 2.6);
scene.add(quarantine);
cyl(0.32, 0.38, 0.9, mat(0x161827, { metalness: 0.6, roughness: 0.4 }), 0, 0.45, 0, quarantine, 32);
const ringMat = glow(0xff3355, 2.5);
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 8, 48), ringMat);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.88;
quarantine.add(ring);
const glassBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.6), new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0.1, depthWrite: false }));
glassBox.position.y = 1.21;
quarantine.add(glassBox);
const edges = new THREE.LineSegments(new THREE.EdgesGeometry(glassBox.geometry), new THREE.LineBasicMaterial({ color: 0x5ad1ff }));
edges.position.copy(glassBox.position);
quarantine.add(edges);
const virus = new THREE.Group();
virus.position.y = 1.21;
quarantine.add(virus);
const virusMat = new THREE.MeshStandardMaterial({ color: 0x330010, emissive: 0xff2050, emissiveIntensity: 1.2, roughness: 0.3, flatShading: true });
virus.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), virusMat));
const spikeGeo = new THREE.ConeGeometry(0.018, 0.08, 6);
const ico = new THREE.IcosahedronGeometry(0.1, 0).getAttribute('position');
const seen = new Set();
for (let i = 0; i < ico.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
  const key = v.toArray().map((n) => n.toFixed(2)).join();
  if (seen.has(key)) continue;
  seen.add(key);
  const s = new THREE.Mesh(spikeGeo, virusMat);
  s.position.copy(v.clone().multiplyScalar(0.12));
  s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  virus.add(s);
}
const qLight = new THREE.PointLight(0xff2050, 1.4, 2.5, 2);
qLight.position.set(4.1, 1.25, 2.6);
scene.add(qLight);
const qSign = sign(['QUARANTINE', 'threats in ~/downloads'], { w: 0.5, h: 0.16, fg: '#ff5c7a', font: 'bold 64px monospace' });
qSign.position.set(-0.3, 0.6, 0);
qSign.rotation.y = -Math.PI / 2;
quarantine.add(qSign);
collide(3.7, 4.5, 2.2, 3.0);
animated.push((t) => {
  virus.rotation.set(t * 0.7, t * 1.1, 0);
  const s = avState === 'infected' ? 1 + 0.08 * Math.sin(t * 5) : 0.55;
  virus.scale.setScalar(s);
});
function onScan(threats) {
  if (threats > 0 || avState === 'infected') {
    avState = 'clean';
    virusMat.emissive.set(0x33ff88);
    ringMat.emissive.set(0x33ff88);
    qLight.color.set(0x33ff88);
    const g = qSign.material.map.image.getContext('2d');
    const W = qSign.material.map.image.width, H = qSign.material.map.image.height;
    g.fillStyle = '#0b0f1e'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#39ff88'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#39ff88'; g.font = 'bold 64px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('QUARANTINE', W / 2, H * 0.36);
    g.fillText(`${threats} contained`, W / 2, H * 0.7);
    qSign.material.map.needsUpdate = true;
  }
  showInfo("Engine's Antivirus", threats
    ? `${threats} threat(s) moved to <code>/quarantine</code>. Byte signatures + Shannon-entropy heuristic. Details are in the terminal.`
    : 'System clean: no signatures matched and no high-entropy files.');
}
interact(quarantine, "[E] Engine's Antivirus: scan ~/", () => {
  terminal.submit('scan');
});

// ------------------------------------------------------------------ safe (EngineManager vault)

const safe = new THREE.Group();
safe.position.set(-4.3, 0, 3.4);
safe.rotation.y = Math.PI * 0.75;
scene.add(safe);
const steel = mat(0x4a5266, { metalness: 0.35, roughness: 0.45 });
box(0.62, 0.62, 0.62, steel, 0, 0.31, 0, safe);
box(0.5, 0.5, 0.02, glow(0xffc94a, 0.8), 0, 0.31, 0.3, safe); // glowing interior
const safeDoor = new THREE.Group();
safeDoor.position.set(-0.29, 0.31, 0.32);
safe.add(safeDoor);
box(0.58, 0.58, 0.04, steel, 0.29, 0, 0, safeDoor);
const dial = cyl(0.07, 0.07, 0.03, chrome, 0.29, 0, 0.035, safeDoor, 32);
dial.rotation.x = Math.PI / 2;
box(0.03, 0.12, 0.03, chrome, 0.5, 0, 0.035, safeDoor);
const safeSign = sign('ENGINEMANAGER', { w: 0.5, h: 0.07, fg: '#ffc94a' });
safeSign.position.set(0, 0.625, 0.1);
safeSign.rotation.x = -Math.PI / 2;
safe.add(safeSign);
collide(-4.75, -3.85, 2.95, 3.85);
const safeLight = new THREE.PointLight(0xffc94a, 1.2, 2.2, 2);
safeLight.position.set(-3.8, 1.0, 2.9);
scene.add(safeLight);
let safeOpen = 0, safeTarget = 0, safeTimer = 0;
animated.push((t, dt) => {
  safeOpen += (safeTarget - safeOpen) * Math.min(1, dt * 4);
  safeDoor.rotation.y = -safeOpen * 1.7;
  dial.rotation.y += safeTarget ? dt * 6 : 0;
  if (safeTarget && (safeTimer -= dt) <= 0) safeTarget = 0;
});
interact(safe, '[E] EngineManager vault: generate a password', () => {
  safeTarget = 1;
  safeTimer = 8;
  const pw = generatePassword(pool, 20);
  showInfo('EngineManager', `Generated from the optical entropy pool:<br><code class="big">${escapeHtml(pw)}</code><br>20 chars × log2(94) ≈ <b>131 bits</b>. Rejection sampling avoids modulo bias.`, 9000);
});

// ------------------------------------------------------------------ game-dev corner (bricks)

const brickTable = new THREE.Group();
brickTable.position.set(-4.5, 0, 1.6);
scene.add(brickTable);
const tableTop = 0.55;
box(0.7, 0.04, 1.1, wood, 0, tableTop - 0.02, 0, brickTable);
for (const [x, z] of [[-0.3, -0.5], [0.3, -0.5], [-0.3, 0.5], [0.3, 0.5]]) box(0.04, tableTop - 0.04, 0.04, metalDark, x, (tableTop - 0.04) / 2, z, brickTable);
const gameSign = sign(['GAME DEV', 'where it all started (Lua)'], { w: 0.9, h: 0.26, fg: '#ffb347', font: 'bold 56px monospace' });
gameSign.position.set(-0.47, 1.25, 0);
gameSign.rotation.y = Math.PI / 2;
brickTable.add(gameSign);
collide(-5, -4.1, 1.0, 2.2);

const BW = 0.16, BH = 0.06, BD = 0.08;
const brickGeo = (() => {
  const parts = [new THREE.BoxGeometry(BW, BH, BD)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const s = new THREE.CylinderGeometry(0.012, 0.012, 0.014, 12);
    s.translate(-BW / 2 + BW / 8 + i * (BW / 4), BH / 2 + 0.007, -BD / 2 + BD / 4 + j * (BD / 2));
    parts.push(s);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
})();
const BRICK_COLORS = [0xd01012, 0x0055bf, 0xf2cd37, 0x237841, 0xfe8a18, 0xffffff, 0x9b59b6];
const bricks = [];
function addBrick(x, y, z, vy = 0) {
  const m = new THREE.Mesh(brickGeo, mat(BRICK_COLORS[Math.floor(Math.random() * BRICK_COLORS.length)], { roughness: 0.35 }));
  m.position.set(x, y, z);
  m.rotation.y = Math.random() < 0.5 ? 0 : Math.PI / 2;
  m.castShadow = true;
  brickTable.add(m);
  const b = { mesh: m, vy, resting: vy === 0 };
  bricks.push(b);
  interact(m, '[E] Drop a brick', dropBrick);
  if (bricks.length > 45) { const old = bricks.shift(); brickTable.remove(old.mesh); }
  return b;
}
function supportHeight(b) {
  // highest top of a resting brick overlapping in XZ, else the table top
  let h = tableTop;
  const p = b.mesh.position;
  for (const o of bricks) {
    if (o === b || !o.resting) continue;
    const q = o.mesh.position;
    if (Math.abs(p.x - q.x) < BW * 0.8 && Math.abs(p.z - q.z) < BW * 0.8) h = Math.max(h, q.y + BH / 2);
  }
  return h;
}
function dropBrick() {
  const x = (Math.random() - 0.5) * 0.45, z = (Math.random() - 0.5) * 0.85;
  addBrick(x, 1.4, z, -0.1);
}
// a starting stack
for (let i = 0; i < 6; i++) addBrick(-0.05 + (i % 2) * 0.04, tableTop + BH / 2 + i * BH, -0.15 + (i % 3) * 0.02);
addBrick(0.12, tableTop + BH / 2, 0.3);
addBrick(-0.15, tableTop + BH / 2, 0.25);
animated.push((t, dt) => {
  for (const b of bricks) {
    if (b.resting) continue;
    b.vy -= 9.8 * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.rotation.x += dt * 2 * Math.sign(b.vy);
    const floorY = supportHeight(b) + BH / 2;
    if (b.mesh.position.y <= floorY) {
      b.mesh.position.y = floorY;
      if (Math.abs(b.vy) > 0.8) b.vy = -b.vy * 0.3;
      else { b.vy = 0; b.resting = true; b.mesh.rotation.x = 0; }
    }
  }
});
interact(brickTable, '[E] Drop a brick', dropBrick);

// ------------------------------------------------------------------ EngineBuddy robot

const buddy = new THREE.Group();
scene.add(buddy);
const white = mat(0xf0f2ff, { roughness: 0.3, metalness: 0.1 });
const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 24), white);
bodyMesh.scale.y = 0.9;
bodyMesh.castShadow = true;
buddy.add(bodyMesh);
const buddyHead = new THREE.Group();
buddyHead.position.y = 0.2;
buddy.add(buddyHead);
const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 32, 24), white);
headMesh.scale.set(1.25, 0.95, 1);
buddyHead.add(headMesh);
const visor = new THREE.Mesh(new THREE.SphereGeometry(0.092, 32, 16, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.42), mat(0x05060c, { roughness: 0.1, metalness: 0.5 }));
visor.scale.set(1.3, 1, 1.08);
visor.rotation.y = Math.PI / 2; // the segment is centred on -x; rotate it to face +z
buddyHead.add(visor);
const eyeMat = glow(0x2fd4ff, 3);
const eyes = [];
for (const x of [-0.035, 0.035]) {
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), eyeMat);
  e.position.set(x, 0.005, 0.098);
  e.scale.z = 0.4;
  buddyHead.add(e);
  eyes.push(e);
}
cyl(0.004, 0.004, 0.08, white, 0, 0.12, 0, buddyHead, 8);
const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), glow(0xb04dff, 3));
antennaTip.position.y = 0.165;
buddyHead.add(antennaTip);
const buddyGlow = new THREE.PointLight(0x2fd4ff, 0.6, 1.5, 2);
buddy.add(buddyGlow);
const buddyLook = new THREE.Vector3();
animated.push((t) => {
  const a = t * 0.25;
  buddy.position.set(2.1 + Math.cos(a) * 0.5, 1.35 + Math.sin(t * 1.6) * 0.06, -1.4 + Math.sin(a) * 0.4);
  buddyLook.copy(camera.position);
  buddy.lookAt(buddyLook.x, buddy.position.y, buddyLook.z);
  buddyHead.rotation.x = THREE.MathUtils.clamp(-Math.atan2(camera.position.y - buddy.position.y, buddy.position.distanceTo(camera.position)), -0.5, 0.5);
  const blink = (t % 4) < 0.12 ? 0.1 : 1;
  for (const e of eyes) e.scale.y = blink;
  antennaTip.material.emissiveIntensity = 2 + Math.sin(t * 4) * 1.5;
});
interact(buddy, '[E] Talk to EngineBuddy', () => {
  const greetings = ['hello', 'what is a gdt', 'a20', 'entropy', 'paging', 'boot', 'rust', 'virus', 'vulkan', 'packet', 'cpu', ''];
  showInfo('EngineBuddy', escapeHtml(buddyReply(greetings[Math.floor(Math.random() * greetings.length)])) + '<br><small>Ask anything in the terminal: <code>buddy &lt;question&gt;</code></small>', 9000);
});

// ------------------------------------------------------------------ HUD

const $ = (id) => document.getElementById(id);
const overlay = $('overlay'), tooltip = $('tooltip'), crosshair = $('crosshair'), info = $('info');
const focusHint = $('focus-hint'), stats = $('stats');
let infoTimer = 0;
function showInfo(title, html, ms = 7000) {
  info.innerHTML = `<h3>${title}</h3><div>${html}</div>`;
  info.classList.add('show');
  infoTimer = ms / 1000;
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ controls

const keysDown = new Set();
let started = false;
let locked = false;
let dragLook = false;
let dragging = false, dragMoved = 0, lastX = 0, lastY = 0;
let yaw = 0, pitch = -0.08;
let mode = 'walk'; // 'walk' | 'focus' | 'transition'
let hovered = null;
const savedPose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const tween = { t: 1, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromQ: new THREE.Quaternion(), toQ: new THREE.Quaternion(), done: null };

function lockPointer() {
  const el = renderer.domElement;
  if (!el.requestPointerLock) { dragLook = true; return; }
  try {
    const p = el.requestPointerLock();
    if (p && p.catch) p.catch(() => { dragLook = true; });
  } catch { dragLook = true; }
}

overlay.addEventListener('click', () => {
  started = true;
  overlay.classList.add('hidden');
  lockPointer();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && mode === 'walk' && started && !dragLook) {
    overlay.classList.remove('hidden');
    overlay.querySelector('.go').textContent = 'Click to resume';
  }
});
document.addEventListener('pointerlockerror', () => { dragLook = true; });

document.addEventListener('mousemove', (e) => {
  if (mode !== 'walk') return;
  if (locked) look(e.movementX, e.movementY);
  else if (dragLook && dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    dragMoved += Math.abs(dx) + Math.abs(dy);
    look(dx * 1.5, dy * 1.5);
    lastX = e.clientX; lastY = e.clientY;
  }
});
function look(dx, dy) {
  irq.mouse++;
  yaw -= dx * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - dy * 0.0022, -1.45, 1.45);
}
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (mode === 'focus') return;
  if (dragLook) { dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY; return; }
  if (!locked) { lockPointer(); return; }
  if (e.button === 0) use();
});
window.addEventListener('mouseup', () => {
  if (dragLook && dragging && dragMoved < 6 && mode === 'walk') use();
  dragging = false;
});

function use() {
  if (hovered) hovered.action();
}

window.addEventListener('keydown', (e) => {
  if (mode === 'focus') {
    if (e.key === 'Escape') { exitFocus(); e.preventDefault(); return; }
    terminal.handleKey(e);
    flashKey();
    if (['Tab', 'Backspace', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', "'", '/', 'PageUp', 'PageDown'].includes(e.key) || e.ctrlKey) e.preventDefault();
    return;
  }
  if (mode !== 'walk') return;
  irq.kbd++;
  keysDown.add(e.code);
  if (e.code === 'KeyE' && started) use();
  if (e.code === 'KeyH') $('help').classList.toggle('show');
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());
window.addEventListener('paste', async (e) => {
  if (mode !== 'focus') return;
  const text = e.clipboardData.getData('text');
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    terminal.input += lines[i];
    terminal.cursor = terminal.input.length;
    if (i < lines.length - 1) { const l = terminal.input; terminal.input = ''; terminal.cursor = 0; await terminal.submit(l); }
  }
  terminal.dirty = true;
});

function focusPose() {
  const center = new THREE.Vector3();
  screen.getWorldPosition(center);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(monitor.quaternion);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const dH = (0.39 / 2) / Math.tan(vFov / 2);
  const dW = (0.52 / 2) / (Math.tan(vFov / 2) * camera.aspect);
  const d = Math.max(dH, dW) * 1.12;
  const pos = center.clone().addScaledVector(normal, d);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, center, new THREE.Vector3(0, 1, 0)));
  return { pos, q };
}
function startTween(toPos, toQ, done) {
  tween.t = 0;
  tween.fromPos.copy(camera.position);
  tween.fromQ.copy(camera.quaternion);
  tween.toPos.copy(toPos);
  tween.toQ.copy(toQ);
  tween.done = done;
  mode = 'transition';
}
function enterFocus() {
  if (mode !== 'walk') return;
  savedPose.pos.copy(camera.position);
  savedPose.quat.copy(camera.quaternion);
  const { pos, q } = focusPose();
  keysDown.clear();
  if (locked) document.exitPointerLock();
  crosshair.classList.add('hidden');
  tooltip.classList.remove('show');
  startTween(pos, q, () => { mode = 'focus'; focusHint.classList.add('show'); });
}
function exitFocus() {
  if (mode !== 'focus') return;
  focusHint.classList.remove('show');
  startTween(savedPose.pos, savedPose.quat, () => {
    mode = 'walk';
    crosshair.classList.remove('hidden');
    camera.rotation.set(pitch, yaw, 0);
    if (!dragLook) {
      overlay.classList.remove('hidden');
      overlay.querySelector('.go').textContent = 'Click to look around again';
    }
  });
}
focusHint.addEventListener('click', () => exitFocus());

const raycaster = new THREE.Raycaster();
raycaster.far = 3.2;
const center2 = new THREE.Vector2(0, 0);
const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

function updateWalk(dt) {
  camera.rotation.set(pitch, yaw, 0);
  forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  move.set(0, 0, 0);
  if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) move.add(forward);
  if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) move.sub(forward);
  if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) move.add(right);
  if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) move.sub(right);
  if (move.lengthSq() > 0) {
    const speed = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 4.2 : 2.4;
    move.normalize().multiplyScalar(speed * dt);
    const p = camera.position;
    p.x += move.x; resolveCollisions(p, 'x');
    p.z += move.z; resolveCollisions(p, 'z');
    camera.position.y = 1.6 + Math.sin(performance.now() / 140) * 0.012; // head bob
  }
}
function resolveCollisions(p, axis) {
  const r = 0.28;
  p.x = THREE.MathUtils.clamp(p.x, ROOM.minX + r, ROOM.maxX - r);
  p.z = THREE.MathUtils.clamp(p.z, ROOM.minZ + r, ROOM.maxZ - r);
  for (const c of colliders) {
    if (p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r) {
      if (axis === 'x') p.x = p.x < (c.minX + c.maxX) / 2 ? c.minX - r : c.maxX + r;
      else p.z = p.z < (c.minZ + c.maxZ) / 2 ? c.minZ - r : c.maxZ + r;
    }
  }
}

function updateHover() {
  raycaster.setFromCamera(center2, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  let found = null;
  for (const h of hits) {
    if (h.object.isLine || h.object === glassBox) continue;
    found = h.object.userData.interact ?? null;
    break;
  }
  hovered = found;
  if (found && mode === 'walk') {
    tooltip.textContent = found.label;
    tooltip.classList.add('show');
    crosshair.classList.add('active');
  } else {
    tooltip.classList.remove('show');
    crosshair.classList.remove('active');
  }
}

// ------------------------------------------------------------------ main loop

const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, irqAcc = 0, lastCpuError = null, hoverTick = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  if (mode === 'walk') updateWalk(dt);
  else if (mode === 'transition') {
    tween.t = Math.min(1, tween.t + dt / 0.6);
    const k = tween.t * tween.t * (3 - 2 * tween.t);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
    camera.quaternion.slerpQuaternions(tween.fromQ, tween.toQ, k);
    if (tween.t >= 1) tween.done?.();
  }
  if (mode === 'walk' && ++hoverTick % 3 === 0) updateHover();

  // EG-8 CPU + virtual timer interrupt
  cpu.tick(dt * 1000, clockHz);
  if (cpu.error && cpu.error !== lastCpuError) { terminal.print('EG-8 fault: ' + cpu.error, '#ff5c7a'); lastCpuError = cpu.error; }
  if (!cpu.error) lastCpuError = null;
  irqAcc += dt * 100;
  irq.timer += Math.floor(irqAcc);
  irqAcc -= Math.floor(irqAcc);

  if (started && terminal.update(dt)) termTex.needsUpdate = true;

  crt.uniforms.time.value = t;
  lava.uniforms.time.value = t;
  gpu.uniforms.time.value = t;
  sky.uniforms.time.value = t;
  lavaLight.intensity = 1.3 + Math.sin(t * 0.8) * 0.3;
  for (const fn of animated) fn(t, dt);
  sampleEntropy();

  if (infoTimer > 0 && (infoTimer -= dt) <= 0) info.classList.remove('show');

  composer.render();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 0.5) {
    stats.textContent = `${Math.round(fpsFrames / fpsAcc)} FPS · EG-8 ${cpu.halted ? 'HALT' : 'RUN'} PC=0x${hex(cpu.pc)} · RNG pool ${pool.pool.length} B`;
    fpsAcc = 0; fpsFrames = 0;
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.resolution.set(window.innerWidth, window.innerHeight);
});

// debug / automation hook
window.engineRoom = { get hovered() { return hovered?.label; }, get mode() { return mode; }, scene, camera, cpu, pool, terminal, enterFocus, exitFocus, setPose: (x, z, y, p) => { camera.position.set(x, 1.6, z); yaw = y; pitch = p ?? 0; } };

frame();
