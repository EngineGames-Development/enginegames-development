// More interest-themed objects: 8x24 LED matrix (embedded), AI lab easel with a live-training
// neural net (AI), 3D printer (maker) and the CTF scoreboard (cybersecurity).
import * as THREE from 'three';
import { FLAGS } from './terminal.js';

// classic 5x7 font, column-major, bit 0 = top row
const FONT = {
  ' ': [0, 0, 0, 0, 0], '!': [0, 0, 0x5f, 0, 0], '-': [8, 8, 8, 8, 8], '.': [0, 0x60, 0x60, 0, 0], ':': [0, 0x36, 0x36, 0, 0],
  '?': [2, 1, 0x51, 9, 6], '_': [0x40, 0x40, 0x40, 0x40, 0x40], '/': [0x20, 0x10, 8, 4, 2], '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '(': [0, 0x1c, 0x22, 0x41, 0], ')': [0, 0x41, 0x22, 0x1c, 0], '=': [0x14, 0x14, 0x14, 0x14, 0x14], '+': [8, 8, 0x3e, 8, 8],
  '*': [0x2a, 0x1c, 0x7f, 0x1c, 0x2a], '<': [8, 0x14, 0x22, 0x41, 0], '>': [0, 0x41, 0x22, 0x14, 8], "'": [0, 0, 7, 0, 0], ',': [0, 0x50, 0x30, 0, 0],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e], '1': [0, 0x42, 0x7f, 0x40, 0], '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39], '6': [0x3c, 0x4a, 0x49, 0x49, 0x30], '7': [1, 0x71, 9, 5, 3],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [6, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x41, 0x22], D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 9, 9, 9, 1], G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 8, 8, 8, 0x7f],
  I: [0, 0x41, 0x7f, 0x41, 0], J: [0x20, 0x40, 0x41, 0x3f, 1], K: [0x7f, 8, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 2, 0x0c, 2, 0x7f], N: [0x7f, 4, 8, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x41, 0x3e], P: [0x7f, 9, 9, 9, 6],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 9, 0x19, 0x29, 0x46], S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [1, 1, 0x7f, 1, 1],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f], V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 8, 0x14, 0x63],
  Y: [7, 8, 0x70, 8, 7], Z: [0x61, 0x51, 0x49, 0x45, 0x43], '♥': [0x0c, 0x1e, 0x3c, 0x1e, 0x0c],
};

// ------------------------------------------------------------------ tiny neural network (2-4-1, tanh + sigmoid)
const XOR = [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
class TinyNet {
  constructor() { this.reset(); }
  reset() {
    const r = () => Math.random() * 2 - 1;
    this.H = 4;
    this.w1 = Array.from({ length: 2 }, () => Array.from({ length: this.H }, r));
    this.b1 = Array.from({ length: this.H }, () => r() * 0.5);
    this.w2 = Array.from({ length: this.H }, r);
    this.b2 = 0;
    this.epoch = 0;
    this.losses = [];
    this.loss = 1;
  }
  forward(x0, x1) {
    const h = this.b1.map((b, j) => Math.tanh(x0 * this.w1[0][j] + x1 * this.w1[1][j] + b));
    const z = h.reduce((s, hj, j) => s + hj * this.w2[j], this.b2);
    return { h, o: 1 / (1 + Math.exp(-z)) };
  }
  step(lr = 0.9) {
    const H = this.H;
    const gw1 = [new Array(H).fill(0), new Array(H).fill(0)], gb1 = new Array(H).fill(0), gw2 = new Array(H).fill(0);
    let gb2 = 0, loss = 0;
    for (const [x0, x1, y] of XOR) {
      const { h, o } = this.forward(x0, x1);
      loss += 0.5 * (o - y) ** 2;
      const dz = (o - y) * o * (1 - o);
      gb2 += dz;
      for (let j = 0; j < H; j++) {
        gw2[j] += dz * h[j];
        const dh = dz * this.w2[j] * (1 - h[j] * h[j]);
        gw1[0][j] += dh * x0; gw1[1][j] += dh * x1; gb1[j] += dh;
      }
    }
    const n = XOR.length;
    for (let j = 0; j < H; j++) {
      this.w2[j] -= (lr * gw2[j]) / n;
      this.w1[0][j] -= (lr * gw1[0][j]) / n;
      this.w1[1][j] -= (lr * gw1[1][j]) / n;
      this.b1[j] -= (lr * gb1[j]) / n;
    }
    this.b2 -= (lr * gb2) / n;
    this.loss = loss / n;
    this.epoch++;
    if (this.epoch % 20 === 0) this.losses.push(this.loss);
  }
}

export function buildMore(k) {
  const { scene, C, mat, basic, box, cyl, ball, sign, interact, collide, animated, showInfo, terminal, noOutline, camera, sfx, emit, renderer } = k;
  const api = {};
  const ink = mat(C.ink);

  // ================================================================ 8x24 LED matrix
  const COLS = 24, ROWS = 8, PITCH = 0.024;
  const ledPanel = new THREE.Group();
  ledPanel.position.set(3.8, 1.62, -3.955);
  scene.add(ledPanel);
  box(0.66, 0.27, 0.035, ink, 0, 0, 0, ledPanel, 0.015);
  const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0095, 8, 6), basic(0xffffff), COLS * ROWS);
  const tm = new THREE.Matrix4(), tc = new THREE.Color();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    tm.makeTranslation((c - (COLS - 1) / 2) * PITCH, ((ROWS - 1) / 2 - r) * PITCH + 0.006, 0.02);
    leds.setMatrixAt(c * ROWS + r, tm);
  }
  ledPanel.add(leds);
  const ledSign = sign('LED matrix · ports 0x50 / 0x51', { w: 0.5, h: 0.07, accent: '#ef5a5a' });
  ledSign.position.set(0, -0.18, 0.02);
  ledPanel.add(ledSign);
  const MESSAGES = ['ENGINE ROOM  *  ', 'HACK THE PLANET  *  ', 'SECURERUSTOS  *  ', 'RING 0  *  0X7C00  *  ', 'I ♥ LOW LEVEL  *  '];
  let msgIdx = 0;
  const fb = new Uint8Array(COLS);
  const mx = { mode: 'text', cols: [], scroll: 0 };
  function setText(text) {
    const t = text.toUpperCase();
    mx.cols = [];
    for (const ch of t) { mx.cols.push(...(FONT[ch] ?? FONT['?']), 0); }
    while (mx.cols.length < COLS) mx.cols.push(0);
    mx.mode = 'text';
    mx.scroll = 0;
  }
  setText(MESSAGES[0]);
  api.matrixText = (text) => { setText(text + '  *  '); emit('matrix'); };
  api.matrixPort = (port, v) => {
    if (port === 0x50) mx.sel = v % COLS;
    else if (port === 0x51) { if (mx.mode !== 'fb') { fb.fill(0); mx.mode = 'fb'; emit('matrix'); } fb[mx.sel ?? 0] = v; }
  };
  const ledOn = new THREE.Color(0xff3b4e), ledOff = new THREE.Color(0x3a1420);
  animated.push((t, dt) => {
    mx.scroll += dt * 14;
    for (let c = 0; c < COLS; c++) {
      const bits = mx.mode === 'fb' ? fb[c] : mx.cols[(Math.floor(mx.scroll) + c) % mx.cols.length];
      for (let r = 0; r < ROWS; r++) leds.setColorAt(c * ROWS + r, (bits >> r) & 1 ? ledOn : ledOff);
    }
    leds.instanceColor.needsUpdate = true;
  });
  interact(ledPanel, '[E] LED matrix: next message', () => {
    msgIdx = (msgIdx + 1) % MESSAGES.length;
    setText(MESSAGES[msgIdx]);
    sfx.click();
    showInfo('LED matrix', 'An 8×24 matrix with a 5×7 bitmap font. Show your own text: <code>matrix hello world</code>. Or let EG-8 draw: <code>run matrix.asm</code> (port <code>0x50</code> picks a column, <code>0x51</code> writes its 8 pixels).');
  });

  // ================================================================ AI lab easel: neural net learning XOR
  const easel = new THREE.Group();
  easel.position.set(-3.55, 0, 0.6);
  easel.rotation.y = Math.PI / 2;
  scene.add(easel);
  const woodL = mat(C.woodDark);
  for (const x of [-0.42, 0.42]) {
    const leg = cyl(0.02, 0.022, 1.9, woodL, x, 0.93, 0.05, easel, 8);
    leg.rotation.z = x > 0 ? -0.08 : 0.08;
  }
  const back = cyl(0.02, 0.022, 1.8, woodL, 0, 0.88, -0.35, easel, 8);
  back.rotation.x = -0.22;
  box(1.0, 0.05, 0.12, woodL, 0, 0.98, 0.1, easel, 0.015);
  const board = new THREE.Group();
  board.position.set(0, 1.42, 0.09);
  board.rotation.x = -0.08;
  easel.add(board);
  box(1.08, 0.82, 0.04, mat(0xffffff), 0, 0, 0, board, 0.02);
  const nnCanvas = document.createElement('canvas');
  nnCanvas.width = 1024; nnCanvas.height = 768;
  const nnTex = new THREE.CanvasTexture(nnCanvas);
  nnTex.colorSpace = THREE.SRGBColorSpace;
  nnTex.anisotropy = 8;
  const nnPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.75), new THREE.MeshBasicMaterial({ map: nnTex }));
  nnPlane.material.userData = { ...noOutline };
  nnPlane.position.z = 0.021;
  board.add(nnPlane);
  collide(-3.85, -3.2, 0.1, 1.1);
  const net = new TinyNet();
  const nn = { training: false, done: false, sample: 0, sampleT: 0 };
  function drawNN() {
    const g = nnCanvas.getContext('2d');
    const W = nnCanvas.width, H = nnCanvas.height;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8a62e8'; g.font = 'bold 48px "Fredoka", "Comic Sans MS", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText('AI lab: a tiny neural net learns XOR', 30, 64);
    // network graph
    const [x0, x1] = XOR[nn.sample];
    const { h, o } = net.forward(x0, x1);
    const inPos = [[90, 230], [90, 410]], hidPos = [0, 1, 2, 3].map((j) => [300, 150 + j * 120]), outPos = [510, 320];
    const edge = (a, b, w) => {
      g.strokeStyle = w >= 0 ? '#4a7fe0' : '#ef5a5a';
      g.lineWidth = 1.5 + Math.min(10, Math.abs(w) * 2.4);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    };
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) edge(inPos[i], hidPos[j], net.w1[i][j]);
    for (let j = 0; j < 4; j++) edge(hidPos[j], outPos, net.w2[j]);
    const node = (p, act, label, r = 34) => {
      const v = Math.max(0, Math.min(1, (act + 1) / 2));
      g.fillStyle = `rgb(${255 - v * 60}, ${205 + v * 30}, ${60 + v * 40})`;
      g.strokeStyle = '#2b2340'; g.lineWidth = 6;
      g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#2b2340'; g.font = 'bold 28px "Fredoka", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, p[0], p[1] + 1);
    };
    node(inPos[0], x0 * 2 - 1, String(x0));
    node(inPos[1], x1 * 2 - 1, String(x1));
    hidPos.forEach((p, j) => node(p, h[j], h[j].toFixed(1), 30));
    node(outPos, o * 2 - 1, o.toFixed(2), 42);
    g.fillStyle = '#6b6088'; g.font = '24px "Fredoka", sans-serif';
    g.fillText('input', 90, 500); g.fillText('hidden (tanh)', 300, 640); g.fillText('output (sigmoid)', 510, 400);
    // decision map
    const mapX = 640, mapY = 110, S = 300, N = 20;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const v = net.forward(i / (N - 1), 1 - j / (N - 1)).o;
      g.fillStyle = `rgb(${Math.round(74 + v * 181)}, ${Math.round(127 + v * 78)}, ${Math.round(224 - v * 164)})`;
      g.fillRect(mapX + (i * S) / N, mapY + (j * S) / N, S / N + 1, S / N + 1);
    }
    g.strokeStyle = '#2b2340'; g.lineWidth = 5; g.strokeRect(mapX, mapY, S, S);
    for (const [a, b, y] of XOR) {
      g.fillStyle = y ? '#ffcd3c' : '#4a7fe0';
      g.beginPath(); g.arc(mapX + a * S, mapY + (1 - b) * S, 16, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#2b2340'; g.font = 'bold 24px "Fredoka", sans-serif'; g.textAlign = 'center';
    g.fillText('decision map  (yellow = 1, blue = 0)', mapX + S / 2, mapY + S + 34);
    // loss curve
    const lx = 600, ly = 500, lw = 380, lh = 170;
    g.strokeStyle = '#c9bfa8'; g.lineWidth = 3; g.strokeRect(lx, ly, lw, lh);
    const L = net.losses;
    if (L.length > 1) {
      const max = Math.max(...L.slice(0, 5), 0.01);
      g.strokeStyle = '#2fa86a'; g.lineWidth = 5; g.beginPath();
      L.forEach((v, i) => {
        const px = lx + (i / (L.length - 1)) * lw, py = ly + lh - Math.min(1, v / max) * lh;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
    g.textAlign = 'left'; g.font = 'bold 26px "DejaVu Sans Mono", monospace'; g.fillStyle = '#2b2340';
    g.fillText(`epoch ${net.epoch}   loss ${net.loss.toFixed(4)}`, lx, ly - 14);
    g.font = 'bold 34px "Fredoka", sans-serif';
    g.fillStyle = nn.done ? '#2fa86a' : nn.training ? '#e8822a' : '#8a62e8';
    g.fillText(nn.done ? 'Learned XOR!' : nn.training ? 'training…' : 'click to train', 40, 720);
    nnTex.needsUpdate = true;
  }
  function startTraining(reset = true) {
    if (reset || nn.done) net.reset();
    nn.training = true;
    nn.done = false;
    sfx.use();
    return true;
  }
  api.train = (reset) => startTraining(reset || nn.done || !nn.training);
  api.predict = (a, b) => net.forward(a, b).o;
  drawNN();
  let nnDraw = 0;
  animated.push((t, dt) => {
    nn.sampleT += dt;
    if (nn.sampleT > 0.7) { nn.sampleT = 0; nn.sample = (nn.sample + 1) % 4; }
    if (nn.training) {
      for (let i = 0; i < 25; i++) net.step();
      if (net.loss < 0.004) {
        nn.training = false; nn.done = true;
        emit('ai'); sfx.success();
        terminal.print(`[ai lab] XOR learned in ${net.epoch} epochs (loss ${net.loss.toFixed(4)}). Try: predict 1 0`, '#5ad1ff');
      } else if (net.epoch > 12000) net.reset(); // stuck in a local minimum: start over
    }
    if ((nnDraw += dt) > 0.1 && camera.position.distanceTo(easel.position) < 7) { nnDraw = 0; drawNN(); }
  });
  interact(easel, '[E] AI lab: train the neural net', () => {
    startTraining(true);
    showInfo('AI lab', 'A real 2-4-1 neural network trains with backpropagation on XOR, the classic problem a single neuron cannot solve. Blue edges are positive weights, red are negative, and thickness is size. Afterwards: <code>predict 1 0</code>.', 9000);
  });

  // ================================================================ 3D printer on the TV cabinet
  renderer.localClippingEnabled = true;
  const printer = new THREE.Group();
  printer.position.set(4.74, 0.5, 0.88);
  printer.rotation.y = -Math.PI / 2;
  scene.add(printer);
  const frameMat = mat(0x3d4a72), accent = mat(C.orange);
  box(0.36, 0.05, 0.32, frameMat, 0, 0.025, 0, printer, 0.015);
  for (const x of [-0.16, 0.16]) box(0.03, 0.42, 0.03, frameMat, x, 0.26, -0.12, printer, 0.01);
  box(0.36, 0.035, 0.035, frameMat, 0, 0.47, -0.12, printer, 0.012);
  const spool = cyl(0.06, 0.06, 0.04, accent, 0, 0.55, -0.12, printer, 20);
  spool.rotation.z = Math.PI / 2;
  const bed = box(0.26, 0.012, 0.24, mat(0x2b2340), 0, 0.06, 0.02, printer, 0.004);
  bed.receiveShadow = true;
  const gantry = new THREE.Group();
  printer.add(gantry);
  box(0.33, 0.02, 0.025, mat(0xb8bcc8), 0, 0, -0.11, gantry, 0.006);
  const headG = new THREE.Group();
  gantry.add(headG);
  box(0.05, 0.05, 0.05, accent, 0, 0.02, 0, headG, 0.012);
  const nozzle = cyl(0.002, 0.008, 0.02, mat(0xd8a040), 0, -0.015, 0, headG, 8);
  const hotTip = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  hotTip.userData = { ...noOutline };
  ball(0.004, hotTip, 0, -0.027, 0, headG, 6);
  const scrSign = sign('3D printer', { w: 0.2, h: 0.05, accent: '#ff9b3d' });
  scrSign.position.set(0, 0.025, 0.162);
  printer.add(scrSign);
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const MODELS = [
    ['gear', () => {
      const sh = new THREE.Shape();
      const teeth = 10, r1 = 0.055, r2 = 0.07;
      for (let i = 0; i < teeth * 2; i++) {
        const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2, r = i % 2 ? r1 : r2;
        if (i === 0) sh.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
        sh.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        sh.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      }
      const hole = new THREE.Path(); hole.absarc(0, 0, 0.018, 0, Math.PI * 2, true); sh.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: false });
      g.rotateX(-Math.PI / 2);
      return g;
    }],
    ['rocket', () => {
      const pts = [[0, 0], [0.03, 0], [0.035, 0.02], [0.035, 0.11], [0.028, 0.15], [0.014, 0.18], [0, 0.195]].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(pts, 24);
    }],
    ['rook', () => {
      const pts = [[0, 0], [0.05, 0], [0.05, 0.015], [0.035, 0.03], [0.028, 0.1], [0.042, 0.11], [0.042, 0.14], [0.03, 0.14], [0.03, 0.13], [0, 0.13]].map(([x, y]) => new THREE.Vector2(x, y));
      return new THREE.LatheGeometry(pts, 24);
    }],
  ];
  let modelIdx = -1;
  const pr = { printing: false, t: 0, dur: 16, mesh: null, h: 0.1, tick: 0 };
  api.startPrint = () => {
    if (pr.printing) return null;
    modelIdx = (modelIdx + 1) % MODELS.length;
    const [name, make] = MODELS[modelIdx];
    if (pr.mesh) printer.remove(pr.mesh);
    const geo = make();
    geo.computeBoundingBox();
    pr.h = geo.boundingBox.max.y;
    const m = new THREE.MeshToonMaterial({ color: [C.yellow, C.green, C.pink][modelIdx], gradientMap: k.gradientMap, clippingPlanes: [clipPlane], side: THREE.DoubleSide });
    m.userData = { outlineParameters: { visible: false } };
    pr.mesh = new THREE.Mesh(geo, m);
    pr.mesh.position.set(0, 0.066, 0.02);
    pr.mesh.castShadow = true;
    printer.add(pr.mesh);
    clipPlane.constant = -100; // nothing visible until the first layer
    pr.printing = true; pr.t = 0; pr.name = name;
    return name;
  };
  const wp = new THREE.Vector3();
  animated.push((t, dt) => {
    if (!pr.printing) {
      gantry.position.y = 0.4;
      headG.position.set(0.1, 0, 0);
      return;
    }
    pr.t += dt;
    const f = Math.min(1, pr.t / pr.dur);
    const layerY = 0.066 + f * pr.h;
    gantry.position.y = layerY + 0.03;
    const a = t * 9;
    const rr = 0.03 + 0.025 * Math.sin(t * 2.3);
    headG.position.set(Math.cos(a) * rr, 0, 0.02 + Math.sin(a) * rr + 0.11);
    pr.mesh.getWorldPosition(wp);
    clipPlane.constant = wp.y + f * pr.h; // keep everything below the current layer
    if ((pr.tick += dt) > 0.14) { pr.tick = 0; sfx.tone?.(420 + Math.random() * 160, 0.05, { type: 'square', vol: 0.02 }); }
    if (f >= 1) {
      pr.printing = false;
      clipPlane.constant = 100;
      pr.mesh.material.userData.outlineParameters.visible = true;
      emit('print'); sfx.success();
      showInfo('3D printer', `Print finished: a little ${pr.name}! Click the printer again for the next model.`);
    }
  });
  interact(printer, '[E] 3D printer: print something', () => {
    const name = api.startPrint();
    showInfo('3D printer', name ? `Slicing <code>${name}.stl</code> and printing it layer by layer (a clipping plane rises with the nozzle).` : 'Still printing. Patience: real prints take hours!');
  });

  // ================================================================ CTF scoreboard (south wall, next to the safe)
  const sb = new THREE.Group();
  sb.position.set(-3.75, 1.85, 3.96);
  sb.rotation.y = Math.PI;
  scene.add(sb);
  box(0.96, 0.72, 0.035, ink, 0, 0, 0, sb, 0.015);
  const sbCanvas = document.createElement('canvas');
  sbCanvas.width = 768; sbCanvas.height = 576;
  const sbTex = new THREE.CanvasTexture(sbCanvas);
  sbTex.colorSpace = THREE.SRGBColorSpace;
  const sbPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.66), new THREE.MeshBasicMaterial({ map: sbTex }));
  sbPlane.material.userData = { ...noOutline };
  sbPlane.position.z = 0.019;
  sb.add(sbPlane);
  function drawScore(found) {
    const g = sbCanvas.getContext('2d');
    const W = sbCanvas.width, H = sbCanvas.height;
    g.fillStyle = '#14112a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffcd3c'; g.font = 'bold 54px "Fredoka", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CTF SCOREBOARD', W / 2, 56);
    g.fillStyle = '#c8f7d4'; g.font = 'bold 30px "DejaVu Sans Mono", monospace';
    g.fillText(`${found.size} / ${FLAGS.length} flags`, W / 2, 112);
    FLAGS.forEach((f, i) => {
      const y = 170 + i * 72;
      const got = found.has(f.id);
      g.fillStyle = got ? '#2fa86a' : '#2d2a4a';
      g.fillRect(40, y - 28, W - 80, 56);
      g.fillStyle = got ? '#ffffff' : '#8f86b8'; g.textAlign = 'left'; g.font = 'bold 28px "DejaVu Sans Mono", monospace';
      g.fillText(`${got ? '[x]' : '[ ]'} ${f.id}`, 60, y);
      g.textAlign = 'right'; g.font = '24px "Fredoka", sans-serif';
      g.fillText(got ? 'captured!' : 'hidden…', W - 60, y);
    });
    g.textAlign = 'center'; g.fillStyle = '#8f86b8'; g.font = '24px "Fredoka", sans-serif';
    g.fillText('start: cat ~/ctf/README.txt  ·  submit flag{...}', W / 2, H - 24);
    sbTex.needsUpdate = true;
  }
  drawScore(terminal.ctfFound);
  api.onFlag = (found) => {
    drawScore(found);
    if (found.size === FLAGS.length) { emit('ctf'); sfx.fanfare(); showInfo('CTF complete!', 'All 5 flags captured. You would do great at a real CTF.', 8000); }
  };
  interact(sb, 'CTF scoreboard', () => {
    const missing = FLAGS.filter((f) => !terminal.ctfFound.has(f.id));
    showInfo('CTF scoreboard', `${terminal.ctfFound.size}/${FLAGS.length} flags captured.` + (missing.length ? `<br>Next hint: ${missing[0].hint.replace(/`([^`]+)`/g, '<code>$1</code>')}<br><small>Submit in the terminal: <code>submit flag{...}</code> · list: <code>flags</code></small>` : ' All done!'), 9000);
  });

  return api;
}
