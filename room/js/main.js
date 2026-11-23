// The Engine Room (cartoon edition): scene, controls, interaction and all the room objects.
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CPU, hex } from './cpu.js';
import { EntropyPool } from './entropy.js';
import { Terminal, buddyReply, generatePassword } from './terminal.js';
import { randomFrame, decode, hexdump } from './net.js';
import { crtMaterial, lavaMaterial, gpuMaterial, skyMaterial, GPU_MODES } from './shaders.js';
import { buildExtras } from './props.js';
import { Sfx } from './audio.js';
import { Quests } from './quests.js';

// canvas signs and posters use the Fredoka web font: wait for it (but never longer than 2.5 s)
try {
  await Promise.race([document.fonts.load('bold 60px "Fredoka"'), new Promise((r) => setTimeout(r, 2500))]);
} catch { /* fall back to system fonts */ }

// ------------------------------------------------------------------ renderer / scene

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// black cartoon outlines around everything (inverted hull)
const outline = new OutlineEffect(renderer, { defaultThickness: 0.0035, defaultColor: [0.11, 0.07, 0.14], defaultAlpha: 1, defaultKeepAlive: true });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2340);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 50);
camera.position.set(0, 1.6, 2.6);
camera.rotation.order = 'YXZ';

const ROOM = { minX: -5, maxX: 5, minZ: -4, maxZ: 4, h: 3 };
const colliders = [];
const interactables = [];
const animated = [];
const maxAniso = renderer.capabilities.getMaxAnisotropy();

// ------------------------------------------------------------------ cartoon palette + materials

const C = {
  wall: 0x9cc9ec, wainscot: 0x5b84c4, trim: 0xfff4dc, ceiling: 0xfff1d6,
  wood: 0xd08a4c, woodDark: 0x9a5a2e, red: 0xef5a5a, yellow: 0xffcd3c, green: 0x55c26b,
  teal: 0x2fbfa8, blue: 0x4a7fe0, purple: 0x8a62e8, pink: 0xff8fb1, orange: 0xff9b3d,
  cream: 0xfff3dc, ink: 0x2b2340, grey: 0x6b7290, steel: 0x8b97b3,
};

const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const noOutline = { outlineParameters: { visible: false } };

function mat(color, opts = {}) {
  const { outline: ol = true, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap, ...rest });
  if (!ol) m.userData = { ...noOutline };
  return m;
}
function glow(color, intensity = 1) {
  return new THREE.MeshToonMaterial({ color, emissive: color, emissiveIntensity: intensity, gradientMap });
}
function basic(color, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...opts });
  m.userData = { ...noOutline };
  return m;
}

// rounded boxes give cartoon softness and continuous normals for clean outlines
function box(w, h, d, material, x = 0, y = 0, z = 0, parent = scene, r) {
  const radius = r ?? Math.min(0.035, Math.min(w, h, d) * 0.3);
  const geo = radius > 0.002 ? new RoundedBoxGeometry(w, h, d, 2, radius) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
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
function ball(r, material, x = 0, y = 0, z = 0, parent = scene, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.75)), material);
  m.position.set(x, y, z);
  m.castShadow = true;
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

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// cartoon sign: cream plate, thick ink border, chunky text
function drawSign(g, W, H, lines, { fg = '#2b2340', bg = '#fff3dc', accent = '#ef5a5a', font = 'bold 78px "Fredoka", "Trebuchet MS", sans-serif' } = {}) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#2b2340';
  roundRect(g, 4, 10, W - 8, H - 14, Math.min(40, H / 3)); g.fill();
  g.fillStyle = bg;
  roundRect(g, 10, 6, W - 20, H - 22, Math.min(36, H / 3)); g.fill();
  g.fillStyle = accent;
  g.fillRect(28, H - 34, W - 56, 6);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  const lh = (H - 30) / arr.length;
  // shrink the font until every line fits the plate
  let size = parseInt(font.match(/(\d+)px/)?.[1] ?? '60', 10);
  const fontAt = (px) => font.replace(/\d+px/, `${px}px`);
  g.font = fontAt(size);
  while (size > 16 && (Math.max(...arr.map((l) => g.measureText(l).width)) > W - 70 || size > lh * 0.85)) g.font = fontAt(--size);
  arr.forEach((l, i) => g.fillText(l, W / 2, 8 + lh * (i + 0.5)));
}
function sign(lines, { w = 0.6, h = 0.14, px = 1024, ...style } = {}) {
  const ph = Math.round(px * (h / w));
  const tex = canvasTexture(px, ph, (g, W, H) => drawSign(g, W, H, lines, style));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.material.userData = { ...noOutline };
  m.userData.redraw = (newLines, newStyle = style) => { drawSign(tex.image.getContext('2d'), tex.image.width, tex.image.height, newLines, newStyle); tex.needsUpdate = true; };
  return m;
}

// ------------------------------------------------------------------ sound + quests

const sfx = new Sfx();
let quests = null; // created once the HUD exists
function emit(ev) {
  if (!quests) return;
  if (ev === 'tux') quests.bump('tux', 3);
  else quests.unlock(ev);
}

// ------------------------------------------------------------------ systems

const cpu = new CPU();
const pool = new EntropyPool();
const irq = { timer: 0, kbd: 0, nic: 0, mouse: 0 };
let clockHz = 400;
let ledState = 0;
let avState = 'infected';
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
  setArm: (b, s, c) => extras?.setArm(b, s, c),
  onCracked: () => extras?.onCracked(),
  onBuild: (on) => extras?.setBuilding(on),
  solder: (cmd) => extras?.solder(cmd),
  emit: (ev) => emit(ev),
  sound: (name) => sfx[name]?.(),
  launchDrone: () => extras?.launchDrone(),
  quests: () => quests,
};
let extras = null; // built further down (props.js)
const terminal = new Terminal(sys);

cpu.ports.out = (port, v) => {
  if (port === 0x00) ledState = v;
  else if (port === 0x01) terminal.putc(v);
  else if (port === 0x02) terminal.print(String(v), '#ffb347');
  else if (port === 0x20) setLampHue(v);
  else if (port >= 0x30 && port <= 0x32) extras?.setArmPort(port, v);
};
cpu.ports.in = (port) => (port === 0x10 ? pool.byte() : 0);

// ------------------------------------------------------------------ lights

const hemi = new THREE.HemisphereLight(0xfff6e8, 0x8a7aa8, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
sun.position.set(-2.5, 4.2, 7);
sun.target.position.set(0.5, 0, -1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: 0.5, far: 20 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const ceilingLight = new THREE.PointLight(0xffe2b0, 4, 9, 1.2);
ceilingLight.position.set(0, 1.95, 0.2);
scene.add(ceilingLight);

// ------------------------------------------------------------------ room shell

const floorTex = canvasTexture(1024, 1024, (g, W, H) => {
  const rows = 8, plank = H / rows;
  const tones = ['#d99355', '#cf874a', '#e09c5e', '#c98245'];
  for (let i = 0; i < rows; i++) {
    let x = -Math.random() * 300;
    while (x < W) {
      const len = 260 + Math.random() * 260;
      g.fillStyle = tones[Math.floor(Math.random() * tones.length)];
      g.fillRect(x, i * plank, len, plank);
      g.fillStyle = '#7a4524';
      g.fillRect(x, i * plank, 5, plank);
      // a few cartoon wood-grain dashes
      g.strokeStyle = 'rgba(122,69,36,0.35)'; g.lineWidth = 4; g.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const gx = x + 30 + Math.random() * (len - 80), gy = i * plank + 20 + Math.random() * (plank - 40);
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + 40 + Math.random() * 50, gy); g.stroke();
      }
      x += len;
    }
    g.fillStyle = '#7a4524';
    g.fillRect(0, i * plank, W, 5);
  }
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(3, 2.5);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat(0xffffff, { map: floorTex, outline: false }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat(C.ceiling, { outline: false }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = ROOM.h;
scene.add(ceiling);

// walls with a two-tone wainscot, polka-dot wallpaper and white trim
const wallpaper = canvasTexture(512, 512, (g, W, H) => {
  g.fillStyle = '#9cc9ec'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#b3d7f2';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.beginPath(); g.arc(x * 64 + (y % 2) * 32 + 16, y * 64 + 32, 9, 0, Math.PI * 2); g.fill();
  }
});
wallpaper.wrapS = wallpaper.wrapT = THREE.RepeatWrapping;
function wall(w, x, z, ry) {
  const tex = wallpaper.clone();
  tex.repeat.set(w / 1.2, 3 / 1.2);
  tex.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM.h), mat(0xffffff, { map: tex, outline: false }));
  m.position.set(x, ROOM.h / 2, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  scene.add(m);
  const low = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.9), mat(C.wainscot, { outline: false }));
  low.position.set(x, 0.45, z);
  low.rotation.y = ry;
  low.translateZ(0.004);
  low.receiveShadow = true;
  scene.add(low);
}
wall(10, 0, -4, 0);
wall(10, 0, 4, Math.PI);
wall(8, -5, 0, Math.PI / 2);
wall(8, 5, 0, -Math.PI / 2);
const trim = mat(C.trim);
box(10, 0.06, 0.04, trim, 0, 0.92, -3.98); box(10, 0.06, 0.04, trim, 0, 0.92, 3.98);
box(0.04, 0.06, 8, trim, -4.98, 0.92, 0); box(0.04, 0.06, 8, trim, 4.98, 0.92, 0);
box(10, 0.12, 0.04, trim, 0, 0.06, -3.98); box(10, 0.12, 0.04, trim, 0, 0.06, 3.98);
box(0.04, 0.12, 8, trim, -4.98, 0.06, 0); box(0.04, 0.12, 8, trim, 4.98, 0.06, 0);
box(10, 0.08, 0.06, trim, 0, 2.96, -3.97); box(10, 0.08, 0.06, trim, 0, 2.96, 3.97);
box(0.06, 0.08, 8, trim, -4.97, 2.96, 0); box(0.06, 0.08, 8, trim, 4.97, 2.96, 0);

// pendant ceiling lamp
const pendant = new THREE.Group();
pendant.position.set(0, ROOM.h, 0.2);
scene.add(pendant);
cyl(0.008, 0.008, 0.5, mat(C.ink), 0, -0.25, 0, pendant, 8);
const pendantShade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.22, 32, 1, true), mat(C.yellow, { side: THREE.DoubleSide }));
pendantShade.position.y = -0.58;
pendant.add(pendantShade);
const pendantBulb = ball(0.07, glow(0xfff2c0, 1), 0, -0.66, 0, pendant);

// fairy lights along the north and east walls
const fairyColors = [C.red, C.yellow, C.green, C.blue, C.pink, C.orange];
const FAIRY = 60;
const fairy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 10, 8), basic(0xffffff), FAIRY);
const fairyBase = [];
const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
for (let i = 0; i < FAIRY; i++) {
  let x, z;
  const t = i / FAIRY;
  if (t < 0.6) { x = -4.8 + (t / 0.6) * 9.6; z = -3.93; } else { x = 4.93; z = -3.8 + ((t - 0.6) / 0.4) * 7.6; }
  const seg = t < 0.6 ? (x + 4.8) / 1.2 : (z + 3.8) / 1.2;
  const y = 2.82 - Math.sin((seg % 1) * Math.PI) * 0.16;
  tmpM.makeTranslation(x, y, z);
  fairy.setMatrixAt(i, tmpM);
  fairyBase.push(fairyColors[i % fairyColors.length]);
}
scene.add(fairy);
animated.push((t) => {
  for (let i = 0; i < FAIRY; i++) {
    const k = 0.65 + 0.35 * Math.sin(t * 2 + i * 1.3);
    fairy.setColorAt(i, tmpC.set(fairyBase[i]).multiplyScalar(lightsOn ? k * 0.9 : k * 1.2));
  }
  fairy.instanceColor.needsUpdate = true;
});

// round striped rug
const rugTex = canvasTexture(1024, 1024, (g, W, H) => {
  const rings = ['#ef5a5a', '#fff3dc', '#ffcd3c', '#fff3dc', '#4a7fe0', '#fff3dc', '#ef5a5a', '#ffcd3c'];
  rings.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath(); g.arc(W / 2, H / 2, W / 2 - i * (W / 2 / rings.length), 0, Math.PI * 2); g.fill();
  });
});
const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), mat(0xffffff, { map: rugTex, outline: false }));
rug.rotation.x = -Math.PI / 2;
rug.position.set(0, 0.006, 0.5);
rug.receiveShadow = true;
scene.add(rug);

// ------------------------------------------------------------------ desk area

const wood = mat(C.wood), woodDark = mat(C.woodDark), ink = mat(C.ink), cream = mat(C.cream);
const deskTopY = 0.76;
box(2.5, 0.07, 0.95, wood, 0, deskTopY - 0.035, -3.45, scene, 0.03);
box(0.5, 0.62, 0.85, woodDark, -0.95, 0.36, -3.45);                 // drawer block
for (const y of [0.2, 0.42, 0.62]) {
  box(0.44, 0.17, 0.02, wood, -0.95, y, -3.01);
  ball(0.022, mat(C.yellow), -0.95, y, -2.99);
}
for (const [x, z] of [[1.15, -3.85], [1.15, -3.05]]) box(0.07, deskTopY - 0.07, 0.07, woodDark, x, (deskTopY - 0.07) / 2, z);
collide(-1.3, 1.3, -4, -2.95);

// office chair
const chair = new THREE.Group();
chair.position.set(-0.1, 0, -2.42);
scene.add(chair);
const chairRed = mat(C.red);
cyl(0.035, 0.035, 0.4, mat(C.grey), 0, 0.24, 0, chair, 12);
box(0.56, 0.1, 0.52, chairRed, 0, 0.48, 0, chair, 0.05);
box(0.52, 0.6, 0.09, chairRed, 0, 0.86, 0.25, chair, 0.05);
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  const leg = box(0.32, 0.04, 0.05, mat(C.grey), Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15, chair, 0.015);
  leg.rotation.y = -a;
  ball(0.035, ink, Math.cos(a) * 0.3, 0.035, Math.sin(a) * 0.3, chair, 10);
}
collide(-0.42, 0.22, -2.72, -2.12);

// chunky retro CRT monitor
const termTex = new THREE.CanvasTexture(terminal.canvas);
termTex.colorSpace = THREE.SRGBColorSpace;
termTex.anisotropy = maxAniso;
const crt = crtMaterial(termTex);
crt.userData = { ...noOutline };
const monitor = new THREE.Group();
monitor.position.set(-0.1, deskTopY, -3.6);
scene.add(monitor);
const beige = mat(0xf2e3c2);
box(0.3, 0.04, 0.24, beige, 0, 0.02, 0, monitor);
box(0.1, 0.06, 0.1, beige, 0, 0.06, 0, monitor);
box(0.66, 0.54, 0.46, beige, 0, 0.35, 0.02, monitor, 0.06);
box(0.48, 0.4, 0.26, beige, 0, 0.35, -0.27, monitor, 0.06);
box(0.58, 0.44, 0.02, mat(0x3a3350), 0, 0.36, 0.245, monitor, 0.02); // bezel
const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.39), crt);
screen.position.set(0, 0.36, 0.257);
monitor.add(screen);
box(0.16, 0.04, 0.012, mat(0xe4d2ad), 0.18, 0.1, 0.255, monitor, 0.006);
ball(0.014, glow(0x55ff88, 1), 0.27, 0.1, 0.258, monitor, 10);     // power LED
const screenGlow = new THREE.PointLight(0x66ffaa, 0.5, 1.8, 2);
screenGlow.position.set(0, 0.36, 0.5);
monitor.add(screenGlow);
interact(monitor, '[E] Use the SecureRustOS terminal', () => enterFocus(termFocus));

// rubber debugging duck sitting on the CRT
const duck = new THREE.Group();
duck.position.set(0.2, 0.62, 0.08);
duck.rotation.y = -0.3;
monitor.add(duck);
const duckYellow = mat(0xffd43b);
const duckBody = ball(0.05, duckYellow, 0, 0.035, 0, duck, 18);
duckBody.scale.set(1.15, 0.8, 1.3);
ball(0.034, duckYellow, 0, 0.09, 0.03, duck, 16);
const duckBeak = ball(0.018, mat(C.orange), 0, 0.085, 0.064, duck, 10);
duckBeak.scale.set(1.3, 0.5, 1.2);
for (const side of [-1, 1]) ball(0.007, mat(C.ink), side * 0.016, 0.1, 0.057, duck, 8);
const duckTail = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 8), duckYellow);
duckTail.position.set(0, 0.06, -0.065);
duckTail.rotation.x = -0.9;
duck.add(duckTail);
const DUCK_TIPS = [
  'Have you tried printing the registers? (<code>regs</code>)',
  'Read the error message again. Slowly. Out loud. To me.',
  'Is the bug in the code, or in your assumptions?',
  'What changed since it last worked? (<code>history</code>)',
  'Step through it one instruction at a time: <code>step 5</code>.',
  'Off-by-one? Check your loop bounds.',
  'Did you enable the A20 line? It is always the A20 line.',
  'Explain it to me line by line... see? You found it yourself.',
];
let duckSquash = 0;
animated.push((t, dt) => {
  duckSquash = Math.max(0, duckSquash - dt * 3);
  const sq = Math.sin(duckSquash * Math.PI) * 0.25;
  duck.scale.set(1 + sq, 1 - sq, 1 + sq);
});
interact(duck, '[E] Rubber duck: explain your bug', () => {
  duckSquash = 1;
  sfx.quack();
  emit('duck');
  showInfo('Rubber duck', 'Quack! ' + DUCK_TIPS[Math.floor(Math.random() * DUCK_TIPS.length)]);
});

// keyboard with instanced keys that flash when you type
const keyboard = new THREE.Group();
keyboard.position.set(-0.1, deskTopY, -3.16);
scene.add(keyboard);
box(0.5, 0.03, 0.17, beige, 0, 0.015, 0, keyboard, 0.012);
const KEY_COLS = 14, KEY_ROWS = 4;
const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(0.028, 0.016, 0.028, 1, 0.005), mat(0xffffff, { outline: false }), KEY_COLS * KEY_ROWS);
const keyBase = [];
for (let r = 0; r < KEY_ROWS; r++) for (let c = 0; c < KEY_COLS; c++) {
  const i = r * KEY_COLS + c;
  tmpM.makeTranslation(-0.205 + c * 0.0315, 0.034, -0.05 + r * 0.034);
  keys.setMatrixAt(i, tmpM);
  keyBase.push(c === 0 || c === KEY_COLS - 1 ? 0xc9b48a : r === 3 && c > 3 && c < 10 ? 0xe9dcc0 : 0xfff6e2);
  keys.setColorAt(i, tmpC.set(keyBase[i]));
}
keyboard.add(keys);
const keyHeat = new Float32Array(KEY_COLS * KEY_ROWS);
const keyHot = new THREE.Color(C.green);
function flashKey() { keyHeat[Math.floor(Math.random() * keyHeat.length)] = 1; }
animated.push((t, dt) => {
  for (let i = 0; i < keyHeat.length; i++) {
    keyHeat[i] = Math.max(0, keyHeat[i] - dt * 3);
    keys.setColorAt(i, tmpC.set(keyBase[i]).lerp(keyHot, keyHeat[i]));
  }
  keys.instanceColor.needsUpdate = true;
});
interact(keyboard, '[E] Use the SecureRustOS terminal', () => enterFocus(termFocus));

// mouse + mouse pad
box(0.2, 0.006, 0.17, mat(C.purple), 0.3, deskTopY + 0.003, -3.12, scene, 0.003);
const mouseDev = ball(0.03, beige, 0.3, deskTopY + 0.015, -3.12, scene, 16);
mouseDev.scale.set(0.9, 0.55, 1.4);

// coffee mug with steam
const mug = new THREE.Group();
mug.position.set(0.5, deskTopY, -3.0);
scene.add(mug);
cyl(0.045, 0.04, 0.11, mat(C.red), 0, 0.055, 0, mug);
cyl(0.046, 0.046, 0.02, mat(0xffffff), 0, 0.07, 0, mug);
cyl(0.04, 0.04, 0.004, mat(0x5a3418, { outline: false }), 0, 0.108, 0, mug);
const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 8, 16), mat(C.red));
handle.position.set(0.05, 0.055, 0);
mug.add(handle);
const steamMat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, gradientMap });
steamMat.userData = { ...noOutline };
const steam = [0, 1, 2].map((i) => ball(0.018 + i * 0.004, steamMat, 0, 0.15 + i * 0.05, 0, mug, 10));
animated.push((t) => steam.forEach((s, i) => {
  const k = (t * 0.5 + i / 3) % 1;
  s.position.set(Math.sin(t * 2 + i) * 0.012, 0.12 + k * 0.16, 0);
  s.scale.setScalar(0.6 + k * 0.8);
}));
interact(mug, '0xC0FFEE', () => showInfo('Mug', 'Contents: <code>0xC0FFEE</code>. Required to fix triple faults at 3 AM.'));

// breadboard with 8 LEDs on port 0x00
const bread = new THREE.Group();
bread.position.set(0.72, deskTopY, -3.32);
scene.add(bread);
box(0.4, 0.03, 0.14, mat(0xffffff), 0, 0.015, 0, bread, 0.008);
box(0.38, 0.004, 0.012, mat(C.red, { outline: false }), 0, 0.031, 0.055, bread, 0.001);
box(0.38, 0.004, 0.012, mat(C.blue, { outline: false }), 0, 0.031, -0.055, bread, 0.001);
const ledMats = [];
const ledColors = [0xff4466, 0xff4466, 0xffb020, 0xffb020, 0x33dd66, 0x33dd66, 0x3399ff, 0x3399ff];
for (let i = 0; i < 8; i++) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(ledColors[i]).multiplyScalar(0.45), emissive: ledColors[i], emissiveIntensity: 0, gradientMap });
  ledMats.push(m);
  const x = 0.15 - i * 0.043; // bit 0 on the right
  cyl(0.013, 0.013, 0.02, m, x, 0.043, 0, bread, 12);
  ball(0.013, m, x, 0.053, 0, bread, 12);
  box(0.006, 0.004, 0.05, mat(fairyColors[i % 6], { outline: false }), x, 0.032, -0.03, bread, 0.001);
}
const ledLight = new THREE.PointLight(0xff6688, 0, 1.2, 2);
ledLight.position.set(0.72, deskTopY + 0.15, -3.25);
scene.add(ledLight);
animated.push(() => {
  let on = 0;
  for (let i = 0; i < 8; i++) {
    const bit = (ledState >> i) & 1;
    ledMats[i].emissiveIntensity += ((bit ? 1.1 : 0) - ledMats[i].emissiveIntensity) * 0.5;
    on += bit;
  }
  ledLight.intensity = on * 0.12;
});
interact(bread, 'Breadboard: 8 LEDs on EG-8 port 0x00', () =>
  showInfo('Breadboard LEDs', `Wired to EG-8 port <code>0x00</code>. Current value: <code>0x${hex(ledState)}</code> = <code>${ledState.toString(2).padStart(8, '0')}b</code>.<br>In the terminal: <code>leds 0b10101010</code> or <code>run blink.asm</code>.`));

// Arduino board: flashes and runs knight.asm
const arduino = new THREE.Group();
arduino.position.set(0.74, deskTopY, -3.66);
scene.add(arduino);
box(0.22, 0.016, 0.15, mat(0x1aa3a8), 0, 0.008, 0, arduino, 0.006);
box(0.08, 0.016, 0.026, ink, 0.02, 0.024, 0.01, arduino, 0.004);
box(0.045, 0.035, 0.04, mat(0xd8dde8), -0.1, 0.025, -0.04, arduino, 0.006);
box(0.17, 0.014, 0.012, ink, 0.01, 0.022, 0.065, arduino, 0.003);
ball(0.008, glow(0x55ff66, 1), 0.08, 0.02, -0.045, arduino, 8);
for (let i = 0; i < 8; i++) {
  const w = box(0.005, 0.005, 0.26, mat(fairyColors[i % 6], { outline: false }), -0.075 + i * 0.012, 0.03, 0.18, arduino, 0.001);
  w.rotation.x = -0.08;
}
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
pi.position.set(1.05, deskTopY, -3.22);
pi.rotation.y = -0.35;
pi.scale.setScalar(1.6);
scene.add(pi);
box(0.085, 0.012, 0.056, mat(0x2e9e4f), 0, 0.006, 0, pi, 0.004);
box(0.016, 0.004, 0.016, mat(0xb8bcc8), -0.01, 0.014, 0, pi, 0.002);
box(0.02, 0.018, 0.015, mat(0xd8dde8), 0.034, 0.02, 0.014, pi, 0.003);
box(0.02, 0.018, 0.015, mat(0xd8dde8), 0.034, 0.02, -0.012, pi, 0.003);
box(0.05, 0.007, 0.006, ink, -0.01, 0.015, -0.024, pi, 0.002);
ball(0.004, glow(0xff3333, 1), -0.038, 0.014, 0.022, pi, 8);
interact(pi, '[E] Raspberry Pi: stream entropy to the LEDs', () => {
  terminal.loadProgram('random.asm');
  cpu.halted = false;
  terminal.print('[pi] ssh engine@raspberrypi: running random.asm (IN A, 0x10 -> OUT 0x00, A)', '#5ad1ff');
  showInfo('Raspberry Pi', 'Running <code>random.asm</code>: it reads bytes from the optical entropy port <code>0x10</code> and writes them to the LEDs.');
});

// desk lamp (SpotLight, hue controllable from EG-8 port 0x20)
const lamp = new THREE.Group();
lamp.position.set(-1.0, deskTopY, -3.7);
scene.add(lamp);
cyl(0.09, 0.1, 0.035, mat(C.red), 0, 0.018, 0, lamp);
const arm1 = cyl(0.014, 0.014, 0.36, mat(C.red), 0, 0.2, 0.04, lamp, 10);
arm1.rotation.x = 0.25;
ball(0.025, mat(C.ink), 0, 0.37, 0.085, lamp, 12);
const arm2 = cyl(0.014, 0.014, 0.2, mat(C.red), 0, 0.42, 0.15, lamp, 10);
arm2.rotation.x = 1.1;
const head = new THREE.Group();
head.position.set(0, 0.45, 0.24);
lamp.add(head);
const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.13, 24, 1, true), mat(C.yellow, { side: THREE.DoubleSide }));
shade.rotation.x = Math.PI * 0.78;
head.add(shade);
const bulbMat = glow(0xfff3c4, 1);
ball(0.035, bulbMat, 0, -0.025, 0.025, head, 16);
const lampLight = new THREE.SpotLight(0xfff1d0, 5, 3, 0.8, 0.6, 1.4);
lampLight.position.set(-1.0, deskTopY + 0.44, -3.45);
lampLight.target.position.set(-0.3, deskTopY, -3.1);
lampLight.castShadow = true;
lampLight.shadow.mapSize.set(1024, 1024);
lampLight.shadow.bias = -0.0005;
scene.add(lampLight, lampLight.target);
let lampOn = true;
function setLampHue(v) {
  const c = new THREE.Color().setHSL((v & 0xff) / 255, 0.85, 0.65);
  lampLight.color.copy(c);
  bulbMat.color.copy(c);
  bulbMat.emissive.copy(c);
  lampOn = true;
  lampLight.intensity = 5;
  bulbMat.emissiveIntensity = 1;
}
interact(lamp, '[E] Desk lamp on/off  (EG-8 port 0x20 sets the hue)', () => {
  lampOn = !lampOn;
  lampLight.intensity = lampOn ? 5 : 0;
  bulbMat.emissiveIntensity = lampOn ? 1 : 0;
});

// trash can full of crumpled core dumps
const bin = new THREE.Group();
bin.position.set(1.6, 0, -3.55);
scene.add(bin);
cyl(0.17, 0.13, 0.4, mat(C.grey), 0, 0.2, 0, bin, 20);
cyl(0.18, 0.18, 0.03, mat(0x8a90aa), 0, 0.4, 0, bin, 20);
for (let i = 0; i < 4; i++) {
  const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), cream);
  p.position.set((Math.random() - 0.5) * 0.15, 0.42 + Math.random() * 0.04, (Math.random() - 0.5) * 0.15);
  p.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  p.castShadow = true;
  bin.add(p);
}
const paperOnFloor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), cream);
paperOnFloor.position.set(1.9, 0.05, -3.2);
scene.add(paperOnFloor);
collide(1.4, 1.8, -3.75, -3.35);
interact(bin, 'Trash: core_dump_*.txt', () => showInfo('Trash can', '12 crumpled printouts of <code>core_dump.txt</code>, 3 attempts at writing a memory allocator, and one that missed.'));

// ------------------------------------------------------------------ RAM board (EG-8 memory visualizer)

const ram = new THREE.Group();
ram.position.set(0, 2.2, -3.95);
scene.add(ram);
box(1.36, 1.36, 0.05, woodDark, 0, 0, 0, ram, 0.03);
box(1.22, 1.22, 0.02, mat(0x231d38), 0, 0, 0.025, ram, 0.008);
for (const [x, y] of [[-0.62, 0.62], [0.62, 0.62], [-0.62, -0.62], [0.62, -0.62]]) ball(0.022, mat(C.yellow), x, y, 0.035, ram, 10);
const CELL = 0.07;
const ramCells = new THREE.InstancedMesh(new RoundedBoxGeometry(CELL * 0.82, CELL * 0.82, 0.014, 1, 0.012), basic(0xffffff), 256);
for (let i = 0; i < 256; i++) {
  const x = (i & 15) - 7.5, y = 7.5 - (i >> 4);
  tmpM.makeTranslation(x * CELL, y * CELL, 0.042);
  ramCells.setMatrixAt(i, tmpM);
}
ram.add(ramCells);
const ramLabel = sign('EG-8 RAM  ·  green = PC  ·  red = SP', { w: 1.2, h: 0.12, font: 'bold 66px "Fredoka", sans-serif' });
ramLabel.position.set(0, -0.76, 0.03);
ram.add(ramLabel);
const cPC = new THREE.Color(0x44ee77), cSP = new THREE.Color(0xff4466), cLow = new THREE.Color(0x3a3260), cHigh = new THREE.Color(0x6fd3ff);
animated.push(() => {
  for (let i = 0; i < 256; i++) {
    const v = cpu.mem[i];
    if (i === cpu.pc) tmpC.copy(cPC);
    else if (i === cpu.sp) tmpC.copy(cSP);
    else tmpC.copy(cLow).lerp(cHigh, v / 255);
    ramCells.setColorAt(i, tmpC);
  }
  ramCells.instanceColor.needsUpdate = true;
});
interact(ram, 'EG-8 RAM board (256 bytes, live)', () =>
  showInfo('RAM board', `Each square is one byte of EG-8 memory; brighter = bigger value. <b style="color:#2aa856">Green</b> is the program counter (PC=0x${hex(cpu.pc)}), <b style="color:#e8435f">red</b> is the stack pointer (SP=0x${hex(cpu.sp)}). Try <code>run lamp.asm</code> to see the stack move.`));

// illustrated posters
function poster(x, y, z, ry, w, h, draw) {
  const tex = canvasTexture(600, Math.round(600 * h / w), draw);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  box(w + 0.06, h + 0.06, 0.03, ink, 0, 0, 0, g, 0.012);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  p.material.userData = { ...noOutline };
  p.position.z = 0.017;
  g.add(p);
  return g;
}
function crab(g, cx, cy, s) {
  g.save(); g.translate(cx, cy); g.scale(s, s);
  g.lineWidth = 8; g.strokeStyle = '#2b2340'; g.fillStyle = '#ef5a5a';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(side * 70, 20 + k * 18); g.lineTo(side * (120 + k * 10), 50 + k * 22); g.stroke(); }
    g.beginPath(); g.moveTo(side * 60, -20); g.lineTo(side * 110, -70); g.stroke();
    g.beginPath(); g.arc(side * 125, -90, 34, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fff3dc'; g.beginPath(); g.moveTo(side * 125, -90); g.arc(side * 125, -90, 34, -0.4 - (side > 0 ? 0 : Math.PI), 0.4 - (side > 0 ? 0 : Math.PI)); g.fill(); g.fillStyle = '#ef5a5a';
  }
  g.beginPath(); g.ellipse(0, 10, 95, 62, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  for (const side of [-1, 1]) {
    g.beginPath(); g.moveTo(side * 25, -45); g.lineTo(side * 30, -85); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(side * 30, -95, 20, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#2b2340'; g.beginPath(); g.arc(side * 33, -93, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ef5a5a';
  }
  g.beginPath(); g.arc(0, 15, 28, 0.2, Math.PI - 0.2); g.stroke();
  g.restore();
}
poster(-3.0, 1.85, -3.97, 0, 0.9, 1.2, (g, W, H) => {
  g.fillStyle = '#ffcd3c'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffe07a';
  for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(W / 2, H * 0.5); g.arc(W / 2, H * 0.5, W, (i / 12) * Math.PI * 2, ((i + 0.5) / 12) * Math.PI * 2); g.fill(); }
  crab(g, W / 2, H * 0.5, 1.5);
  g.fillStyle = '#2b2340'; g.textAlign = 'center';
  g.font = 'bold 74px "Fredoka", sans-serif'; g.fillText('FEARLESS', W / 2, 110);
  g.font = 'bold 56px "Fredoka", sans-serif'; g.fillText('kernel hacking', W / 2, 175);
  g.font = 'bold 40px monospace'; g.fillText('#![no_std]', W / 2, H - 60);
});
poster(2.9, 1.85, -3.97, 0, 0.9, 1.2, (g, W, H) => {
  g.fillStyle = '#4a7fe0'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * W, Math.random() * H * 0.75, 2 + Math.random() * 4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffcd3c'; g.beginPath(); g.arc(W * 0.78, H * 0.18, 40, 0, Math.PI * 2); g.fill();
  // rocket
  g.save(); g.translate(W / 2, H * 0.55); g.rotate(-0.3);
  g.lineWidth = 8; g.strokeStyle = '#2b2340';
  g.fillStyle = '#ff9b3d'; g.beginPath(); g.moveTo(-28, 150); g.quadraticCurveTo(0, 260, 28, 150); g.fill();
  g.fillStyle = '#ef5a5a';
  g.beginPath(); g.moveTo(-55, 90); g.lineTo(-95, 170); g.lineTo(-45, 150); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(55, 90); g.lineTo(95, 170); g.lineTo(45, 150); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff3dc'; g.beginPath(); g.moveTo(0, -170); g.quadraticCurveTo(80, -60, 55, 150); g.lineTo(-55, 150); g.quadraticCurveTo(-80, -60, 0, -170); g.fill(); g.stroke();
  g.fillStyle = '#ef5a5a'; g.beginPath(); g.moveTo(0, -170); g.quadraticCurveTo(45, -120, 52, -90); g.lineTo(-52, -90); g.quadraticCurveTo(-45, -120, 0, -170); g.fill(); g.stroke();
  g.fillStyle = '#6fd3ff'; g.beginPath(); g.arc(0, -20, 30, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = 'bold 64px "Fredoka", sans-serif'; g.fillText('0x7C00', W / 2, H - 120);
  g.font = 'bold 46px "Fredoka", sans-serif'; g.fillText('we have liftoff!', W / 2, H - 60);
});

// wall clock with the real time
const wallClock = new THREE.Group();
wallClock.position.set(-4.96, 2.15, -2.8);
wallClock.rotation.y = Math.PI / 2;
scene.add(wallClock);
const clockFace = cyl(0.26, 0.26, 0.05, mat(C.red), 0, 0, 0, wallClock, 40);
clockFace.rotation.x = Math.PI / 2;
const faceInner = cyl(0.22, 0.22, 0.02, mat(C.cream), 0, 0, 0.03, wallClock, 40);
faceInner.rotation.x = Math.PI / 2;
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  ball(i % 3 === 0 ? 0.018 : 0.01, ink, Math.sin(a) * 0.18, Math.cos(a) * 0.18, 0.045, wallClock, 8);
}
function hand(len, w, color) {
  const g = new THREE.Group();
  g.position.z = 0.05;
  wallClock.add(g);
  box(w, len, 0.01, mat(color), 0, len / 2 - 0.02, 0, g, 0.004);
  return g;
}
const hourHand = hand(0.12, 0.022, C.ink), minHand = hand(0.17, 0.016, C.ink), secHand = hand(0.19, 0.006, C.red);
ball(0.02, mat(C.yellow), 0, 0, 0.06, wallClock, 10);
animated.push(() => {
  const d = new Date();
  const s = d.getSeconds() + d.getMilliseconds() / 1000, m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
  secHand.rotation.z = -(s / 60) * Math.PI * 2;
  minHand.rotation.z = -(m / 60) * Math.PI * 2;
  hourHand.rotation.z = -(h / 12) * Math.PI * 2;
});
interact(wallClock, 'Clock (local time)', () => showInfo('Clock', `It is ${new Date().toLocaleTimeString()}. The PIT has fired IRQ0 ${irq.timer} times since you came in.`));

// ------------------------------------------------------------------ lava lamp (optical entropy)

const sideTable = new THREE.Group();
sideTable.position.set(-1.95, 0, -3.55);
scene.add(sideTable);
box(0.52, 0.05, 0.52, wood, 0, 0.6, 0, sideTable, 0.02);
cyl(0.04, 0.05, 0.58, woodDark, 0, 0.29, 0, sideTable, 12);
cyl(0.2, 0.22, 0.03, woodDark, 0, 0.015, 0, sideTable, 24);
const rngSign = sign('optical RNG', { w: 0.34, h: 0.09, accent: '#8a62e8' });
rngSign.position.set(0, 0.5, 0.27);
sideTable.add(rngSign);
collide(-2.25, -1.65, -3.85, -3.25);

const lava = lavaMaterial();
const lavaLamp = new THREE.Group();
lavaLamp.position.set(-1.95, 0.625, -3.55);
scene.add(lavaLamp);
const lampRed = mat(C.purple);
cyl(0.07, 0.12, 0.15, lampRed, 0, 0.075, 0, lavaLamp, 32);
const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.42, 32, 1, false), lava);
glass.position.y = 0.36;
lavaLamp.add(glass);
cyl(0.035, 0.06, 0.09, lampRed, 0, 0.615, 0, lavaLamp, 32);
const lavaLight = new THREE.PointLight(0xff66cc, 1.2, 2.2, 2);
lavaLight.position.set(-1.95, 1.05, -3.35);
scene.add(lavaLight);
interact(lavaLamp, '[E] Lava lamp: optical entropy source', () => {
  emit('entropy');
  const b = pool.bytes(16);
  const s = pool.stats;
  showInfo('Optical entropy', `Fresh bytes: <code>${Array.from(b).map((x) => hex(x)).join(' ')}</code><br>
    Sensor frames: ${s.samples} · raw LSBs: ${s.rawBits} · kept after von Neumann: ${s.keptBits} (${(100 * s.keptBits / Math.max(1, s.rawBits)).toFixed(1)}%) · pool: ${pool.pool.length} B<br>
    Pipeline: lamp pixels → frame XOR → LSB → von Neumann → ⊕ CSPRNG → SHA-256.`, 9000);
});

// off-screen "camera sensor" looking at the lava shader
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

// potted plants
function plant(x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  scene.add(g);
  cyl(0.2, 0.15, 0.36, mat(C.orange), 0, 0.18, 0, g, 20);
  cyl(0.215, 0.215, 0.06, mat(0xe8822a), 0, 0.36, 0, g, 20);
  cyl(0.19, 0.19, 0.02, mat(0x5a3418, { outline: false }), 0, 0.38, 0, g, 20);
  const leaf = mat(C.green), leafDark = mat(0x3fa556);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const l = ball(0.13, i % 2 ? leaf : leafDark, Math.cos(a) * 0.12, 0.62 + (i % 3) * 0.12, Math.sin(a) * 0.12, g, 14);
    l.scale.set(0.7, 1.4, 0.35);
    l.rotation.set(Math.sin(a) * 0.6, -a, Math.cos(a) * 0.6);
  }
  ball(0.12, leaf, 0, 0.95, 0, g, 14).scale.set(0.7, 1.2, 0.7);
  animated.push((t) => { g.rotation.z = Math.sin(t * 0.8 + x) * 0.015; });
  collide(x - 0.25 * s, x + 0.25 * s, z - 0.25 * s, z + 0.25 * s);
  return g;
}
interact(plant(-4.5, -3.5, 1.1), 'Plant (watered by cron)', () => showInfo('Plant', '<code>0 9 * * * water --amount 200ml</code>. The only process in the room that never crashes.'));
interact(plant(3.45, 3.5), 'Plant', () => showInfo('Plant', 'Photosynthesis: the original renewable energy driver.'));

// ------------------------------------------------------------------ server tower + packet capture

const rack = new THREE.Group();
rack.position.set(4.55, 0, -2.4);
scene.add(rack);
box(0.8, 1.9, 0.74, mat(0x3d4a72), 0, 0.97, 0, rack, 0.06);
for (const [x, z] of [[-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]]) ball(0.04, ink, x, 0.03, z, rack, 10);
const RACK_UNITS = 8, RACK_LEDS = 10;
const unitMat = mat(0x5466a0);
for (let u = 0; u < RACK_UNITS; u++) {
  box(0.03, 0.17, 0.64, unitMat, -0.41, 0.2 + u * 0.205, 0, rack, 0.012);
  for (const z of [-0.2, 0.2]) box(0.012, 0.018, 0.12, mat(0x2d3658, { outline: false }), -0.43, 0.15 + u * 0.205, z, rack, 0.004);
}
const rackLeds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.011, 8, 6), basic(0xffffff), RACK_UNITS * RACK_LEDS);
for (let u = 0; u < RACK_UNITS; u++) for (let l = 0; l < RACK_LEDS; l++) {
  tmpM.makeTranslation(-0.43, 0.2 + u * 0.205 + 0.045, -0.24 + l * 0.04);
  rackLeds.setMatrixAt(u * RACK_LEDS + l, tmpM);
  rackLeds.setColorAt(u * RACK_LEDS + l, tmpC.set(0x224422));
}
rack.add(rackLeds);
const rackSign = sign('packet capture', { w: 0.6, h: 0.13, accent: '#55c26b' });
rackSign.position.set(-0.42, 1.78, 0);
rackSign.rotation.y = -Math.PI / 2;
rack.add(rackSign);
collide(4.1, 5, -2.8, -2.0);
let captureOn = false, rackBlink = 0;
animated.push((t, dt) => {
  rackBlink += dt;
  if (rackBlink < (captureOn ? 0.05 : 0.14)) return;
  rackBlink = 0;
  for (let i = 0; i < RACK_UNITS * RACK_LEDS; i++) {
    if (Math.random() < (captureOn ? 0.35 : 0.12)) {
      const r = Math.random();
      rackLeds.setColorAt(i, tmpC.set(r < 0.7 ? 0x44ff77 : r < 0.92 ? 0xffc23c : 0x55ccff).multiplyScalar(Math.random() < 0.55 ? 1 : 0.25));
    }
  }
  rackLeds.instanceColor.needsUpdate = true;
});
interact(rack, '[E] Server: toggle live packet capture', () => toggleCapture());

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
  captureRows.push(`<div class="row p-${d.proto}"><span>${captureNo}</span><span>${t.toFixed(3)}</span><span>${d.src}</span><span>${d.dst}</span><span>${d.proto}</span><span>${d.info}${d.ok ? ' <i>✓ cksum</i>' : ' <b>bad cksum</b>'}</span></div>`);
  if (captureRows.length > 14) captureRows.shift();
  panelList.innerHTML = captureRows.join('');
  panelHex.textContent = hexdump(f, 80).join('\n');
});

// ------------------------------------------------------------------ GPU shader TV

const gpu = gpuMaterial();
gpu.userData = { ...noOutline };
const gpuScreen = new THREE.Group();
gpuScreen.position.set(4.94, 1.7, 0.7);
gpuScreen.rotation.y = -Math.PI / 2;
scene.add(gpuScreen);
box(1.95, 1.25, 0.08, mat(0x2d2a4a), 0, 0, 0, gpuScreen, 0.06);
const gpuPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), gpu);
gpuPlane.position.z = 0.042;
gpuScreen.add(gpuPlane);
const gpuSign = sign('GPU shaders: raymarch', { w: 0.8, h: 0.12, accent: '#8a62e8' });
gpuSign.position.set(0, -0.73, 0.03);
gpuScreen.add(gpuSign);
// TV cabinet below with a game console
const cabinet = box(0.45, 0.5, 1.5, wood, 4.75, 0.25, 0.7);
box(0.02, 0.2, 0.6, woodDark, 4.52, 0.25, 0.32, scene, 0.008);
box(0.02, 0.2, 0.6, woodDark, 4.52, 0.25, 1.08, scene, 0.008);
const consoleBox = box(0.3, 0.08, 0.4, mat(C.purple), 4.75, 0.54, 0.3, scene, 0.025);
ball(0.015, glow(0x55ff88, 1), 4.6, 0.55, 0.42, scene, 8);
const pad = box(0.1, 0.03, 0.18, mat(C.ink), 4.72, 0.515, 1.1, scene, 0.015);
pad.rotation.y = 0.4;
collide(4.5, 5, -0.1, 1.5);
function setGpuMode(m) {
  if (m && GPU_MODES.includes(m)) gpuMode = GPU_MODES.indexOf(m);
  else gpuMode = (gpuMode + 1) % GPU_MODES.length;
  gpu.uniforms.mode.value = gpuMode;
  gpuSign.userData.redraw(`GPU shaders: ${GPU_MODES[gpuMode]}`, { accent: '#8a62e8' });
  return GPU_MODES[gpuMode];
}
interact(gpuScreen, '[E] TV: switch GPU fragment shader', () => {
  const m = setGpuMode();
  showInfo('GPU shader', `Now running <code>${m}</code>, a pure fragment shader computed per pixel on the GPU. (OpenGL/Vulkan nod: no geometry, just math.)`);
});
interact(consoleBox, 'Game console', () => showInfo('Game console', 'Homebrew dev kit. Currently running a Lua engine from the early game-dev days.'));

// ------------------------------------------------------------------ bookshelf

const shelf = new THREE.Group();
shelf.position.set(-4.78, 0, -0.8);
scene.add(shelf);
box(0.4, 2.1, 0.05, woodDark, 0, 1.05, -0.76, shelf, 0.02);
box(0.4, 2.1, 0.05, woodDark, 0, 1.05, 0.76, shelf, 0.02);
box(0.03, 2.1, 1.5, wood, -0.18, 1.05, 0, shelf, 0.01);
for (const y of [0.05, 0.55, 1.05, 1.55, 2.08]) box(0.4, 0.04, 1.56, woodDark, 0, y, 0, shelf, 0.015);
collide(-5, -4.55, -1.6, 0);

const BOOKS = [
  ['Intel SDM Vol.3', '#3b6fd6', 'Intel® 64 and IA-32 Architectures Software Developer\'s Manual, Vol. 3: System Programming. The bible for GDT, IDT, paging and protected mode.'],
  ['OSTEP', '#ef5a5a', 'Operating Systems: Three Easy Pieces. Virtualization, concurrency, persistence. Free online and excellent.'],
  ['The Rust Book', '#ff9b3d', 'The Rust Programming Language. Ownership and borrowing: how SecureRustOS avoids use-after-free.'],
  ['K&R C', '#fff3dc', 'The C Programming Language by Kernighan & Ritchie. 272 pages, zero fluff.'],
  ['Practical Malware Analysis', '#2b2340', 'Sikorski & Honig. Static and dynamic analysis, unpacking. Pairs well with Ghidra.'],
  ['The Ghidra Book', '#d94040', 'The Ghidra Book. Reverse engineering with the NSA\'s open-source disassembler/decompiler.'],
  ['Art of Exploitation', '#5a4a8a', 'Hacking: The Art of Exploitation by Jon Erickson. Buffer overflows, shellcode and networking from the ground up.'],
  ['Computer Networking', '#2fa86a', 'Kurose & Ross. The top-down approach; read it next to Wireshark.'],
  ['Programming the Pi', '#e64a7a', 'Getting started with the Raspberry Pi: GPIO, Linux and Python.'],
  ['Arduino Cookbook', '#1aa3a8', 'Recipes for sensors, motors and LEDs. Exactly what the breadboard here is doing.'],
  ['Vulkan Guide', '#c0392b', 'Vulkan Programming Guide. ~1000 lines for a triangle, then infinite power.'],
  ['OpenGL SuperBible', '#7fb03a', 'Shaders, buffers and the pipeline. The TV across the room says hi.'],
  ['Deep Learning', '#8a62e8', 'Goodfellow, Bengio & Courville. The math behind EngineBuddy\'s future brain.'],
  ['Programming in Lua', '#2e4fa8', 'Programming in Lua by Roberto Ierusalimschy. Where the game-dev journey started.'],
  ['Write Great Code', '#e8b020', 'Randall Hyde. Understanding the machine so the compiler output makes sense.'],
  ['Crafting Interpreters', '#46607a', 'Robert Nystrom. Build a language twice: a tree-walker, then a bytecode VM (like EG-8!).'],
];
function spineTexture(title, color) {
  return canvasTexture(96, 640, (g, W, H) => {
    g.fillStyle = color; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 50, W, 10); g.fillRect(0, H - 60, W, 10);
    const n = parseInt(color.slice(1), 16);
    const lum = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
    g.fillStyle = lum > 150 ? '#2b2340' : '#fff8ea';
    g.save(); g.translate(W / 2, H / 2); g.rotate(Math.PI / 2);
    let size = 46;
    g.font = `bold ${size}px "Fredoka", sans-serif`;
    while (g.measureText(title).width > H - 140 && size > 20) { size -= 2; g.font = `bold ${size}px "Fredoka", sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, 0, 0);
    g.restore();
  });
}
const SHELF_YS = [0.57, 1.07, 1.57];
const perShelf = Math.ceil(BOOKS.length / SHELF_YS.length);
BOOKS.forEach(([title, color, note], i) => {
  const s = Math.floor(i / perShelf);
  const k = i % perShelf;
  const shelfY = SHELF_YS[s];
  const th = 0.075;
  const h = 0.32 + ((i * 37) % 10) / 100;
  const d = 0.26;
  const z = -0.62 + k * (th + 0.012) + (s === 1 ? 0.5 : 0);
  const spine = new THREE.MeshToonMaterial({ map: spineTexture(title, color), gradientMap });
  const cover = mat(color);
  const b = new THREE.Mesh(new RoundedBoxGeometry(d, h, th, 1, 0.008), [spine, cover, cover, cover, cover, cover]);
  b.position.set(0.19 - d / 2, shelfY + 0.02 + h / 2, z + th / 2);
  if (k === perShelf - 1 && s === 0) { b.rotation.x = -0.35; b.position.z += 0.07; b.position.y -= 0.02; }
  b.castShadow = true;
  shelf.add(b);
  interact(b, `Book: ${title}`, () => showInfo(title, note));
});
// shelf decorations
const trophy = new THREE.Group();
trophy.position.set(-4.75, 2.1, -0.3);
scene.add(trophy);
cyl(0.05, 0.06, 0.05, ink, 0, 0.025, 0, trophy);
cyl(0.015, 0.015, 0.06, mat(C.yellow), 0, 0.08, 0, trophy, 10);
cyl(0.08, 0.03, 0.12, mat(C.yellow), 0, 0.17, 0, trophy, 20);
interact(trophy, 'Trophy: "First triple fault survived"', () => showInfo('Trophy', 'Awarded for surviving the first triple fault. The CPU reset; the developer did not give up.'));
const floppy = new THREE.Group();
floppy.position.set(-4.72, 2.12, -1.15);
floppy.rotation.z = Math.PI / 2 - 0.2;
scene.add(floppy);
box(0.09, 0.09, 0.006, mat(C.blue), 0, 0, 0, floppy, 0.003);
box(0.05, 0.03, 0.008, mat(0xd8dde8), 0, 0.03, 0, floppy, 0.002);
box(0.06, 0.035, 0.008, mat(0xffffff), 0, -0.02, 0, floppy, 0.002);
interact(floppy, 'SECURERUST.IMG (1.44 MB)', () => showInfo('Floppy disk', 'Contains <code>SECURERUST.IMG</code>. Sector 0 ends with <code>55 AA</code>. See <code>cat ~/projects/SecureRustOS/boot.asm</code>.'));
const piggy = ball(0.07, mat(C.pink), -4.72, 1.15, -0.24, scene, 16);
piggy.scale.set(1, 0.85, 1.25);
interact(piggy, 'Piggy bank', () => showInfo('Piggy bank', 'Savings for a real logic analyzer. Currently 37 coins and a USB stick.'));

// ------------------------------------------------------------------ window, door, light switch

const win = new THREE.Group();
win.position.set(-1.8, 1.7, 3.97);
win.rotation.y = Math.PI;
scene.add(win);
const sky = skyMaterial();
sky.userData = { ...noOutline };
const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.15), sky);
win.add(skyPlane);
const frameMat = mat(0xffffff);
box(1.98, 0.08, 0.08, frameMat, 0, 0.61, 0.03, win, 0.03); box(1.98, 0.08, 0.08, frameMat, 0, -0.61, 0.03, win, 0.03);
box(0.08, 1.3, 0.08, frameMat, -0.95, 0, 0.03, win, 0.03); box(0.08, 1.3, 0.08, frameMat, 0.95, 0, 0.03, win, 0.03);
box(0.04, 1.15, 0.05, frameMat, 0, 0, 0.03, win, 0.015); box(1.8, 0.04, 0.05, frameMat, 0, 0, 0.03, win, 0.015);
box(2.1, 0.05, 0.2, frameMat, 0, -0.66, 0.1, win, 0.02);
const curtainMat = mat(C.red);
for (const side of [-1, 1]) {
  const c = box(0.32, 1.45, 0.06, curtainMat, side * 1.12, -0.02, 0.1, win, 0.03);
  c.scale.x = 1;
  ball(0.035, mat(C.yellow), side * 1.12, 0.75, 0.1, win, 10);
}
box(2.6, 0.04, 0.04, mat(C.woodDark), 0, 0.76, 0.1, win, 0.015);
const cactus = new THREE.Group();
cactus.position.set(-1.4, 1.07, 3.86);
scene.add(cactus);
cyl(0.06, 0.05, 0.08, mat(C.orange), 0, 0.04, 0, cactus, 16);
const cBody = ball(0.045, mat(C.green), 0, 0.14, 0, cactus, 14);
cBody.scale.y = 1.8;
interact(win, 'Window', () => showInfo('Window', lightsOn ? 'A sunny day outside. Perfect weather for staying in and writing a bootloader.' : 'Night falls. The best time for kernel debugging.'));
interact(cactus, 'Cactus', () => showInfo('Cactus', 'Low-maintenance, like a well-written interrupt handler.'));

const door = new THREE.Group();
door.position.set(2.3, 0, 3.96);
door.rotation.y = Math.PI;
scene.add(door);
box(1.08, 2.22, 0.06, mat(0xffffff), 0, 1.11, 0, door, 0.02);
box(0.94, 2.1, 0.06, mat(C.teal), 0, 1.06, 0.025, door, 0.03);
for (const y of [0.55, 1.5]) box(0.7, 0.6, 0.02, mat(0x27a893), 0, y, 0.06, door, 0.02);
ball(0.04, mat(C.yellow), 0.36, 1.0, 0.09, door, 12);
const doorSign = sign(['KEEP OUT', 'ring 0 only'], { w: 0.46, h: 0.24, accent: '#ef5a5a', font: 'bold 82px "Fredoka", sans-serif' });
doorSign.position.set(0, 1.62, 0.075);
door.add(doorSign);
interact(door, 'Door to /dev/null', () => showInfo('Door', 'Leads to <code>/dev/null</code>. Nothing that goes in comes back out.'));

const lightSwitch = new THREE.Group();
lightSwitch.position.set(1.45, 1.25, 3.97);
lightSwitch.rotation.y = Math.PI;
scene.add(lightSwitch);
box(0.1, 0.15, 0.02, mat(0xffffff), 0, 0, 0, lightSwitch, 0.01);
const toggle = box(0.035, 0.06, 0.025, mat(C.yellow), 0, 0.02, 0.015, lightSwitch, 0.008);
function toggleLights() {
  lightsOn = !lightsOn;
  sfx.switchClick();
  if (!lightsOn) emit('night');
  ceilingLight.intensity = lightsOn ? 4 : 0;
  pendantBulb.material.emissiveIntensity = lightsOn ? 1 : 0.1;
  sun.intensity = lightsOn ? 2.2 : 0.25;
  sun.color.set(lightsOn ? 0xfff0d0 : 0x8090ff);
  hemi.intensity = lightsOn ? 1.25 : 0.35;
  hemi.color.set(lightsOn ? 0xfff6e8 : 0x8a8ad0);
  sky.uniforms.night.value = lightsOn ? 0 : 1;
  toggle.position.y = lightsOn ? 0.02 : -0.02;
  return lightsOn;
}
interact(lightSwitch, '[E] Light switch (day / night)', () => toggleLights());

// ------------------------------------------------------------------ virus jar (Engine's Antivirus)

const quarantine = new THREE.Group();
quarantine.position.set(4.1, 0, 2.6);
scene.add(quarantine);
box(0.75, 0.75, 0.75, mat(C.cream), 0, 0.375, 0, quarantine, 0.05);
box(0.62, 0.05, 0.02, mat(C.red), 0, 0.6, -0.38, quarantine, 0.01);
const jarGlass = new THREE.MeshToonMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, gradientMap, depthWrite: false });
const jar = cyl(0.25, 0.25, 0.55, jarGlass, 0, 1.03, 0, quarantine, 40);
jar.castShadow = false;
const lid = cyl(0.27, 0.27, 0.08, mat(C.red), 0, 1.34, 0, quarantine, 40);
cyl(0.05, 0.05, 0.05, mat(C.red), 0, 1.4, 0, quarantine, 16);
const virus = new THREE.Group();
virus.position.y = 1.02;
quarantine.add(virus);
const virusMat = mat(0x9be15d);
const virusBody = ball(0.12, virusMat, 0, 0, 0, virus, 24);
const spikeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8);
const knobs = [];
for (let i = 0; i < 14; i++) {
  const y = 1 - (i / 13) * 2, r = Math.sqrt(1 - y * y), a = i * 2.4;
  const v = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  if (v.z > 0.55 && Math.abs(v.y) < 0.5) continue; // keep the face clear
  const s = new THREE.Mesh(spikeGeo, virusMat);
  s.position.copy(v.clone().multiplyScalar(0.14));
  s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  virus.add(s);
  knobs.push(ball(0.025, virusMat, v.x * 0.175, v.y * 0.175, v.z * 0.175, virus, 10));
}
const eyeW = mat(0xffffff), pupilM = mat(C.ink);
const vEyes = [-1, 1].map((side) => {
  const e = new THREE.Group();
  e.position.set(side * 0.045, 0.03, 0.1);
  virus.add(e);
  ball(0.035, eyeW, 0, 0, 0, e, 16);
  const p = ball(0.017, pupilM, 0, 0, 0.026, e, 10);
  const brow = box(0.06, 0.014, 0.014, pupilM, 0, 0.045, 0.015, e, 0.006);
  brow.rotation.z = side * -0.5;
  return { e, p, brow };
});
const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 16, Math.PI), pupilM);
mouth.position.set(0, -0.045, 0.112);
virus.add(mouth);
const qLight = new THREE.PointLight(0x99ff66, 0.8, 2, 2);
qLight.position.set(4.1, 1.1, 2.3);
scene.add(qLight);
const qSign = sign(["Engine's Antivirus", 'threats: ? (click to scan)'], { w: 0.62, h: 0.2, accent: '#ef5a5a', font: 'bold 80px "Fredoka", sans-serif' });
qSign.position.set(-0.38, 0.42, 0);
qSign.rotation.y = -Math.PI / 2;
quarantine.add(qSign);
collide(3.7, 4.5, 2.2, 3.0);
animated.push((t) => {
  const angry = avState === 'infected';
  virus.position.y = 1.02 + (angry ? Math.abs(Math.sin(t * 4)) * 0.08 : Math.sin(t) * 0.01);
  virus.rotation.y = -Math.PI / 2 + (angry ? Math.sin(t * 3) * 0.6 : Math.sin(t * 0.5) * 0.15); // face the room (-x)
  virus.rotation.z = angry ? Math.sin(t * 7) * 0.1 : 0.3;
  for (const { p } of vEyes) p.position.x = angry ? Math.sin(t * 2.5) * 0.008 : 0;
});
function onScan(threats) {
  emit('scan');
  sfx.success();
  avState = 'clean';
  virusMat.color.set(0x8fd0ff);
  qLight.color.set(0x66ccff);
  for (const { e, brow } of vEyes) { e.scale.y = 0.18; brow.visible = false; } // sleepy, closed eyes
  mouth.rotation.z = Math.PI; // the angry frown turns into a sleepy smile
  qSign.userData.redraw(["Engine's Antivirus", `${threats} threat(s) jarred`], { accent: '#55c26b', font: 'bold 80px "Fredoka", sans-serif' });
  showInfo("Engine's Antivirus", threats
    ? `${threats} threat(s) moved to <code>/quarantine</code> using byte signatures + a Shannon-entropy check. The virus is sulking in its jar. Details are in the terminal.`
    : 'System clean: no signatures matched and no high-entropy files.');
}
interact(quarantine, "[E] Engine's Antivirus: scan ~/", () => { terminal.submit('scan'); });

// ------------------------------------------------------------------ safe (EngineManager vault)

const safe = new THREE.Group();
safe.position.set(-4.3, 0, 3.4);
safe.rotation.y = Math.PI * 0.75;
scene.add(safe);
const safeGreen = mat(0x4b7a6e);
box(0.66, 0.66, 0.66, safeGreen, 0, 0.39, 0, safe, 0.06);
for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) cyl(0.04, 0.05, 0.06, ink, x, 0.03, z, safe, 10);
const gold = mat(C.yellow);
box(0.52, 0.52, 0.03, glow(0xffd76a, 0.6), 0, 0.39, 0.31, safe, 0.02); // shiny inside
for (let i = 0; i < 3; i++) box(0.12, 0.05, 0.06, gold, -0.1 + i * 0.1, 0.18 + (i % 2) * 0.05, 0.22, safe, 0.015);
const safeDoor = new THREE.Group();
safeDoor.position.set(-0.3, 0.39, 0.34);
safe.add(safeDoor);
box(0.6, 0.6, 0.05, mat(0x5c9183), 0.3, 0, 0, safeDoor, 0.04);
const dial = cyl(0.085, 0.085, 0.04, gold, 0.3, 0, 0.04, safeDoor, 32);
dial.rotation.x = Math.PI / 2;
for (let i = 0; i < 3; i++) {
  const spoke = box(0.18, 0.018, 0.018, gold, 0.3, 0, 0.075, safeDoor, 0.008);
  spoke.rotation.z = (i / 3) * Math.PI;
  spoke.userData.spoke = true;
}
box(0.03, 0.2, 0.03, gold, 0.53, 0, 0.04, safeDoor, 0.012);
const safeSign = sign('EngineManager', { w: 0.5, h: 0.11, accent: '#ffcd3c' });
safeSign.position.set(0, 0.725, 0.05);
safeSign.rotation.x = -Math.PI / 2;
safe.add(safeSign);
collide(-4.75, -3.85, 2.95, 3.85);
let safeOpen = 0, safeTarget = 0, safeTimer = 0;
animated.push((t, dt) => {
  safeOpen += (safeTarget - safeOpen) * Math.min(1, dt * 4);
  safeDoor.rotation.y = -safeOpen * 1.7;
  if (safeTarget) dial.rotation.y += dt * 6;
  if (safeTarget && (safeTimer -= dt) <= 0) safeTarget = 0;
});
interact(safe, '[E] EngineManager vault: generate a password', () => {
  emit('vault');
  sfx.coin();
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
box(0.75, 0.06, 1.15, mat(C.yellow), 0, tableTop - 0.03, 0, brickTable, 0.03);
for (const [x, z] of [[-0.3, -0.5], [0.3, -0.5], [-0.3, 0.5], [0.3, 0.5]]) cyl(0.035, 0.03, tableTop - 0.06, mat(C.red), x, (tableTop - 0.06) / 2, z, brickTable, 12);
const gameSign = sign(['GAME DEV', 'where it all started (Lua)'], { w: 0.95, h: 0.3, accent: '#ff9b3d', font: 'bold 84px "Fredoka", sans-serif' });
gameSign.position.set(-0.46, 1.3, 0);
gameSign.rotation.y = Math.PI / 2;
brickTable.add(gameSign);
collide(-5, -4.1, 1.0, 2.2);

const BW = 0.16, BH = 0.065, BD = 0.08;
const brickGeo = (() => {
  const parts = [new RoundedBoxGeometry(BW, BH, BD, 2, 0.008)];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    const s = new THREE.CylinderGeometry(0.013, 0.013, 0.016, 12);
    s.translate(-BW / 2 + BW / 8 + i * (BW / 4), BH / 2 + 0.008, -BD / 2 + BD / 4 + j * (BD / 2));
    parts.push(s);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
})();
const BRICK_COLORS = [0xef3b3b, 0x2f6fe0, 0xffcd3c, 0x2fae5a, 0xff8a1f, 0xffffff, 0x8a62e8];
const bricks = [];
function addBrick(x, y, z, vy = 0) {
  const m = new THREE.Mesh(brickGeo, mat(BRICK_COLORS[Math.floor(Math.random() * BRICK_COLORS.length)]));
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
  addBrick((Math.random() - 0.5) * 0.45, 1.4, (Math.random() - 0.5) * 0.85, -0.1);
}
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

// ------------------------------------------------------------------ bean bag + sleeping cat

const beanBag = ball(0.5, mat(C.purple), 1.9, 0.28, 1.6, scene, 28);
beanBag.scale.set(1, 0.55, 1);
collide(1.45, 2.35, 1.15, 2.05);
const cat = new THREE.Group();
cat.position.set(1.88, 0.66, 1.58);
cat.rotation.y = -0.6;
cat.scale.setScalar(1.25);
scene.add(cat);
const fur = mat(C.orange), furLight = mat(0xffd2a0);
const catBody = ball(0.16, fur, 0, 0, 0, cat, 20);
catBody.scale.set(1.3, 0.7, 0.9);
const catLids = [], catEyes = [];
const catHead = new THREE.Group();
catHead.position.set(0.19, 0.02, 0.06);
cat.add(catHead);
ball(0.1, fur, 0, 0, 0, catHead, 20);
ball(0.05, furLight, 0.06, -0.03, 0.04, catHead, 12).scale.set(1, 0.7, 1);
for (const side of [-1, 1]) {
  const ear = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 4), fur);
  ear.position.set(-0.01, 0.09, side * 0.055);
  ear.rotation.x = side * -0.3;
  ear.castShadow = true;
  catHead.add(ear);
  const lid = box(0.006, 0.006, 0.035, mat(C.ink), 0.095, 0.02, side * 0.035, catHead, 0.002); // closed eyes
  lid.rotation.y = side * 0.4;
  catLids.push(lid);
  const eye = ball(0.02, mat(0x9be15d), 0.088, 0.022, side * 0.036, catHead, 12); // open eyes (hidden while asleep)
  ball(0.009, mat(C.ink), 0.016, 0, 0, eye, 8).scale.set(0.6, 1.4, 1);
  eye.visible = false;
  catEyes.push(eye);
}
ball(0.012, mat(C.pink), 0.1, -0.005, 0, catHead, 8);
const tail = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 10, 24, Math.PI * 1.1), fur);
tail.rotation.x = Math.PI / 2;
tail.position.set(-0.05, -0.06, 0);
tail.castShadow = true;
cat.add(tail);
const zzz = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({
  alphaTest: 0.5,
  map: canvasTexture(256, 128, (g, W, H) => {
    g.font = 'bold 64px "Fredoka", sans-serif'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    [['z', 30, 92, 40], ['z', 100, 64, 56], ['Z', 175, 36, 72]].forEach(([ch, x, y, px]) => {
      g.font = `bold ${px}px "Fredoka", sans-serif`;
      g.lineWidth = 10; g.strokeStyle = '#2b2340'; g.strokeText(ch, x, y);
      g.fillStyle = '#ffffff'; g.fillText(ch, x, y);
    });
  }),
}));
zzz.material.userData = { ...noOutline };
scene.add(zzz);
const heartTex = canvasTexture(128, 128, (g) => {
  g.fillStyle = '#ff5c8a'; g.strokeStyle = '#2b2340'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(64, 110); g.bezierCurveTo(-10, 60, 20, -5, 64, 35); g.bezierCurveTo(108, -5, 138, 60, 64, 110); g.closePath();
  g.fill(); g.stroke();
});
const hearts = [];
let catAwake = 0;
animated.push((t, dt) => {
  const awake = catAwake > 0;
  catAwake = Math.max(0, catAwake - dt);
  catBody.scale.y = 0.7 + Math.sin(t * (awake ? 6 : 1.8)) * 0.03;
  catHead.position.y += ((awake ? 0.08 : 0.02 + Math.sin(t * 1.8) * 0.006) - catHead.position.y) * Math.min(1, dt * 6);
  catHead.rotation.z += ((awake ? 0.35 + Math.sin(t * 3) * 0.1 : 0) - catHead.rotation.z) * Math.min(1, dt * 6);
  tail.rotation.z = Math.sin(t * (awake ? 6 : 1.2)) * (awake ? 0.4 : 0.15);
  catLids.forEach((l) => { l.visible = !awake; });
  catEyes.forEach((e) => { e.visible = awake; });
  zzz.visible = !awake;
  zzz.position.set(2.0, 1.0 + ((t * 0.15) % 0.25), 1.45);
  zzz.lookAt(camera.position);
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i];
    h.m.position.y += dt * 0.35;
    h.m.position.x += Math.sin(t * 4 + h.ph) * dt * 0.1;
    h.m.lookAt(camera.position);
    h.m.scale.setScalar(Math.min(1, h.life));
    if ((h.life -= dt) <= 0) { scene.remove(h.m); hearts.splice(i, 1); }
  }
});
interact(cat, '[E] Pet the cat', () => {
  const wasAwake = catAwake > 0;
  catAwake = 4.5;
  emit('cat');
  if (!wasAwake) sfx.meow();
  sfx.purr(2.5);
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({ map: heartTex, alphaTest: 0.5 }));
    m.material.userData = { ...noOutline };
    m.userData.noHit = true;
    m.position.set(1.95 + (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.15, 1.55 + (Math.random() - 0.5) * 0.3);
    scene.add(m);
    hearts.push({ m, life: 1.6 + Math.random() * 0.8, ph: Math.random() * 6 });
  }
  showInfo('cat', wasAwake ? 'Purrrrrrr. (IRQ acknowledged.)' : '<code>cat: woke up from interrupt</code><br>Mrrp! Purrrr. The cat accepts your pets, then goes straight back to sleep.');
});
interact(beanBag, 'Bean bag', () => showInfo('Bean bag', 'Prime thinking spot. Occupied by the cat, as usual.'));

// ------------------------------------------------------------------ EngineBuddy robot

const buddy = new THREE.Group();
scene.add(buddy);
const white = mat(0xffffff);
const bodyMesh = ball(0.14, white, 0, 0, 0, buddy, 28);
bodyMesh.scale.y = 0.95;
box(0.1, 0.05, 0.02, mat(C.blue), 0, 0.0, 0.135, buddy, 0.01);
const buddyHead = new THREE.Group();
buddyHead.position.y = 0.22;
buddy.add(buddyHead);
const headMesh = ball(0.12, white, 0, 0, 0, buddyHead, 28);
headMesh.scale.set(1.25, 0.95, 1);
const visor = box(0.22, 0.12, 0.05, mat(0x2b2340), 0, 0, 0.095, buddyHead, 0.045);
const eyeMat = glow(0x6fe3ff, 1);
const eyes = [-0.045, 0.045].map((x) => {
  const e = ball(0.022, eyeMat, x, 0.005, 0.122, buddyHead, 14);
  e.material.userData = { ...noOutline };
  return e;
});
const smile = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12, Math.PI), eyeMat);
smile.position.set(0, -0.03, 0.122);
smile.rotation.z = Math.PI;
buddyHead.add(smile);
cyl(0.005, 0.005, 0.08, mat(C.grey), 0, 0.14, 0, buddyHead, 8);
const antennaTip = ball(0.02, glow(C.red, 1), 0, 0.19, 0, buddyHead, 12);
const arms = [-1, 1].map((side) => ball(0.045, white, side * 0.18, -0.02, 0, buddy, 14));
const buddyGlow = new THREE.PointLight(0x6fe3ff, 0.4, 1.4, 2);
buddy.add(buddyGlow);
animated.push((t) => {
  const a = t * 0.25;
  buddy.position.set(2.1 + Math.cos(a) * 0.5, 1.4 + Math.sin(t * 1.6) * 0.06, -1.4 + Math.sin(a) * 0.4);
  buddy.lookAt(camera.position.x, buddy.position.y, camera.position.z);
  buddyHead.rotation.x = THREE.MathUtils.clamp(-Math.atan2(camera.position.y - buddy.position.y, buddy.position.distanceTo(camera.position)), -0.5, 0.5);
  const blink = (t % 4) < 0.12 ? 0.15 : 1;
  for (const e of eyes) e.scale.y = blink;
  arms.forEach((m, i) => { m.position.y = -0.02 + Math.sin(t * 3 + i * Math.PI) * 0.025; });
  antennaTip.material.emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.4;
});
interact(buddy, '[E] Talk to EngineBuddy', () => {
  const topics = ['hint', 'hint', 'hello', 'what is a gdt', 'a20', 'entropy', 'paging', 'boot', 'rust', 'virus', 'vulkan', 'packet', 'cpu', ''];
  showInfo('EngineBuddy', escapeHtml(buddyReply(topics[Math.floor(Math.random() * topics.length)], quests?.next())) + '<br><small>Ask anything in the terminal: <code>buddy &lt;question&gt;</code></small>', 9000);
});

// ------------------------------------------------------------------ extra interest-themed objects

extras = buildExtras({
  scene, camera, C, mat, glow, basic, box, cyl, ball, sign, canvasTexture, interact, collide, animated,
  showInfo: (...a) => showInfo(...a), enterFocus: (t) => enterFocus(t), toggleCapture: () => toggleCapture(),
  terminal, cpu, deskTopY, noOutline, gradientMap, getLeds: () => ledState,
  sfx, emit,
});

// ------------------------------------------------------------------ HUD

const $ = (id) => document.getElementById(id);
const overlay = $('overlay'), tooltip = $('tooltip'), crosshair = $('crosshair'), info = $('info');
const focusHint = $('focus-hint'), stats = $('stats');
quests = new Quests({
  list: $('quest-list'), chip: $('quest-chip'), toast: $('toast'),
  onUnlock: () => sfx.success(),
  onAllDone: () => {
    sfx.fanfare();
    const p = camera.position.clone().add(new THREE.Vector3(0, 0.3, 0).add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)));
    extras?.burst(p);
    showInfo('ROOT ACCESS GRANTED', 'You finished every quest in the Engine Room. Thanks for visiting! <code>uid=0(root)</code>', 12000);
    terminal.print('*** all quests complete: uid=0(root) gid=0(root) groups=0(root) ***', '#c792ea');
  },
});
$('quest-chip').addEventListener('click', () => $('quest-list').classList.toggle('show'));
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
const touchMode = window.matchMedia?.('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
const touchMove = { x: 0, y: 0 };
const touchInput = document.getElementById('touch-input');
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
  // sandboxed frames may ignore the request silently: fall back to drag-to-look
  setTimeout(() => {
    if (!locked && !dragLook) {
      dragLook = true;
      $('hint').textContent = 'Drag to look · H = help';
    }
  }, 700);
}

overlay.addEventListener('click', () => {
  sfx.init();
  if (touchMode) { started = true; overlay.classList.add('hidden'); $('touch-ui').classList.add('show'); return; }
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
  if (!started || mode === 'focus') return;
  if (dragLook) { dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY; return; }
  if (!locked) { lockPointer(); return; }
  if (e.button === 0) use();
});
window.addEventListener('mouseup', () => {
  if (dragLook && dragging && dragMoved < 6 && mode === 'walk') use();
  dragging = false;
});

function use() {
  if (!hovered) return;
  sfx.use();
  hovered.action();
}

window.addEventListener('keydown', (e) => {
  if (mode === 'focus') {
    if (e.key === 'Escape') { exitFocus(); e.preventDefault(); return; }
    focus?.keydown?.(e);
    if (['Tab', 'Backspace', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', "'", '/', 'PageUp', 'PageDown'].includes(e.key) || e.ctrlKey) e.preventDefault();
    return;
  }
  if (mode !== 'walk') return;
  irq.kbd++;
  keysDown.add(e.code);
  if (e.code === 'KeyM') { const m = sfx.toggleMute(); showInfo('Sound', m ? 'Sound off. Press <kbd>M</kbd> to turn it back on.' : 'Sound on.', 2000); }
  if (e.code === 'KeyQ') $('quest-list').classList.toggle('show');
  if (e.code === 'KeyE' && started) use();
  if (e.code === 'KeyH') $('help').classList.toggle('show');
});
window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
  if (mode === 'focus') focus?.keyup?.(e);
});
window.addEventListener('blur', () => keysDown.clear());
window.addEventListener('paste', async (e) => {
  if (mode !== 'focus' || focus !== termFocus) return;
  const text = e.clipboardData.getData('text');
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    terminal.input += lines[i];
    terminal.cursor = terminal.input.length;
    if (i < lines.length - 1) { const l = terminal.input; terminal.input = ''; terminal.cursor = 0; await terminal.submit(l); }
  }
  terminal.dirty = true;
});

// Sit-down "focus" targets: the CRT terminal, the arcade and the RE laptop.
const termFocus = {
  screen, w: 0.52, h: 0.39,
  hint: 'Typing into SecureRustOS · press <b>Esc</b> (or click here) to stand up',
  keydown: (e) => { terminal.handleKey(e); flashKey(); sfx.key(); },
  onEnter: () => emit('terminal'),
};
let focus = null;

function focusPose(target) {
  const center = new THREE.Vector3();
  target.screen.getWorldPosition(center);
  const wq = new THREE.Quaternion();
  target.screen.getWorldQuaternion(wq);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const dH = (target.h / 2) / Math.tan(vFov / 2);
  const dW = (target.w / 2) / (Math.tan(vFov / 2) * camera.aspect);
  const d = Math.max(dH, dW) * (target.fit ?? 1.12);
  const pos = center.clone().addScaledVector(normal, d);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, center, up));
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
function enterFocus(target = termFocus) {
  if (mode !== 'walk') return;
  focus = target;
  savedPose.pos.copy(camera.position);
  savedPose.quat.copy(camera.quaternion);
  const { pos, q } = focusPose(target);
  keysDown.clear();
  if (locked) document.exitPointerLock();
  crosshair.classList.add('hidden');
  tooltip.classList.remove('show');
  focusHint.innerHTML = target.hint;
  target.onEnter?.();
  if (touchMode && target.keydown) { touchInput.value = ''; touchInput.focus({ preventScroll: true }); }
  startTween(pos, q, () => { mode = 'focus'; focusHint.classList.add('show'); });
}
function exitFocus() {
  if (mode !== 'focus') return;
  focusHint.classList.remove('show');
  focus?.onExit?.();
  focus = null;
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

// ------------------------------------------------------------------ touch controls (phones / tablets)
// left side: virtual joystick to walk · right side: drag to look · tap: use what you tapped
const joyBase = $('joy-base'), joyKnob = $('joy-knob');
let joy = null, lookTouch = null;
function pickAt(x, y) {
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  for (const h of raycaster.intersectObjects(scene.children, true)) {
    if (h.object === jar || h.object === zzz || h.object.userData.noHit) continue;
    return h.object.userData.interact ?? null;
  }
  return null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !started) return;
  e.preventDefault();
  if (mode === 'focus') {
    if (focus?.keydown) {
      const k = e.clientX < innerWidth / 2 ? 'ArrowLeft' : 'ArrowRight';
      focus.keydown({ key: 'Enter', preventDefault() {} });
      focus.keydown({ key: k, preventDefault() {} });
      lookTouch = { id: e.pointerId, key: k };
    }
    return;
  }
  if (e.clientX < innerWidth * 0.4 && !joy) {
    joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    joyBase.style.left = `${e.clientX}px`; joyBase.style.top = `${e.clientY}px`;
    joyKnob.style.transform = 'translate(-50%, -50%)';
    joyBase.classList.add('show');
  } else if (!lookTouch) {
    lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t0: performance.now() };
  }
}, { passive: false });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') return;
  if (joy && e.pointerId === joy.id) {
    let dx = e.clientX - joy.x0, dy = e.clientY - joy.y0;
    const len = Math.hypot(dx, dy), max = 55;
    if (len > max) { dx *= max / len; dy *= max / len; }
    touchMove.x = dx / max; touchMove.y = dy / max;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  } else if (lookTouch && e.pointerId === lookTouch.id && mode === 'walk') {
    const dx = e.clientX - lookTouch.x, dy = e.clientY - lookTouch.y;
    lookTouch.moved += Math.abs(dx) + Math.abs(dy);
    look(dx * 2.2, dy * 2.2);
    lookTouch.x = e.clientX; lookTouch.y = e.clientY;
  }
});
function endTouch(e) {
  if (e.pointerType !== 'touch') return;
  if (joy && e.pointerId === joy.id) { joy = null; touchMove.x = touchMove.y = 0; joyBase.classList.remove('show'); }
  if (lookTouch && e.pointerId === lookTouch.id) {
    if (mode === 'focus' && lookTouch.key) focus?.keyup?.({ key: lookTouch.key });
    else if (mode === 'walk' && lookTouch.moved < 12 && performance.now() - lookTouch.t0 < 350) {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) { hovered = hit; use(); }
    }
    lookTouch = null;
  }
}
renderer.domElement.addEventListener('pointerup', endTouch);
renderer.domElement.addEventListener('pointercancel', endTouch);
// on-screen keyboard for the terminal: forward typed text as key presses
touchInput.addEventListener('input', () => {
  for (const ch of touchInput.value) focus?.keydown?.({ key: ch, preventDefault() {} });
  touchInput.value = '';
});
touchInput.addEventListener('keydown', (e) => {
  if (['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) { focus?.keydown?.(e); e.preventDefault(); }
});
$('touch-use').addEventListener('click', () => { updateHover(); use(); });

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
  if (touchMove.x || touchMove.y) move.addScaledVector(forward, -touchMove.y).addScaledVector(right, touchMove.x);
  if (move.lengthSq() > 0) {
    const speed = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight') ? 4.2 : 2.4;
    move.normalize().multiplyScalar(speed * dt);
    const p = camera.position;
    p.x += move.x; resolveCollisions(p, 'x');
    p.z += move.z; resolveCollisions(p, 'z');
    camera.position.y = 1.6 + Math.sin(performance.now() / 140) * 0.012;
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
    if (h.object === jar || h.object === zzz || h.object.userData.noHit) continue;
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
let cpuWasHalted = true;
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

  if (!cpu.halted && cpuWasHalted) emit('cpu');
  cpuWasHalted = cpu.halted;
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
  lavaLight.intensity = 1.0 + Math.sin(t * 0.8) * 0.3;
  for (const fn of animated) fn(t, dt);
  sampleEntropy();

  if (infoTimer > 0 && (infoTimer -= dt) <= 0) info.classList.remove('show');

  outline.render(scene, camera);

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
});

// debug / automation hook
window.engineRoom = { get extras() { return extras; }, get hovered() { return hovered?.label; }, get mode() { return mode; }, scene, camera, cpu, pool, terminal, enterFocus, exitFocus, toggleLights, setPose: (x, z, y, p) => { camera.position.set(x, 1.6, z); yaw = y; pitch = p ?? 0; } };

frame();
